from __future__ import annotations

from io import BytesIO

import matplotlib.pyplot as plt
import pandas as pd

DEFAULT_COLORS = {"50-0": "#136DE4", "45-5": "#E42213", "40-10": "#252526"}


def sample_color(sample: str, fallback: str, overrides: dict[str, str] | None = None) -> str:
    if overrides and sample in overrides:
        return overrides[sample]
    return DEFAULT_COLORS.get(sample, fallback)


def setup_fig(font_size: int = 12):
    plt.rcParams.update({"font.size": font_size, "axes.grid": False, "figure.facecolor": "white", "axes.facecolor": "white"})
    return plt.subplots(figsize=(7.2, 4.6), constrained_layout=True)


def raw_overlay(processed: list[pd.DataFrame], reverse_x: bool, line_width: float, colors: dict[str, str] | None = None, legend_loc: str = "best"):
    fig, ax = setup_fig()
    cycle = plt.rcParams["axes.prop_cycle"].by_key()["color"]
    for i, df in enumerate(processed):
        sample = str(df["Sample"].iloc[0])
        ax.plot(df["Binding_Energy"], df["Intensity_raw"], lw=line_width, label=sample, color=sample_color(sample, cycle[i % len(cycle)], colors))
    ax.set_xlabel("Binding Energy (eV)")
    ax.set_ylabel("Intensity")
    if reverse_x:
        ax.invert_xaxis()
    ax.legend(loc=legend_loc)
    return fig


def aligned_overlay(processed: list[pd.DataFrame], regions: list[dict], line_width: float, colors: dict[str, str] | None = None, legend_loc: str = "best"):
    fig, ax = setup_fig()
    region_colors = ["#dbeafe", "#dcfce7", "#fef3c7", "#fee2e2"]
    for region, color in zip(regions, region_colors):
        ax.axvspan(region["start"], region["end"], color=color, alpha=0.45, label=f"{region['key']}: {region['start']}-{region['end']} eV")
    cycle = plt.rcParams["axes.prop_cycle"].by_key()["color"]
    for i, df in enumerate(processed):
        sample = str(df["Sample"].iloc[0])
        ax.plot(df["E_rel"], df["Intensity_processed"], lw=line_width, label=sample, color=sample_color(sample, cycle[i % len(cycle)], colors))
    ax.axvline(0, color="#111827", lw=1.2, ls="--")
    ax.set_xlabel("E_rel = Binding Energy - VBM (eV)")
    ax.set_ylabel("Processed intensity")
    ax.legend(loc=legend_loc, fontsize=9)
    return fig


def fraction_bar(results: pd.DataFrame):
    fig, ax = setup_fig()
    cols = [c for c in ["Fraction_A", "Fraction_B", "Fraction_C", "Fraction_D"] if c in results.columns]
    results.set_index("Sample")[cols].plot(kind="bar", ax=ax, width=0.78)
    ax.set_ylabel("Area fraction")
    ax.set_xlabel("Sample")
    ax.legend(loc="best")
    return fig


def ratio_bar(results: pd.DataFrame):
    fig, ax = setup_fig()
    ax.bar(results["Sample"], results["Hybrid_upper_ratio"], color=[sample_color(str(s), "#6b7280") for s in results["Sample"]])
    ax.set_ylabel("Area_C / (Area_A + Area_B)")
    ax.set_xlabel("Sample")
    return fig


def derivative_plot(processed: list[pd.DataFrame], line_width: float):
    fig, ax = setup_fig()
    for df in processed:
        d = df.sort_values("E_rel")
        dy = d["Intensity_processed"].diff() / d["E_rel"].diff()
        ax.plot(d["E_rel"], dy, lw=line_width, label=str(d["Sample"].iloc[0]))
    ax.axvline(0, color="#111827", lw=1.0, ls="--")
    ax.set_xlabel("E_rel (eV)")
    ax.set_ylabel("dI/dE")
    ax.legend(loc="best")
    return fig


def fit_plot(fit_result: dict, sample: str):
    fig, axes = plt.subplots(2, 1, figsize=(7.2, 5.8), sharex=True, constrained_layout=True, gridspec_kw={"height_ratios": [3, 1]})
    axes[0].plot(fit_result["energy"], fit_result["observed"], color="#111827", lw=1.7, label=f"{sample} observed")
    axes[0].plot(fit_result["energy"], fit_result["fit"], color="#E42213", lw=1.6, label="pDOS fit")
    axes[0].legend(loc="best")
    axes[0].set_ylabel("Intensity")
    axes[1].axhline(0, color="#111827", lw=1)
    axes[1].plot(fit_result["energy"], fit_result["residual"], color="#136DE4", lw=1.2)
    axes[1].set_xlabel("E_rel (eV)")
    axes[1].set_ylabel("Residual")
    return fig


def fig_bytes(fig, fmt: str) -> bytes:
    buf = BytesIO()
    fig.savefig(buf, format=fmt, dpi=300, bbox_inches="tight")
    return buf.getvalue()

