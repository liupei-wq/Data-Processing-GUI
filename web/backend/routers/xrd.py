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
from pydantic import BaseModel
from scipy.signal import peak_widths

from core.parsers import parse_two_column_spectrum_bytes
from core.processing import smooth_signal, apply_normalization
from core.spectrum_ops import (
    detect_spectrum_peaks,
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
    smooth_method: str = "none"       # none | moving_average | savitzky_golay
    smooth_window: int = 11
    smooth_poly: int = 3
    norm_method: str = "none"         # none | min_max | max | area
    norm_x_start: Optional[float] = None
    norm_x_end: Optional[float] = None


class ProcessRequest(BaseModel):
    datasets: List[DatasetInput]
    params: ProcessParams


class DatasetOutput(BaseModel):
    name: str
    x: List[float]
    y_raw: List[float]
    y_processed: List[float]


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


class PeakRow(BaseModel):
    two_theta: float
    d_spacing: float
    intensity: float
    rel_intensity: float
    fwhm_deg: float


class PeakDetectResponse(BaseModel):
    peaks: List[PeakRow]


class RefPeaksRequest(BaseModel):
    materials: List[str]
    wavelength: float = 1.5406


class RefPeak(BaseModel):
    material: str
    hkl: str
    two_theta: float
    d_spacing: float
    rel_i: float


class RefPeaksResponse(BaseModel):
    peaks: List[RefPeak]


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
    Apply interpolation, averaging, smoothing, and normalization.

    Processing order: interpolate → average → smooth → normalize
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
        if params.interpolate and params.n_points >= 2:
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
        x_grid = np.linspace(x_min, x_max, params.n_points if params.interpolate else 500)
        interped = [interpolate_spectrum_to_grid(x, y, x_grid) for _, x, y in processed_pairs]
        y_avg = mean_spectrum_arrays(interped)
        y_avg_proc = _apply_smooth_norm(x_grid, y_avg, params)
        average_output = DatasetOutput(
            name="Average",
            x=x_grid.tolist(),
            y_raw=y_avg.tolist(),
            y_processed=y_avg_proc.tolist(),
        )

    # ── 3. Smooth + normalize each dataset ───────────────────────────────────
    output_datasets: list[DatasetOutput] = []
    for name, x, y in processed_pairs:
        y_proc = _apply_smooth_norm(x, y, params)
        output_datasets.append(DatasetOutput(
            name=name,
            x=x.tolist(),
            y_raw=y.tolist(),
            y_processed=y_proc.tolist(),
        ))

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


@router.post("/peaks", response_model=PeakDetectResponse, summary="Auto-detect XRD peaks")
def detect_peaks(req: PeakDetectRequest):
    """
    Detect peaks in a processed XRD pattern.
    Returns 2θ positions, d-spacings, intensities, and relative intensities.
    """
    x = np.array(req.x, dtype=float)
    y = np.array(req.y, dtype=float)

    idx = detect_spectrum_peaks(
        x, y,
        prominence_ratio=req.prominence,
        height_ratio=0.0,
        min_distance_x=req.min_distance,
        max_peaks=req.max_peaks,
    )

    if len(idx) == 0:
        return PeakDetectResponse(peaks=[])

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
        peaks.append(PeakRow(
            two_theta=round(tt, 4),
            d_spacing=round(d, 4),
            intensity=round(float(y[i]), 2),
            rel_intensity=round(float(y[i]) / y_max * 100, 1),
            fwhm_deg=round(fwhm_deg, 5),
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
                hkl=p["hkl"],
                two_theta=round(tt, 4),
                d_spacing=round(p["d"], 4),
                rel_i=float(p["rel_i"]),
            ))

    return RefPeaksResponse(peaks=sorted(peaks, key=lambda p: p.two_theta))
