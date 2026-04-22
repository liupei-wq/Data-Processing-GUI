import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from scipy.interpolate import interp1d
from scipy.signal import find_peaks

from processing import apply_processing

# ── page config ───────────────────────────────────────────────────────────────
st.set_page_config(page_title="Spectroscopy Data Processing", page_icon="📊", layout="wide")
st.title("📊 Spectroscopy Data Processing GUI")

st.markdown("""
<style>
/* ── 側邊欄整體 ── */
section[data-testid="stSidebar"] {
    background-color: #10131a;
}
section[data-testid="stSidebar"] * {
    font-size: 13.5px;
}

/* ── 跳過勾勾：字體縮小、顏色偏灰 ── */
section[data-testid="stSidebar"] .stCheckbox label p {
    font-size: 12px !important;
    color: #888 !important;
}

/* ── 一般 label 文字微調 ── */
section[data-testid="stSidebar"] label p {
    font-size: 13px !important;
}
</style>
""", unsafe_allow_html=True)


def step_header(num: int, title: str, skipped: bool = False) -> None:
    badge_bg  = "#555"   if skipped else "#3d8ef0"
    text_col  = "#555"   if skipped else "#dde3ee"
    line_col  = "#1e2230"
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

DATA_TYPES = {
    "XPS":   {"icon": "✅", "ready": True,  "desc": "X-ray Photoelectron Spectroscopy"},
    "XAS":   {"icon": "🔧", "ready": False, "desc": "X-ray Absorption Spectroscopy"},
    "XES":   {"icon": "🔧", "ready": False, "desc": "X-ray Emission Spectroscopy"},
    "SEM":   {"icon": "🔧", "ready": False, "desc": "Scanning Electron Microscopy"},
    "Raman": {"icon": "🔧", "ready": False, "desc": "Raman Spectroscopy"},
    "XRD":   {"icon": "🔧", "ready": False, "desc": "X-ray Diffraction"},
}

selected_type = st.radio(
    "選擇數據類型",
    list(DATA_TYPES.keys()),
    format_func=lambda k: f"{DATA_TYPES[k]['icon']} {k} — {DATA_TYPES[k]['desc']}",
    horizontal=True,
)

if not DATA_TYPES[selected_type]["ready"]:
    st.warning(f"**{selected_type}** 模組尚未開放，目前僅支援 XPS。")
    st.stop()

st.divider()

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


def load_xps_file(uploaded_file):
    raw = uploaded_file.read()
    for enc in ("utf-8", "big5", "cp950", "latin-1", "utf-16"):
        try:
            content_str = raw.decode(enc)
            x, y = parse_structured_xps(content_str)
            return x, y, None
        except UnicodeDecodeError:
            continue
        except Exception as e:
            return None, None, str(e)
    return None, None, "無法辨識編碼"


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

# ── sidebar ①②：靜態控制項 ────────────────────────────────────────────────────
with st.sidebar:
    step_header(1, "載入檔案")
    uploaded_files = st.file_uploader(
        "上傳 XPS .txt 檔案（可多選）",
        type=["txt", "csv"],
        accept_multiple_files=True,
    )

    skip_avg = st.checkbox("跳過（此步驟已完成）", key="skip_avg")
    step_header(2, "多檔平均", skipped=skip_avg)
    do_average = False
    show_individual = False
    interp_points = 601
    if not skip_avg:
        do_average = st.checkbox("對所有載入的檔案做平均", value=False)
        interp_points = st.number_input("插值點數", min_value=100, max_value=5000, value=601, step=50)
        if do_average:
            show_individual = st.checkbox("疊加顯示原始個別曲線", value=False)

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

# 讀取目前能量範圍（Streamlit 在 rerun 前已更新 session_state）
_cur = st.session_state.get("display_range", (overlap_min, overlap_max))
_e0 = float(min(_cur[0], _cur[1]))
_e1 = float(max(_cur[0], _cur[1]))

# ── sidebar ③④⑤：依賴數據的控制項 ──────────────────────────────────────────
offset = 0.0
show_calibrated = False
calib_au_x = calib_au_y = None

