# Spectroscopy Data Processing GUI

## 專案概述

一個以 Streamlit 建構的光譜數據處理網頁應用程式，目前支援 XPS（X-ray Photoelectron Spectroscopy）、XES（X-ray Emission Spectroscopy）、Raman、XRD（X-ray Diffraction）數據。使用者透過左側邊欄控制每個處理步驟，主區顯示圖表、峰值表格與匯出結果。

## 執行方式

- Windows：雙擊 `啟動_Windows.bat`
- Mac：雙擊 `啟動_Mac.command`
- 安裝套件（首次使用）：雙擊 `安裝套件.bat`
- 直接執行：`streamlit run app.py`

## 檔案結構

```
Data-Processing-GUI-main/
├── app.py              # 主程式（page config、CSS、DATA_TYPES、radio selector、module dispatch，85 行）
├── core/
│   ├── __init__.py     # 共用 helper package
│   ├── parsers.py      # 共用文字光譜 parser（兩欄 / XPS 結構化格式）
│   ├── spectrum_ops.py # 共用光譜數值 helper（峰值偵測、插值、平均）
│   └── ui_helpers.py   # 共用 Streamlit UI helper（step_header、_next_btn、hex_to_rgba）
├── modules/
│   ├── __init__.py     # 各光譜類型模組 package
│   ├── raman.py        # Raman 完整 UI workflow（run_raman_ui）
│   ├── xes.py          # XES 完整 UI workflow（run_xes_ui + 27 個 helper）
│   ├── xps.py          # XPS 完整 UI workflow（run_xps_ui）
│   └── xrd.py          # XRD 完整 UI workflow（run_xrd_ui）
├── processing.py       # 純數值處理（背景扣除、歸一化）
├── peak_fitting.py     # 峰值擬合（Gaussian/Lorentzian/Voigt，使用 scipy）
├── xps_database.py     # XPS 峰位資料庫（~80 個元素的結合能、FWHM、RSF）
├── xrd_database.py     # XRD 內建代表性參考峰資料庫
├── read_fits_image.py  # XES FITS primary image 讀取與 row/column projection（不依賴 astropy）
├── requirements.txt    # 依賴套件（streamlit、pandas、numpy、plotly、scipy）
├── 啟動_Windows.bat    # Windows 啟動腳本
├── 安裝套件.bat        # Windows 套件安裝腳本
├── 啟動_Mac.command    # Mac 啟動腳本（shell script）
└── .streamlit/
    └── config.toml    # Streamlit 設定（關閉檔案監視、遙測）
```

## 技術棧

- Python 3.14（Mac 路徑：`/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`）
- Streamlit >= 1.35
- NumPy >= 1.26（注意：`np.trapz` 已移除，需用 `np.trapezoid`）
- Pandas >= 2.0
- Plotly >= 5.20
- SciPy（interp1d、find_peaks、curve_fit、voigt_profile）

## UI 架構

### 左側邊欄（所有控制項）

每個模組都以左側邊欄作為主要控制區。多數步驟有「跳過（此步驟已完成）」勾選框，勾選後步驟標題變灰加刪除線、控制項收起、處理略過。

步驟標題用 `core/ui_helpers.py` 的 `step_header(num, title, skipped)` 函式渲染，active = 藍色 badge，skipped = 灰色 badge + 刪除線。

**XPS 步驟順序：**
1. 載入檔案 — 上傳一或多個 XPS `.txt` / `.csv`
2. 多檔平均 — 可跳過；插值後取平均；可疊加顯示原始個別曲線
3. 能量校正 — 可跳過；上傳標準品偵測峰值，計算 ΔE offset；峰值偵測圖在 expander 內
4. 背景扣除 — 可跳過；方法：不扣除 / 線性 / Shirley / Tougaard
5. 歸一化 — 可跳過；方法：不歸一化 / Min-Max / 峰值 / 面積 / 算術平均
6. 峰值擬合 — Voigt / Gaussian / Lorentzian；支援自旋軌道雙峰約束、Scofield RSF 原子濃度累積表

