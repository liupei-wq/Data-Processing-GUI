"""Shared spectrum-level numerical helpers."""

from __future__ import annotations

import numpy as np
from scipy.interpolate import interp1d
from scipy.signal import find_peaks


def detect_spectrum_peaks(
    x: np.ndarray,
    y: np.ndarray,
    prominence_ratio: float,
    height_ratio: float,
    min_distance_x: float,
    max_peaks: int,
) -> np.ndarray:
    """Detect prominent positive peaks in a 1D spectrum."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if len(x) < 3 or len(y) < 3:
        return np.array([], dtype=int)

    dx = np.diff(x)
    dx = dx[np.isfinite(dx) & (dx > 0)]
    median_dx = float(np.median(dx)) if len(dx) else 0.0
    distance_pts = max(1, int(round(float(min_distance_x) / median_dx))) if median_dx > 0 else 1

    y_max = float(np.max(y))
    y_min = float(np.min(y))
    y_range = y_max - y_min
    if not np.isfinite(y_range) or y_range <= 0:
        return np.array([], dtype=int)

    find_kwargs = {}
    if prominence_ratio > 0:
        find_kwargs["prominence"] = float(prominence_ratio) * y_range
    if height_ratio > 0 and y_max > 0:
        find_kwargs["height"] = float(height_ratio) * y_max
    if distance_pts > 1:
        find_kwargs["distance"] = distance_pts

    peaks, props = find_peaks(y, **find_kwargs)
    if len(peaks) == 0:
        return peaks

    metric = props.get("prominences", y[peaks])
    order = np.argsort(metric)[::-1]
    if max_peaks > 0:
        order = order[:max_peaks]
    return np.sort(peaks[order])


def interpolate_spectrum_to_grid(
    x: np.ndarray,
    y: np.ndarray,
    target_x: np.ndarray,
    *,
    fill_value=np.nan,
    bounds_error: bool = False,
) -> np.ndarray:
    """Linearly interpolate one spectrum onto a target x grid."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    target_x = np.asarray(target_x, dtype=float)
    n = min(len(x), len(y))
    if n < 2:
        return np.full(target_x.shape, np.nan, dtype=float)

    return interp1d(
        x[:n],
        y[:n],
        kind="linear",
        bounds_error=bounds_error,
        fill_value=fill_value,
    )(target_x)


def mean_spectrum_arrays(arrays: list[np.ndarray]) -> np.ndarray | None:
    """Average equally sampled spectra; returns None when no spectra are available."""
    if not arrays:
        return None
    return np.mean(np.vstack(arrays), axis=0)


def gaussian_template_from_area(
    x: np.ndarray,
    center: float,
    fwhm: float,
    area: float,
) -> np.ndarray:
    """Build a Gaussian template from fixed center, FWHM and integrated area."""
    x = np.asarray(x, dtype=float)
    sigma = float(max(fwhm, 1e-12)) / (2.0 * np.sqrt(2.0 * np.log(2.0)))
    amplitude = float(area) / (sigma * np.sqrt(2.0 * np.pi))
    return amplitude * np.exp(-0.5 * ((x - float(center)) / sigma) ** 2)


def fit_fixed_gaussian_templates(
    x: np.ndarray,
    signal: np.ndarray,
    centers: list[dict],
    fixed_fwhm: float,
    fixed_area: float,
    search_half_width: float,
    prevent_negative: bool = False,
) -> tuple[np.ndarray, np.ndarray, list[dict], float]:
    """Subtract fixed-area/FWHM Gaussian templates while searching only center positions."""
    x = np.asarray(x, dtype=float)
    signal = np.asarray(signal, dtype=float)
    if len(x) == 0 or len(signal) == 0:
        return np.array([]), np.array([]), [], 1.0

    valid_centers: list[dict] = []
    for idx, row in enumerate(centers):
        enabled = bool(row.get("enabled", True))
        center = row.get("center")
        if not enabled or center is None:
            continue
        try:
            center_f = float(center)
        except (TypeError, ValueError):
            continue
        if not np.isfinite(center_f):
            continue
        valid_centers.append({
            "name": str(row.get("name", "")).strip() or f"Peak {idx + 1}",
            "center": center_f,
        })

    empty_rows: list[dict] = []
    if not valid_centers:
        return np.zeros_like(signal, dtype=float), signal.copy(), empty_rows, 1.0

    valid_centers.sort(key=lambda item: item["center"])
    residual = signal.copy()
    total_model = np.zeros_like(residual, dtype=float)
    fit_rows: list[dict] = []
    overall_guard_scale = 1.0
    local_half_window = float(max(search_half_width, fixed_fwhm * 3.0))

    for row in valid_centers:
        seed_center = float(row["center"])
        low = max(float(np.min(x)), seed_center - float(search_half_width))
        high = min(float(np.max(x)), seed_center + float(search_half_width))
        if not np.isfinite(low) or not np.isfinite(high) or low >= high:
            candidate_centers = np.array([seed_center], dtype=float)
        else:
            candidate_centers = np.linspace(low, high, 161, dtype=float)

        best_center = seed_center
        best_score = -np.inf
        positive_residual = np.clip(residual, a_min=0.0, a_max=None)
        for center in candidate_centers:
            mask = (x >= center - local_half_window) & (x <= center + local_half_window)
            if int(np.count_nonzero(mask)) < 3:
                continue
            local_x = x[mask]
            local_model = gaussian_template_from_area(local_x, float(center), fixed_fwhm, fixed_area)
            score = float(np.trapezoid(positive_residual[mask] * local_model, local_x))
            if score > best_score:
                best_score = score
                best_center = float(center)

        best_model = gaussian_template_from_area(x, best_center, fixed_fwhm, fixed_area)
        applied_model = best_model
        guard_scale = 1.0
        if prevent_negative:
            available_signal = np.clip(residual, a_min=0.0, a_max=None)
            support_mask = (
                (x >= best_center - local_half_window)
                & (x <= best_center + local_half_window)
                & (best_model >= float(np.max(best_model)) * 1e-4)
            )
            if np.any(support_mask):
                safe_ratios = available_signal[support_mask] / np.maximum(best_model[support_mask], 1e-12)
                safe_ratios = safe_ratios[np.isfinite(safe_ratios)]
                if safe_ratios.size > 0:
                    guard_scale = float(np.clip(np.min(safe_ratios), 0.0, 1.0))
                    applied_model = best_model * guard_scale
            overall_guard_scale = min(overall_guard_scale, guard_scale)

        residual = residual - applied_model
        if prevent_negative:
            residual = np.maximum(residual, 0.0)
        total_model += applied_model
        fit_rows.append({
            "Peak_Name": row["name"],
            "Seed_Center": seed_center,
            "Fitted_Center": best_center,
            "Shift": best_center - seed_center,
            "Fixed_FWHM": float(fixed_fwhm),
            "Fixed_Area": float(fixed_area * guard_scale),
            "Template_Height": float(np.max(applied_model)) if len(applied_model) else 0.0,
            "Guard_Scale": float(guard_scale),
            "Guard_Applied": bool(guard_scale < 0.999999),
        })

    return total_model, residual, fit_rows, float(overall_guard_scale)
