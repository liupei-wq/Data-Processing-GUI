"""Raman API endpoints."""

from __future__ import annotations

from typing import List, Optional

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from core.parsers import parse_two_column_spectrum_bytes
from core.peak_fitting import fit_peaks
from core.processing import apply_background, apply_normalization, despike_signal, smooth_signal
from core.spectrum_ops import detect_spectrum_peaks, interpolate_spectrum_to_grid, mean_spectrum_arrays
from db.raman_database import RAMAN_REFERENCES

router = APIRouter()


class DatasetInput(BaseModel):
    name: str
    x: List[float]
    y: List[float]


class ProcessParams(BaseModel):
    despike_enabled: bool = False
    despike_method: str = "none"      # none | median
    despike_threshold: float = 8.0
    despike_window: int = 7
    despike_passes: int = 1
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
    y_despiked: Optional[List[float]] = None
    y_background: Optional[List[float]] = None
    y_processed: List[float]


class ProcessResponse(BaseModel):
    datasets: List[DatasetOutput]
    average: Optional[DatasetOutput] = None


class PeakDetectRequest(BaseModel):
    x: List[float]
    y: List[float]
    prominence: float = 0.05
    height_ratio: float = 0.0
    min_distance: float = 5.0
    max_peaks: int = 30


class PeakRow(BaseModel):
    shift_cm: float
    intensity: float
    rel_intensity: float


class PeakDetectResponse(BaseModel):
    peaks: List[PeakRow]


class RefPeak(BaseModel):
    material: str
    position_cm: float
    label: str
    strength: float
    note: str


class RefPeaksRequest(BaseModel):
    materials: List[str]


class RefPeaksResponse(BaseModel):
    peaks: List[RefPeak]


class FitPeakInput(BaseModel):
    peak_id: str = ""
    enabled: bool = True
    material: str = ""
    label: str
    display_name: str = ""
    position_cm: float
    fwhm_cm: float
    role: str = ""
    mode_label: str = ""
    note: str = ""
    ref_position_cm: Optional[float] = None


class FitRequest(BaseModel):
    dataset_name: str
    x: List[float]
    y: List[float]
    profile: str = "voigt"
    maxfev: int = 20000
    peaks: List[FitPeakInput]


class FitPeakRow(BaseModel):
    Peak_ID: str
    Peak_Name: str
    Material: str
    Peak_Role: str
    Mode_Label: str
    Ref_cm: Optional[float] = None
    Center_cm: float
    Delta_cm: Optional[float] = None
    FWHM_cm: float
    Area: float
    Area_pct: float
    Source_Note: str = ""
    Is_Doublet: bool = False


class FitResponse(BaseModel):
    success: bool
    message: str = ""
    dataset_name: str
    profile: str
    y_fit: List[float]
    residuals: List[float]
    y_individual: List[List[float]]
    peaks: List[FitPeakRow]
    r_squared: float


@router.post("/parse", summary="Parse uploaded Raman files")
async def parse_files(files: List[UploadFile] = File(...)):
    results = []
    for file in files:
        raw = await file.read()
        x, y, err = parse_two_column_spectrum_bytes(raw)
        if err or x is None:
            raise HTTPException(status_code=400, detail=f"{file.filename}: {err or '解析失敗'}")
        results.append({"name": file.filename, "x": x.tolist(), "y": y.tolist()})
    return {"files": results}


