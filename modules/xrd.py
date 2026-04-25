"""XRD-specific numerical helpers, reference-table utilities, and Streamlit UI."""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from scipy.signal import peak_widths

from core.parsers import parse_two_column_spectrum_bytes
from core.spectrum_ops import detect_spectrum_peaks, interpolate_spectrum_to_grid, mean_spectrum_arrays
from core.ui_helpers import _next_btn, auto_scroll_on_appear, scroll_anchor, step_exp_label, step_header, step_header_with_skip
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

    do_average = False
    show_individual = False
    interp_points = 2001

    with st.sidebar:
        s2 = st.session_state.get("xrd_s2", False)
        _skip2 = st.session_state.get("xrd_skip_avg", False)
        with st.expander(step_exp_label(2, "多檔平均", s2 or _skip2), expanded=not (s2 or _skip2)):
            skip_avg = st.checkbox("跳過此步驟 ✓", key="xrd_skip_avg")
            if not skip_avg:
                do_average = st.checkbox("對所有載入的檔案做平均", value=False, key="xrd_do_avg")
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
        step2_done = skip_avg or s2

    smooth_method = "none"
    smooth_window = 11
    smooth_poly_deg = 3

    with st.sidebar:
        s3 = st.session_state.get("xrd_s3", False)
        if step2_done:
            _skip3 = st.session_state.get("xrd_skip_smooth", False)
            with st.expander(step_exp_label(3, "平滑", s3 or _skip3), expanded=not (s3 or _skip3)):
                skip_smooth = st.checkbox("跳過此步驟 ✓", key="xrd_skip_smooth")
                if not skip_smooth:
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
                    st.session_state["xrd_s3"] = True
                s3 = st.session_state.get("xrd_s3", False)
                if not skip_smooth and not s3:
                    if _next_btn("xrd_btn3", "xrd_s3"):
                        s3 = True
            skip_smooth = st.session_state.get("xrd_skip_smooth", False)
            s3 = st.session_state.get("xrd_s3", False)
        else:
            skip_smooth = False
        step3_done = step2_done and (skip_smooth or s3)

    norm_method = "none"
    norm_x_start, norm_x_end = e0, e1

    with st.sidebar:
        s4 = st.session_state.get("xrd_s4", False)
        if step3_done:
            _skip4 = st.session_state.get("xrd_skip_norm", False)
            with st.expander(step_exp_label(4, "歸一化", s4 or _skip4), expanded=not (s4 or _skip4)):
                skip_norm = st.checkbox("跳過此步驟 ✓", key="xrd_skip_norm")
                if not skip_norm:
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
                    st.session_state["xrd_s4"] = True
                s4 = st.session_state.get("xrd_s4", False)
                if not skip_norm and not s4:
                    if _next_btn("xrd_btn4", "xrd_s4"):
                        s4 = True
            skip_norm = st.session_state.get("xrd_skip_norm", False)
            s4 = st.session_state.get("xrd_s4", False)
        else:
            skip_norm = False
        step4_done = step3_done and (skip_norm or s4)

    peak_prom_ratio = 0.05
    peak_height_ratio = 0.05
    peak_distance_deg = peak_distance_default
    max_peak_labels = 12
    label_peaks = True
    run_peak_detection = False

    with st.sidebar:
        s5 = st.session_state.get("xrd_s5", False)
        if step4_done:
            _skip5 = st.session_state.get("xrd_skip_peaks", False)
            with st.expander(step_exp_label(5, "峰值偵測", s5 or _skip5), expanded=not (s5 or _skip5)):
                skip_peaks = st.checkbox("跳過此步驟 ✓", key="xrd_skip_peaks")
                if not skip_peaks:
                    peak_prom_ratio = float(st.slider(
                        "最小顯著度（相對）", 0.0, 1.0, 0.05, 0.01, key="xrd_peak_prominence"
                    ))
                    peak_height_ratio = float(st.slider(
                        "最小高度（相對最大值）", 0.0, 1.0, 0.05, 0.01, key="xrd_peak_height"
                    ))
                    peak_distance_deg = float(st.number_input(
                        "最小峰距 (2θ)",
                        min_value=step_size,
                        max_value=max(step_size, x_max_g - x_min_g),
                        value=peak_distance_default,
                        step=max(step_size, 0.05),
                        format="%.2f",
                        key="xrd_peak_distance",
                    ))
                    max_peak_labels = int(st.number_input(
                        "最多標記峰數", min_value=1, max_value=50, value=12, step=1, key="xrd_peak_max"
                    ))
                    label_peaks = st.checkbox("標示峰位數值", value=True, key="xrd_peak_labels")
                if skip_peaks:
                    st.session_state["xrd_s5"] = True
                s5 = st.session_state.get("xrd_s5", False)
                if not skip_peaks and not s5:
                    if _next_btn("xrd_btn5", "xrd_s5"):
                        s5 = True
                run_peak_detection = (not skip_peaks) and s5
            skip_peaks = st.session_state.get("xrd_skip_peaks", False)
            s5 = st.session_state.get("xrd_s5", False)
            run_peak_detection = (not skip_peaks) and s5

    wavelength_name = "Cu Kα"
    wavelength_angstrom = XRD_WAVELENGTHS[wavelength_name]
    xrd_axis_mode = "two_theta"

    with st.sidebar:
        step_header(6, "X 軸與 d-spacing")
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
        s7 = st.session_state.get("xrd_s7", False)
        if step4_done:
            _skip7 = st.session_state.get("xrd_skip_ref", False)
            with st.expander(step_exp_label(7, "參考峰比對", s7 or _skip7), expanded=not (s7 or _skip7)):
                skip_ref = st.checkbox("跳過此步驟 ✓", key="xrd_skip_ref")
                if not skip_ref:
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
                    st.session_state["xrd_s7"] = True
                s7 = st.session_state.get("xrd_s7", False)
                if not skip_ref and not s7:
                    if _next_btn("xrd_btn7", "xrd_s7"):
                        s7 = True
                run_reference_matching = (not skip_ref) and s7 and bool(selected_ref_phases)
            skip_ref = st.session_state.get("xrd_skip_ref", False)
            s7 = st.session_state.get("xrd_s7", False)
            run_reference_matching = (not skip_ref) and s7 and bool(selected_ref_phases)
        else:
            skip_ref = False

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

    fig1 = go.Figure()
    fig2 = go.Figure()
    export_frames: dict[str, pd.DataFrame] = {}
    peak_tables: list[pd.DataFrame] = []
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
            y_smooth = smooth_signal(avg_raw, smooth_method, smooth_window, smooth_poly_deg)
            y_final = apply_normalization(
                new_x, y_smooth, norm_method,
                norm_x_start=norm_x_start, norm_x_end=norm_x_end,
            )
            compare_signal = y_final if norm_method != "none" else (
                y_smooth if smooth_method != "none" else avg_raw
            )
            compare_y_max = max(compare_y_max, float(np.nanmax(compare_signal)))

            if smooth_method != "none":
                fig1.add_trace(go.Scatter(
                    x=new_axis, y=avg_raw, mode="lines", name="Average（原始）",
                    line=dict(color="white", width=1.5, dash="dash"), opacity=0.55,
                ))
                fig1.add_trace(go.Scatter(
                    x=new_axis, y=y_smooth, mode="lines", name="Average（平滑後）",
                    line=dict(color="#EF553B", width=2.5),
                ))
            else:
                fig1.add_trace(go.Scatter(
                    x=new_axis, y=avg_raw, mode="lines", name="Average",
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
                "Average_smoothed": y_smooth,
            }
            if norm_method != "none":
                export_row["Average_normalized"] = y_final
            export_frames["Average"] = pd.DataFrame(export_row)

            if run_peak_detection:
                peak_signal = y_final if norm_method != "none" else y_smooth
                peak_idx = detect_xrd_peaks(
                    new_x, peak_signal, peak_prom_ratio,
                    peak_height_ratio, peak_distance_deg, max_peak_labels,
                )
                if len(peak_idx):
                    peak_table = build_xrd_peak_table(
                        "Average", new_x, peak_signal, peak_idx, wavelength_angstrom
                    )
                    peak_tables.append(peak_table)
                    peak_fig = fig2 if norm_method != "none" else fig1
                    peak_x_vals = (
                        peak_table["d_spacing_A"] if xrd_axis_mode == "d_spacing"
                        else peak_table["2theta_deg"]
                    )
                    peak_labels = (
                        [f"{v:.3f} Å" for v in peak_table["d_spacing_A"]]
                        if xrd_axis_mode == "d_spacing"
                        else [f"{v:.2f}°" for v in peak_table["2theta_deg"]]
                    )
                    peak_fig.add_trace(go.Scatter(
                        x=peak_x_vals,
                        y=peak_table["Intensity"],
                        mode="markers+text" if label_peaks else "markers",
                        name="Average 峰位",
                        text=peak_labels if label_peaks else None,
                        textposition="top center",
                        textfont=dict(size=10),
                        marker=dict(color="#FFD166", size=10, symbol="x"),
                    ))
    else:
        for i, (fname, (xv, yv)) in enumerate(data_dict.items()):
            mask = (xv >= r_start) & (xv <= r_end)
            xc, yc = xv[mask], yv[mask]
            if len(xc) < 2:
                st.warning(f"{fname}：所選範圍內數據點不足，已跳過。")
                continue

            color = XRD_COLORS[i % len(XRD_COLORS)]
            x_axis = xrd_axis_values(xc, xrd_axis_mode, wavelength_angstrom)
            x_d = two_theta_to_d_spacing(xc, wavelength_angstrom)
            y_smooth = smooth_signal(yc, smooth_method, smooth_window, smooth_poly_deg)
            y_final = apply_normalization(
                xc, y_smooth, norm_method,
                norm_x_start=norm_x_start, norm_x_end=norm_x_end,
            )
            compare_signal = y_final if norm_method != "none" else (
                y_smooth if smooth_method != "none" else yc
            )
            compare_y_max = max(compare_y_max, float(np.nanmax(compare_signal)))

            if smooth_method != "none":
                fig1.add_trace(go.Scatter(
                    x=x_axis, y=yc, mode="lines", name=f"{fname}（原始）",
                    line=dict(color=color, width=1.4, dash="dash"), opacity=0.45,
                ))
                fig1.add_trace(go.Scatter(
                    x=x_axis, y=y_smooth, mode="lines", name=f"{fname}（平滑後）",
                    line=dict(color=color, width=2.2),
                ))
            else:
                fig1.add_trace(go.Scatter(
                    x=x_axis, y=yc, mode="lines", name=fname,
                    line=dict(color=color, width=2),
                ))

            if norm_method != "none":
                fig2.add_trace(go.Scatter(
                    x=x_axis, y=y_final, mode="lines", name=f"{fname}（歸一化後）",
                    line=dict(color=color, width=2),
                ))

            export_row = {
                "TwoTheta_deg": xc,
                "d_spacing_A": x_d,
                "Intensity_raw": yc,
                "Intensity_smoothed": y_smooth,
            }
            if norm_method != "none":
                export_row["Intensity_normalized"] = y_final
            export_frames[fname] = pd.DataFrame(export_row)

            if run_peak_detection:
                peak_signal = y_final if norm_method != "none" else y_smooth
                peak_idx = detect_xrd_peaks(
                    xc, peak_signal, peak_prom_ratio,
                    peak_height_ratio, peak_distance_deg, max_peak_labels,
                )
                if len(peak_idx):
                    peak_table = build_xrd_peak_table(
                        fname, xc, peak_signal, peak_idx, wavelength_angstrom
                    )
                    peak_tables.append(peak_table)
                    peak_fig = fig2 if norm_method != "none" else fig1
                    peak_x_vals = (
                        peak_table["d_spacing_A"] if xrd_axis_mode == "d_spacing"
                        else peak_table["2theta_deg"]
                    )
                    peak_labels = (
                        [f"{v:.3f} Å" for v in peak_table["d_spacing_A"]]
                        if xrd_axis_mode == "d_spacing"
                        else [f"{v:.2f}°" for v in peak_table["2theta_deg"]]
                    )
                    peak_fig.add_trace(go.Scatter(
                        x=peak_x_vals,
                        y=peak_table["Intensity"],
                        mode="markers+text" if label_peaks else "markers",
                        name=f"{fname} 峰位",
                        text=peak_labels if label_peaks else None,
                        textposition="top center",
                        textfont=dict(size=10),
                        marker=dict(color=color, size=9, symbol="x"),
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
        )
    else:
        auto_scroll_on_appear(
            "xrd-norm-plot",
            visible=False,
            state_key="xrd_scroll_norm_plot",
        )

    peak_export_df = pd.concat(peak_tables, ignore_index=True) if peak_tables else pd.DataFrame()
    if run_peak_detection:
        source_label = "歸一化後" if norm_method != "none" else ("平滑後" if smooth_method != "none" else "原始")
        st.caption(f"峰值偵測以目前{source_label}曲線為準。")
        if peak_export_df.empty:
            st.info("目前條件下未偵測到峰值。")
        else:
            st.subheader("峰值列表")
            peak_display = peak_export_df.copy().round({
                "2theta_deg": 4,
                "d_spacing_A": 5,
                "Intensity": 4,
                "Relative_Intensity_pct": 2,
                "FWHM_deg": 4,
            })
            st.dataframe(peak_display, use_container_width=True, hide_index=True)

    reference_match_df = pd.DataFrame()
    if run_reference_matching:
        st.subheader("參考峰")
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
                st.info("若要計算參考峰匹配，請先在 Step 5 啟用並完成峰值偵測。")
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

    if export_frames or not peak_export_df.empty or not reference_df.empty or not reference_match_df.empty:
        st.subheader("匯出")
        curve_items = list(export_frames.items())
        for start in range(0, len(curve_items), 4):
            row_items = curve_items[start:start + 4]
            row_cols = st.columns(len(row_items))
            for col, (fname, df) in zip(row_cols, row_items):
                base = fname.rsplit(".", 1)[0]
                out_name = col.text_input(
                    "檔名", value=f"{base}_processed",
                    key=f"xrd_fname_{fname}", label_visibility="collapsed",
                )
                col.download_button(
                    "⬇️ 下載曲線 CSV",
                    data=df.to_csv(index=False).encode("utf-8"),
                    file_name=f"{(out_name or base + '_processed').strip()}.csv",
                    mime="text/csv",
                    key=f"xrd_dl_{fname}",
                )

        if not peak_export_df.empty:
            peak_name = st.text_input("峰值列表檔名", value="xrd_peaks", key="xrd_peak_fname")
            st.download_button(
                "⬇️ 下載峰值列表 CSV",
                data=peak_export_df.to_csv(index=False).encode("utf-8"),
                file_name=f"{(peak_name or 'xrd_peaks').strip()}.csv",
                mime="text/csv",
                key="xrd_peak_dl",
            )

        if not reference_df.empty:
            ref_name = st.text_input("參考峰檔名", value="xrd_references", key="xrd_ref_fname")
            st.download_button(
                "⬇️ 下載參考峰 CSV",
                data=reference_df.to_csv(index=False).encode("utf-8"),
                file_name=f"{(ref_name or 'xrd_references').strip()}.csv",
                mime="text/csv",
                key="xrd_ref_dl",
            )

        if not reference_match_df.empty:
            ref_match_name = st.text_input(
                "參考匹配檔名", value="xrd_reference_matches", key="xrd_ref_match_fname"
            )
            st.download_button(
                "⬇️ 下載參考匹配 CSV",
                data=reference_match_df.to_csv(index=False).encode("utf-8"),
                file_name=f"{(ref_match_name or 'xrd_reference_matches').strip()}.csv",
                mime="text/csv",
                key="xrd_ref_match_dl",
            )
