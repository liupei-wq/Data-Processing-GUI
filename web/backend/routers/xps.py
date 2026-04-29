"""XPS API endpoints."""

from __future__ import annotations

from typing import List, Optional

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from core.parsers import parse_xps_bytes
from core.peak_fitting import fit_peaks
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
    bg_method: str = "linear"        # linear | shirley | tougaard | polynomial | asls | airpls
    bg_x_start: Optional[float] = None
    bg_x_end: Optional[float] = None
    bg_poly_deg: int = 3
    bg_baseline_lambda: float = 1e5
    bg_baseline_p: float = 0.01
    bg_baseline_iter: int = 20
    bg_tougaard_B: float = 2866.0
    bg_tougaard_C: float = 1643.0
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


class FitRequest(BaseModel):
    x: List[float]
    y: List[float]
    peaks: List[InitPeak]
    profile: str = "voigt"
    maxfev: int = 20000
    peak_labels: Optional[List[str]] = None


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


class CalibrationRequest(BaseModel):
    x: List[float]
    y: List[float]
    standard_element: str
    peak_label: str
    reference_be: float
    search_window: float = 4.0


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
            )
            y = y_sub
            y_bg = bg_curve

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
            )

        outputs.append(DatasetOutput(
            name=ds.name,
            x=x.tolist(),
            y_raw=y_raw.tolist(),
            y_background=y_bg.tolist() if y_bg is not None else None,
            y_processed=y.tolist(),
        ))

    # average
    average_out: DatasetOutput | None = None
    if p.average and len(outputs) > 1:
        try:
            x_ref = np.array(outputs[0].x)
            arrays = [np.interp(x_ref, np.array(d.x), np.array(d.y_processed)) for d in outputs]
            y_avg = np.mean(arrays, axis=0)
            average_out = DatasetOutput(
                name="平均",
                x=x_ref.tolist(),
                y_raw=y_avg.tolist(),
                y_processed=y_avg.tolist(),
            )
        except Exception:
            pass

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
        }
        for pk in req.peaks
    ]

    try:
        result = fit_peaks(x, y, init_peaks, profile=req.profile, maxfev=req.maxfev)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"擬合失敗：{exc}") from exc

    total_area = sum(abs(pk.get("Area", 0)) for pk in result.get("peaks", []))

    rows: list[FitPeakRow] = []
    for i, pk in enumerate(result.get("peaks", []), 1):
        area = float(pk.get("Area", 0))
        name = (
            req.peak_labels[i - 1]
            if req.peak_labels and i - 1 < len(req.peak_labels)
            else str(pk.get("Peak_Name", f"Peak {i}"))
        )
        rows.append(FitPeakRow(
            Peak_Name=name,
            Center_eV=float(pk.get("Center", 0)),
            FWHM_eV=float(pk.get("FWHM", 0)),
            Area=area,
            Height=float(pk.get("Height", 0)),
            Area_pct=round(100 * abs(area) / total_area, 2) if total_area > 0 else 0,
        ))

    return FitResponse(
        y_fit=result.get("y_fit", []),
        y_individual=result.get("y_individual", []),
        residuals=result.get("residuals", []),
        peaks=rows,
    )


# ── VBM linear extrapolation ──────────────────────────────────────────────────

class VbmRequest(BaseModel):
    x: List[float]
    y: List[float]
    edge_lo: float
    edge_hi: float
    baseline_lo: float
    baseline_hi: float


class VbmResponse(BaseModel):
    vbm_ev: Optional[float]
    slope: float
    intercept: float
    baseline_level: float
    x_fit: List[float]
    y_fit: List[float]
    success: bool
    message: str = ""


@router.post("/vbm", response_model=VbmResponse)
def compute_vbm(req: VbmRequest):
    x = np.array(req.x, dtype=float)
    y = np.array(req.y, dtype=float)

    lo_e = min(req.edge_lo, req.edge_hi)
    hi_e = max(req.edge_lo, req.edge_hi)
    mask_edge = (x >= lo_e) & (x <= hi_e)
    if mask_edge.sum() < 2:
        return VbmResponse(vbm_ev=None, slope=0.0, intercept=0.0, baseline_level=0.0,
                           x_fit=[], y_fit=[], success=False, message="邊緣區域點數不足")

    coeffs = np.polyfit(x[mask_edge], y[mask_edge], 1)
    slope, intercept = float(coeffs[0]), float(coeffs[1])

    lo_b = min(req.baseline_lo, req.baseline_hi)
    hi_b = max(req.baseline_lo, req.baseline_hi)
    mask_bl = (x >= lo_b) & (x <= hi_b)
    if mask_bl.sum() < 1:
        return VbmResponse(vbm_ev=None, slope=slope, intercept=intercept, baseline_level=0.0,
                           x_fit=[], y_fit=[], success=False, message="基準線區域點數不足")

    baseline_level = float(np.mean(y[mask_bl]))

    vbm_ev = None
    success = False
    message = ""
    if abs(slope) > 1e-10:
        vbm_ev = float((baseline_level - intercept) / slope)
        success = True
    else:
        message = "斜率接近零，無法外推 VBM"

    x_lo_plot = min(lo_e, float(vbm_ev) - 1.0) if vbm_ev is not None else lo_e - 1.0
    x_hi_plot = max(hi_e, hi_b)
    x_fit_arr = np.linspace(x_lo_plot, x_hi_plot, 80)
    y_fit_arr = slope * x_fit_arr + intercept

    return VbmResponse(
        vbm_ev=vbm_ev,
        slope=slope,
        intercept=intercept,
        baseline_level=baseline_level,
        x_fit=x_fit_arr.tolist(),
        y_fit=y_fit_arr.tolist(),
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
