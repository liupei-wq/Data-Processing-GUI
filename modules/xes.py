"""XES-specific helpers, image processing, and Streamlit UI."""

from __future__ import annotations

import io
import json
import math
import re
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from scipy.interpolate import interp1d
from scipy.ndimage import median_filter
from scipy.signal import find_peaks, peak_widths

from core.parsers import parse_two_column_spectrum_bytes
from core.spectrum_ops import detect_spectrum_peaks, interpolate_spectrum_to_grid, mean_spectrum_arrays
from core.ui_helpers import _next_btn, hex_to_rgba, step_header, step_header_with_skip
from core.processing import apply_normalization, apply_processing, despike_signal, smooth_signal
from core.read_fits_image import read_primary_image_bytes
from db.xes_database import XES_REFERENCES, xes_reference_records


def build_xes_peak_table(
    dataset: str,
    pixel_x: np.ndarray,
    y: np.ndarray,
    peak_idx: np.ndarray,
    energy_x: np.ndarray | None = None,
) -> pd.DataFrame:
    if len(peak_idx) == 0:
        columns = [
            "Dataset", "Peak", "Pixel", "Intensity",
            "Relative_Intensity_pct", "FWHM_pixel",
        ]
        if energy_x is not None:
            columns.extend(["Energy_eV", "FWHM_eV"])
        return pd.DataFrame(columns=columns)

    widths, _, left_ips, right_ips = peak_widths(y, peak_idx, rel_height=0.5)
    sample_axis = np.arange(len(pixel_x), dtype=float)
    left_pixel = np.interp(left_ips, sample_axis, pixel_x)
    right_pixel = np.interp(right_ips, sample_axis, pixel_x)

    peak_x = pixel_x[peak_idx]
    peak_y = y[peak_idx]
    curve_max = float(np.max(y)) if len(y) else 0.0
    rel_intensity = (peak_y / curve_max * 100.0) if curve_max > 0 else np.zeros_like(peak_y)

    rows = {
        "Dataset": dataset,
        "Peak": np.arange(1, len(peak_idx) + 1),
        "Pixel": peak_x,
        "Intensity": peak_y,
        "Relative_Intensity_pct": rel_intensity,
        "FWHM_pixel": np.abs(right_pixel - left_pixel),
    }
    if energy_x is not None:
        left_energy = np.interp(left_ips, sample_axis, energy_x)
        right_energy = np.interp(right_ips, sample_axis, energy_x)
        rows["Energy_eV"] = energy_x[peak_idx]
        rows["FWHM_eV"] = np.abs(right_energy - left_energy)

    return pd.DataFrame(rows)


def build_xes_reference_df(materials: list[str] | None = None) -> pd.DataFrame:
    return pd.DataFrame(xes_reference_records(materials))


def match_xes_reference_peaks(
    observed_df: pd.DataFrame,
    reference_df: pd.DataFrame,
    tolerance_eV: float,
    tolerance_pixel: float,
    use_energy_axis: bool,
) -> pd.DataFrame:
    if observed_df.empty or reference_df.empty:
        return pd.DataFrame()

    observed_col = "Energy_eV" if use_energy_axis and "Energy_eV" in observed_df.columns else "Pixel"
    ref_col = "Reference_Energy_eV" if observed_col == "Energy_eV" else "Reference_Pixel"
    tol_col = "Tolerance_eV" if observed_col == "Energy_eV" else "Tolerance_Pixel"
    default_tol = float(tolerance_eV if observed_col == "Energy_eV" else tolerance_pixel)

    if ref_col not in reference_df.columns:
        return pd.DataFrame()

    rows: list[dict] = []
    for _, obs in observed_df.iterrows():
        obs_pos = pd.to_numeric(pd.Series([obs.get(observed_col)]), errors="coerce").iloc[0]
        if not np.isfinite(obs_pos):
            continue
        candidates = reference_df.dropna(subset=[ref_col]).copy()
        if candidates.empty:
            rows.append({
                "Dataset": obs.get("Dataset", ""),
                "Observed_Peak": obs.get("Peak", ""),
                "Observed_Axis": observed_col,
                "Observed_Position": obs_pos,
                "Assignment": "未匹配",
                "Material": "",
                "Reference_Label": "",
                "Reference_Position": np.nan,
                "Delta": np.nan,
                "Tolerance": default_tol,
                "Meaning": "目前沒有可用的 pixel 參考，請先做 X 軸 eV 校正或建立實驗 pixel 參考。",
                "Matched": False,
            })
            continue
        candidates["Delta"] = candidates[ref_col].astype(float) - float(obs_pos)
        candidates["Abs_Delta"] = candidates["Delta"].abs()
        candidates["Effective_Tolerance"] = pd.to_numeric(
            candidates.get(tol_col, default_tol), errors="coerce"
        ).fillna(default_tol).clip(lower=1e-12)
        candidates = candidates.sort_values("Abs_Delta")
        best = candidates.iloc[0]
        matched = bool(best["Abs_Delta"] <= best["Effective_Tolerance"])
        rows.append({
            "Dataset": obs.get("Dataset", ""),
            "Observed_Peak": obs.get("Peak", ""),
            "Observed_Axis": observed_col,
            "Observed_Position": float(obs_pos),
            "Observed_Intensity": obs.get("Intensity", np.nan),
            "Assignment": best.get("Reference_Label", "") if matched else "未匹配",
            "Material": best.get("Material", "") if matched else "",
            "Reference_Label": best.get("Reference_Label", ""),
            "Reference_Position": float(best.get(ref_col)),
            "Delta": float(best["Delta"]),
            "Tolerance": float(best["Effective_Tolerance"]),
            "Meaning": best.get("Meaning", "") if matched else "超出容差；可能是雜訊、背景、未校正峰，或資料庫尚未收錄。",
            "Matched": matched,
        })
    return pd.DataFrame(rows)


def natural_sort_key(text: str) -> list[object]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text)]


def _xes_header_time_value(image) -> tuple[float | None, str]:
    header = image.header
    for key in ("MJD-OBS", "JD", "EXPSTART", "EXPEND"):
        value = header.get(key)
        if value is None:
            continue
        try:
            return float(value), key
        except (TypeError, ValueError):
            pass

    date_value = header.get("DATE-OBS") or header.get("DATE")
    time_value = header.get("TIME-OBS") or header.get("UT")
    if date_value:
        raw = str(date_value).strip()
        if time_value and "T" not in raw and " " not in raw:
            raw = f"{raw}T{str(time_value).strip()}"
        raw = raw.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp(), "DATE-OBS"
        except ValueError:
            pass

    return None, ""


def _xes_exposure_seconds(image) -> float | None:
    for key in ("EXPTIME", "EXPOSURE", "ITIME", "ONTIME"):
        value = image.header.get(key)
        if value is None:
            continue
        try:
            exposure = float(value)
        except (TypeError, ValueError):
            continue
        if exposure > 0:
            return exposure
    return None


def _xes_image_array(image, plane: int, normalize_exposure: bool,
                     transpose_image: bool = False) -> np.ndarray:
    arr = image.as_array(plane).astype(float)
    if transpose_image:
        arr = arr.T
    if normalize_exposure:
        exposure = _xes_exposure_seconds(image)
        if exposure and exposure > 0:
            arr = arr / exposure
    return arr


def _xes_average_frame(
    image_dict: dict[str, object],
    plane: int,
    normalize_exposure: bool,
    transpose_image: bool = False,
) -> tuple[np.ndarray | None, pd.DataFrame]:
    arrays = []
    rows = []
    expected_shape = None

    for name, image in image_dict.items():
        arr = _xes_image_array(image, plane, normalize_exposure, transpose_image)
        if expected_shape is None:
            expected_shape = arr.shape
        elif arr.shape != expected_shape:
            raise ValueError(f"{name} shape {arr.shape} does not match dark/bias shape {expected_shape}")

        arrays.append(arr)
        rows.append({
            "Frame": name,
            "Exposure_s": _xes_exposure_seconds(image),
            "Mean": float(np.nanmean(arr)),
            "Median": float(np.nanmedian(arr)),
        })

    if not arrays:
        return None, pd.DataFrame()

    avg = np.nanmean(np.stack(arrays, axis=0), axis=0)
    return avg.astype(float), pd.DataFrame(rows)


def _xes_preprocessed_image_array(
    image,
    plane: int,
    normalize_exposure: bool,
    dark_frame: np.ndarray | None = None,
    transpose_image: bool = False,
) -> np.ndarray:
    arr = _xes_image_array(image, plane, normalize_exposure, transpose_image)
    if dark_frame is None:
        return arr
    if arr.shape != dark_frame.shape:
        raise ValueError(f"Image shape {arr.shape} and dark/bias shape {dark_frame.shape} do not match")
    return arr - dark_frame


def _xes_ordered_sample_names(image_dict: dict[str, object], order_method: str) -> list[str]:
    names = list(image_dict.keys())
    if order_method == "filename":
        return sorted(names, key=_natural_sort_key)
    if order_method == "time":
        time_rows = []
        for name in names:
            t_val, _ = _xes_header_time_value(image_dict[name])
            if t_val is None:
                return sorted(names, key=_natural_sort_key)
            time_rows.append((t_val, name))
        return [name for _, name in sorted(time_rows)]
    return names


def _xes_bg_weights(
    image_dict: dict[str, object],
    bg1_image,
    bg2_image,
    order_method: str,
) -> tuple[dict[str, float], pd.DataFrame, str]:
    ordered_names = _xes_ordered_sample_names(image_dict, order_method)
    n = len(ordered_names)
    weights: dict[str, float] = {}
    rows = []
    source_label = {
        "time": "FITS header time",
        "filename": "file name natural sort",
        "upload": "upload order",
    }.get(order_method, order_method)

    bg1_time, bg1_time_key = _xes_header_time_value(bg1_image)
    bg2_time, bg2_time_key = _xes_header_time_value(bg2_image)
    sample_time_available = all(_xes_header_time_value(image_dict[name])[0] is not None for name in image_dict)
    can_use_time = (
        order_method == "time"
        and bg1_time is not None
        and bg2_time is not None
        and bg1_time != bg2_time
        and sample_time_available
    )

    if order_method == "time" and not can_use_time:
        source_label = "file name natural sort (time unavailable)"
        ordered_names = sorted(image_dict.keys(), key=_natural_sort_key)

    for pos, name in enumerate(ordered_names, start=1):
        time_val, time_key = _xes_header_time_value(image_dict[name])
        if can_use_time and time_val is not None:
            raw_weight = (time_val - bg1_time) / (bg2_time - bg1_time)
        else:
            raw_weight = pos / (n + 1)
        weight = float(np.clip(raw_weight, 0.0, 1.0))
        weights[name] = weight
        rows.append({
            "Sample": name,
            "Order": pos,
            "Weight_w": weight,
            "Raw_w": float(raw_weight),
            "Time_Source": time_key,
            "BG1_Time_Source": bg1_time_key,
            "BG2_Time_Source": bg2_time_key,
        })

    return weights, pd.DataFrame(rows), source_label


def _xes_bg_weights_from_names(
    sample_names: list[str],
    order_method: str,
) -> tuple[dict[str, float], pd.DataFrame, str]:
    if order_method == "filename":
        ordered_names = sorted(sample_names, key=_natural_sort_key)
        source_label = "file name natural sort"
    else:
        ordered_names = list(sample_names)
        source_label = "upload order"

    n = len(ordered_names)
    weights: dict[str, float] = {}
    rows = []
    for pos, name in enumerate(ordered_names, start=1):
        raw_weight = pos / (n + 1) if n else 0.5
        weight = float(np.clip(raw_weight, 0.0, 1.0))
        weights[name] = weight
        rows.append({
            "Sample": name,
            "Order": pos,
            "Weight_w": weight,
            "Raw_w": float(raw_weight),
            "Time_Source": "",
            "BG1_Time_Source": "",
            "BG2_Time_Source": "",
        })

    return weights, pd.DataFrame(rows), source_label


def _xes_corrected_array(image, plane: int, bg1_image, bg2_image,
                         bg_method: str, weight: float,
                         normalize_exposure: bool = False,
                         dark_frame: np.ndarray | None = None,
                         transpose_image: bool = False) -> np.ndarray:
    sample_arr = _xes_preprocessed_image_array(
        image, plane, normalize_exposure, dark_frame, transpose_image,
    )
    if bg_method == "none":
        return sample_arr.copy()

    if bg1_image is None and bg_method in ("bg1", "average", "interpolated"):
        raise ValueError("BG1 is required for this background method")
    if bg2_image is None and bg_method in ("bg2", "average", "interpolated"):
        raise ValueError("BG2 is required for this background method")

    if bg_method == "bg1":
        bg_arr = _xes_preprocessed_image_array(
            bg1_image, plane, normalize_exposure, dark_frame, transpose_image,
        )
    elif bg_method == "bg2":
        bg_arr = _xes_preprocessed_image_array(
            bg2_image, plane, normalize_exposure, dark_frame, transpose_image,
        )
    else:
        bg1_arr = _xes_preprocessed_image_array(
            bg1_image, plane, normalize_exposure, dark_frame, transpose_image,
        )
        bg2_arr = _xes_preprocessed_image_array(
            bg2_image, plane, normalize_exposure, dark_frame, transpose_image,
        )
        if bg_method == "average":
            bg_arr = 0.5 * (bg1_arr + bg2_arr)
        elif bg_method == "interpolated":
            bg_arr = bg1_arr + float(weight) * (bg2_arr - bg1_arr)
        else:
            bg_arr = np.zeros_like(sample_arr, dtype=float)

    if sample_arr.shape != bg_arr.shape:
        raise ValueError(f"Sample shape {sample_arr.shape} and background shape {bg_arr.shape} do not match")
    return sample_arr - bg_arr


def _xes_fix_hot_pixels(arr: np.ndarray, enabled: bool,
                        threshold: float = 8.0, window_size: int = 3) -> tuple[np.ndarray, np.ndarray]:
    arr = np.asarray(arr, dtype=float)
    mask = np.zeros(arr.shape, dtype=bool)
    if not enabled or arr.size < 9:
        return arr.copy(), mask

    window_size = int(max(3, window_size))
    if window_size % 2 == 0:
        window_size += 1

    local_median = median_filter(arr, size=window_size, mode="nearest")
    residual = arr - local_median
    finite_res = residual[np.isfinite(residual)]
    if finite_res.size == 0:
        return arr.copy(), mask

    med = float(np.nanmedian(finite_res))
    mad = float(np.nanmedian(np.abs(finite_res - med)))
    scale = 1.4826 * mad
    if not np.isfinite(scale) or scale < 1e-12:
        scale = float(np.nanstd(finite_res))
    if not np.isfinite(scale) or scale < 1e-12:
        return arr.copy(), mask

    mask = residual > float(threshold) * scale
    cleaned = arr.copy()
    cleaned[mask] = local_median[mask]
    return cleaned, mask


def _xes_peak_center_subpixel(x_axis: np.ndarray, y_vals: np.ndarray,
                              cutoff: float) -> tuple[float | None, float, float]:
    x_axis = np.asarray(x_axis, dtype=float)
    y_vals = np.asarray(y_vals, dtype=float)
    finite = np.isfinite(x_axis) & np.isfinite(y_vals)
    if np.count_nonzero(finite) < 3:
        return None, np.nan, np.nan

    x = x_axis[finite]
    y = y_vals[finite]
    baseline = float(np.nanmedian(y))
    residual = y - baseline
    mad = float(np.nanmedian(np.abs(residual - np.nanmedian(residual))))
    noise = 1.4826 * mad
    if not np.isfinite(noise) or noise < 1e-12:
        noise = float(np.nanstd(residual))

    peak_idx = int(np.nanargmax(y))
    peak_height = float(y[peak_idx] - baseline)
    snr = peak_height / noise if noise and noise > 1e-12 else np.inf
    if peak_height <= 0 or (np.isfinite(snr) and snr < float(cutoff)):
        return None, peak_height, snr

    center = float(x[peak_idx])
    if 0 < peak_idx < len(y) - 1:
        y0, y1, y2 = float(y[peak_idx - 1]), float(y[peak_idx]), float(y[peak_idx + 1])
        denom = y0 - 2.0 * y1 + y2
        if abs(denom) > 1e-12:
            delta = 0.5 * (y0 - y2) / denom
            if np.isfinite(delta):
                delta = float(np.clip(delta, -1.0, 1.0))
                center = float(x[peak_idx] + delta * np.nanmedian(np.diff(x)))

    return center, peak_height, snr


