"""XES API endpoints — 1D spectrum mode (FITS mode deferred)."""

from __future__ import annotations

from typing import List, Optional

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from scipy.interpolate import interp1d

from core.parsers import parse_two_column_spectrum_bytes
from core.processing import apply_normalization, smooth_signal
from core.spectrum_ops import detect_spectrum_peaks, interpolate_spectrum_to_grid, mean_spectrum_arrays
from db.xes_database import XES_REFERENCES, xes_reference_records

router = APIRouter()


# ── pydantic models ───────────────────────────────────────────────────────────

class ParsedSpectrum(BaseModel):
    name: str
    x: List[float]
    y: List[float]
    n_points: int


class ParseResponse(BaseModel):
    samples: List[ParsedSpectrum]
    bg1: Optional[ParsedSpectrum] = None
    bg2: Optional[ParsedSpectrum] = None
    errors: List[str] = Field(default_factory=list)


class DatasetInput(BaseModel):
    name: str
    x: List[float]
    y: List[float]


class ProcessParams(BaseModel):
    interpolate: bool = False
    n_points: int = 1000
    average: bool = False
    # BG1/BG2 subtraction
    bg_method: str = "none"       # none | bg1 | bg2 | average | interpolated
    bg_order: str = "upload"      # upload | filename (weights for interpolated)
    # smoothing
    smooth_method: str = "none"   # none | moving_average | savitzky_golay
    smooth_window: int = 5
    smooth_poly: int = 3
    # normalization
    norm_method: str = "none"     # none | min_max | max | area | reference_region
    norm_x_start: Optional[float] = None
    norm_x_end: Optional[float] = None
    # X-axis calibration (pixel → eV)
    axis_calibration: str = "none"  # none | linear
    energy_offset: float = 0.0
    energy_slope: float = 1.0


class ProcessRequest(BaseModel):
    samples: List[DatasetInput]
    bg1: Optional[DatasetInput] = None
    bg2: Optional[DatasetInput] = None
    params: ProcessParams


class DatasetOutput(BaseModel):
    name: str
    x_pixel: List[float]
    x_ev: Optional[List[float]] = None
    y_raw: List[float]
    y_bg: Optional[List[float]] = None
    y_corrected: List[float]
    y_processed: List[float]


class ProcessResponse(BaseModel):
    datasets: List[DatasetOutput]
    average: Optional[DatasetOutput] = None


class PeakDetectParams(BaseModel):
    x: List[float]
    y: List[float]
    prominence: float = 0.05
    min_distance: float = 1.0
    max_peaks: int = 20


class DetectedPeak(BaseModel):
    x: float
    intensity: float
    rel_intensity: float
    fwhm: Optional[float] = None


class PeakDetectResponse(BaseModel):
    peaks: List[DetectedPeak]


class ReferencePeaksRequest(BaseModel):
    materials: List[str]


class ReferencePeak(BaseModel):
    material: str
    label: str
    energy_eV: float
    tolerance_eV: float
    relative_intensity: float
    meaning: str


class ReferencePeaksResponse(BaseModel):
    peaks: List[ReferencePeak]


# ── helpers ───────────────────────────────────────────────────────────────────

def _parse_spectrum_bytes(raw: bytes, name: str) -> tuple[np.ndarray | None, np.ndarray | None, str | None]:
    x, y, err = parse_two_column_spectrum_bytes(raw)
    if err or x is None or y is None:
        return None, None, err or "解析失敗"
    if len(x) < 2:
        return None, None, "資料點不足"
    # ensure ascending x, no duplicates
    order = np.argsort(x)
    x, y = x[order], y[order]
    mask = np.concatenate(([True], np.diff(x) > 1e-12))
    return x[mask].astype(float), y[mask].astype(float), None


