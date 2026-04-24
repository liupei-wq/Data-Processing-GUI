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
}
