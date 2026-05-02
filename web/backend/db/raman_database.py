"""Raman reference peak database for common substrates and thin-film materials.

Each entry has:
  pos      : Raman shift (cm⁻¹), literature value
  label    : symmetry / mode label shown on the figure
  strength : 0–100, relative intensity used to scale stick height
  note     : brief description shown in hover text
"""

RAMAN_REFERENCES: dict[str, list[dict]] = {
    # ── Si substrate ───────────────────────────────────────────────────────────
    "Si (基板)": [
        {
            "pos": 302.0,
            "label": "2TA",
            "mode": "2TA",
            "symmetry": "2TA",
            "strength": 25,
            "tolerance_cm": 8.0,
            "fwhm_min": 8.0,
            "fwhm_max": 28.0,
            "enabled_by_default": False,
            "candidate_only": True,
            "substrate": True,
            "disabled_until_user_selects": True,
            "reference_source": "Si second-order Raman literature",
            "note": "Si second-order transverse acoustic; weak and often sample-dependent.",
        },
        {
            "pos": 520.7,
            "label": "1TO",
            "mode": "TO",
            "symmetry": "F2g-derived",
            "strength": 100,
            "tolerance_cm": 3.0,
            "fwhm_min": 3.0,
            "fwhm_max": 12.0,
            "enabled_by_default": True,
            "candidate_only": False,
            "substrate": True,
            "reference_source": "Anastassakis et al.; standard Si Raman calibration peak",
            "note": "Si first-order TO phonon used for internal constant-offset Raman shift calibration.",
        },
        {
            "pos": 960.0,
            "label": "2TO",
            "mode": "2TO",
            "symmetry": "2TO",
            "strength": 40,
            "tolerance_cm": 14.0,
            "fwhm_min": 18.0,
            "fwhm_max": 80.0,
            "enabled_by_default": False,
            "candidate_only": True,
            "substrate": True,
            "disabled_until_user_selects": True,
            "reference_source": "Si second-order Raman literature",
            "note": "Si second-order overtone; broad and not suitable as a hard-required fit peak.",
        },
    ],

    # ── β-Ga₂O₃ (monoclinic C₂ₕ) ─────────────────────────────────────────────
    # Refs: Kranert et al. PRL 2016; Dohy et al. J. Solid State Chem. 1982
    "β-Ga₂O₃": [
        {"pos": 111.0, "label": "Bg", "mode": "Bg low", "symmetry": "Bg", "strength": 10, "tolerance_cm": 6.0, "fwhm_min": 3.0, "fwhm_max": 20.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "β-Ga₂O₃ low-frequency Raman literature", "note": "Weak low-frequency β-Ga₂O₃ candidate; use probing diagnostics rather than hard assignment."},
        {"pos": 115.0, "label": "Ag", "mode": "Ag(1)", "symmetry": "Ag", "strength": 12, "tolerance_cm": 6.0, "fwhm_min": 3.0, "fwhm_max": 20.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "Kranert et al. PRL 2016", "note": "Very low-frequency β-Ga₂O₃ lattice mode; often weak in thin films."},
        {"pos": 116.0, "label": "Ag", "mode": "Ag(1)", "symmetry": "Ag", "strength": 14, "tolerance_cm": 6.0, "fwhm_min": 3.0, "fwhm_max": 20.0, "enabled_by_default": False, "candidate_only": True, "disabled_until_user_selects": True, "reference_source": "Kranert et al. PRL 2016", "note": "Very low-frequency β-Ga₂O₃ lattice mode; often weak in thin films."},
        {"pos": 144.0, "label": "Ag", "mode": "Ag(2)", "symmetry": "Ag", "strength": 30, "tolerance_cm": 6.0, "fwhm_min": 3.0, "fwhm_max": 20.0, "enabled_by_default": True, "candidate_only": False, "reference_source": "Kranert et al. PRL 2016", "note": "β-Ga₂O₃ Ag lattice mode."},
        {"pos": 145.0, "label": "Ag", "mode": "Ag(2) probe", "symmetry": "Ag", "strength": 28, "tolerance_cm": 6.0, "fwhm_min": 3.0, "fwhm_max": 20.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "β-Ga₂O₃ Raman reference cluster near 145 cm⁻¹", "note": "β-Ga₂O₃ reference-probing companion near 145 cm⁻¹."},
        {"pos": 169.0, "label": "Bg", "mode": "Bg(2)", "symmetry": "Bg", "strength": 20, "tolerance_cm": 6.0, "fwhm_min": 3.0, "fwhm_max": 20.0, "enabled_by_default": True, "candidate_only": False, "reference_source": "Kranert et al. PRL 2016", "note": "β-Ga₂O₃ low-frequency Bg mode."},
        {"pos": 170.0, "label": "Bg", "mode": "Bg(2) probe", "symmetry": "Bg", "strength": 18, "tolerance_cm": 6.0, "fwhm_min": 3.0, "fwhm_max": 20.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "β-Ga₂O₃ Raman reference cluster near 170 cm⁻¹", "note": "β-Ga₂O₃ reference-probing companion near 170 cm⁻¹."},
        {"pos": 199.0, "label": "Ag", "mode": "Ag(3)", "symmetry": "Ag", "strength": 40, "tolerance_cm": 7.0, "fwhm_min": 3.0, "fwhm_max": 22.0, "enabled_by_default": True, "candidate_only": False, "reference_source": "Kranert et al. PRL 2016", "note": "β-Ga₂O₃ Ag mode in the low-frequency lattice region."},
        {"pos": 200.0, "label": "Ag", "mode": "Ag(3) probe", "symmetry": "Ag", "strength": 38, "tolerance_cm": 7.0, "fwhm_min": 3.0, "fwhm_max": 22.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "β-Ga₂O₃ Raman reference cluster near 200 cm⁻¹", "note": "β-Ga₂O₃ reference-probing companion near 200 cm⁻¹."},
        {"pos": 320.0, "label": "Ag", "mode": "Ag/Bg near 320", "symmetry": "Ag/Bg", "strength": 50, "tolerance_cm": 8.0, "fwhm_min": 4.0, "fwhm_max": 25.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "Kranert et al. PRL 2016", "note": "Ambiguous region: may overlap Si-related signal or objective artifact without a blank/substrate reference."},
        {"pos": 346.0, "label": "Bg", "mode": "Bg(4)", "symmetry": "Bg", "strength": 45, "tolerance_cm": 8.0, "fwhm_min": 4.0, "fwhm_max": 25.0, "enabled_by_default": True, "candidate_only": False, "reference_source": "Kranert et al. PRL 2016", "note": "β-Ga₂O₃ mid-frequency mode."},
        {"pos": 347.0, "label": "Bg", "mode": "Bg(4) probe", "symmetry": "Bg", "strength": 42, "tolerance_cm": 8.0, "fwhm_min": 4.0, "fwhm_max": 25.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "β-Ga₂O₃ Raman reference cluster near 347 cm⁻¹", "note": "β-Ga₂O₃ reference-probing companion near 347 cm⁻¹."},
        {"pos": 353.0, "label": "Bg/Ag", "mode": "mode near 353", "symmetry": "Bg/Ag", "strength": 32, "tolerance_cm": 8.0, "fwhm_min": 4.0, "fwhm_max": 25.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "β-Ga₂O₃ Raman shoulder near 353 cm⁻¹", "note": "Possible β-Ga₂O₃ shoulder/candidate near 353 cm⁻¹."},
        {"pos": 416.0, "label": "Ag", "mode": "Ag(6)", "symmetry": "Ag", "strength": 75, "tolerance_cm": 8.0, "fwhm_min": 4.0, "fwhm_max": 25.0, "enabled_by_default": True, "candidate_only": False, "reference_source": "Kranert et al. PRL 2016", "note": "Strong β-Ga₂O₃ crystalline mode."},
        {"pos": 475.0, "label": "Bg", "mode": "Bg(5)", "symmetry": "Bg", "strength": 80, "tolerance_cm": 8.0, "fwhm_min": 4.0, "fwhm_max": 25.0, "enabled_by_default": True, "candidate_only": False, "reference_source": "Kranert et al. PRL 2016", "note": "Strong β-Ga₂O₃ mode near the top of the sub-520 cm⁻¹ region."},
        {"pos": 562.0, "label": "candidate", "mode": "candidate near 562", "symmetry": "candidate", "strength": 24, "tolerance_cm": 10.0, "fwhm_min": 4.0, "fwhm_max": 25.0, "enabled_by_default": False, "candidate_only": True, "disabled_until_user_selects": True, "reference_source": "User-requested candidate around Si/NiO overlap region", "note": "Possible β-Ga₂O₃-related candidate in the Si/NiO overlap zone; never force-fit by default."},
        {"pos": 630.0, "label": "Ag", "mode": "Ag(8)", "symmetry": "Ag", "strength": 50, "tolerance_cm": 10.0, "fwhm_min": 4.0, "fwhm_max": 25.0, "enabled_by_default": True, "candidate_only": False, "reference_source": "Kranert et al. PRL 2016", "note": "β-Ga₂O₃ high-frequency mode."},
        {"pos": 651.0, "label": "Bg", "mode": "Bg(10)", "symmetry": "Bg", "strength": 45, "tolerance_cm": 10.0, "fwhm_min": 4.0, "fwhm_max": 25.0, "enabled_by_default": True, "candidate_only": False, "reference_source": "Kranert et al. PRL 2016", "note": "β-Ga₂O₃ high-frequency mode."},
        {"pos": 652.0, "label": "Bg", "mode": "Bg(10) probe", "symmetry": "Bg", "strength": 42, "tolerance_cm": 10.0, "fwhm_min": 4.0, "fwhm_max": 25.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "β-Ga₂O₃ Raman reference cluster near 652 cm⁻¹", "note": "β-Ga₂O₃ reference-probing companion near 652 cm⁻¹."},
        {"pos": 658.0, "label": "Bg/Ag", "mode": "mode near 658", "symmetry": "Bg/Ag", "strength": 34, "tolerance_cm": 10.0, "fwhm_min": 4.0, "fwhm_max": 25.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "β-Ga₂O₃ high-frequency shoulder near 658 cm⁻¹", "note": "Possible β-Ga₂O₃ high-frequency shoulder/candidate near 658 cm⁻¹."},
        {"pos": 767.0, "label": "Ag", "mode": "Ag(11)", "symmetry": "Ag", "strength": 25, "tolerance_cm": 12.0, "fwhm_min": 4.0, "fwhm_max": 28.0, "enabled_by_default": False, "candidate_only": True, "disabled_until_user_selects": True, "reference_source": "Kranert et al. PRL 2016", "note": "Weak β-Ga₂O₃ high-frequency mode; keep as candidate-only unless data quality is good."},
    ],

    # ── NiO (rock-salt, cubic Fm3̄m) ───────────────────────────────────────────
    # First-order Raman-inactive; observed peaks are disorder/defect or magnon activated
    # Refs: Dietz et al. PRB 1971; Mironova-Ulmane et al. J. Phys. 2007
    "NiO": [
        {"pos": 375.0, "label": "TO", "mode": "TO candidate", "symmetry": "disorder-activated", "strength": 14, "tolerance_cm": 18.0, "fwhm_min": 15.0, "fwhm_max": 100.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "NiO disorder-activated Raman references", "note": "Weak NiO TO-side candidate; broad and disorder-sensitive."},
        {"pos": 395.0, "label": "TO", "mode": "TO", "symmetry": "disorder-activated", "strength": 18, "tolerance_cm": 16.0, "fwhm_min": 15.0, "fwhm_max": 65.0, "enabled_by_default": False, "candidate_only": True, "disabled_until_user_selects": True, "reference_source": "Dietz et al. PRB 1971", "note": "NiO TO-like disorder band; weak and broad."},
        {"pos": 397.0, "label": "TO", "mode": "TO probe", "symmetry": "disorder-activated", "strength": 16, "tolerance_cm": 16.0, "fwhm_min": 15.0, "fwhm_max": 100.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "NiO disorder-activated Raman references", "note": "NiO reference-probing companion near 397 cm⁻¹."},
        {"pos": 441.0, "label": "1M", "mode": "1M shoulder", "symmetry": "magnon", "strength": 28, "tolerance_cm": 18.0, "fwhm_min": 15.0, "fwhm_max": 100.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "NiO magnon/disorder Raman references", "note": "Possible NiO broad one-magnon shoulder near 441 cm⁻¹."},
        {"pos": 457.0, "label": "1M", "mode": "1M", "symmetry": "magnon", "strength": 50, "tolerance_cm": 18.0, "fwhm_min": 15.0, "fwhm_max": 80.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "Mironova-Ulmane et al. 2007", "note": "NiO one-magnon band; broad and disorder-sensitive."},
        {"pos": 511.0, "label": "LO/defect", "mode": "defect shoulder", "symmetry": "disorder-activated", "strength": 18, "tolerance_cm": 18.0, "fwhm_min": 15.0, "fwhm_max": 100.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "NiO disorder-activated Raman references", "note": "NiO candidate near Si tail; treat as overlapped unless independently supported."},
        {"pos": 550.0, "label": "LO", "mode": "LO probe", "symmetry": "disorder-activated", "strength": 22, "tolerance_cm": 20.0, "fwhm_min": 15.0, "fwhm_max": 100.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "NiO LO disorder-activated references", "note": "NiO LO candidate overlapping Si tail / Ga₂O₃ high-frequency region."},
        {"pos": 570.0, "label": "1LO", "mode": "LO", "symmetry": "disorder-activated", "strength": 20, "tolerance_cm": 18.0, "fwhm_min": 15.0, "fwhm_max": 80.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "Dietz et al. PRB 1971", "note": "NiO LO candidate in the Si overlap window; keep as optional candidate only."},
        {"pos": 714.0, "label": "2TO", "mode": "2TO probe", "symmetry": "two-phonon", "strength": 36, "tolerance_cm": 20.0, "fwhm_min": 18.0, "fwhm_max": 100.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "NiO two-phonon Raman references", "note": "NiO broad two-phonon candidate near 714 cm⁻¹."},
        {"pos": 730.0, "label": "2TO", "mode": "2TO", "symmetry": "two-phonon", "strength": 45, "tolerance_cm": 20.0, "fwhm_min": 18.0, "fwhm_max": 85.0, "enabled_by_default": True, "candidate_only": False, "reference_source": "Mironova-Ulmane et al. 2007", "note": "NiO second-order broad band."},
        {"pos": 785.0, "label": "2TO/defect", "mode": "broad defect", "symmetry": "two-phonon / defect", "strength": 24, "tolerance_cm": 22.0, "fwhm_min": 18.0, "fwhm_max": 100.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "NiO disorder-sensitive Raman references", "note": "NiO broad candidate near 785 cm⁻¹."},
        {"pos": 850.0, "label": "TO+LO", "mode": "TO+LO probe", "symmetry": "combination", "strength": 24, "tolerance_cm": 24.0, "fwhm_min": 18.0, "fwhm_max": 100.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "NiO combination-band Raman references", "note": "NiO combination candidate near 850 cm⁻¹."},
        {"pos": 870.0, "label": "TO+LO", "mode": "TO+LO", "symmetry": "combination", "strength": 28, "tolerance_cm": 24.0, "fwhm_min": 18.0, "fwhm_max": 90.0, "enabled_by_default": False, "candidate_only": True, "disabled_until_user_selects": True, "reference_source": "Mironova-Ulmane et al. 2007", "note": "NiO combination band; broad and disorder-sensitive."},
        {"pos": 943.0, "label": "2LO/2M", "mode": "broad overtone", "symmetry": "overtone", "strength": 22, "tolerance_cm": 26.0, "fwhm_min": 20.0, "fwhm_max": 100.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "NiO broad overtone Raman references", "note": "NiO broad high-frequency candidate near 943 cm⁻¹."},
        {"pos": 1090.0, "label": "2M/2LO", "mode": "2M/2LO", "symmetry": "two-magnon / overtone", "strength": 65, "tolerance_cm": 26.0, "fwhm_min": 20.0, "fwhm_max": 95.0, "enabled_by_default": True, "candidate_only": False, "reference_source": "Mironova-Ulmane et al. 2007", "note": "NiO broad high-frequency signature band."},
        {"pos": 1110.0, "label": "2M/2LO", "mode": "2M/2LO probe", "symmetry": "two-magnon / overtone", "strength": 58, "tolerance_cm": 28.0, "fwhm_min": 20.0, "fwhm_max": 100.0, "enabled_by_default": True, "candidate_only": True, "reference_source": "NiO high-frequency Raman references", "note": "NiO high-frequency reference-probing companion near 1110 cm⁻¹."},
    ],

    "Objective artifact": [
        {"pos": 305.0, "label": "artifact", "mode": "objective artifact", "symmetry": "artifact", "strength": 15, "tolerance_cm": 18.0, "fwhm_min": 12.0, "fwhm_max": 80.0, "enabled_by_default": False, "candidate_only": True, "artifact": True, "disabled_until_user_selects": True, "reference_source": "Instrument-specific empirical artifact placeholder", "note": "Objective / optical artifact placeholder around the ambiguous 300–330 cm⁻¹ region."},
        {"pos": 325.0, "label": "artifact", "mode": "objective artifact", "symmetry": "artifact", "strength": 22, "tolerance_cm": 18.0, "fwhm_min": 12.0, "fwhm_max": 80.0, "enabled_by_default": False, "candidate_only": True, "artifact": True, "disabled_until_user_selects": True, "reference_source": "Instrument-specific empirical artifact placeholder", "note": "Objective / optical artifact placeholder near β-Ga₂O₃ 320 cm⁻¹."},
    ],

    # ── Sapphire α-Al₂O₃ c-plane (0001) ──────────────────────────────────────
    # 2A₁g + 5Eg Raman-active modes (D₃d symmetry)
    # Refs: Porto & Krishnan J. Chem. Phys. 1967; Balkanski et al. PRB 1987
    # Note: peak visibility depends on substrate cut and film thickness
    "Sapphire α-Al₂O₃ (c-plane)": [
        {"pos": 378, "label": "Eg",  "strength": 45,  "note": "c-Al₂O₃ Eg mode"},
        {"pos": 418, "label": "A₁g", "strength": 85,  "note": "c-Al₂O₃ A₁g mode (strong)"},
        {"pos": 432, "label": "Eg",  "strength": 20,  "note": "c-Al₂O₃ Eg mode (weak shoulder of 418)"},
        {"pos": 451, "label": "Eg",  "strength": 55,  "note": "c-Al₂O₃ Eg mode"},
        {"pos": 578, "label": "Eg",  "strength": 40,  "note": "c-Al₂O₃ Eg mode"},
        {"pos": 645, "label": "A₁g", "strength": 90,  "note": "c-Al₂O₃ A₁g mode (strong)"},
        {"pos": 750, "label": "Eg",  "strength": 80,  "note": "c-Al₂O₃ Eg mode (strong)"},
    ],

    # ── Sapphire α-Al₂O₃ a-plane (11-20) ─────────────────────────────────────
    # Same 7 modes as c-plane; relative intensities differ due to backscattering
    # geometry along [11-20]: 645 A₁g and 750 Eg are typically strongest.
    # Refs: Porto & Krishnan J. Chem. Phys. 1967; Shim & Duffy PRB 2000
    "Sapphire α-Al₂O₃ (a-plane)": [
        {"pos": 378, "label": "Eg",  "strength": 55,  "note": "a-Al₂O₃ Eg mode"},
        {"pos": 418, "label": "A₁g", "strength": 70,  "note": "a-Al₂O₃ A₁g mode"},
        {"pos": 432, "label": "Eg",  "strength": 25,  "note": "a-Al₂O₃ Eg mode (shoulder of 418)"},
        {"pos": 451, "label": "Eg",  "strength": 65,  "note": "a-Al₂O₃ Eg mode"},
        {"pos": 578, "label": "Eg",  "strength": 50,  "note": "a-Al₂O₃ Eg mode"},
        {"pos": 645, "label": "A₁g", "strength": 100, "note": "a-Al₂O₃ A₁g mode (strongest in a-plane geometry)"},
        {"pos": 750, "label": "Eg",  "strength": 90,  "note": "a-Al₂O₃ Eg mode (very strong in a-plane)"},
    ],

    # ── Sapphire α-Al₂O₃ m-plane (10-10) ─────────────────────────────────────
    # Non-polar m-cut; sometimes informally referred to as "b-plane" in some labs.
    # All 7 modes remain Raman-active; intensities shift vs. c/a-plane geometries.
    # Refs: Porto & Krishnan J. Chem. Phys. 1967; Mayer et al. J. Appl. Phys. 2003
    "Sapphire α-Al₂O₃ (m-plane)": [
        {"pos": 378, "label": "Eg",  "strength": 45,  "note": "m-Al₂O₃ Eg mode"},
        {"pos": 418, "label": "A₁g", "strength": 65,  "note": "m-Al₂O₃ A₁g mode"},
        {"pos": 432, "label": "Eg",  "strength": 20,  "note": "m-Al₂O₃ Eg mode (shoulder)"},
        {"pos": 451, "label": "Eg",  "strength": 55,  "note": "m-Al₂O₃ Eg mode"},
        {"pos": 578, "label": "Eg",  "strength": 45,  "note": "m-Al₂O₃ Eg mode"},
        {"pos": 645, "label": "A₁g", "strength": 85,  "note": "m-Al₂O₃ A₁g mode (strong)"},
        {"pos": 750, "label": "Eg",  "strength": 80,  "note": "m-Al₂O₃ Eg mode (strong)"},
    ],

    # ── ZnO (wurtzite, C₆ᵥ) ──────────────────────────────────────────────────
    # Refs: Damen et al. PR 1966; Calleja & Cardona PRB 1977
    "ZnO": [
        {"pos": 101,  "label": "E₂(low)",  "strength": 35, "note": "ZnO E₂(low) rigid-cage mode"},
        {"pos": 331,  "label": "E₂H-E₂L", "strength": 15, "note": "ZnO multi-phonon difference mode"},
        {"pos": 380,  "label": "A₁(TO)",   "strength": 35, "note": "ZnO A₁ transverse optical"},
        {"pos": 438,  "label": "E₂(high)", "strength": 100,"note": "ZnO E₂(high) main peak"},
        {"pos": 584,  "label": "E₁(LO)",   "strength": 30, "note": "ZnO E₁ longitudinal optical"},
    ],

    # ── TiO₂ anatase (D₄ₕ) ───────────────────────────────────────────────────
    # Refs: Ohsaka et al. J. Raman Spectrosc. 1978; Zhang et al. PRB 2000
    "TiO₂ (anatase)": [
        {"pos": 144,  "label": "Eg",       "strength": 100,"note": "anatase Eg strongest mode"},
        {"pos": 197,  "label": "Eg",       "strength": 15, "note": "anatase Eg weak mode"},
        {"pos": 399,  "label": "B₁g",      "strength": 45, "note": "anatase B₁g mode"},
        {"pos": 515,  "label": "A₁g+B₁g", "strength": 40, "note": "anatase A₁g/B₁g overlap"},
        {"pos": 639,  "label": "Eg",       "strength": 55, "note": "anatase Eg mode"},
    ],

    # ── TiO₂ rutile (D₄ₕ) ────────────────────────────────────────────────────
    # Refs: Porto et al. PR 1967; Ohsaka et al. J. Raman Spectrosc. 1978
    "TiO₂ (rutile)": [
        {"pos": 143,  "label": "B₁g",  "strength": 20, "note": "rutile B₁g silent-like mode"},
        {"pos": 235,  "label": "2ph",  "strength": 10, "note": "rutile two-phonon combination"},
        {"pos": 447,  "label": "Eg",   "strength": 100,"note": "rutile Eg strongest mode"},
        {"pos": 612,  "label": "A₁g",  "strength": 65, "note": "rutile A₁g mode"},
    ],

    # ── SnO₂ (rutile, D₄ₕ) ───────────────────────────────────────────────────
    # Refs: Diéguez et al. J. Appl. Phys. 2001; Abello et al. J. Solid State Chem. 1998
    "SnO₂": [
        {"pos": 473,  "label": "Eg",  "strength": 50, "note": "SnO₂ Eg mode"},
        {"pos": 634,  "label": "A₁g", "strength": 100,"note": "SnO₂ A₁g strongest mode"},
        {"pos": 774,  "label": "B₂g", "strength": 25, "note": "SnO₂ B₂g mode"},
    ],

    # ── GaN (wurtzite, C₆ᵥ) ──────────────────────────────────────────────────
    # Refs: Azuhata et al. J. Phys.: Condens. Matter 1995; Manchon et al. SSC 1970
    "GaN": [
        {"pos": 533,  "label": "A₁(TO)", "strength": 55, "note": "GaN A₁ transverse optical"},
        {"pos": 559,  "label": "E₁(TO)", "strength": 45, "note": "GaN E₁ transverse optical"},
        {"pos": 569,  "label": "E₂(H)",  "strength": 100,"note": "GaN E₂(high) main peak"},
        {"pos": 735,  "label": "A₁(LO)", "strength": 35, "note": "GaN A₁ longitudinal optical"},
    ],

    # ── AlN (wurtzite, C₆ᵥ) ──────────────────────────────────────────────────
    # Refs: McNeil et al. J. Appl. Phys. 1993; Bungaro et al. PRB 2000
    "AlN": [
        {"pos": 250,  "label": "E₂(low)", "strength": 15, "note": "AlN E₂(low) mode"},
        {"pos": 614,  "label": "A₁(TO)",  "strength": 45, "note": "AlN A₁ transverse optical"},
        {"pos": 657,  "label": "E₁(TO)",  "strength": 40, "note": "AlN E₁ transverse optical"},
        {"pos": 669,  "label": "E₂(H)",   "strength": 100,"note": "AlN E₂(high) main peak"},
        {"pos": 890,  "label": "A₁(LO)",  "strength": 25, "note": "AlN A₁ longitudinal optical"},
    ],

    # ── MoS₂ (2H, bulk/few-layer) ────────────────────────────────────────────
    # Refs: Chakraborty et al. PRB 2012; Lee et al. ACS Nano 2010
    # Note: monolayer shifts E₂g down ~2 cm⁻¹, A₁g up ~2 cm⁻¹ vs bulk
    "MoS₂": [
        {"pos": 383,  "label": "E²₂g", "strength": 80, "note": "MoS₂ in-plane E₂g; redshifts for monolayer"},
        {"pos": 408,  "label": "A₁g",  "strength": 100,"note": "MoS₂ out-of-plane A₁g; blueshifts for monolayer"},
    ],

    # ── Graphene / Graphite ───────────────────────────────────────────────────
    # Refs: Ferrari & Robertson PRB 2001; Tuinstra & Koenig J. Chem. Phys. 1970
    # Note: D intensity ∝ defect density; 2D single peak = monolayer graphene
    "Graphene / Graphite": [
        {"pos": 1350, "label": "D",  "strength": 30, "note": "Defect-activated D band (zero for perfect crystal)"},
        {"pos": 1580, "label": "G",  "strength": 100,"note": "G band (E₂g, always present in sp² carbon)"},
        {"pos": 2700, "label": "2D", "strength": 80, "note": "2D band; single sharp peak for monolayer graphene"},
    ],

    # ── α-Fe₂O₃ (hematite, D₃d) ─────────────────────────────────────────────
    # Refs: de Faria et al. J. Raman Spectrosc. 1997; Shim & Duffy Am. Mineral. 2002
    "α-Fe₂O₃ (hematite)": [
        {"pos": 226,  "label": "A₁g", "strength": 50, "note": "hematite A₁g mode"},
        {"pos": 245,  "label": "Eg",  "strength": 45, "note": "hematite Eg mode"},
        {"pos": 292,  "label": "Eg",  "strength": 100,"note": "hematite Eg strongest mode"},
        {"pos": 299,  "label": "Eg",  "strength": 60, "note": "hematite Eg shoulder"},
        {"pos": 412,  "label": "Eg",  "strength": 40, "note": "hematite Eg mode"},
        {"pos": 498,  "label": "A₁g", "strength": 35, "note": "hematite A₁g mode"},
        {"pos": 613,  "label": "Eg",  "strength": 25, "note": "hematite Eg mode (weak)"},
    ],

    # ── α-Ga₂O₃ (corundum, R3̄c) ─────────────────────────────────────────────
    # Refs: Playford et al. Chem. Eur. J. 2013; Cuscó et al. PRB 2020
    "α-Ga₂O₃": [
        {"pos": 166,  "label": "Eg",  "strength": 30, "note": "α-Ga₂O₃ Eg mode"},
        {"pos": 302,  "label": "A₁g", "strength": 55, "note": "α-Ga₂O₃ A₁g mode"},
        {"pos": 423,  "label": "Eg",  "strength": 70, "note": "α-Ga₂O₃ Eg mode (strong)"},
        {"pos": 498,  "label": "A₁g", "strength": 65, "note": "α-Ga₂O₃ A₁g mode (strong)"},
        {"pos": 596,  "label": "Eg",  "strength": 40, "note": "α-Ga₂O₃ Eg mode"},
        {"pos": 881,  "label": "A₁g", "strength": 25, "note": "α-Ga₂O₃ A₁g mode (weak)"},
    ],

    # ── Ta₂O₅ (β-phase, orthorhombic / amorphous thin film) ──────────────────
    # Peaks broad in amorphous films; crystalline β-Ta₂O₅ shows sharper features.
    # Refs: Liegeard et al. Thin Solid Films 2003; Androulidaki et al. phys. stat. sol. 2006
    "Ta₂O₅": [
        {"pos": 100,  "label": "δ",   "strength": 25,  "note": "Ta-O bending (broad, amorphous films)"},
        {"pos": 250,  "label": "mix", "strength": 45,  "note": "Ta₂O₅ mixed mode (broad)"},
        {"pos": 480,  "label": "ν",   "strength": 55,  "note": "Ta-O-Ta stretching"},
        {"pos": 660,  "label": "ν",   "strength": 100, "note": "Ta-O stretching (main peak)"},
        {"pos": 850,  "label": "ν_as","strength": 35,  "note": "Ta-O asymmetric stretching"},
    ],

    # ── CeO₂ (fluorite, Fm3̄m) ────────────────────────────────────────────────
    # Only one first-order mode (F₂g) in perfect crystal; defect peaks appear in
    # nanoparticles and oxygen-vacancy-rich films.
    # Refs: McBride et al. J. Appl. Phys. 1994; Weber et al. PRB 1993
    "CeO₂": [
        {"pos": 260,  "label": "2TA", "strength": 15,  "note": "CeO₂ second-order TA (very weak)"},
        {"pos": 465,  "label": "F₂g", "strength": 100, "note": "CeO₂ F₂g O-Ce-O bending (main peak)"},
        {"pos": 600,  "label": "D",   "strength": 35,  "note": "CeO₂ defect/oxygen-vacancy band"},
        {"pos": 1180, "label": "2LO", "strength": 10,  "note": "CeO₂ 2LO overtone (very weak)"},
    ],

    # ── SrTiO₃ (cubic perovskite, Pm3̄m) ──────────────────────────────────────
    # Nominally Raman-inactive (centrosymmetric); peaks appear via disorder,
    # strain, or surface effects in thin films and ceramics.
    # Refs: Nilsen & Skinner J. Chem. Phys. 1968; Scott PRB 1971
    "SrTiO₃": [
        {"pos": 175,  "label": "TO1", "strength": 20,  "note": "SrTiO₃ TO1 (disorder-activated, weak)"},
        {"pos": 250,  "label": "2TA", "strength": 45,  "note": "SrTiO₃ broad 2TA band"},
        {"pos": 470,  "label": "TO3", "strength": 40,  "note": "SrTiO₃ TO3 (broad in films)"},
        {"pos": 540,  "label": "LO3", "strength": 55,  "note": "SrTiO₃ LO3 (most prominent in thin films)"},
        {"pos": 795,  "label": "LO4", "strength": 30,  "note": "SrTiO₃ LO4 (weak)"},
    ],

    # ── Mo₂Ti₂C₃ MXene (double-ordered MXene, hexagonal) ────────────────────
    # Synthesised from Mo₂Ti₂AlC₃ MAX phase by selective Al etching.
    # All peaks are broad (FWHM 20–60 cm⁻¹); surface terminations (O/OH/F) shift
    # the low-frequency A₁g modes.
    # Refs: Halim et al. Electrochim. Acta 2018; Anasori et al. Nat. Rev. Mater. 2017
    "Mo₂Ti₂C₃ (MXene)": [
        {"pos": 150,  "label": "A₁g", "strength": 55,  "note": "Mo₂Ti₂C₃ out-of-plane A₁g (surface-group sensitive)"},
        {"pos": 200,  "label": "A₁g", "strength": 50,  "note": "Mo₂Ti₂C₃ A₁g mode"},
        {"pos": 258,  "label": "Eg",  "strength": 35,  "note": "Mo₂Ti₂C₃ in-plane Eg mode"},
        {"pos": 460,  "label": "A₁g", "strength": 40,  "note": "Mo₂Ti₂C₃ A₁g (broad feature)"},
        {"pos": 600,  "label": "A₁g", "strength": 25,  "note": "Mo₂Ti₂C₃ A₁g carbon-related mode"},
    ],
}


