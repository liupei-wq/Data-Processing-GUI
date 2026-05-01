import numpy as np
from scipy.optimize import least_squares
from scipy.special import gamma as gamma_func
from scipy.special import voigt_profile


# ── Profile functions ─────────────────────────────────────────────────────────

def gaussian(x, amplitude, center, sigma):
    return amplitude * np.exp(-(x - center) ** 2 / (2 * sigma ** 2))


def lorentzian(x, amplitude, center, gamma):
    return amplitude * gamma ** 2 / ((x - center) ** 2 + gamma ** 2)


def voigt_peak(x, amplitude, center, sigma, gamma):
    """Amplitude-scaled Voigt profile (scipy voigt_profile is area-normalised)."""
    v0 = voigt_profile(0.0, abs(sigma), abs(gamma))
    if v0 == 0:
        return np.zeros_like(x, dtype=float)
    return amplitude * voigt_profile(x - center, abs(sigma), abs(gamma)) / v0


def pseudo_voigt_peak(x, amplitude, center, fwhm, eta):
    """Height-scaled pseudo-Voigt profile."""
    fwhm = max(abs(float(fwhm)), 1e-9)
    eta = float(np.clip(eta, 0.0, 1.0))
    sigma = fwhm / 2.3548
    gamma = fwhm / 2.0
    return (1.0 - eta) * gaussian(x, amplitude, center, sigma) + eta * lorentzian(x, amplitude, center, gamma)


def split_pseudo_voigt_peak(x, amplitude, center, fwhm_left, fwhm_right, eta):
    """Asymmetric pseudo-Voigt using separate left/right FWHM values."""
    x = np.asarray(x, dtype=float)
    out = np.zeros_like(x, dtype=float)
    left = x < center
    if np.any(left):
        out[left] = pseudo_voigt_peak(x[left], amplitude, center, fwhm_left, eta)
    if np.any(~left):
        out[~left] = pseudo_voigt_peak(x[~left], amplitude, center, fwhm_right, eta)
    return out


def super_gaussian_peak(x, amplitude, center, fwhm, shape):
    """
    Height-scaled generalized Gaussian.

    shape=2 is Gaussian-like; larger values flatten the peak top while keeping
    FWHM meaningful. This is useful for Raman bands that look plateau-like
    instead of sharp and pointed.
    """
    x = np.asarray(x, dtype=float)
    fwhm = max(abs(float(fwhm)), 1e-9)
    shape = float(np.clip(shape, 2.0, 12.0))
    scaled = np.abs(2.0 * (x - center) / fwhm)
    return amplitude * np.exp(-np.log(2.0) * np.power(scaled, shape))


# ── FWHM helpers ──────────────────────────────────────────────────────────────

def fwhm_from_sigma(sigma: float) -> float:
    return 2.3548 * abs(sigma)


def fwhm_from_gamma(gamma: float) -> float:
    return 2.0 * abs(gamma)


def fwhm_voigt(sigma: float, gamma: float) -> float:
    fg = fwhm_from_sigma(sigma)
    fl = fwhm_from_gamma(gamma)
    return 0.5346 * fl + np.sqrt(0.2166 * fl ** 2 + fg ** 2)


def _normalise_profile(profile: str | None) -> str:
    value = (profile or "voigt").strip().lower().replace("-", "_")
    aliases = {
        "gauss": "gaussian",
        "lorentz": "lorentzian",
        "pvoigt": "pseudo_voigt",
        "pseudo": "pseudo_voigt",
        "asymmetric_pseudo_voigt": "split_pseudo_voigt",
        "asymmetric_pvoigt": "split_pseudo_voigt",
        "split_pvoigt": "split_pseudo_voigt",
        "flat_top": "super_gaussian",
        "flat_top_gaussian": "super_gaussian",
        "flat_top_peak": "super_gaussian",
        "plateau": "super_gaussian",
        "supergaussian": "super_gaussian",
    }
    allowed = {"gaussian", "lorentzian", "voigt", "pseudo_voigt", "split_pseudo_voigt", "super_gaussian"}
    value = aliases.get(value, value)
    return value if value in allowed else "voigt"


# ── Area helpers ──────────────────────────────────────────────────────────────

def area_gaussian(amplitude: float, sigma: float) -> float:
    return abs(amplitude) * abs(sigma) * np.sqrt(2 * np.pi)


