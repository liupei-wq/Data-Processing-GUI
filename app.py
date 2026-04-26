from html import escape

import streamlit as st

from modules.gaussian_subtraction import run_gaussian_subtraction_ui
from modules.raman import run_raman_ui
from modules.xas_auto import run_xas_ui
from modules.xes import run_xes_ui
from modules.xps import run_xps_ui
from modules.xrd import run_xrd_ui


st.set_page_config(page_title="Nigiro Pro", page_icon="⚙", layout="wide")


THEMES = {
    "light": {
        "label_zh": "淺色",
        "label_en": "Light",
        "bg": "#dfe5ed",
        "surface": "#edf2f6",
        "surface_alt": "#d5dde7",
        "text": "#15202b",
        "muted": "#526171",
        "sidebar": "#d4dce7",
        "sidebar_text": "#172333",
        "border": "#aeb9c8",
        "accent": "#1f5fbf",
        "accent_soft": "rgba(31, 95, 191, 0.18)",
        "button_text": "#ffffff",
    },
    "dark": {
        "label_zh": "深色",
        "label_en": "Dark",
        "bg": "#0f141b",
        "surface": "#171d26",
        "surface_alt": "#202938",
        "text": "#ecf2f8",
        "muted": "#a9b4c2",
        "sidebar": "#10131a",
        "sidebar_text": "#d8e2ee",
        "border": "#2e3a4a",
        "accent": "#3d8ef0",
        "accent_soft": "rgba(61, 142, 240, 0.18)",
        "button_text": "#ffffff",
    },
    "ocean": {
        "label_zh": "海洋藍",
        "label_en": "Ocean",
        "bg": "#cfe1e8",
        "surface": "#e2edf1",
        "surface_alt": "#c1d8e1",
        "text": "#102f3a",
        "muted": "#496772",
        "sidebar": "#bdd5df",
        "sidebar_text": "#102f3a",
        "border": "#8fb5c3",
        "accent": "#007b99",
        "accent_soft": "rgba(0, 123, 153, 0.20)",
        "button_text": "#ffffff",
    },
    "forest": {
        "label_zh": "森林綠",
        "label_en": "Forest",
        "bg": "#d7e3d2",
        "surface": "#e7eee3",
        "surface_alt": "#cbdcc5",
        "text": "#1b2f20",
        "muted": "#536b57",
        "sidebar": "#c8dbc2",
        "sidebar_text": "#1b2f20",
        "border": "#9fb794",
        "accent": "#2c733d",
        "accent_soft": "rgba(44, 115, 61, 0.20)",
        "button_text": "#ffffff",
    },
    "rose": {
        "label_zh": "玫瑰紅",
        "label_en": "Rose",
        "bg": "#ead8dc",
        "surface": "#f2e5e8",
        "surface_alt": "#dfc8ce",
        "text": "#3a1c27",
        "muted": "#745964",
        "sidebar": "#dec7cd",
        "sidebar_text": "#3a1c27",
        "border": "#bd99a4",
        "accent": "#b72f56",
        "accent_soft": "rgba(183, 47, 86, 0.20)",
        "button_text": "#ffffff",
    },
}

FONT_SIZES = {
    "small": {"label_zh": "小", "label_en": "Small", "px": 14},
    "medium": {"label_zh": "中", "label_en": "Medium", "px": 16},
    "large": {"label_zh": "大", "label_en": "Large", "px": 18},
}

LANG = {
    "zh": {
        "settings": "設定",
        "theme": "顏色主題",
        "language": "語言",
        "font_size": "字體大小",
        "data_type": "資料類型",
        "processing": "資料處理",
        "gaussian_tool": "扣除高斯",
        "gaussian_help": "進入獨立的高斯模板扣除工具，支援多種兩欄光譜檔案。",
        "coming": "開發中",
        "standalone": "Standalone Gaussian subtraction",
        "unsupported": "模組尚未開放，目前支援 XPS、XES、Raman、XRD 與 XAS。",
        "app_subtitle": "Spectroscopy Data Processing",
    },
    "en": {
        "settings": "Settings",
        "theme": "Color theme",
        "language": "Language",
        "font_size": "Font size",
        "data_type": "Data type",
        "processing": "Processing",
        "gaussian_tool": "Gaussian subtraction",
        "gaussian_help": "Open the standalone Gaussian template subtraction tool for two-column spectra.",
        "coming": "Coming soon",
        "standalone": "Standalone Gaussian subtraction",
        "unsupported": "This module is not available yet. Current modules: XPS, XES, Raman, XRD, and XAS.",
        "app_subtitle": "Spectroscopy Data Processing",
    },
}

