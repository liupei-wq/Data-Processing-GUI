"""XPS-specific constants, figure helpers, and Streamlit UI."""

from __future__ import annotations

import json
import re
from datetime import datetime

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from scipy.interpolate import interp1d
from scipy.signal import find_peaks

from core.parsers import parse_xps_bytes
from core.ui_helpers import (
    _next_btn,
    auto_scroll_on_change,
    auto_scroll_on_appear,
    hex_to_rgba,
    scroll_anchor,
    step_exp_label,
    step_header,
    step_header_with_skip,
)
from core.peak_fitting import fit_peaks
from core.processing import apply_processing
from db.xps_database import (
    CATEGORY_COLORS,
    DOUBLET_INFO,
    ELEMENT_RSF,
    ELEMENTS,
    FITTABLE_ELEMENTS,
    get_orbital_rsf,
)


CALIB_STANDARDS = {
    "Au 4f7/2": 84.0,
    "Ag 3d5/2": 368.3,
    "Cu 2p3/2": 932.7,
    "Cu 3s": 122.5,
    "C 1s（污染碳 adventitious）": 284.8,
    "Fermi edge": 0.0,
    "自訂": None,
}


COLORS = [
    "#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
    "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52",
]


def _clear_xps_fit_state() -> None:
    for key in (
        "fit_result",
        "fit_x_used",
        "fit_y_used",
        "fit_offset_used",
        "fit_target_used",
        "xps_fit_signature",
    ):
        st.session_state.pop(key, None)


def _signature_value(value):
    if isinstance(value, np.generic):
        return _signature_value(value.item())
    if isinstance(value, float):
        return round(value, 8)
    if isinstance(value, dict):
        return tuple((str(k), _signature_value(v)) for k, v in sorted(value.items()))
    if isinstance(value, (list, tuple)):
        return tuple(_signature_value(v) for v in value)
    return value


def _build_xps_fit_signature(
    *,
    fit_target_name: str | None,
    selected_elem: str,
    fit_profile: str,
    offset: float,
    e_range: tuple[float, float],
    bg_method: str,
    bg_range: tuple[float, float],
    tougaard_B: float,
    tougaard_C: float,
    norm_method: str,
    norm_range: tuple[float, float],
    init_peaks_selected: list[dict],
    manual_centers: list,
    manual_fwhms: list,
    doublet_pairs: list[dict],
) -> tuple:
    peak_signature = [
        {
            "label": pk.get("label"),
            "be": pk.get("be"),
            "fwhm": pk.get("fwhm"),
        }
        for pk in init_peaks_selected
    ]
    return (
        fit_target_name,
        selected_elem,
        fit_profile,
        _signature_value(offset),
        _signature_value(e_range),
        bg_method,
        _signature_value(bg_range),
        _signature_value(tougaard_B),
        _signature_value(tougaard_C),
        norm_method,
        _signature_value(norm_range),
        _signature_value(peak_signature),
        _signature_value(manual_centers),
        _signature_value(manual_fwhms),
        _signature_value(doublet_pairs),
    )


_ORBITAL_FAMILY_RE = re.compile(r"(\d+[spdfgh])(?:\d+/\d+)?", re.IGNORECASE)


def _extract_xps_orbital_family(label: str) -> str | None:
    match = _ORBITAL_FAMILY_RE.search(str(label))
    return None if match is None else match.group(1)


def _is_xps_satellite_label(label: str) -> bool:
    text = str(label).lower()
    return any(token in text for token in ("sat", "satellite", "shake", "loss"))


def _dominant_xps_orbital_family(result_peaks: list[dict], elem_label: str) -> str | None:
    if elem_label in DOUBLET_INFO:
        return _extract_xps_orbital_family(DOUBLET_INFO[elem_label]["major_sub"])
    counts: dict[str, int] = {}
    first_seen: dict[str, int] = {}
    for idx, pk in enumerate(result_peaks):
        label = pk.get("label", "")
        if _is_xps_satellite_label(label):
            continue
        family = _extract_xps_orbital_family(label)
        if family is None:
            continue
        counts[family] = counts.get(family, 0) + 1
        first_seen.setdefault(family, idx)
    if not counts:
        return None
    return sorted(counts, key=lambda fam: (-counts[fam], first_seen[fam]))[0]


def _build_xps_quant_review_df(
    result_peaks: list[dict],
    elem_label: str,
    fit_target_used: str,
    fit_offset_used: float,
) -> pd.DataFrame:
    dominant_family = _dominant_xps_orbital_family(result_peaks, elem_label)
    major_sub = DOUBLET_INFO.get(elem_label, {}).get("major_sub")
    minor_sub = DOUBLET_INFO.get(elem_label, {}).get("minor_sub")

    rows = []
    for pk in result_peaks:
        label = str(pk.get("label", ""))
        family = _extract_xps_orbital_family(label)
        is_satellite = _is_xps_satellite_label(label)
        is_major = bool(major_sub and major_sub in label)
        is_minor = bool(minor_sub and minor_sub in label)

        rsf_val, rsf_src = get_orbital_rsf(elem_label, label)

        if is_satellite:
            include = False
            suggestion = "衛星峰，預設不納入定量"
        elif is_major:
            include = True
            suggestion = "主線，建議納入定量"
        elif is_minor:
            include = False
            suggestion = "自旋軌道次峰，預設不納入定量"
        elif dominant_family and family == dominant_family:
            include = True
            suggestion = "主要軌域，建議納入定量"
        elif dominant_family and family is not None:
            include = False
            suggestion = "非主要軌域，預設不納入定量"
        else:
            include = True
            suggestion = "無法自動判斷，暫時納入"

        rows.append({
            "納入定量": include,
            "資料集": fit_target_used,
            "元素": elem_label,
            "峰": label,
            "軌域族": family or "未辨識",
            "中心 (eV)": round(float(pk.get("center", 0.0)) + fit_offset_used, 3),
            "面積": float(pk.get("area", 0.0)),
            "RSF": rsf_val,
            "RSF來源": rsf_src,
            "定量建議": suggestion,
        })

    return pd.DataFrame(rows)


def _build_xps_quant_tables(records: list[dict]) -> tuple[pd.DataFrame, pd.DataFrame]:
    history_df = pd.DataFrame(records)
    if history_df.empty:
        return history_df, pd.DataFrame()

    history_df = history_df.copy()
    for col, default in {
        "資料集": "未記錄",
        "元素": "Unknown",
        "峰": "未命名峰",
        "軌域族": "未辨識",
        "定量建議": "",
    }.items():
        if col not in history_df.columns:
            history_df[col] = default
    history_df["RSF校正面積"] = history_df.apply(
        lambda r: r["面積"] / r["RSF"] if pd.notna(r["RSF"]) and r["RSF"] > 0 else np.nan,
        axis=1,
    )
    dataset_totals = history_df.groupby("資料集")["RSF校正面積"].sum(min_count=1)
    history_df["原子濃度 at.%"] = history_df.apply(
        lambda r: round(r["RSF校正面積"] / dataset_totals.get(r["資料集"], np.nan) * 100, 2)
        if pd.notna(r["RSF校正面積"]) and pd.notna(dataset_totals.get(r["資料集"], np.nan))
        and dataset_totals.get(r["資料集"], 0) > 0
        else np.nan,
        axis=1,
    )

    summary_df = (
        history_df.groupby(["資料集", "元素"], as_index=False)
        .agg(
            納入峰數=("峰", "count"),
            原始面積總和=("面積", "sum"),
            RSF校正面積=("RSF校正面積", "sum"),
        )
    )
    summary_df["原子濃度 at.%"] = summary_df.apply(
        lambda r: round(r["RSF校正面積"] / dataset_totals.get(r["資料集"], np.nan) * 100, 2)
        if pd.notna(r["RSF校正面積"]) and pd.notna(dataset_totals.get(r["資料集"], np.nan))
        and dataset_totals.get(r["資料集"], 0) > 0
        else np.nan,
        axis=1,
    )
    return history_df, summary_df


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
    if isinstance(value, pd.DataFrame):
        return [_json_safe(row) for row in value.to_dict("records")]
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
    safe_df = df.copy()
    safe_df = safe_df.replace({np.nan: None})
    return [_json_safe(row) for row in safe_df.to_dict("records")]


@st.cache_data
def build_periodic_table(selected_elem: str | None = None) -> go.Figure:
    symbols, rows, cols, cats = [], [], [], []
    hover_templates = []

    for sym, data in ELEMENTS.items():
        symbols.append(sym)
        rows.append(data["row"])
        cols.append(data["col"])
        cats.append(data["cat"])

        peaks = data.get("peaks", [])
        cat_label = {
            "alkali": "鹼金屬", "alkaline": "鹼土金屬", "transition": "過渡金屬",
            "post_trans": "後過渡金屬", "metalloid": "類金屬", "nonmetal": "非金屬",
            "halogen": "鹵素", "noble_gas": "惰性氣體", "lanthanide": "鑭系",
            "actinide": "錒系",
        }.get(data["cat"], data["cat"])

        pk_html = "".join(
            f"&nbsp;&nbsp;<b>{p['label']}</b>: {p['be']:.1f} eV &nbsp;(FWHM {p['fwhm']:.2f})<br>"
            for p in peaks
        ) or "&nbsp;&nbsp;<i>無峰位資料庫</i><br>"

        hover_templates.append(
            f"<b style='font-size:13px'>{sym}</b> &nbsp;{data['name']}&nbsp; Z={data['Z']}<br>"
            f"<span style='color:#aaa'>{cat_label}</span><br>"
            f"─────────────────<br>"
            f"<b>XPS 峰位：</b><br>"
            f"{pk_html}"
            f"<extra></extra>"
        )

    base_colors = [CATEGORY_COLORS.get(c, "#445566") for c in cats]
    marker_colors, line_colors, line_widths, font_colors = [], [], [], []
    for sym, bc in zip(symbols, base_colors):
        if sym == selected_elem:
            marker_colors.append("#2a4a7a")
            line_colors.append("#ffdd00")
            line_widths.append(3.0)
            font_colors.append("#ffdd00")
        elif sym in FITTABLE_ELEMENTS:
            marker_colors.append(bc)
            line_colors.append("#99bbdd")
            line_widths.append(0.8)
            font_colors.append("white")
        else:
            marker_colors.append(bc)
            line_colors.append("#334455")
            line_widths.append(0.3)
            font_colors.append("#cccccc")

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=cols,
        y=[-r for r in rows],
        mode="markers+text",
        text=symbols,
        textposition="middle center",
        textfont=dict(size=11, color=font_colors),
        marker=dict(
            symbol="square",
            size=40,
            color=marker_colors,
            line=dict(color=line_colors, width=line_widths),
        ),
        customdata=[[s] for s in symbols],
        hovertemplate=hover_templates,
        name="",
        hoverlabel=dict(
            bgcolor="#1a2030",
            bordercolor="#3d8ef0",
            font=dict(size=12, color="white"),
        ),
    ))
    fig.update_layout(
        showlegend=False,
        xaxis=dict(visible=False, range=[0.3, 18.7]),
        yaxis=dict(visible=False, range=[-10.1, -0.1]),
        height=520,
        margin=dict(l=0, r=0, t=5, b=0),
        plot_bgcolor="#0e1117",
        paper_bgcolor="#0e1117",
        dragmode=False,
        clickmode="event+select",
    )
    return fig


