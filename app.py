import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from scipy.interpolate import interp1d
from scipy.signal import find_peaks

from processing import apply_processing
from xps_database import ELEMENTS, CATEGORY_COLORS, FITTABLE_ELEMENTS
from peak_fitting import fit_peaks

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


# ── Raman parser ──────────────────────────────────────────────────────────────
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


def _parse_raman_bytes(raw: bytes):
    import io
    for enc in ("utf-8", "utf-8-sig", "big5", "cp950", "latin-1"):
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

    return None, None, "無法解析：請確認為兩欄數字格式（波數, 強度）"


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

    # ── Step 2: averaging options (sidebar) ───────────────────────────────────
    do_average = False
    show_individual = False
    interp_points = 601

    with st.sidebar:
        skip_avg = step_header_with_skip(2, "多檔平均", "raman_skip_avg")
        if not skip_avg:
            do_average = st.checkbox("對所有載入的檔案做平均", value=False, key="raman_do_avg")
            interp_points = int(st.number_input(
                "插值點數", min_value=100, max_value=5000, value=601, step=50, key="raman_interp"
            ))
            if do_average:
                show_individual = st.checkbox("疊加顯示原始個別曲線", value=False, key="raman_show_ind")

        if skip_avg:
            st.session_state["raman_s2"] = True
        s2 = st.session_state.get("raman_s2", False)
        if not skip_avg and not s2:
            if _next_btn("raman_btn2", "raman_s2"):
                s2 = True
        step2_done = skip_avg or s2

    # ── Step 3: background (sidebar) ──────────────────────────────────────────
    bg_method = "none"
    bg_x_start, bg_x_end = _e0, _e1
    show_bg_baseline = False
    poly_deg = 3

    with st.sidebar:
        s3 = st.session_state.get("raman_s3", False)
        if step2_done:
            skip_bg = step_header_with_skip(3, "背景扣除", "raman_skip_bg")
            if not skip_bg:
                bg_method = st.selectbox(
                    "方法",
                    ["none", "linear", "polynomial"],
                    format_func=lambda v: {
                        "none": "不扣除",
                        "linear": "線性背景",
                        "polynomial": "多項式（螢光背景）",
                    }[v],
                    key="raman_bg_method",
                )
                if bg_method == "polynomial":
                    poly_deg = int(st.slider("多項式階數", 2, 6, 3, key="raman_poly_deg"))
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
                st.session_state["raman_s3"] = True
            s3 = st.session_state.get("raman_s3", False)
            if not skip_bg and not s3:
                if _next_btn("raman_btn3", "raman_s3"):
                    s3 = True
        else:
            skip_bg = False
        step3_done = step2_done and (skip_bg or s3)

    # ── Step 4: normalization (sidebar) ───────────────────────────────────────
    norm_method = "none"
    norm_x_start, norm_x_end = _e0, _e1

    with st.sidebar:
        s4 = st.session_state.get("raman_s4", False)
        if step3_done:
            skip_norm = step_header_with_skip(4, "歸一化", "raman_skip_norm")
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
                st.session_state["raman_s4"] = True
            s4 = st.session_state.get("raman_s4", False)
            if not skip_norm and not s4:
                if _next_btn("raman_btn4", "raman_s4"):
                    s4 = True

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

    # ── Build figures ──────────────────────────────────────────────────────────
    fig1 = go.Figure()
    fig2 = go.Figure()
    export_frames: dict[str, pd.DataFrame] = {}

    if do_average:
        new_x = np.linspace(r_start, r_end, interp_points)
        all_interp = []
        for fname, (xv, yv) in data_dict.items():
            mask = (xv >= r_start) & (xv <= r_end)
            xc, yc = xv[mask], yv[mask]
            if len(xc) < 2:
                st.warning(f"{fname}：所選範圍內數據點不足，已跳過。")
                continue
            fi = interp1d(xc, yc, kind="linear", fill_value="extrapolate")
            yi = fi(new_x)
            all_interp.append(yi)
            if show_individual:
                fig1.add_trace(go.Scatter(
                    x=new_x, y=yi, mode="lines", name=fname,
                    line=dict(width=1, dash="dot"), opacity=0.4,
                ))
        if all_interp:
            avg_y = np.mean(all_interp, axis=0)
            y_bg, bg = apply_processing(
                new_x, avg_y, bg_method, "none",
                bg_x_start=bg_x_start, bg_x_end=bg_x_end, poly_deg=poly_deg,
            )
            if bg_method != "none":
                fig1.add_trace(go.Scatter(
                    x=new_x, y=avg_y, mode="lines", name="Average（原始）",
                    line=dict(color="white", width=1.5, dash="dash"), opacity=0.6,
                ))
                if show_bg_baseline:
                    fig1.add_trace(go.Scatter(
                        x=new_x, y=bg, mode="lines", name="背景基準線",
                        line=dict(color="gray", width=1.5, dash="longdash"),
                    ))
                fig1.add_trace(go.Scatter(
                    x=new_x, y=y_bg, mode="lines", name="Average（扣除背景後）",
                    line=dict(color="#EF553B", width=2.5),
                ))
            else:
                fig1.add_trace(go.Scatter(
                    x=new_x, y=avg_y, mode="lines", name="Average",
                    line=dict(color="#EF553B", width=2.5),
                ))
            y_final, _ = apply_processing(
                new_x, y_bg, "none", norm_method,
                norm_x_start=norm_x_start, norm_x_end=norm_x_end,
            )
            if norm_method != "none":
                fig2.add_trace(go.Scatter(
                    x=new_x, y=y_final, mode="lines", name="Average（歸一化後）",
                    line=dict(color="#EF553B", width=2.5),
                ))
            row: dict = {"Raman_Shift_cm": new_x, "Average_raw": avg_y,
                         "Average_bg_subtracted": y_bg}
            if bg_method != "none":
                row["Background"] = bg
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
            y_bg, bg = apply_processing(
                xc, yc, bg_method, "none",
                bg_x_start=bg_x_start, bg_x_end=bg_x_end, poly_deg=poly_deg,
            )
            if bg_method != "none":
                fig1.add_trace(go.Scatter(
                    x=xc, y=yc, mode="lines", name=f"{fname}（原始）",
                    line=dict(color=color, width=1.5, dash="dash"), opacity=0.5,
                ))
                if show_bg_baseline:
                    fig1.add_trace(go.Scatter(
                        x=xc, y=bg, mode="lines", name=f"{fname}（背景）",
                        line=dict(color=color, width=1.2, dash="longdash"), opacity=0.5,
                    ))
                fig1.add_trace(go.Scatter(
                    x=xc, y=y_bg, mode="lines", name=f"{fname}（扣除背景後）",
                    line=dict(color=color, width=2),
                ))
            else:
                fig1.add_trace(go.Scatter(
                    x=xc, y=yc, mode="lines", name=fname,
                    line=dict(color=color, width=2),
                ))
            y_final, _ = apply_processing(
                xc, y_bg, "none", norm_method,
                norm_x_start=norm_x_start, norm_x_end=norm_x_end,
            )
            if norm_method != "none":
                fig2.add_trace(go.Scatter(
                    x=xc, y=y_final, mode="lines", name=f"{fname}（歸一化後）",
                    line=dict(color=color, width=2),
                ))
            row = {"Raman_Shift_cm": xc, "Intensity_raw": yc, "Intensity_bg_subtracted": y_bg}
            if bg_method != "none":
                row["Background"] = bg
            if norm_method != "none":
                row["Intensity_normalized"] = y_final
            export_frames[fname] = pd.DataFrame(row)

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

    # ── Export ─────────────────────────────────────────────────────────────────
    if export_frames:
        st.subheader("匯出")
        btn_cols = st.columns(min(len(export_frames), 4))
        for col, (fname, df) in zip(btn_cols, export_frames.items()):
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