DATA_TYPES = {
    "XPS": {"ready": True, "desc": "X-ray Photoelectron Spectroscopy"},
    "XES": {"ready": True, "desc": "X-ray Emission Spectroscopy"},
    "Raman": {"ready": True, "desc": "Raman Spectroscopy"},
    "XRD": {"ready": True, "desc": "X-ray Diffraction"},
    "XAS": {"ready": True, "desc": "X-ray Absorption Spectroscopy"},
    "SEM": {"ready": False, "desc": "Scanning Electron Microscopy"},
}


def _init_preferences() -> None:
    defaults = {
        "ui_theme": "dark",
        "ui_language": "zh",
        "ui_font_size": "medium",
    }
    allowed_values = {
        "ui_theme": set(THEMES),
        "ui_language": set(LANG),
        "ui_font_size": set(FONT_SIZES),
    }
    for key, value in defaults.items():
        if st.session_state.get(key) not in allowed_values[key]:
            st.session_state[key] = value


def _theme_label(theme_key: str, lang: str) -> str:
    label_key = "label_zh" if lang == "zh" else "label_en"
    return THEMES[theme_key][label_key]


def _font_label(size_key: str, lang: str) -> str:
    label_key = "label_zh" if lang == "zh" else "label_en"
    return FONT_SIZES[size_key][label_key]


