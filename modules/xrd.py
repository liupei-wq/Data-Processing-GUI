"""XRD-specific numerical helpers, reference-table utilities, and Streamlit UI."""

from __future__ import annotations

import json
from datetime import datetime

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from scipy.signal import peak_widths

from core.parsers import parse_two_column_spectrum_bytes
from core.spectrum_ops import detect_spectrum_peaks, interpolate_spectrum_to_grid, mean_spectrum_arrays
from core.ui_helpers import _next_btn, auto_scroll_on_appear, scroll_anchor, step_exp_label, step_header
from core.processing import apply_normalization, smooth_signal
from db.xrd_database import XRD_REFERENCES


XRD_WAVELENGTHS = {
    "Cu Kα": 1.54060,
    "Cu Kα1": 1.54056,
    "Cu Kα2": 1.54439,
    "Co Kα": 1.78901,
    "Mo Kα": 0.70930,
    "Cr Kα": 2.28970,
    "Fe Kα": 1.93604,
    "自訂": None,
}


def two_theta_to_d_spacing(two_theta_deg: np.ndarray, wavelength_angstrom: float) -> np.ndarray:
    two_theta_deg = np.asarray(two_theta_deg, dtype=float)
    if wavelength_angstrom <= 0:
        return np.full_like(two_theta_deg, np.nan, dtype=float)

    theta_rad = np.deg2rad(two_theta_deg / 2.0)
    denom = 2.0 * np.sin(theta_rad)
    with np.errstate(divide="ignore", invalid="ignore"):
        d_spacing = np.where(denom > 0, wavelength_angstrom / denom, np.nan)
    return d_spacing


def d_spacing_to_two_theta(d_spacing_A: np.ndarray, wavelength_angstrom: float) -> np.ndarray:
    d_spacing_A = np.asarray(d_spacing_A, dtype=float)
    if wavelength_angstrom <= 0:
        return np.full_like(d_spacing_A, np.nan, dtype=float)

    ratio = wavelength_angstrom / (2.0 * d_spacing_A)
    with np.errstate(divide="ignore", invalid="ignore"):
        two_theta = np.where(
            (d_spacing_A > 0) & (ratio > 0) & (ratio <= 1),
            2.0 * np.rad2deg(np.arcsin(ratio)),
            np.nan,
        )
    return two_theta


def xrd_axis_values(
    two_theta_deg: np.ndarray,
    axis_mode: str,
    wavelength_angstrom: float,
) -> np.ndarray:
    if axis_mode == "d_spacing":
        return two_theta_to_d_spacing(two_theta_deg, wavelength_angstrom)
    return np.asarray(two_theta_deg, dtype=float)


def build_xrd_reference_df(
    selected_phases: list[str],
    wavelength_angstrom: float,
    min_rel_intensity: float,
    two_theta_min: float,
    two_theta_max: float,
) -> pd.DataFrame:
    rows = []
    for phase_name in selected_phases:
        phase = XRD_REFERENCES.get(phase_name)
        if not phase:
            continue
        for pk in phase.get("peaks", []):
            d_spacing = float(pk["d"])
            two_theta = float(d_spacing_to_two_theta(np.array([d_spacing]), wavelength_angstrom)[0])
            rel_i = float(pk["rel_i"])
            if not np.isfinite(two_theta):
                continue
            if rel_i < float(min_rel_intensity):
                continue
            if two_theta < float(two_theta_min) or two_theta > float(two_theta_max):
                continue
            rows.append({
                "Phase": phase_name,
                "Formula": phase.get("formula", ""),
                "Structure": phase.get("phase", ""),
                "hkl": pk.get("hkl", ""),
                "d_spacing_A": d_spacing,
                "two_theta_deg": two_theta,
                "Relative_Intensity_pct": rel_i,
            })

    if not rows:
        return pd.DataFrame(columns=[
            "Phase", "Formula", "Structure", "hkl",
            "d_spacing_A", "two_theta_deg", "Relative_Intensity_pct",
        ])

    ref_df = pd.DataFrame(rows)
    return ref_df.sort_values(["Phase", "two_theta_deg"], ignore_index=True)


def match_xrd_reference_peaks(
    reference_df: pd.DataFrame,
    observed_df: pd.DataFrame,
    tolerance_deg: float,
) -> pd.DataFrame:
    if reference_df.empty or observed_df.empty:
        return pd.DataFrame(columns=[
            "Dataset", "Phase", "hkl", "Ref_2theta_deg", "Ref_d_spacing_A",
            "Ref_Relative_Intensity_pct", "Observed_2theta_deg", "Observed_d_spacing_A",
            "Observed_Intensity", "Delta_2theta_deg", "Matched",
        ])

    rows = []
    for dataset, obs_df in observed_df.groupby("Dataset", sort=False):
        obs_two_theta = obs_df["2theta_deg"].to_numpy(dtype=float)
        for _, ref in reference_df.iterrows():
            if len(obs_two_theta) == 0:
                continue
            delta = np.abs(obs_two_theta - float(ref["two_theta_deg"]))
            best_pos = int(np.argmin(delta))
            best_obs = obs_df.iloc[best_pos]
            best_delta = float(delta[best_pos])
            rows.append({
                "Dataset": dataset,
                "Phase": ref["Phase"],
                "hkl": ref["hkl"],
                "Ref_2theta_deg": float(ref["two_theta_deg"]),
                "Ref_d_spacing_A": float(ref["d_spacing_A"]),
                "Ref_Relative_Intensity_pct": float(ref["Relative_Intensity_pct"]),
                "Observed_2theta_deg": float(best_obs["2theta_deg"]),
                "Observed_d_spacing_A": float(best_obs["d_spacing_A"]),
                "Observed_Intensity": float(best_obs["Intensity"]),
                "Delta_2theta_deg": best_delta,
                "Matched": bool(best_delta <= float(tolerance_deg)),
            })

    if not rows:
        return pd.DataFrame(columns=[
            "Dataset", "Phase", "hkl", "Ref_2theta_deg", "Ref_d_spacing_A",
            "Ref_Relative_Intensity_pct", "Observed_2theta_deg", "Observed_d_spacing_A",
            "Observed_Intensity", "Delta_2theta_deg", "Matched",
        ])

    match_df = pd.DataFrame(rows)
    return match_df.sort_values(["Dataset", "Phase", "Ref_2theta_deg"], ignore_index=True)


def detect_xrd_peaks(
    x: np.ndarray,
    y: np.ndarray,
    prominence_ratio: float,
    height_ratio: float,
    min_distance_deg: float,
    max_peaks: int,
) -> np.ndarray:
    return detect_spectrum_peaks(
        x, y, prominence_ratio, height_ratio, min_distance_deg, max_peaks
    )


def build_xrd_peak_table(
    dataset: str,
    x: np.ndarray,
    y: np.ndarray,
    peak_idx: np.ndarray,
    wavelength_angstrom: float,
) -> pd.DataFrame:
    if len(peak_idx) == 0:
        return pd.DataFrame(columns=[
            "Dataset", "Peak", "2theta_deg", "d_spacing_A", "Intensity",
            "Relative_Intensity_pct", "FWHM_deg",
        ])

    widths, _, left_ips, right_ips = peak_widths(y, peak_idx, rel_height=0.5)
    sample_axis = np.arange(len(x), dtype=float)
    left_x = np.interp(left_ips, sample_axis, x)
    right_x = np.interp(right_ips, sample_axis, x)

    peak_x = x[peak_idx]
    peak_y = y[peak_idx]
    curve_max = float(np.max(y)) if len(y) else 0.0
    rel_intensity = (peak_y / curve_max * 100.0) if curve_max > 0 else np.zeros_like(peak_y)
    peak_d = two_theta_to_d_spacing(peak_x, wavelength_angstrom)

    return pd.DataFrame({
        "Dataset": dataset,
        "Peak": np.arange(1, len(peak_idx) + 1),
        "2theta_deg": peak_x,
        "d_spacing_A": peak_d,
        "Intensity": peak_y,
        "Relative_Intensity_pct": rel_intensity,
        "FWHM_deg": np.abs(right_x - left_x),
    })


def scherrer_crystallite_size(
    two_theta_deg: float,
    fwhm_deg: float,
    wavelength_angstrom: float,
    K: float = 0.9,
    instrument_broadening_deg: float = 0.0,
    broadening_correction: str = "none",
) -> float:
    """Scherrer formula: D (nm) = K*λ / (β*cosθ). Returns NaN on invalid input."""
    if not (np.isfinite(two_theta_deg) and np.isfinite(fwhm_deg)
            and fwhm_deg > 0 and wavelength_angstrom > 0 and two_theta_deg > 0):
        return np.nan
    beta = float(fwhm_deg)
    b_inst = float(instrument_broadening_deg)
    if broadening_correction == "gaussian" and beta > b_inst > 0:
        beta = float(np.sqrt(max(0.0, beta ** 2 - b_inst ** 2)))
    elif broadening_correction == "lorentzian" and beta > b_inst > 0:
        beta = beta - b_inst
    if beta <= 0:
        return np.nan
    beta_rad = np.deg2rad(beta)
    theta_rad = np.deg2rad(float(two_theta_deg) / 2.0)
    cos_theta = float(np.cos(theta_rad))
    if cos_theta <= 0 or beta_rad <= 0:
        return np.nan
    return float(K * wavelength_angstrom / (beta_rad * cos_theta)) / 10.0  # Å → nm


