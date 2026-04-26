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
        {"pos": 302,   "label": "2TA",  "strength": 25, "note": "Si second-order transverse acoustic"},
        {"pos": 520.7, "label": "1TO",  "strength": 100, "note": "Si first-order TO phonon (main peak)"},
        {"pos": 960,   "label": "2TO",  "strength": 40, "note": "Si second-order overtone (broad)"},
    ],

    # ── β-Ga₂O₃ (monoclinic C₂ₕ) ─────────────────────────────────────────────
    # Refs: Kranert et al. PRL 2016; Dohy et al. J. Solid State Chem. 1982
    "β-Ga₂O₃": [
        {"pos": 144,  "label": "Ag",  "strength": 30, "note": "β-Ga₂O₃ Ag mode"},
        {"pos": 170,  "label": "Ag",  "strength": 20, "note": "β-Ga₂O₃ Ag mode"},
        {"pos": 200,  "label": "Ag",  "strength": 40, "note": "β-Ga₂O₃ Ag mode"},
        {"pos": 320,  "label": "Ag",  "strength": 50, "note": "β-Ga₂O₃ Ag mode"},
        {"pos": 347,  "label": "Ag",  "strength": 45, "note": "β-Ga₂O₃ Ag mode"},
        {"pos": 416,  "label": "Ag",  "strength": 75, "note": "β-Ga₂O₃ Ag mode (strong)"},
        {"pos": 475,  "label": "Ag",  "strength": 80, "note": "β-Ga₂O₃ Ag mode (strong)"},
        {"pos": 630,  "label": "Ag",  "strength": 50, "note": "β-Ga₂O₃ Ag mode"},
        {"pos": 651,  "label": "Ag",  "strength": 45, "note": "β-Ga₂O₃ Ag mode"},
        {"pos": 767,  "label": "Ag",  "strength": 25, "note": "β-Ga₂O₃ Ag mode (weak)"},
    ],

    # ── NiO (rock-salt, cubic Fm3̄m) ───────────────────────────────────────────
    # First-order Raman-inactive; observed peaks are disorder/defect or magnon activated
    # Refs: Dietz et al. PRB 1971; Mironova-Ulmane et al. J. Phys. 2007
    "NiO": [
        {"pos": 457,  "label": "1M",    "strength": 50, "note": "NiO one-magnon"},
        {"pos": 570,  "label": "1LO",   "strength": 20, "note": "NiO 1LO (symmetry-forbidden, disorder-activated)"},
        {"pos": 730,  "label": "2P",    "strength": 45, "note": "NiO two-phonon (broad)"},
        {"pos": 1090, "label": "2M/2LO","strength": 65, "note": "NiO two-magnon/2LO (most characteristic, broad)"},
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