def _apply_preferences_css() -> None:
    theme = THEMES[st.session_state["ui_theme"]]
    font_px = FONT_SIZES[st.session_state["ui_font_size"]]["px"]
    h1_size = max(1.35, font_px / 10.5)

    st.markdown(
        f"""
<style>
:root {{
    --app-bg: {theme["bg"]};
    --app-surface: {theme["surface"]};
    --app-surface-alt: {theme["surface_alt"]};
    --app-text: {theme["text"]};
    --app-muted: {theme["muted"]};
    --app-sidebar: {theme["sidebar"]};
    --app-sidebar-text: {theme["sidebar_text"]};
    --app-border: {theme["border"]};
    --app-accent: {theme["accent"]};
    --app-accent-soft: {theme["accent_soft"]};
    --app-button-text: {theme["button_text"]};
    --app-font-size: {font_px}px;
}}

.stApp,
[data-testid="stAppViewContainer"],
[data-testid="stMain"] {{
    background: var(--app-bg) !important;
    color: var(--app-text) !important;
}}

html, body, .stApp, .stMarkdown, .stText, label, p, div, span {{
    font-size: var(--app-font-size);
}}

h1 {{
    color: var(--app-text) !important;
    font-size: {h1_size:.2f}rem !important;
    margin-bottom: 0 !important;
}}

h2, h3, h4, h5, h6,
.stMarkdown, .stText, label, p, div, span {{
    color: var(--app-text) !important;
}}

[data-testid="stHeader"] {{
    background: transparent !important;
}}

section[data-testid="stSidebar"] {{
    background-color: var(--app-sidebar) !important;
    border-right: 1px solid var(--app-border);
}}

section[data-testid="stSidebar"] *,
section[data-testid="stSidebar"] label p {{
    color: var(--app-sidebar-text) !important;
}}

section[data-testid="stSidebar"] .stCheckbox label p {{
    color: var(--app-sidebar-text) !important;
}}

section[data-testid="stSidebar"] div[data-testid="stButton"] button,
button[kind="primary"],
button[kind="secondary"],
[data-testid="stDownloadButton"] button {{
    background: var(--app-accent-soft) !important;
    border: 1px solid var(--app-accent) !important;
    color: var(--app-text) !important;
    border-radius: 7px !important;
}}

section[data-testid="stSidebar"] div[data-testid="stButton"] button *,
button[kind="primary"] *,
button[kind="secondary"] *,
[data-testid="stDownloadButton"] button * {{
    color: var(--app-text) !important;
}}

section[data-testid="stSidebar"] [data-testid="stRadio"] label {{
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 7px;
    transition:
        background-color 160ms ease,
        border-color 160ms ease,
        box-shadow 160ms ease,
        color 160ms ease;
}}

section[data-testid="stSidebar"] [data-testid="stRadio"] label:has(input:checked) {{
    background: var(--app-accent-soft);
    border-color: color-mix(in srgb, var(--app-accent) 48%, transparent);
}}

section[data-testid="stSidebar"] [data-testid="stRadio"] label:hover,
section[data-testid="stSidebar"] .stCheckbox label:hover {{
    background: color-mix(in srgb, var(--app-accent-soft) 82%, var(--app-surface) 18%);
    border-color: color-mix(in srgb, var(--app-accent) 70%, transparent);
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--app-accent) 24%, transparent),
        0 0 18px color-mix(in srgb, var(--app-accent) 22%, transparent);
}}

section[data-testid="stSidebar"] .stCheckbox label {{
    border: 1px solid transparent;
    border-radius: 7px;
    padding: 5px 8px;
    transition:
        background-color 160ms ease,
        border-color 160ms ease,
        box-shadow 160ms ease,
        color 160ms ease;
}}

[data-testid="stExpander"] {{
    border: 1px solid var(--app-border) !important;
    border-left: 3px solid var(--app-accent) !important;
    border-radius: 0 6px 6px 0 !important;
    margin: 4px 0 2px 0 !important;
    background: var(--app-surface) !important;
}}

[data-testid="stExpander"] summary {{
    background: var(--app-surface-alt) !important;
    font-weight: 600 !important;
    color: var(--app-text) !important;
    padding: 5px 8px !important;
}}

[data-testid="stExpander"] summary *,
[data-testid="stExpander"] details,
[data-testid="stExpander"] details * {{
    color: var(--app-text) !important;
}}

[data-testid="stExpander"] [data-testid="stVerticalBlock"] {{
    background: var(--app-surface) !important;
}}

[data-testid="stFileUploaderDropzone"],
[data-testid="stFileUploaderDropzone"] > div,
[data-testid="stFileUploaderDropzone"] section {{
    background: var(--app-surface-alt) !important;
    border-color: var(--app-border) !important;
}}

[data-testid="stFileUploaderDropzone"] *,
[data-testid="stFileUploader"] *,
[data-testid="stFileUploaderFile"] * {{
    color: var(--app-text) !important;
}}

[data-baseweb="input"],
[data-baseweb="input"] > div,
[data-baseweb="select"],
[data-baseweb="select"] > div,
[data-baseweb="textarea"],
[data-baseweb="textarea"] textarea,
[data-testid="stNumberInput"] input,
[data-testid="stTextInput"] input,
[data-testid="stTextArea"] textarea {{
    background: var(--app-surface-alt) !important;
    color: var(--app-text) !important;
    border-color: var(--app-border) !important;
}}

[data-baseweb="input"] *,
[data-baseweb="select"] *,
[data-baseweb="textarea"] *,
[data-testid="stNumberInput"] *,
[data-testid="stTextInput"] *,
[data-testid="stTextArea"] * {{
    color: var(--app-text) !important;
}}

[data-testid="stNumberInput"] button {{
    background: color-mix(in srgb, var(--app-surface-alt) 82%, var(--app-accent-soft) 18%) !important;
    color: var(--app-text) !important;
}}

[data-testid="stAlert"],
[data-testid="stAlert"] * {{
    color: var(--app-text) !important;
}}

[data-testid="stAlert"] {{
    background: color-mix(in srgb, var(--app-accent-soft) 62%, var(--app-surface) 38%) !important;
    border: 1px solid var(--app-border) !important;
}}

[data-testid="stSlider"] [role="progressbar"] {{
    background: var(--app-accent) !important;
}}

[data-testid="stSlider"] [role="slider"] {{
    background-color: var(--app-accent) !important;
    border-color: var(--app-accent) !important;
    box-shadow: 0 0 0 4px var(--app-accent-soft) !important;
}}

[data-testid="stSlider"] [data-baseweb="tooltip"] div {{
    background-color: var(--app-accent) !important;
}}

div[data-testid="stPopover"] {{
    position: fixed;
    right: max(18px, env(safe-area-inset-right));
    bottom: max(18px, env(safe-area-inset-bottom));
    left: auto !important;
    top: auto !important;
    width: 52px !important;
    min-width: 52px !important;
    max-width: 52px !important;
    height: 52px !important;
    min-height: 52px !important;
    z-index: 10000;
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
}}

div[data-testid="stPopover"] > button {{
    width: 48px;
    min-width: 48px !important;
    max-width: 48px !important;
    height: 48px;
    min-height: 48px !important;
    max-height: 48px !important;
    border-radius: 999px !important;
    background: var(--app-accent) !important;
    color: var(--app-button-text) !important;
    border: 1px solid var(--app-border) !important;
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.22);
    font-size: 24px !important;
    padding: 0 !important;
    transform: rotate(0deg);
    transition:
        transform 260ms ease,
        box-shadow 180ms ease,
        filter 180ms ease;
}}

div[data-testid="stPopover"] > button:hover {{
    transform: rotate(115deg);
    filter: brightness(1.08);
    box-shadow:
        0 14px 36px rgba(0, 0, 0, 0.26),
        0 0 24px color-mix(in srgb, var(--app-accent) 42%, transparent);
}}

[data-baseweb="popover"] {{
    z-index: 10001;
    background: transparent !important;
}}

[data-baseweb="popover"] > div {{
    background: transparent !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 14px !important;
    box-shadow: none !important;
    overflow: hidden !important;
}}

[data-baseweb="popover"] [data-testid="stPopoverBody"] {{
    background: transparent !important;
    border: 1px solid var(--app-border) !important;
    border-radius: 14px !important;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24) !important;
    padding: 8px !important;
    overflow: hidden !important;
}}

[data-baseweb="popover"] [data-testid="stVerticalBlockBorderWrapper"] {{
    background: var(--app-surface) !important;
    border: 0 !important;
    border-radius: 12px !important;
    box-shadow: none !important;
    overflow: hidden !important;
    padding: 12px 14px !important;
    min-width: 272px !important;
    max-width: 300px !important;
}}

[data-baseweb="popover"] [data-testid="stPopoverBody"] > div,
[data-baseweb="popover"] [data-testid="stVerticalBlock"],
[data-baseweb="popover"] [data-testid="stRadio"] {{
    background: var(--app-surface) !important;
}}

[data-baseweb="popover"] *,
[data-baseweb="popover"] label,
[data-baseweb="popover"] label p,
[data-baseweb="popover"] h1,
[data-baseweb="popover"] h2,
[data-baseweb="popover"] h3,
[data-baseweb="popover"] h4,
[data-baseweb="popover"] h5,
[data-baseweb="popover"] h6 {{
    color: var(--app-text) !important;
}}

[data-baseweb="popover"] h3 {{
    font-size: calc(var(--app-font-size) + 1px) !important;
    line-height: 1.25 !important;
    margin: 0 0 12px 0 !important;
}}

[data-baseweb="popover"] [data-testid="stMarkdownContainer"] p {{
    line-height: 1.25 !important;
}}

[data-baseweb="popover"] [data-testid="stRadio"] {{
    margin: 0 0 12px 0 !important;
}}

[data-baseweb="popover"] [data-testid="stRadio"] > label {{
    font-weight: 700 !important;
    margin-bottom: 6px !important;
}}

[data-baseweb="popover"] [data-testid="stRadio"] div[role="radiogroup"] {{
    gap: 7px 12px !important;
}}

[data-baseweb="popover"] [data-testid="stRadio"] label {{
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 5px 8px !important;
    min-height: 30px !important;
    align-items: center !important;
}}

[data-baseweb="popover"] [data-testid="stRadio"] label:has(input:checked) {{
    background: var(--app-accent-soft) !important;
    border-color: var(--app-accent) !important;
}}

[data-baseweb="popover"] [data-testid="stRadio"] label:hover {{
    background: color-mix(in srgb, var(--app-accent-soft) 72%, var(--app-surface-alt) 28%) !important;
    border-color: color-mix(in srgb, var(--app-accent) 68%, transparent) !important;
}}

[data-testid="stMetric"],
[data-testid="stDataFrame"],
[data-testid="stTable"] {{
    color: var(--app-text) !important;
}}

hr {{
    border-color: var(--app-border) !important;
}}

.brand-header {{
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 10px 16px 10px;
    margin: 0 0 12px 0;
    border-bottom: 1px solid var(--app-border);
}}

.brand-logo {{
    width: 54px;
    height: 54px;
    flex: 0 0 54px;
    border-radius: 15px;
    background: linear-gradient(145deg, var(--app-accent), color-mix(in srgb, var(--app-accent) 44%, var(--app-surface) 56%));
    box-shadow:
        0 10px 24px rgba(0, 0, 0, 0.22),
        0 0 0 1px color-mix(in srgb, var(--app-accent) 34%, transparent);
}}

.brand-logo svg {{
    width: 54px;
    height: 54px;
    display: block;
}}

.brand-wordmark {{
    display: flex;
    flex-direction: column;
    min-width: 0;
}}

.brand-name {{
    color: var(--app-sidebar-text) !important;
    font-size: 24px !important;
    font-weight: 800;
    letter-spacing: .01em;
    line-height: 1.05;
}}

.brand-subtitle {{
    color: var(--app-muted) !important;
    font-size: 12px !important;
    font-weight: 650;
    letter-spacing: .10em;
    text-transform: uppercase;
    margin-top: 3px;
}}

.main-sticker-layer {{
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
}}

.main-sticker {{
    position: absolute;
    width: 172px;
    min-height: 88px;
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--app-accent) 28%, var(--app-border) 72%);
    border-radius: 14px;
    background:
        linear-gradient(145deg, color-mix(in srgb, var(--app-surface) 88%, transparent), color-mix(in srgb, var(--app-accent-soft) 72%, transparent));
    box-shadow:
        0 18px 44px rgba(0, 0, 0, 0.10),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
    opacity: .28;
    transform: rotate(var(--rotate, -4deg));
}}

.main-sticker svg {{
    width: 100%;
    height: auto;
    display: block;
}}

.main-sticker-a {{
    left: 42%;
    top: 34%;
    --rotate: -5deg;
}}

.main-sticker-b {{
    left: 72%;
    top: 28%;
    width: 150px;
    --rotate: 7deg;
}}

.main-sticker-c {{
    left: 58%;
    top: 62%;
    width: 190px;
    --rotate: 4deg;
}}

.main-sticker-d {{
    left: 30%;
    top: 68%;
    width: 145px;
    --rotate: -8deg;
}}

@media (max-width: 900px) {{
    .main-sticker-layer {{
        display: none;
    }}
}}

.data-type-hover-menu {{
    position: relative;
    width: 100%;
    min-height: 42px;
    margin-bottom: 8px;
    z-index: 40;
}}

.data-type-hover-trigger {{
    width: 100%;
    min-height: 38px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--app-border) 76%, var(--app-accent) 24%);
    border-radius: 8px;
    background: var(--app-accent-soft);
    color: var(--app-sidebar-text) !important;
    font-weight: 650;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--app-accent) 10%, transparent);
    cursor: default;
    transition:
        border-color 160ms ease,
        background-color 160ms ease,
        box-shadow 160ms ease;
}}

.data-type-hover-trigger::after {{
    content: "⌄";
    font-size: 16px;
    line-height: 1;
    transition: transform 180ms ease;
}}

.data-type-hover-menu:hover .data-type-hover-trigger {{
    border-color: color-mix(in srgb, var(--app-accent) 70%, transparent);
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--app-accent) 22%, transparent),
        0 0 18px color-mix(in srgb, var(--app-accent) 20%, transparent);
}}

.data-type-hover-menu:hover .data-type-hover-trigger::after {{
    transform: rotate(180deg);
}}

.data-type-hover-list {{
    position: absolute;
    left: 0;
    top: calc(100% + 4px);
    width: 100%;
    max-height: 0;
    overflow: hidden;
    opacity: 0;
    transform: translateY(-6px);
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--app-surface);
    box-shadow: none;
    transition:
        max-height 220ms ease,
        opacity 160ms ease,
        transform 180ms ease,
        border-color 160ms ease,
        box-shadow 160ms ease;
}}

.data-type-hover-menu:hover .data-type-hover-list {{
    max-height: min(62vh, 420px);
    opacity: 1;
    transform: translateY(0);
    border-color: var(--app-border);
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.20);
    overflow-y: auto;
}}

.data-type-hover-item {{
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    color: var(--app-sidebar-text) !important;
    text-decoration: none !important;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 62%, transparent);
    transition:
        background-color 140ms ease,
        color 140ms ease;
}}

.data-type-hover-item:last-child {{
    border-bottom: 0;
}}

.data-type-hover-item:hover {{
    background: var(--app-accent-soft);
    color: var(--app-sidebar-text) !important;
}}

.data-type-hover-dot {{
    width: 12px;
    height: 12px;
    flex: 0 0 12px;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--app-sidebar-text) 42%, transparent);
    background: color-mix(in srgb, var(--app-sidebar-text) 16%, transparent);
}}

.data-type-hover-item.is-active .data-type-hover-dot,
.data-type-hover-trigger .data-type-hover-dot {{
    border-color: color-mix(in srgb, var(--app-accent) 22%, white 78%);
    background: var(--app-accent);
    box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--app-button-text) 74%, transparent);
}}

.page-history-drawer {{
    position: fixed;
    top: 0;
    right: 0;
    width: 320px;
    max-width: min(82vw, 320px);
    height: 100vh;
    z-index: 9990;
    transform: translateX(calc(100% - 28px));
    transition: transform 220ms ease, box-shadow 220ms ease;
}}

.page-history-drawer:hover {{
    transform: translateX(0);
    box-shadow: -18px 0 38px rgba(0, 0, 0, 0.24);
}}

.page-history-handle {{
    position: absolute;
    left: 0;
    top: 46%;
    width: 28px;
    min-height: 96px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--app-border);
    border-right: 0;
    border-radius: 10px 0 0 10px;
    background: var(--app-accent);
    color: var(--app-button-text) !important;
    font-weight: 800;
    writing-mode: vertical-rl;
    letter-spacing: .05em;
}}

.page-history-panel {{
    margin-left: 28px;
    height: 100%;
    overflow-y: auto;
    padding: 22px 18px 26px 18px;
    border-left: 1px solid var(--app-border);
    background: var(--app-surface);
}}

.page-history-title {{
    margin: 0 0 14px 0;
    color: var(--app-muted) !important;
    font-size: 13px !important;
}}

.page-history-section {{
    margin: 0 0 18px 0;
}}

.page-history-section + .page-history-section {{
    padding-top: 14px;
    border-top: 1px solid var(--app-border);
}}

.page-history-section-title {{
    margin: 0 0 8px 0;
    color: var(--app-muted) !important;
    font-size: 12px !important;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
}}

.page-history-link {{
    display: block;
    padding: 10px 10px;
    margin: 0 0 5px 0;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--app-text) !important;
    text-decoration: none !important;
    font-weight: 600;
    transition:
        background-color 150ms ease,
        border-color 150ms ease,
        transform 150ms ease;
}}

.page-history-link:hover {{
    background: var(--app-accent-soft);
    border-color: color-mix(in srgb, var(--app-accent) 62%, transparent);
    transform: translateX(-2px);
}}

.page-history-link.is-active {{
    background: var(--app-accent-soft);
    border-color: var(--app-accent);
}}
</style>
""",
        unsafe_allow_html=True,
    )