def build_scherrer_table(
    peak_df: pd.DataFrame,
    wavelength_angstrom: float,
    K: float = 0.9,
    instrument_broadening_deg: float = 0.0,
    broadening_correction: str = "none",
) -> pd.DataFrame:
    if peak_df.empty or "FWHM_deg" not in peak_df.columns:
        return pd.DataFrame()
    df = peak_df.copy()
    d_nm_vals = [
        scherrer_crystallite_size(
            float(row.get("2theta_deg", np.nan)),
            float(row.get("FWHM_deg", np.nan)),
            wavelength_angstrom,
            K=K,
            instrument_broadening_deg=instrument_broadening_deg,
            broadening_correction=broadening_correction,
        )
        for _, row in df.iterrows()
    ]
    df["D_Scherrer_nm"] = d_nm_vals
    df["D_Scherrer_A"] = [d * 10.0 if np.isfinite(d) else np.nan for d in d_nm_vals]
    return df


def _build_export_filename(stem: str, extension: str) -> str:
    clean_stem = str(stem or "").strip() or "export"
    clean_ext = str(extension or "").strip().lstrip(".")
    if not clean_ext:
        return clean_stem
    if clean_stem.lower().endswith(f".{clean_ext.lower()}"):
        return clean_stem
    return f"{clean_stem}.{clean_ext}"


def _render_download_card(
    *,
    title: str,
    description: str,
    input_label: str,
    default_name: str,
    extension: str,
    button_label: str,
    data: bytes,
    mime: str,
    input_key: str,
    button_key: str,
) -> None:
    with st.container(border=True):
        st.markdown(f"**{title}**")
        st.caption(description)
        export_stem = st.text_input(
            input_label,
            value=default_name,
            key=input_key,
        )
        st.download_button(
            button_label,
            data=data,
            file_name=_build_export_filename(export_stem, extension),
            mime=mime,
            key=button_key,
            use_container_width=True,
        )


def _json_safe(value):
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, np.ndarray):
        return [_json_safe(v) for v in value.tolist()]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if np.isnan(value) else float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if pd.isna(value):
        return None
    return value


def _dataframe_records(df: pd.DataFrame) -> list[dict]:
    if df is None or df.empty:
        return []
    return [_json_safe(row) for row in df.to_dict(orient="records")]


def _process_column_display_name(col: str) -> str:
    if col.endswith("_raw") or col == "Intensity_raw":
        return "原始"
    if col.endswith("_gaussian_model"):
        return "高斯模板"
    if col.endswith("_gaussian_subtracted"):
        return "扣高斯後"
    if col.endswith("_smoothed") or col == "Intensity_smoothed":
        return "平滑後"
    if col.endswith("_normalized") or col == "Intensity_normalized":
        return "歸一化後"
    if col.endswith("_log10"):
        return "log10 後"
    if col.endswith("_ln"):
        return "ln 後"
    return col.replace("_", " ")


def _default_compare_columns(columns: list[str]) -> list[str]:
    ordered: list[str] = []
    for matcher in [
        lambda c: c.endswith("_raw") or c == "Intensity_raw",
        lambda c: c.endswith("_gaussian_subtracted"),
        lambda c: c.endswith("_smoothed") or c == "Intensity_smoothed",
        lambda c: c.endswith("_normalized") or c == "Intensity_normalized",
        lambda c: c.endswith("_log10") or c.endswith("_ln"),
    ]:
        match = next((col for col in columns if matcher(col)), None)
        if match and match not in ordered:
            ordered.append(match)
    return ordered[: min(3, len(ordered))] if ordered else columns[: min(3, len(columns))]


def _empty_gaussian_center_df(default_center: float) -> pd.DataFrame:
    return pd.DataFrame([
        {
            "啟用": True,
            "峰名稱": "Peak 1",
            "中心_2theta_deg": float(default_center),
        }
    ])


def _normalize_gaussian_center_df(df: pd.DataFrame, default_center: float) -> pd.DataFrame:
    if df is None:
        return _empty_gaussian_center_df(default_center)
    result = df.copy()
    if "啟用" not in result.columns:
        result["啟用"] = True
    if "峰名稱" not in result.columns:
        result["峰名稱"] = ""
    if "中心_2theta_deg" not in result.columns:
        result["中心_2theta_deg"] = default_center
    result = result[["啟用", "峰名稱", "中心_2theta_deg"]].copy()
    result["啟用"] = result["啟用"].fillna(False).astype(bool)
    result["峰名稱"] = result["峰名稱"].fillna("").astype(str)
    result["中心_2theta_deg"] = pd.to_numeric(result["中心_2theta_deg"], errors="coerce")
    return result.reset_index(drop=True)


def _gaussian_template_from_area(
    x: np.ndarray,
    center_deg: float,
    fwhm_deg: float,
    area: float,
) -> np.ndarray:
    sigma = float(max(fwhm_deg, 1e-12)) / (2.0 * np.sqrt(2.0 * np.log(2.0)))
    amplitude = float(area) / (sigma * np.sqrt(2.0 * np.pi))
    return amplitude * np.exp(-0.5 * ((x - float(center_deg)) / sigma) ** 2)


def _fit_fixed_gaussian_templates(
    x: np.ndarray,
    signal: np.ndarray,
    center_df: pd.DataFrame,
    fixed_fwhm_deg: float,
    fixed_area: float,
    search_half_width_deg: float,
) -> tuple[np.ndarray, np.ndarray, pd.DataFrame]:
    if len(x) == 0 or len(signal) == 0:
        return np.array([]), np.array([]), pd.DataFrame()

    valid_df = center_df.copy()
    valid_df = valid_df[valid_df["啟用"] & valid_df["中心_2theta_deg"].notna()].copy()
    if valid_df.empty:
        return np.zeros_like(signal, dtype=float), np.asarray(signal, dtype=float).copy(), pd.DataFrame(columns=[
            "Peak_Name", "Seed_Center_2theta_deg", "Fitted_Center_2theta_deg",
            "Shift_deg", "Fixed_FWHM_deg", "Fixed_Area", "Template_Height",
        ])

    valid_df = valid_df.sort_values("中心_2theta_deg", ignore_index=True)
    residual = np.asarray(signal, dtype=float).copy()
    total_model = np.zeros_like(residual, dtype=float)
    fit_rows: list[dict] = []
    local_half_window = float(max(search_half_width_deg, fixed_fwhm_deg * 3.0))

    for idx, row in valid_df.iterrows():
        seed_center = float(row["中心_2theta_deg"])
        low = max(float(np.min(x)), seed_center - float(search_half_width_deg))
        high = min(float(np.max(x)), seed_center + float(search_half_width_deg))
        if not np.isfinite(low) or not np.isfinite(high) or low >= high:
            candidate_centers = np.array([seed_center], dtype=float)
        else:
            candidate_centers = np.linspace(low, high, 161, dtype=float)

        best_center = seed_center
        best_score = -np.inf
        positive_residual = np.clip(residual, a_min=0.0, a_max=None)
        for center in candidate_centers:
            mask = (x >= center - local_half_window) & (x <= center + local_half_window)
            if int(np.count_nonzero(mask)) < 3:
                continue
            local_x = x[mask]
            local_model = _gaussian_template_from_area(local_x, float(center), fixed_fwhm_deg, fixed_area)
            score = float(np.trapezoid(positive_residual[mask] * local_model, local_x))
            if score > best_score:
                best_score = score
                best_center = float(center)

        best_model = _gaussian_template_from_area(x, best_center, fixed_fwhm_deg, fixed_area)
        residual = residual - best_model
        total_model += best_model
        peak_name = str(row.get("峰名稱", "")).strip() or f"Peak {idx + 1}"
        fit_rows.append({
            "Peak_Name": peak_name,
            "Seed_Center_2theta_deg": seed_center,
            "Fitted_Center_2theta_deg": best_center,
            "Shift_deg": best_center - seed_center,
            "Fixed_FWHM_deg": float(fixed_fwhm_deg),
            "Fixed_Area": float(fixed_area),
            "Template_Height": float(np.max(best_model)),
        })

    return total_model, residual, pd.DataFrame(fit_rows)


def _safe_log_transform(
    signal: np.ndarray,
    method: str,
    floor_value: float,
) -> tuple[np.ndarray, float]:
    y = np.asarray(signal, dtype=float)
    if len(y) == 0 or method == "none":
        return y.copy(), 0.0
    finite_y = y[np.isfinite(y)]
    min_y = float(np.min(finite_y)) if len(finite_y) else 0.0
    shift = max(0.0, -min_y + float(floor_value))
    shifted = np.maximum(y + shift, float(floor_value))
    if method == "ln":
        return np.log(shifted), shift
    return np.log10(shifted), shift


