# Nigiro Pro 協作手冊

## 協作規則

- 回答使用者時一律使用繁體中文。
- 每次動作前先讀取 `CLAUDE.md`，每次實作後記錄變更。
- 不要修改使用者未要求修改的既有程式。
- 這個 repo 只處理 `web/` 網頁版；離線 Streamlit 版在獨立 repo：`https://github.com/liupei-wq/Data-Processing-GUI-Desktop`

---

## 專案定位

| 項目 | 說明 |
|---|---|
| 網頁版主倉庫 | https://github.com/liupei-wq/Data-Processing-GUI |
| 離線桌面版 | https://github.com/liupei-wq/Data-Processing-GUI-Desktop |
| Render 線上站 | https://data-processing-gui-web.onrender.com/ |
| 目前維護範圍 | `web/` 內的 FastAPI + React/Vite 網頁版 |

---

## 技術棧

| 層級 | 技術 | 版本 |
|---|---|---|
| 前端框架 | React + Vite + TypeScript | React 18.3, Vite 8.0, TS 5.2 |
| 前端樣式 | Tailwind CSS 3.4 + PostCSS + Autoprefixer | |
| 圖表 | Plotly.js 2.32 + react-plotly.js 2.6 | |
| 後端框架 | FastAPI + Uvicorn | FastAPI 0.111, Uvicorn 0.29 |
| 後端語言 | Python 3.11 | |
| 科學計算 | NumPy 1.26, SciPy 1.12, pandas 2.0, lmfit 1.3 | |
| 容器 | Docker (多階段 build) | |
| 部署 | Render (free) + Railway | |

---

## 快速啟動與驗證

**本機啟動（手動）**

```bash
# Terminal 1
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r web\backend\requirements.txt
cd web
..\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000

# Terminal 2
cd web/frontend
npm install
npm run dev
```

**PowerShell 腳本快速啟動**

```powershell
# 初次設定
.\scripts\setup_frontend.ps1
.\scripts\setup_backend.ps1

# 執行（分開兩個視窗）
.\scripts\run_backend.ps1
.\scripts\run_frontend.ps1
```

前端預設位址：`http://localhost:3000`  
後端 Health Check：`http://127.0.0.1:8000/health`

**常用驗證**

```bash
# 前端建置
cd web/frontend && npm run build

# 後端語法檢查
python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py
```

**部署注意**

- `render.yaml` 使用 `runtime: docker`，`dockerfilePath: ./web/Dockerfile`。
- `railway.toml` 使用 `builder=DOCKERFILE`，不要設定 `startCommand`。
- Dockerfile 位於 `web/Dockerfile`，採多階段 build（Node 24 Alpine → Python 3.11 Slim）。
- Render 線上站是目前網頁版主要部署目標。

---

## 架構與目錄

**資料流**

`Browser` → `React/Vite frontend` → `FastAPI backend` → `core processing / db`

**目錄結構**

