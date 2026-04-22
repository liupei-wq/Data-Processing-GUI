# Spectroscopy Data Processing GUI

## 專案概述

一個以 Streamlit 建構的光譜數據處理網頁應用程式，目前支援 XPS（X-ray Photoelectron Spectroscopy）數據。使用者透過左側邊欄控制每個處理步驟，主區顯示圖表結果。

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
- SciPy（interp1d、find_peaks）

## UI 架構

### 左側邊欄（所有控制項）

每個步驟有「跳過（此步驟已完成）」勾選框，勾選後步驟標題變灰加刪除線、控制項收起、處理略過。

步驟順序：
1. **載入檔案** — 上傳一或多個 XPS .txt / .csv
2. **多檔平均** — 可跳過；插值後取平均；可疊加顯示原始個別曲線
3. **能量校正** — 可跳過；上傳標準品偵測峰值，計算 ΔE offset；峰值偵測圖在 expander 內
4. **背景扣除** — 可跳過；方法：不扣除 / 線性 / Shirley；背景計算區間滑桿在此步驟下；可疊加顯示背景基準線
5. **歸一化** — 可跳過；方法：不歸一化 / Min-Max / 峰值 / 面積 / 算術平均；歸一化區間滑桿在此步驟下

步驟標題用 `step_header(num, title, skipped)` 函式渲染，active = 藍色 badge，skipped = 灰色 badge + 刪除線。

### 主區（右側）

- 頂部：**能量顯示範圍**滑桿（唯一在主區的控制項）
- **圖一**：背景扣除步驟視圖（原始曲線淡色 + 背景基準線（可選）+ 扣除後結果 + 背景區間紅色陰影）
- **圖二**：僅在歸一化啟用時出現，獨立 y 軸，顯示歸一化結果 + 歸一化區間藍色陰影
- 底部：**匯出**按鈕（處理後 CSV；有能量校正時另有校正後 CSV）

兩張圖 y 軸完全獨立，不會互相壓縮。

## 數據處理流程（processing.py）

處理管線：**背景扣除 → 歸一化**，兩步分開呼叫 `apply_processing`。

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

背景只在 `[bg_x_start, bg_x_end]` 區間內計算，區間外以兩端常數延伸。

### 歸一化方法

| 方法 | 說明 |
|---|---|
| `min_max` | 縮放至 [0, 1] |
| `max` | 除以選定區間內最大值 |
| `area` | 除以總面積（梯形積分，`np.trapezoid`） |
| `mean_region` | 除以選定區間內所有點的算術平均 y 值 |

## 能量校正

標準品對照表（`CALIB_STANDARDS`）：Au 4f7/2（84.0 eV）、Ag 3d5/2、Cu 2p3/2、Cu 3s、C 1s、Fermi edge、自訂。

流程：`find_peaks` 偵測最高峰 → 計算 `offset = ref_e - measured_e` → 匯出時將 `Energy_eV + offset`。校正後數據可在圖上疊加（虛線）。

## XPS 檔案解析

`parse_structured_xps` 解析含 `Dimension 1 scale=`（X 軸）和 `[Data 1]` / `Data=`（Y 軸）格式的結構化文字檔。支援編碼：utf-8、big5、cp950、latin-1、utf-16。

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

## 待開發模組

XAS、XES、SEM、Raman、XRD 框架已在 `DATA_TYPES` 定義，目前標示為 `ready: False`，選擇後會顯示「尚未開放」並停止。
