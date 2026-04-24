# Spectroscopy Data Processing GUI

## 專案概述

一個以 Streamlit 建構的光譜數據處理網頁應用程式，目前支援 XPS（X-ray Photoelectron Spectroscopy）、XES（X-ray Emission Spectroscopy）、Raman、XRD（X-ray Diffraction）數據。使用者透過左側邊欄控制每個處理步驟，主區顯示圖表、峰值表格與匯出結果。

## 執行方式

- Windows：雙擊 `啟動_Windows.bat`
- Mac：雙擊 `啟動_Mac.app`
- 安裝套件（首次使用）：雙擊 `安裝套件.bat`
- 直接執行：`streamlit run app.py`

## 檔案結構

```
Data Processing GUI/
├── app.py              # 主程式（UI 邏輯、數據讀取、圖表）
├── processing.py       # 純數值處理（背景扣除、歸一化）
├── peak_fitting.py     # 峰值擬合（Gaussian/Lorentzian/Voigt，使用 scipy）
├── xps_database.py     # XPS 峰位資料庫（~80 個元素的結合能與 FWHM）
├── xrd_database.py     # XRD 內建代表性參考峰資料庫
├── read_fits_image.py  # XES FITS primary image 讀取與 row/column projection
├── requirements.txt    # 依賴套件（含 scipy>=1.11）
├── 啟動_Windows.bat    # Windows 啟動腳本
├── 安裝套件.bat        # 套件安裝腳本
├── .streamlit/
│   └── config.toml    # Streamlit 設定（關閉檔案監視、遙測）
└── 啟動_Mac.app/       # Mac 啟動包
```

## 技術棧

- Python 3.14（路徑：`C:\Users\peili\AppData\Local\Python\pythoncore-3.14-64`）
- Streamlit >= 1.35
- NumPy >= 1.26（注意：`np.trapz` 已移除，需用 `np.trapezoid`）
- Pandas >= 2.0
- Plotly >= 5.20
- SciPy（interp1d、find_peaks、curve_fit、voigt_profile）

## UI 架構

### 左側邊欄（所有控制項）

每個模組都以左側邊欄作為主要控制區。多數步驟有「跳過（此步驟已完成）」勾選框，勾選後步驟標題變灰加刪除線、控制項收起、處理略過。

XPS 步驟順序：
1. **載入檔案** — 上傳一或多個 XPS .txt / .csv
2. **多檔平均** — 可跳過；插值後取平均；可疊加顯示原始個別曲線
3. **能量校正** — 可跳過；上傳標準品偵測峰值，計算 ΔE offset；峰值偵測圖在 expander 內
4. **背景扣除** — 可跳過；方法：不扣除 / 線性 / Shirley；背景計算區間滑桿在此步驟下；可疊加顯示背景基準線
5. **歸一化** — 可跳過；方法：不歸一化 / Min-Max / 峰值 / 面積 / 算術平均；歸一化區間滑桿在此步驟下

步驟標題用 `step_header(num, title, skipped)` 函式渲染，active = 藍色 badge，skipped = 灰色 badge + 刪除線。

Raman 步驟順序：
1. **載入檔案** — 上傳 Raman `.txt` / `.csv` / `.asc`，使用共用兩欄光譜 parser
2. **去尖峰** — Median despike，用於修正 cosmic ray 單點尖峰
3. **多檔平均** — 只在所有檔案共同重疊 Raman shift 區間插值平均，不使用外推值
4. **背景扣除** — 方法：不扣除 / 線性 / 多項式 / AsLS / airPLS
5. **平滑** — 方法：不平滑 / Moving average / Savitzky-Golay
6. **歸一化** — 方法：不歸一化 / Min-Max / 峰值 / 面積 / 算術平均
7. **峰值偵測** — 使用 `scipy.signal.find_peaks`，可設定 prominence、height、distance、最多標記峰數
8. **峰擬合** — 使用偵測峰作為初始值，支援 Voigt / Gaussian / Lorentzian，輸出 R²、FWHM、area、component 曲線

