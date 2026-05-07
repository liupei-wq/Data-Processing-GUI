"""XAS / XANES API endpoints.

Handles TEY/TFY dual-channel XAS data from beamline DAT files.
"""

from __future__ import annotations

import io
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from core.parsers import looks_like_excel, numeric_excel_table
from core.peak_fitting import fit_peaks
from core.processing import apply_background, apply_normalization
from core.spectrum_ops import interpolate_spectrum_to_grid, mean_spectrum_arrays
from db.xas_database import get_sample_edge_peaks, list_samples

router = APIRouter()


# ── parsing helpers (self-contained, no streamlit dependency) ─────────────────

def _is_numeric_line(line: str) -> bool:
    parts = line.strip().replace(",", " ").split()
    if not parts:
        return False
    try:
        for part in parts:
            float(part)
        return True
    except ValueError:
        return False


def _parse_xas_table_bytes(raw: bytes):
    """Parse text-like XAS/DAT files and return only numeric columns."""
    excel_df, excel_err = numeric_excel_table(raw, min_columns=3)
    if excel_df is not None:
        return excel_df, None
    if excel_err and looks_like_excel(raw):
        return None, excel_err

    for enc in ("utf-8", "utf-8-sig", "big5", "cp950", "latin-1", "utf-16"):
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue

        lines = text.splitlines()
        numeric_lines: list[str] = []
        in_block = False
        for line in lines:
            if _is_numeric_line(line):
                in_block = True
                numeric_lines.append(line.strip())
            elif in_block:
                break

        if len(numeric_lines) >= 2:
            clean = "\n".join(numeric_lines)
            for sep in ("\t", ",", r"\s+"):
                try:
                    df = pd.read_csv(io.StringIO(clean), sep=sep, header=None, engine="python")
                    num = df.apply(pd.to_numeric, errors="coerce")
                    valid = [col for col in num.columns if num[col].notna().mean() > 0.8]
                    if len(valid) >= 3:
                        out = num[valid].dropna(how="any").copy()
                        out.columns = [f"col_{i + 1}" for i in range(out.shape[1])]
                        return out.reset_index(drop=True), None
                except Exception:
                    pass

        clean_lines = [
            line for line in lines
            if line.strip() and line.strip()[0] not in ("#", "%", ";", "!")
        ]
        if clean_lines:
            clean = "\n".join(clean_lines)
            for sep in (",", "\t", r"\s+"):
                for header in (0, None):
                    try:
                        df = pd.read_csv(io.StringIO(clean), sep=sep, header=header, engine="python")
                        num = df.apply(pd.to_numeric, errors="coerce")
                        valid = [col for col in num.columns if num[col].notna().mean() > 0.8]
                        if len(valid) >= 3:
                            out = num[valid].dropna(how="any").copy()
                            out.columns = [f"col_{i + 1}" for i in range(out.shape[1])]
                            return out.reset_index(drop=True), None
                    except Exception:
                        pass

    return None, "無法解析：請確認檔案至少包含 Energy、TEY、TFY 三欄數字"


def _prepare_tey_tfy_auto(df: pd.DataFrame, flip_tfy: bool):
    """Auto-detect TEY/TFY columns and return (energy, {TEY: arr, TFY: arr}, mapping, error)."""
    if df.shape[1] < 3:
        return np.array([]), {}, {}, "至少需要 Energy、TEY、TFY 三欄"

    energy = df.iloc[:, 0].to_numpy(dtype=float)
    mapping: dict[str, Any] = {"energy_col": 1, "flip_tfy": bool(flip_tfy)}

    if df.shape[1] >= 6:
        # Beamline DAT: Energy, Phase, Gap, CurMD-03(TFY), CurMD-01(TEY), CurMD-02(I0)
        i0 = df.iloc[:, 5].to_numpy(dtype=float)
        denom = np.where(np.abs(i0) > 1e-30, np.abs(i0), np.nan)
        tey_raw = df.iloc[:, 4].to_numpy(dtype=float)
        tfy_raw = df.iloc[:, 3].to_numpy(dtype=float)
        tey = tey_raw / denom
        tfy = tfy_raw / denom
        mapping["mode"] = "beamline_dat_6col"
        mapping["i0_col"] = 6
        mapping["tey_col"] = 5
        mapping["tfy_col"] = 4
    else:
        # Simple 3-col: Energy, TEY, TFY
        tey = df.iloc[:, 1].to_numpy(dtype=float)
        tfy = df.iloc[:, 2].to_numpy(dtype=float)
        mapping["mode"] = "simple_3col"

    if flip_tfy:
        tfy = 1.0 - tfy

    mask = np.isfinite(energy) & np.isfinite(tey) & np.isfinite(tfy)
    if np.count_nonzero(mask) < 2:
        return energy, {}, mapping, "有效資料點不足"

    energy = energy[mask]
    tey = tey[mask]
    tfy = tfy[mask]
    order = np.argsort(energy)
    return energy[order], {"TEY": tey[order], "TFY": tfy[order]}, mapping, None


