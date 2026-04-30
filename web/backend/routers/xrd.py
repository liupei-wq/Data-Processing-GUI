"""XRD API endpoints.

Endpoints
---------
POST /api/xrd/parse           Upload raw files → get x/y arrays back
POST /api/xrd/process         Apply smooth + normalize to stored arrays
POST /api/xrd/peaks           Auto-detect peaks and return 2θ / d-spacing table
GET  /api/xrd/references      List available reference materials
POST /api/xrd/reference-peaks Get reference peaks in 2θ for selected materials
"""

from __future__ import annotations

import math
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel, Field
from scipy.signal import find_peaks, peak_widths

from core.parsers import parse_two_column_spectrum_bytes
from core.processing import smooth_signal, apply_normalization, apply_background
from core.spectrum_ops import (
    fit_fixed_gaussian_templates,
    interpolate_spectrum_to_grid,
    mean_spectrum_arrays,
)
from db.xrd_database import XRD_REFERENCES

router = APIRouter()

# ── wavelength presets (Å) ────────────────────────────────────────────────────
WAVELENGTHS = {
    "Cu Kα (1.5406 Å)": 1.5406,
    "Cu Kα1 (1.5406 Å)": 1.5406,
    "Co Kα (1.7890 Å)": 1.7890,
    "Mo Kα (0.7093 Å)": 0.7093,
    "Cr Kα (2.2909 Å)": 2.2909,
    "Fe Kα (1.9373 Å)": 1.9373,
}


def _d_to_two_theta(d: float, wavelength: float) -> Optional[float]:
    """Bragg's law: 2θ in degrees. Returns None if physically impossible."""
    ratio = wavelength / (2.0 * d)
    if abs(ratio) > 1.0:
        return None
    return math.degrees(2.0 * math.asin(ratio))


def _two_theta_to_d(two_theta_deg: float, wavelength: float) -> float:
    """Bragg's law: d-spacing in Å."""
    theta = math.radians(two_theta_deg / 2.0)
    return wavelength / (2.0 * math.sin(theta))


# ── Pydantic models ───────────────────────────────────────────────────────────

class DatasetInput(BaseModel):
    name: str
    x: List[float]
    y: List[float]


class ProcessParams(BaseModel):
    interpolate: bool = False
    n_points: int = 1000
    average: bool = False
    bg_enabled: bool = False
    bg_method: str = "none"           # none | linear | shirley | polynomial | asls | airpls
    bg_x_start: Optional[float] = None
    bg_x_end: Optional[float] = None
    bg_poly_deg: int = 3
    bg_baseline_lambda: float = 1e5
    bg_baseline_p: float = 0.01
    bg_baseline_iter: int = 20
    gaussian_enabled: bool = False
    gaussian_fwhm: float = 0.2
    gaussian_height: float = 100.0
    gaussian_search_half_width: float = 0.5
    gaussian_centers: List["GaussianCenterInput"] = Field(default_factory=list)
    smooth_method: str = "none"       # none | moving_average | savitzky_golay
    smooth_window: int = 11
    smooth_poly: int = 3
    norm_method: str = "none"         # none | min_max | max | area
    norm_x_start: Optional[float] = None
    norm_x_end: Optional[float] = None


class ProcessRequest(BaseModel):
    datasets: List[DatasetInput]
    params: ProcessParams


class GaussianCenterInput(BaseModel):
    enabled: bool = True
    name: str = ""
    center: float


class GaussianFitRow(BaseModel):
    Peak_Name: str
    Seed_Center: float
    Fitted_Center: float
    Shift: float
    Fixed_FWHM: float
    Fixed_Area: float
    Template_Height: float


class DatasetOutput(BaseModel):
    name: str
    x: List[float]
    y_raw: List[float]
    y_background: Optional[List[float]] = None
    y_gaussian_model: Optional[List[float]] = None
    y_gaussian_subtracted: Optional[List[float]] = None
    y_processed: List[float]
    gaussian_fits: List[GaussianFitRow] = Field(default_factory=list)


class ProcessResponse(BaseModel):
    datasets: List[DatasetOutput]
    average: Optional[DatasetOutput] = None


