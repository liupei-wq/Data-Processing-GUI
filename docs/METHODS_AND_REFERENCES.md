# 方法、文獻與數值驗證

本文件整理 Nigiro Pro（Data-Processing-GUI）各分析模組使用的演算法、對應文獻、程式位置與數值驗證。
所有驗證都用「已知答案」的合成資料，測試檔在 `web/backend/tests/`：

```bash
cd web/backend
python -m pip install numpy scipy pandas fastapi pydantic python-multipart pytest
python -m pytest tests -v
```

---

## 1. 共用：峰形、擬合與誤差

| 項目 | 方法 | 程式位置 | 文獻 |
|---|---|---|---|
| 峰形 | Gaussian、Lorentzian、Voigt（`scipy.special.voigt_profile`）、pseudo-Voigt、split pseudo-Voigt | `web/backend/core/peak_fitting.py` | Thompson, Cox & Hastings, *J. Appl. Cryst.* 20, 79 (1987) |
| Voigt 半高寬 | f_V ≈ 0.5346 f_L + √(0.2166 f_L² + f_G²) | `fwhm_voigt` | Olivero & Longbothum, *JQSRT* 17, 233 (1977) |
| 峰面積 | 全部使用解析解；Voigt：面積 = 峰高 / V(0; σ, γ) | `area_*`、`_area_for_profile` | — |
| 擬合 | 有邊界的非線性最小平方（Trust Region Reflective） | `fit_peaks` | Branch, Coleman & Li, *SIAM J. Sci. Comput.* 21, 1 (1999)；SciPy: Virtanen et al., *Nat. Methods* 17, 261 (2020) |
| 參數誤差 | 共變異矩陣 cov = s²(JᵀJ)⁻¹，s² = Σr²/(n−p)，以數值 Jacobian 傳遞到峰高、峰位、FWHM、面積；碰到上下限的參數視為固定並標記 | `_parameter_covariance`、`_propagate_errors` | Bevington & Robinson, *Data Reduction and Error Analysis for the Physical Sciences* |
| 擬合品質 | R²、RMSE、Σr²/(n−p)、AIC、BIC | `_metric_values` | Akaike, *IEEE TAC* 19, 716 (1974)；Schwarz, *Ann. Stat.* 6, 461 (1978) |

**限制**：資料未以量測誤差加權，所以 Σr²/(n−p) 不是嚴格的 reduced χ²（Andrae et al., arXiv:1012.3754）。先內插或平滑再擬合時，相鄰點殘差相關，R²、AIC/BIC 與參數誤差都會偏樂觀，建議用原始點擬合。R² 不適合單獨評估非線性模型（Spiess & Neumeyer, *BMC Pharmacol.* 10, 6 (2010)）。

**驗證**：`test_fit_standard_errors_match_monte_carlo_scatter`（回報的 ±1σ 與 150 次 Monte Carlo 的實際離散一致，誤差在 ±30% 以內）、`test_voigt_area_matches_analytic_and_limits`、`test_voigt_fit_recovers_true_area`。

## 2. 背景、平滑、去雜訊

| 方法 | 程式位置 | 文獻 |
|---|---|---|
| Shirley（兩端各 5 點平均、中點累積面積） | `core/processing.py` `shirley_background` | Shirley, *PRB* 5, 4709 (1972)；Proctor & Sherwood, *Anal. Chem.* 54, 13 (1982) |
| Tougaard（universal cross-section，B = 2866 eV²，C = 1643 eV²） | `tougaard_background` | Tougaard, *Surf. Interface Anal.* 11, 453 (1988)；*Surf. Sci.* 216, 343 (1989) |
| AsLS / airPLS / arPLS | `asls_background`、`airpls_background`、`arpls_background` | Eilers & Boelens (2005)；Zhang et al., *Analyst* 135, 1138 (2010)；Baek et al., *Analyst* 140, 250 (2015) |
| Savitzky–Golay 平滑與微分 | `smooth_signal`、`routers/xas.py` `_smoothed_derivative` | Savitzky & Golay, *Anal. Chem.* 36, 1627 (1964) |
| 移動平均（邊緣以端點值延伸，不補 0） | `smooth_signal` | — |
| 宇宙射線去除（中位數 + MAD 門檻，Hampel 濾波器） | `despike_signal` | Hampel, *JASA* 69, 383 (1974)；類似做法：Whitaker & Hayes, *Chemom. Intell. Lab. Syst.* 179, 82 (2018) |
| 雜訊估計 1.4826 × MAD | `routers/xrd.py`、`routers/raman.py` | Rousseeuw & Croux, *JASA* 88, 1273 (1993) |