def area_lorentzian(amplitude: float, gamma: float) -> float:
    return abs(amplitude) * np.pi * abs(gamma)


def area_voigt(amplitude: float, sigma: float, gamma: float) -> float:
    half = 8 * max(abs(sigma), abs(gamma), 1e-6)
    xs = np.linspace(-half, half, 2000)
    return float(np.trapezoid(voigt_peak(xs, amplitude, 0.0, sigma, gamma), xs))


def area_pseudo_voigt(amplitude: float, fwhm: float, eta: float) -> float:
    sigma = abs(fwhm) / 2.3548
    gamma = abs(fwhm) / 2.0
    eta = float(np.clip(eta, 0.0, 1.0))
    return (1.0 - eta) * area_gaussian(amplitude, sigma) + eta * area_lorentzian(amplitude, gamma)


def area_split_pseudo_voigt(amplitude: float, fwhm_left: float, fwhm_right: float, eta: float) -> float:
    half = 8 * max(abs(fwhm_left), abs(fwhm_right), 1e-6)
    xs = np.linspace(-half, half, 3000)
    return float(np.trapezoid(split_pseudo_voigt_peak(xs, amplitude, 0.0, fwhm_left, fwhm_right, eta), xs))


def area_super_gaussian(amplitude: float, fwhm: float, shape: float) -> float:
    shape = float(np.clip(shape, 2.0, 12.0))
    return float(abs(amplitude) * abs(fwhm) * gamma_func(1.0 + 1.0 / shape) / (np.log(2.0) ** (1.0 / shape)))


def _finite_or_none(value):
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if np.isfinite(out) else None