XRD 步驟順序：
1. **載入檔案** — 上傳 XRD `.txt` / `.csv` / `.xy` / `.asc`，兩欄預期為 `2θ` 與 intensity
2. **多檔平均** — 插值到共同 `2θ` grid 後平均
3. **平滑** — 方法：不平滑 / Moving average / Savitzky-Golay
4. **歸一化** — 方法：不歸一化 / Min-Max / 峰值 / 面積
5. **峰值偵測** — 輸出 `2theta_deg`、`d_spacing_A`、intensity、relative intensity、FWHM
6. **X 軸與 d-spacing** — 可選 Cu Kα、Cu Kα1、Cu Kα2、Co Kα、Mo Kα、Cr Kα、Fe Kα 或自訂波長；主圖可切換 `2θ` / `d-spacing (Å)`
7. **參考峰比對** — 以 `xrd_database.py` 的內建代表性峰表疊加 reference sticks 並做容差匹配

XES 步驟順序：
1. **載入 FITS** — 上傳 sample `.fits` / `.fit` / `.fts`，並可上傳 BG1（樣品前）與 BG2（樣品後）
2. **BG1/BG2 背景扣除** — 支援不扣除、BG1 only、BG2 only、平均背景、分點法 `BG_i = BG1 + w_i(BG2 - BG1)`
3. **影像修正** — 可用 FITS `EXPTIME` 做 counts/sec 正規化，並可用 local median 修正 hot pixels
4. **ROI 與積分** — 選擇 FITS plane、X/Y ROI、沿 Y 加總成 column spectrum 或沿 X 加總成 row spectrum
5. **多檔平均** — 對扣背景後的一維光譜做共同 pixel 範圍平均
6. **平滑** — 方法：不平滑 / Moving average / Savitzky-Golay
7. **歸一化** — 方法：不歸一化 / 峰值 / Min-Max / 面積
8. **X 軸校正** — detector pixel、線性係數或參考點擬合 pixel → emission energy
9. **峰值偵測** — 輸出 peak pixel；若已做能量校正，峰表也包含 `Energy_eV` 與 `FWHM_eV`

### 主區（右側）

- 頂部：**能量顯示範圍**滑桿（唯一在主區的控制項）
- **圖一**：背景扣除步驟視圖（原始曲線淡色 + 背景基準線（可選）+ 扣除後結果 + 背景區間紅色陰影）
- **圖二**：僅在歸一化啟用時出現，獨立 y 軸，顯示歸一化結果 + 歸一化區間藍色陰影
- 底部：**匯出**按鈕（處理後 CSV；有能量校正時另有校正後 CSV）

兩張圖 y 軸完全獨立，不會互相壓縮。

## 數據處理流程（processing.py）

XPS 處理管線：**背景扣除 → 歸一化**，兩步分開呼叫 `apply_processing`。

```python
# app.py 內的呼叫方式
y_bg, bg  = apply_processing(x, y,    bg_method, "none",        bg_x_start, bg_x_end)
y_final,_ = apply_processing(x, y_bg, "none",    norm_method,   norm_x_start, norm_x_end)
```

### 背景扣除方法

| 方法 | 說明 |
|---|---|
| `linear` | 連接區間兩端點的直線 |
| `shirley` | 迭代 Shirley 背景（累積積分法，20 次迭代） |
| `polynomial` | Raman 用多項式背景，適合簡單螢光背景 |
| `asls` | Raman 用 Asymmetric Least Squares baseline，適合螢光背景 |
| `airpls` | Raman 用 adaptive iteratively reweighted PLS baseline，較自適應 |

背景只在 `[bg_x_start, bg_x_end]` 區間內計算，區間外以兩端常數延伸。

Raman 的 AsLS / airPLS 參數：
- `baseline_lambda`：平滑強度，UI 以 `log10(λ)` 控制；越大背景越平
- `baseline_p`：AsLS 峰值抑制參數，預設 `0.01`
- `baseline_iter`：迭代次數，預設 `20`

### 歸一化方法

| 方法 | 說明 |
|---|---|
| `min_max` | 縮放至 [0, 1] |
| `max` | 除以選定區間內最大值 |
| `area` | 除以總面積（梯形積分，`np.trapezoid`） |
| `mean_region` | 除以選定區間內所有點的算術平均 y 值 |

### 共用處理 helper

