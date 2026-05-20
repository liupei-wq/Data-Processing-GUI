"""XPS API endpoints."""

from __future__ import annotations

from typing import List, Optional

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from core.parsers import parse_xps_bytes
from core.peak_fitting import fit_peaks, perturb_init_peaks
from core.processing import apply_background, apply_normalization, smooth_signal
from core.spectrum_ops import detect_spectrum_peaks
from db.xps_database import CATEGORY_COLORS, CATEGORY_NAMES_ZH, DOUBLET_INFO, ELEMENTS, get_orbital_rsf

router = APIRouter()


# ── pydantic models ───────────────────────────────────────────────────────────

class ParsedFile(BaseModel):
    name: str
    x: List[float]
    y: List[float]
    n_points: int


class ParseResponse(BaseModel):
    files: List[ParsedFile]
    errors: List[str] = Field(default_factory=list)


class DatasetInput(BaseModel):
    name: str
    x: List[float]
    y: List[float]


class ProcessParams(BaseModel):
    interpolate: bool = False
    n_points: int = 1000
    average: bool = False
    energy_shift: float = 0.0
    bg_enabled: bool = False
    bg_method: str = "linear"        # linear | shirley | shirley_linear | tougaard | polynomial | asls | airpls
    bg_x_start: Optional[float] = None
    bg_x_end: Optional[float] = None
    bg_poly_deg: int = 3
    bg_baseline_lambda: float = 1e5
    bg_baseline_p: float = 0.01
    bg_baseline_iter: int = 20
    bg_tougaard_B: float = 2866.0
    bg_tougaard_C: float = 1643.0
    valid_range_enabled: bool = False
    valid_x_start: Optional[float] = None
    valid_x_end: Optional[float] = None
    smooth_method: str = "none"      # none | moving_average | savitzky_golay
    smooth_window: int = 5
    smooth_poly: int = 3
    norm_method: str = "none"        # none | min_max | max | area
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
    average: Optional[DatasetOutput] = None


class PeakDetectParams(BaseModel):
    x: List[float]
    y: List[float]
    prominence: float = 0.05
    min_distance: float = 0.3
    max_peaks: int = 20


class DetectedPeak(BaseModel):
    binding_energy: float
    intensity: float
    rel_intensity: float
    fwhm_ev: Optional[float] = None


class PeakDetectResponse(BaseModel):
    peaks: List[DetectedPeak]


class InitPeak(BaseModel):
    center: float
    fwhm: float
    amplitude: float
    label: Optional[str] = None
    lock_center: bool = True
    lock_fwhm: bool = True
    lock_area: bool = True
    center_min: Optional[float] = None
    center_max: Optional[float] = None
    fwhm_min: Optional[float] = None
    fwhm_max: Optional[float] = None
    amplitude_max: Optional[float] = None
    theoretical_center: Optional[float] = None


class FitRequest(BaseModel):
    x: List[float]
    y: List[float]
    peaks: List[InitPeak]
    profile: str = "voigt"
    maxfev: int = 6000
    fit_range: Optional[List[float]] = None
    peak_labels: Optional[List[str]] = None
    n_restarts: int = 1


class FitPeakRow(BaseModel):
    Peak_Name: str
    Center_eV: float
    FWHM_eV: float
    Area: float
    Height: float
    Area_pct: Optional[float] = None


class FitResponse(BaseModel):
    y_fit: List[float]
    y_individual: List[List[float]]
    residuals: List[float]
    peaks: List[FitPeakRow]
    r_squared: float = 0.0
    rmse: float = 0.0
    chi_red: Optional[float] = None


class CalibrationRequest(BaseModel):
    x: List[float]
    y: List[float]
    standard_element: str
    peak_label: str
    reference_be: float
    search_window: float = 10.0


class CalibrationResponse(BaseModel):
    standard_element: str
    peak_label: str
    reference_be: float
    observed_be: Optional[float]
    offset_ev: float
    search_window: float
    success: bool
    message: str = ""


