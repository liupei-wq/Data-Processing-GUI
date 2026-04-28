"""XAS/XANES TEY/TFY processing workflow."""

from __future__ import annotations

import io
import json
from datetime import datetime

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from scipy.optimize import curve_fit

from core.spectrum_ops import fit_fixed_gaussian_templates, interpolate_spectrum_to_grid
from core.ui_helpers import step_header


COLORS = ["#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
          "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52"]
CHANNELS = ["TEY", "TFY"]

_XAS_PRESET_VERSION = 2
_XAS_PRESET_KEYS = [
    "xas_flip_tfy",
    "xas_average_scans",
    "xas_interp_points",
    "xas_gaussian_enabled",
    "xas_gaussian_channels",
    "xas_gaussian_fwhm",
    "xas_gaussian_area",
    "xas_gaussian_search",
    "xas_gaussian_centers_value",
    "xas_bg_enabled",
    "xas_bg_range",
    "xas_bg_order",
    "xas_e0_mode",
    "xas_manual_e0",
    "xas_edge_search_range",
    "xas_norm_range",
    "xas_norm_order",
    "xas_white_range",
    "xas_fit_enabled",
    "xas_fit_channels",
    "xas_fit_range",
    "xas_fit_components",
]


def _range_from_energy(emin: float, emax: float, start: float, stop: float) -> tuple[float, float]:
    lo = float(emin + (emax - emin) * start)
    hi = float(emin + (emax - emin) * stop)
    if lo >= hi:
        hi = float(emax)
    return lo, hi


def _slider_range_value(key: str, default: tuple[float, float], emin: float, emax: float) -> tuple[float, float]:
    prev = st.session_state.get(key, default)
    try:
        lo, hi = float(min(prev)), float(max(prev))
    except Exception:
        lo, hi = default

    if hi < emin or lo > emax:
        lo, hi = default
    lo = max(float(emin), min(float(lo), float(emax)))
    hi = max(float(emin), min(float(hi), float(emax)))
    if hi <= lo:
        lo, hi = default
    return float(lo), float(hi)


def _is_numeric_line(line: str) -> bool:
    parts = line.strip().replace(",", " ").split()
    if not parts:
        return False
    try:
        for part in parts:
            float(part)
        return True
    except ValueError:
        return False


def _parse_xas_table_bytes(raw: bytes) -> tuple[pd.DataFrame | None, str | None]:
    """Parse text-like XAS files and return only numeric columns."""
    for enc in ("utf-8", "utf-8-sig", "big5", "cp950", "latin-1", "utf-16"):
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue

        lines = text.splitlines()
        numeric_lines: list[str] = []
        in_block = False
        for line in lines:
            if _is_numeric_line(line):
                in_block = True
                numeric_lines.append(line.strip())
            elif in_block:
                break

        if len(numeric_lines) >= 2:
            clean = "\n".join(numeric_lines)
            for sep in ("\t", ",", r"\s+"):
                try:
                    df = pd.read_csv(io.StringIO(clean), sep=sep, header=None, engine="python")
                    num = df.apply(pd.to_numeric, errors="coerce")
                    valid = [col for col in num.columns if num[col].notna().mean() > 0.8]
                    if len(valid) >= 3:
                        out = num[valid].dropna(how="any").copy()
                        out.columns = [f"col_{i + 1}" for i in range(out.shape[1])]
                        return out.reset_index(drop=True), None
                except Exception:
                    pass

        clean_lines = [
            line for line in lines
            if line.strip() and line.strip()[0] not in ("#", "%", ";", "!")
        ]
        if clean_lines:
            clean = "\n".join(clean_lines)
            for sep in (",", "\t", r"\s+"):
                for header in (0, None):
                    try:
                        df = pd.read_csv(io.StringIO(clean), sep=sep, header=header, engine="python")
                        num = df.apply(pd.to_numeric, errors="coerce")
                        valid = [col for col in num.columns if num[col].notna().mean() > 0.8]
                        if len(valid) >= 3:
                            out = num[valid].dropna(how="any").copy()
                            out.columns = [f"col_{i + 1}" for i in range(out.shape[1])]
                            return out.reset_index(drop=True), None
                    except Exception:
                        pass

    return None, "無法解析：請確認檔案至少包含 Energy、TEY、TFY 三欄數字"


def _safe_column(df: pd.DataFrame, one_based_index: int) -> np.ndarray:
    idx = int(one_based_index) - 1
    idx = max(0, min(idx, df.shape[1] - 1))
    return df.iloc[:, idx].to_numpy(dtype=float)


