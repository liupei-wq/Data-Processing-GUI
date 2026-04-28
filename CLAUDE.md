# Nigiro Pro 專案紀錄

## 協作規則

- 回答使用者時一律使用繁體中文。
- 每一次動作前都要先讀取 `CLAUDE.md`。
- 每一次實作、檢查、重啟、重要判斷都要記錄在專案根目錄的 `CLAUDE.md`。
- 不要回復或覆蓋使用者未要求修改的既有變更。
- 目前 PowerShell profile 會出現執行原則警告，通常不影響指令結果。

---

## 專案定位

Nigiro Pro 是以 Streamlit 製作的科學數據處理 GUI，主軸是光譜與材料分析資料處理。入口檔為 `app.py`，目前支援：

- XPS：X-ray Photoelectron Spectroscopy
- XES：X-ray Emission Spectroscopy
- Raman：Raman Spectroscopy
- XRD：X-ray Diffraction
- XAS / XANES：X-ray Absorption Spectroscopy
- Gaussian subtraction：獨立高斯模板扣除工具
- SEM：目前只保留為未來模組，尚未開放

---

## 啟動與環境

- Windows 啟動：`啟動_Windows.bat`（純 ASCII，避免編碼問題）
- Mac 啟動：`啟動_Mac.command`（需 `chmod +x` 與移除 quarantine）
- 安裝套件：`安裝套件.bat`
- 手動啟動：`streamlit run app.py`
- 測試服務：`uv run streamlit run app.py --server.port 8504 --server.headless true`
- 依賴：`requirements.txt`（streamlit / pandas / numpy / plotly / scipy / lmfit）
- Streamlit 設定：`.streamlit/config.toml`（`fileWatcherType = "none"`，修改後需重啟）

---

## 架構總覽（Streamlit 版）

```
app.py                → 全域入口、品牌、主題、語言、字級、右下角齒輪設定
modules/              → 各資料類型 Streamlit UI & workflow
  xps.py              ← 最完整，約 2649 行
  xes.py              ← FITS 影像處理，約 3047 行
  raman.py            ← 材料 DB 比對，完整 peak fitting
  xrd.py              ← 參考峰比對、Scherrer 晶粒分析
  xas_auto.py         ← 活躍開發中，主要 XAS 入口
  gaussian_subtraction.py  ← 獨立工具
core/
  parsers.py          ← 通用兩欄光譜解析、XPS 結構化解析
  processing.py       ← 背景扣除（Shirley/Tougaard/Linear/Poly/AsLS/airPLS）、平滑、歸一化
  spectrum_ops.py     ← 峰偵測、插值、平均、高斯模板扣除
  peak_fitting.py     ← Gaussian/Lorentzian/Voigt 擬合，含 maxfev 參數
  read_fits_image.py  ← XES FITS 讀取核心
  ui_helpers.py       ← step header、skip button
db/
  raman_database.py   ← 含 NiO TO(395)、TO+LO(870) 等材料峰資料
  xps_database.py     ← 元素資訊、RSF、orbital RSF
  xrd_database.py     ← XRD 參考 sticks
  xes_database.py     ← XES 參考 emission lines（NiO / Ga2O3 / ...）
```

---

## Streamlit 全域 UI 現況

- 產品名稱：`Nigiro Pro`，左上角 SVG logo + 品牌文字
- 右側 hover 資料選單抽屜（query param 切換，不開新頁）
- 右下角齒輪設定（主題 / 語言 / 字體大小，hover 展開）
- 多主題：深色、淺色、海洋藍、森林綠、玫瑰紅

---

## 各模組評估（Streamlit 版）

### XPS（`modules/xps.py`，~2649 行）
完整定量分析 workflow：能量校正、背景扣除、歸一化、峰擬合、VBM 外推、Band Offset、Kraut Method、RSF 定量表格。
Core Level / Valence Band 模式切換。**修改時小步切分，避免破壞 session key。**

### XES（`modules/xes.py`，~3047 行）—— 見下方詳細分析
兩種模式：FITS 原始影像 / 已處理 1D 光譜。

### Raman（`modules/raman.py`）
去尖峰、內插、多檔平均、背景扣除、平滑、歸一化、材料 DB 比對、峰擬合、Si 應力估算。
**新增材料優先改 `db/raman_database.py`。**