**Raman 步驟順序：**
1. 載入檔案 — 上傳 Raman `.txt` / `.csv` / `.asc`
2. 去尖峰 — Median despike，修正 cosmic ray 單點尖峰
3. 多檔平均 — 只在共同重疊 Raman shift 區間插值平均，不外推
4. 背景扣除 — 方法：不扣除 / 線性 / 多項式 / AsLS / airPLS
5. 平滑 — 方法：不平滑 / Moving average / Savitzky-Golay
6. 歸一化 — 方法：不歸一化 / Min-Max / 峰值 / 面積 / 算術平均
7. 峰值偵測 — scipy.signal.find_peaks，可設定 prominence、height、distance、最多標記峰數
8. 峰擬合 — 支援 Voigt / Gaussian / Lorentzian，輸出 R²、FWHM、area、component 曲線

**XRD 步驟順序：**
1. 載入檔案 — 上傳 XRD `.txt` / `.csv` / `.xy` / `.asc`，兩欄為 `2θ` 與 intensity
2. 多檔平均 — 插值到共同 `2θ` grid 後平均
3. 平滑 — 方法：不平滑 / Moving average / Savitzky-Golay
4. 歸一化 — 方法：不歸一化 / Min-Max / 峰值 / 面積
5. 峰值偵測 — 輸出 `2theta_deg`、`d_spacing_A`、intensity、relative intensity、FWHM
6. X 軸與 d-spacing — 可選 Cu Kα、Cu Kα1/2、Co Kα、Mo Kα、Cr Kα、Fe Kα 或自訂波長；主圖可切換 `2θ` / `d-spacing (Å)`
7. 參考峰比對 — 以 `xrd_database.py` 疊加 reference sticks，做容差匹配

**XES 步驟順序：**
1. 載入資料 — 可選 Raw FITS（sample + BG1/BG2，可選 Dark/Bias）或已處理 1D 光譜（兩欄 X / intensity）
2. BG1/BG2 光譜背景扣除 — 各自轉成 1D 光譜後做分點法 `BG_i = BG1 + w_i(BG2 - BG1)`
3. 影像修正（FITS 模式）— EXPTIME counts/sec 正規化、hot pixel local median 修正
4. ROI 與積分（FITS 模式）— 選擇 plane、X/Y ROI、column/row projection；可做曲率校正與 side-band 扣除
5. 多檔平均 — 共同 pixel grid（未校正）或共同 energy grid（能量校正後）
6. 平滑 — 方法：不平滑 / Moving average / Savitzky-Golay
7. 歸一化 — 方法：不歸一化 / 峰值 / Min-Max / 面積
8. X 軸校正 — 線性係數或參考點擬合 pixel → emission energy，可匯入 `Pixel, Energy_eV` CSV
9. 峰值偵測 — 輸出 peak pixel；若已做能量校正，峰表也包含 `Energy_eV` 與 `FWHM_eV`

### 主區（右側）

- 圖表顯示處理前後對比、背景基準線（可選）、背景/歸一化區間陰影
- 歸一化後出現獨立第二張圖（y 軸不互相壓縮）
- 底部：匯出 CSV 按鈕

## 數據處理（processing.py）

### 背景扣除方法

| 方法 | 說明 |
|---|---|
| `linear` | 連接區間兩端點的直線 |
| `shirley` | 迭代 Shirley 背景（累積積分法，20 次迭代），XPS 用 |
| `tougaard` | Tougaard 背景，XPS 用；參數 B/C 可調 |
| `polynomial` | 多項式背景，Raman 用 |
| `asls` | Asymmetric Least Squares baseline，Raman 用；lambda/p/iter 可調 |
| `airpls` | adaptive iteratively reweighted PLS baseline，Raman 用 |

背景只在 `[bg_x_start, bg_x_end]` 區間內計算，區間外以兩端常數延伸。

### 歸一化方法

| 方法 | 說明 |
|---|---|
| `min_max` | 縮放至 [0, 1] |
| `max` | 除以選定區間內最大值 |
| `area` | 除以總面積（梯形積分，`np.trapezoid`） |
| `mean_region` | 除以選定區間內所有點的算術平均 y 值 |

### 共用處理 helper

