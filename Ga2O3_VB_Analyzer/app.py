from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st

from src.fitting import fit_components
from src.integration import DEFAULT_REGIONS, integrate_regions
from src.io_utils import detect_xy_columns, df_to_csv_bytes, read_table
from src.pdos_acquisition import materials_project_reference, uploaded_reference
from src.pdos_model import ORBITALS, apply_cross_sections, broaden_pdos, interpolate_components, prepare_pdos
from src.plotting import aligned_overlay, derivative_plot, fig_bytes, fit_plot, fraction_bar, ratio_bar, raw_overlay
from src.preprocessing import process_spectrum
from src.report import DEFAULT_INTERPRETATION, build_html, build_markdown
from src.vbm_extraction import add_vbm_alignment

PASSWORD = "931130"
DEFAULT_VBMS = {"40-10": 4.104, "45-5": 3.888, "50-0": 3.959}


def sample_from_name(name: str) -> str:
    stem = Path(name).stem.replace(" VBM", "").replace("_VBM", "")
    for key in DEFAULT_VBMS:
        if key in stem:
            return key
    return stem


def gate() -> bool:
    if st.session_state.get("dft_unlocked"):
        return True
    st.title("Valence Band DFT-informed Analyzer")
    st.info("此 DFT-informed XPS valence band 分析區為加密區，請輸入密碼解鎖。")
    password = st.text_input("密碼", type="password")
    if st.button("解鎖", type="primary"):
        if password == PASSWORD:
            st.session_state["dft_unlocked"] = True
            st.rerun()
        st.error("密碼錯誤。")
    return False


def configure_page():
    st.set_page_config(page_title="Valence Band DFT-informed Analyzer", layout="wide")
    st.title("Valence Band DFT-informed Analyzer")
    st.caption("Ga2O3/NiO/p-Si XPS valence band spectra, VBM alignment, area-ratio analysis, and optional DFT pDOS-informed fitting.")
    st.warning(
        "This software does not run VASP/DFT. It performs DFT-informed spectral analysis. "
        "Experimental valence band intensity is not equal to raw DOS. It depends on orbital-dependent photoionisation cross sections, "
        "photon energy, instrumental broadening, and lifetime broadening."
    )


def sidebar_options():
    st.sidebar.header("Plot options")
    reverse_x = st.sidebar.checkbox("Raw plot reverse x-axis", value=True)
    line_width = st.sidebar.slider("Line width", 0.5, 4.0, 1.8, 0.1)
    legend_loc = st.sidebar.selectbox("Legend location", ["best", "upper right", "upper left", "lower right", "lower left"], index=0)
    export_fmt = st.sidebar.selectbox("Figure export format", ["png", "svg", "pdf"], index=0)
    derivative = st.sidebar.checkbox("Show derivative plot", value=False)
    return reverse_x, line_width, legend_loc, export_fmt, derivative


def experimental_panel():
    st.header("1. Experimental VB CSV input")
    files = st.file_uploader("Upload experimental VB CSV files", type=["csv", "txt", "dat", "xlsx", "xls"], accept_multiple_files=True)
    processed: list[pd.DataFrame] = []
    if not files:
        st.info("請上傳 40-10 / 45-5 / 50-0 等 valence band CSV。")
        return processed

    for file in files:
        with st.expander(file.name, expanded=True):
            try:
                raw_df = read_table(file)
            except Exception as exc:
                st.error(f"{file.name}: 讀檔失敗：{exc}")
                continue
            x_guess, y_guess = detect_xy_columns(raw_df)
            cols = [str(c) for c in raw_df.columns]
            c1, c2, c3 = st.columns(3)
            sample = c1.text_input("Sample name", value=sample_from_name(file.name), key=f"sample_{file.name}")
            vbm = c2.number_input("VBM value (eV)", value=float(DEFAULT_VBMS.get(sample, 0.0)), step=0.001, format="%.4f", key=f"vbm_{file.name}")
            x_col = c3.selectbox("Energy / BE column", cols, index=cols.index(x_guess) if x_guess in cols else 0, key=f"x_{file.name}")
            y_col = st.selectbox("Intensity column", cols, index=cols.index(y_guess) if y_guess in cols else min(1, len(cols) - 1), key=f"y_{file.name}")
            b1, b2, b3, b4 = st.columns(4)
            baseline = b1.selectbox("Baseline correction", ["none", "linear"], format_func=lambda x: "No baseline correction" if x == "none" else "Linear baseline correction", key=f"baseline_{file.name}")
            baseline_range = b2.text_input("Baseline range(s)", value="0-1,12-16", help="Example: 0-1,12-16", key=f"br_{file.name}")
            clip_negative = b3.checkbox("Clip negative to 0", value=True, key=f"clip_{file.name}")
            norm = b4.selectbox("Normalization", ["none", "max", "area"], format_func=lambda x: {"none": "No normalization", "max": "Max normalization", "area": "Area normalization"}[x], key=f"norm_{file.name}")
            try:
                df = pd.DataFrame({
                    "Binding_Energy": pd.to_numeric(raw_df[x_col], errors="coerce"),
                    "Intensity_raw": pd.to_numeric(raw_df[y_col], errors="coerce"),
                }).dropna()
                ranges = []
                for part in baseline_range.split(","):
                    if "-" in part:
                        lo, hi = part.split("-", 1)
                        ranges.append((float(lo), float(hi)))
                pre = process_spectrum(df, baseline, ranges, clip_negative, norm)
                for warning in pre.attrs.get("warnings", []):
                    st.warning(warning)
                aligned = add_vbm_alignment(pre, sample, vbm)
                processed.append(aligned)
                st.dataframe(aligned.head(8), use_container_width=True)
            except Exception as exc:
                st.error(f"{file.name}: 資料處理失敗：{exc}")
    return processed