def _find_white_line(x: np.ndarray, y: np.ndarray, e_min: float, e_max: float) -> float | None:
    mask = (x >= e_min) & (x <= e_max)
    if not np.any(mask):
        return None
    idx = int(np.argmax(y[mask]))
    return float(x[mask][idx])


def _normalize_post_edge(
    x: np.ndarray, y: np.ndarray,
    edge_region: tuple[float, float],
    norm_region: tuple[float, float],
) -> tuple[np.ndarray, float]:
    """Normalize by post-edge step height using a linear pre/post baseline."""
    pre_mask = (x >= edge_region[0]) & (x <= edge_region[1])
    post_mask = (x >= norm_region[0]) & (x <= norm_region[1])

    if not np.any(pre_mask) or not np.any(post_mask):
        return y, 1.0

    pre_mean = float(np.mean(y[pre_mask]))
    post_mean = float(np.mean(y[post_mask]))
    edge_step = post_mean - pre_mean
    if abs(edge_step) < 1e-20:
        return y, 1.0

    normalized = (y - pre_mean) / edge_step
    return normalized, edge_step


# ── Gaussian template helpers ─────────────────────────────────────────────────

_GAUSS_SIGMA_FACTOR = 2.3548200450309493  # 2√(2ln2)


def _gaussian(x: np.ndarray, center: float, fwhm: float, amplitude: float) -> np.ndarray:
    sigma = fwhm / _GAUSS_SIGMA_FACTOR
    return amplitude * np.exp(-0.5 * ((x - center) / sigma) ** 2)


def _fit_gaussian_center(
    x: np.ndarray, y: np.ndarray,
    center: float, fwhm: float, amplitude: float,
    search_range: float,
) -> float:
    """Return best center via dot-product cross-correlation within ±search_range."""
    if search_range <= 0:
        return center
    sigma = fwhm / _GAUSS_SIGMA_FACTOR
    c_lo = max(float(x[0]), center - search_range)
    c_hi = min(float(x[-1]), center + search_range)
    candidates = np.linspace(c_lo, c_hi, 200)
    scores = np.array([
        float(np.dot(y, amplitude * np.exp(-0.5 * ((x - c) / sigma) ** 2)))
        for c in candidates
    ])
    return float(candidates[int(np.argmax(scores))])


# ── pydantic models ───────────────────────────────────────────────────────────

class GaussPeak(BaseModel):
    center: float
    fwhm: float
    amplitude: float


class ParsedXasFile(BaseModel):
    name: str
    x: List[float]
    tey: List[float]
    tfy: List[float]
    mapping: Dict[str, Any]
    n_cols: int


class ParseResponse(BaseModel):
    files: List[ParsedXasFile]
    errors: List[str] = Field(default_factory=list)


class DatasetInput(BaseModel):
    name: str
    x: List[float]
    tey: List[float]
    tfy: List[float]