- `core/parsers.py: parse_two_column_spectrum_bytes()` — Raman、XRD、XES 已處理 1D 光譜共用 parser；嘗試多種編碼，自動找連續數字區塊
- `core/parsers.py: parse_xps_bytes()` — XPS 專用；先嘗試兩欄 CSV，fallback 到含 `Dimension 1 scale=` / `[Data 1]` 的結構化格式；支援 utf-8 / big5 / cp950 / latin-1 / utf-16
- `core/spectrum_ops.py: detect_spectrum_peaks()` — Raman / XRD / XES 共用峰值偵測核心
- `core/spectrum_ops.py: interpolate_spectrum_to_grid()` / `mean_spectrum_arrays()` — 多檔平均共用插值 helper
- `processing.py: despike_signal()` — Raman cosmic ray 去尖峰
- `processing.py: smooth_signal()` — Moving average / Savitzky-Golay，Raman 與 XRD 共用
- `processing.py: apply_normalization()` — 只做歸一化，供 Raman / XRD 使用

## XES FITS 檔案解析（read_fits_image.py）

不依賴 `astropy`。支援 BITPIX：8、16、32、-32、-64；套用 `BSCALE` / `BZERO`；整數影像若有 `BLANK` 轉成 `NaN`。

核心 API：
- `read_primary_image_bytes(raw, source=...)` — Streamlit uploader 用
- `FitsImage.as_array(plane=0)` — 回傳 `(row, column)` 2D detector array
- `row_sums()` / `column_sums()` — 快速投影光譜

## XPS 進階功能

| 功能 | 實作位置 |
|---|---|
| Tougaard 背景扣除 | `processing.py: tougaard_background()`；UI 在 step 4 |
| Scofield RSF 原子濃度 | `xps_database.py: ELEMENT_RSF`；UI 在擬合結果下方累積表 |
| 自旋軌道雙峰約束 | `peak_fitting.py: fit_peaks(doublet_pairs=...)`；UI 在 step 6 |
| 能量校正手動輸入 | step 3 number_input：自動偵測失敗時可手動輸入峰位 |
| 多元素結果累積 | `st.session_state["xps_fit_history"]`；每次按「加入原子濃度表」追加 |

能量校正標準品（`CALIB_STANDARDS`）：Au 4f7/2（84.0 eV）、Ag 3d5/2、Cu 2p3/2、Cu 3s、C 1s、Fermi edge、自訂。

## XES 進階功能

| 功能 | 狀態 |
|---|---|
| Dark / Bias frame 扣除 | 已完成 v1；進階可選 |
| Side-band background subtraction | 已完成 v1；進階可選 |
| Hot pixel / cosmic ray mask | 已完成 v1；local median filter |
| Curvature correction / image straightening | 已完成 v1；逐 row 找峰 → polyfit → shift |
| Pixel → Emission Energy 校正 | 已完成 v1；線性係數 / 參考點 / CSV 匯入 |
| Exposure / I0 normalization | 已完成 v1；EXPTIME 或手動 I0 |
| 多檔合併到共同 energy grid | 已完成 v1 |

**背景名詞定義：**
- `BG1/BG2`：樣品前/後額外拍攝的完整背景 FITS，分點法是主流程必做項目
- `Dark/Bias frame`：CCD detector 校正影像，進階可選；無儀器資料時不啟用
- `Side-band background`：同一張影像 signal stripe 旁邊的 ROI；教授未要求時不啟用

## 側邊欄滑桿的 Session State 處理

`bg_range` 和 `norm_range` 滑桿的 min/max 依賴能量顯示範圍。每次渲染前先夾到合法範圍，避免 Streamlit 丟出 ValueError：

```python
_prev = st.session_state.get("bg_range", (_e0, _e1))
_lo = float(max(_e0, min(float(min(_prev)), _e1)))
_hi = float(max(_e0, min(float(max(_prev)), _e1)))
if _lo >= _hi:
    _lo, _hi = _e0, _e1
st.session_state["bg_range"] = (_lo, _hi)
```

## 啟動腳本

`啟動_Mac.command`：hardcode Python 路徑 `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`，輪詢 `/_stcore/health` 最多 30 秒後開瀏覽器。

`啟動_Windows.bat`：自動偵測 `py` 或 `python`，檢查 streamlit 是否已安裝，開背景視窗後輪詢 health endpoint 再開瀏覽器。

`安裝套件.bat`：自動偵測 Python，執行 `pip install -r requirements.txt`。

`.streamlit/config.toml`：關閉檔案監視（`fileWatcherType = "none"`）與使用統計（`gatherUsageStats = false`）以加速啟動。

## 注意事項