def regions_panel():
    st.header("2. Integration regions")
    regions = []
    cols = st.columns(4)
    for i, region in enumerate(DEFAULT_REGIONS):
        with cols[i]:
            st.caption(f"Region {region['key']}")
            start = st.number_input("Start", value=float(region["start"]), step=0.1, key=f"r_start_{region['key']}")
            end = st.number_input("End", value=float(region["end"]), step=0.1, key=f"r_end_{region['key']}")
            name = st.text_input("Name", value=region["name"], key=f"r_name_{region['key']}")
            regions.append({"key": region["key"], "name": name, "start": start, "end": end})
    return regions


def _legacy_pdos_panel(processed: list[pd.DataFrame]):
    st.header("4. Optional DFT pDOS fitting")
    pdos_file = st.file_uploader("Upload DFT pDOS reference CSV", type=["csv", "txt", "dat"], key="pdos_file")
    fit_rows = []
    fit_figs = {}
    if not pdos_file or not processed:
        st.info("若沒有 DFT pDOS reference CSV，系統會停留在 experimental VB region / area ratio analysis。")
        return pd.DataFrame(), fit_figs

    try:
        pdos_raw = read_table(pdos_file)
    except Exception as exc:
        st.error(f"pDOS 讀檔失敗：{exc}")
        return pd.DataFrame(), fit_figs
    cols = [str(c) for c in pdos_raw.columns]
    energy_col = st.selectbox("pDOS energy column", cols, index=cols.index("Energy_rel") if "Energy_rel" in cols else 0)
    flip_negative = st.checkbox("DFT energy is negative below VBM: use E_rel = -Energy_DFT", value=False)
    st.subheader("pDOS orbital column mapping")
    mapping = {}
    for orbital in ORBITALS:
        guess = orbital if orbital in cols else orbital.replace("_", "")
        options = [""] + cols
        mapping[orbital] = st.selectbox(orbital, options, index=options.index(guess) if guess in options else 0, key=f"map_{orbital}")

    st.subheader("Photoionisation cross-section correction")
    corr_mode = st.radio("Correction mode", ["none", "manual", "upload"], horizontal=True)
    factors = {name: 1.0 for name in ["O_2p", "O_2s", "Ga_4p", "Ga_3d", "Ga_tet", "Ga_oct"]}
    if corr_mode == "manual":
        factor_cols = st.columns(6)
        for i, name in enumerate(factors):
            factors[name] = factor_cols[i].number_input(f"{name} factor", value=1.0, step=0.1, key=f"fac_{name}")
    elif corr_mode == "upload":
        cf = st.file_uploader("Upload cross_section.csv", type=["csv"], key="cross_section")
        if cf:
            try:
                cdf = read_table(cf)
                factors.update({str(r["orbital"]): float(r["factor"]) for _, r in cdf.iterrows() if "orbital" in cdf and "factor" in cdf})
            except Exception as exc:
                st.warning(f"cross section CSV 讀取失敗：{exc}")

    b1, b2, b3, b4 = st.columns(4)
    broadening = b1.selectbox("Broadening", ["none", "gaussian", "lorentzian", "voigt"], index=3)
    gfwhm = b2.number_input("Gaussian FWHM (eV)", value=0.35, step=0.01)
    lfwhm = b3.number_input("Lorentzian FWHM (eV)", value=0.40, step=0.01)
    bg = b4.selectbox("Background", ["constant", "linear", "none"])
    fit_lo, fit_hi = st.slider("Fitting energy range below VBM (eV)", 0.0, 16.0, (0.0, 12.0), 0.1)

    try:
        pdos = prepare_pdos(pdos_raw, energy_col, mapping, flip_negative)
        pdos = apply_cross_sections(pdos, factors)
        pdos = broaden_pdos(pdos, broadening, gfwhm, lfwhm)
    except Exception as exc:
        st.error(f"pDOS model 建立失敗：{exc}")
        return pd.DataFrame(), fit_figs

    for df in processed:
        sample = str(df["Sample"].iloc[0])
        try:
            energy = df["E_rel"].to_numpy(float)
            y = df["Intensity_processed"].to_numpy(float)
            components = interpolate_components(pdos, energy)
            res = fit_components(energy, y, components, (fit_lo, fit_hi), bg)
            row = {"Sample": sample, "R2": res["r2"], "RMSE": res["rmse"], **res["coefficients"], **res["percentages"]}
            row["Fit_O2p_percent"] = row.get("O_2p_percent", 0.0)
            row["Fit_Ga_tet_percent"] = row.get("Ga_tet_percent", 0.0) + row.get("Ga_tet_4p_percent", 0.0) + row.get("Ga_tet_3d_percent", 0.0)
            row["Fit_Ga_oct_percent"] = row.get("Ga_oct_percent", 0.0) + row.get("Ga_oct_4p_percent", 0.0) + row.get("Ga_oct_3d_percent", 0.0)
            row["Fit_GaO_hybrid_percent"] = row["Fit_Ga_tet_percent"] + row["Fit_Ga_oct_percent"]
            fit_rows.append(row)
            fit_figs[sample] = fit_plot(res, sample)
        except Exception as exc:
            st.warning(f"{sample}: pDOS fitting skipped: {exc}")
    return pd.DataFrame(fit_rows), fit_figs


