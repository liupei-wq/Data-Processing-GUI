# Valence Band DFT-informed Analyzer

This Streamlit app analyzes Ga2O3/NiO/p-Si XPS valence band spectra with DFT-informed spectral analysis.

It does not run VASP or any first-principles DFT calculation. It helps compare experimental valence band line shapes with literature or downloaded pDOS references, with special attention to Ga coordination, tetrahedral Ga / octahedral Ga, and Ga-O hybridization.

## Install And Run

```bash
pip install -r requirements.txt
streamlit run app.py
```

The app is password-gated. Enter:

```text
931130
```

## Experimental VB CSV Input

Energy columns can be named:

```text
Energy, Binding Energy, BindingEnergy, BE, eV, X
```

Intensity columns can be named:

```text
Intensity, Counts, CPS, Y, Signal
```

If automatic detection fails, select the X/Y columns manually in the UI.

## VBM Alignment

For each sample:

```text
E_rel = Binding_Energy - VBM
```

`E_rel = 0` is the VBM. `E_rel > 0` means below VBM, i.e. deeper valence region.

The processed export preserves raw data and includes:

```text
Sample, Binding_Energy, Intensity_raw, Intensity_processed, VBM, E_rel
```

## Region Integration

Default regions:

- Region A: 0-2 eV, VBM leading edge / O 2p onset
- Region B: 2-7 eV, O 2p-dominated upper valence band
- Region C: 7-11.5 eV, mid-valence / Ga-O hybridization-sensitive region
- Region D: 11.5-12.5 eV, Ga 3d-derived / deep valence onset

The app reports area fractions, `Hybrid_upper_ratio = Area_C / (Area_A + Area_B)`, and `Deep_upper_ratio = Area_D / (Area_A + Area_B)`.

## DFT pDOS Reference Acquisition

The pDOS fitting tab supports three reference sources.

### 1. User-uploaded pDOS CSV

Upload a CSV with columns such as:

```text
Energy_rel, O_2p, O_2s, Ga_tet, Ga_oct, Ga_3d
```

More detailed columns are also supported, such as `Ga_tet_4p`, `Ga_oct_4p`, `Ga_tet_3d`, and `Ga_oct_3d`.

### 2. Materials Project / pymatgen import

Enter a Materials Project API key and a `material_id`, for example beta-Ga2O3:

```text
mp-886
```

The app attempts to download the structure and DOS using `mp-api` / `pymatgen`. If site/orbital-projected DOS is available, Ga coordination is estimated:

```text
coordination number about 4 -> Ga_tet
coordination number about 6 -> Ga_oct
```

The site/orbital pDOS is merged into:

```text
O_2p, O_2s, Ga_tet_s, Ga_tet_p, Ga_tet_d, Ga_oct_s, Ga_oct_p, Ga_oct_d
```

If site-projected DOS is unavailable, the UI shows a warning and asks the user to upload a pDOS CSV instead.

### 3. Digitized literature pDOS

Upload CSV data digitized from a literature figure. Reports automatically include:

```text
This digitized pDOS is used only as qualitative reference and should not be interpreted quantitatively.
```

## pDOS Fitting

The app can apply photoionisation cross-section correction, then Gaussian / Lorentzian / Voigt broadening, then non-negative fitting to the experimental VB spectrum.

Simplified model:

```text
I_fit(E) = a O_2p + b O_2s + c Ga_tet + d Ga_oct + e Ga_3d + background
```

Detailed model:

```text
I_fit(E) = a O_2p + b O_2s + c Ga_tet_4p + d Ga_oct_4p + e Ga_tet_3d + f Ga_oct_3d + background
```

For Materials Project site/orbital pDOS, the fitted columns can include `Ga_tet_s`, `Ga_tet_p`, `Ga_tet_d`, `Ga_oct_s`, `Ga_oct_p`, and `Ga_oct_d`.

## Important Notes

1. This app is not a DFT calculation program.
2. Without a DFT pDOS reference, the app performs DFT-informed semi-quantitative experimental VB region / area ratio analysis only.
3. Fitted Ga_tet/Ga_oct coefficients are relative spectral weights, not absolute tetrahedral/octahedral atomic fractions.
4. Experimental valence band intensity is not equal to raw DOS. It depends on orbital-dependent photoionisation cross sections, photon energy, instrumental broadening, lifetime broadening, surface sensitivity, sample disorder, energy calibration, and background.
5. True atomically-resolved DFT requires separate calculations, e.g. VASP calculations of beta-Ga2O3 site-resolved pDOS.
