import streamlit as st

from modules.gaussian_subtraction import run_gaussian_subtraction_ui
from modules.raman import run_raman_ui
from modules.xas_auto import run_xas_ui
from modules.xes import run_xes_ui
from modules.xps import run_xps_ui
from modules.xrd import run_xrd_ui


st.set_page_config(page_title="Spectroscopy Data Processing", page_icon="📊", layout="wide")

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
section[data-testid="stSidebar"] div[data-testid="stButton"] button {
    background: #1e2a40;
    border: 1px solid #3d8ef0;
    color: #7eb8f7;
    font-size: 12px !important;
}
section[data-testid="stSidebar"] [data-testid="stRadio"] label {
    padding: 3px 6px;
    border-radius: 4px;
}
section[data-testid="stSidebar"] [data-testid="stRadio"] label:has(input:checked) {
    background: #1e2a40;
}
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
h1 {
    font-size: 1.4rem !important;
    margin-bottom: 0 !important;
}
</style>
""", unsafe_allow_html=True)


DATA_TYPES = {
    "XPS": {"icon": "⚡", "ready": True, "desc": "X-ray Photoelectron Spectroscopy"},
    "XES": {"icon": "🌊", "ready": True, "desc": "X-ray Emission Spectroscopy"},
    "Raman": {"icon": "🔬", "ready": True, "desc": "Raman Spectroscopy"},
    "XRD": {"icon": "💎", "ready": True, "desc": "X-ray Diffraction"},
    "XAS": {"icon": "🧪", "ready": True, "desc": "X-ray Absorption Spectroscopy"},
    "SEM": {"icon": "🔧", "ready": False, "desc": "Scanning Electron Microscopy"},
}


with st.sidebar:
    ready = [k for k, v in DATA_TYPES.items() if v["ready"]]
    type_col, tool_col = st.columns(2)

    with type_col:
        st.markdown(
            '<p style="font-size:11px; color:#666; letter-spacing:.08em; '
            'text-transform:uppercase; margin:4px 0 6px 0;">數據類型</p>',
            unsafe_allow_html=True,
        )
        selected_type = st.radio(
            "數據類型",
            ready,
            format_func=lambda k: f"{DATA_TYPES[k]['icon']}  {k}",
            key="selected_data_type",
            label_visibility="collapsed",
        )

    with tool_col:
        st.markdown(
            '<p style="font-size:11px; color:#666; letter-spacing:.08em; '
            'text-transform:uppercase; margin:4px 0 6px 0;">數據處理</p>',
            unsafe_allow_html=True,
        )
        use_gaussian_tool = st.checkbox(
            "〽️ 扣除高斯",
            key="use_gaussian_tool",
            help="進入獨立的高斯模板扣除工具，支援多種兩欄光譜檔案。",
        )

    coming = [k for k, v in DATA_TYPES.items() if not v["ready"]]
    if coming:
        st.caption(f"🔧 開發中：{'、'.join(coming)}")
    st.divider()


if use_gaussian_tool:
    st.markdown(
        "<h1>〽️ 扣除高斯 &nbsp;"
        "<span style='font-size:.75rem;font-weight:400;color:#888;'>"
        "Standalone Gaussian subtraction</span></h1>",
        unsafe_allow_html=True,
    )
else:
    info = DATA_TYPES[selected_type]
    st.markdown(
        f"<h1>📊 {selected_type} &nbsp;"
        f"<span style='font-size:.75rem;font-weight:400;color:#888;'>"
        f"{info['desc']}</span></h1>",
        unsafe_allow_html=True,
    )
st.divider()


if use_gaussian_tool:
    run_gaussian_subtraction_ui()
elif selected_type == "Raman":
    run_raman_ui()
elif selected_type == "XES":
    run_xes_ui()
elif selected_type == "XRD":
    run_xrd_ui()
elif selected_type == "XPS":
    run_xps_ui()
elif selected_type == "XAS":
    run_xas_ui()
else:
    st.warning(f"**{selected_type}** 模組尚未開放，目前支援 XPS、XES、Raman、XRD 與 XAS。")