- `is_numeric_line()` 內不要留下裸 list comprehension 或裸表達式，Streamlit magic mode 會把它渲染成輸出。
- `np.trapz` 已從 NumPy >= 2.0 移除，一律用 `np.trapezoid`。
- XES FITS 流程：影像層級先做 Dark/Bias、EXPTIME、hot pixel、transpose、curvature、ROI sum → 得到每張 1D 光譜 → 光譜層級再做 BG1/BG2 分點扣除、I0、平滑、歸一化、能量校正。

## 待開發模組

XAS、SEM 已在 `DATA_TYPES` 定義，標示為 `ready: False`，選擇後顯示「尚未開放」。

## 後續優化方向

**XES：**
- 加入多 ROI workflow
- 加入能量校正參考線資料庫
- 加入批次套用同一組 ROI / 校正參數的 workflow

**Raman：**
- 用真實檔案調整 airPLS / AsLS 預設參數
- 加入手動峰擬合中心與 FWHM 微調
- 加入處理前後比較視圖或 baseline preview

## Raman 進階功能（2026-04-25 新增）

| 功能 | 說明 |
|---|---|
| 基板訊號扣除 | Step 1 expander；上傳裸基板光譜，對齊指定峰位（預設 Si 520.7 cm⁻¹）後縮放並扣除；自動補償不同曝光時間／次數的強度差異；`data_dict_original` 保存扣除前備份 |
| 局部自適應靈敏度 | Step 7 `maximum_filter1d` 滑動窗口；讓強峰（如 Si 520）旁邊的弱峰也能被偵測到 |
| 限制偵測 X 範圍 | Step 7 可指定起點／終點，只在薄膜訊號區間搜尋峰值 |
| 放大顯示 | 主圖下方獨立放大圖，y 軸自動縮放到指定 X 範圍；sidebar 滑桿控制 |
| Raman 參考峰資料庫 | `raman_database.py: RAMAN_REFERENCES`；14 種材料（2 基板 + 12 薄膜）；在圖上疊加虛線 sticks，可顯示峰標籤 |
| 峰位管理表 + 聯合擬合 | Step 8 主區；下拉選基板 / 薄膜材料自動帶入候選峰；峰位表新增 `材料`、`峰類別`、`模式 / 簡稱`、`峰名稱`、`備註` 欄位，可直接編輯位置與 FWHM；啟用欄控制是否納入擬合；「▶ 執行擬合」按鈕觸發，結果存入 session_state 並持續顯示 |
| Step 7 即時峰值預覽 | `run_peak_detection = step6_done and not skip_peaks`；調整滑桿即時更新，不需按「下一步」；「下一步」只負責解鎖 Step 8 |
| 數值新增峰位 | Step 8 改為數值表單新增峰位；可指定材料、峰位、模式 / 簡稱、峰類別、初始 FWHM、峰名稱與備註；若材料對應 `RAMAN_REFERENCES`，會依最近文獻峰自動帶入模式標籤、主峰/次峰分類與說明；不再使用點圖吸附新增峰位。 |
| `data_editor` 穩定性 | 加入 `_EDITOR_WIDGET_KEY = "raman_peak_editor_widget"` 固定 key；載入峰位與清空時 `st.session_state.pop(_EDITOR_WIDGET_KEY, None)` 強制重新初始化 widget，避免勾選 checkbox 時狀態不同步的問題（2026-04-25 修正）。 |

**基板扣除實作細節：**
- `scale = sample_peak_int / sub_peak_int`，15 cm⁻¹ 窗口找峰
- 單檔模式：在 per-file 迴圈開頭加入原始曲線（扣除前）與縮放基板曲線
- 平均模式：在 `for fname, (xv, yv) in data_dict.items():` 迴圈加入對應原始與縮放基板曲線
- `sub_scale_info` caption 顯示在去尖峰摘要之後

**XRD：**
- 自訂 reference CSV 匯入
- Scherrer 晶粒尺寸估算
- 更完整的 PDF/JCPDS 資料來源整合

## 重構完成紀錄（2026-04-25）

從原本 4701 行單一 `app.py` 分 12 個階段漸進式重構為模組化架構，最終 `app.py` 縮減至 **85 行**。

