# Spectroscopy Data Processing GUI

## 專案概述

一個以 Streamlit 建構的光譜數據處理網頁應用程式，目前支援 XPS（X-ray Photoelectron Spectroscopy）、Raman、XRD（X-ray Diffraction）數據。使用者透過左側邊欄控制每個處理步驟，主區顯示圖表、峰值表格與匯出結果。

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

## 最近驗證

- `python3 -m py_compile app.py processing.py xrd_database.py peak_fitting.py`
- `despike_signal()` synthetic spike sanity check
- `fit_peaks()` synthetic Gaussian peaks sanity check
- `asls_background()` / `airpls_background()` synthetic fluorescence baseline sanity check

尚未完成：使用真實 Raman / XRD 檔案做完整 Streamlit 互動式 smoke test。

## 待開發模組

XAS、XES、SEM 框架已在 `DATA_TYPES` 定義，目前標示為 `ready: False`，選擇後會顯示「尚未開放」並停止。

Raman 後續可優化：
- 用真實檔案調整 `airPLS` / `AsLS` 預設參數
- 加入手動峰擬合中心與 FWHM 微調
- 加入處理前後比較視圖或 baseline preview

XRD 後續可優化：
- 自訂 reference CSV 匯入
- Scherrer 晶粒尺寸估算
- 更完整的 PDF/JCPDS 資料來源整合