**驗證**：`tests/test_xps_fitting.py`（Shirley、Tougaard）、`test_moving_average_preserves_flat_edges`、`test_second_derivative_is_far_less_noisy_than_double_gradient`。

## 3. XPS

| 項目 | 方法 | 程式位置 | 文獻 |
|---|---|---|---|
| 擬合實務 | — | `routers/xps.py` `fit_xps_peaks` | Major et al., *JVST A* 38, 061203 (2020) |
| 自旋軌道雙峰 | 同元素、同化學態的 j = l±1/2 峰：固定分裂能、面積比 (2j+1)（p 1:2、d 2:3、f 3:4）、共用 FWHM（勾選「雙峰約束」） | `_auto_doublet_links`、`fit_peaks(link_to=…)` | Major et al. (2020) |
| 結合能 | 參考 NIST XPS Database（SRD 20）；C 1s 校正的注意事項 | `db/xps_database.py` | Greczynski & Hultman, *Prog. Mater. Sci.* 107, 100591 (2020) |
| RSF 定量 | Scofield 截面；子能階依簡併度從總量換算；可選動能校正 RSF × (KE/KE_C1s)^n；可手動改成儀器 RSF | `get_orbital_rsf`、`get_rsf_values` | Scofield, *JESRP* 8, 129 (1976)；Shard, *JVST A* 38, 041201 (2020)；Tanuma, Powell & Penn, *SIA* 21, 165 (1994) |
| VBM | 前緣與背景各做最小平方直線擬合，交點即 VBM；±1σ 由兩條直線的參數誤差傳遞 | `_fit_vbm_line`、`compute_vbm` | Kraut et al., *PRL* 44, 1620 (1980)；Chambers et al., *JVST B* 22, 2205 (2004) |

**限制**：Ga 2p、Ge 2p 的 RSF 與同表週期趨勢不一致，介面上會標黃框，定量前請以儀器軟體的 RSF 庫核對。動能校正指數 n 依儀器而定：只校正 IMFP 時 n ≈ 0.7–0.8，穿透函數要另外加入；n = 0 表示不校正。

**驗證**：`test_vbm_least_squares_is_unbiased_and_error_is_calibrated`（200 次雜訊：平均偏差 < 0.01 eV，±1σ 與實際離散一致）、`test_doublet_link_enforces_ratio_offset_and_width`、`test_auto_doublet_pairing_by_label`、`test_rsf_sublevel_split_and_flag`、`test_rsf_kinetic_energy_correction_keeps_c1s_at_one`。

## 4. XRD

| 項目 | 方法 | 程式位置 | 文獻 |
|---|---|---|---|
| 波長 | Kα1 與加權 Kα 平均 | `routers/xrd.py` `WAVELENGTHS`、`components/ProcessingPanel.tsx` | International Tables for Crystallography Vol. C, Table 4.2.2.1；Hölzer et al., *PRA* 56, 4554 (1997) |
| Kα2 去除 | Rachinger 遞推，sin θ₁ = (λ1/λ2) sin θ | `core/processing.py` `strip_kalpha2`、`pages/XRD.tsx` `stripKalpha2` | Rachinger, *J. Sci. Instrum.* 25, 254 (1948) |
| d-spacing | Bragg 定律 | `xrd.py`、`XRD.tsx` | — |
| 晶粒尺寸 | Scherrer D = Kλ/(β cos θ)，K = 0.9；β 先扣儀器展寬（Gaussian：β² = β_obs² − β_inst²；Lorentzian：β = β_obs − β_inst）；FWHM 一律在線性強度上量測 | `XRD.tsx` `calcScherrerD`、`correctInstrumentalBroadening` | Patterson, *Phys. Rev.* 56, 978 (1939)；Langford & Wilson, *J. Appl. Cryst.* 11, 102 (1978) |

**限制**：β_inst 需以 LaB6 / Si 標準樣品實測，預設 0 時介面會提示。Scherrer 忽略微應變，所得 D 為下限估計。

**驗證**：`test_kalpha2_stripping_recovers_single_kalpha1_peak`（去除後與真實 Kα1 最大差 < 0.5%，面積差 < 0.5%）。

## 5. Raman