def _render_settings_popover(text: dict[str, str]) -> None:
    with st.popover("⚙", help=text["settings"]):
        st.subheader(text["settings"])
        st.radio(
            text["theme"],
            list(THEMES.keys()),
            key="ui_theme",
            format_func=lambda key: _theme_label(key, st.session_state["ui_language"]),
        )
        st.radio(
            text["language"],
            ["zh", "en"],
            key="ui_language",
            format_func=lambda key: "繁體中文" if key == "zh" else "English",
            horizontal=True,
        )
        st.radio(
            text["font_size"],
            list(FONT_SIZES.keys()),
            key="ui_font_size",
            format_func=lambda key: _font_label(key, st.session_state["ui_language"]),
            horizontal=True,
        )


def _render_brand_header() -> None:
    st.markdown(
        """
<div class="brand-header">
  <div class="brand-logo" aria-hidden="true">
    <svg viewBox="0 0 64 64" role="img">
      <defs>
        <linearGradient id="nigiroLogoLine" x1="12" y1="52" x2="52" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="white" stop-opacity=".55"/>
          <stop offset=".48" stop-color="white" stop-opacity=".96"/>
          <stop offset="1" stop-color="white" stop-opacity=".70"/>
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="48" height="48" rx="14" fill="rgba(255,255,255,.10)"/>
      <path d="M18 45V20l28 24V19" fill="none" stroke="url(#nigiroLogoLine)" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M16 44c8-2 11-11 18-12 6-.8 9 4 14 1" fill="none" stroke="white" stroke-opacity=".42" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="18" cy="45" r="4.2" fill="white"/>
      <circle cx="32" cy="31" r="3.3" fill="white" fill-opacity=".92"/>
      <circle cx="46" cy="19" r="4.2" fill="white"/>
      <circle cx="46" cy="44" r="2.4" fill="white" fill-opacity=".75"/>
    </svg>
  </div>
  <div class="brand-wordmark">
    <span class="brand-name">Nigiro Pro</span>
    <span class="brand-subtitle">data processing</span>
  </div>
</div>
""",
        unsafe_allow_html=True,
    )