@st.cache_data
def _parse_xps_bytes(raw: bytes):
    return parse_xps_bytes(raw)


def load_xps_file(uploaded_file):
    raw = uploaded_file.read()
    return _parse_xps_bytes(raw)


def _vbm_linear_extrapolation(
    x: np.ndarray,
    y: np.ndarray,
    edge_lo: float,
    edge_hi: float,
    baseline_lo: float,
    baseline_hi: float,
) -> tuple[float | None, float, float, float, bool]:
    """Linear extrapolation of VB leading edge to baseline level → VBM position.

    Returns (vbm_eV, slope, intercept, baseline_level, success).
    VBM = x where fitted line meets the mean baseline level.
    """
    sort_idx = np.argsort(x)
    xs, ys = x[sort_idx], y[sort_idx]
    edge_mask = (xs >= edge_lo) & (xs <= edge_hi)
    base_mask = (xs >= baseline_lo) & (xs <= baseline_hi)
    if edge_mask.sum() < 2 or base_mask.sum() < 1:
        return None, 0.0, 0.0, 0.0, False
    coeffs = np.polyfit(xs[edge_mask], ys[edge_mask], 1)
    slope, intercept = float(coeffs[0]), float(coeffs[1])
    baseline_level = float(np.mean(ys[base_mask]))
    if abs(slope) < 1e-12:
        return None, slope, intercept, baseline_level, False
    vbm = (baseline_level - intercept) / slope
    return float(vbm), slope, intercept, baseline_level, True


