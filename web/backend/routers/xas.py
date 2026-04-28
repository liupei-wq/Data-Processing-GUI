"""XAS / XANES API endpoints.

Handles TEY/TFY dual-channel XAS data from beamline DAT files.
"""

from __future__ import annotations

import io
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from core.processing import apply_background, apply_normalization
from core.spectrum_ops import interpolate_spectrum_to_grid, mean_spectrum_arrays

router = APIRouter()


# ── parsing helpers (self-contained, no streamlit dependency) ─────────────────

def _is_numeric_line(line: str) -> bool:
    parts = line.strip().replace(",", " ").split()
    if not parts:
        return False
    try:
        for part in parts:
            float(part)
        return True
    except ValueError:
        return False


def _parse_xas_table_bytes(raw: bytes):
    """Parse text-like XAS/DAT files and return only numeric columns."""
    for enc in ("utf-8", "utf-8-sig", "big5", "cp950", "latin-1", "utf-16"):
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue

        lines = text.splitlines()
        numeric_lines: list[str] = []
        in_block = False
        for line in lines:
            if _is_numeric_line(line):
                in_block = True
                numeric_lines.append(line.strip())
            elif in_block:
                break

        if len(numeric_lines) >= 2:
            clean = "\n".join(numeric_lines)
            for sep in ("\t", ",", r"\s+"):
                try:
                    df = pd.read_csv(io.StringIO(clean), sep=sep, header=None, engine="python")
                    num = df.apply(pd.to_numeric, errors="coerce")
                    valid = [col for col in num.columns if num[col].notna().mean() > 0.8]
                    if len(valid) >= 3:
                        out = num[valid].dropna(how="any").copy()
                        out.columns = [f"col_{i + 1}" for i in range(out.shape[1])]
                        return out.reset_index(drop=True), None
                except Exception:
                    pass

        clean_lines = [
            line for line in lines
            if line.strip() and line.strip()[0] not in ("#", "%", ";", "!")
        ]
        if clean_lines:
            clean = "\n".join(clean_lines)
            for sep in (",", "\t", r"\s+"):
                for header in (0, None):
                    try:
                        df = pd.read_csv(io.StringIO(clean), sep=sep, header=header, engine="python")
                        num = df.apply(pd.to_numeric, errors="coerce")
                        valid = [col for col in num.columns if num[col].notna().mean() > 0.8]
                        if len(valid) >= 3:
                            out = num[valid].dropna(how="any").copy()
                            out.columns = [f"col_{i + 1}" for i in range(out.shape[1])]
                            return out.reset_index(drop=True), None
                    except Exception:
                        pass

    return None, "無法解析：請確認檔案至少包含 Energy、TEY、TFY 三欄數字"


def _prepare_tey_tfy_auto(df: pd.DataFrame, flip_tfy: bool):
    """Auto-detect TEY/TFY columns and return (energy, {TEY: arr, TFY: arr}, mapping, error)."""
    if df.shape[1] < 3:
        return np.array([]), {}, {}, "至少需要 Energy、TEY、TFY 三欄"

    energy = df.iloc[:, 0].to_numpy(dtype=float)
    mapping: dict[str, Any] = {"energy_col": 1, "flip_tfy": bool(flip_tfy)}

    if df.shape[1] >= 6:
        # Beamline DAT: Energy, Phase, Gap, CurMD-03(TFY), CurMD-01(TEY), CurMD-02(I0)
        i0 = df.iloc[:, 5].to_numpy(dtype=float)
        denom = np.where(np.abs(i0) > 1e-30, np.abs(i0), np.nan)
        tey_raw = df.iloc[:, 4].to_numpy(dtype=float)
        tfy_raw = df.iloc[:, 3].to_numpy(dtype=float)
        tey = tey_raw / denom
        tfy = tfy_raw / denom
        mapping["mode"] = "beamline_dat_6col"
        mapping["i0_col"] = 6
        mapping["tey_col"] = 5
        mapping["tfy_col"] = 4
    else:
        # Simple 3-col: Energy, TEY, TFY
        tey = df.iloc[:, 1].to_numpy(dtype=float)
        tfy = df.iloc[:, 2].to_numpy(dtype=float)
        mapping["mode"] = "simple_3col"

    if flip_tfy:
        tfy = 1.0 - tfy

    mask = np.isfinite(energy) & np.isfinite(tey) & np.isfinite(tfy)
    if np.count_nonzero(mask) < 2:
        return energy, {}, mapping, "有效資料點不足"

    energy = energy[mask]
    tey = tey[mask]
    tfy = tfy[mask]
    order = np.argsort(energy)
    return energy[order], {"TEY": tey[order], "TFY": tfy[order]}, mapping, None