```text
web/
├── backend/
│   ├── main.py              # FastAPI 入口（含 CORS、static file serving）
│   ├── requirements.txt     # 含 lmfit（XANES 去卷積需要）
│   ├── core/                # parsers / processing / peak_fitting / spectrum_ops
│   │   ├── parsers.py       # .xy / .txt / .csv / .vms / .pro / .dat 解析
│   │   ├── processing.py    # Shirley / Tougaard / Linear / Polynomial / AsLS / airPLS / rubber-band
│   │   ├── peak_fitting.py  # Voigt / Gaussian / Lorentzian / Pseudo-Voigt 擬合（含懲罰項修正）
│   │   └── spectrum_ops.py  # 內插、歸一化、高斯模板扣除、平滑、去尖峰
│   ├── db/                  # raman / xrd / xps / xes database
│   │   ├── raman_database.py
│   │   ├── xrd_database.py
│   │   ├── xps_database.py  # ELEMENTS + ORBITAL_RSF (Scofield 1976 Al Kα)
│   │   └── xes_database.py
│   └── routers/
│       ├── xrd.py           # parse / process / peaks / references / reference-peaks / fit
│       ├── raman.py         # parse / process / peaks / references / reference-peaks / fit
│       ├── xas.py           # parse / process / deconv
│       ├── xps.py           # parse / process / calibrate / fit / vbm / rsf / elements / element-peaks / periodic-table
│       └── xes.py           # parse / process / peaks / references / reference-peaks
├── frontend/
│   ├── package.json         # engines: node >=22 <25, npm >=10
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── src/
│       ├── App.tsx              # 主題(12 themes) / 字體(3 fonts) / 字型大小(3 scales) / workspace 路由 / ErrorBoundary
│       ├── main.tsx             # React root + RootErrorBoundary
│       ├── index.css            # CSS 變數主題（12 主題：核心/月白/光譜/掃描/晶格/銅焰/玫瑰/琥珀/深場/石墨/黑曜/聖誕）
│       ├── pages/               # XRD / Raman / XAS / XPS / XES / SingleProcessTool
│       ├── components/          # WorkspaceUi / ProcessingPanel / AnalysisModuleNav / FileUpload / SpectrumChart / GaussianSubtractionChart / PlotlyChart / PlotPopupHost / CursorParticles
│       ├── api/                 # xrd / raman / xas / xps / xes / http client
│       ├── types/               # xrd / raman / xas / xps / xes
│       └── hooks/               # usePlotPopups
├── Dockerfile               # 多階段：frontend-build (node:24-alpine) → python:3.11-slim
├── .dockerignore
├── static/                  # production build output（由 Dockerfile COPY --from 產生）
└── .nvmrc                   # Node major version 24

scripts/
├── setup_frontend.ps1 / setup_frontend.sh
├── setup_backend.ps1  / setup_backend.sh
├── run_frontend.ps1   / run_frontend.sh
└── run_backend.ps1    / run_backend.sh

render.yaml                # Render Blueprint（Docker runtime, free plan）
railway.toml               # Railway 設定（builder=DOCKERFILE）
```

---

## API 概覽

| Prefix | 端點 |
|---|---|
| `/api/xrd` | parse / process / peaks / references / reference-peaks / fit |
| `/api/raman` | parse / process / peaks / references / reference-peaks / fit |
| `/api/xas` | parse / process / deconv |
| `/api/xps` | parse / process / calibrate / fit / vbm / rsf / elements / element-peaks / periodic-table |
| `/api/xes` | parse / process / peaks / references / reference-peaks |
| `GET /health` | `{"status":"ok"}` |

---

## 模組狀態

| 模組 | 狀態 |
|---|---|
| **XRD** | ✅ 完整：MAD 雜訊估算自動尋峰 / high-medium-low 信心分類 / 排除區間 / Thin film on Si preset / 參考峰匹配 / Scherrer |
| **Raman** | ✅ 完整：Si 應力估算 / Preset 匯入匯出 / 峰擬合 / 去尖峰 / 平滑 / 背景扣除 |
| **XAS** | ✅ 完整：TEY+TFY / 高斯模板扣除 / 二階微分 / XANES 去卷積 |
| **XPS** | ✅ 完整，且目前是功能最完整的模組 |
| **XES** | ✅ 1D 光譜模式完整（含 I0 正規化）；缺 FITS 影像模式 |
| **SEM** | ⏳ 未實作 |

### XPS 重點現況

**Sidebar 流程**

1. 載入：`.xy / .txt / .csv / .vms / .pro / .dat`
2. 內插：每筆各自 `linspace`，不建立共同 x 軸，`INTERP_POINTS_MIN=50 / MAX=5000`
3. 多檔平均：僅疊圖模式可用，平均前先對齊到同一內插網格
4. 能量校正：手動位移 + 標準樣品資料庫自動校正（`POST /api/xps/calibrate`）
5. 背景扣除：Shirley / Tougaard(B=2866,C=1643) / Linear / Polynomial / AsLS / airPLS
6. 歸一化：None / Min-Max / Max / Area / Mean Region
7. 峰擬合：元素資料庫 + 手動新增；Voigt / Gaussian / Lorentzian（`POST /api/xps/fit`）
8. VBM（VB 模式）：線性外推（`POST /api/xps/vbm`）
9. 能帶偏移（VB 模式）：VBM 差值法 / Kraut Method（前端純計算）
10. RSF 定量：`POST /api/xps/rsf`，採 Scofield 1976 Al Kα

**圖表與匯出**