- `despike_signal()`：Raman cosmic ray 去尖峰，回傳修正後訊號與 spike mask
- `smooth_signal()`：Moving average / Savitzky-Golay 平滑，Raman 與 XRD 共用
- `apply_normalization()`：只做歸一化，供 Raman / XRD 這類不一定需要背景扣除的流程使用
- `_detect_spectrum_peaks()`：Raman / XRD 共用的峰值偵測核心

## 能量校正

標準品對照表（`CALIB_STANDARDS`）：Au 4f7/2（84.0 eV）、Ag 3d5/2、Cu 2p3/2、Cu 3s、C 1s、Fermi edge、自訂。

流程：`find_peaks` 偵測最高峰 → 計算 `offset = ref_e - measured_e` → 匯出時將 `Energy_eV + offset`。校正後數據可在圖上疊加（虛線）。

## XPS 檔案解析

`parse_structured_xps` 解析含 `Dimension 1 scale=`（X 軸）和 `[Data 1]` / `Data=`（Y 軸）格式的結構化文字檔。支援編碼：utf-8、big5、cp950、latin-1、utf-16。

## XES FITS 檔案解析

`read_fits_image.py` 是 XES FITS primary image reader，不依賴 `astropy`。目前支援常見 `BITPIX`：8、16、32、-32、-64，使用 FITS big-endian byte order，以 NumPy `frombuffer` 讀取影像資料。讀取時會套用 `BSCALE` / `BZERO`，整數影像若有 `BLANK` 會轉成 `NaN`。

核心 API：
- `read_primary_image_bytes(raw, source=...)`：給 Streamlit uploader 使用
- `read_primary_image(path)`：保留命令列檔案讀取用途
- `FitsImage.as_array(plane=0)`：回傳 `(row, column)` 2D detector array
- `row_sums()` / `column_sums()`：快速匯出投影光譜

## Raman / XRD 檔案解析

`_parse_two_column_spectrum_bytes()` 是 Raman 與 XRD 共用的兩欄光譜 parser。它會嘗試多種編碼，尋找連續數字區塊並解析成 `(x, y)`；Raman 包裝為 `_parse_raman_bytes()`，XRD 包裝為 `_parse_xrd_bytes()`。

注意：`_is_numeric_line()` 內不要留下裸 list comprehension 或裸表達式，Streamlit 會把它當成要渲染的內容，導致上傳 Raman 檔案時右欄出現大量原始數字。

## Raman 模組目前狀態

- Raman 主流程在 `run_raman_ui()`
- 上傳後主區只顯示圖表與處理結果，不顯示原始文字數據
- 多檔平均只在共同重疊區間內插值，避免 `fill_value="extrapolate"` 產生假訊號
- 背景扣除可用 `linear`、`polynomial`、`asls`、`airpls`
- 平滑可用 `moving_average`、`savitzky_golay`
- 峰值偵測會輸出 `Raman_Shift_cm`、`Intensity`、`Relative_Intensity_pct`、`FWHM_cm`
- 峰擬合沿用 `peak_fitting.fit_peaks()`，以偵測到的峰當初始值，支援 Voigt / Gaussian / Lorentzian
- 匯出包含處理後曲線、峰值列表、擬合曲線、擬合峰表

## XRD 模組目前狀態

- XRD 主流程在 `run_xrd_ui()`
- `DATA_TYPES["XRD"]["ready"] = True`
- 支援 `.txt` / `.csv` / `.xy` / `.asc` 兩欄格式
- 主要處理：多檔平均、平滑、歸一化、峰值偵測
- `2θ -> d-spacing` 使用 Bragg law，波長表在 `XRD_WAVELENGTHS`
- X 軸可顯示 `2θ` 或 `d-spacing (Å)`，切到 d-spacing 時圖會反向顯示
- 參考峰資料放在 `xrd_database.py` 的 `XRD_REFERENCES`
- 參考峰比對可疊加 reference sticks、列出 reference table、列出 observed/reference match table
- 匯出包含處理後曲線、峰值列表、參考峰、參考匹配結果

## XES 模組目前狀態

