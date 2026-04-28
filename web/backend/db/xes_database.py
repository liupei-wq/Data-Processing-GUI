"""Built-in XES reference peaks for quick peak assignment.

The energy values are representative soft/hard X-ray emission line positions
used for first-pass screening. Exact peak maxima can shift with beamline
calibration, oxidation state, self absorption, and the chosen VBM/edge
extraction method, so final assignments should be checked against calibrated
standards from the same experiment.
"""

XES_REFERENCES = {
    "NiO": {
        "formula": "NiO",
        "notes": "Nickel oxide. Common checks include O K emission and Ni L emission.",
        "peaks": [
            {
                "label": "O K alpha / O 2p valence emission",
                "energy_eV": 524.9,
                "tolerance_eV": 2.5,
                "relative_intensity": 100,
                "meaning": "O 2p occupied states; useful for oxide valence-band comparison.",
            },
            {
                "label": "Ni L alpha",
                "energy_eV": 851.5,
                "tolerance_eV": 3.0,
                "relative_intensity": 100,
                "meaning": "Ni 3d/4s to Ni 2p3/2 emission; indicates Ni-containing phase.",
            },
            {
                "label": "Ni L beta",
                "energy_eV": 868.0,
                "tolerance_eV": 4.0,
                "relative_intensity": 35,
                "meaning": "Ni 3d/4s to Ni 2p1/2 emission; spin-orbit partner of Ni Lα.",
            },
            {
                "label": "Ni K alpha",
                "energy_eV": 7478.2,
                "tolerance_eV": 8.0,
                "relative_intensity": 100,
                "meaning": "Ni K-shell fluorescence; only relevant for hard-X-ray XES setups.",
            },
        ],
    },
    "Ga2O3": {
        "formula": "Ga2O3",
        "notes": "Gallium oxide. O K emission is valence-sensitive; Ga L/K lines identify Ga.",
        "peaks": [
            {
                "label": "O K alpha / O 2p valence emission",
                "energy_eV": 524.9,
                "tolerance_eV": 2.5,
                "relative_intensity": 100,
                "meaning": "O 2p occupied states in Ga-O bonding.",
            },
            {
                "label": "Ga L alpha",
                "energy_eV": 1098.0,
                "tolerance_eV": 4.0,
                "relative_intensity": 100,
                "meaning": "Ga L-shell emission; indicates Ga-containing phase.",
            },
            {
                "label": "Ga L beta",
                "energy_eV": 1124.0,
                "tolerance_eV": 5.0,
                "relative_intensity": 25,
                "meaning": "Ga L-shell companion line.",
            },
            {
                "label": "Ga K alpha",
                "energy_eV": 9251.7,
                "tolerance_eV": 10.0,
                "relative_intensity": 100,
                "meaning": "Ga K-shell fluorescence; only relevant for hard-X-ray XES setups.",
            },
        ],
    },
    "n-Si": {
        "formula": "Si",
        "notes": "n-type silicon substrate/reference.",
        "peaks": [
            {
                "label": "Si L2,3 / Si 3s3p valence emission",
                "energy_eV": 91.7,
                "tolerance_eV": 2.0,
                "relative_intensity": 100,
                "meaning": "Si valence emission near the L edge; useful for soft-XES Si checks.",
            },
            {
                "label": "Si K beta",
                "energy_eV": 1835.9,
                "tolerance_eV": 5.0,
                "relative_intensity": 20,
                "meaning": "Si valence-to-1s emission; hard-X-ray XES valence-sensitive line.",
            },
            {
                "label": "Si K alpha",
                "energy_eV": 1740.0,
                "tolerance_eV": 5.0,
                "relative_intensity": 100,
                "meaning": "Si K-shell fluorescence; indicates Si substrate/signal.",
            },
        ],
    },
}


def xes_reference_records(materials: list[str] | None = None) -> list[dict]:
    selected = materials or list(XES_REFERENCES)
    rows: list[dict] = []
    for material in selected:
        entry = XES_REFERENCES.get(material)
        if not entry:
            continue
        for peak in entry.get("peaks", []):
            row = {
                "Material": material,
                "Formula": entry.get("formula", ""),
                "Reference_Label": peak.get("label", ""),
                "Reference_Energy_eV": peak.get("energy_eV"),
                "Tolerance_eV": peak.get("tolerance_eV", 2.0),
                "Relative_Intensity": peak.get("relative_intensity"),
                "Meaning": peak.get("meaning", ""),
                "Notes": entry.get("notes", ""),
            }
            if "pixel" in peak:
                row["Reference_Pixel"] = peak.get("pixel")
                row["Tolerance_Pixel"] = peak.get("tolerance_pixel", 5.0)
            rows.append(row)
    return rows