- 中間欄流程圖：原始光譜 → 前處理後 → 背景扣除 → 歸一化 → 最終/擬合
- 背景與歸一化圖表有 shaded region 標示區間（橘 / 青綠）
- 所有圖表支援 legend 點擊隱藏/顯示（`applyHidden` + `makeLegendClick`）
- 每張圖右上角都有線色下拉（`ChartToolbar`）
- 匯出分成三類：研究常用、分析表格、追溯/設定

**資料模式**

- `processingViewMode = 'single' | 'overlay'`
- 單筆模式：每筆資料各自保存 session（`params / peaks / fitResult / rsfRows`）
- 疊圖模式：使用獨立 `overlayState`，不共用單筆參數
- `overlayDraftSelection` 用來避免勾選中途就觸發處理
- 入口位於右上角「選擇疊圖資料」按鈕，透過 modal 選取

**主要 UI 元件**

- `Section`：可折疊步驟卡，支援 `infoContent`
- `TogglePill`：玻璃感啟用按鈕，取代多數主要開關
- `CustomSelect`：`createPortal` + `position: fixed`，避免被 `overflow-hidden` 裁切
- `AnalysisModuleNav`：分析模組下拉選單（cards / dropdown 兩種模式）
- `DeferredRender`：IntersectionObserver 延後掛載圖卡，降低首次進頁卡頓

---

## 重要技術備忘

### XPS x 軸反轉

XPS binding energy 習慣高 BE 在左，因此後端峰偵測先 flip，前端圖表使用 `autorange: 'reversed'`。

### Plotly legend 點擊隱藏

`applyHidden(traces, hidden[])` 會把 trace 設成 `visible: 'legendonly'`；`makeLegendClick` 需 `return false` 來阻止 Plotly 內建切換；各張圖各自維護 `xxxHidden` state。

### Plotly 兼容層

`web/frontend/src/components/PlotlyChart.tsx` 是 `react-plotly.js` 的兼容層，統一將 default export 與 namespace-style export 正規化，避免 production bundle 把 `Plot` 當成 object 觸發 React #130。所有頁面與共用圖表元件都應改走這個兼容層。

### XRD 防抖

`processData` / `detectPeaks` 的 effect 加了 300ms debounce；`SpectrumChart` 的 CSS vars 用 `useMemo([], [])`，只在 mount 時讀取一次。

### XAS parser

不要 import `modules/xas_auto.py`（含 Streamlit 依賴）；parser helpers 直接維護在 `routers/xas.py`。

### 高斯面積換算

`area = peak_height × fwhm × 1.0645`，XAS / XRD 高斯模板共用這個換算。

### 後端 core / db 來源

`web/backend/core/` 與 `web/backend/db/` 是從 Desktop repo 複製過來的，但不包含 `core/ui_helpers.py`。

### 效能優化已實作

- `DeferredRender`：圖卡接近視窗時才掛載，降低 Plotly 初始化成本
- `.step-content`：`content-visibility: auto` + `contain`，降低 sidebar 全開時的版面計算
- `.workspace-main-scroll`：`overscroll-behavior` + `scrollbar-gutter` + `contain`，減少主捲動區重繪
- 多數分階段圖卡 `scrollZoom: false`，降低滾輪縮放負擔
- SingleProcessTool 高斯模式：150ms debounce + `uirevision` 保留縮放視角

---

## 資料庫格式備忘

- **Raman DB**：`{ material: { peaks: [{position_cm, label, fwhm_cm, peak_type}] } }`
- **XRD DB**：`{ phase: { peaks: [{two_theta, relative_intensity, hkl}], color, ... } }`
- **XPS DB**：`ELEMENTS`（be/fwhm per orbital）、`ORBITAL_RSF`（例如 `"Ni 2p3/2": 14.07`）
- **XES DB**：`{ material: { peaks: [{label, energy_eV, tolerance_eV, relative_intensity, meaning}] } }`

---

## 待實作

| 項目 | 說明 |
|---|---|
| XES FITS 影像模式 | Dark/Bias 扣除 → hot pixel → 曲率校正 → ROI 積分；需 `astropy` |
| SEM 模組 | 尚未開始 |
| 前端 bundle 優化 | Plotly 過大，後續可評估 lazy loading 或 code splitting |

---

## 紀錄規範