def pdos_panel(processed: list[pd.DataFrame]):
    st.header("4. DFT pDOS reference acquisition and fitting")
    st.warning("Fitted Ga_tet/Ga_oct coefficients are relative spectral weights, not absolute tetrahedral/octahedral atomic fractions.")
    fit_rows = []
    fit_figs = {}
    reference_notes: list[str] = []

    source = st.radio(
        "Reference source",
        ["User-uploaded pDOS CSV", "Materials Project / pymatgen import", "Digitized literature pDOS"],
        horizontal=False,
    )
    pdos_raw = None
    energy_col = "Energy_rel"
    flip_negative = False
    mapping: dict[str, str] = {}

    if source == "User-uploaded pDOS CSV":
        pdos_file = st.file_uploader("Upload DFT pDOS reference CSV", type=["csv", "txt", "dat"], key="pdos_file")
        if pdos_file:
            try:
                ref = uploaded_reference(pdos_file, "uploaded_csv")
                pdos_raw = ref.data
                reference_notes.extend(ref.notes)
            except Exception as exc:
                st.error(f"pDOS CSV read failed: {exc}")
    elif source == "Digitized literature pDOS":
        digitized_file = st.file_uploader("Upload digitized literature pDOS CSV", type=["csv", "txt", "dat"], key="digitized_pdos_file")
        st.info("This digitized pDOS is used only as qualitative reference and should not be interpreted quantitatively.")
        if digitized_file:
            try:
                ref = uploaded_reference(digitized_file, "digitized")
                pdos_raw = ref.data
                reference_notes.extend(ref.notes)
            except Exception as exc:
                st.error(f"Digitized pDOS CSV read failed: {exc}")
    else:
        st.caption("Requires mp-api/pymatgen and an active Materials Project API key. Example beta-Ga2O3 material_id: mp-886.")
        api_key = st.text_input("Materials Project API key", type="password")
        material_id = st.text_input("material_id", value="mp-886")
        if st.button("Download structure and DOS from Materials Project"):
            try:
                ref = materials_project_reference(api_key.strip(), material_id.strip())
                st.session_state["mp_pdos_reference"] = ref.data
                st.session_state["mp_pdos_notes"] = ref.notes
                st.success("Materials Project pDOS reference imported.")
            except Exception as exc:
                st.warning(f"Materials Project import failed: {exc} Please upload a pDOS CSV instead.")
        if "mp_pdos_reference" in st.session_state:
            pdos_raw = st.session_state["mp_pdos_reference"]
            reference_notes.extend(st.session_state.get("mp_pdos_notes", []))

    if not processed:
        return pd.DataFrame(), fit_figs, reference_notes
    if pdos_raw is None:
        st.info("Provide a pDOS reference to enable pDOS-based fitting. Without a reference, use the experimental area-ratio analysis.")
        return pd.DataFrame(), fit_figs, reference_notes

    for note in reference_notes:
        st.warning(note)

    st.subheader("Reference preview")
    st.dataframe(pdos_raw.head(20), use_container_width=True)
    cols = [str(c) for c in pdos_raw.columns]
    if source == "Materials Project / pymatgen import":
        if "Energy_rel" not in cols:
            st.error("Materials Project import did not produce Energy_rel.")
            return pd.DataFrame(), fit_figs, reference_notes
        mapping = {col: col for col in cols if col != "Energy_rel"}
    else:
        energy_col = st.selectbox("pDOS energy column", cols, index=cols.index("Energy_rel") if "Energy_rel" in cols else 0)
        flip_negative = st.checkbox("DFT energy is negative below VBM: use E_rel = -Energy_DFT", value=False)
        st.subheader("pDOS orbital column mapping")
        for orbital in ORBITALS:
            guess = orbital if orbital in cols else orbital.replace("_", "")
            options = [""] + cols
            mapping[orbital] = st.selectbox(orbital, options, index=options.index(guess) if guess in options else 0, key=f"map_{source}_{orbital}")

    st.subheader("Photoionisation cross-section correction")
    corr_mode = st.radio("Correction mode", ["none", "manual", "upload"], horizontal=True, key="pdos_corr_mode")
    factors = {name: 1.0 for name in ["O_2p", "O_2s", "Ga_4p", "Ga_3d", "Ga_tet", "Ga_oct"]}
    if corr_mode == "manual":
        factor_cols = st.columns(6)
        for i, name in enumerate(factors):
            factors[name] = factor_cols[i].number_input(f"{name} factor", value=1.0, step=0.1, key=f"fac_{name}")
    elif corr_mode == "upload":
        cf = st.file_uploader("Upload cross_section.csv", type=["csv"], key="cross_section")
        if cf:
            try:
                cdf = read_table(cf)
                if {"orbital", "factor"}.issubset(cdf.columns):
                    factors.update({str(r["orbital"]): float(r["factor"]) for _, r in cdf.iterrows()})
                else:
                    st.warning("cross_section.csv must include orbital and factor columns.")
            except Exception as exc:
                st.warning(f"cross section CSV read failed: {exc}")

    b1, b2, b3, b4 = st.columns(4)
    broadening = b1.selectbox("Broadening", ["none", "gaussian", "lorentzian", "voigt"], index=3, key="pdos_broadening")
    gfwhm = b2.number_input("Gaussian FWHM (eV)", value=0.35, step=0.01, key="pdos_gfwhm")
    lfwhm = b3.number_input("Lorentzian FWHM (eV)", value=0.40, step=0.01, key="pdos_lfwhm")
    bg = b4.selectbox("Background", ["constant", "linear", "none"], key="pdos_bg")
    fit_lo, fit_hi = st.slider("Fitting energy range below VBM (eV)", 0.0, 16.0, (0.0, 12.0), 0.1, key="pdos_fit_range")

    try:
        pdos = prepare_pdos(pdos_raw, energy_col, mapping, flip_negative)
        pdos = apply_cross_sections(pdos, factors)
        pdos = broaden_pdos(pdos, broadening, gfwhm, lfwhm)
    except Exception as exc:
        st.error(f"pDOS model preparation failed: {exc}")
        return pd.DataFrame(), fit_figs, reference_notes

    tet_names = ["Ga_tet", "Ga_tet_s", "Ga_tet_p", "Ga_tet_d", "Ga_tet_4p", "Ga_tet_3d"]
    oct_names = ["Ga_oct", "Ga_oct_s", "Ga_oct_p", "Ga_oct_d", "Ga_oct_4p", "Ga_oct_3d"]
    for df in processed:
        sample = str(df["Sample"].iloc[0])
        try:
            energy = df["E_rel"].to_numpy(float)
            y = df["Intensity_processed"].to_numpy(float)
            components = interpolate_components(pdos, energy)
            res = fit_components(energy, y, components, (fit_lo, fit_hi), bg)
            row = {"Sample": sample, "R2": res["r2"], "RMSE": res["rmse"], **res["coefficients"], **res["percentages"]}
            row["Fit_O2p_percent"] = row.get("O_2p_percent", 0.0)
            row["Fit_Ga_tet_percent"] = sum(row.get(f"{name}_percent", 0.0) for name in tet_names)
            row["Fit_Ga_oct_percent"] = sum(row.get(f"{name}_percent", 0.0) for name in oct_names)
            row["Fit_GaO_hybrid_percent"] = row["Fit_Ga_tet_percent"] + row["Fit_Ga_oct_percent"]
            fit_rows.append(row)
            fit_figs[sample] = fit_plot(res, sample)
        except Exception as exc:
            st.warning(f"{sample}: pDOS fitting skipped: {exc}")
    return pd.DataFrame(fit_rows), fit_figs, reference_notes