class ProcessParams(BaseModel):
    interpolate: bool = False
    n_points: int = 2000
    average: bool = False
    energy_shift: float = 0.0
    bg_enabled: bool = False
    bg_method: str = "linear"         # linear | polynomial | asls | airpls
    bg_tey_start: Optional[float] = None
    bg_tey_end: Optional[float] = None
    bg_tfy_start: Optional[float] = None
    bg_tfy_end: Optional[float] = None
    bg_poly_deg: int = 3
    bg_baseline_lambda: float = 1e5
    bg_baseline_p: float = 0.01
    bg_baseline_iter: int = 20
    norm_method: str = "none"         # none | min_max | max | area | post_edge | mean_region
    norm_tey_start: Optional[float] = None
    norm_tey_end: Optional[float] = None
    norm_tfy_start: Optional[float] = None
    norm_tfy_end: Optional[float] = None
    norm_tey_pre_start: Optional[float] = None  # for post_edge: pre-edge region start
    norm_tey_pre_end: Optional[float] = None    # for post_edge: pre-edge region end
    norm_tfy_pre_start: Optional[float] = None
    norm_tfy_pre_end: Optional[float] = None
    white_line_start: Optional[float] = None
    white_line_end: Optional[float] = None
    gauss_enabled: bool = False
    gauss_channel: str = "both"             # both | TEY | TFY
    gauss_peaks: List[GaussPeak] = Field(default_factory=list)
    gauss_search: float = 0.5              # ±eV center search range
    d2y_enabled: bool = False


class ProcessRequest(BaseModel):
    datasets: List[DatasetInput]
    params: ProcessParams


class ProcessedDataset(BaseModel):
    name: str
    x: List[float]
    tey_raw: List[float]
    tfy_raw: List[float]
    tey_processed: List[float]
    tfy_processed: List[float]
    white_line_tey: Optional[float] = None
    white_line_tfy: Optional[float] = None
    edge_step_tey: Optional[float] = None
    edge_step_tfy: Optional[float] = None
    tey_gaussian: Optional[List[float]] = None
    tfy_gaussian: Optional[List[float]] = None
    tey_after_gauss: Optional[List[float]] = None
    tfy_after_gauss: Optional[List[float]] = None
    tey_d2y: Optional[List[float]] = None
    tfy_d2y: Optional[List[float]] = None


class ProcessResponse(BaseModel):
    datasets: List[ProcessedDataset]
    average: Optional[ProcessedDataset] = None


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/parse", response_model=ParseResponse)
async def parse_xas_files(
    files: List[UploadFile] = File(...),
    flip_tfy: bool = True,
):
    results: list[ParsedXasFile] = []
    errors: list[str] = []

    for uf in files:
        raw = await uf.read()
        df, err = _parse_xas_table_bytes(raw)
        if err or df is None:
            errors.append(f"{uf.filename}: {err or '解析失敗'}")
            continue

        energy, channels, mapping, prep_err = _prepare_tey_tfy_auto(df, flip_tfy)
        if prep_err:
            errors.append(f"{uf.filename}: {prep_err}")
            continue

        results.append(ParsedXasFile(
            name=uf.filename or "unknown",
            x=energy.tolist(),
            tey=channels["TEY"].tolist(),
            tfy=channels["TFY"].tolist(),
            mapping=mapping,
            n_cols=int(df.shape[1]),
        ))

    return ParseResponse(files=results, errors=errors)