### XRD（`modules/xrd.py`）
內插、平均、高斯模板扣除、平滑、歸一化、log 弱峰、d-spacing 切換、參考峰比對、Scherrer 晶粒尺寸。
**新增相優先改 `db/xrd_database.py`。**

### XAS（`modules/xas_auto.py`，活躍開發中）
TEY / TFY 雙通道，自動欄位解析，能量校正、背景扣除、歸一化、White Line、高斯扣除、XANES 去卷積擬合。

---

## XES 模組邏輯詳細分析（`modules/xes.py`）

### 兩種輸入模式

**FITS 原始影像模式**（較複雜，網站版第一版不搬）
```
FITS file → Dark/Bias 扣除 → Hot pixel 修正 → 曝光正規化
→ 曲率校正（拉直 emission line）→ ROI 積分 → Sideband BG 扣除
→ BG1/BG2 分點扣除 → 1D 光譜
```

關鍵子步驟：
- **Hot pixel**：`median_filter` 找出 > `threshold × 1.4826 × MAD` 的像素，替換為局部中位數
- **曲率校正**：每 row 找 subpixel 峰位中心，對 `(row, center_column)` 做多項式擬合，各 row 橫移拉直
- **ROI 積分**：沿列 sum/mean，得到 1D 光譜；sideband 是上下相鄰帶的均值背景
- **BG1/BG2 權重**：`BG = BG1 + w × (BG2 - BG1)`，`w` 由 FITS header 時間戳或檔名順序決定

**已處理 1D 光譜模式**（網站版第一版目標）
- 上傳兩欄 CSV/DAT（可同時上傳 BG1、BG2 光譜）
- 跳過 FITS/ROI/曲率校正，直接進 BG1/BG2 1D 插值扣除

### 共用 1D 後處理流程（兩種模式都有）

| 步驟 | 說明 |
|---|---|
| BG1/BG2 扣除 | 1D 插值，依樣品順序加權 |
| I0 正規化 | 除以入射光通量（global 值或 CSV table） |
| 多檔平均 | 先對齊共同 X 範圍，再插值平均 |
| 平滑 | moving_average / savitzky_golay |
| 歸一化 | min_max / max / area / reference_region |
| X 軸校正 | Linear: `eV = offset + slope × pixel`；或從參考點 CSV 做多項式 |
| 峰值偵測 | scipy find_peaks（prominence / height / distance / max_peaks） |
| 能帶對齊 | VBM（由 XES）+ CBM（由 XAS）→ Eg、ΔEV、ΔEC 含誤差傳播 |

### 能帶對齊（`_xes_band_alignment_summary`）
```
Eg_A = CBM_A - VBM_A
ΔEV  = VBM_A - VBM_B
ΔEC  = CBM_A - CBM_B
sigma 用 quadrature 誤差傳播
```

### 參考資料（`db/xes_database.py`）
- NiO：O K alpha (524.9 eV)、Ni L alpha (851.5 eV)、Ni L beta (868.0 eV)、Ni K alpha (7478.2 eV)
- Ga2O3：O K alpha (524.9 eV)、Ga L alpha (1098.0 eV)、...
- 格式：`{ material: { peaks: [{label, energy_eV, tolerance_eV, relative_intensity, meaning}] } }`

### 網站版 XES 搬運策略

| 功能 | 第一版（spectrum mode） | 備注 |
|---|---|---|
| 1D 光譜上傳（CSV/DAT） | ✅ 搬 | 核心功能 |
| BG1/BG2 1D 扣除 | ✅ 搬 | `_xes_spectrum_background_curve` |
| 多檔平均 | ✅ 搬 | |
| 平滑 | ✅ 搬 | |
| 歸一化 | ✅ 搬 | |
| X 軸線性校正（offset + slope） | ✅ 搬 | |
| 峰值偵測 | ✅ 搬 | 重用 `detect_spectrum_peaks` |
| 參考峰 overlay | ✅ 搬 | `db/xes_database.py` |
| 能帶對齊（VBM/CBM → Eg/ΔEV/ΔEC） | ✅ 搬 | |
| FITS 影像模式 | ❌ 暫緩 | 複雜度最高，之後再做 |
| I0 table CSV | ❌ 暫緩 | 可後補 |
| Preset 匯入/匯出 | ❌ 暫緩 | 可後補 |

---

## Web 版本（FastAPI + React）