def _prepare_tey_tfy(
    df: pd.DataFrame,
    energy_col: int,
    tey_col: int,
    tfy_col: int,
    flip_tfy: bool,
) -> tuple[np.ndarray, dict[str, np.ndarray], str | None]:
    if df.shape[1] < 3:
        return np.array([]), {}, "TEY/TFY 模式至少需要 Energy、TEY、TFY 三欄"

    energy = _safe_column(df, energy_col)
    tey = _safe_column(df, tey_col)
    tfy = _safe_column(df, tfy_col)
    if flip_tfy:
        tfy = 1.0 - tfy

    mask = np.isfinite(energy) & np.isfinite(tey) & np.isfinite(tfy)
    if np.count_nonzero(mask) < 2:
        return energy, {}, "有效資料點不足"
    energy = energy[mask]
    tey = tey[mask]
    tfy = tfy[mask]
    order = np.argsort(energy)
    return energy[order], {"TEY": tey[order], "TFY": tfy[order]}, None


def _prepare_tey_tfy_auto(
    df: pd.DataFrame,
    flip_tfy: bool,
) -> tuple[np.ndarray, dict[str, np.ndarray], dict[str, object], str | None]:
    if df.shape[1] < 3:
        return np.array([]), {}, {}, "TEY/TFY ç’…âˆª??å–³??Â€é–¬?Energy?î»ŒEY?î»ŒFY éŠï¤?"

    energy = _safe_column(df, 1)
    mapping: dict[str, object] = {
        "energy_col": 1,
        "mode": "direct_columns",
        "flip_tfy": bool(flip_tfy),
    }

    if df.shape[1] >= 6:
        # Beamline DAT layout: Energy, Phase, Gap, CurMD-03(TFY), CurMD-01(TEY), CurMD-02(I0).
        tfy_idx = 3
        tey_idx = 4
        i0_idx = 5
        i0 = df.iloc[:, i0_idx].to_numpy(dtype=float)
        denom = np.where(np.abs(i0) > 1e-30, np.abs(i0), np.nan)
        tey_raw = df.iloc[:, tey_idx].to_numpy(dtype=float)
        tfy_raw = df.iloc[:, tfy_idx].to_numpy(dtype=float)
        tey = tey_raw / denom
        tfy = tfy_raw / denom
        mapping.update({
            "mode": "beamline_dat_curmd01_tey_curmd02_i0_curmd03_tfy",
            "i0_col": i0_idx + 1,
            "tey_col": tey_idx + 1,
            "tfy_col": tfy_idx + 1,
        })
    else:
        tey = _safe_column(df, 2)
        tfy = _safe_column(df, 3)
        mapping.update({
            "tey_col": 2,
            "tfy_col": 3,
        })

    if flip_tfy:
        tfy = 1.0 - tfy

    mask = np.isfinite(energy) & np.isfinite(tey) & np.isfinite(tfy)
    if np.count_nonzero(mask) < 2:
        return energy, {}, mapping, "?ï¤?éžˆï‹ª?æšºîµ£?é ž?"

    energy = energy[mask]
    tey = tey[mask]
    tfy = tfy[mask]
    order = np.argsort(energy)
    return energy[order], {"TEY": tey[order], "TFY": tfy[order]}, mapping, None


def _derivative_edge_energy(energy: np.ndarray, signal: np.ndarray, window: tuple[float, float]) -> float | None:
    lo, hi = sorted(window)
    mask = (energy >= lo) & (energy <= hi)
    if np.count_nonzero(mask) < 5:
        return None
    e = energy[mask]
    y = signal[mask]
    deriv = np.gradient(y, e)
    if not np.any(np.isfinite(deriv)):
        return None
    return float(e[int(np.nanargmax(deriv))])


def _subtract_background(
    energy: np.ndarray,
    signal: np.ndarray,
    bg_range: tuple[float, float],
    order: int,
) -> tuple[np.ndarray, np.ndarray, str | None]:
    lo, hi = sorted(bg_range)
    mask = (energy >= lo) & (energy <= hi)
    if np.count_nonzero(mask) <= int(order):
        return signal.copy(), np.zeros_like(signal), "背景擬合點不足"
    coeffs = np.polyfit(energy[mask], signal[mask], int(order))
    bg = np.polyval(coeffs, energy)
    return signal - bg, bg, None