def _run_valence_band_ui(
    uploaded_files: list,
    data_dict: dict,
    x_min_global: float,
    x_max_global: float,
    overlap_min: float,
    overlap_max: float,
) -> None:
    """Valence Band XPS analysis mode – VBM linear extrapolation workflow."""
    span = max(x_max_global - x_min_global, 1e-6)

    # ── pre-init sidebar-derived values ──────────────────────────────────────
    offset = 0.0
    bg_method = "none"
    bg_x_start = overlap_min
    bg_x_end = overlap_max
    show_bg_baseline = False
    skip_vb_bg = st.session_state.get("vb_skip_bg", False)
    vb_bg_step_done = False
    run_vbm = False
    vbm_edge_lo = vbm_edge_hi = x_min_global
    vbm_base_lo = vbm_base_hi = x_min_global
    show_vbm_line = True

    with st.sidebar:
        # ─── Step 2: 手動能量校正 ──────────────────────────────────────────
        step_header(2, "能量校正（可選）")
        st.caption("通常以 Au 4f7/2（84.0 eV）或 C 1s 污染碳（284.8 eV）做校正後填入 ΔE。")
        offset = float(st.number_input(
            "手動位移量 ΔE (eV)",
            value=0.0, step=0.01, format="%.3f",
            key="vb_energy_offset",
        ))
        if offset != 0.0:
            st.caption(f"全部光譜將位移 {offset:+.3f} eV")

        # ─── Step 3: 背景扣除（可選） ──────────────────────────────────────
        vb_bg_confirmed = st.session_state.get("vb_bg_confirmed", False)
        _skip_vb_bg_ss = st.session_state.get("vb_skip_bg", False)
        with st.expander(
            step_exp_label(3, "背景扣除（可選）", vb_bg_confirmed or _skip_vb_bg_ss),
            expanded=not (vb_bg_confirmed or _skip_vb_bg_ss),
        ):
            st.caption(
                "VB 分析通常用線性或 Shirley 背景，目的是拉平 free-electron tail，"
                "而非 core level 定量。若訊號已夠乾淨可跳過。"
            )
            skip_vb_bg = st.checkbox("跳過此步驟 ✓", key="vb_skip_bg")
            if not skip_vb_bg:
                bg_method = st.selectbox(
                    "方法",
                    ["none", "linear", "shirley"],
                    format_func=lambda v: {
                        "none": "不扣除",
                        "linear": "線性背景",
                        "shirley": "Shirley 背景",
                    }[v],
                    key="vb_bg_method",
                )
                if bg_method != "none":
                    _prev_vbbg = st.session_state.get("vb_bg_range", (overlap_min, overlap_max))
                    _blo = float(max(x_min_global, min(float(min(_prev_vbbg)), x_max_global)))
                    _bhi = float(max(x_min_global, min(float(max(_prev_vbbg)), x_max_global)))
                    if _blo >= _bhi:
                        _blo, _bhi = overlap_min, overlap_max
                    st.session_state["vb_bg_range"] = (_blo, _bhi)
                    vb_bg_range = st.slider(
                        "背景計算區間 (eV)",
                        min_value=x_min_global, max_value=x_max_global,
                        step=0.01, format="%.2f eV",
                        key="vb_bg_range",
                    )
                    bg_x_start, bg_x_end = sorted(vb_bg_range)
                    show_bg_baseline = st.checkbox(
                        "疊加顯示背景基準線", value=True, key="vb_show_bg_baseline"
                    )
            if skip_vb_bg and not vb_bg_confirmed:
                st.session_state["vb_bg_confirmed"] = True
                vb_bg_confirmed = True
            if not skip_vb_bg and not vb_bg_confirmed:
                if _next_btn("btn_vb_bg_next", "vb_bg_confirmed"):
                    vb_bg_confirmed = True
        skip_vb_bg = st.session_state.get("vb_skip_bg", False)
        vb_bg_confirmed = st.session_state.get("vb_bg_confirmed", False)
        vb_bg_step_done = skip_vb_bg or vb_bg_confirmed
        bg_method = "none" if skip_vb_bg else st.session_state.get("vb_bg_method", "none")

        # ─── Step 4: VBM 線性外推設定 ─────────────────────────────────────
        if vb_bg_step_done:
            step_header(4, "VBM 線性外推")
            st.caption(
                "① 選 **Leading edge 擬合區**（VB 上升段）— 藍色陰影；"
                "② 選 **Baseline 區**（費米能級附近平坦無態區）— 綠色陰影。"
                "外推線與 Baseline 水平線的交點即為 VBM。"
            )

            # Leading edge range
            _edge_def_lo = float(x_min_global + span * 0.12)
            _edge_def_hi = float(x_min_global + span * 0.40)
            _prev_edge = st.session_state.get("vb_edge_range", (_edge_def_lo, _edge_def_hi))
            _el = float(max(x_min_global, min(float(min(_prev_edge)), x_max_global)))
            _eh = float(max(x_min_global, min(float(max(_prev_edge)), x_max_global)))
            if _el >= _eh:
                _el, _eh = _edge_def_lo, _edge_def_hi
            st.session_state["vb_edge_range"] = (_el, _eh)
            edge_range = st.slider(
                "Leading edge 擬合區間 (eV)",
                min_value=x_min_global, max_value=x_max_global,
                step=0.01, format="%.2f eV",
                key="vb_edge_range",
            )
            vbm_edge_lo, vbm_edge_hi = sorted(edge_range)

            # Baseline range
            _base_def_lo = x_min_global
            _base_def_hi = float(x_min_global + span * 0.10)
            _prev_base = st.session_state.get("vb_base_range", (_base_def_lo, _base_def_hi))
            _bl = float(max(x_min_global, min(float(min(_prev_base)), x_max_global)))
            _bh = float(max(x_min_global, min(float(max(_prev_base)), x_max_global)))
            if _bl >= _bh:
                _bl, _bh = _base_def_lo, _base_def_hi
            st.session_state["vb_base_range"] = (_bl, _bh)
            base_range = st.slider(
                "Baseline 區間 (eV)",
                min_value=x_min_global, max_value=x_max_global,
                step=0.01, format="%.2f eV",
                key="vb_base_range",
            )
            vbm_base_lo, vbm_base_hi = sorted(base_range)
            show_vbm_line = st.checkbox(
                "顯示外推線與 VBM 標記", value=True, key="vb_show_vbm_line"
            )
            run_vbm = True

    # ── 主區：顯示範圍 ────────────────────────────────────────────────────────
    _prev_vbd = st.session_state.get("vb_display_range", (overlap_min, overlap_max))
    _vdlo = float(max(x_min_global, min(float(min(_prev_vbd)), x_max_global)))
    _vdhi = float(max(x_min_global, min(float(max(_prev_vbd)), x_max_global)))
    if _vdlo >= _vdhi:
        _vdlo, _vdhi = overlap_min, overlap_max
    st.session_state["vb_display_range"] = (_vdlo, _vdhi)
    e_range = st.slider(
        "能量顯示範圍 — Binding Energy (eV)",
        min_value=x_min_global, max_value=x_max_global,
        step=0.01, format="%.2f eV",
        key="vb_display_range",
    )
    e_start, e_end = sorted(e_range)

    # ── 數據處理與圖表 ────────────────────────────────────────────────────────
    fig_vb = go.Figure()
    export_frames: dict[str, pd.DataFrame] = {}
    vbm_results: dict[str, tuple[float, float, float]] = {}  # name → (vbm, slope, intercept)
    baseline_level_global: float | None = None

    for i, (name, (x, y)) in enumerate(data_dict.items()):
        mask = (x >= e_start) & (x <= e_end)
        xc, yc = x[mask], y[mask]
        if len(xc) < 2:
            st.warning(f"{name}：所選範圍內數據點不足，已跳過。")
            continue
        color = COLORS[i % len(COLORS)]

        y_bg, bg = apply_processing(
            xc, yc, bg_method, "none",
            bg_x_start=bg_x_start, bg_x_end=bg_x_end,
        )
        y_plot = y_bg if bg_method != "none" else yc

        if bg_method != "none":
            fig_vb.add_trace(go.Scatter(
                x=xc + offset, y=yc, mode="lines", name=f"{name}（原始）",
                line=dict(color=color, width=1.5, dash="dash"), opacity=0.4,
            ))
            if show_bg_baseline:
                fig_vb.add_trace(go.Scatter(
                    x=xc + offset, y=bg, mode="lines", name=f"{name}（背景）",
                    line=dict(color=color, width=1, dash="longdash"), opacity=0.45,
                ))
            fig_vb.add_trace(go.Scatter(
                x=xc + offset, y=y_bg, mode="lines", name=name,
                line=dict(color=color, width=2),
            ))
        else:
            fig_vb.add_trace(go.Scatter(
                x=xc + offset, y=yc, mode="lines", name=name,
                line=dict(color=color, width=2),
            ))

        if run_vbm and show_vbm_line:
            vbm, slope, intercept, bl_level, ok = _vbm_linear_extrapolation(
                xc, y_plot, vbm_edge_lo, vbm_edge_hi, vbm_base_lo, vbm_base_hi,
            )
            if ok and vbm is not None:
                vbm_results[name] = (vbm, slope, intercept)
                baseline_level_global = bl_level
                # Extrapolation line from slightly below VBM to edge_hi
                x_ext_lo = max(float(xc.min()), vbm - 0.5 * (vbm_edge_hi - vbm_edge_lo))
                x_line = np.linspace(x_ext_lo, vbm_edge_hi, 80)
                y_line = slope * x_line + intercept
                fig_vb.add_trace(go.Scatter(
                    x=x_line + offset, y=y_line,
                    mode="lines", name=f"{name} 外推線",
                    line=dict(color=color, width=1.8, dash="dot"),
                ))
                fig_vb.add_vline(
                    x=vbm + offset, line_dash="dash", line_color=color,
                    annotation_text=f"VBM = {vbm + offset:.2f} eV",
                    annotation_position="top right",
                )

        export_frames[name] = pd.DataFrame({
            "Energy_eV": xc + offset,
            "Intensity_raw": yc,
            "Intensity_bg_subtracted": y_bg,
            **({"Background": bg} if bg_method != "none" else {}),
        })

    # Shared overlays for VBM regions and baseline
    if run_vbm:
        fig_vb.add_vrect(
            x0=vbm_edge_lo + offset, x1=vbm_edge_hi + offset,
            fillcolor="#636EFA", opacity=0.07, layer="below", line_width=0,
            annotation_text="Edge 擬合區", annotation_position="top left",
        )
        fig_vb.add_vrect(
            x0=vbm_base_lo + offset, x1=vbm_base_hi + offset,
            fillcolor="#00CC96", opacity=0.07, layer="below", line_width=0,
            annotation_text="Baseline 區", annotation_position="top right",
        )
        if show_vbm_line and baseline_level_global is not None:
            fig_vb.add_hline(
                y=baseline_level_global, line_dash="longdash",
                line_color="gray", opacity=0.6,
                annotation_text="Baseline", annotation_position="bottom left",
            )

    fig_vb.update_layout(
        xaxis_title="Binding Energy (eV)",
        yaxis_title="Intensity",
        xaxis=dict(autorange="reversed"),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        template="plotly_dark",
        height=480,
        margin=dict(l=50, r=20, t=60, b=50),
    )
    st.plotly_chart(fig_vb, use_container_width=True)

    # ── VBM 結果顯示 ──────────────────────────────────────────────────────────
    if vbm_results:
        st.divider()
        st.subheader("VBM 外推結果")
        met_cols = st.columns(max(1, len(vbm_results)))
        for col, (name, (vbm, _, __)) in zip(met_cols, vbm_results.items()):
            with col:
                st.metric(
                    label=name,
                    value=f"{vbm + offset:.3f} eV",
                    help="E_F − E_VBM：Fermi level 到 valence band maximum 的距離（eV）",
                )
        vbm_table_df = pd.DataFrame([
            {
                "資料集": name,
                "VBM (eV)": round(vbm + offset, 3),
                "Leading Edge 區間": f"{vbm_edge_lo:.2f}–{vbm_edge_hi:.2f} eV",
                "Baseline 區間": f"{vbm_base_lo:.2f}–{vbm_base_hi:.2f} eV",
            }
            for name, (vbm, _, __) in vbm_results.items()
        ])
        st.dataframe(vbm_table_df, use_container_width=True, hide_index=True)
        st.caption(
            "**VBM (eV)** = E_F − E_{VBM}：Fermi level 到價帶頂的距離。"
            "半導體通常 0.5–3 eV；金屬趨近 0 eV。"
        )
        st.caption(
            "搭配 optical bandgap E_g 推估 CBM：E_CBM − E_F ≈ E_g − VBM。"
            "嚴格 band offset 請用 Kraut method（需同時量測 core level 與接面樣品）。"
        )

    # ── Kraut Method Band Offset 計算 ────────────────────────────────────────
    st.divider()
    with st.expander("Band Offset 計算（Kraut Method）", expanded=False):
        st.caption(
            "Kraut method 需要三組 XPS 量測：\n"
            "① 純材料 A 的 VBM（由 VB XPS 外推）與一個 core level BE；\n"
            "② 純材料 B 的 VBM 與一個 core level BE；\n"
            "③ A/B 接面樣品中 A 與 B 各自的 core level BE。"
        )
        st.markdown(
            r"$$\Delta E_V = (E_{CL}^A - E_{VBM}^A)_{bulk}"
            r" - (E_{CL}^B - E_{VBM}^B)_{bulk}"
            r" - (E_{CL}^A - E_{CL}^B)_{interface}$$"
        )

        kc1, kc2 = st.columns(2)
        with kc1:
            st.markdown("**材料 A（純品量測）**")
            k_mat_a = st.text_input("材料 A 名稱", value="NiO", key="kraut_mat_a")
            k_vbm_a = st.number_input(
                "VBM_A (eV)", value=0.20, step=0.01, format="%.3f", key="kraut_vbm_a",
                help="由 VB XPS 線性外推得到的 VBM（= E_F − E_VBM，單位 eV）",
            )
            k_cl_label_a = st.text_input("Core level 標籤 A", value="Ni 2p3/2", key="kraut_cl_label_a")
            k_cl_a = st.number_input(
                "CL_A BE (eV)", value=854.50, step=0.01, format="%.3f", key="kraut_cl_a",
                help="在純 A 材料樣品中量測到的 core level binding energy",
            )
        with kc2:
            st.markdown("**材料 B（純品量測）**")
            k_mat_b = st.text_input("材料 B 名稱", value="Ga₂O₃", key="kraut_mat_b")
            k_vbm_b = st.number_input(
                "VBM_B (eV)", value=3.50, step=0.01, format="%.3f", key="kraut_vbm_b",
                help="由 VB XPS 線性外推得到的 VBM",
            )
            k_cl_label_b = st.text_input("Core level 標籤 B", value="Ga 2p3/2", key="kraut_cl_label_b")
            k_cl_b = st.number_input(
                "CL_B BE (eV)", value=1118.50, step=0.01, format="%.3f", key="kraut_cl_b",
                help="在純 B 材料樣品中量測到的 core level binding energy",
            )

        st.markdown("**接面樣品量測（A/B heterostructure）**")
        int_c1, int_c2 = st.columns(2)
        with int_c1:
            k_cl_a_int = st.number_input(
                f"{k_cl_label_a} @ interface (eV)",
                value=854.80, step=0.01, format="%.3f", key="kraut_cl_a_int",
            )
        with int_c2:
            k_cl_b_int = st.number_input(
                f"{k_cl_label_b} @ interface (eV)",
                value=1118.30, step=0.01, format="%.3f", key="kraut_cl_b_int",
            )

        st.markdown("**Bandgap（可選，用於計算 ΔEC 與繪製能帶圖）**")
        eg_c1, eg_c2 = st.columns(2)
        with eg_c1:
            k_eg_a = st.number_input(
                f"Eg ({k_mat_a}) (eV)", value=3.70, min_value=0.0,
                step=0.01, format="%.2f", key="kraut_eg_a",
                help="填 0 表示不使用",
            )
        with eg_c2:
            k_eg_b = st.number_input(
                f"Eg ({k_mat_b}) (eV)", value=4.80, min_value=0.0,
                step=0.01, format="%.2f", key="kraut_eg_b",
                help="填 0 表示不使用",
            )
        k_use_eg = k_eg_a > 0 and k_eg_b > 0

        # ── 計算 ──────────────────────────────────────────────────────────────
        delta_bulk_a = k_cl_a - k_vbm_a
        delta_bulk_b = k_cl_b - k_vbm_b
        delta_cl_int = k_cl_a_int - k_cl_b_int
        delta_ev = delta_bulk_a - delta_bulk_b - delta_cl_int
        delta_ec = (delta_ev + k_eg_a - k_eg_b) if k_use_eg else None

        st.divider()
        st.markdown("**計算結果**")
        step_cols = st.columns(3)
        step_cols[0].metric(
            "ΔCL_A (bulk)",
            f"{delta_bulk_a:.3f} eV",
            help=f"{k_cl_label_a} − VBM_A = {k_cl_a:.3f} − {k_vbm_a:.3f}",
        )
        step_cols[1].metric(
            "ΔCL_B (bulk)",
            f"{delta_bulk_b:.3f} eV",
            help=f"{k_cl_label_b} − VBM_B = {k_cl_b:.3f} − {k_vbm_b:.3f}",
        )
        step_cols[2].metric(
            "ΔCL (interface)",
            f"{delta_cl_int:.3f} eV",
            help=f"{k_cl_label_a}@int − {k_cl_label_b}@int",
        )

        res_cols = st.columns(2)
        res_cols[0].metric(
            f"ΔEV  ({k_mat_a} / {k_mat_b})",
            f"{delta_ev:.3f} eV",
            help="ΔCL_A − ΔCL_B − ΔCL_interface；正值表示 A 的 VBM 比 B 高",
        )
        if delta_ec is not None:
            res_cols[1].metric(
                f"ΔEC  ({k_mat_a} / {k_mat_b})",
                f"{delta_ec:.3f} eV",
                help=f"ΔEV + Eg_A − Eg_B = {delta_ev:.3f} + {k_eg_a:.2f} − {k_eg_b:.2f}",
            )

        if abs(delta_ev) < 0.01:
            st.info("ΔEV ≈ 0：兩材料 VBM 幾乎對齊。")
        elif delta_ev > 0:
            st.success(
                f"ΔEV = +{delta_ev:.3f} eV：{k_mat_a} 的 VBM 比 {k_mat_b} 高 {delta_ev:.3f} eV"
                f"（{k_mat_a} ionization energy 較低）。"
            )
        else:
            st.info(
                f"ΔEV = {delta_ev:.3f} eV：{k_mat_b} 的 VBM 比 {k_mat_a} 高 {abs(delta_ev):.3f} eV"
                f"（{k_mat_b} ionization energy 較低）。"
            )

        # ── 能帶排列示意圖 ─────────────────────────────────────────────────────
        if k_use_eg:
            st.caption(f"能帶排列示意圖（以 {k_mat_b} 的 VBM = 0 eV 為基準）")
            # Energy positions relative to B's VBM = 0
            vbm_b_e = 0.0
            cbm_b_e = k_eg_b
            vbm_a_e = delta_ev
            cbm_a_e = delta_ev + k_eg_a

            all_e = [vbm_b_e, cbm_b_e, vbm_a_e, cbm_a_e]
            y_lo = min(all_e) - 0.8
            y_hi = max(all_e) + 0.8
            band_h = (y_hi - y_lo) * 0.35  # height of shaded band blocks

            fig_band = go.Figure()

            def _add_band_block(fig, x0, x1, e_vbm, e_cbm, color, mat):
                # VB block (below VBM)
                fig.add_shape(type="rect", x0=x0, x1=x1,
                              y0=e_vbm - band_h, y1=e_vbm,
                              fillcolor=color, opacity=0.55, line_width=0)
                # CB block (above CBM)
                fig.add_shape(type="rect", x0=x0, x1=x1,
                              y0=e_cbm, y1=e_cbm + band_h,
                              fillcolor=color, opacity=0.30, line_width=0)
                # VBM line
                fig.add_shape(type="line", x0=x0, x1=x1, y0=e_vbm, y1=e_vbm,
                              line=dict(color=color, width=2))
                # CBM line
                fig.add_shape(type="line", x0=x0, x1=x1, y0=e_cbm, y1=e_cbm,
                              line=dict(color=color, width=2))
                xc = (x0 + x1) / 2
                fig.add_annotation(x=xc, y=e_vbm, text=f"VBM<br>{e_vbm:.2f} eV",
                                   yanchor="top", showarrow=False, font=dict(size=10, color=color))
                fig.add_annotation(x=xc, y=e_cbm, text=f"CBM<br>{e_cbm:.2f} eV",
                                   yanchor="bottom", showarrow=False, font=dict(size=10, color=color))
                fig.add_annotation(x=xc, y=(e_cbm + e_vbm) / 2, text=f"Eg = {e_cbm - e_vbm:.2f} eV",
                                   yanchor="middle", showarrow=False,
                                   font=dict(size=9, color="#aaa"))

            _add_band_block(fig_band, 0.6, 1.4, vbm_b_e, cbm_b_e, "#636EFA", k_mat_b)
            _add_band_block(fig_band, 1.8, 2.6, vbm_a_e, cbm_a_e, "#EF553B", k_mat_a)

            # ΔEV arrow (between VBMs)
            if abs(delta_ev) > 0.02:
                fig_band.add_annotation(
                    x=1.7, y=vbm_b_e,
                    ax=1.7, ay=vbm_a_e,
                    axref="x", ayref="y",
                    text=f"ΔEV={delta_ev:.2f}",
                    showarrow=True, arrowhead=3, arrowwidth=1.5,
                    arrowcolor="#FFD700", font=dict(size=9, color="#FFD700"),
                    xanchor="right",
                )
            # ΔEC arrow (between CBMs)
            if delta_ec is not None and abs(delta_ec) > 0.02:
                fig_band.add_annotation(
                    x=1.7, y=cbm_b_e,
                    ax=1.7, ay=cbm_a_e,
                    axref="x", ayref="y",
                    text=f"ΔEC={delta_ec:.2f}",
                    showarrow=True, arrowhead=3, arrowwidth=1.5,
                    arrowcolor="#00CC96", font=dict(size=9, color="#00CC96"),
                    xanchor="right",
                )

            fig_band.update_layout(
                xaxis=dict(
                    tickvals=[1.0, 2.2],
                    ticktext=[k_mat_b, k_mat_a],
                    range=[0.2, 3.0], showgrid=False,
                ),
                yaxis=dict(
                    title="Energy (eV)",
                    range=[y_lo, y_hi],
                    zeroline=True, zerolinecolor="#444",
                ),
                template="plotly_dark",
                height=380,
                margin=dict(l=60, r=20, t=20, b=40),
                showlegend=False,
            )
            st.plotly_chart(fig_band, use_container_width=True)

        # ── Kraut 結果匯出 ────────────────────────────────────────────────────
        kraut_row: dict = {
            "材料 A": k_mat_a,
            "材料 B": k_mat_b,
            "VBM_A (eV)": k_vbm_a,
            f"{k_cl_label_a}_bulk (eV)": k_cl_a,
            "ΔCL_A = CL_A − VBM_A (eV)": round(delta_bulk_a, 4),
            "VBM_B (eV)": k_vbm_b,
            f"{k_cl_label_b}_bulk (eV)": k_cl_b,
            "ΔCL_B = CL_B − VBM_B (eV)": round(delta_bulk_b, 4),
            f"{k_cl_label_a}_interface (eV)": k_cl_a_int,
            f"{k_cl_label_b}_interface (eV)": k_cl_b_int,
            "ΔCL_interface (eV)": round(delta_cl_int, 4),
            "ΔEV (eV)": round(delta_ev, 4),
        }
        if k_eg_a > 0:
            kraut_row[f"Eg_A ({k_mat_a}) (eV)"] = k_eg_a
        if k_eg_b > 0:
            kraut_row[f"Eg_B ({k_mat_b}) (eV)"] = k_eg_b
        if delta_ec is not None:
            kraut_row["ΔEC (eV)"] = round(delta_ec, 4)
        kraut_export_df = pd.DataFrame([kraut_row])
        _render_download_card(
            title="Kraut Method 結果 CSV",
            description="保存所有輸入值與 ΔEV / ΔEC 計算結果，方便論文補充與日後追溯。",
            input_label="檔名",
            default_name=f"kraut_{k_mat_a}_{k_mat_b}_band_offset",
            extension="csv",
            button_label="下載 Kraut 結果 CSV",
            data=kraut_export_df.to_csv(index=False).encode("utf-8"),
            mime="text/csv",
            input_key="kraut_csv_fname",
            button_key="kraut_csv_dl",
        )

    # ── 匯出 ─────────────────────────────────────────────────────────────────
    if export_frames or vbm_results:
        st.divider()
        st.subheader("匯出")
        st.caption("研究常用：VBM 結果表與處理後光譜。")
        exp_cols = st.columns(2)
        with exp_cols[0]:
            if vbm_results:
                vbm_export_df = pd.DataFrame([
                    {"資料集": n, "VBM (eV)": round(v + offset, 3)}
                    for n, (v, _, __) in vbm_results.items()
                ])
                _render_download_card(
                    title="VBM 結果 CSV",
                    description="各資料集的 VBM 值（E_F − E_VBM），適合整理 band diagram 或與其他樣品比較。",
                    input_label="檔名",
                    default_name="xps_vbm_results",
                    extension="csv",
                    button_label="下載 VBM 結果 CSV",
                    data=vbm_export_df.to_csv(index=False).encode("utf-8"),
                    mime="text/csv",
                    input_key="vb_vbm_csv_fname",
                    button_key="vb_vbm_csv_dl",
                )

        export_items = list(export_frames.items())
        if len(export_items) == 1:
            fname, df = export_items[0]
            base = fname.rsplit(".", 1)[0]
            with exp_cols[1]:
                _render_download_card(
                    title=f"處理後光譜：{fname}",
                    description="包含原始與背景扣除後欄位，適合重畫 VB 光譜或匯入其他分析工具。",
                    input_label="檔名",
                    default_name=f"{base}_vb_processed",
                    extension="csv",
                    button_label="下載處理後光譜 CSV",
                    data=df.to_csv(index=False).encode("utf-8"),
                    mime="text/csv",
                    input_key="vb_spec_fname_0",
                    button_key="vb_spec_dl_0",
                )
        elif len(export_items) > 1:
            st.caption("**處理後光譜**")
            for start in range(0, len(export_items), 2):
                chunk = export_items[start:start + 2]
                row_cols = st.columns(len(chunk))
                for col, (fname, df) in zip(row_cols, chunk):
                    base = fname.rsplit(".", 1)[0]
                    with col:
                        _render_download_card(
                            title=f"處理後光譜：{fname}",
                            description="包含原始與背景扣除後欄位，適合重畫 VB 光譜。",
                            input_label="檔名",
                            default_name=f"{base}_vb_processed",
                            extension="csv",
                            button_label="下載處理後光譜 CSV",
                            data=df.to_csv(index=False).encode("utf-8"),
                            mime="text/csv",
                            input_key=f"vb_spec_fname_{fname}",
                            button_key=f"vb_spec_dl_{fname}",
                        )


