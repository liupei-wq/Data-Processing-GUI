import streamlit as st

from modules.raman import run_raman_ui
from modules.xes import run_xes_ui
from modules.xps import run_xps_ui
from modules.xrd import run_xrd_ui

# ── page config ───────────────────────────────────────────────────────────────
st.set_page_config(page_title="Spectroscopy Data Processing", page_icon="📊", layout="wide")

st.markdown("""
<style>
/* ── Sidebar ───────────────────────────────────────────────── */
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
/* 繼續按鈕 */
section[data-testid="stSidebar"] div[data-testid="stButton"] button {
    background: #1e2a40;
    border: 1px solid #3d8ef0;
    color: #7eb8f7;
    font-size: 12px !important;
}
/* 數據類型 radio 群組 */
section[data-testid="stSidebar"] [data-testid="stRadio"] label {
    padding: 3px 6px;
    border-radius: 4px;
}
section[data-testid="stSidebar"] [data-testid="stRadio"] label:has(input:checked) {
    background: #1e2a40;
}
/* 步驟折疊 expander：收緊間距、加左邊框 */
section[data-testid="stSidebar"] [data-testid="stExpander"] {
    border: none !important;
    border-left: 3px solid #1e3a5f !important;
    border-radius: 0 4px 4px 0 !important;
    margin: 4px 0 2px 0 !important;
    background: rgba(255,255,255,0.03) !important;
}
section[data-testid="stSidebar"] [data-testid="stExpander"] summary {
    font-size: 13px !important;
    font-weight: 600 !important;
    color: #c8d6e8 !important;
    padding: 5px 8px !important;
}
/* 滑桿：青藍色 */
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
/* ── Main area ─────────────────────────────────────────────── */
h1 { font-size: 1.4rem !important; margin-bottom: 0 !important; }
</style>
""", unsafe_allow_html=True)

DATA_TYPES = {
    "XPS":   {"icon": "⚡", "ready": True,  "desc": "X-ray Photoelectron Spectroscopy"},
    "XES":   {"icon": "🌊", "ready": True,  "desc": "X-ray Emission Spectroscopy"},
    "Raman": {"icon": "🔬", "ready": True,  "desc": "Raman Spectroscopy"},
    "XRD":   {"icon": "💎", "ready": True,  "desc": "X-ray Diffraction"},
    "XAS":   {"icon": "🔧", "ready": False, "desc": "X-ray Absorption Spectroscopy"},
    "SEM":   {"icon": "🔧", "ready": False, "desc": "Scanning Electron Microscopy"},
}

# ── Sidebar: data-type selector (renders first, modules append below) ─────────
with st.sidebar:
    st.markdown(
        '<p style="font-size:11px; color:#666; letter-spacing:.08em; '
        'text-transform:uppercase; margin:4px 0 6px 0;">數據類型</p>',
        unsafe_allow_html=True,
    )
    ready = [k for k, v in DATA_TYPES.items() if v["ready"]]
    selected_type = st.radio(
        "數據類型",
        ready,
        format_func=lambda k: f"{DATA_TYPES[k]['icon']}  {k}",
        key="selected_data_type",
        label_visibility="collapsed",
    )
    coming = [k for k, v in DATA_TYPES.items() if not v["ready"]]
    if coming:
        st.caption(f"🔧 開發中：{'、'.join(coming)}")
    st.divider()

# ── Main area: compact title ──────────────────────────────────────────────────
info = DATA_TYPES[selected_type]
st.markdown(
    f"<h1>📊 {selected_type} &nbsp;"
    f"<span style='font-size:.75rem;font-weight:400;color:#888;'>"
    f"{info['desc']}</span></h1>",
    unsafe_allow_html=True,
)
st.divider()

if selected_type == "Raman":
    run_raman_ui()
elif selected_type == "XES":
    run_xes_ui()
elif selected_type == "XRD":
    run_xrd_ui()
elif selected_type == "XPS":
    run_xps_ui()
else:
    st.warning(f"**{selected_type}** 模組尚未開放，目前支援 XPS、XES、Raman 與 XRD。")