def _interp_to(x_src: np.ndarray, y_src: np.ndarray, x_target: np.ndarray) -> np.ndarray:
    if len(x_src) < 2:
        return np.zeros_like(x_target, dtype=float)
    f = interp1d(x_src, y_src, kind="linear", bounds_error=False, fill_value=0.0)
    return f(x_target)


def _bg_weight(pos: int, total: int) -> float:
    return float(pos + 1) / float(total + 1) if total > 0 else 0.5


def _apply_calibration(x_pixel: np.ndarray, offset: float, slope: float) -> np.ndarray:
    return offset + slope * x_pixel


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/parse", response_model=ParseResponse)
async def parse_xes_files(
    files: List[UploadFile] = File(...),
    bg1_file: Optional[UploadFile] = File(default=None),
    bg2_file: Optional[UploadFile] = File(default=None),
):
    samples: list[ParsedSpectrum] = []
    errors: list[str] = []

    for uf in files:
        raw = await uf.read()
        x, y, err = _parse_spectrum_bytes(raw, uf.filename or "")
        if err:
            errors.append(f"{uf.filename}: {err}")
        else:
            samples.append(ParsedSpectrum(name=uf.filename or "unknown", x=x.tolist(), y=y.tolist(), n_points=len(x)))

    bg1_out: ParsedSpectrum | None = None
    if bg1_file is not None:
        raw = await bg1_file.read()
        x, y, err = _parse_spectrum_bytes(raw, bg1_file.filename or "")
        if err:
            errors.append(f"BG1 {bg1_file.filename}: {err}")
        else:
            bg1_out = ParsedSpectrum(name=bg1_file.filename or "BG1", x=x.tolist(), y=y.tolist(), n_points=len(x))

    bg2_out: ParsedSpectrum | None = None
    if bg2_file is not None:
        raw = await bg2_file.read()
        x, y, err = _parse_spectrum_bytes(raw, bg2_file.filename or "")
        if err:
            errors.append(f"BG2 {bg2_file.filename}: {err}")
        else:
            bg2_out = ParsedSpectrum(name=bg2_file.filename or "BG2", x=x.tolist(), y=y.tolist(), n_points=len(x))

    return ParseResponse(samples=samples, bg1=bg1_out, bg2=bg2_out, errors=errors)