- XES 主流程在 `run_xes_ui()`
- `DATA_TYPES["XES"]["ready"] = True`
- 支援 sample / BG1 / BG2 FITS primary image 上傳與影像 heatmap preview
- 支援多張 Dark/Bias FITS 上傳，平均後在 BG1/BG2 扣除前先套用影像層級扣除
- BG 分點法依序用 FITS header 時間、檔名自然排序或上傳順序計算 `w_i`
- 背景扣除在 2D detector image level 先做，再進入 ROI projection
- 可用 `EXPTIME` / `EXPOSURE` / `ITIME` / `ONTIME` 將 sample 與 BG 轉成 counts/sec 後再扣背景
- 可做 I0 / incident flux 正規化，支援所有 sample 共用單一 I0，或上傳 `File + I0` CSV 對照表
- 可選 Transpose array，對應舊版程式中影像 row/column 方向調整
- 可用 2D local median 修正 hot pixels / 單點異常亮點
- 可選 FITS plane、X/Y ROI、row/column projection、sum/mean reducer
- 可做 curvature correction / image straightening：在指定 column range 逐 row 找峰中心、用多項式擬合曲率、再沿 column 方向平移每列影像
- 可做 side-band background subtraction：沿 column projection 時用 Y side-band，沿 row projection 時用 X side-band，並依 signal ROI 寬度縮放背景
- 可做多檔平均、平滑、歸一化、pixel → emission energy 校正、峰值偵測；能量校正可手動填係數、手動填 reference points，或匯入 `Pixel, Energy_eV` CSV
- 匯出包含扣背景/side-band 後投影光譜、signal ROI projection、scaled side-band background、分點權重表與峰值列表
- 若啟用能量校正，圖表與匯出會同時保留 `Pixel` 與 `Energy_eV`
- 若啟用能量校正且做多檔平均，會先將各檔轉成共同 energy grid 後再平均；未啟用能量校正時維持共同 pixel grid 平均

### XES 進階處理完成度（2026-04-24 盤點）

| 項目 | 狀態 | 說明 |
|---|---|---|
| Dark / Bias frame 扣除 | 已完成 v1 | 支援獨立 Dark/Bias FITS 多檔上傳，依目前 plane 與 exposure 設定平均後，在 BG1/BG2 扣除前先套用到 sample/BG 影像 |
| Side-band background subtraction | 已完成 v1 | 支援 signal ROI 外的 A/B side-band；column projection 使用 Y side-band，row projection 使用 X side-band，匯出會保留 signal 與 scaled background |
| Hot pixel / cosmic ray mask | 已完成 v1 | 影像層級使用 local median filter 找正向異常點並替換，發生在 projection 前 |
| Curvature correction / image straightening | 已完成 v1 | 對應舊程式 `find curvature` / `shift image from curvature`；支援 column spectrum，依 row ROI 與 fitting column range 找 peak center、polyfit、逐 row shift |
| Pixel → Emission Energy 校正 | 已完成 v1 | 支援 `E = E0 + slope * pixel`，也支援參考點擬合 linear/quadratic `pixel -> Energy_eV`，並可匯入 `Pixel, Energy_eV` CSV |
| Exposure / I0 normalization | 已完成 v1 | 已支援 FITS `EXPTIME` / `EXPOSURE` / `ITIME` / `ONTIME` 轉 counts/sec，也支援手動共用 I0 與逐檔 I0 CSV |
| 多檔合併到共同 energy grid | 已完成 v1 | 未校正時用共同 pixel grid；啟用能量校正時各檔先轉 energy，再插值到共同 energy grid 後平均 |

### XES 背景類型釐清（2026-04-24）

目前確定正式必做流程先以教授提供/要求的 **BG1（樣品前背景）與 BG2（樣品後背景）分點扣除** 為主，之後接 **pixel → emission energy 能量校正**。

背景名詞定義：
- `BG1/BG2`：額外拍攝的完整背景 FITS，BG1 在樣品前、BG2 在樣品後；用分點公式估計每張 sample 對應背景，這是目前 XES 主流程必做項目。
- `Dark/Bias frame`：CCD/相機校正影像，通常是關 shutter、無 X-ray 或 zero/固定曝光取得，用來扣 detector offset/dark current；若實驗沒有提供這類檔案，就不要啟用。
- `Side-band background`：不是額外上傳的 BG1/BG2，而是同一張 sample 影像裡 signal stripe 旁邊的 ROI，用來估計 local background；若教授沒有要求或 ROI 意義不明，先不要啟用，避免過度扣背景。

