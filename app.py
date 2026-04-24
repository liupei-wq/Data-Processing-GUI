import io
import math
import re
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from scipy.interpolate import interp1d
from scipy.ndimage import median_filter
from scipy.signal import find_peaks, peak_widths

from processing import apply_normalization, apply_processing, despike_signal, smooth_signal
from xps_database import ELEMENTS, CATEGORY_COLORS, FITTABLE_ELEMENTS, ELEMENT_RSF, DOUBLET_INFO
from xrd_database import XRD_REFERENCES
from peak_fitting import fit_peaks
from read_fits_image import read_primary_image_bytes

# ── page config ───────────────────────────────────────────────────────────────
st.set_page_config(page_title="Spectroscopy Data Processing", page_icon="📊", layout="wide")
st.title("📊 Spectroscopy Data Processing GUI")

st.markdown("""
<style>
section[data-testid="stSidebar"] {
    background-color: #10131a;
}
section[data-testid="stSidebar"] * {
    font-size: 13.5px;
}
section[data-testid="stSidebar"] .stCheckbox label p {
    font-size: 12px !important;
    color: #aaa !important;
}
section[data-testid="stSidebar"] label p {
    font-size: 13px !important;
}
/* 繼續按鈕樣式 */
section[data-testid="stSidebar"] div[data-testid="stButton"] button {
    background: #1e2a40;
    border: 1px solid #3d8ef0;
    color: #7eb8f7;
    font-size: 12px !important;
}
/* ── 滑桿顏色：青藍色 ─────────────────────────────────────── */
[data-testid="stSlider"] [role="progressbar"] {
    background: linear-gradient(90deg, #0096c7, #00b4d8) !important;
}
[data-testid="stSlider"] [role="slider"] {
    background-color: #0096c7 !important;
    border-color: #0096c7 !important;
    box-shadow: 0 0 0 4px rgba(0,180,216,0.2) !important;
}
[data-testid="stSlider"] [data-baseweb="tooltip"] div {
    background-color: #0096c7 !important;
}
</style>
""", unsafe_allow_html=True)


def step_header(num: int, title: str, skipped: bool = False) -> None:
    badge_bg = "#555"   if skipped else "#3d8ef0"
    text_col = "#555"   if skipped else "#dde3ee"
    line_col = "#1e2230"
    st.markdown(f"""
    <div style="display:flex;align-items:center;gap:9px;
                margin:18px 0 6px 0;padding-bottom:7px;
                border-bottom:1px solid {line_col};">
      <span style="background:{badge_bg};color:#fff;border-radius:50%;
                   min-width:22px;height:22px;display:inline-flex;
                   align-items:center;justify-content:center;
                   font-size:12px;font-weight:700;">{num}</span>
      <span style="font-size:14.5px;font-weight:600;color:{text_col};
                   {'text-decoration:line-through;' if skipped else ''}"
      >{title}</span>
    </div>""", unsafe_allow_html=True)


def step_header_with_skip(num: int, title: str, skip_key: str) -> bool:
    """步驟標題與跳過勾選框排在同一行。"""
    skipped = st.session_state.get(skip_key, False)
    badge_bg = "#555" if skipped else "#3d8ef0"
    text_col = "#555" if skipped else "#dde3ee"
    strike = "text-decoration:line-through;" if skipped else ""
    line_col = "#1e2230"
    col_h, col_cb = st.columns([3.2, 1.5])
    with col_h:
        st.markdown(f"""
        <div style="display:flex;align-items:center;gap:8px;margin:16px 0 2px 0;">
          <span style="background:{badge_bg};color:#fff;border-radius:50%;
                       min-width:22px;height:22px;display:inline-flex;
                       align-items:center;justify-content:center;
                       font-size:12px;font-weight:700;">{num}</span>
          <span style="font-size:14px;font-weight:600;color:{text_col};{strike}"
          >{title}</span>
        </div>""", unsafe_allow_html=True)
    with col_cb:
        skipped = st.checkbox("跳過 ✓", key=skip_key)
    st.markdown(
        f'<div style="border-top:1px solid {line_col};margin:0 0 6px 0;"></div>',
        unsafe_allow_html=True,
    )
    return skipped


def _next_btn(key: str, state_key: str) -> bool:
    """顯示「繼續 →」按鈕並更新 session_state。回傳是否剛被點擊。"""
    clicked = st.button("繼續下一步 →", key=key, use_container_width=True)
    if clicked:
        st.session_state[state_key] = True
    return clicked


def hex_to_rgba(hex_color: str, alpha: float = 0.15) -> str:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{alpha})"


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


# ── Generic 2-column parser ───────────────────────────────────────────────────
def _is_numeric_line(line: str) -> bool:
    """Return True if every whitespace/comma-separated token in line is a float."""
    parts = line.strip().replace(',', ' ').split()
    if not parts:
        return False
    try:
        for p in parts:
            float(p)
        return True
    except ValueError:
        return False


def _parse_two_column_spectrum_bytes(
    raw: bytes,
    encodings=("utf-8", "utf-8-sig", "big5", "cp950", "latin-1", "utf-16"),
):
    import io
    for enc in encodings:
        try:
            content = raw.decode(enc)
        except UnicodeDecodeError:
            continue

        all_lines = content.splitlines()

        # ── Strategy 1: scan forward to find where numeric data begins ──────
        # Handles Andor .asc and other files with text headers
        data_lines = []
        in_data = False
        for line in all_lines:
            if _is_numeric_line(line):
                in_data = True
                data_lines.append(line.strip())
            elif in_data:
                # A non-numeric line after data started → end of data block
                break

        if len(data_lines) >= 2:
            clean = "\n".join(data_lines)
            for sep in ('\t', r'\s+', ','):
                try:
                    df = pd.read_csv(io.StringIO(clean), sep=sep, header=None,
                                     engine='python', on_bad_lines='skip')
                    num_df = df.apply(pd.to_numeric, errors='coerce')
                    valid = [c for c in num_df.columns
                             if num_df[c].notna().mean() > 0.8]
                    if len(valid) < 2:
                        continue
                    # 3-column case (e.g. pixel-index, wavenumber, intensity)
                    # Detect if first column is an integer index (uniform step ≈ 1)
                    if len(valid) >= 3:
                        col0 = num_df[valid[0]].dropna()
                        diffs = col0.diff().dropna().abs()
                        if diffs.mean() > 0 and diffs.std() / diffs.mean() < 0.05:
                            # Very uniform steps → likely pixel index → skip it
                            x = num_df[valid[1]].dropna().to_numpy()
                            y = num_df[valid[2]].dropna().to_numpy()
                        else:
                            x = num_df[valid[0]].dropna().to_numpy()
                            y = num_df[valid[1]].dropna().to_numpy()
                    else:
                        x = num_df[valid[0]].dropna().to_numpy()
                        y = num_df[valid[1]].dropna().to_numpy()
                    n = min(len(x), len(y))
                    if n >= 2:
                        x, y = x[:n], y[:n]
                        idx = np.argsort(x)
                        return x[idx], y[idx], None
                except Exception:
                    continue

        # ── Strategy 2: fallback — filter comment lines, try various layouts ─
        lines = [l for l in all_lines
                 if l.strip() and l.strip()[0] not in ('#', '%', ';', '!')]
        if not lines:
            continue
        clean = "\n".join(lines)
        for sep in (',', '\t', r'\s+'):
            for hdr in (0, None):
                try:
                    df = pd.read_csv(io.StringIO(clean), sep=sep, header=hdr,
                                     engine='python', on_bad_lines='skip')
                    num_df = df.apply(pd.to_numeric, errors='coerce')
                    valid = [c for c in num_df.columns
                             if num_df[c].notna().mean() > 0.8]
                    if len(valid) >= 2:
                        x = num_df[valid[0]].dropna().to_numpy()
                        y = num_df[valid[1]].dropna().to_numpy()
                        n = min(len(x), len(y))
                        if n >= 2:
                            x, y = x[:n], y[:n]
                            idx = np.argsort(x)
                            return x[idx], y[idx], None
                except Exception:
                    continue

    return None, None, "無法解析：請確認為兩欄數字格式（X, Y）"


def _parse_raman_bytes(raw: bytes):
    return _parse_two_column_spectrum_bytes(raw)


def _parse_xrd_bytes(raw: bytes):
    return _parse_two_column_spectrum_bytes(raw)


# ── Raman UI ──────────────────────────────────────────────────────────────────
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
            _x, _y, _err = _parse_raman_bytes(uf.read())
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
                raw_interp = interp1d(
                    xc, yc, kind="linear", bounds_error=False, fill_value=np.nan
                )(new_x)
                input_interp = interp1d(
                    xc, y_input, kind="linear", bounds_error=False, fill_value=np.nan
                )(new_x)
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
                avg_raw = np.mean(np.vstack(all_interp_raw), axis=0)
                avg_input = np.mean(np.vstack(all_interp_input), axis=0)
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
                    peak_idx = _detect_spectrum_peaks(
                        new_x, peak_signal, peak_prom_ratio,
                        peak_height_ratio, peak_distance_cm, max_peak_labels,
                    )
                    peak_table = _build_raman_peak_table("Average", new_x, peak_signal, peak_idx)
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
                peak_idx = _detect_spectrum_peaks(
                    xc, peak_signal, peak_prom_ratio,
                    peak_height_ratio, peak_distance_cm, max_peak_labels,
                )
                peak_table = _build_raman_peak_table(fname, xc, peak_signal, peak_idx)
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


def _detect_spectrum_peaks(
    x: np.ndarray,
    y: np.ndarray,
    prominence_ratio: float,
    height_ratio: float,
    min_distance_x: float,
    max_peaks: int,
) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if len(x) < 3 or len(y) < 3:
        return np.array([], dtype=int)

    dx = np.diff(x)
    dx = dx[np.isfinite(dx) & (dx > 0)]
    median_dx = float(np.median(dx)) if len(dx) else 0.0
    distance_pts = max(1, int(round(float(min_distance_x) / median_dx))) if median_dx > 0 else 1

    y_max = float(np.max(y))
    y_min = float(np.min(y))
    y_range = y_max - y_min
    if not np.isfinite(y_range) or y_range <= 0:
        return np.array([], dtype=int)

    find_kwargs = {}
    if prominence_ratio > 0:
        find_kwargs["prominence"] = float(prominence_ratio) * y_range
    if height_ratio > 0 and y_max > 0:
        find_kwargs["height"] = float(height_ratio) * y_max
    if distance_pts > 1:
        find_kwargs["distance"] = distance_pts

    peaks, props = find_peaks(y, **find_kwargs)
    if len(peaks) == 0:
        return peaks

    metric = props.get("prominences", y[peaks])
    order = np.argsort(metric)[::-1]
    if max_peaks > 0:
        order = order[:max_peaks]
    return np.sort(peaks[order])


def _build_raman_peak_table(dataset: str, x: np.ndarray, y: np.ndarray,
                            peak_idx: np.ndarray) -> pd.DataFrame:
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


def _build_xes_peak_table(dataset: str, pixel_x: np.ndarray, y: np.ndarray,
                          peak_idx: np.ndarray,
                          energy_x: np.ndarray | None = None) -> pd.DataFrame:
    if len(peak_idx) == 0:
        columns = [
            "Dataset", "Peak", "Pixel", "Intensity",
            "Relative_Intensity_pct", "FWHM_pixel",
        ]
        if energy_x is not None:
            columns.extend(["Energy_eV", "FWHM_eV"])
        return pd.DataFrame(columns=columns)

    widths, _, left_ips, right_ips = peak_widths(y, peak_idx, rel_height=0.5)
    sample_axis = np.arange(len(pixel_x), dtype=float)
    left_pixel = np.interp(left_ips, sample_axis, pixel_x)
    right_pixel = np.interp(right_ips, sample_axis, pixel_x)

    peak_x = pixel_x[peak_idx]
    peak_y = y[peak_idx]
    curve_max = float(np.max(y)) if len(y) else 0.0
    rel_intensity = (peak_y / curve_max * 100.0) if curve_max > 0 else np.zeros_like(peak_y)

    rows = {
        "Dataset": dataset,
        "Peak": np.arange(1, len(peak_idx) + 1),
        "Pixel": peak_x,
        "Intensity": peak_y,
        "Relative_Intensity_pct": rel_intensity,
        "FWHM_pixel": np.abs(right_pixel - left_pixel),
    }
    if energy_x is not None:
        left_energy = np.interp(left_ips, sample_axis, energy_x)
        right_energy = np.interp(right_ips, sample_axis, energy_x)
        rows["Energy_eV"] = energy_x[peak_idx]
        rows["FWHM_eV"] = np.abs(right_energy - left_energy)

    return pd.DataFrame(rows)


def _natural_sort_key(text: str) -> list[object]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text)]