@router.post("/process", response_model=ProcessResponse, summary="Process Raman data")
def process_data(req: ProcessRequest):
    if not req.datasets:
        raise HTTPException(status_code=400, detail="No datasets provided")

    params = req.params
    aligned_pairs: list[tuple[str, np.ndarray, np.ndarray, np.ndarray]] = []
    for ds in req.datasets:
        x = np.asarray(ds.x, dtype=float)
        y_raw = np.asarray(ds.y, dtype=float)
        y_despiked = y_raw.copy()
        if params.despike_enabled and params.despike_method != "none":
            y_despiked, _ = despike_signal(
                y_raw,
                method=params.despike_method,
                threshold=float(params.despike_threshold),
                window_points=int(params.despike_window),
                passes=int(params.despike_passes),
            )

        if (params.interpolate or params.average) and params.n_points >= 2:
            x_grid = np.linspace(float(np.min(x)), float(np.max(x)), int(params.n_points))
            y_raw = interpolate_spectrum_to_grid(x, y_raw, x_grid)
            y_despiked = interpolate_spectrum_to_grid(x, y_despiked, x_grid)
            x = x_grid

        aligned_pairs.append((ds.name, x, y_raw, y_despiked))

    average_output: Optional[DatasetOutput] = None
    if params.average and len(aligned_pairs) > 1:
        x_min = max(pair[1].min() for pair in aligned_pairs)
        x_max = min(pair[1].max() for pair in aligned_pairs)
        if x_min >= x_max:
            raise HTTPException(status_code=400, detail="Files have no overlapping x range")
        x_grid = np.linspace(x_min, x_max, int(params.n_points) if params.n_points >= 2 else 1000)
        raw_stack = [interpolate_spectrum_to_grid(x, y_raw, x_grid) for _, x, y_raw, _ in aligned_pairs]
        despiked_stack = [interpolate_spectrum_to_grid(x, y_despiked, x_grid) for _, x, _, y_despiked in aligned_pairs]
        average_output = _build_dataset_output(
            "Average",
            x_grid,
            mean_spectrum_arrays(raw_stack),
            mean_spectrum_arrays(despiked_stack),
            params,
        )

    datasets = [
        _build_dataset_output(name, x, y_raw, y_despiked, params)
        for name, x, y_raw, y_despiked in aligned_pairs
    ]
    return ProcessResponse(datasets=datasets, average=average_output)


def _build_dataset_output(
    name: str,
    x: np.ndarray,
    y_raw: np.ndarray,
    y_despiked: np.ndarray,
    params: ProcessParams,
) -> DatasetOutput:
    background_curve: Optional[np.ndarray] = None
    smooth_input = y_despiked.copy()

    if params.bg_enabled and params.bg_method != "none":
        bg_start = float(params.bg_x_start) if params.bg_x_start is not None else float(np.min(x))
        bg_end = float(params.bg_x_end) if params.bg_x_end is not None else float(np.max(x))
        smooth_input, background_curve = apply_background(
            x,
            smooth_input,
            method=params.bg_method,
            bg_x_start=bg_start,
            bg_x_end=bg_end,
            poly_deg=int(params.bg_poly_deg),
            baseline_lambda=float(params.bg_baseline_lambda),
            baseline_p=float(params.bg_baseline_p),
            baseline_iter=int(params.bg_baseline_iter),
        )

    y_processed = smooth_signal(
        smooth_input,
        method=params.smooth_method,
        window_points=int(params.smooth_window),
        poly_deg=int(params.smooth_poly),
    )
    y_processed = apply_normalization(
        x,
        y_processed,
        norm_method=params.norm_method,
        norm_x_start=params.norm_x_start,
        norm_x_end=params.norm_x_end,
    )

    return DatasetOutput(
        name=name,
        x=x.tolist(),
        y_raw=y_raw.tolist(),
        y_despiked=y_despiked.tolist(),
        y_background=background_curve.tolist() if background_curve is not None else None,
        y_processed=y_processed.tolist(),
    )


@router.post("/peaks", response_model=PeakDetectResponse, summary="Detect Raman peaks")
def detect_peaks(req: PeakDetectRequest):
    x = np.asarray(req.x, dtype=float)
    y = np.asarray(req.y, dtype=float)
    peak_indices = detect_spectrum_peaks(
        x,
        y,
        prominence_ratio=float(req.prominence),
        height_ratio=float(req.height_ratio),
        min_distance_x=float(req.min_distance),
        max_peaks=int(req.max_peaks),
    )
    if len(peak_indices) == 0:
        return PeakDetectResponse(peaks=[])

    y_max = float(np.max(y)) if len(y) else 1.0
    y_max = y_max if y_max > 0 else 1.0
    peaks = [
        PeakRow(
            shift_cm=float(x[idx]),
            intensity=float(y[idx]),
            rel_intensity=float(y[idx] / y_max * 100.0),
        )
        for idx in peak_indices
    ]
    return PeakDetectResponse(peaks=peaks)


