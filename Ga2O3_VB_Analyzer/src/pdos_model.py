from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.signal import fftconvolve
from scipy.special import wofz

ORBITALS = [
    "O_2p",
    "O_2s",
    "Ga_tet",
    "Ga_oct",
    "Ga_3d",
    "Ga_tet_s",
    "Ga_tet_p",
    "Ga_tet_d",
    "Ga_oct_s",
    "Ga_oct_p",
    "Ga_oct_d",
    "Ga_tet_4p",
    "Ga_oct_4p",
    "Ga_tet_3d",
    "Ga_oct_3d",
]
FACTOR_ALIASES = {
    "O_2p": ["O_2p", "O2p"],
    "O_2s": ["O_2s", "O2s"],
    "Ga_4p": ["Ga_4p", "Ga_tet_p", "Ga_oct_p", "Ga_tet_4p", "Ga_oct_4p"],
    "Ga_3d": ["Ga_3d", "Ga3d", "Ga_tet_d", "Ga_oct_d", "Ga_tet_3d", "Ga_oct_3d"],
    "Ga_tet": ["Ga_tet", "Ga_tet_s", "Ga_tet_p", "Ga_tet_d", "Ga_tet_4p", "Ga_tet_3d"],
    "Ga_oct": ["Ga_oct", "Ga_oct_s", "Ga_oct_p", "Ga_oct_d", "Ga_oct_4p", "Ga_oct_3d"],
}


def prepare_pdos(df: pd.DataFrame, energy_col: str, mapping: dict[str, str], flip_negative_energy: bool) -> pd.DataFrame:
    out = pd.DataFrame({"Energy_rel": pd.to_numeric(df[energy_col], errors="coerce")})
    if flip_negative_energy:
        out["Energy_rel"] = -out["Energy_rel"]
    for orbital, col in mapping.items():
        if col and col in df.columns:
            out[orbital] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
    return out.dropna(subset=["Energy_rel"]).sort_values("Energy_rel").reset_index(drop=True)


def apply_cross_sections(pdos: pd.DataFrame, factors: dict[str, float]) -> pd.DataFrame:
    out = pdos.copy()
    for col in out.columns:
        if col == "Energy_rel":
            continue
        factor = factors.get(col, 1.0)
        for group, aliases in FACTOR_ALIASES.items():
            if col in aliases:
                factor *= factors.get(group, 1.0)
        out[col] = out[col].to_numpy(float) * factor
    return out


def _kernel(grid: np.ndarray, kind: str, gaussian_fwhm: float, lorentzian_fwhm: float) -> np.ndarray:
    dx = float(np.median(np.diff(grid))) if len(grid) > 2 else 0.02
    half_width = max(gaussian_fwhm, lorentzian_fwhm, dx) * 8
    kx = np.arange(-half_width, half_width + dx, dx)
    if kind == "gaussian":
        sigma = gaussian_fwhm / 2.354820045 if gaussian_fwhm > 0 else dx
        k = np.exp(-0.5 * (kx / sigma) ** 2)
    elif kind == "lorentzian":
        gamma = lorentzian_fwhm / 2 if lorentzian_fwhm > 0 else dx
        k = gamma**2 / (kx**2 + gamma**2)
    elif kind == "voigt":
        sigma = gaussian_fwhm / 2.354820045 if gaussian_fwhm > 0 else dx
        gamma = lorentzian_fwhm / 2 if lorentzian_fwhm > 0 else dx
        z = (kx + 1j * gamma) / (sigma * np.sqrt(2))
        k = np.real(wofz(z)) / (sigma * np.sqrt(2 * np.pi))
    else:
        k = np.array([1.0])
    s = np.sum(k)
    return k / s if s else k


def broaden_pdos(pdos: pd.DataFrame, kind: str, gaussian_fwhm: float = 0.35, lorentzian_fwhm: float = 0.40) -> pd.DataFrame:
    if kind == "none":
        return pdos.copy()
    out = pdos.copy()
    grid = out["Energy_rel"].to_numpy(float)
    k = _kernel(grid, kind, gaussian_fwhm, lorentzian_fwhm)
    for col in out.columns:
        if col != "Energy_rel":
            out[col] = fftconvolve(out[col].to_numpy(float), k, mode="same")
    return out


def interpolate_components(pdos: pd.DataFrame, target_energy: np.ndarray) -> dict[str, np.ndarray]:
    grid = pdos["Energy_rel"].to_numpy(float)
    return {col: np.interp(target_energy, grid, pdos[col].to_numpy(float), left=0.0, right=0.0) for col in pdos.columns if col != "Energy_rel"}