@router.post("/process", response_model=ProcessResponse)
def process_xas(req: ProcessRequest):
    p = req.params
    datasets = req.datasets

    if not datasets:
        raise HTTPException(status_code=400, detail="沒有資料集")

    processed_datasets: list[ProcessedDataset] = []

    for ds in datasets:
        x = np.array(ds.x, dtype=float)
        tey = np.array(ds.tey, dtype=float)
        tfy = np.array(ds.tfy, dtype=float)

        # energy shift
        x_shifted = x + p.energy_shift

        # interpolation
        if p.interpolate:
            x_grid = np.linspace(float(x_shifted.min()), float(x_shifted.max()), int(p.n_points))
            tey = np.interp(x_grid, x_shifted, tey)
            tfy = np.interp(x_grid, x_shifted, tfy)
            x_shifted = x_grid

        x_out = x_shifted

        tey_proc = tey.copy()
        tfy_proc = tfy.copy()

        # gaussian template subtraction (before BG)
        tey_gauss_model: np.ndarray | None = None
        tfy_gauss_model: np.ndarray | None = None
        tey_after_gauss: np.ndarray | None = None
        tfy_after_gauss: np.ndarray | None = None

        if p.gauss_enabled and p.gauss_peaks:
            apply_tey = p.gauss_channel in ("both", "TEY")
            apply_tfy = p.gauss_channel in ("both", "TFY")

            if apply_tey:
                model = np.zeros_like(tey_proc)
                for gp in p.gauss_peaks:
                    c = _fit_gaussian_center(x_out, tey_proc, gp.center, gp.fwhm, gp.amplitude, p.gauss_search)
                    model += _gaussian(x_out, c, gp.fwhm, gp.amplitude)
                tey_gauss_model = model
                tey_proc = tey_proc - model
                tey_after_gauss = tey_proc.copy()

            if apply_tfy:
                model = np.zeros_like(tfy_proc)
                for gp in p.gauss_peaks:
                    c = _fit_gaussian_center(x_out, tfy_proc, gp.center, gp.fwhm, gp.amplitude, p.gauss_search)
                    model += _gaussian(x_out, c, gp.fwhm, gp.amplitude)
                tfy_gauss_model = model
                tfy_proc = tfy_proc - model
                tfy_after_gauss = tfy_proc.copy()

        # background subtraction
        if p.bg_enabled:
            x_min = float(np.min(x_out))
            x_max = float(np.max(x_out))
            bg_common_kwargs: dict[str, Any] = {
                "method": p.bg_method,
                "poly_deg": p.bg_poly_deg,
                "baseline_lambda": p.bg_baseline_lambda,
                "baseline_p": p.bg_baseline_p,
                "baseline_iter": p.bg_baseline_iter,
            }
            tey_proc, _ = apply_background(
                x_out,
                tey_proc,
                bg_x_start=p.bg_tey_start if p.bg_tey_start is not None else x_min,
                bg_x_end=p.bg_tey_end if p.bg_tey_end is not None else x_max,
                **bg_common_kwargs,
            )
            tfy_proc, _ = apply_background(
                x_out,
                tfy_proc,
                bg_x_start=p.bg_tfy_start if p.bg_tfy_start is not None else x_min,
                bg_x_end=p.bg_tfy_end if p.bg_tfy_end is not None else x_max,
                **bg_common_kwargs,
            )

        # normalization
        edge_step_tey: float | None = None
        edge_step_tfy: float | None = None

        if p.norm_method == "post_edge":
            x_min = float(np.min(x_out))
            x_max = float(np.max(x_out))
            x_span = max(x_max - x_min, 1e-12)
            tey_pre_start = p.norm_tey_pre_start if p.norm_tey_pre_start is not None else x_min
            tey_pre_end = p.norm_tey_pre_end if p.norm_tey_pre_end is not None else x_min + x_span * 0.3
            tey_norm_start = p.norm_tey_start if p.norm_tey_start is not None else x_min + x_span * 0.7
            tey_norm_end = p.norm_tey_end if p.norm_tey_end is not None else x_max
            tfy_pre_start = p.norm_tfy_pre_start if p.norm_tfy_pre_start is not None else x_min
            tfy_pre_end = p.norm_tfy_pre_end if p.norm_tfy_pre_end is not None else x_min + x_span * 0.3
            tfy_norm_start = p.norm_tfy_start if p.norm_tfy_start is not None else x_min + x_span * 0.7
            tfy_norm_end = p.norm_tfy_end if p.norm_tfy_end is not None else x_max
            tey_proc, step_t = _normalize_post_edge(
                x_out,
                tey_proc,
                (tey_pre_start, tey_pre_end),
                (tey_norm_start, tey_norm_end),
            )
            tfy_proc, step_f = _normalize_post_edge(
                x_out,
                tfy_proc,
                (tfy_pre_start, tfy_pre_end),
                (tfy_norm_start, tfy_norm_end),
            )
            edge_step_tey = float(step_t)
            edge_step_tfy = float(step_f)
        elif p.norm_method != "none" and p.norm_method != "post_edge":
            tey_proc = apply_normalization(
                x_out,
                tey_proc,
                norm_method=p.norm_method,
                norm_x_start=p.norm_tey_start,
                norm_x_end=p.norm_tey_end,
            )
            tfy_proc = apply_normalization(
                x_out,
                tfy_proc,
                norm_method=p.norm_method,
                norm_x_start=p.norm_tfy_start,
                norm_x_end=p.norm_tfy_end,
            )

        # white line
        wl_tey: float | None = None
        wl_tfy: float | None = None
        if p.white_line_start is not None and p.white_line_end is not None:
            wl_tey = _find_white_line(x_out, tey_proc, p.white_line_start, p.white_line_end)
            wl_tfy = _find_white_line(x_out, tfy_proc, p.white_line_start, p.white_line_end)

        # second derivative
        tey_d2y: np.ndarray | None = None
        tfy_d2y: np.ndarray | None = None
        if p.d2y_enabled and len(x_out) > 4:
            tey_d2y = np.gradient(np.gradient(tey_proc, x_out), x_out)
            tfy_d2y = np.gradient(np.gradient(tfy_proc, x_out), x_out)

        processed_datasets.append(ProcessedDataset(
            name=ds.name,
            x=x_out.tolist(),
            tey_raw=tey.tolist(),
            tfy_raw=tfy.tolist(),
            tey_processed=tey_proc.tolist(),
            tfy_processed=tfy_proc.tolist(),
            white_line_tey=wl_tey,
            white_line_tfy=wl_tfy,
            edge_step_tey=edge_step_tey,
            edge_step_tfy=edge_step_tfy,
            tey_gaussian=tey_gauss_model.tolist() if tey_gauss_model is not None else None,
            tfy_gaussian=tfy_gauss_model.tolist() if tfy_gauss_model is not None else None,
            tey_after_gauss=tey_after_gauss.tolist() if tey_after_gauss is not None else None,
            tfy_after_gauss=tfy_after_gauss.tolist() if tfy_after_gauss is not None else None,
            tey_d2y=tey_d2y.tolist() if tey_d2y is not None else None,
            tfy_d2y=tfy_d2y.tolist() if tfy_d2y is not None else None,
        ))

    # average across all datasets
    average_ds: ProcessedDataset | None = None
    if p.average and len(processed_datasets) > 1:
        try:
            x_ref = np.array(processed_datasets[0].x)
            tey_arrays = [np.interp(x_ref, np.array(d.x), np.array(d.tey_processed)) for d in processed_datasets]
            tfy_arrays = [np.interp(x_ref, np.array(d.x), np.array(d.tfy_processed)) for d in processed_datasets]
            tey_avg = np.mean(tey_arrays, axis=0)
            tfy_avg = np.mean(tfy_arrays, axis=0)
            wl_tey_avg: float | None = None
            wl_tfy_avg: float | None = None
            if p.white_line_start is not None and p.white_line_end is not None:
                wl_tey_avg = _find_white_line(x_ref, tey_avg, p.white_line_start, p.white_line_end)
                wl_tfy_avg = _find_white_line(x_ref, tfy_avg, p.white_line_start, p.white_line_end)
            average_ds = ProcessedDataset(
                name="平均",
                x=x_ref.tolist(),
                tey_raw=tey_avg.tolist(),
                tfy_raw=tfy_avg.tolist(),
                tey_processed=tey_avg.tolist(),
                tfy_processed=tfy_avg.tolist(),
                white_line_tey=wl_tey_avg,
                white_line_tfy=wl_tfy_avg,
            )
        except Exception:
            pass

    return ProcessResponse(datasets=processed_datasets, average=average_ds)