def _sorted_xy(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    order = np.argsort(x)
    return x[order], y[order]


def _estimate_peak_position(x: np.ndarray, y: np.ndarray, target_be: float, search_window: float) -> Optional[float]:
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    mask = np.isfinite(x) & np.isfinite(y)
    if np.count_nonzero(mask) < 5:
        return None

    xs, ys = _sorted_xy(x[mask], y[mask])
    half_window = max(float(search_window), 0.5)
    region = (xs >= target_be - half_window) & (xs <= target_be + half_window)
    if np.count_nonzero(region) < 3:
        return None

    xr = xs[region]
    yr = ys[region]
    if len(yr) >= 7:
        window = min(len(yr) if len(yr) % 2 == 1 else len(yr) - 1, 11)
        if window >= 5:
            yr = smooth_signal(yr, method="savitzky_golay", window_points=window, poly_deg=3)

    max_idx = int(np.argmax(yr))
    left = max(0, max_idx - 1)
    right = min(len(xr) - 1, max_idx + 1)
    if left == max_idx or right == max_idx:
        return float(xr[max_idx])

    x_fit = xr[left:right + 1]
    y_fit = yr[left:right + 1]
    try:
        coeffs = np.polyfit(x_fit, y_fit, 2)
        a, b = float(coeffs[0]), float(coeffs[1])
        if abs(a) > 1e-12:
            vertex = -b / (2 * a)
            if float(x_fit.min()) <= vertex <= float(x_fit.max()):
                return float(vertex)
    except Exception:
        pass
    return float(xr[max_idx])


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/parse", response_model=ParseResponse)
async def parse_xps_files(files: List[UploadFile] = File(...)):
    results: list[ParsedFile] = []
    errors: list[str] = []

    for uf in files:
        raw = await uf.read()
        x, y, err = parse_xps_bytes(raw)
        if err or x is None or y is None:
            errors.append(f"{uf.filename}: {err or '解析失敗'}")
            continue
        if len(x) < 2:
            errors.append(f"{uf.filename}: 資料點不足")
            continue
        results.append(ParsedFile(
            name=uf.filename or "unknown",
            x=x.tolist(),
            y=y.tolist(),
            n_points=len(x),
        ))

    return ParseResponse(files=results, errors=errors)


@router.post("/process", response_model=ProcessResponse)
def process_xps(req: ProcessRequest):
    p = req.params
    if not req.datasets:
        raise HTTPException(status_code=400, detail="沒有資料集")

    outputs: list[DatasetOutput] = []

    for ds in req.datasets:
        try:
            x = np.array(ds.x, dtype=float)
            y = np.array(ds.y, dtype=float)

            # energy shift
            x = x + p.energy_shift

            # interpolation
            if p.interpolate:
                x_grid = np.linspace(float(x.min()), float(x.max()), int(p.n_points))
                y = np.interp(x_grid, x, y)
                x = x_grid

            y_raw = y.copy()
            y_bg: np.ndarray | None = None

            # background subtraction
            if p.bg_enabled:
                x_start = p.bg_x_start if p.bg_x_start is not None else float(x.min())
                x_end = p.bg_x_end if p.bg_x_end is not None else float(x.max())
                y_sub, bg_curve = apply_background(
                    x, y,
                    method=p.bg_method,
                    bg_x_start=x_start,
                    bg_x_end=x_end,
                    poly_deg=p.bg_poly_deg,
                    baseline_lambda=p.bg_baseline_lambda,
                    baseline_p=p.bg_baseline_p,
                    baseline_iter=p.bg_baseline_iter,
                    tougaard_B=p.bg_tougaard_B,
                    tougaard_C=p.bg_tougaard_C,
                    strict=True,
                )
                y = y_sub
                y_bg = bg_curve

            # effective data range after background subtraction
            if p.valid_range_enabled:
                range_start = p.valid_x_start if p.valid_x_start is not None else float(x.min())
                range_end = p.valid_x_end if p.valid_x_end is not None else float(x.max())
                range_lo, range_hi = min(float(range_start), float(range_end)), max(float(range_start), float(range_end))
                valid_mask = (x >= range_lo) & (x <= range_hi)
                if int(np.sum(valid_mask)) < 3:
                    raise ValueError("有效數據範圍內點數不足，請拉開起點與終點。")
                x = x[valid_mask]
                y = y[valid_mask]
                y_raw = y_raw[valid_mask]
                if y_bg is not None:
                    y_bg = y_bg[valid_mask]

            # smoothing
            if p.smooth_method != "none":
                y = smooth_signal(y, method=p.smooth_method, window_points=p.smooth_window, poly_deg=p.smooth_poly)

            # normalization
            if p.norm_method != "none":
                y = apply_normalization(
                    x, y,
                    norm_method=p.norm_method,
                    norm_x_start=p.norm_x_start,
                    norm_x_end=p.norm_x_end,
                    strict=True,
                )

            outputs.append(DatasetOutput(
                name=ds.name,
                x=x.tolist(),
                y_raw=y_raw.tolist(),
                y_background=y_bg.tolist() if y_bg is not None else None,
                y_processed=y.tolist(),
            ))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"{ds.name}: {exc}") from exc

    # average
    average_out: DatasetOutput | None = None
    if p.average and len(outputs) > 1:
        try:
            x_ref = np.array(outputs[0].x, dtype=float)
            processed_arrays = [np.interp(x_ref, np.array(d.x, dtype=float), np.array(d.y_processed, dtype=float)) for d in outputs]
            raw_arrays = [np.interp(x_ref, np.array(d.x, dtype=float), np.array(d.y_raw, dtype=float)) for d in outputs]
            background_arrays = None
            if all(d.y_background is not None for d in outputs):
                background_arrays = [
                    np.interp(x_ref, np.array(d.x, dtype=float), np.array(d.y_background, dtype=float))
                    for d in outputs
                ]
            average_out = DatasetOutput(
                name="平均",
                x=x_ref.tolist(),
                y_raw=np.mean(raw_arrays, axis=0).tolist(),
                y_background=np.mean(background_arrays, axis=0).tolist() if background_arrays else None,
                y_processed=np.mean(processed_arrays, axis=0).tolist(),
            )
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"多檔平均失敗：{exc}") from exc

    return ProcessResponse(datasets=outputs, average=average_out)


