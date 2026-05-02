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


def constant_background(y):
    """Constant baseline at the lower edge of the segment."""
    y = np.asarray(y, dtype=float)
    if len(y) == 0:
        return y.copy()
    return np.full_like(y, float(np.nanpercentile(y, 5)))


def polynomial_background(x, y, degree=3):
    """Fit a polynomial of given degree to the segment."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if len(x) <= degree:
        return np.linspace(y[0], y[-1], len(y))
    coeffs = np.polyfit(x, y, degree)
    return np.polyval(coeffs, x)


def rubber_band_background(x, y):
    """
    Lower convex-hull baseline, commonly called rubber-band correction.

    The baseline is interpolated through the lower hull vertices. This keeps
    broad fluorescence/background structure in the baseline instead of forcing
    it into a very wide synthetic peak.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if len(x) < 3:
        return linear_background(x, y)

    order = np.argsort(x)
    xs = x[order]
    ys = y[order]
    points = list(zip(xs, ys))

    lower: list[tuple[float, float]] = []
    for point in points:
        while len(lower) >= 2:
            x1, y1 = lower[-2]
            x2, y2 = lower[-1]
            x3, y3 = point
            cross = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)
            if cross <= 0:
                lower.pop()
            else:
                break
        lower.append(point)

    if len(lower) < 2:
        return constant_background(y)

    hx = np.asarray([p[0] for p in lower], dtype=float)
    hy = np.asarray([p[1] for p in lower], dtype=float)
    bg_sorted = np.interp(xs, hx, hy)
    bg = np.zeros_like(y, dtype=float)
    bg[order] = bg_sorted
    return bg


def manual_anchor_background(x, anchor_x, anchor_y):
    """Piecewise-linear baseline through user-provided anchor points."""
    x = np.asarray(x, dtype=float)
    ax = np.asarray(anchor_x or [], dtype=float)
    ay = np.asarray(anchor_y or [], dtype=float)
    valid = np.isfinite(ax) & np.isfinite(ay)
    ax = ax[valid]
    ay = ay[valid]
    if len(ax) < 2:
        return np.zeros_like(x, dtype=float)
    order = np.argsort(ax)
    ax = ax[order]
    ay = ay[order]
    return np.interp(x, ax, ay, left=ay[0], right=ay[-1])


def _baseline_system_matrix(n_points: int):
    """Second-derivative penalty matrix used by Whittaker-style baselines."""
    if n_points < 3:
        return None
    diff = sparse.diags([1.0, -2.0, 1.0], [0, 1, 2], shape=(n_points - 2, n_points), format="csc")
    return diff.T @ diff


def asls_background(y, lam=1e5, p=0.01, max_iter=20, weights=None):
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
    base_weights = np.clip(np.asarray(weights, dtype=float), 1e-6, 1e6) if weights is not None else np.ones(n, dtype=float)
    weights = base_weights.copy()
    baseline = y.copy()

    for _ in range(max(1, int(max_iter))):
        system = sparse.spdiags(weights, 0, n, n, format="csc") + lam * penalty
        baseline = spsolve(system, weights * y)
        weights = base_weights * np.where(y > baseline, p, 1.0 - p)

    return np.asarray(baseline, dtype=float)


def airpls_background(y, lam=1e5, max_iter=15, weights=None):
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
    base_weights = np.clip(np.asarray(weights, dtype=float), 1e-6, 1e6) if weights is not None else np.ones(n, dtype=float)
    weights = base_weights.copy()
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
        weights = np.maximum(weights * base_weights, 1e-6)

    return np.asarray(baseline, dtype=float)


