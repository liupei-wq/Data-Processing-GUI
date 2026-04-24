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