### 目前網站版模組狀態

| 模組 | 狀態 | 後端 Router | 前端頁面 |
|---|---|---|---|
| **Raman** | ✅ 完成 | `web/backend/routers/raman.py` | `web/frontend/src/pages/Raman.tsx` |
| **XRD** | ✅ 完成 | `web/backend/routers/xrd.py` | `web/frontend/src/pages/XRD.tsx` |
| **XAS** | ✅ 完成 | `web/backend/routers/xas.py` | `web/frontend/src/pages/XAS.tsx` |
| **XPS** | ✅ 完成 | `web/backend/routers/xps.py` | `web/frontend/src/pages/XPS.tsx` |
| **XES** | 🔄 進行中 | 待建立 | 待建立 |
| SEM | ⏳ 未開始 | — | — |

### 目錄結構

```
web/
├── backend/
│   ├── main.py              # FastAPI 入口，掛載 xrd/raman/xas/xps router
│   ├── requirements.txt
│   └── routers/
│       ├── xrd.py           # XRD 5 個 endpoints（含 Scherrer、Gaussian）
│       ├── raman.py         # Raman parse/process/peaks/references/fit
│       ├── xas.py           # XAS parse/process（TEY/TFY 雙通道）
│       └── xps.py           # XPS parse/process/peaks/fit（含 Shirley/Tougaard）
├── frontend/
│   ├── package.json         # React 18 + Vite + Tailwind + Plotly.js
│   ├── vite.config.ts       # dev proxy /api → port 8000
│   └── src/
│       ├── App.tsx          # 根元件，主題 / 字體 / workspace 路由
│       ├── index.css        # CSS 變數主題系統（6 主題：杏桃/柔白/海霧/黑曜/暮焰/森夜）
│       ├── pages/
│       │   ├── XRD.tsx
│       │   ├── Raman.tsx
│       │   ├── XAS.tsx
│       │   ├── XPS.tsx
│       │   └── SingleProcessTool.tsx  # 背景扣除 / 歸一化 / 高斯扣除 單一工具
│       ├── components/
│       │   ├── AnalysisModuleNav.tsx  # 固定順序模組切換（Raman/XRD/XPS/XAS/XES/SEM）
│       │   ├── FileUpload.tsx
│       │   ├── ProcessingPanel.tsx
│       │   ├── SpectrumChart.tsx
│       │   └── GaussianSubtractionChart.tsx
│       ├── api/             # xrd.ts / raman.ts / xas.ts / xps.ts
│       └── types/           # xrd.ts / raman.ts / xas.ts / xps.ts
├── Dockerfile               # 多階段 build（Node → Python + 靜態服務）
└── (docker-compose.yml 已刪除，有 YAML 重複鍵錯誤)
railway.toml                 # builder=DOCKERFILE，healthcheckPath=/health
render.yaml                  # Render Blueprint，plan=free
```

### API 端點總覽

| Prefix | 端點 | 說明 |
|---|---|---|
| `/api/xrd` | parse / process / peaks / references / reference-peaks | XRD 完整流程 |
| `/api/raman` | parse / process / peaks / references / reference-peaks / fit | Raman + 峰擬合 |
| `/api/xas` | parse / process | TEY+TFY 雙通道，energy/bg/norm/white-line |
| `/api/xps` | parse / process / peaks / fit | Shirley/Tougaard 背景，峰擬合含 Area% |

### 前端 App 路由（App.tsx）

```typescript
type WorkspaceId =
  | 'workflow-raman' | 'workflow-xrd' | 'workflow-xas' | 'workflow-xps'
  | `tool-background` | `tool-normalize` | `tool-gaussian`
```

- 右下角齒輪（hover 展開）：主題 6 種 / 字體 3 種 / 字級 3 種
- 右側 hover 抽屜（`選單`）：單一處理工具（背景扣除/歸一化/高斯模板扣除）

### 本機啟動

```bash
# Terminal 1：後端
cd web && uvicorn backend.main:app --reload --port 8000

# Terminal 2：前端
cd web/frontend && npm install && npm run dev
# 開 http://localhost:3000
```

### 部署

- **Render**（目前主力）：`render.yaml` 自動讀取，free plan，15 分鐘無流量會 spin down
- **Railway**：`railway.toml`，`builder=DOCKERFILE`，`$PORT` 由 Dockerfile CMD 的 `sh -c` 展開
- **同一份 code**，不需要兩個版本

