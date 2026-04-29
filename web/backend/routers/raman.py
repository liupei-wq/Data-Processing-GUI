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
from db.raman_database import RAMAN_REFERENCES, get_enriched_raman_peaks, get_raman_peak_library

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
    bg_method: str = "none"           # none | constant | linear | polynomial | asls | airpls | rubber_band | manual_anchor
    bg_x_start: Optional[float] = None
    bg_x_end: Optional[float] = None
    bg_poly_deg: int = 3
    bg_baseline_lambda: float = 1e5
    bg_baseline_p: float = 0.01
    bg_baseline_iter: int = 20
    bg_anchor_x: List[float] = []
    bg_anchor_y: List[float] = []
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
    oxidation_state: str = "N/A"
    oxidation_state_inference: str = "Not applicable"
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
    oxidation_state: str = "N/A"
    oxidation_state_inference: str = "Not applicable"
    role: str = ""
    mode_label: str = ""
    note: str = ""
    ref_position_cm: Optional[float] = None
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
    profile: str = "voigt"
    maxfev: int = 20000
    fit_lo: Optional[float] = None
    fit_hi: Optional[float] = None
    robust_loss: str = "linear"
    segment_weights: List[SegmentWeight] = []
    residual_target_enabled: bool = False
    residual_target: float = 0.05
    residual_target_rounds: int = 4
    peaks: List[FitPeakInput]


class FitPeakRow(BaseModel):
    Peak_ID: str
    Peak_Name: str
    Phase: str = ""
    Phase_Group: str = ""
    Material: str
    Peak_Role: str
    Mode_Label: str
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
    FWHM_Min_cm: Optional[float] = None
    FWHM_Max_cm: Optional[float] = None
    Broad_Background_Like: bool = False
    Area: float
    Area_pct: float
    SNR: Optional[float] = None
    Fit_Status: str = "Fit OK"
    Physical_Confidence: str = "Medium"
    Confidence: str = "Medium"
    Quality_Flags: List[str] = []
    Group_Shift_cm: Optional[float] = None
    Spacing_Error_cm: Optional[float] = None
    Group_Consistency_Score: Optional[float] = None
    Group_Status: str = ""
    Source_Note: str = ""
    Reference: str = ""
    Is_Doublet: bool = False


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
    Peak_Count: int
    Group_Shift_cm: float
    Mean_Spacing_Error_cm: float
    Max_Spacing_Error_cm: float
    Group_Consistency_Score: float
    Status: str


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
            manual_anchor_x=params.bg_anchor_x,
            manual_anchor_y=params.bg_anchor_y,
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
                    oxidation_state=str(row.get("oxidation_state", "N/A")),
                    oxidation_state_inference=str(row.get("oxidation_state_inference", "Not applicable")),
                    strength=float(row.get("strength", 0.0)),
                    note=str(row.get("note", "")),
                )
            )
    peaks.sort(key=lambda item: (item.material, item.position_cm))
    return RefPeaksResponse(peaks=peaks)