def _normalize_by_post_edge(
    energy: np.ndarray,
    signal_bg_subtracted: np.ndarray,
    e0: float,
    norm_range: tuple[float, float],
    order: int,
) -> tuple[np.ndarray, np.ndarray, float, str | None]:
    lo, hi = sorted(norm_range)
    mask = (energy >= lo) & (energy <= hi)
    if np.count_nonzero(mask) <= int(order):
        return signal_bg_subtracted.copy(), np.zeros_like(signal_bg_subtracted), np.nan, "歸一化擬合點不足"
    coeffs = np.polyfit(energy[mask], signal_bg_subtracted[mask], int(order))
    post = np.polyval(coeffs, energy)
    edge_step = float(np.polyval(coeffs, e0))
    if not np.isfinite(edge_step) or abs(edge_step) < 1e-12:
        return signal_bg_subtracted.copy(), post, edge_step, "edge step 過小，無法歸一化"
    return signal_bg_subtracted / edge_step, post, edge_step, None


def _empty_gaussian_center_df(default_center: float) -> pd.DataFrame:
    return pd.DataFrame([{
        "啟用": True,
        "峰名稱": "Gaussian 1",
        "中心_eV": float(default_center),
    }])


def _normalize_gaussian_center_df(df: pd.DataFrame | None, default_center: float) -> pd.DataFrame:
    if df is None:
        return _empty_gaussian_center_df(default_center)
    result = df.copy()
    if "啟用" not in result.columns:
        result["啟用"] = True
    if "峰名稱" not in result.columns:
        result["峰名稱"] = ""
    if "中心_eV" not in result.columns:
        result["中心_eV"] = default_center
    result = result[["啟用", "峰名稱", "中心_eV"]].copy()
    result["啟用"] = result["啟用"].fillna(False).astype(bool)
    result["峰名稱"] = result["峰名稱"].fillna("").astype(str)
    result["中心_eV"] = pd.to_numeric(result["中心_eV"], errors="coerce")
    return result.reset_index(drop=True)


def _gaussian_center_records(df: pd.DataFrame) -> list[dict]:
    return [
        {
            "enabled": bool(row.get("啟用", True)),
            "name": str(row.get("峰名稱", "")).strip(),
            "center": row.get("中心_eV"),
        }
        for _, row in df.iterrows()
    ]


def _multi_gaussian(x: np.ndarray, *params: float) -> np.ndarray:
    y = np.zeros_like(x, dtype=float)
    baseline = params[-1]
    for i in range(0, len(params) - 1, 3):
        amp, center, sigma = params[i:i + 3]
        y += amp * np.exp(-0.5 * ((x - center) / max(abs(sigma), 1e-12)) ** 2)
    return y + baseline


def _fit_xanes_gaussians(
    energy: np.ndarray,
    signal: np.ndarray,
    fit_range: tuple[float, float],
    components: int,
) -> tuple[np.ndarray, pd.DataFrame, str | None]:
    lo, hi = sorted(fit_range)
    mask = (energy >= lo) & (energy <= hi)
    if np.count_nonzero(mask) < max(8, components * 4):
        return np.full_like(signal, np.nan), pd.DataFrame(), "擬合區間資料點不足"

    x = energy[mask]
    y = signal[mask]
    width = max(float(hi - lo), 1e-6)
    centers = np.linspace(lo + width * 0.25, hi - width * 0.25, components)
    amp0 = max(float(np.nanmax(y) - np.nanmin(y)), 1e-6)
    sigma0 = max(width / (components * 6.0), 1e-6)
    p0: list[float] = []
    lower: list[float] = []
    upper: list[float] = []
    for center in centers:
        p0.extend([amp0 / components, float(center), sigma0])
        lower.extend([-np.inf, lo, 1e-9])
        upper.extend([np.inf, hi, width])
    p0.append(float(np.nanmin(y)))
    lower.append(-np.inf)
    upper.append(np.inf)

    try:
        popt, _ = curve_fit(
            _multi_gaussian,
            x,
            y,
            p0=p0,
            bounds=(lower, upper),
            maxfev=20000,
        )
    except Exception as exc:
        return np.full_like(signal, np.nan), pd.DataFrame(), f"擬合失敗：{exc}"

    fit_full = _multi_gaussian(energy, *popt)
    rows = []
    for idx in range(components):
        amp, center, sigma = popt[idx * 3:idx * 3 + 3]
        fwhm = 2.0 * np.sqrt(2.0 * np.log(2.0)) * abs(float(sigma))
        area = float(amp) * abs(float(sigma)) * np.sqrt(2.0 * np.pi)
        rows.append({
            "Component": idx + 1,
            "Amplitude": float(amp),
            "Center_eV": float(center),
            "FWHM_eV": fwhm,
            "Area": area,
        })
    return fit_full, pd.DataFrame(rows), None