UI/工作流建議：Dark/Bias 與 side-band 應視為「進階可選」功能，預設不作為使用者必填流程；後續可把 UI 文案改得更清楚，避免和 BG1/BG2 混淆。

2026-04-24 已完成 UI 文案釐清：
- Step 1 將 BG1/BG2 標示為樣品前/後背景必做，上傳 Dark/Bias 則標成進階可選 detector 校正檔。
- Step 2 改名為「前後背景影像扣除（BG1/BG2）」，並標示分點法為建議流程。
- Step 3 的 Dark/Bias 勾選標成進階可選，並提醒它不是 BG1/BG2。
- Step 4 的 side-band 勾選標成進階可選，並提醒它是同一張 sample 影像旁邊 ROI，不是 BG1/BG2；教授未要求時先不要啟用。

### XES 目前剩餘工作（2026-04-24）

以目前確定需求來看，XES 主流程已具備完整可用 v1；剩餘重點如下：
- 必做：用一組完整真實資料 `BG1 + 多張 sample + BG2` 再跑一次，確認分點權重順序、ROI 投影方向、曲率 fitting column range、拉直效果與輸出 CSV 欄位符合實驗習慣。
- 必做：等教授提供能量校正資料後，確認資料格式是 `pixel-energy 對照點`、標準 emission line、或校正係數；目前 UI 已支援線性係數、reference points 手動填表與 `Pixel, Energy_eV` CSV 匯入。
- 可選：若教授提供每張 sample 的 I0 / incident flux，可使用共用 I0 或逐檔 I0 CSV；若沒有資料就保持不使用。
- 可選：Dark/Bias 與 side-band 已有 v1，但除非教授或儀器資料明確要求，先不列入主流程。
- 工程整理：`read_fits_image.py` 是新檔案，若要提交版本控制需要一起納入。

## 側邊欄滑桿的 Session State 處理

`bg_range` 和 `norm_range` 滑桿的 min/max 依賴能量顯示範圍。每次渲染前先從 session_state 讀取前值並夾到合法範圍，避免 Streamlit 丟出 ValueError：

```python
_prev = st.session_state.get("bg_range", (_e0, _e1))
_lo = float(max(_e0, min(float(min(_prev)), _e1)))
_hi = float(max(_e0, min(float(max(_prev)), _e1)))
if _lo >= _hi:
    _lo, _hi = _e0, _e1
st.session_state["bg_range"] = (_lo, _hi)
```

## 啟動腳本優化

`啟動_Windows.bat` 使用 `start /B` 直接背景啟動（不經 PowerShell 包裝），輪詢 `/_stcore/health` 端點，伺服器就緒後立刻開瀏覽器，最多等 30 秒。`.streamlit/config.toml` 關閉檔案監視與遙測以加速啟動。

## XPS 進階功能（已完成）

| 功能 | 實作位置 |
|---|---|
| Tougaard 背景扣除 | `processing.py: tougaard_background()`；UI 在 step4 selectbox |
| Scofield RSF 原子濃度 | `xps_database.py: ELEMENT_RSF`；UI 在擬合結果下方的累積表 |
| 自旋軌道雙峰約束 | `peak_fitting.py: fit_peaks(doublet_pairs=...)`；UI 在 step6 peak checkboxes 下方 |
| 能量校正手動輸入 | step3 `number_input`：自動偵測失敗時可手動輸入峰位 |
| 多元素結果累積 | `st.session_state["xps_fit_history"]`；每次按「加入原子濃度表」追加 |

`apply_processing()` 已加入 `tougaard_B/C` 參數並透傳至 `apply_background()`。

## 最近驗證