def run_xrd_ui() -> None:
    XRD_COLORS = ["#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
                  "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52"]
    REF_COLORS = ["#FFD166", "#06D6A0", "#EF476F", "#118AB2", "#F78C6B", "#B794F4"]

    with st.sidebar:
        step_header(1, "載入檔案")
        uploaded_files = st.file_uploader(
            "上傳 XRD .txt / .csv / .xy / .asc 檔案（可多選）",
            type=["txt", "csv", "xy", "asc", "asc_"],
            accept_multiple_files=True,
            key="xrd_uploader",
        )

    if not uploaded_files:
        st.info("請在左側上傳一個或多個 XRD 檔案。")
        st.stop()

    data_dict: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for uf in uploaded_files:
        cache_key = f"_xrd_{uf.name}_{uf.size}"
        if cache_key not in st.session_state:
            x_vals, y_vals, err = parse_two_column_spectrum_bytes(uf.read())
            if err:
                st.session_state[cache_key] = (None, None, err)
            else:
                st.session_state[cache_key] = (
                    np.asarray(x_vals, dtype=float).ravel(),
                    np.asarray(y_vals, dtype=float).ravel(),
                    None,
                )
        cached = st.session_state[cache_key]
        if cached[2] is not None:
            st.error(f"**{uf.name}** 讀取失敗：{cached[2]}")
        else:
            data_dict[uf.name] = (cached[0], cached[1])

    if not data_dict:
        st.stop()

    st.success(f"成功載入 {len(data_dict)} 個檔案：{', '.join(data_dict.keys())}")
    y_max_global = float(max(np.nanmax(yv) for _, yv in data_dict.values()))

    all_x = np.concatenate([xv for xv, _ in data_dict.values()])
    x_min_g = float(all_x.min())
    x_max_g = float(all_x.max())
    ov_min = float(max(xv.min() for xv, _ in data_dict.values()))
    ov_max = float(min(xv.max() for xv, _ in data_dict.values()))
    if ov_min >= ov_max:
        ov_min, ov_max = x_min_g, x_max_g

    cur_range = st.session_state.get("xrd_disp", (ov_min, ov_max))
    e0 = float(np.clip(float(min(cur_range)), x_min_g, x_max_g))
    e1 = float(np.clip(float(max(cur_range)), x_min_g, x_max_g))
    if e0 >= e1:
        e0, e1 = ov_min, ov_max

    step_size = float(max(0.01, (x_max_g - x_min_g) / 2000))
    peak_distance_default = float(max(step_size, min(0.20, max(step_size, (e1 - e0) / 150))))
    gauss_fwhm_default = float(max(step_size * 3.0, min(0.35, max(step_size * 3.0, peak_distance_default))))
    gauss_height_default = float(max(1.0, y_max_global * 0.10))
    gauss_area_default = gauss_height_default * gauss_fwhm_default * 1.0645
    gauss_search_default = float(max(step_size * 3.0, gauss_fwhm_default * 2.0))

    do_interpolate = False
    do_average = False
    show_individual = False
    interp_points = 2001
    scherrer_enabled = False
    scherrer_K = 0.9
    scherrer_inst_broadening = 0.0
    scherrer_correction = "none"

    log_enabled = False
    log_method = "log10"
    log_floor_value = 1e-6

    with st.sidebar:
        s6 = st.session_state.get("xrd_s6", False)
        _skip6 = st.session_state.get("xrd_skip_log", False)
        with st.expander(step_exp_label(2, "取對數（弱峰檢視）", s6 or _skip6), expanded=not (s6 or _skip6)):
            skip_log = st.checkbox("跳過此步驟 ✓", key="xrd_skip_log")
            if not skip_log:
                st.caption("當強峰與弱峰差很多、弱峰埋在底部、或你想更容易看出寬廣尾巴時可用。這一步主要用於檢視，不建議直接拿 log 強度解讀 peak area。")
                log_enabled = st.checkbox(
                    "建立 log 顯示曲線",
                    value=bool(st.session_state.get("xrd_log_enabled", False)),
                    key="xrd_log_enabled",
                )
                if log_enabled:
                    log_method = st.selectbox(
                        "方法",
                        ["log10", "ln"],
                        format_func=lambda v: {"log10": "log10", "ln": "自然對數 ln"}[v],
                        key="xrd_log_method",
                    )
                    log_floor_value = float(st.number_input(
                        "最小正值 / 自動平移基準",
                        min_value=1e-12,
                        max_value=1.0,
                        value=1e-6,
                        format="%.1e",
                        key="xrd_log_floor",
                    ))
            if skip_log:
                st.session_state["xrd_s6"] = True
            s6 = st.session_state.get("xrd_s6", False)
            if not skip_log and not s6:
                if _next_btn("xrd_btn6_log", "xrd_s6"):
                    s6 = True
        skip_log = st.session_state.get("xrd_skip_log", False)
        s6 = st.session_state.get("xrd_s6", False)
        step2_done = skip_log or s6

    with st.sidebar:
        s2 = st.session_state.get("xrd_s2", False)
        if step2_done:
            _skip2 = st.session_state.get("xrd_skip_avg", False)
            with st.expander(step_exp_label(3, "內插化及平均化", s2 or _skip2), expanded=not (s2 or _skip2)):
                skip_avg = st.checkbox("跳過此步驟 ✓", key="xrd_skip_avg")
                if not skip_avg:
                    do_interpolate = st.checkbox(
                        "對每個載入檔案做內插化",
                        value=bool(st.session_state.get("xrd_do_interp", False)),
                        key="xrd_do_interp",
                    )
                    if len(data_dict) < 2:
                        st.session_state["xrd_do_avg"] = False
                    do_average = st.checkbox(
                        "對所有載入的檔案做平均化",
                        value=bool(st.session_state.get("xrd_do_avg", False)),
                        key="xrd_do_avg",
                        disabled=len(data_dict) < 2,
                    )
                    if len(data_dict) < 2:
                        st.caption("目前只有 1 個檔案，因此平均化已停用；若需要統一點數，可單獨使用內插化。")
                    if do_interpolate or do_average:
                        interp_points = int(st.number_input(
                            "插值點數", min_value=100, max_value=10000, value=2001, step=100, key="xrd_interp"
                        ))
                    if do_average:
                        show_individual = st.checkbox("疊加顯示原始個別曲線", value=False, key="xrd_show_ind")
                if skip_avg:
                    st.session_state["xrd_s2"] = True
                s2 = st.session_state.get("xrd_s2", False)
                if not skip_avg and not s2:
                    if _next_btn("xrd_btn2", "xrd_s2"):
                        s2 = True
            skip_avg = st.session_state.get("xrd_skip_avg", False)
            s2 = st.session_state.get("xrd_s2", False)
        else:
            skip_avg = False
        step3_done = step2_done and (skip_avg or s2)
    apply_interpolation = bool(do_interpolate or do_average)

    gaussian_enabled = False
    gaussian_fixed_height = gauss_height_default
    gaussian_fixed_fwhm = gauss_fwhm_default
    gaussian_fixed_area = gaussian_fixed_height * gaussian_fixed_fwhm * 1.0645
    gaussian_search_half_width = gauss_search_default
    gaussian_center_df = _empty_gaussian_center_df((e0 + e1) / 2.0)

    with st.sidebar:
        s3_gauss = st.session_state.get("xrd_s3_gauss", False)
        if step3_done:
            _skip3_gauss = st.session_state.get("xrd_skip_gauss", False)
            with st.expander(step_exp_label(4, "高斯模板扣除", s3_gauss or _skip3_gauss), expanded=not (s3_gauss or _skip3_gauss)):
                skip_gauss = st.checkbox("跳過此步驟 ✓", key="xrd_skip_gauss")
                if not skip_gauss:
                    st.caption("這一步會在內插後，用固定面積與固定 FWHM 的高斯模板，只允許移動中心位置來做扣除。目的主要是幫你更穩定地找出每根 peak 的實際位置。")
                    gaussian_enabled = st.checkbox(
                        "啟用高斯模板扣除",
                        value=bool(st.session_state.get("xrd_gauss_enabled", False)),
                        key="xrd_gauss_enabled",
                    )
                    if gaussian_enabled:
                        if not apply_interpolation:
                            st.caption("前一步若未啟用內插化，這裡仍會先用固定點數建立等距網格，再做高斯模板扣除。")
                            interp_points = int(st.number_input(
                                "高斯扣除用插值點數",
                                min_value=100, max_value=10000, value=interp_points, step=100,
                                key="xrd_gauss_interp",
                            ))
                        _fwhm_max = float(max(5.0, (x_max_g - x_min_g) / 2.0))
                        _area_max = float(max(1000.0, gauss_area_default * 5.0))
                        _srch_max = float(max(5.0, (x_max_g - x_min_g) / 2.0))

                        # FWHM
                        _fwhm_cur = max(float(max(step_size, 1e-4)), min(_fwhm_max, float(st.session_state.get("xrd_gauss_fwhm", gauss_fwhm_default))))
                        st.session_state["_xrd_gauss_fwhm_sl"] = _fwhm_cur
                        def _on_xrd_fwhm_sl():
                            st.session_state["xrd_gauss_fwhm"] = st.session_state["_xrd_gauss_fwhm_sl"]
                        st.slider("FWHM 拉桿 (2θ)", float(max(step_size, 1e-4)), _fwhm_max, step=float(max(step_size, 0.005)),
                                  key="_xrd_gauss_fwhm_sl", on_change=_on_xrd_fwhm_sl)
                        gaussian_fixed_fwhm = float(st.number_input(
                            "固定 FWHM 精確輸入 (2θ)",
                            min_value=float(max(step_size, 1e-4)),
                            max_value=float(max(1.0, x_max_g - x_min_g)),
                            step=float(max(step_size, 0.01)),
                            format="%.4f",
                            key="xrd_gauss_fwhm",
                        ))

                        # 峰高 → 面積
                        _ht_max = float(max(y_max_global * 2.0, gauss_height_default * 5.0))
                        _ht_cur = max(0.0, min(_ht_max, float(st.session_state.get("xrd_gauss_height", gauss_height_default))))
                        st.session_state["_xrd_gauss_height_sl"] = _ht_cur
                        def _on_xrd_height_sl():
                            st.session_state["xrd_gauss_height"] = st.session_state["_xrd_gauss_height_sl"]
                        st.slider("峰高 拉桿", 0.0, _ht_max, step=float(max(0.1, gauss_height_default * 0.01)),
                                  key="_xrd_gauss_height_sl", on_change=_on_xrd_height_sl)
                        gaussian_fixed_height = float(st.number_input(
                            "峰高 精確輸入（從圖上讀取）",
                            min_value=0.0,
                            step=float(max(0.1, gauss_height_default * 0.01)),
                            format="%.4g",
                            key="xrd_gauss_height",
                        ))
                        gaussian_fixed_area = gaussian_fixed_height * gaussian_fixed_fwhm * 1.0645
                        st.caption(f"換算面積 = {gaussian_fixed_area:.4g}")

                        # 搜尋半寬
                        _srch_cur = max(float(max(step_size, 1e-4)), min(_srch_max, float(st.session_state.get("xrd_gauss_search_half_width", gauss_search_default))))
                        st.session_state["_xrd_gauss_srch_sl"] = _srch_cur
                        def _on_xrd_srch_sl():
                            st.session_state["xrd_gauss_search_half_width"] = st.session_state["_xrd_gauss_srch_sl"]
                        st.slider("搜尋半寬 拉桿 (±2θ)", float(max(step_size, 1e-4)), _srch_max, step=float(max(step_size, 0.005)),
                                  key="_xrd_gauss_srch_sl", on_change=_on_xrd_srch_sl)
                        gaussian_search_half_width = float(st.number_input(
                            "中心搜尋半寬 精確輸入 (±2θ)",
                            min_value=float(max(step_size, 1e-4)),
                            max_value=float(max(1.0, x_max_g - x_min_g)),
                            step=float(max(step_size, 0.01)),
                            format="%.4f",
                            key="xrd_gauss_search_half_width",
                        ))
                        center_state = st.session_state.get("xrd_gauss_centers_value")
                        if isinstance(center_state, list):
                            center_seed_df = pd.DataFrame(center_state)
                        else:
                            center_seed_df = _empty_gaussian_center_df((e0 + e1) / 2.0)
                        gaussian_center_df = _normalize_gaussian_center_df(center_seed_df, (e0 + e1) / 2.0)
                        gaussian_center_df = st.data_editor(
                            gaussian_center_df,
                            use_container_width=True,
                            hide_index=True,
                            num_rows="dynamic",
                            key="xrd_gauss_centers_editor",
                            column_config={
                                "啟用": st.column_config.CheckboxColumn("啟用"),
                                "峰名稱": st.column_config.TextColumn("峰名稱"),
                                "中心_2theta_deg": st.column_config.NumberColumn("中心位置 (2θ)", format="%.4f"),
                            },
                        )
                        gaussian_center_df = _normalize_gaussian_center_df(gaussian_center_df, (e0 + e1) / 2.0)
                        st.session_state["xrd_gauss_centers_value"] = gaussian_center_df.to_dict(orient="records")
                if skip_gauss:
                    st.session_state["xrd_s3_gauss"] = True
                s3_gauss = st.session_state.get("xrd_s3_gauss", False)
                if not skip_gauss and not s3_gauss:
                    if _next_btn("xrd_btn3_gauss", "xrd_s3_gauss"):
                        s3_gauss = True
            skip_gauss = st.session_state.get("xrd_skip_gauss", False)
            s3_gauss = st.session_state.get("xrd_s3_gauss", False)
        else:
            skip_gauss = False
        step4_done = step3_done and (skip_gauss or s3_gauss)

    effective_interpolation = bool(apply_interpolation or gaussian_enabled)

    smooth_method = "none"
    smooth_window = 11
    smooth_poly_deg = 3

    with st.sidebar:
        s4 = st.session_state.get("xrd_s4", False)
        if step4_done:
            _skip4 = st.session_state.get("xrd_skip_smooth", False)
            with st.expander(step_exp_label(5, "平滑", s4 or _skip4), expanded=not (s4 or _skip4)):
                skip_smooth = st.checkbox("跳過此步驟 ✓", key="xrd_skip_smooth")
                if not skip_smooth:
                    st.caption("若原始 XRD 曲線訊雜比已高、峰形清楚，可直接跳過；視窗過大則可能把窄峰抹平。")
                    smooth_method = st.selectbox(
                        "方法",
                        ["none", "moving_average", "savitzky_golay"],
                        format_func=lambda v: {
                            "none": "不平滑",
                            "moving_average": "移動平均",
                            "savitzky_golay": "Savitzky-Golay",
                        }[v],
                        key="xrd_smooth_method",
                    )
                    if smooth_method != "none":
                        smooth_window = int(st.number_input(
                            "視窗點數", min_value=3, max_value=301, value=11, step=2, key="xrd_smooth_window"
                        ))
                    if smooth_method == "savitzky_golay":
                        smooth_poly_deg = int(st.slider("多項式階數", 2, 5, 3, key="xrd_smooth_poly"))
                if skip_smooth:
                    st.session_state["xrd_s4"] = True
                s4 = st.session_state.get("xrd_s4", False)
                if not skip_smooth and not s4:
                    if _next_btn("xrd_btn4_smooth", "xrd_s4"):
                        s4 = True
            skip_smooth = st.session_state.get("xrd_skip_smooth", False)
            s4 = st.session_state.get("xrd_s4", False)
        else:
            skip_smooth = False
        step5_done = step4_done and (skip_smooth or s4)

    norm_method = "none"
    norm_x_start, norm_x_end = e0, e1

    with st.sidebar:
        s5 = st.session_state.get("xrd_s5", False)
        if step5_done:
            _skip5 = st.session_state.get("xrd_skip_norm", False)
            with st.expander(step_exp_label(6, "歸一化", s5 or _skip5), expanded=not (s5 or _skip5)):
                skip_norm = st.checkbox("跳過此步驟 ✓", key="xrd_skip_norm")
                if not skip_norm:
                    st.caption("若你要保留絕對強度差異做樣品比較，可跳過；若主要比峰形與峰位，歸一化通常會更直觀。")
                    norm_method = st.selectbox(
                        "方法",
                        ["none", "max", "min_max", "area"],
                        format_func=lambda v: {
                            "none": "不歸一化",
                            "max": "峰值歸一化（可選區間）",
                            "min_max": "Min-Max (0~1)",
                            "area": "面積歸一化（總面積 = 1）",
                        }[v],
                        key="xrd_norm_method",
                    )
                    if norm_method == "max":
                        prev = st.session_state.get("xrd_norm_range", (e0, e1))
                        lo = float(np.clip(float(min(prev)), e0, e1))
                        hi = float(np.clip(float(max(prev)), e0, e1))
                        if lo >= hi:
                            lo, hi = e0, e1
                        st.session_state["xrd_norm_range"] = (lo, hi)
                        norm_range = st.slider(
                            "歸一化參考區間 (2θ)",
                            min_value=e0, max_value=e1,
                            step=step_size, format="%.2f°",
                            key="xrd_norm_range",
                        )
                        norm_x_start = float(min(norm_range))
                        norm_x_end = float(max(norm_range))
                if skip_norm:
                    st.session_state["xrd_s5"] = True
                s5 = st.session_state.get("xrd_s5", False)
                if not skip_norm and not s5:
                    if _next_btn("xrd_btn5_norm", "xrd_s5"):
                        s5 = True
            skip_norm = st.session_state.get("xrd_skip_norm", False)
            s5 = st.session_state.get("xrd_s5", False)
        else:
            skip_norm = False
        step6_done = step5_done and (skip_norm or s5)

    with st.sidebar:
        step_header(7, "X 軸與 d-spacing")
        wavelength_name = st.selectbox(
            "X-ray wavelength",
            list(XRD_WAVELENGTHS.keys()),
            index=0,
            key="xrd_wavelength_name",
        )
        wavelength_angstrom = XRD_WAVELENGTHS[wavelength_name]
        if wavelength_angstrom is None:
            wavelength_angstrom = float(st.number_input(
                "自訂波長 (Å)",
                min_value=0.00001,
                value=1.54060,
                step=0.00001,
                format="%.5f",
                key="xrd_wavelength_custom",
            ))
        xrd_axis_mode = st.selectbox(
            "主圖 X 軸",
            ["two_theta", "d_spacing"],
            format_func=lambda v: {
                "two_theta": "2θ (degree)",
                "d_spacing": "d-spacing (Å)",
            }[v],
            key="xrd_axis_mode",
        )
        if xrd_axis_mode == "d_spacing":
            st.caption("顯示範圍仍以 2θ 滑桿控制。")

    selected_ref_phases: list[str] = []
    ref_min_rel_intensity = 10.0
    ref_match_tolerance = 0.30
    ref_overlay = True
    ref_only_matched = True
    run_reference_matching = False

    with st.sidebar:
        s8 = st.session_state.get("xrd_s8", False)
        if step6_done:
            _skip8 = st.session_state.get("xrd_skip_ref", False)
            with st.expander(step_exp_label(8, "參考峰比對", s8 or _skip8), expanded=not (s8 or _skip8)):
                skip_ref = st.checkbox("跳過此步驟 ✓", key="xrd_skip_ref")
                if not skip_ref:
                    st.caption("這裡會直接用目前處理後的 XRD 曲線在背景自動尋找局部峰位，再拿去和參考相位比對。")
                    selected_ref_phases = st.multiselect(
                        "選擇內建參考相位",
                        list(XRD_REFERENCES.keys()),
                        default=[],
                        key="xrd_ref_phases",
                    )
                    ref_min_rel_intensity = float(st.slider(
                        "最小參考相對強度 (%)", 1, 100, 10, 1, key="xrd_ref_min_int"
                    ))
                    ref_match_tolerance = float(st.number_input(
                        "匹配容差 (±2θ)",
                        min_value=0.01,
                        max_value=5.00,
                        value=0.30,
                        step=0.01,
                        format="%.2f",
                        key="xrd_ref_tol",
                    ))
                    ref_overlay = st.checkbox("在圖上疊加參考峰", value=True, key="xrd_ref_overlay")
                    ref_only_matched = st.checkbox("比對表只顯示容差內匹配", value=True, key="xrd_ref_only_match")
                    st.caption("內建資料為代表性參考峰，用於快速相辨識，不等同完整 PDF/JCPDS 卡。")
                if skip_ref:
                    st.session_state["xrd_s8"] = True
                s8 = st.session_state.get("xrd_s8", False)
                if not skip_ref and not s8:
                    if _next_btn("xrd_btn8_ref", "xrd_s8"):
                        s8 = True
                run_reference_matching = (not skip_ref) and s8 and bool(selected_ref_phases)
            skip_ref = st.session_state.get("xrd_skip_ref", False)
            s8 = st.session_state.get("xrd_s8", False)
            run_reference_matching = (not skip_ref) and s8 and bool(selected_ref_phases)
        else:
            skip_ref = False

    with st.sidebar:
        with st.expander("Scherrer 晶粒尺寸", expanded=False):
            scherrer_enabled = st.checkbox("啟用 Scherrer 計算", value=False, key="xrd_scherrer_on")
            if scherrer_enabled:
                scherrer_K = float(st.number_input(
                    "K 值（形狀因子）",
                    min_value=0.5, max_value=2.0, value=0.9, step=0.01, format="%.2f",
                    key="xrd_scherrer_K",
                ))
                scherrer_inst_broadening = float(st.number_input(
                    "儀器展寬 β_inst (°)  ← 0 = 不校正",
                    min_value=0.0, max_value=2.0, value=0.0, step=0.001, format="%.4f",
                    key="xrd_scherrer_inst_b",
                ))
                scherrer_correction = st.radio(
                    "展寬校正方式",
                    ["none", "gaussian", "lorentzian"],
                    format_func=lambda v: {
                        "none": "不校正",
                        "gaussian": "Gaussian：√(β²−β_inst²)",
                        "lorentzian": "Lorentzian：β − β_inst",
                    }[v],
                    key="xrd_scherrer_correction",
                    horizontal=False,
                )
                st.caption(
                    "K = 0.9 適用球形晶粒，K = 1.0 適用立方體；"
                    "儀器展寬通常由 LaB₆ 或 Si 標準品 FWHM 量測得到。"
                    "若有應力/晶格畸變建議額外做 Williamson-Hall plot。"
                )

    r_range = st.slider(
        "顯示範圍 — 2θ (degree)",
        min_value=x_min_g, max_value=x_max_g,
        value=(ov_min, ov_max),
        step=step_size, format="%.2f°",
        key="xrd_disp",
    )
    r_start = float(min(r_range))
    r_end = float(max(r_range))
    st.caption(f"目前波長：{wavelength_name} = {wavelength_angstrom:.5f} Å")
    auto_peak_distance = float(max(step_size, min(0.20, max(step_size, (r_end - r_start) / 150))))

    fig1 = go.Figure()
    fig_gauss = go.Figure()
    fig2 = go.Figure()
    fig_log = go.Figure()
    export_frames: dict[str, pd.DataFrame] = {}
    auto_peak_tables: list[pd.DataFrame] = []
    gaussian_fit_tables: list[pd.DataFrame] = []
    x_axis_title = "d-spacing (Å)" if xrd_axis_mode == "d_spacing" else "2θ (degree)"
    reverse_x_axis = xrd_axis_mode == "d_spacing"
    compare_y_max = 0.0

    if do_average:
        new_x = np.linspace(r_start, r_end, interp_points)
        new_axis = xrd_axis_values(new_x, xrd_axis_mode, wavelength_angstrom)
        new_d = two_theta_to_d_spacing(new_x, wavelength_angstrom)
        all_interp = []
        for fname, (xv, yv) in data_dict.items():
            mask = (xv >= r_start) & (xv <= r_end)
            xc, yc = xv[mask], yv[mask]
            if len(xc) < 2:
                st.warning(f"{fname}：所選範圍內數據點不足，已跳過。")
                continue
            yi = interpolate_spectrum_to_grid(xc, yc, new_x, fill_value="extrapolate")
            all_interp.append(yi)
            if show_individual:
                fig1.add_trace(go.Scatter(
                    x=new_axis, y=yi, mode="lines", name=fname,
                    line=dict(width=1, dash="dot"), opacity=0.35,
                ))

        if all_interp:
            avg_raw = mean_spectrum_arrays(all_interp)
            gaussian_model = np.zeros_like(avg_raw)
            gaussian_subtracted = avg_raw.copy()
            if gaussian_enabled:
                gaussian_model, gaussian_subtracted, gaussian_fit_df = _fit_fixed_gaussian_templates(
                    new_x,
                    avg_raw,
                    gaussian_center_df,
                    gaussian_fixed_fwhm,
                    gaussian_fixed_area,
                    gaussian_search_half_width,
                )
                if not gaussian_fit_df.empty:
                    gaussian_fit_df.insert(0, "Dataset", "Average")
                    gaussian_fit_tables.append(gaussian_fit_df)
                fig_gauss.add_trace(go.Scatter(
                    x=new_axis, y=avg_raw, mode="lines", name="Average（原始）",
                    line=dict(color="#7EB6D9", width=1.3), opacity=0.60,
                ))
                fig_gauss.add_trace(go.Scatter(
                    x=new_axis, y=gaussian_model, mode="lines", name="Average（高斯模板）",
                    line=dict(color="#F05441", width=1.8, dash="dot"),
                ))
                fig_gauss.add_trace(go.Scatter(
                    x=new_axis, y=gaussian_subtracted, mode="lines", name="Average（扣高斯後）",
                    line=dict(color="#2ABF83", width=2.3),
                ))

            smooth_input = gaussian_subtracted if gaussian_enabled else avg_raw
            y_smooth = smooth_signal(smooth_input, smooth_method, smooth_window, smooth_poly_deg)
            y_final = apply_normalization(
                new_x, y_smooth, norm_method,
                norm_x_start=norm_x_start, norm_x_end=norm_x_end,
            )
            linear_display_signal = y_final if norm_method != "none" else (
                y_smooth if smooth_method != "none" else smooth_input
            )
            compare_y_max = max(compare_y_max, float(np.nanmax(linear_display_signal)))

            if log_enabled:
                log_signal, _ = _safe_log_transform(linear_display_signal, log_method, log_floor_value)
                fig_log.add_trace(go.Scatter(
                    x=new_axis, y=log_signal, mode="lines",
                    name=f"Average（{'log10' if log_method == 'log10' else 'ln'}）",
                    line=dict(color="#90CAF9", width=2.4),
                ))
            else:
                log_signal = np.array([])

            if smooth_method != "none":
                fig1.add_trace(go.Scatter(
                    x=new_axis, y=smooth_input, mode="lines", name="Average（原始）",
                    line=dict(color="white", width=1.5, dash="dash"), opacity=0.55,
                ))
                fig1.add_trace(go.Scatter(
                    x=new_axis, y=y_smooth, mode="lines", name="Average（平滑後）",
                    line=dict(color="#EF553B", width=2.5),
                ))
            else:
                fig1.add_trace(go.Scatter(
                    x=new_axis, y=smooth_input, mode="lines", name="Average",
                    line=dict(color="#EF553B", width=2.5),
                ))

            if norm_method != "none":
                fig2.add_trace(go.Scatter(
                    x=new_axis, y=y_final, mode="lines", name="Average（歸一化後）",
                    line=dict(color="#EF553B", width=2.5),
                ))

            export_row: dict[str, np.ndarray] = {
                "TwoTheta_deg": new_x,
                "d_spacing_A": new_d,
                "Average_raw": avg_raw,
                "Average_gaussian_model": gaussian_model,
                "Average_gaussian_subtracted": gaussian_subtracted,
                "Average_smoothed": y_smooth,
            }
            if norm_method != "none":
                export_row["Average_normalized"] = y_final
            if log_enabled:
                export_row[f"Average_{log_method}"] = log_signal
            export_frames["Average"] = pd.DataFrame(export_row)

            if run_reference_matching:
                peak_signal = y_final if norm_method != "none" else (y_smooth if smooth_method != "none" else smooth_input)
                peak_idx = detect_xrd_peaks(
                    new_x, peak_signal, 0.05, 0.05, auto_peak_distance, 30
                )
                if len(peak_idx):
                    auto_peak_tables.append(build_xrd_peak_table(
                        "Average", new_x, peak_signal, peak_idx, wavelength_angstrom
                    ))
    else:
        for i, (fname, (xv, yv)) in enumerate(data_dict.items()):
            mask = (xv >= r_start) & (xv <= r_end)
            xc, yc = xv[mask], yv[mask]
            if len(xc) < 2:
                st.warning(f"{fname}：所選範圍內數據點不足，已跳過。")
                continue

            if effective_interpolation:
                x_proc = np.linspace(float(xc.min()), float(xc.max()), interp_points)
                y_raw = interpolate_spectrum_to_grid(xc, yc, x_proc, fill_value="extrapolate")
            else:
                x_proc = xc
                y_raw = yc

            color = XRD_COLORS[i % len(XRD_COLORS)]
            x_axis = xrd_axis_values(x_proc, xrd_axis_mode, wavelength_angstrom)
            x_d = two_theta_to_d_spacing(x_proc, wavelength_angstrom)

            gaussian_model = np.zeros_like(y_raw)
            gaussian_subtracted = y_raw.copy()
            if gaussian_enabled:
                gaussian_model, gaussian_subtracted, gaussian_fit_df = _fit_fixed_gaussian_templates(
                    x_proc,
                    y_raw,
                    gaussian_center_df,
                    gaussian_fixed_fwhm,
                    gaussian_fixed_area,
                    gaussian_search_half_width,
                )
                if not gaussian_fit_df.empty:
                    gaussian_fit_df.insert(0, "Dataset", fname)
                    gaussian_fit_tables.append(gaussian_fit_df)
                _xrd_raw_c   = ["#7EB6D9","#9BC9E0","#A8D5E2","#B0C4DE"]
                _xrd_model_c = ["#F05441","#FF8C42","#E6501A","#FF6B35"]
                _xrd_after_c = ["#2ABF83","#4DAF4A","#00BFA5","#43C59E"]
                fig_gauss.add_trace(go.Scatter(
                    x=x_axis, y=y_raw, mode="lines", name=f"{fname}（原始）",
                    line=dict(color=_xrd_raw_c[i % len(_xrd_raw_c)], width=1.3), opacity=0.60,
                ))
                fig_gauss.add_trace(go.Scatter(
                    x=x_axis, y=gaussian_model, mode="lines", name=f"{fname}（高斯模板）",
                    line=dict(color=_xrd_model_c[i % len(_xrd_model_c)], width=1.8, dash="dot"),
                ))
                fig_gauss.add_trace(go.Scatter(
                    x=x_axis, y=gaussian_subtracted, mode="lines", name=f"{fname}（扣高斯後）",
                    line=dict(color=_xrd_after_c[i % len(_xrd_after_c)], width=2.2),
                ))

            smooth_input = gaussian_subtracted if gaussian_enabled else y_raw
            y_smooth = smooth_signal(smooth_input, smooth_method, smooth_window, smooth_poly_deg)
            y_final = apply_normalization(
                x_proc, y_smooth, norm_method,
                norm_x_start=norm_x_start, norm_x_end=norm_x_end,
            )
            linear_display_signal = y_final if norm_method != "none" else (
                y_smooth if smooth_method != "none" else smooth_input
            )
            compare_y_max = max(compare_y_max, float(np.nanmax(linear_display_signal)))

            if log_enabled:
                log_signal, _ = _safe_log_transform(linear_display_signal, log_method, log_floor_value)
                fig_log.add_trace(go.Scatter(
                    x=x_axis, y=log_signal, mode="lines",
                    name=f"{fname}（{'log10' if log_method == 'log10' else 'ln'}）",
                    line=dict(color=color, width=2.0),
                ))
            else:
                log_signal = np.array([])

            if smooth_method != "none":
                fig1.add_trace(go.Scatter(
                    x=x_axis, y=smooth_input, mode="lines", name=f"{fname}（原始）",
                    line=dict(color=color, width=1.4, dash="dash"), opacity=0.45,
                ))
                fig1.add_trace(go.Scatter(
                    x=x_axis, y=y_smooth, mode="lines", name=f"{fname}（平滑後）",
                    line=dict(color=color, width=2.2),
                ))
            else:
                fig1.add_trace(go.Scatter(
                    x=x_axis, y=smooth_input, mode="lines", name=fname,
                    line=dict(color=color, width=2),
                ))

            if norm_method != "none":
                fig2.add_trace(go.Scatter(
                    x=x_axis, y=y_final, mode="lines", name=f"{fname}（歸一化後）",
                    line=dict(color=color, width=2),
                ))

            export_row = {
                "TwoTheta_deg": x_proc,
                "d_spacing_A": x_d,
                "Intensity_raw": y_raw,
                "Intensity_gaussian_model": gaussian_model,
                "Intensity_gaussian_subtracted": gaussian_subtracted,
                "Intensity_smoothed": y_smooth,
            }
            if norm_method != "none":
                export_row["Intensity_normalized"] = y_final
            if log_enabled:
                export_row[f"Intensity_{log_method}"] = log_signal
            export_frames[fname] = pd.DataFrame(export_row)

            if run_reference_matching:
                peak_signal = y_final if norm_method != "none" else (y_smooth if smooth_method != "none" else smooth_input)
                peak_idx = detect_xrd_peaks(
                    x_proc, peak_signal, 0.05, 0.05, auto_peak_distance, 30
                )
                if len(peak_idx):
                    auto_peak_tables.append(build_xrd_peak_table(
                        fname, x_proc, peak_signal, peak_idx, wavelength_angstrom
                    ))

    reference_df = pd.DataFrame()
    if run_reference_matching:
        reference_df = build_xrd_reference_df(
            selected_ref_phases, wavelength_angstrom, ref_min_rel_intensity, r_start, r_end
        )
        if ref_overlay and not reference_df.empty:
            target_fig = fig2 if norm_method != "none" else fig1
            ref_scale = compare_y_max * 0.22 if compare_y_max > 0 else 1.0
            for i, phase_name in enumerate(selected_ref_phases):
                phase_df = reference_df[reference_df["Phase"] == phase_name]
                if phase_df.empty:
                    continue
                phase_color = REF_COLORS[i % len(REF_COLORS)]
                x_vals = (
                    phase_df["d_spacing_A"].to_numpy(dtype=float)
                    if xrd_axis_mode == "d_spacing"
                    else phase_df["two_theta_deg"].to_numpy(dtype=float)
                )
                xs, ys, hover_texts = [], [], []
                for x_val, (_, row) in zip(x_vals, phase_df.iterrows()):
                    height = ref_scale * float(row["Relative_Intensity_pct"]) / 100.0
                    xs.extend([x_val, x_val, None])
                    ys.extend([0.0, height, None])
                    hover = (
                        f"Phase: {row['Phase']}<br>"
                        f"hkl: {row['hkl']}<br>"
                        f"2θ: {float(row['two_theta_deg']):.3f}°<br>"
                        f"d: {float(row['d_spacing_A']):.4f} Å<br>"
                        f"Rel. I: {float(row['Relative_Intensity_pct']):.1f}%"
                    )
                    hover_texts.extend([hover, hover, None])
                target_fig.add_trace(go.Scatter(
                    x=xs,
                    y=ys,
                    mode="lines",
                    name=f"{phase_name} 參考峰",
                    line=dict(color=phase_color, width=1.6, dash="dot"),
                    text=hover_texts,
                    hovertemplate="%{text}<extra></extra>",
                ))

    fig1.update_layout(
        xaxis_title=x_axis_title, yaxis_title="Intensity",
        xaxis=dict(autorange="reversed" if reverse_x_axis else True),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        template="plotly_dark", height=500, margin=dict(l=50, r=20, t=60, b=50),
    )
    st.plotly_chart(fig1, use_container_width=True)

    gaussian_fit_export_df = pd.concat(gaussian_fit_tables, ignore_index=True) if gaussian_fit_tables else pd.DataFrame()
    if gaussian_enabled:
        scroll_anchor("xrd-gauss-plot")
        st.caption("高斯模板扣除結果")
        fig_gauss.update_layout(
            xaxis_title=x_axis_title, yaxis_title="Intensity",
            xaxis=dict(autorange="reversed" if reverse_x_axis else True),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            template="plotly_dark", height=440, margin=dict(l=50, r=20, t=40, b=50),
        )
        st.plotly_chart(fig_gauss, use_container_width=True)
        auto_scroll_on_appear(
            "xrd-gauss-plot",
            visible=True,
            state_key="xrd_scroll_gauss_plot",
            block="start",
        )
        if not gaussian_fit_export_df.empty:
            fit_display = gaussian_fit_export_df.copy().round({
                "Seed_Center_2theta_deg": 4,
                "Fitted_Center_2theta_deg": 4,
                "Shift_deg": 4,
                "Fixed_FWHM_deg": 4,
                "Fixed_Area": 6,
                "Template_Height": 6,
            })
            st.dataframe(fit_display, use_container_width=True, hide_index=True)
    else:
        auto_scroll_on_appear(
            "xrd-gauss-plot",
            visible=False,
            state_key="xrd_scroll_gauss_plot",
        )

    if norm_method != "none":
        scroll_anchor("xrd-norm-plot")
        st.caption("歸一化結果")
        if norm_method == "max":
            norm_axis = xrd_axis_values(
                np.array([norm_x_start, norm_x_end]), xrd_axis_mode, wavelength_angstrom
            )
            norm_axis = norm_axis[np.isfinite(norm_axis)]
            if len(norm_axis) == 2:
                fig2.add_vrect(
                    x0=float(np.min(norm_axis)),
                    x1=float(np.max(norm_axis)),
                    fillcolor="blue", opacity=0.06,
                    layer="below", line_width=0,
                    annotation_text="歸一化區間", annotation_position="top right",
                )
        fig2.update_layout(
            xaxis_title=x_axis_title, yaxis_title="Normalized Intensity",
            xaxis=dict(autorange="reversed" if reverse_x_axis else True),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            template="plotly_dark", height=420, margin=dict(l=50, r=20, t=40, b=50),
        )
        st.plotly_chart(fig2, use_container_width=True)
        auto_scroll_on_appear(
            "xrd-norm-plot",
            visible=True,
            state_key="xrd_scroll_norm_plot",
            block="start",
        )
    else:
        auto_scroll_on_appear(
            "xrd-norm-plot",
            visible=False,
            state_key="xrd_scroll_norm_plot",
        )

    if log_enabled:
        scroll_anchor("xrd-log-plot")
        st.caption("log 弱峰檢視")
        fig_log.update_layout(
            xaxis_title=x_axis_title,
            yaxis_title="log Intensity",
            xaxis=dict(autorange="reversed" if reverse_x_axis else True),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            template="plotly_dark", height=420, margin=dict(l=50, r=20, t=35, b=50),
        )
        st.plotly_chart(fig_log, use_container_width=True)
        auto_scroll_on_appear(
            "xrd-log-plot",
            visible=True,
            state_key="xrd_scroll_log_plot",
            block="start",
        )
    else:
        auto_scroll_on_appear(
            "xrd-log-plot",
            visible=False,
            state_key="xrd_scroll_log_plot",
        )

    peak_export_df = pd.concat(auto_peak_tables, ignore_index=True) if auto_peak_tables else pd.DataFrame()

    # ── Scherrer 晶粒尺寸 ─────────────────────────────────────────────────────
    scherrer_df = pd.DataFrame()
    if scherrer_enabled:
        if peak_export_df.empty:
            st.info("Scherrer 計算需要自動尋峰結果，請先啟用「參考峰比對」或調整顯示範圍使峰位可被偵測。")
        else:
            scherrer_df = build_scherrer_table(
                peak_export_df,
                wavelength_angstrom,
                K=scherrer_K,
                instrument_broadening_deg=scherrer_inst_broadening,
                broadening_correction=scherrer_correction,
            )
            st.subheader("Scherrer 晶粒尺寸")
            corr_label = {
                "none": "無儀器展寬校正",
                "gaussian": f"Gaussian 校正（β_inst = {scherrer_inst_broadening:.4f}°）",
                "lorentzian": f"Lorentzian 校正（β_inst = {scherrer_inst_broadening:.4f}°）",
            }.get(scherrer_correction, "")
            st.caption(
                f"K = {scherrer_K}，λ = {wavelength_angstrom:.5f} Å（{wavelength_name}），{corr_label}。"
                "D = Kλ / (β cosθ)，β = FWHM（rad），θ = Bragg angle。"
            )
            if not scherrer_df.empty:
                display_cols = [c for c in [
                    "Dataset", "Peak", "2theta_deg", "d_spacing_A",
                    "FWHM_deg", "D_Scherrer_nm", "D_Scherrer_A",
                    "Relative_Intensity_pct",
                ] if c in scherrer_df.columns]
                st.dataframe(
                    scherrer_df[display_cols].round({
                        "2theta_deg": 4, "d_spacing_A": 5,
                        "FWHM_deg": 4, "D_Scherrer_nm": 2,
                        "D_Scherrer_A": 1, "Relative_Intensity_pct": 1,
                    }),
                    use_container_width=True,
                    hide_index=True,
                )
                # 各資料集摘要
                if "Dataset" in scherrer_df.columns and "D_Scherrer_nm" in scherrer_df.columns:
                    valid = scherrer_df.dropna(subset=["D_Scherrer_nm"])
                    if not valid.empty:
                        summary = (
                            valid.groupby("Dataset")["D_Scherrer_nm"]
                            .agg(["mean", "std", "min", "max", "count"])
                            .rename(columns={
                                "mean": "D 平均 (nm)", "std": "D std (nm)",
                                "min": "D 最小 (nm)", "max": "D 最大 (nm)",
                                "count": "峰數",
                            })
                            .reset_index()
                        )
                        st.caption("各資料集晶粒尺寸統計摘要（nm）")
                        st.dataframe(
                            summary.round({
                                "D 平均 (nm)": 2, "D std (nm)": 2,
                                "D 最小 (nm)": 2, "D 最大 (nm)": 2,
                            }),
                            use_container_width=True, hide_index=True,
                        )
                        # 顯示 metric 卡片（前 4 個資料集）
                        datasets_with_d = summary["Dataset"].tolist()[:4]
                        if datasets_with_d:
                            metric_cols = st.columns(len(datasets_with_d))
                            for mc, ds in zip(metric_cols, datasets_with_d):
                                row = summary[summary["Dataset"] == ds].iloc[0]
                                d_mean = row["D 平均 (nm)"]
                                d_std = row.get("D std (nm)", np.nan)
                                delta_str = f"± {d_std:.1f} nm" if np.isfinite(d_std) and d_std > 0 else None
                                mc.metric(
                                    label=ds[:20],
                                    value=f"{d_mean:.1f} nm",
                                    delta=delta_str,
                                )

    reference_match_df = pd.DataFrame()
    if run_reference_matching:
        st.subheader("參考峰")
        source_label = (
            "歸一化後" if norm_method != "none" else (
                "平滑後" if smooth_method != "none" else (
                    "扣高斯後" if gaussian_enabled else "原始"
                )
            )
        )
        st.caption(f"參考峰匹配會以目前{source_label}曲線自動尋找局部峰位，不需另外手動做峰值偵測。")
        if reference_df.empty:
            st.info("所選參考相位在目前顯示範圍內沒有符合強度門檻的峰。")
        else:
            ref_display = reference_df.copy().round({
                "two_theta_deg": 4,
                "d_spacing_A": 5,
                "Relative_Intensity_pct": 1,
            })
            st.dataframe(ref_display, use_container_width=True, hide_index=True)

            if peak_export_df.empty:
                st.info("目前條件下沒有找到足夠穩定的局部峰位，因此暫時無法做參考匹配；可嘗試縮小顯示範圍、調整平滑或先做歸一化。")
            else:
                reference_match_df = match_xrd_reference_peaks(
                    reference_df, peak_export_df, ref_match_tolerance
                )
                match_display = reference_match_df
                if ref_only_matched:
                    match_display = match_display[match_display["Matched"]]
                st.subheader("參考峰匹配")
                if match_display.empty:
                    st.info("目前容差下沒有匹配到參考峰。")
                else:
                    match_display = match_display.copy().round({
                        "Ref_2theta_deg": 4,
                        "Ref_d_spacing_A": 5,
                        "Ref_Relative_Intensity_pct": 1,
                        "Observed_2theta_deg": 4,
                        "Observed_d_spacing_A": 5,
                        "Observed_Intensity": 4,
                        "Delta_2theta_deg": 4,
                    })
                    st.dataframe(match_display, use_container_width=True, hide_index=True)

    if export_frames:
        st.subheader("處理前後比較")
        st.caption("可直接對照原始、扣高斯後、平滑後、歸一化後與 log 曲線，快速檢查每一步對 XRD 判讀的影響。")
        compare_keys = list(export_frames.keys())
        compare_target = st.selectbox(
            "比較資料集",
            compare_keys,
            key="xrd_compare_target",
        )
        compare_df = export_frames[compare_target]
        compare_x_col = "d_spacing_A" if xrd_axis_mode == "d_spacing" else "TwoTheta_deg"
        compare_columns = [
            col for col in compare_df.columns
            if col not in {"TwoTheta_deg", "d_spacing_A"}
        ]
        compare_defaults = st.session_state.get(
            "xrd_compare_columns",
            _default_compare_columns(compare_columns),
        )
        compare_selected = st.multiselect(
            "要比較的處理階段",
            compare_columns,
            default=[c for c in compare_defaults if c in compare_columns],
            format_func=_process_column_display_name,
            key="xrd_compare_columns",
        )
        if compare_selected:
            compare_fig = go.Figure()
            for idx, col in enumerate(compare_selected):
                compare_fig.add_trace(go.Scatter(
                    x=compare_df[compare_x_col],
                    y=compare_df[col],
                    mode="lines",
                    name=_process_column_display_name(col),
                    line=dict(width=2.2, color=XRD_COLORS[idx % len(XRD_COLORS)]),
                ))
            compare_fig.update_layout(
                xaxis_title=x_axis_title,
                yaxis_title="Intensity",
                xaxis=dict(autorange="reversed" if reverse_x_axis else True),
                template="plotly_dark",
                height=420,
                margin=dict(l=50, r=20, t=35, b=50),
                legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            )
            st.plotly_chart(compare_fig, use_container_width=True)
        else:
            st.info("請至少選擇一個處理階段來比較。")

    if export_frames or not gaussian_fit_export_df.empty or not peak_export_df.empty or not reference_df.empty or not reference_match_df.empty:
        processing_report = {
            "report_type": "xrd_processing_report",
            "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "module": "xrd",
            "input_files": [uf.name for uf in uploaded_files],
            "dataset_count": len(data_dict),
            "processed_datasets": list(export_frames.keys()),
            "display_range_two_theta_deg": [float(r_start), float(r_end)],
            "x_axis_mode": xrd_axis_mode,
            "wavelength": {
                "name": wavelength_name,
                "angstrom": float(wavelength_angstrom),
            },
            "processing": {
                "interpolation_and_average": {
                    "skip": bool(skip_avg),
                    "interpolation_enabled": bool(apply_interpolation),
                    "effective_interpolation_enabled": bool(effective_interpolation),
                    "average_enabled": bool(do_average),
                    "interp_points": int(interp_points) if effective_interpolation else None,
                    "show_individual": bool(show_individual),
                },
                "gaussian_subtraction": {
                    "skip": bool(skip_gauss),
                    "enabled": bool(gaussian_enabled),
                    "fixed_fwhm_deg": float(gaussian_fixed_fwhm),
                    "fixed_area": float(gaussian_fixed_area),
                    "search_half_width_deg": float(gaussian_search_half_width),
                    "centers": _dataframe_records(gaussian_center_df),
                    "fit_summary": _dataframe_records(gaussian_fit_export_df),
                },
                "smoothing": {
                    "skip": bool(skip_smooth),
                    "method": smooth_method,
                    "window": int(smooth_window),
                    "poly_degree": int(smooth_poly_deg),
                },
                "normalization": {
                    "skip": bool(skip_norm),
                    "method": norm_method,
                    "range_two_theta_deg": [float(norm_x_start), float(norm_x_end)],
                },
                "log_view": {
                    "skip": bool(skip_log),
                    "enabled": bool(log_enabled),
                    "method": log_method,
                    "floor_value": float(log_floor_value),
                },
                "reference_matching": {
                    "skip": bool(skip_ref),
                    "enabled": bool(run_reference_matching),
                    "selected_phases": list(selected_ref_phases),
                    "min_relative_intensity_pct": float(ref_min_rel_intensity),
                    "tolerance_deg": float(ref_match_tolerance),
                    "overlay_enabled": bool(ref_overlay),
                    "only_show_matched": bool(ref_only_matched),
                },
            },
            "gaussian_fit_peaks": _dataframe_records(gaussian_fit_export_df),
            "auto_detected_peaks": _dataframe_records(peak_export_df),
            "reference_peaks": _dataframe_records(reference_df),
            "reference_matches": _dataframe_records(reference_match_df),
            "scherrer": {
                "enabled": bool(scherrer_enabled),
                "K": float(scherrer_K),
                "instrument_broadening_deg": float(scherrer_inst_broadening),
                "correction": scherrer_correction,
                "results": _dataframe_records(scherrer_df),
            } if scherrer_enabled else {"enabled": False},
        }

        st.subheader("匯出")
        st.caption("下載區已整理成三類：研究常用、原始處理輸出、追溯 / 設定。通常先拿研究常用，再視需要保存底層資料與流程紀錄。")

        st.markdown("**研究常用**")
        st.caption("最常拿來做圖、整理結果與和其他樣品比較的檔案。")
        if not scherrer_df.empty:
            _render_download_card(
                title="Scherrer 晶粒尺寸 CSV",
                description=f"各峰的晶粒尺寸 D（nm 與 Å），K = {scherrer_K}，λ = {wavelength_angstrom:.5f} Å，含 FWHM 與 d-spacing。",
                input_label="檔名",
                default_name="xrd_scherrer_size",
                extension="csv",
                button_label="下載 Scherrer CSV",
                data=scherrer_df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key="xrd_scherrer_fname",
                button_key="xrd_scherrer_dl",
            )
        if not gaussian_fit_export_df.empty:
            _render_download_card(
                title="高斯中心結果 CSV",
                description="整理每個固定面積 / 固定 FWHM 高斯模板最後找到的中心位置與位移量，適合拿來記錄 peak 實際位置。",
                input_label="檔名",
                default_name="xrd_gaussian_peak_positions",
                extension="csv",
                button_label="下載高斯中心結果 CSV",
                data=gaussian_fit_export_df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key="xrd_gauss_fit_fname",
                button_key="xrd_gauss_fit_dl",
            )
        export_items = list(export_frames.items())
        if export_items:
            for start in range(0, len(export_items), 2):
                row_items = export_items[start:start + 2]
                row_cols = st.columns(len(row_items))
                for col, (fname, df) in zip(row_cols, row_items):
                    base = fname.rsplit(".", 1)[0]
                    with col:
                        _render_download_card(
                            title=f"處理後光譜：{fname}",
                            description="包含目前流程下的原始、平滑與歸一化欄位，適合重畫 XRD 曲線、做樣品比較或後續分析。",
                            input_label="檔名",
                            default_name=f"{base}_processed",
                            extension="csv",
                            button_label="下載處理後光譜 CSV",
                            data=df.to_csv(index=False).encode("utf-8"),
                            mime="text/csv",
                            input_key=f"xrd_fname_{fname}",
                            button_key=f"xrd_dl_{fname}",
                        )
        if not reference_match_df.empty:
            _render_download_card(
                title="參考匹配 CSV",
                description="整理每個資料集和參考相位的匹配結果，包含參考峰位置、觀測峰位置與 2θ 偏移量，適合做相辨識整理。",
                input_label="檔名",
                default_name="xrd_reference_matches",
                extension="csv",
                button_label="下載參考匹配 CSV",
                data=reference_match_df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key="xrd_ref_match_fname",
                button_key="xrd_ref_match_dl",
            )

        st.markdown("**原始處理輸出**")
        st.caption("偏向底層數值與相位對照資料，適合二次分析、重新檢查自動尋峰或留研究紀錄。")
        raw_cols = st.columns(2)
        if not peak_export_df.empty:
            with raw_cols[0]:
                _render_download_card(
                    title="自動尋峰 CSV",
                    description="保存參考峰比對前的局部尋峰結果，包含 2θ、d-spacing、相對強度與 FWHM，方便回頭檢查匹配來源。",
                    input_label="檔名",
                    default_name="xrd_auto_detected_peaks",
                    extension="csv",
                    button_label="下載自動尋峰 CSV",
                    data=peak_export_df.to_csv(index=False).encode("utf-8"),
                    mime="text/csv",
                    input_key="xrd_peak_fname",
                    button_key="xrd_peak_dl",
                )
        if not reference_df.empty:
            with raw_cols[1 if not peak_export_df.empty else 0]:
                _render_download_card(
                    title="參考峰 CSV",
                    description="匯出目前選取相位在當前波長與顯示範圍下的參考峰列表，方便後續對照與留存。",
                    input_label="檔名",
                    default_name="xrd_references",
                    extension="csv",
                    button_label="下載參考峰 CSV",
                    data=reference_df.to_csv(index=False).encode("utf-8"),
                    mime="text/csv",
                    input_key="xrd_ref_fname",
                    button_key="xrd_ref_dl",
                )
        if peak_export_df.empty and reference_df.empty:
            st.caption("啟用參考峰比對後，這裡會提供自動尋峰與參考峰底層資料。")

        st.markdown("**追溯 / 設定**")
        st.caption("保存本次 XRD 流程設定與輸出摘要，方便日後重現分析、交叉比對與研究存檔。")
        report_cols = st.columns(2)
        with report_cols[0]:
            _render_download_card(
                title="處理報告 JSON",
                description="完整保存本次 XRD 的步驟設定、波長、顯示區間、參考相位與自動尋峰/匹配結果，適合研究追溯與重現。",
                input_label="檔名",
                default_name="xrd_processing_report",
                extension="json",
                button_label="下載處理報告 JSON",
                data=json.dumps(_json_safe(processing_report), ensure_ascii=False, indent=2).encode("utf-8"),
                mime="application/json",
                input_key="xrd_report_fname",
                button_key="xrd_report_dl",
            )
        with report_cols[1]:
            with st.container(border=True):
                st.markdown("**XRD 流程說明**")
                st.caption("這份報告會記錄內插化/平均化、高斯模板扣除、平滑、歸一化、log 檢視、波長設定、參考峰比對條件與目前輸出摘要。")