class PeakDetectRequest(BaseModel):
    x: List[float]
    y: List[float]
    prominence: float = 0.05
    min_distance: float = 0.3
    max_peaks: int = 30
    wavelength: float = 1.5406
    include_weak_peaks: bool = True
    weak_peak_threshold: float = 10.0
    min_snr: float = 1.0
    min_prominence: float = 0.0


class PeakRow(BaseModel):
    two_theta: float
    d_spacing: float
    intensity: float
    rel_intensity: float
    fwhm_deg: float
    snr: float
    prominence: float
    confidence: str
    note: str


class PeakDetectResponse(BaseModel):
    peaks: List[PeakRow]


class RefPeaksRequest(BaseModel):
    materials: List[str]
    wavelength: float = 1.5406


class RefPeak(BaseModel):
    material: str
    phase: str
    hkl: str
    two_theta: float
    d_spacing: float
    rel_i: float
    source: str = "Built-in XRD reference library"
    tolerance: float = 0.3


class RefPeaksResponse(BaseModel):
    peaks: List[RefPeak]


ProcessParams.model_rebuild()


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/parse", summary="Parse uploaded XRD files")
async def parse_files(files: List[UploadFile] = File(...)):
    """
    Upload one or more XRD text files (.txt / .csv / .xy / .asc).
    Returns raw x (2θ) and y (intensity) arrays for each file.
    """
    results = []
    for f in files:
        raw = await f.read()
        x, y, err = parse_two_column_spectrum_bytes(raw)
        if err or x is None:
            raise HTTPException(status_code=400, detail=f"{f.filename}: {err or '解析失敗'}")
        results.append({"name": f.filename, "x": x.tolist(), "y": y.tolist()})
    return {"files": results}


@router.post("/process", response_model=ProcessResponse, summary="Process XRD data")
def process_data(req: ProcessRequest):
    """
    Apply interpolation, optional background subtraction, optional fixed Gaussian subtraction,
    smoothing, and normalization.

    Processing order: interpolate → average → background subtraction → Gaussian subtraction → smooth → normalize
    """
    if not req.datasets:
        raise HTTPException(status_code=400, detail="No datasets provided")

    params = req.params
    datasets = req.datasets

    # ── 1. Interpolate each file to a fixed grid ──────────────────────────────
    processed_pairs: list[tuple[str, np.ndarray, np.ndarray]] = []
    for ds in datasets:
        x = np.array(ds.x, dtype=float)
        y = np.array(ds.y, dtype=float)
        if (params.interpolate or params.gaussian_enabled) and params.n_points >= 2:
            x_grid = np.linspace(x.min(), x.max(), params.n_points)
            y = interpolate_spectrum_to_grid(x, y, x_grid)
            x = x_grid
        processed_pairs.append((ds.name, x, y))

    # ── 2. Average across files ───────────────────────────────────────────────
    average_output: Optional[DatasetOutput] = None
    if params.average and len(processed_pairs) > 1:
        # Shared overlap range
        x_min = max(p[1].min() for p in processed_pairs)
        x_max = min(p[1].max() for p in processed_pairs)
        if x_min >= x_max:
            raise HTTPException(status_code=400, detail="Files have no overlapping x range")
        x_grid = np.linspace(
            x_min,
            x_max,
            params.n_points if (params.interpolate or params.gaussian_enabled) else 500,
        )
        interped = [interpolate_spectrum_to_grid(x, y, x_grid) for _, x, y in processed_pairs]
        y_avg = mean_spectrum_arrays(interped)
        average_output = _build_dataset_output("Average", x_grid, y_avg, params)

    # ── 3. Smooth + normalize each dataset ───────────────────────────────────
    output_datasets: list[DatasetOutput] = []
    for name, x, y in processed_pairs:
        output_datasets.append(_build_dataset_output(name, x, y, params))

    return ProcessResponse(datasets=output_datasets, average=average_output)


def _apply_smooth_norm(x: np.ndarray, y: np.ndarray, params: ProcessParams) -> np.ndarray:
    """Smooth then normalize."""
    y_out = smooth_signal(y, method=params.smooth_method,
                          window_points=params.smooth_window,
                          poly_deg=params.smooth_poly)
    y_out = apply_normalization(x, y_out,
                                norm_method=params.norm_method,
                                norm_x_start=params.norm_x_start,
                                norm_x_end=params.norm_x_end)
    return y_out


