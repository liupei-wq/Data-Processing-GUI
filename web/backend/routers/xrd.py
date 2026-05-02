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
from core.peak_fitting import fit_peaks
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
    gaussian_nonnegative_guard: bool = False
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
    gaussian_guard_enabled: bool = False
    gaussian_guard_applied: bool = False
    gaussian_guard_scale: Optional[float] = None
    y_processed: List[float]
    gaussian_fits: List[GaussianFitRow] = Field(default_factory=list)


class ProcessResponse(BaseModel):
    datasets: List[DatasetOutput]
    average: Optional[DatasetOutput] = None


class PeakDetectRequest(BaseModel):
    x: List[float]
    y: List[float]
    sensitivity: str = "medium"
    min_distance: float = 0.2
    width_min: float = 0.03
    width_max: float = 1.5
    exclude_ranges: List["PeakExcludeRangeInput"] = Field(default_factory=list)
    max_peaks: int = 30
    wavelength: float = 1.5406
    min_snr: float = 3.0


class PeakExcludeRangeInput(BaseModel):
    start: float
    end: float


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


class FitPeakInput(BaseModel):
    peak_id: str = ""
    label: str
    center: float
    fwhm: float
    amplitude: float
    phase: str = ""
    hkl: str = ""
    confidence: str = "medium"
    near_reference: bool = False
    center_tolerance: float = 0.3
    fwhm_min: float = 0.03
    fwhm_max: float = 2.0
    note: str = ""
    enabled: bool = True


class FitRequest(BaseModel):
    dataset_name: str = "XRD"
    x: List[float]
    y: List[float]
    peaks: List[FitPeakInput]
    profile: str = "pseudo_voigt"
    fit_lo: Optional[float] = None
    fit_hi: Optional[float] = None
    maxfev: int = 20000


class FitPeakRow(BaseModel):
    Peak_ID: str
    Peak_Name: str
    Phase: str = ""
    HKL: str = ""
    Profile: str
    Seed_Center_deg: float
    Center_deg: float
    Delta_deg: float
    FWHM_deg: float
    Height: float
    Area: float
    Area_pct: float
    Eta: Optional[float] = None
    Confidence: str = "medium"
    Near_Reference: bool = False
    Fit_Status: str = "Fit OK"
    Note: str = ""


class FitResponse(BaseModel):
    success: bool
    message: str = ""
    dataset_name: str
    profile: str
    fit_lo: Optional[float] = None
    fit_hi: Optional[float] = None
    y_fit: List[float]
    residuals: List[float]
    y_individual: List[List[float]]
    peaks: List[FitPeakRow]
    r_squared: float
    adjusted_r_squared: float = 0.0
    rmse: float = 0.0
    aic: float = 0.0
    bic: float = 0.0


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
    source: str = "內建 XRD 參考峰資料庫"
    tolerance: float = 0.3


class RefPeaksResponse(BaseModel):
    peaks: List[RefPeak]


ProcessParams.model_rebuild()
PeakDetectRequest.model_rebuild()


