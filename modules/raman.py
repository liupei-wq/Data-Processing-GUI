"""Raman-specific numerical helpers, result-table utilities, and Streamlit UI."""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from scipy.signal import peak_widths

from core.parsers import parse_two_column_spectrum_bytes
from core.spectrum_ops import detect_spectrum_peaks, interpolate_spectrum_to_grid, mean_spectrum_arrays
from core.ui_helpers import _next_btn, hex_to_rgba, step_header, step_header_with_skip
from peak_fitting import fit_peaks
from processing import apply_normalization, apply_processing, despike_signal, smooth_signal


def build_raman_peak_table(
    dataset: str,
    x: np.ndarray,
    y: np.ndarray,
    peak_idx: np.ndarray,
) -> pd.DataFrame:
    if len(peak_idx) == 0:
        return pd.DataFrame(columns=[
            "Dataset", "Peak", "Raman_Shift_cm", "Intensity",
            "Relative_Intensity_pct", "FWHM_cm",
        ])

    widths, _, left_ips, right_ips = peak_widths(y, peak_idx, rel_height=0.5)
    sample_axis = np.arange(len(x), dtype=float)
    left_x = np.interp(left_ips, sample_axis, x)
    right_x = np.interp(right_ips, sample_axis, x)

    peak_x = x[peak_idx]
    peak_y = y[peak_idx]
    curve_max = float(np.max(y)) if len(y) else 0.0
    rel_intensity = (peak_y / curve_max * 100.0) if curve_max > 0 else np.zeros_like(peak_y)

    return pd.DataFrame({
        "Dataset": dataset,
        "Peak": np.arange(1, len(peak_idx) + 1),
        "Raman_Shift_cm": peak_x,
        "Intensity": peak_y,
        "Relative_Intensity_pct": rel_intensity,
        "FWHM_cm": np.abs(right_x - left_x),
    })