def _render_main_stickers() -> None:
    st.markdown(
        """
<div class="main-sticker-layer" aria-hidden="true">
  <div class="main-sticker main-sticker-a">
    <svg viewBox="0 0 180 92">
      <path d="M8 68 C35 22, 52 78, 78 42 S126 36, 168 18" fill="none" stroke="var(--app-accent)" stroke-width="5" stroke-linecap="round"/>
      <path d="M8 76 H168" stroke="var(--app-border)" stroke-width="2"/>
      <circle cx="78" cy="42" r="7" fill="var(--app-accent)"/>
      <circle cx="128" cy="34" r="5" fill="var(--app-text)"/>
    </svg>
  </div>
  <div class="main-sticker main-sticker-b">
    <svg viewBox="0 0 150 90">
      <rect x="16" y="42" width="18" height="30" rx="4" fill="var(--app-accent)"/>
      <rect x="48" y="24" width="18" height="48" rx="4" fill="var(--app-text)" opacity=".78"/>
      <rect x="80" y="34" width="18" height="38" rx="4" fill="var(--app-accent)" opacity=".62"/>
      <rect x="112" y="14" width="18" height="58" rx="4" fill="var(--app-text)" opacity=".48"/>
      <path d="M12 74 H138" stroke="var(--app-border)" stroke-width="2"/>
    </svg>
  </div>
  <div class="main-sticker main-sticker-c">
    <svg viewBox="0 0 190 94">
      <circle cx="34" cy="48" r="10" fill="var(--app-accent)"/>
      <circle cx="92" cy="24" r="8" fill="var(--app-text)" opacity=".78"/>
      <circle cx="144" cy="54" r="11" fill="var(--app-accent)" opacity=".70"/>
      <circle cx="102" cy="74" r="6" fill="var(--app-text)" opacity=".62"/>
      <path d="M43 44 L84 27 M99 28 L135 50 M136 58 L108 71 M43 53 L96 73" stroke="var(--app-border)" stroke-width="4" stroke-linecap="round"/>
    </svg>
  </div>
  <div class="main-sticker main-sticker-d">
    <svg viewBox="0 0 145 88">
      <path d="M18 24 H126 M18 44 H96 M18 64 H116" stroke="var(--app-text)" stroke-width="5" stroke-linecap="round" opacity=".72"/>
      <circle cx="22" cy="24" r="7" fill="var(--app-accent)"/>
      <circle cx="98" cy="44" r="7" fill="var(--app-accent)" opacity=".72"/>
      <circle cx="118" cy="64" r="7" fill="var(--app-accent)" opacity=".58"/>
    </svg>
  </div>
</div>
""",
        unsafe_allow_html=True,
    )