---

## 各 Web 模組實作重點

### XRD（最早完成，功能最完整）
- 後端：parse / process（含 Gaussian template 扣除） / peaks（含 fwhm_deg 供 Scherrer） / references / reference-peaks
- 前端：Scherrer 晶粒分析、log 弱峰視圖、高斯模板扣除圖、參考峰匹配表、完整匯出（研究用 / 分析表格 / 追溯 JSON）

### Raman（功能最豐富）
- 後端：parse / process（去尖峰/interpolate/avg/bg/smooth/norm） / peaks / references / reference-peaks / fit
- 前端：峰位管理（從 DB 載入 / 手動新增 / 逐峰編輯）、峰擬合、可疑峰多選停用、自動二次擬合迴圈
- NiO 峰資料：TO(395 cm⁻¹)、TO+LO(870 cm⁻¹) 已加入 `db/raman_database.py`

### XAS（TEY/TFY 雙通道）
- 後端 parser：`_is_numeric_line` / `_parse_xas_table_bytes` / `_prepare_tey_tfy_auto` 直接寫在 router（不依賴 streamlit imports）
- 支援 6 欄同步輻射 DAT（Energy/Phase/Gap/TFY/TEY/I0）與 3 欄格式
- 後邊緣歸一化：`_normalize_post_edge(x, y, edge_region, norm_region)` → `(y - pre_mean) / edge_step`
- 前端：TEY（藍）+ TFY（紫）分開繪圖，White Line 橘色虛線標記，post-edge 摘要表

### XPS（x 軸反轉）
- 後端使用 `core/parsers.parse_xps_bytes`（支援多格式多編碼）
- 背景：Shirley / Tougaard（B=2866/C=1643）/ Linear / Polynomial / AsLS / airPLS
- 峰偵測時自動偵測並翻轉反向 x 軸（高 BE 在左）
- 前端：圖表 `autorange: 'reversed'`，自動尋峰後可逐峰「加入擬合」或「全部加入」

---

## 目前主要風險與注意事項

- **中文編碼**：多數檔案中的中文在終端顯示可能 mojibake，Python 可執行，修改中文字串需謹慎。
- **`fileWatcherType = "none"`**：Streamlit 改動後需手動重啟。
- **XPS/XES/Raman 檔案很大**：重構要分段，避免一次重寫整個 module。
- **`modules/xas.py`**：保留舊版邏輯，app 實際使用 `xas_auto.py`，不要誤改 `xas.py`。
- **高斯扣除計算順序**：XRD 網站版的 Gaussian subtraction 是在背景扣除前計算，不是在 normalized 後；UI 順序與實際計算順序不同，若使用者要求「對 normalized 後做扣除」需另外調整。
- **npm 環境**：部署驗證需在有 npm 的機器上做 `npm run build`；Vite chunk size warning（~5 MB）與 postcss module warning 不阻擋 build。

---

## 部署驗證記錄

- Render 網址：`https://data-processing-gui-web.onrender.com/`
- Railway：`$PORT` 問題修正（Dockerfile CMD 用 `sh -c`，不在 railway.toml 設 startCommand）
- `python3 -m py_compile web/backend/main.py web/backend/routers/*.py` ✅
- `git diff --check` ✅（格式無誤）
- `npm run build` 需在有 npm 的機器確認

---

## 重要歷史決策紀錄

- **不搬 XES FITS 模式（第一版）**：曲率校正、ROI、sideband BG 太複雜，網站版第一版只做 1D 光譜模式
- **XAS 不 import modules/xas_auto.py**：那個檔案有 streamlit import，改成把 parser helper 直接複製到 router
- **刪除 docker-compose.yml**：有重複的 `build:` key，YAML 語法錯誤，Railway/Render 都不使用它
- **不在 railway.toml 設 startCommand**：`$PORT` 不會被展開，讓 Dockerfile CMD（含 `sh -c`）處理
- **node_modules 不進 git**：已加入 .gitignore，並執行過 `git rm -r --cached`
- **vite-env.d.ts 需要存在**：缺少時 VSCode 顯示大量 JSX TS7026 錯誤
- **Peak fitting `maxfev` 參數**：`core/peak_fitting.py` 已支援，Raman API 會傳入