def main():
    configure_page()
    if not gate():
        return
    reverse_x, line_width, legend_loc, export_fmt, derivative = sidebar_options()
    processed = experimental_panel()
    regions = regions_panel()
    if not processed:
        return

    st.header("3. Spectra and area-ratio analysis")
    all_processed = pd.concat(processed, ignore_index=True)
    result_rows, warnings = [], []
    for df in processed:
        row, warn = integrate_regions(df, regions)
        result_rows.append(row)
        warnings.extend(warn)
    results = pd.DataFrame(result_rows)
    for warning in warnings:
        st.warning(warning)

    tabs = st.tabs(["Figures", "Tables", "DFT pDOS fitting", "Report"])
    with tabs[0]:
        figs = {
            "raw_overlay": raw_overlay(processed, reverse_x, line_width, legend_loc=legend_loc),
            "vbm_aligned": aligned_overlay(processed, regions, line_width, legend_loc=legend_loc),
            "area_fractions": fraction_bar(results),
            "hybrid_ratio": ratio_bar(results),
        }
        if derivative:
            figs["derivative"] = derivative_plot(processed, line_width)
        for name, fig in figs.items():
            st.pyplot(fig, clear_figure=False)
            st.download_button(f"Export {name}.{export_fmt}", fig_bytes(fig, export_fmt), file_name=f"{name}.{export_fmt}")

    with tabs[1]:
        st.subheader("Processed spectra")
        st.dataframe(all_processed, use_container_width=True)
        st.download_button("Export processed spectra CSV", df_to_csv_bytes(all_processed), "processed_spectra.csv", "text/csv")
        st.subheader("Integration results")
        st.dataframe(results, use_container_width=True)
        st.download_button("Export integration results CSV", df_to_csv_bytes(results), "integration_results.csv", "text/csv")

    with tabs[2]:
        fit_df, fit_figs, reference_notes = pdos_panel(processed)
        if not fit_df.empty:
            st.warning("Fitted coefficients cannot be directly interpreted as tetrahedral / octahedral Ga contents. They are relative spectral contributions affected by cross-section, surface sensitivity, disorder, calibration, and background.")
            st.dataframe(fit_df, use_container_width=True)
            st.download_button("Export fitting results CSV", df_to_csv_bytes(fit_df), "fitting_results.csv", "text/csv")
            for sample, fig in fit_figs.items():
                st.pyplot(fig, clear_figure=False)
                st.download_button(f"Export {sample} fitting plot.{export_fmt}", fig_bytes(fig, export_fmt), file_name=f"{sample}_fit.{export_fmt}")
        else:
            fit_df = pd.DataFrame()

    with tabs[3]:
        fit_cols = ["Sample", "Fit_O2p_percent", "Fit_Ga_tet_percent", "Fit_Ga_oct_percent", "Fit_GaO_hybrid_percent", "R2", "RMSE"]
        summary = results.copy()
        if "fit_df" in locals() and not fit_df.empty:
            summary = summary.merge(fit_df[[c for c in fit_cols if c in fit_df.columns]], on="Sample", how="left")
        for col in ["Fit_O2p_percent", "Fit_Ga_tet_percent", "Fit_Ga_oct_percent", "Fit_GaO_hybrid_percent", "R2", "RMSE"]:
            if col not in summary:
                summary[col] = np.nan
        st.dataframe(summary, use_container_width=True)
        interpretation = st.text_area("Editable interpretation text", value=DEFAULT_INTERPRETATION, height=170)
        report_notes = [
            "Fitted Ga_tet/Ga_oct coefficients are relative spectral weights, not absolute tetrahedral/octahedral atomic fractions."
        ]
        if "reference_notes" in locals():
            report_notes.extend(reference_notes)
        interpretation_with_notes = interpretation + "\n\n" + "\n".join(f"- {note}" for note in dict.fromkeys(report_notes))
        md = build_markdown(summary, interpretation_with_notes)
        html = build_html(summary, interpretation_with_notes)
        st.download_button("Export Markdown report", md.encode("utf-8-sig"), "vb_dft_report.md", "text/markdown")
        st.download_button("Export HTML report", html.encode("utf-8-sig"), "vb_dft_report.html", "text/html")


if __name__ == "__main__":
    main()