def _read_selected_type_from_query(ready: list[str]) -> str:
    query_value = st.query_params.get("data_type")
    if isinstance(query_value, list):
        query_value = query_value[0] if query_value else None
    if query_value in ready:
        st.session_state["selected_data_type"] = query_value
    if st.session_state.get("selected_data_type") not in ready:
        st.session_state["selected_data_type"] = ready[0]
    return st.session_state["selected_data_type"]


def _read_tool_from_query() -> bool:
    tool_value = st.query_params.get("tool")
    if isinstance(tool_value, list):
        tool_value = tool_value[0] if tool_value else None
    return tool_value == "gaussian"


def _remember_data_type_visit(selected_type: str) -> None:
    visits = st.session_state.get("data_type_visits", [])
    visits = [item for item in visits if item in DATA_TYPES and item != selected_type]
    st.session_state["data_type_visits"] = [selected_type, *visits][:12]


def _render_data_type_menu(selected_type: str, ready: list[str]) -> None:
    items = []
    for data_type in ready:
        active_class = " is-active" if data_type == selected_type else ""
        items.append(
            '<a class="data-type-hover-item{active}" href="?data_type={value}">'
            '<span class="data-type-hover-dot"></span><span>{label}</span></a>'.format(
                active=active_class,
                value=escape(data_type),
                label=escape(data_type),
            )
        )
    st.markdown(
        """
<div class="data-type-hover-menu">
  <div class="data-type-hover-trigger">
    <span class="data-type-hover-dot"></span>
    <span>{selected}</span>
  </div>
  <div class="data-type-hover-list">
    {items}
  </div>
</div>
""".format(
            selected=escape(selected_type),
            items="\n".join(items),
        ),
        unsafe_allow_html=True,
    )