def _xes_fit_curvature(
    arr: np.ndarray,
    x_range: tuple[int, int],
    y_range: tuple[int, int],
    fit_x_range: tuple[int, int],
    poly_order: int,
    cutoff: float,
) -> tuple[pd.DataFrame, list[float], float]:
    arr = np.asarray(arr, dtype=float)
    height, width = arr.shape
    x0 = int(np.clip(min(x_range), 0, width - 1))
    x1 = int(np.clip(max(x_range), 0, width - 1))
    y0 = int(np.clip(min(y_range), 0, height - 1))
    y1 = int(np.clip(max(y_range), 0, height - 1))
    c0 = int(np.clip(min(fit_x_range), x0, x1))
    c1 = int(np.clip(max(fit_x_range), x0, x1))
    if c1 - c0 < 2:
        raise ValueError("曲率 fitting column 範圍至少需要 3 個 pixel。")

    col_axis = np.arange(c0, c1 + 1, dtype=float)
    rows = []
    for row_idx in range(y0, y1 + 1):
        segment = arr[row_idx, c0:c1 + 1]
        center, peak_height, snr = _xes_peak_center_subpixel(col_axis, segment, cutoff)
        rows.append({
            "Row": row_idx,
            "Peak_Center_Column": center,
            "Peak_Height": peak_height,
            "SNR": snr,
            "Accepted": center is not None,
        })

    curve_df = pd.DataFrame(rows)
    accepted = curve_df[curve_df["Accepted"]].copy()
    degree = int(max(1, poly_order))
    if len(accepted) < degree + 1:
        raise ValueError(f"可用 row 數不足，無法 fit {degree} 階曲率。")

    x_fit = accepted["Row"].to_numpy(dtype=float)
    y_fit = accepted["Peak_Center_Column"].to_numpy(dtype=float)
    coeffs = np.polyfit(x_fit, y_fit, degree).astype(float)
    fit_vals = np.polyval(coeffs, x_fit)
    residual = y_fit - fit_vals
    res_mad = float(np.nanmedian(np.abs(residual - np.nanmedian(residual))))
    res_scale = 1.4826 * res_mad
    if np.isfinite(res_scale) and res_scale > 1e-12:
        keep = np.abs(residual) <= float(cutoff) * res_scale
        if np.count_nonzero(keep) >= degree + 1 and np.count_nonzero(~keep) > 0:
            x_fit = x_fit[keep]
            y_fit = y_fit[keep]
            coeffs = np.polyfit(x_fit, y_fit, degree).astype(float)
            accepted = accepted.iloc[np.where(keep)[0]].copy()

    row_all = curve_df["Row"].to_numpy(dtype=float)
    curve_df["Fitted_Center_Column"] = np.polyval(coeffs, row_all)
    curve_df["Shift_Column"] = np.nan
    curve_df["Used_In_Fit"] = curve_df["Row"].isin(accepted["Row"].astype(int))
    reference_center = float(np.nanmedian(curve_df.loc[curve_df["Used_In_Fit"], "Fitted_Center_Column"]))
    curve_df.loc[curve_df["Accepted"], "Shift_Column"] = (
        reference_center - curve_df.loc[curve_df["Accepted"], "Fitted_Center_Column"]
    )
    return curve_df, coeffs.tolist(), reference_center


def _xes_shift_image_from_curvature(
    arr: np.ndarray,
    curve_df: pd.DataFrame,
    coeffs: list[float],
    reference_center: float,
    y_range: tuple[int, int],
) -> np.ndarray:
    arr = np.asarray(arr, dtype=float)
    shifted = arr.copy()
    if not coeffs:
        return shifted

    height, width = arr.shape
    y0 = int(np.clip(min(y_range), 0, height - 1))
    y1 = int(np.clip(max(y_range), 0, height - 1))
    col_axis = np.arange(width, dtype=float)
    rows = np.arange(y0, y1 + 1, dtype=float)
    fitted_centers = np.polyval(np.asarray(coeffs, dtype=float), rows)

    for row_idx, fitted_center in zip(range(y0, y1 + 1), fitted_centers):
        if not np.isfinite(fitted_center):
            continue
        delta = float(reference_center - fitted_center)
        shifted[row_idx, :] = np.interp(
            col_axis - delta,
            col_axis,
            arr[row_idx, :],
            left=np.nan,
            right=np.nan,
        )

    return shifted


def _xes_apply_curvature_correction(
    arr: np.ndarray,
    enabled: bool,
    x_range: tuple[int, int],
    y_range: tuple[int, int],
    fit_x_range: tuple[int, int],
    poly_order: int,
    cutoff: float,
) -> tuple[np.ndarray, pd.DataFrame, list[float], float | None]:
    if not enabled:
        return arr.copy(), pd.DataFrame(), [], None

    curve_df, coeffs, reference_center = _xes_fit_curvature(
        arr, x_range, y_range, fit_x_range, poly_order, cutoff,
    )
    shifted = _xes_shift_image_from_curvature(
        arr, curve_df, coeffs, reference_center, y_range,
    )
    return shifted, curve_df, coeffs, reference_center


def _xes_apply_axis_calibration(pixel_axis: np.ndarray, mode: str,
                                linear_offset: float, linear_slope: float,
                                poly_coeffs: list[float]) -> np.ndarray:
    pixel_axis = np.asarray(pixel_axis, dtype=float)
    if mode == "linear":
        return linear_offset + linear_slope * pixel_axis
    if mode == "reference_points" and poly_coeffs:
        return np.polyval(poly_coeffs, pixel_axis)
    return pixel_axis


def _xes_calibration_coeffs(ref_df: pd.DataFrame, degree: int) -> list[float]:
    if ref_df.empty:
        return []
    valid = ref_df[["Pixel", "Energy_eV"]].dropna()
    min_points = int(degree) + 1
    if len(valid) < min_points:
        return []
    return np.polyfit(
        valid["Pixel"].to_numpy(dtype=float),
        valid["Energy_eV"].to_numpy(dtype=float),
        int(degree),
    ).astype(float).tolist()


def _xes_find_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    normalized = {
        re.sub(r"[^a-z0-9]+", "", str(col).lower()): col
        for col in df.columns
    }
    for candidate in candidates:
        key = re.sub(r"[^a-z0-9]+", "", candidate.lower())
        if key in normalized:
            return normalized[key]
    return None


def _xes_read_table_bytes(uploaded_file) -> pd.DataFrame:
    raw = uploaded_file.getvalue() if hasattr(uploaded_file, "getvalue") else uploaded_file.read()
    name = str(getattr(uploaded_file, "name", "")).lower()
    if name.endswith((".xlsx", ".xls")):
        try:
            return pd.read_excel(io.BytesIO(raw))
        except ImportError as exc:
            raise RuntimeError("讀取 Excel 需要 openpyxl，請執行「安裝套件.bat」後重新啟動。") from exc
    return pd.read_csv(io.BytesIO(raw))


def _xes_calibration_points_from_csv(uploaded_file) -> tuple[pd.DataFrame, str]:
    try:
        df = _xes_read_table_bytes(uploaded_file)
    except Exception as exc:
        return pd.DataFrame(columns=["Pixel", "Energy_eV"]), str(exc)
    pixel_col = _xes_find_column(df, ["Pixel", "Detector Pixel", "Channel", "Column", "Row", "X"])
    energy_col = _xes_find_column(df, ["Energy_eV", "Energy", "Emission Energy", "eV"])
    if pixel_col is None or energy_col is None:
        return pd.DataFrame(columns=["Pixel", "Energy_eV"]), (
            "CSV 需要包含 Pixel 與 Energy_eV 欄位；也可用 Channel/Column/Row 與 Energy/eV。"
        )

    points = pd.DataFrame({
        "Pixel": pd.to_numeric(df[pixel_col], errors="coerce"),
        "Energy_eV": pd.to_numeric(df[energy_col], errors="coerce"),
    }).dropna()
    return points, ""


def _xes_i0_table_from_csv(uploaded_file) -> tuple[pd.DataFrame, str]:
    try:
        df = _xes_read_table_bytes(uploaded_file)
    except Exception as exc:
        return pd.DataFrame(columns=["File", "I0"]), str(exc)
    file_col = _xes_find_column(df, ["File", "Filename", "Sample", "Name", "Dataset"])
    i0_col = _xes_find_column(df, ["I0", "Incident Flux", "IncidentFlux", "Flux", "Monitor"])
    if i0_col is None:
        return pd.DataFrame(columns=["File", "I0"]), "CSV 需要包含 I0 / Flux / Monitor 欄位。"

    if file_col is None and len(df) == 1:
        out = pd.DataFrame({"File": ["*"], "I0": [pd.to_numeric(df[i0_col], errors="coerce").iloc[0]]})
    elif file_col is not None:
        out = pd.DataFrame({
            "File": df[file_col].astype(str),
            "I0": pd.to_numeric(df[i0_col], errors="coerce"),
        })
    else:
        return pd.DataFrame(columns=["File", "I0"]), "多筆 I0 CSV 需要包含 File / Filename / Sample 欄位。"

    out = out.dropna(subset=["I0"])
    out = out[out["I0"] > 0]
    return out.reset_index(drop=True), ""


def _xes_lookup_i0_value(fname: str, i0_mode: str, i0_global: float,
                         i0_table: pd.DataFrame) -> float | None:
    if i0_mode == "global":
        return float(i0_global) if i0_global > 0 else None
    if i0_mode != "table" or i0_table.empty:
        return None

    target = str(fname).strip().lower()
    target_stem = target.rsplit(".", 1)[0]
    for _, row in i0_table.iterrows():
        key = str(row.get("File", "")).strip().lower()
        if key == "*":
            return float(row["I0"])
        key_stem = key.rsplit(".", 1)[0]
        if key == target or key_stem == target_stem:
            return float(row["I0"])
    return None


def _xes_apply_i0_to_spectra(values: tuple[np.ndarray, ...], i0_value: float | None) -> tuple[np.ndarray, ...]:
    if i0_value is None or i0_value <= 0:
        return values
    return tuple(np.asarray(v, dtype=float) / float(i0_value) for v in values)


def _xes_band_alignment_summary(
    mat_a: str,
    mat_b: str,
    vbm_a: float,
    cbm_a: float,
    vbm_b: float,
    cbm_b: float,
    sigma_vbm_a: float = 0.0,
    sigma_cbm_a: float = 0.0,
    sigma_vbm_b: float = 0.0,
    sigma_cbm_b: float = 0.0,
) -> tuple[pd.DataFrame, dict[str, float]]:
    eg_a = float(cbm_a - vbm_a)
    eg_b = float(cbm_b - vbm_b)
    delta_ev = float(vbm_a - vbm_b)
    delta_ec = float(cbm_a - cbm_b)
    sigma_eg_a = float(math.hypot(sigma_vbm_a, sigma_cbm_a))
    sigma_eg_b = float(math.hypot(sigma_vbm_b, sigma_cbm_b))
    sigma_delta_ev = float(math.hypot(sigma_vbm_a, sigma_vbm_b))
    sigma_delta_ec = float(math.hypot(sigma_cbm_a, sigma_cbm_b))
    rows = [
        {"Quantity": f"{mat_a} VBM_XES", "Value_eV": vbm_a, "Sigma_eV": sigma_vbm_a},
        {"Quantity": f"{mat_a} CBM_XAS", "Value_eV": cbm_a, "Sigma_eV": sigma_cbm_a},
        {"Quantity": f"{mat_a} Bandgap_Eg", "Value_eV": eg_a, "Sigma_eV": sigma_eg_a},
        {"Quantity": f"{mat_b} VBM_XES", "Value_eV": vbm_b, "Sigma_eV": sigma_vbm_b},
        {"Quantity": f"{mat_b} CBM_XAS", "Value_eV": cbm_b, "Sigma_eV": sigma_cbm_b},
        {"Quantity": f"{mat_b} Bandgap_Eg", "Value_eV": eg_b, "Sigma_eV": sigma_eg_b},
        {"Quantity": f"Delta_EV = VBM({mat_a}) - VBM({mat_b})", "Value_eV": delta_ev, "Sigma_eV": sigma_delta_ev},
        {"Quantity": f"Delta_EC = CBM({mat_a}) - CBM({mat_b})", "Value_eV": delta_ec, "Sigma_eV": sigma_delta_ec},
    ]
    metrics = {
        "eg_a": eg_a,
        "eg_b": eg_b,
        "delta_ev": delta_ev,
        "delta_ec": delta_ec,
        "sigma_eg_a": sigma_eg_a,
        "sigma_eg_b": sigma_eg_b,
        "sigma_delta_ev": sigma_delta_ev,
        "sigma_delta_ec": sigma_delta_ec,
    }
    return pd.DataFrame(rows), metrics


def _xes_band_alignment_figure(
    mat_a: str,
    mat_b: str,
    vbm_a: float,
    cbm_a: float,
    vbm_b: float,
    cbm_b: float,
) -> go.Figure:
    fig = go.Figure()
    materials = [
        (mat_a, 0.8, vbm_a, cbm_a, "#00CC96"),
        (mat_b, 2.0, vbm_b, cbm_b, "#636EFA"),
    ]
    for label, xc, ev, ec, color in materials:
        fig.add_shape(type="line", x0=xc - 0.35, x1=xc + 0.35, y0=ev, y1=ev, line=dict(color=color, width=5))
        fig.add_shape(type="line", x0=xc - 0.35, x1=xc + 0.35, y0=ec, y1=ec, line=dict(color=color, width=5))
        fig.add_shape(
            type="rect",
            x0=xc - 0.35,
            x1=xc + 0.35,
            y0=min(ev, ec),
            y1=max(ev, ec),
            fillcolor=hex_to_rgba(color, 0.16),
            line=dict(color=hex_to_rgba(color, 0.65), width=1),
            layer="below",
        )
        fig.add_annotation(x=xc, y=ev, text=f"VBM<br>{ev:.3f} eV", showarrow=False, yshift=-28)
        fig.add_annotation(x=xc, y=ec, text=f"CBM<br>{ec:.3f} eV", showarrow=False, yshift=28)
        fig.add_annotation(x=xc, y=min(ev, ec) - 0.12 * max(1.0, abs(ec - ev)), text=label, showarrow=False)

    fig.add_shape(type="line", x0=0.8, x1=2.0, y0=vbm_a, y1=vbm_b, line=dict(color="#FFD166", width=2, dash="dash"))
    fig.add_shape(type="line", x0=0.8, x1=2.0, y0=cbm_a, y1=cbm_b, line=dict(color="#FF6692", width=2, dash="dash"))
    fig.add_annotation(x=1.4, y=(vbm_a + vbm_b) / 2, text=f"Delta EV = {vbm_a - vbm_b:+.3f} eV", showarrow=False, yshift=-18)
    fig.add_annotation(x=1.4, y=(cbm_a + cbm_b) / 2, text=f"Delta EC = {cbm_a - cbm_b:+.3f} eV", showarrow=False, yshift=18)
    y_min = min(vbm_a, cbm_a, vbm_b, cbm_b)
    y_max = max(vbm_a, cbm_a, vbm_b, cbm_b)
    pad = max(0.5, 0.15 * (y_max - y_min if y_max > y_min else 1.0))
    fig.update_layout(
        title="XES/XAS Band Alignment",
        xaxis=dict(visible=False, range=[0.2, 2.6]),
        yaxis_title="Energy (eV)",
        yaxis=dict(range=[y_min - pad, y_max + pad]),
        template="plotly_dark",
        height=430,
        margin=dict(l=50, r=20, t=60, b=50),
    )
    return fig