def _build_export_filename(stem: str, extension: str) -> str:
    clean = (stem or "xas_export").strip()
    if not clean.lower().endswith(f".{extension.lower()}"):
        clean = f"{clean}.{extension}"
    return clean


def _download_card(
    title: str,
    description: str,
    default_name: str,
    extension: str,
    data: bytes,
    mime: str,
    key_prefix: str,
) -> None:
    with st.container(border=True):
        st.markdown(f"**{title}**")
        st.caption(description)
        name = st.text_input("檔名", value=default_name, key=f"{key_prefix}_name")
        st.download_button(
            "下載",
            data=data,
            file_name=_build_export_filename(name, extension),
            mime=mime,
            key=f"{key_prefix}_download",
            use_container_width=True,
        )


def _build_xas_preset_payload() -> dict:
    return {
        "preset_type": "xas_processing_preset",
        "version": _XAS_PRESET_VERSION,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "settings": {
            key: st.session_state.get(key)
            for key in _XAS_PRESET_KEYS
            if key in st.session_state
        },
    }


def _apply_xas_preset_payload(payload: dict) -> None:
    settings = payload.get("settings", {})
    if not isinstance(settings, dict):
        raise ValueError("Preset settings 格式不正確")
    for key in _XAS_PRESET_KEYS:
        if key in settings:
            st.session_state[key] = settings[key]


def _channel_figure(title: str, ytitle: str) -> go.Figure:
    fig = go.Figure()
    fig.update_layout(
        title=title,
        xaxis_title="Energy (eV)",
        yaxis_title=ytitle,
        template="plotly_dark",
        height=430,
        margin=dict(l=50, r=20, t=50, b=50),
    )
    return fig