- 有實作或明確驗證動作時，請在下方「動作紀錄」追加一筆。
- 建議格式：`YYYY-MM-DD HH:MM TZ：動作 + 影響檔案 + 驗證結果`
- 純討論若沒有修改檔案，可視情況省略；若內容會影響後續判斷，仍建議記錄。

---

## 動作紀錄

### 2026-05-03

- 2026-05-03 CST：掃描整個代碼庫，更新 `CLAUDE.md` 加入技術棧表格、完整目錄結構、效能優化備忘；建立 `AGENTS.md` 作為 AI Agent 快速參考；將 `ENV_SETUP.zh-TW.md` 完整整合進 `README.md`；驗證三份文件皆已正確寫入。

### 2026-05-02

- 2026-05-02 01:29 CST：修改 `web/frontend/src/pages/XPS.tsx` 的 `handleFit()`，疊圖模式下按下擬合會自動切回單筆模式後執行擬合；後端語法檢查與前端建置皆通過。
- 2026-05-02 01:24 CST：新增 XPS 獨立「峰擬合光譜」圖卡，補上單筆模式保護；後端語法檢查與前端建置皆通過。
- 2026-05-02 01:16 CST：修正 XPS 擬合結果被 `useEffect` 自我清空的 bug；後端語法檢查與前端建置皆通過。
- 2026-05-02 01:13 CST：移除 `plotConfig.ts` 的 Plotly 自訂全螢幕 modebar 按鈕，避免跨模組 runtime 異常；後端語法檢查與前端建置皆通過。
- 2026-05-02 01:22 CST：新增 `main.tsx` 全域 `RootErrorBoundary`，讓 runtime 錯誤不再整頁黑掉；後端語法檢查與前端建置皆通過。
- 2026-05-02 01:45 CST：新增 `PlotlyChart.tsx` 兼容層，統一 `react-plotly.js` 匯入方式，避免 production React #130；後端語法檢查與前端建置皆通過。
- 2026-05-02 00:55 CST：確認 `v18.5` 跨模組共用前端大改版為黑畫面主因，屬於部署版本差異。

### 2026-05-03

- 2026-05-03 CST：掃描整個代碼庫，更新 `CLAUDE.md` 加入技術棧表格、完整目錄結構、效能優化備忘；建立 `AGENTS.md` 作為 AI Agent 快速參考；將 `ENV_SETUP.zh-TW.md` 完整整合進 `README.md`；驗證三份文件皆已正確寫入。
- 2026-05-03 CST：在 XRD 弱峰檢視步驟卡新增「匯出弱峰轉換圖譜 .txt」出口；修改 `web/frontend/src/components/ProcessingPanel.tsx`（Props 新增 `onExportWeakPeakSeries? / canExportWeakPeak?`，步驟卡底部加匯出按鈕）與 `web/frontend/src/pages/XRD.tsx`（傳入 `handleExportTransformedWeakPeakSeriesTxt` 與 `weakPeakTransformedSeries.x.length > 0`）；有資料時按鈕啟用，無資料時 disabled 灰顯。

### 2026-05-02

- 2026-05-02 01:29 CST：修改 `web/frontend/src/pages/XPS.tsx` 的 `handleFit()`，疊圖模式下按下擬合會自動切回單筆模式後執行擬合；後端語法檢查與前端建置皆通過。
- 2026-05-02 01:24 CST：新增 XPS 獨立「峰擬合光譜」圖卡，補上單筆模式保護；後端語法檢查與前端建置皆通過。
- 2026-05-02 01:16 CST：修正 XPS 擬合結果被 `useEffect` 自我清空的 bug；後端語法檢查與前端建置皆通過。
- 2026-05-02 01:13 CST：移除 `plotConfig.ts` 的 Plotly 自訂全螢幕 modebar 按鈕，避免跨模組 runtime 異常；後端語法檢查與前端建置皆通過。
- 2026-05-02 01:22 CST：新增 `main.tsx` 全域 `RootErrorBoundary`，讓 runtime 錯誤不再整頁黑掉；後端語法檢查與前端建置皆通過。
- 2026-05-02 01:45 CST：新增 `PlotlyChart.tsx` 兼容層，統一 `react-plotly.js` 匯入方式，避免 production React #130；後端語法檢查與前端建置皆通過。
- 2026-05-02 00:55 CST：確認 `v18.5` 跨模組共用前端大改版為黑畫面主因，屬於部署版本差異。