def run_xps_ui() -> None:
    # ── 讀取週期表點選（在 sidebar 渲染前，確保 selectbox 可同步）─────────────────
    _pt_sel = st.session_state.get("periodic_table_chart", {})
    _clicked_elem = None
    if isinstance(_pt_sel, dict):
        pts = _pt_sel.get("selection", {}).get("points", [])
        if pts:
            _cd = pts[0].get("customdata")
            if _cd:
                _clicked_elem = _cd[0]
    if _clicked_elem and _clicked_elem not in FITTABLE_ELEMENTS:
        _clicked_elem = None

    _pt_last_sync = st.session_state.get("_pt_last_sync")
    if _clicked_elem and _clicked_elem != _pt_last_sync:
        st.session_state["fit_element"] = _clicked_elem
        st.session_state["_pt_last_sync"] = _clicked_elem

    # ── sidebar ①②：靜態控制項 ────────────────────────────────────────────────────
    with st.sidebar:
        st.markdown(
            '<p style="font-size:11px;color:#666;letter-spacing:.08em;'
            'text-transform:uppercase;margin:4px 0 4px 0;">分析模式</p>',
            unsafe_allow_html=True,
        )
        xps_analysis_mode = st.radio(
            "分析模式",
            ["Core Level", "Valence Band"],
            horizontal=True,
            key="xps_analysis_mode",
            label_visibility="collapsed",
        )
        st.divider()

        step_header(1, "載入檔案")
        uploaded_files = st.file_uploader(
            "上傳 XPS .txt 檔案（可多選）",
            type=["txt", "csv"],
            accept_multiple_files=True,
        )

        do_average = False
        show_individual = False
        interp_points = 601
        step2_confirmed = st.session_state.get("step2_confirmed", False)
        _skip2 = st.session_state.get("skip_avg", False)
        if xps_analysis_mode == "Core Level":
            with st.expander(step_exp_label(2, "多檔平均", step2_confirmed or _skip2),
                             expanded=not (step2_confirmed or _skip2)):
                skip_avg = st.checkbox("跳過此步驟 ✓", key="skip_avg")
                if not skip_avg:
                    do_average = st.checkbox("對所有載入的檔案做平均", value=False)
                    interp_points = st.number_input(
                        "插值點數", min_value=100, max_value=5000, value=601, step=50
                    )
                    if do_average:
                        show_individual = st.checkbox("疊加顯示原始個別曲線", value=False)
                if skip_avg and not step2_confirmed:
                    st.session_state["step2_confirmed"] = True
                    step2_confirmed = True
                if not skip_avg and not step2_confirmed:
                    if _next_btn("btn_step2_next", "step2_confirmed"):
                        step2_confirmed = True
            skip_avg = st.session_state.get("skip_avg", False)
            step2_confirmed = st.session_state.get("step2_confirmed", False)
            step2_done = skip_avg or step2_confirmed
        else:
            skip_avg = True
            step2_done = True

    # ── 載入數據 ──────────────────────────────────────────────────────────────────
    if not uploaded_files:
        st.info("請在左側上傳一個或多個 XPS .txt 檔案。")
        st.stop()

    data_dict = {}
    for uf in uploaded_files:
        x, y, err = load_xps_file(uf)
        if err:
            st.error(f"**{uf.name}** 讀取失敗：{err}")
        else:
            data_dict[uf.name] = (x, y)

    if not data_dict:
        st.stop()

    st.success(f"成功載入 {len(data_dict)} 個檔案：{', '.join(data_dict.keys())}")

    # ── 計算能量邊界 ──────────────────────────────────────────────────────────────
    all_x = np.concatenate([x for x, _ in data_dict.values()])
    x_min_global = float(all_x.min())
    x_max_global = float(all_x.max())
    overlap_min = float(max(x.min() for x, _ in data_dict.values()))
    overlap_max = float(min(x.max() for x, _ in data_dict.values()))

    # ── Valence Band 模式分支 ─────────────────────────────────────────────────────
    if st.session_state.get("xps_analysis_mode", "Core Level") == "Valence Band":
        _run_valence_band_ui(
            uploaded_files, data_dict,
            x_min_global, x_max_global, overlap_min, overlap_max,
        )
        return

    _cur = st.session_state.get("display_range", (overlap_min, overlap_max))
    _e0 = float(min(_cur[0], _cur[1]))
    _e1 = float(max(_cur[0], _cur[1]))

    # 預設值（未到該步驟時使用）
    offset = 0.0
    calib_au_x = calib_au_y = None
    bg_method = "none"
    bg_x_start, bg_x_end = _e0, _e1
    show_bg_baseline = False
    tougaard_B = 2866.0
    tougaard_C = 1643.0
    norm_method = "none"
    norm_x_start, norm_x_end = _e0, _e1
    fit_target_options = ["Average"] if do_average else list(data_dict.keys())
    fit_target_name = fit_target_options[0] if fit_target_options else None
    selected_elem = "（未選擇）"
    init_peaks_selected: list = []
    manual_centers: list = []
    manual_fwhms: list = []
    doublet_pairs: list = []
    fit_profile = "voigt"
    do_fit = False

    # ── sidebar ③④⑤⑥：依賴數據的控制項 ──────────────────────────────────────────
    with st.sidebar:

        # ─── ③ 能量校正 ───────────────────────────────────────────────────────────
        step3_visible = step2_done
        skip_calib = False
        step3_confirmed = st.session_state.get("step3_confirmed", False)

        if step3_visible:
            _skip3 = st.session_state.get("skip_calib", False)
            with st.expander(step_exp_label(3, "能量校正（標準品）", step3_confirmed or _skip3),
                             expanded=not (step3_confirmed or _skip3)):
                skip_calib = st.checkbox("跳過此步驟 ✓", key="skip_calib")
                if not skip_calib:
                    au_file = st.file_uploader(
                        "上傳標準品 .txt", type=["txt", "csv"], key="au_uploader"
                    )
                    if au_file:
                        std_name = st.selectbox(
                            "選擇標準品", list(CALIB_STANDARDS.keys()), index=0, key="calib_std"
                        )
                        ref_e = CALIB_STANDARDS[std_name]
                        if ref_e is None:
                            ref_e = st.number_input(
                                "輸入標準峰位置 (eV)", value=84.0, step=0.1,
                                format="%.2f", key="calib_custom_e"
                            )
                        calib_au_x, calib_au_y, au_err = load_xps_file(au_file)
                        if au_err:
                            st.error(f"標準品讀取失敗：{au_err}")
                            calib_au_x = calib_au_y = None
                        else:
                            peaks_det, _ = find_peaks(
                                calib_au_y, height=np.max(calib_au_y) * 0.5, distance=20
                            )
                            auto_e = None
                            if len(peaks_det) > 0:
                                best = peaks_det[np.argmax(calib_au_y[peaks_det])]
                                auto_e = float(calib_au_x[best])
                            else:
                                st.warning("無法自動偵測峰值，請手動輸入峰位。")
                            measured_e = st.number_input(
                                "偵測到的峰位置 (eV)（可手動修改）",
                                value=auto_e if auto_e is not None else float(ref_e),
                                step=0.01, format="%.3f",
                                key="calib_measured_e",
                            )
                            offset = ref_e - measured_e
                            col_m1, col_m2 = st.columns(2)
                            col_m1.metric("偵測峰值", f"{measured_e:.2f} eV")
                            col_m2.metric("位移量 ΔE", f"{offset:+.3f} eV")
                            with st.expander("查看標準品峰值偵測圖"):
                                fig_au = go.Figure()
                                fig_au.add_trace(go.Scatter(
                                    x=calib_au_x, y=calib_au_y, mode="lines",
                                    name=std_name, line=dict(color="#00CC96", width=2),
                                ))
                                fig_au.add_vline(
                                    x=measured_e, line_dash="dash", line_color="red",
                                    annotation_text=f"偵測：{measured_e:.2f} eV",
                                    annotation_position="top left",
                                )
                                fig_au.add_vline(
                                    x=ref_e, line_dash="dot", line_color="gray",
                                    annotation_text=f"標準：{ref_e:.2f} eV",
                                    annotation_position="top right",
                                )
                                fig_au.update_layout(
                                    xaxis_title="Binding Energy (eV)", yaxis_title="Intensity",
                                    xaxis=dict(autorange="reversed"),
                                    template="plotly_white", height=260,
                                    margin=dict(l=40, r=20, t=30, b=40),
                                )
                                st.plotly_chart(fig_au, use_container_width=True)
                if skip_calib and not step3_confirmed:
                    st.session_state["step3_confirmed"] = True
                    step3_confirmed = True
                if not skip_calib and not step3_confirmed:
                    if _next_btn("btn_step3_next", "step3_confirmed"):
                        step3_confirmed = True
            skip_calib = st.session_state.get("skip_calib", False)
            step3_confirmed = st.session_state.get("step3_confirmed", False)

        step3_done = step3_visible and (skip_calib or step3_confirmed)

        # ─── ④ 背景扣除 ───────────────────────────────────────────────────────────
        step4_visible = step3_done
        skip_bg = False
        step4_confirmed = st.session_state.get("step4_confirmed", False)

        if step4_visible:
            _skip4 = st.session_state.get("skip_bg", False)
            with st.expander(step_exp_label(4, "背景扣除", step4_confirmed or _skip4),
                             expanded=not (step4_confirmed or _skip4)):
                skip_bg = st.checkbox("跳過此步驟 ✓", key="skip_bg")
                tougaard_B = 2866.0
                tougaard_C = 1643.0
                if not skip_bg:
                    bg_method = st.selectbox(
                        "方法",
                        ["none", "linear", "shirley", "tougaard"],
                        format_func=lambda v: {
                            "none": "不扣除",
                            "linear": "線性背景",
                            "shirley": "Shirley 背景",
                            "tougaard": "Tougaard 背景（XPS 推薦）",
                        }[v],
                    )
                    if bg_method == "tougaard":
                        tougaard_B = float(st.number_input(
                            "Tougaard B (eV²)", value=2866.0, min_value=100.0,
                            max_value=9999.0, step=50.0, format="%.0f",
                        ))
                        tougaard_C = float(st.number_input(
                            "Tougaard C (eV³)", value=1643.0, min_value=100.0,
                            max_value=9999.0, step=50.0, format="%.0f",
                        ))
                    if bg_method != "none":
                        _prev_bg = st.session_state.get("bg_range", (_e0, _e1))
                        _bg_lo = float(max(_e0, min(float(min(_prev_bg)), _e1)))
                        _bg_hi = float(max(_e0, min(float(max(_prev_bg)), _e1)))
                        if _bg_lo >= _bg_hi:
                            _bg_lo, _bg_hi = _e0, _e1
                        st.session_state["bg_range"] = (_bg_lo, _bg_hi)
                        bg_range = st.slider(
                            "背景計算區間 (eV)",
                            min_value=_e0, max_value=_e1,
                            step=0.01, format="%.2f eV",
                            key="bg_range",
                        )
                        bg_x_start, bg_x_end = sorted(bg_range)
                        show_bg_baseline = st.checkbox("疊加顯示背景基準線", value=True)
                if skip_bg and not step4_confirmed:
                    st.session_state["step4_confirmed"] = True
                    step4_confirmed = True
                if not skip_bg and not step4_confirmed:
                    if _next_btn("btn_step4_next", "step4_confirmed"):
                        step4_confirmed = True
            skip_bg = st.session_state.get("skip_bg", False)
            step4_confirmed = st.session_state.get("step4_confirmed", False)

        step4_done = step4_visible and (skip_bg or step4_confirmed)

        # ─── ⑤ 歸一化 ────────────────────────────────────────────────────────────
        step5_visible = step4_done
        skip_norm = False
        step5_confirmed = st.session_state.get("step5_confirmed", False)

        if step5_visible:
            _skip5 = st.session_state.get("skip_norm", False)
            with st.expander(step_exp_label(5, "歸一化", step5_confirmed or _skip5),
                             expanded=not (step5_confirmed or _skip5)):
                skip_norm = st.checkbox("跳過此步驟 ✓", key="skip_norm")
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
                    )
                    if norm_method in ("mean_region", "max"):
                        _prev_nm = st.session_state.get("norm_range", (_e0, _e1))
                        _nm_lo = float(max(_e0, min(float(min(_prev_nm)), _e1)))
                        _nm_hi = float(max(_e0, min(float(max(_prev_nm)), _e1)))
                        if _nm_lo >= _nm_hi:
                            _nm_lo, _nm_hi = _e0, _e1
                        st.session_state["norm_range"] = (_nm_lo, _nm_hi)
                        norm_range = st.slider(
                            "歸一化參考區間 (eV)",
                            min_value=_e0, max_value=_e1,
                            step=0.01, format="%.2f eV",
                            key="norm_range",
                        )
                        norm_x_start, norm_x_end = sorted(norm_range)
                if skip_norm and not step5_confirmed:
                    st.session_state["step5_confirmed"] = True
                    step5_confirmed = True
                if not skip_norm and not step5_confirmed:
                    if _next_btn("btn_step5_next", "step5_confirmed"):
                        step5_confirmed = True
            skip_norm = st.session_state.get("skip_norm", False)
            step5_confirmed = st.session_state.get("step5_confirmed", False)

        step5_done = step5_visible and (skip_norm or step5_confirmed)

        # ─── ⑥ 峰值擬合 ──────────────────────────────────────────────────────────
        step6_visible = step5_done

        if step6_visible:
            step_header(6, "峰值擬合")

            elem_options = ["（未選擇）"] + sorted(FITTABLE_ELEMENTS.keys())
            if "fit_element" not in st.session_state:
                st.session_state["fit_element"] = "（未選擇）"

            selected_elem = st.selectbox(
                "選擇元素（可點選下方週期表）",
                elem_options,
                key="fit_element",
            )

            fit_profile = st.selectbox(
                "峰形",
                ["voigt", "gaussian", "lorentzian"],
                format_func=lambda v: {
                    "voigt": "Voigt（推薦）",
                    "gaussian": "Gaussian",
                    "lorentzian": "Lorentzian",
                }[v],
                key="fit_profile",
            )
            if do_average:
                fit_target_name = "Average"
                st.caption("目前擬合對象：Average（多檔平均後、背景扣除後的未歸一化曲線）")
            elif fit_target_options:
                fit_target_name = st.selectbox(
                    "擬合目標資料集",
                    fit_target_options,
                    key="fit_dataset",
                )
                if len(fit_target_options) > 1:
                    st.caption("多檔未平均時，峰擬合只會套用在這裡選擇的單一資料集。")
            st.caption("XPS 峰擬合與原子濃度一律使用背景扣除後、未歸一化的訊號。")

            if selected_elem != "（未選擇）" and selected_elem in FITTABLE_ELEMENTS:
                all_peaks_db = FITTABLE_ELEMENTS[selected_elem]["peaks"]
                use_manual = st.checkbox("手動調整峰位 / FWHM", key="fit_manual_toggle")

                st.caption("勾選要擬合的峰：")
                for pi, pk in enumerate(all_peaks_db):
                    pk_label = f"{selected_elem} {pk['label']}  ({pk['be']:.1f} eV)"
                    checked = st.checkbox(
                        pk_label, value=True, key=f"fit_pk_{selected_elem}_{pi}"
                    )
                    if checked:
                        init_peaks_selected.append(pk)
                        if use_manual:
                            mc = st.number_input(
                                f"↳ 中心 (eV)  [{pk['label']}]",
                                value=float(pk["be"]),
                                step=0.1, format="%.2f",
                                key=f"fit_mc_{selected_elem}_{pi}",
                            )
                            mf = st.number_input(
                                f"↳ FWHM (eV) [{pk['label']}]",
                                value=float(pk["fwhm"]),
                                min_value=0.05, step=0.05, format="%.2f",
                                key=f"fit_mf_{selected_elem}_{pi}",
                            )
                            manual_centers.append(mc)
                            manual_fwhms.append(mf)
                        else:
                            manual_centers.append(None)
                            manual_fwhms.append(None)

                # ── 自旋軌道雙峰約束 ───────────────────────────────────────────
                if selected_elem in DOUBLET_INFO:
                    dinfo = DOUBLET_INFO[selected_elem]
                    use_doublet = st.checkbox(
                        f"啟用自旋軌道雙峰約束 ({dinfo['orbital']}: "
                        f"{dinfo['major_sub']} / {dinfo['minor_sub']})",
                        value=True, key="fit_use_doublet",
                    )
                    if use_doublet:
                        st.caption(
                            f"間距 {dinfo['be_sep']} eV · "
                            f"面積比 {dinfo['area_ratio']:.3f}（次峰/主峰）"
                        )
                        maj_sub = dinfo["major_sub"]
                        min_sub = dinfo["minor_sub"]
                        maj_idx = next(
                            (i for i, p in enumerate(init_peaks_selected) if maj_sub in p["label"]),
                            None,
                        )
                        min_idx = next(
                            (i for i, p in enumerate(init_peaks_selected) if min_sub in p["label"]),
                            None,
                        )
                        if maj_idx is not None and min_idx is not None:
                            doublet_pairs = [{
                                "major": maj_idx, "minor": min_idx,
                                "be_sep": dinfo["be_sep"],
                                "area_ratio": dinfo["area_ratio"],
                            }]
                        else:
                            st.warning("請同時勾選主峰與次峰以套用雙峰約束。")

            st.divider()
            st.caption("⊕ 自訂峰（手動輸入，不受資料庫限制）")

            if "custom_peak_n" not in st.session_state:
                st.session_state["custom_peak_n"] = 0

            col_add, col_clear = st.columns(2)
            with col_add:
                if st.button("＋ 新增自訂峰", use_container_width=True, key="btn_add_custom"):
                    st.session_state["custom_peak_n"] += 1
            with col_clear:
                if st.button("清除全部", use_container_width=True, key="btn_clear_custom"):
                    for _ci in range(st.session_state["custom_peak_n"]):
                        for _k in [f"cpk_lbl_{_ci}", f"cpk_be_{_ci}", f"cpk_fwhm_{_ci}"]:
                            st.session_state.pop(_k, None)
                    st.session_state["custom_peak_n"] = 0

            for ci in range(st.session_state["custom_peak_n"]):
                with st.container(border=True):
                    c_lbl = st.text_input(
                        f"標籤 #{ci + 1}", value=f"Custom {ci + 1}",
                        key=f"cpk_lbl_{ci}",
                    )
                    c_be = st.number_input(
                        f"BE (eV) #{ci + 1}", value=530.0,
                        step=0.1, format="%.2f",
                        key=f"cpk_be_{ci}",
                    )
                    c_fwhm = st.number_input(
                        f"FWHM (eV) #{ci + 1}", value=1.5,
                        min_value=0.05, step=0.05, format="%.2f",
                        key=f"cpk_fwhm_{ci}",
                    )
                    init_peaks_selected.append({"label": c_lbl, "be": c_be, "fwhm": c_fwhm})
                    manual_centers.append(c_be)
                    manual_fwhms.append(c_fwhm)

            do_fit = st.button("執行擬合", type="primary", use_container_width=True)
        else:
            selected_elem = "（未選擇）"

    # ── 主區：能量範圍滑桿 ────────────────────────────────────────────────────────
    e_range = st.slider(
        "能量顯示範圍 — Binding Energy (eV)",
        min_value=x_min_global, max_value=x_max_global,
        value=(overlap_min, overlap_max),
        step=0.01, format="%.2f eV",
        key="display_range",
    )
    e_start, e_end = sorted(e_range)

    # ── 數據處理 ─────────────────────────────────────────────────────────────────
    fig1 = go.Figure()
    fig2 = go.Figure()
    export_frames = {}
    processed_frames: dict[str, dict[str, np.ndarray | None]] = {}
    fit_curve_export_df = pd.DataFrame()
    fit_peak_export_df = pd.DataFrame()
    quant_summary_export_df = pd.DataFrame()
    quant_detail_export_df = pd.DataFrame()
    fit_result_summary: dict[str, object] = {}

    if do_average:
        new_x = np.linspace(e_start, e_end, int(interp_points))
        all_interp = []
        for name, (x, y) in data_dict.items():
            mask = (x >= e_start) & (x <= e_end)
            xc, yc = x[mask], y[mask]
            if len(xc) < 2:
                st.warning(f"{name}：所選範圍內數據點不足，已跳過。")
                continue
            f_interp = interp1d(xc, yc, kind="linear", fill_value="extrapolate")
            yi = f_interp(new_x)
            all_interp.append(yi)
            if show_individual:
                fig1.add_trace(go.Scatter(
                    x=new_x + offset, y=yi, mode="lines", name=name,
                    line=dict(width=1, dash="dot"), opacity=0.4,
                ))

        if all_interp:
            avg_y = np.mean(all_interp, axis=0)
            y_bg, bg = apply_processing(
                new_x, avg_y, bg_method, "none",
                bg_x_start=bg_x_start, bg_x_end=bg_x_end,
                tougaard_B=tougaard_B, tougaard_C=tougaard_C,
            )
            if bg_method != "none":
                fig1.add_trace(go.Scatter(
                    x=new_x + offset, y=avg_y, mode="lines", name="Average（原始）",
                    line=dict(color="white", width=1.5, dash="dash"), opacity=0.6,
                ))
                if show_bg_baseline:
                    fig1.add_trace(go.Scatter(
                        x=new_x + offset, y=bg, mode="lines", name="背景基準線",
                        line=dict(color="gray", width=1.5, dash="longdash"),
                    ))
                fig1.add_trace(go.Scatter(
                    x=new_x + offset, y=y_bg, mode="lines", name="Average（扣除背景後）",
                    line=dict(color="#EF553B", width=2.5),
                ))
            else:
                fig1.add_trace(go.Scatter(
                    x=new_x + offset, y=avg_y, mode="lines", name="Average",
                    line=dict(color="#EF553B", width=2.5),
                ))
            y_final, _ = apply_processing(
                new_x, y_bg, "none", norm_method,
                norm_x_start=norm_x_start, norm_x_end=norm_x_end,
            )
            if norm_method != "none":
                fig2.add_trace(go.Scatter(
                    x=new_x + offset, y=y_final, mode="lines", name="Average（歸一化後）",
                    line=dict(color="#EF553B", width=2.5),
                ))
            export_frames["Average"] = pd.DataFrame({
                "Energy_eV": new_x + offset,
                "Average_raw": avg_y,
                "Average_bg_subtracted": y_bg,
                **({"Background": bg} if bg_method != "none" else {}),
                **({"Average_normalized": y_final} if norm_method != "none" else {}),
            })
            processed_frames["Average"] = {
                "x": new_x,
                "raw": avg_y,
                "bg_subtracted": y_bg,
                "normalized": y_final if norm_method != "none" else None,
            }
    else:
        for i, (name, (x, y)) in enumerate(data_dict.items()):
            mask = (x >= e_start) & (x <= e_end)
            xc, yc = x[mask], y[mask]
            if len(xc) < 2:
                st.warning(f"{name}：所選範圍內數據點不足，已跳過。")
                continue
            color = COLORS[i % len(COLORS)]
            y_bg, bg = apply_processing(
                xc, yc, bg_method, "none",
                bg_x_start=bg_x_start, bg_x_end=bg_x_end,
                tougaard_B=tougaard_B, tougaard_C=tougaard_C,
            )
            if bg_method != "none":
                fig1.add_trace(go.Scatter(
                    x=xc + offset, y=yc, mode="lines", name=f"{name}（原始）",
                    line=dict(color=color, width=1.5, dash="dash"), opacity=0.5,
                ))
                if show_bg_baseline:
                    fig1.add_trace(go.Scatter(
                        x=xc + offset, y=bg, mode="lines", name=f"{name}（背景）",
                        line=dict(color=color, width=1.2, dash="longdash"), opacity=0.5,
                    ))
                fig1.add_trace(go.Scatter(
                    x=xc + offset, y=y_bg, mode="lines", name=f"{name}（扣除背景後）",
                    line=dict(color=color, width=2),
                ))
            else:
                fig1.add_trace(go.Scatter(
                    x=xc + offset, y=yc, mode="lines", name=name,
                    line=dict(color=color, width=2),
                ))
            y_final, _ = apply_processing(
                xc, y_bg, "none", norm_method,
                norm_x_start=norm_x_start, norm_x_end=norm_x_end,
            )
            if norm_method != "none":
                fig2.add_trace(go.Scatter(
                    x=xc + offset, y=y_final, mode="lines", name=f"{name}（歸一化後）",
                    line=dict(color=color, width=2),
                ))
            export_frames[name] = pd.DataFrame({
                "Energy_eV": xc + offset,
                "Intensity_raw": yc,
                "Intensity_bg_subtracted": y_bg,
                **({"Background": bg} if bg_method != "none" else {}),
                **({"Intensity_normalized": y_final} if norm_method != "none" else {}),
            })
            processed_frames[name] = {
                "x": xc,
                "raw": yc,
                "bg_subtracted": y_bg,
                "normalized": y_final if norm_method != "none" else None,
            }

    fit_frame = processed_frames.get(fit_target_name) if fit_target_name else None
    fit_x = None if fit_frame is None else np.asarray(fit_frame["x"], dtype=float)
    fit_y = None if fit_frame is None else np.asarray(fit_frame["bg_subtracted"], dtype=float)

    current_fit_signature = None
    fit_invalidated = False
    if step6_visible:
        current_fit_signature = _build_xps_fit_signature(
            fit_target_name=fit_target_name,
            selected_elem=selected_elem,
            fit_profile=fit_profile,
            offset=offset,
            e_range=(e_start, e_end),
            bg_method=bg_method,
            bg_range=(bg_x_start, bg_x_end),
            tougaard_B=tougaard_B,
            tougaard_C=tougaard_C,
            norm_method=norm_method,
            norm_range=(norm_x_start, norm_x_end),
            init_peaks_selected=init_peaks_selected,
            manual_centers=manual_centers,
            manual_fwhms=manual_fwhms,
            doublet_pairs=doublet_pairs,
        )
        stored_fit_signature = st.session_state.get("xps_fit_signature")
        if stored_fit_signature is not None and stored_fit_signature != current_fit_signature:
            _clear_xps_fit_state()
            fit_invalidated = True

    # ── 圖一：背景扣除 ────────────────────────────────────────────────────────────
    if bg_method != "none":
        fig1.add_vrect(
            x0=bg_x_start + offset, x1=bg_x_end + offset,
            fillcolor="red", opacity=0.06,
            layer="below", line_width=0,
            annotation_text="背景區間", annotation_position="top left",
        )
    fig1.update_layout(
        xaxis_title="Binding Energy (eV)",
        yaxis_title="Intensity",
        xaxis=dict(autorange="reversed"),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        template="plotly_dark",
        height=480,
        margin=dict(l=50, r=20, t=60, b=50),
    )
    scroll_anchor("xps-bg-plot")
    st.plotly_chart(fig1, use_container_width=True)
    auto_scroll_on_appear(
        "xps-bg-plot",
        visible=bg_method != "none",
        state_key="xps_scroll_bg_plot",
        block="start",
    )

    # ── 圖二：歸一化結果 ─────────────────────────────────────────────────────────
    if norm_method != "none":
        scroll_anchor("xps-norm-plot")
        st.caption("歸一化結果")
        if norm_method in ("mean_region", "max"):
            fig2.add_vrect(
                x0=norm_x_start + offset, x1=norm_x_end + offset,
                fillcolor="blue", opacity=0.06,
                layer="below", line_width=0,
                annotation_text="歸一化區間", annotation_position="top right",
            )
        fig2.update_layout(
            xaxis_title="Binding Energy (eV)",
            yaxis_title="Normalized Intensity",
            xaxis=dict(autorange="reversed"),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            template="plotly_dark",
            height=400,
            margin=dict(l=50, r=20, t=40, b=50),
        )
        st.plotly_chart(fig2, use_container_width=True)
        auto_scroll_on_appear(
            "xps-norm-plot",
            visible=True,
            state_key="xps_scroll_norm_plot",
            block="start",
        )
    else:
        auto_scroll_on_appear(
            "xps-norm-plot",
            visible=False,
            state_key="xps_scroll_norm_plot",
        )

    # ── 週期表 & 峰值擬合 ─────────────────────────────────────────────────────────
    if step6_visible:
        st.divider()
        st.subheader("⑥ 峰值擬合")

        st.caption(
            "點選元素選取（邊框較亮＝有 XPS 峰位資料）；"
            "選中的元素以黃色外框標示。亦可直接在左側 selectbox 輸入。"
        )
        pt_fig = build_periodic_table(
            selected_elem=selected_elem if selected_elem != "（未選擇）" else None
        )
        scroll_anchor("xps-periodic-table")
        st.plotly_chart(
            pt_fig,
            use_container_width=True,
            on_select="rerun",
            key="periodic_table_chart",
        )
        auto_scroll_on_appear(
            "xps-periodic-table",
            visible=True,
            state_key="xps_scroll_periodic_table",
            block="start",
        )
        auto_scroll_on_change(
            "xps-periodic-table",
            trigger_value=(
                selected_elem
                if selected_elem != "（未選擇）"
                else None
            ),
            state_key="xps_scroll_periodic_table_selected_elem",
            block="start",
        )

        # ── 執行擬合 ──────────────────────────────────────────────────────────────
        if do_fit:
            if fit_x is None or fit_y is None:
                if fit_target_name:
                    st.error(f"資料集「{fit_target_name}」目前沒有可擬合的數據，請先確認顯示範圍與處理步驟。")
                else:
                    st.error("沒有可擬合的數據，請先載入並處理數據。")
            elif not init_peaks_selected:
                st.warning("請至少勾選一個峰。")
            else:
                with st.spinner("擬合中…"):
                    result = fit_peaks(
                        fit_x, fit_y,
                        init_peaks=init_peaks_selected,
                        profile=fit_profile,
                        manual_centers=(
                            manual_centers
                            if any(c is not None for c in manual_centers) else None
                        ),
                        manual_fwhms=(
                            manual_fwhms
                            if any(f is not None for f in manual_fwhms) else None
                        ),
                        doublet_pairs=doublet_pairs if doublet_pairs else None,
                    )
                st.session_state["fit_result"] = result
                st.session_state["fit_x_used"] = fit_x.tolist()
                st.session_state["fit_y_used"] = fit_y.tolist()
                st.session_state["fit_offset_used"] = offset
                st.session_state["fit_target_used"] = fit_target_name
                st.session_state["xps_fit_signature"] = current_fit_signature

        # ── 顯示擬合結果 ──────────────────────────────────────────────────────────
        FIT_PEAK_COLORS = [
            "#EF553B", "#636EFA", "#00CC96", "#AB63FA",
            "#FFA15A", "#19D3F3", "#FF6692", "#B6E880",
        ]

        if "fit_result" in st.session_state:
            result = st.session_state["fit_result"]
            if not result.get("success"):
                st.error(f"擬合失敗：{result.get('message', '')}")
            else:
                fit_x_used = np.array(st.session_state["fit_x_used"])
                fit_y_used = np.array(st.session_state["fit_y_used"])
                fit_offset_used = float(st.session_state.get("fit_offset_used", offset))
                fit_target_used = st.session_state.get("fit_target_used", "未記錄")
                elem_label = selected_elem if selected_elem != "（未選擇）" else "Unknown"

                fig_fit = go.Figure()
                fig_fit.add_trace(go.Scatter(
                    x=fit_x_used + fit_offset_used, y=fit_y_used,
                    mode="lines", name="實驗數據",
                    line=dict(color="white", width=1.5, dash="dot"),
                ))
                fig_fit.add_trace(go.Scatter(
                    x=fit_x_used + fit_offset_used, y=result["y_fit"],
                    mode="lines", name="擬合包絡",
                    line=dict(color="#FFD700", width=2.5),
                ))
                for pi, (pk_info, yi) in enumerate(
                    zip(result["peaks"], result["y_individual"])
                ):
                    c = FIT_PEAK_COLORS[pi % len(FIT_PEAK_COLORS)]
                    fig_fit.add_trace(go.Scatter(
                        x=fit_x_used + fit_offset_used, y=yi,
                        mode="lines",
                        name=f"{pk_info['label']}  {pk_info['center'] + fit_offset_used:.2f} eV",
                        line=dict(color=c, width=1.5, dash="dash"),
                        fill="tozeroy",
                        fillcolor=hex_to_rgba(c, 0.12),
                    ))
                fig_fit.add_trace(go.Scatter(
                    x=fit_x_used + fit_offset_used, y=result["residuals"],
                    mode="lines", name="殘差",
                    line=dict(color="#888888", width=1),
                    yaxis="y2",
                ))
                fig_fit.update_layout(
                    xaxis_title="Binding Energy (eV)",
                    yaxis_title="Intensity",
                    yaxis2=dict(
                        title="殘差", overlaying="y", side="right",
                        showgrid=False, zeroline=True, zerolinecolor="#555555",
                    ),
                    xaxis=dict(autorange="reversed"),
                    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                    template="plotly_dark",
                    height=480,
                    margin=dict(l=50, r=70, t=60, b=50),
                )
                st.plotly_chart(fig_fit, use_container_width=True)
                st.caption(
                    f"擬合資料集：{fit_target_used}；使用訊號：背景扣除後、未歸一化曲線"
                )

                r2 = result["r_squared"]
                st.caption(
                    f"R² = {r2:.5f}  "
                    f"({'優秀' if r2 > 0.999 else '良好' if r2 > 0.99 else '尚可' if r2 > 0.95 else '差'})"
                )
                rows_table = [
                    {
                        "資料集": fit_target_used,
                        "元素": elem_label,
                        "峰": pk["label"],
                        "中心 (eV)": round(pk["center"] + fit_offset_used, 3),
                        "FWHM (eV)": round(pk["fwhm"], 3),
                        "面積": float(pk["area"]),
                        "面積%": round(pk["area_pct"], 2),
                    }
                    for pk in result["peaks"]
                ]
                fit_peak_export_df = pd.DataFrame(rows_table)
                st.dataframe(
                    fit_peak_export_df.style.format({
                        "中心 (eV)": "{:.3f}",
                        "FWHM (eV)": "{:.3f}",
                        "面積": "{:.6g}",
                        "面積%": "{:.2f}",
                    }),
                    use_container_width=True,
                    hide_index=True,
                )

                fit_curve_export_df = pd.DataFrame({
                    "Energy_eV": fit_x_used + fit_offset_used,
                    "Experimental": fit_y_used,
                    "Fit_envelope": result["y_fit"],
                    "Residuals": result["residuals"],
                    **{
                        f"Peak_{pk['label']}": yi
                        for pk, yi in zip(result["peaks"], result["y_individual"])
                    },
                })
                fit_result_summary = {
                    "target_dataset": fit_target_used,
                    "element": elem_label,
                    "profile": fit_profile,
                    "r_squared": float(r2),
                    "peak_count": int(len(result["peaks"])),
                }

                # ── 原子濃度累積表 ─────────────────────────────────────────────
                st.divider()
                st.caption("原子濃度計算（先審核本次峰，再更新累積表）")
                st.caption("RSF 來源欄：「軌域精確」表示已查到該峰對應軌域（如 2p3/2）的精確值；「元素層級近似」表示僅找到元素整體 RSF，誤差約 ±5–15%。")
                st.caption("預設規則：衛星峰與自旋軌道次峰不納入；若同元素有多種軌域，預設只保留主要軌域。")

                if "xps_quant_history" not in st.session_state:
                    legacy_records = st.session_state.get("xps_fit_history", [])
                    st.session_state["xps_quant_history"] = list(legacy_records) if legacy_records else []

                quant_review_df = _build_xps_quant_review_df(
                    result["peaks"],
                    elem_label=elem_label,
                    fit_target_used=fit_target_used,
                    fit_offset_used=fit_offset_used,
                )
                edited_quant_df = st.data_editor(
                    quant_review_df,
                    use_container_width=True,
                    hide_index=True,
                    disabled=["資料集", "元素", "峰", "軌域族", "中心 (eV)", "面積", "RSF", "RSF來源", "定量建議"],
                    column_config={
                        "納入定量": st.column_config.CheckboxColumn("納入定量"),
                        "面積": st.column_config.NumberColumn("面積", format="%.6g"),
                        "中心 (eV)": st.column_config.NumberColumn("中心 (eV)", format="%.3f"),
                        "RSF來源": st.column_config.TextColumn("RSF來源", width="medium"),
                    },
                    key=f"xps_quant_editor_{fit_target_used}_{elem_label}",
                )

                col_add_ac, col_clr_ac = st.columns(2)
                with col_add_ac:
                    if st.button("更新原子濃度表（覆蓋本資料集+元素）", use_container_width=True, key="btn_add_ac"):
                        kept_df = edited_quant_df[edited_quant_df["納入定量"]].copy()
                        existing_records = st.session_state.get("xps_quant_history", [])
                        existing_df = pd.DataFrame(existing_records)
                        if not existing_df.empty:
                            existing_df = existing_df[
                                ~(
                                    (existing_df["資料集"] == fit_target_used)
                                    & (existing_df["元素"] == elem_label)
                                )
                            ]
                        new_records = kept_df.to_dict("records")
                        merged_records = existing_df.to_dict("records") if not existing_df.empty else []
                        merged_records.extend(new_records)
                        st.session_state["xps_quant_history"] = merged_records
                        st.session_state["xps_fit_history"] = merged_records
                with col_clr_ac:
                    if st.button("清除原子濃度表", use_container_width=True, key="btn_clr_ac"):
                        st.session_state["xps_quant_history"] = []
                        st.session_state["xps_fit_history"] = []

                history_records = st.session_state.get("xps_quant_history", [])
                if history_records:
                    hist_detail_df, hist_summary_df = _build_xps_quant_tables(history_records)
                    quant_detail_export_df = hist_detail_df.copy()
                    quant_summary_export_df = hist_summary_df.copy()
                    st.caption("元素摘要（每個資料集分開計算 at.%）")
                    summary_cols = ["資料集", "元素", "納入峰數", "原始面積總和", "RSF校正面積", "原子濃度 at.%"]
                    st.dataframe(hist_summary_df[summary_cols], use_container_width=True, hide_index=True)

                    with st.expander("查看定量明細峰表"):
                        detail_cols = [
                            "資料集", "元素", "峰", "軌域族", "中心 (eV)",
                            "面積", "RSF", "RSF校正面積", "原子濃度 at.%", "定量建議",
                        ]
                        st.dataframe(hist_detail_df[detail_cols], use_container_width=True, hide_index=True)

        elif fit_invalidated:
            st.info("擬合參數已更新；請重新按一次「執行擬合」以產生目前設定下的結果。")
    else:
        auto_scroll_on_appear(
            "xps-periodic-table",
            visible=False,
            state_key="xps_scroll_periodic_table",
            block="start",
        )
        auto_scroll_on_change(
            "xps-periodic-table",
            trigger_value=None,
            state_key="xps_scroll_periodic_table_selected_elem",
            block="start",
        )

    history_records = st.session_state.get("xps_quant_history", [])
    if history_records and (quant_summary_export_df.empty or quant_detail_export_df.empty):
        hist_detail_df, hist_summary_df = _build_xps_quant_tables(history_records)
        if quant_detail_export_df.empty:
            quant_detail_export_df = hist_detail_df.copy()
        if quant_summary_export_df.empty:
            quant_summary_export_df = hist_summary_df.copy()

    processing_report = {
        "report_type": "xps_processing_report",
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "module": "xps",
        "input_files": [uf.name for uf in uploaded_files],
        "dataset_count": len(data_dict),
        "processed_datasets": list(export_frames.keys()),
        "display_range_eV": [float(e_start), float(e_end)],
        "energy_offset_eV": float(offset),
        "processing": {
            "average": {
                "skip": bool(skip_avg),
                "average_enabled": bool(do_average),
                "interp_points": int(interp_points),
                "show_individual": bool(show_individual),
            },
            "calibration": {
                "skip": bool(skip_calib),
                "standard_name": st.session_state.get("calib_std"),
                "measured_peak_eV": st.session_state.get("calib_measured_e"),
                "offset_eV": float(offset),
            },
            "background": {
                "skip": bool(skip_bg),
                "method": bg_method,
                "range_eV": [float(bg_x_start), float(bg_x_end)],
                "show_baseline": bool(show_bg_baseline),
                "tougaard_B": float(tougaard_B),
                "tougaard_C": float(tougaard_C),
            },
            "normalization": {
                "skip": bool(skip_norm),
                "method": norm_method,
                "range_eV": [float(norm_x_start), float(norm_x_end)],
                "note": "峰擬合與定量固定使用背景扣除後、未歸一化訊號",
            },
            "fit": {
                "selected_element": selected_elem,
                "target_dataset": fit_target_name,
                "profile": fit_profile,
                "peak_count": int(len(init_peaks_selected)),
                "doublet_pairs": _json_safe(doublet_pairs),
                "result_summary": _json_safe(fit_result_summary),
                "peak_table": _dataframe_records(fit_peak_export_df),
            },
            "quantification": {
                "history_record_count": int(len(history_records)),
                "summary_table": _dataframe_records(quant_summary_export_df),
                "detail_table": _dataframe_records(quant_detail_export_df),
                "rsf_note": "RSF 採軌域精確值（如 2p3/2 子能階）；若無軌域資料則退回元素層級近似；衛星峰與自旋軌道次峰預設不納入定量。",
            },
        },
    }

    if export_frames or not fit_curve_export_df.empty or not fit_peak_export_df.empty or not quant_summary_export_df.empty or not quant_detail_export_df.empty:
        st.subheader("匯出")
        st.caption("下載區已整理成三類：研究常用、原始處理輸出、追溯 / QC。通常先拿研究常用，再視需要保存完整曲線與流程紀錄。")

        st.markdown("**研究常用**")
        st.caption("最常拿來做圖、整理 XPS 結果與和其他樣品比較的檔案。")
        research_cards_rendered = False
        if not fit_peak_export_df.empty:
            research_cards_rendered = True
            _render_download_card(
                title="擬合峰表 CSV",
                description="整理每個 XPS component 的中心、FWHM、面積與面積%，適合做研究結果整理與後續比較。",
                input_label="檔名",
                default_name=f"{fit_target_name or 'xps'}_xps_fit_peaks",
                extension="csv",
                button_label="下載擬合峰表 CSV",
                data=fit_peak_export_df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key="xps_fit_peak_fname",
                button_key="xps_fit_peak_dl",
            )
        if not quant_summary_export_df.empty:
            research_cards_rendered = True
            _render_download_card(
                title="原子濃度摘要 CSV",
                description="依資料集與元素整理定量摘要，包含納入峰數、RSF 校正面積與 at.%，適合做樣品比較與報告表格。",
                input_label="檔名",
                default_name="atomic_concentration_summary",
                extension="csv",
                button_label="下載原子濃度摘要 CSV",
                data=quant_summary_export_df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key="xps_ac_summary_fname",
                button_key="xps_ac_summary_dl",
            )
        export_items = list(export_frames.items())
        if export_items:
            research_cards_rendered = True
            st.caption("處理後光譜會保留目前流程下的主要數值欄位，適合重畫 XPS 光譜、比較樣品或再匯入其他分析工具。")
            for start in range(0, len(export_items), 2):
                row_items = export_items[start:start + 2]
                row_cols = st.columns(len(row_items))
                for col, (fname, df) in zip(row_cols, row_items):
                    base = fname.rsplit(".", 1)[0]
                    with col:
                        _render_download_card(
                            title=f"處理後光譜：{fname}",
                            description="包含原始、背景扣除後與歸一化後欄位，適合重畫光譜、做樣品比較或交給其他軟體分析。",
                            input_label="檔名",
                            default_name=f"{base}_processed",
                            extension="csv",
                            button_label="下載處理後光譜 CSV",
                            data=df.to_csv(index=False).encode("utf-8"),
                            mime="text/csv",
                            input_key=f"xps_processed_fname_{fname}",
                            button_key=f"xps_processed_dl_{fname}",
                        )
        if not research_cards_rendered:
            st.caption("完成資料處理或峰擬合後，這裡會出現最常用的下載檔案。")

        st.markdown("**原始處理輸出**")
        st.caption("偏向完整數值與底層定量明細，適合二次分析、重建圖表或回頭審核峰擬合。")
        raw_cards_rendered = False
        raw_cols = st.columns(2)
        if not fit_curve_export_df.empty:
            raw_cards_rendered = True
            with raw_cols[0]:
                _render_download_card(
                    title="擬合曲線 CSV",
                    description="包含實驗曲線、擬合包絡、殘差與每個 component 曲線，適合重繪 XPS 擬合圖與檢查殘差。",
                    input_label="檔名",
                    default_name=f"{fit_target_name or 'xps'}_xps_fit",
                    extension="csv",
                    button_label="下載擬合曲線 CSV",
                    data=fit_curve_export_df.to_csv(index=False).encode("utf-8"),
                    mime="text/csv",
                    input_key="xps_fit_curve_fname",
                    button_key="xps_fit_curve_dl",
                )
        if not quant_detail_export_df.empty:
            raw_cards_rendered = True
            with raw_cols[1 if not fit_curve_export_df.empty else 0]:
                _render_download_card(
                    title="原子濃度明細 CSV",
                    description="保存每個納入定量峰的軌域族、面積、RSF 校正面積與 at.% 來源，方便回頭審核定量假設。",
                    input_label="檔名",
                    default_name="atomic_concentration_detail",
                    extension="csv",
                    button_label="下載原子濃度明細 CSV",
                    data=quant_detail_export_df.to_csv(index=False).encode("utf-8"),
                    mime="text/csv",
                    input_key="xps_ac_detail_fname",
                    button_key="xps_ac_detail_dl",
                )
        if not raw_cards_rendered:
            st.caption("完成峰擬合或原子濃度整理後，這裡會提供完整曲線與定量明細輸出。")

        st.markdown("**追溯 / QC**")
        st.caption("保存本次 XPS 流程設定與輸出摘要，方便日後重現分析、交叉比對與研究存檔。")
        report_cols = st.columns(2)
        with report_cols[0]:
            _render_download_card(
                title="處理報告 JSON",
                description="完整保存本次 XPS 的顯示範圍、校正、背景、歸一化、擬合條件與定量摘要，適合研究追溯與重現。",
                input_label="檔名",
                default_name="xps_processing_report",
                extension="json",
                button_label="下載處理報告 JSON",
                data=json.dumps(_json_safe(processing_report), ensure_ascii=False, indent=2).encode("utf-8"),
                mime="application/json",
                input_key="xps_report_fname",
                button_key="xps_report_dl",
            )
        with report_cols[1]:
            with st.container(border=True):
                st.markdown("**XPS 流程說明**")
                st.caption("這份報告會記錄顯示區間、能量校正、背景扣除、歸一化、擬合目標資料集、峰表與定量摘要。")
                st.caption("目前 XPS 定量仍使用元素層級近似 RSF；若之後補 orbital/source 專屬 RSF，這份報告也會跟著一起保存。")