with st.sidebar:
    # ③ 能量校正
    skip_calib = st.checkbox("跳過（此步驟已完成）", key="skip_calib")
    step_header(3, "能量校正（標準品）", skipped=skip_calib)
    if not skip_calib:
        au_file = st.file_uploader("上傳標準品 .txt", type=["txt", "csv"], key="au_uploader")

        if au_file:
            std_name = st.selectbox(
                "選擇標準品",
                list(CALIB_STANDARDS.keys()),
                index=0,
                key="calib_std",
            )
            ref_e = CALIB_STANDARDS[std_name]
            if ref_e is None:
                ref_e = st.number_input(
                    "輸入標準峰位置 (eV)", value=84.0, step=0.1, format="%.2f", key="calib_custom_e"
                )

            calib_au_x, calib_au_y, au_err = load_xps_file(au_file)
            if au_err:
                st.error(f"標準品讀取失敗：{au_err}")
                calib_au_x = calib_au_y = None
            else:
                peaks, _ = find_peaks(calib_au_y, height=np.max(calib_au_y) * 0.5, distance=20)
                if len(peaks) == 0:
                    st.error("無法偵測到明顯峰值，請確認檔案是否正確。")
                    calib_au_x = calib_au_y = None
                else:
                    best = peaks[np.argmax(calib_au_y[peaks])]
                    measured_e = float(calib_au_x[best])
                    offset = ref_e - measured_e

                    col_m1, col_m2 = st.columns(2)
                    col_m1.metric("偵測峰值", f"{measured_e:.2f} eV")
                    col_m2.metric("位移量 ΔE", f"{offset:+.3f} eV")

                    show_calibrated = st.checkbox("疊加顯示校正後數據", value=False)

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

    # ④ 背景扣除
    skip_bg = st.checkbox("跳過（此步驟已完成）", key="skip_bg")
    step_header(4, "背景扣除", skipped=skip_bg)
    bg_method = "none"
    bg_x_start, bg_x_end = _e0, _e1
    show_bg_baseline = False
    if not skip_bg:
        bg_method = st.selectbox(
            "方法",
            ["none", "linear", "shirley"],
            format_func=lambda v: {"none": "不扣除", "linear": "線性背景", "shirley": "Shirley 背景"}[v],
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
                min_value=_e0,
                max_value=_e1,
                step=0.01,
                format="%.2f eV",
                key="bg_range",
            )
            bg_x_start, bg_x_end = sorted(bg_range)
            show_bg_baseline = st.checkbox("疊加顯示背景基準線", value=True)

    # ⑤ 歸一化
    skip_norm = st.checkbox("跳過（此步驟已完成）", key="skip_norm")
    step_header(5, "歸一化", skipped=skip_norm)
    norm_method = "none"
    norm_x_start, norm_x_end = _e0, _e1
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
                min_value=_e0,
                max_value=_e1,
                step=0.01,
                format="%.2f eV",
                key="norm_range",
            )
            norm_x_start, norm_x_end = sorted(norm_range)

# ── 主區：僅能量範圍滑桿 ──────────────────────────────────────────────────────
e_range = st.slider(
    "能量顯示範圍 — Binding Energy (eV)",
    min_value=x_min_global,
    max_value=x_max_global,
    value=(overlap_min, overlap_max),
    step=0.01,
    format="%.2f eV",
    key="display_range",
)
e_start, e_end = sorted(e_range)

