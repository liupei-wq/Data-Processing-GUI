from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.integrate import trapezoid


def linear_baseline(x: np.ndarray, y: np.ndarray, ranges: list[tuple[float, float]]) -> np.ndarray:
    mask = np.zeros_like(x, dtype=bool)
    for lo, hi in ranges:
        mask |= (x >= min(lo, hi)) & (x <= max(lo, hi))
    if mask.sum() < 2:
        raise ValueError("Linear baseline needs at least two points in the selected ranges.")
    slope, intercept = np.polyfit(x[mask], y[mask], 1)
    return slope * x + intercept


def normalize_signal(x: np.ndarray, y: np.ndarray, method: str) -> np.ndarray:
    if method == "none":
        return y.copy()
    if method == "max":
        denom = np.nanmax(np.abs(y))
        return y / denom if denom > 0 else y.copy()
    if method == "area":
        area = trapezoid(np.clip(y, 0, None), x)
        return y / area if area > 0 else y.copy()
    raise ValueError(f"Unknown normalization method: {method}")


def process_spectrum(
    df: pd.DataFrame,
    baseline_method: str = "none",
    baseline_ranges: list[tuple[float, float]] | None = None,
    clip_negative: bool = True,
    normalization: str = "none",
) -> pd.DataFrame:
    out = df.copy()
    x = out["Binding_Energy"].to_numpy(float)
    raw = out["Intensity_raw"].to_numpy(float)
    processed = raw.copy()
    baseline = np.zeros_like(processed)
    warnings: list[str] = []

    if baseline_method == "linear":
        try:
            baseline = linear_baseline(x, processed, baseline_ranges or [])
            processed = processed - baseline
        except ValueError as exc:
            warnings.append(str(exc))
    elif baseline_method != "none":
        warnings.append(f"Unsupported baseline method: {baseline_method}")

    if clip_negative:
        processed = np.clip(processed, 0, None)
    processed = normalize_signal(x, processed, normalization)

    out["Baseline"] = baseline
    out["Intensity_processed"] = processed
    out.attrs["warnings"] = warnings
    return out