def run_raman_ui():
    RAMAN_COLORS = ["#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
                    "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52"]

    # ── Step 1: file upload (sidebar) ─────────────────────────────────────────
    with st.sidebar:
        step_header(1, "載入檔案")
        uploaded_files = st.file_uploader(
            "上傳 Raman .txt / .csv / .asc 檔案（可多選）",
            type=["txt", "csv", "asc", "asc_"],
            accept_multiple_files=True,
            key="raman_uploader",
        )

    if not uploaded_files:
        st.info("請在左側上傳一個或多個 Raman .txt / .csv 檔案。")
        st.stop()

    # ── Parse uploaded files ───────────────────────────────────────────────────
    data_dict: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for uf in uploaded_files:
        _ck = f"_raman_{uf.name}_{uf.size}"
        if _ck not in st.session_state:
            _x, _y, _err = parse_two_column_spectrum_bytes(uf.read())
            if _err:
                st.session_state[_ck] = (None, None, _err)
            else:
                st.session_state[_ck] = (
                    np.asarray(_x, dtype=float).ravel(),
                    np.asarray(_y, dtype=float).ravel(),
                    None,
                )
        _cached = st.session_state[_ck]
        if _cached[2] is not None:
            st.error(f"**{uf.name}** 讀取失敗：{_cached[2]}")
        else:
            data_dict[uf.name] = (_cached[0], _cached[1])

    if not data_dict:
        st.stop()

    st.success(f"成功載入 {len(data_dict)} 個檔案：{', '.join(data_dict.keys())}")

    # ── Compute global x range ─────────────────────────────────────────────────
    _all_x = np.concatenate([xv for xv, _ in data_dict.values()])
    x_min_g = float(_all_x.min())
    x_max_g = float(_all_x.max())
    ov_min = float(max(xv.min() for xv, _ in data_dict.values()))
    ov_max = float(min(xv.max() for xv, _ in data_dict.values()))
    _cur = st.session_state.get("raman_disp", (ov_min, ov_max))
    _e0 = float(np.clip(float(min(_cur)), x_min_g, x_max_g))
    _e1 = float(np.clip(float(max(_cur)), x_min_g, x_max_g))
    if _e0 >= _e1:
        _e0, _e1 = ov_min, ov_max
    step_size = float(max(0.1, (x_max_g - x_min_g) / 2000))
    raman_peak_distance_default = float(max(step_size, min(20.0, max(step_size, (_e1 - _e0) / 80))))

    # ── Step 2: despike (sidebar) ─────────────────────────────────────────────
    despike_method = "none"
    despike_threshold = 8.0
    despike_window = 7
    despike_passes = 1
    show_spike_marks = False

    with st.sidebar:
        skip_despike = step_header_with_skip(2, "去尖峰", "raman_skip_despike")
        if not skip_despike:
            despike_method = st.selectbox(
                "方法",
                ["none", "median"],
                format_func=lambda v: {
                    "none": "不處理",
                    "median": "Median despike（cosmic ray）",
                }[v],
                key="raman_despike_method",
            )
            if despike_method != "none":
                despike_threshold = float(st.slider(
                    "尖峰判定門檻", 4.0, 20.0, 8.0, 0.5, key="raman_despike_threshold"
                ))
                despike_window = int(st.number_input(
                    "局部視窗點數", min_value=3, max_value=31, value=7, step=2, key="raman_despike_window"
                ))
                despike_passes = int(st.slider("修正回合數", 1, 3, 1, key="raman_despike_passes"))
                show_spike_marks = st.checkbox("在圖上標示被修正的點", value=False, key="raman_show_spikes")

        if skip_despike:
            st.session_state["raman_step2_done"] = True
        s2 = st.session_state.get("raman_step2_done", False)
        if not skip_despike and not s2:
            if _next_btn("raman_btn2", "raman_step2_done"):
                s2 = True
        step2_done = skip_despike or s2

    # ── Step 3: averaging options (sidebar) ───────────────────────────────────
    do_average = False
    show_individual = False
    interp_points = 601

    with st.sidebar:
        s3 = st.session_state.get("raman_step3_done", False)
        if step2_done:
            skip_avg = step_header_with_skip(3, "多檔平均", "raman_skip_avg")
            if not skip_avg:
                do_average = st.checkbox("對所有載入的檔案做平均", value=False, key="raman_do_avg")
                interp_points = int(st.number_input(
                    "插值點數", min_value=100, max_value=5000, value=601, step=50, key="raman_interp"
                ))
                if do_average:
                    show_individual = st.checkbox("疊加顯示原始個別曲線", value=False, key="raman_show_ind")
            if skip_avg:
                st.session_state["raman_step3_done"] = True
            s3 = st.session_state.get("raman_step3_done", False)
            if not skip_avg and not s3:
                if _next_btn("raman_btn3", "raman_step3_done"):
                    s3 = True
        else:
            skip_avg = False
        step3_done = step2_done and (skip_avg or s3)

    # ── Step 4: background (sidebar) ──────────────────────────────────────────
    bg_method = "none"
    bg_x_start, bg_x_end = _e0, _e1
    show_bg_baseline = False
    poly_deg = 3
    baseline_lambda = 1e5
    baseline_p = 0.01
    baseline_iter = 20

    with st.sidebar:
        s4 = st.session_state.get("raman_step4_done", False)
        if step3_done:
            skip_bg = step_header_with_skip(4, "背景扣除", "raman_skip_bg")
            if not skip_bg:
                bg_method = st.selectbox(
                    "方法",
                    ["none", "linear", "polynomial", "asls", "airpls"],
                    format_func=lambda v: {
                        "none": "不扣除",
                        "linear": "線性背景",
                        "polynomial": "多項式（螢光背景）",
                        "asls": "AsLS（推薦，螢光背景）",
                        "airpls": "airPLS（自適應螢光背景）",
                    }[v],
                    key="raman_bg_method",
                )
                if bg_method == "polynomial":
                    poly_deg = int(st.slider("多項式階數", 2, 6, 3, key="raman_poly_deg"))
                elif bg_method in ("asls", "airpls"):
                    lambda_exp = float(st.slider(
                        "平滑強度 log10(λ)", 2.0, 9.0, 5.0, 0.5, key="raman_baseline_lambda_exp"
                    ))
                    baseline_lambda = float(10.0 ** lambda_exp)
                    baseline_iter = int(st.slider(
                        "迭代次數", 5, 50, 20, key="raman_baseline_iter"
                    ))
                    if bg_method == "asls":
                        baseline_p = float(st.slider(
                            "峰值抑制 p", 0.001, 0.200, 0.010, 0.001, key="raman_baseline_p"
                        ))
                    st.caption(
                        "λ 越大，背景越平；AsLS 的 p 越小，越不容易把真正峰形當成背景。"
                    )
                if bg_method != "none":
                    _prev = st.session_state.get("raman_bg_range", (_e0, _e1))
                    _lo = float(np.clip(float(min(_prev)), _e0, _e1))
                    _hi = float(np.clip(float(max(_prev)), _e0, _e1))
                    if _lo >= _hi:
                        _lo, _hi = _e0, _e1
                    st.session_state["raman_bg_range"] = (_lo, _hi)
                    bg_range = st.slider(
                        "背景計算區間 (cm⁻¹)",
                        min_value=_e0, max_value=_e1,
                        step=step_size, format="%.1f cm⁻¹",
                        key="raman_bg_range",
                    )
                    bg_x_start = float(min(bg_range))
                    bg_x_end = float(max(bg_range))
                    show_bg_baseline = st.checkbox("疊加顯示背景基準線", value=True, key="raman_show_bg")
            if skip_bg:
                st.session_state["raman_step4_done"] = True
            s4 = st.session_state.get("raman_step4_done", False)
            if not skip_bg and not s4:
                if _next_btn("raman_btn4", "raman_step4_done"):
                    s4 = True
        else:
            skip_bg = False
        step4_done = step3_done and (skip_bg or s4)

    # ── Step 5: smoothing (sidebar) ───────────────────────────────────────────
    smooth_method = "none"
    smooth_window = 11
    smooth_poly_deg = 3

    with st.sidebar:
        s5 = st.session_state.get("raman_step5_done", False)
        if step4_done:
            skip_smooth = step_header_with_skip(5, "平滑", "raman_skip_smooth")
            if not skip_smooth:
                smooth_method = st.selectbox(
                    "方法",
                    ["none", "moving_average", "savitzky_golay"],
                    format_func=lambda v: {
                        "none": "不平滑",
                        "moving_average": "移動平均",
                        "savitzky_golay": "Savitzky-Golay",
                    }[v],
                    key="raman_smooth_method",
                )
                if smooth_method != "none":
                    smooth_window = int(st.number_input(
                        "視窗點數", min_value=3, max_value=301, value=11, step=2, key="raman_smooth_window"
                    ))
                if smooth_method == "savitzky_golay":
                    smooth_poly_deg = int(st.slider("多項式階數", 2, 5, 3, key="raman_smooth_poly"))
            if skip_smooth:
                st.session_state["raman_step5_done"] = True
            s5 = st.session_state.get("raman_step5_done", False)
            if not skip_smooth and not s5:
                if _next_btn("raman_btn5", "raman_step5_done"):
                    s5 = True
        else:
            skip_smooth = False
        step5_done = step4_done and (skip_smooth or s5)

    # ── Step 6: normalization (sidebar) ───────────────────────────────────────
    norm_method = "none"
    norm_x_start, norm_x_end = _e0, _e1

    with st.sidebar:
        s6 = st.session_state.get("raman_step6_done", False)
        if step5_done:
            skip_norm = step_header_with_skip(6, "歸一化", "raman_skip_norm")
            if not skip_norm:
                norm_method = st.selectbox(
                    "方法",
                    ["none", "min_max", "max", "area", "mean_region"],
                    format_func=lambda v: {
                        "none": "不歸一化",
                        "min_max": "Min-Max (0~1)",
                        "max": "峰值歸一化（可選區間）",
                        "area": "面積歸一化（總面積 = 1）",
                        "mean_region": "算術平均歸一化（選區間）",
                    }[v],
                    key="raman_norm_method",
                )
                if norm_method in ("mean_region", "max"):
                    _prev = st.session_state.get("raman_norm_range", (_e0, _e1))
                    _lo = float(np.clip(float(min(_prev)), _e0, _e1))
                    _hi = float(np.clip(float(max(_prev)), _e0, _e1))
                    if _lo >= _hi:
                        _lo, _hi = _e0, _e1
                    st.session_state["raman_norm_range"] = (_lo, _hi)
                    norm_range = st.slider(
                        "歸一化參考區間 (cm⁻¹)",
                        min_value=_e0, max_value=_e1,
                        step=step_size, format="%.1f cm⁻¹",
                        key="raman_norm_range",
                    )
                    norm_x_start = float(min(norm_range))
                    norm_x_end = float(max(norm_range))
            if skip_norm:
                st.session_state["raman_step6_done"] = True
            s6 = st.session_state.get("raman_step6_done", False)
            if not skip_norm and not s6:
                if _next_btn("raman_btn6", "raman_step6_done"):
                    s6 = True
        else:
            skip_norm = False
        step6_done = step5_done and (skip_norm or s6)

    # ── Step 7: peak detection (sidebar) ──────────────────────────────────────
    peak_prom_ratio = 0.05
    peak_height_ratio = 0.03
    peak_distance_cm = raman_peak_distance_default
    max_peak_labels = 15
    label_peaks = True
    run_peak_detection = False

    with st.sidebar:
        s7 = st.session_state.get("raman_step7_done", False)
        if step6_done:
            skip_peaks = step_header_with_skip(7, "峰值偵測", "raman_skip_peaks")
            if not skip_peaks:
                peak_prom_ratio = float(st.slider(
                    "最小顯著度（相對）", 0.0, 1.0, 0.05, 0.01, key="raman_peak_prominence"
                ))
                peak_height_ratio = float(st.slider(
                    "最小高度（相對最大值）", 0.0, 1.0, 0.03, 0.01, key="raman_peak_height"
                ))
                peak_distance_cm = float(st.number_input(
                    "最小峰距 (cm⁻¹)",
                    min_value=step_size,
                    max_value=max(step_size, x_max_g - x_min_g),
                    value=raman_peak_distance_default,
                    step=max(step_size, 1.0),
                    format="%.1f",
                    key="raman_peak_distance",
                ))
                max_peak_labels = int(st.number_input(
                    "最多標記峰數", min_value=1, max_value=50, value=15, step=1, key="raman_peak_max"
                ))
                label_peaks = st.checkbox("標示峰位數值", value=True, key="raman_peak_labels")
            if skip_peaks:
                st.session_state["raman_step7_done"] = True
            s7 = st.session_state.get("raman_step7_done", False)
            if not skip_peaks and not s7:
                if _next_btn("raman_btn7", "raman_step7_done"):
                    s7 = True
            run_peak_detection = (not skip_peaks) and s7
        else:
            skip_peaks = False
        step7_done = step6_done and (skip_peaks or s7)

    # ── Step 8: peak fitting (sidebar) ────────────────────────────────────────
    fit_profile = "voigt"
    fit_max_peaks = 5
    fit_initial_fwhm = float(max(4.0, min(24.0, (_e1 - _e0) / 30.0)))
    fit_target_options = ["Average"] if do_average else list(data_dict.keys())
    fit_target_default = fit_target_options[0]
    run_peak_fit = False

    with st.sidebar:
        s8 = st.session_state.get("raman_step8_done", False)
        if step7_done and run_peak_detection:
            if st.session_state.get("raman_fit_target") not in fit_target_options:
                st.session_state["raman_fit_target"] = fit_target_default
            skip_fit = step_header_with_skip(8, "峰擬合", "raman_skip_fit")
            if not skip_fit:
                if len(fit_target_options) > 1:
                    fit_target = st.selectbox("擬合對象", fit_target_options, key="raman_fit_target")
                else:
                    fit_target = fit_target_default
                    st.caption(f"擬合對象：{fit_target}")
                fit_profile = st.selectbox(
                    "線形",
                    ["voigt", "gaussian", "lorentzian"],
                    format_func=lambda v: {
                        "voigt": "Voigt（推薦）",
                        "gaussian": "Gaussian",
                        "lorentzian": "Lorentzian",
                    }[v],
                    key="raman_fit_profile",
                )
                fit_max_peaks = int(st.number_input(
                    "最多擬合峰數",
                    min_value=1,
                    max_value=12,
                    value=min(5, max_peak_labels),
                    step=1,
                    key="raman_fit_max_peaks",
                ))
                fit_initial_fwhm = float(st.number_input(
                    "初始 FWHM (cm⁻¹)",
                    min_value=float(max(step_size, 0.5)),
                    max_value=float(max(200.0, x_max_g - x_min_g)),
                    value=float(max(4.0, min(24.0, (_e1 - _e0) / 30.0))),
                    step=float(max(step_size, 0.5)),
                    format="%.1f",
                    key="raman_fit_init_fwhm",
                ))
                st.caption("以目前峰值偵測結果作為初始中心，取強度最高的前幾個峰做擬合。")
            if skip_fit:
                st.session_state["raman_step8_done"] = True
            s8 = st.session_state.get("raman_step8_done", False)
            if not skip_fit and not s8:
                if _next_btn("raman_btn8", "raman_step8_done"):
                    s8 = True
            run_peak_fit = (not skip_fit) and s8
        else:
            fit_target = fit_target_default

    # ── Main: display range slider ─────────────────────────────────────────────
    r_range = st.slider(
        "顯示範圍 — Raman Shift (cm⁻¹)",
        min_value=x_min_g, max_value=x_max_g,
        value=(ov_min, ov_max),
        step=step_size, format="%.1f cm⁻¹",
        key="raman_disp",
    )
    r_start = float(min(r_range))
    r_end = float(max(r_range))

    def _raman_peak_source(y_raw, y_despiked, y_bg_subtracted, y_smoothed, y_normalized):
        if norm_method != "none":
            return y_normalized, "歸一化後"
        if smooth_method != "none":
            return y_smoothed, "平滑後"
        if bg_method != "none":
            return y_bg_subtracted, "背景扣除後"
        if despike_method != "none":
            return y_despiked, "去尖峰後"
        return y_raw, "原始"

    # ── Build figures ──────────────────────────────────────────────────────────
    fig1 = go.Figure()
    fig2 = go.Figure()
    export_frames: dict[str, pd.DataFrame] = {}
    despike_notes: list[str] = []
    peak_tables: list[pd.DataFrame] = []
    peak_table_map: dict[str, pd.DataFrame] = {}
    fit_source_map: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    peak_signal_label = None

    if do_average:
        avg_start = float(max(r_start, ov_min))
        avg_end = float(min(r_end, ov_max))
        if avg_start >= avg_end:
            st.warning("多檔平均需要共同重疊區間；目前顯示範圍內沒有可平均的區段。")
        else:
            if avg_start > r_start or avg_end < r_end:
                st.caption(
                    f"多檔平均僅在共同重疊區間 {avg_start:.1f} – {avg_end:.1f} cm⁻¹ 內進行。"
                )
            new_x = np.linspace(avg_start, avg_end, interp_points)
            all_interp_raw = []
            all_interp_input = []
            total_spikes = 0
            for fname, (xv, yv) in data_dict.items():
                mask = (xv >= avg_start) & (xv <= avg_end)
                xc, yc = xv[mask], yv[mask]
                if len(xc) < 2:
                    st.warning(f"{fname}：共同重疊區間內數據點不足，已跳過。")
                    continue

                y_input, spike_mask = despike_signal(
                    yc, despike_method,
                    threshold=despike_threshold,
                    window_points=despike_window,
                    passes=despike_passes,
                )
                total_spikes += int(np.count_nonzero(spike_mask))
                raw_interp = interpolate_spectrum_to_grid(xc, yc, new_x, fill_value=np.nan)
                input_interp = interpolate_spectrum_to_grid(xc, y_input, new_x, fill_value=np.nan)
                if not (np.all(np.isfinite(raw_interp)) and np.all(np.isfinite(input_interp))):
                    st.warning(f"{fname}：插值後資料不完整，已跳過。")
                    continue
                all_interp_raw.append(raw_interp)
                all_interp_input.append(input_interp)
                if show_individual:
                    fig1.add_trace(go.Scatter(
                        x=new_x, y=raw_interp, mode="lines", name=fname,
                        line=dict(width=1, dash="dot"), opacity=0.35,
                    ))

            if all_interp_input:
                avg_raw = mean_spectrum_arrays(all_interp_raw)
                avg_input = mean_spectrum_arrays(all_interp_input)
                y_bg, bg = apply_processing(
                    new_x, avg_input, bg_method, "none",
                    bg_x_start=bg_x_start, bg_x_end=bg_x_end, poly_deg=poly_deg,
                    baseline_lambda=baseline_lambda,
                    baseline_p=baseline_p,
                    baseline_iter=baseline_iter,
                )
                y_smooth = smooth_signal(
                    y_bg, smooth_method,
                    window_points=smooth_window, poly_deg=smooth_poly_deg,
                )
                y_final = apply_normalization(
                    new_x, y_smooth, norm_method,
                    norm_x_start=norm_x_start, norm_x_end=norm_x_end,
                )

                any_preprocess = (
                    despike_method != "none" or bg_method != "none" or smooth_method != "none"
                )
                if any_preprocess:
                    fig1.add_trace(go.Scatter(
                        x=new_x, y=avg_raw, mode="lines", name="Average（原始）",
                        line=dict(color="white", width=1.5, dash="dash"), opacity=0.55,
                    ))

                if despike_method != "none" and bg_method == "none" and smooth_method == "none":
                    fig1.add_trace(go.Scatter(
                        x=new_x, y=avg_input, mode="lines", name="Average（去尖峰後）",
                        line=dict(color="#EF553B", width=2.5),
                    ))
                elif bg_method != "none":
                    if show_bg_baseline:
                        fig1.add_trace(go.Scatter(
                            x=new_x, y=bg, mode="lines", name="背景基準線",
                            line=dict(color="gray", width=1.5, dash="longdash"),
                        ))
                    if smooth_method != "none":
                        fig1.add_trace(go.Scatter(
                            x=new_x, y=y_bg, mode="lines", name="Average（背景扣除後）",
                            line=dict(color="#B6E880", width=1.8, dash="dot"), opacity=0.85,
                        ))
                        fig1.add_trace(go.Scatter(
                            x=new_x, y=y_smooth, mode="lines", name="Average（平滑後）",
                            line=dict(color="#EF553B", width=2.5),
                        ))
                    else:
                        fig1.add_trace(go.Scatter(
                            x=new_x, y=y_bg, mode="lines", name="Average（扣除背景後）",
                            line=dict(color="#EF553B", width=2.5),
                        ))
                elif smooth_method != "none":
                    if despike_method != "none":
                        fig1.add_trace(go.Scatter(
                            x=new_x, y=avg_input, mode="lines", name="Average（去尖峰後）",
                            line=dict(color="#B6E880", width=1.8, dash="dot"), opacity=0.85,
                        ))
                    fig1.add_trace(go.Scatter(
                        x=new_x, y=y_smooth, mode="lines", name="Average（平滑後）",
                        line=dict(color="#EF553B", width=2.5),
                    ))
                else:
                    fig1.add_trace(go.Scatter(
                        x=new_x, y=avg_raw, mode="lines", name="Average",
                        line=dict(color="#EF553B", width=2.5),
                    ))

                if despike_method != "none":
                    despike_notes.append(f"Average：共修正 {total_spikes} 個尖峰點")

                if norm_method != "none":
                    fig2.add_trace(go.Scatter(
                        x=new_x, y=y_final, mode="lines", name="Average（歸一化後）",
                        line=dict(color="#EF553B", width=2.5),
                    ))

                if run_peak_detection:
                    peak_signal, peak_signal_label = _raman_peak_source(
                        avg_raw, avg_input, y_bg, y_smooth, y_final
                    )
                    fit_source_map["Average"] = (new_x, peak_signal)
                    peak_idx = detect_spectrum_peaks(
                        new_x, peak_signal, peak_prom_ratio,
                        peak_height_ratio, peak_distance_cm, max_peak_labels,
                    )
                    peak_table = build_raman_peak_table("Average", new_x, peak_signal, peak_idx)
                    peak_table_map["Average"] = peak_table
                    if not peak_table.empty:
                        peak_tables.append(peak_table)
                        peak_fig = fig2 if norm_method != "none" else fig1
                        peak_fig.add_trace(go.Scatter(
                            x=peak_table["Raman_Shift_cm"],
                            y=peak_table["Intensity"],
                            mode="markers+text" if label_peaks else "markers",
                            name="Average 峰位",
                            text=[f"{v:.1f}" for v in peak_table["Raman_Shift_cm"]] if label_peaks else None,
                            textposition="top center",
                            textfont=dict(size=10),
                            marker=dict(color="#FFD166", size=10, symbol="x"),
                        ))

                row: dict[str, np.ndarray] = {
                    "Raman_Shift_cm": new_x,
                    "Average_raw": avg_raw,
                }
                if despike_method != "none":
                    row["Average_despiked"] = avg_input
                if bg_method != "none":
                    row["Background"] = bg
                    row["Average_bg_subtracted"] = y_bg
                if smooth_method != "none":
                    row["Average_smoothed"] = y_smooth
                if norm_method != "none":
                    row["Average_normalized"] = y_final
                export_frames["Average"] = pd.DataFrame(row)
    else:
        for i, (fname, (xv, yv)) in enumerate(data_dict.items()):
            mask = (xv >= r_start) & (xv <= r_end)
            xc, yc = xv[mask], yv[mask]
            if len(xc) < 2:
                st.warning(f"{fname}：所選範圍內數據點不足，已跳過。")
                continue
            color = RAMAN_COLORS[i % len(RAMAN_COLORS)]
            y_input, spike_mask = despike_signal(
                yc, despike_method,
                threshold=despike_threshold,
                window_points=despike_window,
                passes=despike_passes,
            )
            y_bg, bg = apply_processing(
                xc, y_input, bg_method, "none",
                bg_x_start=bg_x_start, bg_x_end=bg_x_end, poly_deg=poly_deg,
                baseline_lambda=baseline_lambda,
                baseline_p=baseline_p,
                baseline_iter=baseline_iter,
            )
            y_smooth = smooth_signal(
                y_bg, smooth_method,
                window_points=smooth_window, poly_deg=smooth_poly_deg,
            )
            y_final = apply_normalization(
                xc, y_smooth, norm_method,
                norm_x_start=norm_x_start, norm_x_end=norm_x_end,
            )

            any_preprocess = (
                despike_method != "none" or bg_method != "none" or smooth_method != "none"
            )
            if any_preprocess:
                fig1.add_trace(go.Scatter(
                    x=xc, y=yc, mode="lines", name=f"{fname}（原始）",
                    line=dict(color=color, width=1.5, dash="dash"), opacity=0.45,
                ))
            if despike_method != "none" and show_spike_marks and np.any(spike_mask):
                fig1.add_trace(go.Scatter(
                    x=xc[spike_mask], y=yc[spike_mask], mode="markers",
                    name=f"{fname}（尖峰點）",
                    marker=dict(color=color, size=7, symbol="x"),
                    showlegend=False,
                ))

            if bg_method != "none":
                if show_bg_baseline:
                    fig1.add_trace(go.Scatter(
                        x=xc, y=bg, mode="lines", name=f"{fname}（背景）",
                        line=dict(color=color, width=1.2, dash="longdash"), opacity=0.5,
                    ))
                if smooth_method != "none":
                    fig1.add_trace(go.Scatter(
                        x=xc, y=y_bg, mode="lines", name=f"{fname}（背景扣除後）",
                        line=dict(color=color, width=1.7, dash="dot"), opacity=0.8,
                    ))
                    fig1.add_trace(go.Scatter(
                        x=xc, y=y_smooth, mode="lines", name=f"{fname}（平滑後）",
                        line=dict(color=color, width=2.2),
                    ))
                else:
                    fig1.add_trace(go.Scatter(
                        x=xc, y=y_bg, mode="lines", name=f"{fname}（扣除背景後）",
                        line=dict(color=color, width=2),
                    ))
            elif smooth_method != "none":
                if despike_method != "none":
                    fig1.add_trace(go.Scatter(
                        x=xc, y=y_input, mode="lines", name=f"{fname}（去尖峰後）",
                        line=dict(color=color, width=1.7, dash="dot"), opacity=0.8,
                    ))
                fig1.add_trace(go.Scatter(
                    x=xc, y=y_smooth, mode="lines", name=f"{fname}（平滑後）",
                    line=dict(color=color, width=2.2),
                ))
            elif despike_method != "none":
                fig1.add_trace(go.Scatter(
                    x=xc, y=y_input, mode="lines", name=f"{fname}（去尖峰後）",
                    line=dict(color=color, width=2),
                ))
            else:
                fig1.add_trace(go.Scatter(
                    x=xc, y=yc, mode="lines", name=fname,
                    line=dict(color=color, width=2),
                ))

            if despike_method != "none":
                spike_count = int(np.count_nonzero(spike_mask))
                despike_notes.append(f"{fname}：修正 {spike_count} 個尖峰點")

            if norm_method != "none":
                fig2.add_trace(go.Scatter(
                    x=xc, y=y_final, mode="lines", name=f"{fname}（歸一化後）",
                    line=dict(color=color, width=2),
                ))

            if run_peak_detection:
                peak_signal, peak_signal_label = _raman_peak_source(
                    yc, y_input, y_bg, y_smooth, y_final
                )
                fit_source_map[fname] = (xc, peak_signal)
                peak_idx = detect_spectrum_peaks(
                    xc, peak_signal, peak_prom_ratio,
                    peak_height_ratio, peak_distance_cm, max_peak_labels,
                )
                peak_table = build_raman_peak_table(fname, xc, peak_signal, peak_idx)
                peak_table_map[fname] = peak_table
                if not peak_table.empty:
                    peak_tables.append(peak_table)
                    peak_fig = fig2 if norm_method != "none" else fig1
                    peak_fig.add_trace(go.Scatter(
                        x=peak_table["Raman_Shift_cm"],
                        y=peak_table["Intensity"],
                        mode="markers+text" if label_peaks else "markers",
                        name=f"{fname} 峰位",
                        text=[f"{v:.1f}" for v in peak_table["Raman_Shift_cm"]] if label_peaks else None,
                        textposition="top center",
                        textfont=dict(size=10),
                        marker=dict(color=color, size=9, symbol="x"),
                    ))

            row: dict[str, np.ndarray] = {"Raman_Shift_cm": xc, "Intensity_raw": yc}
            if despike_method != "none":
                row["Intensity_despiked"] = y_input
            if bg_method != "none":
                row["Background"] = bg
                row["Intensity_bg_subtracted"] = y_bg
            if smooth_method != "none":
                row["Intensity_smoothed"] = y_smooth
            if norm_method != "none":
                row["Intensity_normalized"] = y_final
            export_frames[fname] = pd.DataFrame(row)

    if despike_method != "none" and despike_notes:
        st.caption("去尖峰摘要：" + "；".join(despike_notes))

    # ── Render figure 1 ────────────────────────────────────────────────────────
    if bg_method != "none":
        fig1.add_vrect(
            x0=bg_x_start, x1=bg_x_end, fillcolor="red", opacity=0.06,
            layer="below", line_width=0,
            annotation_text="背景區間", annotation_position="top left",
        )
    fig1.update_layout(
        xaxis_title="Raman Shift (cm⁻¹)", yaxis_title="Intensity",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        template="plotly_dark", height=480, margin=dict(l=50, r=20, t=60, b=50),
    )
    st.plotly_chart(fig1, use_container_width=True)

    # ── Render figure 2 (normalization) ───────────────────────────────────────
    if norm_method != "none":
        st.caption("歸一化結果")
        if norm_method in ("mean_region", "max"):
            fig2.add_vrect(
                x0=norm_x_start, x1=norm_x_end, fillcolor="blue", opacity=0.06,
                layer="below", line_width=0,
                annotation_text="歸一化區間", annotation_position="top right",
            )
        fig2.update_layout(
            xaxis_title="Raman Shift (cm⁻¹)", yaxis_title="Normalized Intensity",
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            template="plotly_dark", height=400, margin=dict(l=50, r=20, t=40, b=50),
        )
        st.plotly_chart(fig2, use_container_width=True)

    peak_export_df = pd.concat(peak_tables, ignore_index=True) if peak_tables else pd.DataFrame()
    if run_peak_detection:
        source_label = peak_signal_label or "目前處理後"
        st.caption(f"峰值偵測以目前{source_label}曲線為準。")
        if peak_export_df.empty:
            st.info("目前條件下未偵測到峰值。")
        else:
            st.subheader("峰值列表")
            peak_display = peak_export_df.copy().round({
                "Raman_Shift_cm": 3,
                "Intensity": 4,
                "Relative_Intensity_pct": 2,
                "FWHM_cm": 3,
            })
            st.dataframe(peak_display, use_container_width=True, hide_index=True)

    if run_peak_fit:
        st.subheader("峰擬合")
        fit_peak_df = peak_table_map.get(fit_target, pd.DataFrame())
        fit_series = fit_source_map.get(fit_target)
        source_label = peak_signal_label or "目前處理後"

        if fit_series is None:
            st.info("目前沒有可用於擬合的曲線。")
        elif fit_peak_df.empty:
            st.info("所選曲線目前沒有可作為初始值的偵測峰。")
        else:
            fit_x, fit_y = fit_series
            fit_seed_df = fit_peak_df.sort_values("Intensity", ascending=False).head(
                fit_max_peaks
            ).sort_values("Raman_Shift_cm")

            init_peaks = []
            min_fwhm = float(max(step_size, 0.5))
            max_fwhm = float(max(200.0, x_max_g - x_min_g))
            for idx, row in enumerate(fit_seed_df.itertuples(index=False), start=1):
                fwhm_guess = float(getattr(row, "FWHM_cm", np.nan))
                if not np.isfinite(fwhm_guess) or fwhm_guess <= 0:
                    fwhm_guess = fit_initial_fwhm
                fwhm_guess = float(np.clip(fwhm_guess, min_fwhm, max_fwhm))
                init_peaks.append({
                    "label": f"P{idx}",
                    "be": float(row.Raman_Shift_cm),
                    "fwhm": fwhm_guess,
                })

            st.caption(
                f"{fit_target}：以目前{source_label}曲線擬合，"
                f"共使用 {len(init_peaks)} 個初始峰。"
            )

            with st.spinner("Raman 峰擬合中…"):
                fit_result = fit_peaks(
                    fit_x, fit_y,
                    init_peaks=init_peaks,
                    profile=fit_profile,
                )

            if not fit_result.get("success"):
                st.warning(f"峰擬合失敗：{fit_result.get('message', '')}")
            else:
                fit_colors = [
                    "#EF553B", "#636EFA", "#00CC96", "#AB63FA",
                    "#FFA15A", "#19D3F3", "#FF6692", "#B6E880",
                ]
                fig_fit = go.Figure()
                fig_fit.add_trace(go.Scatter(
                    x=fit_x, y=fit_y,
                    mode="lines", name="實驗曲線",
                    line=dict(color="white", width=1.6, dash="dot"),
                ))
                fig_fit.add_trace(go.Scatter(
                    x=fit_x, y=fit_result["y_fit"],
                    mode="lines", name="擬合包絡",
                    line=dict(color="#FFD166", width=2.5),
                ))
                for pi, (pk_info, yi) in enumerate(zip(fit_result["peaks"], fit_result["y_individual"])):
                    color = fit_colors[pi % len(fit_colors)]
                    fig_fit.add_trace(go.Scatter(
                        x=fit_x, y=yi,
                        mode="lines",
                        name=f"{pk_info['label']}  {pk_info['center']:.1f} cm⁻¹",
                        line=dict(color=color, width=1.5, dash="dash"),
                        fill="tozeroy",
                        fillcolor=hex_to_rgba(color, 0.12),
                    ))
                fig_fit.add_trace(go.Scatter(
                    x=fit_x, y=fit_result["residuals"],
                    mode="lines", name="殘差",
                    line=dict(color="#888888", width=1),
                    yaxis="y2",
                ))
                fig_fit.update_layout(
                    xaxis_title="Raman Shift (cm⁻¹)",
                    yaxis_title="Intensity",
                    yaxis2=dict(
                        title="殘差", overlaying="y", side="right",
                        showgrid=False, zeroline=True, zerolinecolor="#555555",
                    ),
                    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                    template="plotly_dark",
                    height=500,
                    margin=dict(l=50, r=70, t=60, b=50),
                )
                st.plotly_chart(fig_fit, use_container_width=True)

                r2 = float(fit_result["r_squared"])
                st.caption(
                    f"R² = {r2:.5f}  "
                    f"({'優秀' if r2 > 0.999 else '良好' if r2 > 0.99 else '尚可' if r2 > 0.95 else '差'})"
                )

                fit_summary_df = pd.DataFrame([
                    {
                        "Dataset": fit_target,
                        "Peak": pk["label"],
                        "Center_cm": pk["center"],
                        "FWHM_cm": pk["fwhm"],
                        "Area": pk["area"],
                        "Area_pct": pk["area_pct"],
                    }
                    for pk in fit_result["peaks"]
                ])
                st.dataframe(
                    fit_summary_df.round({
                        "Center_cm": 3,
                        "FWHM_cm": 3,
                        "Area": 4,
                        "Area_pct": 2,
                    }),
                    use_container_width=True,
                    hide_index=True,
                )

                fit_curve_df = pd.DataFrame({
                    "Raman_Shift_cm": fit_x,
                    "Experimental": fit_y,
                    "Fit_envelope": fit_result["y_fit"],
                    "Residuals": fit_result["residuals"],
                })
                for pk, yi in zip(fit_result["peaks"], fit_result["y_individual"]):
                    fit_curve_df[f"{pk['label']}_component"] = yi

                dl_cols = st.columns(2)
                fit_curve_name = dl_cols[0].text_input(
                    "擬合曲線檔名", value=f"{fit_target}_raman_fit", key="raman_fit_curve_fname"
                )
                dl_cols[0].download_button(
                    "⬇️ 下載擬合曲線 CSV",
                    data=fit_curve_df.to_csv(index=False).encode("utf-8"),
                    file_name=f"{(fit_curve_name or fit_target + '_raman_fit').strip()}.csv",
                    mime="text/csv",
                    key="raman_fit_curve_dl",
                )
                fit_peak_name = dl_cols[1].text_input(
                    "擬合峰表檔名", value=f"{fit_target}_raman_fit_peaks", key="raman_fit_peak_fname"
                )
                dl_cols[1].download_button(
                    "⬇️ 下載擬合峰表 CSV",
                    data=fit_summary_df.to_csv(index=False).encode("utf-8"),
                    file_name=f"{(fit_peak_name or fit_target + '_raman_fit_peaks').strip()}.csv",
                    mime="text/csv",
                    key="raman_fit_peak_dl",
                )

    # ── Export ─────────────────────────────────────────────────────────────────
    if export_frames or not peak_export_df.empty:
        st.subheader("匯出")
        export_items = list(export_frames.items())
        for start in range(0, len(export_items), 4):
            row_items = export_items[start:start + 4]
            row_cols = st.columns(len(row_items))
            for col, (fname, df) in zip(row_cols, row_items):
                base = fname.rsplit(".", 1)[0]
                out_name = col.text_input(
                    "檔名", value=f"{base}_processed",
                    key=f"raman_fname_{fname}", label_visibility="collapsed",
                )
                col.download_button(
                    "⬇️ 下載 CSV",
                    data=df.to_csv(index=False).encode("utf-8"),
                    file_name=f"{(out_name or base + '_processed').strip()}.csv",
                    mime="text/csv",
                    key=f"raman_dl_{fname}",
                )

        if not peak_export_df.empty:
            peak_name = st.text_input("峰值列表檔名", value="raman_peaks", key="raman_peak_fname")
            st.download_button(
                "⬇️ 下載峰值列表 CSV",
                data=peak_export_df.to_csv(index=False).encode("utf-8"),
                file_name=f"{(peak_name or 'raman_peaks').strip()}.csv",
                mime="text/csv",
                key="raman_peak_dl",
            )