# ── 數據處理 ─────────────────────────────────────────────────────────────────
# 每條曲線分兩步處理：① 背景扣除  ② 歸一化
# fig1 = 背景扣除步驟（原始 + 基準線 + 扣除後），fig2 = 歸一化結果（獨立 y 軸）
fig1 = go.Figure()
fig2 = go.Figure()
export_frames = {}

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
                x=new_x, y=yi, mode="lines", name=name,
                line=dict(width=1, dash="dot"), opacity=0.4,
            ))

    if all_interp:
        avg_y = np.mean(all_interp, axis=0)

        # ① 背景扣除
        y_bg, bg = apply_processing(
            new_x, avg_y, bg_method, "none",
            bg_x_start=bg_x_start, bg_x_end=bg_x_end,
        )
        # 圖1：原始平均（背景扣除對照用）
        fig1.add_trace(go.Scatter(
            x=new_x, y=avg_y, mode="lines", name="Average（原始）",
            line=dict(color="white", width=1.5, dash="dash"), opacity=0.6,
        ))
        if bg_method != "none" and show_bg_baseline:
            fig1.add_trace(go.Scatter(
                x=new_x, y=bg, mode="lines", name="背景基準線",
                line=dict(color="gray", width=1.5, dash="longdash"),
            ))
        fig1.add_trace(go.Scatter(
            x=new_x, y=y_bg, mode="lines", name="Average（扣除背景後）",
            line=dict(color="#EF553B", width=2.5),
        ))

        # ② 歸一化（在 fig2）
        y_final, _ = apply_processing(
            new_x, y_bg, "none", norm_method,
            norm_x_start=norm_x_start, norm_x_end=norm_x_end,
        )
        if norm_method != "none":
            fig2.add_trace(go.Scatter(
                x=new_x, y=y_final, mode="lines", name="Average（歸一化後）",
                line=dict(color="#EF553B", width=2.5),
            ))
            if show_calibrated and calib_au_x is not None:
                fig2.add_trace(go.Scatter(
                    x=new_x + offset, y=y_final, mode="lines", name="Average（校正後）",
                    line=dict(color="#FFA15A", width=2.5, dash="dash"),
                ))
        else:
            if show_calibrated and calib_au_x is not None:
                fig1.add_trace(go.Scatter(
                    x=new_x + offset, y=y_bg, mode="lines", name="Average（校正後）",
                    line=dict(color="#FFA15A", width=2.5, dash="dash"),
                ))

        export_frames["Average"] = pd.DataFrame({
            "Energy_eV": new_x,
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

        # ① 背景扣除
        y_bg, bg = apply_processing(
            xc, yc, bg_method, "none",
            bg_x_start=bg_x_start, bg_x_end=bg_x_end,
        )
        # 圖1：原始（背景扣除對照用）
        fig1.add_trace(go.Scatter(
            x=xc, y=yc, mode="lines", name=f"{name}（原始）",
            line=dict(color=color, width=1.5, dash="dash"), opacity=0.5,
        ))
        if bg_method != "none" and show_bg_baseline:
            fig1.add_trace(go.Scatter(
                x=xc, y=bg, mode="lines", name=f"{name}（背景）",
                line=dict(color=color, width=1.2, dash="longdash"), opacity=0.5,
            ))
        fig1.add_trace(go.Scatter(
            x=xc, y=y_bg, mode="lines", name=f"{name}（扣除背景後）",
            line=dict(color=color, width=2),
        ))

        # ② 歸一化（在 fig2）
        y_final, _ = apply_processing(
            xc, y_bg, "none", norm_method,
            norm_x_start=norm_x_start, norm_x_end=norm_x_end,
        )
        if norm_method != "none":
            fig2.add_trace(go.Scatter(
                x=xc, y=y_final, mode="lines", name=f"{name}（歸一化後）",
                line=dict(color=color, width=2),
            ))
            if show_calibrated and calib_au_x is not None:
                fig2.add_trace(go.Scatter(
                    x=xc + offset, y=y_final, mode="lines", name=f"{name}（校正後）",
                    line=dict(color=color, width=2, dash="dash"),
                ))
        else:
            if show_calibrated and calib_au_x is not None:
                fig1.add_trace(go.Scatter(
                    x=xc + offset, y=y_bg, mode="lines", name=f"{name}（校正後）",
                    line=dict(color=color, width=2, dash="dash"),
                ))

        export_frames[name] = pd.DataFrame({
            "Energy_eV": xc,
            "Intensity_raw": yc,
            "Intensity_bg_subtracted": y_bg,
            **({"Background": bg} if bg_method != "none" else {}),
            **({"Intensity_normalized": y_final} if norm_method != "none" else {}),
        })

# ── 圖一：背景扣除步驟 ───────────────────────────────────────────────────────
if bg_method != "none":
    fig1.add_vrect(
        x0=bg_x_start, x1=bg_x_end,
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

# ── 圖二：歸一化結果（只在選了歸一化時顯示）─────────────────────────────────
if norm_method != "none":
    st.caption("歸一化結果")
    if norm_method in ("mean_region", "max"):
        fig2.add_vrect(
            x0=norm_x_start, x1=norm_x_end,
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
    has_calib = show_calibrated and calib_au_x is not None

    if has_calib:
        col_raw, col_calib = st.columns(2)
    else:
        col_raw = st.container()

    with col_raw:
        st.caption("處理後數據")
        btn_cols = st.columns(min(len(export_frames), 4))
        for col, (name, df) in zip(btn_cols, export_frames.items()):
            base = name.rsplit(".", 1)[0]
            col.download_button(
                f"⬇️ {base}",
                data=df.to_csv(index=False).encode("utf-8"),
                file_name=f"{base}_processed.csv",
                mime="text/csv",
                key=f"dl_{name}",
            )

    if has_calib:
        with col_calib:
            st.caption("校正後數據")
            btn_cols2 = st.columns(min(len(export_frames), 4))
            for col, (name, df) in zip(btn_cols2, export_frames.items()):
                df_calib = df.copy()
                df_calib["Energy_eV"] = df_calib["Energy_eV"] + offset
                base = name.rsplit(".", 1)[0]
                col.download_button(
                    f"⬇️ {base}（校正後）",
                    data=df_calib.to_csv(index=False).encode("utf-8"),
                    file_name=f"{base}_calibrated.csv",
                    mime="text/csv",
                    key=f"calib_{name}",
                )