def _render_page_history_drawer(
    selected_type: str,
    ready: list[str],
    text: dict[str, str],
    use_gaussian_tool: bool,
) -> None:
    ordered = ready
    data_title = "資料類型" if st.session_state["ui_language"] == "zh" else "Data types"
    tool_title = "工具" if st.session_state["ui_language"] == "zh" else "Tools"
    links = [
        '<section class="page-history-section">',
        '<p class="page-history-section-title">{title}</p>'.format(title=escape(data_title)),
    ]
    for data_type in ordered:
        active_class = " is-active" if data_type == selected_type and not use_gaussian_tool else ""
        desc = DATA_TYPES[data_type]["desc"]
        links.append(
            '<a class="page-history-link{active}" href="?data_type={value}" target="_self">'
            '{label}<br><span style="font-size:12px;color:var(--app-muted)!important;">{desc}</span></a>'.format(
                active=active_class,
                value=escape(data_type),
                label=escape(data_type),
                desc=escape(desc),
            )
        )
    links.extend(
        [
            '</section>',
            '<section class="page-history-section">',
            '<p class="page-history-section-title">{title}</p>'.format(title=escape(tool_title)),
        ]
    )
    tool_active_class = " is-active" if use_gaussian_tool else ""
    links.append(
        '<a class="page-history-link{active}" href="?tool=gaussian" target="_self">'
        '{label}<br><span style="font-size:12px;color:var(--app-muted)!important;">{desc}</span></a>'.format(
            active=tool_active_class,
            label=escape(text["gaussian_tool"]),
            desc=escape(text["standalone"]),
        )
    )
    links.append("</section>")
    title = "資料選單" if st.session_state["ui_language"] == "zh" else "Data menu"
    handle = "選單" if st.session_state["ui_language"] == "zh" else "Menu"
    st.markdown(
        """
<aside class="page-history-drawer" aria-label="{title}">
  <div class="page-history-handle">{handle}</div>
  <div class="page-history-panel">
    <p class="page-history-title">{title}</p>
    {links}
  </div>
</aside>
""".format(
            title=escape(title),
            handle=escape(handle),
            links="\n".join(links),
        ),
        unsafe_allow_html=True,
    )


_init_preferences()
_apply_preferences_css()
TEXT = LANG[st.session_state["ui_language"]]
_render_settings_popover(TEXT)
_render_main_stickers()


with st.sidebar:
    _render_brand_header()
    ready = [key for key, value in DATA_TYPES.items() if value["ready"]]
    selected_type = _read_selected_type_from_query(ready)
    use_gaussian_tool = _read_tool_from_query()
    _remember_data_type_visit(selected_type)


_render_page_history_drawer(selected_type, ready, TEXT, use_gaussian_tool)


if use_gaussian_tool:
    st.markdown(
        f"<h1>{TEXT['gaussian_tool']} &nbsp;"
        f"<span style='font-size:.75rem;font-weight:400;color:var(--app-muted);'>"
        f"{TEXT['standalone']}</span></h1>",
        unsafe_allow_html=True,
    )
else:
    info = DATA_TYPES[selected_type]
    st.markdown(
        f"<h1>{selected_type} &nbsp;"
        f"<span style='font-size:.75rem;font-weight:400;color:var(--app-muted);'>"
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
    st.warning(f"**{selected_type}** {TEXT['unsupported']}")
