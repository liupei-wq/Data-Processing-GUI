"""Standalone Gaussian subtraction tool for simple two-column spectra."""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from core.parsers import parse_two_column_spectrum_bytes, parse_xps_bytes
from core.spectrum_ops import fit_fixed_gaussian_templates, interpolate_spectrum_to_grid


COLORS = ["#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
          "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52"]


def _load_spectrum(uploaded_file):
    raw = uploaded_file.read()
    x, y, err = parse_two_column_spectrum_bytes(raw)
    if x is not None and y is not None:
        return x, y, None
    x, y, xps_err = parse_xps_bytes(raw)
    if x is not None and y is not None:
        return x, y, None
    return None, None, err or xps_err or "無法解析檔案"


def _empty_center_df(default_center: float) -> pd.DataFrame:
    return pd.DataFrame([{
        "啟用": True,
        "峰名稱": "Peak 1",
        "中心_X": float(default_center),
    }])


def _normalize_center_df(df: pd.DataFrame | None, default_center: float) -> pd.DataFrame:
    if df is None:
        return _empty_center_df(default_center)
    result = df.copy()
    if "啟用" not in result.columns:
        result["啟用"] = True
    if "峰名稱" not in result.columns:
        result["峰名稱"] = ""
    if "中心_X" not in result.columns:
        result["中心_X"] = default_center
    result = result[["啟用", "峰名稱", "中心_X"]].copy()
    result["啟用"] = result["啟用"].fillna(False).astype(bool)
    result["峰名稱"] = result["峰名稱"].fillna("").astype(str)
    result["中心_X"] = pd.to_numeric(result["中心_X"], errors="coerce")
    return result.reset_index(drop=True)


def _center_records(center_df: pd.DataFrame) -> list[dict]:
    rows: list[dict] = []
    for _, row in center_df.iterrows():
        rows.append({
            "enabled": bool(row.get("啟用", True)),
            "name": str(row.get("峰名稱", "")).strip(),
            "center": row.get("中心_X"),
        })
    return rows


def _build_filename(stem: str, extension: str) -> str:
    clean = (stem or "gaussian_subtraction").strip()
    if not clean.lower().endswith(f".{extension.lower()}"):
        clean = f"{clean}.{extension}"
    return clean


def _download_card(
    title: str,
    description: str,
    default_name: str,
    extension: str,
    data: bytes,
    mime: str,
    key_prefix: str,
) -> None:
    with st.container(border=True):
        st.markdown(f"**{title}**")
        st.caption(description)
        stem = st.text_input("檔名", value=default_name, key=f"{key_prefix}_name")
        st.download_button(
            "下載",
            data=data,
            file_name=_build_filename(stem, extension),
            mime=mime,
            key=f"{key_prefix}_download",
            use_container_width=True,
        )