def _build_dataset_output(name: str, x: np.ndarray, y: np.ndarray, params: ProcessParams) -> DatasetOutput:
    background_curve: Optional[np.ndarray] = None
    gaussian_model: Optional[np.ndarray] = None
    gaussian_subtracted: Optional[np.ndarray] = None
    gaussian_fits: list[GaussianFitRow] = []
    smooth_input = y

    if params.bg_enabled and params.bg_method != "none":
        bg_start = float(params.bg_x_start) if params.bg_x_start is not None else float(np.min(x))
        bg_end = float(params.bg_x_end) if params.bg_x_end is not None else float(np.max(x))
        bg_subtracted, background_curve = apply_background(
            x,
            y,
            params.bg_method,
            bg_start,
            bg_end,
            poly_deg=int(params.bg_poly_deg),
            baseline_lambda=float(params.bg_baseline_lambda),
            baseline_p=float(params.bg_baseline_p),
            baseline_iter=int(params.bg_baseline_iter),
        )
        smooth_input = bg_subtracted

    if params.gaussian_enabled:
        fixed_area = float(params.gaussian_height) * float(params.gaussian_fwhm) * 1.0645
        centers = [center.model_dump() for center in params.gaussian_centers]
        model_arr, subtracted_arr, fit_rows = fit_fixed_gaussian_templates(
            x,
            y,
            centers,
            fixed_fwhm=float(params.gaussian_fwhm),
            fixed_area=fixed_area,
            search_half_width=float(params.gaussian_search_half_width),
        )
        gaussian_model = model_arr
        gaussian_subtracted = subtracted_arr
        smooth_input = subtracted_arr
        gaussian_fits = [GaussianFitRow(**row) for row in fit_rows]

    y_proc = _apply_smooth_norm(x, smooth_input, params)
    return DatasetOutput(
        name=name,
        x=x.tolist(),
        y_raw=y.tolist(),
        y_background=None if background_curve is None else background_curve.tolist(),
        y_gaussian_model=None if gaussian_model is None else gaussian_model.tolist(),
        y_gaussian_subtracted=None if gaussian_subtracted is None else gaussian_subtracted.tolist(),
        y_processed=y_proc.tolist(),
        gaussian_fits=gaussian_fits,
    )


