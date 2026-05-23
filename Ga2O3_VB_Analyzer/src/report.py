from __future__ import annotations

import html
import pandas as pd


DEFAULT_INTERPRETATION = """- The sample with the highest Hybrid_upper_ratio shows stronger mid-valence contribution relative to the O 2p-dominated upper valence band.
- This may indicate enhanced Ga-O hybridized states, local coordination disorder, or broader Ga-O bonding distribution.
- The fitted Ga_tet/Ga_oct spectral contribution should be interpreted as relative spectral weight, not as absolute atomic fraction."""


def build_markdown(summary: pd.DataFrame, interpretation: str) -> str:
    table = summary.to_markdown(index=False) if not summary.empty else "No summary results."
    return f"""# Valence Band DFT-informed Analyzer Report

## Summary Dashboard

{table}

## Interpretation

{interpretation}

## Caveats

This software does not run DFT. pDOS fitting coefficients are relative spectral contributions, not direct tetrahedral/octahedral Ga fractions.
Experimental valence band intensity is affected by photoionisation cross sections, photon energy, broadening, surface sensitivity, disorder, calibration, and background.
"""


def build_html(summary: pd.DataFrame, interpretation: str) -> str:
    table = summary.to_html(index=False, classes="summary", border=0) if not summary.empty else "<p>No summary results.</p>"
    paragraphs = "<br>".join(html.escape(line) for line in interpretation.splitlines())
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Valence Band DFT-informed Analyzer Report</title>
<style>body{{font-family:Arial,sans-serif;margin:32px;color:#111827}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #d1d5db;padding:6px 8px}}th{{background:#f3f4f6}}</style>
</head><body><h1>Valence Band DFT-informed Analyzer Report</h1><h2>Summary Dashboard</h2>{table}<h2>Interpretation</h2><p>{paragraphs}</p><h2>Caveats</h2><p>This software does not run DFT. Fitted coefficients are relative spectral contributions only.</p></body></html>"""