PHASE_LIBRARY_DEFAULTS: dict[str, dict] = {
    "Si (基板)": {
        "phase_group": "Si group",
        "species": "Si lattice",
        "tolerance_cm": 3.0,
        "fwhm_min": 3.0,
        "fwhm_max": 12.0,
        "profile": "split_pseudo_voigt",
        "peak_type": "substrate phonon",
        "oxidation_state": "N/A",
        "oxidation_state_inference": "Not applicable",
        "reference": "Si Raman first-/second-order phonon references",
    },
    "β-Ga₂O₃": {
        "phase_group": "β-Ga₂O₃ group",
        "species": "Ga-O lattice",
        "tolerance_cm": 10.0,
        "fwhm_min": 3.0,
        "fwhm_max": 25.0,
        "profile": "pseudo_voigt",
        "peak_type": "phonon",
        "oxidation_state": "Ga³⁺",
        "oxidation_state_inference": "Inferred",
        "reference": "Kranert et al. PRL 2016; Dohy et al. J. Solid State Chem. 1982",
    },
    "α-Ga₂O₃": {
        "phase_group": "α-Ga₂O₃ group",
        "species": "Ga-O lattice",
        "tolerance_cm": 10.0,
        "fwhm_min": 2.0,
        "fwhm_max": 35.0,
        "profile": "pseudo_voigt",
        "peak_type": "phonon",
        "oxidation_state": "Ga³⁺",
        "oxidation_state_inference": "Inferred",
        "reference": "Playford et al. Chem. Eur. J. 2013; Cuscó et al. PRB 2020",
    },
    "NiO": {
        "phase_group": "NiO group",
        "species": "Ni-O / magnon mode",
        "tolerance_cm": 20.0,
        "fwhm_min": 15.0,
        "fwhm_max": 80.0,
        "profile": "pseudo_voigt",
        "peak_type": "broad disorder/magnon band",
        "oxidation_state": "Ni²⁺",
        "oxidation_state_inference": "Inferred",
        "reference": "Dietz et al. PRB 1971; Mironova-Ulmane et al. J. Phys. 2007",
    },
}