# ── XANES deconvolution ───────────────────────────────────────────────────────

class DeconvPeak(BaseModel):
    center: float
    delta: float = 2.0
    name: str = ""
    ptype: str = "gaussian"   # gaussian | lorentzian


class DeconvRequest(BaseModel):
    x: List[float]
    y: List[float]
    peaks: List[DeconvPeak]
    fwhm_inst: float = 0.5
    fwhm_init: float = 1.5
    link_fwhm: bool = False
    include_step: bool = True
    e0: float = 0.0
    fit_lo: Optional[float] = None
    fit_hi: Optional[float] = None


class DeconvParamRow(BaseModel):
    name: str
    value: float
    stderr: float
    vary: bool


class DeconvResponse(BaseModel):
    success: bool
    x_fit: List[float]
    y_fit: List[float]
    components: Dict[str, List[float]]
    residual: List[float]
    r_factor: float
    params_table: List[DeconvParamRow]
    message: str = ""


@router.post("/deconv", response_model=DeconvResponse)
def xanes_deconv(req: DeconvRequest):
    try:
        from lmfit.models import GaussianModel, LorentzianModel, StepModel
        from lmfit import Parameters
    except ImportError:
        raise HTTPException(status_code=500, detail="lmfit 未安裝，無法執行 XANES 去卷積擬合")

    x = np.array(req.x, dtype=float)
    y = np.array(req.y, dtype=float)

    lo = req.fit_lo if req.fit_lo is not None else float(x[0])
    hi = req.fit_hi if req.fit_hi is not None else float(x[-1])
    mask = (x >= lo) & (x <= hi)
    if mask.sum() < 4:
        raise HTTPException(status_code=400, detail="擬合範圍內資料點不足")

    x_f = x[mask]
    y_f = y[mask]

    _SIGMA_FACTOR = 2.3548200450309493
    sigma_inst = req.fwhm_inst / _SIGMA_FACTOR
    sigma_init = req.fwhm_init / _SIGMA_FACTOR

    composite = None
    params = Parameters()

    if req.include_step:
        step = StepModel(form='arctan', prefix='step_')
        composite = step
        params.update(step.make_params(
            center=dict(value=req.e0, vary=False),
            amplitude=dict(value=1.0, vary=False),
            sigma=dict(value=sigma_inst, min=sigma_inst * 0.5),
        ))

    for i, pk in enumerate(req.peaks):
        prefix = f'p{i}_'
        comp = LorentzianModel(prefix=prefix) if pk.ptype == 'lorentzian' else GaussianModel(prefix=prefix)
        p = comp.make_params()
        p[f'{prefix}center'].set(value=pk.center, min=pk.center - pk.delta, max=pk.center + pk.delta)
        p[f'{prefix}amplitude'].set(value=0.3, min=0)
        if req.link_fwhm and req.include_step and i == 0:
            p[f'{prefix}sigma'].set(value=sigma_init, min=sigma_inst)
        elif req.link_fwhm and req.include_step and i > 0:
            p[f'{prefix}sigma'].set(expr='p0_sigma', min=sigma_inst)
        else:
            p[f'{prefix}sigma'].set(value=sigma_init, min=sigma_inst)
        params.update(p)
        composite = comp if composite is None else composite + comp

    if composite is None:
        raise HTTPException(status_code=400, detail="沒有任何擬合分量")

    try:
        fit_result = composite.fit(y_f, params, x=x_f, method='leastsq')
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"擬合失敗：{exc}") from exc

    y_fit_arr = np.array(fit_result.best_fit)
    residual = y_f - y_fit_arr
    ss_res = float(np.sum(residual ** 2))
    ss_tot = float(np.sum(y_f ** 2))
    r_factor = ss_res / ss_tot if ss_tot > 0 else 0.0

    comps_raw = fit_result.eval_components(x=x_f)
    components: Dict[str, List[float]] = {k: list(map(float, v)) for k, v in comps_raw.items()}

    param_rows = [
        DeconvParamRow(
            name=name,
            value=float(par.value),
            stderr=float(par.stderr) if par.stderr is not None else 0.0,
            vary=bool(par.vary),
        )
        for name, par in fit_result.params.items()
    ]

    return DeconvResponse(
        success=bool(fit_result.success),
        x_fit=x_f.tolist(),
        y_fit=y_fit_arr.tolist(),
        components=components,
        residual=residual.tolist(),
        r_factor=r_factor,
        params_table=param_rows,
        message=str(fit_result.message) if fit_result.message else "",
    )