@router.get("/peak-library", summary="Get enriched Raman peak library")
def get_peak_library():
    return {"peaks": get_raman_peak_library()}


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
            "material": row.material or row.phase,
            "phase": row.phase or row.material,
            "phase_group": row.phase_group or row.phase or row.material,
            "role": row.role,
            "mode_label": row.mode_label,
            "display_name": row.display_name or row.label,
            "note": row.note,
            "species": row.species,
            "tolerance_cm": float(max(row.tolerance_cm, 0.0)),
            "fwhm_min": float(max(row.fwhm_min, 0.01)),
            "fwhm_max": float(max(row.fwhm_max, row.fwhm_min + 0.1)),
            "profile": _normal_profile_for_physical_peak(row.profile or req.profile, row.peak_type),
            "allowed_profiles": row.allowed_profiles,
            "peak_type": row.peak_type,
            "anchor_peak": row.anchor_peak,
            "can_be_quantified": row.can_be_quantified,
            "related_technique": row.related_technique,
            "reference": row.reference,
            "oxidation_state": row.oxidation_state,
            "oxidation_state_inference": row.oxidation_state_inference,
            "theoretical_center": float(row.theoretical_center) if row.theoretical_center is not None else (
                float(row.ref_position_cm) if row.ref_position_cm is not None else float(row.position_cm)
            ),
            "lock_center": row.lock_center,
            "lock_fwhm": row.lock_fwhm,
            "lock_area": row.lock_area,
            "lock_profile": row.lock_profile,
            "ref_center": float(row.ref_position_cm) if row.ref_position_cm is not None else float("nan"),
        }
        for row in enabled_rows
    ]

    fit_range = None
    if req.fit_lo is not None and req.fit_hi is not None:
        fit_range = (float(req.fit_lo), float(req.fit_hi))

    target_message = ""
    if req.residual_target_enabled:
        result, target_message = _force_residual_target(x, y, init_peaks, req, fit_range)
    else:
        result = fit_peaks(
            x,
            y,
            init_peaks=init_peaks,
            profile=req.profile,
            maxfev=int(req.maxfev),
            fit_range=fit_range,
            segment_weights=[item.dict() for item in req.segment_weights],
            robust_loss=req.robust_loss,
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
            adjusted_r_squared=0.0,
            rmse=0.0,
            aic=0.0,
            bic=0.0,
            residual_diagnostics=ResidualDiagnostics(),
            group_summaries=[],
        )

    residuals_arr = np.asarray(result["residuals"], dtype=float)
    noise = _robust_noise(residuals_arr)
    raw_rows: list[dict] = []
    for peak in result["peaks"]:
        ref_center = peak.get("ref_center")
        ref_center_value = float(ref_center) if ref_center is not None and np.isfinite(ref_center) else None
        delta_value = (
            float(peak["center"]) - ref_center_value
            if ref_center_value is not None
            else None
        )
        tolerance = float(peak.get("tolerance_cm", 8.0))
        amplitude = abs(float(peak.get("amplitude", 0.0)))
        snr = float(amplitude / noise) if noise > 0 else None
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
        if str(peak.get("peak_type", "")) == "residual_assist":
            flags.append("residual assist / possible overfit")
        model_component = str(peak.get("peak_type", "")).lower() in {"residual_assist", "background_like", "background-like", "background component"}

        raw_rows.append(
            {
                "Peak_ID": str(peak.get("peak_id", "")),
                "Peak_Name": str(peak.get("display_name", peak["label"])),
                "Phase": "Model component" if model_component else str(peak.get("phase", peak.get("material", ""))),
                "Phase_Group": "Model component" if model_component else str(peak.get("phase_group", peak.get("phase", peak.get("material", "")))),
                "Material": str(peak.get("material", "")),
                "Peak_Role": str(peak.get("role", "")),
                "Mode_Label": str(peak.get("mode_label", "")),
                "Species": str(peak.get("species", "")),
                "Oxidation_State": str(peak.get("oxidation_state", "N/A")),
                "Oxidation_State_Inference": str(peak.get("oxidation_state_inference", "Not applicable")),
                "Assignment_Basis": "model component" if model_component else "phase/mode-based",
                "Profile": str(peak.get("profile", req.profile)),
                "Peak_Type": str(peak.get("peak_type", "")),
                "Anchor_Peak": bool(peak.get("anchor_peak", False)),
                "Can_Be_Quantified": bool(peak.get("can_be_quantified", True)) and not model_component,
                "Ref_cm": ref_center_value,
                "Tolerance_cm": tolerance,
                "Center_Min_cm": float(peak.get("center_min")) if peak.get("center_min") is not None else None,
                "Center_Max_cm": float(peak.get("center_max")) if peak.get("center_max") is not None else None,
                "Center_cm": float(peak["center"]),
                "Delta_cm": delta_value,
                "Boundary_Peak": bool(peak.get("center_at_boundary", False)),
                "FWHM_cm": float(peak["fwhm"]),
                "FWHM_Min_cm": float(peak.get("fwhm_min")) if peak.get("fwhm_min") is not None else None,
                "FWHM_Max_cm": float(peak.get("fwhm_max")) if peak.get("fwhm_max") is not None else None,
                "Broad_Background_Like": bool(peak.get("broad_peak", False)),
                "Area": float(peak["area"]),
                "Area_pct": float(peak["area_pct"]),
                "SNR": snr,
                "Fit_Status": "Model component" if model_component else ("Fit boundary" if flags else "Fit OK"),
                "Quality_Flags": flags,
                "Source_Note": str(peak.get("note", "")),
                "Reference": str(peak.get("reference", "")),
                "Is_Doublet": bool(peak.get("doublet", False)),
            }
        )

    physical_area_total = sum(
        float(row["Area"])
        for row in raw_rows
        if row.get("Can_Be_Quantified") and row.get("Peak_Type") != "residual_assist"
    )
    for row in raw_rows:
        if row.get("Can_Be_Quantified") and physical_area_total > 0:
            row["Area_pct"] = float(row["Area"]) / physical_area_total * 100.0
        elif row.get("Peak_Type") == "residual_assist":
            row["Area_pct"] = 0.0

    physical_group_rows = [
        row for row in raw_rows
        if row.get("Can_Be_Quantified") and row.get("Peak_Type") != "residual_assist"
    ]
    group_summaries, group_lookup = _build_group_summaries(physical_group_rows)
    rows: list[FitPeakRow] = []
    for row in raw_rows:
        group_info = group_lookup.get(row["Phase_Group"])
        if group_info:
            row["Group_Shift_cm"] = group_info["shift"]
            row["Spacing_Error_cm"] = group_info["spacing"]
            row["Group_Consistency_Score"] = group_info["score"]
            row["Group_Status"] = group_info["status"]
            if group_info["status"] == "reasonable shifted group":
                row["Quality_Flags"] = [flag for flag in row["Quality_Flags"] if flag != "center outside tolerance"]
                row["Quality_Flags"].append("reasonable shifted group")
        else:
            row["Group_Shift_cm"] = None
            row["Spacing_Error_cm"] = None
            row["Group_Consistency_Score"] = None
            row["Group_Status"] = ""
        physical_confidence = _confidence_from_flags(
            row["Quality_Flags"],
            float(row["SNR"]) if row["SNR"] is not None else 0.0,
            float(row["Area_pct"]),
            row["Group_Consistency_Score"],
        )
        row["Physical_Confidence"] = physical_confidence
        row["Confidence"] = physical_confidence
        rows.append(FitPeakRow(**row))

    residual_diagnostics = _residual_diagnostics(x, residuals_arr)

    return FitResponse(
        success=True,
        message=target_message,
        dataset_name=req.dataset_name,
        profile=req.profile,
        y_fit=np.asarray(result["y_fit"], dtype=float).tolist(),
        residuals=np.asarray(result["residuals"], dtype=float).tolist(),
        y_individual=[np.asarray(item, dtype=float).tolist() for item in result["y_individual"]],
        peaks=rows,
        r_squared=float(result["r_squared"]),
        adjusted_r_squared=float(result.get("adjusted_r_squared", 0.0)),
        rmse=float(result.get("rmse", 0.0)),
        aic=float(result.get("aic", 0.0)),
        bic=float(result.get("bic", 0.0)),
        residual_diagnostics=residual_diagnostics,
        group_summaries=group_summaries,
    )
