"""Shared Streamlit UI helper widgets used across all spectrum modules."""

import json

import streamlit as st
import streamlit.components.v1 as components

# Per-step badge colours (step number → hex).  Skipped steps always use #555.
_STEP_BADGE_COLORS: dict[int, str] = {
    1:  "#2e7d52",   # green        – load files
    2:  "#1565c0",   # blue         – despike / pre-process
    3:  "#6a1b9a",   # purple       – averaging
    4:  "#bf360c",   # deep-orange  – background
    5:  "#00695c",   # teal         – smoothing
    6:  "#1a237e",   # indigo       – normalisation
    7:  "#4a148c",   # deep-purple  – peak detection
    8:  "#880e4f",   # dark-pink    – peak fitting
    9:  "#1b4f72",   # navy         – extra step
    10: "#263238",   # blue-grey    – extra step
}
_STEP_COLOR_DEFAULT = "#3d8ef0"


def _step_color(num: int) -> str:
    return _STEP_BADGE_COLORS.get(num, _STEP_COLOR_DEFAULT)


def step_exp_label(num: int, title: str, is_done: bool) -> str:
    """Sidebar expander label: shows ✓ prefix when the step is completed."""
    if is_done:
        return f"✓ {num}. {title}"
    return f"{num}. {title}"


def step_header(num: int, title: str, skipped: bool = False) -> None:
    badge_bg = "#555" if skipped else _step_color(num)
    text_col = "#555" if skipped else "#dde3ee"
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
    badge_bg = "#555" if skipped else _step_color(num)
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


def scroll_anchor(anchor_id: str) -> None:
    st.markdown(
        f'<div id="{anchor_id}" style="scroll-margin-top: 88px;"></div>',
        unsafe_allow_html=True,
    )


def auto_scroll_on_appear(anchor_id: str, *, visible: bool, state_key: str, block: str = "center") -> None:
    prev_visible = bool(st.session_state.get(state_key, False))
    if visible and not prev_visible:
        target = json.dumps(anchor_id)
        block_mode = json.dumps(block)
        components.html(
            f"""
            <script>
            const scrollToTarget = () => {{
              const doc = window.parent.document;
              const el = doc.getElementById({target});
              if (!el) return;
              el.scrollIntoView({{ behavior: "smooth", block: {block_mode} }});
            }};
            setTimeout(scrollToTarget, 60);
            setTimeout(scrollToTarget, 240);
            setTimeout(scrollToTarget, 520);
            </script>
            """,
            height=0,
            width=0,
        )
    st.session_state[state_key] = bool(visible)