| 項目 | 方法 | 程式位置 | 文獻 |
|---|---|---|---|
| β-Ga2O3 參考峰 | 15 個 Raman 活性聲子 | `db/raman_database.py` | Kranert et al., *Sci. Rep.* 6, 35964 (2016)；Dohy et al. (1982) |
| Si 基板扣除 | 以 Si 參考光譜做縮放、位移與線性基線擬合後扣除 | `routers/raman.py` `_apply_si_subtraction` | — |
| 自動加峰 | ΔAIC ≥ 6 且 ΔBIC ≥ 6 才接受新峰 | `_fit_with_aic_bic_auto_peaks` | Burnham & Anderson (2002)；Kass & Raftery, *JASA* 90, 773 (1995) |
| 峰位／FWHM 誤差 | 優先用擬合共變異矩陣；不可得時才用 SNR 經驗式（`Uncertainty_Method` 會標示） | `_peak_row_from_candidate` | — |
| Si 應力 | σ = Δω / 係數；單軸 −2.0、雙軸 −4.0 cm⁻¹/GPa；Si 峰依歸屬選取 | `pages/Raman.tsx` | De Wolf, *Semicond. Sci. Technol.* 11, 139 (1996)；Anastassakis, Cantarero & Cardona, *PRB* 41, 7529 (1990) |

## 6. XAS / XES

| 項目 | 方法 | 程式位置 | 文獻 |
|---|---|---|---|
| XANES 正規化 | pre-edge 直線、post-edge 二次式、edge step = post(E0)；flatten 只套用在 E ≥ E0 | `routers/xas.py` `_normalize_athena` | Ravel & Newville, *J. Synchrotron Rad.* 12, 537 (2005) |
| E0 | Savitzky–Golay 一次微分最大值 | `_detect_e0` | 同上 |
| 二次微分 | Savitzky–Golay 二次微分（可調 window / 階數） | `_smoothed_derivative` | Savitzky & Golay (1964)；用於能隙估計：McLeod et al., *PRB* 81, 245123 (2010) |
| 軟 X 光 NEXAFS 校正 | I0 正規化 | `_apply_column_mapping` | Watts, Thomsen & Dastoor, *JESRP* 151, 105 (2006) |
| XANES 去卷積 | arctan 階梯 + 高斯峰（lmfit，含 stderr） | `xanes_deconv` | Stöhr, *NEXAFS Spectroscopy* (Springer, 1992) |
| EXAFS | k = √((E−E0)/3.81)；Larch AUTOBK / xftf；SciPy 版僅供預覽 | `_calculate_exafs_larch`、`_calculate_exafs_preview` | Newville et al., *PRB* 47, 14126 (1993)；Newville, *J. Phys.: Conf. Ser.* 430, 012007 (2013) |
| CBM / VBM 外推 | 與 XPS VBM 相同的最小平方直線擬合 | `pages/XAS.tsx` `fitEdgeLine`、`pages/PlotFileTool.tsx` `fitVbmPlotLine` | Kraut et al. (1980)；Chambers et al. (2004) |
| XES 背景與 I0 | (y − BG) / I0：先在原始計數扣背景，再除以 I0 | `routers/xes.py` `process_xes` | — |

**限制**：TFY 沒有做自吸收校正（需要組成、入射／出射角與吸收係數表，Tröger et al., *PRB* 46, 3283 (1992)；Eisebitt et al., *PRB* 47, 14103 (1993)），厚樣品的 TFY 強度比例請保守解讀。

**驗證**：`test_athena_flatten_leaves_pre_edge_untouched`、`test_xes_smoothing_works_and_background_is_removed_before_i0`。

## 7. Ga2O3 價帶 DFT 分析（`Ga2O3_VB_Analyzer/`）

| 項目 | 方法 | 程式位置 | 文獻 |
|---|---|---|---|
| pDOS 來源 | Materials Project / pymatgen；Ga 配位以 CrystalNN 判斷 | `src/pdos_acquisition.py` | Jain et al., *APL Mater.* 1, 011002 (2013)；Ong et al., *Comput. Mater. Sci.* 68, 314 (2013) |
| 能量對齊 | E_rel = −(E − E_VBM)（DFT VBM，取不到時退回 E_F 並提示） | `materials_project_reference` | — |
| 截面加權 | 每個軌域 pDOS × 光電離截面（使用者輸入或上傳）；每個係數只乘一次 | `src/pdos_model.py` `apply_cross_sections` | Yeh & Lindau, *At. Data Nucl. Data Tables* 32, 1 (1985) |
| 展寬與擬合 | Gaussian / Lorentzian / Voigt 展寬後，以非負最小平方擬合實驗價帶 | `broaden_pdos`、`src/fitting.py` | 做法參考 Swallow et al., *Chem. Mater.* 32, 8460 (2020) |
| 軌域比例 | 各成分貢獻 = 係數 × 該成分在擬合範圍內的積分 | `fit_components` | — |

**限制**：程式沒有內建截面數值，未加權時介面會警告，此時的比例不能解讀為軌域貢獻。DFT（PBE）常低估能隙與 Ga 3d 結合能；線性外推的實驗 VBM 與 DFT VBM 也可能差數百 meV（Chambers et al. 2004）。

**驗證**：`test_pdos_percentages_use_component_areas`、`test_cross_section_factor_is_applied_once`。