def _xes_sorted_finite_xy(axis: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    axis = np.asarray(axis, dtype=float)
    values = np.asarray(values, dtype=float)
    mask = np.isfinite(axis) & np.isfinite(values)
    axis = axis[mask]
    values = values[mask]
    if len(axis) < 2:
        return axis, values
    order = np.argsort(axis)
    axis = axis[order]
    values = values[order]
    keep = np.concatenate(([True], np.diff(axis) > 1e-12))
    return axis[keep], values[keep]


def _xes_interp_to_axis(axis: np.ndarray, values: np.ndarray, target_axis: np.ndarray) -> np.ndarray:
    clean_axis, clean_values = _xes_sorted_finite_xy(axis, values)
    if len(clean_axis) < 2:
        return np.full_like(target_axis, np.nan, dtype=float)
    return interp1d(
        clean_axis, clean_values, kind="linear",
        bounds_error=False, fill_value=np.nan,
    )(target_axis)


def _xes_spectrum_background_curve(
    x_vals: np.ndarray,
    bg1_spectrum: tuple[np.ndarray, np.ndarray] | None,
    bg2_spectrum: tuple[np.ndarray, np.ndarray] | None,
    bg_method: str,
    weight: float,
) -> np.ndarray:
    x_vals = np.asarray(x_vals, dtype=float)
    zeros = np.zeros_like(x_vals, dtype=float)
    if bg_method == "none":
        return zeros

    bg1_y = _xes_interp_to_axis(bg1_spectrum[0], bg1_spectrum[1], x_vals) if bg1_spectrum else None
    bg2_y = _xes_interp_to_axis(bg2_spectrum[0], bg2_spectrum[1], x_vals) if bg2_spectrum else None

    if bg_method == "bg1":
        return np.nan_to_num(bg1_y, nan=0.0) if bg1_y is not None else zeros
    if bg_method == "bg2":
        return np.nan_to_num(bg2_y, nan=0.0) if bg2_y is not None else zeros
    if bg_method == "average":
        if bg1_y is None or bg2_y is None:
            return zeros
        return np.nan_to_num(0.5 * (bg1_y + bg2_y), nan=0.0)
    if bg_method == "interpolated":
        if bg1_y is None or bg2_y is None:
            return zeros
        return np.nan_to_num(bg1_y + float(weight) * (bg2_y - bg1_y), nan=0.0)
    return zeros


def _parse_xes_spectrum_dataframe(df: pd.DataFrame) -> tuple[np.ndarray | None, np.ndarray | None, str | None]:
    num_df = df.apply(pd.to_numeric, errors="coerce")
    valid_cols = [col for col in num_df.columns if num_df[col].notna().sum() >= 2]
    if len(valid_cols) < 2:
        return None, None, "Excel 檔需要至少兩個數值欄位：X 與 intensity。"
    clean = num_df[[valid_cols[0], valid_cols[1]]].dropna()
    if len(clean) < 2:
        return None, None, "Excel 檔需要至少兩筆有效的 X 與 intensity 數據。"
    x_vals = clean.iloc[:, 0].to_numpy(dtype=float)
    y_vals = clean.iloc[:, 1].to_numpy(dtype=float)
    x_vals, y_vals = _xes_sorted_finite_xy(x_vals, y_vals)
    if len(x_vals) < 2:
        return None, None, "Excel 光譜資料不足，請確認前兩個數值欄位為 X 與 intensity。"
    return x_vals, y_vals, None


def _parse_xes_spectrum_bytes(raw: bytes, filename: str = "") -> tuple[np.ndarray | None, np.ndarray | None, str | None]:
    if str(filename).lower().endswith((".xlsx", ".xls")):
        try:
            return _parse_xes_spectrum_dataframe(pd.read_excel(io.BytesIO(raw)))
        except ImportError as exc:
            return None, None, "讀取 Excel 需要 openpyxl，請執行「安裝套件.bat」後重新啟動。"
        except Exception as exc:
            return None, None, f"Excel 光譜讀取失敗：{exc}"

    x_vals, y_vals, err = parse_two_column_spectrum_bytes(raw)
    if err:
        return None, None, err
    x_vals, y_vals = _xes_sorted_finite_xy(x_vals, y_vals)
    if len(x_vals) < 2:
        return None, None, "光譜檔至少需要兩筆有效的 X, intensity 數據。"
    return x_vals, y_vals, None


def _xes_spectrum_result(label: str, x_vals: np.ndarray, y_vals: np.ndarray, role: str) -> dict:
    x_vals = np.asarray(x_vals, dtype=float)
    y_vals = np.nan_to_num(np.asarray(y_vals, dtype=float), nan=0.0)
    return {
        "label": label,
        "role": role,
        "image": None,
        "hot_mask": np.array([], dtype=bool),
        "curve_df": pd.DataFrame(),
        "curve_coeffs": [],
        "reference_center": None,
        "curvature_applied": False,
        "x": x_vals,
        "raw_y": y_vals,
        "signal": y_vals.copy(),
        "side_bg": np.zeros_like(y_vals, dtype=float),
    }


def _extract_xes_spectrum_from_array(arr: np.ndarray, x_range: tuple[int, int], y_range: tuple[int, int],
                                     projection: str, reducer: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    height, width = arr.shape

    x0 = int(np.clip(min(x_range), 0, width - 1))
    x1 = int(np.clip(max(x_range), 0, width - 1))
    y0 = int(np.clip(min(y_range), 0, height - 1))
    y1 = int(np.clip(max(y_range), 0, height - 1))

    roi = arr[y0:y1 + 1, x0:x1 + 1]
    if projection == "columns":
        x_axis = np.arange(x0, x1 + 1, dtype=float)
        values = np.nanmean(roi, axis=0) if reducer == "mean" else np.nansum(roi, axis=0)
    else:
        x_axis = np.arange(y0, y1 + 1, dtype=float)
        values = np.nanmean(roi, axis=1) if reducer == "mean" else np.nansum(roi, axis=1)

    return x_axis, np.nan_to_num(values.astype(float), nan=0.0), roi


def _xes_default_sideband_ranges(signal_range: tuple[int, int], max_index: int) -> tuple[tuple[int, int], tuple[int, int]]:
    s0 = int(np.clip(min(signal_range), 0, max_index))
    s1 = int(np.clip(max(signal_range), 0, max_index))
    width = max(1, s1 - s0 + 1)

    upper_end = max(0, s0 - 1)
    upper_start = max(0, upper_end - width + 1)
    lower_start = min(max_index, s1 + 1)
    lower_end = min(max_index, lower_start + width - 1)
    return (upper_start, upper_end), (lower_start, lower_end)


def _xes_non_overlapping_indices(candidate_range: tuple[int, int], signal_range: tuple[int, int], max_index: int) -> np.ndarray:
    c0 = int(np.clip(min(candidate_range), 0, max_index))
    c1 = int(np.clip(max(candidate_range), 0, max_index))
    s0 = int(np.clip(min(signal_range), 0, max_index))
    s1 = int(np.clip(max(signal_range), 0, max_index))
    idx = np.arange(c0, c1 + 1, dtype=int)
    return idx[(idx < s0) | (idx > s1)]


def _extract_xes_spectrum_with_sideband(
    arr: np.ndarray,
    x_range: tuple[int, int],
    y_range: tuple[int, int],
    projection: str,
    reducer: str,
    sideband_enabled: bool = False,
    sideband_ranges: tuple[tuple[int, int], tuple[int, int]] | None = None,
    sideband_stat: str = "mean",
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    x_axis, signal_values, roi = _extract_xes_spectrum_from_array(
        arr, x_range, y_range, projection, reducer,
    )
    zero_bg = np.zeros_like(signal_values, dtype=float)
    if not sideband_enabled or not sideband_ranges:
        return x_axis, signal_values, signal_values, zero_bg, roi

    height, width = arr.shape
    x0 = int(np.clip(min(x_range), 0, width - 1))
    x1 = int(np.clip(max(x_range), 0, width - 1))
    y0 = int(np.clip(min(y_range), 0, height - 1))
    y1 = int(np.clip(max(y_range), 0, height - 1))

    projections = []
    if projection == "columns":
        signal_size = max(1, y1 - y0 + 1)
        for band_range in sideband_ranges:
            rows = _xes_non_overlapping_indices(band_range, (y0, y1), height - 1)
            if rows.size == 0:
                continue
            band_roi = arr[np.ix_(rows, np.arange(x0, x1 + 1, dtype=int))]
            per_pixel = (
                np.nanmedian(band_roi, axis=0)
                if sideband_stat == "median" else np.nanmean(band_roi, axis=0)
            )
            projections.append(per_pixel)
    else:
        signal_size = max(1, x1 - x0 + 1)
        for band_range in sideband_ranges:
            cols = _xes_non_overlapping_indices(band_range, (x0, x1), width - 1)
            if cols.size == 0:
                continue
            band_roi = arr[np.ix_(np.arange(y0, y1 + 1, dtype=int), cols)]
            per_pixel = (
                np.nanmedian(band_roi, axis=1)
                if sideband_stat == "median" else np.nanmean(band_roi, axis=1)
            )
            projections.append(per_pixel)

    if not projections:
        return x_axis, signal_values, signal_values, zero_bg, roi

    bg_per_pixel = np.nanmean(np.vstack(projections), axis=0)
    scale = signal_size if reducer == "sum" else 1
    scaled_bg = np.nan_to_num(bg_per_pixel * scale, nan=0.0)
    corrected = np.nan_to_num(signal_values - scaled_bg, nan=0.0)
    return x_axis, corrected.astype(float), signal_values.astype(float), scaled_bg.astype(float), roi


def _extract_xes_spectrum(image, plane: int, x_range: tuple[int, int], y_range: tuple[int, int],
                          projection: str, reducer: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    arr = image.as_array(plane)
    return _extract_xes_spectrum_from_array(arr, x_range, y_range, projection, reducer)


# ── Preset / export helpers ────────────────────────────────────────────────────

_XES_PRESET_VERSION = 1
_XES_PRESET_KEYS = [
    "xes_input_mode",
    "xes_bg_method", "xes_bg_order",
    "xes_norm_exposure", "xes_transpose_image",
    "xes_i0_mode", "xes_i0_global",
    "xes_use_dark", "xes_fix_hot", "xes_hot_threshold", "xes_hot_window",
    "xes_plane",
    "xes_projection", "xes_reducer",
    "xes_x_roi", "xes_y_roi",
    "xes_sideband_enabled", "xes_sideband_a", "xes_sideband_b", "xes_sideband_stat",
    "xes_curvature_enabled", "xes_curvature_x_range", "xes_curvature_order", "xes_curvature_cutoff",
    "xes_do_avg", "xes_show_ind",
    "xes_smooth_method", "xes_smooth_window", "xes_smooth_poly",
    "xes_norm_method", "xes_norm_range",
    "xes_axis_calibration", "xes_energy_offset", "xes_energy_slope", "xes_cal_degree",
    "xes_run_peaks", "xes_peak_prominence", "xes_peak_height", "xes_peak_distance",
    "xes_peak_max", "xes_peak_labels",
    "xes_peak_id_enabled", "xes_peak_id_materials", "xes_peak_id_tol_ev",
    "xes_peak_id_tol_pixel", "xes_peak_id_only_matched",
    "xes_band_align_enabled", "xes_band_mat_a", "xes_band_mat_b",
    "xes_band_vbm_a", "xes_band_cbm_a", "xes_band_vbm_b", "xes_band_cbm_b",
    "xes_band_sigma_vbm_a", "xes_band_sigma_cbm_a",
    "xes_band_sigma_vbm_b", "xes_band_sigma_cbm_b",
]


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
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _dataframe_records(df: pd.DataFrame) -> list[dict]:
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return []
    safe_df = df.astype(object).where(pd.notna(df), None)
    return [_json_safe(rec) for rec in safe_df.to_dict("records")]


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
        export_stem = st.text_input(input_label, value=default_name, key=input_key)
        st.download_button(
            button_label,
            data=data,
            file_name=_build_export_filename(export_stem, extension),
            mime=mime,
            key=button_key,
            use_container_width=True,
        )


def _build_xes_preset_payload() -> dict:
    settings = {
        key: _json_safe(st.session_state.get(key))
        for key in _XES_PRESET_KEYS
        if key in st.session_state
    }
    return {
        "preset_type": "xes_processing_preset",
        "version": _XES_PRESET_VERSION,
        "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "settings": settings,
    }


def _apply_xes_preset_payload(payload: dict) -> None:
    if not isinstance(payload, dict):
        return
    settings = payload.get("settings", {})
    if not isinstance(settings, dict):
        return
    for key, value in settings.items():
        if key in _XES_PRESET_KEYS:
            st.session_state[key] = value


def _xes_column_display_name(col: str) -> str:
    mapping = {
        "Intensity": "原始訊號",
        "Average_intensity": "原始訊號（平均）",
        "BG1BG2_background": "BG1/BG2 背景",
        "Average_BG1BG2_background": "BG1/BG2 背景（平均）",
        "Intensity_before_BG1BG2": "BG 扣除前",
        "Average_before_BG1BG2": "BG 扣除前（平均）",
        "Intensity_smoothed": "平滑後",
        "Average_smoothed": "平滑後（平均）",
        "Intensity_normalized": "歸一化後",
        "Average_normalized": "歸一化後（平均）",
    }
    return mapping.get(col, col.replace("_", " "))


def _xes_default_compare_columns(columns: list[str]) -> list[str]:
    priority = [
        lambda c: c in ("Intensity", "Average_intensity"),
        lambda c: c in ("BG1BG2_background", "Average_BG1BG2_background"),
        lambda c: c in ("Intensity_smoothed", "Average_smoothed"),
        lambda c: c in ("Intensity_normalized", "Average_normalized"),
    ]
    ordered: list[str] = []
    for matcher in priority:
        match = next((col for col in columns if matcher(col)), None)
        if match and match not in ordered:
            ordered.append(match)
    return ordered or columns[:min(3, len(columns))]


def run_xes_ui():
    XES_COLORS = ["#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
                  "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52"]

    with st.sidebar:
        with st.expander("XES Preset", expanded=False):
            st.caption(
                "Preset 會保存目前 XES 流程的主要參數，例如資料來源模式、FITS 影像處理、"
                "ROI / 投影方向、BG1/BG2 背景扣除、I0 或曝光時間歸一化、平滑、"
                "能量校正與峰偵測設定。適合把同一套偵測器與量測條件套用到同批樣品，"
                "或日後重現同一組 XES 分析流程。"
            )
            preset_payload = _build_xes_preset_payload()
            preset_name = st.text_input(
                "Preset 檔名",
                value=st.session_state.get("xes_preset_name", "xes_preset"),
                key="xes_preset_name",
            )
            st.download_button(
                "⬇️ 匯出 XES preset JSON",
                data=json.dumps(preset_payload, ensure_ascii=False, indent=2).encode("utf-8"),
                file_name=_build_export_filename(preset_name or "xes_preset", "json"),
                mime="application/json",
                key="xes_preset_export_btn",
                use_container_width=True,
            )
            st.divider()
            preset_upload = st.file_uploader(
                "匯入 Preset JSON",
                type=["json"],
                key="xes_preset_uploader",
            )
            if preset_upload is not None:
                try:
                    loaded = json.loads(preset_upload.read().decode("utf-8"))
                    if loaded.get("preset_type") == "xes_processing_preset":
                        _apply_xes_preset_payload(loaded)
                        st.success("Preset 已套用，重新整理頁面生效。")
                    else:
                        st.warning("此 JSON 不是 XES preset 格式。")
                except Exception as exc:
                    st.error(f"Preset 讀取失敗：{exc}")

        step_header(1, "載入資料")
        xes_input_mode = st.radio(
            "資料來源模式",
            ["fits", "spectrum"],
            index=0,
            format_func=lambda v: {
                "fits": "Raw FITS：由本程式轉 1D 光譜",
                "spectrum": "已處理 1D 光譜：跳過 FITS 影像處理",
            }[v],
            key="xes_input_mode",
        )
        using_preprocessed_spectra = xes_input_mode == "spectrum"
        if using_preprocessed_spectra:
            spectrum_files = st.file_uploader(
                "上傳已處理 Sample 1D 光譜（可多選，兩欄 X / intensity）",
                type=["txt", "csv", "dat", "xy", "asc", "xlsx", "xls"],
                accept_multiple_files=True,
                key="xes_spectrum_uploader",
            )
            bg1_spectrum_file = st.file_uploader(
                "上傳已處理 BG1 1D 光譜（樣品前背景）",
                type=["txt", "csv", "dat", "xy", "asc", "xlsx", "xls"],
                accept_multiple_files=False,
                key="xes_bg1_spectrum_uploader",
            )
            bg2_spectrum_file = st.file_uploader(
                "上傳已處理 BG2 1D 光譜（樣品後背景）",
                type=["txt", "csv", "dat", "xy", "asc", "xlsx", "xls"],
                accept_multiple_files=False,
                key="xes_bg2_spectrum_uploader",
            )
            uploaded_files = []
            bg1_file = None
            bg2_file = None
            dark_files = []
        else:
            uploaded_files = st.file_uploader(
                "上傳 Sample FITS 影像（可多選）",
                type=["fits", "fit", "fts"],
                accept_multiple_files=True,
                key="xes_uploader",
            )
            bg1_file = st.file_uploader(
                "上傳 BG1 FITS（樣品前背景，必做）",
                type=["fits", "fit", "fts"],
                accept_multiple_files=False,
                key="xes_bg1_uploader",
            )
            bg2_file = st.file_uploader(
                "上傳 BG2 FITS（樣品後背景，必做）",
                type=["fits", "fit", "fts"],
                accept_multiple_files=False,
                key="xes_bg2_uploader",
            )
            dark_files = st.file_uploader(
                "進階可選：Dark/Bias FITS（沒有這類 detector 校正檔就不用上傳）",
                type=["fits", "fit", "fts"],
                accept_multiple_files=True,
                key="xes_dark_uploader",
            )
            spectrum_files = []
            bg1_spectrum_file = None
            bg2_spectrum_file = None

    image_dict = {}
    spectrum_dict: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    bg1_image = None
    bg2_image = None
    bg1_spectrum_data: tuple[np.ndarray, np.ndarray] | None = None
    bg2_spectrum_data: tuple[np.ndarray, np.ndarray] | None = None
    dark_images = {}

    def _parse_optional_xes_bg(uploaded_bg, label: str):
        if uploaded_bg is None:
            return None
        cache_key = f"_xes_{label}_{uploaded_bg.name}_{uploaded_bg.size}"
        if cache_key not in st.session_state:
            try:
                image = read_primary_image_bytes(uploaded_bg.read(), source=uploaded_bg.name)
                st.session_state[cache_key] = (image, None)
            except Exception as exc:
                st.session_state[cache_key] = (None, str(exc))
        image, err = st.session_state[cache_key]
        if err:
            st.error(f"**{label}: {uploaded_bg.name}** 讀取失敗：{err}")
            return None
        return image

    def _parse_optional_xes_spectrum(uploaded_spectrum, label: str):
        if uploaded_spectrum is None:
            return None
        cache_key = f"_xes_1d_{label}_{uploaded_spectrum.name}_{uploaded_spectrum.size}"
        if cache_key not in st.session_state:
            x_vals, y_vals, err = _parse_xes_spectrum_bytes(uploaded_spectrum.getvalue(), uploaded_spectrum.name)
            st.session_state[cache_key] = (x_vals, y_vals, err)
        x_vals, y_vals, err = st.session_state[cache_key]
        if err:
            st.error(f"**{label}: {uploaded_spectrum.name}** 讀取失敗：{err}")
            return None
        return x_vals, y_vals

    if using_preprocessed_spectra:
        if not spectrum_files:
            st.info("請在左側上傳一個或多個已處理 XES 1D sample 光譜檔。")
            st.stop()
        for uf in spectrum_files:
            cache_key = f"_xes_1d_sample_{uf.name}_{uf.size}"
            if cache_key not in st.session_state:
                x_vals, y_vals, err = _parse_xes_spectrum_bytes(uf.getvalue(), uf.name)
                st.session_state[cache_key] = (x_vals, y_vals, err)
            x_vals, y_vals, cached_err = st.session_state[cache_key]
            if cached_err:
                st.error(f"**{uf.name}** 讀取失敗：{cached_err}")
            else:
                spectrum_dict[uf.name] = (x_vals, y_vals)

        if not spectrum_dict:
            st.stop()

        bg1_spectrum_data = _parse_optional_xes_spectrum(bg1_spectrum_file, "BG1")
        bg2_spectrum_data = _parse_optional_xes_spectrum(bg2_spectrum_file, "BG2")
        st.success(f"成功載入 {len(spectrum_dict)} 個已處理 sample 1D 光譜：{', '.join(spectrum_dict.keys())}")

        first_name, (first_x_vals, _) = next(iter(spectrum_dict.items()))
        first_image = None
        raw_width, raw_height = len(first_x_vals), 1
        width, height = raw_width, raw_height
        plane_count = 1
        input_axis_start = float(np.nanmin(first_x_vals))
        input_axis_end = float(np.nanmax(first_x_vals))
    else:
        if not uploaded_files:
            st.info("請在左側上傳一個或多個 XES sample FITS 影像檔。")
            st.stop()

        for uf in uploaded_files:
            cache_key = f"_xes_{uf.name}_{uf.size}"
            if cache_key not in st.session_state:
                try:
                    image = read_primary_image_bytes(uf.read(), source=uf.name)
                    st.session_state[cache_key] = (image, None)
                except Exception as exc:
                    st.session_state[cache_key] = (None, str(exc))
            cached_image, cached_err = st.session_state[cache_key]
            if cached_err:
                st.error(f"**{uf.name}** 讀取失敗：{cached_err}")
            else:
                image_dict[uf.name] = cached_image

        if not image_dict:
            st.stop()

        bg1_image = _parse_optional_xes_bg(bg1_file, "BG1")
        bg2_image = _parse_optional_xes_bg(bg2_file, "BG2")
        for df in dark_files or []:
            cache_key = f"_xes_dark_{df.name}_{df.size}"
            if cache_key not in st.session_state:
                try:
                    image = read_primary_image_bytes(df.read(), source=df.name)
                    st.session_state[cache_key] = (image, None)
                except Exception as exc:
                    st.session_state[cache_key] = (None, str(exc))
            cached_image, cached_err = st.session_state[cache_key]
            if cached_err:
                st.error(f"**Dark/Bias: {df.name}** 讀取失敗：{cached_err}")
            else:
                dark_images[df.name] = cached_image

        st.success(f"成功載入 {len(image_dict)} 個 sample FITS：{', '.join(image_dict.keys())}")

        first_name, first_image = next(iter(image_dict.items()))
        raw_width, raw_height = first_image.width, first_image.height
        width, height = raw_width, raw_height
        plane_count = first_image.plane_count
        input_axis_start = 0.0
        input_axis_end = float(max(0, width - 1))

    sample_names = list(spectrum_dict.keys()) if using_preprocessed_spectra else list(image_dict.keys())
    bg1_available = bg1_spectrum_data is not None if using_preprocessed_spectra else bg1_image is not None
    bg2_available = bg2_spectrum_data is not None if using_preprocessed_spectra else bg2_image is not None

    bg_method = "interpolated" if (bg1_available and bg2_available) else "none"
    bg_order_method = "filename"
    bg_weights = {name: (idx + 1) / (len(sample_names) + 1) for idx, name in enumerate(sample_names)}
    bg_weight_df = pd.DataFrame()
    bg_weight_source = "upload order"
    normalize_exposure = False
    transpose_image = False
    i0_mode = "none"
    i0_global_value = 1.0
    i0_table_df = pd.DataFrame()
    use_dark_frame = bool(dark_images)
    dark_frame = None
    dark_summary_df = pd.DataFrame()
    fix_hot_pixels = False
    hot_pixel_threshold = 8.0
    hot_pixel_window = 3
    projection = "columns"
    reducer = "sum"
    plane_index = 0
    x_roi = (0, max(0, width - 1))
    y_roi = (0, max(0, height - 1))
    sideband_enabled = False
    sideband_ranges = None
    sideband_stat = "mean"
    curvature_enabled = False
    curvature_fit_x_range = (0, max(0, width - 1))
    curvature_poly_order = 4
    curvature_cutoff = 1.9
    do_average = False
    show_individual = False
    smooth_method = "none"
    smooth_window = 11
    smooth_poly_deg = 3
    norm_method = "none"
    norm_x_start = float(input_axis_start if using_preprocessed_spectra else x_roi[0])
    norm_x_end = float(input_axis_end if using_preprocessed_spectra else x_roi[1])
    run_peak_detection = False
    peak_prom_ratio = 0.05
    peak_height_ratio = 0.03
    peak_distance_pixel = 5.0
    max_peak_labels = 12
    label_peaks = True
    peak_id_enabled = False
    peak_id_materials = ["NiO", "Ga2O3", "n-Si"]
    peak_id_tol_ev = 3.0
    peak_id_tol_pixel = 5.0
    peak_id_only_matched = False
    axis_calibration = "pixel"
    energy_offset = 0.0
    energy_slope = 1.0
    energy_poly_coeffs: list[float] = []
    band_align_enabled = False
    band_mat_a = "p-NiO"
    band_mat_b = "n-Ga2O3"
    band_vbm_a = 0.0
    band_cbm_a = 0.0
    band_vbm_b = 0.0
    band_cbm_b = 0.0
    band_sigma_vbm_a = 0.0
    band_sigma_cbm_a = 0.0
    band_sigma_vbm_b = 0.0
    band_sigma_cbm_b = 0.0

    with st.sidebar:
        step_header(2, "前後背景光譜扣除（BG1/BG2）")
        st.caption("主流程：BG1、sample、BG2 會先各自轉成 1D 光譜，再用分點法對 sample 光譜扣背景。")
        bg_method = st.selectbox(
            "1D BG1/BG2 扣除方法",
            ["none", "bg1", "bg2", "average", "interpolated"],
            index=4 if (bg1_available and bg2_available) else 0,
            format_func=lambda v: {
                "none": "不扣除",
                "bg1": "只扣 BG1",
                "bg2": "只扣 BG2",
                "average": "(BG1 + BG2) / 2",
                "interpolated": "分點法（建議）：BG1 + w(BG2 - BG1)",
            }[v],
            key="xes_bg_method",
        )
        bg_upload_label = "1D 光譜" if using_preprocessed_spectra else "FITS"
        if bg_method in ("bg1", "average", "interpolated") and not bg1_available:
            st.warning(f"此方法需要 BG1 {bg_upload_label}。")
        if bg_method in ("bg2", "average", "interpolated") and not bg2_available:
            st.warning(f"此方法需要 BG2 {bg_upload_label}。")
        if bg_method == "interpolated":
            order_options = ["filename", "upload"] if using_preprocessed_spectra else ["time", "filename", "upload"]
            if st.session_state.get("xes_bg_order") not in order_options:
                st.session_state["xes_bg_order"] = order_options[0]
            bg_order_method = st.selectbox(
                "Sample 順序來源",
                order_options,
                index=0 if using_preprocessed_spectra else 1,
                format_func=lambda v: {
                    "time": "FITS header 時間",
                    "filename": "檔名自然排序",
                    "upload": "上傳順序",
                }[v],
                key="xes_bg_order",
            )
            st.caption("分點權重：第 i 張 sample 的 1D 光譜會對應 BG1 與 BG2 光譜之間的位置 w。")

        step_header(3, "影像修正 / I0", skipped=using_preprocessed_spectra)
        if using_preprocessed_spectra:
            st.caption("已處理 1D 光譜模式會跳過 FITS EXPTIME、Dark/Bias、hot pixel 與 transpose；仍可在此套用 I0。")
            normalize_exposure = False
            transpose_image = False
            use_dark_frame = False
            fix_hot_pixels = False
        else:
            exposure_options = [
                _xes_exposure_seconds(img) for img in [first_image, bg1_image, bg2_image] if img is not None
            ]
            normalize_exposure = st.checkbox(
                "以 FITS EXPTIME 正規化（counts/sec）",
                value=bool(exposure_options),
                key="xes_norm_exposure",
            )
            transpose_image = st.checkbox(
                "Transpose array（若影像 row/column 與舊程式相反才啟用）",
                value=False,
                key="xes_transpose_image",
            )
            width, height = (raw_height, raw_width) if transpose_image else (raw_width, raw_height)
            x_roi = (0, max(0, width - 1))
            y_roi = (0, max(0, height - 1))
        i0_mode = st.selectbox(
            "I0(eV) / incident flux 正規化",
            ["none", "global", "table"],
            format_func=lambda v: {
                "none": "不使用 I0(eV)",
                "global": "使用者輸入同一個 I0(eV)",
                "table": "上傳 CSV：每個 sample 對應 I0(eV)",
            }[v],
            key="xes_i0_mode",
        )
        if i0_mode == "global":
            i0_global_value = float(st.number_input(
                "I0(eV) 值", min_value=1e-12, value=1.0, step=1.0,
                format="%.9g", key="xes_i0_global",
            ))
            st.caption("程式會在歸一化前先將光譜強度除以此 I0(eV)。若尚未有 I0 資料請保持不使用。")
        elif i0_mode == "table":
            i0_file = st.file_uploader(
                "I0(eV) CSV（欄位可用 File/Filename/Sample + I0/Flux/Monitor）",
                type=["csv", "xlsx", "xls"],
                accept_multiple_files=False,
                key="xes_i0_table",
            )
            if i0_file is not None:
                i0_table_df, i0_err = _xes_i0_table_from_csv(i0_file)
                if i0_err:
                    st.warning(i0_err)
                elif i0_table_df.empty:
                    st.warning("I0 CSV 沒有可用的正值 I0。")
                else:
                    st.caption(f"已讀取 {len(i0_table_df)} 筆 I0 對照。")
        if not using_preprocessed_spectra:
            use_dark_frame = st.checkbox(
                "進階可選：扣除 Dark/Bias 平均影像",
                value=bool(dark_images),
                disabled=not bool(dark_images),
                key="xes_use_dark",
            )
            if dark_images:
                st.caption(f"已載入 {len(dark_images)} 張 Dark/Bias，套用時會先平均後再扣除。")
            else:
                st.caption("Dark/Bias 是 detector 校正檔，不是 BG1/BG2；教授或儀器沒有提供時請保持關閉。")
            if normalize_exposure and not exposure_options:
                st.warning("目前 FITS header 沒有可辨識的 EXPTIME / EXPOSURE。")
            if normalize_exposure:
                exposure_missing = [
                    name for name, img in image_dict.items() if _xes_exposure_seconds(img) is None
                ]
                if bg1_image is not None and _xes_exposure_seconds(bg1_image) is None:
                    exposure_missing.append("BG1")
                if bg2_image is not None and _xes_exposure_seconds(bg2_image) is None:
                    exposure_missing.append("BG2")
                exposure_missing.extend(
                    f"Dark/Bias:{name}" for name, img in dark_images.items()
                    if _xes_exposure_seconds(img) is None
                )
                if exposure_missing:
                    st.warning("以下 FITS 缺少曝光時間，會保留原始 counts：" + "、".join(exposure_missing))
            fix_hot_pixels = st.checkbox("修正 CCD hot pixels / 單點異常亮點", value=False, key="xes_fix_hot")
            if fix_hot_pixels:
                hot_pixel_threshold = float(st.slider(
                    "hot pixel 門檻", 4.0, 30.0, 8.0, 0.5, key="xes_hot_threshold"
                ))
                hot_pixel_window = int(st.number_input(
                    "局部 median 視窗", min_value=3, max_value=15, value=3, step=2, key="xes_hot_window"
                ))

        step_header(4, "ROI 與積分", skipped=using_preprocessed_spectra)
        if using_preprocessed_spectra:
            st.caption("已處理 1D 光譜已完成 ROI / 積分，這一步自動跳過。")
            projection = "columns"
            reducer = "sum"
            sideband_enabled = False
        else:
            if plane_count > 1:
                plane_index = int(st.number_input(
                    "FITS plane", min_value=0, max_value=plane_count - 1, value=0, step=1, key="xes_plane"
                ))
            else:
                st.caption("FITS plane：0")

            projection = st.selectbox(
                "投影方向",
                ["columns", "rows"],
                format_func=lambda v: {
                    "columns": "沿 Y 加總，輸出 column spectrum",
                    "rows": "沿 X 加總，輸出 row spectrum",
                }[v],
                key="xes_projection",
            )
            reducer = st.selectbox(
                "ROI 積分方式",
                ["sum", "mean"],
                format_func=lambda v: {"sum": "加總", "mean": "平均"}[v],
                key="xes_reducer",
            )
            if width > 1:
                prev_x_roi = st.session_state.get("xes_x_roi", (0, width - 1))
                x0_safe = int(np.clip(min(prev_x_roi), 0, width - 1))
                x1_safe = int(np.clip(max(prev_x_roi), 0, width - 1))
                if x0_safe >= x1_safe:
                    x0_safe, x1_safe = 0, width - 1
                st.session_state["xes_x_roi"] = (x0_safe, x1_safe)
                x_roi = st.slider("X ROI / column", 0, width - 1, (0, width - 1), key="xes_x_roi")
            if height > 1:
                prev_y_roi = st.session_state.get("xes_y_roi", (0, height - 1))
                y0_safe = int(np.clip(min(prev_y_roi), 0, height - 1))
                y1_safe = int(np.clip(max(prev_y_roi), 0, height - 1))
                if y0_safe >= y1_safe:
                    y0_safe, y1_safe = 0, height - 1
                st.session_state["xes_y_roi"] = (y0_safe, y1_safe)
                y_roi = st.slider("Y ROI / row", 0, height - 1, (0, height - 1), key="xes_y_roi")
            sideband_enabled = st.checkbox(
                "進階可選：啟用 side-band background subtraction",
                value=False,
                key="xes_sideband_enabled",
            )
            if sideband_enabled:
                if projection == "columns":
                    band_axis_label = "Y / row"
                    band_max = height - 1
                    signal_band = y_roi
                else:
                    band_axis_label = "X / column"
                    band_max = width - 1
                    signal_band = x_roi
                if band_max <= 0:
                    sideband_enabled = False
                    st.warning("目前影像尺寸太小，無法選擇 side-band ROI。")
                else:
                    default_band_a, default_band_b = _xes_default_sideband_ranges(signal_band, band_max)
                    st.caption("Side-band 是同一張 sample 影像裡 signal ROI 旁邊的背景區，不是 BG1/BG2；教授未要求時建議先不要啟用。")
                    sideband_a = st.slider(
                        f"Side-band A ({band_axis_label})",
                        0, band_max, default_band_a,
                        key="xes_sideband_a",
                    )
                    sideband_b = st.slider(
                        f"Side-band B ({band_axis_label})",
                        0, band_max, default_band_b,
                        key="xes_sideband_b",
                    )
                    sideband_ranges = (sideband_a, sideband_b)
                    sideband_stat = st.selectbox(
                        "Side-band 統計",
                        ["mean", "median"],
                        format_func=lambda v: {"mean": "平均值", "median": "中位數"}[v],
                        key="xes_sideband_stat",
                    )

        step_header(5, "曲率校正 / 影像拉直", skipped=using_preprocessed_spectra)
        if using_preprocessed_spectra:
            st.caption("已處理 1D 光譜代表教授程式已完成曲率/影像拉直；這一步自動跳過。")
            curvature_enabled = False
        else:
            curvature_enabled = st.checkbox(
                "啟用 find curvature → shift image",
                value=False,
                disabled=(projection != "columns"),
                key="xes_curvature_enabled",
            )
            if projection != "columns":
                st.caption("曲率校正目前依舊程式流程支援 column spectrum；若要使用請將投影方向設為 columns。")
                curvature_enabled = False
            if curvature_enabled:
                st.caption("流程：先用目前 row ROI 做 Sum，看主峰位置後設定 fitting column 範圍，再逐 row 找峰中心並拉直影像。")
                if width > 2:
                    prev_curve_range = st.session_state.get(
                        "xes_curvature_x_range", (int(min(x_roi)), int(max(x_roi))),
                    )
                    curve0_safe = int(np.clip(min(prev_curve_range), int(min(x_roi)), int(max(x_roi))))
                    curve1_safe = int(np.clip(max(prev_curve_range), int(min(x_roi)), int(max(x_roi))))
                    if curve1_safe - curve0_safe < 2:
                        curve0_safe, curve1_safe = int(min(x_roi)), int(max(x_roi))
                    st.session_state["xes_curvature_x_range"] = (curve0_safe, curve1_safe)
                    curvature_fit_x_range = st.slider(
                        "曲率 fitting column 範圍",
                        0, width - 1,
                        (int(min(x_roi)), int(max(x_roi))),
                        key="xes_curvature_x_range",
                    )
                curvature_poly_order = int(st.number_input(
                    "polynomial order", min_value=1, max_value=6, value=4, step=1,
                    key="xes_curvature_order",
                ))
                curvature_cutoff = float(st.number_input(
                    "cutoff（弱峰/離群 row 篩選）", min_value=0.1, max_value=20.0,
                    value=1.9, step=0.1, format="%.2f", key="xes_curvature_cutoff",
                ))

        step_header(6, "多檔平均")
        do_average = st.checkbox(
            "對所有 1D 光譜做平均" if using_preprocessed_spectra else "對所有 FITS 投影光譜做平均",
            value=False,
            key="xes_do_avg",
        )
        if do_average:
            show_individual = st.checkbox("疊加顯示個別光譜", value=False, key="xes_show_ind")

        step_header(7, "平滑")
        smooth_method = st.selectbox(
            "方法",
            ["none", "moving_average", "savitzky_golay"],
            format_func=lambda v: {
                "none": "不平滑",
                "moving_average": "移動平均",
                "savitzky_golay": "Savitzky-Golay",
            }[v],
            key="xes_smooth_method",
        )
        if smooth_method != "none":
            smooth_window = int(st.number_input(
                "視窗點數", min_value=3, max_value=301, value=11, step=2, key="xes_smooth_window"
            ))
        if smooth_method == "savitzky_golay":
            smooth_poly_deg = int(st.slider("多項式階數", 2, 5, 3, key="xes_smooth_poly"))

        step_header(8, "歸一化")
        axis_start = float(
            input_axis_start if using_preprocessed_spectra
            else (x_roi[0] if projection == "columns" else y_roi[0])
        )
        axis_end = float(
            input_axis_end if using_preprocessed_spectra
            else (x_roi[1] if projection == "columns" else y_roi[1])
        )
        norm_method = st.selectbox(
            "方法",
            ["none", "max", "min_max", "area"],
            format_func=lambda v: {
                "none": "不歸一化",
                "max": "峰值歸一化（可選區間）",
                "min_max": "Min-Max (0~1)",
                "area": "面積歸一化（總面積 = 1）",
            }[v],
            key="xes_norm_method",
        )
        if norm_method == "max" and axis_end > axis_start:
            norm_step = 1.0 if not using_preprocessed_spectra else max((axis_end - axis_start) / 1000.0, 1e-9)
            prev_norm_range = st.session_state.get("xes_norm_range", (axis_start, axis_end))
            norm_lo = float(max(axis_start, min(float(min(prev_norm_range)), axis_end)))
            norm_hi = float(max(axis_start, min(float(max(prev_norm_range)), axis_end)))
            if norm_lo >= norm_hi:
                norm_lo, norm_hi = axis_start, axis_end
            st.session_state["xes_norm_range"] = (norm_lo, norm_hi)
            norm_range = st.slider(
                "歸一化參考區間 (X)" if using_preprocessed_spectra else "歸一化參考區間 (pixel)",
                min_value=axis_start,
                max_value=axis_end,
                value=(norm_lo, norm_hi),
                step=norm_step,
                format="%.6g" if using_preprocessed_spectra else "%.0f",
                key="xes_norm_range",
            )
            norm_x_start = float(min(norm_range))
            norm_x_end = float(max(norm_range))

        step_header(9, "X 軸校正")
        axis_calibration = st.selectbox(
            "X 軸顯示",
            ["pixel", "linear", "reference_points"],
            format_func=lambda v: {
                "pixel": "輸入檔 X 軸" if using_preprocessed_spectra else "Detector pixel",
                "linear": "線性係數：E = E0 + slope × pixel",
                "reference_points": "參考點擬合 pixel → eV",
            }[v],
            key="xes_axis_calibration",
        )
        if axis_calibration == "linear":
            energy_offset = float(st.number_input(
                "E0 (eV)", value=0.0, step=1.0, format="%.6f", key="xes_energy_offset"
            ))
            energy_slope = float(st.number_input(
                "slope (eV / pixel)", value=1.0, step=0.001, format="%.9f", key="xes_energy_slope"
            ))
        elif axis_calibration == "reference_points":
            cal_degree = int(st.selectbox("擬合階數", [1, 2], format_func=lambda v: "linear" if v == 1 else "quadratic", key="xes_cal_degree"))
            cal_points_file = st.file_uploader(
                "可選：上傳校正點 CSV（Pixel, Energy_eV）",
                type=["csv", "xlsx", "xls"],
                accept_multiple_files=False,
                key="xes_cal_points_csv",
            )
            default_cal_df = pd.DataFrame({
                "Pixel": [np.nan] * (cal_degree + 1),
                "Energy_eV": [np.nan] * (cal_degree + 1),
            })
            if cal_points_file is not None:
                uploaded_cal_df, cal_err = _xes_calibration_points_from_csv(cal_points_file)
                if cal_err:
                    st.warning(cal_err)
                elif uploaded_cal_df.empty:
                    st.warning("校正點 CSV 沒有可用的 pixel / energy 數值。")
                else:
                    default_cal_df = uploaded_cal_df
                    st.caption(f"已從 CSV 讀取 {len(uploaded_cal_df)} 個校正點。")
            cal_df = st.data_editor(
                default_cal_df,
                num_rows="dynamic",
                key="xes_cal_points",
                hide_index=True,
            )
            energy_poly_coeffs = _xes_calibration_coeffs(cal_df, cal_degree)
            if energy_poly_coeffs:
                coeff_text = ", ".join(f"{c:.6g}" for c in energy_poly_coeffs)
                st.caption(f"校正係數 np.polyval 順序：{coeff_text}")
            else:
                st.warning("請至少填入足夠的 pixel / energy 參考點。")

        step_header(10, "峰值偵測")
        run_peak_detection = st.checkbox("啟用峰值偵測", value=False, key="xes_run_peaks")
        if run_peak_detection:
            peak_prom_ratio = float(st.slider(
                "最小顯著度（相對）", 0.0, 1.0, 0.05, 0.01, key="xes_peak_prominence"
            ))
            peak_height_ratio = float(st.slider(
                "最小高度（相對最大值）", 0.0, 1.0, 0.03, 0.01, key="xes_peak_height"
            ))
            peak_distance_max = max(1.0, axis_end - axis_start)
            peak_distance_default = min(5.0, peak_distance_max)
            prev_peak_distance = st.session_state.get("xes_peak_distance", peak_distance_default)
            st.session_state["xes_peak_distance"] = float(np.clip(prev_peak_distance, 1.0, peak_distance_max))
            peak_distance_pixel = float(st.number_input(
                "最小峰距 (X)" if using_preprocessed_spectra else "最小峰距 (pixel)",
                min_value=1.0,
                max_value=peak_distance_max,
                value=peak_distance_default,
                step=1.0,
                format="%.0f",
                key="xes_peak_distance",
            ))
            max_peak_labels = int(st.number_input(
                "最多標記峰數", min_value=1, max_value=50, value=12, step=1, key="xes_peak_max"
            ))
            label_peaks = st.checkbox("標示峰位數值", value=True, key="xes_peak_labels")

        peak_id_enabled = st.checkbox(
            "啟用峰值指認資料庫",
            value=run_peak_detection,
            key="xes_peak_id_enabled",
        )
        if peak_id_enabled:
            if not run_peak_detection:
                st.caption("請同時啟用峰值偵測，系統才有觀測峰可以比對資料庫。")
            peak_id_materials = st.multiselect(
                "樣品 / 參考材料",
                list(XES_REFERENCES.keys()),
                default=["NiO", "Ga2O3", "n-Si"],
                key="xes_peak_id_materials",
            )
            peak_id_tol_ev = float(st.number_input(
                "eV 比對容差",
                min_value=0.01,
                max_value=50.0,
                value=3.0,
                step=0.5,
                format="%.2f",
                key="xes_peak_id_tol_ev",
            ))
            peak_id_tol_pixel = float(st.number_input(
                "pixel 比對容差（僅限自訂 pixel 參考）",
                min_value=0.1,
                max_value=200.0,
                value=5.0,
                step=1.0,
                format="%.1f",
                key="xes_peak_id_tol_pixel",
            ))
            peak_id_only_matched = st.checkbox(
                "只顯示已匹配峰",
                value=False,
                key="xes_peak_id_only_matched",
            )

        step_header(11, "能帶對齊")
        band_align_enabled = st.checkbox(
            "啟用 XES/XAS 能帶對齊",
            value=False,
            key="xes_band_align_enabled",
        )
        if band_align_enabled:
            st.caption("以 XES 測得的 VBM 與 XAS 測得的 CBM 計算 bandgap 與 band offset。")
            band_mat_a = st.text_input("材料 A", value="p-NiO", key="xes_band_mat_a")
            band_mat_b = st.text_input("材料 B", value="n-Ga2O3", key="xes_band_mat_b")
            st.markdown("**材料 A：XES VBM / XAS CBM**")
            band_vbm_a = float(st.number_input("A: VBM from XES (eV)", value=0.0, step=0.01, format="%.6f", key="xes_band_vbm_a"))
            band_cbm_a = float(st.number_input("A: CBM from XAS (eV)", value=3.70, step=0.01, format="%.6f", key="xes_band_cbm_a"))
            band_sigma_vbm_a = float(st.number_input("A: sigma(VBM) (eV)", value=0.0, min_value=0.0, step=0.01, format="%.6f", key="xes_band_sigma_vbm_a"))
            band_sigma_cbm_a = float(st.number_input("A: sigma(CBM) (eV)", value=0.0, min_value=0.0, step=0.01, format="%.6f", key="xes_band_sigma_cbm_a"))
            st.markdown("**材料 B：XES VBM / XAS CBM**")
            band_vbm_b = float(st.number_input("B: VBM from XES (eV)", value=0.0, step=0.01, format="%.6f", key="xes_band_vbm_b"))
            band_cbm_b = float(st.number_input("B: CBM from XAS (eV)", value=4.80, step=0.01, format="%.6f", key="xes_band_cbm_b"))
            band_sigma_vbm_b = float(st.number_input("B: sigma(VBM) (eV)", value=0.0, min_value=0.0, step=0.01, format="%.6f", key="xes_band_sigma_vbm_b"))
            band_sigma_cbm_b = float(st.number_input("B: sigma(CBM) (eV)", value=0.0, min_value=0.0, step=0.01, format="%.6f", key="xes_band_sigma_cbm_b"))

    if bg_method == "interpolated" and bg1_available and bg2_available:
        if using_preprocessed_spectra:
            bg_weights, bg_weight_df, bg_weight_source = _xes_bg_weights_from_names(
                sample_names, bg_order_method,
            )
        else:
            bg_weights, bg_weight_df, bg_weight_source = _xes_bg_weights(
                image_dict, bg1_image, bg2_image, bg_order_method,
            )
        st.caption(f"XES 分點背景扣除使用順序來源：{bg_weight_source}")
        if not bg_weight_df.empty:
            st.dataframe(
                bg_weight_df.round({"Weight_w": 4, "Raw_w": 4}),
                use_container_width=True,
                hide_index=True,
            )
    else:
        bg_weights = {name: 0.5 for name in sample_names}

    if use_dark_frame and dark_images and not using_preprocessed_spectra:
        try:
            dark_frame, dark_summary_df = _xes_average_frame(
                dark_images, plane_index, normalize_exposure, transpose_image,
            )
            st.caption(f"Dark/Bias：已平均 {len(dark_images)} 張影像，並在 BG1/BG2 扣除前先套用。")
        except Exception as exc:
            st.error(f"Dark/Bias frame 準備失敗：{exc}")
            st.stop()

    hot_pixel_notes: list[str] = []
    i0_notes: list[str] = []
    curvature_tables: list[pd.DataFrame] = []
    curvature_notes: list[str] = []

    def _process_xes_image_to_1d(label: str, image, role: str) -> dict:
        raw_arr = _xes_corrected_array(
            image, plane_index, None, None,
            "none", 0.5,
            normalize_exposure=normalize_exposure,
            dark_frame=dark_frame,
            transpose_image=transpose_image,
        )
        image_arr, hot_mask = _xes_fix_hot_pixels(
            raw_arr, fix_hot_pixels,
            threshold=hot_pixel_threshold, window_size=hot_pixel_window,
        )
        curve_df = pd.DataFrame()
        curve_coeffs: list[float] = []
        ref_center = None
        curvature_applied = False
        if curvature_enabled:
            try:
                image_arr, curve_df, curve_coeffs, ref_center = _xes_apply_curvature_correction(
                    image_arr, True, x_roi, y_roi, curvature_fit_x_range,
                    curvature_poly_order, curvature_cutoff,
                )
                if not curve_df.empty:
                    curve_export = curve_df.copy()
                    curve_export.insert(0, "Dataset", label)
                    curvature_tables.append(curve_export)
                curvature_notes.append(
                    f"{label}：fit {int(curve_df['Used_In_Fit'].sum())}/{len(curve_df)} rows，"
                    f"ref={ref_center:.2f}"
                )
                curvature_applied = True
            except Exception as exc:
                curvature_notes.append(f"{label}：曲率校正失敗，使用未拉直影像（{exc}）")

        x_vals, y_vals, signal_vals, side_bg_vals, _ = _extract_xes_spectrum_with_sideband(
            image_arr, x_roi, y_roi, projection, reducer,
            sideband_enabled=sideband_enabled,
            sideband_ranges=sideband_ranges,
            sideband_stat=sideband_stat,
        )

        if fix_hot_pixels:
            hot_pixel_notes.append(f"{label}：修正 {int(np.count_nonzero(hot_mask))} 點")

        return {
            "label": label,
            "role": role,
            "image": image_arr,
            "hot_mask": hot_mask,
            "curve_df": curve_df,
            "curve_coeffs": curve_coeffs,
            "reference_center": ref_center,
            "curvature_applied": curvature_applied,
            "x": x_vals,
            "raw_y": y_vals,
            "signal": signal_vals,
            "side_bg": side_bg_vals,
        }

    processed_fits: dict[str, dict] = {}
    bg1_result = None
    bg2_result = None
    try:
        if using_preprocessed_spectra:
            if bg1_spectrum_data is not None:
                bg1_result = _xes_spectrum_result("BG1", bg1_spectrum_data[0], bg1_spectrum_data[1], "bg1")
                processed_fits["BG1"] = bg1_result
            for fname, (x_vals, y_vals) in spectrum_dict.items():
                processed_fits[fname] = _xes_spectrum_result(fname, x_vals, y_vals, "sample")
            if bg2_spectrum_data is not None:
                bg2_result = _xes_spectrum_result("BG2", bg2_spectrum_data[0], bg2_spectrum_data[1], "bg2")
                processed_fits["BG2"] = bg2_result
        else:
            if bg1_image is not None:
                bg1_result = _process_xes_image_to_1d("BG1", bg1_image, "bg1")
                processed_fits["BG1"] = bg1_result
            for fname, image in image_dict.items():
                processed_fits[fname] = _process_xes_image_to_1d(fname, image, "sample")
            if bg2_image is not None:
                bg2_result = _process_xes_image_to_1d("BG2", bg2_image, "bg2")
                processed_fits["BG2"] = bg2_result
    except Exception as exc:
        st.error(f"XES 轉 1D 光譜失敗：{exc}")
        st.stop()

    preview_options = list(processed_fits.keys())
    preview_label = st.selectbox(
        "逐檔預覽：選擇要查看的資料",
        preview_options,
        index=preview_options.index(first_name) if first_name in preview_options else 0,
        key="xes_preview_file",
    )
    preview_result = processed_fits[preview_label]
    preview = preview_result["image"]
    preview_hot_mask = preview_result["hot_mask"]
    preview_curve_df = preview_result["curve_df"]
    preview_curvature_coeffs = preview_result["curve_coeffs"]
    preview_reference_center = preview_result["reference_center"]

    image_intensity_title = "Intensity" if using_preprocessed_spectra else (
        "Counts / s" if normalize_exposure else "Counts"
    )
    intensity_title = image_intensity_title
    if i0_mode != "none":
        intensity_title += " / I0"
    use_energy_axis = (
        axis_calibration == "linear"
        or (axis_calibration == "reference_points" and bool(energy_poly_coeffs))
    )
    axis_title = "Emission Energy (eV)" if use_energy_axis else (
        "Input X" if using_preprocessed_spectra else (
            "Detector column (pixel)" if projection == "columns" else "Detector row (pixel)"
        )
    )

    if using_preprocessed_spectra:
        finite_y = preview_result["raw_y"][np.isfinite(preview_result["raw_y"])]
        c1, c2, c3 = st.columns(3)
        c1.metric("資料點數", f"{len(preview_result['x'])}")
        c2.metric("X 範圍", f"{float(np.nanmin(preview_result['x'])):.4g} ~ {float(np.nanmax(preview_result['x'])):.4g}")
        c3.metric("最大強度", f"{float(np.nanmax(finite_y)):.4g}" if len(finite_y) else "n/a")
        st.caption("目前使用已處理 1D 光譜模式：已跳過 FITS heatmap、ROI、side-band 與曲率校正 preview。")
    else:
        finite_preview = preview[np.isfinite(preview)]
        if len(finite_preview):
            c1, c2, c3, c4, c5 = st.columns(5)
            c1.metric("影像尺寸", f"{width} × {height}")
            c2.metric("Plane", f"{plane_index + 1} / {plane_count}")
            c3.metric("最大值", f"{float(np.nanmax(finite_preview)):.3g}")
            c4.metric("修正熱點", f"{int(np.count_nonzero(preview_hot_mask))}")
            c5.metric("曲率校正", "ON" if curvature_enabled and not preview_curve_df.empty else "OFF")

        fig_img = go.Figure()
        fig_img.add_trace(go.Heatmap(
            z=preview,
            colorscale="Viridis",
            colorbar=dict(title=image_intensity_title),
            hovertemplate="x=%{x}<br>y=%{y}<br>counts=%{z}<extra></extra>",
        ))
        fig_img.add_shape(
            type="rect",
            x0=x_roi[0] - 0.5,
            x1=x_roi[1] + 0.5,
            y0=y_roi[0] - 0.5,
            y1=y_roi[1] + 0.5,
            line=dict(color="#FFD166", width=2),
        )
        if sideband_enabled and sideband_ranges:
            for band_range in sideband_ranges:
                if projection == "columns":
                    x0_shape, x1_shape = x_roi[0] - 0.5, x_roi[1] + 0.5
                    y0_shape, y1_shape = min(band_range) - 0.5, max(band_range) + 0.5
                else:
                    x0_shape, x1_shape = min(band_range) - 0.5, max(band_range) + 0.5
                    y0_shape, y1_shape = y_roi[0] - 0.5, y_roi[1] + 0.5
                fig_img.add_shape(
                    type="rect",
                    x0=x0_shape,
                    x1=x1_shape,
                    y0=y0_shape,
                    y1=y1_shape,
                    line=dict(color="#19D3F3", width=1.5, dash="dash"),
                )
        if curvature_enabled:
            fig_img.add_shape(
                type="rect",
                x0=curvature_fit_x_range[0] - 0.5,
                x1=curvature_fit_x_range[1] + 0.5,
                y0=y_roi[0] - 0.5,
                y1=y_roi[1] + 0.5,
                line=dict(color="#FF6692", width=1.5, dash="dot"),
            )
        fig_img.update_layout(
            title=(
                f"FITS preview: {preview_label}（影像修正後 / BG1-BG2 扣除前）"
                + ("（已曲率校正）" if curvature_enabled and not preview_curve_df.empty else "")
            ),
            xaxis_title="Column pixel",
            yaxis_title="Row pixel",
            yaxis=dict(autorange="reversed"),
            template="plotly_dark",
            height=460,
            margin=dict(l=50, r=20, t=60, b=50),
        )
        st.plotly_chart(fig_img, use_container_width=True)

    fig_raw = go.Figure()
    fig_norm = go.Figure()
    export_frames: dict[str, pd.DataFrame] = {}
    peak_tables: list[pd.DataFrame] = []
    i0_notes: list[str] = []

    fig_pre_bg = go.Figure()
    for i, (label, result) in enumerate(processed_fits.items()):
        pre_x = result["x"]
        pre_axis = (
            _xes_apply_axis_calibration(pre_x, axis_calibration, energy_offset, energy_slope, energy_poly_coeffs)
            if use_energy_axis else pre_x
        )
        role = result["role"]
        if role == "bg1":
            color = "#19D3F3"
            dash = "dash"
            role_label = "BG1"
        elif role == "bg2":
            color = "#FFA15A"
            dash = "dash"
            role_label = "BG2"
        else:
            color = XES_COLORS[i % len(XES_COLORS)]
            dash = "solid"
            role_label = "Sample"
        fig_pre_bg.add_trace(go.Scatter(
            x=pre_axis,
            y=result["raw_y"],
            mode="lines",
            name=f"{label}（{role_label}，扣 BG 前）",
            line=dict(color=color, width=1.8, dash=dash),
            opacity=0.85 if role == "sample" else 0.7,
        ))

    pre_bg_y_title = "Intensity" if using_preprocessed_spectra else (
        "Counts / s" if normalize_exposure else "Counts"
    )
    if sideband_enabled:
        pre_bg_y_title += "（side-band 後）"
    fig_pre_bg.update_layout(
        title="背景扣除前：逐檔 1D 光譜",
        xaxis_title=axis_title,
        yaxis_title=pre_bg_y_title,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        template="plotly_dark",
        height=400,
        margin=dict(l=50, r=20, t=60, b=50),
    )
    if using_preprocessed_spectra:
        st.caption("這張圖會先顯示你上傳的 BG1、sample、BG2 已處理 1D 光譜；此時尚未做 BG1/BG2 分點扣除。")
    else:
        st.caption("這張圖會先顯示 BG1、每張 sample、BG2 各自完成影像修正、ROI/曲率投影後的 1D 光譜；此時尚未做 BG1/BG2 分點扣除。")
    st.plotly_chart(fig_pre_bg, use_container_width=True)

    bg1_spectrum = (bg1_result["x"], bg1_result["raw_y"]) if bg1_result is not None else None
    bg2_spectrum = (bg2_result["x"], bg2_result["raw_y"]) if bg2_result is not None else None

    extracted = {}
    for fname in sample_names:
        try:
            result = processed_fits[fname]
            x_vals = result["x"]
            raw_y = result["raw_y"]
            bg_curve = _xes_spectrum_background_curve(
                x_vals,
                bg1_spectrum,
                bg2_spectrum,
                bg_method,
                bg_weights.get(fname, 0.5),
            )
            y_vals = np.nan_to_num(raw_y - bg_curve, nan=0.0)
            signal_vals = result["signal"]
            side_bg_vals = result["side_bg"]
            i0_value = _xes_lookup_i0_value(fname, i0_mode, i0_global_value, i0_table_df)
            if i0_mode != "none":
                if i0_value is None:
                    i0_notes.append(f"{fname}：未找到 I0，保留原值")
                else:
                    y_vals, raw_y, bg_curve, signal_vals, side_bg_vals = _xes_apply_i0_to_spectra(
                        (y_vals, raw_y, bg_curve, signal_vals, side_bg_vals), i0_value,
                    )
                    i0_notes.append(f"{fname}：I0={i0_value:.6g}")
            extracted[fname] = (
                x_vals,
                y_vals,
                signal_vals,
                side_bg_vals,
                i0_value,
                result["curvature_applied"],
                raw_y,
                bg_curve,
            )
        except Exception as exc:
            st.warning(f"{fname}：1D BG1/BG2 扣除失敗，已跳過。{exc}")

    if hot_pixel_notes:
        st.caption("Hot pixel 修正摘要：" + "；".join(hot_pixel_notes))
    if i0_notes:
        st.caption("I0 正規化摘要：" + "；".join(i0_notes))
    if curvature_notes:
        st.caption("曲率校正摘要：" + "；".join(curvature_notes))

    if do_average:
        average_records = []
        for fname, (
            x_vals,
            y_vals,
            signal_vals,
            side_bg_vals,
            i0_value,
            curvature_applied,
            raw_y,
            bg_curve,
        ) in extracted.items():
            coord_axis = (
                _xes_apply_axis_calibration(x_vals, axis_calibration, energy_offset, energy_slope, energy_poly_coeffs)
                if use_energy_axis else x_vals
            )
            clean_coord, _ = _xes_sorted_finite_xy(coord_axis, y_vals)
            if len(clean_coord) >= 2:
                average_records.append({
                    "name": fname,
                    "pixel": x_vals,
                    "coord": coord_axis,
                    "y": y_vals,
                    "signal": signal_vals,
                    "side_bg": side_bg_vals,
                    "raw_y": raw_y,
                    "bg_curve": bg_curve,
                    "i0": i0_value,
                    "curvature_applied": curvature_applied,
                })

        ranges = [
            (float(np.nanmin(rec["coord"])), float(np.nanmax(rec["coord"])))
            for rec in average_records
        ]
        if not ranges:
            st.warning("沒有足夠資料可平均。")
        else:
            avg_start = max(r[0] for r in ranges)
            avg_end = min(r[1] for r in ranges)
            if avg_start >= avg_end:
                overlap_unit = "energy" if use_energy_axis else (
                    "input X" if using_preprocessed_spectra else "pixel"
                )
                st.warning(f"多檔平均需要共同 {overlap_unit} 範圍，目前沒有重疊區間。")
            else:
                if use_energy_axis:
                    point_count = min(len(_xes_sorted_finite_xy(rec["coord"], rec["y"])[0]) for rec in average_records)
                    point_count = int(np.clip(point_count, 2, 20000))
                    new_axis = np.linspace(avg_start, avg_end, point_count, dtype=float)
                    first_coord, first_pixel = _xes_sorted_finite_xy(
                        average_records[0]["coord"], average_records[0]["pixel"],
                    )
                    new_x = np.interp(new_axis, first_coord, first_pixel)
                    interp_axis_label = "energy"
                    st.caption(f"多檔平均：已先將各檔轉成 energy，再插值到共同 energy grid（{point_count} 點）。")
                else:
                    if using_preprocessed_spectra:
                        point_count = min(len(_xes_sorted_finite_xy(rec["coord"], rec["y"])[0]) for rec in average_records)
                        point_count = int(np.clip(point_count, 2, 20000))
                        new_x = np.linspace(avg_start, avg_end, point_count, dtype=float)
                        interp_axis_label = "input_x"
                    else:
                        new_x = np.arange(int(math.ceil(avg_start)), int(math.floor(avg_end)) + 1, dtype=float)
                        interp_axis_label = "pixel"
                    new_axis = new_x
                all_interp = []
                all_signal_interp = []
                all_side_bg_interp = []
                all_raw_interp = []
                all_bg_interp = []
                for i, rec in enumerate(average_records):
                    fname = rec["name"]
                    target_axis = new_axis if use_energy_axis else new_x
                    source_axis = rec["coord"] if use_energy_axis else rec["pixel"]
                    interp_y = _xes_interp_to_axis(source_axis, rec["y"], target_axis)
                    interp_signal = _xes_interp_to_axis(source_axis, rec["signal"], target_axis)
                    interp_side_bg = _xes_interp_to_axis(source_axis, rec["side_bg"], target_axis)
                    interp_raw = _xes_interp_to_axis(source_axis, rec["raw_y"], target_axis)
                    interp_bg = _xes_interp_to_axis(source_axis, rec["bg_curve"], target_axis)
                    if not np.all(np.isfinite(interp_y)):
                        continue
                    all_interp.append(interp_y)
                    all_signal_interp.append(interp_signal)
                    all_side_bg_interp.append(interp_side_bg)
                    all_raw_interp.append(interp_raw)
                    all_bg_interp.append(interp_bg)
                    if show_individual:
                        fig_raw.add_trace(go.Scatter(
                            x=new_axis, y=interp_y, mode="lines", name=fname,
                            line=dict(color=XES_COLORS[i % len(XES_COLORS)], width=1, dash="dot"),
                            opacity=0.35,
                        ))

                if all_interp:
                    raw_signal = np.mean(np.vstack(all_interp), axis=0)
                    avg_signal_roi = np.mean(np.vstack(all_signal_interp), axis=0)
                    avg_side_bg = np.mean(np.vstack(all_side_bg_interp), axis=0)
                    avg_before_bg = np.mean(np.vstack(all_raw_interp), axis=0)
                    avg_bg_curve = np.mean(np.vstack(all_bg_interp), axis=0)
                    if sideband_enabled and bg_method != "none":
                        raw_label = "Average（side-band + 1D BG 扣除後）"
                    elif sideband_enabled:
                        raw_label = "Average（side-band 扣除後）"
                    elif bg_method != "none":
                        raw_label = "Average（1D BG 扣除後）"
                    elif using_preprocessed_spectra:
                        raw_label = "Average（已處理 1D）"
                    elif dark_frame is not None or curvature_enabled or fix_hot_pixels or normalize_exposure:
                        raw_label = "Average（影像處理後）"
                    else:
                        raw_label = "Average（原始）"
                    smooth_signal_vals = smooth_signal(
                        raw_signal, smooth_method,
                        window_points=smooth_window, poly_deg=smooth_poly_deg,
                    )
                    final_signal = apply_normalization(
                        new_x, smooth_signal_vals, norm_method,
                        norm_x_start=norm_x_start, norm_x_end=norm_x_end,
                    )
                    plot_signal = final_signal if norm_method != "none" else smooth_signal_vals

                    if smooth_method != "none":
                        fig_raw.add_trace(go.Scatter(
                            x=new_axis, y=raw_signal, mode="lines", name=raw_label,
                            line=dict(color="white", width=1.4, dash="dash"), opacity=0.55,
                        ))
                    fig_raw.add_trace(go.Scatter(
                        x=new_axis, y=smooth_signal_vals, mode="lines",
                        name="Average（平滑後）" if smooth_method != "none" else raw_label,
                        line=dict(color="#EF553B", width=2.4),
                    ))
                    if norm_method != "none":
                        fig_norm.add_trace(go.Scatter(
                            x=new_axis, y=final_signal, mode="lines", name="Average（歸一化後）",
                            line=dict(color="#EF553B", width=2.4),
                        ))

                    peak_signal = plot_signal
                    if run_peak_detection:
                        peak_idx = detect_spectrum_peaks(
                            new_x, peak_signal, peak_prom_ratio,
                            peak_height_ratio, peak_distance_pixel, max_peak_labels,
                        )
                        peak_table = build_xes_peak_table(
                            "Average", new_x, peak_signal, peak_idx,
                            energy_x=new_axis if use_energy_axis else None,
                        )
                        if not peak_table.empty:
                            peak_tables.append(peak_table)
                            target_fig = fig_norm if norm_method != "none" else fig_raw
                            peak_x_vals = peak_table["Energy_eV"] if use_energy_axis else peak_table["Pixel"]
                            peak_labels = (
                                [f"{v:.2f}" for v in peak_table["Energy_eV"]]
                                if use_energy_axis else [f"{v:.0f}" for v in peak_table["Pixel"]]
                            )
                            target_fig.add_trace(go.Scatter(
                                x=peak_x_vals,
                                y=peak_table["Intensity"],
                                mode="markers+text" if label_peaks else "markers",
                                name="Average 峰位",
                                text=peak_labels if label_peaks else None,
                                textposition="top center",
                                textfont=dict(size=10),
                                marker=dict(color="#FFD166", size=10, symbol="x"),
                            ))

                    row = {
                        "Pixel": new_x,
                        "Average_grid": np.full(new_x.shape, interp_axis_label, dtype=object),
                        "Average_intensity": raw_signal,
                        "Average_smoothed": smooth_signal_vals,
                    }
                    if bg_method != "none":
                        row["Average_before_BG1BG2"] = avg_before_bg
                        row["Average_BG1BG2_background"] = avg_bg_curve
                    if sideband_enabled:
                        row["Average_signal_roi_projection"] = avg_signal_roi
                        row["Average_sideband_background_scaled"] = avg_side_bg
                    if curvature_enabled:
                        used_curvature = [rec["curvature_applied"] for rec in average_records]
                        row["Curvature_corrected_fraction"] = np.full(
                            new_x.shape, float(np.mean(used_curvature)) if used_curvature else 0.0,
                            dtype=float,
                        )
                    if transpose_image:
                        row["Transposed"] = np.full(new_x.shape, True, dtype=bool)
                    if use_energy_axis:
                        row["Energy_eV"] = new_axis
                    if bg_method == "interpolated":
                        used_weights = [bg_weights.get(fname, np.nan) for fname in extracted]
                        row["Background_weight_w_mean"] = np.full_like(
                            new_x, float(np.nanmean(used_weights)), dtype=float
                        )
                    if i0_mode != "none":
                        used_i0 = [rec["i0"] for rec in average_records if rec["i0"] is not None]
                        row["I0_mean"] = np.full_like(
                            new_x, float(np.nanmean(used_i0)) if used_i0 else np.nan, dtype=float
                        )
                    if norm_method != "none":
                        row["Average_normalized"] = final_signal
                    export_frames["Average"] = pd.DataFrame(row)
    else:
        for i, (
            fname,
            (
                x_vals,
                y_vals,
                signal_vals,
                side_bg_vals,
                i0_value,
                curvature_applied,
                raw_y,
                bg_curve,
            ),
        ) in enumerate(extracted.items()):
            color = XES_COLORS[i % len(XES_COLORS)]
            x_axis = _xes_apply_axis_calibration(
                x_vals, axis_calibration, energy_offset, energy_slope, energy_poly_coeffs
            )
            smooth_signal_vals = smooth_signal(
                y_vals, smooth_method,
                window_points=smooth_window, poly_deg=smooth_poly_deg,
            )
            final_signal = apply_normalization(
                x_vals, smooth_signal_vals, norm_method,
                norm_x_start=norm_x_start, norm_x_end=norm_x_end,
            )
            plot_signal = final_signal if norm_method != "none" else smooth_signal_vals

            if smooth_method != "none":
                fig_raw.add_trace(go.Scatter(
                    x=x_axis, y=y_vals, mode="lines",
                    name=f"{fname}（side-band + 1D BG 扣除後）" if sideband_enabled and bg_method != "none" else (
                        f"{fname}（side-band 扣除後）" if sideband_enabled else (
                            f"{fname}（1D BG 扣除後）" if bg_method != "none" else (
                                f"{fname}（已處理 1D）" if using_preprocessed_spectra else (
                                    f"{fname}（影像處理後）" if dark_frame is not None or curvature_enabled or fix_hot_pixels or normalize_exposure else f"{fname}（原始）"
                                )
                            )
                        )
                    ),
                    line=dict(color=color, width=1.3, dash="dash"), opacity=0.45,
                ))
            fig_raw.add_trace(go.Scatter(
                x=x_axis, y=smooth_signal_vals, mode="lines",
                name=f"{fname}（平滑後）" if smooth_method != "none" else (
                    f"{fname}（side-band + 1D BG 扣除後）" if sideband_enabled and bg_method != "none" else (
                        f"{fname}（side-band 扣除後）" if sideband_enabled else (
                            f"{fname}（1D BG 扣除後）" if bg_method != "none" else (
                                f"{fname}（已處理 1D）" if using_preprocessed_spectra else (
                                    f"{fname}（影像處理後）" if dark_frame is not None or curvature_enabled or fix_hot_pixels or normalize_exposure else fname
                                )
                            )
                        )
                    )
                ),
                line=dict(color=color, width=2),
            ))

            if norm_method != "none":
                fig_norm.add_trace(go.Scatter(
                    x=x_axis, y=final_signal, mode="lines", name=f"{fname}（歸一化後）",
                    line=dict(color=color, width=2),
                ))

            if run_peak_detection:
                peak_idx = detect_spectrum_peaks(
                    x_vals, plot_signal, peak_prom_ratio,
                    peak_height_ratio, peak_distance_pixel, max_peak_labels,
                )
                peak_table = build_xes_peak_table(
                    fname, x_vals, plot_signal, peak_idx,
                    energy_x=x_axis if use_energy_axis else None,
                )
                if not peak_table.empty:
                    peak_tables.append(peak_table)
                    target_fig = fig_norm if norm_method != "none" else fig_raw
                    peak_x_vals = peak_table["Energy_eV"] if use_energy_axis else peak_table["Pixel"]
                    peak_labels = (
                        [f"{v:.2f}" for v in peak_table["Energy_eV"]]
                        if use_energy_axis else [f"{v:.0f}" for v in peak_table["Pixel"]]
                    )
                    target_fig.add_trace(go.Scatter(
                        x=peak_x_vals,
                        y=peak_table["Intensity"],
                        mode="markers+text" if label_peaks else "markers",
                        name=f"{fname} 峰位",
                        text=peak_labels if label_peaks else None,
                        textposition="top center",
                        textfont=dict(size=10),
                        marker=dict(color=color, size=9, symbol="x"),
                    ))

            row = {
                "Pixel": x_vals,
                "Intensity": y_vals,
                "Intensity_smoothed": smooth_signal_vals,
            }
            if bg_method != "none":
                row["Intensity_before_BG1BG2"] = raw_y
                row["BG1BG2_background"] = bg_curve
            if sideband_enabled:
                row["Signal_ROI_projection"] = signal_vals
                row["Sideband_background_scaled"] = side_bg_vals
            if curvature_enabled:
                row["Curvature_corrected"] = np.full(x_vals.shape, curvature_applied, dtype=bool)
            if transpose_image:
                row["Transposed"] = np.full(x_vals.shape, True, dtype=bool)
            if use_energy_axis:
                row["Energy_eV"] = x_axis
            if bg_method == "interpolated":
                row["Background_weight_w"] = np.full_like(x_vals, bg_weights.get(fname, np.nan), dtype=float)
            if i0_mode != "none":
                row["I0"] = np.full_like(x_vals, i0_value if i0_value is not None else np.nan, dtype=float)
            if norm_method != "none":
                row["Intensity_normalized"] = final_signal
            export_frames[fname] = pd.DataFrame(row)

    fig_raw.update_layout(
        title="XES 1D 光譜（BG1/BG2 扣除後）" if bg_method != "none" else "XES 1D 光譜",
        xaxis_title=axis_title,
        yaxis_title=intensity_title,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        template="plotly_dark",
        height=460,
        margin=dict(l=50, r=20, t=60, b=50),
    )
    st.plotly_chart(fig_raw, use_container_width=True)

    if norm_method != "none":
        fig_norm.update_layout(
            xaxis_title=axis_title,
            yaxis_title="Normalized intensity",
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            template="plotly_dark",
            height=400,
            margin=dict(l=50, r=20, t=40, b=50),
        )
        st.plotly_chart(fig_norm, use_container_width=True)

    peak_export_df = pd.concat(peak_tables, ignore_index=True) if peak_tables else pd.DataFrame()
    if run_peak_detection:
        if peak_export_df.empty:
            st.info("目前條件下未偵測到 XES 峰值。")
        else:
            st.subheader("峰值列表")
            st.dataframe(
                peak_export_df.copy().round({
                    "Pixel": 3,
                    "Energy_eV": 4,
                    "Intensity": 4,
                    "Relative_Intensity_pct": 2,
                    "FWHM_pixel": 3,
                    "FWHM_eV": 4,
                }),
                use_container_width=True,
                hide_index=True,
            )

    xes_reference_df = pd.DataFrame()
    xes_reference_match_df = pd.DataFrame()
    if peak_id_enabled:
        xes_reference_df = build_xes_reference_df(peak_id_materials)
        st.subheader("XES 峰值指認資料庫")
        if not use_energy_axis:
            st.warning(
                "目前 X 軸仍是 pixel；內建 NiO / Ga2O3 / n-Si 資料庫主要以 eV 比對。"
                "請先在「X 軸校正」把 pixel 轉成 eV，或在資料庫中加入你們實驗的 Reference_Pixel。"
            )
        if xes_reference_df.empty:
            st.info("目前沒有可用的 XES 參考峰。")
        else:
            ref_round = {"Reference_Energy_eV": 3, "Tolerance_eV": 3, "Reference_Pixel": 3, "Tolerance_Pixel": 3}
            st.caption("內建資料庫為快速初判；正式報告請用同一束線/同一量測條件的標準品校正。")
            st.dataframe(
                xes_reference_df.round({k: v for k, v in ref_round.items() if k in xes_reference_df.columns}),
                use_container_width=True,
                hide_index=True,
            )
        if peak_export_df.empty:
            st.info("尚無偵測峰可指認；請先啟用峰值偵測並調整 prominence / peak distance。")
        elif not xes_reference_df.empty:
            xes_reference_match_df = match_xes_reference_peaks(
                peak_export_df,
                xes_reference_df,
                peak_id_tol_ev,
                peak_id_tol_pixel,
                use_energy_axis,
            )
            match_display = xes_reference_match_df
            if peak_id_only_matched and not match_display.empty:
                match_display = match_display[match_display["Matched"]]
            if match_display.empty:
                st.info("目前容差下沒有匹配到資料庫參考峰。")
            else:
                st.subheader("峰值指認結果")
                st.dataframe(
                    match_display.round({
                        "Observed_Position": 4,
                        "Observed_Intensity": 4,
                        "Reference_Position": 4,
                        "Delta": 4,
                        "Tolerance": 4,
                    }),
                    use_container_width=True,
                    hide_index=True,
                )

    band_alignment_df = pd.DataFrame()
    band_alignment_metrics: dict[str, float] = {}
    if band_align_enabled:
        band_alignment_df, band_alignment_metrics = _xes_band_alignment_summary(
            band_mat_a,
            band_mat_b,
            band_vbm_a,
            band_cbm_a,
            band_vbm_b,
            band_cbm_b,
            band_sigma_vbm_a,
            band_sigma_cbm_a,
            band_sigma_vbm_b,
            band_sigma_cbm_b,
        )
        st.subheader("能帶對齊（Band Alignment）")
        metric_cols = st.columns(4)
        metric_cols[0].metric(f"Eg ({band_mat_a})", f"{band_alignment_metrics['eg_a']:.3f} eV")
        metric_cols[1].metric(f"Eg ({band_mat_b})", f"{band_alignment_metrics['eg_b']:.3f} eV")
        metric_cols[2].metric("Delta EV", f"{band_alignment_metrics['delta_ev']:+.3f} eV")
        metric_cols[3].metric("Delta EC", f"{band_alignment_metrics['delta_ec']:+.3f} eV")
        if band_alignment_metrics["eg_a"] <= 0 or band_alignment_metrics["eg_b"] <= 0:
            st.warning("CBM 必須高於 VBM 才會得到正的 bandgap；請確認輸入的能量基準一致。")
        st.plotly_chart(
            _xes_band_alignment_figure(band_mat_a, band_mat_b, band_vbm_a, band_cbm_a, band_vbm_b, band_cbm_b),
            use_container_width=True,
        )
        st.dataframe(
            band_alignment_df.round({"Value_eV": 6, "Sigma_eV": 6}),
            use_container_width=True,
            hide_index=True,
        )

    if not using_preprocessed_spectra:
        with st.expander("FITS header 摘要"):
            header_rows = []
            for key in ("SIMPLE", "BITPIX", "NAXIS", "NAXIS1", "NAXIS2", "BSCALE", "BZERO", "EXPTIME", "DATE-OBS", "TIME-OBS", "MJD-OBS"):
                if key in first_image.header:
                    header_rows.append({"Keyword": key, "Value": first_image.header[key]})
            st.dataframe(pd.DataFrame(header_rows), use_container_width=True, hide_index=True)

    if use_dark_frame and not dark_summary_df.empty:
        with st.expander("Dark/Bias frame 摘要"):
            st.dataframe(
                dark_summary_df.round({"Exposure_s": 4, "Mean": 4, "Median": 4}),
                use_container_width=True,
                hide_index=True,
            )

    curvature_export_df = pd.concat(curvature_tables, ignore_index=True) if curvature_tables else pd.DataFrame()
    if curvature_enabled and not using_preprocessed_spectra:
        with st.expander("曲率校正 / image straightening 摘要"):
            if preview_curve_df.empty:
                st.info("目前沒有可顯示的曲率校正結果。")
            else:
                coeff_text = ", ".join(f"{c:.6g}" for c in preview_curvature_coeffs)
                st.caption(
                    f"Preview polynomial coefficients（np.polyval 順序）：{coeff_text}；"
                    f"reference column = {preview_reference_center:.3f}"
                )
                fig_curve = go.Figure()
                accepted_df = preview_curve_df[preview_curve_df["Accepted"]]
                used_df = preview_curve_df[preview_curve_df["Used_In_Fit"]]
                fig_curve.add_trace(go.Scatter(
                    x=accepted_df["Peak_Center_Column"],
                    y=accepted_df["Row"],
                    mode="markers",
                    name="detected center",
                    marker=dict(color="#FFD166", size=6),
                ))
                fig_curve.add_trace(go.Scatter(
                    x=used_df["Fitted_Center_Column"],
                    y=used_df["Row"],
                    mode="lines",
                    name="polynomial fit",
                    line=dict(color="#FF6692", width=2),
                ))
                fig_curve.update_layout(
                    xaxis_title="Peak center column",
                    yaxis_title="Row",
                    yaxis=dict(autorange="reversed"),
                    template="plotly_dark",
                    height=320,
                    margin=dict(l=50, r=20, t=30, b=50),
                )
                st.plotly_chart(fig_curve, use_container_width=True)
                st.dataframe(
                    preview_curve_df.round({
                        "Peak_Center_Column": 3,
                        "Peak_Height": 3,
                        "SNR": 3,
                        "Fitted_Center_Column": 3,
                        "Shift_Column": 3,
                    }),
                    use_container_width=True,
                    hide_index=True,
                )

    # ── 處理前後比較 ─────────────────────────────────────────────────────────────
    if export_frames:
        with st.expander("處理前後比較 / Baseline Preview", expanded=False):
            frame_names = list(export_frames.keys())
            cmp_dataset = st.selectbox(
                "選擇資料集",
                frame_names,
                key="xes_compare_dataset",
            )
            cmp_df = export_frames.get(cmp_dataset, pd.DataFrame())
            x_col = "Energy_eV" if "Energy_eV" in cmp_df.columns else "Pixel"
            signal_cols = [c for c in cmp_df.columns if c not in (x_col, "Average_grid",
                "Curvature_corrected", "Transposed", "Background_weight_w",
                "Background_weight_w_mean", "I0", "I0_mean",
                "Signal_ROI_projection", "Sideband_background_scaled",
                "Average_signal_roi_projection", "Average_sideband_background_scaled",
                "Curvature_corrected_fraction")]
            default_cols = _xes_default_compare_columns(signal_cols)
            cmp_cols = st.multiselect(
                "比較欄位",
                signal_cols,
                default=default_cols,
                format_func=_xes_column_display_name,
                key="xes_compare_cols",
            )
            if cmp_cols and not cmp_df.empty and x_col in cmp_df.columns:
                x_vals_cmp = cmp_df[x_col].to_numpy(dtype=float)
                fig_cmp = go.Figure()
                cmp_colors = ["#636EFA", "#EF553B", "#00CC96", "#AB63FA",
                              "#FFA15A", "#19D3F3", "#FF6692", "#B6E880"]
                for ci, col_name in enumerate(cmp_cols):
                    if col_name in cmp_df.columns:
                        y_vals_cmp = cmp_df[col_name].to_numpy(dtype=float)
                        is_bg = "background" in col_name.lower() or "BG" in col_name
                        fig_cmp.add_trace(go.Scatter(
                            x=x_vals_cmp, y=y_vals_cmp,
                            mode="lines",
                            name=_xes_column_display_name(col_name),
                            line=dict(
                                color=cmp_colors[ci % len(cmp_colors)],
                                width=1.5,
                                dash="dot" if is_bg else "solid",
                            ),
                        ))
                fig_cmp.update_layout(
                    xaxis_title="Energy (eV)" if x_col == "Energy_eV" else "Pixel",
                    yaxis_title="Intensity",
                    template="plotly_dark",
                    height=380,
                    margin=dict(l=50, r=20, t=30, b=50),
                    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                )
                st.plotly_chart(fig_cmp, use_container_width=True)

    # ── QC 摘要 ──────────────────────────────────────────────────────────────────
    qc_rows: list[dict] = []
    for ds_name, ds_df in export_frames.items():
        x_col_q = "Energy_eV" if "Energy_eV" in ds_df.columns else "Pixel"
        sig_col = next(
            (c for c in ("Intensity_smoothed", "Average_smoothed", "Intensity", "Average_intensity")
             if c in ds_df.columns),
            None,
        )
        qc_row: dict = {"資料集": ds_name}
        if sig_col and x_col_q in ds_df.columns:
            yq = ds_df[sig_col].to_numpy(dtype=float)
            finite_y = yq[np.isfinite(yq)]
            if finite_y.size > 0:
                peak_val = float(np.nanmax(finite_y))
                med = float(np.nanmedian(finite_y))
                mad = float(np.nanmedian(np.abs(finite_y - med)))
                noise = 1.4826 * mad
                snr = peak_val / noise if noise > 1e-12 else np.inf
                qc_row["最大強度"] = round(peak_val, 4)
                qc_row["估算 SNR"] = round(snr, 1) if np.isfinite(snr) else None
        if not peak_export_df.empty:
            ds_peaks = peak_export_df[peak_export_df["Dataset"] == ds_name]
            qc_row["偵測峰數"] = len(ds_peaks)
            if not ds_peaks.empty:
                if "Energy_eV" in ds_peaks.columns:
                    peak_pos_str = ", ".join(f"{v:.3f}" for v in ds_peaks["Energy_eV"].dropna())
                else:
                    peak_pos_str = ", ".join(f"{v:.1f}" for v in ds_peaks["Pixel"].dropna())
                qc_row["峰位"] = peak_pos_str
        qc_rows.append(qc_row)

    if qc_rows:
        with st.expander("QC 摘要", expanded=False):
            qc_df = pd.DataFrame(qc_rows)
            st.dataframe(qc_df, use_container_width=True, hide_index=True)

    # ── 建立 processing report ────────────────────────────────────────────────
    report_input_files = (
        [f.name for f in spectrum_files] if using_preprocessed_spectra else
        [f.name for f in uploaded_files]
    ) if True else []
    processing_report = {
        "tool": "XES Data Processing GUI",
        "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "input_mode": "preprocessed_1d" if using_preprocessed_spectra else "fits",
        "input_files": report_input_files,
        "datasets": list(export_frames.keys()),
        "step_bg1bg2": {
            "method": bg_method,
            "order": bg_order_method,
            "bg1_provided": bg1_available,
            "bg2_provided": bg2_available,
        },
        "step_image_correction": {
            "normalize_exposure": normalize_exposure,
            "transpose": transpose_image,
            "use_dark_frame": use_dark_frame,
            "fix_hot_pixels": fix_hot_pixels,
            "hot_threshold": hot_pixel_threshold,
            "hot_window": hot_pixel_window,
        },
        "step_roi_projection": {
            "projection": projection,
            "reducer": reducer,
            "x_roi": list(x_roi),
            "y_roi": list(y_roi),
            "sideband_enabled": sideband_enabled,
            "curvature_enabled": curvature_enabled,
            "curvature_poly_order": curvature_poly_order,
        },
        "step_average": {
            "enabled": do_average,
        },
        "step_smooth": {
            "method": smooth_method,
            "window": smooth_window,
            "poly_deg": smooth_poly_deg,
        },
        "step_normalization": {
            "method": norm_method,
            "x_start": norm_x_start,
            "x_end": norm_x_end,
            "pre_normalization_i0_mode": i0_mode,
            "pre_normalization_i0_global_eV": i0_global_value if i0_mode == "global" else None,
        },
        "step_axis_calibration": {
            "mode": axis_calibration,
            "energy_offset": energy_offset,
            "energy_slope": energy_slope,
            "poly_coeffs": energy_poly_coeffs,
        },
        "step_peak_detection": {
            "enabled": run_peak_detection,
            "prominence_ratio": peak_prom_ratio,
            "height_ratio": peak_height_ratio,
            "distance": peak_distance_pixel,
            "max_labels": max_peak_labels,
        },
        "step_peak_assignment": {
            "enabled": peak_id_enabled,
            "materials": peak_id_materials,
            "tolerance_eV": peak_id_tol_ev,
            "tolerance_pixel": peak_id_tol_pixel,
            "only_show_matched": peak_id_only_matched,
            "references": _dataframe_records(xes_reference_df),
            "matches": _dataframe_records(xes_reference_match_df),
            "note": "Energy-based assignments require X-axis calibration to eV. Pixel matching requires experimental Reference_Pixel entries.",
        },
        "step_band_alignment": {
            "enabled": band_align_enabled,
            "material_a": band_mat_a,
            "material_b": band_mat_b,
            "vbm_a_xes_eV": band_vbm_a,
            "cbm_a_xas_eV": band_cbm_a,
            "vbm_b_xes_eV": band_vbm_b,
            "cbm_b_xas_eV": band_cbm_b,
            "summary": _dataframe_records(band_alignment_df),
            "metrics": _json_safe(band_alignment_metrics),
        },
        "qc_summary": _json_safe(qc_rows),
    }

    # ── 三區卡片式匯出 ────────────────────────────────────────────────────────
    if (
        export_frames
        or not peak_export_df.empty
        or not xes_reference_df.empty
        or not xes_reference_match_df.empty
        or not band_alignment_df.empty
    ):
        st.divider()
        st.subheader("匯出")

        # 研究常用
        st.markdown("**研究常用**")
        st.caption("直接用於論文附圖或數據報告的檔案。")
        rc_cols = st.columns(2)
        rc_idx = 0
        for fname, df in export_frames.items():
            base = fname.rsplit(".", 1)[0]
            _render_download_card(
                title=f"處理後光譜 — {fname}",
                description="含各處理階段欄位（BG 扣除、平滑、歸一化、能量軸）的完整光譜 CSV。",
                input_label="檔名",
                default_name=f"{base}_xes_spectrum",
                extension="csv",
                button_label="⬇️ 下載光譜 CSV",
                data=df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key=f"xes_fname_card_{fname}",
                button_key=f"xes_dl_card_{fname}",
            )

        if not peak_export_df.empty:
            _render_download_card(
                title="峰值列表",
                description="偵測峰的 Pixel、Energy_eV（若已校正）、Intensity、FWHM 匯整表。",
                input_label="檔名",
                default_name="xes_peaks",
                extension="csv",
                button_label="⬇️ 下載峰值列表 CSV",
                data=peak_export_df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key="xes_peak_fname_card",
                button_key="xes_peak_dl_card",
            )

        if not xes_reference_match_df.empty:
            _render_download_card(
                title="XES 峰值指認結果",
                description="自動偵測峰與 NiO / Ga2O3 / n-Si XES 參考峰的比對表，包含材料、峰名、偏差與物理意義。",
                input_label="檔名",
                default_name="xes_peak_assignments",
                extension="csv",
                button_label="下載峰值指認 CSV",
                data=xes_reference_match_df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key="xes_peak_assign_fname_card",
                button_key="xes_peak_assign_dl_card",
            )

        if not xes_reference_df.empty:
            _render_download_card(
                title="XES 參考峰資料庫",
                description="目前選取材料的內建 XES 參考峰，可作為校正與指認依據。",
                input_label="檔名",
                default_name="xes_reference_database",
                extension="csv",
                button_label="下載 XES 資料庫 CSV",
                data=xes_reference_df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key="xes_ref_db_fname_card",
                button_key="xes_ref_db_dl_card",
            )

        if not band_alignment_df.empty:
            _render_download_card(
                title="能帶對齊結果",
                description="包含 XES VBM、XAS CBM、bandgap、Delta EV 與 Delta EC 的 CSV 匯整。",
                input_label="檔名",
                default_name="xes_xas_band_alignment",
                extension="csv",
                button_label="下載能帶對齊 CSV",
                data=band_alignment_df.to_csv(index=False).encode("utf-8"),
                mime="text/csv",
                input_key="xes_band_alignment_fname_card",
                button_key="xes_band_alignment_dl_card",
            )

        # 原始處理輸出
        st.markdown("**原始處理輸出**")
        st.caption("校正過程中產生的中間結果，適合深入審閱或重現。")
        aux_col1, aux_col2 = st.columns(2)
        if bg_method == "interpolated" and not bg_weight_df.empty:
            with aux_col1:
                _render_download_card(
                    title="BG1/BG2 分點權重表",
                    description="各 sample 的 BG 分點插值權重 w，確認分點法是否合理。",
                    input_label="檔名",
                    default_name="xes_bg_weights",
                    extension="csv",
                    button_label="⬇️ 下載權重表 CSV",
                    data=bg_weight_df.to_csv(index=False).encode("utf-8"),
                    mime="text/csv",
                    input_key="xes_bg_weight_fname_card",
                    button_key="xes_bg_weight_dl_card",
                )
        if curvature_enabled and not curvature_export_df.empty:
            with aux_col2:
                _render_download_card(
                    title="曲率校正表",
                    description="各 row 的 peak center 偵測結果與 polynomial fit 校正量。",
                    input_label="檔名",
                    default_name="xes_curvature",
                    extension="csv",
                    button_label="⬇️ 下載曲率校正表 CSV",
                    data=curvature_export_df.to_csv(index=False).encode("utf-8"),
                    mime="text/csv",
                    input_key="xes_curve_fname_card",
                    button_key="xes_curve_dl_card",
                )

        # 追溯 / QC
        st.markdown("**追溯 / QC**")
        st.caption("記錄完整處理流程的 JSON，日後重現或向合作者說明參數設定時使用。")
        rp_col1, rp_col2 = st.columns(2)
        with rp_col1:
            _render_download_card(
                title="XES Processing Report",
                description="完整處理參數（輸入檔、BG 方法、平滑、歸一化、能量校正、峰偵測設定）。",
                input_label="檔名",
                default_name="xes_processing_report",
                extension="json",
                button_label="⬇️ 下載 Processing Report JSON",
                data=json.dumps(_json_safe(processing_report), ensure_ascii=False, indent=2).encode("utf-8"),
                mime="application/json",
                input_key="xes_report_fname",
                button_key="xes_report_dl",
            )
        if qc_rows:
            with rp_col2:
                _render_download_card(
                    title="QC 摘要",
                    description="各資料集的 SNR 估算、最大強度與峰位統計。",
                    input_label="檔名",
                    default_name="xes_qc_summary",
                    extension="csv",
                    button_label="⬇️ 下載 QC 摘要 CSV",
                    data=pd.DataFrame(qc_rows).to_csv(index=False).encode("utf-8"),
                    mime="text/csv",
                    input_key="xes_qc_fname",
                    button_key="xes_qc_dl",
                )
