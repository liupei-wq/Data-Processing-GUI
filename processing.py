import numpy as np
from scipy import sparse
from scipy.sparse.linalg import spsolve
from scipy.signal import savgol_filter


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


def polynomial_background(x, y, degree=3):
    """Fit a polynomial of given degree to the segment."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if len(x) <= degree:
        return np.linspace(y[0], y[-1], len(y))
    coeffs = np.polyfit(x, y, degree)
    return np.polyval(coeffs, x)


def _baseline_system_matrix(n_points: int):
    """Second-derivative penalty matrix used by Whittaker-style baselines."""
    if n_points < 3:
        return None
    diff = sparse.diags([1.0, -2.0, 1.0], [0, 1, 2], shape=(n_points - 2, n_points), format="csc")
    return diff.T @ diff


def asls_background(y, lam=1e5, p=0.01, max_iter=20):
    """
    Asymmetric least squares baseline for fluorescence-heavy Raman spectra.

    Parameters
    ----------
    lam : float
        Smoothness penalty. Larger values produce a flatter baseline.
    p : float
        Asymmetry weight in (0, 1). Small values push the baseline below peaks.
    max_iter : int
        Number of reweighting iterations.
    """
    y = np.asarray(y, dtype=float)
    n = len(y)
    if n < 3:
        return np.zeros_like(y)

    penalty = _baseline_system_matrix(n)
    if penalty is None:
        return np.zeros_like(y)

    lam = float(max(lam, 1.0))
    p = float(np.clip(p, 1e-4, 0.4999))
    weights = np.ones(n, dtype=float)
    baseline = y.copy()

    for _ in range(max(1, int(max_iter))):
        system = sparse.spdiags(weights, 0, n, n, format="csc") + lam * penalty
        baseline = spsolve(system, weights * y)
        weights = np.where(y > baseline, p, 1.0 - p)

    return np.asarray(baseline, dtype=float)


def airpls_background(y, lam=1e5, max_iter=15):
    """
    Adaptive iteratively reweighted penalized least squares baseline.

    Compared with AsLS, airPLS adapts the weights based on negative residuals,
    which often behaves better on broad fluorescence backgrounds.
    """
    y = np.asarray(y, dtype=float)
    n = len(y)
    if n < 3:
        return np.zeros_like(y)

    penalty = _baseline_system_matrix(n)
    if penalty is None:
        return np.zeros_like(y)

    lam = float(max(lam, 1.0))
    weights = np.ones(n, dtype=float)
    baseline = y.copy()
    scale_ref = max(float(np.sum(np.abs(y))), 1.0)

    for it in range(max(1, int(max_iter))):
        system = sparse.spdiags(weights, 0, n, n, format="csc") + lam * penalty
        baseline = spsolve(system, weights * y)
        residual = y - baseline
        negative = residual[residual < 0]
        neg_sum = float(np.sum(np.abs(negative)))

        if neg_sum <= 1e-6 * scale_ref:
            break

        weights = np.zeros(n, dtype=float)
        neg_mask = residual < 0
        if np.any(neg_mask):
            scaled = np.clip((it + 1) * np.abs(residual[neg_mask]) / max(neg_sum, 1e-12), 0.0, 50.0)
            weights[neg_mask] = np.exp(scaled)
            edge_weight = float(np.max(weights[neg_mask]))
            weights[0] = edge_weight
            weights[-1] = edge_weight

    return np.asarray(baseline, dtype=float)


def apply_background(x, y, method, bg_x_start, bg_x_end, poly_deg=3,
                     baseline_lambda=1e5, baseline_p=0.01, baseline_iter=20):
    """
    Calculate and subtract background only within [bg_x_start, bg_x_end].
    Outside that region the background is extended as a constant
    (left side = bg value at bg_x_start, right side = bg value at bg_x_end).

    Returns (y_subtracted, bg_full_curve)
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)

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
    elif method == "polynomial":
        bg_seg = polynomial_background(xs, ys, degree=poly_deg)
    elif method == "asls":
        bg_seg = asls_background(
            ys, lam=baseline_lambda, p=baseline_p, max_iter=baseline_iter,
        )
    elif method == "airpls":
        bg_seg = airpls_background(
            ys, lam=baseline_lambda, max_iter=baseline_iter,
        )
    else:
        return y.copy(), bg_full

    bg_full[mask] = bg_seg
    bg_full[x < r0] = bg_seg[0]
    bg_full[x > r1] = bg_seg[-1]

    return y - bg_full, bg_full