def _generic_phase_defaults(material: str) -> dict:
    oxidation = "N/A"
    inference = "Not applicable"
    species = "lattice vibration"
    if "Ga" in material:
        oxidation = "Ga³⁺"
        inference = "Inferred"
        species = "Ga-O lattice"
    elif "Ni" in material:
        oxidation = "Ni²⁺"
        inference = "Inferred"
        species = "Ni-O lattice"
    elif "Ti" in material:
        oxidation = "Ti⁴⁺"
        inference = "Inferred"
        species = "Ti-O lattice"
    elif "Al" in material:
        oxidation = "Al³⁺"
        inference = "Inferred"
        species = "Al-O lattice"
    elif "Zn" in material:
        oxidation = "Zn²⁺"
        inference = "Inferred"
        species = "Zn-O lattice"
    elif "Sn" in material:
        oxidation = "Sn⁴⁺"
        inference = "Inferred"
        species = "Sn-O lattice"
    elif "Ce" in material:
        oxidation = "Ce⁴⁺/Ce³⁺"
        inference = "Inferred"
        species = "Ce-O lattice"

    return {
        "phase_group": f"{material} group",
        "species": species,
        "tolerance_cm": 10.0,
        "fwhm_min": 2.0,
        "fwhm_max": 60.0,
        "profile": "pseudo_voigt",
        "allowed_profiles": ["gaussian", "lorentzian", "voigt", "pseudo_voigt", "split_pseudo_voigt"],
        "peak_type": "phonon",
        "anchor_peak": False,
        "can_be_quantified": True,
        "enabled_by_default": True,
        "candidate_only": False,
        "artifact": False,
        "substrate": False,
        "disabled_until_user_selects": False,
        "oxidation_state": oxidation,
        "oxidation_state_inference": inference,
        "reference": "Raman reference peak library",
    }