def _xes_header_time_value(image) -> tuple[float | None, str]:
    header = image.header
    for key in ("MJD-OBS", "JD", "EXPSTART", "EXPEND"):
        value = header.get(key)
        if value is None:
            continue
        try:
            return float(value), key
        except (TypeError, ValueError):
            pass

    date_value = header.get("DATE-OBS") or header.get("DATE")
    time_value = header.get("TIME-OBS") or header.get("UT")
    if date_value:
        raw = str(date_value).strip()
        if time_value and "T" not in raw and " " not in raw:
            raw = f"{raw}T{str(time_value).strip()}"
        raw = raw.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp(), "DATE-OBS"
        except ValueError:
            pass

    return None, ""


def _xes_exposure_seconds(image) -> float | None:
    for key in ("EXPTIME", "EXPOSURE", "ITIME", "ONTIME"):
        value = image.header.get(key)
        if value is None:
            continue
        try:
            exposure = float(value)
        except (TypeError, ValueError):
            continue
        if exposure > 0:
            return exposure
    return None


def _xes_image_array(image, plane: int, normalize_exposure: bool,
                     transpose_image: bool = False) -> np.ndarray:
    arr = image.as_array(plane).astype(float)
    if transpose_image:
        arr = arr.T
    if normalize_exposure:
        exposure = _xes_exposure_seconds(image)
        if exposure and exposure > 0:
            arr = arr / exposure
    return arr


def _xes_average_frame(
    image_dict: dict[str, object],
    plane: int,
    normalize_exposure: bool,
    transpose_image: bool = False,
) -> tuple[np.ndarray | None, pd.DataFrame]:
    arrays = []
    rows = []
    expected_shape = None

    for name, image in image_dict.items():
        arr = _xes_image_array(image, plane, normalize_exposure, transpose_image)
        if expected_shape is None:
            expected_shape = arr.shape
        elif arr.shape != expected_shape:
            raise ValueError(f"{name} shape {arr.shape} does not match dark/bias shape {expected_shape}")

        arrays.append(arr)
        rows.append({
            "Frame": name,
            "Exposure_s": _xes_exposure_seconds(image),
            "Mean": float(np.nanmean(arr)),
            "Median": float(np.nanmedian(arr)),
        })

    if not arrays:
        return None, pd.DataFrame()

    avg = np.nanmean(np.stack(arrays, axis=0), axis=0)
    return avg.astype(float), pd.DataFrame(rows)


def _xes_preprocessed_image_array(
    image,
    plane: int,
    normalize_exposure: bool,
    dark_frame: np.ndarray | None = None,
    transpose_image: bool = False,
) -> np.ndarray:
    arr = _xes_image_array(image, plane, normalize_exposure, transpose_image)
    if dark_frame is None:
        return arr
    if arr.shape != dark_frame.shape:
        raise ValueError(f"Image shape {arr.shape} and dark/bias shape {dark_frame.shape} do not match")
    return arr - dark_frame


def _xes_ordered_sample_names(image_dict: dict[str, object], order_method: str) -> list[str]:
    names = list(image_dict.keys())
    if order_method == "filename":
        return sorted(names, key=_natural_sort_key)
    if order_method == "time":
        time_rows = []
        for name in names:
            t_val, _ = _xes_header_time_value(image_dict[name])
            if t_val is None:
                return sorted(names, key=_natural_sort_key)
            time_rows.append((t_val, name))
        return [name for _, name in sorted(time_rows)]
    return names


def _xes_bg_weights(
    image_dict: dict[str, object],
    bg1_image,
    bg2_image,
    order_method: str,
) -> tuple[dict[str, float], pd.DataFrame, str]:
    ordered_names = _xes_ordered_sample_names(image_dict, order_method)
    n = len(ordered_names)
    weights: dict[str, float] = {}
    rows = []
    source_label = {
        "time": "FITS header time",
        "filename": "file name natural sort",
        "upload": "upload order",
    }.get(order_method, order_method)

    bg1_time, bg1_time_key = _xes_header_time_value(bg1_image)
    bg2_time, bg2_time_key = _xes_header_time_value(bg2_image)
    sample_time_available = all(_xes_header_time_value(image_dict[name])[0] is not None for name in image_dict)
    can_use_time = (
        order_method == "time"
        and bg1_time is not None
        and bg2_time is not None
        and bg1_time != bg2_time
        and sample_time_available
    )

    if order_method == "time" and not can_use_time:
        source_label = "file name natural sort (time unavailable)"
        ordered_names = sorted(image_dict.keys(), key=_natural_sort_key)

    for pos, name in enumerate(ordered_names, start=1):
        time_val, time_key = _xes_header_time_value(image_dict[name])
        if can_use_time and time_val is not None:
            raw_weight = (time_val - bg1_time) / (bg2_time - bg1_time)
        else:
            raw_weight = pos / (n + 1)
        weight = float(np.clip(raw_weight, 0.0, 1.0))
        weights[name] = weight
        rows.append({
            "Sample": name,
            "Order": pos,
            "Weight_w": weight,
            "Raw_w": float(raw_weight),
            "Time_Source": time_key,
            "BG1_Time_Source": bg1_time_key,
            "BG2_Time_Source": bg2_time_key,
        })

    return weights, pd.DataFrame(rows), source_label


def _xes_corrected_array(image, plane: int, bg1_image, bg2_image,
                         bg_method: str, weight: float,
                         normalize_exposure: bool = False,
                         dark_frame: np.ndarray | None = None,
                         transpose_image: bool = False) -> np.ndarray:
    sample_arr = _xes_preprocessed_image_array(
        image, plane, normalize_exposure, dark_frame, transpose_image,
    )
    if bg_method == "none":
        return sample_arr.copy()

    if bg1_image is None and bg_method in ("bg1", "average", "interpolated"):
        raise ValueError("BG1 is required for this background method")
    if bg2_image is None and bg_method in ("bg2", "average", "interpolated"):
        raise ValueError("BG2 is required for this background method")

    if bg_method == "bg1":
        bg_arr = _xes_preprocessed_image_array(
            bg1_image, plane, normalize_exposure, dark_frame, transpose_image,
        )
    elif bg_method == "bg2":
        bg_arr = _xes_preprocessed_image_array(
            bg2_image, plane, normalize_exposure, dark_frame, transpose_image,
        )
    else:
        bg1_arr = _xes_preprocessed_image_array(
            bg1_image, plane, normalize_exposure, dark_frame, transpose_image,
        )
        bg2_arr = _xes_preprocessed_image_array(
            bg2_image, plane, normalize_exposure, dark_frame, transpose_image,
        )
        if bg_method == "average":
            bg_arr = 0.5 * (bg1_arr + bg2_arr)
        elif bg_method == "interpolated":
            bg_arr = bg1_arr + float(weight) * (bg2_arr - bg1_arr)
        else:
            bg_arr = np.zeros_like(sample_arr, dtype=float)

    if sample_arr.shape != bg_arr.shape:
        raise ValueError(f"Sample shape {sample_arr.shape} and background shape {bg_arr.shape} do not match")
    return sample_arr - bg_arr


def _xes_fix_hot_pixels(arr: np.ndarray, enabled: bool,
                        threshold: float = 8.0, window_size: int = 3) -> tuple[np.ndarray, np.ndarray]:
    arr = np.asarray(arr, dtype=float)
    mask = np.zeros(arr.shape, dtype=bool)
    if not enabled or arr.size < 9:
        return arr.copy(), mask

    window_size = int(max(3, window_size))
    if window_size % 2 == 0:
        window_size += 1

    local_median = median_filter(arr, size=window_size, mode="nearest")
    residual = arr - local_median
    finite_res = residual[np.isfinite(residual)]
    if finite_res.size == 0:
        return arr.copy(), mask

    med = float(np.nanmedian(finite_res))
    mad = float(np.nanmedian(np.abs(finite_res - med)))
    scale = 1.4826 * mad
    if not np.isfinite(scale) or scale < 1e-12:
        scale = float(np.nanstd(finite_res))
    if not np.isfinite(scale) or scale < 1e-12:
        return arr.copy(), mask

    mask = residual > float(threshold) * scale
    cleaned = arr.copy()
    cleaned[mask] = local_median[mask]
    return cleaned, mask


def _xes_peak_center_subpixel(x_axis: np.ndarray, y_vals: np.ndarray,
                              cutoff: float) -> tuple[float | None, float, float]:
    x_axis = np.asarray(x_axis, dtype=float)
    y_vals = np.asarray(y_vals, dtype=float)
    finite = np.isfinite(x_axis) & np.isfinite(y_vals)
    if np.count_nonzero(finite) < 3:
        return None, np.nan, np.nan

    x = x_axis[finite]
    y = y_vals[finite]
    baseline = float(np.nanmedian(y))
    residual = y - baseline
    mad = float(np.nanmedian(np.abs(residual - np.nanmedian(residual))))
    noise = 1.4826 * mad
    if not np.isfinite(noise) or noise < 1e-12:
        noise = float(np.nanstd(residual))

    peak_idx = int(np.nanargmax(y))
    peak_height = float(y[peak_idx] - baseline)
    snr = peak_height / noise if noise and noise > 1e-12 else np.inf
    if peak_height <= 0 or (np.isfinite(snr) and snr < float(cutoff)):
        return None, peak_height, snr

    center = float(x[peak_idx])
    if 0 < peak_idx < len(y) - 1:
        y0, y1, y2 = float(y[peak_idx - 1]), float(y[peak_idx]), float(y[peak_idx + 1])
        denom = y0 - 2.0 * y1 + y2
        if abs(denom) > 1e-12:
            delta = 0.5 * (y0 - y2) / denom
            if np.isfinite(delta):
                delta = float(np.clip(delta, -1.0, 1.0))
                center = float(x[peak_idx] + delta * np.nanmedian(np.diff(x)))

    return center, peak_height, snr


def _xes_fit_curvature(
    arr: np.ndarray,
    x_range: tuple[int, int],
    y_range: tuple[int, int],
    fit_x_range: tuple[int, int],
    poly_order: int,
    cutoff: float,
) -> tuple[pd.DataFrame, list[float], float]:
    arr = np.asarray(arr, dtype=float)
    height, width = arr.shape
    x0 = int(np.clip(min(x_range), 0, width - 1))
    x1 = int(np.clip(max(x_range), 0, width - 1))
    y0 = int(np.clip(min(y_range), 0, height - 1))
    y1 = int(np.clip(max(y_range), 0, height - 1))
    c0 = int(np.clip(min(fit_x_range), x0, x1))
    c1 = int(np.clip(max(fit_x_range), x0, x1))
    if c1 - c0 < 2:
        raise ValueError("曲率 fitting column 範圍至少需要 3 個 pixel。")

    col_axis = np.arange(c0, c1 + 1, dtype=float)
    rows = []
    for row_idx in range(y0, y1 + 1):
        segment = arr[row_idx, c0:c1 + 1]
        center, peak_height, snr = _xes_peak_center_subpixel(col_axis, segment, cutoff)
        rows.append({
            "Row": row_idx,
            "Peak_Center_Column": center,
            "Peak_Height": peak_height,
            "SNR": snr,
            "Accepted": center is not None,
        })

    curve_df = pd.DataFrame(rows)
    accepted = curve_df[curve_df["Accepted"]].copy()
    degree = int(max(1, poly_order))
    if len(accepted) < degree + 1:
        raise ValueError(f"可用 row 數不足，無法 fit {degree} 階曲率。")

    x_fit = accepted["Row"].to_numpy(dtype=float)
    y_fit = accepted["Peak_Center_Column"].to_numpy(dtype=float)
    coeffs = np.polyfit(x_fit, y_fit, degree).astype(float)
    fit_vals = np.polyval(coeffs, x_fit)
    residual = y_fit - fit_vals
    res_mad = float(np.nanmedian(np.abs(residual - np.nanmedian(residual))))
    res_scale = 1.4826 * res_mad
    if np.isfinite(res_scale) and res_scale > 1e-12:
        keep = np.abs(residual) <= float(cutoff) * res_scale
        if np.count_nonzero(keep) >= degree + 1 and np.count_nonzero(~keep) > 0:
            x_fit = x_fit[keep]
            y_fit = y_fit[keep]
            coeffs = np.polyfit(x_fit, y_fit, degree).astype(float)
            accepted = accepted.iloc[np.where(keep)[0]].copy()

    row_all = curve_df["Row"].to_numpy(dtype=float)
    curve_df["Fitted_Center_Column"] = np.polyval(coeffs, row_all)
    curve_df["Shift_Column"] = np.nan
    curve_df["Used_In_Fit"] = curve_df["Row"].isin(accepted["Row"].astype(int))
    reference_center = float(np.nanmedian(curve_df.loc[curve_df["Used_In_Fit"], "Fitted_Center_Column"]))
    curve_df.loc[curve_df["Accepted"], "Shift_Column"] = (
        reference_center - curve_df.loc[curve_df["Accepted"], "Fitted_Center_Column"]
    )
    return curve_df, coeffs.tolist(), reference_center