def _find_white_line(x: np.ndarray, y: np.ndarray, e_min: float, e_max: float) -> float | None:
    mask = (x >= e_min) & (x <= e_max)
    if not np.any(mask):
        return None
    idx = int(np.argmax(y[mask]))
    return float(x[mask][idx])


def _normalize_post_edge(
    x: np.ndarray, y: np.ndarray,
    edge_region: tuple[float, float],
    norm_region: tuple[float, float],
) -> tuple[np.ndarray, float]:
    """Normalize by post-edge step height using a linear pre/post baseline."""
    pre_mask = (x >= edge_region[0]) & (x <= edge_region[1])
    post_mask = (x >= norm_region[0]) & (x <= norm_region[1])

    if not np.any(pre_mask) or not np.any(post_mask):
        return y, 1.0

    pre_mean = float(np.mean(y[pre_mask]))
    post_mean = float(np.mean(y[post_mask]))
    edge_step = post_mean - pre_mean
    if abs(edge_step) < 1e-20:
        return y, 1.0

    normalized = (y - pre_mean) / edge_step
    return normalized, edge_step


# ── pydantic models ───────────────────────────────────────────────────────────

class ParsedXasFile(BaseModel):
    name: str
    x: List[float]
    tey: List[float]
    tfy: List[float]
    mapping: Dict[str, Any]
    n_cols: int


class ParseResponse(BaseModel):
    files: List[ParsedXasFile]
    errors: List[str] = Field(default_factory=list)


class DatasetInput(BaseModel):
    name: str
    x: List[float]
    tey: List[float]
    tfy: List[float]


class ProcessParams(BaseModel):
    interpolate: bool = False
    n_points: int = 2000
    average: bool = False
    energy_shift: float = 0.0
    bg_enabled: bool = False
    bg_channel: str = "both"          # both | TEY | TFY
    bg_method: str = "linear"         # linear | polynomial | asls | airpls
    bg_x_start: Optional[float] = None
    bg_x_end: Optional[float] = None
    bg_poly_deg: int = 3
    bg_baseline_lambda: float = 1e5
    bg_baseline_p: float = 0.01
    bg_baseline_iter: int = 20
    norm_method: str = "none"         # none | min_max | max | area | post_edge
    norm_x_start: Optional[float] = None
    norm_x_end: Optional[float] = None
    norm_pre_start: Optional[float] = None  # for post_edge: pre-edge region start
    norm_pre_end: Optional[float] = None    # for post_edge: pre-edge region end
    white_line_start: Optional[float] = None
    white_line_end: Optional[float] = None


class ProcessRequest(BaseModel):
    datasets: List[DatasetInput]
    params: ProcessParams


class ProcessedDataset(BaseModel):
    name: str
    x: List[float]
    tey_raw: List[float]
    tfy_raw: List[float]
    tey_processed: List[float]
    tfy_processed: List[float]
    white_line_tey: Optional[float] = None
    white_line_tfy: Optional[float] = None
    edge_step_tey: Optional[float] = None
    edge_step_tfy: Optional[float] = None


class ProcessResponse(BaseModel):
    datasets: List[ProcessedDataset]
    average: Optional[ProcessedDataset] = None


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/parse", response_model=ParseResponse)
async def parse_xas_files(
    files: List[UploadFile] = File(...),
    flip_tfy: bool = True,
):
    results: list[ParsedXasFile] = []
    errors: list[str] = []

    for uf in files:
        raw = await uf.read()
        df, err = _parse_xas_table_bytes(raw)
        if err or df is None:
            errors.append(f"{uf.filename}: {err or '解析失敗'}")
            continue

        energy, channels, mapping, prep_err = _prepare_tey_tfy_auto(df, flip_tfy)
        if prep_err:
            errors.append(f"{uf.filename}: {prep_err}")
            continue

        results.append(ParsedXasFile(
            name=uf.filename or "unknown",
            x=energy.tolist(),
            tey=channels["TEY"].tolist(),
            tfy=channels["TFY"].tolist(),
            mapping=mapping,
            n_cols=int(df.shape[1]),
        ))

    return ParseResponse(files=results, errors=errors)