def _estimate_noise_mad(values: np.ndarray) -> float:
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if values.size == 0:
        return 0.0
    center = float(np.median(values))
    mad = float(np.median(np.abs(values - center)))
    noise = 1.4826 * mad
    if not np.isfinite(noise) or noise <= 0:
        noise = float(np.std(values))
    return noise if np.isfinite(noise) and noise > 0 else 0.0


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
        raise HTTPException(status_code=400, detail="沒有提供資料集")

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
            raise HTTPException(status_code=400, detail="檔案之間沒有重疊的 X 軸範圍")
        x_grid = np.linspace(
            x_min,
            x_max,
            params.n_points if (params.interpolate or params.gaussian_enabled) else 500,
        )
        interped = [interpolate_spectrum_to_grid(x, y, x_grid) for _, x, y in processed_pairs]
        y_avg = mean_spectrum_arrays(interped)
        average_output = _build_dataset_output("平均", x_grid, y_avg, params)

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
    gaussian_guard_applied = False
    gaussian_guard_scale: Optional[float] = None
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
        model_arr, subtracted_arr, fit_rows, guard_scale = fit_fixed_gaussian_templates(
            x,
            y,
            centers,
            fixed_fwhm=float(params.gaussian_fwhm),
            fixed_area=fixed_area,
            search_half_width=float(params.gaussian_search_half_width),
            prevent_negative=bool(params.gaussian_nonnegative_guard),
        )
        gaussian_model = model_arr
        gaussian_subtracted = subtracted_arr
        gaussian_guard_scale = guard_scale
        gaussian_guard_applied = bool(params.gaussian_nonnegative_guard) and guard_scale is not None and guard_scale < 0.999999
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
        gaussian_guard_enabled=bool(params.gaussian_nonnegative_guard),
        gaussian_guard_applied=gaussian_guard_applied,
        gaussian_guard_scale=gaussian_guard_scale,
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
    valid = np.isfinite(x) & np.isfinite(y)
    x = x[valid]
    y = y[valid]
    if len(x) < 3 or len(y) < 3:
        return PeakDetectResponse(peaks=[])

    dx = np.diff(x)
    dx = dx[np.isfinite(dx) & (dx > 0)]
    median_dx = float(np.median(dx)) if len(dx) else 0.0
    distance_pts = max(1, int(round(float(req.min_distance) / median_dx))) if median_dx > 0 else 1

    exclude_mask = np.ones(len(x), dtype=bool)
    normalized_ranges: list[tuple[float, float]] = []
    for item in req.exclude_ranges:
        start = float(min(item.start, item.end))
        end = float(max(item.start, item.end))
        if not np.isfinite(start) or not np.isfinite(end):
            continue
        normalized_ranges.append((start, end))
        exclude_mask &= ~((x >= start) & (x <= end))

    y_for_noise = y[exclude_mask] if int(np.count_nonzero(exclude_mask)) >= 5 else y
    baseline = float(np.median(y_for_noise)) if len(y_for_noise) else float(np.median(y))
    noise = _estimate_noise_mad(y_for_noise)
    if not np.isfinite(noise) or noise <= 0:
        noise = 1e-12

    sensitivity_factors = {
        "high": 3.0,
        "medium": 5.0,
        "low": 8.0,
    }
    prominence_factor = sensitivity_factors.get(str(req.sensitivity).lower(), 5.0)
    height_min = baseline + max(float(req.min_snr), 0.0) * noise
    prominence_min = prominence_factor * noise

    width_min_pts = None
    width_max_pts = None
    if median_dx > 0:
        width_min_pts = max(1, int(round(max(float(req.width_min), 0.0) / median_dx)))
        width_max_pts = max(width_min_pts, int(round(max(float(req.width_max), float(req.width_min)) / median_dx)))

    find_kwargs = {
        "height": height_min,
        "prominence": prominence_min,
    }
    if distance_pts > 1:
        find_kwargs["distance"] = distance_pts
    if width_min_pts is not None and width_max_pts is not None:
        find_kwargs["width"] = (width_min_pts, width_max_pts)

    idx, props = find_peaks(y, **find_kwargs)
    prominences = np.asarray(props.get("prominences", np.zeros(len(idx))), dtype=float)

    if len(idx) == 0:
        return PeakDetectResponse(peaks=[])

    if normalized_ranges:
        keep_mask = np.ones(len(idx), dtype=bool)
        peak_positions = x[idx]
        for range_idx, peak_pos in enumerate(peak_positions):
            if any(start <= peak_pos <= end for start, end in normalized_ranges):
                keep_mask[range_idx] = False
        idx = idx[keep_mask]
        prominences = prominences[keep_mask]
        if len(idx) == 0:
            return PeakDetectResponse(peaks=[])

    if req.max_peaks > 0 and len(idx) > req.max_peaks:
        order = np.argsort(prominences)[::-1][: req.max_peaks]
        order = np.sort(order)
        idx = idx[order]
        prominences = prominences[order]

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
        snr = float(max(y[i] - baseline, prominence) / noise)
        if snr >= max(float(req.min_snr) + 4.0, 8.0):
            confidence = "high"
        elif snr >= max(float(req.min_snr) + 1.0, 4.0):
            confidence = "medium"
        else:
            confidence = "low"
        note_parts = []
        if confidence == "low":
            note_parts.append("接近雜訊底線")
        elif confidence == "medium":
            note_parts.append("中等信心峰")
        if snr < max(float(req.min_snr) + 1.0, 4.0):
            note_parts.append("建議人工確認")
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