def enriched_raman_peak(material: str, row: dict) -> dict:
    defaults = {**_generic_phase_defaults(material), **PHASE_LIBRARY_DEFAULTS.get(material, {})}
    peak_type = row.get("peak_type")
    note = str(row.get("note", ""))
    if not peak_type:
        peak_type = "broad band" if "broad" in note.lower() else defaults["peak_type"]
    fwhm_min = float(row.get("fwhm_min", defaults["fwhm_min"]))
    fwhm_max = float(row.get("fwhm_max", defaults["fwhm_max"]))
    if "broad" in note.lower() and fwhm_max < 90:
        fwhm_max = 120.0
    anchor_peak = bool(row.get("anchor_peak", False))
    if material == "Si (基板)" and abs(float(row["pos"]) - 520.7) <= 2.0:
        anchor_peak = True
    if material == "β-Ga₂O₃" and any(abs(float(row["pos"]) - value) <= 2.0 for value in (416.0, 651.0)):
        anchor_peak = True
    allowed_profiles = row.get("allowed_profiles", defaults.get("allowed_profiles", ["gaussian", "lorentzian", "voigt", "pseudo_voigt", "split_pseudo_voigt"]))
    return {
        "phase": material,
        "material": material,
        "phase_group": row.get("phase_group", defaults["phase_group"]),
        "mode": row.get("mode", row.get("label", "")),
        "label": row.get("label", ""),
        "species": row.get("species", defaults["species"]),
        "theoretical_center": float(row.get("theoretical_center", row["pos"])),
        "pos": float(row["pos"]),
        "tolerance_cm": float(row.get("tolerance_cm", defaults["tolerance_cm"])),
        "fwhm_min": fwhm_min,
        "fwhm_max": fwhm_max,
        "profile": row.get("profile", defaults["profile"]),
        "allowed_profiles": allowed_profiles,
        "peak_type": peak_type,
        "anchor_peak": anchor_peak,
        "can_be_quantified": bool(row.get("can_be_quantified", defaults.get("can_be_quantified", True))),
        "enabled_by_default": bool(row.get("enabled_by_default", defaults.get("enabled_by_default", True))),
        "candidate_only": bool(row.get("candidate_only", defaults.get("candidate_only", False))),
        "artifact": bool(row.get("artifact", defaults.get("artifact", False))),
        "substrate": bool(row.get("substrate", defaults.get("substrate", material == "Si (基板)"))),
        "disabled_until_user_selects": bool(row.get("disabled_until_user_selects", defaults.get("disabled_until_user_selects", False))),
        "related_technique": row.get("related_technique", "Raman"),
        "reference": row.get("reference", defaults["reference"]),
        "reference_source": row.get("reference_source", row.get("reference", defaults["reference"])),
        "symmetry": row.get("symmetry", row.get("label", "")),
        "oxidation_state": row.get("oxidation_state", defaults["oxidation_state"]),
        "oxidation_state_inference": row.get("oxidation_state_inference", defaults["oxidation_state_inference"]),
        "strength": float(row.get("strength", 0.0)),
        "note": note,
    }


def get_enriched_raman_peaks(material: str) -> list[dict]:
    return [enriched_raman_peak(material, row) for row in RAMAN_REFERENCES.get(material, [])]


def get_raman_peak_library() -> list[dict]:
    library: list[dict] = []
    for material in sorted(RAMAN_REFERENCES):
        library.extend(get_enriched_raman_peaks(material))
    return library