# ── Peak fitting (XPS-compatible, adapted for XAS energy axis) ────────────────

class XasInitPeak(BaseModel):
    center: float
    fwhm: float
    amplitude: float
    label: Optional[str] = None


class XasFitRequest(BaseModel):
    x: List[float]
    y: List[float]
    peaks: List[XasInitPeak]
    profile: str = "voigt"
    maxfev: int = 20000
    peak_labels: Optional[List[str]] = None


class XasFitPeakRow(BaseModel):
    Peak_Name: str
    Center_eV: float
    FWHM_eV: float
    Area: float
    Height: float
    Area_pct: Optional[float] = None


class XasFitResponse(BaseModel):
    y_fit: List[float]
    y_individual: List[List[float]]
    residuals: List[float]
    peaks: List[XasFitPeakRow]


@router.post("/fit", response_model=XasFitResponse)
def fit_xas_peaks(req: XasFitRequest):
    x = np.array(req.x, dtype=float)
    y = np.array(req.y, dtype=float)

    if len(x) < 4 or not req.peaks:
        raise HTTPException(status_code=400, detail="資料或峰值參數不足")

    init_peaks = [
        {"center": pk.center, "fwhm": pk.fwhm, "amplitude": pk.amplitude}
        for pk in req.peaks
    ]

    try:
        result = fit_peaks(x, y, init_peaks, profile=req.profile, maxfev=req.maxfev)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"擬合失敗：{exc}") from exc

    if not result.get("success", False):
        raise HTTPException(status_code=422, detail=result.get("message", "擬合失敗"))

    raw_peaks = result.get("peaks", [])
    total_area = sum(abs(pk.get("area", 0)) for pk in raw_peaks)

    rows: list[XasFitPeakRow] = []
    for i, pk in enumerate(raw_peaks, 1):
        area = float(pk.get("area", 0))
        name = (
            req.peak_labels[i - 1]
            if req.peak_labels and i - 1 < len(req.peak_labels)
            else str(pk.get("label", f"Peak {i}"))
        )
        rows.append(XasFitPeakRow(
            Peak_Name=name,
            Center_eV=float(pk.get("center", 0)),
            FWHM_eV=float(pk.get("fwhm", 0)),
            Area=area,
            Height=float(pk.get("amplitude", 0)),
            Area_pct=round(100 * abs(area) / total_area, 2) if total_area > 0 else 0,
        ))

    def _to_list(arr):
        return arr.tolist() if hasattr(arr, "tolist") else list(arr)

    return XasFitResponse(
        y_fit=_to_list(result.get("y_fit", [])),
        y_individual=[_to_list(yi) for yi in result.get("y_individual", [])],
        residuals=_to_list(result.get("residuals", [])),
        peaks=rows,
    )


# ── XAS sample database endpoints ─────────────────────────────────────────────

class XasSampleListItem(BaseModel):
    name: str
    description: str
    edges: List[str]


class XasEdgePeak(BaseModel):
    label: str
    energy_eV: float
    fwhm_eV: float
    meaning: str


class XasSampleEdgeResponse(BaseModel):
    sample: str
    edge: str
    energy_range: List[float]
    peaks: List[XasEdgePeak]


@router.get("/samples", response_model=List[XasSampleListItem])
def get_xas_samples():
    return [XasSampleListItem(**s) for s in list_samples()]


@router.get("/sample-peaks/{sample_name}/{edge_name:path}", response_model=XasSampleEdgeResponse)
def get_xas_sample_peaks(sample_name: str, edge_name: str):
    data = get_sample_edge_peaks(sample_name, edge_name)
    if data is None:
        raise HTTPException(status_code=404, detail=f"找不到樣品 '{sample_name}' 或邊 '{edge_name}'")
    return XasSampleEdgeResponse(
        sample=data["sample"],
        edge=data["edge"],
        energy_range=data["energy_range"],
        peaks=[XasEdgePeak(**p) for p in data["peaks"]],
    )