def arpls_background(y, lam=1e5, max_iter=20, ratio=1e-6, weights=None):
    """
    Asymmetrically reweighted penalized least squares baseline.

    Compared with AsLS, arPLS updates weights using a smooth logistic rule,
    which generally avoids pinning the baseline too aggressively under weak
    Raman peaks.
    """
    y = np.asarray(y, dtype=float)
    n = len(y)
    if n < 3:
        return np.zeros_like(y)

    penalty = _baseline_system_matrix(n)
    if penalty is None:
        return np.zeros_like(y)

    lam = float(max(lam, 1.0))
    ratio = float(np.clip(ratio, 1e-9, 0.1))
    base_weights = np.clip(np.asarray(weights, dtype=float), 1e-6, 1e6) if weights is not None else np.ones(n, dtype=float)
    weights = base_weights.copy()
    baseline = y.copy()

    for _ in range(max(1, int(max_iter))):
        system = sparse.spdiags(weights, 0, n, n, format="csc") + lam * penalty
        baseline = np.asarray(spsolve(system, weights * y), dtype=float)
        residual = y - baseline
        negative = residual[residual < 0]
        if len(negative) == 0:
            break
        mean_neg = float(np.mean(negative))
        std_neg = float(np.std(negative))
        std_neg = max(std_neg, 1e-12)
        shifted = 2.0 * (residual - (2.0 * std_neg - mean_neg)) / std_neg
        new_weights = base_weights * (1.0 / (1.0 + np.exp(np.clip(shifted, -60.0, 60.0))))
        if np.linalg.norm(new_weights - weights) / max(np.linalg.norm(weights), 1e-12) < ratio:
            weights = new_weights
            break
        weights = new_weights

    return np.asarray(baseline, dtype=float)


def masked_weight_profile(x, centers=None, widths=None, extra_mask=None, notch_depth=0.02):
    """
    Build baseline weights that down-weight candidate peak regions.

    Returns weights in [notch_depth, 1]. Small values tell Whittaker-style
    baselines to largely ignore those x regions.
    """
    x = np.asarray(x, dtype=float)
    weights = np.ones(len(x), dtype=float)
    notch_depth = float(np.clip(notch_depth, 1e-4, 1.0))

    centers = centers or []
    widths = widths or []
    for idx, center in enumerate(centers):
        try:
            c = float(center)
        except (TypeError, ValueError):
            continue
        width = float(widths[idx]) if idx < len(widths) and widths[idx] is not None else 12.0
        width = max(abs(width), 1.0)
        sigma = max(width / 2.3548, 1e-6)
        notch = 1.0 - (1.0 - notch_depth) * np.exp(-((x - c) ** 2) / (2.0 * sigma ** 2))
        weights *= notch

    if extra_mask is not None:
        extra_mask_arr = np.asarray(extra_mask, dtype=bool)
        if len(extra_mask_arr) == len(weights):
            weights[extra_mask_arr] = np.minimum(weights[extra_mask_arr], notch_depth)

    return np.clip(weights, notch_depth, 1.0)