@router.post("/calibrate", response_model=CalibrationResponse)
def calibrate_xps_energy(req: CalibrationRequest):
    x = np.array(req.x, dtype=float)
    y = np.array(req.y, dtype=float)
    if len(x) < 5 or len(y) < 5:
        raise HTTPException(status_code=400, detail="標準樣品資料點不足")

    observed_be = _estimate_peak_position(x, y, req.reference_be, req.search_window)
    if observed_be is None:
        return CalibrationResponse(
            standard_element=req.standard_element,
            peak_label=req.peak_label,
            reference_be=req.reference_be,
            observed_be=None,
            offset_ev=0.0,
            search_window=req.search_window,
            success=False,
            message="在指定搜尋範圍內找不到可用峰位",
        )

    offset_ev = float(req.reference_be - observed_be)
    return CalibrationResponse(
        standard_element=req.standard_element,
        peak_label=req.peak_label,
        reference_be=req.reference_be,
        observed_be=observed_be,
        offset_ev=offset_ev,
        search_window=req.search_window,
        success=True,
        message="已完成標準樣品能量校正",
    )


@router.post("/peaks", response_model=PeakDetectResponse)
def detect_xps_peaks(req: PeakDetectParams):
    x = np.array(req.x, dtype=float)
    y = np.array(req.y, dtype=float)

    if len(x) < 4:
        return PeakDetectResponse(peaks=[])

    y_max = float(y.max())
    if y_max == 0:
        return PeakDetectResponse(peaks=[])

    # XPS x-axis may be reversed (high BE → low BE); detect_spectrum_peaks needs ascending x
    flipped = x[-1] < x[0]
    if flipped:
        x = x[::-1]
        y = y[::-1]

    peaks_raw = detect_spectrum_peaks(
        x, y,
        prominence=req.prominence * y_max,
        min_distance_x=req.min_distance,
        max_peaks=req.max_peaks,
    )

    detected: list[DetectedPeak] = []
    for pk in peaks_raw:
        detected.append(DetectedPeak(
            binding_energy=float(pk.get("two_theta", pk.get("x", 0))),
            intensity=float(pk.get("intensity", 0)),
            rel_intensity=float(pk.get("rel_intensity", 0)),
            fwhm_ev=float(pk.get("fwhm_deg", 0)) if pk.get("fwhm_deg") else None,
        ))

    return PeakDetectResponse(peaks=detected)


