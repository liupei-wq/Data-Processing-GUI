"""Global Gaussian component fitting for multiple XAS spectra.

The small-peak correction deliberately subtracts only the fitted Gaussian.
Its local background is retained in the corrected spectrum.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy.optimize import least_squares


_FWHM_FACTOR = 2.0 * np.sqrt(2.0 * np.log(2.0))
_GAUSSIAN_AREA_FACTOR = np.sqrt(np.pi / (4.0 * np.log(2.0)))


def gaussian_height(x: np.ndarray, height: float, center: float, fwhm: float) -> np.ndarray:
    width = max(float(fwhm), 1e-9)
    return float(height) * np.exp(-4.0 * np.log(2.0) * ((x - float(center)) / width) ** 2)


def _finite_spectrum(dataset: dict[str, Any]) -> tuple[str, np.ndarray, np.ndarray]:
    name = str(dataset.get("name") or "sample")
    x = np.asarray(dataset.get("x", []), dtype=float)
    y = np.asarray(dataset.get("y", []), dtype=float)
    if x.size != y.size:
        raise ValueError(f"{name}：x/y 長度不一致")
    mask = np.isfinite(x) & np.isfinite(y)
    x = x[mask]
    y = y[mask]
    if x.size < 6:
        raise ValueError(f"{name}：有效資料點不足")
    order = np.argsort(x)
    return name, x[order], y[order]


def _range_mask(x: np.ndarray, bounds: list[float] | tuple[float, float], minimum: int = 4) -> np.ndarray:
    lo, hi = sorted((float(bounds[0]), float(bounds[1])))
    mask = (x >= lo) & (x <= hi)
    if int(mask.sum()) < minimum:
        raise ValueError(f"擬合範圍 {lo:g}–{hi:g} eV 內資料點不足")
    return mask


def _small_peak_fit(
    x: np.ndarray,
    y: np.ndarray,
    config: dict[str, Any],
) -> dict[str, Any]:
    mask = _range_mask(x, config["range"], minimum=5)
    xf = x[mask]
    yf = y[mask]
    center0 = float(config["center"])
    fwhm0 = max(float(config["fwhm"]), 0.01)
    center_min, center_max = sorted((float(config["center_min"]), float(config["center_max"])))
    fwhm_min, fwhm_max = sorted((max(float(config["fwhm_min"]), 0.01), max(float(config["fwhm_max"]), 0.01)))
    background_type = str(config.get("background", "linear"))
    x_ref = float(np.mean(xf))
    edge_count = max(1, min(3, xf.size // 3))
    baseline0 = float(np.median(np.r_[yf[:edge_count], yf[-edge_count:]]))
    height0 = max(float(np.max(yf) - baseline0), float(np.ptp(yf)) * 0.1, 1e-9)

    p0: list[float] = [height0, baseline0]
    lower: list[float] = [0.0, -np.inf]
    upper: list[float] = [max(height0 * 10.0, float(np.ptp(yf)) * 20.0, 1.0), np.inf]
    center_idx: int | None = None
    fwhm_idx: int | None = None
    slope_idx: int | None = None
    if not bool(config.get("lock_center", False)):
        center_idx = len(p0)
        p0.append(float(np.clip(center0, center_min, center_max)))
        lower.append(center_min)
        upper.append(max(center_max, center_min + 1e-9))
    if not bool(config.get("lock_fwhm", False)):
        fwhm_idx = len(p0)
        p0.append(float(np.clip(fwhm0, fwhm_min, fwhm_max)))
        lower.append(fwhm_min)
        upper.append(max(fwhm_max, fwhm_min + 1e-9))
    if background_type == "linear":
        slope_idx = len(p0)
        p0.append(0.0)
        lower.append(-np.inf)
        upper.append(np.inf)

    def unpack(params: np.ndarray) -> tuple[float, float, float, float, float]:
        height = float(params[0])
        intercept = float(params[1])
        center = float(params[center_idx]) if center_idx is not None else center0
        fwhm = float(params[fwhm_idx]) if fwhm_idx is not None else fwhm0
        slope = float(params[slope_idx]) if slope_idx is not None else 0.0
        return height, center, fwhm, intercept, slope

    def model(x_values: np.ndarray, params: np.ndarray) -> np.ndarray:
        height, center, fwhm, intercept, slope = unpack(params)
        return gaussian_height(x_values, height, center, fwhm) + intercept + slope * (x_values - x_ref)

    result = least_squares(
        lambda params: yf - model(xf, params),
        np.asarray(p0),
        bounds=(np.asarray(lower), np.asarray(upper)),
        max_nfev=12000,
    )
    height, center, fwhm, intercept, slope = unpack(result.x)
    component = gaussian_height(x, height, center, fwhm)
    background = intercept + slope * (x - x_ref)
    return {
        "center": center,
        "fwhm": fwhm,
        "height": height,
        "area": height * fwhm * _GAUSSIAN_AREA_FACTOR,
        "background_intercept": intercept,
        "background_slope": slope,
        "component": component,
        "background": background,
        "corrected": y - component,
    }


def fit_xas_global_components(
    datasets: list[dict[str, Any]],
    small_peak: dict[str, Any],
    main_peaks: list[dict[str, Any]],
    fit_range: list[float] | tuple[float, float],
    main_background: str = "linear",
    ratio_numerator: str | None = None,
    ratio_denominator: str | None = None,
    max_nfev: int = 30000,
) -> dict[str, Any]:
    """Fit shared main-peak centers/FWHMs and sample-specific heights/backgrounds."""
    if not datasets:
        raise ValueError("請至少提供一筆光譜")
    if not main_peaks:
        raise ValueError("請至少設定一個主峰")
    names = [str(pk.get("label") or f"Peak {index + 1}") for index, pk in enumerate(main_peaks)]
    if len(set(names)) != len(names):
        raise ValueError("主峰名稱不可重複")

    spectra = [_finite_spectrum(dataset) for dataset in datasets]
    small_results = [_small_peak_fit(x, y, small_peak) for _, x, y in spectra]
    fit_masks = [_range_mask(x, fit_range, minimum=max(6, len(main_peaks) * 2)) for _, x, _ in spectra]

    p0: list[float] = []
    lower: list[float] = []
    upper: list[float] = []
    peak_specs: list[dict[str, Any]] = []
    for index, peak in enumerate(main_peaks):
        center = float(peak["center"])
        fwhm = max(float(peak["fwhm"]), 0.01)
        center_min, center_max = sorted((float(peak["center_min"]), float(peak["center_max"])))
        fwhm_min, fwhm_max = sorted((max(float(peak["fwhm_min"]), 0.01), max(float(peak["fwhm_max"]), 0.01)))
        spec: dict[str, Any] = {"label": names[index], "center": center, "fwhm": fwhm}
        if bool(peak.get("lock_center", False)):
            spec["center_idx"] = None
        else:
            spec["center_idx"] = len(p0)
            p0.append(float(np.clip(center, center_min, center_max)))
            lower.append(center_min)
            upper.append(max(center_max, center_min + 1e-9))
        if bool(peak.get("lock_fwhm", False)):
            spec["fwhm_idx"] = None
        else:
            spec["fwhm_idx"] = len(p0)
            p0.append(float(np.clip(fwhm, fwhm_min, fwhm_max)))
            lower.append(fwhm_min)
            upper.append(max(fwhm_max, fwhm_min + 1e-9))
        peak_specs.append(spec)

    sample_specs: list[dict[str, Any]] = []
    for (_, x, _), small, mask in zip(spectra, small_results, fit_masks):
        xf = x[mask]
        yf = small["corrected"][mask]
        baseline0 = float(np.percentile(yf, 10))
        span = max(float(np.ptp(yf)), float(np.max(np.abs(yf))), 1.0)
        height_indices: list[int] = []
        for peak in peak_specs:
            height_indices.append(len(p0))
            seed = max(float(np.interp(peak["center"], xf, yf) - baseline0), span * 0.05, 1e-9)
            p0.append(seed)
            lower.append(0.0)
            upper.append(max(seed * 10.0, span * 20.0))
        intercept_idx = len(p0)
        p0.append(baseline0)
        lower.append(-np.inf)
        upper.append(np.inf)
        slope_idx: int | None = None
        if main_background == "linear":
            slope_idx = len(p0)
            p0.append(0.0)
            lower.append(-np.inf)
            upper.append(np.inf)
        sample_specs.append({
            "height_indices": height_indices,
            "intercept_idx": intercept_idx,
            "slope_idx": slope_idx,
            "x_ref": float(np.mean(xf)),
        })

    def shared_shape(params: np.ndarray, index: int) -> tuple[float, float]:
        spec = peak_specs[index]
        center = float(params[spec["center_idx"]]) if spec["center_idx"] is not None else float(spec["center"])
        fwhm = float(params[spec["fwhm_idx"]]) if spec["fwhm_idx"] is not None else float(spec["fwhm"])
        return center, fwhm

    def sample_model(x_values: np.ndarray, params: np.ndarray, sample_index: int) -> np.ndarray:
        spec = sample_specs[sample_index]
        output = np.full_like(x_values, float(params[spec["intercept_idx"]]), dtype=float)
        if spec["slope_idx"] is not None:
            output += float(params[spec["slope_idx"]]) * (x_values - spec["x_ref"])
        for peak_index, height_index in enumerate(spec["height_indices"]):
            center, fwhm = shared_shape(params, peak_index)
            output += gaussian_height(x_values, float(params[height_index]), center, fwhm)
        return output

    def objective(params: np.ndarray) -> np.ndarray:
        residual_blocks = []
        for sample_index, ((_, x, _), small, mask) in enumerate(zip(spectra, small_results, fit_masks)):
            residual_blocks.append(small["corrected"][mask] - sample_model(x[mask], params, sample_index))
        return np.concatenate(residual_blocks)

    result = least_squares(
        objective,
        np.asarray(p0),
        bounds=(np.asarray(lower), np.asarray(upper)),
        max_nfev=max(2000, min(int(max_nfev), 100000)),
        loss="soft_l1",
    )
    if not result.success and not np.all(np.isfinite(result.x)):
        raise ValueError(f"全域擬合失敗：{result.message}")

    shared_peaks = []
    for peak_index, peak in enumerate(peak_specs):
        center, fwhm = shared_shape(result.x, peak_index)
        shared_peaks.append({"label": peak["label"], "center": center, "fwhm": fwhm})

    output_datasets = []
    for sample_index, ((name, x, y), small, mask) in enumerate(zip(spectra, small_results, fit_masks)):
        spec = sample_specs[sample_index]
        background = np.full_like(x, float(result.x[spec["intercept_idx"]]), dtype=float)
        slope = float(result.x[spec["slope_idx"]]) if spec["slope_idx"] is not None else 0.0
        background += slope * (x - spec["x_ref"])
        components = []
        peak_rows = []
        area_by_label: dict[str, float] = {}
        for peak_index, height_index in enumerate(spec["height_indices"]):
            center, fwhm = shared_shape(result.x, peak_index)
            height = float(result.x[height_index])
            component = gaussian_height(x, height, center, fwhm)
            area = height * fwhm * _GAUSSIAN_AREA_FACTOR
            label = peak_specs[peak_index]["label"]
            components.append(component.tolist())
            peak_rows.append({"label": label, "center": center, "fwhm": fwhm, "height": height, "area": area})
            area_by_label[label] = area
        total_fit = background + np.sum(np.asarray(components), axis=0)
        corrected = small["corrected"]
        residual = corrected - total_fit
        observed = corrected[mask]
        fitted = total_fit[mask]
        ss_res = float(np.sum((observed - fitted) ** 2))
        ss_tot = float(np.sum((observed - np.mean(observed)) ** 2))
        ratio = None
        denominator = area_by_label.get(ratio_denominator or "")
        numerator = area_by_label.get(ratio_numerator or "")
        if numerator is not None and denominator is not None and abs(denominator) > 1e-15:
            ratio = numerator / denominator
        output_datasets.append({
            "name": name,
            "x": x.tolist(),
            "original": y.tolist(),
            "small_peak": {
                "center": small["center"],
                "fwhm": small["fwhm"],
                "height": small["height"],
                "area": small["area"],
                "component": small["component"].tolist(),
                "local_background": small["background"].tolist(),
            },
            "corrected": corrected.tolist(),
            "background": background.tolist(),
            "components": components,
            "total_fit": total_fit.tolist(),
            "residual": residual.tolist(),
            "peaks": peak_rows,
            "area_ratio": ratio,
            "r_squared": 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0,
            "rmse": float(np.sqrt(np.mean((observed - fitted) ** 2))),
        })

    return {
        "success": True,
        "message": str(result.message),
        "shared_peaks": shared_peaks,
        "ratio_numerator": ratio_numerator,
        "ratio_denominator": ratio_denominator,
        "datasets": output_datasets,
    }
