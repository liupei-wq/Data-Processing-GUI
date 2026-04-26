"""Auto-parsed XAS/XANES workflow for beamline DAT files."""

from __future__ import annotations

import json
from datetime import datetime

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from core.processing import apply_background, apply_normalization
from core.spectrum_ops import fit_fixed_gaussian_templates, interpolate_spectrum_to_grid
from core.ui_helpers import step_header
from modules.xas import (
    CHANNELS,
    COLORS,
    _build_export_filename,
    _channel_figure,
    _derivative_edge_energy,
    _download_card,
    _empty_gaussian_center_df,
    _fit_xanes_gaussians,
    _gaussian_center_records,
    _normalize_by_post_edge,
    _normalize_gaussian_center_df,
    _parse_xas_table_bytes,
    _prepare_tey_tfy_auto,
    _range_from_energy,
    _slider_range_value,
)


def _parse_uploads(files, flip_tfy: bool):
    scans: dict[str, dict[str, tuple[np.ndarray, np.ndarray]]] = {}
    mappings: dict[str, dict[str, object]] = {}
    errors: list[str] = []
    for uf in files or []:
        df, err = _parse_xas_table_bytes(uf.getvalue())
        if err or df is None:
            errors.append(f"{uf.name}: 無法解析資料表")
            continue
        energy, channels, mapping, prep_err = _prepare_tey_tfy_auto(df, flip_tfy)
        if prep_err:
            errors.append(f"{uf.name}: TEY / TFY / I0 處理失敗")
            continue
        scans[uf.name] = {ch: (energy, channels[ch]) for ch in CHANNELS}
        mappings[uf.name] = mapping
    return scans, mappings, errors


def _plot_processed_stage(title: str, processed: dict, column_suffix: str, ytitle: str) -> None:
    st.subheader(title)
    for col, ch in zip(st.columns(2), CHANNELS):
        with col:
            fig = _channel_figure(f"{ch} {title}", ytitle)
            for idx, (name, channel_map) in enumerate(processed.items()):
                df = channel_map[ch]
                fig.add_trace(go.Scatter(
                    x=df["Energy_eV"],
                    y=df[f"{ch}_{column_suffix}"],
                    mode="lines",
                    name=name,
                    line=dict(color=COLORS[idx % len(COLORS)]),
                ))
            st.plotly_chart(fig, use_container_width=True)


def _add_range_box(fig: go.Figure, lo: float, hi: float, label: str, color: str) -> None:
    fig.add_vrect(
        x0=lo,
        x1=hi,
        fillcolor=color,
        opacity=0.14,
        line_width=0,
        annotation_text=label,
        annotation_position="top left",
    )