def despike_signal(y, method="none", threshold=8.0, window_points=7, passes=1):
    """
    Remove isolated positive spikes such as cosmic rays from Raman spectra.

    Returns (y_despiked, spike_mask).
    """
    y = np.asarray(y, dtype=float)
    spike_mask = np.zeros(len(y), dtype=bool)
    if len(y) < 5 or method == "none":
        return y.copy(), spike_mask

    if method != "median":
        return y.copy(), spike_mask

    window_points = int(max(3, window_points))
    if window_points % 2 == 0:
        window_points += 1
    window_points = min(window_points, len(y) if len(y) % 2 == 1 else len(y) - 1)
    if window_points < 3:
        return y.copy(), spike_mask

    half = window_points // 2
    out = y.copy()

    for _ in range(max(1, int(passes))):
        changed = False
        new_out = out.copy()
        for i in range(half, len(out) - half):
            window = out[i - half:i + half + 1]
            neigh = np.concatenate((window[:half], window[half + 1:]))
            if len(neigh) == 0:
                continue
            local_med = float(np.median(neigh))
            local_mad = float(np.median(np.abs(neigh - local_med)))
            local_scale = 1.4826 * local_mad
            if not np.isfinite(local_scale) or local_scale < 1e-12:
                local_scale = float(np.std(neigh))
            if not np.isfinite(local_scale) or local_scale < 1e-12:
                continue
            if (out[i] - local_med) > float(threshold) * local_scale:
                new_out[i] = local_med
                spike_mask[i] = True
                changed = True
        out = new_out
        if not changed:
            break

    return out, spike_mask


def smooth_signal(y, method="none", window_points=11, poly_deg=3):
    """Apply optional smoothing to a 1D signal and return a copy."""
    y = np.asarray(y, dtype=float)
    if len(y) < 3 or method == "none":
        return y.copy()

    window_points = int(max(1, window_points))

    if method == "moving_average":
        window_points = min(window_points, len(y))
        kernel = np.ones(window_points, dtype=float) / window_points
        return np.convolve(y, kernel, mode="same")

    if method == "savitzky_golay":
        max_window = len(y) if len(y) % 2 == 1 else len(y) - 1
        if max_window < 3:
            return y.copy()

        window_points = max(3, window_points)
        if window_points % 2 == 0:
            window_points += 1
        window_points = min(window_points, max_window)

        min_window = max(3, int(poly_deg) + 2)
        if min_window % 2 == 0:
            min_window += 1
        if window_points < min_window:
            if max_window < min_window:
                return y.copy()
            window_points = min_window

        poly_deg = min(int(poly_deg), window_points - 1)
        return savgol_filter(y, window_length=window_points, polyorder=poly_deg, mode="interp")

    return y.copy()


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


def apply_normalization(x, y, norm_method="none",
                        norm_x_start=None, norm_x_end=None):
    """Normalization-only helper for spectra that do not need background subtraction."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)

    if len(x) == 0 or len(y) == 0:
        return y.copy()

    if norm_x_start is None:
        norm_x_start = x.min()
    if norm_x_end is None:
        norm_x_end = x.max()

    y_out = y.copy()
    if norm_method == "min_max":
        y_out = normalize_min_max(y_out)
    elif norm_method == "max":
        y_out = normalize_max(x, y_out, norm_x_start, norm_x_end)
    elif norm_method == "area":
        y_out = normalize_area(x, y_out)
    elif norm_method == "mean_region":
        y_out = normalize_mean_region(x, y_out, norm_x_start, norm_x_end)

    return y_out


def apply_processing(x, y, bg_method="none", norm_method="none",
                     bg_x_start=None, bg_x_end=None,
                     norm_x_start=None, norm_x_end=None,
                     poly_deg=3,
                     baseline_lambda=1e5, baseline_p=0.01, baseline_iter=20):
    """
    Full processing pipeline: background subtraction → normalization.

    bg_method   : 'none' | 'linear' | 'shirley' | 'polynomial' | 'asls' | 'airpls'
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

    y_out, bg = apply_background(
        x, y, bg_method, bg_x_start, bg_x_end,
        poly_deg=poly_deg,
        baseline_lambda=baseline_lambda,
        baseline_p=baseline_p,
        baseline_iter=baseline_iter,
    )

    return apply_normalization(
        x, y_out, norm_method,
        norm_x_start=norm_x_start, norm_x_end=norm_x_end,
    ), bg
