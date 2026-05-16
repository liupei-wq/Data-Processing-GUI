"""XES API endpoints — 1D spectrum mode (FITS mode deferred)."""

from __future__ import annotations

from typing import Dict, List, Optional

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
    measurement_order: Optional[int] = None


class CalibrationPoint(BaseModel):
    channel: float
    energy: float


class ProcessParams(BaseModel):
    interpolate: bool = False
    n_points: int = 1000
    average: bool = False
    # BG1/BG2 subtraction
    bg_method: str = "none"       # none | bg1 | bg2 | average | interpolated
    bg_order: str = "upload"      # upload | filename (weights for interpolated)
    total_measurements: Optional[int] = None
    # smoothing
    smooth_method: str = "none"   # none | moving_average | savitzky_golay
    smooth_window: int = 5
    smooth_poly: int = 3
    # normalization
    norm_method: str = "none"     # none | min_max | max | area | reference_region
    norm_x_start: Optional[float] = None
    norm_x_end: Optional[float] = None
    # I0 normalization (divide raw y by per-dataset monitor value before BG subtraction)
    i0_values: Dict[str, float] = Field(default_factory=dict)
    # X-axis calibration (pixel/channel → eV)
    axis_calibration: str = "none"  # none | linear | table
    energy_offset: float = 0.0
    energy_slope: float = 1.0
    energy_order: str = "increasing"  # increasing | decreasing | original
    calibration_points: List[CalibrationPoint] = Field(default_factory=list)


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
    original_x: Optional[List[float]] = None
    measurement_order: Optional[int] = None
    bg_weight: Optional[float] = None


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
        y_only = _parse_single_column_spectrum(raw)
        if y_only is None:
            return None, None, err or "解析失敗"
        x = np.arange(len(y_only), dtype=float)
        y = y_only
    if len(x) < 2:
        return None, None, "資料點不足"
    # ensure ascending x, no duplicates
    order = np.argsort(x)
    x, y = x[order], y[order]
    mask = np.concatenate(([True], np.diff(x) > 1e-12))
    return x[mask].astype(float), y[mask].astype(float), None


def _parse_single_column_spectrum(raw: bytes) -> np.ndarray | None:
    for enc in ("utf-8", "utf-8-sig", "big5", "cp950", "latin-1", "utf-16"):
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue
        values: list[float] = []
        for line in text.splitlines():
            trimmed = line.strip()
            if not trimmed or trimmed.startswith(("#", "//", "%", ";", "!")):
                continue
            parts = [p for p in trimmed.replace(",", " ").split() if p]
            if len(parts) != 1:
                continue
            try:
                val = float(parts[0])
            except ValueError:
                continue
            if np.isfinite(val):
                values.append(val)
        if len(values) >= 2:
            return np.array(values, dtype=float)
    return None


def _interp_to(x_src: np.ndarray, y_src: np.ndarray, x_target: np.ndarray) -> np.ndarray:
    if len(x_src) < 2:
        return np.zeros_like(x_target, dtype=float)
    f = interp1d(x_src, y_src, kind="linear", bounds_error=False, fill_value=0.0)
    return f(x_target)


def _bg_weight(pos: int, total: int) -> float:
    return float(pos + 1) / float(total + 1) if total > 0 else 0.5


def _apply_calibration(x_pixel: np.ndarray, offset: float, slope: float) -> np.ndarray:
    return offset + slope * x_pixel


def _bg_weight_from_measurement(order: Optional[int], total: Optional[int], fallback_pos: int, fallback_total: int) -> float:
    if order is not None and total is not None:
        if total < 2:
            raise ValueError("量測數據總數至少需為 2，才能使用 BG1/BG2 分點扣背。")
        if order < 1 or order > total:
            raise ValueError(f"量測序號 {order} 超出總量測次數 1–{total}。")
        return float(np.clip((order - 1) / (total - 1), 0.0, 1.0))
    return _bg_weight(fallback_pos, fallback_total)


def _calibration_arrays(points: list[CalibrationPoint]) -> tuple[np.ndarray, np.ndarray]:
    if len(points) < 10:
        raise ValueError("校正檔有效點數過少，無法進行 XES 能量校正。")
    sorted_points = sorted(points, key=lambda p: p.channel)
    channels = np.array([p.channel for p in sorted_points], dtype=float)
    energies = np.array([p.energy for p in sorted_points], dtype=float)
    if np.any(~np.isfinite(channels)) or np.any(~np.isfinite(energies)):
        raise ValueError("校正檔包含無效數值。")
    if np.any(np.diff(channels) <= 0):
        raise ValueError("校正檔中有重複的 channel / pixel index。")
    return channels, energies


def _apply_table_calibration(x_pixel: np.ndarray, channels: np.ndarray, energies: np.ndarray) -> np.ndarray:
    if len(x_pixel) == len(energies):
        return energies.copy()
    return np.interp(x_pixel, channels, energies, left=energies[0], right=energies[-1])


def _ensure_axis_length(axis: np.ndarray | None, target_len: int, label: str) -> np.ndarray | None:
    if axis is None:
        return None
    if len(axis) == target_len:
        return axis
    if len(axis) < 2 or target_len < 2:
        raise ValueError(f"{label} 長度與光譜強度不一致。")
    src_idx = np.linspace(0.0, 1.0, len(axis))
    dst_idx = np.linspace(0.0, 1.0, target_len)
    return np.interp(dst_idx, src_idx, axis)