def run_xas_ui() -> None:
    with st.sidebar:
        with st.expander("XAS Preset", expanded=False):
            st.caption("保存高斯扣除、背景扣除、歸一化與擬合設定。DAT 欄位會自動解析。")

        with st.expander("1. 載入資料", expanded=True):
            step_header(1, "載入資料")
            uploaded_files = st.file_uploader(
                "上傳 XAS / XANES .DAT 檔案（可多選）",
                type=["dat", "txt", "csv", "xmu", "nor"],
                accept_multiple_files=True,
                key="xas_uploader",
            )
            st.caption("自動解析：Energy=第 1 欄，CurMD-01=TEY，CurMD-02=I0，CurMD-03=TFY；輸出 TEY/I0 與 TFY/I0。")
            flip_tfy = st.checkbox("TFY 使用 1 - TFY 翻轉", value=True, key="xas_flip_tfy")

            raw_scans, detected_mappings, parse_errors = _parse_uploads(uploaded_files, flip_tfy)
            for msg in parse_errors:
                st.warning(msg)

            if detected_mappings:
                st.dataframe(
                    pd.DataFrame([{"file": name, **mapping} for name, mapping in detected_mappings.items()]),
                    use_container_width=True,
                    hide_index=True,
                )

        if raw_scans:
            energy_min = min(float(np.min(scan["TEY"][0])) for scan in raw_scans.values())
            energy_max = max(float(np.max(scan["TEY"][0])) for scan in raw_scans.values())
        else:
            energy_min, energy_max = 440.0, 490.0
        energy_step = max((energy_max - energy_min) / 500.0, 0.01)

        with st.expander("2. 內插與多檔平均", expanded=False):
            step_header(2, "內插與多檔平均")
            st.caption("邏輯同 Raman：內插可單獨啟用；多檔平均會在共同重疊能量範圍內先內插再平均。")
            do_interpolate = st.checkbox("啟用內插化", value=False, key="xas_do_interpolate")
            do_average = st.checkbox("對所有載入檔案做平均化", value=False, key="xas_average_scans")
            interp_points = int(st.number_input("內插點數", min_value=200, max_value=30000, value=2000, step=100, key="xas_interp_points"))

        with st.expander("3. 能量校正（可選）", expanded=False):
            step_header(3, "能量校正（可選）")
            energy_correction_enabled = st.checkbox("啟用能量位移校正", value=False, key="xas_energy_correction_enabled")
            energy_offset = float(st.number_input(
                "能量位移 ΔE (eV)",
                value=0.0,
                step=float(energy_step),
                format="%.4f",
                disabled=not energy_correction_enabled,
                key="xas_energy_offset",
            ))
            st.caption("目前只做整體 Energy 軸平移；未啟用時完全跳過。")

        with st.expander("4. 扣除高斯曲線（可選）", expanded=False):
            step_header(4, "扣除高斯曲線（可選）")
            gaussian_enabled = st.checkbox("啟用高斯扣除", value=False, key="xas_gaussian_enabled")
            gaussian_channels = st.multiselect("套用通道", CHANNELS, default=CHANNELS, key="xas_gaussian_channels", disabled=not gaussian_enabled)
            gaussian_fwhm = float(st.number_input("固定 FWHM (eV)", min_value=0.000001, value=2.0, step=0.1, format="%.6f", disabled=not gaussian_enabled, key="xas_gaussian_fwhm"))
            gaussian_area = float(st.number_input("固定面積", min_value=0.0, value=1.0, step=0.1, format="%.6f", disabled=not gaussian_enabled, key="xas_gaussian_area"))
            gaussian_search = float(st.number_input("中心搜尋半寬 (eV)", min_value=0.0, value=2.0, step=0.1, format="%.6f", disabled=not gaussian_enabled, key="xas_gaussian_search"))

        bg_default = _range_from_energy(energy_min, energy_max, 0.02, 0.18)
        edge_default = _range_from_energy(energy_min, energy_max, 0.35, 0.65)
        norm_default = _range_from_energy(energy_min, energy_max, 0.78, 0.98)
        white_default = _range_from_energy(energy_min, energy_max, 0.35, 0.75)

        with st.expander("5. 背景扣除", expanded=False):
            step_header(5, "背景扣除")
            bg_enabled = st.checkbox("啟用背景扣除", value=True, key="xas_bg_enabled")
            bg_method = st.selectbox(
                "背景方法",
                ["linear", "polynomial", "asls", "airpls"],
                format_func=lambda v: {
                    "linear": "線性背景",
                    "polynomial": "多項式背景",
                    "asls": "AsLS",
                    "airpls": "airPLS",
                }[v],
                key="xas_bg_method",
                disabled=not bg_enabled,
            )
            bg_range = st.slider(
                "背景計算區間 (eV)",
                float(energy_min),
                float(energy_max),
                _slider_range_value("xas2_bg_range", bg_default, energy_min, energy_max),
                float(energy_step),
                key="xas2_bg_range",
                disabled=not bg_enabled,
            )
            bg_order = int(st.number_input("多項式階數", min_value=0, max_value=5, value=1, key="xas_bg_order", disabled=not (bg_enabled and bg_method == "polynomial")))
            show_bg_baseline = st.checkbox("疊加顯示背景基準線", value=True, key="xas_show_bg_baseline", disabled=not bg_enabled)

        with st.expander("6. 歸一化", expanded=False):
            step_header(6, "歸一化")
            norm_method = st.selectbox(
                "歸一化方式",
                ["none", "post_edge", "min_max", "max", "area", "mean_region"],
                format_func=lambda v: {
                    "none": "不歸一化",
                    "post_edge": "XANES post-edge 歸一化",
                    "min_max": "Min-Max 歸一化",
                    "max": "峰值歸一化（可選區間）",
                    "area": "面積歸一化（總面積 = 1）",
                    "mean_region": "算術平均歸一化（選區間）",
                }[v],
                key="xas_norm_method",
            )
            e0_mode = st.radio("E0 判定", ["derivative", "manual"], format_func=lambda v: {"derivative": "自動最大導數", "manual": "手動輸入"}[v], key="xas_e0_mode", disabled=norm_method != "post_edge")
            manual_e0 = float(st.number_input("手動 E0 (eV)", value=float(np.mean(edge_default)), step=float(energy_step), format="%.3f", disabled=not (norm_method == "post_edge" and e0_mode == "manual"), key="xas2_manual_e0"))
            edge_search = st.slider("E0 搜尋範圍 (eV)", float(energy_min), float(energy_max), _slider_range_value("xas2_edge_search_range", edge_default, energy_min, energy_max), float(energy_step), key="xas2_edge_search_range", disabled=norm_method != "post_edge")
            norm_range = st.slider("歸一化參考區間 (eV)", float(energy_min), float(energy_max), _slider_range_value("xas2_norm_range", norm_default, energy_min, energy_max), float(energy_step), key="xas2_norm_range", disabled=norm_method in ("none", "min_max", "area"))
            norm_order = int(st.number_input("Post-edge 多項式階數", min_value=0, max_value=3, value=1, key="xas_norm_order", disabled=norm_method != "post_edge"))
            show_norm_region = st.checkbox("疊加顯示歸一化區間", value=True, key="xas_show_norm_region", disabled=norm_method == "none")

        with st.expander("7. 擬合與輸出", expanded=False):
            step_header(7, "擬合與輸出")
            white_range = st.slider("White line 搜尋範圍 (eV)", float(energy_min), float(energy_max), _slider_range_value("xas2_white_range", white_default, energy_min, energy_max), float(energy_step), key="xas2_white_range")
            fit_enabled = st.checkbox("啟用初步 Gaussian 擬合", value=False, key="xas_fit_enabled")
            fit_channels = st.multiselect("擬合通道", CHANNELS, default=CHANNELS, disabled=not fit_enabled, key="xas_fit_channels")
            fit_range = st.slider("擬合範圍 (eV)", float(energy_min), float(energy_max), _slider_range_value("xas2_fit_range", white_default, energy_min, energy_max), float(energy_step), disabled=not fit_enabled, key="xas2_fit_range")
            fit_components = int(st.number_input("Gaussian component 數", min_value=1, max_value=5, value=1, disabled=not fit_enabled, key="xas_fit_components"))

    if not uploaded_files:
        st.info("請上傳 XAS .DAT 檔案。程式會自動解析 TEY / I0 / TFY，不需要選資料欄位模式。")
        return
    if not raw_scans:
        st.error("沒有可解析的 XAS TEY/TFY 資料。")
        return

    corrected_scans = {}
    for name, channel_map in raw_scans.items():
        corrected_scans[name] = {
            ch: (energy + (energy_offset if energy_correction_enabled else 0.0), signal)
            for ch, (energy, signal) in channel_map.items()
        }

    overlap_min = max(float(np.min(scan["TEY"][0])) for scan in corrected_scans.values())
    overlap_max = min(float(np.max(scan["TEY"][0])) for scan in corrected_scans.values())
    if overlap_min >= overlap_max:
        overlap_min = min(float(np.min(scan["TEY"][0])) for scan in corrected_scans.values())
        overlap_max = max(float(np.max(scan["TEY"][0])) for scan in corrected_scans.values())

    scans = corrected_scans
    if do_interpolate or do_average:
        if do_average and len(corrected_scans) > 1:
            grid = np.linspace(overlap_min, overlap_max, interp_points)
            scans = {"Average": {
                ch: (grid, np.nanmean(np.vstack([
                    interpolate_spectrum_to_grid(energy, signal, grid)
                    for scan in corrected_scans.values()
                    for energy, signal in [scan[ch]]
                ]), axis=0))
                for ch in CHANNELS
            }}
            st.info(f"多檔平均只在共同重疊能量區間 {overlap_min:.3f} - {overlap_max:.3f} eV 內進行。")
        else:
            scans = {}
            for name, channel_map in corrected_scans.items():
                scans[name] = {}
                for ch, (energy, signal) in channel_map.items():
                    grid = np.linspace(float(np.min(energy)), float(np.max(energy)), interp_points)
                    scans[name][ch] = (grid, interpolate_spectrum_to_grid(energy, signal, grid))

    default_center = float((overlap_min + overlap_max) / 2.0)
    with st.sidebar:
        if gaussian_enabled:
            seed = st.session_state.get("xas_gaussian_centers_value")
            center_df = _normalize_gaussian_center_df(pd.DataFrame(seed) if seed else None, default_center)
            center_df = st.data_editor(center_df, num_rows="dynamic", use_container_width=True, key="xas_gaussian_center_editor")
            center_df = _normalize_gaussian_center_df(center_df, default_center)
            st.session_state["xas_gaussian_centers_value"] = center_df.to_dict(orient="records")
        else:
            center_df = _empty_gaussian_center_df(default_center)

    processed: dict[str, dict[str, pd.DataFrame]] = {}
    summary_rows: list[dict] = []
    gaussian_rows: list[pd.DataFrame] = []
    fit_rows: list[pd.DataFrame] = []

    for scan_name, channel_map in scans.items():
        processed[scan_name] = {}
        for ch in CHANNELS:
            energy, raw_signal = channel_map[ch]
            gaussian_model = np.zeros_like(raw_signal, dtype=float)
            signal_after_gaussian = raw_signal.copy()

            if gaussian_enabled and ch in gaussian_channels:
                gaussian_model, signal_after_gaussian, rows = fit_fixed_gaussian_templates(
                    energy, raw_signal, _gaussian_center_records(center_df), gaussian_fwhm, gaussian_area, gaussian_search,
                )
                if rows:
                    gdf = pd.DataFrame(rows)
                    gdf.insert(0, "Channel", ch)
                    gdf.insert(0, "Dataset", scan_name)
                    gaussian_rows.append(gdf)

            if bg_enabled:
                signal_bg_sub, bg_curve = apply_background(
                    energy,
                    signal_after_gaussian,
                    bg_method,
                    bg_range[0],
                    bg_range[1],
                    poly_deg=bg_order,
                )
            else:
                signal_bg_sub = signal_after_gaussian.copy()
                bg_curve = np.zeros_like(signal_after_gaussian)

            e0 = manual_e0 if e0_mode == "manual" else _derivative_edge_energy(energy, signal_bg_sub, edge_search)
            if e0 is None:
                e0 = float(np.median(energy))

            if norm_method == "post_edge":
                post_norm, post_curve, edge_step, norm_err = _normalize_by_post_edge(
                    energy, signal_bg_sub, float(e0), norm_range, norm_order,
                )
                signal_norm = post_norm
                norm_curve = post_curve
                if norm_err:
                    st.warning(f"{scan_name} / {ch}: {norm_err}")
            else:
                signal_norm = apply_normalization(
                    energy,
                    signal_bg_sub,
                    norm_method=norm_method,
                    norm_x_start=norm_range[0],
                    norm_x_end=norm_range[1],
                )
                norm_curve = np.full_like(signal_bg_sub, np.nan, dtype=float)
                edge_step = np.nan

            wlo, whi = sorted(white_range)
            wmask = (energy >= wlo) & (energy <= whi)
            if np.count_nonzero(wmask) > 0 and np.any(np.isfinite(signal_norm[wmask])):
                local = np.where(wmask)[0]
                best_idx = int(local[np.nanargmax(signal_norm[wmask])])
                white_e = float(energy[best_idx])
                white_i = float(signal_norm[best_idx])
            else:
                white_e = np.nan
                white_i = np.nan

            fit_curve = np.full_like(energy, np.nan, dtype=float)
            if fit_enabled and ch in fit_channels:
                fit_curve, fit_df, fit_err = _fit_xanes_gaussians(energy, signal_norm, fit_range, fit_components)
                if fit_err:
                    st.warning(f"{scan_name} / {ch}: {fit_err}")
                elif not fit_df.empty:
                    fit_df.insert(0, "Channel", ch)
                    fit_df.insert(0, "Dataset", scan_name)
                    fit_rows.append(fit_df)

            processed[scan_name][ch] = pd.DataFrame({
                "Energy_eV": energy,
                f"{ch}_raw": raw_signal,
                f"{ch}_gaussian_model": gaussian_model,
                f"{ch}_after_gaussian": signal_after_gaussian,
                f"{ch}_background": bg_curve,
                f"{ch}_bg_subtracted": signal_bg_sub,
                f"{ch}_post_edge_curve": norm_curve,
                f"{ch}_normalized": signal_norm,
                f"{ch}_fit_curve": fit_curve,
            })
            summary_rows.append({
                "Dataset": scan_name,
                "Channel": ch,
                "E0_eV": round(float(e0), 4),
                "Edge_Step": round(float(edge_step), 6) if np.isfinite(edge_step) else np.nan,
                "White_Line_Energy_eV": round(white_e, 4) if np.isfinite(white_e) else np.nan,
                "White_Line_Intensity_norm": round(white_i, 6) if np.isfinite(white_i) else np.nan,
            })

    st.subheader("原始 TEY / TFY")
    for col, ch in zip(st.columns(2), CHANNELS):
        with col:
            fig = _channel_figure(f"{ch} 原始資料", ch)
            for idx, (name, channel_map) in enumerate(corrected_scans.items()):
                energy, signal = channel_map[ch]
                fig.add_trace(go.Scatter(x=energy, y=signal, mode="lines", name=name, line=dict(color=COLORS[idx % len(COLORS)])))
            st.plotly_chart(fig, use_container_width=True)

    if gaussian_enabled:
        st.subheader("高斯扣除對照")
        for col, ch in zip(st.columns(2), CHANNELS):
            with col:
                fig = _channel_figure(f"{ch} 原始 / 高斯 / 扣除後", ch)
                for idx, (name, channel_map) in enumerate(processed.items()):
                    df = channel_map[ch]
                    color = COLORS[idx % len(COLORS)]
                    fig.add_trace(go.Scatter(x=df["Energy_eV"], y=df[f"{ch}_raw"], mode="lines", name=f"{name} raw", line=dict(color=color)))
                    fig.add_trace(go.Scatter(x=df["Energy_eV"], y=df[f"{ch}_gaussian_model"], mode="lines", name=f"{name} Gaussian", line=dict(color=color, dash="dot")))
                    fig.add_trace(go.Scatter(x=df["Energy_eV"], y=df[f"{ch}_after_gaussian"], mode="lines", name=f"{name} after", line=dict(color=color, dash="dash")))
                st.plotly_chart(fig, use_container_width=True)

    st.subheader("背景扣除")
    for col, ch in zip(st.columns(2), CHANNELS):
        with col:
            fig = _channel_figure(f"{ch} 背景扣除", ch)
            _add_range_box(fig, bg_range[0], bg_range[1], "背景區間", "#FECB52")
            for idx, (name, channel_map) in enumerate(processed.items()):
                df = channel_map[ch]
                color = COLORS[idx % len(COLORS)]
                fig.add_trace(go.Scatter(x=df["Energy_eV"], y=df[f"{ch}_after_gaussian"], mode="lines", name=f"{name} input", line=dict(color=color)))
                if bg_enabled and show_bg_baseline:
                    fig.add_trace(go.Scatter(x=df["Energy_eV"], y=df[f"{ch}_background"], mode="lines", name=f"{name} 背景", line=dict(color=color, dash="dot")))
                fig.add_trace(go.Scatter(x=df["Energy_eV"], y=df[f"{ch}_bg_subtracted"], mode="lines", name=f"{name} 扣背景後", line=dict(color=color, dash="dash")))
            st.plotly_chart(fig, use_container_width=True)

    st.subheader("歸一化結果")
    for col, ch in zip(st.columns(2), CHANNELS):
        with col:
            fig = _channel_figure(f"{ch} 歸一化", f"{ch} normalized")
            if show_norm_region and norm_method not in ("none", "min_max", "area"):
                _add_range_box(fig, norm_range[0], norm_range[1], "歸一化區間", "#00CC96")
            for idx, (name, channel_map) in enumerate(processed.items()):
                df = channel_map[ch]
                color = COLORS[idx % len(COLORS)]
                fig.add_trace(go.Scatter(x=df["Energy_eV"], y=df[f"{ch}_normalized"], mode="lines", name=name, line=dict(color=color)))
                if fit_enabled and ch in fit_channels and df[f"{ch}_fit_curve"].notna().any():
                    fig.add_trace(go.Scatter(x=df["Energy_eV"], y=df[f"{ch}_fit_curve"], mode="lines", name=f"{name} fit", line=dict(color=color, dash="dot")))
            st.plotly_chart(fig, use_container_width=True)

    with st.expander("處理前後比較", expanded=False):
        compare_dataset = st.selectbox("資料", list(processed.keys()), key="xas2_compare_dataset")
        compare_channel = st.radio("通道", CHANNELS, horizontal=True, key="xas2_compare_channel")
        cdf = processed[compare_dataset][compare_channel]
        options = [
            f"{compare_channel}_raw",
            f"{compare_channel}_gaussian_model",
            f"{compare_channel}_after_gaussian",
            f"{compare_channel}_background",
            f"{compare_channel}_bg_subtracted",
            f"{compare_channel}_normalized",
        ]
        compare_cols = st.multiselect("顯示曲線", options, default=[options[0], options[4], options[5]], key="xas2_compare_columns")
        fig_compare = _channel_figure(f"{compare_dataset} / {compare_channel}", "Intensity")
        for col_name in compare_cols:
            fig_compare.add_trace(go.Scatter(x=cdf["Energy_eV"], y=cdf[col_name], mode="lines", name=col_name.replace(f"{compare_channel}_", "")))
        st.plotly_chart(fig_compare, use_container_width=True)

    summary_df = pd.DataFrame(summary_rows)
    st.subheader("XANES 摘要")
    st.dataframe(summary_df, use_container_width=True, hide_index=True)

    gaussian_df = pd.concat(gaussian_rows, ignore_index=True) if gaussian_rows else pd.DataFrame()
    if gaussian_enabled and not gaussian_df.empty:
        st.subheader("高斯扣除結果")
        st.dataframe(gaussian_df.round(6), use_container_width=True, hide_index=True)

    fit_df_all = pd.concat(fit_rows, ignore_index=True) if fit_rows else pd.DataFrame()
    if fit_enabled and not fit_df_all.empty:
        st.subheader("Gaussian 擬合結果")
        st.dataframe(fit_df_all.round(6), use_container_width=True, hide_index=True)

    st.divider()
    st.subheader("匯出")
    c1, c2 = st.columns(2)
    with c1:
        _download_card("XANES 摘要 CSV", "E0、edge step 與 white line 摘要。", "xas_xanes_summary", "csv", summary_df.to_csv(index=False).encode("utf-8"), "text/csv", "xas2_summary")
    with c2:
        report = {
            "report_type": "xas_processing_report",
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "columns": {"auto_mapping": detected_mappings, "flip_tfy": flip_tfy},
            "interpolation": {"enabled": do_interpolate, "points": interp_points},
            "average": {"enabled": do_average},
            "energy_correction": {"enabled": energy_correction_enabled, "offset_eV": energy_offset},
            "gaussian_subtraction": {"enabled": gaussian_enabled, "channels": gaussian_channels, "fixed_fwhm_eV": gaussian_fwhm, "fixed_area": gaussian_area, "search_half_width_eV": gaussian_search},
            "background": {"enabled": bg_enabled, "method": bg_method, "range_eV": list(bg_range), "order": bg_order},
            "normalization": {"method": norm_method, "e0_mode": e0_mode, "edge_search_range_eV": list(edge_search), "reference_range_eV": list(norm_range), "post_edge_order": norm_order},
            "summary": summary_df.to_dict(orient="records"),
        }
        _download_card("Processing Report JSON", "保存本次 XAS 處理設定與摘要。", "xas_processing_report", "json", json.dumps(report, ensure_ascii=False, indent=2).encode("utf-8"), "application/json", "xas2_report")

    for scan_name, channel_map in processed.items():
        merged = None
        for ch in CHANNELS:
            merged = channel_map[ch].copy() if merged is None else pd.merge(merged, channel_map[ch], on="Energy_eV", how="outer")
        if merged is not None:
            base = scan_name.rsplit(".", 1)[0]
            _download_card(f"處理後 TEY/TFY：{scan_name}", "包含 raw、Gaussian model、扣高斯後、背景、背景扣除後、normalized 與 fit curve。", f"{base}_xas_tey_tfy_processed", "csv", merged.to_csv(index=False).encode("utf-8"), "text/csv", f"xas2_processed_{base}")