@router.post("/process", response_model=ProcessResponse)
def process_xes(req: ProcessRequest):
    p = req.params
    if not req.samples:
        raise HTTPException(status_code=400, detail="沒有 sample 資料集")

    bg1_x = np.array(req.bg1.x) if req.bg1 else None
    bg1_y = np.array(req.bg1.y) if req.bg1 else None
    bg2_x = np.array(req.bg2.x) if req.bg2 else None
    bg2_y = np.array(req.bg2.y) if req.bg2 else None

    n = len(req.samples)
    outputs: list[DatasetOutput] = []

    for idx, ds in enumerate(req.samples):
        x = np.array(ds.x, dtype=float)
        y = np.array(ds.y, dtype=float)

        if p.interpolate:
            x_grid = np.linspace(float(x.min()), float(x.max()), int(p.n_points))
            y = np.interp(x_grid, x, y)
            x = x_grid

        y_raw = y.copy()

        # BG1/BG2 subtraction
        y_bg: np.ndarray | None = None
        if p.bg_method != "none":
            bg1_interp = _interp_to(bg1_x, bg1_y, x) if (bg1_x is not None) else None
            bg2_interp = _interp_to(bg2_x, bg2_y, x) if (bg2_x is not None) else None

            if p.bg_method == "bg1" and bg1_interp is not None:
                y_bg = bg1_interp
            elif p.bg_method == "bg2" and bg2_interp is not None:
                y_bg = bg2_interp
            elif p.bg_method == "average" and bg1_interp is not None and bg2_interp is not None:
                y_bg = 0.5 * (bg1_interp + bg2_interp)
            elif p.bg_method == "interpolated" and bg1_interp is not None and bg2_interp is not None:
                w = _bg_weight(idx, n)
                y_bg = bg1_interp + w * (bg2_interp - bg1_interp)

            if y_bg is not None:
                y = np.nan_to_num(y - y_bg, nan=0.0)

        y_corrected = y.copy()

        # smoothing
        if p.smooth_method != "none":
            y, _ = smooth_signal(y, method=p.smooth_method, window_points=p.smooth_window, poly_deg=p.smooth_poly)

        # normalization
        if p.norm_method != "none":
            _, y = apply_normalization(x, y, norm_method=p.norm_method, x_start=p.norm_x_start, x_end=p.norm_x_end)

        # X-axis calibration
        x_ev: np.ndarray | None = None
        if p.axis_calibration == "linear":
            x_ev = _apply_calibration(x, p.energy_offset, p.energy_slope)

        outputs.append(DatasetOutput(
            name=ds.name,
            x_pixel=x.tolist(),
            x_ev=x_ev.tolist() if x_ev is not None else None,
            y_raw=y_raw.tolist(),
            y_bg=y_bg.tolist() if y_bg is not None else None,
            y_corrected=y_corrected.tolist(),
            y_processed=y.tolist(),
        ))

    # average
    average_out: DatasetOutput | None = None
    if p.average and len(outputs) > 1:
        try:
            x_ref = np.array(outputs[0].x_pixel)
            arrs = [np.interp(x_ref, np.array(d.x_pixel), np.array(d.y_processed)) for d in outputs]
            y_avg = np.mean(arrs, axis=0)
            x_ev_ref = np.array(outputs[0].x_ev) if outputs[0].x_ev else None
            average_out = DatasetOutput(
                name="平均",
                x_pixel=x_ref.tolist(),
                x_ev=x_ev_ref.tolist() if x_ev_ref is not None else None,
                y_raw=y_avg.tolist(),
                y_corrected=y_avg.tolist(),
                y_processed=y_avg.tolist(),
            )
        except Exception:
            pass

    return ProcessResponse(datasets=outputs, average=average_out)


@router.post("/peaks", response_model=PeakDetectResponse)
def detect_xes_peaks(req: PeakDetectParams):
    x = np.array(req.x, dtype=float)
    y = np.array(req.y, dtype=float)
    if len(x) < 4:
        return PeakDetectResponse(peaks=[])
    y_max = float(y.max())
    if y_max == 0:
        return PeakDetectResponse(peaks=[])

    peaks_raw = detect_spectrum_peaks(
        x, y,
        prominence=req.prominence * y_max,
        min_distance_x=req.min_distance,
        max_peaks=req.max_peaks,
    )

    detected: list[DetectedPeak] = []
    for pk in peaks_raw:
        detected.append(DetectedPeak(
            x=float(pk.get("two_theta", pk.get("x", 0))),
            intensity=float(pk.get("intensity", 0)),
            rel_intensity=float(pk.get("rel_intensity", 0)),
            fwhm=float(pk["fwhm_deg"]) if pk.get("fwhm_deg") else None,
        ))
    return PeakDetectResponse(peaks=detected)


@router.get("/references")
def list_xes_references():
    return {"materials": list(XES_REFERENCES.keys())}


@router.post("/reference-peaks", response_model=ReferencePeaksResponse)
def get_xes_reference_peaks(req: ReferencePeaksRequest):
    records = xes_reference_records(req.materials or None)
    peaks: list[ReferencePeak] = []
    for r in records:
        if r.get("Reference_Energy_eV") is None:
            continue
        peaks.append(ReferencePeak(
            material=str(r["Material"]),
            label=str(r["Reference_Label"]),
            energy_eV=float(r["Reference_Energy_eV"]),
            tolerance_eV=float(r.get("Tolerance_eV", 2.0)),
            relative_intensity=float(r.get("Relative_Intensity", 100)),
            meaning=str(r.get("Meaning", "")),
        ))
    return ReferencePeaksResponse(peaks=peaks)