### 2026-05-01

- 2026-05-01 CST：修改 XPS 疊圖模式為獨立四張圖卡（前處理/背景/歸一化/最終）；修正後端 `/fit` key 大小寫錯誤與 numpy `tolist()`；後端語法檢查與前端建置皆通過。
- 2026-05-01 14:13 CST：XRD 自動尋峰改為 MAD 雜訊估算 + high/medium/low 信心分類 + Thin film on Si preset；後端語法檢查與前端建置皆通過。
- 2026-05-01 14:26 CST：新增 XRD `/api/xrd/fit` 端點與前端峰擬合 UI；後端語法檢查與前端建置皆通過。
- 2026-05-01 14:40 CST：重構 SingleProcessTool 高斯模板 UI（步進 0.01、控制移入中間欄、橘色虛線標示）；前端建置通過。
- 2026-05-01 14:46 CST：新增高斯模板 `gaussian_nonnegative_guard` 後端保護與前端勾選；後端語法檢查與前端建置皆通過。
- 2026-05-01 14:49 CST：SingleProcessTool 動態安全上限與區間最低點偵測；前端建置通過。
- 2026-05-01 15:04 CST：SingleProcessTool 新增匯出 CSV、403–406 最低點標記、縮放模式修正（框選放大/雙擊重置/禁用滾輪）；前端建置通過。
- 2026-05-01 15:15 CST：SingleProcessTool 最低點改為一次性「對齊到最低點」按鈕；前端建置通過。
- 2026-05-01 15:25 CST：SingleProcessTool 改回持續綁定最低點 + 180ms debounce + `uirevision`；前端建置通過。
- 2026-05-01 15:35 CST：SingleProcessTool 最低點 marker 重新顯示 + SliderRow 拖動結束才提交；前端建置通過。
- 2026-05-01 15:52 CST：SingleProcessTool 控制區移回左側欄 + `gaussianDraft` 手動套用模式；前端建置通過。
- 2026-05-01 17:30 CST：完整重構 SingleProcessTool（v17.8）：`flex h-screen overflow-hidden` 版型、手動套用按鈕、前端純計算 `lockedAfterY`；TypeScript 及前端建置均通過。
- 2026-05-01 18:00 CST：SingleProcessTool 鎖定最低點改為歸一化歐式距離 + 高斯面積顯示 + 移除搜尋半寬 + `clientAfterY` 即時預覽；前端建置通過。
- 2026-05-01 18:12 CST：修正 `peak_fitting.py` Voigt 寬度懲罰項固定長度輸出，修復 SciPy broadcast shape 錯誤；後端語法檢查與前端建置皆通過。
- 2026-05-01 18:31 CST：前端優化：`DeferredRender` + `content-visibility` + 主捲動區 `contain`；XRD/Raman 圖卡延後掛載；前端建置通過。

### 2026-04-30

- 2026-04-30 17:35 CST：XPS Section `?` 說明改為中央覆蓋式 modal + 玻璃感步驟卡；前端建置通過。
- 2026-04-30 17:44 CST：XPS sticky sidebar header + 分析模組下拉選單；前端建置通過。
- 2026-04-30 18:00 CST：XRD UI 套版（WorkspaceUi + ProcessingPanel）；前端建置通過。
- 2026-04-30 18:02 CST：Raman UI 套版；前端建置通過。
- 2026-04-30 18:34 CST：XRD/Raman 補上單筆/多筆疊圖前端狀態流程；前端建置通過。
- 2026-04-30 19:02 CST：Sidebar 效能優化（`content-visibility` / `overscroll-behavior`）；前端建置通過。
- 2026-04-30 19:08 CST：Raman sidebar 拆成獨立步驟（去尖峰/內插/多檔平均/背景/平滑/歸一化/峰偵測/擬合）；前端建置通過。
- 2026-04-30 19:14 CST：XRD/Raman 多張分階段圖卡 + ChartToolbar + legend hide + stage CSV 匯出；前端建置通過。
- 2026-04-30 20:42 CST：審閱 XRD 自動找峰推薦方案，整理分階段導入建議。
