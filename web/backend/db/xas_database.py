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
    "Mo2Ti2C3": {
        "description": "Mo₂Ti₂C₃ MXene",
        "edges": {
            "C K-edge (~282–310 eV)": {
                "energy_range": [280, 312],
                "peaks": [
                    {
                        "label": "π* (C–Mo)",
                        "energy_eV": 283.4,
                        "fwhm_eV": 1.0,
                        "meaning": "MXene 晶格中 C–Mo 鍵的 π* 躍遷，為 Mo₂Ti₂C₃ 特有峰",
                    },
                    {
                        "label": "π* (C–Ti)",
                        "energy_eV": 284.5,
                        "fwhm_eV": 1.1,
                        "meaning": "C–Ti 鍵的 π* 躍遷，與 Ti₃CN 類似但強度較弱",
                    },
                    {
                        "label": "π* (C=C sp²)",
                        "energy_eV": 285.4,
                        "fwhm_eV": 1.0,
                        "meaning": "石墨化 sp² 碳的 π* 特徵，表面碳雜質或部分石墨化",
                    },
                    {
                        "label": "σ* (C–Mo/C–Ti)",
                        "energy_eV": 292.0,
                        "fwhm_eV": 2.5,
                        "meaning": "C–Mo 與 C–Ti 鍵混合 σ* 躍遷寬峰",
                    },
                    {
                        "label": "MS feature",
                        "energy_eV": 297.5,
                        "fwhm_eV": 3.5,
                        "meaning": "多重散射特徵，反映碳層的近程有序結構",
                    },
                ],
            },
            "Ti L-edge (~450–475 eV)": {
                "energy_range": [448, 478],
                "peaks": [
                    {
                        "label": "A₁ (Ti²⁺/Ti³⁺ L₃ t₂g)",
                        "energy_eV": 454.2,
                        "fwhm_eV": 1.2,
                        "meaning": "Ti 低氧化態 L₃ t₂g 峰，因 Mo 配位改變晶場，峰位較 Ti₃CN 略有位移",
                    },
                    {
                        "label": "B₁ (Ti³⁺/Ti⁴⁺ L₃ eg)",
                        "energy_eV": 456.8,
                        "fwhm_eV": 1.4,
                        "meaning": "Ti L₃ eg 峰，反映 Mo₂Ti₂C₃ 中 Ti 的混合氧化態",
                    },
                    {
                        "label": "C₁ (Ti⁴⁺ L₃ t₂g)",
                        "energy_eV": 458.5,
                        "fwhm_eV": 1.3,
                        "meaning": "Ti⁴⁺ L₃ t₂g，表面氧化 TiO₂ 的貢獻",
                    },
                    {
                        "label": "A₂ (Ti L₂ t₂g)",
                        "energy_eV": 463.5,
                        "fwhm_eV": 1.5,
                        "meaning": "Ti L₂ t₂g 自旋軌道耦合對應峰",
                    },
                    {
                        "label": "B₂ (Ti L₂ eg)",
                        "energy_eV": 466.0,
                        "fwhm_eV": 1.7,
                        "meaning": "Ti L₂ eg 峰",
                    },
                ],
            },
            "Mo L-edge (~2515–2545 eV)": {
                "energy_range": [2512, 2550],
                "peaks": [
                    {
                        "label": "Mo⁴⁺ L₃ t₂g",
                        "energy_eV": 2519.5,
                        "fwhm_eV": 1.3,
                        "meaning": "Mo₂Ti₂C₃ 中 Mo⁴⁺ L₃ t₂g 主峰，MXene 本體氧化態特徵",
                    },
                    {
                        "label": "Mo⁴⁺ L₃ eg",
                        "energy_eV": 2522.0,
                        "fwhm_eV": 1.5,
                        "meaning": "Mo⁴⁺ L₃ eg 晶場分裂峰",
                    },
                    {
                        "label": "Mo⁵⁺/Mo⁶⁺ L₃",
                        "energy_eV": 2526.0,
                        "fwhm_eV": 1.8,
                        "meaning": "表面氧化 Mo 的 L₃ 特徵（Mo⁵⁺ 或 Mo⁶⁺），TEY 更明顯",
                    },
                    {
                        "label": "MS feature (L₃)",
                        "energy_eV": 2535.0,
                        "fwhm_eV": 4.0,
                        "meaning": "Mo L₃ 區多重散射寬峰，反映 Mo–C/Mo–Ti 近鄰結構",
                    },
                ],
            },
            "Ti K-edge (~4966–5010 eV)": {
                "energy_range": [4963, 5015],
                "peaks": [
                    {
                        "label": "pre-edge A (1s→3d, Ti³⁺)",
                        "energy_eV": 4969.0,
                        "fwhm_eV": 1.0,
                        "meaning": "Ti³⁺ 的 1s→3d 四極躍遷預峰",
                    },
                    {
                        "label": "pre-edge B (1s→3d, Ti⁴⁺)",
                        "energy_eV": 4971.5,
                        "fwhm_eV": 1.2,
                        "meaning": "Ti⁴⁺ 的 1s→3d 預峰（表面氧化貢獻）",
                    },
                    {
                        "label": "white line (1s→4p)",
                        "energy_eV": 4982.0,
                        "fwhm_eV": 4.0,
                        "meaning": "Ti K-edge 主白線，能量反映 Mo₂Ti₂C₃ 中 Ti 的平均氧化態",
                    },
                    {
                        "label": "MS feature",
                        "energy_eV": 4996.0,
                        "fwhm_eV": 7.0,
                        "meaning": "XANES 多重散射特徵，Ti–C/Ti–Mo 近程有序",
                    },
                ],
            },
            "Mo K-edge (~19994–20060 eV)": {
                "energy_range": [19990, 20065],
                "peaks": [
                    {
                        "label": "pre-edge (1s→4d)",
                        "energy_eV": 19997.5,
                        "fwhm_eV": 2.0,
                        "meaning": "Mo 的 1s→4d 四極躍遷預峰，強度低；Mo⁴⁺/Mo⁶⁺ 混合影響預峰形狀",
                    },
                    {
                        "label": "white line (1s→5p, Mo⁴⁺)",
                        "energy_eV": 20014.0,
                        "fwhm_eV": 8.0,
                        "meaning": "Mo⁴⁺ K-edge 主白線（1s→5p），較 MoO₃ Mo⁶⁺ 約低 5–7 eV",
                    },
                    {
                        "label": "shoulder (Mo⁶⁺)",
                        "energy_eV": 20021.0,
                        "fwhm_eV": 5.0,
                        "meaning": "表面 Mo⁶⁺ 的白線肩峰，TEY 靈敏度高時較明顯",
                    },
                    {
                        "label": "MS feature",
                        "energy_eV": 20035.0,
                        "fwhm_eV": 12.0,
                        "meaning": "Mo K-edge 多重散射寬峰，反映 Mo–C/Mo–Ti 近鄰殼層",
                    },
                ],
            },
        },
    },

    "Ti3CN": {
        "description": "Ti₃CN MXene 粉末",
        "edges": {
            "Ti K-edge (~4966–5010 eV)": {
                "energy_range": [4963, 5015],
                "peaks": [
                    {
                        "label": "pre-edge A (1s→3d, Ti³⁺)",
                        "energy_eV": 4969.0,
                        "fwhm_eV": 1.0,
                        "meaning": "Ti³⁺ 的 1s→3d 四極躍遷預峰，反映 MXene 混合氧化態",
                    },
                    {
                        "label": "pre-edge B (1s→3d, Ti⁴⁺)",
                        "energy_eV": 4971.5,
                        "fwhm_eV": 1.2,
                        "meaning": "Ti⁴⁺ 的 1s→3d 預峰，表面氧化 TiO₂ 成分",
                    },
                    {
                        "label": "white line (1s→4p)",
                        "energy_eV": 4982.0,
                        "fwhm_eV": 4.0,
                        "meaning": "Ti K-edge 主白線，1s→4p 偶極躍遷，能量反映平均氧化態",
                    },
                    {
                        "label": "MS feature",
                        "energy_eV": 4996.0,
                        "fwhm_eV": 7.0,
                        "meaning": "XANES 多重散射特徵峰，反映 Ti 的近程有序結構",
                    },
                ],
            },
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
            "Ni K-edge (~8333–8400 eV)": {
                "energy_range": [8328, 8405],
                "peaks": [
                    {
                        "label": "pre-edge (1s→3d)",
                        "energy_eV": 8331.5,
                        "fwhm_eV": 1.2,
                        "meaning": "Ni²⁺ Oh 晶場中 1s→3d 四極躍遷，強度極弱（對稱禁止）",
                    },
                    {
                        "label": "edge shoulder (1s→4s/4p)",
                        "energy_eV": 8337.0,
                        "fwhm_eV": 3.0,
                        "meaning": "Ni²⁺ 邊緣肩峰，反映 Ni–O 鍵的空 4p 態密度",
                    },
                    {
                        "label": "white line (1s→4p)",
                        "energy_eV": 8348.0,
                        "fwhm_eV": 8.0,
                        "meaning": "NiO Ni K-edge 主白線，1s→4p 偶極躍遷，Ni²⁺ 特徵",
                    },
                    {
                        "label": "MS feature",
                        "energy_eV": 8363.0,
                        "fwhm_eV": 10.0,
                        "meaning": "XANES 多重散射寬峰，反映 NiO 岩鹽結構近程有序",
                    },
                ],
            },
            "Ga K-edge (~10367–10420 eV)": {
                "energy_range": [10363, 10425],
                "peaks": [
                    {
                        "label": "pre-edge (Td site, 1s→4p)",
                        "energy_eV": 10370.0,
                        "fwhm_eV": 2.0,
                        "meaning": "β-Ga₂O₃ 四面體 Ga 位（GaₐO₄）的 1s→4p 預峰，強度高於 Oh 位",
                    },
                    {
                        "label": "white line (1s→4p)",
                        "energy_eV": 10375.5,
                        "fwhm_eV": 5.0,
                        "meaning": "Ga³⁺ K-edge 主白線，四面體與八面體混合位點的 1s→4p 躍遷",
                    },
                    {
                        "label": "MS feature 1",
                        "energy_eV": 10395.0,
                        "fwhm_eV": 8.0,
                        "meaning": "β-Ga₂O₃ 第一多重散射特徵，反映 Ga–O 近鄰殼層結構",
                    },
                    {
                        "label": "MS feature 2",
                        "energy_eV": 10410.0,
                        "fwhm_eV": 10.0,
                        "meaning": "β-Ga₂O₃ 第二多重散射特徵，反映 Ga–Ga 次近鄰殼層",
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
            "Ga K-edge (~10367–10420 eV)": {
                "energy_range": [10363, 10425],
                "peaks": [
                    {
                        "label": "pre-edge (Td site, 1s→4p)",
                        "energy_eV": 10370.0,
                        "fwhm_eV": 2.0,
                        "meaning": "β-Ga₂O₃ 頂層四面體 Ga 位的 1s→4p 預峰",
                    },
                    {
                        "label": "white line (1s→4p)",
                        "energy_eV": 10375.5,
                        "fwhm_eV": 5.0,
                        "meaning": "Ga³⁺ K-edge 主白線，頂層 Ga₂O₃ 特徵",
                    },
                    {
                        "label": "MS feature 1",
                        "energy_eV": 10395.0,
                        "fwhm_eV": 8.0,
                        "meaning": "β-Ga₂O₃ 第一多重散射特徵",
                    },
                    {
                        "label": "MS feature 2",
                        "energy_eV": 10410.0,
                        "fwhm_eV": 10.0,
                        "meaning": "β-Ga₂O₃ 第二多重散射特徵",
                    },
                ],
            },
            "Ni K-edge (~8333–8400 eV)": {
                "energy_range": [8328, 8405],
                "peaks": [
                    {
                        "label": "pre-edge (1s→3d)",
                        "energy_eV": 8331.5,
                        "fwhm_eV": 1.2,
                        "meaning": "NiO 下層 Ni²⁺ 的 1s→3d 四極躍遷預峰（強度極弱）",
                    },
                    {
                        "label": "edge shoulder (1s→4s/4p)",
                        "energy_eV": 8337.0,
                        "fwhm_eV": 3.0,
                        "meaning": "NiO 下層邊緣肩峰（TFY 深度靈敏，較 TEY 明顯）",
                    },
                    {
                        "label": "white line (1s→4p)",
                        "energy_eV": 8348.0,
                        "fwhm_eV": 8.0,
                        "meaning": "NiO 下層 Ni K-edge 主白線，Ni²⁺ 特徵",
                    },
                    {
                        "label": "MS feature",
                        "energy_eV": 8363.0,
                        "fwhm_eV": 10.0,
                        "meaning": "NiO 多重散射寬峰，岩鹽結構近程有序",
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
