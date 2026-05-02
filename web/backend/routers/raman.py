"""Raman API endpoints."""

from __future__ import annotations

import json
import math
import re
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from core.parsers import parse_two_column_spectrum_bytes
from core.peak_fitting import fit_peaks
from core.processing import apply_background, apply_normalization, airpls_background, arpls_background, asls_background, masked_weight_profile
from core.spectrum_ops import detect_spectrum_peaks
from db.raman_database import RAMAN_REFERENCES, get_enriched_raman_peaks, get_raman_peak_library

router = APIRouter()


class DatasetInput(BaseModel):
    name: str
    x: List[float]
    y: List[float]


class ProcessParams(BaseModel):
    bg_enabled: bool = False
    bg_method: str = "none"           # none | constant | linear | polynomial | asls | airpls | rubber_band | manual_anchor
    bg_x_start: Optional[float] = None
    bg_x_end: Optional[float] = None
    bg_poly_deg: int = 3
    bg_baseline_lambda: float = 1e5
    bg_baseline_p: float = 0.01
    bg_baseline_iter: int = 20
    bg_anchor_x: List[float] = []
    bg_anchor_y: List[float] = []
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
    y_background: Optional[List[float]] = None
    y_processed: List[float]


class ProcessResponse(BaseModel):
    datasets: List[DatasetOutput]


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
    phase: str = ""
    phase_group: str = ""
    position_cm: float
    theoretical_center: float
    label: str
    mode: str = ""
    species: str = ""
    tolerance_cm: float = 8.0
    fwhm_min: float = 0.5
    fwhm_max: float = 80.0
    profile: str = "voigt"
    allowed_profiles: List[str] = []
    peak_type: str = ""
    anchor_peak: bool = False
    can_be_quantified: bool = True
    related_technique: str = "Raman"
    reference: str = ""
    reference_source: str = ""
    symmetry: str = ""
    oxidation_state: str = "N/A"
    oxidation_state_inference: str = "Not applicable"
    enabled_by_default: bool = True
    candidate_only: bool = False
    artifact: bool = False
    substrate: bool = False
    disabled_until_user_selects: bool = False
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
    phase: str = ""
    phase_group: str = ""
    label: str
    display_name: str = ""
    position_cm: float
    fwhm_cm: float
    tolerance_cm: float = 8.0
    fwhm_min: float = 0.5
    fwhm_max: float = 80.0
    profile: str = ""
    allowed_profiles: List[str] = []
    peak_type: str = ""
    anchor_peak: bool = False
    can_be_quantified: bool = True
    species: str = ""
    theoretical_center: Optional[float] = None
    related_technique: str = "Raman"
    reference: str = ""
    reference_source: str = ""
    symmetry: str = ""
    oxidation_state: str = "N/A"
    oxidation_state_inference: str = "Not applicable"
    role: str = ""
    mode_label: str = ""
    note: str = ""
    ref_position_cm: Optional[float] = None
    enabled_by_default: bool = True
    candidate_only: bool = False
    artifact: bool = False
    substrate: bool = False
    disabled_until_user_selects: bool = False
    lock_center: bool = False
    lock_fwhm: bool = False
    lock_area: bool = False
    lock_profile: bool = False


class SegmentWeight(BaseModel):
    lo: float
    hi: float
    weight: float = 1.0


class FitRequest(BaseModel):
    dataset_name: str
    x: List[float]
    y: List[float]
    input_is_preprocessed: bool = False
    profile: str = "voigt"
    maxfev: int = 20000
    fit_lo: Optional[float] = None
    fit_hi: Optional[float] = None
    robust_loss: str = "linear"
    segment_weights: List[SegmentWeight] = []
    residual_target_enabled: bool = False
    residual_target: float = 0.05
    residual_target_rounds: int = 4
    baseline_method: str = "arpls"
    baseline_lambda: float = 1e5
    baseline_p: float = 0.01
    baseline_iter: int = 20
    bootstrap_rounds: int = 8
    peaks: List[FitPeakInput]


class FitPeakRow(BaseModel):
    Peak_ID: str
    Peak_Name: str
    Phase: str = ""
    Phase_Group: str = ""
    Material: str
    Peak_Role: str
    Mode_Label: str
    Symmetry: str = ""
    Species: str = ""
    Oxidation_State: str = "N/A"
    Oxidation_State_Inference: str = "Not applicable"
    Assignment_Basis: str = "mode/phase"
    Profile: str = ""
    Peak_Type: str = ""
    Anchor_Peak: bool = False
    Can_Be_Quantified: bool = True
    Ref_cm: Optional[float] = None
    Tolerance_cm: float = 8.0
    Center_Min_cm: Optional[float] = None
    Center_Max_cm: Optional[float] = None
    Center_cm: float
    Delta_cm: Optional[float] = None
    Boundary_Peak: bool = False
    FWHM_cm: float
    Height: float = 0.0
    FWHM_Min_cm: Optional[float] = None
    FWHM_Max_cm: Optional[float] = None
    Broad_Background_Like: bool = False
    Area: float
    Area_pct: float
    SNR: Optional[float] = None
    Bootstrap_Center_STD: Optional[float] = None
    Bootstrap_FWHM_STD: Optional[float] = None
    Fit_Status: str = "Fit OK"
    Physical_Confidence: str = "Medium"
    Confidence: str = "Medium"
    Quality_Flags: List[str] = []
    Group_Shift_cm: Optional[float] = None
    Spacing_Error_cm: Optional[float] = None
    Group_Consistency_Score: Optional[float] = None
    Group_Status: str = ""
    Anchor_Related_Delta_cm: Optional[float] = None
    Confidence_Score: float = 0.0
    Source_Note: str = ""
    Reference: str = ""
    Reference_Source: str = ""
    Is_Doublet: bool = False
    Status: str = ""
    Note: str = ""


class LocalResidualRange(BaseModel):
    Range: str
    Lo_cm: float
    Hi_cm: float
    RMSE: Optional[float] = None
    MaxAbs: Optional[float] = None
    Warning: str = ""


class ResidualDiagnostics(BaseModel):
    Global_RMSE: float = 0.0
    Global_MaxAbs: float = 0.0
    Max_Residual_Center_cm: Optional[float] = None
    Max_Residual_Range: str = ""
    Segment_480_570_RMSE: Optional[float] = None
    Segment_480_570_MaxAbs: Optional[float] = None
    Local_Ranges: List[LocalResidualRange] = []
    Suggestions: List[str] = []


class GroupSummary(BaseModel):
    Phase_Group: str
    Material: str = ""
    Anchor_Peak: str = ""
    Anchor_Ref_cm: Optional[float] = None
    Anchor_Fitted_cm: Optional[float] = None
    Peak_Count: int
    Candidate_Count: int = 0
    Matched_Count: int = 0
    Group_Shift_cm: float
    Stretch: float = 0.0
    Mean_Abs_Delta_cm: float = 0.0
    Max_Abs_Delta_cm: float = 0.0
    Mean_Spacing_Error_cm: float = 0.0
    Max_Spacing_Error_cm: float = 0.0
    Group_Consistency_Score: float
    Status: str
    Remarks: str = ""


class SegmentFitSummary(BaseModel):
    Range: str
    Lo_cm: float
    Hi_cm: float
    Baseline_Method: str
    R_squared: float = 0.0
    RMSE: float = 0.0
    Residual_MaxAbs: float = 0.0
    Peak_Count: int = 0
    Warning: str = ""
    x: List[float] = []
    y_raw: List[float] = []
    baseline: List[float] = []
    y_corrected: List[float] = []
    y_fit: List[float] = []
    residuals: List[float] = []


class CalibrationSummary(BaseModel):
    method: str = "none"
    offset_cm: float = 0.0
    si_peak_before_cm: Optional[float] = None
    si_peak_after_cm: Optional[float] = None
    applied: bool = False
    reference: str = "520.7 cm⁻¹"


class GroupFitStage(BaseModel):
    group_name: str
    material: str
    anchor_peak_label: str = ""
    anchor_ref_cm: float = 0.0
    anchor_fitted_cm: Optional[float] = None
    group_shift_cm: float = 0.0
    stretch: float = 0.0
    x: List[float] = []
    y_current_spectrum: List[float] = []
    y_remaining_before: List[float] = []
    y_group_fit: List[float] = []
    y_locked_previous: List[float] = []
    y_combined_fit: List[float] = []
    residuals: List[float] = []
    peaks: List["FitPeakRow"] = []
    probe_rows: List["PeakProbeRow"] = []
    r_squared: float = 0.0
    warnings: List[str] = []


class AlignmentRow(BaseModel):
    sample_id: str
    material: str
    phase: str
    mode: str
    symmetry: str = ""
    reference_cm1: float
    fitted_cm1: Optional[float] = None
    delta_cm1: Optional[float] = None
    tolerance_cm1: float
    status: str
    confidence: str
    note: str = ""
    reference_source: str = ""


class PeakProbeRow(BaseModel):
    material_group: str
    material: str
    peak_id: str
    peak_label: str
    mode: str = ""
    reference_cm1: float
    search_window: str
    search_window_lo: float
    search_window_hi: float
    local_max_position: Optional[float] = None
    fitted_cm1: Optional[float] = None
    delta_cm1: Optional[float] = None
    FWHM: Optional[float] = None
    height: float = 0.0
    area: float = 0.0
    local_noise: float = 0.0
    SNR: float = 0.0
    AIC_improvement: float = 0.0
    BIC_improvement: float = 0.0
    uncertainty_center: Optional[float] = None
    tolerance_cm1: float = 0.0
    status: str = "not_observed"
    rejection_reason: str = ""
    y_fit: List[float] = []


class RamanReport(BaseModel):
    sample_id: str
    sample_name: str
    ar_o2_flux: str = "unknown"
    baseline_method: str
    calibration_method: str
    si_peak_before_cm: Optional[float] = None
    si_peak_after_cm: Optional[float] = None
    global_r_squared: float
    global_rmse: float
    global_reduced_chi2: float
    fitting_segments: List[str] = []
    warnings: List[str] = []
    unmatched_peaks: List[str] = []
    unobserved_reference_peaks: List[str] = []
    credibility_summary: List[str] = []
    report_text: str = ""
    alignment_csv: str = ""
    peak_table_csv: str = ""
    group_probe_table_csv: str = ""
    unmatched_csv: str = ""
    report_markdown: str = ""
    report_html: str = ""
    report_json: str = ""


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
    adjusted_r_squared: float = 0.0
    rmse: float = 0.0
    aic: float = 0.0
    bic: float = 0.0
    residual_diagnostics: ResidualDiagnostics = ResidualDiagnostics()
    group_summaries: List[GroupSummary] = []
    calibration: CalibrationSummary = CalibrationSummary()
    segment_summaries: List[SegmentFitSummary] = []
    alignment_rows: List[AlignmentRow] = []
    report: Optional[RamanReport] = None
    x_calibrated: List[float] = []
    y_baseline: List[float] = []
    y_corrected: List[float] = []
    y_fit_corrected: List[float] = []
    group_fit_stages: List[GroupFitStage] = []
    group_probe_rows: List[PeakProbeRow] = []


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
    datasets: list[DatasetOutput] = []
    for ds in req.datasets:
        x = np.asarray(ds.x, dtype=float)
        y_raw = np.asarray(ds.y, dtype=float)
        datasets.append(_build_dataset_output(ds.name, x, y_raw, params))
    return ProcessResponse(datasets=datasets)


