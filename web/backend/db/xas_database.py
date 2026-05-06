"""XAS sample peak database.

Contains known absorption edge features for:
- Ti3CN (MXene 粉末)
- NiO/Ga2O3/n-Si (雙層薄膜)
- Ga2O3/NiO/p-Si (雙層薄膜)

Peak format per entry:
  { "label": str, "energy_eV": float, "fwhm_eV": float, "meaning": str }
"""

from __future__ import annotations

XAS_SAMPLES: dict = {
    "Ti3CN": {
        "description": "Ti₃CN MXene 粉末",
        "edges": {
            "Ti L-edge (~450–475 eV)": {
                "energy_range": [448, 478],
                "peaks": [
                    {
                        "label": "A₁ (Ti²⁺ L₃ t₂g)",
                        "energy_eV": 453.5,
                        "fwhm_eV": 1.2,
                        "meaning": "Ti²⁺ 的 L₃ t₂g 躍遷，表面氧化態",
                    },
                    {
                        "label": "B₁ (Ti³⁺ L₃)",
                        "energy_eV": 455.8,
                        "fwhm_eV": 1.5,
                        "meaning": "Ti³⁺ 的 L₃ 主峰，MXene 本體氧化態",
                    },
                    {
                        "label": "C₁ (Ti⁴⁺ L₃ t₂g)",
                        "energy_eV": 457.8,
                        "fwhm_eV": 1.3,
                        "meaning": "Ti⁴⁺ L₃ t₂g，表面氧化形成 TiO₂",
                    },
                    {
                        "label": "D₁ (Ti⁴⁺ L₃ eg)",
                        "energy_eV": 460.2,
                        "fwhm_eV": 1.6,
                        "meaning": "Ti⁴⁺ L₃ eg 晶場分裂峰",
                    },
                    {
                        "label": "A₂ (Ti²⁺ L₂ t₂g)",
                        "energy_eV": 462.5,
                        "fwhm_eV": 1.4,
                        "meaning": "Ti²⁺ L₂ 自旋軌道對應峰",
                    },
                    {
                        "label": "B₂ (Ti³⁺ L₂)",
                        "energy_eV": 464.8,
                        "fwhm_eV": 1.6,
                        "meaning": "Ti³⁺ L₂ 主峰",
                    },
                    {
                        "label": "C₂ (Ti⁴⁺ L₂ t₂g)",
                        "energy_eV": 466.8,
                        "fwhm_eV": 1.5,
                        "meaning": "Ti⁴⁺ L₂ t₂g 峰",
                    },
                    {
                        "label": "D₂ (Ti⁴⁺ L₂ eg)",
                        "energy_eV": 469.2,
                        "fwhm_eV": 1.8,
                        "meaning": "Ti⁴⁺ L₂ eg 晶場分裂峰",
                    },
                ],
            },
            "C K-edge (~282–310 eV)": {
                "energy_range": [280, 312],
                "peaks": [
                    {
                        "label": "π* (C=C sp²)",
                        "energy_eV": 285.4,
                        "fwhm_eV": 1.0,
                        "meaning": "石墨化 sp² 碳的 π* 躍遷（C–Ti 鍵貢獻）",
                    },
                    {
                        "label": "π* (C–Ti)",
                        "energy_eV": 287.2,
                        "fwhm_eV": 1.2,
                        "meaning": "MXene 中 C–Ti 鍵的 π* 特徵",
                    },
                    {
                        "label": "σ* (C–C sp³)",
                        "energy_eV": 291.5,
                        "fwhm_eV": 2.0,
                        "meaning": "sp³ 碳的 σ* 躍遷，含氧化表面基團",
                    },
                    {
                        "label": "σ* (C–Ti)",
                        "energy_eV": 295.0,
                        "fwhm_eV": 2.5,
                        "meaning": "C–Ti 鍵的 σ* 多重散射特徵",
                    },
                ],
            },
            "N K-edge (~395–420 eV)": {
                "energy_range": [393, 422],
                "peaks": [
                    {
                        "label": "π* (pyridinic N)",
                        "energy_eV": 397.8,
                        "fwhm_eV": 1.1,
                        "meaning": "pyridinic-like N 的 π* 峰（N–Ti 鍵）",
                    },
                    {
                        "label": "π* (N–Ti)",
                        "energy_eV": 399.5,
                        "fwhm_eV": 1.3,
                        "meaning": "MXene 晶格中 N–Ti 鍵的主要 π* 峰",
                    },
                    {
                        "label": "π* (graphitic N)",
                        "energy_eV": 401.2,
                        "fwhm_eV": 1.4,
                        "meaning": "石墨化 N（置換石墨結構中的 N）",
                    },
                    {
                        "label": "σ* (N–Ti)",
                        "energy_eV": 407.5,
                        "fwhm_eV": 2.8,
                        "meaning": "N–Ti 鍵的 σ* 多重散射寬峰",
                    },
                ],
            },
        },
    },

    "NiO/Ga2O3/n-Si": {
        "description": "NiO/Ga₂O₃/n-Si 雙層薄膜（頂層 NiO）",
        "edges": {
            "Ni L-edge (~845–885 eV)": {
                "energy_range": [843, 888],
                "peaks": [
                    {
                        "label": "Ni²⁺ L₃ (main)",
                        "energy_eV": 853.0,
                        "fwhm_eV": 1.8,
                        "meaning": "NiO 中 Ni²⁺ 的 L₃ 主峰，八面體晶場 t₂g⁶eg²",
                    },
                    {
                        "label": "Ni²⁺ L₃ (satellite)",
                        "energy_eV": 855.8,
                        "fwhm_eV": 2.2,
                        "meaning": "Ni²⁺ L₃ 電荷轉移衛星峰（shake-up）",
                    },
                    {
                        "label": "Ni²⁺ L₂ (main)",
                        "energy_eV": 870.3,
                        "fwhm_eV": 2.0,
                        "meaning": "NiO 中 Ni²⁺ 的 L₂ 主峰",
                    },
                    {
                        "label": "Ni²⁺ L₂ (satellite)",
                        "energy_eV": 873.0,
                        "fwhm_eV": 2.5,
                        "meaning": "Ni²⁺ L₂ 衛星峰",
                    },
                ],
            },
            "O K-edge (~527–560 eV)": {
                "energy_range": [525, 565],
                "peaks": [
                    {
                        "label": "pre-peak (NiO t₂g*)",
                        "energy_eV": 528.5,
                        "fwhm_eV": 1.2,
                        "meaning": "NiO 的 O 2p–Ni 3d t₂g* 預峰（佔 O K-edge 較低能側）",
                    },
                    {
                        "label": "pre-peak (NiO eg*)",
                        "energy_eV": 530.3,
                        "fwhm_eV": 1.4,
                        "meaning": "NiO 的 O 2p–Ni 3d eg* 預峰",
                    },
                    {
                        "label": "Ga₂O₃ pre-peak",
                        "energy_eV": 532.8,
                        "fwhm_eV": 1.5,
                        "meaning": "β-Ga₂O₃ 的 O 1s→Ga 4s/4p 預峰",
                    },
                    {
                        "label": "main (Ni–O σ*)",
                        "energy_eV": 537.5,
                        "fwhm_eV": 3.0,
                        "meaning": "NiO O K-edge 主峰，Ni–O 鍵 σ* 貢獻",
                    },
                    {
                        "label": "main (Ga–O σ*)",
                        "energy_eV": 542.0,
                        "fwhm_eV": 3.5,
                        "meaning": "Ga₂O₃ O K-edge 主峰，Ga–O 鍵 σ* 貢獻",
                    },
                ],
            },
            "Ga L-edge (~1115–1150 eV)": {
                "energy_range": [1112, 1155],
                "peaks": [
                    {
                        "label": "Ga³⁺ L₃",
                        "energy_eV": 1117.5,
                        "fwhm_eV": 2.5,
                        "meaning": "β-Ga₂O₃ 中 Ga³⁺ 的 L₃ 主吸收邊",
                    },
                    {
                        "label": "Ga³⁺ L₂",
                        "energy_eV": 1143.5,
                        "fwhm_eV": 2.8,
                        "meaning": "β-Ga₂O₃ 中 Ga³⁺ 的 L₂ 主吸收邊",
                    },
                ],
            },
        },
    },

    "Ga2O3/NiO/p-Si": {
        "description": "Ga₂O₃/NiO/p-Si 雙層薄膜（頂層 Ga₂O₃）",
        "edges": {
            "Ga L-edge (~1115–1150 eV)": {
                "energy_range": [1112, 1155],
                "peaks": [
                    {
                        "label": "Ga³⁺ L₃",
                        "energy_eV": 1117.5,
                        "fwhm_eV": 2.5,
                        "meaning": "β-Ga₂O₃ 頂層 Ga³⁺ 的 L₃ 主吸收邊",
                    },
                    {
                        "label": "Ga³⁺ L₂",
                        "energy_eV": 1143.5,
                        "fwhm_eV": 2.8,
                        "meaning": "β-Ga₂O₃ 頂層 Ga³⁺ 的 L₂ 主吸收邊",
                    },
                ],
            },
            "O K-edge (~527–560 eV)": {
                "energy_range": [525, 565],
                "peaks": [
                    {
                        "label": "Ga₂O₃ pre-peak",
                        "energy_eV": 532.8,
                        "fwhm_eV": 1.5,
                        "meaning": "β-Ga₂O₃ 頂層 O 1s→Ga 4s/4p 預峰",
                    },
                    {
                        "label": "pre-peak (NiO t₂g*)",
                        "energy_eV": 528.5,
                        "fwhm_eV": 1.2,
                        "meaning": "NiO 下層 O 2p–Ni 3d t₂g* 預峰（TFY 更明顯）",
                    },
                    {
                        "label": "pre-peak (NiO eg*)",
                        "energy_eV": 530.3,
                        "fwhm_eV": 1.4,
                        "meaning": "NiO 下層 O 2p–Ni 3d eg* 預峰",
                    },
                    {
                        "label": "main (Ga–O σ*)",
                        "energy_eV": 542.0,
                        "fwhm_eV": 3.5,
                        "meaning": "Ga₂O₃ O K-edge 主峰，Ga–O 鍵 σ* 貢獻",
                    },
                    {
                        "label": "main (Ni–O σ*)",
                        "energy_eV": 537.5,
                        "fwhm_eV": 3.0,
                        "meaning": "NiO O K-edge 主峰",
                    },
                ],
            },
            "Ni L-edge (~845–885 eV)": {
                "energy_range": [843, 888],
                "peaks": [
                    {
                        "label": "Ni²⁺ L₃ (main)",
                        "energy_eV": 853.0,
                        "fwhm_eV": 1.8,
                        "meaning": "NiO 下層 Ni²⁺ 的 L₃ 主峰（TFY 深度靈敏）",
                    },
                    {
                        "label": "Ni²⁺ L₃ (satellite)",
                        "energy_eV": 855.8,
                        "fwhm_eV": 2.2,
                        "meaning": "Ni²⁺ L₃ 電荷轉移衛星峰",
                    },
                    {
                        "label": "Ni²⁺ L₂ (main)",
                        "energy_eV": 870.3,
                        "fwhm_eV": 2.0,
                        "meaning": "NiO 下層 Ni²⁺ 的 L₂ 主峰",
                    },
                    {
                        "label": "Ni²⁺ L₂ (satellite)",
                        "energy_eV": 873.0,
                        "fwhm_eV": 2.5,
                        "meaning": "Ni²⁺ L₂ 衛星峰",
                    },
                ],
            },
        },
    },
}


def list_samples() -> list[dict]:
    """Return [{name, description, edges}] for all samples."""
    return [
        {
            "name": name,
            "description": info["description"],
            "edges": list(info["edges"].keys()),
        }
        for name, info in XAS_SAMPLES.items()
    ]


def get_sample_edge_peaks(sample_name: str, edge_name: str) -> dict | None:
    """Return { peaks: [...], energy_range: [...] } or None if not found."""
    sample = XAS_SAMPLES.get(sample_name)
    if sample is None:
        return None
    edge = sample["edges"].get(edge_name)
    if edge is None:
        return None
    return {
        "sample": sample_name,
        "edge": edge_name,
        "energy_range": edge["energy_range"],
        "peaks": edge["peaks"],
    }