| 階段 | 說明 | app.py 行數 |
|---|---|---|
| 1 | 新增 `core/parsers.py`，抽出兩欄光譜共用 parser | — |
| 2 | 新增 `core/spectrum_ops.py`，抽出峰值偵測核心 | — |
| 3 | `core/spectrum_ops.py` 補插值與平均 helper | — |
| 4 | 新增 `modules/xrd.py`，搬出 XRD 純 helper | — |
| 5 | 新增 `modules/raman.py`，搬出 Raman 峰值表 helper | — |
| 6 | XPS parser 搬到 `core/parsers.py` | — |
| 7 | 新增 `modules/xps.py`，搬出 XPS 校正標準、色盤、週期表 | — |
| 8 | 新增 `modules/xes.py`，搬出 XES 峰值表與自然排序 helper | — |
| 9 | 新增 `core/ui_helpers.py`；XRD 完整 UI workflow → `modules/xrd.py` | 4701 → 3993 |
| 10 | Raman 完整 UI workflow → `modules/raman.py` | 3993 → 3066 |
| 11 | XES 完整 UI workflow（27 helper + run_xes_ui）→ `modules/xes.py` | 3066 → 916 |
| 12 | XPS 完整 UI workflow → `modules/xps.py` | 916 → **85** |

最終驗證：`python3 -m py_compile app.py core/__init__.py core/parsers.py core/spectrum_ops.py core/ui_helpers.py modules/__init__.py modules/raman.py modules/xes.py modules/xps.py modules/xrd.py read_fits_image.py processing.py peak_fitting.py xps_database.py xrd_database.py` ✅ 與 `git diff --check` ✅（2026-04-25）

## 最近動作（2026-04-25）

