import numpy as np
from scipy.optimize import curve_fit
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


# ── FWHM helpers ──────────────────────────────────────────────────────────────

def fwhm_from_sigma(sigma: float) -> float:
    return 2.3548 * abs(sigma)


def fwhm_from_gamma(gamma: float) -> float:
    return 2.0 * abs(gamma)


def fwhm_voigt(sigma: float, gamma: float) -> float:
    fg = fwhm_from_sigma(sigma)
    fl = fwhm_from_gamma(gamma)
    return 0.5346 * fl + np.sqrt(0.2166 * fl ** 2 + fg ** 2)


# ── Area helpers ──────────────────────────────────────────────────────────────

def area_gaussian(amplitude: float, sigma: float) -> float:
    return abs(amplitude) * abs(sigma) * np.sqrt(2 * np.pi)


def area_lorentzian(amplitude: float, gamma: float) -> float:
    return abs(amplitude) * np.pi * abs(gamma)


def area_voigt(amplitude: float, sigma: float, gamma: float) -> float:
    half = 8 * max(abs(sigma), abs(gamma))
    xs = np.linspace(-half, half, 2000)
    return float(np.trapezoid(voigt_peak(xs, amplitude, 0.0, sigma, gamma), xs))


# ── Main fitting routine ──────────────────────────────────────────────────────

