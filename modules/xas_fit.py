"""XANES deconvolution fitting utilities (Step function + peaks, lmfit backend)."""
from __future__ import annotations

import numpy as np
import pandas as pd

try:
    from lmfit.models import GaussianModel, LorentzianModel, StepModel
    LMFIT_AVAILABLE = True
except ImportError:
    LMFIT_AVAILABLE = False

PEAK_TYPES = ["Gaussian", "Lorentzian"]

# ── helpers ────────────────────────────────────────────────────────────────

def default_peak_df() -> pd.DataFrame:
    return pd.DataFrame({
        "啟用": pd.Series([], dtype=bool),
        "峰名稱": pd.Series([], dtype=str),
        "中心_eV": pd.Series([], dtype=float),
        "偏移範圍_eV": pd.Series([], dtype=float),
        "峰形": pd.Series([], dtype=str),
    })


def add_peak(df: pd.DataFrame, center: float, name: str, ptype: str, delta: float) -> pd.DataFrame:
    n = len(df) + 1
    row = pd.DataFrame([{
        "啟用": True,
        "峰名稱": name or f"Peak {n}",
        "中心_eV": round(center, 4),
        "偏移範圍_eV": round(delta, 3),
        "峰形": ptype,
    }])
    return pd.concat([df, row], ignore_index=True)


def second_derivative(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Smooth second derivative via np.gradient twice."""
    dy = np.gradient(y, x)
    d2y = np.gradient(dy, x)
    return d2y


def calc_r_factor(y_data: np.ndarray, y_fit: np.ndarray) -> float:
    denom = np.sum(y_data ** 2)
    if denom == 0:
        return float("nan")
    return float(np.sum((y_data - y_fit) ** 2) / denom)


# ── main fit ───────────────────────────────────────────────────────────────

def run_xanes_fit(
    energy: np.ndarray,
    y_norm: np.ndarray,
    peaks_df: pd.DataFrame,
    fwhm_inst: float,
    fwhm_init: float,
    link_fwhm: bool,
    include_step: bool,
    e0: float,
    fit_range: tuple[float, float],
) -> dict:
    """
    Fit XANES spectrum with Step function + Gaussian/Lorentzian peaks.

    Returns dict:
        success, y_fit, components, residual, r_factor, redchi,
        params_table, message, fit_range
    """
    if not LMFIT_AVAILABLE:
        return {"success": False, "message": "未安裝 lmfit，請執行：pip install lmfit"}

    from lmfit import Parameters as LMParams

    lo, hi = sorted(fit_range)
    mask = (energy >= lo) & (energy <= hi)
    x_fit = energy[mask]
    y_fit_data = y_norm[mask]

    if len(x_fit) < 5:
        return {"success": False, "message": "擬合範圍內數據點不足（< 5 點）"}

    active = peaks_df[peaks_df["啟用"] == True].reset_index(drop=True)
    if len(active) == 0 and not include_step:
        return {"success": False, "message": "至少需要一個啟用的峰或 Step Function"}

    sigma_inst = fwhm_inst / 2.3548
    sigma_init = max(fwhm_init / 2.3548, sigma_inst)

    model = None
    params = LMParams()

    # ── Step function ──────────────────────────────────────────────────────
    if include_step:
        step_mdl = StepModel(form="arctan", prefix="step_")
        step_p = step_mdl.make_params()
        step_p["step_center"].set(value=e0, vary=False)
        step_p["step_amplitude"].set(value=1.0, vary=False)
        step_p["step_sigma"].set(value=sigma_init, min=sigma_inst, vary=True)
        model = step_mdl
        params.update(step_p)

    # ── Peaks ──────────────────────────────────────────────────────────────
    first_peak_prefix = None
    for i, row in active.iterrows():
        pref = f"p{i}_"
        ptype = str(row.get("峰形", "Gaussian"))
        peak_mdl = LorentzianModel(prefix=pref) if ptype == "Lorentzian" else GaussianModel(prefix=pref)
        pp = peak_mdl.make_params()

        ctr = float(row["中心_eV"])
        delta = float(row.get("偏移範圍_eV", 0.3))
        amp_init = max(1e-6, float(np.nanmax(np.abs(y_fit_data))) * 0.15)

        pp[f"{pref}center"].set(value=ctr, min=ctr - delta, max=ctr + delta)
        pp[f"{pref}amplitude"].set(value=amp_init, min=0)

        if link_fwhm:
            if include_step:
                pp[f"{pref}sigma"].set(expr="step_sigma", min=sigma_inst)
            elif first_peak_prefix is not None:
                pp[f"{pref}sigma"].set(expr=f"{first_peak_prefix}sigma", min=sigma_inst)
            else:
                pp[f"{pref}sigma"].set(value=sigma_init, min=sigma_inst, vary=True)
        else:
            pp[f"{pref}sigma"].set(value=sigma_init, min=sigma_inst, vary=True)

        if first_peak_prefix is None:
            first_peak_prefix = pref

        params.update(pp)
        model = peak_mdl if model is None else model + peak_mdl

    if model is None:
        return {"success": False, "message": "模型建立失敗（無有效元件）"}

    # ── Run fit ────────────────────────────────────────────────────────────
    try:
        result = model.fit(y_fit_data, params, x=x_fit, method="leastsq")
    except Exception as exc:
        return {"success": False, "message": f"擬合失敗：{exc}"}

    # ── Full-range arrays ──────────────────────────────────────────────────
    y_fit_full = np.full_like(y_norm, np.nan, dtype=float)
    y_fit_full[mask] = result.best_fit
    residual_full = np.full_like(y_norm, np.nan, dtype=float)
    residual_full[mask] = result.residual

    # ── Components ────────────────────────────────────────────────────────
    comp_dict_fit = result.eval_components(x=x_fit)
    components: dict[str, np.ndarray] = {}
    for pref, vals in comp_dict_fit.items():
        full = np.full_like(y_norm, np.nan, dtype=float)
        full[mask] = vals
        components[pref] = full

    # ── Params table ──────────────────────────────────────────────────────
    rows = []
    for i, row in active.iterrows():
        pref = f"p{i}_"
        sigma_key = f"{pref}sigma"
        sigma_val = result.params[sigma_key].value if sigma_key in result.params else np.nan
        fwhm_val = sigma_val * 2.3548 if np.isfinite(sigma_val) else np.nan
        ctr_fit = result.params[f"{pref}center"].value if f"{pref}center" in result.params else float(row["中心_eV"])
        amp_val = result.params[f"{pref}amplitude"].value if f"{pref}amplitude" in result.params else np.nan

        rows.append({
            "峰名稱": row["峰名稱"],
            "峰形": row["峰形"],
            "擬合中心_eV": round(float(ctr_fit), 4),
            "初始中心_eV": round(float(row["中心_eV"]), 4),
            "偏移_eV": round(float(ctr_fit) - float(row["中心_eV"]), 4),
            "FWHM_eV": round(float(fwhm_val), 4) if np.isfinite(fwhm_val) else None,
            "振幅": round(float(amp_val), 6) if np.isfinite(amp_val) else None,
        })

    return {
        "success": True,
        "y_fit": y_fit_full,
        "components": components,
        "residual": residual_full,
        "r_factor": calc_r_factor(y_fit_data, result.best_fit),
        "redchi": float(result.redchi) if result.redchi is not None else float("nan"),
        "ndata": int(np.sum(mask)),
        "params_table": pd.DataFrame(rows),
        "message": "擬合完成",
        "fit_range": (lo, hi),
    }