def tougaard_background(x, y, B=2866.0, C=1643.0, max_iter=20):
    """
    Iterative 2-parameter Tougaard background for XPS.
    bg(E) = C × ∫_E^E_max (y(E')−bg(E')) × K(E'−E) dE'
    K(T) = T / (T² + B)²
    Default B=2866 eV², C=1643 eV³ (universal Tougaard parameters).
    Background grows from the high-BE tail toward the peak.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    sort_idx = np.argsort(x)
    xs, ys = x[sort_idx], y[sort_idx]
    n = len(xs)
    bg = np.zeros(n)
    for _ in range(max_iter):
        bg_prev = bg.copy()
        for i in range(n - 1):
            T = xs[i + 1:] - xs[i]
            K = T / (T ** 2 + B) ** 2
            integrand = np.maximum(ys[i + 1:] - bg[i + 1:], 0.0) * K
            bg[i] = C * float(np.trapezoid(integrand, xs[i + 1:]))
        if np.max(np.abs(bg - bg_prev)) < 1e-8 * (np.max(np.abs(ys)) + 1e-10):
            break
    result = np.zeros_like(y)
    result[sort_idx] = bg
    return result


def apply_background(x, y, method, bg_x_start, bg_x_end, poly_deg=3,
                     baseline_lambda=1e5, baseline_p=0.01, baseline_iter=20,
                     tougaard_B=2866.0, tougaard_C=1643.0,
                     manual_anchor_x=None, manual_anchor_y=None):
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

    if method == "constant":
        bg_seg = constant_background(ys)
    elif method == "linear":
        bg_seg = linear_background(xs, ys)
    elif method == "shirley":
        bg_seg = shirley_background(ys)
    elif method == "polynomial":
        bg_seg = polynomial_background(xs, ys, degree=poly_deg)
    elif method == "rubber_band":
        bg_seg = rubber_band_background(xs, ys)
    elif method == "manual_anchor":
        bg_seg = manual_anchor_background(xs, manual_anchor_x, manual_anchor_y)
    elif method == "asls":
        bg_seg = asls_background(
            ys, lam=baseline_lambda, p=baseline_p, max_iter=baseline_iter,
        )
    elif method == "arpls":
        bg_seg = arpls_background(
            ys, lam=baseline_lambda, max_iter=baseline_iter,
        )
    elif method == "airpls":
        bg_seg = airpls_background(
            ys, lam=baseline_lambda, max_iter=baseline_iter,
        )
    elif method == "tougaard":
        bg_seg = tougaard_background(xs, ys, B=tougaard_B, C=tougaard_C)
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


def _normalization_mask(x, y, region_x_start=None, region_x_end=None):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    mask = np.isfinite(x) & np.isfinite(y)
    if region_x_start is not None and region_x_end is not None:
        r0, r1 = min(region_x_start, region_x_end), max(region_x_start, region_x_end)
        region_mask = mask & (x >= r0) & (x <= r1)
        if np.any(region_mask):
            return region_mask
    return mask


def normalize_min_max(x, y, region_x_start=None, region_x_end=None):
    """Scale y using the min/max inside the selected normalization region."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    mask = _normalization_mask(x, y, region_x_start, region_x_end)
    if not np.any(mask):
        return y.copy()

    y_min, y_max = np.min(y[mask]), np.max(y[mask])
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
    mask = _normalization_mask(x, y, region_x_start, region_x_end)
    if not np.any(mask):
        return y.copy()

    peak_val = np.max(np.abs(y[mask]))
    if peak_val == 0:
        return np.zeros_like(y)
    return y / peak_val


def normalize_area(x, y, region_x_start=None, region_x_end=None):
    """
    Divide entire spectrum by the positive area inside the selected region.
    The area is measured after shifting the selected region to a non-negative floor,
    which avoids cancellation when baseline-corrected spectra dip below zero.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    mask = _normalization_mask(x, y, region_x_start, region_x_end)
    if not np.any(mask):
        return y.copy()

    xs, ys = x[mask], y[mask]
    sort_idx = np.argsort(xs)
    xs, ys = xs[sort_idx], ys[sort_idx]
    positive_ys = ys - min(np.min(ys), 0)
    total_area = np.trapezoid(positive_ys, xs)
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
        y_out = normalize_min_max(x, y_out, norm_x_start, norm_x_end)
    elif norm_method == "max":
        y_out = normalize_max(x, y_out, norm_x_start, norm_x_end)
    elif norm_method == "area":
        y_out = normalize_area(x, y_out, norm_x_start, norm_x_end)
    elif norm_method == "mean_region":
        y_out = normalize_mean_region(x, y_out, norm_x_start, norm_x_end)

    return y_out


def apply_processing(x, y, bg_method="none", norm_method="none",
                     bg_x_start=None, bg_x_end=None,
                     norm_x_start=None, norm_x_end=None,
                     poly_deg=3,
                     baseline_lambda=1e5, baseline_p=0.01, baseline_iter=20,
                     tougaard_B=2866.0, tougaard_C=1643.0):
    """
    Full processing pipeline: background subtraction → normalization.

    bg_method   : 'none' | 'linear' | 'shirley' | 'polynomial' | 'asls' | 'airpls' | 'tougaard'
    norm_method : 'none' | 'min_max' | 'max' | 'area' | 'mean_region'
    bg_x_start/end   : energy range for background; defaults to full range.
    norm_x_start/end : range used to calculate normalization scale; defaults to full range.

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
        tougaard_B=tougaard_B,
        tougaard_C=tougaard_C,
    )

    return apply_normalization(
        x, y_out, norm_method,
        norm_x_start=norm_x_start, norm_x_end=norm_x_end,
    ), bg