@router.post("/fit", response_model=FitResponse)
def fit_xps_peaks(req: FitRequest):
    x = np.array(req.x, dtype=float)
    y = np.array(req.y, dtype=float)

    if len(x) < 4 or not req.peaks:
        raise HTTPException(status_code=400, detail="資料或峰值參數不足")

    init_peaks = [
        {
            "center": pk.center,
            "fwhm": pk.fwhm,
            "amplitude": pk.amplitude,
            "lock_center": pk.lock_center,
            "lock_fwhm": pk.lock_fwhm,
            "lock_area": pk.lock_area,
            "center_min": pk.center_min,
            "center_max": pk.center_max,
            "fwhm_min": pk.fwhm_min,
            "fwhm_max": pk.fwhm_max,
            "amplitude_max": pk.amplitude_max,
            "theoretical_center": pk.theoretical_center,
            "label": pk.label,
        }
        for pk in req.peaks
    ]

    fit_range = req.fit_range
    if fit_range is None and req.peaks:
        centers = np.array([pk.center for pk in req.peaks], dtype=float)
        fwhms = np.array([max(pk.fwhm, 0.05) for pk in req.peaks], dtype=float)
        padding = max(3.0, float(np.max(fwhms)) * 6.0)
        fit_lo = max(float(np.min(x)), float(np.min(centers)) - padding)
        fit_hi = min(float(np.max(x)), float(np.max(centers)) + padding)
        fit_range = [fit_lo, fit_hi]

    capped_maxfev = max(1000, min(int(req.maxfev), 8000))
    n_restarts = max(1, min(int(req.n_restarts), 10))
    rng = np.random.default_rng() if n_restarts > 1 else None

    best_result: dict | None = None
    best_ss_res = float("inf")
    for restart_idx in range(n_restarts):
        current_peaks = init_peaks if restart_idx == 0 else perturb_init_peaks(init_peaks, rng)
        try:
            candidate = fit_peaks(x, y, current_peaks, profile=req.profile,
                                  maxfev=capped_maxfev, fit_range=fit_range)
        except Exception:
            continue
        if not candidate.get("success", False):
            continue
        cand_ss = candidate.get("ss_res", float("inf"))
        if cand_ss < best_ss_res:
            best_result = candidate
            best_ss_res = cand_ss

    if best_result is None:
        raise HTTPException(status_code=422, detail="擬合失敗（全部嘗試均未收斂）")
    result = best_result

    raw_peaks = result.get("peaks", [])
    total_area = sum(abs(pk.get("area", 0)) for pk in raw_peaks)

    rows: list[FitPeakRow] = []
    for i, pk in enumerate(raw_peaks, 1):
        area = float(pk.get("area", 0))
        name = (
            req.peak_labels[i - 1]
            if req.peak_labels and i - 1 < len(req.peak_labels)
            else str(pk.get("label", f"Peak {i}"))
        )
        rows.append(FitPeakRow(
            Peak_Name=name,
            Center_eV=float(pk.get("center", 0)),
            FWHM_eV=float(pk.get("fwhm", 0)),
            Area=area,
            Height=float(pk.get("amplitude", 0)),
            Area_pct=round(100 * abs(area) / total_area, 2) if total_area > 0 else 0,
        ))

    def _to_list(arr):
        return arr.tolist() if hasattr(arr, "tolist") else list(arr)

    return FitResponse(
        y_fit=_to_list(result.get("y_fit", [])),
        y_individual=[_to_list(yi) for yi in result.get("y_individual", [])],
        residuals=_to_list(result.get("residuals", [])),
        peaks=rows,
        r_squared=float(result.get("r_squared", 0.0)),
        rmse=float(result.get("rmse", 0.0)),
        chi_red=result.get("chi_red"),
    )


# ── VBM linear extrapolation ──────────────────────────────────────────────────

class VbmRequest(BaseModel):
    x: List[float]
    y: List[float]
    edge_lo: float
    edge_hi: float
    baseline_lo: float
    baseline_hi: float


class VbmLinePoint(BaseModel):
    x: float
    y: float


class VbmLineFit(BaseModel):
    slope: float
    intercept: float
    point_count: int
    start_window_point_count: int
    end_window_point_count: int
    candidate_pair_count: int
    anchor_start_point: VbmLinePoint
    anchor_end_point: VbmLinePoint
    start_point: VbmLinePoint
    end_point: VbmLinePoint


class VbmResponse(BaseModel):
    vbm_ev: Optional[float]
    slope: float
    intercept: float
    baseline_level: float
    baseline_slope: float
    baseline_intercept: float
    edge_line: Optional[VbmLineFit] = None
    baseline_line: Optional[VbmLineFit] = None
    success: bool
    message: str = ""


