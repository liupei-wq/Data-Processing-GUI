from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.integrate import trapezoid

DEFAULT_REGIONS = [
    {"key": "A", "name": "VBM leading edge / O 2p onset", "start": 0.0, "end": 2.0},
    {"key": "B", "name": "O 2p-dominated upper valence band", "start": 2.0, "end": 7.0},
    {"key": "C", "name": "mid-valence / Ga-O hybridization-sensitive region", "start": 7.0, "end": 11.5},
    {"key": "D", "name": "Ga 3d-derived / deep valence onset", "start": 11.5, "end": 12.5},
]


def integrate_regions(df: pd.DataFrame, regions: list[dict] | None = None) -> tuple[dict, list[str]]:
    regions = regions or DEFAULT_REGIONS
    x = df["E_rel"].to_numpy(float)
    y = df["Intensity_processed"].to_numpy(float)
    row: dict[str, float | str] = {"Sample": str(df["Sample"].iloc[0]), "VBM": float(df["VBM"].iloc[0])}
    warnings: list[str] = []
    total = 0.0

    for region in regions:
        key = region["key"]
        lo, hi = sorted((float(region["start"]), float(region["end"])))
        mask = (x >= lo) & (x <= hi)
        if mask.sum() < 2:
            row[f"Area_{key}"] = 0.0
            warnings.append(f"{row['Sample']}: Region {key} has fewer than 2 points.")
        else:
            area = float(trapezoid(np.clip(y[mask], 0, None), x[mask]))
            row[f"Area_{key}"] = max(area, 0.0)
        total += float(row[f"Area_{key}"])

    row["Total_area"] = total
    for region in regions:
        key = region["key"]
        row[f"Fraction_{key}"] = float(row[f"Area_{key}"]) / total if total > 0 else 0.0
    upper = float(row.get("Area_A", 0.0)) + float(row.get("Area_B", 0.0))
    row["Hybrid_upper_ratio"] = float(row.get("Area_C", 0.0)) / upper if upper > 0 else 0.0
    row["Deep_upper_ratio"] = float(row.get("Area_D", 0.0)) / upper if upper > 0 else 0.0
    return row, warnings