- 2026-04-24：完成 XES curvature correction / image straightening v1，包含 Transpose array、曲率 fitting column range、polynomial order、cutoff、逐 row peak center、polyfit、shift image、曲率表檢視與 CSV 匯出；已通過 `python3 -m py_compile app.py read_fits_image.py processing.py peak_fitting.py xps_database.py xrd_database.py` 與 `git diff --check`。
- 2026-04-24：開始實作 XES curvature correction / image straightening，對齊舊版逆工程流程的 `find curvature` 與 `shift image from curvature`。
- 2026-04-24：使用者提供舊版 XES 逆工程程式截圖；初步判讀舊流程包含 open FITS、transpose、remove spike、row subset、sum spectrum、依峰位設定 column fitting range、find curvature、shift image from curvature、再 sum/save。現有 GUI 尚缺完整的 curvature detection / image straightening 流程。
- 2026-04-24：補齊 XES 剩餘處理程序 v1：I0 normalization、能量校正點 CSV 匯入、啟用能量校正時的共同 energy grid 平均；已通過 `python3 -m py_compile app.py read_fits_image.py processing.py peak_fitting.py xps_database.py xrd_database.py` 與 `git diff --check`。
- 2026-04-24：開始補齊 XES 剩餘處理程序，不等待教授能量校正資料；目標包含 I0 normalization、校正點 CSV 匯入與共同 energy grid 平均。
- 2026-04-24：整理 XES 目前剩餘工作；主流程 v1 已可用，後續重點是完整真實資料測試、教授能量校正資料格式、共同 energy grid 平均與可選 I0 normalization。
- 2026-04-24：XES UI 文案釐清後重新通過 `python3 -m py_compile app.py read_fits_image.py processing.py peak_fitting.py xps_database.py xrd_database.py` 與 `git diff --check`。
- 2026-04-24：依使用者確認將 XES UI 文案改清楚：BG1/BG2 為主流程，Dark/Bias 與 side-band 標示為進階可選，避免混淆。
- 2026-04-24：使用者釐清目前確定必做 XES 流程是 BG1/BG2 背景扣除與之後教授提供數據做能量校正；Dark/Bias 與 side-band 先定義為進階可選、有對應資料再啟用。
- 2026-04-24：釐清 XES `BG1/BG2` 與 `side-band background subtraction` 的概念差異；目前程式把 BG1/BG2 視為樣品前/後額外拍攝的完整背景 FITS，side-band 則視為同一張影像內 signal ROI 旁的背景 ROI。
- 2026-04-24：補上 side-band 小尺寸影像防護；重新通過 `python3 -m py_compile app.py read_fits_image.py processing.py peak_fitting.py xps_database.py xrd_database.py` 與 `git diff --check`。
- 2026-04-24：完成 XES Dark/Bias frame 扣除與 side-band background subtraction v1，並通過 `python3 -m py_compile app.py read_fits_image.py processing.py peak_fitting.py xps_database.py xrd_database.py`。
- 2026-04-24：開始補 XES Dark/Bias frame 扣除與 side-band background subtraction；目標是讓 raw FITS 先做影像層級前處理，再做 ROI 投影。
- 2026-04-24：使用者回報真實 XES 檔案測試成功；XES v1 目前已通過實際檔案資料流驗證。
- 2026-04-24：回覆使用者確認 XES 數據處理完成度；目前程式層級已完成 v1，仍需真實 XES FITS 做完整 Streamlit 操作驗證。
- `python3 -m py_compile app.py processing.py read_fits_image.py xps_database.py xrd_database.py peak_fitting.py` ✅（2026-04-24）
- `read_primary_image_bytes()` synthetic FITS sanity check
- `despike_signal()` synthetic spike sanity check
- `fit_peaks()` synthetic Gaussian peaks sanity check
- `asls_background()` / `airpls_background()` synthetic fluorescence baseline sanity check

尚未完成：使用真實 XPS / Raman / XRD 檔案做完整 Streamlit 互動式 smoke test；XES 已由使用者回報真實檔案測試成功。

## 待開發模組

XAS、SEM 框架已在 `DATA_TYPES` 定義，目前標示為 `ready: False`，選擇後會顯示「尚未開放」並停止。

XES 後續可優化：
- 加入多 ROI workflow
- 加入能量校正參考線資料庫
- 加入批次套用同一組 ROI / 校正參數的 workflow

Raman 後續可優化：
- 用真實檔案調整 `airPLS` / `AsLS` 預設參數
- 加入手動峰擬合中心與 FWHM 微調
- 加入處理前後比較視圖或 baseline preview

XRD 後續可優化：
- 自訂 reference CSV 匯入
- Scherrer 晶粒尺寸估算
- 更完整的 PDF/JCPDS 資料來源整合