def _build_dataset_output(
    name: str,
    x: np.ndarray,
    y_raw: np.ndarray,
    params: ProcessParams,
) -> DatasetOutput:
    background_curve: Optional[np.ndarray] = None
    y_processed = y_raw.copy()

    if params.bg_enabled and params.bg_method != "none":
        bg_start = float(params.bg_x_start) if params.bg_x_start is not None else float(np.min(x))
        bg_end = float(params.bg_x_end) if params.bg_x_end is not None else float(np.max(x))
        y_processed, background_curve = apply_background(
            x,
            y_processed,
            method=params.bg_method,
            bg_x_start=bg_start,
            bg_x_end=bg_end,
            poly_deg=int(params.bg_poly_deg),
            baseline_lambda=float(params.bg_baseline_lambda),
            baseline_p=float(params.bg_baseline_p),
            baseline_iter=int(params.bg_baseline_iter),
            manual_anchor_x=params.bg_anchor_x,
            manual_anchor_y=params.bg_anchor_y,
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
        for row in get_enriched_raman_peaks(material):
            peaks.append(
                RefPeak(
                    material=material,
                    phase=str(row.get("phase", material)),
                    phase_group=str(row.get("phase_group", "")),
                    position_cm=float(row["pos"]),
                    theoretical_center=float(row.get("theoretical_center", row["pos"])),
                    label=str(row.get("label", "")),
                    mode=str(row.get("mode", row.get("label", ""))),
                    species=str(row.get("species", "")),
                    tolerance_cm=float(row.get("tolerance_cm", 8.0)),
                    fwhm_min=float(row.get("fwhm_min", 0.5)),
                    fwhm_max=float(row.get("fwhm_max", 80.0)),
                    profile=str(row.get("profile", "voigt")),
                    peak_type=str(row.get("peak_type", "")),
                    related_technique=str(row.get("related_technique", "Raman")),
                    reference=str(row.get("reference", "")),
                    reference_source=str(row.get("reference_source", row.get("reference", ""))),
                    symmetry=str(row.get("symmetry", "")),
                    oxidation_state=str(row.get("oxidation_state", "N/A")),
                    oxidation_state_inference=str(row.get("oxidation_state_inference", "Not applicable")),
                    enabled_by_default=bool(row.get("enabled_by_default", True)),
                    candidate_only=bool(row.get("candidate_only", False)),
                    artifact=bool(row.get("artifact", False)),
                    substrate=bool(row.get("substrate", False)),
                    disabled_until_user_selects=bool(row.get("disabled_until_user_selects", False)),
                    strength=float(row.get("strength", 0.0)),
                    note=str(row.get("note", "")),
                )
            )
    peaks.sort(key=lambda item: (item.material, item.position_cm))
    return RefPeaksResponse(peaks=peaks)


@router.get("/peak-library", summary="Get enriched Raman peak library")
def get_peak_library():
    return {"peaks": get_raman_peak_library()}


AMBIGUOUS_LOW_WINDOW = (300.0, 330.0)


def _csv_escape(value) -> str:
    if value is None:
        return ""
    text = str(value)
    if any(ch in text for ch in [",", '"', "\n"]):
        return '"' + text.replace('"', '""') + '"'
    return text


def _to_csv(headers: list[str], rows: list[list[object]]) -> str:
    body = [",".join(_csv_escape(item) for item in headers)]
    body.extend(",".join(_csv_escape(item) for item in row) for row in rows)
    return "\n".join(body)


def _sample_id_from_name(name: str) -> str:
    match = re.search(r"(\d{3,4}(?:-\d+)?)", name or "")
    return match.group(1) if match else (name.rsplit(".", 1)[0] if name else "sample")


def _flux_from_name(name: str) -> str:
    text = name or ""
    explicit = re.search(r"(Ar\s*[:/]\s*O2\s*[:=]?\s*[\w.\-:]+)", text, flags=re.IGNORECASE)
    if explicit:
        return explicit.group(1)
    ratio = re.search(r"(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)", text)
    if ratio:
        return f"{ratio.group(1)}:{ratio.group(2)}"
    return "unknown"


def _window_from_peak(center: float, tolerance: float, fwhm_max: float) -> float:
    return max(12.0, tolerance * 1.6, fwhm_max * 0.9)


def _baseline_curve_with_peak_masks(
    x: np.ndarray,
    y: np.ndarray,
    candidates: list[dict],
    method: str,
    baseline_lambda: float,
    baseline_p: float,
    baseline_iter: int,
) -> np.ndarray:
    centers = []
    widths = []
    for item in candidates:
        ref = item.get("theoretical_center", item.get("ref_center", item.get("be", None)))
        if ref is None or not np.isfinite(ref):
            continue
        centers.append(float(ref))
        widths.append(_window_from_peak(float(ref), float(item.get("tolerance_cm", 8.0)), float(item.get("fwhm_max", 40.0))))
    weights = masked_weight_profile(x, centers=centers, widths=widths, notch_depth=0.03)
    selected = str(method or "arpls").lower()
    if selected == "airpls":
        return airpls_background(y, lam=baseline_lambda, max_iter=baseline_iter, weights=weights)
    if selected == "asls":
        return asls_background(y, lam=baseline_lambda, p=baseline_p, max_iter=baseline_iter, weights=weights)
    return arpls_background(y, lam=baseline_lambda, max_iter=baseline_iter, weights=weights)


def _prepare_candidate_dict(row: FitPeakInput, shift_offset: float = 0.0) -> dict:
    theoretical = float(row.theoretical_center) if row.theoretical_center is not None else (
        float(row.ref_position_cm) if row.ref_position_cm is not None else float(row.position_cm)
    )
    return {
        "label": row.label,
        "be": float(row.position_cm) + shift_offset,
        "fwhm": float(max(0.5, row.fwhm_cm)),
        "peak_id": row.peak_id,
        "material": row.material or row.phase,
        "phase": row.phase or row.material,
        "phase_group": row.phase_group or row.phase or row.material,
        "role": row.role,
        "mode_label": row.mode_label or row.label,
        "display_name": row.display_name or row.label,
        "note": row.note,
        "species": row.species,
        "tolerance_cm": float(max(row.tolerance_cm, 0.0)),
        "fwhm_min": float(max(row.fwhm_min, 0.01)),
        "fwhm_max": float(max(row.fwhm_max, row.fwhm_min + 0.1)),
        "profile": _normal_profile_for_physical_peak(row.profile or "voigt", row.peak_type),
        "allowed_profiles": row.allowed_profiles,
        "peak_type": row.peak_type,
        "anchor_peak": row.anchor_peak,
        "can_be_quantified": row.can_be_quantified,
        "related_technique": row.related_technique,
        "reference": row.reference,
        "reference_source": row.reference_source or row.reference,
        "symmetry": row.symmetry,
        "oxidation_state": row.oxidation_state,
        "oxidation_state_inference": row.oxidation_state_inference,
        "theoretical_center": theoretical,
        "lock_center": row.lock_center,
        "lock_fwhm": row.lock_fwhm,
        "lock_area": row.lock_area,
        "lock_profile": row.lock_profile,
        "ref_center": float(row.ref_position_cm) if row.ref_position_cm is not None else theoretical,
        "enabled_by_default": row.enabled_by_default,
        "candidate_only": row.candidate_only,
        "artifact": row.artifact,
        "substrate": row.substrate,
        "disabled_until_user_selects": row.disabled_until_user_selects,
    }


def _candidate_status_and_note(row: dict, bootstrap: dict | None, comparison: dict | None) -> tuple[str, list[str]]:
    notes: list[str] = []
    snr = float(row.get("SNR") or 0.0)
    if snr < 3.0:
        notes.append("SNR < 3")
    if float(row.get("Height", 0.0)) <= 0:
        notes.append("amplitude <= 0")
    ref_cm = row.get("Ref_cm")
    delta = row.get("Delta_cm")
    tolerance = float(row.get("Tolerance_cm", 8.0))
    if ref_cm is not None and delta is not None and abs(float(delta)) > tolerance:
        notes.append("center shift outside tolerance")
    fwhm = float(row.get("FWHM_cm", 0.0))
    fmin = row.get("FWHM_Min_cm")
    fmax = row.get("FWHM_Max_cm")
    if fmin is not None and fwhm < float(fmin) - 1e-6:
        notes.append("FWHM below physical range")
    if fmax is not None and fwhm > float(fmax) + 1e-6:
        notes.append("FWHM above physical range")
    if bootstrap:
        center_std = float(bootstrap.get("center_std", 0.0))
        fwhm_std = float(bootstrap.get("fwhm_std", 0.0))
        if center_std > max(tolerance * 0.5, 1.5):
            notes.append("bootstrap center uncertainty too large")
        if fwhm_std > max(float(row.get("FWHM_cm", 0.0)) * 0.6, 6.0):
            notes.append("bootstrap FWHM uncertainty too large")
    else:
        notes.append("bootstrap unavailable")
    if comparison:
        delta_aic = float(comparison.get("aic", 0.0)) - float(row.get("_base_aic", 0.0))
        delta_bic = float(comparison.get("bic", 0.0)) - float(row.get("_base_bic", 0.0))
        delta_adj = float(row.get("_base_adj_r2", 0.0)) - float(comparison.get("adjusted_r_squared", 0.0))
        if delta_aic < 2.0 and delta_bic < 2.0 and delta_adj < 1e-3:
            notes.append("AIC/BIC or adjusted R² improvement too small")
    center_val = float(row.get("Center_cm", 0.0))
    if AMBIGUOUS_LOW_WINDOW[0] <= center_val <= AMBIGUOUS_LOW_WINDOW[1] and row.get("Material") == "β-Ga₂O₃":
        notes.append("ambiguous 300–330 cm⁻¹ region; could overlap substrate/objective artifact")

    if any("ambiguous 300–330" in item for item in notes):
        return "ambiguous", notes
    if not notes:
        if delta is not None and abs(float(delta)) > tolerance * 0.65:
            return "shifted", ["within tolerance but shifted"]
        return "pass", ["all retention criteria satisfied"]
    if snr >= 3 and "AIC/BIC or adjusted R² improvement too small" not in notes and len(notes) <= 2:
        return "uncertain", notes
    return "not observed", notes


def _build_peak_row(
    peak: dict,
    noise: float,
    base_metrics: dict,
    bootstrap_stats: dict[str, dict],
    comparison_by_id: dict[str, Optional[dict]],
) -> dict:
    ref_center = peak.get("ref_center")
    ref_center_value = float(ref_center) if ref_center is not None and np.isfinite(ref_center) else None
    delta_value = float(peak["center"]) - ref_center_value if ref_center_value is not None else None
    tolerance = float(peak.get("tolerance_cm", 8.0))
    height = float(peak.get("amplitude", 0.0))
    snr = float(abs(height) / noise) if noise > 0 else None
    flags: list[str] = []
    if bool(peak.get("center_at_boundary", False)):
        flags.append("boundary peak")
    if bool(peak.get("fwhm_at_boundary", False)):
        flags.append("FWHM at limit")
    if bool(peak.get("broad_peak", False)):
        flags.append("broad/background-like peak")
    if delta_value is not None and tolerance > 0 and abs(delta_value) > tolerance:
        flags.append("center outside tolerance")
    if float(peak.get("area_pct", 0.0)) < 0.5:
        flags.append("very low area")
    if snr is not None and snr < 3:
        flags.append("low SNR")
    bootstrap = bootstrap_stats.get(str(peak.get("peak_id", "")))
    row = {
        "Peak_ID": str(peak.get("peak_id", "")),
        "Peak_Name": str(peak.get("display_name", peak.get("label", ""))),
        "Phase": str(peak.get("phase", peak.get("material", ""))),
        "Phase_Group": str(peak.get("phase_group", peak.get("phase", peak.get("material", "")))),
        "Material": str(peak.get("material", "")),
        "Peak_Role": str(peak.get("role", "")),
        "Mode_Label": str(peak.get("mode_label", peak.get("label", ""))),
        "Symmetry": str(peak.get("symmetry", "")),
        "Species": str(peak.get("species", "")),
        "Oxidation_State": str(peak.get("oxidation_state", "N/A")),
        "Oxidation_State_Inference": str(peak.get("oxidation_state_inference", "Not applicable")),
        "Assignment_Basis": "candidate-based segmented Raman fitting",
        "Profile": str(peak.get("profile", "")),
        "Peak_Type": str(peak.get("peak_type", "")),
        "Anchor_Peak": bool(peak.get("anchor_peak", False)),
        "Can_Be_Quantified": bool(peak.get("can_be_quantified", True)),
        "Ref_cm": ref_center_value,
        "Tolerance_cm": tolerance,
        "Center_Min_cm": float(peak.get("center_min")) if peak.get("center_min") is not None else None,
        "Center_Max_cm": float(peak.get("center_max")) if peak.get("center_max") is not None else None,
        "Center_cm": float(peak["center"]),
        "Delta_cm": delta_value,
        "Boundary_Peak": bool(peak.get("center_at_boundary", False)),
        "FWHM_cm": float(peak["fwhm"]),
        "Height": height,
        "FWHM_Min_cm": float(peak.get("fwhm_min")) if peak.get("fwhm_min") is not None else None,
        "FWHM_Max_cm": float(peak.get("fwhm_max")) if peak.get("fwhm_max") is not None else None,
        "Broad_Background_Like": bool(peak.get("broad_peak", False)),
        "Area": float(peak["area"]),
        "Area_pct": float(peak["area_pct"]),
        "SNR": snr,
        "Bootstrap_Center_STD": None if not bootstrap else float(bootstrap.get("center_std", 0.0)),
        "Bootstrap_FWHM_STD": None if not bootstrap else float(bootstrap.get("fwhm_std", 0.0)),
        "Fit_Status": "Fit OK" if not flags else "Fit warning",
        "Quality_Flags": flags,
        "Source_Note": str(peak.get("note", "")),
        "Reference": str(peak.get("reference", "")),
        "Reference_Source": str(peak.get("reference_source", peak.get("reference", ""))),
        "Is_Doublet": bool(peak.get("doublet", False)),
        "_base_aic": float(base_metrics.get("aic", 0.0)),
        "_base_bic": float(base_metrics.get("bic", 0.0)),
        "_base_adj_r2": float(base_metrics.get("adjusted_r_squared", 0.0)),
    }
    status, note_list = _candidate_status_and_note(row, bootstrap, comparison_by_id.get(row["Peak_ID"]))
    row["Status"] = status
    row["Note"] = "; ".join(note_list)
    row["Physical_Confidence"] = "High" if status == "pass" else ("Medium" if status in {"shifted", "uncertain", "ambiguous"} else "Low")
    row["Confidence"] = row["Physical_Confidence"]
    return row


def _fit_segmented_region(
    segment: dict,
    x: np.ndarray,
    y: np.ndarray,
    candidates: list[dict],
    req: FitRequest,
) -> tuple[dict, list[dict], SegmentFitSummary]:
    lo = float(segment["lo"])
    hi = float(segment["hi"])
    mask = (x >= lo) & (x <= hi)
    x_seg = x[mask]
    y_seg = y[mask]
    if len(x_seg) < 8:
        empty_summary = SegmentFitSummary(
            Range=segment["name"], Lo_cm=lo, Hi_cm=hi, Baseline_Method=req.baseline_method,
            Warning="segment contains too few points",
        )
        return {"success": True, "y_fit": np.zeros_like(x_seg), "residuals": np.zeros_like(x_seg), "peaks": [], "r_squared": 0.0, "adjusted_r_squared": 0.0, "rmse": 0.0, "aic": 0.0, "bic": 0.0}, [], empty_summary

    baseline = _baseline_curve_with_peak_masks(
        x_seg, y_seg, candidates,
        method=req.baseline_method,
        baseline_lambda=float(req.baseline_lambda),
        baseline_p=float(req.baseline_p),
        baseline_iter=int(req.baseline_iter),
    )
    y_corrected = y_seg - baseline

    if not candidates:
        residuals = y_corrected.copy()
        empty_summary = SegmentFitSummary(
            Range=segment["name"], Lo_cm=lo, Hi_cm=hi, Baseline_Method=req.baseline_method,
            R_squared=0.0, RMSE=float(np.sqrt(np.mean(residuals ** 2))) if len(residuals) else 0.0,
            Residual_MaxAbs=float(np.max(np.abs(residuals))) if len(residuals) else 0.0,
            Peak_Count=0, Warning="no candidate peaks in segment",
            x=x_seg.tolist(), y_raw=y_seg.tolist(), baseline=baseline.tolist(),
            y_corrected=y_corrected.tolist(), y_fit=np.zeros_like(y_corrected).tolist(), residuals=residuals.tolist(),
        )
        return {"success": True, "y_fit": np.zeros_like(y_corrected), "residuals": residuals, "peaks": [], "r_squared": 0.0, "adjusted_r_squared": 0.0, "rmse": empty_summary.RMSE, "aic": 0.0, "bic": 0.0}, [], empty_summary

    initial = fit_peaks(
        x_seg, y_corrected, init_peaks=candidates, profile=req.profile,
        maxfev=int(req.maxfev), robust_loss=req.robust_loss,
    )
    if not initial.get("success"):
        fallback_summary = SegmentFitSummary(
            Range=segment["name"], Lo_cm=lo, Hi_cm=hi, Baseline_Method=req.baseline_method,
            Warning=str(initial.get("message", "segment fit failed")),
            x=x_seg.tolist(), y_raw=y_seg.tolist(), baseline=baseline.tolist(),
            y_corrected=y_corrected.tolist(), y_fit=np.zeros_like(y_corrected).tolist(), residuals=y_corrected.tolist(),
        )
        return {"success": True, "y_fit": np.zeros_like(y_corrected), "residuals": y_corrected, "peaks": [], "r_squared": 0.0, "adjusted_r_squared": 0.0, "rmse": float(np.sqrt(np.mean(y_corrected ** 2))) if len(y_corrected) else 0.0, "aic": 0.0, "bic": 0.0}, [], fallback_summary

    bootstrap = _bootstrap_uncertainty(x_seg, y_corrected, initial["peaks"], req)
    comparisons = {
        str(peak.get("peak_id", "")): _fit_without_peak(x_seg, y_corrected, initial["peaks"], str(peak.get("peak_id", "")), req)
        for peak in initial["peaks"]
    }
    noise = _robust_noise(np.asarray(initial["residuals"], dtype=float))
    peak_rows = [_build_peak_row(peak, noise, initial, bootstrap, comparisons) for peak in initial["peaks"]]

    accepted_ids = [row["Peak_ID"] for row in peak_rows if row["Status"] in {"pass", "shifted"}]
    accepted_init = [dict(item) for item in initial["peaks"] if str(item.get("peak_id", "")) in accepted_ids]
    if accepted_init:
        final = fit_peaks(
            x_seg, y_corrected, init_peaks=accepted_init, profile=req.profile,
            maxfev=max(int(req.maxfev), 25000), robust_loss=req.robust_loss,
        )
        final = final if final.get("success") else initial
    else:
        final = {"success": True, "y_fit": np.zeros_like(y_corrected), "residuals": y_corrected, "peaks": [], "r_squared": 0.0, "adjusted_r_squared": 0.0, "rmse": float(np.sqrt(np.mean(y_corrected ** 2))) if len(y_corrected) else 0.0, "aic": 0.0, "bic": 0.0}

    final_lookup = _fit_result_lookup(final.get("peaks", []))
    for row in peak_rows:
        matched = final_lookup.get(row["Peak_ID"])
        if matched is not None:
            row["Center_cm"] = float(matched["center"])
            row["Delta_cm"] = None if row["Ref_cm"] is None else float(matched["center"]) - float(row["Ref_cm"])
            row["FWHM_cm"] = float(matched["fwhm"])
            row["Area"] = float(matched["area"])
            row["Area_pct"] = float(matched["area_pct"])
            row["Height"] = float(matched.get("amplitude", row["Height"]))
            row["Fit_Status"] = "Fit OK"
        elif row["Status"] == "not observed":
            row["Fit_Status"] = "Not observed"

    warning = ""
    if lo <= AMBIGUOUS_LOW_WINDOW[0] and hi >= AMBIGUOUS_LOW_WINDOW[1]:
        warning = "300–330 cm⁻¹ region requires manual review for β-Ga₂O₃ / Si / objective artifact ambiguity."
    summary = SegmentFitSummary(
        Range=segment["name"],
        Lo_cm=lo,
        Hi_cm=hi,
        Baseline_Method=req.baseline_method,
        R_squared=float(final.get("r_squared", 0.0)),
        RMSE=float(final.get("rmse", 0.0)),
        Residual_MaxAbs=float(np.max(np.abs(final.get("residuals", np.zeros_like(y_corrected))))) if len(x_seg) else 0.0,
        Peak_Count=len(accepted_ids),
        Warning=warning,
        x=x_seg.tolist(),
        y_raw=y_seg.tolist(),
        baseline=baseline.tolist(),
        y_corrected=y_corrected.tolist(),
        y_fit=np.asarray(final.get("y_fit", np.zeros_like(y_corrected)), dtype=float).tolist(),
        residuals=np.asarray(final.get("residuals", y_corrected), dtype=float).tolist(),
    )
    return final, peak_rows, summary


def _estimate_si_offset(x: np.ndarray, y: np.ndarray, candidates: list[dict], req: FitRequest) -> CalibrationSummary:
    si_candidates = [dict(item) for item in candidates if str(item.get("material", "")).startswith("Si")]
    overlap_candidates = [
        dict(item) for item in candidates
        if _candidate_overlaps_segment(item, 500.0, 570.0) and (
            str(item.get("material", "")).startswith("Si") or
            str(item.get("material", "")) in {"NiO", "β-Ga₂O₃"}
        )
    ]
    if not si_candidates:
        return CalibrationSummary()
    segment = {"name": "500-570 cm⁻¹", "lo": 500.0, "hi": 570.0}
    _, peak_rows, _ = _fit_segmented_region(segment, x, y, overlap_candidates, req)
    si_rows = [row for row in peak_rows if row["Material"].startswith("Si") and row["Status"] in {"pass", "shifted", "uncertain"}]
    if not si_rows:
        return CalibrationSummary()
    best = max(si_rows, key=lambda row: float(row.get("Height", 0.0)))
    fitted_center = float(best["Center_cm"])
    offset = 520.7 - fitted_center
    if not np.isfinite(offset) or abs(offset) > 12.0:
        return CalibrationSummary(method="si_detected_but_not_applied", si_peak_before_cm=fitted_center)
    return CalibrationSummary(
        method="constant_offset_from_si_520.7",
        offset_cm=float(offset),
        si_peak_before_cm=fitted_center,
        si_peak_after_cm=fitted_center + float(offset),
        applied=abs(offset) > 1e-6,
    )


def _alignment_rows_from_peaks(dataset_name: str, peak_rows: list[dict]) -> list[AlignmentRow]:
    rows: list[AlignmentRow] = []
    for row in peak_rows:
        ref = row.get("Ref_cm")
        if ref is None:
            continue
        hidden_status = str(row.get("Status", "")) in {"not_observed", "rejected"}
        rows.append(AlignmentRow(
            sample_id=_sample_id_from_name(dataset_name),
            material=str(row.get("Material", "")),
            phase=str(row.get("Phase", "")),
            mode=str(row.get("Mode_Label", row.get("Peak_Name", ""))),
            symmetry=str(row.get("Symmetry", "")),
            reference_cm1=float(ref),
            fitted_cm1=float(row["Center_cm"]) if not hidden_status else None,
            delta_cm1=float(row["Delta_cm"]) if row.get("Delta_cm") is not None and not hidden_status else None,
            tolerance_cm1=float(row.get("Tolerance_cm", 8.0)),
            status=str(row.get("Status", "")),
            confidence=str(row.get("Confidence", "")),
            note=str(row.get("Note", "")),
            reference_source=str(row.get("Reference_Source", row.get("Reference", ""))),
        ))
    rows.sort(key=lambda item: (item.material, item.reference_cm1))
    return rows


def _build_raman_report(
    dataset_name: str,
    req: FitRequest,
    calibration: CalibrationSummary,
    global_metrics: dict,
    segment_summaries: list[SegmentFitSummary],
    peak_rows: list[dict],
    alignment_rows: list[AlignmentRow],
) -> RamanReport:
    unmatched = [f"{row['Peak_Name']} ({row['Center_cm']:.1f} cm⁻¹)" for row in peak_rows if row["Ref_cm"] is None]
    unobserved = [f"{row['Peak_Name']} [{row['Material']} @ {row['Ref_cm']:.1f} cm⁻¹]" for row in peak_rows if row["Status"] == "not observed" and row["Ref_cm"] is not None]
    warnings = [summary.Warning for summary in segment_summaries if summary.Warning]
    warnings.extend(row["Note"] for row in peak_rows if row["Status"] in {"ambiguous", "uncertain"} and row["Note"])
    credibility_by_material: dict[str, list[str]] = {}
    for row in peak_rows:
        credibility_by_material.setdefault(row["Material"], []).append(row["Status"])
    credibility_summary = []
    for material, statuses in sorted(credibility_by_material.items()):
        score = statuses.count("pass") + 0.5 * statuses.count("shifted") - statuses.count("not observed")
        if score >= 2:
            credibility = "high"
        elif score >= 0:
            credibility = "medium"
        else:
            credibility = "low"
        credibility_summary.append(f"{material}: {credibility} confidence from {statuses.count('pass')} pass / {statuses.count('shifted')} shifted / {statuses.count('uncertain')} uncertain / {statuses.count('not observed')} not observed")

    report_lines = [
        f"Sample: {dataset_name}",
        f"Sample ID: {_sample_id_from_name(dataset_name)}",
        f"Ar:O2 flux: {_flux_from_name(dataset_name)}",
        f"Baseline: {req.baseline_method}",
        f"Calibration: {calibration.method}",
        f"Si peak before/after: {calibration.si_peak_before_cm if calibration.si_peak_before_cm is not None else 'N/A'} / {calibration.si_peak_after_cm if calibration.si_peak_after_cm is not None else 'N/A'}",
        f"Global R² / RMSE / reduced χ²: {global_metrics['r_squared']:.5f} / {global_metrics['rmse']:.4g} / {global_metrics['reduced_chi2']:.4g}",
        "Segments:",
    ]
    report_lines.extend(
        f"- {summary.Range}: R² {summary.R_squared:.4f}, RMSE {summary.RMSE:.4g}, residual max {summary.Residual_MaxAbs:.4g}"
        for summary in segment_summaries
    )
    if warnings:
        report_lines.append("Warnings:")
        report_lines.extend(f"- {item}" for item in warnings[:12])
    if credibility_summary:
        report_lines.append("Credibility:")
        report_lines.extend(f"- {item}" for item in credibility_summary)

    alignment_csv = _to_csv(
        ["sample_id", "material", "phase", "mode", "symmetry", "reference_cm1", "fitted_cm1", "delta_cm1", "tolerance_cm1", "status", "confidence", "note", "reference_source"],
        [
            [
                row.sample_id, row.material, row.phase, row.mode, row.symmetry,
                row.reference_cm1, row.fitted_cm1, row.delta_cm1, row.tolerance_cm1,
                row.status, row.confidence, row.note, row.reference_source,
            ]
            for row in alignment_rows
        ],
    )

    return RamanReport(
        sample_id=_sample_id_from_name(dataset_name),
        sample_name=dataset_name,
        ar_o2_flux=_flux_from_name(dataset_name),
        baseline_method=req.baseline_method,
        calibration_method=calibration.method,
        si_peak_before_cm=calibration.si_peak_before_cm,
        si_peak_after_cm=calibration.si_peak_after_cm,
        global_r_squared=float(global_metrics["r_squared"]),
        global_rmse=float(global_metrics["rmse"]),
        global_reduced_chi2=float(global_metrics["reduced_chi2"]),
        fitting_segments=[item.Range for item in segment_summaries],
        warnings=warnings,
        unmatched_peaks=unmatched,
        unobserved_reference_peaks=unobserved,
        credibility_summary=credibility_summary,
        report_text="\n".join(report_lines),
        alignment_csv=alignment_csv,
    )


def _robust_noise(residuals: np.ndarray) -> float:
    if len(residuals) == 0:
        return 1.0
    centered = residuals - np.median(residuals)
    mad = float(np.median(np.abs(centered)))
    if mad > 0:
        return max(mad / 0.6745, 1e-12)
    std = float(np.std(residuals))
    return max(std, 1e-12)


def _residual_diagnostics(x: np.ndarray, residuals: np.ndarray) -> ResidualDiagnostics:
    if len(x) == 0 or len(residuals) == 0:
        return ResidualDiagnostics()

    abs_res = np.abs(residuals)
    idx = int(np.argmax(abs_res))
    global_rmse = float(np.sqrt(np.mean(residuals ** 2)))
    max_center = float(x[idx])
    suggestions: list[str] = []

    x_min = float(np.min(x))
    x_max = float(np.max(x))
    window_width = max((x_max - x_min) / 20.0, 20.0)
    best_lo = x_min
    best_hi = min(x_max, x_min + window_width)
    best_rmse = -1.0
    start = x_min
    while start < x_max:
        end = min(x_max, start + window_width)
        mask = (x >= start) & (x <= end)
        if np.any(mask):
            rmse = float(np.sqrt(np.mean(residuals[mask] ** 2)))
            if rmse > best_rmse:
                best_rmse = rmse
                best_lo = start
                best_hi = end
        start += window_width / 2.0

    si_mask = (x >= 480.0) & (x <= 570.0)
    si_rmse = None
    si_max = None
    if np.any(si_mask):
        si_rmse = float(np.sqrt(np.mean(residuals[si_mask] ** 2)))
        si_max = float(np.max(np.abs(residuals[si_mask])))
        if si_rmse > max(global_rmse * 1.35, 1e-12):
            suggestions.append("520 cm⁻¹ 附近殘差偏高，建議使用 asymmetric/split pseudo-Voigt Si profile 或加入 Si shoulder。")

    local_ranges: list[LocalResidualRange] = []
    for lo, hi in [(480.0, 570.0), (570.0, 700.0), (700.0, 900.0), (900.0, 1050.0)]:
        mask = (x >= lo) & (x <= hi)
        warning = ""
        rmse = None
        max_abs = None
        if np.any(mask):
            rmse = float(np.sqrt(np.mean(residuals[mask] ** 2)))
            max_abs = float(np.max(np.abs(residuals[mask])))
            sign_changes = int(np.sum(np.diff(np.signbit(residuals[mask])) != 0))
            if rmse > max(global_rmse * 1.35, 1e-12) and sign_changes <= max(2, int(np.sum(mask) * 0.03)):
                warning = "structured residual"
            elif rmse > max(global_rmse * 1.35, 1e-12):
                warning = "high local residual"
        local_ranges.append(LocalResidualRange(
            Range=f"{lo:.0f}-{hi:.0f} cm⁻¹",
            Lo_cm=lo,
            Hi_cm=hi,
            RMSE=rmse,
            MaxAbs=max_abs,
            Warning=warning,
        ))

    if best_rmse > max(global_rmse * 1.5, 1e-12):
        suggestions.append(f"最大殘差集中在 {best_lo:.1f}–{best_hi:.1f} cm⁻¹，可檢查該區背景或缺峰。")
        if best_hi <= 600.0:
            suggestions.append("低 Raman shift 區殘差偏大且峰形較平時，可嘗試 flat-top / super-Gaussian profile。")

    return ResidualDiagnostics(
        Global_RMSE=global_rmse,
        Global_MaxAbs=float(np.max(abs_res)),
        Max_Residual_Center_cm=max_center,
        Max_Residual_Range=f"{best_lo:.1f}–{best_hi:.1f} cm⁻¹",
        Segment_480_570_RMSE=si_rmse,
        Segment_480_570_MaxAbs=si_max,
        Local_Ranges=local_ranges,
        Suggestions=suggestions,
    )


def _build_group_summaries(peaks: list[dict]) -> tuple[list[GroupSummary], dict[str, dict]]:
    grouped: dict[str, list[dict]] = {}
    for peak in peaks:
        group = str(peak.get("Phase_Group") or peak.get("Phase") or "")
        ref = peak.get("Ref_cm")
        if group and ref is not None:
            grouped.setdefault(group, []).append(peak)

    summaries: list[GroupSummary] = []
    lookup: dict[str, dict] = {}
    for group, rows in grouped.items():
        if len(rows) < 2:
            continue
        deltas = np.asarray([float(row["Center_cm"]) - float(row["Ref_cm"]) for row in rows], dtype=float)
        group_shift = float(np.mean(deltas))
        spacing_errors: list[float] = []
        rows_sorted = sorted(rows, key=lambda row: float(row["Ref_cm"]))
        for i in range(len(rows_sorted)):
            for j in range(i + 1, len(rows_sorted)):
                observed = float(rows_sorted[j]["Center_cm"]) - float(rows_sorted[i]["Center_cm"])
                theoretical = float(rows_sorted[j]["Ref_cm"]) - float(rows_sorted[i]["Ref_cm"])
                spacing_errors.append(observed - theoretical)
        abs_spacing = np.abs(np.asarray(spacing_errors, dtype=float)) if spacing_errors else np.asarray([0.0])
        mean_spacing = float(np.mean(abs_spacing))
        max_spacing = float(np.max(abs_spacing))
        shift_spread = float(np.std(deltas))
        score = float(np.clip(100.0 - mean_spacing * 12.0 - shift_spread * 8.0, 0.0, 100.0))
        status = "reasonable shifted group" if abs(group_shift) >= 2.0 and mean_spacing <= 3.0 and score >= 65 else (
            "consistent group" if score >= 70 else "inconsistent spacing"
        )
        summary = GroupSummary(
            Phase_Group=group,
            Peak_Count=len(rows),
            Group_Shift_cm=group_shift,
            Mean_Spacing_Error_cm=mean_spacing,
            Max_Spacing_Error_cm=max_spacing,
            Group_Consistency_Score=score,
            Status=status,
        )
        summaries.append(summary)
        lookup[group] = {
            "shift": group_shift,
            "spacing": mean_spacing,
            "score": score,
            "status": status,
        }
    return summaries, lookup


def _confidence_from_flags(flags: list[str], snr: float, area_pct: float, spacing_score: Optional[float]) -> str:
    score = 100.0
    for flag in flags:
        if flag in {"boundary peak", "center outside tolerance"}:
            score -= 28.0
        elif flag in {"broad/background-like peak", "FWHM at limit"}:
            score -= 22.0
        elif flag == "low SNR":
            score -= 20.0
        elif flag == "very low area":
            score -= 15.0
        elif flag == "residual assist / possible overfit":
            score -= 40.0
    if snr < 3:
        score -= 18.0
    elif snr < 6:
        score -= 8.0
    if area_pct < 0.5:
        score -= 12.0
    if spacing_score is not None and spacing_score < 55:
        score -= 18.0
    if score >= 75:
        return "High"
    if score >= 45:
        return "Medium"
    return "Low"


def _fit_range_mask(x: np.ndarray, fit_range):
    if fit_range is None:
        return np.ones_like(x, dtype=bool)
    lo, hi = min(fit_range), max(fit_range)
    mask = (x >= lo) & (x <= hi)
    return mask if np.any(mask) else np.ones_like(x, dtype=bool)


def _residual_target_score(x: np.ndarray, result: dict, fit_range) -> float:
    residuals = np.asarray(result.get("residuals", []), dtype=float)
    if len(residuals) != len(x) or len(residuals) == 0:
        return float("inf")
    mask = _fit_range_mask(x, fit_range)
    return float(np.max(np.abs(residuals[mask])))


def _largest_residual_index(x: np.ndarray, result: dict, fit_range) -> Optional[int]:
    residuals = np.asarray(result.get("residuals", []), dtype=float)
    if len(residuals) != len(x) or len(residuals) == 0:
        return None
    mask = _fit_range_mask(x, fit_range)
    idxs = np.flatnonzero(mask)
    if len(idxs) == 0:
        return None
    return int(idxs[int(np.argmax(np.abs(residuals[idxs])))] )


def _force_residual_target(
    x: np.ndarray,
    y: np.ndarray,
    init_peaks: list[dict],
    req: FitRequest,
    fit_range,
):
    working_peaks = [dict(item) for item in init_peaks]

    def run(peaks):
        return fit_peaks(
            x,
            y,
            init_peaks=peaks,
            profile=req.profile,
            maxfev=int(max(req.maxfev, 30000)),
            fit_range=fit_range,
            segment_weights=[item.dict() for item in req.segment_weights],
            robust_loss=req.robust_loss,
        )

    result = run(working_peaks)
    if not result.get("success"):
        return result, ""

    target = max(float(req.residual_target), 1e-9)
    max_rounds = int(np.clip(req.residual_target_rounds, 1, 8))
    best_result = result
    best_score = _residual_target_score(x, result, fit_range)
    actions: list[str] = []
    added_assist = 0
    y_span = float(np.max(y) - np.min(y)) if len(y) else 1.0
    y_span = y_span if y_span > 0 else 1.0

    for round_idx in range(max_rounds):
        score = _residual_target_score(x, result, fit_range)
        if score < best_score:
            best_score = score
            best_result = result
        if score <= target:
            break

        idx = _largest_residual_index(x, result, fit_range)
        if idx is None:
            break
        center = float(x[idx])
        residual_value = float(np.asarray(result["residuals"], dtype=float)[idx])
        nearest_idx = None
        nearest_distance = float("inf")
        for peak_idx, peak in enumerate(working_peaks):
            peak_center = float(peak.get("theoretical_center", peak.get("be", center)))
            distance = abs(peak_center - center)
            if distance < nearest_distance:
                nearest_idx = peak_idx
                nearest_distance = distance

        changed = False
        if nearest_idx is not None:
            peak = working_peaks[nearest_idx]
            tolerance = max(float(peak.get("tolerance_cm", 8.0)), 8.0)
            fwhm_max = max(float(peak.get("fwhm_max", 80.0)), 1.0)
            if nearest_distance <= max(tolerance * 1.8, fwhm_max * 0.75, 25.0):
                if peak.get("profile") not in {"split_pseudo_voigt", "pseudo_voigt"}:
                    peak["profile"] = "split_pseudo_voigt"
                    peak["lock_profile"] = False
                    peak["fwhm"] = min(max(float(peak.get("fwhm", 8.0)), 8.0), fwhm_max)
                    actions.append(f"{peak.get('display_name', peak.get('label', 'peak'))} -> asymmetric/pseudo-Voigt within hard limits")
                    changed = True

        if not changed and residual_value > target:
            added_assist += 1
            assist_fwhm = max(6.0, min(35.0, (float(np.max(x)) - float(np.min(x))) / 35.0))
            working_peaks.append({
                "label": f"residual assist {center:.1f} cm⁻¹",
                "display_name": f"Residual assist {center:.1f} cm⁻¹",
                "be": center,
                "fwhm": assist_fwhm,
                "peak_id": f"RASSIST{added_assist:02d}",
                "material": "Residual assist",
                "phase": "Residual assist",
                "phase_group": "Residual assist",
                "role": "model correction",
                "mode_label": "residual assist",
                "note": "Automatically added by residual target mode; treat as possible overfit, not a physical assignment.",
                "species": "model residual",
                "tolerance_cm": 18.0,
                "fwhm_min": 2.0,
                "fwhm_max": 90.0,
                "profile": "super_gaussian",
                "shape": 5.0,
                "peak_type": "residual_assist",
                "related_technique": "Model",
                "reference": "Residual target mode",
                "oxidation_state": "N/A",
                "oxidation_state_inference": "Not applicable",
                "theoretical_center": center,
                "lock_center": False,
                "lock_fwhm": False,
                "lock_area": False,
                "lock_profile": False,
                "ref_center": float("nan"),
                "amplitude": max(residual_value, y_span * 0.02),
            })
            actions.append(f"added residual assist {center:.1f} cm⁻¹")
            changed = True

        if not changed:
            break
        result = run(working_peaks)
        if not result.get("success"):
            break

    if result.get("success"):
        score = _residual_target_score(x, result, fit_range)
        if score < best_score:
            best_score = score
            best_result = result

    final_score = _residual_target_score(x, best_result, fit_range)
    status = "達標" if final_score <= target else "未達標"
    action_text = f"；調整：{', '.join(actions)}" if actions else ""
    message = f"Residual target {status}：max |residual| {final_score:.4g} / target {target:.4g}{action_text}"
    return best_result, message


def _normal_profile_for_physical_peak(profile: str, peak_type: str) -> str:
    value = str(profile or "voigt")
    model_component = str(peak_type or "").lower() in {"residual_assist", "background_like", "background-like", "background component"}
    if value == "super_gaussian" and not model_component:
        return "pseudo_voigt"
    return value


GROUP_SEQUENCE = ["Si group", "β-Ga₂O₃ group", "NiO group"]
ACCEPTED_PEAK_STATUSES = {"accepted", "matched", "shifted"}
PROBED_OBSERVED_STATUSES = {"accepted", "matched", "shifted", "candidate", "uncertain", "ambiguous", "overlapped"}


def _group_name_for_candidate(candidate: dict) -> str:
    text = f"{candidate.get('phase_group', '')} {candidate.get('phase', '')} {candidate.get('material', '')}"
    if "Si" in text:
        return "Si group"
    if "β-Ga" in text or "Ga₂O₃" in text:
        return "β-Ga₂O₃ group"
    if "NiO" in text:
        return "NiO group"
    return str(candidate.get("phase_group") or candidate.get("phase") or candidate.get("material") or "Other")


def _group_material_name(group_name: str) -> str:
    if group_name == "Si group":
        return "Si (基板)"
    if group_name == "β-Ga₂O₃ group":
        return "β-Ga₂O₃"
    if group_name == "NiO group":
        return "NiO"
    return group_name.replace(" group", "")


def _group_config(group_name: str) -> dict:
    if group_name == "Si group":
        return {
            "preferred_anchors": [520.7, 302.0, 960.0],
            "anchor_window": (500.0, 535.0),
            "stretch_bounds": (-0.0015, 0.0015),
            "refinement_slack": 0.8,
        }
    if group_name == "β-Ga₂O₃ group":
        return {
            "preferred_anchors": [416.0, 346.0, 199.0, 630.0, 651.0, 320.0],
            "stretch_bounds": (-0.0030, 0.0030),
            "refinement_slack": 1.2,
        }
    if group_name == "NiO group":
        return {
            "preferred_anchors": [570.0, 1090.0, 730.0, 457.0, 395.0],
            "stretch_bounds": (-0.0030, 0.0030),
            "refinement_slack": 1.8,
        }
    return {
        "preferred_anchors": [],
        "stretch_bounds": (-0.0020, 0.0020),
        "refinement_slack": 1.2,
    }


def _group_order(group_name: str) -> tuple[int, str]:
    try:
        return (GROUP_SEQUENCE.index(group_name), group_name)
    except ValueError:
        return (len(GROUP_SEQUENCE), group_name)


def _center_slack(candidate: dict, refinement: bool = False) -> float:
    tolerance = float(candidate.get("tolerance_cm", 8.0))
    fwhm_max = float(candidate.get("fwhm_max", 25.0))
    material = str(candidate.get("material", ""))
    if refinement:
        return min(_group_config(_group_name_for_candidate(candidate))["refinement_slack"], max(0.45, tolerance * 0.18))
    if material.startswith("Si"):
        return min(1.0, max(0.45, tolerance * 0.22))
    if material == "NiO" or fwhm_max >= 40:
        return min(3.0, max(0.9, tolerance * 0.25))
    return min(2.0, max(0.55, tolerance * 0.22))


def _probe_fwhm_limits(candidate: dict) -> tuple[float, float]:
    group_name = _group_name_for_candidate(candidate)
    ref_center = float(candidate.get("ref_center", candidate.get("be", 0.0)))
    fwhm_min = float(candidate.get("fwhm_min", 0.5))
    fwhm_max = float(candidate.get("fwhm_max", 80.0))
    if group_name == "Si group" and abs(ref_center - 520.7) <= 20.0:
        return max(3.0, fwhm_min), min(max(fwhm_max, 3.1), 12.0)
    if group_name == "β-Ga₂O₃ group":
        return max(3.0, fwhm_min), min(max(fwhm_max, 3.1), 25.0)
    if group_name == "NiO group":
        return max(15.0, min(fwhm_min, 25.0)), min(max(fwhm_max, 80.0), 100.0)
    return fwhm_min, fwhm_max


def _probe_window_half_width(candidate: dict) -> float:
    group_name = _group_name_for_candidate(candidate)
    ref_center = float(candidate.get("ref_center", candidate.get("be", 0.0)))
    tolerance = float(candidate.get("tolerance_cm", 8.0))
    _, fwhm_max = _probe_fwhm_limits(candidate)
    if group_name == "Si group" and abs(ref_center - 520.7) <= 20.0:
        return 18.0
    cap = 125.0 if group_name == "NiO group" else 70.0
    return float(min(max(16.0, tolerance * 2.2, fwhm_max * 1.15), cap))


def _local_linear_baseline(x_local: np.ndarray, y_local: np.ndarray) -> np.ndarray:
    if len(x_local) < 6:
        return np.full_like(y_local, float(np.median(y_local)) if len(y_local) else 0.0)
    edge_count = max(2, int(round(len(x_local) * 0.18)))
    left_level = float(np.median(y_local[:edge_count]))
    right_level = float(np.median(y_local[-edge_count:]))
    x0 = float(x_local[0])
    x1 = float(x_local[-1])
    if abs(x1 - x0) < 1e-12:
        return np.full_like(y_local, (left_level + right_level) / 2.0)
    return left_level + (right_level - left_level) * (x_local - x0) / (x1 - x0)


def _probe_candidate_peak(
    x: np.ndarray,
    y_current: np.ndarray,
    candidate: dict,
    req: FitRequest,
    predicted_center_value: float | None = None,
) -> tuple[PeakProbeRow, dict | None, np.ndarray]:
    group_name = _group_name_for_candidate(candidate)
    ref_center = float(candidate.get("ref_center", candidate.get("theoretical_center", candidate.get("be", 0.0))))
    predicted = float(predicted_center_value if predicted_center_value is not None else ref_center)
    tolerance = float(max(candidate.get("tolerance_cm", 8.0), 0.5))
    half = _probe_window_half_width(candidate)
    lo = predicted - half
    hi = predicted + half
    mask = (x >= lo) & (x <= hi)
    y_fit_full = np.zeros_like(y_current, dtype=float)
    label = str(candidate.get("display_name", candidate.get("label", "")))
    mode = str(candidate.get("mode_label", candidate.get("label", "")))
    if int(np.sum(mask)) < 8:
        return PeakProbeRow(
            material_group=group_name,
            material=_group_material_name(group_name),
            peak_id=str(candidate.get("peak_id", "")),
            peak_label=label,
            mode=mode,
            reference_cm1=ref_center,
            search_window=f"{lo:.1f}-{hi:.1f}",
            search_window_lo=float(lo),
            search_window_hi=float(hi),
            tolerance_cm1=tolerance,
            status="not_observed",
            rejection_reason="local window contains too few data points",
            y_fit=y_fit_full.tolist(),
        ), None, y_fit_full

    x_local = x[mask]
    y_local = y_current[mask]
    local_baseline = _local_linear_baseline(x_local, y_local)
    y_probe = y_local - local_baseline
    edge_count = max(2, int(round(len(y_probe) * 0.18)))
    edge_values = np.concatenate([y_probe[:edge_count], y_probe[-edge_count:]])
    edge_noise = max(_robust_noise(edge_values - np.median(edge_values)), float(np.std(edge_values)) * 0.5, 1e-9)
    local_max_idx = int(np.argmax(y_probe))
    local_max_position = float(x_local[local_max_idx])
    local_signal_seed = float(max(y_probe[local_max_idx], edge_noise * 0.25, 1e-9))
    fwhm_min, fwhm_max = _probe_fwhm_limits(candidate)
    working = dict(candidate)
    working.update({
        "be": predicted,
        "center_min": predicted - tolerance,
        "center_max": predicted + tolerance,
        "fwhm_min": fwhm_min,
        "fwhm_max": fwhm_max,
        "fwhm": float(np.clip(float(candidate.get("fwhm", (fwhm_min + fwhm_max) / 2.0)), fwhm_min, fwhm_max)),
        "amplitude": local_signal_seed,
        "profile": "pseudo_voigt" if group_name != "Si group" else str(candidate.get("profile", "pseudo_voigt")),
    })
    result = fit_peaks(
        x_local,
        y_probe,
        init_peaks=[working],
        profile=str(working.get("profile", req.profile)),
        maxfev=int(max(req.maxfev, 30000)),
        robust_loss=req.robust_loss,
    )
    if not result.get("success") or not result.get("peaks"):
        return PeakProbeRow(
            material_group=group_name,
            material=_group_material_name(group_name),
            peak_id=str(candidate.get("peak_id", "")),
            peak_label=label,
            mode=mode,
            reference_cm1=ref_center,
            search_window=f"{lo:.1f}-{hi:.1f}",
            search_window_lo=float(lo),
            search_window_hi=float(hi),
            local_max_position=local_max_position,
            local_noise=float(edge_noise),
            tolerance_cm1=tolerance,
            status="not_observed",
            rejection_reason=str(result.get("message", "local fit failed")),
            y_fit=y_fit_full.tolist(),
        ), None, y_fit_full

    peak = dict(result["peaks"][0])
    peak["ref_center"] = ref_center
    residuals_local = np.asarray(result.get("residuals", np.zeros_like(y_probe)), dtype=float)
    residual_noise = _robust_noise(residuals_local)
    local_noise = max(edge_noise, residual_noise * 0.35 if residual_noise > 0 else edge_noise, 1e-9)
    fitted_center = float(peak.get("center", predicted))
    fwhm = float(peak.get("fwhm", 0.0))
    height = float(peak.get("amplitude", 0.0))
    area = float(peak.get("area", 0.0))
    snr = float(max(height, 0.0) / local_noise) if local_noise > 0 else 0.0
    delta = fitted_center - ref_center
    base_variance = max(float(np.mean(y_probe ** 2)), 1e-300)
    base_aic = float(len(y_probe) * np.log(base_variance))
    base_bic = float(len(y_probe) * np.log(base_variance))
    aic_improvement = base_aic - float(result.get("aic", base_aic))
    bic_improvement = base_bic - float(result.get("bic", base_bic))
    y_fit_local = np.asarray(result.get("y_fit", np.zeros_like(y_probe)), dtype=float)
    y_fit_full[mask] = y_fit_local
    center_unc, _ = _estimate_uncertainty(fwhm, snr, tolerance)

    reasons: list[str] = []
    if height <= 0:
        reasons.append("amplitude <= 0")
    if snr < 1.5:
        reasons.append("SNR < 1.5")
    elif snr < 2.5:
        reasons.append("weak local SNR")
    elif snr < 5.0:
        reasons.append("candidate-level local SNR")
    if abs(delta) > tolerance:
        reasons.append("center shift outside tolerance")
    if fwhm < fwhm_min - 1e-6:
        reasons.append("FWHM below lower bound")
    if fwhm > fwhm_max + 1e-6:
        reasons.append("FWHM exceeded upper bound")
    if peak.get("center_at_boundary"):
        reasons.append("center reached local search boundary")
    if peak.get("fwhm_at_boundary"):
        reasons.append("FWHM reached local limit")
    if aic_improvement < 1.0 and bic_improvement < 1.0:
        reasons.append("AIC/BIC improvement too small")

    ambiguous = group_name == "β-Ga₂O₃ group" and 300.0 <= ref_center <= 330.0
    overlapped = (
        (group_name == "NiO group" and 500.0 <= ref_center <= 590.0) or
        (group_name == "β-Ga₂O₃ group" and 500.0 <= ref_center <= 540.0)
    )
    if ambiguous:
        reasons.append("ambiguous 300–330 cm⁻¹ region; possible substrate/objective artifact overlap")
    if overlapped:
        reasons.append("overlaps with Si tail or neighboring oxide mode")

    fwhm_ok = fwhm_min - 1e-6 <= fwhm <= fwhm_max + 1e-6
    center_ok = abs(delta) <= tolerance
    improvement_ok = aic_improvement >= 1.0 or bic_improvement >= 1.0
    if ambiguous and snr >= 1.5 and center_ok:
        status = "ambiguous"
    elif overlapped and snr >= 1.5 and center_ok:
        status = "overlapped"
    elif snr >= 5.0 and center_ok and fwhm_ok and improvement_ok and height > 0:
        status = "accepted"
    elif snr >= 2.5 and center_ok and fwhm_ok and height > 0:
        status = "candidate"
    elif snr >= 1.5 and center_ok and height > 0:
        status = "uncertain"
    elif snr < 1.5 and local_signal_seed <= edge_noise * 1.5:
        status = "not_observed"
    else:
        status = "rejected"

    if status == "accepted":
        rejection_reason = "accepted by local SNR, center, FWHM, and AIC/BIC checks"
    elif not reasons:
        rejection_reason = "candidate retained with caution"
    else:
        rejection_reason = "; ".join(dict.fromkeys(reasons))

    peak.update({
        "center": fitted_center,
        "amplitude": height,
        "fwhm": fwhm,
        "area": area,
        "profile": peak.get("profile", working.get("profile", req.profile)),
    })
    return PeakProbeRow(
        material_group=group_name,
        material=_group_material_name(group_name),
        peak_id=str(candidate.get("peak_id", "")),
        peak_label=label,
        mode=mode,
        reference_cm1=ref_center,
        search_window=f"{lo:.1f}-{hi:.1f}",
        search_window_lo=float(lo),
        search_window_hi=float(hi),
        local_max_position=local_max_position,
        fitted_cm1=fitted_center,
        delta_cm1=delta,
        FWHM=fwhm,
        height=height,
        area=area,
        local_noise=float(local_noise),
        SNR=snr,
        AIC_improvement=float(aic_improvement),
        BIC_improvement=float(bic_improvement),
        uncertainty_center=center_unc,
        tolerance_cm1=tolerance,
        status=status,
        rejection_reason=rejection_reason,
        y_fit=y_fit_full.tolist(),
    ), peak, y_fit_full


def _predicted_center(ref_center: float, group_shift: float, stretch: float, anchor_ref: float) -> float:
    return float(ref_center + group_shift + stretch * (ref_center - anchor_ref))


def _fit_model(
    x: np.ndarray,
    y: np.ndarray,
    candidates: list[dict],
    req: FitRequest,
    fit_range: tuple[float, float] | None = None,
) -> dict:
    return fit_peaks(
        x,
        y,
        init_peaks=candidates,
        profile=req.profile,
        maxfev=int(req.maxfev),
        fit_range=fit_range,
        robust_loss=req.robust_loss,
    )


def _estimate_uncertainty(fwhm: float, snr: float, tolerance: float) -> tuple[float | None, float | None]:
    if not np.isfinite(snr) or snr <= 0:
        return None, None
    center_unc = min(max(fwhm / (2.355 * max(snr, 1.0)), 0.08), max(tolerance * 0.7, 0.5))
    fwhm_unc = min(max(fwhm / max(snr, 1.0), 0.15), max(fwhm * 0.8, 1.0))
    return float(center_unc), float(fwhm_unc)


def _peak_improvement_metrics(
    x: np.ndarray,
    y: np.ndarray,
    candidate: dict,
    fitted_peak: dict,
    req: FitRequest,
    fit_range: tuple[float, float] | None = None,
) -> dict:
    with_peak = _fit_model(x, y, [dict(fitted_peak)], req, fit_range=fit_range)
    without_peak = {
        "aic": 0.0,
        "bic": 0.0,
        "adjusted_r_squared": 0.0,
        "rmse": float(np.sqrt(np.mean(y ** 2))) if len(y) else 0.0,
    }
    if len(y) > 0:
        without_peak = {
            "aic": float(len(y) * np.log(max(np.mean(y ** 2), 1e-300))),
            "bic": float(len(y) * np.log(max(np.mean(y ** 2), 1e-300))),
            "adjusted_r_squared": 0.0,
            "rmse": float(np.sqrt(np.mean(y ** 2))),
        }
    if with_peak.get("success"):
        return {
            "delta_aic": float(without_peak["aic"]) - float(with_peak.get("aic", 0.0)),
            "delta_bic": float(without_peak["bic"]) - float(with_peak.get("bic", 0.0)),
            "delta_adj_r2": float(with_peak.get("adjusted_r_squared", 0.0)) - float(without_peak["adjusted_r_squared"]),
        }
    return {"delta_aic": 0.0, "delta_bic": 0.0, "delta_adj_r2": 0.0}


def _status_and_confidence(
    candidate: dict,
    peak: dict | None,
    snr: float,
    improvement: dict | None,
    group_shift: float = 0.0,
) -> tuple[str, float, list[str]]:
    tolerance = float(candidate.get("tolerance_cm", 8.0))
    notes: list[str] = []
    confidence = 100.0
    if peak is None:
        return "not_observed", 0.0, ["peak not retained in constrained group model"]

    height = float(peak.get("amplitude", 0.0))
    center = float(peak.get("center", candidate.get("ref_center", candidate.get("be", 0.0))))
    ref_center = float(candidate.get("ref_center", candidate.get("theoretical_center", center)))
    delta = center - ref_center
    anchor_related_delta = delta - group_shift
    fwhm = float(peak.get("fwhm", 0.0))
    fwhm_min = float(candidate.get("fwhm_min", 0.5))
    fwhm_max = float(candidate.get("fwhm_max", 80.0))

    if snr < 3.0:
        notes.append("SNR < 3")
        confidence -= 26.0
    if height <= 0.0:
        notes.append("amplitude <= 0")
        confidence -= 28.0
    if abs(delta) > tolerance:
        notes.append("center shift outside tolerance")
        confidence -= 25.0
    if fwhm < fwhm_min - 1e-6:
        notes.append("FWHM below physical range")
        confidence -= 18.0
    if fwhm > fwhm_max + 1e-6:
        notes.append("FWHM above physical range")
        confidence -= 20.0
    if peak.get("center_at_boundary"):
        notes.append("center reached fit boundary")
        confidence -= 14.0
    if peak.get("fwhm_at_boundary"):
        notes.append("FWHM reached fit boundary")
        confidence -= 12.0
    if peak.get("broad_peak"):
        notes.append("broad/background-like peak")
        confidence -= 18.0
    if improvement is not None and (
        float(improvement.get("delta_aic", 0.0)) < 2.0 and
        float(improvement.get("delta_bic", 0.0)) < 2.0 and
        float(improvement.get("delta_adj_r2", 0.0)) < 1e-3
    ):
        notes.append("AIC/BIC or adjusted R² improvement too small")
        confidence -= 18.0
    if AMBIGUOUS_LOW_WINDOW[0] <= center <= AMBIGUOUS_LOW_WINDOW[1] and candidate.get("material") == "β-Ga₂O₃":
        notes.append("ambiguous 300–330 cm⁻¹ region")
        confidence -= 18.0
    if abs(anchor_related_delta) > max(1.6, tolerance * 0.4):
        confidence -= 10.0

    confidence = float(np.clip(confidence, 0.0, 100.0))
    if not notes:
        if abs(delta) > tolerance * 0.65:
            return "shifted", confidence, ["within tolerance but shifted"]
        return "matched", confidence, ["all retention criteria satisfied"]
    if any("ambiguous 300–330" in note for note in notes):
        return "uncertain", confidence, notes
    if snr >= 3.0 and height > 0 and len(notes) <= 2 and "AIC/BIC or adjusted R² improvement too small" not in notes:
        return "uncertain", confidence, notes
    if candidate.get("candidate_only"):
        return "rejected", confidence, notes
    return "not_observed", confidence, notes


def _peak_row_from_candidate(
    candidate: dict,
    fitted_peak: dict | None,
    noise: float,
    improvement: dict | None = None,
    group_shift: float = 0.0,
) -> dict:
    ref_center = float(candidate.get("ref_center", candidate.get("theoretical_center", candidate.get("be", 0.0))))
    peak = fitted_peak or {}
    center = float(peak.get("center", ref_center))
    fwhm = float(peak.get("fwhm", candidate.get("fwhm", 0.0)))
    height = float(peak.get("amplitude", 0.0))
    snr = float(abs(height) / noise) if noise > 0 and fitted_peak is not None else 0.0
    center_unc, fwhm_unc = _estimate_uncertainty(fwhm, snr, float(candidate.get("tolerance_cm", 8.0)))
    status, confidence_score, note_list = _status_and_confidence(candidate, fitted_peak, snr, improvement, group_shift=group_shift)
    flags: list[str] = []
    if peak.get("center_at_boundary"):
        flags.append("boundary peak")
    if peak.get("fwhm_at_boundary"):
        flags.append("FWHM at limit")
    if peak.get("broad_peak"):
        flags.append("broad/background-like peak")
    if abs(center - ref_center) > float(candidate.get("tolerance_cm", 8.0)):
        flags.append("center outside tolerance")
    if status in {"not_observed", "rejected"}:
        area = 0.0
        area_pct = 0.0
        height = 0.0
    else:
        area = float(peak.get("area", 0.0))
        area_pct = float(peak.get("area_pct", 0.0))

    return {
        "Peak_ID": str(candidate.get("peak_id", "")),
        "Peak_Name": str(candidate.get("display_name", candidate.get("label", ""))),
        "Phase": str(candidate.get("phase", candidate.get("material", ""))),
        "Phase_Group": _group_name_for_candidate(candidate),
        "Material": str(candidate.get("material", "")),
        "Peak_Role": str(candidate.get("role", "")),
        "Mode_Label": str(candidate.get("mode_label", candidate.get("label", ""))),
        "Symmetry": str(candidate.get("symmetry", "")),
        "Species": str(candidate.get("species", "")),
        "Oxidation_State": str(candidate.get("oxidation_state", "N/A")),
        "Oxidation_State_Inference": str(candidate.get("oxidation_state_inference", "Not applicable")),
        "Assignment_Basis": "sequential grouped Raman fitting with relative-position constraints",
        "Profile": str(peak.get("profile", candidate.get("profile", ""))),
        "Peak_Type": str(candidate.get("peak_type", "")),
        "Anchor_Peak": bool(candidate.get("anchor_peak", False)),
        "Can_Be_Quantified": bool(candidate.get("can_be_quantified", True)),
        "Ref_cm": ref_center,
        "Tolerance_cm": float(candidate.get("tolerance_cm", 8.0)),
        "Center_Min_cm": float(peak.get("center_min", center)),
        "Center_Max_cm": float(peak.get("center_max", center)),
        "Center_cm": center,
        "Delta_cm": center - ref_center,
        "Boundary_Peak": bool(peak.get("center_at_boundary", False)),
        "FWHM_cm": fwhm,
        "Height": height,
        "FWHM_Min_cm": float(candidate.get("fwhm_min", 0.5)),
        "FWHM_Max_cm": float(candidate.get("fwhm_max", 80.0)),
        "Broad_Background_Like": bool(peak.get("broad_peak", False)),
        "Area": area,
        "Area_pct": area_pct,
        "SNR": snr if status not in {"not_observed", "rejected"} else 0.0,
        "Bootstrap_Center_STD": center_unc,
        "Bootstrap_FWHM_STD": fwhm_unc,
        "Fit_Status": "Fit OK" if status in {"matched", "shifted"} else ("Not observed" if status == "not_observed" else "Fit warning"),
        "Physical_Confidence": "High" if confidence_score >= 75 else ("Medium" if confidence_score >= 45 else "Low"),
        "Confidence": "High" if confidence_score >= 75 else ("Medium" if confidence_score >= 45 else "Low"),
        "Quality_Flags": flags,
        "Group_Shift_cm": None,
        "Spacing_Error_cm": None,
        "Group_Consistency_Score": None,
        "Group_Status": "",
        "Anchor_Related_Delta_cm": (center - ref_center) - group_shift,
        "Confidence_Score": confidence_score,
        "Source_Note": str(candidate.get("note", "")),
        "Reference": str(candidate.get("reference", "")),
        "Reference_Source": str(candidate.get("reference_source", candidate.get("reference", ""))),
        "Is_Doublet": bool(candidate.get("doublet", False)),
        "Status": status,
        "Note": "; ".join(note_list),
    }


def _peak_row_from_probe(candidate: dict, probe: PeakProbeRow, group_shift: float = 0.0) -> dict:
    ref_center = float(probe.reference_cm1)
    fitted_center = float(probe.fitted_cm1) if probe.fitted_cm1 is not None else ref_center
    fwhm_min, fwhm_max = _probe_fwhm_limits(candidate)
    fwhm = float(probe.FWHM) if probe.FWHM is not None else float(candidate.get("fwhm", 0.0))
    height = float(probe.height if probe.status in PROBED_OBSERVED_STATUSES else 0.0)
    area = float(probe.area if probe.status in PROBED_OBSERVED_STATUSES else 0.0)
    confidence_seed = {
        "accepted": 88.0,
        "candidate": 62.0,
        "overlapped": 52.0,
        "ambiguous": 48.0,
        "uncertain": 42.0,
        "rejected": 18.0,
        "not_observed": 5.0,
    }.get(probe.status, 20.0)
    confidence_score = float(np.clip(confidence_seed + min(float(probe.SNR), 8.0) * 2.0, 0.0, 100.0))
    flags: list[str] = []
    if probe.status in {"ambiguous", "overlapped"}:
        flags.append(probe.status)
    if probe.status in {"rejected", "not_observed"}:
        flags.append("not retained")
    if probe.SNR < 2.5:
        flags.append("low local SNR")
    if probe.FWHM is not None and fwhm >= fwhm_max - max(0.05, (fwhm_max - fwhm_min) * 0.05):
        flags.append("FWHM at limit")
    fit_status = "Fit OK" if probe.status == "accepted" else ("Fit warning" if probe.status in {"candidate", "uncertain", "ambiguous", "overlapped"} else "Not observed")
    return {
        "Peak_ID": str(candidate.get("peak_id", "")),
        "Peak_Name": str(candidate.get("display_name", candidate.get("label", ""))),
        "Phase": str(candidate.get("phase", candidate.get("material", ""))),
        "Phase_Group": _group_name_for_candidate(candidate),
        "Material": _group_material_name(_group_name_for_candidate(candidate)),
        "Peak_Role": str(candidate.get("role", "")),
        "Mode_Label": str(candidate.get("mode_label", candidate.get("label", ""))),
        "Symmetry": str(candidate.get("symmetry", "")),
        "Species": str(candidate.get("species", "")),
        "Oxidation_State": str(candidate.get("oxidation_state", "N/A")),
        "Oxidation_State_Inference": str(candidate.get("oxidation_state_inference", "Not applicable")),
        "Assignment_Basis": "theoretical-peak local probing with local SNR and constrained center window",
        "Profile": str(candidate.get("profile", "")),
        "Peak_Type": str(candidate.get("peak_type", "")),
        "Anchor_Peak": bool(candidate.get("anchor_peak", False)),
        "Can_Be_Quantified": bool(candidate.get("can_be_quantified", True)) and probe.status == "accepted",
        "Ref_cm": ref_center,
        "Tolerance_cm": float(probe.tolerance_cm1),
        "Center_Min_cm": float(probe.search_window_lo),
        "Center_Max_cm": float(probe.search_window_hi),
        "Center_cm": fitted_center,
        "Delta_cm": None if probe.fitted_cm1 is None else float(probe.delta_cm1 or 0.0),
        "Boundary_Peak": "center reached" in probe.rejection_reason,
        "FWHM_cm": fwhm,
        "Height": height,
        "FWHM_Min_cm": fwhm_min,
        "FWHM_Max_cm": fwhm_max,
        "Broad_Background_Like": bool(probe.status in {"uncertain", "overlapped"} and fwhm >= fwhm_max * 0.9),
        "Area": area,
        "Area_pct": 0.0,
        "SNR": float(probe.SNR),
        "Bootstrap_Center_STD": probe.uncertainty_center,
        "Bootstrap_FWHM_STD": None,
        "Fit_Status": fit_status,
        "Physical_Confidence": "High" if confidence_score >= 75 else ("Medium" if confidence_score >= 45 else "Low"),
        "Confidence": "High" if confidence_score >= 75 else ("Medium" if confidence_score >= 45 else "Low"),
        "Quality_Flags": list(dict.fromkeys(flags)),
        "Group_Shift_cm": None,
        "Spacing_Error_cm": None,
        "Group_Consistency_Score": None,
        "Group_Status": "",
        "Anchor_Related_Delta_cm": (float(probe.delta_cm1) - group_shift) if probe.delta_cm1 is not None else None,
        "Confidence_Score": confidence_score,
        "Source_Note": str(candidate.get("note", "")),
        "Reference": str(candidate.get("reference", "")),
        "Reference_Source": str(candidate.get("reference_source", candidate.get("reference", ""))),
        "Is_Doublet": bool(candidate.get("doublet", False)),
        "Status": probe.status,
        "Note": probe.rejection_reason,
    }


def _build_constrained_candidate(
    candidate: dict,
    predicted_center_value: float,
    center_slack_value: float,
    amplitude_seed: float | None = None,
) -> dict:
    out = dict(candidate)
    out["be"] = float(predicted_center_value)
    out["center_min"] = float(predicted_center_value - center_slack_value)
    out["center_max"] = float(predicted_center_value + center_slack_value)
    if amplitude_seed is not None and np.isfinite(amplitude_seed):
        out["amplitude"] = max(float(amplitude_seed), 1e-9)
    return out


def _fit_single_candidate(
    x: np.ndarray,
    y: np.ndarray,
    candidate: dict,
    req: FitRequest,
    predicted_center_value: float | None = None,
    fit_range: tuple[float, float] | None = None,
    refinement: bool = False,
) -> dict | None:
    ref_center = float(predicted_center_value if predicted_center_value is not None else candidate.get("ref_center", candidate.get("be", 0.0)))
    slack = _center_slack(candidate, refinement=refinement)
    working = _build_constrained_candidate(candidate, ref_center, slack)
    if fit_range is None:
        half = max(18.0, float(candidate.get("tolerance_cm", 8.0)) * 1.8, float(candidate.get("fwhm_max", 25.0)) * 0.8)
        fit_range = (ref_center - half, ref_center + half)
    result = _fit_model(x, y, [working], req, fit_range=fit_range)
    return result if result.get("success") else None


def _choose_anchor_for_group(
    x: np.ndarray,
    y_remaining: np.ndarray,
    group_name: str,
    candidates: list[dict],
    req: FitRequest,
) -> dict | None:
    config = _group_config(group_name)
    preferred = config["preferred_anchors"]

    def sort_key(item: dict) -> tuple[int, float, int]:
        ref_center = float(item.get("ref_center", item.get("be", 0.0)))
        anchor_rank = min((abs(ref_center - pref), idx) for idx, pref in enumerate(preferred))[1] if preferred else 999
        return (
            0 if item.get("anchor_peak") else 1,
            float(anchor_rank),
            1 if item.get("candidate_only") else 0,
        )

    best: dict | None = None
    for candidate in sorted(candidates, key=sort_key):
        ref_center = float(candidate.get("ref_center", candidate.get("be", 0.0)))
        if group_name == "Si group":
            fit_range = tuple(config["anchor_window"])
        else:
            half = max(18.0, float(candidate.get("tolerance_cm", 8.0)) * 1.8, float(candidate.get("fwhm_max", 25.0)) * 0.75)
            fit_range = (ref_center - half, ref_center + half)
        result = _fit_single_candidate(x, y_remaining, candidate, req, predicted_center_value=ref_center, fit_range=fit_range)
        if not result:
            continue
        peak = result["peaks"][0]
        noise = _robust_noise(np.asarray(result.get("residuals", []), dtype=float))
        snr = float(abs(float(peak.get("amplitude", 0.0))) / noise) if noise > 0 else 0.0
        delta = abs(float(peak.get("center", ref_center)) - ref_center)
        score = snr * 5.0 - delta * 2.5 - float(result.get("rmse", 0.0)) * 10.0
        if candidate.get("anchor_peak"):
            score += 6.0
        if candidate.get("candidate_only"):
            score -= 2.0
        if best is None or score > float(best["score"]):
            best = {
                "candidate": candidate,
                "peak": peak,
                "result": result,
                "snr": snr,
                "delta": delta,
                "score": score,
            }
    return best


def _fit_group_candidates(
    x: np.ndarray,
    y_remaining: np.ndarray,
    group_name: str,
    candidates: list[dict],
    req: FitRequest,
    anchor_ref: float,
    group_shift: float,
    stretch_seed: float,
) -> tuple[dict | None, float]:
    stretch_lo, stretch_hi = _group_config(group_name)["stretch_bounds"]
    stretch_values = [0.0] if len(candidates) < 3 else np.linspace(stretch_lo, stretch_hi, 7).tolist()
    if 0.0 not in stretch_values:
        stretch_values = [0.0, *stretch_values]
    if stretch_seed not in stretch_values:
        stretch_values.append(float(np.clip(stretch_seed, stretch_lo, stretch_hi)))

    best_result: dict | None = None
    best_stretch = 0.0
    best_score = float("inf")
    for stretch in stretch_values:
        working: list[dict] = []
        for candidate in candidates:
            ref_center = float(candidate.get("ref_center", candidate.get("be", 0.0)))
            predicted = _predicted_center(ref_center, group_shift, float(stretch), anchor_ref)
            working.append(_build_constrained_candidate(candidate, predicted, _center_slack(candidate)))
        result = _fit_model(x, y_remaining, working, req)
        if not result.get("success"):
            continue
        peaks = result.get("peaks", [])
        noise = _robust_noise(np.asarray(result.get("residuals", []), dtype=float))
        matched = 0
        for peak, candidate in zip(peaks, candidates):
            snr = float(abs(float(peak.get("amplitude", 0.0))) / noise) if noise > 0 else 0.0
            if snr >= 3.0 and abs(float(peak.get("center", candidate.get("ref_center", 0.0))) - float(candidate.get("ref_center", 0.0))) <= float(candidate.get("tolerance_cm", 8.0)):
                matched += 1
        score = float(result.get("aic", 0.0)) - matched * 40.0 + float(result.get("rmse", 0.0)) * 25.0
        if score < best_score:
            best_score = score
            best_result = result
            best_stretch = float(stretch)
    return best_result, best_stretch


def _estimate_group_shift_and_stretch(
    group_name: str,
    rows: list[dict],
    anchor_ref: float,
    anchor_peak_id: str,
) -> tuple[float, float]:
    matched_rows = [row for row in rows if row["Status"] in PROBED_OBSERVED_STATUSES and row["Ref_cm"] is not None]
    if not matched_rows:
        return 0.0, 0.0
    anchor_row = next((row for row in matched_rows if row["Peak_ID"] == anchor_peak_id), None)
    if anchor_row is not None:
        group_shift = float(anchor_row["Center_cm"]) - float(anchor_row["Ref_cm"])
    else:
        deltas = np.asarray([float(row["Delta_cm"]) for row in matched_rows if row["Delta_cm"] is not None], dtype=float)
        group_shift = float(np.mean(deltas)) if len(deltas) else 0.0

    stretches: list[float] = []
    for row in matched_rows:
        ref = float(row["Ref_cm"])
        if abs(ref - anchor_ref) < 1e-9:
            continue
        stretches.append((float(row["Center_cm"]) - ref - group_shift) / (ref - anchor_ref))
    stretch = float(np.clip(np.mean(stretches), *_group_config(group_name)["stretch_bounds"])) if stretches else 0.0
    return group_shift, stretch


def _group_summary_from_rows(
    group_name: str,
    rows: list[dict],
    anchor_peak_label: str,
    anchor_ref: float | None,
    anchor_fitted: float | None,
    group_shift: float,
    stretch: float,
    warnings: list[str],
) -> GroupSummary:
    accepted_rows = [row for row in rows if row["Status"] in ACCEPTED_PEAK_STATUSES and row["Ref_cm"] is not None]
    candidate_rows = [row for row in rows if row["Status"] in {"candidate", "uncertain", "ambiguous", "overlapped"} and row["Ref_cm"] is not None]
    matched_rows = [*accepted_rows, *candidate_rows]
    deltas = np.asarray([abs(float(row["Delta_cm"])) for row in matched_rows if row["Delta_cm"] is not None], dtype=float) if matched_rows else np.asarray([], dtype=float)
    spacing_errors: list[float] = []
    rows_sorted = sorted(matched_rows, key=lambda row: float(row["Ref_cm"]))
    for i in range(len(rows_sorted)):
        for j in range(i + 1, len(rows_sorted)):
            observed = float(rows_sorted[j]["Center_cm"]) - float(rows_sorted[i]["Center_cm"])
            theoretical = float(rows_sorted[j]["Ref_cm"]) - float(rows_sorted[i]["Ref_cm"])
            spacing_errors.append(abs(observed - theoretical))
    spacing_arr = np.asarray(spacing_errors, dtype=float) if spacing_errors else np.asarray([0.0], dtype=float)
    mean_abs_delta = float(np.mean(deltas)) if len(deltas) else 0.0
    max_abs_delta = float(np.max(deltas)) if len(deltas) else 0.0
    mean_spacing = float(np.mean(spacing_arr))
    max_spacing = float(np.max(spacing_arr))
    total_candidates = max(len(rows), 1)
    accepted_fraction = len(accepted_rows) / total_candidates
    candidate_fraction = len(candidate_rows) / total_candidates
    raw_score = float(np.clip(
        accepted_fraction * 100.0 + candidate_fraction * 42.0 - mean_abs_delta * 4.0 - max_spacing * 2.5,
        0.0,
        100.0,
    ))
    floor_score = accepted_fraction * 45.0 + candidate_fraction * 18.0
    score = float(np.clip(max(raw_score, floor_score), 0.0, 100.0))
    status = "locked" if score >= 75 and len(accepted_rows) > 0 else ("partial" if len(accepted_rows) > 0 else ("diagnostic_only" if len(candidate_rows) > 0 else "not_confirmed"))
    if warnings:
        remarks = "; ".join(warnings)
    elif len(accepted_rows) > 0:
        remarks = "accepted peaks found by local theoretical probing"
    elif len(candidate_rows) > 0:
        remarks = "no accepted peaks; candidate/ambiguous local responses require review"
    else:
        reasons = list(dict.fromkeys(str(row.get("Note", "")) for row in rows if row.get("Note")))
        remarks = "no accepted peaks; " + ("; ".join(reasons[:3]) if reasons else "all candidate peaks failed local probing thresholds")
    return GroupSummary(
        Phase_Group=group_name,
        Material=_group_material_name(group_name),
        Anchor_Peak=anchor_peak_label,
        Anchor_Ref_cm=anchor_ref,
        Anchor_Fitted_cm=anchor_fitted,
        Peak_Count=len(matched_rows),
        Candidate_Count=len(rows),
        Matched_Count=len(accepted_rows),
        Group_Shift_cm=float(group_shift),
        Stretch=float(stretch),
        Mean_Abs_Delta_cm=mean_abs_delta,
        Max_Abs_Delta_cm=max_abs_delta,
        Mean_Spacing_Error_cm=mean_spacing,
        Max_Spacing_Error_cm=max_spacing,
        Group_Consistency_Score=score,
        Status=status,
        Remarks=remarks,
    )


def _build_report_v2(
    dataset_name: str,
    req: FitRequest,
    calibration: CalibrationSummary,
    metrics: dict,
    group_summaries: list[GroupSummary],
    rows: list[dict],
    alignment_rows: list[AlignmentRow],
    unmatched_rows: list[list[object]],
    probe_rows: list[PeakProbeRow],
) -> RamanReport:
    sample_id = _sample_id_from_name(dataset_name)
    preprocessing_method = (
        "frontend-processed spectrum + sequential grouped fitting"
        if req.input_is_preprocessed
        else "baseline correction + sequential grouped fitting"
    )
    baseline_method = "frontend_processed" if req.input_is_preprocessed else req.baseline_method
    warnings = [row["Note"] for row in rows if row["Status"] in {"uncertain", "rejected"} and row["Note"]]
    unmatched = [f"{row['Peak_Name']} ({row['Center_cm']:.1f} cm⁻¹)" for row in rows if row["Status"] == "rejected"]
    unobserved = [f"{row['Peak_Name']} [{row['Material']} @ {row['Ref_cm']:.1f} cm⁻¹]" for row in rows if row["Status"] == "not_observed" and row["Ref_cm"] is not None]
    credibility_summary = [
        f"{summary.Material}: {summary.Matched_Count}/{summary.Candidate_Count} matched, shift {summary.Group_Shift_cm:+.2f} cm⁻¹, stretch {summary.Stretch:+.4f}, score {summary.Group_Consistency_Score:.0f}"
        for summary in group_summaries
    ]

    peak_table_headers = [
        "sample_id", "group_name", "material", "peak_label", "mode", "reference_shift_cm1", "fitted_shift_cm1",
        "delta_cm1", "tolerance_cm1", "FWHM", "area", "height", "uncertainty_center", "uncertainty_FWHM",
        "SNR", "anchor_related_delta", "status", "confidence_score", "note",
    ]
    peak_table_rows = [
        [
            sample_id, row["Phase_Group"], row["Material"], row["Peak_Name"], row["Mode_Label"], row["Ref_cm"], row["Center_cm"],
            row["Delta_cm"], row["Tolerance_cm"], row["FWHM_cm"], row["Area"], row["Height"], row["Bootstrap_Center_STD"],
            row["Bootstrap_FWHM_STD"], row["SNR"], row["Anchor_Related_Delta_cm"], row["Status"], row["Confidence_Score"], row["Note"],
        ]
        for row in rows
    ]
    peak_table_csv = _to_csv(peak_table_headers, peak_table_rows)
    unmatched_csv = _to_csv(
        ["sample_id", "category", "peak_label", "material", "reference_cm1", "observed_cm1", "status", "note"],
        unmatched_rows,
    )
    alignment_csv = _to_csv(
        ["sample_id", "material", "phase", "mode", "symmetry", "reference_cm1", "fitted_cm1", "delta_cm1", "tolerance_cm1", "status", "confidence", "note", "reference_source"],
        [
            [
                row.sample_id, row.material, row.phase, row.mode, row.symmetry,
                row.reference_cm1, row.fitted_cm1, row.delta_cm1, row.tolerance_cm1,
                row.status, row.confidence, row.note, row.reference_source,
            ]
            for row in alignment_rows
        ],
    )
    probe_table_headers = [
        "material_group", "peak_label", "reference_cm1", "search_window", "local_max_position",
        "fitted_cm1", "delta_cm1", "FWHM", "height", "area", "local_noise", "SNR",
        "AIC_improvement", "BIC_improvement", "status", "rejection_reason",
    ]
    group_probe_table_csv = _to_csv(
        probe_table_headers,
        [
            [
                row.material_group, row.peak_label, row.reference_cm1, row.search_window,
                row.local_max_position, row.fitted_cm1, row.delta_cm1, row.FWHM, row.height,
                row.area, row.local_noise, row.SNR, row.AIC_improvement, row.BIC_improvement,
                row.status, row.rejection_reason,
            ]
            for row in probe_rows
        ],
    )

    for summary in group_summaries:
        if summary.Matched_Count == 0:
            group_probe = [row for row in probe_rows if row.material_group == summary.Phase_Group]
            reason_counts: dict[str, int] = {}
            for row in group_probe:
                reason = row.rejection_reason or row.status
                first_reason = reason.split(";")[0].strip()
                reason_counts[first_reason] = reason_counts.get(first_reason, 0) + 1
            top_reasons = ", ".join(f"{reason} ({count})" for reason, count in sorted(reason_counts.items(), key=lambda item: -item[1])[:3])
            warnings.append(f"No accepted {summary.Material} peaks. Checked {len(group_probe)} theoretical positions. Main reasons: {top_reasons or 'no local response above threshold'}.")

    report_payload = {
        "sample_summary": {
            "sample_id": sample_id,
            "sample_name": dataset_name,
            "structure": "Ga2O3/NiO/P-Si",
            "preprocessing_method": preprocessing_method,
            "baseline_method": baseline_method,
            "calibration_anchor": "Si 520.7 cm⁻¹",
            "global_metrics": metrics,
        },
        "group_summary": [summary.model_dump() for summary in group_summaries],
        "peak_table": rows,
        "alignment_rows": [row.model_dump() for row in alignment_rows],
        "group_probe_table": [row.model_dump() for row in probe_rows],
        "unmatched_rows": unmatched_rows,
    }
    report_json = json.dumps(report_payload, ensure_ascii=False, indent=2)

    markdown_lines = [
        f"# Raman report: {dataset_name}",
        "",
        "## Sample summary",
        f"- sample_id: {sample_id}",
        f"- structure: Ga2O3/NiO/P-Si",
        f"- preprocessing_method: {preprocessing_method}",
        f"- baseline_method: {baseline_method}",
        f"- calibration_anchor: Si 520.7 cm⁻¹",
        f"- R²: {metrics['r_squared']:.5f}",
        f"- adjusted R²: {metrics['adjusted_r_squared']:.5f}",
        f"- RMSE: {metrics['rmse']:.5g}",
        f"- reduced chi-square: {metrics['reduced_chi2']:.5g}",
        f"- AIC: {metrics['aic']:.5g}",
        f"- BIC: {metrics['bic']:.5g}",
        "",
        "## Group summary",
    ]
    markdown_lines.extend(
        f"- {summary.Material}: anchor {summary.Anchor_Peak or '—'} ({summary.Anchor_Fitted_cm if summary.Anchor_Fitted_cm is not None else 'N/A'}), shift {summary.Group_Shift_cm:+.2f}, stretch {summary.Stretch:+.4f}, matched {summary.Matched_Count}/{summary.Candidate_Count}, mean |delta| {summary.Mean_Abs_Delta_cm:.2f}, max |delta| {summary.Max_Abs_Delta_cm:.2f}, score {summary.Group_Consistency_Score:.0f}, remarks {summary.Remarks}"
        for summary in group_summaries
    )
    markdown_lines.extend(["", "## Peak table", "", "```csv", peak_table_csv, "```"])
    markdown_lines.extend(["", "## Theoretical peak probing table", "", "```csv", group_probe_table_csv, "```"])
    if unmatched_rows:
        markdown_lines.extend(["", "## Unmatched / ambiguous", "", "```csv", unmatched_csv, "```"])
    report_markdown = "\n".join(markdown_lines)

    html_lines = [
        "<html><head><meta charset='utf-8'><title>Raman report</title></head><body>",
        f"<h1>Raman report: {dataset_name}</h1>",
        "<h2>Sample summary</h2>",
        "<ul>",
        f"<li>sample_id: {sample_id}</li>",
        "<li>structure: Ga2O3/NiO/P-Si</li>",
        f"<li>preprocessing_method: {preprocessing_method}</li>",
        f"<li>baseline_method: {baseline_method}</li>",
        f"<li>calibration_anchor: {calibration.reference}</li>",
        f"<li>R²: {metrics['r_squared']:.5f}</li>",
        f"<li>adjusted R²: {metrics['adjusted_r_squared']:.5f}</li>",
        f"<li>RMSE: {metrics['rmse']:.5g}</li>",
        f"<li>reduced chi-square: {metrics['reduced_chi2']:.5g}</li>",
        f"<li>AIC: {metrics['aic']:.5g}</li>",
        f"<li>BIC: {metrics['bic']:.5g}</li>",
        "</ul>",
        "<h2>Group summary</h2>",
        "<table border='1' cellspacing='0' cellpadding='6'><tr><th>material</th><th>anchor</th><th>shift</th><th>stretch</th><th>matched</th><th>mean |delta|</th><th>max |delta|</th><th>score</th><th>remarks</th></tr>",
    ]
    html_lines.extend(
        f"<tr><td>{summary.Material}</td><td>{summary.Anchor_Peak}</td><td>{summary.Group_Shift_cm:+.2f}</td><td>{summary.Stretch:+.4f}</td><td>{summary.Matched_Count}/{summary.Candidate_Count}</td><td>{summary.Mean_Abs_Delta_cm:.2f}</td><td>{summary.Max_Abs_Delta_cm:.2f}</td><td>{summary.Group_Consistency_Score:.0f}</td><td>{summary.Remarks}</td></tr>"
        for summary in group_summaries
    )
    html_lines.extend([
        "</table>",
        "<h2>Peak table (CSV)</h2>",
        f"<pre>{peak_table_csv}</pre>",
        "<h2>Theoretical peak probing table (CSV)</h2>",
        f"<pre>{group_probe_table_csv}</pre>",
    ])
    if unmatched_rows:
        html_lines.extend(["<h2>Unmatched / ambiguous (CSV)</h2>", f"<pre>{unmatched_csv}</pre>"])
    html_lines.append("</body></html>")
    report_html = "\n".join(html_lines)

    report_lines = [
        f"Sample: {dataset_name}",
        f"Sample ID: {sample_id}",
        f"Ar:O2 flux: {_flux_from_name(dataset_name)}",
        f"Preprocessing: {preprocessing_method}",
        f"Baseline: {baseline_method}",
        f"Calibration: {calibration.method}",
        f"Si peak before/after: {calibration.si_peak_before_cm if calibration.si_peak_before_cm is not None else 'N/A'} / {calibration.si_peak_after_cm if calibration.si_peak_after_cm is not None else 'N/A'}",
        f"Global R² / RMSE / reduced χ² / AIC / BIC: {metrics['r_squared']:.5f} / {metrics['rmse']:.4g} / {metrics['reduced_chi2']:.4g} / {metrics['aic']:.4g} / {metrics['bic']:.4g}",
    ]
    report_lines.extend(credibility_summary)

    return RamanReport(
        sample_id=sample_id,
        sample_name=dataset_name,
        ar_o2_flux=_flux_from_name(dataset_name),
        baseline_method=baseline_method,
        calibration_method=calibration.method,
        si_peak_before_cm=calibration.si_peak_before_cm,
        si_peak_after_cm=calibration.si_peak_after_cm,
        global_r_squared=float(metrics["r_squared"]),
        global_rmse=float(metrics["rmse"]),
        global_reduced_chi2=float(metrics["reduced_chi2"]),
        fitting_segments=[],
        warnings=warnings,
        unmatched_peaks=unmatched,
        unobserved_reference_peaks=unobserved,
        credibility_summary=credibility_summary,
        report_text="\n".join(report_lines),
        alignment_csv=alignment_csv,
        peak_table_csv=peak_table_csv,
        group_probe_table_csv=group_probe_table_csv,
        unmatched_csv=unmatched_csv,
        report_markdown=report_markdown,
        report_html=report_html,
        report_json=report_json,
    )


@router.post("/fit", response_model=FitResponse, summary="Fit Raman peaks")
def fit_raman_peaks(req: FitRequest):
    x = np.asarray(req.x, dtype=float)
    y = np.asarray(req.y, dtype=float)
    enabled_rows = [row for row in req.peaks if row.enabled]
    if len(x) < 3 or len(y) < 3:
        raise HTTPException(status_code=400, detail="Spectrum too short for fitting")
    if not enabled_rows:
        raise HTTPException(status_code=400, detail="No enabled peaks provided")
    probe_candidates = [_prepare_candidate_dict(row, 0.0) for row in enabled_rows]
    if req.input_is_preprocessed:
        baseline = np.zeros_like(y, dtype=float)
        y_corrected = y.copy()
    else:
        baseline = _baseline_curve_with_peak_masks(
            x,
            y,
            probe_candidates,
            method=req.baseline_method,
            baseline_lambda=float(req.baseline_lambda),
            baseline_p=float(req.baseline_p),
            baseline_iter=int(req.baseline_iter),
        )
        y_corrected = y - baseline

    calibration = CalibrationSummary()
    si_probe_candidates = [
        candidate for candidate in probe_candidates
        if _group_name_for_candidate(candidate) == "Si group" and abs(float(candidate.get("ref_center", 0.0)) - 520.7) <= 25.0
    ]
    if si_probe_candidates:
        anchor_probe = _choose_anchor_for_group(x, y_corrected, "Si group", si_probe_candidates, req)
        if anchor_probe is not None:
            si_center = float(anchor_probe["peak"]["center"])
            offset = 520.7 - si_center
            if np.isfinite(offset) and abs(offset) <= 12.0:
                calibration = CalibrationSummary(
                    method="constant_offset_from_si_520.7",
                    offset_cm=float(offset),
                    si_peak_before_cm=si_center,
                    si_peak_after_cm=si_center + float(offset),
                    applied=abs(offset) > 1e-6,
                )
            else:
                calibration = CalibrationSummary(
                    method="si_detected_but_not_applied",
                    offset_cm=0.0,
                    si_peak_before_cm=si_center,
                    si_peak_after_cm=si_center,
                    applied=False,
                )

    x_cal = x + float(calibration.offset_cm)
    if calibration.applied:
        calibration.si_peak_after_cm = 520.7

    candidates = [_prepare_candidate_dict(row, float(calibration.offset_cm)) for row in enabled_rows]
    group_names = sorted({_group_name_for_candidate(candidate) for candidate in candidates}, key=_group_order)
    locked_total = np.zeros_like(y_corrected, dtype=float)
    group_fit_stages: list[GroupFitStage] = []
    stage_meta: dict[str, dict] = {}
    accepted_candidates: list[dict] = []
    all_probe_rows: list[PeakProbeRow] = []
    probed_rows_by_id: dict[str, dict] = {}
    grouped_candidates: dict[str, list[dict]] = {group_name: [] for group_name in group_names}
    for candidate in candidates:
        grouped_candidates.setdefault(_group_name_for_candidate(candidate), []).append(candidate)

    for group_name in group_names:
        group_candidates = grouped_candidates[group_name]
        y_remaining = y_corrected - locked_total
        anchor_info = _choose_anchor_for_group(x_cal, y_remaining, group_name, group_candidates, req)
        config = _group_config(group_name)
        anchor_candidate = anchor_info["candidate"] if anchor_info is not None else (
            sorted(
                group_candidates,
                key=lambda item: (
                    0 if item.get("anchor_peak") else 1,
                    min(abs(float(item.get("ref_center", 0.0)) - pref) for pref in config["preferred_anchors"]) if config["preferred_anchors"] else 0.0,
                ),
            )[0]
        )
        anchor_ref = float(anchor_candidate.get("ref_center", anchor_candidate.get("be", 0.0)))
        anchor_fitted = float(anchor_info["peak"]["center"]) if anchor_info is not None else None
        group_shift_seed = (anchor_fitted - anchor_ref) if anchor_fitted is not None else 0.0
        warnings: list[str] = []
        if anchor_info is None or float(anchor_info.get("snr", 0.0)) < 3.0:
            warnings.append("anchor peak not confidently observed; group kept conservative")

        group_fit = np.zeros_like(y_corrected, dtype=float)
        fitted_lookup: dict[str, dict] = {}
        probe_rows: list[PeakProbeRow] = []
        stage_rows_raw: list[dict] = []
        stretch = 0.0
        for candidate in group_candidates:
            ref_center = float(candidate.get("ref_center", candidate.get("be", 0.0)))
            predicted = _predicted_center(ref_center, group_shift_seed, stretch, anchor_ref)
            probe, peak, probe_fit = _probe_candidate_peak(
                x_cal,
                y_remaining,
                candidate,
                req,
                predicted_center_value=predicted,
            )
            probe_rows.append(probe)
            stage_row = _peak_row_from_probe(candidate, probe, group_shift=group_shift_seed)
            stage_rows_raw.append(stage_row)
            if peak is not None and probe.status in ACCEPTED_PEAK_STATUSES:
                fitted_lookup[str(candidate.get("peak_id", ""))] = peak
                group_fit += probe_fit

        residual_stage = y_remaining - group_fit
        group_shift, stretch = _estimate_group_shift_and_stretch(group_name, stage_rows_raw, anchor_ref, str(anchor_candidate.get("peak_id", "")))
        stage_summary = _group_summary_from_rows(
            group_name,
            stage_rows_raw,
            str(anchor_candidate.get("display_name", anchor_candidate.get("label", ""))),
            anchor_ref,
            anchor_fitted,
            group_shift,
            stretch,
            warnings,
        )
        for row in stage_rows_raw:
            row["Group_Shift_cm"] = stage_summary.Group_Shift_cm
            row["Spacing_Error_cm"] = stage_summary.Mean_Spacing_Error_cm
            row["Group_Consistency_Score"] = stage_summary.Group_Consistency_Score
            row["Group_Status"] = stage_summary.Status
        group_fit_stages.append(GroupFitStage(
            group_name=group_name,
            material=_group_material_name(group_name),
            anchor_peak_label=stage_summary.Anchor_Peak,
            anchor_ref_cm=float(anchor_ref),
            anchor_fitted_cm=anchor_fitted,
            group_shift_cm=float(group_shift),
            stretch=float(stretch),
            x=x_cal.tolist(),
            y_current_spectrum=y_remaining.tolist(),
            y_remaining_before=y_remaining.tolist(),
            y_group_fit=group_fit.tolist(),
            y_locked_previous=locked_total.tolist(),
            y_combined_fit=(locked_total + group_fit).tolist(),
            residuals=residual_stage.tolist(),
            peaks=[FitPeakRow(**row) for row in stage_rows_raw],
            probe_rows=probe_rows,
            r_squared=float(1.0 - np.sum(residual_stage ** 2) / max(np.sum((y_remaining - np.mean(y_remaining)) ** 2), 1e-12)),
            warnings=warnings,
        ))
        all_probe_rows.extend(probe_rows)
        for row in stage_rows_raw:
            probed_rows_by_id[str(row["Peak_ID"])] = dict(row)
        stage_meta[group_name] = {
            "anchor_label": stage_summary.Anchor_Peak,
            "anchor_ref": anchor_ref,
            "anchor_fitted": anchor_fitted,
            "warnings": warnings,
        }
        for candidate in group_candidates:
            peak = fitted_lookup.get(str(candidate.get("peak_id", "")))
            row = next((item for item in stage_rows_raw if item["Peak_ID"] == str(candidate.get("peak_id", ""))), None)
            if peak is None or row is None:
                continue
            if row["Status"] not in ACCEPTED_PEAK_STATUSES:
                continue
            accepted = dict(candidate)
            accepted["be"] = float(peak.get("center", candidate.get("be", 0.0)))
            accepted["amplitude"] = float(peak.get("amplitude", 0.0))
            accepted["fwhm"] = float(peak.get("fwhm", candidate.get("fwhm", 8.0)))
            accepted["profile"] = str(peak.get("profile", candidate.get("profile", req.profile)))
            accepted["center_min"] = accepted["be"] - _center_slack(candidate, refinement=True)
            accepted["center_max"] = accepted["be"] + _center_slack(candidate, refinement=True)
            accepted_candidates.append(accepted)
        locked_total += group_fit

    if accepted_candidates:
        final_result = _fit_model(x_cal, y_corrected, accepted_candidates, req)
        if not final_result.get("success"):
            raise HTTPException(status_code=400, detail=str(final_result.get("message", "Final refinement failed")))
    else:
        final_result = {
            "success": True,
            "peaks": [],
            "y_fit": np.zeros_like(y_corrected),
            "y_individual": [],
            "residuals": y_corrected.copy(),
            "r_squared": 0.0,
            "adjusted_r_squared": 0.0,
            "rmse": float(np.sqrt(np.mean(y_corrected ** 2))) if len(y_corrected) else 0.0,
            "aic": 0.0,
            "bic": 0.0,
        }

    final_lookup = {str(peak.get("peak_id", "")): dict(peak) for peak in final_result.get("peaks", [])}
    residuals = np.asarray(final_result.get("residuals", np.zeros_like(y_corrected)), dtype=float)
    noise_final = _robust_noise(residuals)
    final_rows_raw: list[dict] = []
    for candidate in candidates:
        peak_id = str(candidate.get("peak_id", ""))
        if peak_id in final_lookup:
            peak = final_lookup[peak_id]
            row = dict(probed_rows_by_id.get(peak_id, _peak_row_from_candidate(candidate, peak, noise_final, None, group_shift=0.0)))
            ref_center = float(row["Ref_cm"]) if row.get("Ref_cm") is not None else float(peak.get("center", 0.0))
            row["Center_cm"] = float(peak.get("center", row["Center_cm"]))
            row["Delta_cm"] = float(row["Center_cm"] - ref_center)
            row["FWHM_cm"] = float(peak.get("fwhm", row["FWHM_cm"]))
            row["Height"] = float(peak.get("amplitude", row["Height"]))
            row["Area"] = float(peak.get("area", row["Area"]))
            row["Area_pct"] = float(peak.get("area_pct", row["Area_pct"]))
            row["Profile"] = str(peak.get("profile", row.get("Profile", "")))
            row["Fit_Status"] = "Fit OK"
            row["Status"] = "accepted" if row.get("Status") in ACCEPTED_PEAK_STATUSES else row.get("Status", "accepted")
            final_rows_raw.append(row)
        else:
            final_rows_raw.append(dict(probed_rows_by_id.get(peak_id, _peak_row_from_candidate(candidate, None, noise_final, None, group_shift=0.0))))

    group_summaries: list[GroupSummary] = []
    summary_by_group: dict[str, GroupSummary] = {}
    for group_name in group_names:
        rows_in_group = [row for row in final_rows_raw if row["Phase_Group"] == group_name]
        meta = stage_meta.get(group_name, {})
        anchor_peak_id = next(
            (row["Peak_ID"] for row in rows_in_group if row["Peak_Name"] == meta.get("anchor_label")),
            next((row["Peak_ID"] for row in rows_in_group if row["Anchor_Peak"]), ""),
        )
        anchor_ref = float(meta.get("anchor_ref", rows_in_group[0]["Ref_cm"] if rows_in_group else 0.0))
        group_shift, stretch = _estimate_group_shift_and_stretch(group_name, rows_in_group, anchor_ref, anchor_peak_id)
        anchor_row = next((row for row in rows_in_group if row["Peak_ID"] == anchor_peak_id and row["Status"] in PROBED_OBSERVED_STATUSES), None)
        summary = _group_summary_from_rows(
            group_name,
            rows_in_group,
            str(meta.get("anchor_label", "")),
            anchor_ref if anchor_ref else None,
            float(anchor_row["Center_cm"]) if anchor_row is not None else meta.get("anchor_fitted"),
            group_shift,
            stretch,
            list(meta.get("warnings", [])),
        )
        group_summaries.append(summary)
        summary_by_group[group_name] = summary

    rows: list[FitPeakRow] = []
    for row in final_rows_raw:
        summary = summary_by_group.get(row["Phase_Group"])
        if summary is not None:
            row["Group_Shift_cm"] = summary.Group_Shift_cm
            row["Spacing_Error_cm"] = summary.Mean_Spacing_Error_cm
            row["Group_Consistency_Score"] = summary.Group_Consistency_Score
            row["Group_Status"] = summary.Status
            row["Anchor_Related_Delta_cm"] = (
                row["Delta_cm"] - summary.Group_Shift_cm if row["Delta_cm"] is not None else None
            )
        rows.append(FitPeakRow(**row))

    alignment_rows = _alignment_rows_from_peaks(req.dataset_name, [row.model_dump() for row in rows])
    detected_unmatched_rows: list[list[object]] = []
    accepted_centers = [float(row.Center_cm) for row in rows if row.Status in PROBED_OBSERVED_STATUSES]
    detected_indices = detect_spectrum_peaks(
        x_cal,
        y_corrected,
        prominence_ratio=0.04,
        height_ratio=0.0,
        min_distance_x=8.0,
        max_peaks=40,
    )
    sample_id = _sample_id_from_name(req.dataset_name)
    for idx in detected_indices:
        center = float(x_cal[idx])
        if any(abs(center - accepted_center) <= 8.0 for accepted_center in accepted_centers):
            continue
        detected_unmatched_rows.append([
            sample_id,
            "observed_unassigned",
            f"{center:.1f} cm⁻¹",
            "unassigned",
            None,
            center,
            "uncertain",
            "detected in corrected spectrum but not retained in the grouped model",
        ])
    for row in rows:
        if row.Status == "not_observed":
            detected_unmatched_rows.append([
                sample_id,
                "database_not_observed",
                row.Peak_Name,
                row.Material,
                row.Ref_cm,
                None,
                row.Status,
                row.Note,
            ])
        elif row.Status in {"candidate", "uncertain", "ambiguous", "overlapped", "rejected"}:
            detected_unmatched_rows.append([
                sample_id,
                "ambiguous_or_low_confidence",
                row.Peak_Name,
                row.Material,
                row.Ref_cm,
                row.Center_cm,
                row.Status,
                row.Note,
            ])

    n_points = len(x_cal)
    n_params = max(len(final_result.get("peaks", [])) * 3, 1)
    ss_res = float(np.sum(residuals ** 2))
    reduced_chi2 = ss_res / max(n_points - n_params, 1)
    metrics = {
        "r_squared": float(final_result.get("r_squared", 0.0)),
        "adjusted_r_squared": float(final_result.get("adjusted_r_squared", 0.0)),
        "rmse": float(final_result.get("rmse", 0.0)),
        "reduced_chi2": float(reduced_chi2),
        "aic": float(final_result.get("aic", 0.0)),
        "bic": float(final_result.get("bic", 0.0)),
    }
    residual_diagnostics = _residual_diagnostics(x_cal, residuals)
    report = _build_report_v2(
        req.dataset_name,
        req,
        calibration,
        metrics,
        group_summaries,
        [row.model_dump() for row in rows],
        alignment_rows,
        detected_unmatched_rows,
        all_probe_rows,
    )

    message_parts = []
    if calibration.applied:
        message_parts.append(f"Si calibration applied: offset {calibration.offset_cm:+.3f} cm⁻¹")
    message_parts.append("Sequential grouped fitting completed: Si → β-Ga₂O₃ → NiO → global refinement")

    return FitResponse(
        success=True,
        message="; ".join(message_parts),
        dataset_name=req.dataset_name,
        profile=req.profile,
        y_fit=(baseline + np.asarray(final_result.get("y_fit", np.zeros_like(y_corrected)), dtype=float)).tolist(),
        residuals=residuals.tolist(),
        y_individual=[np.asarray(item, dtype=float).tolist() for item in final_result.get("y_individual", [])],
        peaks=rows,
        r_squared=metrics["r_squared"],
        adjusted_r_squared=metrics["adjusted_r_squared"],
        rmse=metrics["rmse"],
        aic=metrics["aic"],
        bic=metrics["bic"],
        residual_diagnostics=residual_diagnostics,
        group_summaries=group_summaries,
        calibration=calibration,
        segment_summaries=[],
        alignment_rows=alignment_rows,
        report=report,
        x_calibrated=x_cal.tolist(),
        y_baseline=baseline.tolist(),
        y_corrected=y_corrected.tolist(),
        y_fit_corrected=np.asarray(final_result.get("y_fit", np.zeros_like(y_corrected)), dtype=float).tolist(),
        group_fit_stages=group_fit_stages,
        group_probe_rows=all_probe_rows,
    )
