from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import BinaryIO

import pandas as pd

ENERGY_CANDIDATES = ["Energy", "Binding Energy", "BindingEnergy", "BE", "eV", "X"]
INTENSITY_CANDIDATES = ["Intensity", "Counts", "CPS", "Y", "Signal"]


def read_table(uploaded_file: BinaryIO | str | Path) -> pd.DataFrame:
    """Read CSV/Excel-like user input without assuming exact column names."""
    name = getattr(uploaded_file, "name", str(uploaded_file)).lower()
    if name.endswith((".xlsx", ".xls")):
        return pd.read_excel(uploaded_file)
    try:
        return pd.read_csv(uploaded_file)
    except Exception:
        if hasattr(uploaded_file, "seek"):
            uploaded_file.seek(0)
        return pd.read_csv(uploaded_file, sep=None, engine="python")


def detect_xy_columns(df: pd.DataFrame) -> tuple[str | None, str | None]:
    normalized = {str(col).strip().lower().replace(" ", "").replace("_", ""): col for col in df.columns}

    def find(candidates: list[str]) -> str | None:
        for candidate in candidates:
            key = candidate.lower().replace(" ", "").replace("_", "")
            if key in normalized:
                return str(normalized[key])
        return None

    return find(ENERGY_CANDIDATES), find(INTENSITY_CANDIDATES)


def coerce_xy(df: pd.DataFrame, x_col: str, y_col: str) -> pd.DataFrame:
    out = pd.DataFrame(
        {
            "Binding_Energy": pd.to_numeric(df[x_col], errors="coerce"),
            "Intensity_raw": pd.to_numeric(df[y_col], errors="coerce"),
        }
    )
    return out.dropna().sort_values("Binding_Energy").reset_index(drop=True)


def sort_x_descending(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    sort_cols = [col for col in ["Sample", "Binding_Energy", "E_rel", "Energy_rel"] if col in out.columns]
    if "Sample" in sort_cols:
        numeric_cols = [col for col in sort_cols if col != "Sample"]
        if numeric_cols:
            return out.sort_values(["Sample", *numeric_cols], ascending=[True, *([False] * len(numeric_cols))]).reset_index(drop=True)
    for col in ["Binding_Energy", "E_rel", "Energy_rel"]:
        if col in out.columns:
            return out.sort_values(col, ascending=False).reset_index(drop=True)
    return out


def df_to_csv_bytes(df: pd.DataFrame) -> bytes:
    return sort_x_descending(df).to_csv(index=False).encode("utf-8-sig")


def bytes_download(data: str | bytes) -> bytes:
    if isinstance(data, bytes):
        return data
    return data.encode("utf-8-sig")