def _sort_for_energy_order(
    energy_order: str,
    x: np.ndarray,
    x_ev: np.ndarray | None,
    arrays: list[np.ndarray | None],
) -> tuple[np.ndarray, np.ndarray | None, list[np.ndarray | None]]:
    target_len = len(x)
    x_ev = _ensure_axis_length(x_ev, target_len, "XES energy axis")
    arrays = [_ensure_axis_length(arr, target_len, "XES data array") for arr in arrays]
    if x_ev is None or energy_order == "original":
        return x, x_ev, arrays
    if energy_order == "increasing":
        order = np.argsort(x_ev)
    elif energy_order == "decreasing":
        order = np.argsort(x_ev)[::-1]
    else:
        return x, x_ev, arrays
    sorted_arrays = [arr[order] if arr is not None else None for arr in arrays]
    return x[order], x_ev[order], sorted_arrays


def _interp_processed_to_x(x_ref: np.ndarray, d: DatasetOutput) -> np.ndarray:
    x_src = np.array(d.x_pixel, dtype=float)
    y_src = np.array(d.y_processed, dtype=float)
    order = np.argsort(x_src)
    return np.interp(x_ref, x_src[order], y_src[order])


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

    calibration_channels: np.ndarray | None = None
    calibration_energies: np.ndarray | None = None
    if p.axis_calibration == "table":
        try:
            calibration_channels, calibration_energies = _calibration_arrays(p.calibration_points)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    bg1_x = np.array(req.bg1.x) if req.bg1 else None
    bg1_y = np.array(req.bg1.y) if req.bg1 else None
    bg2_x = np.array(req.bg2.x) if req.bg2 else None
    bg2_y = np.array(req.bg2.y) if req.bg2 else None

    n = len(req.samples)
    outputs: list[DatasetOutput] = []

    for idx, ds in enumerate(req.samples):
        try:
            x = np.array(ds.x, dtype=float)
            y = np.array(ds.y, dtype=float)
            if len(x) != len(y):
                n_xy = min(len(x), len(y))
                if n_xy < 2:
                    raise ValueError("x/y 有效點數不足。")
                x = x[:n_xy]
                y = y[:n_xy]
            if len(x) < 2:
                raise ValueError("資料點不足。")
            if np.any(~np.isfinite(x)) or np.any(~np.isfinite(y)):
                raise ValueError("資料包含非數值或無限值。")

            order = np.argsort(x)
            x = x[order]
            y = y[order]

            if p.interpolate:
                x_grid = np.linspace(float(x.min()), float(x.max()), int(p.n_points))
                y = np.interp(x_grid, x, y)
                x = x_grid

            y_raw = y.copy()

            # I0 normalization (per-dataset monitor signal)
            i0_val = p.i0_values.get(ds.name)
            if i0_val and i0_val > 0:
                y = y / i0_val
                y_raw = y_raw / i0_val

            # BG1/BG2 subtraction
            y_bg: np.ndarray | None = None
            bg_weight: float | None = None
            if p.bg_method != "none":
                bg1_interp = _interp_to(bg1_x, bg1_y, x) if (bg1_x is not None and bg1_y is not None) else None
                bg2_interp = _interp_to(bg2_x, bg2_y, x) if (bg2_x is not None and bg2_y is not None) else None

                if p.bg_method == "bg1" and bg1_interp is not None:
                    y_bg = bg1_interp
                elif p.bg_method == "bg2" and bg2_interp is not None:
                    y_bg = bg2_interp
                elif p.bg_method == "average" and bg1_interp is not None and bg2_interp is not None:
                    y_bg = 0.5 * (bg1_interp + bg2_interp)
                elif p.bg_method == "interpolated" and bg1_interp is not None and bg2_interp is not None:
                    bg_weight = _bg_weight_from_measurement(ds.measurement_order, p.total_measurements, idx, n)
                    y_bg = (1.0 - bg_weight) * bg1_interp + bg_weight * bg2_interp
                else:
                    raise ValueError(f"背景扣除方式 {p.bg_method} 需要對應的 BG1/BG2 檔案。")

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
            elif p.axis_calibration == "table" and calibration_channels is not None and calibration_energies is not None:
                x_ev = _apply_table_calibration(x, calibration_channels, calibration_energies)

            x_out, x_ev_out, sorted_arrays = _sort_for_energy_order(
                p.energy_order,
                x,
                x_ev,
                [y_raw, y_bg, y_corrected, y],
            )
            y_raw_out, y_bg_out, y_corrected_out, y_processed_out = sorted_arrays

            outputs.append(DatasetOutput(
                name=ds.name,
                x_pixel=x_out.tolist(),
                x_ev=x_ev_out.tolist() if x_ev_out is not None else None,
                y_raw=y_raw_out.tolist() if y_raw_out is not None else [],
                y_bg=y_bg_out.tolist() if y_bg_out is not None else None,
                y_corrected=y_corrected_out.tolist() if y_corrected_out is not None else [],
                y_processed=y_processed_out.tolist() if y_processed_out is not None else [],
                original_x=x_out.tolist(),
                measurement_order=ds.measurement_order,
                bg_weight=bg_weight,
            ))
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"{ds.name} XES 資料處理失敗：{exc}") from exc

    # average
    average_out: DatasetOutput | None = None
    if p.average and len(outputs) > 1:
        try:
            x_ref = np.array(outputs[0].x_pixel)
            arrs = [_interp_processed_to_x(x_ref, d) for d in outputs]
            y_avg = np.mean(arrs, axis=0)
            x_ev_ref = np.array(outputs[0].x_ev) if outputs[0].x_ev else None
            average_out = DatasetOutput(
                name="平均",
                x_pixel=x_ref.tolist(),
                x_ev=x_ev_ref.tolist() if x_ev_ref is not None else None,
                y_raw=y_avg.tolist(),
                y_corrected=y_avg.tolist(),
                y_processed=y_avg.tolist(),
                original_x=x_ref.tolist(),
            )
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"XES 多檔平均失敗：{exc}") from exc

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