DATA_TYPES = {
    "XPS":   {"icon": "✅", "ready": True,  "desc": "X-ray Photoelectron Spectroscopy"},
    "XAS":   {"icon": "🔧", "ready": False, "desc": "X-ray Absorption Spectroscopy"},
    "XES":   {"icon": "🔧", "ready": False, "desc": "X-ray Emission Spectroscopy"},
    "SEM":   {"icon": "🔧", "ready": False, "desc": "Scanning Electron Microscopy"},
    "Raman": {"icon": "✅", "ready": True,  "desc": "Raman Spectroscopy"},
    "XRD":   {"icon": "🔧", "ready": False, "desc": "X-ray Diffraction"},
}

selected_type = st.radio(
    "選擇數據類型",
    list(DATA_TYPES.keys()),
    format_func=lambda k: f"{DATA_TYPES[k]['icon']} {k} — {DATA_TYPES[k]['desc']}",
    horizontal=True,
)

if not DATA_TYPES[selected_type]["ready"]:
    st.warning(f"**{selected_type}** 模組尚未開放，目前僅支援 XPS 與 Raman。")
    st.stop()

st.divider()

if selected_type == "Raman":
    run_raman_ui()
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
norm_method = "none"
norm_x_start, norm_x_end = _e0, _e1
init_peaks_selected: list = []
manual_centers: list = []
manual_fwhms: list = []
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
                    if len(peaks_det) == 0:
                        st.error("無法偵測到明顯峰值。")
                        calib_au_x = calib_au_y = None
                    else:
                        best = peaks_det[np.argmax(calib_au_y[peaks_det])]
                        measured_e = float(calib_au_x[best])
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
        if not skip_bg:
            bg_method = st.selectbox(
                "方法",
                ["none", "linear", "shirley"],
                format_func=lambda v: {
                    "none": "不扣除", "linear": "線性背景", "shirley": "Shirley 背景"
                }[v],
            )
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