- 閱讀並盤點 `CLAUDE.md`，確認目前主程式已完成 12 階段重構、`app.py` 縮減至 85 行，`core/` 與 `modules/` 架構已成形。
- 重新閱讀 `CLAUDE.md` 後，盤點 `modules/raman.py` 與 `raman_database.py`，確認 Raman Step 8 目前仍保留 `plotly_events` 點圖新增峰位流程，且峰位管理表只有簡短 `標籤`，缺少材料、主峰/次峰分類與備註欄位，後續將改為數值新增峰位表單並整理命名。
- 更新 `modules/raman.py` 與 `peak_fitting.py`：移除 Raman Step 8 的點圖新增峰位流程，改為數值新增峰位表單；峰位管理表新增 `材料`、`峰類別`、`顯示名稱`、`備註` 欄位，參考峰會自動標示主峰 / 強峰 / 次峰 / 弱峰，擬合結果表與 component 欄名同步帶出新命名；同時移除未再使用的 `streamlit-plotly-events` 依賴。
- 驗證完成：`python3 -m py_compile ...` ✅、`git diff --check` ✅，並以 `NiO 1090 cm⁻¹` 做 helper sanity check，成功自動產生 `NiO 主峰 2M/2LO`、`主峰`、`2M/2LO` 的命名與分類。
- 重新閱讀 `CLAUDE.md` 並檢視 Raman 擬合結果表後，確認目前使用者在「看完擬合結果再回上方逐一取消峰位」的流程上負擔偏重；後續優化方向應集中在：加入 `理論峰位 Ref_cm`、`偏移 Delta_cm`、批次快速取消規則（如 `Area=0` / `Area_pct 過低` / `偏移過大`），並避免上下兩處同時可勾選造成雙重操作來源。
- 更新 `modules/raman.py`：新增 `Peak_ID`、`理論位置_cm` 追蹤欄位，擬合結果表加入 `Ref_cm`、`Delta_cm`、`Quality_Flag`；審核區新增 `停用 Area=0`、`停用 Area_pct 過低`、`停用偏移過大`、`本次只留主峰/強峰`、`恢復本次擬合峰`、`手動停用選取峰`，並在套用後自動同步上方峰位表與重新擬合，避免來回上下捲動逐筆取消。
- 驗證完成：`python3 -m py_compile ...` ✅、`git diff --check` ✅；helper sanity check 顯示 `β-Ga₂O₃` 475 cm⁻¹ 會命名為 `β-Ga₂O₃ 強峰 Ag [475]`，品質旗標可正確產生 `Area=0；|Δ|>10`；review 範圍測試確認停用 `RPK002` 時不會影響不屬於本次擬合的 `RPK099`。
- 重新閱讀 `CLAUDE.md` 後，對 Raman 現況做整體判斷：目前已從「能用但難管理」提升到「研究操作上可用、而且逐漸有審核 workflow」的狀態；優點是命名、理論峰位對照、批次停用與單一資料來源都已明顯改善，主要剩餘問題集中在峰位表欄位偏多、擬合結果表仍可再加視覺強調與可疑峰排序/過濾體驗優化。
- 重新閱讀 `CLAUDE.md` 後，規劃下一輪 Raman UX 優化方向：1. 峰位管理表加入簡潔/進階顯示與快速整理操作，降低欄位密度；2. 擬合圖加入更清楚的 `Peak_ID` / hover 對照，讓圖與表可以快速對號；3. 擬合審核表補摘要、過濾模式與更清楚的可疑峰排序，讓篩峰流程更順手。
- 更新 `modules/raman.py`：峰位管理表新增峰數摘要、簡潔表格模式、依位置排序 / 啟用全部 / 全部停用快捷操作；擬合圖新增 `Peak_ID` 標記與更完整 hover 資訊；擬合審核表新增峰數摘要、顯示過濾模式（全部/可疑/Area=0/低面積/偏移大）與排序模式，整體操作流程朝「先看圖與摘要、再在下方審核篩峰」優化。
- 驗證完成：`python3 -m py_compile ...` ✅、`git diff --check` ✅；helper sanity check 確認峰位排序會先列出已啟用且依位置排序的 `RPK001 / RPK002 / RPK003`，顯示名稱 helper 仍可正確輸出 `β-Ga₂O₃ 強峰 Ag [475]`，表示簡潔表格模式與圖/表對照命名的底層資料仍一致。
- 重新閱讀 `CLAUDE.md` 並查閱 `raman_database.py` 後，開始針對實際樣品 `NiO / β-Ga₂O₃ / n-Si` 規劃 Raman 處理策略；目前已確認可直接使用的參考峰包含 Si 520.7 / 960、β-Ga₂O₃ 144/170/200/320/347/416/475/630/651/767，以及 NiO 457/570/730/1090，後續處理建議將以「先辨識 Si 基板、再分離 β-Ga₂O₃ 與 NiO 特徵峰」為主軸。
- 重新閱讀 `CLAUDE.md` 後，實際分析使用者提供的 Raman 檔案 `/Users/liupeicheng/Downloads/1019 45-5 n-Si 1_ 30s 20p 50X.txt`：檔案為正常兩欄格式，範圍 `67.2–2003.6 cm⁻¹`、共 `1024` 點；以 `airPLS + SG smooth` 初步篩峰後，最明顯訊號為 `Si 520.8 cm⁻¹`，其次可見 `Si 302` 與 `~980 cm⁻¹` 區域訊號；局部參考對照顯示 β-Ga₂O₃ 在 `416/475/630/651/767` 區域有弱到中等結構，NiO 在 `~730` 與 `~1090` 區域也有候選訊號，其中 `1090` 最值得保留；全域 12 峰 Voigt 試擬合得到 `R² ≈ 0.9971`，但部分弱峰 FWHM 過大或 area≈0，代表這張樣品目前應以「Si 基板很強、NiO 1090 與部分 β-Ga₂O₃ 峰弱訊號疊加」來解讀，不適合一次把所有理論峰都當成等權重有效峰。
- 重新閱讀 `CLAUDE.md` 後，針對使用者詢問「是否還有需要優化，因為後續會大量用於 Raman 研究與發表」做整體判斷：目前 Raman workflow 已很適合探索、初步分析與日常研究操作，但若要往發表級、可追溯、可批次重現的等級走，下一優先應放在 1. 參數/版本/provenance 匯出與鎖定、2. 批次處理 preset 與同條件套用、3. 擬合結果 QC/警告的系統化摘要、4. 發表用圖匯出一致性，而不是再一直增加單點功能。
- 重新閱讀 `CLAUDE.md` 後，開始把 Raman workflow 往「研究/發表可追溯」方向補完：在 `modules/raman.py` 新增 Raman preset 匯入/匯出、擬合後 `QC summary` 統計、發表用圖 helper、擬合歷史暫存結構與處理報告匯出骨架，並將這些功能接到既有 Step 8 與匯出區，避免額外產生第二套平行流程。
- 更新 `modules/raman.py`：擬合完成後新增「發表用圖匯出」與「擬合歷史比較 / 統計」兩個區塊；前者可匯出 HTML，若環境已安裝 `kaleido` 也可直接匯出 SVG / PNG，後者可用 `Run_Label` 保存每次擬合結果並自動產生跨次峰位統計；底部匯出區同步新增 `raman_processing_report` JSON 與 `raman_fit_qc_summary` CSV，內容包含輸入檔名、基板扣除、各步驟參數、峰偵測設定、當前峰位表、擬合摘要與 QC 摘要，方便日後重現與整理發表圖表。
- 另外修正 Raman 匯出區的流程安全性：初始化 `skip_fit = False`，避免使用者尚未走到 Step 8 時就觸發匯出區而出現 runtime NameError；`fit_history_df` 若 session state 內型別異常也會先落回空 DataFrame。
- 驗證完成：`python3 -m py_compile app.py core/__init__.py core/parsers.py core/spectrum_ops.py core/ui_helpers.py modules/__init__.py modules/raman.py modules/xes.py modules/xps.py modules/xrd.py read_fits_image.py processing.py peak_fitting.py xps_database.py xrd_database.py` ✅、`git diff --check` ✅；額外以 publication helper 做 sanity check，確認 `_build_publication_fit_figure(...)` 可正常建立含實驗曲線 / 擬合包絡 / component 的 Plotly figure（`raman_publication_helper_ok 3`）。
- 重新閱讀 `CLAUDE.md` 後，確認 Raman 在「可追溯匯出」已補齊一輪，下一個更值得補的是科學判讀效率：直接在主流程中加入處理前後比較與 baseline preview，而不是只靠下載 CSV 或盯著主圖上的所有 trace 混在一起看。
- 更新 `modules/raman.py`：新增 `_process_column_display_name()` 與 `_default_compare_columns()` helper，並把 `raman_compare_*` 狀態納入 preset；在主圖與 zoom panel 下方新增「處理前後比較 / Baseline Preview」區塊，可選資料集、選擇要對照的處理階段（原始 / 背景基準線 / 背景扣除後 / 平滑後 / 歸一化後）、限制比較區間，直接疊圖檢查 baseline 是否過度扣除、平滑是否扭曲峰形。
- 驗證完成：`python3 -m py_compile ...` ✅、`git diff --check` ✅；新增 compare helper sanity check，`_default_compare_columns(['Average_raw', 'Background', 'Average_bg_subtracted', 'Average_smoothed', 'Average_normalized'])` 會正確回傳 `['Average_raw', 'Background', 'Average_bg_subtracted', 'Average_smoothed']`，`_process_column_display_name('Background')` 會輸出 `背景基準線`，`_process_column_display_name('Average_normalized')` 會輸出 `歸一化後`。
- 重新閱讀 `CLAUDE.md` 後，開始補 Raman 的「手動峰擬合中心與 FWHM 微調」這個原先列在待優化清單中的項目；考量峰位表原本雖可編輯，但使用者在看完 fit 結果後還要回頭手抄數值很麻煩，因此改成在擬合結果區直接提供下一輪初值回填流程。
- 更新 `modules/raman.py`：新增 `_apply_fit_tuning_to_peak_df()` helper，並在 Step 8 擬合結果區加入「下一輪初值微調」expander；表格會列出 `Peak_ID / Peak_Name / Ref_cm / Center_cm / FWHM_cm / Quality_Flag`，並提供可編輯的 `下一輪位置_cm / 下一輪FWHM_cm` 與 `套用` checkbox。使用者可直接在這裡微調數值，按下「套用到峰位表並重擬合」後，程式會只更新上方峰位表的 `位置_cm` 與 `初始_FWHM_cm`，保留理論峰位與命名欄位不變，然後自動重擬合。
- 驗證完成：`python3 -m py_compile ...` ✅、`git diff --check` ✅；新增 fit tuning helper sanity check，對 `RPK001` 套用 `1091.2 / 18.5` 後可正確更新第一列，而未勾選的 `RPK002` 仍維持 `521.0 / 8.0`，確認回填只影響被選取的峰。
- 重新閱讀 `CLAUDE.md` 後，決定把 Raman 的微調流程再往前整合成真正的「一輪收斂」版本：不只允許逐峰手調，而是補上批次勾選、批次填入策略、以及直接停用勾選峰，避免使用者在 review 區與 tune 區來回切換。
- 更新 `modules/raman.py`：新增 `_fit_summary_signature()`、`_recommend_fit_tuning_action()`、`_build_fit_tuning_table()`、`_set_fit_tuning_selection()`、`_fill_selected_fit_tuning_rows()` helper，讓「下一輪初值微調」有自己的穩定資料來源與 fit 簽名刷新機制；微調表現在新增 `Delta_cm`、`目前初始位置_cm`、`目前初始FWHM_cm`、`建議` 欄位，並支援快速按鈕 `勾選全部峰 / 勾選可疑峰 / 勾選偏移大 / 勾選 Area=0 / 清除勾選`，以及批次填入策略 `位置：本次中心 / 理論位置 / 目前初始位置`、`FWHM：本次 FWHM / 本次 FWHM（上限） / 目前初始 FWHM`；勾選後可直接「套用到峰位表並重擬合」或「停用勾選峰並重擬合」。
- 驗證完成：`python3 -m py_compile ...` ✅、`git diff --check` ✅；新增批次微調 helper sanity check，當 `RPK001 / RPK003` 被標為可疑峰並套用 `位置=理論位置`、`FWHM=本次值但上限 60` 時，會得到 `selected [True, False, True]`、`centers [475.0, 520.8, 1090.0]`、`fwhm [60.0, 7.2, 60.0]`，表示快速勾選與批次填入邏輯正常。
- 重新閱讀 `CLAUDE.md` 後，開始處理右欄「新圖出現時自動捲動置中」需求；先盤點 Raman / XPS / XRD 在背景扣除與歸一化後的 `st.plotly_chart(...)` 出圖位置，並確認這類情境最適合用共用 UI helper 實作，而不是在單一模組內各自塞重複 JS。
- 更新 `core/ui_helpers.py`：新增 `scroll_anchor(anchor_id)` 與 `auto_scroll_on_appear(anchor_id, visible, state_key, block=\"center\")` 共用 helper，利用錨點與 `window.parent.document.getElementById(...).scrollIntoView({behavior:\"smooth\", block:\"center\"})` 在新圖首次出現時平滑捲動到畫面中央；session state 會記錄前一次可見狀態，避免每次 rerun 都強制亂跳。
- 更新 `modules/raman.py`、`modules/xps.py`、`modules/xrd.py`：在背景扣除或歸一化結果圖前插入對應錨點，並在圖真正出現時觸發自動捲動；Raman / XPS 的背景結果圖會在 `bg_method != \"none\"` 首次成立時自動捲到圖一，Raman / XPS / XRD 的歸一化圖則會在 `norm_method != \"none\"` 首次成立時自動捲到圖二；若之後切回 `none`，狀態也會重置，下一次重新開啟時仍可再次自動捲動。
- 驗證完成：`python3 -m py_compile app.py core/__init__.py core/parsers.py core/spectrum_ops.py core/ui_helpers.py modules/__init__.py modules/raman.py modules/xes.py modules/xps.py modules/xrd.py read_fits_image.py processing.py peak_fitting.py xps_database.py xrd_database.py` ✅、`git diff --check` ✅；目前尚未做 Streamlit 實際互動 smoke test，但靜態語法與 diff 檢查已通過。
- 重新閱讀 `CLAUDE.md` 後，依照使用者追加需求，開始補 Raman Step 8「按峰擬合後跳出的峰位管理表」自動捲動；盤點 `modules/raman.py` 後確認峰位管理表是跟著 `run_peak_fit` 首次變成 `True` 才會顯示，因此應直接綁在這個可見狀態，而不是綁在 expander 開關或按鈕事件本身。
- 更新 `modules/raman.py`：在 `if run_peak_fit:` 區塊開頭加入 `scroll_anchor("raman-fit-management")`，並在峰位管理 expander 渲染完成後呼叫 `auto_scroll_on_appear("raman-fit-management", visible=True, state_key="raman_scroll_fit_management", block="start")`；當 `run_peak_fit` 不成立時則同步重置 state，確保之後再次進入 Step 8 仍會自動捲回峰位管理區塊頂端。
- 驗證完成：`python3 -m py_compile modules/raman.py core/ui_helpers.py app.py modules/xps.py modules/xrd.py modules/xes.py processing.py peak_fitting.py` ✅、`git diff --check` ✅；目前尚未做 Streamlit 互動 smoke test，但靜態檢查已通過。