def _fit_vbm_line(x: np.ndarray, y: np.ndarray, lo: float, hi: float, mode: str) -> Optional[VbmLineFit]:
    mask = np.isfinite(x) & np.isfinite(y)
    if int(np.sum(mask)) < 2:
        return None

    xs = x[mask]
    ys = y[mask]
    order = np.argsort(xs)
    xs = xs[order]
    ys = ys[order]

    def nearest_point(target_x: float) -> tuple[int, float, float]:
        idx = int(np.argmin(np.abs(xs - target_x)))
        return idx, float(xs[idx]), float(ys[idx])

    anchor_start_idx, anchor_start_x, anchor_start_y = nearest_point(lo)
    anchor_end_idx, anchor_end_x, anchor_end_y = nearest_point(hi)
    span_points = max(abs(anchor_end_idx - anchor_start_idx) + 1, 5)
    window_point_count = max(3, min(int(xs.size), int(round(span_points * 0.2))))

    def build_window(anchor_idx: int) -> tuple[np.ndarray, np.ndarray]:
        start_idx = max(0, min(int(xs.size) - window_point_count, anchor_idx - window_point_count // 2))
        end_idx = start_idx + window_point_count
        return xs[start_idx:end_idx], ys[start_idx:end_idx]

    start_xs, start_ys = build_window(anchor_start_idx)
    end_xs, end_ys = build_window(anchor_end_idx)

    best = None
    candidate_pair_count = 0
    for sx0, sy0 in zip(start_xs, start_ys):
        for ex0, ey0 in zip(end_xs, end_ys):
            dx = float(ex0 - sx0)
            if dx <= 1e-10:
                continue
            slope = float((ey0 - sy0) / dx)
            span = abs(dx)
            mean_y = float((sy0 + ey0) / 2.0)
            candidate_pair_count += 1
            candidate = {
                "start_x": float(sx0),
                "start_y": float(sy0),
                "end_x": float(ex0),
                "end_y": float(ey0),
                "slope": slope,
                "span": span,
                "mean_y": mean_y,
            }
            if best is None:
                best = candidate
                continue

            if mode == "tangent":
                if slope > best["slope"] + 1e-10 or (abs(slope - best["slope"]) <= 1e-10 and span > best["span"]):
                    best = candidate
            else:
                abs_slope = abs(slope)
                best_abs_slope = abs(best["slope"])
                if (
                    abs_slope < best_abs_slope - 1e-10
                    or (abs(abs_slope - best_abs_slope) <= 1e-10 and mean_y < best["mean_y"] - 1e-10)
                    or (
                        abs(abs_slope - best_abs_slope) <= 1e-10
                        and abs(mean_y - best["mean_y"]) <= 1e-10
                        and span > best["span"]
                    )
                ):
                    best = candidate

    if best is None:
        return None

    slope = float(best["slope"])
    intercept = float(best["start_y"] - slope * best["start_x"])
    return VbmLineFit(
        slope=slope,
        intercept=intercept,
        point_count=int(start_xs.size + end_xs.size),
        start_window_point_count=int(start_xs.size),
        end_window_point_count=int(end_xs.size),
        candidate_pair_count=candidate_pair_count,
        anchor_start_point=VbmLinePoint(x=anchor_start_x, y=anchor_start_y),
        anchor_end_point=VbmLinePoint(x=anchor_end_x, y=anchor_end_y),
        start_point=VbmLinePoint(x=float(best["start_x"]), y=float(best["start_y"])),
        end_point=VbmLinePoint(x=float(best["end_x"]), y=float(best["end_y"])),
    )


@router.post("/vbm", response_model=VbmResponse)
def compute_vbm(req: VbmRequest):
    x = np.array(req.x, dtype=float)
    y = np.array(req.y, dtype=float)

    lo_e = min(req.edge_lo, req.edge_hi)
    hi_e = max(req.edge_lo, req.edge_hi)
    edge_line = _fit_vbm_line(x, y, lo_e, hi_e, "tangent")
    if edge_line is None:
        return VbmResponse(
            vbm_ev=None,
            slope=0.0,
            intercept=0.0,
            baseline_level=0.0,
            baseline_slope=0.0,
            baseline_intercept=0.0,
            edge_line=None,
            baseline_line=None,
            success=False,
            message="切線區間有效點數不足，至少需要 2 個點",
        )

    lo_b = min(req.baseline_lo, req.baseline_hi)
    hi_b = max(req.baseline_lo, req.baseline_hi)
    baseline_line = _fit_vbm_line(x, y, lo_b, hi_b, "baseline")
    if baseline_line is None:
        return VbmResponse(
            vbm_ev=None,
            slope=edge_line.slope,
            intercept=edge_line.intercept,
            baseline_level=0.0,
            baseline_slope=0.0,
            baseline_intercept=0.0,
            edge_line=edge_line,
            baseline_line=None,
            success=False,
            message="基準線區間有效點數不足，至少需要 2 個點",
        )

    mask_bl = np.isfinite(x) & np.isfinite(y) & (x >= lo_b) & (x <= hi_b)
    baseline_level = float(np.mean(y[mask_bl])) if int(np.sum(mask_bl)) > 0 else 0.0

    vbm_ev = None
    success = False
    message = ""
    slope = edge_line.slope
    intercept = edge_line.intercept
    baseline_slope = baseline_line.slope
    baseline_intercept = baseline_line.intercept
    slope_delta = slope - baseline_slope
    if abs(slope_delta) > 1e-10:
        vbm_candidate = (baseline_intercept - intercept) / slope_delta
        if np.isfinite(vbm_candidate):
            x_range = float(np.max(x) - np.min(x))
            # Upper margin: allow small extrapolation above data maximum
            upper_margin = max(x_range * 0.3, 3.0)
            # Lower bound: VBM should not be more than 1 eV below data minimum or below -1 eV
            lower_bound = min(float(np.min(x)) - 1.0, -1.0)
            if lower_bound <= vbm_candidate <= float(np.max(x)) + upper_margin:
                vbm_ev = float(vbm_candidate)
                success = True
            elif vbm_candidate < lower_bound:
                message = (
                    f"外推 VBM ({vbm_candidate:.2f} eV) 為負值，"
                    "請確認切線區間是否選在費米邊（Fermi edge）附近的低 BE 線性上升段，"
                    "而非 VB 內部特徵"
                )
            else:
                message = f"外推 VBM ({vbm_candidate:.1f} eV) 超出光譜範圍，請重新選取區間"
        else:
            message = "VBM 計算結果非有限值，請重新選取區間"
    else:
        message = "切線與基準線斜率過於接近，無法穩定求交點"

    return VbmResponse(
        vbm_ev=vbm_ev,
        slope=slope,
        intercept=intercept,
        baseline_level=baseline_level,
        baseline_slope=baseline_slope,
        baseline_intercept=baseline_intercept,
        edge_line=edge_line,
        baseline_line=baseline_line,
        success=success,
        message=message,
    )


# ── Element peaks from DB ─────────────────────────────────────────────────────

class ElementPeakItem(BaseModel):
    label: str
    be: float
    fwhm: float


class ElementPeaksResponse(BaseModel):
    element: str
    peaks: List[ElementPeakItem]
    has_doublet: bool
    doublet_be_sep: Optional[float] = None
    doublet_area_ratio: Optional[float] = None
    major_sub: Optional[str] = None
    minor_sub: Optional[str] = None


class PeriodicTableItem(BaseModel):
    symbol: str
    name: str
    row: int
    col: int
    category: str
    category_name_zh: str
    category_color: str
    has_peaks: bool


@router.get("/elements")
def list_elements_endpoint():
    return [
        {"symbol": k, "name": v["name"], "has_peaks": len(v.get("peaks", [])) > 0}
        for k, v in ELEMENTS.items()
    ]


@router.get("/periodic-table", response_model=List[PeriodicTableItem])
def periodic_table_endpoint():
    return [
        PeriodicTableItem(
            symbol=symbol,
            name=data["name"],
            row=int(data["row"]),
            col=int(data["col"]),
            category=str(data["cat"]),
            category_name_zh=CATEGORY_NAMES_ZH.get(str(data["cat"]), str(data["cat"])),
            category_color=CATEGORY_COLORS.get(str(data["cat"]), "#64748b"),
            has_peaks=len(data.get("peaks", [])) > 0,
        )
        for symbol, data in ELEMENTS.items()
    ]


@router.get("/element-peaks/{element}", response_model=ElementPeaksResponse)
def get_element_peaks(element: str):
    elem_data = ELEMENTS.get(element)
    if elem_data is None:
        raise HTTPException(status_code=404, detail=f"Element '{element}' not in database")
    peaks = [
        ElementPeakItem(label=p["label"], be=p["be"], fwhm=p["fwhm"])
        for p in elem_data.get("peaks", [])
    ]
    doublet = DOUBLET_INFO.get(element)
    return ElementPeaksResponse(
        element=element,
        peaks=peaks,
        has_doublet=doublet is not None,
        doublet_be_sep=doublet["be_sep"] if doublet else None,
        doublet_area_ratio=doublet["area_ratio"] if doublet else None,
        major_sub=doublet["major_sub"] if doublet else None,
        minor_sub=doublet["minor_sub"] if doublet else None,
    )


# ── RSF lookup ────────────────────────────────────────────────────────────────

class RsfItem(BaseModel):
    element: str
    label: str


class RsfResultRow(BaseModel):
    element: str
    label: str
    rsf: Optional[float]
    source: str


@router.post("/rsf", response_model=List[RsfResultRow])
def get_rsf_values(items: List[RsfItem]):
    results = []
    for item in items:
        rsf, source = get_orbital_rsf(item.element.strip(), item.label.strip())
        results.append(RsfResultRow(element=item.element, label=item.label, rsf=rsf, source=source))
    return results


# ── Fit report (Excel, 3-sheet) ───────────────────────────────────────────────

class XpsFitReportPeak(BaseModel):
    name: str
    center: float
    fwhm: float
    area: float
    height: float
    area_pct: Optional[float] = None


class XpsRsfReportRow(BaseModel):
    peak_name: str
    element: str
    orbital: str
    area: float
    rsf: Optional[float] = None
    rsf_area: Optional[float] = None
    atomic_pct: Optional[float] = None


class XpsFitReportRequest(BaseModel):
    channel: str = "XPS"
    profile: str
    r2: float
    rmse: float
    chi_red: Optional[float] = None
    peaks: List[XpsFitReportPeak]
    rsf_rows: Optional[List[XpsRsfReportRow]] = None


@router.post("/fit-report")
def generate_xps_fit_report(req: XpsFitReportRequest):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl 未安裝")

    from fastapi.responses import StreamingResponse as _SR
    import io as _io

    wb = Workbook()

    thin = Side(style="thin", color="CCCCCC")
    border_thin = Border(left=thin, right=thin, top=thin, bottom=thin)

    def _hdr_font(size=11):
        return Font(name="Arial", bold=True, size=size, color="FFFFFF")

    def _body_font(bold=False, size=10, color="000000"):
        return Font(name="Arial", bold=bold, size=size, color=color)

    def _fill(hex_color: str):
        return PatternFill(fill_type="solid", fgColor=hex_color)

    TITLE_FILL = "2D4A6B"
    SECTION_FILL = "4A7CA8"
    ROW_EVEN = "EDF3F9"

    # ── Sheet 1: 擬合品質 ────────────────────────────────────────────────
    ws1 = wb.active
    ws1.title = "擬合品質"

    ws1.merge_cells("A1:C1")
    t = ws1["A1"]
    t.value = "XPS 峰擬合分析報告"
    t.font = Font(name="Arial", bold=True, size=13, color="FFFFFF")
    t.fill = _fill(TITLE_FILL)
    t.alignment = Alignment(horizontal="center", vertical="center")
    ws1.row_dimensions[1].height = 28

    ws1.merge_cells("A2:C2")
    s = ws1["A2"]
    s.value = "擬合參數"
    s.font = _hdr_font(size=10)
    s.fill = _fill(SECTION_FILL)
    s.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws1.row_dimensions[2].height = 20

    params_rows = [
        ("模式", req.channel),
        ("峰形", req.profile.upper()),
        ("峰數量", len(req.peaks)),
    ]
    for r_idx, (label, val) in enumerate(params_rows, start=3):
        c1 = ws1.cell(r_idx, 1, label)
        c1.font = _body_font(bold=True); c1.fill = _fill(ROW_EVEN); c1.border = border_thin
        c2 = ws1.cell(r_idx, 2, val)
        c2.font = _body_font(); c2.border = border_thin
        ws1.cell(r_idx, 3).border = border_thin

    nr = 3 + len(params_rows)
    ws1.merge_cells(f"A{nr}:C{nr}")
    sq = ws1.cell(nr, 1, "擬合品質指標")
    sq.font = _hdr_font(size=10); sq.fill = _fill(SECTION_FILL)
    sq.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws1.row_dimensions[nr].height = 20

    r2_val = req.r2
    if r2_val >= 0.99:
        r2_bg, r2_fg = "D4EDDA", "228B22"
    elif r2_val >= 0.97:
        r2_bg, r2_fg = "D0E8F5", "0066AA"
    elif r2_val >= 0.90:
        r2_bg, r2_fg = "FFF3CD", "856404"
    else:
        r2_bg, r2_fg = "F8D7DA", "842029"

    quality_rows: list[tuple] = [
        ("R²", f"{r2_val:.6f}", r2_bg, r2_fg, True),
        ("RMSE", f"{req.rmse:.6f}", "FFFFFF", "000000", False),
    ]
    if req.chi_red is not None:
        quality_rows.append(("χ²ᵣ (Reduced χ²)", f"{req.chi_red:.6f}", "FFFFFF", "000000", False))

    for q_idx, (label, val, bg, fg, bold) in enumerate(quality_rows, start=nr + 1):
        c1 = ws1.cell(q_idx, 1, label)
        c1.font = _body_font(bold=True); c1.fill = _fill(ROW_EVEN); c1.border = border_thin
        c2 = ws1.cell(q_idx, 2, val)
        c2.font = _body_font(bold=bold, color=fg); c2.fill = _fill(bg); c2.border = border_thin
        ws1.cell(q_idx, 3).border = border_thin

    ws1.column_dimensions["A"].width = 24
    ws1.column_dimensions["B"].width = 18
    ws1.column_dimensions["C"].width = 4

    # ── Sheet 2: 峰參數 ──────────────────────────────────────────────────
    ws2 = wb.create_sheet("峰參數")
    col_headers2 = ["峰名稱", "中心 (eV)", "FWHM (eV)", "面積", "高度", "面積 %"]
    col_widths2 = [18, 14, 14, 14, 14, 10]

    for c_idx, (hdr, w) in enumerate(zip(col_headers2, col_widths2), start=1):
        cell = ws2.cell(1, c_idx, hdr)
        cell.font = _hdr_font(); cell.fill = _fill(TITLE_FILL)
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border_thin
        ws2.column_dimensions[get_column_letter(c_idx)].width = w
    ws2.row_dimensions[1].height = 22

    for r_idx, pk in enumerate(req.peaks, start=2):
        row_bg = ROW_EVEN if r_idx % 2 == 0 else "FFFFFF"
        values = [pk.name, pk.center, pk.fwhm, pk.area, pk.height, pk.area_pct]
        for c_idx, val in enumerate(values, start=1):
            cell = ws2.cell(r_idx, c_idx, val if val is not None else "—")
            cell.font = _body_font(); cell.fill = _fill(row_bg); cell.border = border_thin
            if c_idx > 1 and isinstance(val, float):
                cell.number_format = "0.0000" if c_idx <= 5 else "0.00"
            cell.alignment = Alignment(
                horizontal="left" if c_idx == 1 else "right",
                indent=1 if c_idx == 1 else 0,
            )

    # ── Sheet 3: RSF 定量（可選） ─────────────────────────────────────────
    if req.rsf_rows:
        ws3 = wb.create_sheet("RSF 定量")
        col_headers3 = ["峰名稱", "元素", "軌道", "面積", "RSF", "RSF 面積", "原子 %"]
        col_widths3 = [18, 10, 10, 14, 10, 14, 10]

        for c_idx, (hdr, w) in enumerate(zip(col_headers3, col_widths3), start=1):
            cell = ws3.cell(1, c_idx, hdr)
            cell.font = _hdr_font(); cell.fill = _fill(TITLE_FILL)
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = border_thin
            ws3.column_dimensions[get_column_letter(c_idx)].width = w
        ws3.row_dimensions[1].height = 22

        for r_idx, row in enumerate(req.rsf_rows, start=2):
            row_bg = ROW_EVEN if r_idx % 2 == 0 else "FFFFFF"
            values = [row.peak_name, row.element, row.orbital, row.area,
                      row.rsf, row.rsf_area, row.atomic_pct]
            for c_idx, val in enumerate(values, start=1):
                cell = ws3.cell(r_idx, c_idx, val if val is not None else "—")
                cell.font = _body_font(); cell.fill = _fill(row_bg); cell.border = border_thin
                if c_idx > 3 and isinstance(val, float):
                    cell.number_format = "0.0000" if c_idx <= 6 else "0.00"
                cell.alignment = Alignment(
                    horizontal="left" if c_idx <= 3 else "right",
                    indent=1 if c_idx <= 3 else 0,
                )

    buf = _io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return _SR(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=xps_fit_report.xlsx"},
    )