def _xes_shift_image_from_curvature(
    arr: np.ndarray,
    curve_df: pd.DataFrame,
    coeffs: list[float],
    reference_center: float,
    y_range: tuple[int, int],
) -> np.ndarray:
    arr = np.asarray(arr, dtype=float)
    shifted = arr.copy()
    if not coeffs:
        return shifted

    height, width = arr.shape
    y0 = int(np.clip(min(y_range), 0, height - 1))
    y1 = int(np.clip(max(y_range), 0, height - 1))
    col_axis = np.arange(width, dtype=float)
    rows = np.arange(y0, y1 + 1, dtype=float)
    fitted_centers = np.polyval(np.asarray(coeffs, dtype=float), rows)

    for row_idx, fitted_center in zip(range(y0, y1 + 1), fitted_centers):
        if not np.isfinite(fitted_center):
            continue
        delta = float(reference_center - fitted_center)
        shifted[row_idx, :] = np.interp(
            col_axis - delta,
            col_axis,
            arr[row_idx, :],
            left=np.nan,
            right=np.nan,
        )

    return shifted


def _xes_apply_curvature_correction(
    arr: np.ndarray,
    enabled: bool,
    x_range: tuple[int, int],
    y_range: tuple[int, int],
    fit_x_range: tuple[int, int],
    poly_order: int,
    cutoff: float,
) -> tuple[np.ndarray, pd.DataFrame, list[float], float | None]:
    if not enabled:
        return arr.copy(), pd.DataFrame(), [], None

    curve_df, coeffs, reference_center = _xes_fit_curvature(
        arr, x_range, y_range, fit_x_range, poly_order, cutoff,
    )
    shifted = _xes_shift_image_from_curvature(
        arr, curve_df, coeffs, reference_center, y_range,
    )
    return shifted, curve_df, coeffs, reference_center


def _xes_apply_axis_calibration(pixel_axis: np.ndarray, mode: str,
                                linear_offset: float, linear_slope: float,
                                poly_coeffs: list[float]) -> np.ndarray:
    pixel_axis = np.asarray(pixel_axis, dtype=float)
    if mode == "linear":
        return linear_offset + linear_slope * pixel_axis
    if mode == "reference_points" and poly_coeffs:
        return np.polyval(poly_coeffs, pixel_axis)
    return pixel_axis


def _xes_calibration_coeffs(ref_df: pd.DataFrame, degree: int) -> list[float]:
    if ref_df.empty:
        return []
    valid = ref_df[["Pixel", "Energy_eV"]].dropna()
    min_points = int(degree) + 1
    if len(valid) < min_points:
        return []
    return np.polyfit(
        valid["Pixel"].to_numpy(dtype=float),
        valid["Energy_eV"].to_numpy(dtype=float),
        int(degree),
    ).astype(float).tolist()


def _xes_find_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    normalized = {
        re.sub(r"[^a-z0-9]+", "", str(col).lower()): col
        for col in df.columns
    }
    for candidate in candidates:
        key = re.sub(r"[^a-z0-9]+", "", candidate.lower())
        if key in normalized:
            return normalized[key]
    return None


def _xes_read_csv_bytes(uploaded_file) -> pd.DataFrame:
    raw = uploaded_file.getvalue() if hasattr(uploaded_file, "getvalue") else uploaded_file.read()
    return pd.read_csv(io.BytesIO(raw))


def _xes_calibration_points_from_csv(uploaded_file) -> tuple[pd.DataFrame, str]:
    df = _xes_read_csv_bytes(uploaded_file)
    pixel_col = _xes_find_column(df, ["Pixel", "Detector Pixel", "Channel", "Column", "Row", "X"])
    energy_col = _xes_find_column(df, ["Energy_eV", "Energy", "Emission Energy", "eV"])
    if pixel_col is None or energy_col is None:
        return pd.DataFrame(columns=["Pixel", "Energy_eV"]), (
            "CSV 需要包含 Pixel 與 Energy_eV 欄位；也可用 Channel/Column/Row 與 Energy/eV。"
        )

    points = pd.DataFrame({
        "Pixel": pd.to_numeric(df[pixel_col], errors="coerce"),
        "Energy_eV": pd.to_numeric(df[energy_col], errors="coerce"),
    }).dropna()
    return points, ""


def _xes_i0_table_from_csv(uploaded_file) -> tuple[pd.DataFrame, str]:
    df = _xes_read_csv_bytes(uploaded_file)
    file_col = _xes_find_column(df, ["File", "Filename", "Sample", "Name", "Dataset"])
    i0_col = _xes_find_column(df, ["I0", "Incident Flux", "IncidentFlux", "Flux", "Monitor"])
    if i0_col is None:
        return pd.DataFrame(columns=["File", "I0"]), "CSV 需要包含 I0 / Flux / Monitor 欄位。"

    if file_col is None and len(df) == 1:
        out = pd.DataFrame({"File": ["*"], "I0": [pd.to_numeric(df[i0_col], errors="coerce").iloc[0]]})
    elif file_col is not None:
        out = pd.DataFrame({
            "File": df[file_col].astype(str),
            "I0": pd.to_numeric(df[i0_col], errors="coerce"),
        })
    else:
        return pd.DataFrame(columns=["File", "I0"]), "多筆 I0 CSV 需要包含 File / Filename / Sample 欄位。"

    out = out.dropna(subset=["I0"])
    out = out[out["I0"] > 0]
    return out.reset_index(drop=True), ""


def _xes_lookup_i0_value(fname: str, i0_mode: str, i0_global: float,
                         i0_table: pd.DataFrame) -> float | None:
    if i0_mode == "global":
        return float(i0_global) if i0_global > 0 else None
    if i0_mode != "table" or i0_table.empty:
        return None

    target = str(fname).strip().lower()
    target_stem = target.rsplit(".", 1)[0]
    for _, row in i0_table.iterrows():
        key = str(row.get("File", "")).strip().lower()
        if key == "*":
            return float(row["I0"])
        key_stem = key.rsplit(".", 1)[0]
        if key == target or key_stem == target_stem:
            return float(row["I0"])
    return None


def _xes_apply_i0_to_spectra(values: tuple[np.ndarray, ...], i0_value: float | None) -> tuple[np.ndarray, ...]:
    if i0_value is None or i0_value <= 0:
        return values
    return tuple(np.asarray(v, dtype=float) / float(i0_value) for v in values)


