"""Raman-specific numerical helpers, result-table utilities, and Streamlit UI."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from core.parsers import parse_two_column_spectrum_bytes
from core.spectrum_ops import interpolate_spectrum_to_grid, mean_spectrum_arrays
from core.ui_helpers import (
    _next_btn,
    auto_scroll_on_appear,
    hex_to_rgba,
    scroll_anchor,
    step_exp_label,
    step_header,
    step_header_with_skip,
)
from core.peak_fitting import fit_peaks
from core.processing import apply_normalization, apply_processing, despike_signal, smooth_signal
from db.raman_database import RAMAN_REFERENCES

_PEAK_CANDS_KEY = "raman_fit_candidates"
_EDITOR_WIDGET_KEY = "raman_peak_editor_widget"
_EDITOR_WIDGET_VERSION_KEY = "raman_peak_editor_widget_version"
_PEAK_ROLE_OPTIONS = ["主峰", "強峰", "次峰", "弱峰", "待判定", "自訂"]
_PEAK_ID_COUNTER_KEY = "raman_peak_id_counter"
_AUTO_REFIT_FLAG_KEY = "raman_fit_auto_refit"
_AUTO_REFIT_TARGET_KEY = "raman_fit_auto_refit_target"
_REVIEW_PICK_KEY = "raman_fit_review_pick"
_RAMAN_PRESET_VERSION = 1
_RAMAN_PRESET_KEYS = [
    "raman_sub_peak_pos", "raman_sub_enabled", "raman_show_sub", "raman_show_pre_corr",
    "raman_skip_despike", "raman_despike_method", "raman_despike_threshold",
    "raman_despike_window", "raman_despike_passes", "raman_show_spikes", "raman_step2_done",
    "raman_skip_avg", "raman_do_interp", "raman_do_avg", "raman_interp", "raman_show_ind", "raman_step3_done",
    "raman_skip_bg", "raman_bg_method", "raman_poly_deg", "raman_baseline_lambda_exp",
    "raman_baseline_iter", "raman_baseline_p", "raman_bg_range", "raman_show_bg",
    "raman_step4_done", "raman_skip_smooth", "raman_smooth_method", "raman_smooth_window",
    "raman_smooth_poly", "raman_step5_done", "raman_skip_norm", "raman_norm_method",
    "raman_norm_range", "raman_step6_done", "raman_skip_fit",
    "raman_fit_target", "raman_fit_profile", "raman_fit_init_fwhm", "raman_sample_type", "raman_step8_done",
    "raman_zoom_on", "raman_zoom_start", "raman_zoom_end", "raman_zoom_range_slider",
    "raman_peak_table_compact", "raman_review_min_area_pct", "raman_review_max_abs_delta",
    "raman_fit_show_peak_ids", "raman_fit_show_flag_only", "raman_review_filter_mode",
    "raman_review_sort_mode", "raman_compare_dataset", "raman_compare_cols",
    "raman_compare_range_on", "raman_compare_range",
]


def _empty_peak_df() -> pd.DataFrame:
    return pd.DataFrame({
        "Peak_ID":     pd.Series([], dtype=str),
        "啟用":        pd.Series([], dtype=bool),
        "來源":        pd.Series([], dtype=str),
        "材料":        pd.Series([], dtype=str),
        "峰類別":      pd.Series([], dtype=str),
        "理論位置_cm": pd.Series([], dtype=float),
        "位置_cm":     pd.Series([], dtype=float),
        "標籤":        pd.Series([], dtype=str),
        "顯示名稱":    pd.Series([], dtype=str),
        "初始_FWHM_cm": pd.Series([], dtype=float),
        "備註":        pd.Series([], dtype=str),
    })


def _next_peak_id() -> str:
    next_id = int(st.session_state.get(_PEAK_ID_COUNTER_KEY, 0)) + 1
    st.session_state[_PEAK_ID_COUNTER_KEY] = next_id
    return f"RPK{next_id:03d}"


def _coerce_optional_float(value) -> float:
    num = pd.to_numeric(value, errors="coerce")
    return float(num) if np.isfinite(num) else float("nan")


def _format_peak_pos(value: float) -> str:
    if not np.isfinite(value):
        return "?"
    if abs(value - round(value)) < 0.05:
        return f"{int(round(value))}"
    return f"{value:.1f}"


def _classify_reference_peak(ref: dict) -> str:
    note = str(ref.get("note", "")).lower()
    strength = float(ref.get("strength", 0) or 0)
    if (
        "main peak" in note
        or "strongest" in note
        or "most characteristic" in note
        or "always present" in note
        or strength >= 90
    ):
        return "主峰"
    if "strong" in note or strength >= 70:
        return "強峰"
    if "weak" in note or strength <= 25:
        return "弱峰"
    return "次峰"


def _find_reference_peak(mat_name: str, position_cm: float, tolerance_cm: float = 12.0) -> dict | None:
    refs = RAMAN_REFERENCES.get(mat_name, [])
    if not refs or not np.isfinite(position_cm):
        return None
    nearest = min(refs, key=lambda p: abs(float(p["pos"]) - float(position_cm)))
    if abs(float(nearest["pos"]) - float(position_cm)) <= tolerance_cm:
        return nearest
    return None


def _compose_peak_display_name(
    material: str,
    peak_role: str,
    mode_label: str,
    ref_position_cm: float | None = None,
    position_cm: float | None = None,
) -> str:
    material = str(material).strip()
    peak_role = str(peak_role).strip()
    mode_label = str(mode_label).strip()
    base = ""
    if material and mode_label and peak_role in {"主峰", "強峰"}:
        base = f"{material} {peak_role} {mode_label}"
    elif material and mode_label:
        base = f"{material} {mode_label}"
    elif material and peak_role:
        base = f"{material} {peak_role}"
    elif mode_label:
        base = mode_label
    elif position_cm is not None and np.isfinite(position_cm):
        base = f"{float(position_cm):.1f} cm⁻¹"
    else:
        base = "未命名峰"
    if ref_position_cm is not None and np.isfinite(ref_position_cm):
        return f"{base} [{_format_peak_pos(float(ref_position_cm))}]"
    return base


def _build_peak_candidate_row(
    *,
    source: str,
    position_cm: float,
    default_fwhm: float,
    peak_id: str = "",
    material: str = "",
    peak_role: str = "",
    ref_position_cm: float | None = None,
    mode_label: str = "",
    display_name: str = "",
    note: str = "",
    enabled: bool = True,
) -> dict:
    position_cm = float(position_cm)
    peak_id = str(peak_id).strip() or _next_peak_id()
    material = str(material).strip()
    source = str(source).strip()
    peak_role = str(peak_role).strip()
    ref_position = _coerce_optional_float(ref_position_cm)
    mode_label = str(mode_label).strip()
    display_name = str(display_name).strip()
    note = str(note).strip()

    if material in RAMAN_REFERENCES:
        ref = _find_reference_peak(material, position_cm)
        if ref is not None:
            if not np.isfinite(ref_position):
                ref_position = float(ref.get("pos"))
            if not mode_label:
                mode_label = str(ref.get("label", "")).strip()
            if not peak_role:
                peak_role = _classify_reference_peak(ref)
            if not note:
                note = str(ref.get("note", "")).strip()

    if not peak_role:
        peak_role = "待判定" if source == "自動偵測" else "自訂"
    if not mode_label:
        mode_label = f"{position_cm:.1f}"
    if not display_name:
        display_name = _compose_peak_display_name(
            material,
            peak_role,
            mode_label,
            ref_position_cm=ref_position if np.isfinite(ref_position) else None,
            position_cm=position_cm,
        )

    return {
        "Peak_ID": peak_id,
        "啟用": bool(enabled),
        "來源": source or "數值新增",
        "材料": material or "未指定",
        "峰類別": peak_role,
        "理論位置_cm": ref_position,
        "位置_cm": position_cm,
        "標籤": mode_label,
        "顯示名稱": display_name,
        "初始_FWHM_cm": float(max(0.5, default_fwhm)),
        "備註": note,
    }


def _ensure_peak_df(df: pd.DataFrame | None) -> pd.DataFrame:
    if df is None or not isinstance(df, pd.DataFrame):
        return _empty_peak_df()
    if df.empty and not len(df.columns):
        return _empty_peak_df()

    rows: list[dict] = []
    for row in df.to_dict("records"):
        pos = pd.to_numeric(row.get("位置_cm"), errors="coerce")
        fwhm = pd.to_numeric(row.get("初始_FWHM_cm"), errors="coerce")
        if not np.isfinite(pos):
            continue

        source = str(row.get("來源", "")).strip()
        material = str(row.get("材料", "")).strip()
        if source in RAMAN_REFERENCES:
            material = material or source
            source = "參考資料庫"
        if not material and source in RAMAN_REFERENCES:
            material = source

        rebuilt = _build_peak_candidate_row(
            source=source or ("參考資料庫" if material in RAMAN_REFERENCES else "數值新增"),
            peak_id=str(row.get("Peak_ID", "")).strip(),
            material=material,
            position_cm=float(pos),
            default_fwhm=float(fwhm) if np.isfinite(fwhm) else 8.0,
            peak_role=str(row.get("峰類別", "")).strip(),
            ref_position_cm=row.get("理論位置_cm"),
            mode_label=str(row.get("標籤", "")).strip(),
            display_name=str(row.get("顯示名稱", "")).strip(),
            note=str(row.get("備註", "")).strip(),
            enabled=bool(row.get("啟用", True)),
        )
        rows.append(rebuilt)

    if not rows:
        return _empty_peak_df()
    return pd.DataFrame(rows, columns=_empty_peak_df().columns)


def _add_ref_to_session(mat_name: str, default_fwhm: float) -> None:
    current = _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df()))
    existing = set(round(float(v), 1) for v in current["位置_cm"])
    new_rows = [
        _build_peak_candidate_row(
            source="參考資料庫",
            material=mat_name,
            position_cm=float(p["pos"]),
            default_fwhm=default_fwhm,
            peak_role=_classify_reference_peak(p),
            ref_position_cm=float(p["pos"]),
            mode_label=str(p.get("label", "")),
            note=str(p.get("note", "")),
        )
        for p in RAMAN_REFERENCES.get(mat_name, [])
        if round(float(p["pos"]), 1) not in existing
    ]
    if new_rows:
        st.session_state[_PEAK_CANDS_KEY] = pd.concat(
            [current, pd.DataFrame(new_rows)], ignore_index=True
        )
        _reset_peak_editor_widget()


def _add_rows_to_session(rows: list[dict]) -> None:
    current = _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df()))
    existing = set(round(float(v), 1) for v in current["位置_cm"])
    filtered = []
    for row in rows:
        pos = float(row["位置_cm"])
        if round(pos, 1) in existing:
            continue
        filtered.append(_build_peak_candidate_row(
            source=str(row.get("來源", "數值新增")),
            peak_id=str(row.get("Peak_ID", "")),
            material=str(row.get("材料", "")),
            position_cm=pos,
            default_fwhm=float(row.get("初始_FWHM_cm", 8.0)),
            peak_role=str(row.get("峰類別", "")),
            ref_position_cm=row.get("理論位置_cm"),
            mode_label=str(row.get("標籤", "")),
            display_name=str(row.get("顯示名稱", "")),
            note=str(row.get("備註", "")),
            enabled=bool(row.get("啟用", True)),
        ))
    if filtered:
        st.session_state[_PEAK_CANDS_KEY] = pd.concat(
            [current, pd.DataFrame(filtered)], ignore_index=True
        )
        _reset_peak_editor_widget()


def _queue_raman_auto_refit(target: str) -> None:
    st.session_state[_AUTO_REFIT_FLAG_KEY] = True
    st.session_state[_AUTO_REFIT_TARGET_KEY] = str(target)


def _apply_peak_enable_flags(
    current_df: pd.DataFrame,
    *,
    review_ids: set[str] | None = None,
    disable_ids: set[str] | None = None,
    enable_only_ids: set[str] | None = None,
    enable_all: bool | None = None,
) -> pd.DataFrame:
    df = _ensure_peak_df(current_df).copy()
    review_mask = pd.Series(True, index=df.index)
    if review_ids is not None:
        review_mask = df["Peak_ID"].astype(str).isin(set(review_ids))
    if enable_all is not None:
        df.loc[review_mask, "啟用"] = bool(enable_all)
    if enable_only_ids is not None:
        df.loc[review_mask, "啟用"] = df.loc[review_mask, "Peak_ID"].astype(str).isin(set(enable_only_ids))
    if disable_ids:
        df.loc[review_mask & df["Peak_ID"].astype(str).isin(set(disable_ids)), "啟用"] = False
    return df


def _build_fit_quality_flag(
    area: float,
    area_pct: float,
    delta_cm: float,
    min_area_pct: float,
    max_abs_delta: float,
) -> str:
    flags: list[str] = []
    if abs(float(area)) <= 1e-9:
        flags.append("Area=0")
    elif float(area_pct) < float(min_area_pct):
        flags.append(f"Area%<{float(min_area_pct):g}")
    if np.isfinite(delta_cm) and abs(float(delta_cm)) > float(max_abs_delta):
        flags.append(f"|Δ|>{float(max_abs_delta):g}")
    return "；".join(flags) if flags else "OK"


def _sort_peak_candidate_df(df: pd.DataFrame) -> pd.DataFrame:
    out = _ensure_peak_df(df).copy()
    if out.empty:
        return out
    return out.sort_values(
        by=["啟用", "位置_cm", "Peak_ID"],
        ascending=[False, True, True],
        kind="stable",
    ).reset_index(drop=True)


def _json_safe(value):
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    if isinstance(value, np.ndarray):
        return [_json_safe(v) for v in value.tolist()]
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, pd.DataFrame):
        return _json_safe(_dataframe_records(value))
    if isinstance(value, pd.Series):
        return _json_safe(value.to_dict())
    if pd.isna(value):
        return None
    return value


def _dataframe_records(df: pd.DataFrame) -> list[dict]:
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return []
    safe_df = df.astype(object).where(pd.notna(df), None)
    return [_json_safe(rec) for rec in safe_df.to_dict("records")]


def _peak_editor_widget_key() -> str:
    version = int(st.session_state.get(_EDITOR_WIDGET_VERSION_KEY, 0))
    return f"{_EDITOR_WIDGET_KEY}_{version}"


def _reset_peak_editor_widget() -> None:
    st.session_state[_EDITOR_WIDGET_VERSION_KEY] = int(
        st.session_state.get(_EDITOR_WIDGET_VERSION_KEY, 0)
    ) + 1


def _clear_raman_fit_artifacts() -> None:
    for key in [
        "raman_fit_result",
        "raman_fit_result_target",
        "raman_fit_result_xy",
        _AUTO_REFIT_FLAG_KEY,
        _AUTO_REFIT_TARGET_KEY,
        _REVIEW_PICK_KEY,
    ]:
        st.session_state.pop(key, None)


def _update_peak_id_counter_from_df(df: pd.DataFrame) -> None:
    peak_df = _ensure_peak_df(df)
    max_id = 0
    for peak_id in peak_df["Peak_ID"].astype(str):
        digits = "".join(ch for ch in peak_id if ch.isdigit())
        if digits:
            max_id = max(max_id, int(digits))
    st.session_state[_PEAK_ID_COUNTER_KEY] = max_id


def _build_raman_preset_payload() -> dict:
    settings = {
        key: _json_safe(st.session_state.get(key))
        for key in _RAMAN_PRESET_KEYS
        if key in st.session_state
    }
    peak_df = _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df()))
    return {
        "preset_type": "raman_processing_preset",
        "version": _RAMAN_PRESET_VERSION,
        "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "settings": settings,
        "peak_candidates": _dataframe_records(peak_df),
    }


def _apply_raman_preset_payload(payload: dict) -> None:
    settings = payload.get("settings", {}) if isinstance(payload, dict) else {}
    for key, value in settings.items():
        if key in _RAMAN_PRESET_KEYS:
            st.session_state[key] = value

    peak_records = payload.get("peak_candidates", []) if isinstance(payload, dict) else []
    if peak_records:
        peak_df = _ensure_peak_df(pd.DataFrame(peak_records))
        st.session_state[_PEAK_CANDS_KEY] = peak_df
        _update_peak_id_counter_from_df(peak_df)
    _reset_peak_editor_widget()
    _clear_raman_fit_artifacts()


def _process_column_display_name(col: str) -> str:
    if col == "Background":
        return "背景基準線"
    if col.endswith("_raw") or col == "Intensity_raw":
        return "原始"
    if col.endswith("_despiked"):
        return "去尖峰後"
    if col.endswith("_bg_subtracted"):
        return "背景扣除後"
    if col.endswith("_smoothed"):
        return "平滑後"
    if col.endswith("_normalized"):
        return "歸一化後"
    return col.replace("_", " ")


def _default_compare_columns(columns: list[str]) -> list[str]:
    ordered: list[str] = []
    for matcher in [
        lambda c: c.endswith("_raw") or c == "Intensity_raw",
        lambda c: c == "Background",
        lambda c: c.endswith("_bg_subtracted"),
        lambda c: c.endswith("_smoothed"),
        lambda c: c.endswith("_normalized"),
        lambda c: c.endswith("_despiked"),
    ]:
        match = next((col for col in columns if matcher(col)), None)
        if match and match not in ordered:
            ordered.append(match)
    if not ordered:
        return columns[: min(3, len(columns))]
    return ordered[: min(4, len(ordered))]


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


def run_raman_ui():
    RAMAN_COLORS = ["#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
                    "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52"]

    # ── Step 1: file upload (sidebar) ─────────────────────────────────────────
    with st.sidebar:
        with st.expander("Raman Preset", expanded=False):
            st.caption(
                "Preset 會保存目前 Raman 流程的主要參數，例如去尖峰、內插/平均、"
                "背景扣除、平滑、歸一化、峰偵測與峰擬合設定。適合把同一組處理條件"
                "套用到同系列樣品，或把分析設定留給下次重現。"
            )
            preset_payload = _build_raman_preset_payload()
            preset_name = st.text_input(
                "Preset 檔名",
                value=st.session_state.get("raman_preset_name", "raman_preset"),
                key="raman_preset_name",
            )
            st.download_button(
                "⬇️ 匯出 Raman preset JSON",
                data=json.dumps(preset_payload, ensure_ascii=False, indent=2).encode("utf-8"),
                file_name=f"{(preset_name or 'raman_preset').strip()}.json",
                mime="application/json",
                key="raman_preset_export_btn",
            )

            preset_upload = st.file_uploader(
                "匯入 Raman preset JSON",
                type=["json"],
                accept_multiple_files=False,
                key="raman_preset_uploader",
            )
            if preset_upload is not None:
                preset_raw = preset_upload.read()
                preset_sig = hashlib.md5(preset_raw).hexdigest()
                if preset_sig != st.session_state.get("raman_last_applied_preset_sig"):
                    try:
                        payload = json.loads(preset_raw.decode("utf-8"))
                        _apply_raman_preset_payload(payload)
                        st.session_state["raman_last_applied_preset_sig"] = preset_sig
                        st.session_state["raman_last_applied_preset_name"] = preset_upload.name
                        st.rerun()
                    except Exception as exc:
                        st.error(f"Preset 載入失敗：{exc}")
                else:
                    st.caption(f"已套用 preset：{preset_upload.name}")
            elif st.session_state.get("raman_last_applied_preset_name"):
                st.caption(f"最近套用 preset：{st.session_state['raman_last_applied_preset_name']}")

        step_header(1, "載入檔案")
        uploaded_files = st.file_uploader(
            "上傳 Raman .txt / .csv / .asc 檔案（可多選）",
            type=["txt", "csv", "asc", "asc_"],
            accept_multiple_files=True,
            key="raman_uploader",
        )

        # ── 基板訊號扣除（可選）──────────────────────────────────────────────
        sub_correction_enabled = False
        sub_peak_pos = 520.7
        show_sub_spectrum = False
        show_pre_correction = False
        sub_uploader = None

        with st.expander("基板訊號扣除（可選）", expanded=False):
            st.caption(
                "上傳裸基板光譜，程式自動對齊 Si 峰再扣除，"
                "可消除不同曝光時間／次數造成的強度差異。"
            )
            sub_uploader = st.file_uploader(
                "裸基板光譜（.txt / .csv / .asc）",
                type=["txt", "csv", "asc"],
                accept_multiple_files=False,
                key="raman_substrate_uploader",
            )
            if sub_uploader is not None:
                sub_peak_pos = float(st.number_input(
                    "對齊峰位 (cm⁻¹)",
                    min_value=50.0, max_value=2000.0,
                    value=520.7, step=0.1, format="%.1f",
                    key="raman_sub_peak_pos",
                    help="通常用 Si 520.7 cm⁻¹；藍寶石基板可選 645 cm⁻¹",
                ))
                sub_correction_enabled = st.checkbox(
                    "啟用基板扣除",
                    value=True,
                    key="raman_sub_enabled",
                )
                show_sub_spectrum = st.checkbox(
                    "在圖上顯示已縮放基板光譜",
                    value=False,
                    key="raman_show_sub",
                )
                show_pre_correction = st.checkbox(
                    "在圖上顯示扣除前原始光譜",
                    value=True,
                    key="raman_show_pre_corr",
                )

    if not uploaded_files:
        st.info("請在左側上傳一個或多個 Raman .txt / .csv 檔案。")
        st.stop()

    # ── Parse uploaded files ───────────────────────────────────────────────────
    data_dict: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for uf in uploaded_files:
        _ck = f"_raman_{uf.name}_{uf.size}"
        if _ck not in st.session_state:
            _x, _y, _err = parse_two_column_spectrum_bytes(uf.read())
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

    # ── Detect file change → reset range sliders ──────────────────────────────
    _cur_upload_ids = frozenset(f"{uf.name}_{uf.size}" for uf in uploaded_files)
    if _cur_upload_ids != st.session_state.get("raman_last_upload_ids"):
        for _rk in [
            "raman_bg_range", "raman_norm_range",
            "raman_detect_x_start", "raman_detect_x_end",
            "raman_zoom_start", "raman_zoom_end", "raman_zoom_range_slider",
        ]:
            st.session_state.pop(_rk, None)
        st.session_state["raman_last_upload_ids"] = _cur_upload_ids

    # ── Compute global x range ─────────────────────────────────────────────────
    _all_x = np.concatenate([xv for xv, _ in data_dict.values()])
    x_min_g = float(_all_x.min())
    x_max_g = float(_all_x.max())
    ov_min = float(max(xv.min() for xv, _ in data_dict.values()))
    ov_max = float(min(xv.max() for xv, _ in data_dict.values()))
    _e0 = x_min_g
    _e1 = x_max_g
    step_size = float(max(0.1, (x_max_g - x_min_g) / 2000))

    # ── Substrate correction ───────────────────────────────────────────────────
    data_dict_original: dict[str, tuple[np.ndarray, np.ndarray]] = {
        k: (xv.copy(), yv.copy()) for k, (xv, yv) in data_dict.items()
    }
    sub_spectrum_scaled: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    sub_scale_info: list[str] = []

    if sub_uploader is not None:
        _sub_ck = f"_raman_sub_{sub_uploader.name}_{sub_uploader.size}"
        if _sub_ck not in st.session_state:
            _sx, _sy, _serr = parse_two_column_spectrum_bytes(sub_uploader.read())
            if _serr:
                st.session_state[_sub_ck] = (None, None, _serr)
            else:
                st.session_state[_sub_ck] = (
                    np.asarray(_sx, dtype=float).ravel(),
                    np.asarray(_sy, dtype=float).ravel(),
                    None,
                )
        _sub_cached = st.session_state[_sub_ck]
        if _sub_cached[2] is not None:
            st.error(f"基板檔案讀取失敗：{_sub_cached[2]}")
        else:
            sub_x_raw, sub_y_raw = _sub_cached[0], _sub_cached[1]

            if sub_correction_enabled:
                # find substrate's own peak at sub_peak_pos
                _win_sub = (sub_x_raw >= sub_peak_pos - 15) & (sub_x_raw <= sub_peak_pos + 15)
                sub_peak_int = float(sub_y_raw[_win_sub].max()) if _win_sub.any() else 1.0

                corrected_dict: dict[str, tuple[np.ndarray, np.ndarray]] = {}
                for fname, (xv, yv) in data_dict.items():
                    # interpolate substrate onto sample x-grid
                    sub_y_interp = np.interp(xv, sub_x_raw, sub_y_raw,
                                             left=float(sub_y_raw[0]),
                                             right=float(sub_y_raw[-1]))
                    # find sample peak intensity at sub_peak_pos
                    _win_s = (xv >= sub_peak_pos - 15) & (xv <= sub_peak_pos + 15)
                    sample_peak_int = float(yv[_win_s].max()) if _win_s.any() else 1.0
                    # scale factor: normalise substrate to same peak height as sample
                    scale = sample_peak_int / max(sub_peak_int, 1e-10)
                    y_sub_scaled = sub_y_interp * scale
                    y_corrected = yv - y_sub_scaled
                    corrected_dict[fname] = (xv, y_corrected)
                    sub_spectrum_scaled[fname] = (xv, y_sub_scaled)
                    sub_scale_info.append(
                        f"{fname}：Si 峰縮放比 {scale:.4f}"
                        f"（樣品 {sample_peak_int:.0f} / 基板 {sub_peak_int:.0f}）"
                    )
                data_dict = corrected_dict

    # ── Step 2: despike (sidebar) ─────────────────────────────────────────────
    despike_method = "none"
    despike_threshold = 8.0
    despike_window = 7
    despike_passes = 1
    show_spike_marks = False

    with st.sidebar:
        s2 = st.session_state.get("raman_step2_done", False)
        _skip2 = st.session_state.get("raman_skip_despike", False)
        with st.expander(step_exp_label(2, "去尖峰", s2 or _skip2), expanded=not (s2 or _skip2)):
            skip_despike = st.checkbox("跳過此步驟 ✓", key="raman_skip_despike")
            if not skip_despike:
                st.caption("⚠️ 僅用於修正雷射 cosmic ray 造成的**單點**尖銳突起，不適合一般峰形處理。")
                despike_method = st.selectbox(
                    "方法",
                    ["none", "median"],
                    format_func=lambda v: {
                        "none": "不處理",
                        "median": "Median despike（cosmic ray）",
                    }[v],
                    key="raman_despike_method",
                    help="Median despike：以局部中位數取代偏差過大的單點，專門針對 cosmic ray 尖峰。一般樣品訊號寬峰請跳過此步驟。",
                )
                if despike_method != "none":
                    despike_threshold = float(st.slider(
                        "尖峰判定門檻", 4.0, 20.0, 8.0, 0.5, key="raman_despike_threshold",
                        help="判定倍數：偏差超過局部標準差×此值才視為尖峰。數值越小修正越激進，建議從 8 開始調整。",
                    ))
                    despike_window = int(st.number_input(
                        "局部視窗點數", min_value=3, max_value=31, value=7, step=2, key="raman_despike_window",
                        help="計算中位數的鄰近點數（奇數）。視窗太小易誤判，太大會把真實峰也納入比較。",
                    ))
                    despike_passes = int(st.slider("修正回合數", 1, 3, 1, key="raman_despike_passes",
                        help="重複套用幾次。通常 1 次即可；有多個相鄰 cosmic ray 點時可試 2–3 次。",
                    ))
                    show_spike_marks = st.checkbox("在圖上標示被修正的點", value=False, key="raman_show_spikes")
            if skip_despike:
                st.session_state["raman_step2_done"] = True
            s2 = st.session_state.get("raman_step2_done", False)
            if not skip_despike and not s2:
                if _next_btn("raman_btn2", "raman_step2_done"):
                    s2 = True
        skip_despike = st.session_state.get("raman_skip_despike", False)
        s2 = st.session_state.get("raman_step2_done", False)
        step2_done = skip_despike or s2

    # ── Step 3: interpolation / averaging options (sidebar) ──────────────────
    do_interpolate = False
    do_average = False
    show_individual = False
    interp_points = 601

    with st.sidebar:
        s3 = st.session_state.get("raman_step3_done", False)
        if step2_done:
            if len(data_dict) < 2 and st.session_state.get("raman_do_avg", False):
                st.session_state["raman_do_avg"] = False
            _skip3 = st.session_state.get("raman_skip_avg", False)
            with st.expander(step_exp_label(3, "內插化及平均化", s3 or _skip3), expanded=not (s3 or _skip3)):
                skip_avg = st.checkbox("跳過此步驟 ✓", key="raman_skip_avg")
                if not skip_avg:
                    if len(data_dict) < 2:
                        st.caption("目前只有 1 個檔案，可單獨做內插化；平均化需至少 2 個檔案。")
                    else:
                        st.caption("內插化會先把每條光譜重採樣到固定點數；平均化則會在共同重疊區間內先內插、再平均。")
                    do_interpolate = st.checkbox(
                        "對每個載入檔案做內插化",
                        value=st.session_state.get("raman_do_interp", False),
                        key="raman_do_interp",
                        help="單檔與多檔都可使用。適合想把光譜重採樣成固定點數後再進入後續處理。",
                    )
                    do_average = st.checkbox(
                        "對所有載入的檔案做平均化",
                        value=st.session_state.get("raman_do_avg", False),
                        key="raman_do_avg",
                        disabled=len(data_dict) < 2,
                        help="平均化需要至少 2 個檔案，並會自動使用同一組插值點數。",
                    )
                    if do_interpolate or do_average:
                        interp_points = int(st.number_input(
                            "插值點數", min_value=100, max_value=5000, value=601, step=50, key="raman_interp"
                        ))
                    if do_average:
                        st.caption("平均化會自動使用上方插值點數，並只在共同重疊區間內進行。")
                        show_individual = st.checkbox("疊加顯示原始個別曲線", value=False, key="raman_show_ind")
                if skip_avg:
                    st.session_state["raman_step3_done"] = True
                s3 = st.session_state.get("raman_step3_done", False)
                if not skip_avg and not s3:
                    if _next_btn("raman_btn3", "raman_step3_done"):
                        s3 = True
            skip_avg = st.session_state.get("raman_skip_avg", False)
            s3 = st.session_state.get("raman_step3_done", False)
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
            _skip4 = st.session_state.get("raman_skip_bg", False)
            with st.expander(step_exp_label(4, "背景扣除", s4 or _skip4), expanded=not (s4 or _skip4)):
                skip_bg = st.checkbox("跳過此步驟 ✓", key="raman_skip_bg")
                if not skip_bg:
                    st.caption(
                        "如果基線已接近零且無明顯斜率，可直接跳過。"
                        "螢光背景強或基線有漂移時才需要扣除。"
                    )
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
            skip_bg = st.session_state.get("raman_skip_bg", False)
            s4 = st.session_state.get("raman_step4_done", False)
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
            _skip5 = st.session_state.get("raman_skip_smooth", False)
            with st.expander(step_exp_label(5, "平滑", s5 or _skip5), expanded=not (s5 or _skip5)):
                skip_smooth = st.checkbox("跳過此步驟 ✓", key="raman_skip_smooth")
                if not skip_smooth:
                    st.caption(
                        "訊雜比（SNR）高的數據通常不需要平滑。"
                        "平滑視窗過大會展寬峰形，特別是窄峰（如 Si 520 cm⁻¹）。"
                    )
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
            skip_smooth = st.session_state.get("raman_skip_smooth", False)
            s5 = st.session_state.get("raman_step5_done", False)
        else:
            skip_smooth = False
        step5_done = step4_done and (skip_smooth or s5)

    # ── Step 6: normalization (sidebar) ───────────────────────────────────────
    norm_method = "none"
    norm_x_start, norm_x_end = _e0, _e1

    with st.sidebar:
        s6 = st.session_state.get("raman_step6_done", False)
        if step5_done:
            _skip6 = st.session_state.get("raman_skip_norm", False)
            with st.expander(step_exp_label(6, "歸一化", s6 or _skip6), expanded=not (s6 or _skip6)):
                skip_norm = st.checkbox("跳過此步驟 ✓", key="raman_skip_norm")
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
            skip_norm = st.session_state.get("raman_skip_norm", False)
            s6 = st.session_state.get("raman_step6_done", False)
        else:
            skip_norm = False
        step6_done = step5_done and (skip_norm or s6)

    # ── Step 8: peak fitting (sidebar) ────────────────────────────────────────
    fit_profile = "voigt"
    sample_type = st.session_state.get("raman_sample_type", "薄膜")
    _fwhm_default = (
        float(max(15.0, min(60.0, (_e1 - _e0) / 15.0)))
        if sample_type == "粉末"
        else float(max(4.0, min(24.0, (_e1 - _e0) / 30.0)))
    )
    fit_initial_fwhm = _fwhm_default
    fit_target_options = ["Average"] if do_average else list(data_dict.keys())
    fit_target_default = fit_target_options[0]
    run_peak_fit = False
    skip_fit = False

    with st.sidebar:
        s8 = st.session_state.get("raman_step8_done", False)
        if step6_done:
            if st.session_state.get("raman_fit_target") not in fit_target_options:
                st.session_state["raman_fit_target"] = fit_target_default
            _skip8 = st.session_state.get("raman_skip_fit", False)
            with st.expander(step_exp_label(8, "峰擬合", s8 or _skip8), expanded=not (s8 or _skip8)):
                skip_fit = st.checkbox("跳過此步驟 ✓", key="raman_skip_fit")
                if not skip_fit:
                    sample_type = st.radio(
                        "樣品類型",
                        ["薄膜", "粉末"],
                        horizontal=True,
                        key="raman_sample_type",
                    )
                    _fwhm_default = (
                        float(max(15.0, min(60.0, (_e1 - _e0) / 15.0)))
                        if sample_type == "粉末"
                        else float(max(4.0, min(24.0, (_e1 - _e0) / 30.0)))
                    )
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
                    fit_initial_fwhm = float(st.number_input(
                        "預設初始 FWHM (cm⁻¹)",
                        min_value=float(max(step_size, 0.5)),
                        max_value=float(max(300.0, x_max_g - x_min_g)),
                        value=float(st.session_state.get("raman_fit_init_fwhm", _fwhm_default)),
                        step=float(max(step_size, 0.5)),
                        format="%.1f",
                        key="raman_fit_init_fwhm",
                    ))
                    st.caption("峰位管理（載入材料參考峰 / 自訂峰）在圖表下方操作。")
                if skip_fit:
                    st.session_state["raman_step8_done"] = True
                s8 = st.session_state.get("raman_step8_done", False)
                if not skip_fit and not s8:
                    if _next_btn("raman_btn8", "raman_step8_done"):
                        s8 = True
                run_peak_fit = (not skip_fit) and s8
            skip_fit = st.session_state.get("raman_skip_fit", False)
            s8 = st.session_state.get("raman_step8_done", False)
            run_peak_fit = (not skip_fit) and s8
        else:
            fit_target = fit_target_default

        # ── 放大顯示設定（sidebar，永遠顯示只要有資料）──────────────────────
        if data_dict:
            st.divider()
            st.markdown("**放大顯示**")
            zoom_on = st.checkbox(
                "啟用放大圖",
                value=st.session_state.get("raman_zoom_on", False),
                key="raman_zoom_on",
                help="在主圖下方顯示指定 X 範圍的放大圖，y 軸自動縮放",
            )
            if zoom_on:
                _z_lo = float(st.session_state.get("raman_zoom_start", float(x_min_g)))
                _z_hi = float(st.session_state.get("raman_zoom_end", float(x_max_g)))
                _z_lo = max(float(x_min_g), min(_z_lo, float(x_max_g)))
                _z_hi = max(float(x_min_g), min(_z_hi, float(x_max_g)))
                if _z_lo >= _z_hi:
                    _z_lo, _z_hi = float(x_min_g), float(x_max_g)
                st.session_state["raman_zoom_start"] = _z_lo
                st.session_state["raman_zoom_end"] = _z_hi
                z_range = st.slider(
                    "放大區間 (cm⁻¹)",
                    min_value=float(x_min_g),
                    max_value=float(x_max_g),
                    value=(_z_lo, _z_hi),
                    step=step_size,
                    format="%.0f",
                    key="raman_zoom_range_slider",
                )
                st.session_state["raman_zoom_start"] = float(min(z_range))
                st.session_state["raman_zoom_end"] = float(max(z_range))


    r_start = x_min_g
    r_end = x_max_g

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
    fit_source_map: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    peak_signal_label = None
    fit_curve_export_df = pd.DataFrame()
    fit_summary_export_df = pd.DataFrame()
    fit_qc_summary: dict[str, object] = {}
    apply_interpolation = bool(do_interpolate or do_average)

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
                raw_interp = interpolate_spectrum_to_grid(xc, yc, new_x, fill_value=np.nan)
                input_interp = interpolate_spectrum_to_grid(xc, y_input, new_x, fill_value=np.nan)
                if not (np.all(np.isfinite(raw_interp)) and np.all(np.isfinite(input_interp))):
                    st.warning(f"{fname}：插值後資料不完整，已跳過。")
                    continue
                all_interp_raw.append(raw_interp)
                all_interp_input.append(input_interp)
                if sub_correction_enabled and fname in data_dict_original and show_pre_correction:
                    xv_orig, yv_orig = data_dict_original[fname]
                    mask_o = (xv_orig >= avg_start) & (xv_orig <= avg_end)
                    if np.any(mask_o):
                        fig1.add_trace(go.Scatter(
                            x=xv_orig[mask_o], y=yv_orig[mask_o],
                            mode="lines", name=f"{fname}（扣除前）",
                            line=dict(width=1.0, dash="longdash"),
                            opacity=0.25,
                        ))
                if sub_correction_enabled and fname in sub_spectrum_scaled and show_sub_spectrum:
                    xsub, ysub = sub_spectrum_scaled[fname]
                    mask_s = (xsub >= avg_start) & (xsub <= avg_end)
                    if np.any(mask_s):
                        fig1.add_trace(go.Scatter(
                            x=xsub[mask_s], y=ysub[mask_s],
                            mode="lines", name=f"基板×縮放（{fname}）",
                            line=dict(color="gray", width=1.0, dash="longdash"),
                            opacity=0.5,
                        ))
                if show_individual:
                    fig1.add_trace(go.Scatter(
                        x=new_x, y=raw_interp, mode="lines", name=fname,
                        line=dict(width=1, dash="dot"), opacity=0.35,
                    ))

            if all_interp_input:
                avg_raw = mean_spectrum_arrays(all_interp_raw)
                avg_input = mean_spectrum_arrays(all_interp_input)
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

                peak_signal, peak_signal_label = _raman_peak_source(
                    avg_raw, avg_input, y_bg, y_smooth, y_final
                )
                fit_source_map["Average"] = (new_x, peak_signal)

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
            xc_raw, yc_raw = xv[mask], yv[mask]
            if len(xc_raw) < 2:
                st.warning(f"{fname}：所選範圍內數據點不足，已跳過。")
                continue
            color = RAMAN_COLORS[i % len(RAMAN_COLORS)]

            # ── 基板扣除前後疊加顯示 ───────────────────────────────────────
            if sub_correction_enabled and fname in data_dict_original:
                xv_orig, yv_orig = data_dict_original[fname]
                mask_o = (xv_orig >= r_start) & (xv_orig <= r_end)
                if show_pre_correction and np.any(mask_o):
                    fig1.add_trace(go.Scatter(
                        x=xv_orig[mask_o], y=yv_orig[mask_o],
                        mode="lines", name=f"{fname}（扣除前）",
                        line=dict(color=color, width=1.2, dash="dot"),
                        opacity=0.35,
                    ))
                if show_sub_spectrum and fname in sub_spectrum_scaled:
                    xsub, ysub = sub_spectrum_scaled[fname]
                    mask_s = (xsub >= r_start) & (xsub <= r_end)
                    if np.any(mask_s):
                        fig1.add_trace(go.Scatter(
                            x=xsub[mask_s], y=ysub[mask_s],
                            mode="lines", name=f"基板×縮放（{fname}）",
                            line=dict(color="gray", width=1.0, dash="longdash"),
                            opacity=0.5,
                        ))
            y_input, spike_mask = despike_signal(
                yc_raw, despike_method,
                threshold=despike_threshold,
                window_points=despike_window,
                passes=despike_passes,
            )
            if apply_interpolation:
                interp_x = np.linspace(float(xc_raw.min()), float(xc_raw.max()), interp_points)
                yc = interpolate_spectrum_to_grid(xc_raw, yc_raw, interp_x, fill_value=np.nan)
                y_input = interpolate_spectrum_to_grid(xc_raw, y_input, interp_x, fill_value=np.nan)
                if not (np.all(np.isfinite(yc)) and np.all(np.isfinite(y_input))):
                    st.warning(f"{fname}：內插後資料不完整，已跳過。")
                    continue
                xc = interp_x
            else:
                xc = xc_raw
                yc = yc_raw
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
                    x=xc_raw[spike_mask], y=yc_raw[spike_mask], mode="markers",
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

            peak_signal, peak_signal_label = _raman_peak_source(
                yc, y_input, y_bg, y_smooth, y_final
            )
            fit_source_map[fname] = (xc, peak_signal)

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
    if sub_scale_info:
        st.caption("基板扣除縮放比：" + "；".join(sub_scale_info))


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
    scroll_anchor("raman-bg-plot")
    st.plotly_chart(fig1, use_container_width=True)
    auto_scroll_on_appear(
        "raman-bg-plot",
        visible=bg_method != "none",
        state_key="raman_scroll_bg_plot",
        block="start",
    )

    # ── Render figure 2 (normalization) ───────────────────────────────────────
    if norm_method != "none":
        scroll_anchor("raman-norm-plot")
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
        auto_scroll_on_appear(
            "raman-norm-plot",
            visible=True,
            state_key="raman_scroll_norm_plot",
            block="start",
        )
    else:
        auto_scroll_on_appear(
            "raman-norm-plot",
            visible=False,
            state_key="raman_scroll_norm_plot",
        )

    # ── Render zoom panel ──────────────────────────────────────────────────────
    if st.session_state.get("raman_zoom_on", False):
        zm_start = float(st.session_state.get("raman_zoom_start", r_start))
        zm_end = float(st.session_state.get("raman_zoom_end", r_end))
        if zm_start < zm_end:
            # Rebuild zoom figure from the same traces used in the source figure
            src_fig = fig2 if norm_method != "none" else fig1
            zoom_fig = go.Figure()
            for tr in src_fig.data:
                x_tr = np.asarray(tr.x) if tr.x is not None else np.array([])
                y_tr = np.asarray(tr.y) if tr.y is not None else np.array([])
                if len(x_tr) == 0:
                    continue
                mask_z = (x_tr >= zm_start) & (x_tr <= zm_end)
                if not np.any(mask_z):
                    continue
                zoom_fig.add_trace(go.Scatter(
                    x=x_tr[mask_z], y=y_tr[mask_z],
                    mode=tr.mode, name=tr.name,
                    line=tr.line if hasattr(tr, "line") else None,
                    marker=tr.marker if hasattr(tr, "marker") else None,
                    text=None,
                    showlegend=tr.showlegend if hasattr(tr, "showlegend") else True,
                    opacity=tr.opacity if hasattr(tr, "opacity") else 1.0,
                ))
            zoom_fig.update_layout(
                xaxis_title="Raman Shift (cm⁻¹)",
                yaxis_title="Intensity（放大）",
                legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                template="plotly_dark",
                height=360,
                margin=dict(l=50, r=20, t=40, b=50),
            )
            st.caption(f"放大顯示 {zm_start:.0f} – {zm_end:.0f} cm⁻¹（y 軸自動縮放）")
            st.plotly_chart(zoom_fig, use_container_width=True)

    if export_frames:
        with st.expander("處理前後比較 / Baseline Preview", expanded=False):
            compare_targets = list(export_frames.keys())
            if st.session_state.get("raman_compare_dataset") not in compare_targets:
                st.session_state["raman_compare_dataset"] = compare_targets[0]
            compare_dataset = st.selectbox(
                "比較資料集",
                compare_targets,
                key="raman_compare_dataset",
            )
            compare_df = export_frames.get(compare_dataset, pd.DataFrame())
            if not compare_df.empty and "Raman_Shift_cm" in compare_df.columns:
                available_compare_cols = [c for c in compare_df.columns if c != "Raman_Shift_cm"]
                valid_saved_cols = [
                    col for col in st.session_state.get("raman_compare_cols", [])
                    if col in available_compare_cols
                ]
                if not valid_saved_cols:
                    st.session_state["raman_compare_cols"] = _default_compare_columns(available_compare_cols)

                compare_ctrl_cols = st.columns([2.2, 1.2])
                compare_cols = compare_ctrl_cols[0].multiselect(
                    "顯示階段",
                    options=available_compare_cols,
                    default=st.session_state.get("raman_compare_cols", []),
                    format_func=_process_column_display_name,
                    key="raman_compare_cols",
                    help="可直接對照原始、背景基準線、背景扣除後、平滑後與歸一化後曲線。",
                )
                compare_range_on = compare_ctrl_cols[1].checkbox(
                    "限制比較區間",
                    value=st.session_state.get("raman_compare_range_on", False),
                    key="raman_compare_range_on",
                )

                x_cmp = compare_df["Raman_Shift_cm"].to_numpy(dtype=float)
                x_cmp_min = float(np.nanmin(x_cmp))
                x_cmp_max = float(np.nanmax(x_cmp))
                if compare_range_on:
                    prev_cmp = st.session_state.get("raman_compare_range", (x_cmp_min, x_cmp_max))
                    cmp_lo = float(np.clip(float(min(prev_cmp)), x_cmp_min, x_cmp_max))
                    cmp_hi = float(np.clip(float(max(prev_cmp)), x_cmp_min, x_cmp_max))
                    if cmp_lo >= cmp_hi:
                        cmp_lo, cmp_hi = x_cmp_min, x_cmp_max
                    st.session_state["raman_compare_range"] = (cmp_lo, cmp_hi)
                    compare_range = st.slider(
                        "比較區間 (cm⁻¹)",
                        min_value=x_cmp_min,
                        max_value=x_cmp_max,
                        value=(cmp_lo, cmp_hi),
                        step=max(step_size, 0.1),
                        format="%.1f cm⁻¹",
                        key="raman_compare_range",
                    )
                    cmp_start = float(min(compare_range))
                    cmp_end = float(max(compare_range))
                else:
                    cmp_start, cmp_end = x_cmp_min, x_cmp_max

                if not compare_cols:
                    st.info("請至少選擇一個處理階段來比較。")
                else:
                    mask_cmp = (x_cmp >= cmp_start) & (x_cmp <= cmp_end)
                    compare_fig = go.Figure()
                    compare_palette = ["#F6C85F", "#6F4E7C", "#9FD356", "#CA472F", "#45B7B7", "#FF8C42"]
                    for idx, col in enumerate(compare_cols):
                        y_cmp = compare_df[col].to_numpy(dtype=float)
                        color = "#A0AEC0" if col == "Background" else compare_palette[idx % len(compare_palette)]
                        line = dict(color=color, width=2.2)
                        if col == "Background":
                            line["dash"] = "longdash"
                        elif col.endswith("_raw") or col == "Intensity_raw":
                            line["dash"] = "dot"
                            line["width"] = 1.8
                        compare_fig.add_trace(go.Scatter(
                            x=x_cmp[mask_cmp],
                            y=y_cmp[mask_cmp],
                            mode="lines",
                            name=_process_column_display_name(col),
                            line=line,
                        ))
                    compare_fig.update_layout(
                        xaxis_title="Raman Shift (cm⁻¹)",
                        yaxis_title="Intensity",
                        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                        template="plotly_dark",
                        height=420,
                        margin=dict(l=50, r=20, t=40, b=50),
                    )
                    st.caption(
                        f"{compare_dataset}：目前顯示 {cmp_start:.1f} – {cmp_end:.1f} cm⁻¹。"
                        "可用來判斷 baseline 是否過度扣除、平滑是否扭曲峰形。"
                    )
                    st.plotly_chart(compare_fig, use_container_width=True)

    if run_peak_fit:
        scroll_anchor("raman-fit-management")
        st.subheader("峰擬合")

        # ── Peak candidate table ──────────────────────────────────────────────
        with st.expander("峰位管理", expanded=True):
            st.session_state[_PEAK_CANDS_KEY] = _ensure_peak_df(
                st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df())
            )

            # ── 載入參考峰 ────────────────────────────────────────────────────
            mat_sel = st.multiselect(
                "選擇材料",
                sorted(RAMAN_REFERENCES),
                key="raman_fit_mat_sel",
                placeholder="選擇一或多種材料…",
            )
            btn_cols = st.columns([2, 1.5])
            if btn_cols[0].button("載入參考峰", key="raman_load_mat_btn", use_container_width=True):
                for mat in mat_sel:
                    _add_ref_to_session(mat, fit_initial_fwhm)
                if mat_sel:
                    st.rerun()
            if btn_cols[1].button("清空峰位表", key="raman_clear_peaks_btn", use_container_width=True):
                st.session_state[_PEAK_CANDS_KEY] = _empty_peak_df()
                _reset_peak_editor_widget()
                st.rerun()

            st.divider()

            # ── 峰位表 ────────────────────────────────────────────────────────
            peak_df_for_ui = _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df()))
            peak_total = len(peak_df_for_ui)
            peak_enabled = int(peak_df_for_ui["啟用"].sum()) if not peak_df_for_ui.empty else 0
            peak_primary = int(peak_df_for_ui["峰類別"].isin(["主峰", "強峰"]).sum()) if not peak_df_for_ui.empty else 0

            ctrl_cols = st.columns([3.5, 1, 1.1, 1.1])
            ctrl_cols[0].caption(
                f"共 **{peak_total}** 峰 · 啟用 **{peak_enabled}** · 停用 {peak_total - peak_enabled} · 主峰/強峰 {peak_primary}"
            )
            if ctrl_cols[1].button("排序", key="raman_peak_sort_btn", use_container_width=True, help="依位置由小到大排序"):
                st.session_state[_PEAK_CANDS_KEY] = _sort_peak_candidate_df(peak_df_for_ui)
                _reset_peak_editor_widget()
                st.rerun()
            if ctrl_cols[2].button("啟用全部", key="raman_peak_enable_all_btn", use_container_width=True):
                peak_df_all = peak_df_for_ui.copy()
                peak_df_all["啟用"] = True
                st.session_state[_PEAK_CANDS_KEY] = _ensure_peak_df(peak_df_all)
                _reset_peak_editor_widget()
                st.rerun()
            if ctrl_cols[3].button("停用全部", key="raman_peak_disable_all_btn", use_container_width=True):
                peak_df_all = peak_df_for_ui.copy()
                peak_df_all["啟用"] = False
                st.session_state[_PEAK_CANDS_KEY] = _ensure_peak_df(peak_df_all)
                _reset_peak_editor_widget()
                st.rerun()

            peak_table_cols = ["Peak_ID", "啟用", "材料", "位置_cm", "初始_FWHM_cm", "顯示名稱"]
            peak_editor_source = peak_df_for_ui[peak_table_cols].copy()
            edited_view = st.data_editor(
                peak_editor_source,
                key=_peak_editor_widget_key(),
                column_config={
                    "Peak_ID": st.column_config.TextColumn("ID", width="small"),
                    "啟用": st.column_config.CheckboxColumn("✓", width="small"),
                    "材料": st.column_config.TextColumn("材料", width="medium"),
                    "位置_cm": st.column_config.NumberColumn(
                        "位置 (cm⁻¹)", format="%.1f", min_value=10.0, max_value=4000.0, width="small"),
                    "初始_FWHM_cm": st.column_config.NumberColumn(
                        "FWHM (cm⁻¹)", format="%.1f", min_value=0.5, max_value=500.0, width="small"),
                    "顯示名稱": st.column_config.TextColumn("峰名稱", width="large"),
                },
                disabled=["Peak_ID"],
                num_rows="fixed",
                use_container_width=True,
                hide_index=True,
            )

            peak_edit_cols = st.columns([1.25, 1.15, 3.6])
            apply_peak_table = peak_edit_cols[0].button(
                "套用表格變更",
                key="raman_peak_apply_btn",
                type="primary",
                use_container_width=True,
            )
            reset_peak_table = peak_edit_cols[1].button(
                "恢復未套用",
                key="raman_peak_reset_btn",
                use_container_width=True,
            )
            peak_edit_cols[2].caption(
                "峰位表的勾選、位置、FWHM 與峰名稱會先暫存在表格內；按「套用表格變更」後才會真正寫回。"
            )

            if apply_peak_table:
                edited_cands = peak_df_for_ui.copy()
                for col in peak_table_cols:
                    edited_cands[col] = edited_view[col].values
                st.session_state[_PEAK_CANDS_KEY] = _ensure_peak_df(edited_cands)
                _reset_peak_editor_widget()
                _clear_raman_fit_artifacts()
                st.rerun()

            if reset_peak_table:
                _reset_peak_editor_widget()
                st.rerun()

            st.divider()

            # ── 手動新增峰位 ──────────────────────────────────────────────────
            with st.container(border=True):
                st.caption("＋ 手動新增峰位")
                manual_series = fit_source_map.get(fit_target)
                manual_x_min = float(manual_series[0].min()) if manual_series is not None else float(x_min_g)
                manual_x_max = float(manual_series[0].max()) if manual_series is not None else float(x_max_g)
                manual_default_pos = float(np.clip(
                    st.session_state.get("raman_manual_peak_pos", (manual_x_min + manual_x_max) / 2.0),
                    manual_x_min,
                    manual_x_max,
                ))

                add_cols = st.columns([2.5, 1.2, 1])
                material_choice = add_cols[0].selectbox(
                    "材料",
                    ["（未指定）"] + sorted(RAMAN_REFERENCES) + ["自訂材料"],
                    key="raman_manual_peak_material_choice",
                )
                manual_pos = float(add_cols[1].number_input(
                    "峰位 (cm⁻¹)",
                    min_value=float(manual_x_min),
                    max_value=float(manual_x_max),
                    value=float(manual_default_pos),
                    step=float(step_size),
                    format="%.1f",
                    key="raman_manual_peak_pos",
                ))
                manual_fwhm = float(add_cols[2].number_input(
                    "FWHM",
                    min_value=float(max(step_size, 0.5)),
                    max_value=500.0,
                    value=float(fit_initial_fwhm),
                    step=float(max(step_size, 0.5)),
                    format="%.1f",
                    key="raman_manual_peak_fwhm",
                ))

                if material_choice == "自訂材料":
                    manual_material = st.text_input(
                        "自訂材料名稱",
                        value=st.session_state.get("raman_manual_peak_material_custom", ""),
                        key="raman_manual_peak_material_custom",
                        placeholder="例如 NiO thin film",
                    ).strip()
                else:
                    manual_material = "" if material_choice == "（未指定）" else material_choice

                manual_name = st.text_input(
                    "峰名稱（可留白，自動根據材料生成）",
                    value=st.session_state.get("raman_manual_peak_name", ""),
                    key="raman_manual_peak_name",
                    placeholder="如：Si 基板峰、NiO 主峰",
                )

                with st.expander("進階設定（模式標籤 / 類別 / 備註）"):
                    adv_cols = st.columns([2, 1.5])
                    manual_mode = adv_cols[0].text_input(
                        "模式 / 簡稱",
                        value=st.session_state.get("raman_manual_peak_mode", ""),
                        key="raman_manual_peak_mode",
                        placeholder="如 1TO、A₁g、2TO",
                    )
                    manual_role_choice = adv_cols[1].selectbox(
                        "峰類別",
                        ["自動判定"] + _PEAK_ROLE_OPTIONS,
                        key="raman_manual_peak_role",
                    )
                    manual_note = st.text_input(
                        "備註",
                        value=st.session_state.get("raman_manual_peak_note", ""),
                        key="raman_manual_peak_note",
                        placeholder="可選",
                    )

                preview_row = _build_peak_candidate_row(
                    source="數值新增",
                    material=manual_material,
                    position_cm=manual_pos,
                    default_fwhm=manual_fwhm,
                    peak_role="" if manual_role_choice == "自動判定" else manual_role_choice,
                    mode_label=manual_mode,
                    display_name=manual_name,
                    note=manual_note,
                )
                st.caption(
                    f"→ **{preview_row['顯示名稱']}**  ·  {manual_pos:.1f} cm⁻¹  ·  FWHM {manual_fwhm:.1f}"
                )
                if st.button("＋ 新增到峰位表", key="raman_add_manual_peak_btn", use_container_width=True):
                    _add_rows_to_session([preview_row])
                    st.rerun()

        auto_scroll_on_appear(
            "raman-fit-management",
            visible=True,
            state_key="raman_scroll_fit_management",
            block="start",
        )

        # ── Fit execution ─────────────────────────────────────────────────────
        current_peak_df = _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df()))
        has_enabled = (
            not current_peak_df.empty
            and "啟用" in current_peak_df.columns
            and bool(current_peak_df["啟用"].any())
        )
        active_cands = current_peak_df[current_peak_df["啟用"] == True] if has_enabled else pd.DataFrame()
        fit_series = fit_source_map.get(fit_target)

        if active_cands.empty:
            st.info("請在上方峰位管理表載入或新增峰位後再執行擬合。")
        elif fit_series is None:
            st.info("目前沒有可用於擬合的曲線（請確認步驟 1–6 已完成）。")
        else:
            fit_x_s, fit_y_s = fit_series
            in_range = active_cands[
                (active_cands["位置_cm"] >= float(fit_x_s.min())) &
                (active_cands["位置_cm"] <= float(fit_x_s.max()))
            ]
            out_count = len(active_cands) - len(in_range)
            if out_count:
                st.caption(f"注意：{out_count} 個峰位超出目前 x 軸範圍，已略過。")

            init_peaks = [
                {
                    "label": str(r["顯示名稱"]).strip() or str(r["標籤"]).strip(),
                    "be": float(r["位置_cm"]),
                    "fwhm": float(max(0.5, r["初始_FWHM_cm"])),
                    "peak_id": str(r.get("Peak_ID", "")),
                    "source": str(r.get("來源", "")),
                    "material": str(r.get("材料", "")),
                    "role": str(r.get("峰類別", "")),
                    "ref_center": _coerce_optional_float(r.get("理論位置_cm")),
                    "init_center": float(r["位置_cm"]),
                    "mode_label": str(r.get("標籤", "")),
                    "display_name": str(r.get("顯示名稱", "")),
                    "note": str(r.get("備註", "")),
                }
                for _, r in in_range.iterrows()
            ]

            if not init_peaks:
                st.warning("所有啟用峰位都超出目前 x 軸範圍。")
            else:
                btn_label = f"▶ 執行擬合（{len(init_peaks)} 個峰，{fit_profile}）"
                auto_refit_requested = (
                    bool(st.session_state.get(_AUTO_REFIT_FLAG_KEY, False))
                    and st.session_state.get(_AUTO_REFIT_TARGET_KEY) == fit_target
                )
                if auto_refit_requested:
                    st.session_state[_AUTO_REFIT_FLAG_KEY] = False
                    st.session_state.pop(_AUTO_REFIT_TARGET_KEY, None)

                if st.button(btn_label, type="primary", key="raman_run_fit_btn") or auto_refit_requested:
                    with st.spinner("Raman 峰擬合中…"):
                        _res = fit_peaks(fit_x_s, fit_y_s, init_peaks=init_peaks, profile=fit_profile)
                    st.session_state["raman_fit_result"] = _res
                    st.session_state["raman_fit_result_target"] = fit_target
                    st.session_state["raman_fit_result_xy"] = (fit_x_s.copy(), fit_y_s.copy())

                fit_result = st.session_state.get("raman_fit_result")
                stored_target = st.session_state.get("raman_fit_result_target")

                if fit_result is not None and stored_target == fit_target:
                    fit_x_r, fit_y_r = st.session_state["raman_fit_result_xy"]

                    if not fit_result.get("success"):
                        st.warning(f"峰擬合失敗：{fit_result.get('message', '')}")
                    else:
                        review_min_area_pct = float(st.session_state.get("raman_review_min_area_pct", 1.0))
                        review_max_abs_delta = float(st.session_state.get("raman_review_max_abs_delta", 10.0))
                        fit_summary_df = pd.DataFrame([
                            {
                                "Dataset": fit_target,
                                "Peak_ID": pk.get("peak_id", ""),
                                "Peak_Name": pk.get("display_name", pk["label"]),
                                "Material": pk.get("material", ""),
                                "Peak_Role": pk.get("role", ""),
                                "Mode_Label": pk.get("mode_label", ""),
                                "Ref_cm": pk.get("ref_center", float("nan")),
                                "Center_cm": pk["center"],
                                "Delta_cm": (
                                    float(pk["center"]) - float(pk.get("ref_center"))
                                    if np.isfinite(_coerce_optional_float(pk.get("ref_center")))
                                    else float("nan")
                                ),
                                "FWHM_cm": pk["fwhm"],
                                "Area": pk["area"],
                                "Area_pct": pk["area_pct"],
                                "Source": pk.get("source", ""),
                                "Note": pk.get("note", ""),
                            }
                            for pk in fit_result["peaks"]
                        ])
                        fit_summary_df["Quality_Flag"] = fit_summary_df.apply(
                            lambda row: _build_fit_quality_flag(
                                area=float(row["Area"]),
                                area_pct=float(row["Area_pct"]),
                                delta_cm=float(row["Delta_cm"]),
                                min_area_pct=review_min_area_pct,
                                max_abs_delta=review_max_abs_delta,
                            ),
                            axis=1,
                        )

                        flagged_count = int((fit_summary_df["Quality_Flag"] != "OK").sum())
                        area_zero_count = int((fit_summary_df["Area"].abs() <= 1e-9).sum())
                        low_area_count = int((fit_summary_df["Area_pct"] < review_min_area_pct).sum())
                        large_delta_count = int(
                            fit_summary_df["Delta_cm"].abs().gt(review_max_abs_delta).fillna(False).sum()
                        )

                        summary_cols = st.columns(4)
                        summary_cols[0].metric("擬合峰數", len(fit_summary_df))
                        summary_cols[1].metric("可疑峰", flagged_count)
                        summary_cols[2].metric("Area=0", area_zero_count)
                        summary_cols[3].metric("偏移過大", large_delta_count)

                        fit_colors = [
                            "#EF553B", "#636EFA", "#00CC96", "#AB63FA",
                            "#FFA15A", "#19D3F3", "#FF6692", "#B6E880",
                        ]
                        fig_fit = go.Figure()
                        fig_fit.add_trace(go.Scatter(
                            x=fit_x_r, y=fit_y_r,
                            mode="lines", name="實驗曲線",
                            line=dict(color="white", width=1.6, dash="dot"),
                        ))
                        fig_fit.add_trace(go.Scatter(
                            x=fit_x_r, y=fit_result["y_fit"],
                            mode="lines", name="擬合包絡",
                            line=dict(color="#FFD166", width=2.5),
                        ))
                        for pi, (pk_info, yi) in enumerate(
                            zip(fit_result["peaks"], fit_result["y_individual"])
                        ):
                            color = fit_colors[pi % len(fit_colors)]
                            peak_row = fit_summary_df.iloc[pi]
                            peak_name = str(pk_info.get("display_name") or pk_info["label"])
                            ref_text = "-" if not np.isfinite(float(peak_row["Ref_cm"])) else f"{float(peak_row['Ref_cm']):.1f}"
                            delta_text = "-" if not np.isfinite(float(peak_row["Delta_cm"])) else f"{float(peak_row['Delta_cm']):+.1f}"
                            quality_flag = str(peak_row["Quality_Flag"])
                            line_dash = "dashdot" if quality_flag != "OK" else "dash"
                            fig_fit.add_trace(go.Scatter(
                                x=fit_x_r, y=yi,
                                mode="lines",
                                name=f"{peak_name}  {pk_info['center']:.1f} cm⁻¹",
                                line=dict(color=color, width=1.8 if quality_flag != "OK" else 1.5, dash=line_dash),
                                fill="tozeroy",
                                fillcolor=hex_to_rgba(color, 0.18 if quality_flag != "OK" else 0.12),
                                hovertemplate=(
                                    f"<b>{peak_name}</b><br>"
                                    f"ID: {peak_row['Peak_ID']}<br>"
                                    f"Ref: {ref_text} cm⁻¹  Fit: {float(peak_row['Center_cm']):.1f} cm⁻¹  Δ: {delta_text}<br>"
                                    f"Area%: {float(peak_row['Area_pct']):.2f}  狀態: {quality_flag}<extra></extra>"
                                ),
                            ))
                        fig_fit.add_trace(go.Scatter(
                            x=fit_x_r, y=fit_result["residuals"],
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
                        fit_qc_summary = {
                            "fit_target": fit_target,
                            "fit_profile": fit_profile,
                            "r_squared": r2,
                            "peak_count": int(len(fit_summary_df)),
                            "flagged_peak_count": flagged_count,
                            "area_zero_count": area_zero_count,
                            "low_area_count": low_area_count,
                            "large_delta_count": large_delta_count,
                            "min_area_pct_threshold": review_min_area_pct,
                            "max_abs_delta_threshold": review_max_abs_delta,
                        }

                        # ── 審核表 ────────────────────────────────────────────
                        st.divider()
                        thresh_cols = st.columns(2)
                        review_min_area_pct = float(thresh_cols[0].number_input(
                            "低面積門檻 Area%",
                            min_value=0.0, max_value=100.0,
                            value=review_min_area_pct,
                            step=0.1, format="%.1f",
                            key="raman_review_min_area_pct",
                        ))
                        review_max_abs_delta = float(thresh_cols[1].number_input(
                            "偏移門檻 |Δ| (cm⁻¹)",
                            min_value=0.0, max_value=200.0,
                            value=review_max_abs_delta,
                            step=0.5, format="%.1f",
                            key="raman_review_max_abs_delta",
                        ))

                        review_ids = set(fit_summary_df["Peak_ID"].astype(str))
                        current_peak_df = _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df()))

                        qbtn_cols = st.columns(4)
                        disable_area_zero = qbtn_cols[0].button("停用 Area=0", key="raman_review_disable_area0", use_container_width=True)
                        disable_low_area = qbtn_cols[1].button(f"停用 Area%<{review_min_area_pct:g}", key="raman_review_disable_low_area", use_container_width=True)
                        disable_large_delta = qbtn_cols[2].button(f"停用 |Δ|>{review_max_abs_delta:g}", key="raman_review_disable_large_delta", use_container_width=True)
                        restore_review = qbtn_cols[3].button("恢復本次全部", key="raman_review_restore", use_container_width=True)

                        next_peak_df: pd.DataFrame | None = None
                        if disable_area_zero:
                            next_peak_df = _apply_peak_enable_flags(
                                current_peak_df, review_ids=review_ids,
                                disable_ids=set(fit_summary_df.loc[fit_summary_df["Area"].abs() <= 1e-9, "Peak_ID"].astype(str)),
                            )
                        elif disable_low_area:
                            next_peak_df = _apply_peak_enable_flags(
                                current_peak_df, review_ids=review_ids,
                                disable_ids=set(fit_summary_df.loc[fit_summary_df["Area_pct"] < review_min_area_pct, "Peak_ID"].astype(str)),
                            )
                        elif disable_large_delta:
                            next_peak_df = _apply_peak_enable_flags(
                                current_peak_df, review_ids=review_ids,
                                disable_ids=set(fit_summary_df.loc[fit_summary_df["Delta_cm"].abs() > review_max_abs_delta, "Peak_ID"].astype(str)),
                            )
                        elif restore_review:
                            next_peak_df = _apply_peak_enable_flags(current_peak_df, review_ids=review_ids, enable_all=True)

                        if next_peak_df is not None:
                            st.session_state[_PEAK_CANDS_KEY] = _ensure_peak_df(next_peak_df)
                            _reset_peak_editor_widget()
                            _queue_raman_auto_refit(fit_target)
                            st.rerun()

                        # ── Si 峰位移 → 雙軸應力 ──────────────────────────────
                        si_cands = fit_summary_df[
                            fit_summary_df["Material"].str.contains(
                                r"n[-\s]?Si|p[-\s]?Si|\bSi\b", case=False, na=False, regex=True
                            )
                            & fit_summary_df["Center_cm"].between(480, 570)
                        ]
                        if not si_cands.empty:
                            with st.expander("Si 峰位移 → 雙軸應力估算", expanded=False):
                                st.caption(
                                    "依 Anastassakis et al. (1990)，(100) Si 的雙軸應力轉換係數約為 "
                                    "**Δω = −1.93 cm⁻¹/GPa**。"
                                    "Δω > 0 → 壓應力（compressive）；Δω < 0 → 拉應力（tensile）。"
                                )
                                _col_ref, _col_coeff = st.columns(2)
                                si_ref_pos = float(_col_ref.number_input(
                                    "無應力參考位置 (cm⁻¹)",
                                    value=float(st.session_state.get("raman_si_ref_pos", 520.7)),
                                    step=0.1, format="%.1f",
                                    key="raman_si_ref_pos",
                                    help="體矽 520.7 cm⁻¹；可改成您量測的標準品值",
                                ))
                                si_coeff = float(_col_coeff.number_input(
                                    "轉換係數 (cm⁻¹/GPa)",
                                    value=float(st.session_state.get("raman_si_stress_coeff", -1.93)),
                                    step=0.01, format="%.3f",
                                    key="raman_si_stress_coeff",
                                    help="雙軸：−1.93；單軸 [100]：約 −1.6 cm⁻¹/GPa",
                                ))
                                _stress_rows = []
                                for _, _sr in si_cands.iterrows():
                                    _center = float(_sr["Center_cm"])
                                    _dw = _center - si_ref_pos
                                    _sigma = (_dw / si_coeff) if abs(si_coeff) > 1e-9 else np.nan
                                    _interp = (
                                        "壓應力（compressive）" if _sigma < -0.05 else
                                        "拉應力（tensile）" if _sigma > 0.05 else
                                        "接近無應力"
                                    ) if np.isfinite(_sigma) else "—"
                                    _stress_rows.append({
                                        "Peak_ID": _sr["Peak_ID"],
                                        "Peak_Name": _sr["Peak_Name"],
                                        "Ref (cm⁻¹)": si_ref_pos,
                                        "Center (cm⁻¹)": round(_center, 2),
                                        "Δω (cm⁻¹)": round(_dw, 3),
                                        "σ (GPa)": round(_sigma, 3) if np.isfinite(_sigma) else None,
                                        "解讀": _interp,
                                    })
                                _stress_df = pd.DataFrame(_stress_rows)
                                st.dataframe(_stress_df, use_container_width=True, hide_index=True)
                                _m_cols = st.columns(min(4, len(_stress_rows)))
                                for _mc, _row in zip(_m_cols, _stress_rows):
                                    _σ = _row.get("σ (GPa)")
                                    if _σ is not None:
                                        _mc.metric(
                                            label=(_row["Peak_Name"] or _row["Peak_ID"])[:18],
                                            value=f"{_σ:+.3f} GPa",
                                            delta=_row["解讀"],
                                        )
                                st.caption(
                                    "此估算假設峰位移完全來自應力；若樣品有組成偏析、"
                                    "溫度效應或多峰疊加，需進一步校正。"
                                )

                        enabled_map = dict(zip(current_peak_df["Peak_ID"].astype(str), current_peak_df["啟用"].astype(bool)))
                        review_table_source = pd.DataFrame({
                            "啟用": [bool(enabled_map.get(str(pid), True)) for pid in fit_summary_df["Peak_ID"]],
                            "Peak_ID": fit_summary_df["Peak_ID"].values,
                            "峰名稱": fit_summary_df["Peak_Name"].values,
                            "位置_cm": fit_summary_df["Center_cm"].round(1).values,
                            "Ref_cm": fit_summary_df["Ref_cm"].round(1).values,
                            "Δ_cm": fit_summary_df["Delta_cm"].round(1).values,
                            "FWHM_cm": fit_summary_df["FWHM_cm"].round(1).values,
                            "Area_pct": fit_summary_df["Area_pct"].round(2).values,
                            "狀態": fit_summary_df["Quality_Flag"].values,
                        })
                        review_edited = st.data_editor(
                            review_table_source,
                            column_config={
                                "啟用": st.column_config.CheckboxColumn("啟用", width="small"),
                                "Peak_ID": st.column_config.TextColumn("ID", width="small"),
                                "峰名稱": st.column_config.TextColumn("峰名稱", width="large"),
                                "位置_cm": st.column_config.NumberColumn("位置 cm⁻¹", format="%.1f", width="small"),
                                "Ref_cm": st.column_config.NumberColumn("理論 cm⁻¹", format="%.1f", width="small"),
                                "Δ_cm": st.column_config.NumberColumn("Δ cm⁻¹", format="%.1f", width="small"),
                                "FWHM_cm": st.column_config.NumberColumn("FWHM", format="%.1f", width="small"),
                                "Area_pct": st.column_config.NumberColumn("Area%", format="%.2f", width="small"),
                                "狀態": st.column_config.TextColumn("狀態", width="medium"),
                            },
                            disabled=["Peak_ID", "峰名稱", "位置_cm", "Ref_cm", "Δ_cm", "FWHM_cm", "Area_pct", "狀態"],
                            num_rows="fixed",
                            use_container_width=True,
                            hide_index=True,
                        )
                        if st.button("套用並重擬合 ▶", type="primary", key="raman_review_apply_refit", use_container_width=True):
                            updated_enabled = dict(zip(
                                review_edited["Peak_ID"].astype(str),
                                review_edited["啟用"].astype(bool),
                            ))
                            new_peak_df = current_peak_df.copy()
                            for idx, row in new_peak_df.iterrows():
                                pid = str(row["Peak_ID"])
                                if pid in updated_enabled:
                                    new_peak_df.at[idx, "啟用"] = updated_enabled[pid]
                            st.session_state[_PEAK_CANDS_KEY] = _ensure_peak_df(new_peak_df)
                            _reset_peak_editor_widget()
                            _queue_raman_auto_refit(fit_target)
                            st.rerun()

                        fit_curve_df = pd.DataFrame({
                            "Raman_Shift_cm": fit_x_r,
                            "Experimental": fit_y_r,
                            "Fit_envelope": fit_result["y_fit"],
                            "Residuals": fit_result["residuals"],
                        })
                        for pk, yi in zip(fit_result["peaks"], fit_result["y_individual"]):
                            component_name = str(pk.get("display_name", pk["label"])).strip() or "Peak"
                            component_id = str(pk.get("peak_id", "")).strip()
                            fit_curve_df[
                                f"{component_id}_{component_name}_{pk['center']:.1f}_component"
                            ] = yi

                        fit_summary_export_df = fit_summary_df.copy()

                        fit_curve_export_df = fit_curve_df.copy()
    else:
        auto_scroll_on_appear(
            "raman-fit-management",
            visible=False,
            state_key="raman_scroll_fit_management",
            block="start",
        )

    # ── Export ─────────────────────────────────────────────────────────────────
    if export_frames or not fit_curve_export_df.empty or not fit_summary_export_df.empty or bool(fit_qc_summary):
        st.subheader("匯出")
        st.caption("下載區已整理成三類：研究常用、原始處理輸出、追溯 / QC。通常先拿研究常用，再視需要保存完整紀錄。")

        st.markdown("**研究常用**")
        st.caption("最常拿來做圖、寫結果與和其他樣品比較的檔案。")
        research_cards_rendered = False
        if not fit_summary_export_df.empty:
            research_cards_rendered = True
            _render_download_card(
                title="擬合峰表 CSV",
                description="包含每個峰的峰位、FWHM、Area%、理論峰位與偏移量，適合整理研究結果、做後續統計與對照文獻。",
                input_label="檔名",
                default_name=f"{st.session_state.get('raman_fit_result_target', 'raman')}_raman_fit_peaks",
                extension="csv",
                button_label="下載擬合峰表 CSV",
                data=fit_summary_export_df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key="raman_fit_peak_fname",
                button_key="raman_fit_peak_dl",
            )

        export_items = list(export_frames.items())
        if export_items:
            research_cards_rendered = True
            st.caption("處理後光譜會保留目前流程下的主要數值欄位，適合重畫光譜、做樣品比較或再匯入其他分析工具。")
            for start in range(0, len(export_items), 2):
                row_items = export_items[start:start + 2]
                row_cols = st.columns(len(row_items))
                for col, (fname, df) in zip(row_cols, row_items):
                    base = fname.rsplit(".", 1)[0]
                    with col:
                        _render_download_card(
                            title=f"處理後光譜：{fname}",
                            description="適合後續重畫光譜、和其他樣品比較，或再匯入分析軟體做進一步處理。",
                            input_label="檔名",
                            default_name=f"{base}_processed",
                            extension="csv",
                            button_label="下載處理後光譜 CSV",
                            data=df.to_csv(index=False).encode("utf-8"),
                            mime="text/csv",
                            input_key=f"raman_fname_{fname}",
                            button_key=f"raman_dl_{fname}",
                        )
        if not research_cards_rendered:
            st.caption("完成光譜處理或峰擬合後，這裡會出現最常用的下載檔案。")

        st.markdown("**原始處理輸出**")
        st.caption("偏向完整數值輸出，適合二次分析、重建圖表或自己做其他後處理。")
        if not fit_curve_export_df.empty:
            _render_download_card(
                title="擬合曲線 CSV",
                description="包含實驗曲線、擬合包絡、殘差與每個 component 曲線，適合重繪擬合圖、檢查殘差或做更深入分析。",
                input_label="檔名",
                default_name=f"{st.session_state.get('raman_fit_result_target', 'raman')}_raman_fit",
                extension="csv",
                button_label="下載擬合曲線 CSV",
                data=fit_curve_export_df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key="raman_fit_curve_fname",
                button_key="raman_fit_curve_dl",
            )
        else:
            st.caption("完成峰擬合後，這裡會提供完整的擬合曲線輸出。")

        processing_report = {
            "report_type": "raman_processing_report",
            "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "module": "raman",
            "input_files": [uf.name for uf in uploaded_files],
            "dataset_count": len(data_dict),
            "average_enabled": bool(do_average),
            "processed_datasets": list(export_frames.keys()),
            "peak_source_label": peak_signal_label,
            "last_applied_preset_name": st.session_state.get("raman_last_applied_preset_name"),
            "substrate_correction": {
                "enabled": bool(sub_uploader is not None and sub_correction_enabled),
                "substrate_file": getattr(sub_uploader, "name", None) if sub_uploader is not None else None,
                "align_peak_cm": float(sub_peak_pos) if sub_uploader is not None else None,
                "scale_info": list(sub_scale_info),
            },
            "processing": {
                "despike": {
                    "skip": bool(skip_despike),
                    "method": despike_method,
                    "threshold": float(despike_threshold),
                    "window": int(despike_window),
                    "passes": int(despike_passes),
                },
                "average": {
                    "skip": bool(skip_avg),
                    "interpolation_enabled": bool(apply_interpolation),
                    "average_enabled": bool(do_average),
                    "interp_points": int(interp_points) if apply_interpolation else None,
                    "show_individual": bool(show_individual),
                },
                "background": {
                    "skip": bool(skip_bg),
                    "method": bg_method,
                    "range_cm": [float(bg_x_start), float(bg_x_end)],
                    "poly_degree": int(poly_deg),
                    "baseline_lambda": float(baseline_lambda),
                    "baseline_p": float(baseline_p),
                    "baseline_iter": int(baseline_iter),
                },
                "smoothing": {
                    "skip": bool(skip_smooth),
                    "method": smooth_method,
                    "window": int(smooth_window),
                    "poly_degree": int(smooth_poly_deg),
                },
                "normalization": {
                    "skip": bool(skip_norm),
                    "method": norm_method,
                    "range_cm": [float(norm_x_start), float(norm_x_end)],
                },
                "fit": {
                    "skip": bool(skip_fit),
                    "target": st.session_state.get("raman_fit_result_target"),
                    "profile": st.session_state.get("raman_fit_profile"),
                    "summary": _dataframe_records(fit_summary_export_df),
                    "qc_summary": _json_safe(fit_qc_summary),
                },
            },
            "peak_candidates": _dataframe_records(
                _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df()))
            ),
            "preset_snapshot": _build_raman_preset_payload(),
        }

        st.markdown("**追溯 / QC**")
        st.caption("保存參數、流程與品質指標，方便日後重現分析、交叉比對與研究存檔。")
        report_cols = st.columns(2)
        with report_cols[0]:
            _render_download_card(
                title="處理報告 JSON",
                description="完整保存本次 Raman 流程的參數、處理步驟與峰位表，適合研究追溯、重現分析與日後整理。",
                input_label="檔名",
                default_name="raman_processing_report",
                extension="json",
                button_label="下載處理報告 JSON",
                data=json.dumps(_json_safe(processing_report), ensure_ascii=False, indent=2).encode("utf-8"),
                mime="application/json",
                input_key="raman_report_fname",
                button_key="raman_report_dl",
            )

        with report_cols[1]:
            if fit_qc_summary:
                qc_df = pd.DataFrame([_json_safe(fit_qc_summary)])
                _render_download_card(
                    title="QC 摘要 CSV",
                    description="整理本次擬合的 R²、可疑峰數、Area=0 與偏移過大統計，適合快速做品質檢查與批次比較。",
                    input_label="檔名",
                    default_name="raman_fit_qc_summary",
                    extension="csv",
                    button_label="下載 QC 摘要 CSV",
                    data=qc_df.to_csv(index=False).encode("utf-8"),
                    mime="text/csv",
                    input_key="raman_qc_fname",
                    button_key="raman_qc_dl",
                )
            else:
                with st.container(border=True):
                    st.markdown("**QC 摘要 CSV**")
                    st.caption("完成峰擬合後，這裡會提供本次擬合的 QC 摘要下載。")
