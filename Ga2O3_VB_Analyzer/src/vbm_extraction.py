from __future__ import annotations

import pandas as pd


def add_vbm_alignment(df: pd.DataFrame, sample: str, vbm: float) -> pd.DataFrame:
    out = df.copy()
    out.insert(0, "Sample", sample)
    out["VBM"] = float(vbm)
    out["E_rel"] = out["Binding_Energy"] - float(vbm)
    return out[["Sample", "Binding_Energy", "Intensity_raw", "Intensity_processed", "VBM", "E_rel"]]