@router.post("/fit", response_model=FitResponse, summary="Fit XRD peaks")
def fit_xrd_peaks(req: FitRequest):
    x = np.asarray(req.x, dtype=float)
    y = np.asarray(req.y, dtype=float)
    enabled_rows = [row for row in req.peaks if row.enabled]

    if len(x) < 4 or len(y) < 4 or len(x) != len(y):
        raise HTTPException(status_code=400, detail="光譜點數不足或 x/y 長度不一致")
    if not enabled_rows:
        raise HTTPException(status_code=400, detail="沒有可用的擬合峰 seed")

    fit_range = None
    fit_lo = None
    fit_hi = None
    if req.fit_lo is not None and req.fit_hi is not None:
        fit_lo = float(min(req.fit_lo, req.fit_hi))
        fit_hi = float(max(req.fit_lo, req.fit_hi))
        fit_range = (fit_lo, fit_hi)

    init_peaks = [
        {
            "peak_id": row.peak_id,
            "label": row.label,
            "center": float(row.center),
            "fwhm": float(max(row.fwhm, 0.01)),
            "amplitude": float(max(row.amplitude, 1e-9)),
            "phase": row.phase,
            "hkl": row.hkl,
            "confidence": row.confidence,
            "near_reference": row.near_reference,
            "center_tolerance": float(max(row.center_tolerance, 0.01)),
            "fwhm_min": float(max(row.fwhm_min, 0.01)),
            "fwhm_max": float(max(row.fwhm_max, row.fwhm_min + 0.01)),
            "note": row.note,
            "seed_center": float(row.center),
            "profile": req.profile,
            "eta": 0.5,
        }
        for row in enabled_rows
    ]

    try:
        result = fit_peaks(
            x,
            y,
            init_peaks=init_peaks,
            profile=req.profile,
            maxfev=int(req.maxfev),
            fit_range=fit_range,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"XRD 擬合失敗：{exc}") from exc

    if not result.get("success", False):
        raise HTTPException(status_code=422, detail=result.get("message", "XRD 擬合失敗"))

    rows: list[FitPeakRow] = []
    for idx, peak in enumerate(result.get("peaks", []), start=1):
        flags: list[str] = []
        if bool(peak.get("center_at_boundary", False)):
            flags.append("中心位置碰到邊界")
        if bool(peak.get("fwhm_at_boundary", False)):
            flags.append("半高寬達到限制")
        if bool(peak.get("broad_peak", False)):
            flags.append("寬峰")
        rows.append(FitPeakRow(
            Peak_ID=str(peak.get("peak_id", f"peak_{idx}")),
            Peak_Name=str(peak.get("label", f"峰 {idx}")),
            Phase=str(peak.get("phase", "")),
            HKL=str(peak.get("hkl", "")),
            Profile=str(peak.get("profile", req.profile)),
            Seed_Center_deg=float(peak.get("seed_center", peak.get("center", 0.0))),
            Center_deg=float(peak.get("center", 0.0)),
            Delta_deg=float(peak.get("center", 0.0) - peak.get("seed_center", peak.get("center", 0.0))),
            FWHM_deg=float(peak.get("fwhm", 0.0)),
            Height=float(peak.get("amplitude", 0.0)),
            Area=float(peak.get("area", 0.0)),
            Area_pct=float(peak.get("area_pct", 0.0)),
            Eta=float(peak.get("eta")) if peak.get("eta") is not None else None,
            Confidence=str(peak.get("confidence", "medium")),
            Near_Reference=bool(peak.get("near_reference", False)),
            Fit_Status="擬合碰到邊界" if flags else "擬合成功",
            Note="; ".join(flags + ([str(peak.get("note"))] if peak.get("note") else [])),
        ))

    def _to_list(arr):
        return arr.tolist() if hasattr(arr, "tolist") else list(arr)

    return FitResponse(
        success=True,
        message="",
        dataset_name=req.dataset_name,
        profile=req.profile,
        fit_lo=fit_lo,
        fit_hi=fit_hi,
        y_fit=_to_list(result.get("y_fit", [])),
        residuals=_to_list(result.get("residuals", [])),
        y_individual=[_to_list(item) for item in result.get("y_individual", [])],
        peaks=rows,
        r_squared=float(result.get("r_squared", 0.0)),
        adjusted_r_squared=float(result.get("adjusted_r_squared", 0.0)),
        rmse=float(result.get("rmse", 0.0)),
        aic=float(result.get("aic", 0.0)),
        bic=float(result.get("bic", 0.0)),
    )


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
                source=str(p.get("source", ref.get("source", "內建 XRD 參考峰資料庫"))),
                tolerance=float(p.get("tolerance", ref.get("tolerance", 0.3))),
            ))

    return RefPeaksResponse(peaks=sorted(peaks, key=lambda p: p.two_theta))