@router.post("/peaks", response_model=PeakDetectResponse, summary="Auto-detect XRD peaks")
def detect_peaks(req: PeakDetectRequest):
    """
    Detect peaks in a processed XRD pattern.
    Returns 2θ positions, d-spacings, intensities, and relative intensities.
    """
    x = np.array(req.x, dtype=float)
    y = np.array(req.y, dtype=float)

    dx = np.diff(x)
    dx = dx[np.isfinite(dx) & (dx > 0)]
    median_dx = float(np.median(dx)) if len(dx) else 0.0
    distance_pts = max(1, int(round(float(req.min_distance) / median_dx))) if median_dx > 0 else 1

    y_max = float(np.max(y))
    y_min = float(np.min(y))
    y_range = y_max - y_min
    if not np.isfinite(y_range) or y_range <= 0:
        return PeakDetectResponse(peaks=[])

    strong_prominence = max(float(req.prominence), 0.0) * y_range
    detection_prominence = strong_prominence
    if req.include_weak_peaks:
        weak_prominence = max(float(req.min_prominence), strong_prominence * 0.2, y_range * 0.002)
        detection_prominence = min(strong_prominence, weak_prominence) if strong_prominence > 0 else weak_prominence

    find_kwargs = {"prominence": max(detection_prominence, 0.0)}
    if distance_pts > 1:
        find_kwargs["distance"] = distance_pts
    idx, props = find_peaks(y, **find_kwargs)

    if len(idx) == 0:
        return PeakDetectResponse(peaks=[])

    prominences = np.asarray(props.get("prominences", np.zeros(len(idx))), dtype=float)
    baseline = np.percentile(y, 10)
    residual = y - baseline
    noise = 1.4826 * float(np.median(np.abs(residual - np.median(residual))))
    if not np.isfinite(noise) or noise <= 0:
        noise = max(float(np.std(residual)), 1e-12)

    keep_mask = prominences >= max(float(req.min_prominence), 0.0)
    snr_values = prominences / noise
    keep_mask &= snr_values >= max(float(req.min_snr), 0.0)
    if not req.include_weak_peaks:
        keep_mask &= prominences >= strong_prominence
    idx = idx[keep_mask]
    prominences = prominences[keep_mask]
    snr_values = snr_values[keep_mask]

    if len(idx) == 0:
        return PeakDetectResponse(peaks=[])

    if req.max_peaks > 0 and len(idx) > req.max_peaks:
        order = np.argsort(prominences)[::-1][: req.max_peaks]
        order = np.sort(order)
        idx = idx[order]
        prominences = prominences[order]
        snr_values = snr_values[order]

    widths, _, left_ips, right_ips = peak_widths(y, idx, rel_height=0.5)
    sample_axis = np.arange(len(x), dtype=float)
    left_x = np.interp(left_ips, sample_axis, x)
    right_x = np.interp(right_ips, sample_axis, x)

    y_max = float(np.max(y[y > 0])) if np.any(y > 0) else 1.0
    peaks = []
    for pos, i in enumerate(idx):
        tt = float(x[i])
        d = _two_theta_to_d(tt, req.wavelength)
        fwhm_deg = abs(float(right_x[pos] - left_x[pos]))
        rel_intensity = float(y[i]) / y_max * 100
        prominence = float(prominences[pos])
        snr = float(snr_values[pos])
        weak_by_intensity = rel_intensity < float(req.weak_peak_threshold)
        weak_by_prominence = strong_prominence > 0 and prominence < strong_prominence
        if weak_by_intensity or weak_by_prominence:
            confidence = "weak" if snr >= max(float(req.min_snr), 1.0) * 2 else "tentative"
        else:
            confidence = "strong"
        note_parts = []
        if confidence != "strong":
            note_parts.append("weak peak retained")
        if weak_by_intensity:
            note_parts.append(f"relative intensity below {req.weak_peak_threshold:g}%")
        if weak_by_prominence:
            note_parts.append("below strong-peak prominence threshold")
        peaks.append(PeakRow(
            two_theta=round(tt, 4),
            d_spacing=round(d, 4),
            intensity=round(float(y[i]), 2),
            rel_intensity=round(rel_intensity, 1),
            fwhm_deg=round(fwhm_deg, 5),
            snr=round(snr, 2),
            prominence=round(prominence, 5),
            confidence=confidence,
            note="; ".join(note_parts),
        ))

    return PeakDetectResponse(peaks=sorted(peaks, key=lambda p: p.two_theta))


@router.get("/references", summary="List reference materials")
def get_references():
    """Return all available reference material names."""
    return {"materials": list(XRD_REFERENCES.keys())}


@router.post("/reference-peaks", response_model=RefPeaksResponse,
             summary="Get reference peaks in 2θ")
def get_reference_peaks(req: RefPeaksRequest):
    """
    Convert d-spacing reference data to 2θ for the given wavelength.
    Only returns peaks that are physically accessible (2θ < 180°).
    """
    peaks: list[RefPeak] = []
    for material in req.materials:
        ref = XRD_REFERENCES.get(material)
        if not ref:
            continue
        for p in ref["peaks"]:
            tt = _d_to_two_theta(p["d"], req.wavelength)
            if tt is None or tt <= 0 or tt >= 180:
                continue
            peaks.append(RefPeak(
                material=material,
                phase=str(ref.get("phase", material)),
                hkl=p["hkl"],
                two_theta=round(tt, 4),
                d_spacing=round(p["d"], 4),
                rel_i=float(p["rel_i"]),
                source=str(p.get("source", ref.get("source", "Built-in XRD reference library"))),
                tolerance=float(p.get("tolerance", ref.get("tolerance", 0.3))),
            ))

    return RefPeaksResponse(peaks=sorted(peaks, key=lambda p: p.two_theta))