@router.post("/process", response_model=ProcessResponse)
def process_xas(req: ProcessRequest):
    p = req.params
    datasets = req.datasets

    if not datasets:
        raise HTTPException(status_code=400, detail="沒有資料集")

    processed_datasets: list[ProcessedDataset] = []

    for ds in datasets:
        x = np.array(ds.x, dtype=float)
        tey = np.array(ds.tey, dtype=float)
        tfy = np.array(ds.tfy, dtype=float)

        # energy shift
        x_shifted = x + p.energy_shift

        # interpolation
        if p.interpolate:
            x_grid = np.linspace(float(x_shifted.min()), float(x_shifted.max()), int(p.n_points))
            tey = np.interp(x_grid, x_shifted, tey)
            tfy = np.interp(x_grid, x_shifted, tfy)
            x_shifted = x_grid

        x_out = x_shifted

        tey_proc = tey.copy()
        tfy_proc = tfy.copy()

        # background subtraction
        if p.bg_enabled:
            bg_kwargs: dict[str, Any] = {
                "method": p.bg_method,
                "x_start": p.bg_x_start,
                "x_end": p.bg_x_end,
                "poly_deg": p.bg_poly_deg,
                "baseline_lambda": p.bg_baseline_lambda,
                "baseline_p": p.bg_baseline_p,
                "baseline_iter": p.bg_baseline_iter,
            }
            if p.bg_channel in ("both", "TEY"):
                _, tey_proc = apply_background(x_out, tey_proc, **bg_kwargs)
            if p.bg_channel in ("both", "TFY"):
                _, tfy_proc = apply_background(x_out, tfy_proc, **bg_kwargs)

        # normalization
        edge_step_tey: float | None = None
        edge_step_tfy: float | None = None

        if p.norm_method == "post_edge" and p.norm_pre_start is not None and p.norm_pre_end is not None:
            norm_start = p.norm_x_start if p.norm_x_start is not None else float(x_out[-1] * 0.9)
            norm_end = p.norm_x_end if p.norm_x_end is not None else float(x_out[-1])
            tey_proc, step_t = _normalize_post_edge(x_out, tey_proc, (p.norm_pre_start, p.norm_pre_end), (norm_start, norm_end))
            tfy_proc, step_f = _normalize_post_edge(x_out, tfy_proc, (p.norm_pre_start, p.norm_pre_end), (norm_start, norm_end))
            edge_step_tey = float(step_t)
            edge_step_tfy = float(step_f)
        elif p.norm_method != "none" and p.norm_method != "post_edge":
            norm_kwargs: dict[str, Any] = {
                "method": p.norm_method,
                "x_start": p.norm_x_start,
                "x_end": p.norm_x_end,
            }
            _, tey_proc = apply_normalization(x_out, tey_proc, **norm_kwargs)
            _, tfy_proc = apply_normalization(x_out, tfy_proc, **norm_kwargs)

        # white line
        wl_tey: float | None = None
        wl_tfy: float | None = None
        if p.white_line_start is not None and p.white_line_end is not None:
            wl_tey = _find_white_line(x_out, tey_proc, p.white_line_start, p.white_line_end)
            wl_tfy = _find_white_line(x_out, tfy_proc, p.white_line_start, p.white_line_end)

        processed_datasets.append(ProcessedDataset(
            name=ds.name,
            x=x_out.tolist(),
            tey_raw=tey.tolist(),
            tfy_raw=tfy.tolist(),
            tey_processed=tey_proc.tolist(),
            tfy_processed=tfy_proc.tolist(),
            white_line_tey=wl_tey,
            white_line_tfy=wl_tfy,
            edge_step_tey=edge_step_tey,
            edge_step_tfy=edge_step_tfy,
        ))

    # average across all datasets
    average_ds: ProcessedDataset | None = None
    if p.average and len(processed_datasets) > 1:
        try:
            x_ref = np.array(processed_datasets[0].x)
            tey_arrays = [np.interp(x_ref, np.array(d.x), np.array(d.tey_processed)) for d in processed_datasets]
            tfy_arrays = [np.interp(x_ref, np.array(d.x), np.array(d.tfy_processed)) for d in processed_datasets]
            tey_avg = np.mean(tey_arrays, axis=0)
            tfy_avg = np.mean(tfy_arrays, axis=0)
            wl_tey_avg: float | None = None
            wl_tfy_avg: float | None = None
            if p.white_line_start is not None and p.white_line_end is not None:
                wl_tey_avg = _find_white_line(x_ref, tey_avg, p.white_line_start, p.white_line_end)
                wl_tfy_avg = _find_white_line(x_ref, tfy_avg, p.white_line_start, p.white_line_end)
            average_ds = ProcessedDataset(
                name="平均",
                x=x_ref.tolist(),
                tey_raw=tey_avg.tolist(),
                tfy_raw=tfy_avg.tolist(),
                tey_processed=tey_avg.tolist(),
                tfy_processed=tfy_avg.tolist(),
                white_line_tey=wl_tey_avg,
                white_line_tfy=wl_tfy_avg,
            )
        except Exception:
            pass

    return ProcessResponse(datasets=processed_datasets, average=average_ds)
