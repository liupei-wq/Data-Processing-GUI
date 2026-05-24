from __future__ import annotations

import numpy as np
from scipy.optimize import lsq_linear, nnls


def fit_components(
    energy: np.ndarray,
    intensity: np.ndarray,
    components: dict[str, np.ndarray],
    fit_range: tuple[float, float],
    background: str = "constant",
) -> dict:
    lo, hi = sorted(fit_range)
    mask = (energy >= lo) & (energy <= hi) & np.isfinite(intensity)
    names = [name for name, values in components.items() if np.nanmax(np.abs(values)) > 0]
    if mask.sum() < 3 or not names:
        raise ValueError("Not enough points or pDOS components for fitting.")

    x = energy[mask]
    y = intensity[mask]
    cols = [components[name][mask] for name in names]
    bg_names: list[str] = []
    if background in {"constant", "linear"}:
        cols.append(np.ones_like(x))
        bg_names.append("background_const")
    if background == "linear":
        cols.append(x - x.mean())
        bg_names.append("background_linear")

    A = np.vstack(cols).T
    if background == "none":
        coef, _ = nnls(A, y)
    else:
        lower = np.zeros(A.shape[1])
        if background == "linear":
            lower[-1] = -np.inf
        result = lsq_linear(A, y, bounds=(lower, np.inf), method="trf")
        coef = result.x

    fit = A @ coef
    residual = y - fit
    ss_res = float(np.sum(residual**2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    rmse = float(np.sqrt(np.mean(residual**2)))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
    coef_names = names + bg_names
    coeffs = {name: float(value) for name, value in zip(coef_names, coef)}
    spectral = np.array([coeffs[name] for name in names], dtype=float)
    denom = float(np.sum(spectral))
    perc = {f"{name}_percent": float(value / denom * 100) if denom > 0 else 0.0 for name, value in zip(names, spectral)}
    return {
        "energy": x,
        "observed": y,
        "fit": fit,
        "residual": residual,
        "coefficients": coeffs,
        "percentages": perc,
        "r2": r2,
        "rmse": rmse,
        "component_names": names,
    }