def _xes_sorted_finite_xy(axis: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    axis = np.asarray(axis, dtype=float)
    values = np.asarray(values, dtype=float)
    mask = np.isfinite(axis) & np.isfinite(values)
    axis = axis[mask]
    values = values[mask]
    if len(axis) < 2:
        return axis, values
    order = np.argsort(axis)
    axis = axis[order]
    values = values[order]
    keep = np.concatenate(([True], np.diff(axis) > 1e-12))
    return axis[keep], values[keep]


def _xes_interp_to_axis(axis: np.ndarray, values: np.ndarray, target_axis: np.ndarray) -> np.ndarray:
    clean_axis, clean_values = _xes_sorted_finite_xy(axis, values)
    if len(clean_axis) < 2:
        return np.full_like(target_axis, np.nan, dtype=float)
    return interp1d(
        clean_axis, clean_values, kind="linear",
        bounds_error=False, fill_value=np.nan,
    )(target_axis)


def _extract_xes_spectrum_from_array(arr: np.ndarray, x_range: tuple[int, int], y_range: tuple[int, int],
                                     projection: str, reducer: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    height, width = arr.shape

    x0 = int(np.clip(min(x_range), 0, width - 1))
    x1 = int(np.clip(max(x_range), 0, width - 1))
    y0 = int(np.clip(min(y_range), 0, height - 1))
    y1 = int(np.clip(max(y_range), 0, height - 1))

    roi = arr[y0:y1 + 1, x0:x1 + 1]
    if projection == "columns":
        x_axis = np.arange(x0, x1 + 1, dtype=float)
        values = np.nanmean(roi, axis=0) if reducer == "mean" else np.nansum(roi, axis=0)
    else:
        x_axis = np.arange(y0, y1 + 1, dtype=float)
        values = np.nanmean(roi, axis=1) if reducer == "mean" else np.nansum(roi, axis=1)

    return x_axis, np.nan_to_num(values.astype(float), nan=0.0), roi


def _xes_default_sideband_ranges(signal_range: tuple[int, int], max_index: int) -> tuple[tuple[int, int], tuple[int, int]]:
    s0 = int(np.clip(min(signal_range), 0, max_index))
    s1 = int(np.clip(max(signal_range), 0, max_index))
    width = max(1, s1 - s0 + 1)

    upper_end = max(0, s0 - 1)
    upper_start = max(0, upper_end - width + 1)
    lower_start = min(max_index, s1 + 1)
    lower_end = min(max_index, lower_start + width - 1)
    return (upper_start, upper_end), (lower_start, lower_end)


def _xes_non_overlapping_indices(candidate_range: tuple[int, int], signal_range: tuple[int, int], max_index: int) -> np.ndarray:
    c0 = int(np.clip(min(candidate_range), 0, max_index))
    c1 = int(np.clip(max(candidate_range), 0, max_index))
    s0 = int(np.clip(min(signal_range), 0, max_index))
    s1 = int(np.clip(max(signal_range), 0, max_index))
    idx = np.arange(c0, c1 + 1, dtype=int)
    return idx[(idx < s0) | (idx > s1)]


def _extract_xes_spectrum_with_sideband(
    arr: np.ndarray,
    x_range: tuple[int, int],
    y_range: tuple[int, int],
    projection: str,
    reducer: str,
    sideband_enabled: bool = False,
    sideband_ranges: tuple[tuple[int, int], tuple[int, int]] | None = None,
    sideband_stat: str = "mean",
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    x_axis, signal_values, roi = _extract_xes_spectrum_from_array(
        arr, x_range, y_range, projection, reducer,
    )
    zero_bg = np.zeros_like(signal_values, dtype=float)
    if not sideband_enabled or not sideband_ranges:
        return x_axis, signal_values, signal_values, zero_bg, roi

    height, width = arr.shape
    x0 = int(np.clip(min(x_range), 0, width - 1))
    x1 = int(np.clip(max(x_range), 0, width - 1))
    y0 = int(np.clip(min(y_range), 0, height - 1))
    y1 = int(np.clip(max(y_range), 0, height - 1))

    projections = []
    if projection == "columns":
        signal_size = max(1, y1 - y0 + 1)
        for band_range in sideband_ranges:
            rows = _xes_non_overlapping_indices(band_range, (y0, y1), height - 1)
            if rows.size == 0:
                continue
            band_roi = arr[np.ix_(rows, np.arange(x0, x1 + 1, dtype=int))]
            per_pixel = (
                np.nanmedian(band_roi, axis=0)
                if sideband_stat == "median" else np.nanmean(band_roi, axis=0)
            )
            projections.append(per_pixel)
    else:
        signal_size = max(1, x1 - x0 + 1)
        for band_range in sideband_ranges:
            cols = _xes_non_overlapping_indices(band_range, (x0, x1), width - 1)
            if cols.size == 0:
                continue
            band_roi = arr[np.ix_(np.arange(y0, y1 + 1, dtype=int), cols)]
            per_pixel = (
                np.nanmedian(band_roi, axis=1)
                if sideband_stat == "median" else np.nanmean(band_roi, axis=1)
            )
            projections.append(per_pixel)

    if not projections:
        return x_axis, signal_values, signal_values, zero_bg, roi

    bg_per_pixel = np.nanmean(np.vstack(projections), axis=0)
    scale = signal_size if reducer == "sum" else 1
    scaled_bg = np.nan_to_num(bg_per_pixel * scale, nan=0.0)
    corrected = np.nan_to_num(signal_values - scaled_bg, nan=0.0)
    return x_axis, corrected.astype(float), signal_values.astype(float), scaled_bg.astype(float), roi


def _extract_xes_spectrum(image, plane: int, x_range: tuple[int, int], y_range: tuple[int, int],
                          projection: str, reducer: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    arr = image.as_array(plane)
    return _extract_xes_spectrum_from_array(arr, x_range, y_range, projection, reducer)


def run_xes_ui():
    XES_COLORS = ["#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
                  "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52"]

    with st.sidebar:
        step_header(1, "載入 FITS")
        uploaded_files = st.file_uploader(
            "上傳 Sample FITS 影像（可多選）",
            type=["fits", "fit", "fts"],
            accept_multiple_files=True,
            key="xes_uploader",
        )
        bg1_file = st.file_uploader(
            "上傳 BG1 FITS（樣品前背景，必做）",
            type=["fits", "fit", "fts"],
            accept_multiple_files=False,
            key="xes_bg1_uploader",
        )
        bg2_file = st.file_uploader(
            "上傳 BG2 FITS（樣品後背景，必做）",
            type=["fits", "fit", "fts"],
            accept_multiple_files=False,
            key="xes_bg2_uploader",
        )
        dark_files = st.file_uploader(
            "進階可選：Dark/Bias FITS（沒有這類 detector 校正檔就不用上傳）",
            type=["fits", "fit", "fts"],
            accept_multiple_files=True,
            key="xes_dark_uploader",
        )

    if not uploaded_files:
        st.info("請在左側上傳一個或多個 XES sample FITS 影像檔。")
        st.stop()

    image_dict = {}
    for uf in uploaded_files:
        cache_key = f"_xes_{uf.name}_{uf.size}"
        if cache_key not in st.session_state:
            try:
                image = read_primary_image_bytes(uf.read(), source=uf.name)
                st.session_state[cache_key] = (image, None)
            except Exception as exc:
                st.session_state[cache_key] = (None, str(exc))
        cached_image, cached_err = st.session_state[cache_key]
        if cached_err:
            st.error(f"**{uf.name}** 讀取失敗：{cached_err}")
        else:
            image_dict[uf.name] = cached_image

    if not image_dict:
        st.stop()

    def _parse_optional_xes_bg(uploaded_bg, label: str):
        if uploaded_bg is None:
            return None
        cache_key = f"_xes_{label}_{uploaded_bg.name}_{uploaded_bg.size}"
        if cache_key not in st.session_state:
            try:
                image = read_primary_image_bytes(uploaded_bg.read(), source=uploaded_bg.name)
                st.session_state[cache_key] = (image, None)
            except Exception as exc:
                st.session_state[cache_key] = (None, str(exc))
        image, err = st.session_state[cache_key]
        if err:
            st.error(f"**{label}: {uploaded_bg.name}** 讀取失敗：{err}")
            return None
        return image

    bg1_image = _parse_optional_xes_bg(bg1_file, "BG1")
    bg2_image = _parse_optional_xes_bg(bg2_file, "BG2")
    dark_images = {}
    for df in dark_files or []:
        cache_key = f"_xes_dark_{df.name}_{df.size}"
        if cache_key not in st.session_state:
            try:
                image = read_primary_image_bytes(df.read(), source=df.name)
                st.session_state[cache_key] = (image, None)
            except Exception as exc:
                st.session_state[cache_key] = (None, str(exc))
        cached_image, cached_err = st.session_state[cache_key]
        if cached_err:
            st.error(f"**Dark/Bias: {df.name}** 讀取失敗：{cached_err}")
        else:
            dark_images[df.name] = cached_image

    st.success(f"成功載入 {len(image_dict)} 個 sample FITS：{', '.join(image_dict.keys())}")

    first_name, first_image = next(iter(image_dict.items()))
    raw_width, raw_height = first_image.width, first_image.height
    width, height = raw_width, raw_height
    plane_count = first_image.plane_count

    bg_method = "interpolated" if (bg1_image is not None and bg2_image is not None) else "none"
    bg_order_method = "filename"
    bg_weights = {name: (idx + 1) / (len(image_dict) + 1) for idx, name in enumerate(image_dict)}
    bg_weight_df = pd.DataFrame()
    bg_weight_source = "upload order"
    normalize_exposure = False
    transpose_image = False
    i0_mode = "none"
    i0_global_value = 1.0
    i0_table_df = pd.DataFrame()
    use_dark_frame = bool(dark_images)
    dark_frame = None
    dark_summary_df = pd.DataFrame()
    fix_hot_pixels = False
    hot_pixel_threshold = 8.0
    hot_pixel_window = 3
    projection = "columns"
    reducer = "sum"
    plane_index = 0
    x_roi = (0, max(0, width - 1))
    y_roi = (0, max(0, height - 1))
    sideband_enabled = False
    sideband_ranges = None
    sideband_stat = "mean"
    curvature_enabled = False
    curvature_fit_x_range = (0, max(0, width - 1))
    curvature_poly_order = 4
    curvature_cutoff = 1.9
    do_average = False
    show_individual = False
    smooth_method = "none"
    smooth_window = 11
    smooth_poly_deg = 3
    norm_method = "none"
    norm_x_start = float(x_roi[0])
    norm_x_end = float(x_roi[1])
    run_peak_detection = False
    peak_prom_ratio = 0.05
    peak_height_ratio = 0.03
    peak_distance_pixel = 5.0
    max_peak_labels = 12
    label_peaks = True
    axis_calibration = "pixel"
    energy_offset = 0.0
    energy_slope = 1.0
    energy_poly_coeffs: list[float] = []

    with st.sidebar:
        step_header(2, "前後背景影像扣除（BG1/BG2）")
        st.caption("主流程：BG1 是樣品前背景，BG2 是樣品後背景；多張 sample 會用分點法估計各自背景。")
        bg_method = st.selectbox(
            "BG1/BG2 扣除方法",
            ["none", "bg1", "bg2", "average", "interpolated"],
            index=4 if (bg1_image is not None and bg2_image is not None) else 0,
            format_func=lambda v: {
                "none": "不扣除",
                "bg1": "只扣 BG1",
                "bg2": "只扣 BG2",
                "average": "(BG1 + BG2) / 2",
                "interpolated": "分點法（建議）：BG1 + w(BG2 - BG1)",
            }[v],
            key="xes_bg_method",
        )
        if bg_method in ("bg1", "average", "interpolated") and bg1_image is None:
            st.warning("此方法需要 BG1 FITS。")
        if bg_method in ("bg2", "average", "interpolated") and bg2_image is None:
            st.warning("此方法需要 BG2 FITS。")
        if bg_method == "interpolated":
            bg_order_method = st.selectbox(
                "Sample 順序來源",
                ["time", "filename", "upload"],
                index=1,
                format_func=lambda v: {
                    "time": "FITS header 時間",
                    "filename": "檔名自然排序",
                    "upload": "上傳順序",
                }[v],
                key="xes_bg_order",
            )
            st.caption("分點權重：第 i 張 sample 會對應 BG1 與 BG2 之間的位置 w。")

        step_header(3, "影像修正")
        exposure_options = [
            _xes_exposure_seconds(img) for img in [first_image, bg1_image, bg2_image] if img is not None
        ]
        normalize_exposure = st.checkbox(
            "以 FITS EXPTIME 正規化（counts/sec）",
            value=bool(exposure_options),
            key="xes_norm_exposure",
        )
        transpose_image = st.checkbox(
            "Transpose array（若影像 row/column 與舊程式相反才啟用）",
            value=False,
            key="xes_transpose_image",
        )
        width, height = (raw_height, raw_width) if transpose_image else (raw_width, raw_height)
        x_roi = (0, max(0, width - 1))
        y_roi = (0, max(0, height - 1))
        i0_mode = st.selectbox(
            "I0 / incident flux 正規化",
            ["none", "global", "table"],
            format_func=lambda v: {
                "none": "不使用 I0",
                "global": "所有 sample 使用同一個 I0",
                "table": "上傳 CSV：每個 sample 對應 I0",
            }[v],
            key="xes_i0_mode",
        )
        if i0_mode == "global":
            i0_global_value = float(st.number_input(
                "I0 值", min_value=1e-12, value=1.0, step=1.0,
                format="%.9g", key="xes_i0_global",
            ))
            st.caption("光譜投影後會除以此 I0；若尚未有 I0 資料請保持不使用。")
        elif i0_mode == "table":
            i0_file = st.file_uploader(
                "I0 CSV（欄位可用 File/Filename/Sample + I0/Flux/Monitor）",
                type=["csv"],
                accept_multiple_files=False,
                key="xes_i0_table",
            )
            if i0_file is not None:
                i0_table_df, i0_err = _xes_i0_table_from_csv(i0_file)
                if i0_err:
                    st.warning(i0_err)
                elif i0_table_df.empty:
                    st.warning("I0 CSV 沒有可用的正值 I0。")
                else:
                    st.caption(f"已讀取 {len(i0_table_df)} 筆 I0 對照。")
        use_dark_frame = st.checkbox(
            "進階可選：扣除 Dark/Bias 平均影像",
            value=bool(dark_images),
            disabled=not bool(dark_images),
            key="xes_use_dark",
        )
        if dark_images:
            st.caption(f"已載入 {len(dark_images)} 張 Dark/Bias，套用時會先平均後再扣除。")
        else:
            st.caption("Dark/Bias 是 detector 校正檔，不是 BG1/BG2；教授或儀器沒有提供時請保持關閉。")
        if normalize_exposure and not exposure_options:
            st.warning("目前 FITS header 沒有可辨識的 EXPTIME / EXPOSURE。")
        if normalize_exposure:
            exposure_missing = [
                name for name, img in image_dict.items() if _xes_exposure_seconds(img) is None
            ]
            if bg1_image is not None and _xes_exposure_seconds(bg1_image) is None:
                exposure_missing.append("BG1")
            if bg2_image is not None and _xes_exposure_seconds(bg2_image) is None:
                exposure_missing.append("BG2")
            exposure_missing.extend(
                f"Dark/Bias:{name}" for name, img in dark_images.items()
                if _xes_exposure_seconds(img) is None
            )
            if exposure_missing:
                st.warning("以下 FITS 缺少曝光時間，會保留原始 counts：" + "、".join(exposure_missing))
        fix_hot_pixels = st.checkbox("修正 CCD hot pixels / 單點異常亮點", value=False, key="xes_fix_hot")
        if fix_hot_pixels:
            hot_pixel_threshold = float(st.slider(
                "hot pixel 門檻", 4.0, 30.0, 8.0, 0.5, key="xes_hot_threshold"
            ))
            hot_pixel_window = int(st.number_input(
                "局部 median 視窗", min_value=3, max_value=15, value=3, step=2, key="xes_hot_window"
            ))

        step_header(4, "ROI 與積分")
        if plane_count > 1:
            plane_index = int(st.number_input(
                "FITS plane", min_value=0, max_value=plane_count - 1, value=0, step=1, key="xes_plane"
            ))
        else:
            st.caption("FITS plane：0")

        projection = st.selectbox(
            "投影方向",
            ["columns", "rows"],
            format_func=lambda v: {
                "columns": "沿 Y 加總，輸出 column spectrum",
                "rows": "沿 X 加總，輸出 row spectrum",
            }[v],
            key="xes_projection",
        )
        reducer = st.selectbox(
            "ROI 積分方式",
            ["sum", "mean"],
            format_func=lambda v: {"sum": "加總", "mean": "平均"}[v],
            key="xes_reducer",
        )
        if width > 1:
            prev_x_roi = st.session_state.get("xes_x_roi", (0, width - 1))
            x0_safe = int(np.clip(min(prev_x_roi), 0, width - 1))
            x1_safe = int(np.clip(max(prev_x_roi), 0, width - 1))
            if x0_safe >= x1_safe:
                x0_safe, x1_safe = 0, width - 1
            st.session_state["xes_x_roi"] = (x0_safe, x1_safe)
            x_roi = st.slider("X ROI / column", 0, width - 1, (0, width - 1), key="xes_x_roi")
        if height > 1:
            prev_y_roi = st.session_state.get("xes_y_roi", (0, height - 1))
            y0_safe = int(np.clip(min(prev_y_roi), 0, height - 1))
            y1_safe = int(np.clip(max(prev_y_roi), 0, height - 1))
            if y0_safe >= y1_safe:
                y0_safe, y1_safe = 0, height - 1
            st.session_state["xes_y_roi"] = (y0_safe, y1_safe)
            y_roi = st.slider("Y ROI / row", 0, height - 1, (0, height - 1), key="xes_y_roi")
        sideband_enabled = st.checkbox(
            "進階可選：啟用 side-band background subtraction",
            value=False,
            key="xes_sideband_enabled",
        )
        if sideband_enabled:
            if projection == "columns":
                band_axis_label = "Y / row"
                band_max = height - 1
                signal_band = y_roi
            else:
                band_axis_label = "X / column"
                band_max = width - 1
                signal_band = x_roi
            if band_max <= 0:
                sideband_enabled = False
                st.warning("目前影像尺寸太小，無法選擇 side-band ROI。")
            else:
                default_band_a, default_band_b = _xes_default_sideband_ranges(signal_band, band_max)
                st.caption("Side-band 是同一張 sample 影像裡 signal ROI 旁邊的背景區，不是 BG1/BG2；教授未要求時建議先不要啟用。")
                sideband_a = st.slider(
                    f"Side-band A ({band_axis_label})",
                    0, band_max, default_band_a,
                    key="xes_sideband_a",
                )
                sideband_b = st.slider(
                    f"Side-band B ({band_axis_label})",
                    0, band_max, default_band_b,
                    key="xes_sideband_b",
                )
                sideband_ranges = (sideband_a, sideband_b)
                sideband_stat = st.selectbox(
                    "Side-band 統計",
                    ["mean", "median"],
                    format_func=lambda v: {"mean": "平均值", "median": "中位數"}[v],
                    key="xes_sideband_stat",
                )

        step_header(5, "曲率校正 / 影像拉直")
        curvature_enabled = st.checkbox(
            "啟用 find curvature → shift image",
            value=False,
            disabled=(projection != "columns"),
            key="xes_curvature_enabled",
        )
        if projection != "columns":
            st.caption("曲率校正目前依舊程式流程支援 column spectrum；若要使用請將投影方向設為 columns。")
            curvature_enabled = False
        if curvature_enabled:
            st.caption("流程：先用目前 row ROI 做 Sum，看主峰位置後設定 fitting column 範圍，再逐 row 找峰中心並拉直影像。")
            if width > 2:
                prev_curve_range = st.session_state.get(
                    "xes_curvature_x_range", (int(min(x_roi)), int(max(x_roi))),
                )
                curve0_safe = int(np.clip(min(prev_curve_range), int(min(x_roi)), int(max(x_roi))))
                curve1_safe = int(np.clip(max(prev_curve_range), int(min(x_roi)), int(max(x_roi))))
                if curve1_safe - curve0_safe < 2:
                    curve0_safe, curve1_safe = int(min(x_roi)), int(max(x_roi))
                st.session_state["xes_curvature_x_range"] = (curve0_safe, curve1_safe)
                curvature_fit_x_range = st.slider(
                    "曲率 fitting column 範圍",
                    0, width - 1,
                    (int(min(x_roi)), int(max(x_roi))),
                    key="xes_curvature_x_range",
                )
            curvature_poly_order = int(st.number_input(
                "polynomial order", min_value=1, max_value=6, value=4, step=1,
                key="xes_curvature_order",
            ))
            curvature_cutoff = float(st.number_input(
                "cutoff（弱峰/離群 row 篩選）", min_value=0.1, max_value=20.0,
                value=1.9, step=0.1, format="%.2f", key="xes_curvature_cutoff",
            ))

        step_header(6, "多檔平均")
        do_average = st.checkbox("對所有 FITS 投影光譜做平均", value=False, key="xes_do_avg")
        if do_average:
            show_individual = st.checkbox("疊加顯示個別光譜", value=False, key="xes_show_ind")

        step_header(7, "平滑")
        smooth_method = st.selectbox(
            "方法",
            ["none", "moving_average", "savitzky_golay"],
            format_func=lambda v: {
                "none": "不平滑",
                "moving_average": "移動平均",
                "savitzky_golay": "Savitzky-Golay",
            }[v],
            key="xes_smooth_method",
        )
        if smooth_method != "none":
            smooth_window = int(st.number_input(
                "視窗點數", min_value=3, max_value=301, value=11, step=2, key="xes_smooth_window"
            ))
        if smooth_method == "savitzky_golay":
            smooth_poly_deg = int(st.slider("多項式階數", 2, 5, 3, key="xes_smooth_poly"))

        step_header(8, "歸一化")
        axis_start = float(x_roi[0] if projection == "columns" else y_roi[0])
        axis_end = float(x_roi[1] if projection == "columns" else y_roi[1])
        norm_method = st.selectbox(
            "方法",
            ["none", "max", "min_max", "area"],
            format_func=lambda v: {
                "none": "不歸一化",
                "max": "峰值歸一化（可選區間）",
                "min_max": "Min-Max (0~1)",
                "area": "面積歸一化（總面積 = 1）",
            }[v],
            key="xes_norm_method",
        )
        if norm_method == "max" and axis_end > axis_start:
            norm_range = st.slider(
                "歸一化參考區間 (pixel)",
                min_value=axis_start,
                max_value=axis_end,
                value=(axis_start, axis_end),
                step=1.0,
                format="%.0f",
                key="xes_norm_range",
            )
            norm_x_start = float(min(norm_range))
            norm_x_end = float(max(norm_range))

        step_header(9, "X 軸校正")
        axis_calibration = st.selectbox(
            "X 軸顯示",
            ["pixel", "linear", "reference_points"],
            format_func=lambda v: {
                "pixel": "Detector pixel",
                "linear": "線性係數：E = E0 + slope × pixel",
                "reference_points": "參考點擬合 pixel → eV",
            }[v],
            key="xes_axis_calibration",
        )
        if axis_calibration == "linear":
            energy_offset = float(st.number_input(
                "E0 (eV)", value=0.0, step=1.0, format="%.6f", key="xes_energy_offset"
            ))
            energy_slope = float(st.number_input(
                "slope (eV / pixel)", value=1.0, step=0.001, format="%.9f", key="xes_energy_slope"
            ))
        elif axis_calibration == "reference_points":
            cal_degree = int(st.selectbox("擬合階數", [1, 2], format_func=lambda v: "linear" if v == 1 else "quadratic", key="xes_cal_degree"))
            cal_points_file = st.file_uploader(
                "可選：上傳校正點 CSV（Pixel, Energy_eV）",
                type=["csv"],
                accept_multiple_files=False,
                key="xes_cal_points_csv",
            )
            default_cal_df = pd.DataFrame({
                "Pixel": [np.nan] * (cal_degree + 1),
                "Energy_eV": [np.nan] * (cal_degree + 1),
            })
            if cal_points_file is not None:
                uploaded_cal_df, cal_err = _xes_calibration_points_from_csv(cal_points_file)
                if cal_err:
                    st.warning(cal_err)
                elif uploaded_cal_df.empty:
                    st.warning("校正點 CSV 沒有可用的 pixel / energy 數值。")
                else:
                    default_cal_df = uploaded_cal_df
                    st.caption(f"已從 CSV 讀取 {len(uploaded_cal_df)} 個校正點。")
            cal_df = st.data_editor(
                default_cal_df,
                num_rows="dynamic",
                key="xes_cal_points",
                hide_index=True,
            )
            energy_poly_coeffs = _xes_calibration_coeffs(cal_df, cal_degree)
            if energy_poly_coeffs:
                coeff_text = ", ".join(f"{c:.6g}" for c in energy_poly_coeffs)
                st.caption(f"校正係數 np.polyval 順序：{coeff_text}")
            else:
                st.warning("請至少填入足夠的 pixel / energy 參考點。")

        step_header(10, "峰值偵測")
        run_peak_detection = st.checkbox("啟用峰值偵測", value=False, key="xes_run_peaks")
        if run_peak_detection:
            peak_prom_ratio = float(st.slider(
                "最小顯著度（相對）", 0.0, 1.0, 0.05, 0.01, key="xes_peak_prominence"
            ))
            peak_height_ratio = float(st.slider(
                "最小高度（相對最大值）", 0.0, 1.0, 0.03, 0.01, key="xes_peak_height"
            ))
            peak_distance_pixel = float(st.number_input(
                "最小峰距 (pixel)",
                min_value=1.0,
                max_value=max(1.0, axis_end - axis_start),
                value=min(5.0, max(1.0, axis_end - axis_start)),
                step=1.0,
                format="%.0f",
                key="xes_peak_distance",
            ))
            max_peak_labels = int(st.number_input(
                "最多標記峰數", min_value=1, max_value=50, value=12, step=1, key="xes_peak_max"
            ))
            label_peaks = st.checkbox("標示峰位數值", value=True, key="xes_peak_labels")

    if bg_method == "interpolated" and bg1_image is not None and bg2_image is not None:
        bg_weights, bg_weight_df, bg_weight_source = _xes_bg_weights(
            image_dict, bg1_image, bg2_image, bg_order_method,
        )
        st.caption(f"XES 分點背景扣除使用順序來源：{bg_weight_source}")
        if not bg_weight_df.empty:
            st.dataframe(
                bg_weight_df.round({"Weight_w": 4, "Raw_w": 4}),
                use_container_width=True,
                hide_index=True,
            )
    else:
        bg_weights = {name: 0.5 for name in image_dict}

    if use_dark_frame and dark_images:
        try:
            dark_frame, dark_summary_df = _xes_average_frame(
                dark_images, plane_index, normalize_exposure, transpose_image,
            )
            st.caption(f"Dark/Bias：已平均 {len(dark_images)} 張影像，並在 BG1/BG2 扣除前先套用。")
        except Exception as exc:
            st.error(f"Dark/Bias frame 準備失敗：{exc}")
            st.stop()

    preview_curve_df = pd.DataFrame()
    preview_curvature_coeffs: list[float] = []
    preview_reference_center = None
    try:
        preview_raw = _xes_corrected_array(
            first_image, plane_index, bg1_image, bg2_image,
            bg_method, bg_weights.get(first_name, 0.5),
            normalize_exposure=normalize_exposure,
            dark_frame=dark_frame,
            transpose_image=transpose_image,
        )
        preview, preview_hot_mask = _xes_fix_hot_pixels(
            preview_raw, fix_hot_pixels,
            threshold=hot_pixel_threshold, window_size=hot_pixel_window,
        )
        if curvature_enabled:
            try:
                preview, preview_curve_df, preview_curvature_coeffs, preview_reference_center = (
                    _xes_apply_curvature_correction(
                        preview, True, x_roi, y_roi, curvature_fit_x_range,
                        curvature_poly_order, curvature_cutoff,
                    )
                )
                st.caption(
                    "曲率校正 preview："
                    f"使用 {int(preview_curve_df['Used_In_Fit'].sum())} / {len(preview_curve_df)} rows，"
                    f"reference column = {preview_reference_center:.2f}"
                )
            except Exception as exc:
                st.warning(f"曲率校正 preview 失敗，暫用未拉直影像：{exc}")
    except Exception as exc:
        st.error(f"背景扣除失敗：{exc}")
        st.stop()

    intensity_title = "Counts / s" if normalize_exposure else "Counts"
    if i0_mode != "none":
        intensity_title += " / I0"
    use_energy_axis = (
        axis_calibration == "linear"
        or (axis_calibration == "reference_points" and bool(energy_poly_coeffs))
    )
    axis_title = "Emission Energy (eV)" if use_energy_axis else (
        "Detector column (pixel)" if projection == "columns" else "Detector row (pixel)"
    )

    finite_preview = preview[np.isfinite(preview)]
    if len(finite_preview):
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("影像尺寸", f"{width} × {height}")
        c2.metric("Plane", f"{plane_index + 1} / {plane_count}")
        c3.metric("最大值", f"{float(np.nanmax(finite_preview)):.3g}")
        c4.metric("修正熱點", f"{int(np.count_nonzero(preview_hot_mask))}")
        c5.metric("曲率校正", "ON" if curvature_enabled and not preview_curve_df.empty else "OFF")

    fig_img = go.Figure()
    fig_img.add_trace(go.Heatmap(
        z=preview,
        colorscale="Viridis",
        colorbar=dict(title=intensity_title),
        hovertemplate="x=%{x}<br>y=%{y}<br>counts=%{z}<extra></extra>",
    ))
    fig_img.add_shape(
        type="rect",
        x0=x_roi[0] - 0.5,
        x1=x_roi[1] + 0.5,
        y0=y_roi[0] - 0.5,
        y1=y_roi[1] + 0.5,
        line=dict(color="#FFD166", width=2),
    )
    if sideband_enabled and sideband_ranges:
        for band_range in sideband_ranges:
            if projection == "columns":
                x0_shape, x1_shape = x_roi[0] - 0.5, x_roi[1] + 0.5
                y0_shape, y1_shape = min(band_range) - 0.5, max(band_range) + 0.5
            else:
                x0_shape, x1_shape = min(band_range) - 0.5, max(band_range) + 0.5
                y0_shape, y1_shape = y_roi[0] - 0.5, y_roi[1] + 0.5
            fig_img.add_shape(
                type="rect",
                x0=x0_shape,
                x1=x1_shape,
                y0=y0_shape,
                y1=y1_shape,
                line=dict(color="#19D3F3", width=1.5, dash="dash"),
            )
    if curvature_enabled:
        fig_img.add_shape(
            type="rect",
            x0=curvature_fit_x_range[0] - 0.5,
            x1=curvature_fit_x_range[1] + 0.5,
            y0=y_roi[0] - 0.5,
            y1=y_roi[1] + 0.5,
            line=dict(color="#FF6692", width=1.5, dash="dot"),
        )
    fig_img.update_layout(
        title=(
            f"FITS preview: {first_name}"
            + ("（已扣背景）" if bg_method != "none" else "")
            + ("（已曲率校正）" if curvature_enabled and not preview_curve_df.empty else "")
        ),
        xaxis_title="Column pixel",
        yaxis_title="Row pixel",
        yaxis=dict(autorange="reversed"),
        template="plotly_dark",
        height=460,
        margin=dict(l=50, r=20, t=60, b=50),
    )
    st.plotly_chart(fig_img, use_container_width=True)

    fig_raw = go.Figure()
    fig_norm = go.Figure()
    export_frames: dict[str, pd.DataFrame] = {}
    peak_tables: list[pd.DataFrame] = []
    hot_pixel_notes: list[str] = []
    i0_notes: list[str] = []
    curvature_tables: list[pd.DataFrame] = []
    curvature_notes: list[str] = []

    extracted = {}
    for fname, image in image_dict.items():
        try:
            corrected_raw = _xes_corrected_array(
                image, plane_index, bg1_image, bg2_image,
                bg_method, bg_weights.get(fname, 0.5),
                normalize_exposure=normalize_exposure,
                dark_frame=dark_frame,
                transpose_image=transpose_image,
            )
            corrected_arr, hot_mask = _xes_fix_hot_pixels(
                corrected_raw, fix_hot_pixels,
                threshold=hot_pixel_threshold, window_size=hot_pixel_window,
            )
            curvature_applied = False
            if curvature_enabled:
                try:
                    corrected_arr, curve_df, coeffs, ref_center = _xes_apply_curvature_correction(
                        corrected_arr, True, x_roi, y_roi, curvature_fit_x_range,
                        curvature_poly_order, curvature_cutoff,
                    )
                    if not curve_df.empty:
                        curve_df = curve_df.copy()
                        curve_df.insert(0, "Dataset", fname)
                        curvature_tables.append(curve_df)
                    curvature_notes.append(
                        f"{fname}：fit {int(curve_df['Used_In_Fit'].sum())}/{len(curve_df)} rows，"
                        f"ref={ref_center:.2f}"
                    )
                    curvature_applied = True
                except Exception as exc:
                    curvature_notes.append(f"{fname}：曲率校正失敗，使用未拉直影像（{exc}）")
            x_vals, y_vals, signal_vals, side_bg_vals, _ = _extract_xes_spectrum_with_sideband(
                corrected_arr, x_roi, y_roi, projection, reducer,
                sideband_enabled=sideband_enabled,
                sideband_ranges=sideband_ranges,
                sideband_stat=sideband_stat,
            )
            i0_value = _xes_lookup_i0_value(fname, i0_mode, i0_global_value, i0_table_df)
            if i0_mode != "none":
                if i0_value is None:
                    i0_notes.append(f"{fname}：未找到 I0，保留原值")
                else:
                    y_vals, signal_vals, side_bg_vals = _xes_apply_i0_to_spectra(
                        (y_vals, signal_vals, side_bg_vals), i0_value,
                    )
                    i0_notes.append(f"{fname}：I0={i0_value:.6g}")
            extracted[fname] = (x_vals, y_vals, signal_vals, side_bg_vals, i0_value, curvature_applied)
            if fix_hot_pixels:
                hot_pixel_notes.append(f"{fname}：修正 {int(np.count_nonzero(hot_mask))} 點")
        except Exception as exc:
            st.warning(f"{fname}：背景扣除或投影失敗，已跳過。{exc}")

    if hot_pixel_notes:
        st.caption("Hot pixel 修正摘要：" + "；".join(hot_pixel_notes))
    if i0_notes:
        st.caption("I0 正規化摘要：" + "；".join(i0_notes))
    if curvature_notes:
        st.caption("曲率校正摘要：" + "；".join(curvature_notes))

    if do_average:
        average_records = []
        for fname, (x_vals, y_vals, signal_vals, side_bg_vals, i0_value, curvature_applied) in extracted.items():
            coord_axis = (
                _xes_apply_axis_calibration(x_vals, axis_calibration, energy_offset, energy_slope, energy_poly_coeffs)
                if use_energy_axis else x_vals
            )
            clean_coord, _ = _xes_sorted_finite_xy(coord_axis, y_vals)
            if len(clean_coord) >= 2:
                average_records.append({
                    "name": fname,
                    "pixel": x_vals,
                    "coord": coord_axis,
                    "y": y_vals,
                    "signal": signal_vals,
                    "side_bg": side_bg_vals,
                    "i0": i0_value,
                    "curvature_applied": curvature_applied,
                })

        ranges = [
            (float(np.nanmin(rec["coord"])), float(np.nanmax(rec["coord"])))
            for rec in average_records
        ]
        if not ranges:
            st.warning("沒有足夠資料可平均。")
        else:
            avg_start = max(r[0] for r in ranges)
            avg_end = min(r[1] for r in ranges)
            if avg_start >= avg_end:
                overlap_unit = "energy" if use_energy_axis else "pixel"
                st.warning(f"多檔平均需要共同 {overlap_unit} 範圍，目前沒有重疊區間。")
            else:
                if use_energy_axis:
                    point_count = min(len(_xes_sorted_finite_xy(rec["coord"], rec["y"])[0]) for rec in average_records)
                    point_count = int(np.clip(point_count, 2, 20000))
                    new_axis = np.linspace(avg_start, avg_end, point_count, dtype=float)
                    first_coord, first_pixel = _xes_sorted_finite_xy(
                        average_records[0]["coord"], average_records[0]["pixel"],
                    )
                    new_x = np.interp(new_axis, first_coord, first_pixel)
                    interp_axis_label = "energy"
                    st.caption(f"多檔平均：已先將各檔轉成 energy，再插值到共同 energy grid（{point_count} 點）。")
                else:
                    new_x = np.arange(int(math.ceil(avg_start)), int(math.floor(avg_end)) + 1, dtype=float)
                    new_axis = new_x
                    interp_axis_label = "pixel"
                all_interp = []
                all_signal_interp = []
                all_side_bg_interp = []
                for i, rec in enumerate(average_records):
                    fname = rec["name"]
                    target_axis = new_axis if use_energy_axis else new_x
                    source_axis = rec["coord"] if use_energy_axis else rec["pixel"]
                    interp_y = _xes_interp_to_axis(source_axis, rec["y"], target_axis)
                    interp_signal = _xes_interp_to_axis(source_axis, rec["signal"], target_axis)
                    interp_side_bg = _xes_interp_to_axis(source_axis, rec["side_bg"], target_axis)
                    if not np.all(np.isfinite(interp_y)):
                        continue
                    all_interp.append(interp_y)
                    all_signal_interp.append(interp_signal)
                    all_side_bg_interp.append(interp_side_bg)
                    if show_individual:
                        fig_raw.add_trace(go.Scatter(
                            x=new_axis, y=interp_y, mode="lines", name=fname,
                            line=dict(color=XES_COLORS[i % len(XES_COLORS)], width=1, dash="dot"),
                            opacity=0.35,
                        ))

                if all_interp:
                    raw_signal = np.mean(np.vstack(all_interp), axis=0)
                    avg_signal_roi = np.mean(np.vstack(all_signal_interp), axis=0)
                    avg_side_bg = np.mean(np.vstack(all_side_bg_interp), axis=0)
                    if sideband_enabled:
                        raw_label = "Average（side-band 扣除後）"
                    elif bg_method != "none" or dark_frame is not None:
                        raw_label = "Average（影像校正後）"
                    else:
                        raw_label = "Average（原始）"
                    smooth_signal_vals = smooth_signal(
                        raw_signal, smooth_method,
                        window_points=smooth_window, poly_deg=smooth_poly_deg,
                    )
                    final_signal = apply_normalization(
                        new_x, smooth_signal_vals, norm_method,
                        norm_x_start=norm_x_start, norm_x_end=norm_x_end,
                    )
                    plot_signal = final_signal if norm_method != "none" else smooth_signal_vals

                    if smooth_method != "none":
                        fig_raw.add_trace(go.Scatter(
                            x=new_axis, y=raw_signal, mode="lines", name=raw_label,
                            line=dict(color="white", width=1.4, dash="dash"), opacity=0.55,
                        ))
                    fig_raw.add_trace(go.Scatter(
                        x=new_axis, y=smooth_signal_vals, mode="lines",
                        name="Average（平滑後）" if smooth_method != "none" else raw_label,
                        line=dict(color="#EF553B", width=2.4),
                    ))
                    if norm_method != "none":
                        fig_norm.add_trace(go.Scatter(
                            x=new_axis, y=final_signal, mode="lines", name="Average（歸一化後）",
                            line=dict(color="#EF553B", width=2.4),
                        ))

                    peak_signal = plot_signal
                    if run_peak_detection:
                        peak_idx = _detect_spectrum_peaks(
                            new_x, peak_signal, peak_prom_ratio,
                            peak_height_ratio, peak_distance_pixel, max_peak_labels,
                        )
                        peak_table = _build_xes_peak_table(
                            "Average", new_x, peak_signal, peak_idx,
                            energy_x=new_axis if use_energy_axis else None,
                        )
                        if not peak_table.empty:
                            peak_tables.append(peak_table)
                            target_fig = fig_norm if norm_method != "none" else fig_raw
                            peak_x_vals = peak_table["Energy_eV"] if use_energy_axis else peak_table["Pixel"]
                            peak_labels = (
                                [f"{v:.2f}" for v in peak_table["Energy_eV"]]
                                if use_energy_axis else [f"{v:.0f}" for v in peak_table["Pixel"]]
                            )
                            target_fig.add_trace(go.Scatter(
                                x=peak_x_vals,
                                y=peak_table["Intensity"],
                                mode="markers+text" if label_peaks else "markers",
                                name="Average 峰位",
                                text=peak_labels if label_peaks else None,
                                textposition="top center",
                                textfont=dict(size=10),
                                marker=dict(color="#FFD166", size=10, symbol="x"),
                            ))

                    row = {
                        "Pixel": new_x,
                        "Average_grid": np.full(new_x.shape, interp_axis_label, dtype=object),
                        "Average_sideband_corrected" if sideband_enabled else (
                            "Average_bg_corrected" if bg_method != "none" or dark_frame is not None else "Average_raw"
                        ): raw_signal,
                        "Average_smoothed": smooth_signal_vals,
                    }
                    if sideband_enabled:
                        row["Average_signal_roi_projection"] = avg_signal_roi
                        row["Average_sideband_background_scaled"] = avg_side_bg
                    if curvature_enabled:
                        used_curvature = [rec["curvature_applied"] for rec in average_records]
                        row["Curvature_corrected_fraction"] = np.full(
                            new_x.shape, float(np.mean(used_curvature)) if used_curvature else 0.0,
                            dtype=float,
                        )
                    if transpose_image:
                        row["Transposed"] = np.full(new_x.shape, True, dtype=bool)
                    if use_energy_axis:
                        row["Energy_eV"] = new_axis
                    if bg_method == "interpolated":
                        used_weights = [bg_weights.get(fname, np.nan) for fname in extracted]
                        row["Background_weight_w_mean"] = np.full_like(
                            new_x, float(np.nanmean(used_weights)), dtype=float
                        )
                    if i0_mode != "none":
                        used_i0 = [rec["i0"] for rec in average_records if rec["i0"] is not None]
                        row["I0_mean"] = np.full_like(
                            new_x, float(np.nanmean(used_i0)) if used_i0 else np.nan, dtype=float
                        )
                    if norm_method != "none":
                        row["Average_normalized"] = final_signal
                    export_frames["Average"] = pd.DataFrame(row)
    else:
        for i, (fname, (x_vals, y_vals, signal_vals, side_bg_vals, i0_value, curvature_applied)) in enumerate(extracted.items()):
            color = XES_COLORS[i % len(XES_COLORS)]
            x_axis = _xes_apply_axis_calibration(
                x_vals, axis_calibration, energy_offset, energy_slope, energy_poly_coeffs
            )
            smooth_signal_vals = smooth_signal(
                y_vals, smooth_method,
                window_points=smooth_window, poly_deg=smooth_poly_deg,
            )
            final_signal = apply_normalization(
                x_vals, smooth_signal_vals, norm_method,
                norm_x_start=norm_x_start, norm_x_end=norm_x_end,
            )
            plot_signal = final_signal if norm_method != "none" else smooth_signal_vals

            if smooth_method != "none":
                fig_raw.add_trace(go.Scatter(
                    x=x_axis, y=y_vals, mode="lines",
                    name=f"{fname}（side-band 扣除後）" if sideband_enabled else (
                        f"{fname}（影像校正後）" if bg_method != "none" or dark_frame is not None else f"{fname}（原始）"
                    ),
                    line=dict(color=color, width=1.3, dash="dash"), opacity=0.45,
                ))
            fig_raw.add_trace(go.Scatter(
                x=x_axis, y=smooth_signal_vals, mode="lines",
                name=f"{fname}（平滑後）" if smooth_method != "none" else (
                    f"{fname}（side-band 扣除後）" if sideband_enabled else (
                        f"{fname}（影像校正後）" if bg_method != "none" or dark_frame is not None else fname
                    )
                ),
                line=dict(color=color, width=2),
            ))

            if norm_method != "none":
                fig_norm.add_trace(go.Scatter(
                    x=x_axis, y=final_signal, mode="lines", name=f"{fname}（歸一化後）",
                    line=dict(color=color, width=2),
                ))

            if run_peak_detection:
                peak_idx = _detect_spectrum_peaks(
                    x_vals, plot_signal, peak_prom_ratio,
                    peak_height_ratio, peak_distance_pixel, max_peak_labels,
                )
                peak_table = _build_xes_peak_table(
                    fname, x_vals, plot_signal, peak_idx,
                    energy_x=x_axis if use_energy_axis else None,
                )
                if not peak_table.empty:
                    peak_tables.append(peak_table)
                    target_fig = fig_norm if norm_method != "none" else fig_raw
                    peak_x_vals = peak_table["Energy_eV"] if use_energy_axis else peak_table["Pixel"]
                    peak_labels = (
                        [f"{v:.2f}" for v in peak_table["Energy_eV"]]
                        if use_energy_axis else [f"{v:.0f}" for v in peak_table["Pixel"]]
                    )
                    target_fig.add_trace(go.Scatter(
                        x=peak_x_vals,
                        y=peak_table["Intensity"],
                        mode="markers+text" if label_peaks else "markers",
                        name=f"{fname} 峰位",
                        text=peak_labels if label_peaks else None,
                        textposition="top center",
                        textfont=dict(size=10),
                        marker=dict(color=color, size=9, symbol="x"),
                    ))

            row = {
                "Pixel": x_vals,
                "Intensity_sideband_corrected" if sideband_enabled else (
                    "Intensity_bg_corrected" if bg_method != "none" or dark_frame is not None else "Intensity_raw"
                ): y_vals,
                "Intensity_smoothed": smooth_signal_vals,
            }
            if sideband_enabled:
                row["Signal_ROI_projection"] = signal_vals
                row["Sideband_background_scaled"] = side_bg_vals
            if curvature_enabled:
                row["Curvature_corrected"] = np.full(x_vals.shape, curvature_applied, dtype=bool)
            if transpose_image:
                row["Transposed"] = np.full(x_vals.shape, True, dtype=bool)
            if use_energy_axis:
                row["Energy_eV"] = x_axis
            if bg_method == "interpolated":
                row["Background_weight_w"] = np.full_like(x_vals, bg_weights.get(fname, np.nan), dtype=float)
            if i0_mode != "none":
                row["I0"] = np.full_like(x_vals, i0_value if i0_value is not None else np.nan, dtype=float)
            if norm_method != "none":
                row["Intensity_normalized"] = final_signal
            export_frames[fname] = pd.DataFrame(row)

    fig_raw.update_layout(
        xaxis_title=axis_title,
        yaxis_title=intensity_title,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        template="plotly_dark",
        height=460,
        margin=dict(l=50, r=20, t=60, b=50),
    )
    st.plotly_chart(fig_raw, use_container_width=True)

    if norm_method != "none":
        fig_norm.update_layout(
            xaxis_title=axis_title,
            yaxis_title="Normalized intensity",
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            template="plotly_dark",
            height=400,
            margin=dict(l=50, r=20, t=40, b=50),
        )
        st.plotly_chart(fig_norm, use_container_width=True)

    peak_export_df = pd.concat(peak_tables, ignore_index=True) if peak_tables else pd.DataFrame()
    if run_peak_detection:
        if peak_export_df.empty:
            st.info("目前條件下未偵測到 XES 峰值。")
        else:
            st.subheader("峰值列表")
            st.dataframe(
                peak_export_df.copy().round({
                    "Pixel": 3,
                    "Energy_eV": 4,
                    "Intensity": 4,
                    "Relative_Intensity_pct": 2,
                    "FWHM_pixel": 3,
                    "FWHM_eV": 4,
                }),
                use_container_width=True,
                hide_index=True,
            )

    with st.expander("FITS header 摘要"):
        header_rows = []
        for key in ("SIMPLE", "BITPIX", "NAXIS", "NAXIS1", "NAXIS2", "BSCALE", "BZERO", "EXPTIME", "DATE-OBS", "TIME-OBS", "MJD-OBS"):
            if key in first_image.header:
                header_rows.append({"Keyword": key, "Value": first_image.header[key]})
        st.dataframe(pd.DataFrame(header_rows), use_container_width=True, hide_index=True)

    if use_dark_frame and not dark_summary_df.empty:
        with st.expander("Dark/Bias frame 摘要"):
            st.dataframe(
                dark_summary_df.round({"Exposure_s": 4, "Mean": 4, "Median": 4}),
                use_container_width=True,
                hide_index=True,
            )

    curvature_export_df = pd.concat(curvature_tables, ignore_index=True) if curvature_tables else pd.DataFrame()
    if curvature_enabled:
        with st.expander("曲率校正 / image straightening 摘要"):
            if preview_curve_df.empty:
                st.info("目前沒有可顯示的曲率校正結果。")
            else:
                coeff_text = ", ".join(f"{c:.6g}" for c in preview_curvature_coeffs)
                st.caption(
                    f"Preview polynomial coefficients（np.polyval 順序）：{coeff_text}；"
                    f"reference column = {preview_reference_center:.3f}"
                )
                fig_curve = go.Figure()
                accepted_df = preview_curve_df[preview_curve_df["Accepted"]]
                used_df = preview_curve_df[preview_curve_df["Used_In_Fit"]]
                fig_curve.add_trace(go.Scatter(
                    x=accepted_df["Peak_Center_Column"],
                    y=accepted_df["Row"],
                    mode="markers",
                    name="detected center",
                    marker=dict(color="#FFD166", size=6),
                ))
                fig_curve.add_trace(go.Scatter(
                    x=used_df["Fitted_Center_Column"],
                    y=used_df["Row"],
                    mode="lines",
                    name="polynomial fit",
                    line=dict(color="#FF6692", width=2),
                ))
                fig_curve.update_layout(
                    xaxis_title="Peak center column",
                    yaxis_title="Row",
                    yaxis=dict(autorange="reversed"),
                    template="plotly_dark",
                    height=320,
                    margin=dict(l=50, r=20, t=30, b=50),
                )
                st.plotly_chart(fig_curve, use_container_width=True)
                st.dataframe(
                    preview_curve_df.round({
                        "Peak_Center_Column": 3,
                        "Peak_Height": 3,
                        "SNR": 3,
                        "Fitted_Center_Column": 3,
                        "Shift_Column": 3,
                    }),
                    use_container_width=True,
                    hide_index=True,
                )

    if bg_method == "interpolated" and not bg_weight_df.empty:
        weight_name = st.text_input("分點權重表檔名", value="xes_bg_weights", key="xes_bg_weight_fname")
        st.download_button(
            "⬇️ 下載分點權重表 CSV",
            data=bg_weight_df.to_csv(index=False).encode("utf-8"),
            file_name=f"{(weight_name or 'xes_bg_weights').strip()}.csv",
            mime="text/csv",
            key="xes_bg_weight_dl",
        )

    if curvature_enabled and not curvature_export_df.empty:
        curve_name = st.text_input("曲率校正表檔名", value="xes_curvature", key="xes_curve_fname")
        st.download_button(
            "⬇️ 下載曲率校正表 CSV",
            data=curvature_export_df.to_csv(index=False).encode("utf-8"),
            file_name=f"{(curve_name or 'xes_curvature').strip()}.csv",
            mime="text/csv",
            key="xes_curve_dl",
        )

    if export_frames or not peak_export_df.empty:
        st.subheader("匯出")
        curve_items = list(export_frames.items())
        for start in range(0, len(curve_items), 4):
            row_items = curve_items[start:start + 4]
            row_cols = st.columns(len(row_items))
            for col, (fname, df) in zip(row_cols, row_items):
                base = fname.rsplit(".", 1)[0]
                out_name = col.text_input(
                    "檔名", value=f"{base}_xes_spectrum",
                    key=f"xes_fname_{fname}", label_visibility="collapsed",
                )
                col.download_button(
                    "⬇️ 下載光譜 CSV",
                    data=df.to_csv(index=False).encode("utf-8"),
                    file_name=f"{(out_name or base + '_xes_spectrum').strip()}.csv",
                    mime="text/csv",
                    key=f"xes_dl_{fname}",
                )

        if not peak_export_df.empty:
            peak_name = st.text_input("峰值列表檔名", value="xes_peaks", key="xes_peak_fname")
            st.download_button(
                "⬇️ 下載峰值列表 CSV",
                data=peak_export_df.to_csv(index=False).encode("utf-8"),
                file_name=f"{(peak_name or 'xes_peaks').strip()}.csv",
                mime="text/csv",
                key="xes_peak_dl",
            )


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


def _two_theta_to_d_spacing(two_theta_deg: np.ndarray, wavelength_angstrom: float) -> np.ndarray:
    two_theta_deg = np.asarray(two_theta_deg, dtype=float)
    if wavelength_angstrom <= 0:
        return np.full_like(two_theta_deg, np.nan, dtype=float)

    theta_rad = np.deg2rad(two_theta_deg / 2.0)
    denom = 2.0 * np.sin(theta_rad)
    with np.errstate(divide="ignore", invalid="ignore"):
        d_spacing = np.where(denom > 0, wavelength_angstrom / denom, np.nan)
    return d_spacing


def _d_spacing_to_two_theta(d_spacing_A: np.ndarray, wavelength_angstrom: float) -> np.ndarray:
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


def _xrd_axis_values(two_theta_deg: np.ndarray, axis_mode: str,
                     wavelength_angstrom: float) -> np.ndarray:
    if axis_mode == "d_spacing":
        return _two_theta_to_d_spacing(two_theta_deg, wavelength_angstrom)
    return np.asarray(two_theta_deg, dtype=float)


def _build_xrd_reference_df(selected_phases: list[str], wavelength_angstrom: float,
                            min_rel_intensity: float,
                            two_theta_min: float, two_theta_max: float) -> pd.DataFrame:
    rows = []
    for phase_name in selected_phases:
        phase = XRD_REFERENCES.get(phase_name)
        if not phase:
            continue
        for pk in phase.get("peaks", []):
            d_spacing = float(pk["d"])
            two_theta = float(_d_spacing_to_two_theta(np.array([d_spacing]), wavelength_angstrom)[0])
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


def _match_xrd_reference_peaks(reference_df: pd.DataFrame, observed_df: pd.DataFrame,
                               tolerance_deg: float) -> pd.DataFrame:
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


def _detect_xrd_peaks(
    x: np.ndarray,
    y: np.ndarray,
    prominence_ratio: float,
    height_ratio: float,
    min_distance_deg: float,
    max_peaks: int,
) -> np.ndarray:
    return _detect_spectrum_peaks(
        x, y, prominence_ratio, height_ratio, min_distance_deg, max_peaks
    )


def _build_xrd_peak_table(dataset: str, x: np.ndarray, y: np.ndarray,
                          peak_idx: np.ndarray,
                          wavelength_angstrom: float) -> pd.DataFrame:
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
    peak_d = _two_theta_to_d_spacing(peak_x, wavelength_angstrom)

    return pd.DataFrame({
        "Dataset": dataset,
        "Peak": np.arange(1, len(peak_idx) + 1),
        "2theta_deg": peak_x,
        "d_spacing_A": peak_d,
        "Intensity": peak_y,
        "Relative_Intensity_pct": rel_intensity,
        "FWHM_deg": np.abs(right_x - left_x),
    })


def run_xrd_ui():
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
            x_vals, y_vals, err = _parse_xrd_bytes(uf.read())
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
        skip_avg = step_header_with_skip(2, "多檔平均", "xrd_skip_avg")
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
        step2_done = skip_avg or s2

    smooth_method = "none"
    smooth_window = 11
    smooth_poly_deg = 3

    with st.sidebar:
        s3 = st.session_state.get("xrd_s3", False)
        if step2_done:
            skip_smooth = step_header_with_skip(3, "平滑", "xrd_skip_smooth")
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
        else:
            skip_smooth = False
        step3_done = step2_done and (skip_smooth or s3)

    norm_method = "none"
    norm_x_start, norm_x_end = e0, e1

    with st.sidebar:
        s4 = st.session_state.get("xrd_s4", False)
        if step3_done:
            skip_norm = step_header_with_skip(4, "歸一化", "xrd_skip_norm")
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
            skip_peaks = step_header_with_skip(5, "峰值偵測", "xrd_skip_peaks")
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
            skip_ref = step_header_with_skip(7, "參考峰比對", "xrd_skip_ref")
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
        new_axis = _xrd_axis_values(new_x, xrd_axis_mode, wavelength_angstrom)
        new_d = _two_theta_to_d_spacing(new_x, wavelength_angstrom)
        all_interp = []
        for fname, (xv, yv) in data_dict.items():
            mask = (xv >= r_start) & (xv <= r_end)
            xc, yc = xv[mask], yv[mask]
            if len(xc) < 2:
                st.warning(f"{fname}：所選範圍內數據點不足，已跳過。")
                continue
            yi = interp1d(xc, yc, kind="linear", fill_value="extrapolate")(new_x)
            all_interp.append(yi)
            if show_individual:
                fig1.add_trace(go.Scatter(
                    x=new_axis, y=yi, mode="lines", name=fname,
                    line=dict(width=1, dash="dot"), opacity=0.35,
                ))

        if all_interp:
            avg_raw = np.mean(all_interp, axis=0)
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
                peak_idx = _detect_xrd_peaks(
                    new_x, peak_signal, peak_prom_ratio,
                    peak_height_ratio, peak_distance_deg, max_peak_labels,
                )
                if len(peak_idx):
                    peak_table = _build_xrd_peak_table(
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
            x_axis = _xrd_axis_values(xc, xrd_axis_mode, wavelength_angstrom)
            x_d = _two_theta_to_d_spacing(xc, wavelength_angstrom)
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
                peak_idx = _detect_xrd_peaks(
                    xc, peak_signal, peak_prom_ratio,
                    peak_height_ratio, peak_distance_deg, max_peak_labels,
                )
                if len(peak_idx):
                    peak_table = _build_xrd_peak_table(
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
        reference_df = _build_xrd_reference_df(
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
        st.caption("歸一化結果")
        if norm_method == "max":
            norm_axis = _xrd_axis_values(
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
                reference_match_df = _match_xrd_reference_peaks(
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


DATA_TYPES = {
    "XPS":   {"icon": "✅", "ready": True,  "desc": "X-ray Photoelectron Spectroscopy"},
    "XAS":   {"icon": "🔧", "ready": False, "desc": "X-ray Absorption Spectroscopy"},
    "XES":   {"icon": "✅", "ready": True,  "desc": "X-ray Emission Spectroscopy"},
    "SEM":   {"icon": "🔧", "ready": False, "desc": "Scanning Electron Microscopy"},
    "Raman": {"icon": "✅", "ready": True,  "desc": "Raman Spectroscopy"},
    "XRD":   {"icon": "✅", "ready": True,  "desc": "X-ray Diffraction"},
}

selected_type = st.radio(
    "選擇數據類型",
    list(DATA_TYPES.keys()),
    format_func=lambda k: f"{DATA_TYPES[k]['icon']} {k} — {DATA_TYPES[k]['desc']}",
    horizontal=True,
)

if not DATA_TYPES[selected_type]["ready"]:
    st.warning(f"**{selected_type}** 模組尚未開放，目前支援 XPS、XES、Raman 與 XRD。")
    st.stop()

st.divider()

if selected_type == "Raman":
    run_raman_ui()
    st.stop()

if selected_type == "XES":
    run_xes_ui()
    st.stop()

if selected_type == "XRD":
    run_xrd_ui()
    st.stop()


# ── XPS parser ────────────────────────────────────────────────────────────────
def parse_structured_xps(content_str):
    lines = content_str.splitlines()
    x_vals, y_vals = [], []
    mode = None
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if "Dimension 1 scale=" in line:
            vals = line.split("=", 1)[1].split()
            x_vals.extend([float(v) for v in vals])
            mode = "X"
            continue
        if "[Data 1]" in line or "Data=" in line:
            if "Data=" in line:
                vals = line.split("=", 1)[1].split()
                y_vals.extend([float(v) for v in vals])
            mode = "Y"
            continue
        if line.startswith("[") and mode is not None:
            if mode == "Y":
                break
            mode = None
            continue
        if mode == "X":
            vals = line.split()
            x_vals.extend([
                float(v) for v in vals
                if v.replace(".", "", 1).replace("E", "", 1)
                    .replace("+", "", 1).replace("-", "", 1).isdigit()
            ])
        elif mode == "Y":
            vals = line.split()
            if len(vals) >= 2:
                y_vals.append(float(vals[1]))
            elif len(vals) == 1:
                y_vals.append(float(vals[0]))

    x, y = np.array(x_vals), np.array(y_vals)
    if len(x) > 0 and len(y) > 0:
        min_len = min(len(x), len(y))
        x, y = x[:min_len], y[:min_len]
        idx = np.argsort(x)
        return x[idx], y[idx]
    raise ValueError("解析失敗：找不到 XPS 數據區塊")


@st.cache_data
def _parse_xps_bytes(raw: bytes):
    for enc in ("utf-8", "big5", "cp950", "latin-1", "utf-16"):
        try:
            content_str = raw.decode(enc)
            # 先嘗試標準 CSV（兩欄數字，首行可為標頭）
            import io
            df = pd.read_csv(io.StringIO(content_str))
            if df.shape[1] >= 2:
                x = df.iloc[:, 0].to_numpy(dtype=float)
                y = df.iloc[:, 1].to_numpy(dtype=float)
                if len(x) >= 2:
                    idx = np.argsort(x)
                    return x[idx], y[idx], None
        except UnicodeDecodeError:
            continue
        except Exception:
            pass

        try:
            content_str = raw.decode(enc)
            x, y = parse_structured_xps(content_str)
            return x, y, None
        except UnicodeDecodeError:
            continue
        except Exception as e:
            return None, None, str(e)
    return None, None, "無法辨識編碼"


def load_xps_file(uploaded_file):
    raw = uploaded_file.read()
    return _parse_xps_bytes(raw)


CALIB_STANDARDS = {
    "Au 4f7/2":                   84.0,
    "Ag 3d5/2":                  368.3,
    "Cu 2p3/2":                  932.7,
    "Cu 3s":                     122.5,
    "C 1s（污染碳 adventitious）": 284.8,
    "Fermi edge":                   0.0,
    "自訂":                        None,
}

COLORS = ["#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
          "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52"]

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
    step_header(1, "載入檔案")
    uploaded_files = st.file_uploader(
        "上傳 XPS .txt 檔案（可多選）",
        type=["txt", "csv"],
        accept_multiple_files=True,
    )

    skip_avg = step_header_with_skip(2, "多檔平均", "skip_avg")
    do_average = False
    show_individual = False
    interp_points = 601
    if not skip_avg:
        do_average = st.checkbox("對所有載入的檔案做平均", value=False)
        interp_points = st.number_input(
            "插值點數", min_value=100, max_value=5000, value=601, step=50
        )
        if do_average:
            show_individual = st.checkbox("疊加顯示原始個別曲線", value=False)

    # step2 完成條件
    step2_confirmed = st.session_state.get("step2_confirmed", False)
    if skip_avg and not step2_confirmed:
        st.session_state["step2_confirmed"] = True
        step2_confirmed = True
    if not skip_avg and not step2_confirmed:
        if _next_btn("btn_step2_next", "step2_confirmed"):
            step2_confirmed = True
    step2_done = skip_avg or step2_confirmed

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
        skip_calib = step_header_with_skip(3, "能量校正（標準品）", "skip_calib")
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

    step3_done = step3_visible and (skip_calib or step3_confirmed)

    # ─── ④ 背景扣除 ───────────────────────────────────────────────────────────
    step4_visible = step3_done
    skip_bg = False
    step4_confirmed = st.session_state.get("step4_confirmed", False)

    if step4_visible:
        skip_bg = step_header_with_skip(4, "背景扣除", "skip_bg")
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

    step4_done = step4_visible and (skip_bg or step4_confirmed)

    # ─── ⑤ 歸一化 ────────────────────────────────────────────────────────────
    step5_visible = step4_done
    skip_norm = False
    step5_confirmed = st.session_state.get("step5_confirmed", False)

    if step5_visible:
        skip_norm = step_header_with_skip(5, "歸一化", "skip_norm")
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
fit_x: np.ndarray | None = None
fit_y: np.ndarray | None = None

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
            fit_x, fit_y = new_x, y_final
        else:
            fit_x, fit_y = new_x, y_bg
        export_frames["Average"] = pd.DataFrame({
            "Energy_eV": new_x + offset,
            "Average_raw": avg_y,
            "Average_bg_subtracted": y_bg,
            **({"Background": bg} if bg_method != "none" else {}),
            **({"Average_normalized": y_final} if norm_method != "none" else {}),
        })
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
            fit_x, fit_y = xc, y_final
        else:
            fit_x, fit_y = xc, y_bg
        export_frames[name] = pd.DataFrame({
            "Energy_eV": xc + offset,
            "Intensity_raw": yc,
            "Intensity_bg_subtracted": y_bg,
            **({"Background": bg} if bg_method != "none" else {}),
            **({"Intensity_normalized": y_final} if norm_method != "none" else {}),
        })

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
st.plotly_chart(fig1, use_container_width=True)

# ── 圖二：歸一化結果 ─────────────────────────────────────────────────────────
if norm_method != "none":
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

# ── 匯出 ──────────────────────────────────────────────────────────────────────
if export_frames:
    st.subheader("匯出")
    btn_cols = st.columns(min(len(export_frames), 4))
    for col, (name, df) in zip(btn_cols, export_frames.items()):
        base = name.rsplit(".", 1)[0]
        fname = col.text_input(
            "檔名", value=f"{base}_processed",
            key=f"fname_{name}", label_visibility="collapsed",
        )
        col.download_button(
            "⬇️ 下載 CSV",
            data=df.to_csv(index=False).encode("utf-8"),
            file_name=f"{(fname or base + '_processed').strip()}.csv",
            mime="text/csv",
            key=f"dl_{name}",
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
    st.plotly_chart(
        pt_fig,
        use_container_width=True,
        on_select="rerun",
        key="periodic_table_chart",
    )

    # ── 執行擬合 ──────────────────────────────────────────────────────────────
    if do_fit:
        if fit_x is None or fit_y is None:
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

            fig_fit = go.Figure()
            fig_fit.add_trace(go.Scatter(
                x=fit_x_used + offset, y=fit_y_used,
                mode="lines", name="實驗數據",
                line=dict(color="white", width=1.5, dash="dot"),
            ))
            fig_fit.add_trace(go.Scatter(
                x=fit_x_used + offset, y=result["y_fit"],
                mode="lines", name="擬合包絡",
                line=dict(color="#FFD700", width=2.5),
            ))
            for pi, (pk_info, yi) in enumerate(
                zip(result["peaks"], result["y_individual"])
            ):
                c = FIT_PEAK_COLORS[pi % len(FIT_PEAK_COLORS)]
                fig_fit.add_trace(go.Scatter(
                    x=fit_x_used + offset, y=yi,
                    mode="lines",
                    name=f"{pk_info['label']}  {pk_info['center'] + offset:.2f} eV",
                    line=dict(color=c, width=1.5, dash="dash"),
                    fill="tozeroy",
                    fillcolor=hex_to_rgba(c, 0.12),
                ))
            fig_fit.add_trace(go.Scatter(
                x=fit_x_used + offset, y=result["residuals"],
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

            r2 = result["r_squared"]
            st.caption(
                f"R² = {r2:.5f}  "
                f"({'優秀' if r2 > 0.999 else '良好' if r2 > 0.99 else '尚可' if r2 > 0.95 else '差'})"
            )
            rows_table = [
                {
                    "峰": pk["label"],
                    "中心 (eV)": f"{pk['center'] + offset:.3f}",
                    "FWHM (eV)": f"{pk['fwhm']:.3f}",
                    "面積": f"{pk['area']:.4g}",
                    "面積%": f"{pk['area_pct']:.1f}%",
                }
                for pk in result["peaks"]
            ]
            st.dataframe(
                pd.DataFrame(rows_table), use_container_width=True, hide_index=True
            )

            fit_df = pd.DataFrame({
                "Energy_eV": fit_x_used + offset,
                "Experimental": fit_y_used,
                "Fit_envelope": result["y_fit"],
                "Residuals": result["residuals"],
                **{
                    f"Peak_{pk['label']}": yi
                    for pk, yi in zip(result["peaks"], result["y_individual"])
                },
            })
            fit_fname = st.text_input(
                "擬合結果檔名", value="fit_result", key="fit_export_fname"
            )
            st.download_button(
                "⬇️ 匯出擬合數據 CSV",
                data=fit_df.to_csv(index=False).encode("utf-8"),
                file_name=f"{(fit_fname or 'fit_result').strip()}.csv",
                mime="text/csv",
            )

            # ── 原子濃度累積表 ─────────────────────────────────────────────
            st.divider()
            st.caption("原子濃度計算（跨元素累積）")
            col_add_ac, col_clr_ac = st.columns(2)
            with col_add_ac:
                if st.button("＋ 加入原子濃度表", use_container_width=True, key="btn_add_ac"):
                    if "xps_fit_history" not in st.session_state:
                        st.session_state["xps_fit_history"] = []
                    elem_label = selected_elem if selected_elem != "（未選擇）" else "Unknown"
                    for pk in result["peaks"]:
                        rsf = ELEMENT_RSF.get(elem_label, None)
                        st.session_state["xps_fit_history"].append({
                            "元素": elem_label,
                            "峰": pk["label"],
                            "中心 (eV)": round(pk["center"] + offset, 3),
                            "面積": pk["area"],
                            "RSF": rsf,
                        })
            with col_clr_ac:
                if st.button("清除原子濃度表", use_container_width=True, key="btn_clr_ac"):
                    st.session_state["xps_fit_history"] = []

            if st.session_state.get("xps_fit_history"):
                hist = st.session_state["xps_fit_history"]
                hist_df = pd.DataFrame(hist)
                hist_df["RSF校正面積"] = hist_df.apply(
                    lambda r: r["面積"] / r["RSF"] if r["RSF"] and r["RSF"] > 0 else None,
                    axis=1,
                )
                total_corrected = hist_df["RSF校正面積"].sum()
                hist_df["原子濃度 at.%"] = hist_df["RSF校正面積"].apply(
                    lambda v: round(v / total_corrected * 100, 2) if total_corrected > 0 else None
                )
                display_cols = ["元素", "峰", "中心 (eV)", "面積", "RSF", "RSF校正面積", "原子濃度 at.%"]
                st.dataframe(hist_df[display_cols], use_container_width=True, hide_index=True)
                ac_csv = hist_df[display_cols].to_csv(index=False).encode("utf-8")
                st.download_button(
                    "⬇️ 匯出原子濃度表 CSV",
                    data=ac_csv,
                    file_name="atomic_concentration.csv",
                    mime="text/csv",
                    key="dl_ac_csv",
                )