def run_xas_ui() -> None:
    with st.sidebar:
        with st.expander("XAS Preset", expanded=False):
            st.caption(
                "Preset 會保存 XAS / XANES 的欄位、TFY 翻轉、扣高斯、背景扣除、"
                "歸一化、white line 與初步擬合設定，方便同一批 TEY/TFY 檔案重複套用。"
            )
            preset_payload = _build_xas_preset_payload()
            preset_name = st.text_input(
                "Preset 檔名",
                value=st.session_state.get("xas_preset_name", "xas_preset"),
                key="xas_preset_name",
            )
            st.download_button(
                "匯出 XAS preset JSON",
                data=json.dumps(preset_payload, ensure_ascii=False, indent=2).encode("utf-8"),
                file_name=_build_export_filename(preset_name or "xas_preset", "json"),
                mime="application/json",
                key="xas_preset_export_btn",
                use_container_width=True,
            )
            preset_upload = st.file_uploader(
                "匯入 XAS preset JSON",
                type=["json"],
                key="xas_preset_uploader",
            )
            if preset_upload is not None:
                try:
                    loaded = json.loads(preset_upload.read().decode("utf-8"))
                    if loaded.get("preset_type") == "xas_processing_preset":
                        _apply_xas_preset_payload(loaded)
                        st.success("Preset 已套用，頁面重新整理後生效。")
                        st.rerun()
                    else:
                        st.warning("此 JSON 不是 XAS preset 格式。")
                except Exception as exc:
                    st.error(f"Preset 讀取失敗：{exc}")

        step_header(1, "載入 TEY / TFY 資料")
        uploaded_files = st.file_uploader(
            "上傳 XAS .DAT / .txt / .csv 檔案（可多選）",
            type=["dat", "txt", "csv", "xmu", "nor"],
            accept_multiple_files=True,
            key="xas_uploader",
        )
        st.caption("自動解析欄位：第 1 欄當 Energy；6 欄 DAT 會用 CurMD-01=TEY、CurMD-02=I0、CurMD-03=TFY，並自動完成 TEY/I0 與 TFY/I0。")
        flip_tfy = st.checkbox("TFY 使用 1 - TFY 翻轉", value=True, key="xas_flip_tfy")
        average_scans = st.checkbox("多檔同通道內插平均", value=False, key="xas_average_scans")
        interp_points = int(st.number_input(
            "內插點數",
            min_value=200,
            max_value=30000,
            value=2000,
            step=100,
            key="xas_interp_points",
        ))

        step_header(2, "扣除高斯曲線（可選）")
        gaussian_enabled = st.checkbox("啟用高斯模板扣除", value=False, key="xas_gaussian_enabled")
        gaussian_channels = st.multiselect(
            "套用通道",
            CHANNELS,
            default=CHANNELS,
            key="xas_gaussian_channels",
            disabled=not gaussian_enabled,
        )
        gaussian_fwhm = float(st.number_input(
            "固定 FWHM (eV)",
            min_value=0.000001,
            value=2.0,
            step=0.1,
            format="%.6f",
            disabled=not gaussian_enabled,
            key="xas_gaussian_fwhm",
        ))
        gaussian_area = float(st.number_input(
            "固定面積",
            min_value=0.0,
            value=1.0,
            step=0.1,
            format="%.6f",
            disabled=not gaussian_enabled,
            key="xas_gaussian_area",
        ))
        gaussian_search = float(st.number_input(
            "中心搜尋半寬 (eV)",
            min_value=0.0,
            value=2.0,
            step=0.1,
            format="%.6f",
            disabled=not gaussian_enabled,
            key="xas_gaussian_search",
        ))

        step_header(3, "背景扣除")
        bg_enabled = st.checkbox("啟用 pre-edge 背景扣除", value=True, key="xas_bg_enabled")
        bg_range = st.slider(
            "背景擬合範圍 (eV)",
            min_value=0.0,
            max_value=30000.0,
            value=(520.0, 530.0),
            step=0.5,
            key="xas_bg_range",
            disabled=not bg_enabled,
        )
        bg_order = int(st.number_input(
            "背景多項式階數",
            min_value=0,
            max_value=3,
            value=1,
            key="xas_bg_order",
            disabled=not bg_enabled,
        ))

        step_header(4, "歸一化")
        e0_mode = st.radio(
            "E0 設定",
            ["derivative", "manual"],
            format_func=lambda v: {"derivative": "用一階導數最大值", "manual": "手動指定"}[v],
            key="xas_e0_mode",
        )
        manual_e0 = float(st.number_input(
            "手動 E0 (eV)",
            value=535.0,
            step=0.1,
            format="%.3f",
            disabled=e0_mode != "manual",
            key="xas_manual_e0",
        ))
        edge_search = st.slider(
            "E0 搜尋範圍 (eV)",
            min_value=0.0,
            max_value=30000.0,
            value=(530.0, 545.0),
            step=0.5,
            key="xas_edge_search_range",
        )
        norm_range = st.slider(
            "Post-edge 歸一化範圍 (eV)",
            min_value=0.0,
            max_value=30000.0,
            value=(560.0, 590.0),
            step=0.5,
            key="xas_norm_range",
        )
        norm_order = int(st.number_input("Post-edge 多項式階數", min_value=0, max_value=3, value=1, key="xas_norm_order"))

        step_header(5, "摘要與擬合")
        white_range = st.slider(
            "White line 搜尋範圍 (eV)",
            min_value=0.0,
            max_value=30000.0,
            value=(532.0, 555.0),
            step=0.5,
            key="xas_white_range",
        )
        fit_enabled = st.checkbox("啟用初步 Gaussian 擬合", value=False, key="xas_fit_enabled")
        fit_channels = st.multiselect(
            "擬合通道",
            CHANNELS,
            default=CHANNELS,
            disabled=not fit_enabled,
            key="xas_fit_channels",
        )
        fit_range = st.slider(
            "擬合範圍 (eV)",
            min_value=0.0,
            max_value=30000.0,
            value=(532.0, 555.0),
            step=0.5,
            disabled=not fit_enabled,
            key="xas_fit_range",
        )
        fit_components = int(st.number_input(
            "Gaussian component 數",
            min_value=1,
            max_value=5,
            value=1,
            disabled=not fit_enabled,
            key="xas_fit_components",
        ))

    if not uploaded_files:
        st.info("請在左側上傳包含 Energy、TEY、TFY 的 XAS .DAT 檔案。TFY 會依設定自動做 1 - TFY 翻轉。")
        return

    raw_scans: dict[str, dict[str, tuple[np.ndarray, np.ndarray]]] = {}
    detected_mappings: dict[str, dict[str, object]] = {}
    for uf in uploaded_files:
        df, err = _parse_xas_table_bytes(uf.read())
        if err or df is None:
            st.warning(f"{uf.name}：{err}")
            continue
        energy, channels, mapping, prep_err = _prepare_tey_tfy_auto(df, flip_tfy)
        if prep_err:
            st.warning(f"{uf.name}：{prep_err}")
            continue
        raw_scans[uf.name] = {ch: (energy, channels[ch]) for ch in CHANNELS}
        detected_mappings[uf.name] = mapping

    if not raw_scans:
        st.error("沒有成功載入的 XAS TEY/TFY 資料。")
        return

    with st.expander("自動欄位解析", expanded=False):
        st.dataframe(
            pd.DataFrame([
                {"file": name, **mapping}
                for name, mapping in detected_mappings.items()
            ]),
            use_container_width=True,
            hide_index=True,
        )

    overlap_min = max(float(np.min(scan["TEY"][0])) for scan in raw_scans.values())
    overlap_max = min(float(np.max(scan["TEY"][0])) for scan in raw_scans.values())
    if overlap_min >= overlap_max:
        overlap_min = min(float(np.min(scan["TEY"][0])) for scan in raw_scans.values())
        overlap_max = max(float(np.max(scan["TEY"][0])) for scan in raw_scans.values())

    scans = raw_scans.copy()
    if average_scans and len(raw_scans) > 1:
        grid = np.linspace(overlap_min, overlap_max, interp_points)
        avg_scan: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        for ch in CHANNELS:
            arrays = [
                interpolate_spectrum_to_grid(energy, signal, grid)
                for scan in raw_scans.values()
                for energy, signal in [scan[ch]]
            ]
            avg_scan[ch] = (grid, np.nanmean(np.vstack(arrays), axis=0))
        scans = {"Average": avg_scan}

    default_center = float((overlap_min + overlap_max) / 2.0)
    with st.sidebar:
        if gaussian_enabled:
            center_seed = st.session_state.get("xas_gaussian_centers_value")
            center_df = _normalize_gaussian_center_df(pd.DataFrame(center_seed) if center_seed else None, default_center)
            center_df = st.data_editor(
                center_df,
                num_rows="dynamic",
                use_container_width=True,
                key="xas_gaussian_center_editor",
                column_config={
                    "中心_eV": st.column_config.NumberColumn("中心 (eV)", step=0.1, format="%.3f"),
                },
            )
            center_df = _normalize_gaussian_center_df(center_df, default_center)
            st.session_state["xas_gaussian_centers_value"] = center_df.to_dict(orient="records")
        else:
            center_df = _empty_gaussian_center_df(default_center)

    processed: dict[str, dict[str, pd.DataFrame]] = {}
    summary_rows: list[dict] = []
    gaussian_rows: list[pd.DataFrame] = []
    fit_rows: list[pd.DataFrame] = []

    for scan_idx, (scan_name, channel_map) in enumerate(scans.items()):
        processed[scan_name] = {}
        for ch in CHANNELS:
            energy, raw_signal = channel_map[ch]
            work_energy = energy
            raw_interp = raw_signal
            gaussian_model = np.zeros_like(raw_signal, dtype=float)
            signal_after_gaussian = raw_signal.copy()

            if gaussian_enabled and ch in gaussian_channels:
                work_energy = np.linspace(float(np.min(energy)), float(np.max(energy)), interp_points)
                raw_interp = interpolate_spectrum_to_grid(energy, raw_signal, work_energy)
                gaussian_model, signal_after_gaussian, rows = fit_fixed_gaussian_templates(
                    work_energy,
                    raw_interp,
                    _gaussian_center_records(center_df),
                    gaussian_fwhm,
                    gaussian_area,
                    gaussian_search,
                )
                if rows:
                    gdf = pd.DataFrame(rows)
                    gdf.insert(0, "Channel", ch)
                    gdf.insert(0, "Dataset", scan_name)
                    gaussian_rows.append(gdf)

            if bg_enabled:
                signal_bg_sub, bg_curve, bg_err = _subtract_background(
                    work_energy, signal_after_gaussian, bg_range, bg_order,
                )
                if bg_err:
                    st.warning(f"{scan_name} / {ch}：{bg_err}")
            else:
                signal_bg_sub = signal_after_gaussian.copy()
                bg_curve = np.zeros_like(signal_after_gaussian)

            e0 = manual_e0 if e0_mode == "manual" else _derivative_edge_energy(
                work_energy, signal_bg_sub, edge_search,
            )
            if e0 is None:
                e0 = float(np.median(work_energy))

            signal_norm, norm_curve, edge_step, norm_err = _normalize_by_post_edge(
                work_energy, signal_bg_sub, float(e0), norm_range, norm_order,
            )
            if norm_err:
                st.warning(f"{scan_name} / {ch}：{norm_err}")

            wlo, whi = sorted(white_range)
            wmask = (work_energy >= wlo) & (work_energy <= whi)
            if np.count_nonzero(wmask) > 0 and np.any(np.isfinite(signal_norm[wmask])):
                local = np.where(wmask)[0]
                best_idx = int(local[np.nanargmax(signal_norm[wmask])])
                white_e = float(work_energy[best_idx])
                white_i = float(signal_norm[best_idx])
            else:
                white_e = np.nan
                white_i = np.nan

            fit_curve = np.full_like(work_energy, np.nan, dtype=float)
            if fit_enabled and ch in fit_channels:
                fit_curve, fit_df, fit_err = _fit_xanes_gaussians(
                    work_energy, signal_norm, fit_range, fit_components,
                )
                if fit_err:
                    st.warning(f"{scan_name} / {ch}：{fit_err}")
                elif not fit_df.empty:
                    fit_df.insert(0, "Channel", ch)
                    fit_df.insert(0, "Dataset", scan_name)
                    fit_rows.append(fit_df)

            processed[scan_name][ch] = pd.DataFrame({
                "Energy_eV": work_energy,
                f"{ch}_raw": raw_interp,
                f"{ch}_gaussian_model": gaussian_model,
                f"{ch}_after_gaussian": signal_after_gaussian,
                f"{ch}_background": bg_curve,
                f"{ch}_bg_subtracted": signal_bg_sub,
                f"{ch}_post_edge_curve": norm_curve,
                f"{ch}_normalized": signal_norm,
                f"{ch}_fit_curve": fit_curve,
            })
            summary_rows.append({
                "Dataset": scan_name,
                "Channel": ch,
                "E0_eV": round(float(e0), 4),
                "Edge_Step": round(float(edge_step), 6) if np.isfinite(edge_step) else np.nan,
                "White_Line_Energy_eV": round(white_e, 4) if np.isfinite(white_e) else np.nan,
                "White_Line_Intensity_norm": round(white_i, 6) if np.isfinite(white_i) else np.nan,
                "Gaussian_Subtraction": bool(gaussian_enabled and ch in gaussian_channels),
            })

    st.subheader("原始 TEY / TFY")
    raw_cols = st.columns(2)
    for col, ch in zip(raw_cols, CHANNELS):
        with col:
            fig = _channel_figure(f"{ch} 原始資料", ch)
            for idx, (scan_name, channel_map) in enumerate(raw_scans.items()):
                energy, signal = channel_map[ch]
                fig.add_trace(go.Scatter(
                    x=energy,
                    y=signal,
                    mode="lines",
                    name=scan_name,
                    line=dict(color=COLORS[idx % len(COLORS)]),
                ))
            st.plotly_chart(fig, use_container_width=True)

    st.subheader("處理後 TEY / TFY")
    proc_cols = st.columns(2)
    for col, ch in zip(proc_cols, CHANNELS):
        with col:
            fig = _channel_figure(f"{ch} 歸一化後", f"{ch} normalized")
            for idx, (scan_name, channel_map) in enumerate(processed.items()):
                df = channel_map[ch]
                fig.add_trace(go.Scatter(
                    x=df["Energy_eV"],
                    y=df[f"{ch}_normalized"],
                    mode="lines",
                    name=scan_name,
                    line=dict(color=COLORS[idx % len(COLORS)]),
                ))
                if fit_enabled and ch in fit_channels and df[f"{ch}_fit_curve"].notna().any():
                    fig.add_trace(go.Scatter(
                        x=df["Energy_eV"],
                        y=df[f"{ch}_fit_curve"],
                        mode="lines",
                        name=f"{scan_name} fit",
                        line=dict(color=COLORS[idx % len(COLORS)], dash="dot"),
                    ))
            st.plotly_chart(fig, use_container_width=True)

    if processed:
        with st.expander("處理前後比較", expanded=False):
            dataset_options = list(processed.keys())
            compare_dataset = st.selectbox("資料集", dataset_options, key="xas_compare_dataset")
            compare_channel = st.radio("通道", CHANNELS, horizontal=True, key="xas_compare_channel")
            cdf = processed[compare_dataset][compare_channel]
            options = [
                f"{compare_channel}_raw",
                f"{compare_channel}_after_gaussian",
                f"{compare_channel}_background",
                f"{compare_channel}_bg_subtracted",
                f"{compare_channel}_post_edge_curve",
                f"{compare_channel}_normalized",
            ]
            if fit_enabled:
                options.append(f"{compare_channel}_fit_curve")
            default = [
                f"{compare_channel}_raw",
                f"{compare_channel}_bg_subtracted",
                f"{compare_channel}_normalized",
            ]
            compare_cols = st.multiselect(
                "比較欄位",
                options,
                default=[col for col in default if col in options],
                key="xas_compare_columns",
            )
            fig_compare = _channel_figure(f"{compare_dataset} / {compare_channel} 處理前後比較", "Intensity")
            for col_name in compare_cols:
                fig_compare.add_trace(go.Scatter(
                    x=cdf["Energy_eV"],
                    y=cdf[col_name],
                    mode="lines",
                    name=col_name.replace(f"{compare_channel}_", ""),
                ))
            st.plotly_chart(fig_compare, use_container_width=True)

    summary_df = pd.DataFrame(summary_rows)
    st.subheader("XANES 摘要")
    st.dataframe(summary_df, use_container_width=True, hide_index=True)

    gaussian_df = pd.concat(gaussian_rows, ignore_index=True) if gaussian_rows else pd.DataFrame()
    if gaussian_enabled and not gaussian_df.empty:
        st.subheader("高斯扣除中心結果")
        st.dataframe(gaussian_df.round(6), use_container_width=True, hide_index=True)

    fit_df_all = pd.concat(fit_rows, ignore_index=True) if fit_rows else pd.DataFrame()
    if fit_enabled and not fit_df_all.empty:
        st.subheader("初步 Gaussian 擬合結果")
        st.dataframe(fit_df_all.round(6), use_container_width=True, hide_index=True)

    st.divider()
    st.subheader("匯出")
    c1, c2 = st.columns(2)
    with c1:
        _download_card(
            "XANES 摘要 CSV",
            "包含每個資料集與 TEY/TFY 通道的 E0、edge step、white line 位置與強度。",
            "xas_xanes_summary",
            "csv",
            summary_df.to_csv(index=False).encode("utf-8"),
            "text/csv",
            "xas_summary",
        )
    with c2:
        report = {
            "report_type": "xas_processing_report",
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "columns": {
                "auto_mapping": detected_mappings,
                "flip_tfy": flip_tfy,
            },
            "average_scans": average_scans,
            "gaussian_subtraction": {
                "enabled": gaussian_enabled,
                "channels": gaussian_channels,
                "fixed_fwhm_eV": gaussian_fwhm,
                "fixed_area": gaussian_area,
                "search_half_width_eV": gaussian_search,
                "centers": center_df.to_dict(orient="records"),
            },
            "background": {
                "enabled": bg_enabled,
                "range_eV": list(bg_range),
                "order": bg_order,
            },
            "normalization": {
                "e0_mode": e0_mode,
                "manual_e0_eV": manual_e0 if e0_mode == "manual" else None,
                "edge_search_range_eV": list(edge_search),
                "post_edge_range_eV": list(norm_range),
                "post_edge_order": norm_order,
                "white_line_range_eV": list(white_range),
            },
            "fit": {
                "enabled": fit_enabled,
                "channels": fit_channels,
                "range_eV": list(fit_range),
                "components": fit_components,
            },
            "summary": summary_df.to_dict(orient="records"),
        }
        _download_card(
            "Processing Report JSON",
            "保存本次 XAS TEY/TFY 的欄位、扣高斯、背景扣除、歸一化與擬合設定。",
            "xas_processing_report",
            "json",
            json.dumps(report, ensure_ascii=False, indent=2).encode("utf-8"),
            "application/json",
            "xas_report",
        )

    for scan_name, channel_map in processed.items():
        merged = None
        for ch in CHANNELS:
            df = channel_map[ch]
            if merged is None:
                merged = df.copy()
            else:
                merged = pd.merge(merged, df, on="Energy_eV", how="outer")
        if merged is not None:
            base = scan_name.rsplit(".", 1)[0]
            _download_card(
                f"處理後 TEY/TFY：{scan_name}",
                "包含 TEY 與 TFY 的 raw、扣高斯後、背景、背景扣除後、post-edge curve、normalized 與 fit curve 欄位。",
                f"{base}_xas_tey_tfy_processed",
                "csv",
                merged.to_csv(index=False).encode("utf-8"),
                "text/csv",
                f"xas_processed_{base}",
            )

    if gaussian_enabled and not gaussian_df.empty:
        _download_card(
            "高斯中心結果 CSV",
            "記錄固定 FWHM / 固定面積高斯模板在 TEY/TFY 上搜尋到的中心位置。",
            "xas_gaussian_centers",
            "csv",
            gaussian_df.to_csv(index=False).encode("utf-8"),
            "text/csv",
            "xas_gaussian_centers",
        )

    if fit_enabled and not fit_df_all.empty:
        _download_card(
            "初步擬合結果 CSV",
            "記錄 TEY/TFY normalized XANES 的 Gaussian component 中心、FWHM 與面積。",
            "xas_gaussian_fit_results",
            "csv",
            fit_df_all.to_csv(index=False).encode("utf-8"),
            "text/csv",
            "xas_fit_results",
        )
