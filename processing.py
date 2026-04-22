import numpy as np


def shirley_background(y, max_iter=20):
    """
    Iterative Shirley background using cumulative sum (fast & stable).
    Starts from a linear guess and refines until the integral converges.
    """
    y = np.asarray(y, dtype=float)
    if len(y) < 2:
        return np.zeros_like(y)
    bkg = np.linspace(y[0], y[-1], len(y))
    for _ in range(max_iter):
        integral = np.cumsum(y - bkg)
        if integral[-1] == 0:
            break
        bkg = y[-1] + (y[0] - y[-1]) * (1 - integral / integral[-1])
    return bkg


def linear_background(x, y):
    """Straight line connecting first and last points of the segment."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    slope = (y[-1] - y[0]) / (x[-1] - x[0]) if x[-1] != x[0] else 0.0
    bg = y[0] + slope * (x - x[0])
    return bg


def apply_background(x, y, method, bg_x_start, bg_x_end):
    """
    Calculate and subtract background only within [bg_x_start, bg_x_end].
    Outside that region the background is extended as a constant
    (left side = bg value at bg_x_start, right side = bg value at bg_x_end).

    Returns (y_subtracted, bg_full_curve)
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)

    # Ensure the range is ordered correctly
    r0, r1 = min(bg_x_start, bg_x_end), max(bg_x_start, bg_x_end)
    mask = (x >= r0) & (x <= r1)

    bg_full = np.zeros_like(y)

    if method == "none" or not np.any(mask):
        return y.copy(), bg_full

    xs, ys = x[mask], y[mask]

    if method == "linear":
        bg_seg = linear_background(xs, ys)
    elif method == "shirley":
        bg_seg = shirley_background(ys)
    else:
        return y.copy(), bg_full

    # Fill bg_full: constant outside, computed inside
    bg_full[mask] = bg_seg
    bg_full[x < r0] = bg_seg[0]
    bg_full[x > r1] = bg_seg[-1]

    return y - bg_full, bg_full


def normalize_min_max(y):
    """Scale y to [0, 1]."""
    y = np.asarray(y, dtype=float)
    y_min, y_max = y.min(), y.max()
    if y_max == y_min:
        return np.zeros_like(y)
    return (y - y_min) / (y_max - y_min)


def normalize_max(x, y, region_x_start=None, region_x_end=None):
    """
    Divide entire spectrum by the maximum within [region_x_start, region_x_end].
    When no region is given, uses the global maximum.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if region_x_start is not None and region_x_end is not None:
        r0, r1 = min(region_x_start, region_x_end), max(region_x_start, region_x_end)
        mask = (x >= r0) & (x <= r1)
        peak_val = np.max(y[mask]) if np.any(mask) else np.max(y)
    else:
        peak_val = y.max()
    if peak_val == 0:
        return np.zeros_like(y)
    return y / peak_val


def normalize_area(x, y):
    """
    Divide entire spectrum by the total area (trapezoid integration).
    Result: area under the normalized curve = 1.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    sort_idx = np.argsort(x)
    xs, ys = x[sort_idx], y[sort_idx]
    total_area = np.abs(np.trapezoid(ys, xs))
    if total_area == 0:
        return np.zeros_like(y)
    return y / total_area


def normalize_mean_region(x, y, region_x_start, region_x_end):
    """
    Divide entire spectrum by the mean intensity within [region_x_start, region_x_end].
    Useful for post-edge or pre-edge normalization in XPS/XAS.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    r0, r1 = min(region_x_start, region_x_end), max(region_x_start, region_x_end)
    mask = (x >= r0) & (x <= r1)
    mean_val = np.mean(y[mask]) if np.any(mask) else np.mean(y)
    if mean_val == 0:
        return np.zeros_like(y)
    return y / mean_val


def apply_processing(x, y, bg_method="none", norm_method="none",
                     bg_x_start=None, bg_x_end=None,
                     norm_x_start=None, norm_x_end=None):
    """
    Full processing pipeline: background subtraction → normalization.

    bg_method   : 'none' | 'linear' | 'shirley'
    norm_method : 'none' | 'min_max' | 'max' | 'mean_region'
    bg_x_start/end   : energy range for background; defaults to full range.
    norm_x_start/end : energy range for mean normalization; defaults to full range.

    Returns (y_processed, bg_curve)
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)

    if bg_x_start is None:
        bg_x_start = x.min()
    if bg_x_end is None:
        bg_x_end = x.max()
    if norm_x_start is None:
        norm_x_start = x.min()
    if norm_x_end is None:
        norm_x_end = x.max()

    y_out, bg = apply_background(x, y, bg_method, bg_x_start, bg_x_end)

    if norm_method == "min_max":
        y_out = normalize_min_max(y_out)
    elif norm_method == "max":
        y_out = normalize_max(x, y_out, norm_x_start, norm_x_end)
    elif norm_method == "area":
        y_out = normalize_area(x, y_out)
    elif norm_method == "mean_region":
        y_out = normalize_mean_region(x, y_out, norm_x_start, norm_x_end)

    return y_out, bg
