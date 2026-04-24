import streamlit as st

from modules.raman import run_raman_ui
from modules.xes import run_xes_ui
from modules.xps import run_xps_ui
from modules.xrd import run_xrd_ui

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

if selected_type == "XPS":
    run_xps_ui()
