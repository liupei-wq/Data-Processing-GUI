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