def fit_peaks(x, y, init_peaks, profile="voigt",
              manual_centers=None, manual_fwhms=None,
              doublet_pairs=None, maxfev=20000):
    """
    Fit a sum of peaks to (x, y) data.

    Parameters
    ----------
    x, y          : array-like  (background-subtracted spectrum)
    init_peaks    : list of dict  {"label": str, "be": float, "fwhm": float}
    profile       : "gaussian" | "lorentzian" | "voigt"
    manual_centers: list[float | None]  override center per peak (None = use DB)
    manual_fwhms  : list[float | None]  override FWHM   per peak (None = use DB)
    doublet_pairs : list of dict, each:
                    {"major": int, "minor": int, "be_sep": float, "area_ratio": float}
                    When provided, the minor peak's center is constrained to
                    major_center + delta_BE (delta_BE fitted within ±0.8 eV of be_sep),
                    and its amplitude satisfies area_minor/area_major = area_ratio
                    (assuming shared FWHM for both components).

    Returns
    -------
    dict with keys:
        success, message, peaks, y_fit, y_individual, residuals, r_squared
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    n = len(init_peaks)

    if n == 0:
        return {"success": False, "message": "沒有選取任何峰。"}

    y_max = float(y.max()) if y.max() > 0 else 1.0

    # ── Doublet lookup tables ─────────────────────────────────────────────────
    # minor_of[i]        = (major_idx, be_sep, area_ratio)
    # major_has_minor[i] = [(minor_idx, be_sep, area_ratio), ...]
    minor_of: dict[int, tuple] = {}
    major_has_minor: dict[int, list] = {}
    if doublet_pairs:
        for dp in doublet_pairs:
            mi, ni = int(dp["major"]), int(dp["minor"])
            minor_of[ni] = (mi, float(dp["be_sep"]), float(dp["area_ratio"]))
            major_has_minor.setdefault(mi, []).append(
                (ni, float(dp["be_sep"]), float(dp["area_ratio"]))
            )

    # Peaks with independent parameters (not minor components of a doublet)
    independent = [i for i in range(n) if i not in minor_of]

    # ── Build p0 / lo / hi ───────────────────────────────────────────────────
    p0: list[float] = []
    lo: list[float] = []
    hi: list[float] = []
    param_start: dict[int, int] = {}  # independent peak idx -> start in p0
    delta_be_pos: dict[int, int] = {}  # minor peak idx -> position of delta_BE in p0

    x_sorted = np.sort(x)
    y_sorted = y[np.argsort(x)]

    for i in independent:
        pk = init_peaks[i]
        ctr = (manual_centers[i] if manual_centers and manual_centers[i] is not None
               else pk["be"])
        fwhm = (manual_fwhms[i] if manual_fwhms and manual_fwhms[i] is not None
                else pk["fwhm"])
        fwhm = max(fwhm, 0.05)

        amp = float(np.interp(ctr, x_sorted, y_sorted))
        amp = max(amp, y_max * 0.01)
        ctr_lo, ctr_hi = ctr - 8.0, ctr + 8.0

        param_start[i] = len(p0)

        if profile == "gaussian":
            sigma = fwhm / 2.3548
            p0 += [amp, ctr, sigma]
            lo += [0.0, ctr_lo, 0.01]
            hi += [y_max * 5, ctr_hi, fwhm * 6]
        elif profile == "lorentzian":
            gamma = fwhm / 2.0
            p0 += [amp, ctr, gamma]
            lo += [0.0, ctr_lo, 0.01]
            hi += [y_max * 5, ctr_hi, fwhm * 6]
        else:  # voigt
            sigma = fwhm / 3.6
            gamma = fwhm / 3.6
            p0 += [amp, ctr, sigma, gamma]
            lo += [0.0, ctr_lo, 0.001, 0.001]
            hi += [y_max * 5, ctr_hi, fwhm * 6, fwhm * 6]

        # For each minor doublet partner of this major, add a delta_BE parameter
        for ni, be_sep, _ in major_has_minor.get(i, []):
            delta_be_pos[ni] = len(p0)
            p0.append(be_sep)
            lo.append(be_sep - 0.8)
            hi.append(be_sep + 0.8)

    # ── Helper: extract (A, center, sigma, gamma) for any peak ───────────────
    def _params(p, idx):
        if idx in minor_of:
            maj_idx, _, area_ratio = minor_of[idx]
            s = param_start[maj_idx]
            delta_be = p[delta_be_pos[idx]]
            if profile == "gaussian":
                A_maj, c_maj, sigma = p[s], p[s + 1], abs(p[s + 2])
                return A_maj * area_ratio, c_maj + delta_be, sigma, None
            elif profile == "lorentzian":
                A_maj, c_maj, gamma = p[s], p[s + 1], abs(p[s + 2])
                return A_maj * area_ratio, c_maj + delta_be, gamma, None
            else:
                A_maj, c_maj, sigma, gamma = (
                    p[s], p[s + 1], abs(p[s + 2]), abs(p[s + 3])
                )
                return A_maj * area_ratio, c_maj + delta_be, sigma, gamma
        else:
            s = param_start[idx]
            if profile == "gaussian":
                return p[s], p[s + 1], abs(p[s + 2]), None
            elif profile == "lorentzian":
                return p[s], p[s + 1], abs(p[s + 2]), None
            else:
                return p[s], p[s + 1], abs(p[s + 2]), abs(p[s + 3])

    # ── Composite model ───────────────────────────────────────────────────────
    if profile == "gaussian":
        def func(xv, *p):
            out = np.zeros_like(xv, dtype=float)
            for i in range(n):
                A, c, sig, _ = _params(p, i)
                out += gaussian(xv, A, c, sig)
            return out
    elif profile == "lorentzian":
        def func(xv, *p):
            out = np.zeros_like(xv, dtype=float)
            for i in range(n):
                A, c, gam, _ = _params(p, i)
                out += lorentzian(xv, A, c, gam)
            return out
    else:
        def func(xv, *p):
            out = np.zeros_like(xv, dtype=float)
            for i in range(n):
                A, c, sig, gam = _params(p, i)
                out += voigt_peak(xv, A, c, sig, gam)
            return out

    try:
        popt, _ = curve_fit(func, x, y, p0=p0, bounds=(lo, hi), maxfev=int(maxfev))
    except Exception as exc:
        return {"success": False, "message": f"擬合失敗：{exc}"}

    y_fit = func(x, *popt)
    residuals = y - y_fit
    ss_res = float(np.sum(residuals ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

    # ── Per-peak output ───────────────────────────────────────────────────────
    peaks_out: list[dict] = []
    y_individual: list[np.ndarray] = []

    for i in range(n):
        if profile == "gaussian":
            A, c, sigma, _ = _params(popt, i)
            yi = gaussian(x, A, c, sigma)
            fwhm_fit = fwhm_from_sigma(sigma)
            area = area_gaussian(A, sigma)
        elif profile == "lorentzian":
            A, c, gamma, _ = _params(popt, i)
            yi = lorentzian(x, A, c, gamma)
            fwhm_fit = fwhm_from_gamma(gamma)
            area = area_lorentzian(A, gamma)
        else:
            A, c, sigma, gamma = _params(popt, i)
            yi = voigt_peak(x, A, c, sigma, gamma)
            fwhm_fit = fwhm_voigt(sigma, gamma)
            area = area_voigt(A, sigma, gamma)

        y_individual.append(yi)
        peak_entry = {
            "label":   init_peaks[i]["label"],
            "center":  float(c),
            "fwhm":    float(fwhm_fit),
            "area":    float(area),
            "doublet": i in minor_of,
        }
        for key, value in init_peaks[i].items():
            if key not in {"label", "be", "fwhm"}:
                peak_entry[key] = value
        peaks_out.append(peak_entry)

    total_area = sum(p["area"] for p in peaks_out)
    for p in peaks_out:
        p["area_pct"] = p["area"] / total_area * 100 if total_area > 0 else 0.0

    return {
        "success":      True,
        "peaks":        peaks_out,
        "y_fit":        y_fit,
        "y_individual": y_individual,
        "residuals":    residuals,
        "r_squared":    r2,
    }
