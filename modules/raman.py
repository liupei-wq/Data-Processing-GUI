"""Raman-specific numerical helpers, result-table utilities, and Streamlit UI."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import plotly.io as pio
import streamlit as st
from scipy.ndimage import maximum_filter1d
from scipy.signal import peak_widths

from core.parsers import parse_two_column_spectrum_bytes
from core.spectrum_ops import detect_spectrum_peaks, interpolate_spectrum_to_grid, mean_spectrum_arrays
from core.ui_helpers import (
    _next_btn,
    auto_scroll_on_appear,
    hex_to_rgba,
    scroll_anchor,
    step_header,
    step_header_with_skip,
)
from peak_fitting import fit_peaks
from processing import apply_normalization, apply_processing, despike_signal, smooth_signal
from raman_database import RAMAN_REFERENCES

_SUBSTRATE_KEYS: set[str] = {"Si (基板)", "Sapphire α-Al₂O₃ (c-plane)"}
_FILM_KEYS: list[str] = [k for k in RAMAN_REFERENCES if k not in _SUBSTRATE_KEYS]
_PEAK_CANDS_KEY = "raman_fit_candidates"
_EDITOR_WIDGET_KEY = "raman_peak_editor_widget"
_PEAK_ROLE_OPTIONS = ["主峰", "強峰", "次峰", "弱峰", "待判定", "自訂"]
_PEAK_ID_COUNTER_KEY = "raman_peak_id_counter"
_AUTO_REFIT_FLAG_KEY = "raman_fit_auto_refit"
_AUTO_REFIT_TARGET_KEY = "raman_fit_auto_refit_target"
_REVIEW_PICK_KEY = "raman_fit_review_pick"
_FIT_HISTORY_KEY = "raman_fit_history"
_RAMAN_PRESET_VERSION = 1
_RAMAN_PRESET_KEYS = [
    "raman_sub_peak_pos", "raman_sub_enabled", "raman_show_sub", "raman_show_pre_corr",
    "raman_skip_despike", "raman_despike_method", "raman_despike_threshold",
    "raman_despike_window", "raman_despike_passes", "raman_show_spikes", "raman_step2_done",
    "raman_skip_avg", "raman_do_avg", "raman_interp", "raman_show_ind", "raman_step3_done",
    "raman_skip_bg", "raman_bg_method", "raman_poly_deg", "raman_baseline_lambda_exp",
    "raman_baseline_iter", "raman_baseline_p", "raman_bg_range", "raman_show_bg",
    "raman_step4_done", "raman_skip_smooth", "raman_smooth_method", "raman_smooth_window",
    "raman_smooth_poly", "raman_step5_done", "raman_skip_norm", "raman_norm_method",
    "raman_norm_range", "raman_step6_done", "raman_skip_peaks", "raman_peak_prominence",
    "raman_peak_height", "raman_peak_distance", "raman_peak_max", "raman_peak_labels",
    "raman_local_prom", "raman_local_window_cm", "raman_detect_range_on",
    "raman_detect_x_start", "raman_detect_x_end", "raman_step7_done", "raman_skip_fit",
    "raman_fit_target", "raman_fit_profile", "raman_fit_init_fwhm", "raman_step8_done",
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
        st.session_state.pop(_EDITOR_WIDGET_KEY, None)


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
        st.session_state.pop(_EDITOR_WIDGET_KEY, None)


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


def _apply_fit_tuning_to_peak_df(current_df: pd.DataFrame, tune_df: pd.DataFrame) -> pd.DataFrame:
    out = _ensure_peak_df(current_df).copy()
    if tune_df is None or not isinstance(tune_df, pd.DataFrame) or tune_df.empty:
        return out

    updates: dict[str, dict[str, float]] = {}
    for row in tune_df.to_dict("records"):
        if not bool(row.get("套用", False)):
            continue
        peak_id = str(row.get("Peak_ID", "")).strip()
        if not peak_id:
            continue
        new_center = pd.to_numeric(row.get("下一輪位置_cm"), errors="coerce")
        new_fwhm = pd.to_numeric(row.get("下一輪FWHM_cm"), errors="coerce")
        updates[peak_id] = {
            "位置_cm": float(new_center) if np.isfinite(new_center) else float("nan"),
            "初始_FWHM_cm": float(new_fwhm) if np.isfinite(new_fwhm) else float("nan"),
        }

    if not updates:
        return out

    for idx, peak_id in out["Peak_ID"].astype(str).items():
        upd = updates.get(peak_id)
        if upd is None:
            continue
        if np.isfinite(upd["位置_cm"]):
            out.at[idx, "位置_cm"] = float(upd["位置_cm"])
        if np.isfinite(upd["初始_FWHM_cm"]):
            out.at[idx, "初始_FWHM_cm"] = float(max(0.5, upd["初始_FWHM_cm"]))
    return _ensure_peak_df(out)


def _fit_summary_signature(df: pd.DataFrame) -> str:
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return "empty"
    subset_cols = [c for c in ["Peak_ID", "Center_cm", "FWHM_cm", "Quality_Flag"] if c in df.columns]
    payload = df[subset_cols].round(6).to_csv(index=False)
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


def _recommend_fit_tuning_action(flag: str, ref_cm: float, delta_cm: float) -> str:
    flag = str(flag or "").strip()
    if "Area=0" in flag:
        return "建議停用"
    if "|Δ|" in flag and np.isfinite(ref_cm):
        return "建議回拉理論位置"
    if "Area%<" in flag:
        return "低面積，視情況停用"
    if flag == "OK":
        return "可直接沿用本次結果"
    return "人工判斷"


def _build_fit_tuning_table(fit_summary_df: pd.DataFrame, current_peak_df: pd.DataFrame) -> pd.DataFrame:
    current_df = _ensure_peak_df(current_peak_df)
    current_map = current_df.set_index("Peak_ID") if not current_df.empty else pd.DataFrame()
    rows: list[dict] = []
    for row in fit_summary_df.to_dict("records"):
        peak_id = str(row.get("Peak_ID", "")).strip()
        current_init_center = float("nan")
        current_init_fwhm = float("nan")
        if not current_map.empty and peak_id in current_map.index:
            current_init_center = _coerce_optional_float(current_map.at[peak_id, "位置_cm"])
            current_init_fwhm = _coerce_optional_float(current_map.at[peak_id, "初始_FWHM_cm"])
        ref_cm = _coerce_optional_float(row.get("Ref_cm"))
        delta_cm = _coerce_optional_float(row.get("Delta_cm"))
        flag = str(row.get("Quality_Flag", "")).strip()
        rows.append({
            "套用": False,
            "Peak_ID": peak_id,
            "Peak_Name": str(row.get("Peak_Name", "")),
            "Ref_cm": ref_cm,
            "Center_cm": _coerce_optional_float(row.get("Center_cm")),
            "Delta_cm": delta_cm,
            "FWHM_cm": _coerce_optional_float(row.get("FWHM_cm")),
            "目前初始位置_cm": current_init_center,
            "目前初始FWHM_cm": current_init_fwhm,
            "下一輪位置_cm": _coerce_optional_float(row.get("Center_cm")),
            "下一輪FWHM_cm": _coerce_optional_float(row.get("FWHM_cm")),
            "Quality_Flag": flag,
            "建議": _recommend_fit_tuning_action(flag, ref_cm, delta_cm),
        })
    return pd.DataFrame(rows)


def _set_fit_tuning_selection(tune_df: pd.DataFrame, selector: str, max_abs_delta: float) -> pd.DataFrame:
    out = tune_df.copy()
    if out.empty:
        return out
    if selector == "all":
        out["套用"] = True
    elif selector == "flagged":
        out["套用"] = out["Quality_Flag"].astype(str) != "OK"
    elif selector == "large_delta":
        out["套用"] = out["Delta_cm"].abs().gt(float(max_abs_delta)).fillna(False)
    elif selector == "zero_area":
        out["套用"] = out["Quality_Flag"].astype(str).str.contains("Area=0", regex=False)
    elif selector == "keep":
        return out
    else:
        out["套用"] = False
    return out


def _fill_selected_fit_tuning_rows(
    tune_df: pd.DataFrame,
    *,
    center_mode: str,
    fwhm_mode: str,
    fwhm_cap: float,
) -> pd.DataFrame:
    out = tune_df.copy()
    if out.empty or "套用" not in out.columns:
        return out
    mask = out["套用"].astype(bool)
    if not mask.any():
        return out

    if center_mode == "fit":
        out.loc[mask, "下一輪位置_cm"] = out.loc[mask, "Center_cm"]
    elif center_mode == "ref":
        ref_mask = mask & out["Ref_cm"].notna()
        out.loc[ref_mask, "下一輪位置_cm"] = out.loc[ref_mask, "Ref_cm"]
    elif center_mode == "current":
        out.loc[mask, "下一輪位置_cm"] = out.loc[mask, "目前初始位置_cm"]

    if fwhm_mode == "fit":
        out.loc[mask, "下一輪FWHM_cm"] = out.loc[mask, "FWHM_cm"]
    elif fwhm_mode == "fit_cap":
        capped = out.loc[mask, "FWHM_cm"].clip(upper=float(max(0.5, fwhm_cap)))
        out.loc[mask, "下一輪FWHM_cm"] = capped
    elif fwhm_mode == "current":
        out.loc[mask, "下一輪FWHM_cm"] = out.loc[mask, "目前初始FWHM_cm"]
    return out


def _format_review_option(row: pd.Series) -> str:
    ref_text = "-" if not np.isfinite(float(row["Ref_cm"])) else f"{float(row['Ref_cm']):.1f}"
    delta = float(row["Delta_cm"])
    delta_text = "-" if not np.isfinite(delta) else f"{delta:+.1f}"
    return (
        f"{row['Peak_ID']}｜{row['Peak_Name']}｜Ref {ref_text}｜"
        f"Fit {float(row['Center_cm']):.1f}｜Δ {delta_text}"
    )


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
    st.session_state.pop(_EDITOR_WIDGET_KEY, None)
    _clear_raman_fit_artifacts()


def _try_plotly_export_bytes(fig: go.Figure, fmt: str) -> tuple[bytes | None, str | None]:
    try:
        img_bytes = pio.to_image(fig, format=fmt)
        return img_bytes, None
    except Exception as exc:
        return None, str(exc)


def _build_publication_fit_figure(
    fit_x: np.ndarray,
    fit_y: np.ndarray,
    fit_result: dict,
    fit_summary_df: pd.DataFrame,
    *,
    show_components: bool = True,
) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=fit_x, y=fit_y,
        mode="lines", name="Experimental",
        line=dict(color="black", width=2.0),
    ))
    fig.add_trace(go.Scatter(
        x=fit_x, y=fit_result["y_fit"],
        mode="lines", name="Fit",
        line=dict(color="#d62728", width=2.4),
    ))
    pub_colors = [
        "#1f77b4", "#ff7f0e", "#2ca02c", "#9467bd",
        "#8c564b", "#e377c2", "#17becf", "#bcbd22",
    ]
    if show_components:
        for pi, (pk, yi) in enumerate(zip(fit_result["peaks"], fit_result["y_individual"])):
            fig.add_trace(go.Scatter(
                x=fit_x,
                y=yi,
                mode="lines",
                name=str(pk.get("display_name", pk["label"])),
                line=dict(color=pub_colors[pi % len(pub_colors)], width=1.3, dash="dot"),
            ))
    fig.update_layout(
        template="none",
        paper_bgcolor="white",
        plot_bgcolor="white",
        font=dict(color="black", size=16),
        xaxis=dict(
            title="Raman Shift (cm⁻¹)",
            showline=True,
            linewidth=1.5,
            linecolor="black",
            mirror=True,
            showgrid=False,
            zeroline=False,
        ),
        yaxis=dict(
            title="Intensity (a.u.)",
            showline=True,
            linewidth=1.5,
            linecolor="black",
            mirror=True,
            showgrid=False,
            zeroline=False,
        ),
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="right",
            x=1,
        ),
        height=560,
        margin=dict(l=70, r=30, t=40, b=60),
    )
    return fig


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


def build_raman_peak_table(
    dataset: str,
    x: np.ndarray,
    y: np.ndarray,
    peak_idx: np.ndarray,
) -> pd.DataFrame:
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


def _detect_raman_peaks(
    x: np.ndarray,
    y: np.ndarray,
    prom_ratio: float,
    height_ratio: float,
    distance_cm: float,
    max_peaks: int,
    detect_x_start: float,
    detect_x_end: float,
    use_local_prom: bool,
    local_window_cm: float,
) -> np.ndarray:
    """Peak detection with optional X-range filter and local adaptive normalization.

    Returns indices into the *original* x/y arrays.
    """
    # -- X range filter --
    if detect_x_start > x[0] or detect_x_end < x[-1]:
        mask = (x >= detect_x_start) & (x <= detect_x_end)
        x_det = x[mask]
        y_det = y[mask]
        orig_idx = np.where(mask)[0]
    else:
        x_det, y_det = x, y
        orig_idx = np.arange(len(x), dtype=int)

    if len(x_det) < 3:
        return np.array([], dtype=int)

    # -- Local adaptive normalization --
    if use_local_prom:
        step = (x_det[-1] - x_det[0]) / max(len(x_det) - 1, 1)
        win = max(5, int(local_window_cm / step))
        local_max = maximum_filter1d(y_det, size=win)
        local_max = np.where(local_max < 1e-10, 1e-10, local_max)
        y_for_det = y_det / local_max
    else:
        y_for_det = y_det

    sub_idx = detect_spectrum_peaks(
        x_det, y_for_det, prom_ratio, height_ratio, distance_cm, max_peaks,
    )
    if len(sub_idx) == 0:
        return np.array([], dtype=int)
    # map sub-array indices back to original array
    return orig_idx[sub_idx]


def run_raman_ui():
    RAMAN_COLORS = ["#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
                    "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52"]

    # ── Step 1: file upload (sidebar) ─────────────────────────────────────────
    with st.sidebar:
        with st.expander("Raman Preset", expanded=False):
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

    # ── Compute global x range ─────────────────────────────────────────────────
    _all_x = np.concatenate([xv for xv, _ in data_dict.values()])
    x_min_g = float(_all_x.min())
    x_max_g = float(_all_x.max())
    ov_min = float(max(xv.min() for xv, _ in data_dict.values()))
    ov_max = float(min(xv.max() for xv, _ in data_dict.values()))
    _e0 = x_min_g
    _e1 = x_max_g
    step_size = float(max(0.1, (x_max_g - x_min_g) / 2000))
    raman_peak_distance_default = float(max(step_size, min(20.0, max(step_size, (_e1 - _e0) / 80))))

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
    detect_x_start = float(x_min_g)
    detect_x_end = float(x_max_g)
    use_local_prom = False
    local_window_cm = 100.0

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

                # ── 局部自適應靈敏度 ──────────────────────────────────────────
                use_local_prom = st.checkbox(
                    "局部自適應靈敏度",
                    value=False,
                    key="raman_local_prom",
                    help="偵測前對每個局部區域做歸一化，讓強峰（如 Si）旁邊的弱峰也能被偵測到",
                )
                if use_local_prom:
                    local_window_cm = float(st.number_input(
                        "局部窗口 (cm⁻¹)",
                        min_value=20.0,
                        max_value=float(max(200.0, x_max_g - x_min_g)),
                        value=100.0,
                        step=10.0,
                        format="%.0f",
                        key="raman_local_window_cm",
                    ))

                # ── 限制偵測 X 範圍 ───────────────────────────────────────────
                use_detect_range = st.checkbox(
                    "限制偵測 X 範圍",
                    value=False,
                    key="raman_detect_range_on",
                    help="只在指定區間內搜尋峰值，適合只看某段薄膜訊號區域",
                )
                if use_detect_range:
                    detect_x_start = float(st.number_input(
                        "偵測起點 (cm⁻¹)",
                        min_value=float(x_min_g),
                        max_value=float(x_max_g),
                        value=float(x_min_g),
                        step=step_size,
                        format="%.1f",
                        key="raman_detect_x_start",
                    ))
                    detect_x_end = float(st.number_input(
                        "偵測終點 (cm⁻¹)",
                        min_value=float(x_min_g),
                        max_value=float(x_max_g),
                        value=float(x_max_g),
                        step=step_size,
                        format="%.1f",
                        key="raman_detect_x_end",
                    ))

            if skip_peaks:
                st.session_state["raman_step7_done"] = True
            s7 = st.session_state.get("raman_step7_done", False)
            if not skip_peaks and not s7:
                if _next_btn("raman_btn7", "raman_step7_done"):
                    s7 = True
            run_peak_detection = step6_done and not skip_peaks
        else:
            skip_peaks = False
        step7_done = step6_done and (skip_peaks or s7)

    # ── Step 8: peak fitting (sidebar) ────────────────────────────────────────
    fit_profile = "voigt"
    fit_initial_fwhm = float(max(4.0, min(24.0, (_e1 - _e0) / 30.0)))
    fit_target_options = ["Average"] if do_average else list(data_dict.keys())
    fit_target_default = fit_target_options[0]
    run_peak_fit = False
    skip_fit = False

    with st.sidebar:
        s8 = st.session_state.get("raman_step8_done", False)
        if step7_done:
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
                fit_initial_fwhm = float(st.number_input(
                    "預設初始 FWHM (cm⁻¹)",
                    min_value=float(max(step_size, 0.5)),
                    max_value=float(max(200.0, x_max_g - x_min_g)),
                    value=float(max(4.0, min(24.0, (_e1 - _e0) / 30.0))),
                    step=float(max(step_size, 0.5)),
                    format="%.1f",
                    key="raman_fit_init_fwhm",
                ))
                st.caption("峰位管理（載入基板 / 薄膜 / 自訂峰）在圖表下方操作。")
            if skip_fit:
                st.session_state["raman_step8_done"] = True
            s8 = st.session_state.get("raman_step8_done", False)
            if not skip_fit and not s8:
                if _next_btn("raman_btn8", "raman_step8_done"):
                    s8 = True
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
    peak_tables: list[pd.DataFrame] = []
    peak_table_map: dict[str, pd.DataFrame] = {}
    fit_source_map: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    peak_signal_label = None
    fit_summary_export_df = pd.DataFrame()
    fit_curve_export_df = pd.DataFrame()
    publication_fit_fig: go.Figure | None = None
    fit_qc_summary: dict[str, object] = {}
    fit_history_df = st.session_state.get(_FIT_HISTORY_KEY, pd.DataFrame())
    if not isinstance(fit_history_df, pd.DataFrame):
        fit_history_df = pd.DataFrame()

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
                if run_peak_detection:
                    peak_idx = _detect_raman_peaks(
                        new_x, peak_signal, peak_prom_ratio,
                        peak_height_ratio, peak_distance_cm, max_peak_labels,
                        detect_x_start, detect_x_end,
                        use_local_prom, local_window_cm,
                    )
                    peak_table = build_raman_peak_table("Average", new_x, peak_signal, peak_idx)
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

            peak_signal, peak_signal_label = _raman_peak_source(
                yc, y_input, y_bg, y_smooth, y_final
            )
            fit_source_map[fname] = (xc, peak_signal)
            if run_peak_detection:
                peak_idx = _detect_raman_peaks(
                    xc, peak_signal, peak_prom_ratio,
                    peak_height_ratio, peak_distance_cm, max_peak_labels,
                    detect_x_start, detect_x_end,
                    use_local_prom, local_window_cm,
                )
                peak_table = build_raman_peak_table(fname, xc, peak_signal, peak_idx)
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
        scroll_anchor("raman-fit-management")
        st.subheader("峰擬合")

        # ── Peak candidate table ──────────────────────────────────────────────
        with st.expander("峰位管理", expanded=True):
            st.session_state[_PEAK_CANDS_KEY] = _ensure_peak_df(
                st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df())
            )
            peak_df_for_ui = _sort_peak_candidate_df(st.session_state[_PEAK_CANDS_KEY])
            st.session_state[_PEAK_CANDS_KEY] = peak_df_for_ui
            c_sub, c_film, c_ops = st.columns([2, 4, 2])

            sub_sel = c_sub.selectbox(
                "基板峰", ["（不選）"] + sorted(_SUBSTRATE_KEYS),
                key="raman_fit_sub_sel", label_visibility="collapsed",
            )
            if c_sub.button("載入基板峰", key="raman_load_sub_btn", use_container_width=True):
                if sub_sel != "（不選）":
                    _add_ref_to_session(sub_sel, fit_initial_fwhm)
                    st.rerun()

            film_sel = c_film.multiselect(
                "薄膜材料", sorted(_FILM_KEYS),
                key="raman_fit_film_sel", label_visibility="collapsed",
                placeholder="選擇薄膜材料…",
            )
            if c_film.button("載入薄膜峰", key="raman_load_film_btn", use_container_width=True):
                for mat in film_sel:
                    _add_ref_to_session(mat, fit_initial_fwhm)
                if film_sel:
                    st.rerun()

            if run_peak_detection:
                if c_ops.button("載入偵測峰", key="raman_load_det_btn", use_container_width=True):
                    det_df = peak_table_map.get(fit_target, pd.DataFrame())
                    if not det_df.empty:
                        new_rows = [
                            _build_peak_candidate_row(
                                source="自動偵測",
                                material="未指定",
                                position_cm=float(r.Raman_Shift_cm),
                                default_fwhm=float(max(1.0, r.FWHM_cm)),
                                peak_role="待判定",
                                mode_label=f"Peak {idx}",
                                display_name=f"待判定峰 {float(r.Raman_Shift_cm):.1f} cm⁻¹",
                                note="由自動偵測加入，建議補上材料或峰名稱。",
                            )
                            for idx, r in enumerate(det_df.itertuples(index=False), start=1)
                        ]
                        _add_rows_to_session(new_rows)
                        st.rerun()

            if c_ops.button("清空峰位表", key="raman_clear_peaks_btn", use_container_width=True):
                st.session_state[_PEAK_CANDS_KEY] = _empty_peak_df()
                st.session_state.pop(_EDITOR_WIDGET_KEY, None)
                st.rerun()

            peak_df_for_ui = _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df()))
            peak_total = len(peak_df_for_ui)
            peak_enabled = int(peak_df_for_ui["啟用"].sum()) if not peak_df_for_ui.empty else 0
            peak_primary = int(peak_df_for_ui["峰類別"].isin(["主峰", "強峰"]).sum()) if not peak_df_for_ui.empty else 0
            metric_cols = st.columns(4)
            metric_cols[0].metric("峰總數", peak_total)
            metric_cols[1].metric("已啟用", peak_enabled)
            metric_cols[2].metric("已停用", peak_total - peak_enabled)
            metric_cols[3].metric("主峰/強峰", peak_primary)

            table_ctrl_cols = st.columns([1.3, 1, 1, 1.2])
            compact_peak_table = table_ctrl_cols[0].toggle(
                "簡潔表格",
                value=st.session_state.get("raman_peak_table_compact", True),
                key="raman_peak_table_compact",
                help="簡潔模式只保留最常用欄位；進階模式會顯示來源、模式與備註。",
            )
            if table_ctrl_cols[1].button("依位置排序", key="raman_peak_sort_btn", use_container_width=True):
                st.session_state[_PEAK_CANDS_KEY] = _sort_peak_candidate_df(peak_df_for_ui)
                st.session_state.pop(_EDITOR_WIDGET_KEY, None)
                st.rerun()
            if table_ctrl_cols[2].button("啟用全部", key="raman_peak_enable_all_btn", use_container_width=True):
                peak_df_all = peak_df_for_ui.copy()
                peak_df_all["啟用"] = True
                st.session_state[_PEAK_CANDS_KEY] = _ensure_peak_df(peak_df_all)
                st.session_state.pop(_EDITOR_WIDGET_KEY, None)
                st.rerun()
            if table_ctrl_cols[3].button("全部停用", key="raman_peak_disable_all_btn", use_container_width=True):
                peak_df_all = peak_df_for_ui.copy()
                peak_df_all["啟用"] = False
                st.session_state[_PEAK_CANDS_KEY] = _ensure_peak_df(peak_df_all)
                st.session_state.pop(_EDITOR_WIDGET_KEY, None)
                st.rerun()

            st.caption(
                "在表格中可直接編輯材料、峰類別、峰名稱、位置與 FWHM；"
                "簡潔模式會隱藏來源、模式與備註，讓大量峰位時更好整理。"
            )

            peak_table_cols = (
                ["Peak_ID", "啟用", "材料", "峰類別", "理論位置_cm", "位置_cm", "顯示名稱", "初始_FWHM_cm"]
                if compact_peak_table
                else [
                    "Peak_ID", "啟用", "來源", "材料", "峰類別",
                    "理論位置_cm", "位置_cm", "標籤", "顯示名稱", "初始_FWHM_cm", "備註",
                ]
            )

            peak_editor_source = peak_df_for_ui[peak_table_cols].copy()
            edited_view = st.data_editor(
                peak_editor_source,
                key=_EDITOR_WIDGET_KEY,
                column_config={
                    "Peak_ID": st.column_config.TextColumn("Peak_ID", width="small"),
                    "啟用": st.column_config.CheckboxColumn("啟用", width="small"),
                    "來源": st.column_config.TextColumn("來源", disabled=True, width="medium"),
                    "材料": st.column_config.TextColumn("材料", width="medium"),
                    "峰類別": st.column_config.SelectboxColumn(
                        "峰類別",
                        options=_PEAK_ROLE_OPTIONS,
                        width="small",
                    ),
                    "理論位置_cm": st.column_config.NumberColumn(
                        "理論位置 (cm⁻¹)", format="%.1f", width="small"),
                    "位置_cm": st.column_config.NumberColumn(
                        "位置 (cm⁻¹)", format="%.1f", min_value=10.0, max_value=4000.0),
                    "標籤": st.column_config.TextColumn("模式 / 簡稱", width="small"),
                    "顯示名稱": st.column_config.TextColumn("峰名稱", width="large"),
                    "初始_FWHM_cm": st.column_config.NumberColumn(
                        "初始 FWHM (cm⁻¹)", format="%.1f", min_value=0.5, max_value=500.0),
                    "備註": st.column_config.TextColumn("備註", width="large"),
                },
                disabled=["Peak_ID", "來源", "理論位置_cm"],
                num_rows="fixed",
                use_container_width=True,
                hide_index=True,
            )

            edited_cands = peak_df_for_ui.copy()
            for col in peak_table_cols:
                edited_cands[col] = edited_view[col].values
            edited_cands = _ensure_peak_df(edited_cands)
            st.session_state[_PEAK_CANDS_KEY] = edited_cands

            st.markdown("**數值新增峰位**")
            manual_series = fit_source_map.get(fit_target)
            manual_x_min = float(manual_series[0].min()) if manual_series is not None else float(x_min_g)
            manual_x_max = float(manual_series[0].max()) if manual_series is not None else float(x_max_g)
            manual_default_pos = float(np.clip(
                st.session_state.get("raman_manual_peak_pos", (manual_x_min + manual_x_max) / 2.0),
                manual_x_min,
                manual_x_max,
            ))

            add_cols = st.columns([2.1, 1.4, 1.8, 1.4, 1.4])
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
            manual_mode = add_cols[2].text_input(
                "模式 / 簡稱",
                value=st.session_state.get("raman_manual_peak_mode", ""),
                key="raman_manual_peak_mode",
                placeholder="如 1TO、A₁g、2TO",
            )
            manual_role_choice = add_cols[3].selectbox(
                "峰類別",
                ["自動判定"] + _PEAK_ROLE_OPTIONS,
                key="raman_manual_peak_role",
            )
            manual_fwhm = float(add_cols[4].number_input(
                "初始 FWHM",
                min_value=float(max(step_size, 0.5)),
                max_value=500.0,
                value=float(fit_initial_fwhm),
                step=float(max(step_size, 0.5)),
                format="%.1f",
                key="raman_manual_peak_fwhm",
            ))

            manual_material = ""
            if material_choice == "自訂材料":
                manual_material = st.text_input(
                    "自訂材料名稱",
                    value=st.session_state.get("raman_manual_peak_material_custom", ""),
                    key="raman_manual_peak_material_custom",
                    placeholder="例如 NiO thin film",
                ).strip()
            elif material_choice != "（未指定）":
                manual_material = material_choice

            name_cols = st.columns([2.2, 1.2])
            manual_name = name_cols[0].text_input(
                "峰名稱（可留白自動生成）",
                value=st.session_state.get("raman_manual_peak_name", ""),
                key="raman_manual_peak_name",
                placeholder="例如 NiO 主峰、Si 2TO",
            )
            manual_note = name_cols[1].text_input(
                "備註（可留白）",
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
                f"預覽：{preview_row['顯示名稱']}｜{preview_row['峰類別']}｜"
                f"{preview_row['位置_cm']:.1f} cm⁻¹"
                f"{'｜' + preview_row['備註'] if preview_row['備註'] else ''}"
            )
            if st.button("新增到峰位表", key="raman_add_manual_peak_btn", use_container_width=True):
                _add_rows_to_session([preview_row])
                st.rerun()

        auto_scroll_on_appear(
            "raman-fit-management",
            visible=True,
            state_key="raman_scroll_fit_management",
            block="start",
        )

        # ── Fit execution ─────────────────────────────────────────────────────
        has_enabled = (
            not edited_cands.empty
            and "啟用" in edited_cands.columns
            and bool(edited_cands["啟用"].any())
        )
        active_cands = edited_cands[edited_cands["啟用"] == True] if has_enabled else pd.DataFrame()
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
                        summary_cols[0].metric("本次擬合峰數", len(fit_summary_df))
                        summary_cols[1].metric("可疑峰", flagged_count)
                        summary_cols[2].metric("Area=0", area_zero_count)
                        summary_cols[3].metric("偏移過大", large_delta_count)

                        plot_ctrl_cols = st.columns([1.1, 1.1, 1.2, 1.2])
                        show_peak_ids_on_plot = plot_ctrl_cols[0].checkbox(
                            "圖上標 Peak_ID",
                            value=st.session_state.get("raman_fit_show_peak_ids", len(fit_summary_df) <= 8),
                            key="raman_fit_show_peak_ids",
                            help="在擬合圖上標示 Peak_ID，方便和下方表格對照。",
                        )
                        show_flagged_only_on_plot = plot_ctrl_cols[1].checkbox(
                            "圖上只標可疑峰",
                            value=st.session_state.get("raman_fit_show_flag_only", False),
                            key="raman_fit_show_flag_only",
                            help="開啟後只在圖上標示有 Quality_Flag 的峰。",
                        )
                        review_min_area_pct = float(plot_ctrl_cols[2].number_input(
                            "低面積門檻 Area_pct (%)",
                            min_value=0.0,
                            max_value=100.0,
                            value=review_min_area_pct,
                            step=0.1,
                            format="%.1f",
                            key="raman_review_min_area_pct",
                        ))
                        review_max_abs_delta = float(plot_ctrl_cols[3].number_input(
                            "偏移門檻 |Δ| (cm⁻¹)",
                            min_value=0.0,
                            max_value=200.0,
                            value=review_max_abs_delta,
                            step=0.5,
                            format="%.1f",
                            key="raman_review_max_abs_delta",
                        ))

                        if (
                            review_min_area_pct != float(st.session_state.get("raman_review_min_area_pct", review_min_area_pct))
                            or review_max_abs_delta != float(st.session_state.get("raman_review_max_abs_delta", review_max_abs_delta))
                        ):
                            st.rerun()

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
                                    f"Peak_ID: {peak_row['Peak_ID']}<br>"
                                    f"Ref: {ref_text} cm⁻¹<br>"
                                    f"Fit: {float(peak_row['Center_cm']):.1f} cm⁻¹<br>"
                                    f"Δ: {delta_text} cm⁻¹<br>"
                                    f"Area%: {float(peak_row['Area_pct']):.2f}<br>"
                                    f"狀態: {quality_flag}<extra></extra>"
                                ),
                            ))
                        if show_peak_ids_on_plot and not fit_summary_df.empty:
                            marker_df = fit_summary_df.copy()
                            if show_flagged_only_on_plot:
                                marker_df = marker_df[marker_df["Quality_Flag"] != "OK"]
                            if not marker_df.empty:
                                marker_y = np.interp(
                                    marker_df["Center_cm"].to_numpy(dtype=float),
                                    fit_x_r,
                                    fit_result["y_fit"],
                                )
                                marker_hover = [
                                    f"{pid}｜{name}｜Δ {delta:+.1f} cm⁻¹"
                                    if np.isfinite(delta)
                                    else f"{pid}｜{name}"
                                    for pid, name, delta in zip(
                                        marker_df["Peak_ID"],
                                        marker_df["Peak_Name"],
                                        marker_df["Delta_cm"],
                                    )
                                ]
                                fig_fit.add_trace(go.Scatter(
                                    x=marker_df["Center_cm"],
                                    y=marker_y,
                                    mode="markers+text",
                                    text=marker_df["Peak_ID"],
                                    textposition="top center",
                                    textfont=dict(size=10, color="#8BE9FD"),
                                    marker=dict(
                                        color="#8BE9FD",
                                        size=8,
                                        line=dict(color="#111111", width=1),
                                    ),
                                    name="Peak_ID",
                                    showlegend=False,
                                    hovertext=marker_hover,
                                    hovertemplate="%{hovertext}<extra></extra>",
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

                        review_cfg_cols = st.columns([2.4, 1.2, 1.8])
                        review_filter_mode = review_cfg_cols[0].radio(
                            "審核表顯示",
                            ["全部峰", "只看可疑峰", "只看 Area=0", "只看低面積", "只看偏移大"],
                            horizontal=True,
                            key="raman_review_filter_mode",
                        )
                        review_sort_mode = review_cfg_cols[1].selectbox(
                            "排序方式",
                            ["可疑優先", "理論位置", "擬合位置", "面積由小到大"],
                            key="raman_review_sort_mode",
                        )
                        review_cfg_cols[2].caption(
                            "下方審核表是擬合後篩峰入口。使用快速停用或手動選取後，"
                            "會同步更新上方峰位表並自動重新擬合。"
                        )

                        fit_display_df = fit_summary_df.copy()
                        if review_filter_mode == "只看可疑峰":
                            fit_display_df = fit_display_df[fit_display_df["Quality_Flag"] != "OK"]
                        elif review_filter_mode == "只看 Area=0":
                            fit_display_df = fit_display_df[fit_display_df["Area"].abs() <= 1e-9]
                        elif review_filter_mode == "只看低面積":
                            fit_display_df = fit_display_df[fit_display_df["Area_pct"] < review_min_area_pct]
                        elif review_filter_mode == "只看偏移大":
                            fit_display_df = fit_display_df[
                                fit_display_df["Delta_cm"].abs().gt(review_max_abs_delta).fillna(False)
                            ]

                        if review_sort_mode == "理論位置":
                            fit_display_df = fit_display_df.sort_values(
                                by=["Ref_cm", "Center_cm"], ascending=[True, True], na_position="last"
                            )
                        elif review_sort_mode == "擬合位置":
                            fit_display_df = fit_display_df.sort_values(by=["Center_cm"], ascending=[True])
                        elif review_sort_mode == "面積由小到大":
                            fit_display_df = fit_display_df.sort_values(by=["Area_pct", "Center_cm"], ascending=[True, True])
                        else:
                            fit_display_df["__has_flag"] = fit_display_df["Quality_Flag"] != "OK"
                            fit_display_df["__abs_delta"] = fit_display_df["Delta_cm"].abs().fillna(0.0)
                            fit_display_df = fit_display_df.sort_values(
                                by=["__has_flag", "Area_pct", "__abs_delta", "Center_cm"],
                                ascending=[False, True, False, True],
                            ).drop(columns=["__has_flag", "__abs_delta"])

                        st.caption(f"審核表目前顯示 {len(fit_display_df)} / {len(fit_summary_df)} 個峰。")

                        st.dataframe(
                            fit_display_df.round(
                                {
                                    "Ref_cm": 3,
                                    "Center_cm": 3,
                                    "Delta_cm": 3,
                                    "FWHM_cm": 3,
                                    "Area": 4,
                                    "Area_pct": 2,
                                }
                            ),
                            use_container_width=True,
                            hide_index=True,
                        )

                        review_ids = set(fit_summary_df["Peak_ID"].astype(str))
                        review_options_df = fit_display_df.copy() if not fit_display_df.empty else fit_summary_df.copy()
                        review_option_map = {
                            _format_review_option(row): str(row["Peak_ID"])
                            for _, row in review_options_df.iterrows()
                        }

                        review_btn_cols = st.columns([1.1, 1.2, 1.2, 1.2, 1.0])
                        disable_area_zero = review_btn_cols[0].button(
                            "停用 Area=0",
                            key="raman_review_disable_area0",
                            use_container_width=True,
                        )
                        disable_low_area = review_btn_cols[1].button(
                            f"停用 Area_pct<{review_min_area_pct:g}",
                            key="raman_review_disable_low_area",
                            use_container_width=True,
                        )
                        disable_large_delta = review_btn_cols[2].button(
                            f"停用 |Δ|>{review_max_abs_delta:g}",
                            key="raman_review_disable_large_delta",
                            use_container_width=True,
                        )
                        keep_primary = review_btn_cols[3].button(
                            "本次只留主峰/強峰",
                            key="raman_review_keep_primary",
                            use_container_width=True,
                        )
                        restore_review = review_btn_cols[4].button(
                            "恢復本次擬合峰",
                            key="raman_review_restore",
                            use_container_width=True,
                        )

                        manual_review_cols = st.columns([4, 1])
                        selected_review_items = manual_review_cols[0].multiselect(
                            "手動停用峰",
                            options=list(review_option_map.keys()),
                            key=_REVIEW_PICK_KEY,
                            placeholder="選擇要停用的峰…",
                        )
                        disable_selected = manual_review_cols[1].button(
                            "停用選取峰",
                            key="raman_review_disable_selected",
                            use_container_width=True,
                        )

                        current_peak_df = _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df()))
                        next_peak_df: pd.DataFrame | None = None
                        if disable_area_zero:
                            next_peak_df = _apply_peak_enable_flags(
                                current_peak_df,
                                review_ids=review_ids,
                                disable_ids=set(
                                    fit_summary_df.loc[fit_summary_df["Area"].abs() <= 1e-9, "Peak_ID"].astype(str)
                                ),
                            )
                        elif disable_low_area:
                            next_peak_df = _apply_peak_enable_flags(
                                current_peak_df,
                                review_ids=review_ids,
                                disable_ids=set(
                                    fit_summary_df.loc[fit_summary_df["Area_pct"] < review_min_area_pct, "Peak_ID"].astype(str)
                                ),
                            )
                        elif disable_large_delta:
                            next_peak_df = _apply_peak_enable_flags(
                                current_peak_df,
                                review_ids=review_ids,
                                disable_ids=set(
                                    fit_summary_df.loc[
                                        fit_summary_df["Delta_cm"].abs() > review_max_abs_delta,
                                        "Peak_ID",
                                    ].astype(str)
                                ),
                            )
                        elif keep_primary:
                            next_peak_df = _apply_peak_enable_flags(
                                current_peak_df,
                                review_ids=review_ids,
                                enable_only_ids=set(
                                    fit_summary_df.loc[
                                        fit_summary_df["Peak_Role"].isin(["主峰", "強峰"]),
                                        "Peak_ID",
                                    ].astype(str)
                                ),
                            )
                        elif restore_review:
                            next_peak_df = _apply_peak_enable_flags(
                                current_peak_df,
                                review_ids=review_ids,
                                enable_all=True,
                            )
                        elif disable_selected and selected_review_items:
                            next_peak_df = _apply_peak_enable_flags(
                                current_peak_df,
                                review_ids=review_ids,
                                disable_ids={review_option_map[item] for item in selected_review_items},
                            )

                        if next_peak_df is not None:
                            st.session_state[_PEAK_CANDS_KEY] = _ensure_peak_df(next_peak_df)
                            st.session_state.pop(_EDITOR_WIDGET_KEY, None)
                            st.session_state.pop(_REVIEW_PICK_KEY, None)
                            _queue_raman_auto_refit(fit_target)
                            st.rerun()

                        with st.expander("下一輪初值微調", expanded=False):
                            st.caption(
                                "把本次擬合得到的中心與 FWHM 當成下一輪初值。"
                                "你可以直接在表格裡微調數字，再回寫到上方峰位表並自動重擬合。"
                            )
                            tune_state_key = f"raman_fit_tune_source_{fit_target}"
                            tune_sig_key = f"raman_fit_tune_sig_{fit_target}"
                            tune_editor_key = f"raman_fit_tune_editor_{fit_target}"
                            fit_sig = _fit_summary_signature(fit_summary_df)
                            if fit_sig != st.session_state.get(tune_sig_key):
                                st.session_state[tune_state_key] = _build_fit_tuning_table(
                                    fit_summary_df,
                                    _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df())),
                                )
                                st.session_state[tune_sig_key] = fit_sig
                                st.session_state.pop(tune_editor_key, None)

                            tune_df = st.session_state.get(tune_state_key, pd.DataFrame())
                            if not isinstance(tune_df, pd.DataFrame) or tune_df.empty:
                                tune_df = _build_fit_tuning_table(
                                    fit_summary_df,
                                    _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df())),
                                )
                                st.session_state[tune_state_key] = tune_df

                            quick_pick_cols = st.columns([1, 1, 1, 1, 1])
                            pick_all = quick_pick_cols[0].button(
                                "勾選全部峰",
                                key=f"raman_tune_pick_all_{fit_target}",
                                use_container_width=True,
                            )
                            pick_flagged = quick_pick_cols[1].button(
                                "勾選可疑峰",
                                key=f"raman_tune_pick_flagged_{fit_target}",
                                use_container_width=True,
                            )
                            pick_large_delta = quick_pick_cols[2].button(
                                "勾選偏移大",
                                key=f"raman_tune_pick_delta_{fit_target}",
                                use_container_width=True,
                            )
                            pick_zero_area = quick_pick_cols[3].button(
                                "勾選 Area=0",
                                key=f"raman_tune_pick_area0_{fit_target}",
                                use_container_width=True,
                            )
                            clear_pick = quick_pick_cols[4].button(
                                "清除勾選",
                                key=f"raman_tune_clear_pick_{fit_target}",
                                use_container_width=True,
                            )

                            select_mode = "keep"
                            if pick_all:
                                select_mode = "all"
                            elif pick_flagged:
                                select_mode = "flagged"
                            elif pick_large_delta:
                                select_mode = "large_delta"
                            elif pick_zero_area:
                                select_mode = "zero_area"
                            elif clear_pick:
                                select_mode = "clear"
                            if select_mode != "keep":
                                st.session_state[tune_state_key] = _set_fit_tuning_selection(
                                    tune_df,
                                    select_mode,
                                    review_max_abs_delta,
                                )
                                st.session_state.pop(tune_editor_key, None)
                                st.rerun()

                            fill_ctrl_cols = st.columns([1.3, 1.3, 1.0, 1.2])
                            center_fill_mode = fill_ctrl_cols[0].selectbox(
                                "位置批次填入",
                                ["本次中心", "理論位置", "目前初始位置"],
                                key=f"raman_tune_center_fill_{fit_target}",
                            )
                            fwhm_fill_mode = fill_ctrl_cols[1].selectbox(
                                "FWHM 批次填入",
                                ["本次 FWHM", "本次 FWHM（上限）", "目前初始 FWHM"],
                                key=f"raman_tune_fwhm_fill_{fit_target}",
                            )
                            fwhm_cap = float(fill_ctrl_cols[2].number_input(
                                "FWHM 上限",
                                min_value=0.5,
                                max_value=500.0,
                                value=float(st.session_state.get(f"raman_tune_fwhm_cap_{fit_target}", 80.0)),
                                step=0.5,
                                format="%.1f",
                                key=f"raman_tune_fwhm_cap_{fit_target}",
                            ))
                            fill_selected = fill_ctrl_cols[3].button(
                                "批次填入勾選峰",
                                key=f"raman_tune_fill_selected_{fit_target}",
                                use_container_width=True,
                            )
                            if fill_selected:
                                filled_df = _fill_selected_fit_tuning_rows(
                                    tune_df,
                                    center_mode={
                                        "本次中心": "fit",
                                        "理論位置": "ref",
                                        "目前初始位置": "current",
                                    }[center_fill_mode],
                                    fwhm_mode={
                                        "本次 FWHM": "fit",
                                        "本次 FWHM（上限）": "fit_cap",
                                        "目前初始 FWHM": "current",
                                    }[fwhm_fill_mode],
                                    fwhm_cap=fwhm_cap,
                                )
                                st.session_state[tune_state_key] = filled_df
                                st.session_state.pop(tune_editor_key, None)
                                st.rerun()

                            tuned_view = st.data_editor(
                                tune_df.round(
                                    {
                                        "Ref_cm": 3,
                                        "Center_cm": 3,
                                        "Delta_cm": 3,
                                        "FWHM_cm": 3,
                                        "目前初始位置_cm": 3,
                                        "目前初始FWHM_cm": 3,
                                        "下一輪位置_cm": 3,
                                        "下一輪FWHM_cm": 3,
                                    }
                                ),
                                key=tune_editor_key,
                                column_config={
                                    "套用": st.column_config.CheckboxColumn("套用", width="small"),
                                    "Peak_ID": st.column_config.TextColumn("Peak_ID", width="small"),
                                    "Peak_Name": st.column_config.TextColumn("峰名稱", width="large"),
                                    "Ref_cm": st.column_config.NumberColumn("理論位置", format="%.1f", width="small"),
                                    "Center_cm": st.column_config.NumberColumn("本次中心", format="%.3f", width="small"),
                                    "Delta_cm": st.column_config.NumberColumn("Δ", format="%.3f", width="small"),
                                    "FWHM_cm": st.column_config.NumberColumn("本次 FWHM", format="%.3f", width="small"),
                                    "目前初始位置_cm": st.column_config.NumberColumn("目前初始位置", format="%.3f", width="small"),
                                    "目前初始FWHM_cm": st.column_config.NumberColumn("目前初始 FWHM", format="%.3f", width="small"),
                                    "下一輪位置_cm": st.column_config.NumberColumn(
                                        "下一輪位置", format="%.3f", min_value=10.0, max_value=4000.0
                                    ),
                                    "下一輪FWHM_cm": st.column_config.NumberColumn(
                                        "下一輪 FWHM", format="%.3f", min_value=0.5, max_value=500.0
                                    ),
                                    "Quality_Flag": st.column_config.TextColumn("Quality", width="medium"),
                                    "建議": st.column_config.TextColumn("建議", width="medium"),
                                },
                                disabled=[
                                    "Peak_ID", "Peak_Name", "Ref_cm", "Center_cm", "Delta_cm",
                                    "FWHM_cm", "目前初始位置_cm", "目前初始FWHM_cm", "Quality_Flag", "建議",
                                ],
                                num_rows="fixed",
                                use_container_width=True,
                                hide_index=True,
                            )
                            st.session_state[tune_state_key] = tuned_view.copy()
                            tune_btn_cols = st.columns([1.2, 1.2, 1.6])
                            apply_tune = tune_btn_cols[0].button(
                                "套用到峰位表並重擬合",
                                key=f"raman_apply_fit_tune_{fit_target}",
                                use_container_width=True,
                            )
                            disable_tuned = tune_btn_cols[1].button(
                                "停用勾選峰並重擬合",
                                key=f"raman_disable_fit_tune_{fit_target}",
                                use_container_width=True,
                            )
                            selected_tune_count = int(tuned_view["套用"].sum()) if "套用" in tuned_view.columns else 0
                            tune_btn_cols[2].caption(
                                f"目前已勾選 {selected_tune_count} 個峰。"
                                "可先用上方快速勾選與批次填入，再決定要回寫初值或直接停用。"
                            )
                            selected_tune_ids = set(
                                tuned_view.loc[tuned_view["套用"] == True, "Peak_ID"].astype(str)
                            ) if "套用" in tuned_view.columns else set()
                            if apply_tune:
                                if selected_tune_count <= 0:
                                    st.warning("請先勾選至少一個峰，再套用下一輪初值。")
                                else:
                                    tuned_peak_df = _apply_fit_tuning_to_peak_df(
                                        _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df())),
                                        tuned_view,
                                    )
                                    st.session_state[_PEAK_CANDS_KEY] = tuned_peak_df
                                    st.session_state.pop(_EDITOR_WIDGET_KEY, None)
                                    _queue_raman_auto_refit(fit_target)
                                    st.rerun()
                            elif disable_tuned:
                                if selected_tune_count <= 0:
                                    st.warning("請先勾選至少一個峰，再停用。")
                                else:
                                    disabled_peak_df = _apply_peak_enable_flags(
                                        _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df())),
                                        review_ids=set(fit_summary_df["Peak_ID"].astype(str)),
                                        disable_ids=selected_tune_ids,
                                    )
                                    st.session_state[_PEAK_CANDS_KEY] = disabled_peak_df
                                    st.session_state.pop(_EDITOR_WIDGET_KEY, None)
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

                        with st.expander("發表用圖匯出", expanded=False):
                            pub_cfg_cols = st.columns([1.1, 1.5])
                            pub_show_components = pub_cfg_cols[0].checkbox(
                                "顯示 component 曲線",
                                value=True,
                                key=f"raman_pub_components_{fit_target}",
                                help="關閉後只保留原始曲線與總擬合包絡，較適合做簡潔版發表圖。",
                            )
                            pub_base_name = pub_cfg_cols[1].text_input(
                                "發表圖檔名",
                                value=f"{fit_target}_raman_publication",
                                key=f"raman_pub_fname_{fit_target}",
                            )
                            publication_fit_fig = _build_publication_fit_figure(
                                fit_x_r,
                                fit_y_r,
                                fit_result,
                                fit_summary_df,
                                show_components=pub_show_components,
                            )
                            st.plotly_chart(publication_fit_fig, use_container_width=True)

                            pub_dl_cols = st.columns(3)
                            pub_html = publication_fit_fig.to_html(
                                include_plotlyjs="cdn",
                                full_html=True,
                            ).encode("utf-8")
                            pub_dl_cols[0].download_button(
                                "⬇️ 下載 HTML 圖",
                                data=pub_html,
                                file_name=f"{(pub_base_name or fit_target + '_raman_publication').strip()}.html",
                                mime="text/html",
                                key=f"raman_pub_html_dl_{fit_target}",
                            )
                            svg_bytes, svg_err = _try_plotly_export_bytes(publication_fit_fig, "svg")
                            if svg_bytes is not None:
                                pub_dl_cols[1].download_button(
                                    "⬇️ 下載 SVG",
                                    data=svg_bytes,
                                    file_name=f"{(pub_base_name or fit_target + '_raman_publication').strip()}.svg",
                                    mime="image/svg+xml",
                                    key=f"raman_pub_svg_dl_{fit_target}",
                                )
                            else:
                                pub_dl_cols[1].caption("SVG 匯出需安裝 kaleido")
                            png_bytes, png_err = _try_plotly_export_bytes(publication_fit_fig, "png")
                            if png_bytes is not None:
                                pub_dl_cols[2].download_button(
                                    "⬇️ 下載 PNG",
                                    data=png_bytes,
                                    file_name=f"{(pub_base_name or fit_target + '_raman_publication').strip()}.png",
                                    mime="image/png",
                                    key=f"raman_pub_png_dl_{fit_target}",
                                )
                            else:
                                pub_dl_cols[2].caption("PNG 匯出需安裝 kaleido")
                            if svg_err or png_err:
                                st.caption("若要直接輸出 SVG / PNG，請安裝 `kaleido`；目前 HTML 發表圖可直接使用。")

                        with st.expander("擬合歷史比較 / 統計", expanded=False):
                            existing_run_count = (
                                int(fit_history_df["Run_Label"].nunique())
                                if not fit_history_df.empty and "Run_Label" in fit_history_df.columns
                                else 0
                            )
                            history_label = st.text_input(
                                "本次擬合標籤",
                                value=st.session_state.get(
                                    f"raman_fit_history_label_{fit_target}",
                                    f"{fit_target}_run_{existing_run_count + 1:02d}",
                                ),
                                key=f"raman_fit_history_label_{fit_target}",
                                help="可用樣品名、退火條件、重測批次等做標記，方便後面統計比較。",
                            )
                            history_btn_cols = st.columns([1.2, 1.0, 2.2])
                            save_history = history_btn_cols[0].button(
                                "加入擬合歷史",
                                key=f"raman_fit_history_add_{fit_target}",
                                use_container_width=True,
                            )
                            clear_history = history_btn_cols[1].button(
                                "清空歷史",
                                key=f"raman_fit_history_clear_{fit_target}",
                                use_container_width=True,
                            )
                            history_btn_cols[2].caption(
                                "保存後會把本次峰表附上 Run_Label、R²、門檻值，"
                                "可用來比較不同樣品或不同處理條件。"
                            )

                            if save_history:
                                saved_at = datetime.now().astimezone().isoformat(timespec="seconds")
                                history_block = fit_summary_df.copy()
                                history_block.insert(0, "Run_Label", (history_label or fit_target).strip())
                                history_block.insert(1, "Saved_At", saved_at)
                                history_block["Fit_Target"] = fit_target
                                history_block["Fit_Profile"] = fit_profile
                                history_block["R_squared"] = r2
                                history_block["Min_Area_pct_Threshold"] = review_min_area_pct
                                history_block["Max_Abs_Delta_Threshold"] = review_max_abs_delta
                                fit_history_df = pd.concat(
                                    [fit_history_df, history_block],
                                    ignore_index=True,
                                )
                                st.session_state[_FIT_HISTORY_KEY] = fit_history_df
                                st.success(f"已保存擬合歷史：{(history_label or fit_target).strip()}")

                            if clear_history:
                                fit_history_df = pd.DataFrame()
                                st.session_state[_FIT_HISTORY_KEY] = fit_history_df
                                st.info("已清空 Raman 擬合歷史。")

                            if fit_history_df.empty:
                                st.caption("尚未保存任何擬合歷史。")
                            else:
                                run_count = (
                                    int(fit_history_df["Run_Label"].nunique())
                                    if "Run_Label" in fit_history_df.columns
                                    else 0
                                )
                                st.caption(f"目前已保存 {run_count} 次擬合，共 {len(fit_history_df)} 筆峰資料。")
                                st.dataframe(
                                    fit_history_df.round(
                                        {
                                            "Ref_cm": 3,
                                            "Center_cm": 3,
                                            "Delta_cm": 3,
                                            "FWHM_cm": 3,
                                            "Area": 4,
                                            "Area_pct": 2,
                                            "R_squared": 5,
                                        }
                                    ),
                                    use_container_width=True,
                                    hide_index=True,
                                )

                                history_stats_df = (
                                    fit_history_df.groupby(
                                        ["Peak_Name", "Material", "Peak_Role", "Mode_Label"],
                                        dropna=False,
                                    )
                                    .agg(
                                        Runs=("Run_Label", "nunique"),
                                        Ref_cm=("Ref_cm", "mean"),
                                        Center_cm_mean=("Center_cm", "mean"),
                                        Center_cm_std=("Center_cm", "std"),
                                        FWHM_cm_mean=("FWHM_cm", "mean"),
                                        FWHM_cm_std=("FWHM_cm", "std"),
                                        Area_pct_mean=("Area_pct", "mean"),
                                        Area_pct_std=("Area_pct", "std"),
                                    )
                                    .reset_index()
                                )
                                st.caption("跨次擬合統計摘要")
                                st.dataframe(
                                    history_stats_df.round(
                                        {
                                            "Ref_cm": 3,
                                            "Center_cm_mean": 3,
                                            "Center_cm_std": 3,
                                            "FWHM_cm_mean": 3,
                                            "FWHM_cm_std": 3,
                                            "Area_pct_mean": 2,
                                            "Area_pct_std": 2,
                                        }
                                    ),
                                    use_container_width=True,
                                    hide_index=True,
                                )

                                history_dl_cols = st.columns(2)
                                history_dl_cols[0].download_button(
                                    "⬇️ 下載擬合歷史 CSV",
                                    data=fit_history_df.to_csv(index=False).encode("utf-8"),
                                    file_name="raman_fit_history.csv",
                                    mime="text/csv",
                                    key=f"raman_fit_history_dl_{fit_target}",
                                )
                                history_dl_cols[1].download_button(
                                    "⬇️ 下載擬合統計 CSV",
                                    data=history_stats_df.to_csv(index=False).encode("utf-8"),
                                    file_name="raman_fit_history_stats.csv",
                                    mime="text/csv",
                                    key=f"raman_fit_history_stats_dl_{fit_target}",
                                )

                        dl_cols = st.columns(2)
                        fit_curve_name = dl_cols[0].text_input(
                            "擬合曲線檔名", value=f"{fit_target}_raman_fit",
                            key="raman_fit_curve_fname",
                        )
                        dl_cols[0].download_button(
                            "⬇️ 下載擬合曲線 CSV",
                            data=fit_curve_df.to_csv(index=False).encode("utf-8"),
                            file_name=f"{(fit_curve_name or fit_target + '_raman_fit').strip()}.csv",
                            mime="text/csv",
                            key="raman_fit_curve_dl",
                        )
                        fit_peak_name = dl_cols[1].text_input(
                            "擬合峰表檔名", value=f"{fit_target}_raman_fit_peaks",
                            key="raman_fit_peak_fname",
                        )
                        dl_cols[1].download_button(
                            "⬇️ 下載擬合峰表 CSV",
                            data=fit_summary_df.to_csv(index=False).encode("utf-8"),
                            file_name=f"{(fit_peak_name or fit_target + '_raman_fit_peaks').strip()}.csv",
                            mime="text/csv",
                            key="raman_fit_peak_dl",
                        )
    else:
        auto_scroll_on_appear(
            "raman-fit-management",
            visible=False,
            state_key="raman_scroll_fit_management",
            block="start",
        )

    # ── Export ─────────────────────────────────────────────────────────────────
    if export_frames or not peak_export_df.empty or not fit_summary_export_df.empty or bool(fit_qc_summary):
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
                    "enabled": bool(do_average),
                    "interp_points": int(interp_points),
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
                "peak_detection": {
                    "skip": bool(skip_peaks),
                    "source_label": peak_signal_label,
                    "prominence_ratio": float(st.session_state.get("raman_peak_prominence", 0.02)),
                    "height_ratio": float(st.session_state.get("raman_peak_height", 0.0)),
                    "distance_cm": float(st.session_state.get("raman_peak_distance", raman_peak_distance_default)),
                    "max_peaks": int(st.session_state.get("raman_peak_max", 12)),
                    "local_prominence": bool(st.session_state.get("raman_local_prom", False)),
                    "local_window_cm": float(st.session_state.get("raman_local_window_cm", 80.0)),
                    "detect_range_enabled": bool(st.session_state.get("raman_detect_range_on", False)),
                    "detect_range_cm": [
                        float(st.session_state.get("raman_detect_x_start", _e0)),
                        float(st.session_state.get("raman_detect_x_end", _e1)),
                    ],
                    "detected_peaks": _dataframe_records(peak_export_df),
                },
                "fit": {
                    "skip": bool(skip_fit),
                    "target": st.session_state.get("raman_fit_result_target"),
                    "profile": st.session_state.get("raman_fit_profile"),
                    "summary": _dataframe_records(fit_summary_export_df),
                    "qc_summary": _json_safe(fit_qc_summary),
                    "history_run_count": int(
                        fit_history_df["Run_Label"].nunique()
                        if not fit_history_df.empty and "Run_Label" in fit_history_df.columns
                        else 0
                    ),
                },
            },
            "peak_candidates": _dataframe_records(
                _ensure_peak_df(st.session_state.get(_PEAK_CANDS_KEY, _empty_peak_df()))
            ),
            "preset_snapshot": _build_raman_preset_payload(),
        }

        report_cols = st.columns(2)
        report_name = report_cols[0].text_input(
            "處理報告檔名",
            value="raman_processing_report",
            key="raman_report_fname",
        )
        report_cols[0].download_button(
            "⬇️ 下載處理報告 JSON",
            data=json.dumps(_json_safe(processing_report), ensure_ascii=False, indent=2).encode("utf-8"),
            file_name=f"{(report_name or 'raman_processing_report').strip()}.json",
            mime="application/json",
            key="raman_report_dl",
        )

        if fit_qc_summary:
            qc_name = report_cols[1].text_input(
                "QC 摘要檔名",
                value="raman_fit_qc_summary",
                key="raman_qc_fname",
            )
            qc_df = pd.DataFrame([_json_safe(fit_qc_summary)])
            report_cols[1].download_button(
                "⬇️ 下載 QC 摘要 CSV",
                data=qc_df.to_csv(index=False).encode("utf-8"),
                file_name=f"{(qc_name or 'raman_fit_qc_summary').strip()}.csv",
                mime="text/csv",
                key="raman_qc_dl",
            )
        else:
            report_cols[1].caption("完成峰擬合後，這裡會提供 QC 摘要 CSV。")