def run_gaussian_subtraction_ui() -> None:
    with st.sidebar:
        st.markdown("### 扣除高斯")
        st.caption(
            "適合只想從一批光譜中扣掉固定形狀高斯峰的情境。"
            "演算法沿用 XRD 的固定 FWHM / 固定面積模板，只搜尋每個峰的中心位置。"
        )
        uploaded_files = st.file_uploader(
            "上傳光譜檔案（可多選）",
            type=["txt", "csv", "asc", "asc_", "xy", "dat"],
            accept_multiple_files=True,
            key="gauss_sub_uploader",
        )
        x_label = st.text_input("X 軸名稱", value="X", key="gauss_sub_x_label")

        st.divider()
        st.markdown("### 高斯模板")
        fixed_fwhm = float(st.number_input(
            "固定 FWHM（X 軸單位）",
            min_value=0.000001,
            value=0.50,
            step=0.05,
            format="%.6f",
            key="gauss_sub_fwhm",
        ))
        fixed_area = float(st.number_input(
            "固定面積",
            min_value=0.0,
            value=100.0,
            step=10.0,
            format="%.6f",
            key="gauss_sub_area",
        ))
        search_half_width = float(st.number_input(
            "中心搜尋半寬（X 軸單位）",
            min_value=0.0,
            value=0.50,
            step=0.05,
            format="%.6f",
            key="gauss_sub_search_half_width",
        ))
        use_interpolation = st.checkbox(
            "先內插到等距 X 軸",
            value=True,
            key="gauss_sub_use_interpolation",
        )
        interp_points = int(st.number_input(
            "內插點數",
            min_value=100,
            max_value=20000,
            value=2000,
            step=100,
            disabled=not use_interpolation,
            key="gauss_sub_interp_points",
        ))

    if not uploaded_files:
        st.info("請在左側上傳一個或多個兩欄光譜檔案。支援 Raman / XRD / XES 常見兩欄文字檔，也會嘗試解析 XPS 文字格式。")
        return

    data_dict: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for uf in uploaded_files:
        x, y, err = _load_spectrum(uf)
        if err:
            st.warning(f"{uf.name}：{err}")
            continue
        data_dict[uf.name] = (np.asarray(x, dtype=float), np.asarray(y, dtype=float))

    if not data_dict:
        st.error("沒有成功載入的資料。")
        return

    all_x = np.concatenate([x for x, _ in data_dict.values()])
    x_min = float(np.nanmin(all_x))
    x_max = float(np.nanmax(all_x))
    default_center = float((x_min + x_max) / 2.0)

    with st.sidebar:
        st.markdown("### 扣除峰列表")
        seed_df = st.session_state.get("gauss_sub_centers_value")
        center_df = _normalize_center_df(pd.DataFrame(seed_df) if seed_df else None, default_center)
        center_df = st.data_editor(
            center_df,
            num_rows="dynamic",
            use_container_width=True,
            key="gauss_sub_centers_editor",
            column_config={
                "中心_X": st.column_config.NumberColumn(
                    f"中心 ({x_label})",
                    step=0.01,
                    format="%.6f",
                )
            },
        )
        center_df = _normalize_center_df(center_df, default_center)
        st.session_state["gauss_sub_centers_value"] = center_df.to_dict(orient="records")

    fig = go.Figure()
    fit_tables: list[pd.DataFrame] = []
    export_frames: dict[str, pd.DataFrame] = {}

    for idx, (name, (x_raw, y_raw)) in enumerate(data_dict.items()):
        finite = np.isfinite(x_raw) & np.isfinite(y_raw)
        x_raw = x_raw[finite]
        y_raw = y_raw[finite]
        if len(x_raw) < 2:
            st.warning(f"{name}：有效資料點不足，已略過。")
            continue

        order = np.argsort(x_raw)
        x_raw = x_raw[order]
        y_raw = y_raw[order]
        if use_interpolation:
            x = np.linspace(float(np.min(x_raw)), float(np.max(x_raw)), interp_points)
            y = interpolate_spectrum_to_grid(x_raw, y_raw, x)
        else:
            x, y = x_raw, y_raw

        model, subtracted, rows = fit_fixed_gaussian_templates(
            x,
            y,
            _center_records(center_df),
            fixed_fwhm,
            fixed_area,
            search_half_width,
        )
        if rows:
            fit_df = pd.DataFrame(rows)
            fit_df.insert(0, "Dataset", name)
            fit_tables.append(fit_df)

        color = COLORS[idx % len(COLORS)]
        fig.add_trace(go.Scatter(
            x=x, y=y, mode="lines", name=f"{name}（原始）",
            line=dict(color=color, width=1.3, dash="dash"), opacity=0.45,
        ))
        fig.add_trace(go.Scatter(
            x=x, y=model, mode="lines", name=f"{name}（高斯模板）",
            line=dict(color=color, width=1.1, dash="dot"), opacity=0.65,
        ))
        fig.add_trace(go.Scatter(
            x=x, y=subtracted, mode="lines", name=f"{name}（扣高斯後）",
            line=dict(color=color, width=2),
        ))

        export_frames[name] = pd.DataFrame({
            x_label: x,
            "Intensity_raw": y,
            "Gaussian_model": model,
            "Intensity_gaussian_subtracted": subtracted,
        })

    fig.update_layout(
        xaxis_title=x_label,
        yaxis_title="Intensity",
        template="plotly_dark",
        height=520,
        margin=dict(l=50, r=20, t=45, b=50),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    st.plotly_chart(fig, use_container_width=True)

    fit_export_df = pd.concat(fit_tables, ignore_index=True) if fit_tables else pd.DataFrame()
    if not fit_export_df.empty:
        st.subheader("高斯中心結果")
        display_df = fit_export_df.rename(columns={
            "Seed_Center": f"Seed_Center_{x_label}",
            "Fitted_Center": f"Fitted_Center_{x_label}",
            "Shift": f"Shift_{x_label}",
            "Fixed_FWHM": f"Fixed_FWHM_{x_label}",
        })
        st.dataframe(display_df.round(6), use_container_width=True, hide_index=True)

    if export_frames or not fit_export_df.empty:
        st.divider()
        st.subheader("匯出")
        if not fit_export_df.empty:
            _download_card(
                "高斯中心結果 CSV",
                "記錄每個峰的初始中心、搜尋後中心、位移、固定 FWHM、固定面積與模板高度。",
                "gaussian_subtraction_centers",
                "csv",
                fit_export_df.to_csv(index=False).encode("utf-8"),
                "text/csv",
                "gauss_sub_centers_csv",
            )
        for start in range(0, len(export_frames), 2):
            row_items = list(export_frames.items())[start:start + 2]
            cols = st.columns(len(row_items))
            for col, (fname, df) in zip(cols, row_items):
                base = fname.rsplit(".", 1)[0]
                with col:
                    _download_card(
                        f"處理後光譜：{fname}",
                        "包含原始訊號、高斯模板與扣除高斯後訊號。",
                        f"{base}_gaussian_subtracted",
                        "csv",
                        df.to_csv(index=False).encode("utf-8"),
                        "text/csv",
                        f"gauss_sub_processed_{start}_{base}",
                    )