@router.get("/references", summary="List Raman reference materials")
def get_references():
    return {"materials": sorted(RAMAN_REFERENCES.keys())}


@router.post("/reference-peaks", response_model=RefPeaksResponse, summary="Get Raman reference peaks")
def get_reference_peaks(req: RefPeaksRequest):
    peaks: list[RefPeak] = []
    for material in req.materials:
        for row in RAMAN_REFERENCES.get(material, []):
            peaks.append(
                RefPeak(
                    material=material,
                    position_cm=float(row["pos"]),
                    label=str(row.get("label", "")),
                    strength=float(row.get("strength", 0.0)),
                    note=str(row.get("note", "")),
                )
            )
    peaks.sort(key=lambda item: (item.material, item.position_cm))
    return RefPeaksResponse(peaks=peaks)


@router.post("/fit", response_model=FitResponse, summary="Fit Raman peaks")
def fit_raman_peaks(req: FitRequest):
    x = np.asarray(req.x, dtype=float)
    y = np.asarray(req.y, dtype=float)
    enabled_rows = [row for row in req.peaks if row.enabled]
    if len(x) < 3 or len(y) < 3:
        raise HTTPException(status_code=400, detail="Spectrum too short for fitting")
    if not enabled_rows:
        raise HTTPException(status_code=400, detail="No enabled peaks provided")

    init_peaks = [
        {
            "label": row.label,
            "be": float(row.position_cm),
            "fwhm": float(max(0.5, row.fwhm_cm)),
            "peak_id": row.peak_id,
            "material": row.material,
            "role": row.role,
            "mode_label": row.mode_label,
            "display_name": row.display_name or row.label,
            "note": row.note,
            "ref_center": float(row.ref_position_cm) if row.ref_position_cm is not None else float("nan"),
        }
        for row in enabled_rows
    ]

    result = fit_peaks(
        x,
        y,
        init_peaks=init_peaks,
        profile=req.profile,
        maxfev=int(req.maxfev),
    )
    if not result.get("success"):
        return FitResponse(
            success=False,
            message=str(result.get("message", "Fitting failed")),
            dataset_name=req.dataset_name,
            profile=req.profile,
            y_fit=[],
            residuals=[],
            y_individual=[],
            peaks=[],
            r_squared=0.0,
        )

    rows: list[FitPeakRow] = []
    for peak in result["peaks"]:
        ref_center = peak.get("ref_center")
        ref_center_value = float(ref_center) if ref_center is not None and np.isfinite(ref_center) else None
        delta_value = (
            float(peak["center"]) - ref_center_value
            if ref_center_value is not None
            else None
        )
        rows.append(
            FitPeakRow(
                Peak_ID=str(peak.get("peak_id", "")),
                Peak_Name=str(peak.get("display_name", peak["label"])),
                Material=str(peak.get("material", "")),
                Peak_Role=str(peak.get("role", "")),
                Mode_Label=str(peak.get("mode_label", "")),
                Ref_cm=ref_center_value,
                Center_cm=float(peak["center"]),
                Delta_cm=delta_value,
                FWHM_cm=float(peak["fwhm"]),
                Area=float(peak["area"]),
                Area_pct=float(peak["area_pct"]),
                Source_Note=str(peak.get("note", "")),
                Is_Doublet=bool(peak.get("doublet", False)),
            )
        )

    return FitResponse(
        success=True,
        message="",
        dataset_name=req.dataset_name,
        profile=req.profile,
        y_fit=np.asarray(result["y_fit"], dtype=float).tolist(),
        residuals=np.asarray(result["residuals"], dtype=float).tolist(),
        y_individual=[np.asarray(item, dtype=float).tolist() for item in result["y_individual"]],
        peaks=rows,
        r_squared=float(result["r_squared"]),
    )
