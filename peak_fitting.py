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
              manual_centers=None, manual_fwhms=None):
    """
    Fit a sum of peaks to (x, y) data.

    Parameters
    ----------
    x, y        : array-like  (background-subtracted spectrum)
    init_peaks  : list of dict  {"label": str, "be": float, "fwhm": float}
    profile     : "gaussian" | "lorentzian" | "voigt"
    manual_centers : list[float | None]  override center per peak (None = use DB)
    manual_fwhms   : list[float | None]  override FWHM   per peak (None = use DB)

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

    p0, lo, hi = [], [], []

    for i, pk in enumerate(init_peaks):
        ctr  = (manual_centers[i] if manual_centers and manual_centers[i] is not None
                else pk["be"])
        fwhm = (manual_fwhms[i]   if manual_fwhms   and manual_fwhms[i]   is not None
                else pk["fwhm"])
        fwhm = max(fwhm, 0.05)

        # Amplitude: intensity at the reference center (interpolate; x may be descending)
        x_sorted = np.sort(x)
        y_sorted = y[np.argsort(x)]
        amp = float(np.interp(ctr, x_sorted, y_sorted))
        amp = max(amp, y_max * 0.01)

        ctr_lo, ctr_hi = ctr - 8.0, ctr + 8.0

        if profile == "gaussian":
            sigma = fwhm / 2.3548
            p0 += [amp, ctr, sigma]
            lo += [0.0,    ctr_lo, 0.01]
            hi += [y_max * 5, ctr_hi, fwhm * 6]
        elif profile == "lorentzian":
            gamma = fwhm / 2.0
            p0 += [amp, ctr, gamma]
            lo += [0.0,    ctr_lo, 0.01]
            hi += [y_max * 5, ctr_hi, fwhm * 6]
        else:  # voigt
            sigma = fwhm / 3.6
            gamma = fwhm / 3.6
            p0 += [amp, ctr, sigma, gamma]
            lo += [0.0,    ctr_lo, 0.001, 0.001]
            hi += [y_max * 5, ctr_hi, fwhm * 6, fwhm * 6]

    n_pp = {"gaussian": 3, "lorentzian": 3, "voigt": 4}[profile]

    if profile == "gaussian":
        def func(x, *p):
            out = np.zeros_like(x, dtype=float)
            for i in range(n):
                A, c, s = p[i*3], p[i*3+1], abs(p[i*3+2])
                out += gaussian(x, A, c, s)
            return out
    elif profile == "lorentzian":
        def func(x, *p):
            out = np.zeros_like(x, dtype=float)
            for i in range(n):
                A, c, g = p[i*3], p[i*3+1], abs(p[i*3+2])
                out += lorentzian(x, A, c, g)
            return out
    else:
        def func(x, *p):
            out = np.zeros_like(x, dtype=float)
            for i in range(n):
                A, c, s, g = p[i*4], p[i*4+1], abs(p[i*4+2]), abs(p[i*4+3])
                out += voigt_peak(x, A, c, s, g)
            return out

    try:
        popt, _ = curve_fit(func, x, y, p0=p0, bounds=(lo, hi), maxfev=20000)
    except Exception as exc:
        return {"success": False, "message": f"擬合失敗：{exc}"}

    y_fit     = func(x, *popt)
    residuals = y - y_fit
    ss_res    = float(np.sum(residuals ** 2))
    ss_tot    = float(np.sum((y - np.mean(y)) ** 2))
    r2        = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

    peaks_out  = []
    y_individual = []

    for i in range(n):
        p = popt[i * n_pp: (i + 1) * n_pp]

        if profile == "gaussian":
            A, c, s = p[0], p[1], abs(p[2])
            yi    = gaussian(x, A, c, s)
            fwhm_fit = fwhm_from_sigma(s)
            area  = area_gaussian(A, s)
        elif profile == "lorentzian":
            A, c, g = p[0], p[1], abs(p[2])
            yi    = lorentzian(x, A, c, g)
            fwhm_fit = fwhm_from_gamma(g)
            area  = area_lorentzian(A, g)
        else:
            A, c, s, g = p[0], p[1], abs(p[2]), abs(p[3])
            yi    = voigt_peak(x, A, c, s, g)
            fwhm_fit = fwhm_voigt(s, g)
            area  = area_voigt(A, s, g)

        y_individual.append(yi)
        peaks_out.append({
            "label":  init_peaks[i]["label"],
            "center": float(c),
            "fwhm":   float(fwhm_fit),
            "area":   float(area),
        })

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