def _boolish(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def _clamp(value: float, lo: float, hi: float) -> float:
    return float(min(max(value, lo), hi))


def _metric_values(y_true: np.ndarray, y_pred: np.ndarray, n_params: int) -> dict:
    n = int(len(y_true))
    residual = y_true - y_pred
    ss_res = float(np.sum(residual ** 2))
    ss_tot = float(np.sum((y_true - np.mean(y_true)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
    adj = 1.0 - (1.0 - r2) * (n - 1) / max(n - n_params - 1, 1) if n > 1 else r2
    rmse = float(np.sqrt(ss_res / max(n, 1)))
    variance = max(ss_res / max(n, 1), 1e-300)
    aic = float(n * np.log(variance) + 2 * n_params) if n else 0.0
    bic = float(n * np.log(variance) + np.log(max(n, 1)) * n_params) if n else 0.0
    return {
        "r_squared": float(r2),
        "adjusted_r_squared": float(adj),
        "rmse": rmse,
        "aic": aic,
        "bic": bic,
        "ss_res": ss_res,
    }


# ── Main fitting routine ──────────────────────────────────────────────────────

def fit_peaks(x, y, init_peaks, profile="voigt",
              manual_centers=None, manual_fwhms=None,
              doublet_pairs=None, maxfev=20000,
              fit_range=None, weights=None, segment_weights=None,
              robust_loss="linear"):
    """
    Fit a sum of peaks to (x, y) data.

    Individual peaks can carry optional keys:
    tolerance_cm, center_min, center_max, fwhm_min, fwhm_max, profile,
    lock_center, lock_fwhm, lock_area, lock_profile, amplitude, eta,
    fwhm_left, fwhm_right, and shape.

    The legacy signature is preserved for XPS callers that pass only
    init_peaks/profile/maxfev.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    n = len(init_peaks)

    if n == 0:
        return {"success": False, "message": "沒有選取任何峰。"}
    if len(x) != len(y) or len(x) < 3:
        return {"success": False, "message": "輸入光譜點數不足或 x/y 長度不一致。"}

    if doublet_pairs:
        # Kept for backward compatibility with the old signature. Raman does
        # not currently create doublet constraints.
        doublet_pairs = None

    sort_idx = np.argsort(x)
    x_sorted = x[sort_idx]
    y_sorted = y[sort_idx]
    y_max = float(np.max(y)) if np.max(y) > 0 else 1.0
    y_span = float(np.max(y) - np.min(y)) if len(y) else 1.0
    y_span = y_span if y_span > 0 else max(abs(y_max), 1.0)

    fit_mask = np.ones_like(x, dtype=bool)
    if fit_range is not None:
        try:
            fit_lo, fit_hi = float(fit_range[0]), float(fit_range[1])
            fit_lo, fit_hi = min(fit_lo, fit_hi), max(fit_lo, fit_hi)
            fit_mask = (x >= fit_lo) & (x <= fit_hi)
        except Exception:
            fit_mask = np.ones_like(x, dtype=bool)
    if int(np.sum(fit_mask)) < max(3, n):
        return {"success": False, "message": "局部擬合區間內點數不足。"}

    point_weights = np.ones_like(y, dtype=float)
    if weights is not None:
        weights_arr = np.asarray(weights, dtype=float)
        if len(weights_arr) == len(point_weights):
            point_weights *= np.clip(weights_arr, 0.0, 1e6)
    if segment_weights:
        for segment in segment_weights:
            try:
                lo_v = float(segment.get("lo"))
                hi_v = float(segment.get("hi"))
                weight_v = float(segment.get("weight", 1.0))
            except Exception:
                continue
            lo_v, hi_v = min(lo_v, hi_v), max(lo_v, hi_v)
            point_weights[(x >= lo_v) & (x <= hi_v)] *= max(weight_v, 0.0)
    fit_weights = np.sqrt(np.clip(point_weights[fit_mask], 0.0, 1e6))

    specs: list[dict] = []
    p0: list[float] = []
    lo: list[float] = []
    hi: list[float] = []

    def add_param(initial: float, lower: float, upper: float, locked: bool = False):
        lower = float(lower)
        upper = float(upper)
        if upper < lower:
            lower, upper = upper, lower
        if locked or upper <= lower:
            return None, _clamp(float(initial), lower, upper if upper >= lower else lower)
        idx = len(p0)
        value = _clamp(float(initial), lower, upper)
        p0.append(value)
        lo.append(lower)
        hi.append(upper)
        return idx, value

    for i, pk in enumerate(init_peaks):
        ctr_seed = (
            manual_centers[i] if manual_centers and i < len(manual_centers) and manual_centers[i] is not None
            else pk.get("be", pk.get("center", 0.0))
        )
        ctr = float(ctr_seed)
        ref_ctr = _finite_or_none(pk.get("ref_center"))
        theoretical = _finite_or_none(pk.get("theoretical_center"))
        bound_center = theoretical if theoretical is not None else (ref_ctr if ref_ctr is not None else ctr)
        tolerance = _finite_or_none(pk.get("tolerance_cm"))
        if tolerance is None:
            tolerance = _finite_or_none(pk.get("center_tolerance"))
        tolerance = max(float(tolerance if tolerance is not None else 8.0), 0.0)
        center_min = _finite_or_none(pk.get("center_min"))
        center_max = _finite_or_none(pk.get("center_max"))
        if center_min is None:
            center_min = bound_center - tolerance
        if center_max is None:
            center_max = bound_center + tolerance
        center_min, center_max = min(center_min, center_max), max(center_min, center_max)
        if center_max - center_min < 1e-9:
            center_max = center_min + 1e-9

        fwhm_seed = (
            manual_fwhms[i] if manual_fwhms and i < len(manual_fwhms) and manual_fwhms[i] is not None
            else pk.get("fwhm", pk.get("fwhm_cm", 8.0))
        )
        fwhm_init = max(float(fwhm_seed), 0.05)
        fwhm_min = _finite_or_none(pk.get("fwhm_min"))
        fwhm_max = _finite_or_none(pk.get("fwhm_max"))
        fwhm_min = max(float(fwhm_min if fwhm_min is not None else 0.5), 0.01)
        fwhm_max = float(fwhm_max if fwhm_max is not None else max(fwhm_init * 6.0, fwhm_min + 0.1))
        if fwhm_max <= fwhm_min:
            fwhm_max = fwhm_min + 0.1
        fwhm_init = _clamp(fwhm_init, fwhm_min, fwhm_max)

        amp_seed = _finite_or_none(pk.get("amplitude"))
        if amp_seed is None:
            amp_seed = float(np.interp(ctr, x_sorted, y_sorted))
        amp_seed = max(float(amp_seed), y_max * 0.01, 1e-12)
        amp_max = max(float(pk.get("amplitude_max", y_max * 10.0)), amp_seed * 1.05, 1e-9)

        peak_profile = _normalise_profile(str(pk.get("profile") or profile))
        lock_center = _boolish(pk.get("lock_center", False))
        lock_fwhm = _boolish(pk.get("lock_fwhm", False))
        lock_area = _boolish(pk.get("lock_area", False))
        lock_profile = _boolish(pk.get("lock_profile", False))

        spec = {
            "profile": peak_profile,
            "label": pk.get("label", f"Peak {i + 1}"),
            "amp_idx": None,
            "amp_fixed": amp_seed,
            "center_idx": None,
            "center_fixed": ctr,
            "fwhm_idx": None,
            "fwhm_fixed": fwhm_init,
            "fwhm_left_idx": None,
            "fwhm_left_fixed": fwhm_init,
            "fwhm_right_idx": None,
            "fwhm_right_fixed": fwhm_init,
            "sigma_idx": None,
            "sigma_fixed": max(fwhm_init / 3.6, 1e-4),
            "gamma_idx": None,
            "gamma_fixed": max(fwhm_init / 3.6, 1e-4),
            "eta_idx": None,
            "eta_fixed": float(np.clip(pk.get("eta", 0.5), 0.0, 1.0)),
            "shape_idx": None,
            "shape_fixed": float(np.clip(pk.get("shape", pk.get("flatness", 4.0)), 2.0, 12.0)),
            "center_min": center_min,
            "center_max": center_max,
            "center_seed": ctr,
            "fwhm_min": fwhm_min,
            "fwhm_max": fwhm_max,
            "lock_center": lock_center,
            "lock_fwhm": lock_fwhm,
            "lock_area": lock_area,
            "lock_profile": lock_profile,
        }

        spec["amp_idx"], spec["amp_fixed"] = add_param(amp_seed, 0.0, amp_max, lock_area)
        spec["center_idx"], spec["center_fixed"] = add_param(ctr, center_min, center_max, lock_center)

        if peak_profile in {"gaussian", "lorentzian"}:
            idx, fixed = add_param(fwhm_init, fwhm_min, fwhm_max, lock_fwhm)
            spec["fwhm_idx"], spec["fwhm_fixed"] = idx, fixed
        elif peak_profile == "super_gaussian":
            idx, fixed = add_param(fwhm_init, fwhm_min, fwhm_max, lock_fwhm)
            spec["fwhm_idx"], spec["fwhm_fixed"] = idx, fixed
            shape_idx, shape_fixed = add_param(spec["shape_fixed"], 2.0, 12.0, lock_profile)
            spec["shape_idx"], spec["shape_fixed"] = shape_idx, shape_fixed
        elif peak_profile == "pseudo_voigt":
            idx, fixed = add_param(fwhm_init, fwhm_min, fwhm_max, lock_fwhm)
            spec["fwhm_idx"], spec["fwhm_fixed"] = idx, fixed
            eta_idx, eta_fixed = add_param(spec["eta_fixed"], 0.0, 1.0, lock_profile)
            spec["eta_idx"], spec["eta_fixed"] = eta_idx, eta_fixed
        elif peak_profile == "split_pseudo_voigt":
            left_seed = _finite_or_none(pk.get("fwhm_left")) or fwhm_init
            right_seed = _finite_or_none(pk.get("fwhm_right")) or fwhm_init
            left_idx, left_fixed = add_param(left_seed, fwhm_min, fwhm_max, lock_fwhm)
            right_idx, right_fixed = add_param(right_seed, fwhm_min, fwhm_max, lock_fwhm)
            spec["fwhm_left_idx"], spec["fwhm_left_fixed"] = left_idx, left_fixed
            spec["fwhm_right_idx"], spec["fwhm_right_fixed"] = right_idx, right_fixed
            eta_idx, eta_fixed = add_param(spec["eta_fixed"], 0.0, 1.0, lock_profile)
            spec["eta_idx"], spec["eta_fixed"] = eta_idx, eta_fixed
        else:
            sigma0 = max(fwhm_init / 3.6, 1e-4)
            gamma0 = max(fwhm_init / 3.6, 1e-4)
            sigma_hi = max(fwhm_max / 2.3548, sigma0 * 1.05, 1e-3)
            gamma_hi = max(fwhm_max / 2.0, gamma0 * 1.05, 1e-3)
            sigma_lo = max(fwhm_min / 10.0, 1e-5)
            gamma_lo = max(fwhm_min / 10.0, 1e-5)
            sigma_idx, sigma_fixed = add_param(sigma0, sigma_lo, sigma_hi, lock_fwhm)
            gamma_idx, gamma_fixed = add_param(gamma0, gamma_lo, gamma_hi, lock_fwhm)
            spec["sigma_idx"], spec["sigma_fixed"] = sigma_idx, sigma_fixed
            spec["gamma_idx"], spec["gamma_fixed"] = gamma_idx, gamma_fixed

        for key, value in pk.items():
            if key not in spec and key not in {"label", "be", "center", "fwhm", "fwhm_cm"}:
                spec[key] = value
        specs.append(spec)

    def value_at(p, spec, name):
        idx = spec.get(f"{name}_idx")
        if idx is None:
            return float(spec.get(f"{name}_fixed", 0.0))
        return float(p[idx])

    def peak_values(p, spec):
        A = value_at(p, spec, "amp")
        c = value_at(p, spec, "center")
        prof = spec["profile"]
        if prof in {"gaussian", "lorentzian"}:
            fwhm = value_at(p, spec, "fwhm")
            return A, c, fwhm, None, None, None
        if prof == "super_gaussian":
            fwhm = value_at(p, spec, "fwhm")
            shape = value_at(p, spec, "shape")
            return A, c, fwhm, None, None, shape
        if prof == "pseudo_voigt":
            fwhm = value_at(p, spec, "fwhm")
            eta = value_at(p, spec, "eta")
            return A, c, fwhm, None, None, eta
        if prof == "split_pseudo_voigt":
            left = value_at(p, spec, "fwhm_left")
            right = value_at(p, spec, "fwhm_right")
            eta = value_at(p, spec, "eta")
            return A, c, (left + right) / 2.0, left, right, eta
        sigma = value_at(p, spec, "sigma")
        gamma = value_at(p, spec, "gamma")
        return A, c, fwhm_voigt(sigma, gamma), sigma, gamma, None

    def eval_one(xv, p, spec):
        A, c, fwhm, v1, v2, eta = peak_values(p, spec)
        prof = spec["profile"]
        if prof == "gaussian":
            return gaussian(xv, A, c, fwhm / 2.3548)
        if prof == "lorentzian":
            return lorentzian(xv, A, c, fwhm / 2.0)
        if prof == "pseudo_voigt":
            return pseudo_voigt_peak(xv, A, c, fwhm, eta if eta is not None else 0.5)
        if prof == "super_gaussian":
            return super_gaussian_peak(xv, A, c, fwhm, eta if eta is not None else 4.0)
        if prof == "split_pseudo_voigt":
            return split_pseudo_voigt_peak(
                xv,
                A,
                c,
                v1 if v1 is not None else fwhm,
                v2 if v2 is not None else fwhm,
                eta if eta is not None else 0.5,
            )
        return voigt_peak(
            xv,
            A,
            c,
            v1 if v1 is not None else fwhm / 3.6,
            v2 if v2 is not None else fwhm / 3.6,
        )

    def model(xv, p):
        out = np.zeros_like(xv, dtype=float)
        for spec in specs:
            out += eval_one(xv, p, spec)
        return out

    def objective(p):
        resid = (y[fit_mask] - model(x[fit_mask], p)) * fit_weights
        penalties: list[float] = []
        for spec in specs:
            _, _, fwhm, _, _, _ = peak_values(p, spec)
            penalty_value = 0.0
            if spec["profile"] == "voigt":
                if fwhm < spec["fwhm_min"]:
                    penalty_value = (spec["fwhm_min"] - fwhm) / max(spec["fwhm_min"], 1e-6) * y_span * 5
                elif fwhm > spec["fwhm_max"]:
                    penalty_value = (fwhm - spec["fwhm_max"]) / max(spec["fwhm_max"], 1e-6) * y_span * 5
            penalties.append(float(penalty_value))
        return np.concatenate([resid, np.asarray(penalties, dtype=float)])

    p0_arr = np.asarray(p0, dtype=float)
    lo_arr = np.asarray(lo, dtype=float)
    hi_arr = np.asarray(hi, dtype=float)
    loss = str(robust_loss or "linear").lower()
    if loss not in {"linear", "soft_l1", "huber", "cauchy", "arctan"}:
        loss = "linear"

    try:
        if len(p0_arr) == 0:
            popt = p0_arr
        else:
            res = least_squares(
                objective,
                p0_arr,
                bounds=(lo_arr, hi_arr),
                loss=loss,
                f_scale=max(float(np.std(y[fit_mask])), 1e-6),
                max_nfev=int(maxfev),
            )
            popt = res.x
            if not res.success and not np.all(np.isfinite(popt)):
                return {"success": False, "message": f"擬合失敗：{res.message}"}
    except Exception as exc:
        return {"success": False, "message": f"擬合失敗：{exc}"}

    y_fit = model(x, popt)
    residuals = y - y_fit
    metrics = _metric_values(y[fit_mask], y_fit[fit_mask], len(popt))

    peaks_out: list[dict] = []
    y_individual: list[np.ndarray] = []

    for spec in specs:
        yi = eval_one(x, popt, spec)
        A, c, fwhm_fit, v1, v2, eta = peak_values(popt, spec)
        prof = spec["profile"]
        if prof == "gaussian":
            area = area_gaussian(A, fwhm_fit / 2.3548)
        elif prof == "lorentzian":
            area = area_lorentzian(A, fwhm_fit / 2.0)
        elif prof == "super_gaussian":
            area = area_super_gaussian(A, fwhm_fit, eta if eta is not None else 4.0)
        elif prof == "pseudo_voigt":
            area = area_pseudo_voigt(A, fwhm_fit, eta if eta is not None else 0.5)
        elif prof == "split_pseudo_voigt":
            area = area_split_pseudo_voigt(
                A,
                v1 if v1 is not None else fwhm_fit,
                v2 if v2 is not None else fwhm_fit,
                eta if eta is not None else 0.5,
            )
        else:
            area = area_voigt(A, v1 if v1 is not None else fwhm_fit / 3.6, v2 if v2 is not None else fwhm_fit / 3.6)

        center_span = max(spec["center_max"] - spec["center_min"], 1e-9)
        boundary_margin = max(0.1, center_span * 0.05)
        near_lower = c <= spec["center_min"] + boundary_margin
        near_upper = c >= spec["center_max"] - boundary_margin
        fwhm_span = max(spec["fwhm_max"] - spec["fwhm_min"], 1e-9)
        fwhm_boundary_margin = max(0.05, fwhm_span * 0.05)
        fwhm_at_min = fwhm_fit <= spec["fwhm_min"] + fwhm_boundary_margin
        fwhm_at_max = fwhm_fit >= spec["fwhm_max"] - fwhm_boundary_margin

        y_individual.append(yi)
        peak_entry = {
            "label": spec["label"],
            "center": float(c),
            "amplitude": float(A),
            "fwhm": float(fwhm_fit),
            "area": float(area),
            "profile": prof,
            "eta": float(eta) if prof in {"pseudo_voigt", "split_pseudo_voigt"} and eta is not None else None,
            "shape": float(eta) if prof == "super_gaussian" and eta is not None else None,
            "fwhm_left": float(v1) if prof == "split_pseudo_voigt" and v1 is not None else None,
            "fwhm_right": float(v2) if prof == "split_pseudo_voigt" and v2 is not None else None,
            "center_min": float(spec["center_min"]),
            "center_max": float(spec["center_max"]),
            "fwhm_min": float(spec["fwhm_min"]),
            "fwhm_max": float(spec["fwhm_max"]),
            "center_at_boundary": bool(near_lower or near_upper),
            "center_boundary_side": "lower" if near_lower else ("upper" if near_upper else ""),
            "fwhm_at_boundary": bool(fwhm_at_min or fwhm_at_max),
            "fwhm_boundary_side": "lower" if fwhm_at_min else ("upper" if fwhm_at_max else ""),
            "broad_peak": bool(fwhm_at_max),
            "doublet": False,
        }
        for key, value in spec.items():
            if key not in peak_entry and not key.endswith("_idx") and key not in {
                "amp_fixed", "center_fixed", "fwhm_fixed", "fwhm_left_fixed", "fwhm_right_fixed",
                "sigma_fixed", "gamma_fixed", "eta_fixed", "shape_fixed", "center_seed", "profile",
            }:
                peak_entry[key] = value
        peaks_out.append(peak_entry)

    total_area = sum(p["area"] for p in peaks_out)
    for p in peaks_out:
        p["area_pct"] = p["area"] / total_area * 100 if total_area > 0 else 0.0

    return {
        "success": True,
        "peaks": peaks_out,
        "y_fit": y_fit,
        "y_individual": y_individual,
        "residuals": residuals,
        **metrics,
    }
