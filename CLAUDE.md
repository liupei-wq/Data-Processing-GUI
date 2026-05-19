[2026-05-15] 除錯：修正 XAS Section 8「匯入已處理光譜」模式下中間欄空白的三個問題。① 修正 empty state 條件加入 `!(fitDataSource === 'imported' && importedFitDataset)` 保護，避免匯入資料時仍顯示空狀態；② 新增匯入光譜預覽圖卡（在無 pipeline result 且未完成擬合時顯示，含點數/能量範圍摘要與 Plotly 折線預覽）；③ 將 `{/* Peak fitting result */}` block 從 `result && (activeDataset != null || ...)` 大 block 內部移出，放置於其後，使匯入模式下執行擬合後仍能正常渲染結果。影響檔案：`web/frontend/src/pages/XAS.tsx`；驗證 `npm run build` 通過（無 TypeScript 錯誤）。

[2026-05-15] 新增：XAS Section 8 峰擬合支援「匯入已處理光譜」資料來源。① 新增 `parseTwoColumnText` 前端 helper，解析任意分隔 2 欄 TXT/CSV，自動跳過 #/%/!/@ 開頭的注釋行，sort by x，少於 3 個有效點時回傳 null；② 新增 states：`importedFitDataset`、`fitDataSource`（'pipeline'|'imported'）、`importedFitError`；③ 新增 `fitEffective` useMemo：`fitDataSource==='imported'` 時使用匯入光譜，否則使用 activeDataset TEY/TFY，回傳 `{x, y, name} | null`；④ 新增 `fitEnergyMin/fitEnergyMax`，由 `fitEffective.x` 的首末值決定（fallback 到 energyMin/Max）；⑤ `handleFit`、`handleAutoConverge`、`loadSampleEdgePeaks`、`addManualFitPeak` 全部改用 `fitEffective.x/y`；⑥ Section 8 頂部新增資料來源切換卡（「處理流程結果」/「匯入已處理光譜」pill），匯入模式下顯示檔案選擇器、解析摘要（名稱/點數/能量範圍）與移除按鈕；疊圖模式鎖定條件改為 `isOverlayMode && fitDataSource !== 'imported'`；DualRangeInput 的 min/max 與 reset 按鈕改用 `fitEnergyMin/fitEnergyMax`。影響檔案：`web/frontend/src/pages/XAS.tsx`。驗證 `npm run build` 通過。

[2026-05-15] 新增：XPS / XAS 峰擬合新增「自動收斂」按鈕、「↺ 重設所有峰」與逐峰「↺」初始值重設、收斂歷史 chip 顯示、R²/RMSE/χ²ᵣ 改用 `formatMetric` 智慧格式化（自動指數/小數切換）。① `PeakCandidate`/`XasPeakCandidate` 新增 `originalCenter/originalFwhm/originalAmplitude` 欄位，在 `createPeakCandidate/createXasPeakCandidate` 首次建立時固定；`sanitize` 保留原值；`buildFitPeakPayloads/buildXasFitPeakPayloads` payload 前剔除以免送後端；② XPS `loadElementPeaks` 修正 bug：改為先過濾 `sourceType!=='database'` 再加新峰，避免重複匯入（與 XAS 對齊）；③ `handleFit` 重構為回傳 `FitResult | null` 並在成功後更新 `fitHistory`；④ 新增 `handleAutoConverge`：本地迴圈最多 10 次，每輪更新 candidate seed，當 |ΔR²| < 0.00005 自動停止；⑤ 收斂歷史以彩色 chip 列出每輪 R² 與 Δ；⑥ XPS/XAS 側欄均加入兩顆按鈕列（執行擬合 + 自動收斂）。影響檔案：`web/frontend/src/pages/XPS.tsx`、`web/frontend/src/pages/XAS.tsx`。驗證 `npm run build` 通過。

[2026-05-15] 新增：XPS / XAS 峰擬合新增 OriginPro 風格迭代收斂。`handleFit` 在擬合成功後，將未鎖定的峰（`lock_center/lock_fwhm/lock_area = false`）的 Center、FWHM、Height 更新回 `peakCandidates`（透過 `updatePeakCenterSeed/FwhmSeed/AmplitudeSeed`），使下一次按「執行擬合」從上次結果出發，持續收斂至最佳解。影響檔案：`web/frontend/src/pages/XPS.tsx`、`web/frontend/src/pages/XAS.tsx`。驗證 `npm run build` 通過。

[2026-05-15] 除錯：XAS 三項 bug 修正。① 峰擬合重複匯入：`loadSampleEdgePeaks` 改為先清除所有 `sourceType==='database'` 的舊峰再加入新峰，不再無限 append；② 歸一化方法切換時 trace 標籤錯誤：`buildNormTracesSingle`/`buildNormTracesOverlay` 的曲線名稱改為 `normView==='flattened' && norm_method==='athena_norm'` 才顯示 "Flattened"；③ `normChartMode`/`normView` 不隨方法切換重置：新增 `useEffect` 在 `norm_method !== 'athena_norm'` 時自動重置為 `'normalized'`，避免切換回 athena 時殘留舊狀態。影響檔案：`web/frontend/src/pages/XAS.tsx`。驗證 `npm run build` 通過。

[2026-05-15] 變更：XAS 主圖精簡為常態 2 張，「3. 最終光譜」改為只在 `norm_method !== 'none'` 時才顯示；無歸一化時畫面只剩「1. 原始/前處理後」TEY + TFY 2 張，開啟歸一化後才追加「2. 歸一化」與「3. 最終光譜」共 4 張。影響檔案：`web/frontend/src/pages/XAS.tsx`。驗證 `npm run build` 通過。

[2026-05-15] 變更：XAS 歸一化方法精簡，只保留 `athena_norm` 與 `post_edge`，移除 `min_max`、`max`、`area`、`mean_region`；`types/xas.ts` 的 `norm_method` union type 同步縮減；sidebar Section 4 選單、onChange 邏輯、renderNormalizationSidebarInputs 死碼分支、chart controls label 全部清理。驗證 `npm run build` 通過。

[2026-05-15] 變更：XAS 模組歸一化圖新增「背景擬合視圖」。後端 `_normalize_athena()` 回傳值擴充為 7-tuple，新增 `pre_line`（pre-edge 線性擬合線）、`post_poly`（post-edge 多項式）、`y_sub`（扣 pre-edge 後光譜）；`ProcessedDataset` 新增 `tey/tfy_pre_edge_line`、`tey/tfy_post_edge_poly`、`tey/tfy_pre_subtracted` 六個欄位；前端 `types/xas.ts` 同步；`XAS.tsx` 加 `normChartMode` state，在歸一化卡片 footer 加「背景擬合 / 歸一化後」切換 pills，背景擬合模式顯示原始光譜 + 橘色 pre-edge 線（左 y 軸）及扣除後光譜 + 綠色 post-edge 多項式（右 y 軸），Pre-edge 滑桿條件從 `post_edge` 擴充至 `athena_norm`。驗證 `python3 -m py_compile`、`npm run build`、`git diff --check` 通過。
[2026-05-15] 變更：`Athena` 入口新增到分析頁左側 module tabs，顯示為 `Athena`，選取後進入既有 `tool-athena` workspace；右側 floating 選單依使用者要求暫時保留 Athena 入口。同步補 `MODULE_CONTENT.athena` metadata。驗證 `cd web/frontend && npm run build` 通過。

[2026-05-15] 變更：`Athena` 入口改放到分析頁左側 module tabs，顯示為 `Athena`，選取後進入既有 `tool-athena` workspace；右側 floating 選單不再插入 Athena 入口。同步補 `MODULE_CONTENT.athena` metadata。驗證 `cd web/frontend && npm run build` 通過。

[2026-05-15] 變更：`XAS Athena 處理` 的手動刪峰 / 加回資料 draft 區間支援直接在 Plotly 預覽圖上拖曳；藍色刪峰區與青綠色加回區可拖整塊或左右邊界，左側 start/end 拉桿數值會同步更新。`PlotlyChart.tsx` 兼容層新增 `onRelayout` 轉發。驗證 `cd web/frontend && npm run build` 通過。

[2026-05-15] 變更：`XAS Athena 處理` 新增線性背景扣除與歸一化微調；左側新增全域微調卡，可開關線性扣背景並調整背景斜率/截距、歸一化倍率/平移。微調會套用到所有 scan 的 normalized / flattened 曲線，並同步進入平均、手動刪峰/加回、CSV 匯出與 OriginPro 產檔腳本。驗證 `cd web/frontend && npm run build` 通過。

[2026-05-15] 變更：`XAS Athena 處理` 右側預覽新增最終結果圖；上方保留 raw/平均與可拖曳區間，下方獨立顯示目前 selected sample 經微調、刪峰/加回後的 clean scan1、clean scan2 與 final average 曲線，並跟 Normalized / Flattened 切換同步。驗證 `cd web/frontend && npm run build` 通過。

[2026-05-15] 變更：XAS 模組欄位對應改為強制 Modal 選擇。上傳檔案後自動彈出「欄位對應設定」modal，停用自動偵測（下拉預設為索引 0/1/2），使用者必須逐檔手動指定 Energy / TEY / TFY 欄（I₀ 可選）；多檔時可「套用到全部」一次設定；`effectiveFiles` 改為只含已確認 mapping 的檔案，未設定欄位的檔案不會送入處理；Section 1 檔案清單改為顯示確認狀態（✓ / ! 未設定），並提供「設定欄位 / 重設欄位」按鈕可重開 modal。驗證 `npm run build` 通過。

[2026-05-15] 變更：XAS 模組新增逐檔欄位對應選擇器。後端 `routers/xas.py` parser 改為回傳所有欄的原始數值陣列（`raw_columns`）、偵測到的欄位名稱（`column_names`）與自動猜測的 mapping（`default_mapping`，依 energy/tey/tfy/i0 關鍵字比對）；前端 `types/xas.ts` 擴充 `ParsedXasFile`，`XAS.tsx` 新增 `effectiveFiles` useMemo（依使用者選定欄位在前端計算 TEY/I₀、TFY/I₀ 並排序），Section 1 檔案清單每個檔案加入可展開「欄位 ▼」選擇器，含前 3 行預覽表、2×2 欄位下拉（Energy / I₀ / TEY / TFY）、套用到其他未設定檔案按鈕與還原自動按鈕；後續所有 process 呼叫使用 effectiveFiles。驗證 `python3 -m py_compile ...`、`npm run build`、`git diff --check` 通過。

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
| 科學計算 | NumPy 1.26, SciPy 1.12, pandas 2.0, lmfit 1.3, openpyxl/xlrd | |
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
│   ├── requirements.txt     # 含 lmfit（XAS/XPS 峰擬合需要）
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
│       ├── xas.py           # parse / process / fit / samples / sample-peaks
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
| `/api/xas` | parse / process / fit / samples / sample-peaks |
| `/api/xps` | parse / process / calibrate / fit / vbm / rsf / elements / element-peaks / periodic-table |
| `/api/xes` | parse / process / peaks / references / reference-peaks |
| `GET /health` | `{"status":"ok"}` |

---

## 模組狀態

| 模組 | 狀態 |
|---|---|
| **XRD** | ✅ 完整：MAD 雜訊估算自動尋峰 / high-medium-low 信心分類 / 排除區間 / Thin film on Si preset / 參考峰匹配 / Scherrer |
| **Raman** | ✅ 完整：Si 應力估算 / Preset 匯入匯出 / 峰擬合 / 去尖峰 / 平滑 / 背景扣除 |
| **XAS** | ✅ 完整：TEY+TFY / 分階段圖卡 / 背景與歸一化區間標示 / 高斯模板扣除 / 峰擬合 |
| **XPS** | ✅ 完整，且目前是功能最完整的模組 |
| **XES** | ✅ 1D 光譜模式完整（含 I0 正規化）；缺 FITS 影像模式 |
| **SEM** | ⏳ 未實作 |

### XPS 重點現況

**Sidebar 流程**

1. 載入：`.xy / .txt / .csv / .vms / .pro / .dat`
2. 內插 / 資料模式：每筆各自 `linspace`，不建立共同 x 軸，`INTERP_POINTS_MIN=50 / MAX=5000`；多檔時單筆 / 疊圖入口整合在同一步
3. 多筆疊圖 / 多檔平均：疊圖模式預設不平均，會讓多筆資料各自套同一組參數後分階段疊圖；第 3 步可明確啟用「平均所有疊圖數據」，平均前會對齊到同一內插網格
4. 能量校正：手動位移 + 標準樣品資料庫自動校正（`POST /api/xps/calibrate`）
5. 背景扣除：Shirley / Tougaard(B=2866,C=1643) / Linear / Polynomial / AsLS / airPLS
6. 歸一化：None / Min-Max / Max / Area / Mean Region
7. 峰擬合：元素資料庫 + 手動新增；Voigt / Gaussian / Lorentzian（`POST /api/xps/fit`）
8. VBM（VB 模式）：先將切線/基準線的兩個輸入 x 值映射到實際光譜點，再以各點附近 20% 搜尋窗選點；切線取最大正斜率、基準線取最平斜率，兩條線交點為 VBM（`POST /api/xps/vbm`）；前端中間圖同步顯示輸入對應點、實際選點、兩條線與 VBM 標記
9. 能帶偏移（VB 模式）：VBM 差值法 / Kraut Method（前端純計算）
10. RSF 定量：`POST /api/xps/rsf`，採 Scofield 1976 Al Kα

**圖表與匯出**

- 中間欄流程圖：原始光譜 → 前處理後 → 背景扣除 → 歸一化 → 最終/擬合
- 背景與歸一化圖表有 shaded region 標示區間（橘 / 青綠）
- 所有圖表支援 legend 點擊隱藏/顯示（`applyHidden` + `makeLegendClick`）
- 疊圖圖卡改為上下堆疊全寬顯示；原始 / 疊圖圖卡都可逐筆調整線色，疊圖圖卡右上角 `ChartToolbar` 可一鍵重排整組色盤
- 匯出分成三類：研究常用、分析表格、追溯/設定

**資料模式**

- `processingViewMode = 'single' | 'overlay'`
- 單筆模式：每筆資料各自保存 session（`params / peaks / fitResult / rsfRows`）
- 疊圖模式：使用獨立 `overlayState`，不共用單筆參數；`average=false` 時顯示每筆 processed dataset，`average=true` 時才產生平均光譜
- 疊圖不平均模式會鎖定峰擬合與 RSF；需要峰擬合 / RSF 時須先啟用第 3 步多檔平均，或切回單筆資料
- 中間欄不再提供第二套單筆 / 疊圖切換，避免和 sidebar 重複
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

### 2026-05-06（本次）

- 2026-05-06 CST：讀取 `CLAUDE.md`，確認本次需求為在 XAS 內插化新增像 XPS 一樣的自動偵測模式，範圍限定 `web/` 網頁版。
- 2026-05-06 CST：讀取 XPS 內插自動偵測邏輯與 XAS 目前 `interpolate/n_points` UI/處理流程，確認 XPS 由前端依原始 x 軸中位步距估算有效點數後送入後端。
- 2026-05-06 CST：XAS 內插新增自動偵測點數：`estimateInterpolationPoints()` 依每筆原始 energy 軸的 median step 估算自然點數、取中位數後四捨五入並夾在 200–10000；側欄新增「自動調整點數」、自動建議、每檔原點數/新點數與步距變化；主內容摘要顯示有效內插點數；分階段三次 `/process` 皆使用同一個 `effectiveNPoints`。影響檔案：`web/frontend/src/pages/XAS.tsx`；驗證 `python3 -m py_compile ...`、`cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-06 CST：讀取 `CLAUDE.md`，確認本次需求為比對 XAS `Post-edge Step` 與 XPS `Mean Region` 歸一化邏輯，並將 XAS 圖表改為類 XPS 分階段顯示且保留 TEY/TFY 左右並排與取量範圍標示。
- 2026-05-06 CST：搜尋並讀取 `web/backend/routers/xas.py`、`web/backend/routers/xps.py`、`web/backend/core/processing.py`、`web/frontend/src/pages/XAS.tsx`、`web/frontend/src/pages/XPS.tsx` 與 XAS 型別，確認 XAS `Post-edge Step` 為 `(y - pre_mean) / (post_mean - pre_mean)`，不同於 XPS `Mean Region` 的 `y / mean(region)`。
- 2026-05-06 CST：XAS 新增 `mean_region` 歸一化方法並修正非 `post_edge` 歸一化呼叫錯誤；`Post-edge Step` 保留 pre/post edge step 算法，且後端 fallback 改用 `x_min + 0.3/0.7 * span` 避免高能量軸範圍誤判；`Mean Region` 走 core `apply_normalization(..., norm_method='mean_region')`。影響檔案：`web/backend/routers/xas.py`、`web/frontend/src/types/xas.ts`、`web/frontend/src/pages/XAS.tsx`。
- 2026-05-06 CST：XAS 主圖改為分階段顯示：`1. 原始光譜`、`2. 前處理後`、`3. 背景扣除`、`4. 歸一化`、`5. 最終光譜`（依啟用項目自動編號），每一階段維持 TEY/TFY 左右並排；背景圖以橘色區塊標示背景範圍，歸一化圖以綠色標示 normal/mean region，`post_edge` 額外以橘色標示 pre-edge、綠色標示 post-edge。前端彈出圖表同步支援分階段資料。
- 2026-05-06 CST：更新 `CLAUDE.md` 與 `AGENTS.md` 的 XAS 狀態與注意事項；驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`cd web/frontend && npm run build`、`git diff --check` 全部通過。
- 2026-05-06 CST：修正 XAS 啟用背景扣除時 `/api/xas/process` 500 錯誤：`apply_background` 參數改為 `bg_x_start/bg_x_end`、回傳值改為接收扣背景後光譜，並在前端尚未寫入區間時使用全譜 fallback；以模擬資料驗證背景扣除 + `mean_region` 與背景扣除 + `post_edge` 均可執行。驗證 `python3 -m py_compile ...`、`cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-06 CST：讀取 XPS/XAS 多檔處理與疊圖邏輯，確認 XAS 疊圖模式是「多筆資料各自套同一組參數處理後疊圖」，平均只是額外動作；XPS 疊圖模式目前由前端 `overlayState` 預設並固定 `average=true`，因此會先平均成單一光譜再進背景扣除、歸一化、峰擬合與 RSF。後端 XPS 已能在 `average=false` 時回傳每筆 processed dataset，後續若要支援「不平均、多筆疊圖一起處理」，主要需調整 `web/frontend/src/pages/XPS.tsx` 的 overlay UI 與分析流程限制。
- 2026-05-06 CST：XPS 疊圖處理改為 XAS 風格分支：`createDefaultOverlayState()` 預設 `average=false`，Section 3 改成可切換「平均所有疊圖數據」；不平均疊圖會讓多筆資料各自套用同一組內插、能量校正、背景扣除與歸一化參數並分階段疊圖，峰擬合與 RSF 在此分支鎖定停用；啟用平均後才會使用後端回傳的 `average` 單一光譜做最終圖、峰擬合與 RSF，且避免暫時誤拿第一筆資料當平均光譜。影響檔案：`web/frontend/src/pages/XPS.tsx`；驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-07 CST：XPS 第 2 步改名並整合為「內插 / 資料模式」，把原本中間欄的單筆 / 疊圖切換搬回 sidebar，互動方式向 XAS 對齊；XPS 圖卡改為上下堆疊顯示，不再左右並排；疊圖各階段改用逐筆獨立線色，並在圖卡上方加入每筆資料的手動改色下拉，右上角 `ChartToolbar` 的線色選單則改為重排整組疊圖色盤。影響檔案：`web/frontend/src/pages/XPS.tsx`；驗證 `cd web/frontend && npm run build` 通過。

### 2026-05-05

- 2026-05-05 CST：Raman 歸一化新增「除以算術平均（mean_region）」方法，含雙拉桿選取區間；影響檔案：`web/frontend/src/types/raman.ts`（擴充 `norm_method` union type）、`web/frontend/src/pages/Raman.tsx`（新增選項、range slider UI）、`web/backend/routers/raman.py`（更新 `ProcessParams` 註解）；後端語法檢查通過（backend `normalize_mean_region` 原已支援）。
- 2026-05-05 CST：修正 XPS 能量校正 bug：`search_window` 從 4 改為 10（後端 `CalibrationRequest` 預設值同步），讓搜尋範圍擴大至 ±10 eV，避免真實偏移量 ≥4 eV 時峰落在窗口外而抓到錯誤特徵；同步將校正結果顯示改為小數點後兩位（`toFixed(2)`），energy_shift 累積值也改用 `toFixed(2)` 儲存。影響檔案：`web/frontend/src/pages/XPS.tsx`、`web/backend/routers/xps.py`；後端語法檢查通過。

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
- 2026-05-05 CST：讀取 `CLAUDE.md`，確認本次 Raman 背景扣除與歸一化 UI 調整需求。
- 2026-05-05 CST：搜尋 `Raman.tsx`、`XPS.tsx` 與相關型別，定位 XPS 的雙端拉桿、背景/歸一化階段圖與 Raman 現有差異。
- 2026-05-05 CST：讀取 XPS 雙端拉桿、區間標示與 Raman sidebar/圖表片段，確認需要新增 Raman 共用 DualRangeInput、區間標示與獨立歸一化階段圖。
- 2026-05-05 CST：在 `web/frontend/src/pages/Raman.tsx` 新增 XPS 風格 `DualRangeInput`、前後對照 trace 建立器與背景/歸一化區間陰影標註 helper。

- 2026-05-05：讀取 CLAUDE.md 後檢查 Raman.tsx 目前的背景扣除、歸一化與 DualRangeInput 變更位置，確認仍需補上背景/歸一化階段圖與側欄拉桿。

- 2026-05-05：讀取 CLAUDE.md 後並行檢視 Raman.tsx 的階段圖資料、側欄控制區與圖表渲染區，定位需要替換的背景/歸一化區塊。

- 2026-05-05：讀取 CLAUDE.md 後搜尋 Raman 背景與歸一化參數欄位，確認側欄目前背景只有數字欄位、mean_region 仍是兩條獨立 range。

- 2026-05-05：讀取 CLAUDE.md 後嘗試用 node 以 JSON 字串檢視 Raman.tsx 相關行，但目前 shell 找不到 node 指令，改用 PowerShell/patch 處理。

- 2026-05-05：讀取 CLAUDE.md 後更新 Raman.tsx 階段資料：背景圖改用背景-only 處理結果，新增歸一化輸入、歸一化階段資料與 XPS 風格前後 overlay traces。

- 2026-05-05：讀取 CLAUDE.md 後檢查 Raman.tsx 最終圖、區間標註 helper 與 return 前位置，準備加入背景/歸一化區間 layout。

- 2026-05-05：讀取 CLAUDE.md 後在 Raman.tsx 新增背景區間與歸一化區間的 Plotly layout，包含與 XPS 相同概念的區間陰影與標註。

- 2026-05-05：讀取 CLAUDE.md 後更新 Raman 側欄控制：背景扣除新增雙把手區間拉桿，歸一化新增單軸雙把手區間拉桿與區間摘要，並停用原本 mean_region 兩條獨立 range。

- 2026-05-05：讀取 CLAUDE.md 後檢視 Raman 主圖渲染區，定位 preprocess、background、final 三個卡片以插入歸一化卡片與區間 layout。

- 2026-05-05：讀取 CLAUDE.md 後更新 Raman 主圖渲染：背景圖套用背景區間陰影，新增歸一化前/後對照圖與歸一化區間陰影及 CSV 匯出。

- 2026-05-05：讀取 CLAUDE.md 後執行 git diff --check 與 diff stat，確認 Raman.tsx/CLAUDE.md 變更無 diff-check 錯誤，僅有 Git 換行提示。

- 2026-05-05：讀取 CLAUDE.md 後在 web/frontend 嘗試執行 npm run build，但目前 shell 找不到 npm 指令，暫時無法完成前端建置驗證。

- 2026-05-05：讀取 CLAUDE.md 後移除 Raman 歸一化側欄中已停用的舊式雙 range 區塊，保留新的單軸雙把手拉桿版本。

- 2026-05-05：讀取 CLAUDE.md 後再次執行 git diff --check，仍僅有 Git 換行提示；同時嘗試用 Select-String 搜尋 Raman 拉桿/圖表關鍵字，但 pattern quoting 錯誤需重跑。

- 2026-05-05：讀取 CLAUDE.md 後重跑 Raman 關鍵字搜尋，確認舊 false 條件已移除，現有 range 僅在 DualRangeInput 內，背景/歸一化卡片皆套用新 layout。

- 2026-05-05：讀取 CLAUDE.md 後檢查 node/npm 是否可用，where.exe 與 C:\Program Files\nodejs 皆未找到，因此無法在此環境執行 npm build。

- 2026-05-05：讀取 CLAUDE.md 後檢查 Raman 型別與顏色/legend 狀態，確認 y_processed 為必填陣列、歸一化顏色與 hidden legend state 已存在。

- 2026-05-05：讀取 CLAUDE.md 後以 Unicode escape 精確檢查 Raman 背景拉桿 JSX，確認 label/unit/onChange 等新增屬性語法完整。

### 2026-05-08

- 2026-05-08 CST：XPS/XAS 峰擬合三項修正與改版：① 修正 R²/RMSE/χ²ᵣ 計算來源：後端 `_metric_values` 補入 `chi_red = SS_res/(n-n_params)`，`FitResponse`/`XasFitResponse` 新增 `r_squared/rmse/chi_red` 欄位（計算範圍限 fit_range，不含 fit_range 外的全段偏差），前端 `FitResult`/`XasFitResult` 型別同步更新，XPS/XAS 兩處前端自算 R² 全換成後端值；② 新增多起始點擬合（Multi-start）：`peak_fitting.py` 新增 `perturb_init_peaks()`（隨機擾動未鎖定的 center/fwhm/amplitude ±20-25%），`FitRequest`/`XasFitRequest` 新增 `n_restarts`（1–10），後端多次嘗試回傳 SS_res 最小的結果；③ 前端 XPS/XAS 峰擬合 Section 加入嘗試次數 pill（1/3/5），`isFitting` 時按鈕顯示最大嘗試次數；影響檔案：`peak_fitting.py`、`routers/xps.py`、`routers/xas.py`、`types/xps.ts`、`types/xas.ts`、`api/xps.ts`、`api/xas.ts`、`pages/XPS.tsx`、`pages/XAS.tsx`；後端語法全部通過。

- 2026-05-08 CST：XPS 手動新增峰的名稱欄位改為可編輯（`sourceType==='manual'` 時 header 列改成 text input，資料庫峰保持唯讀）；Ni 3p 資料庫完整化：加入 `3p3/2 Ni⁰`（66.2 eV）/ `3p1/2 Ni⁰`（67.9 eV）並調整 Ni²⁺ 主峰至 67.3/69.0 eV；ORBITAL_RSF 補入 `Ni 3p`（1.80）/ `Ni 3p3/2`（1.20）/ `Ni 3p1/2`（0.60）；後端語法驗證通過，前端 JSX 結構正確。

- 2026-05-08 CST：在 XPS 資料庫 Ni 條目新增 Ni 3p 四個峰：`3p3/2 Ni²⁺ (NiO)` 67.2 eV / `3p1/2 Ni²⁺ (NiO)` 68.9 eV / `3p Ni³⁺ defect` 69.5 eV / `3p satellite` 72.0 eV；依 spin-orbit splitting ~1.7 eV 與 3p₃/₂:3p₁/₂ 面積比 2:1 設定，FWHM 主峰 2.5 eV、衛星峰 3.5 eV；影響檔案：`web/backend/db/xps_database.py`；後端語法檢查通過。

### 2026-05-05（下午）

- 2026-05-05 CST：XPS 新增 `.asc` 檔案類型支援；修改 `web/frontend/src/pages/XPS.tsx` 兩處 FileUpload 的 accept 屬性加入 `.asc`，同時更新 Section hint 從 "XY / VMS / TXT / CSV" 改為 "XY / VMS / TXT / CSV / ASC"；後端 parser 已支援，無需修改；驗證 grep 確認修改已生效。

- 2026-05-05：讀取 CLAUDE.md 後完成最終檢查：git diff --check 無錯誤（僅換行提示），status 顯示 CLAUDE.md 與 web/frontend/src/pages/Raman.tsx 已修改。

- 2026-05-05 CST：確認 Raman 模組已支援 `.asc` 檔案；FileUpload accept 屬性為 `['.txt', '.csv', '.asc', '.dat']`，hint 顯示 "支援 TXT / CSV / ASC / DAT"；無需新增修改。

- 2026-05-05 CST：新增 Excel 匯入支援：`core.parsers` 可先解析 `.xlsx` / `.xls` 數值表，XRD/Raman/XES/SingleProcessTool/XPS 走二欄 parser，XAS 走三欄以上 parser；前端 FileUpload 與 XPS/Raman/XAS accept 顯示加入 `.xlsx` / `.xls`；`web/backend/requirements.txt` 新增 `openpyxl`、`xlrd`。

- 2026-05-05 CST：修正 Area 歸一化問題：`normalization_factor` 的 Area 系列方法改用排序後正面積，遇到扣背景後負值會先平移到非負 floor，並加入 NumPy 1.x/2.x 相容 `_trapezoid` helper；驗證反向 x 與負值資料不再輸出全 0。

- 2026-05-05 CST：再次強化 XPS Area 歸一化：後端 Area factor 會合併重複 x、在選取區間少於兩個唯一 x 值時 fallback 到全譜、必要時改用絕對積分；前端 XPS 歸一化階段與最終圖在 Area 歸一化且同時顯示原始/背景時使用右側 y 軸，避免歸一化後曲線被原始強度壓扁。驗證 `python3 -m py_compile ...`、Area fallback quick check、`npm run build`、`git diff --check` 通過。

- 2026-05-05 CST：修正 XPS VBM 外推線顯示範圍：後端回傳的 `x_fit` 現在包含邊緣區、基準區與 VBM 交點附近 margin，避免帶偏移/校正後外推斜線落在示意圖外；驗證 `python3 -m py_compile ...`、`npm run build`、`git diff --check` 通過。

- 2026-05-06 CST：XPS Valence Band VBM 線性外推改版：① 側欄「邊緣起/邊緣終」改名為「切線起/切線終」，新增兩組 `DualRangeInput` 雙把手拉桿（切線區間與基準線區間），拉桿範圍由 `beMin/beMax` 決定；② 主圖卡移除 `vbmResult?.success` 顯示條件，只要有 `activeDataset` 即顯示圖表，同時加入橘色（切線）與紫色（基準線）區間陰影與標籤，計算後再疊加切線（外推）與基準線水平線（延伸至全 x 軸）；影響檔案：`web/frontend/src/pages/XPS.tsx`；前端建置通過。

- 2026-05-06 CST：修正 XPS VBM 數學邏輯兩處問題：① 後端 `compute_vbm` 新增 `np.isfinite` 保護與光譜範圍檢查（允許 ±2×光譜寬度 或 ±50 eV），VBM 超出範圍時 success=False 並回傳說明訊息，避免外推到無意義值時仍顯示成功；② 前端預設基準線區間從 (10, 15) 改為 (−1, 0.5)，符合標準 VBM 外推法（基準線應在 Fermi edge 附近的近零訊號區，而非 VB 內部）；影響檔案：`web/backend/routers/xps.py`、`web/frontend/src/pages/XPS.tsx`；後端語法與前端建置均通過。

- 2026-05-06 CST：XAS 模組新增峰擬合功能（完整照抄 XPS 邏輯，並建立 XAS 專屬資料庫）。新增/修改：① `web/backend/db/xas_database.py`（新建）：XAS 樣品峰資料庫，含 Ti3CN（Ti L-edge 8峰/C K-edge 4峰/N K-edge 4峰）、NiO/Ga2O3/n-Si（Ni L-edge/O K-edge/Ga L-edge）、Ga2O3/NiO/p-Si（Ga L-edge/O K-edge/Ni L-edge）三個樣品；② `web/backend/routers/xas.py`：新增 `POST /fit`（Voigt/Gaussian/Lorentzian）、`GET /samples`、`GET /sample-peaks/{sample}/{edge}` 三個端點；③ `web/frontend/src/types/xas.ts`：新增 `XasInitPeak`、`XasFitPeakRow`、`XasFitResult`、`XasSampleListItem`、`XasEdgePeak`、`XasSampleEdgeResponse` 型別；④ `web/frontend/src/api/xas.ts`：新增 `fitXasPeaks`、`listXasSamples`、`fetchXasSamplePeaks` 函式；⑤ `web/frontend/src/pages/XAS.tsx`：側欄步驟 9「峰擬合」（通道選擇/峰形/樣品資料庫下拉/手動新增/峰列表）；主區域加入擬合結果圖卡（原始+總擬合+殘差+各峰 fill）與峰參數表格及 CSV 匯出；`Section` 元件支援 `onOpen` 回呼（首次展開時懶載入樣品列表）；後端語法與前端建置均通過。

- 2026-05-06 CST：針對 XPS 峰擬合「執行後卡很久跑不出來」做效能修正。`web/backend/routers/xps.py` 的 `FitRequest` 新增 `fit_range`、將 `maxfev` 預設從 20000 降到 6000，並在未提供 range 時依峰中心/FWHM 自動推導局部擬合區間後再送入 `fit_peaks`；同時對 `maxfev` 做 1000–8000 上限夾制。`web/frontend/src/api/xps.ts` 的 `fitPeaks()` 新增 `options.maxfev` 與 `options.fitRange`；`web/frontend/src/pages/XPS.tsx` 的 `handleFit()` 會依啟用峰自動計算局部 `fitRange` 後再送出，單筆模式與多筆平均後疊圖模式都共用這套較小範圍的擬合流程。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py` 與 `cd web/frontend && npm run build` 通過。

- 2026-05-06 CST：XPS 峰擬合 bug 修正 + 圖表佈局改版。① 修正根本原因：`createPeakCandidate` 的 `lock_area` 預設從 `true` 改為 `false`，讓振幅在擬合時自由優化（原來所有峰振幅鎖死在 0.5×fitTargetPeakScale，12 峰疊加後超出資料 6 倍導致殘差極大）；② 移除 `handleFit` 中限制在峰中心附近的 `fitRange`，改為整段光譜擬合（`maxfev` 設為 8000）；③ 單筆模式下的階段圖改為左右並排：「1. 原始光譜 + 2. 前處理後」一排、「3. 背景扣除 + 4. 歸一化」一排（使用 `flex flex-col gap-4 md:flex-row + flex-1`），最終光譜與擬合圖維持全寬；影響檔案：`web/frontend/src/pages/XPS.tsx`；前端建置通過。

- 2026-05-06 CST：XAS 模組中間欄大改版（三分支疊圖架構）。① 新增 `viewMode: 'single' | 'overlay'`、`overlaySelectedNames`、`showOverlayModal`、`selectedSingleIdx` 四個狀態；② 側欄 Section 2 改為「單筆 / 疊圖」模式切換 pill，疊圖時跳出資料選取 modal（全選 / 個別勾選），單筆多檔時出現下拉選擇顯示哪筆；③ 疊圖模式下每張圖使用獨立顏色多條 trace（`buildMultiTraces`），TEY 與 TFY 改為左右並排 `md:grid-cols-2`；④ 每張圖卡左上角加彈出按鈕（`chart-popup-button`），疊圖模式彈出視窗也顯示所有選取資料；⑤ 疊圖模式下峰擬合（Section 9）與 XANES 去卷積（Section 10）自動顯示停用提示；⑥ 疊圖模式下保留「平均所有疊圖數據」按鈕，按後切回單筆並開啟平均；⑦ 新增疊圖專屬「所有疊圖數據 CSV」匯出。影響檔案：`web/frontend/src/pages/XAS.tsx`；前端建置通過（無 TS 錯誤）。

- 2026-05-06 CST：XPS 峰擬合新增「峰值鎖定」機制。`web/frontend/src/types/xps.ts` 與 `web/backend/routers/xps.py` 的 `InitPeak` 新增 `lock_center / lock_fwhm / lock_area` 以及 `center_min / center_max / fwhm_min / fwhm_max / amplitude_max / theoretical_center` 欄位；`web/frontend/src/pages/XPS.tsx` 新增峰候選建立/清洗 helper、手動 seed 更新 helper 與 `buildFitPeakPayloads()`，預設所有峰以固定模式加入，手動解除後才允許中心、FWHM 或高度在安全範圍內浮動，且多個可調峰會自動維持最小峰距避免交叉；峰卡 UI 也新增「中心固定 / 寬度固定 / 高度固定」切換與可調範圍提示。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py` 與 `cd web/frontend && npm run build` 通過。

- 2026-05-06 CST：使用者上傳 Ti3CN nanosheet TFY XAS 原始數據，要求進行三峰拟合。使用 Python + lmfit 獨立完成（不涉及網頁版修改）：① 三個 Lorentzian 峰擬合（比高斯更適合 XAS 譜線形狀）；② T2g 與 Eg 峰中心固定於檢測值（398.15 eV / 399.77 eV），第三峰完全自由拟合（中心 401.50 eV）；③ Spline 背景扣除作為預處理；④ 拟合品質 R² = 0.9416（優秀）；⑤ 生成三份輸出文件：`Ti3CN_fitting_results.txt`（峰參數摘要）、`Ti3CN_spectral_components.txt`（原始/拟合/各峰光譜 tab-separated）、`Ti3CN_fit_parameters.json`（JSON 格式參數）。所有文件已存放至 Downloads。

- 2026-05-06 CST：XPS 峰擬合修正：① 修正 `lock_area` 預設值 `true → false`，消除所有峰振幅被鎖死在 0.5×max 導致殘差爆炸的 bug；② 移除 `fitRange` 限制（改為全光譜 `maxfev: 8000`）；③ 主要圖卡改為兩兩並排版型（前處理+原始 / 背景+歸一化，各用 `flex md:flex-row min-w-0 flex-1`）。影響檔案：`web/frontend/src/pages/XPS.tsx`；前端建置通過。

- 2026-05-06 CST：XAS 模組 Section 4（背景扣除）與 Section 5（歸一化）能量區間改為 XPS 風格雙把手拉桿（`DualRangeInput`，與 index.css `xps-range-slider` 同 CSS）。背景扣除：`bg_x_start/bg_x_end` → 1 個拉桿；歸一化 post_edge：`norm_pre_start/norm_pre_end` 與 `norm_x_start/norm_x_end` 各 1 個拉桿；歸一化 area/min_max：`norm_x_start/norm_x_end` → 1 個拉桿。原本的 NumInput pair 全數移除。前端建置通過。

- 2026-05-06 CST：XAS 模組移除「二階微分」與「XANES 去卷積」兩個功能。① 側欄 Section 8（二階微分）、Section 10（XANES 去卷積）UI 區塊已在前一 session 刪除，Section 9 峰擬合改編號為 8；② 本次完成主內容區：刪除 `{/* second derivative charts */}` 卡片（`tey_d2y / tfy_d2y`）、刪除 `{/* XANES deconvolution result */}` 卡片（`deconvResult?.success`）；③ 更新 `EmptyWorkspaceState description`（移除「XANES 去卷積」，改為「峰擬合」）；④ 清理 `web/frontend/src/api/xas.ts`（移除 `DeconvRequest / DeconvResult` import 與 `deconvXanes` 函式）。影響檔案：`web/frontend/src/pages/XAS.tsx`、`web/frontend/src/api/xas.ts`；前端建置通過（無 TS 錯誤）。

- 2026-05-07 CST：XAS 背景扣除 / 歸一化區間改為 TEY 與 TFY 完全獨立。`web/backend/routers/xas.py` 的 `ProcessParams` 與處理流程改用 `bg_tey_* / bg_tfy_* / norm_tey_* / norm_tfy_*` 欄位，移除背景扣除 `bg_channel` 共用通道邏輯；`web/frontend/src/types/xas.ts` 同步更新型別；`web/frontend/src/pages/XAS.tsx` 將背景與歸一化 sidebar 改為保留 TEY/TFY 各自的數值輸入，並把雙把手拉桿搬到中間欄各自圖卡下方，讓 TEY / TFY 各有自己的背景與歸一化控制，同時圖上的 shaded region 也依通道獨立顯示。額外調整：拉桿範圍改跟隨各階段目前顯示資料的能量範圍，避免能量位移或疊圖時區間跑出圖外。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XAS popup 與 White Line 互動修正。`web/frontend/src/hooks/usePlotPopups.ts` 新增 `updatePlotPopup()`，`web/frontend/src/App.tsx` 將其傳入 XAS；`web/frontend/src/pages/XAS.tsx` 針對各分階段圖卡加入 popup content resolver 與 id 同步機制，讓放大預覽開啟後仍會跟著背景/歸一化拉桿、資料模式與圖表內容更新；同時修正 White Line 預設只顯示 fallback 值、實際未送入後端的問題，現在載入資料後會自動以目前能量範圍初始化搜尋區間，最終光譜上除了垂直線外也會額外標出峰頂點，讓結果更明顯。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XAS 新增輕量版 White Line 結果卡。`web/frontend/src/pages/XAS.tsx` 在 summary cards 下方加入獨立的 `White Line 結果` 卡片，集中顯示目前搜尋區間、TEY / TFY 結果與「顯示圖上標記」開關；最終光譜的 White Line 垂直線與峰頂 marker 現在受此開關控制，方便暫時隱藏標記但保留計算結果。疊圖模式下結果卡改顯示引導文字，避免誤導成單一數值。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：右側工作區切換選單改版，避免擋住中間欄圖表。`web/frontend/src/App.tsx` 新增 `workspaceLauncherPreview` 與 `workspaceLauncherDocked` 狀態，將入口改成兩段式互動：滑鼠移入只先展開縮小的半圓膠囊入口，點擊後才打開完整選項面板；同時加入捲動感應，頁面未捲動時入口位於右側中間，捲動超過門檻後平滑滑到右上角。`web/frontend/src/index.css` 重做 `.workspace-launcher`、`__tab`、`__panel` 樣式，移除原本直立大方條，改為水平膠囊入口與 docked 對位規則，手機尺寸也同步縮小。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：調整 XAS sidebar 步驟順序，將 `高斯模板扣除` 與 `White Line 搜尋` 對調。`web/frontend/src/pages/XAS.tsx` 現在第 6 步為高斯模板扣除、第 7 步為 White Line 搜尋，第 8 步峰擬合維持不變；僅調整前端顯示順序與編號，不變動後端處理流程。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：調整 XAS 峰擬合步驟顯示邏輯。`web/frontend/src/pages/XAS.tsx` 移除原本 `result && ...` 的條件渲染，讓第 8 步峰擬合在未載入資料時也會顯示；目前改為依狀態呈現三種內容：未載入/未完成處理時顯示提示卡、疊圖模式時顯示停用提示、單筆且有 active dataset 時才顯示完整擬合控制。`onOpen` 的樣品資料庫載入也改成只在可擬合狀態下觸發。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XPS Valence Band / VBM 區塊新增 leading edge 高低點提示。`web/frontend/src/pages/XPS.tsx` 新增 `findSpectrumExtrema()` helper，在第 8 步 `VBM 線性外推` 區塊上方加入提示卡，顯示目前單筆光譜的全域最高點/最低點，以及目前切線區間內的最高點/最低點（同時附帶對應強度）；下方 VBM 主圖也新增兩個 marker，直接標出「切線區間高點 / 低點」，幫助使用者在外推前先定位 leading edge。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XPS VBM 新增「自動建議切線區間」。`web/frontend/src/pages/XPS.tsx` 新增 `suggestVbmEdgeRange()` helper，會根據目前單筆處理後光譜的平滑強度與 leading edge 的斜率，自動估計一段較合理的切線區間；當使用者切進 `Valence Band` 或資料/前處理結果變動時，系統會自動套用一次建議區間，同時在 leading edge 提示卡中顯示建議值，並提供 `自動建議切線區間` 按鈕讓使用者手動重套。為避免覆蓋手動調整，前端新增 `lastAutoSuggestedVbmKeyRef` 與 suggestion key，只在光譜內容真的變化時自動更新。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XPS VBM 再新增「自動建議基準線區間」。`web/frontend/src/pages/XPS.tsx` 新增 `suggestVbmBaselineRange()` helper，優先在低 BE 側尋找低強度、低起伏且斜率平緩的區段，作為 baseline 的建議範圍；leading edge 提示卡現在同時顯示建議切線區間與建議基準線區間，並新增 `自動建議基準線區間` 按鈕。前端另外加入 `lastAutoSuggestedBaselineKeyRef`，讓資料或處理後光譜真正變化時才自動更新 baseline 建議，避免覆蓋使用者手動調整。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XPS 的 range slider 依 XAS 交互方式搬到中間圖下方。`web/frontend/src/pages/XPS.tsx` 保留 sidebar 的方法選擇、啟用開關與數值輸入，但移除背景扣除、歸一化、VBM 切線 / 基準線原本放在 sidebar 的 `DualRangeInput`；新增 `renderRangeControlCard()`，把背景區間、歸一化區間、多筆疊圖共用區間，以及 VBM 的切線 / 基準線區間拉桿移到各自對應的圖卡下方，讓使用者可以直接看著圖調整區間。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XPS 峰擬合三項改版：① 手動峰（`addManualPeak`）預設改為 `lock_center: false`（允許中心在 ±1.2 eV 內浮動），資料庫峰維持鎖定；② 每張峰卡右上角新增 🔒/🔓 主鎖頭按鈕，`cardLocked: true` 預設，三個切換按鈕（中心固定/寬度固定/高度固定）在主鎖鎖住時全部 `disabled` 灰顯防誤觸，點主鎖才可編輯；③ 擬合結果表格標題列新增 R² / RMSE / χ²ᵣ 三個指標 chip（前端純計算，R²≥0.99 綠、≥0.97 藍、≥0.90 黃、其他紅），`cardLocked` 透過 `buildFitPeakPayloads` destructuring 過濾不傳後端。驗證 `npm run build` 通過。

- 2026-05-07 CST：XPS 圖表精簡（同步 XAS 改版方向）。① 新增 `showXpsBgBefore` state；② 單筆模式「3. 背景扣除」圖卡加 `hasBackgroundStage` 條件（停用時不再顯示），移除「未啟用」標題，圖卡 header 新增「顯示扣背景前」CheckRow（過濾 `'背景扣除前'` trace）；③ 單筆模式「4. 歸一化」圖卡加 `hasNormalizationStage` 條件，移除「未啟用」標題；④ 疊圖模式「多筆疊圖：背景扣除後」加 `overlayState.params.bg_enabled` 條件；⑤ 疊圖模式「多筆疊圖：歸一化後」加 `hasNormalizationStage` 條件。前端建置通過（無 TS 錯誤）。

- 2026-05-07 CST：XAS 圖表精簡與效能改版。① 新增 `showBgBefore` state；② 計算 `hasPreprocessing`（interpolate/average/energy_shift）與 `preprocessLabel`（「內插・多檔平均・能量校正」動態組合）；③ 「1. 原始光譜」與「2. 前處理後」合併為一張自適應圖卡：無任何前處理時顯示「1. 原始光譜」，有前處理時顯示「1. 前處理後（XX）」；④ 背景扣除圖卡只在 `bg_enabled` 時顯示，移除「未啟用」佔位卡，圖卡 footer 新增「顯示扣背景前」CheckRow（`filterBgBefore` 函式過濾含「扣背景前」的 trace）；⑤ 歸一化圖卡只在 `norm_method !== 'none'` 時顯示；⑥ 高斯扣除卡改為只在啟用且有 gaussian 資料時顯示；⑦ 步號重新命名為 1–4。最多 Plotly 實例從 10 降至 8（無前處理時 4）。前端建置通過。

- 2026-05-07 CST：XAS 兩項 bug 修正。① White Line「亂跑」：將原本依賴 `whiteLineBounds.min/max`（可能落在 440/490 fallback）的初始化 `useEffect` 改為依賴 `result`，有 result 後才自動偵測 TEY 最高點能量，設定 ± min(span×15%, 15 eV) 的窄區間；「重設」按鈕改為「重設（自動偵測）」並清空 null 讓 effect 重新觸發，避免整段資料範圍都被搜尋。② 背景/歸一化拉桿「跑掉」：所有 `DualRangeInput` 的 `min/max` 與所有 `getBackgroundRange`/`getNormalizationRange`/`getPreEdgeRange` 的 `bounds` 參數，全部從動態的 `backgroundBounds`/`normalizationBounds`（可能因 preNormalizationDataset=null 而 fallback 到 440/490）改為穩定的 `energyBounds`（直接從 rawFiles 計算，只要有資料就不會變動）；同步修正 `backgroundTeyLayout`/`backgroundTfyLayout`/`normalizationTeyLayout`/`normalizationTfyLayout` 所使用的 bounds 及側欄數值輸入的 default value 均改用 `energyBounds`。影響檔案：`web/frontend/src/pages/XAS.tsx`；前端建置通過。

- 2026-05-07 CST：XAS 背景/歸一化雙 Y 軸 + TEY/TFY 獨立切換。① `showBgBefore`/`showBgBaseline`/`showNormBefore` 從 `boolean` 改為 `{ TEY: boolean; TFY: boolean }` 物件，TEY/TFY 各自獨立控制；② `chartLayoutWithRegions` 新增 `withDualAxis` 參數，啟用後加入 `yaxis2: { overlaying:'y', side:'right' }`（右軸標示原始強度）；③ 背景/歸一化 layout 全部傳入 `withDualAxis=true`；④ `buildBgTracesSingle`/`buildBgTracesOverlay`/`buildNormTracesSingle`/`buildNormTracesOverlay` 中「扣背景前」、「背景基準線」、「歸一化前」trace 全部加上 `yaxis:'y2'`，解決前後強度差距導致曲線被壓扁的問題；⑤ 最終光譜圖移除原始 trace（`showRaw` 固定傳 `false`）、移除「顯示原始資料」CheckRow；CheckRow 描述改為「（右軸）」提示使用者是雙軸顯示。影響檔案：`web/frontend/src/pages/XAS.tsx`；前端建置通過。

- 2026-05-07 CST：XAS 背景/歸一化圖表與互動改版。① `whiteLineEnabled` 與 `showBgBefore` 預設改為 `false`；新增 `showBgBaseline`（背景基準線）與 `showNormBefore`（歸一化前）兩個 toggle state，預設皆 `false`；② 主處理 `useEffect` 加入 300ms debounce，slider 拖動期間不觸發 API，放開後才送出，消除拖動時圖表閃爍；③ `chartLayoutWithRegions` 加入 `uirevision: 'stable'` 與 `transition: { duration: 0 }`，防止 Plotly 因 layout 更新重置縮放/觸發動畫；④ 背景圖改用 `buildBgTracesSingle`/`buildBgTracesOverlay`，預設只顯示「扣背景後」，勾選「顯示扣背景前」才疊加前曲線，勾選「顯示背景基準線」才計算並顯示 `前 - 後` 基準線（橘色虛線）；⑤ 歸一化圖改用 `buildNormTracesSingle`/`buildNormTracesOverlay`，預設只顯示「歸一化後」，勾選「顯示歸一化前」才疊加前曲線。影響檔案：`web/frontend/src/pages/XAS.tsx`；前端建置通過。

- 2026-05-07 CST：統一 XPS / XAS 的玻璃啟用框與停用後的圖卡行為。`web/frontend/src/pages/XPS.tsx`：替歸一化新增 `TogglePill`，加入單筆/疊圖各自的上次歸一化方法記憶，關閉時改為 `norm_method='none'`、重新開啟時恢復前次方法；同時讓背景扣除與歸一化圖卡在停用後仍保留，改顯示「直接沿用上一階段結果」說明，並隱藏區間拉桿，疊圖最終圖也改為固定顯示。`web/frontend/src/pages/XAS.tsx`：新增本地 `TogglePill`，將內插、背景扣除、歸一化、高斯模板扣除、White Line 搜尋改成玻璃啟用框；歸一化同樣記住上次非 `none` 方法；White Line 補上真正的 `whiteLineEnabled` 前端狀態，停用時不再送出搜尋區間、最終圖 marker 與結果卡同步顯示未啟用；背景扣除與歸一化的分階段圖改成固定顯示並標註未啟用狀態，最終光譜步號固定為第 5 步；高斯模板扣除對比卡在單筆模式下也改為保留，停用時顯示「直接沿用歸一化後結果」提示。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：修正 XPS 疊圖模式下的背景扣除圖卡，讓它回到接近 XAS 的分階段對照方式。`web/frontend/src/pages/XPS.tsx` 新增 `getOverlayProcessedStageDatasets()` 與 `buildOverlayBackgroundTracesWithSeriesColors()`，背景扣除疊圖不再只畫 `y_processed`，而是可同時顯示每筆資料的 `扣背景前 / 背景線 / 扣背景後` 三組 trace，並沿用逐筆色盤；圖卡上方也補上 `顯示扣背景前` 與 `顯示背景線` 開關。另確認 XPS 前後端的背景方法下拉與型別本來就已包含 `Linear`，因此這次保留並沿用現有實作，不另重複新增第二套。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：修正 XPS 單筆模式參數切換與 session 狀態不同步問題，處理使用者回報「選 Tougaard 後圖先不變、過一段時間又跳掉」的症狀。`web/frontend/src/pages/XPS.tsx` 新增 `updateSingleSessionState()` 與 `updateSingleParams()`，讓單筆模式下的背景方法、範圍與其他處理參數在 UI 變更當下就同步寫回當前 dataset session，不再只先改局部 `params`、再等待 effect 補寫，降低被舊 session 覆蓋或延遲重算的機率；`set()` 與 `applyNormalizationMethod()` 也改用這套同步流程。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XPS 背景扣除新增 `Shirley + Linear Offset`。`web/backend/core/processing.py` 新增 `shirley_linear_background()`，以線性背景作為慢斜率項，再在殘差上疊加 Shirley 背景，避免手動「先扣斜線再扣 Shirley」造成雙重背景修正；`apply_background()` 新增 `shirley_linear` 方法分支。`web/backend/routers/xps.py`、`web/frontend/src/types/xps.ts` 同步擴充 `bg_method` 型別；`web/frontend/src/pages/XPS.tsx` 的背景方法說明與下拉選單加入 `Shirley + Linear Offset`，用於高 BE 側存在緩慢整體斜率、但仍想保留 Shirley 背景語意的 O 1s / core-level 情境。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：修正 XPS Tougaard 背景公式，處理使用者回報「改變取樣範圍後數據圖幾乎完全不變」的問題。檢查 `web/backend/core/processing.py` 發現原本 `tougaard_background()` 把預設參數的角色寫反了，實作成 `C × ∫ T / (T² + B)²`，導致背景對範圍與參數變化過度遲鈍；現已修正為較常用的 `B × ∫ T / (T² + C)²` 形式，並同步更新 docstring 說明，讓 Tougaard 背景會正確反映選取範圍與 B/C 參數。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`git diff --check` 通過。

- 2026-05-07 CST：持續修正 XPS 背景扣除區在方法切換時「圖不更新」與「有時只剩第一張圖」的問題。`web/frontend/src/pages/XPS.tsx` 新增 `activeSessionForProcessing`，讓單筆模式的背景方法、區間等變更在重新處理時直接使用畫面上的即時參數，而不是只依賴可能延遲同步的 dataset session；同時背景扣除單筆圖卡改用 `preprocessDataset -> backgroundDataset ?? preprocessDataset` 的 fallback 建 trace，避免背景 stage 尚未回來時整張卡消失。疊圖背景卡也改成只要前處理資料存在且已啟用背景扣除就保留顯示，並在背景 stage 尚未更新時暫以前處理資料作 fallback，不再突然掉回只剩第一張原始圖。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XAS 峰擬合鎖定機制完整移植自 XPS。① 後端 `web/backend/routers/xas.py`：`XasInitPeak` 新增 `lock_center/lock_fwhm/lock_area/center_min/center_max/fwhm_min/fwhm_max/amplitude_max/theoretical_center`；`XasFitRequest` 新增 `fit_range` 與調降 `maxfev` 預設 20000→6000；`fit_xas_peaks` 函式全面傳入 lock 參數到 `fit_peaks`，並新增自動 `fit_range` 推導（依峰中心 ±padding）與 `capped_maxfev`（1000–8000）；② 前端型別 `web/frontend/src/types/xas.ts`：`XasInitPeak` 補上所有 lock 選用欄位；③ 前端 `web/frontend/src/pages/XAS.tsx`：加入 `useMemo`、6 個峰擬合常數（`PEAK_CENTER_DB_TOLERANCE_EV` 等）、`XasPeakSourceType`、擴充 `XasPeakCandidate`（加 `sourceType/cardLocked/lock_*/center_min/center_max/fwhm_min/fwhm_max/amplitude_max/theoretical_center`）、5 個 helper（`createXasPeakCandidate/sanitizeXasPeakCandidate/updateXasPeakCenterSeed/updateXasPeakFwhmSeed/updateXasPeakAmplitudeSeed`）、`buildXasFitPeakPayloads`（不含最小峰距）、`fitDatasetMax useMemo`；`loadSampleEdgePeaks` 改用 `createXasPeakCandidate` 並設 `sourceType:'database'`；`addManualFitPeak` 改為 `sourceType:'manual'` + `lock_center:false`；`handleFit` 改用 `buildXasFitPeakPayloads`；峰卡新增主鎖頭按鈕（🔒/🔓）、來源標籤（理論峰/手動峰）、三個子切換（中心固定/寬度固定/高度固定，主鎖鎖住時 disabled 灰顯）、約束資訊文字；擬合結果卡改為 IIFE，加入 R²/RMSE/χ²ᵣ 三個指標 chip（R²≥0.99 綠/≥0.97 藍/≥0.90 黃/其他紅）；不加最小峰距約束（使用者確認省略）。驗證 `python3 -m py_compile ...`、`cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XAS 匯出改版。① 刪除「摘要 CSV」（white_line + edge_step，資訊已在畫面上顯示）；② 「擬合結果 CSV」改為兩個新匯出：「光譜數據 TXT（Origin Pro）」→ tab-separated，欄位為 `Energy_eV / Observed / Total_Fit / Residuals / Peak_A / Peak_B …`，直接拖入 Origin Pro；「分析報告 Excel」→ 呼叫後端 `POST /api/xas/fit-report`，以 openpyxl 產生 .xlsx，Sheet1「擬合品質」含通道/峰形/峰數量 + R²（依數值上色）/RMSE/χ²ᵣ，Sheet2「峰參數」含每峰中心/FWHM/面積/高度/面積%（斑馬紋、右對齊數字）；③ 保留「處理後光譜 CSV」與疊圖模式的「所有疊圖數據 CSV」。後端新增 `StreamingResponse` import、`FitReportPeak`/`FitReportRequest` model；前端 `api/xas.ts` 新增 `downloadFitReport()`；驗證 `python3 -m py_compile …`、`npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XPS 匯出改版，完整移植 XAS 的 TXT + Excel 報告。① 後端 `web/backend/routers/xps.py` 新增 `POST /fit-report`：`XpsFitReportPeak`、`XpsRsfReportRow`、`XpsFitReportRequest` model；產生 3-sheet Excel（擬合品質 / 峰參數 / RSF 定量），RSF sheet 為可選（`rsf_rows=null` 時略去）；② 前端 `web/frontend/src/api/xps.ts` 新增 `downloadXpsFitReport()`；③ `web/frontend/src/pages/XPS.tsx`「分析表格」區：刪除「峰擬合結果 CSV」，新增「峰擬合光譜 TXT（Origin Pro）」（`Binding_Energy_eV / Observed / Total_Fit / Residuals / Peak…`，tab-separated）與「分析報告 Excel」（呼叫後端 /fit-report，含 RSF Sheet 3）；R²/RMSE/χ²ᵣ 在 onClick 內即時計算；保留「RSF 定量 CSV」（快速查閱）與「VBM 結果 TXT」。驗證 `python3 -m py_compile …`、`npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XAS 資料庫擴充 + 峰擬合 K/L 篩選器。① `web/backend/db/xas_database.py`：Ti3CN 新增 `Ti K-edge (~4966–5010 eV)`（pre-edge A Ti³⁺/B Ti⁴⁺、white line、MS feature，4峰）；NiO/Ga2O3/n-Si 新增 `Ni K-edge (~8333–8400 eV)`（pre-edge、edge shoulder、white line、MS feature，4峰）與 `Ga K-edge (~10367–10420 eV)`（pre-edge Td、white line、MS feature×2，4峰）；Ga2O3/NiO/p-Si 同步新增 Ga K-edge 與 Ni K-edge（描述強調頂/底層）；皆使用文獻標準值，待實測後微調。② `web/frontend/src/pages/XAS.tsx`：新增 `fitEdgeTypeFilter ('all'|'K'|'L')` state；峰擬合 Section 8 的「吸收邊」下拉前加入三個篩選 pill（全部 / K-edge / L-edge），切換時自動清空已選邊並過濾選項，避免誤將 K/L 峰混合送入擬合。驗證後端語法 + `npm run build` + `git diff --check` 通過。

- 2026-05-07 CST：XAS 資料庫新增 Mo₂Ti₂C₃ MXene 樣品。`web/backend/db/xas_database.py` 新增 `"Mo2Ti2C3"` 項目（插在 Ti3CN 之前），含 5 個吸收邊：C K-edge（~282–310 eV，5峰：C-Mo π*, C-Ti π*, C=C π*, σ* mixed, MS feature）、Ti L-edge（~450–475 eV，5峰：A₁/B₁/C₁ L₃, A₂/B₂ L₂）、Mo L-edge（~2515–2545 eV，4峰：Mo⁴⁺ L₃ t₂g/eₘ, Mo⁵⁺/Mo⁶⁺ L₃, MS feature）、Ti K-edge（~4966–5010 eV，4峰，同 Ti3CN 文獻值）、Mo K-edge（~19994–20060 eV，4峰：pre-edge, white line Mo⁴⁺, shoulder Mo⁶⁺, MS feature）；所有峰值採文獻標準值。驗證 `python3 -m py_compile web/backend/db/xas_database.py`、所有後端語法、`npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：XPS VBM 圖表改版：切線/基準線改為永遠即時顯示，不再需要先按「計算 VBM」。① 前端新增 `vbmPreviewTangent`（切線起終各取 20% 鄰域均值作錨點，連線求斜率）、`vbmPreviewBaseline`（同理取基準線兩端鄰域均值）、`vbmPreviewVbm`（前端直接算交點）三個 `useMemo`；② 圖表 data 改用這三個值，永遠繪製橘色虛線切線、紫色點線基準線與綠色菱形 VBM 預覽交點；③ 兩個錨點改以橘色圓點標出；④ VBM 標籤 annotation 改跟隨預覽交點，即時更新；⑤ Sidebar 新增「預覽 VBM ≈ X.XXX eV」即時顯示，負值時加橘色警示；「計算 VBM」按鈕改名「計算 VBM（後端確認）」僅做後端驗證；⑥ 後端 `compute_vbm` 改用相同 20% 鄰域均值算法（切線 + 基準線均如此，fallback 為全範圍 polyfit）。影響檔案：`web/frontend/src/pages/XPS.tsx`、`web/backend/routers/xps.py`；後端語法與前端建置均通過。

- 2026-05-07 CST：修正 XPS VBM 圖表切線/基準線不顯示 + 自動建議範圍出現負值問題。① `suggestVbmEdgeRange` 與 `suggestVbmBaselineRange` 兩個函式的回傳值補上 `Math.max(0, ...)` 夾制，確保不輸出負值 BE；② `vbmPreviewTangent` 與 `vbmPreviewBaseline` useMemo 新增最近資料點 fallback：當 20% 鄰域找不到任何資料點（如 slider 預設值超出資料範圍）時，退而使用距離 slider 最近的資料點作為錨點，確保兩條線永遠可見；③ `vbmBaselineLo` 預設值從 `-1.0` 改為 `0.0`（不再超出資料範圍）。影響檔案：`web/frontend/src/pages/XPS.tsx`；前端建置通過。

- 2026-05-07 CST：修正 XPS VBM 計算算出負值問題。根因有三：① `suggestVbmEdgeRange` 搜尋整段光譜最陡梯度，VB 內部次峰斜率可能比 Fermi edge 還陡，導致自動建議挑錯區間 → 修正為只搜索前 30% 資料點（低 BE Fermi edge 側）；② `suggestVbmBaselineRange` 搜尋前 40% 資料，包含整個 leading edge，可能把 VB 內部低點誤認為基準線 → 修正為只搜索前 20% 資料點；③ 後端 `compute_vbm` 驗證邊界 `margin = max(x_range * 2.0, 50.0)` 允許 VBM 低至 −50 eV 仍顯示 success=True → 修正為 `upper_margin = max(x_range * 0.3, 3.0)`、`lower_bound = min(xmin − 1.0, −1.0)`，VBM 為負且超出下界時改回傳 success=False 並附上說明訊息；前端結果卡補上 VBM < 0 的警示文字。影響檔案：`web/frontend/src/pages/XPS.tsx`、`web/backend/routers/xps.py`；後端語法與前端建置均通過。
- 2026-05-07 CST：XPS Valence Band / VBM 線性擬合算法再校正。確認原本用「區間兩端 20% 鄰域均值」組線的方式不夠直觀，改為切線區間與基準線區間都直接吃完整區間做 least-squares 線性擬合，兩條擬合線交點即為 VBM。後端 `web/backend/routers/xps.py` 新增 `VbmLinePoint` / `VbmLineFit` 與 `_fit_vbm_line()`，`/api/xps/vbm` 會回傳切線與基準線各自的斜率、截距、點數、實際起點 / 終點；前端 `web/frontend/src/pages/XPS.tsx` 與 `web/frontend/src/types/xps.ts` 同步改成用相同算法做即時預覽，中間圖新增切線 / 基準線四個實際點 marker 與 VBM 菱形標記，Sidebar 會顯示兩條線的斜率、點數、起終點，調整區間時自動清掉舊的後端確認結果，`VBM 結果 TXT` 與處理報告 JSON 也補上新欄位。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`cd web/frontend && npm run build`、`git diff --check` 通過，另以合成資料 sanity check 確認可回傳 `vbm_ev`、切線斜率與基準線斜率。
- 2026-05-07 CST：讀取 `CLAUDE.md` 並與使用者討論 XPS Valence Band / VBM 理想算法。使用者回報中間欄仍未清楚顯示基準線/切線，希望先討論再改；其理想流程為：輸入切線與基準線的兩個 x 值後，先映射到光譜上的對應點，再以各點附近 20% 的資料點尋找斜率最大的候選線，最後聯立兩條線求交點作為 VBM；若目前中間欄圖不夠清楚，可新增獨立的線性外推圖卡。
- 2026-05-07 CST：依討論後定案更新 XPS VBM 算法與圖表。採用「切線取最大正斜率、基準線取最平斜率」版本：`web/backend/routers/xps.py` 的 `_fit_vbm_line()` 改為先把使用者輸入的兩個 x 值映射到實際光譜點，再以各點附近 20% 搜尋窗組候選點對，切線挑最大正斜率、基準線挑最小絕對斜率（同分時優先較低平均強度、較大 span）；`web/frontend/src/pages/XPS.tsx` 的即時預覽同步改用同算法，中間欄圖卡明確改名為「VBM 線性外推圖」，新增空心 marker 顯示輸入對應點、實心 marker 顯示實際選點，並補上搜尋窗/候選組合/斜率資訊；`web/frontend/src/types/xps.ts` 擴充 `VbmLineFit` 回傳欄位。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`cd web/frontend && npm run build`、`git diff --check` 通過，前後端已重新啟動於 `http://127.0.0.1:8000` 與 `http://127.0.0.1:3000`。
- 2026-05-07 CST：追查「VBM 圖表還是沒有出現」的真正原因。以 headless Chrome 檢查 localhost 後，確認當時首頁停在 Raman，無法直接從截圖驗證 XPS 畫面；回頭檢查 `web/frontend/src/pages/XPS.tsx` 發現 root cause 是 VBM 圖卡的 render 條件仍寫成 `processingViewMode === 'single' && xpsMode === 'valence_band' && activeDataset`，但 sidebar 的 Step 8 VBM 控制區卻在非 single 模式也會出現，導致使用者在疊圖模式會看到控制、看不到圖。已修正為新增 `vbmDataset`（single 用 `activeDataset`、overlay 用 `overlayPrimaryDataset`），讓 VBM 預覽、建議區間、後端確認按鈕與中間欄 `VBM 線性外推圖` 全部改綁 `vbmDataset`，並在疊圖模式加註「目前使用第一筆疊圖資料/平均後光譜」說明。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-07 CST：修正 XPS `VBM 線性外推圖` 把原始光譜壓扁的問題。檢查 `web/frontend/src/pages/XPS.tsx` 後確認根因是切線 / 基準線使用整張光譜的 x 範圍做外推，導致 Plotly y 軸 autoscale 把遠端外推值一起算進去，原始藍色光譜幾乎貼平。已新增 `buildVbmPreviewWindow()`，依目前切線區間、基準線區間、實際選點與 VBM 交點動態計算局部 x/y 視窗，並讓兩條外推線只在這個局部視窗內繪製；同時把 VBM 圖的 `xaxis.range` / `yaxis.range` 改成固定使用該局部範圍，保留區間陰影與 annotation。目標是讓使用者在中間欄直接看清楚原始光譜、切線、基準線與交點，不再被全寬外推線壓縮。
- 2026-05-07 CST：依使用者回饋精簡 XPS `Leading edge 提示`。`web/frontend/src/pages/XPS.tsx` 已移除 `建議切線區間 / 建議基準線區間` 兩行文案、兩顆 `自動建議...` 按鈕，以及背後整套自動建議區間的 helper / effect / callback，避免畫面雜訊與系統偷偷改動使用者手動設定的切線、基準線範圍；保留的只剩全域光譜與切線區間內的高低點資訊，讓 VBM 區塊聚焦在實際可用的參考點與外推圖。
- 2026-05-07 CST：更新 XPS 資料庫 `web/backend/db/xps_database.py`：Ga 新增 reduced Ga（Ga+ / Ga0 / oxygen-deficient, 18.5-20.0 eV）與 Ga3+ in Ga2O3（20.3-20.9 eV）；O 1s 改為 OI Ga-O-Ga lattice、OII defect / oxygen vacancy、OIII OH / adsorbed O / H2O、NiO lattice reference。驗證 `.venv\Scripts\python.exe -m py_compile web\backend\db\xps_database.py` 通過；系統 `python` 執行檔目前回報無法存取，已改用 `.venv` Python。
- 2026-05-07 CST：追加 XPS Ga 區參考峰：在 `web/backend/db/xps_database.py` 的 Ga peaks 增加 `O 2s reference (22.8-23.8 eV)`，初始 BE 使用區間中點 23.3 eV。驗證 `.venv\Scripts\python.exe -m py_compile web\backend\db\xps_database.py` 與 `git diff --check` 通過。
- 2026-05-07 CST：依使用者指定修正 XPS Ga 區 O 2s 參考峰：將單一 `O 2s reference` 拆成 `O 2s beta-Ga2O3 (23.1-23.8 eV)` 與 `O 2s NiO (22.8-23.4 eV)`，初始 BE 分別為 23.45 與 23.1 eV。驗證 `.venv\Scripts\python.exe -m py_compile web\backend\db\xps_database.py` 與 `git diff --check` 通過。
- 2026-05-07 CST：準備將 XPS 資料庫更新提交並推送到 `origin/main`；提交範圍限定 `web/backend/db/xps_database.py`、`CLAUDE.md`、`AGENTS.md`。
- 2026-05-07 CST：本 repo 尚未設定 commit 作者資訊，將使用 local git config `Codex <codex@openai.com>` 完成本次 XPS 資料庫提交，不修改全域 git config。
- 2026-05-07 CST：已建立本次 XPS 資料庫更新 commit `f5833ad`（Update XPS Ga and O references），接著將補入此紀錄並 amend 後推送。
- 2026-05-07 CST：XPS 資料庫更新已 rebase 到遠端最新 `main` 後推送完成；實際推送 commit 為 `7ff68bf`（Update XPS Ga and O references）。
- 2026-05-07 CST：開始處理 `main` 與 `origin/main` 的合併與提交需求；先確認工作樹乾淨、本地 `HEAD=ba0c349 (op.21.7)`、遠端額外有 `7ff68bf` 與 `4e037d8` 兩個 commit。
- 2026-05-07 CST：執行 `git fetch origin` 成功更新遠端追蹤資訊；嘗試 `git merge --no-edit origin/main` 後，確認只有 `CLAUDE.md` 與 `AGENTS.md` 發生內容衝突，程式碼檔僅新增來自遠端的 `web/backend/db/xps_database.py` 變更，無程式碼衝突。
- 2026-05-07 CST：已手動解決 `CLAUDE.md` / `AGENTS.md` 的 merge conflict，保留遠端 XPS 資料庫更新紀錄與本地 VBM/UI 修正紀錄；驗證 `python3 -m py_compile web/backend/db/xps_database.py`、`git diff --check` 通過，準備建立 merge commit 並推送。
- 2026-05-07 CST：XPS 峰擬合新增 Paper-style 擬合結果圖輸出。完成峰擬合後，主畫面會出現論文風格 component panel 預覽：以處理後光譜為 observed、總擬合為 fit、各 `y_individual` 為 component fill，依正面積積分計算百分比並標註；可在網頁調整原始/總擬合/component 顏色、字體、標籤文字與 X/Y fraction 位置、峰位標線中心、X/Y 範圍、填色透明度、PNG/SVG 匯出尺寸與倍率。後續修正測試頁空白問題：匯出 API 改由 `web/frontend/src/components/PlotlyChart.tsx` 兼容層輸出 `PlotlyApi`，並在 `vite-env.d.ts` 補 `plotly.js/dist/plotly` declaration，避免動態匯入 `plotly.js` 原始包導致 Vite dev server `buffer/` 解析錯誤。影響檔案：`web/frontend/src/pages/XPS.tsx`、`web/frontend/src/components/PlotlyChart.tsx`、`web/frontend/src/vite-env.d.ts`；前端建置通過。

- 2026-05-07 CST：新增獨立「繪製圖檔」工作區並放入右側選單。新增 `web/frontend/src/pages/PlotFileTool.tsx`，目前先啟用 XPS：可上傳多個 fit spectra TXT/CSV（欄位需含 `Binding_Energy_eV`、`Observed`、`Total_Fit` 與任意多個 component 欄位），自動生成多檔垂直 component panels、area ratio 堆疊圖與 component ratio 折線圖；支援 X 軸顯示範圍、X/Y 軸字體大小、刻度/標籤/樣品字體、component 顏色、標籤 X/Y fraction、峰位標線、樣品名稱與 PNG/SVG 匯出尺寸。`web/frontend/src/App.tsx` 新增 workspace `tool-plot-files`，右側選單新增「繪製圖檔」；Raman/XRD/XAS/XES 分頁先保留空狀態供後續擴充；XPS 分析頁原本 paper-style 卡片已移除，繪圖集中到新工作區。前端建置通過。

- 2026-05-07 CST：改善「繪製圖檔」工作區操作性。`web/frontend/src/pages/PlotFileTool.tsx` 版面改為三欄：左側只放檔案上傳/樣品名稱，中間集中顯示 component panels 與 area/ratio 圖，右側 sticky 參數面板集中調整圖面、比例圖、component 樣式與匯出尺寸；component 設定改為 details 展開卡。修正比例圖 Y 軸跑位：summary figure 的 `xaxis/yaxis`、`xaxis2/yaxis2` 明確設定 `anchor`，並加大左右 margin。前端建置與 `git diff --check` 通過。

- 2026-05-07 CST：繪製圖檔新增軸標題間距控制。`PlotFigureStyle` 新增 `xAxisTitleStandoff`、`yAxisTitleStandoff`，component panels 與 area/ratio summary figure 的 X/Y axis title 皆套用 Plotly `title.standoff`；右側圖面設定新增「X 標題距離」「Y 標題距離」數值欄位（0–120 px）。前端建置與 `git diff --check` 通過。

- 2026-05-07 CST：繪製圖檔新增框線粗細控制。`PlotFigureStyle` 新增 `axisLineWidth`，右側圖面設定新增「框線粗細」欄位（0.2–8），component panels 與 area/ratio summary figure 所有 X/Y 軸 `linewidth` 改由此值控制。前端建置與 `git diff --check` 通過。

- 2026-05-07 CST：繪製圖檔 component 標籤支援下標。新增 `formatPlotLabel()`，會將標籤中的 `_{...}` 與 `_word` 轉成 Plotly 支援的 `<sub>...</sub>`；使用者也可直接輸入 HTML `<sub>`。套用於 component panels annotation、summary legend name 與 ratio Y 軸標題，並在 component 標籤輸入框下方新增提示文字。前端建置與 `git diff --check` 通過。

- 2026-05-07 CST：修正繪製圖檔下方 area/ratio 比例圖跑位。`buildXpsSummaryFigure()` 中 bar 子圖 domain 調整為 `[0, 0.44]`、ratio 子圖 domain 調整為 `[0.63, 1]`，加大中間間距以容納右圖 Y 軸標題；兩個 X 軸固定 `type: 'category'`、`categoryarray: samples` 保留樣品順序；legend 改放左側 bar 圖內右上角，ratio line 設 `showlegend: false`。前端建置與 `git diff --check` 通過。

- 2026-05-07 CST：繪製圖檔新增 XPS combined publication figure 輸出。`PlotFileTool.tsx` 新增單張合併投稿圖：左側 a 為多 panel XPS component 圖，右側上方 b 為 area ratio 堆疊圖、右側下方 c 為 component ratio 折線圖；Raw data 可切換線、圓圈、線+圓圈並調整圓圈大小/線寬/填色；Component 樣式新增一鍵套用 `O<sub>Ⅰ</sub>` / `O<sub>Ⅱ</sub>` / `O<sub>Ⅲ</sub>` 標籤、顏色與標籤位置。驗證 `npm run build`、`git diff --check` 通過。

- 2026-05-07 CST：繪製圖檔 component 標籤連線位置微調。一般 panels 與 combined publication figure 的 component annotation 改用 `yanchor: 'bottom'`，使連線終點落在 OⅠ/OⅡ/OⅢ 標籤百分比括號下方，而不是標籤文字中央。

- 2026-05-07 CST：取消繪製圖檔 Combined publication figure 入口。`PlotFileTool.tsx` 移除中間欄 `Combined publication figure` 預覽卡與 PNG/SVG 匯出按鈕，匯出流程回到 `panels` 與 `summary` 兩種圖；Raw 圓圈顯示與 OⅠ/OⅡ/OⅢ 標籤 preset 保留。驗證 `npm run build` 通過。

- 2026-05-07 CST：繪製圖檔 summary 圖 b legend 位置調整。`buildXpsSummaryFigure()` 的 legend 從 bar subplot domain 內改到右側空白區（`x: 0.465`, `xanchor: 'left'`），使 OⅠ/OⅡ/OⅢ 標籤欄顯示在圖 b 框線外。

- 2026-05-08 CST：改善右側 workspace 選單入口可見性。`web/frontend/src/App.tsx` 的右側「選單」改為固定同時顯示「分析模組」與「工具」，並對目前 workspace 套用 active 樣式，讓「繪製圖檔」固定出現在工具區，避免進入「繪製圖檔」或單一處理工具後工具入口被切換隱藏；`web/frontend/src/index.css` 為兩段選單新增分隔線、最大高度與內部滾動。驗證 `npm run build`、`git diff --check` 通過。

- 2026-05-08 CST：繪製圖檔工作區新增獨立 XPS `VBM 線性外推` 子模式。`web/frontend/src/pages/PlotFileTool.tsx` 在 XPS 繪圖內新增「XPS 峰擬合圖 / VBM 線性外推」切換，VBM 模式獨立匯入多個 CSV/TXT/TSV，前端自動判斷 Binding Energy 與 intensity 欄位、最大值歸一化、不做背景扣除，依各樣品 baseline / tangent 區間計算 VBM；可預覽與匯出 stacked 線性外推圖、每組單張外推圖、VBM summary 圖，並輸出 CSV/TXT summary。右側參數面板支援字體、顏色、軸範圍、線寬、區間透明度與匯出尺寸。驗證 `npm run build` 通過。

- 2026-05-08 CST：繪製圖檔 XPS `VBM 線性外推` 補上 VBM 標籤位置控制。`VbmFigureStyle` 新增 `labelOffsetX` / `labelOffsetY`，右側 VBM 圖面設定新增「標籤 X 偏移」「標籤 Y 偏移」，可用像素偏移調整 `VBM = ... eV` annotation 位置；stacked 圖與每組單張外推圖共用此設定。

- 2026-05-08 CST：繪製圖檔 XPS `VBM 線性外推` 算法同步 XPS 分析區。`PlotFileTool.tsx` 新增與 `XPS.tsx` 相同的 VBM 選點 helper：使用者輸入的 baseline/tangent 起終值先映射到最近資料點，各自建立 20% 搜尋窗；tangent 取最大正斜率候選點對，baseline 取最平斜率候選點對，兩條線交點作為 VBM。圖上的 baseline 由水平平均線改為實際基準線斜率，VBM marker/annotation 改放在兩線交點；CSV/TXT summary 補上 tangent/baseline slope、intercept 與實際選點。

- 2026-05-09 CST：Raman 新增 Si 基板訊號校正扣除模組並改善背景扣除卡頓。後端 `web/backend/routers/raman.py` 的 `/api/raman/process` 擴充 `si_subtraction_enabled`、`reference_fit` 與 `fit_si_peak`：reference 模式會先把 Si reference 重新取樣到 sample x 軸，再於預設 500–540 cm⁻¹ 最佳化 Si scale `a`、shift `dx` 與局部線性 baseline，只扣除 `a * shifted_si_reference`；直接擬合模式則以 Voigt 擬合樣品 520 cm⁻¹ Si peak 後扣除，不會把負值歸零，並輸出 over-subtraction / S-shaped residual 警告。前端 `web/frontend/src/pages/Raman.tsx` 新增 Step 3「Si 基板校正扣除」、Si residual region 診斷圖、Si 扣除後疊圖、每樣品 corrected CSV 與 `si_subtraction_report.csv`；`web/frontend/src/api/raman.ts` 支援 AbortSignal，Raman 自動處理加 300 ms debounce 與過期請求取消；`web/backend/core/processing.py` 對 Whittaker baseline penalty matrix 加 LRU cache。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/raman.py web/backend/core/processing.py`、`cd web/frontend && npm run build`、合成 Si reference sanity check 通過。

- 2026-05-09 CST：依使用者要求將 Raman 圖檔輸出移到「繪製圖檔」Raman 分頁。`web/frontend/src/pages/Raman.tsx` 移除 Raman 分析頁上的 PNG 圖檔輸出入口，保留處理流程、CSV 與 fitting report 匯出；`web/frontend/src/pages/PlotFileTool.tsx` 啟用 Raman 模組，新增 Raman fit JSON 匯入、publication deconvolution figure 預覽與 PNG/SVG 匯出。Raman publication plot 會從 fit JSON 重建 original spectrum、baseline、baseline-corrected spectrum、total fit、individual components 與 residual，下方使用獨立 residual panel；預設白底、無 grid，右側可調字體、顏色、線寬、components/labels 顯示、歸一化與輸出尺寸。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/raman.py web/backend/core/processing.py`、`cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-09 CST：Raman peak fitting 改為 staged fitting。`web/backend/routers/raman.py` 的 `/api/raman/fit` 現在依序執行 fitting window 裁切、資料品質檢查（過曝、負值異常、cosmic ray）、裁切資料 baseline correction、讀取啟用的 literature/manual peak candidates、在各 candidate center ± tolerance 內用局部最大值更新初始值、global constrained least-squares fitting 與 robust loss（linear 會轉為 soft_l1）。新增 `StagedFitDiagnostics`、top-level `reduced_chi_square`，auto peak 只有在 residual 呈系統性峰形且 AIC/BIC 同時明顯下降時才加入；輸出仍保留 fitted parameters table、component curves、total fit 與 residual。`web/frontend/src/pages/Raman.tsx` 預設 robust loss 改為 `soft_l1`，fitting window 裁切結果改用後端回傳 x/y 繪圖，結果摘要新增 reduced χ²；`web/frontend/src/types/raman.ts` 同步型別。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-09 CST：Raman 峰擬合最終結果圖新增單峰 contribution curves。`web/backend/routers/raman.py` 的 `/api/raman/fit` response 新增 `components`、`total_fit_corrected`、`total_fit_raw`，每個 fitted peak 會保留 `center`、`fwhm`、`amplitude`、`area`、`area_percent`、`profile`、`component_label/group/material`、`y_component_corrected` 與 `y_component_raw`，並保證 `total_fit_corrected = sum(y_component_corrected)`、`total_fit_raw = baseline + total_fit_corrected`；`report_json` 也同步輸出完整曲線與 component metadata，供 Raman publication plot 直接匯入。`web/frontend/src/pages/Raman.tsx` 的最終擬合圖改為主圖 + residual 子圖，新增 `show components` / `fill components` / `show peak labels` 開關，主圖可畫每個 raw component curve 與峰位文字；summary table 與 Excel/CSV/report 欄位補入 `area`、`area_percent`、`component_label`、`component_group`。`web/frontend/src/pages/PlotFileTool.tsx` 的 Raman publication plot 同步支援新 component/raw fit 結構與 fill toggle。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`cd web/frontend && npm run build` 通過。
- 2026-05-09 CST：依使用者回饋調整 Raman component 標示方式。`web/frontend/src/pages/Raman.tsx` 與 `web/frontend/src/pages/PlotFileTool.tsx` 的 Raman 圖不再把 component label 疊寫在主圖曲線上，改為在結果圖上方建立獨立 component 對照區；對照標籤會依圖寬自動換行，分析頁的 component 對照文字顏色會對應各自曲線色，讓峰形本體保持乾淨。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-10 CST：Raman fitting 結果圖標籤改為逐 component 標示。後端在 `web/backend/db/raman_database.py` 集中建立 `RAMAN_PEAK_ASSIGNMENTS`，`/api/raman/fit` 依 fitted center 自動匹配 assignment，統一輸出 `Peak_Name`、`component_label`、`assignment`、`label_type` 與 report CSV；tentative/NiO/defect 類 peak 會標示為 possible/tentative。前端 `web/frontend/src/pages/Raman.tsx` 與 `web/frontend/src/pages/PlotFileTool.tsx` 移除上方大型分類文字，改讓每條 fitted component 在 legend 與 peak center annotation 使用同一 label、同一顏色，並用垂直虛線/箭頭指向對應 peak，近峰標籤會自動上下錯開。驗證 `python3 -m py_compile web/backend/routers/raman.py web/backend/db/raman_database.py`、`cd web/frontend && npm run build` 通過。
- 2026-05-10 CST：改善 XAS 扣背景時卡頓。`web/frontend/src/api/xas.ts` 的 `processData` 支援 `AbortSignal`；`web/frontend/src/pages/XAS.tsx` 的自動處理 effect 會對過期 `/api/xas/process` 請求呼叫 abort，並依目前前處理 / Gaussian / 背景 / 歸一化狀態決定是否需要獨立 stage request，可重用 preprocess 或 final 結果時不再重打，減少拖動背景參數時的重複背景扣除計算。驗證 `cd web/frontend && npm run build` 通過。

- 2026-05-10 CST：XAS 峰擬合新增「擬合範圍」設定。後端 `XasFitRequest.fit_range` 已存在；前端新增 `fitRangeEnabled / fitRangeLo / fitRangeHi` state，`web/frontend/src/api/xas.ts` 的 `fitXasPeaks()` 新增 `fitRange?: [number, number] | null` 參數，啟用時傳入 `body.fit_range`；峰形選單下方加入「擬合範圍」卡片（停用時顯示「自動」說明，啟用後改為 `DualRangeInput` 雙把手拉桿，範圍由 energyMin/energyMax 決定）；擬合結果圖在啟用時疊加青色陰影（`rgba(34,211,238,0.08)`）與虛線框標示擬合範圍，並加上「擬合範圍」標籤 annotation；`handleFit` 依賴項補上 `fitNRestarts`（原本遺漏）。影響檔案：`web/frontend/src/api/xas.ts`、`web/frontend/src/pages/XAS.tsx`；後端語法 `python3 -m py_compile` 通過。

- 2026-05-18 CST：XAS 峰擬合峰卡新增各參數獨立手動約束範圍輸入。將原本「中心可在 X–Y eV 內位移」灰色唯讀文字改為可編輯的 min/max 欄位：「中心可調」展開中心範圍 min/max 兩個 NumInput、「寬度可調」展開 FWHM 範圍 min/max 兩個 NumInput、「高度可調」展開高度上限 max 一個 NumInput；三個參數完全獨立，只有對應參數解鎖時才顯示，預填自動計算值；`buildXasFitPeakPayloads` 同步修正：解鎖時直接使用使用者輸入的 amplitude_max，不再強制套 `PEAK_AMPLITUDE_MAX_MULTIPLIER` 或 `datasetMax * 1.5` 覆蓋值。影響檔案：`web/frontend/src/pages/XAS.tsx`；後端語法 `python3 -m py_compile` 通過。

- 2026-05-18 CST：修正 XAS 峰擬合兩個邏輯 bug。① `updateXasPeakCenterSeed / updateXasPeakFwhmSeed / updateXasPeakAmplitudeSeed` 原本在每次擬合後更新 seed 值時會同時以公式重算並覆蓋 `center_min/max`、`fwhm_min/max`、`amplitude_max`，導致使用者手動輸入的約束範圍在第一次擬合後即被清除；修正為三個函式只更新 seed 值本身，保留既有的 min/max 欄位不重算。② 約束範圍 UI 輸入欄新增 min ≤ max 防呆：修改 min 時若新值大於現有 max 則自動將 max 拉高、修改 max 時若新值小於現有 min 則自動將 min 壓低；FWHM 欄同時保持 `≥ PEAK_FWHM_MIN_ABS` 下限。影響檔案：`web/frontend/src/pages/XAS.tsx`；後端語法 `python3 -m py_compile` 通過。

- 2026-05-11 CST：開始處理 Raman 圖表需求：結果圖全螢幕、標籤避讓、繪製圖檔峰顯示篩選/可信度篩選、移除 Raman publication residual panel，以及預留多樣品疊圖顯示。範圍先限定 web/frontend Raman 分析頁與 PlotFileTool。

- 2026-05-11 CST：準備實作 Raman 分析頁結果圖全螢幕與 peak label 避讓；判斷以 React overlay 呈現全螢幕，避免恢復舊版 Plotly 自訂 modebar fullscreen 造成 bundle/runtime 風險。

- 2026-05-11 CST：Raman 分析頁已新增擬合結果圖全螢幕 overlay，並將 component peak label 改為圖框上方標籤帶，避免標籤直接覆蓋資料曲線。接續修改 PlotFileTool Raman 繪圖工具。

- 2026-05-11 CST：首次前端建置嘗試失敗，原因是指令工作目錄在 web/frontend 時相對路徑讀不到根目錄 CLAUDE.md，且該 PowerShell session 找不到 npm；接著改從 repo root 讀取 CLAUDE.md 並確認 npm 可執行檔。

- 2026-05-11 CST：清理首次建置失敗時意外建立的 web/frontend/CLAUDE.md；該檔為本次錯誤命令產物，非使用者既有檔案。

- 2026-05-11 CST：確認目前工具環境找不到 node/npm，也沒有本地 node_modules，可先以靜態檢查與 git diff 檢查替代；另補上 PlotFileTool Raman 預覽全螢幕，以涵蓋繪圖工具中的結果圖檢視。

- 2026-05-11 CST：完成 Raman 圖表需求。影響檔案：web/frontend/src/pages/Raman.tsx、web/frontend/src/pages/PlotFileTool.tsx、CLAUDE.md、AGENTS.md。驗證：git diff --check 通過；目前工具環境 Get-Command node/npm 無結果，因此無法執行 cd web/frontend && npm run build。

- 2026-05-11 CST：依使用者要求復原上一輪 Raman fitting 修改（v23.2 反向套用）：移除材料白名單/Si mask 或 fit-subtract/分區物理限制/unresolved 新流程與前端 fitting 控制，回到 v23.1 的 Raman fitting 狀態；保留 v23.1 的 Raman 圖表全螢幕與繪製圖檔功能。

- 2026-05-11 CST：檢查：復原後確認 Raman fitting 新流程關鍵字已從 web/backend 與 web/frontend/src 消失；復原後程式檔與 HEAD~1(v23.1) 無差異；git diff --cached --check 與 git diff --check 通過。

- 2026-05-11 CST：同步：已將 Raman fitting 復原提交推送到 origin/main（包含 Revert v23.2 與復原紀錄），用於觸發線上網頁更新。

- 2026-05-12 CST：右側選單在「分析模組」區新增明確的 `XAS Athena 處理` 入口，排在 XAS 後方，作為像 Raman / XRD 一樣的專門資料處理入口；功能包含 Athena `.xmu` 資料夾分樣品處理、normalized / flattened 預覽與 Origin CSV/TXT 匯出。驗證 `cd web/frontend && npm run build` 通過。

- 2026-05-12 CST：`XAS Athena 處理` 預覽圖改用高對比線色，平均曲線改深色；新增「手動刪峰」滑桿，可選 scan1 / scan2 / 兩筆 scan 的 energy 區間，加入後會在圖上以淡橘色區塊標示，並於平均前將該區間併入 removal mask 內插處理，CSV/TXT 匯出同步反映手動刪峰結果。驗證 `cd web/frontend && npm run build` 通過。

- 2026-05-12 CST：收斂 `XAS Athena 處理` 版面，左側上傳/匯出/手動刪峰卡片改為 compact，主 grid 左欄由 22rem 縮至 18–19rem；樣品清單從圖左側移到圖上方橫向按鈕，避免吃掉 Plotly 寬度造成圖跑版；預覽圖高度固定 500px，legend 移到下方左側。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-12 CST：`XAS Athena 處理` 手動刪峰滑桿拖拉時新增藍色半透明 draft 區間，與已加入的橘色刪峰區間區分，讓使用者拖曳左右邊界時能即時看見目前選取範圍。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-12 CST：`XAS Athena 處理` 新增「匯出 OriginPro 產檔腳本」；網頁會將目前處理結果、手動刪峰後平均資料與 raw scan 嵌入 `.py`，使用者在有 OriginPro / originpro package 的 Windows 電腦執行後會自動建立 worksheet、normalized / flattened overlay graph，並輸出 `Athena_XMU_processed.opju`。瀏覽器/Render 無法直接寫 `.opju`，需靠本機 OriginPro API 產檔。驗證 `cd web/frontend && npm run build` 通過。

- 2026-05-12 CST：放寬 `XAS Athena 處理` 自動刪峰判定：`SPIKE_DIFF_MAD_FACTOR` 由 4.5 降至 3.0，`PEAK_EDGE_THRESHOLD_RATIO` 由 0.35 降至 0.25，讓差異峰更容易被偵測且峰腳區段更容易納入 removal mask；手動滑桿刪峰不變。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-12 CST：修正 `XAS Athena 處理` 匯出的 OriginPro 產檔腳本相容性：raw scan worksheet 改用樣品+檔名避免重名，`wks.from_list` 與線色設定加入 fallback；已同步修補 `C:\Users\User\Downloads\athena_create_origin_project_20260511_204722.py` 並成功產生 `C:\Users\User\Downloads\Athena_XMU_processed.opju`。驗證下載腳本 `py_compile`、`cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-12 CST：`XAS Athena 處理` 自動刪峰改為可調靈敏度，於手動刪峰區新增「標準 / 寬鬆 / 很寬鬆 / 極寬鬆」選單；寬鬆為目前預設（MAD 3.0 / 邊界 0.25），很寬鬆為 MAD 2.2 / 邊界 0.18，極寬鬆為 MAD 1.6 / 邊界 0.12，讓使用者可先用更寬鬆自動 removal mask 多抓峰，再用手動滑桿補刪或微調。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-12 CST：`XAS Athena 處理` 新增加回誤刪資料功能；在手動刪峰區新增 Restore 綠色拉條，可選 scan1 / scan2 / 兩筆 scan 的 energy 區間，最終 mask 流程為自動刪峰 → 手動刪峰 → 手動加回，restore 區間會將 removal mask 清為 0，使該段使用原始資料參與平均；圖上加回區間以綠色顯示，拖拉中的加回區間以青綠色顯示。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-12 CST：`XAS Athena 處理` 右側「樣品與預覽」圖卡在桌面版改為 sticky，使用者捲動左側自動刪峰/手動刪峰/加回資料控制時，處理圖會固定在視窗內；sticky 容器加上 `max-height: calc(100vh - 2rem)` 與內部滾動，避免矮視窗卡住。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-12 CST：改善 `XAS Athena 處理` 刪峰/加回滑桿拖曳頓挫；滑桿數值仍即時更新，但圖上的 draft 區間改用 80ms debounce 後才觸發 Plotly 重畫，降低拖曳時的 Plotly relayout 頻率。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。

[2026-05-12] 實作：開始整合繪製圖檔 Raman 多樣品疊圖參考峰資料庫功能，新增可勾選 Raman reference peaks、Si interference、zoom-in 與峰比對匯出。

[2026-05-12] 檢查：執行 cd web/frontend && npm run build 驗證 Raman reference overlay 改動。

[2026-05-12] 檢查：Raman reference overlay 前端 build 因工具環境找不到 npm 而未能執行；改以靜態檢查與 git diff --check 補驗。

[2026-05-12] 檢查：補跑 Raman reference database JSON 解析、語法殘留掃描與 git diff --check。

[2026-05-12] 實作完成：繪製圖檔 Raman 多樣品疊圖新增 default_raman_peaks 可勾選資料庫、參考峰標註/Si interference/zoom-in/峰比對 CSV，並同步更新 AGENTS.md；npm build 因環境缺 npm 未執行，JSON 解析與 git diff --check 通過。

- 2026-05-12：XAS Athena 網頁 parser 支援 8 欄與 9 欄 Athena .xmu；8 欄缺少 chi(e) 時自動以 0.0 補入，錯誤訊息改為至少 8 欄。另補 PlotFileTool Raman local maximum 回傳型別，驗證 cd web/frontend && npm run build、git diff --check 通過。

[2026-05-12] 實作：依使用者要求調整繪製圖檔 Raman 疊圖，準備擴充 β-Ga2O3/NiO 共振峰資料、簡化標籤為材料色文字、加入逐峰標籤位置與逐數據線色/位置控制。

[2026-05-12] 檢查：Raman reference 共振峰/標籤位置改動後，JSON 解析與 git diff --check 通過；工具環境仍找不到 node/npm，因此無法執行 npm run build。

[2026-05-12] 實作完成：Raman 疊圖參考峰改為共振態標籤與材料色純文字，新增逐峰標籤位置、整體標籤視窗位置、逐數據線色/垂直位置/名稱位置控制，並同步更新 AGENTS.md。

[2026-05-12] 檢查：使用者要求同步變更，先檢查 git 工作樹、分支與遠端狀態，避免覆蓋未要求修改的既有變更。

[2026-05-12] 檢查：查看本地未提交變更摘要，準備同步前確認只包含使用者要求的 Raman 繪圖與紀錄更新。

[2026-05-12] 檢查：查看 origin/main 最新提交 V25.1 的檔案範圍，判斷與本地 Raman 疊圖變更是否會衝突。

[2026-05-12] 檢查：同步前執行 git diff --check，確認目前本地變更沒有 whitespace error。

[2026-05-12] 同步：同步前檢查通過，準備提交本地 Raman 疊圖參考峰與文件紀錄變更，再 rebase 至 origin/main 最新 V25.1。

[2026-05-12] 同步：本地提交已建立（Enhance Raman overlay reference controls），準備 rebase 到 origin/main V25.1 以接上遠端最新變更。

[2026-05-12] 同步：rebase 時 AGENTS.md / CLAUDE.md 文件紀錄衝突，已保留遠端 V25.1 Athena parser 紀錄與本地 Raman 疊圖同步紀錄。

[2026-05-12] 同步：rebase origin/main V25.1 成功，文件衝突已解決；準備進行最終狀態檢查與推送。

[2026-05-12] 檢查：推送前執行 conflict marker 掃描、提交 diff whitespace 檢查、Raman reference JSON 解析，並在 npm 可用時執行前端 build。

[2026-05-12] 檢查完成：推送前 conflict marker 掃描、git diff --check origin/main..HEAD、Raman reference JSON 解析通過；目前工具環境找不到 npm，未執行 npm run build。

[2026-05-12] 同步完成：已將 Raman 疊圖參考峰控制變更推送到 origin/main（eeafcbd..e07da12），遠端已接上 V25.1 後的新提交。

[2026-05-12] 檢查：使用者要求 Raman 繪圖區新增可修改參考峰理論值與自訂參考峰名稱，並調整圖中右上角顯示；先讀取目前 PlotFileTool 與 Raman peak database 實作。

[2026-05-12] 實作：準備修改 PlotFileTool Raman overlay reference peak 結構與 UI，新增可編輯理論 Raman shift、顯示名稱，以及右上角 overlay legend 顯示開關。

[2026-05-12] 實作：更新 Raman reference peak 匯入與標籤格式，保留 defaultShift/defaultDisplayLabel 供預設還原，圖上標籤改用可編輯 displayLabel。

[2026-05-12] 實作：新增 updateRamanReferencePeakData，讓 Raman overlay 右側面板可直接修改每個參考峰理論值與顯示名稱；reset 會同步還原預設值。

[2026-05-12] 實作：補強 Raman reference peak CSV 與 match CSV 欄位，輸出自訂顯示名稱與原始預設理論值。

[2026-05-12] 實作：調整 Raman overlay figure legend 顯示策略，並準備在 reference peak 卡片加入名稱與理論值輸入欄位。

[2026-05-12] 檢查：Raman reference peak 理論值/名稱編輯功能完成後，執行 git diff --check、default_raman_peaks JSON 解析，並在 npm 可用時執行前端 build。

[2026-05-12] 實作完成：Raman 繪圖 overlay 參考峰新增可編輯理論值與自訂顯示名稱；每個參考峰可單獨還原，整體預設會還原所有理論值/名稱；圖中右上角 overlay legend 預設關閉並新增顯示開關。驗證 git diff --check 與 default_raman_peaks JSON 解析通過；工具環境找不到 npm，未執行 npm run build。

[2026-05-15] 檢查：使用者要求「推下來，以 GitHub 為主」；先確認本地 `main` 狀態為 `ahead 1, behind 43`，本地多出 commit `2265a2b`，遠端 `origin/main` 為 `8a0ae72`。

[2026-05-15] 同步完成：已建立本地備份分支 `backup_github_sync_20260515_2265a2b`，執行 `git fetch origin` 後以 `git reset --hard origin/main` 將 `main` 直接對齊 GitHub；目前 `HEAD=origin/main=8a0ae72`（`v25.3`）。
[2026-05-15] XAS Athena manual removal/restore editor was unified behind a two-option mode selector. Only the selected mode now shows its editable draft range on the Plotly preview, and drag relayout updates only that active draft. Verification: `cd web/frontend && npm run build` passed.

[2026-05-15] XAS Athena OriginPro export script now creates per-sample final normalized and final flattened graphs that match the web final-result view: clean scan1, clean scan2, and final average. Existing all-sample average overlay graphs are still exported. Verification: `cd web/frontend && npm run build` passed.

[2026-05-15] 合併：依使用者要求 merge GitHub 檔案；執行 `git fetch origin` 與 `git merge origin/main` 後，確認程式碼檔自動合併，僅 `CLAUDE.md` / `AGENTS.md` 發生文件衝突，已手動整併保留遠端 `v25.4/v25.5` 與本地 `v25.6` 紀錄。
[2026-05-15] 除錯：修正 XPS `VBM 線性外推圖` 拉動切線/基準線 slider 時整張圖亂跑。根因是 `web/frontend/src/pages/XPS.tsx` 的 VBM 預覽視窗原本會依切線、基準線與 VBM 交點動態重算 `xaxis.range`、`yaxis.range` 與畫線用 `lineX`，導致使用者一調區間，圖框就跟著平移/縮放。現改為 `buildVbmStablePlotWindow()` 只根據光譜本身的 x/y 範圍建立固定座標窗，讓 slider 只影響切線/基準線旋轉與 marker 位置，不再改變整張數據圖視窗。影響檔案：`web/frontend/src/pages/XPS.tsx`；驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
[2026-05-15] 調整：將 XPS 的「多檔平均」從獨立第 3 步併回第 2 步「內插 / 資料模式」，改成和 XAS 一樣在切到疊圖後就直接顯示「平均所有疊圖數據」按鈕；同時移除原本獨立的平均 section，將後續步驟編號整體前移，並把疊圖選擇 modal 的提示文案從「第 3 步」改為「第 2 步」。為了保留 XPS 現有能力，平均按鈕在啟用後可再切回「取消平均，改回疊圖比較」。影響檔案：`web/frontend/src/pages/XPS.tsx`；驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
[2026-05-15] 檢查：全面檢查 XPS 前後端流程與 UI 狀態，重點覆核 `web/frontend/src/pages/XPS.tsx`、`web/frontend/src/api/xps.ts`、`web/frontend/src/types/xps.ts`、`web/backend/routers/xps.py`、`web/backend/core/processing.py`。確認 `npm run build`、`python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`git diff --check` 通過；review 發現 3 類風險：① 疊圖平均模式的 `average` 只保留 `y_processed`，導致背景圖「扣背景前」與最終匯出 `intensity_raw` 欄位在平均模式下語意錯誤，且無法顯示平均背景線；② `apply_background()` 在未知方法或背景區間無有效點時靜默回原始光譜；③ `apply_normalization()` 在區間/因子無效時靜默回零或沿用原值，使用者只會看到圖形異常而不會收到明確錯誤。
[2026-05-15] 修正：完成 XPS 全檢查後的 bug fix。`web/backend/routers/xps.py` 的 average dataset 改為分別保留平均後的 `y_raw`、`y_background`、`y_processed`，修正疊圖平均模式背景圖「扣背景前」語意錯誤、平均背景線缺失，以及最終匯出 raw 欄位被錯填成 processed 的問題；同時平均失敗不再 `pass`，改回傳 422 明確錯誤。`web/backend/core/processing.py` 新增 `strict` 參數，讓 XPS 在背景區間無資料、背景方法未知、歸一化區間/因子無效時直接丟出 `ValueError`，不再靜默回原始/零值光譜；`web/frontend/src/pages/XPS.tsx` 新增 overlay 錯誤顯示同步，讓這些後端錯誤會出現在頁面頂部紅色訊息卡，並移除主圖卡上會過時的數字前綴（原始光譜 / 前處理後 / 背景扣除 / 歸一化 / 峰擬合光譜），避免和 sidebar 步驟號碼脫節。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`cd web/frontend && npm run build`、`git diff --check` 通過。

[2026-05-15] Change: Web export/report timestamps now use a fixed UTC+8 timezone. Added `web/frontend/src/utils/time.ts` for `+08:00` ISO strings and UTC+8 filename timestamps, then applied it to Athena, XRD, and XPS exports/reports. Verification: `cd web/frontend && npm run build` passed.
[2026-05-15] Change: XAS Athena final average now respects manual removal/restore source selection. Removed points no longer contribute through interpolated clean curves, and restoring only scan1 or scan2 forces the final average in that interval to use that selected scan as the source. Verification: `cd web/frontend && npm run build` passed.
[2026-05-14] 檢查：使用者要求可設定 X、Y 軸顯示範圍；先檢查繪製圖檔 Raman 圖面設定與 Plotly layout 目前的 x/y range 實作。

[2026-05-14] 實作：準備在 RamanFigureStyle 加入 yBottom/yTop，讓 Raman single 與 overlay 主圖可手動指定 Y 軸顯示範圍，並在 UI 提供自動 Y 還原。

[2026-05-14] 實作：新增 Raman 手動 Y 軸範圍 helper，並套用到 publication plot 與 overlay plot 的主 Y 軸 range。

[2026-05-14] 實作：在 Raman 圖面設定 UI 新增 Y 下限/Y 上限輸入，並新增 X 自動與 Y 自動按鈕；Y 單端修改時用目前圖面範圍補齊另一端。

[2026-05-14] 檢查：完成 Raman X/Y 顯示範圍 UI 後，執行關鍵字掃描、git diff --check、Raman reference JSON 解析，並在 npm 可用時執行前端 build。

[2026-05-14] 實作完成：Raman 繪圖區新增 Y 下限/Y 上限與 X 自動/Y 自動控制；X 左端/X 右端維持既有功能，Y 軸手動範圍套用到 single publication plot 與 overlay 主圖。驗證關鍵字掃描、git diff --check、default_raman_peaks JSON 解析通過；工具環境找不到 npm，未執行 npm run build。

[2026-05-16] 檢查：使用者要求同步到 git；同步前先檢查本地 Raman 繪圖 Y 軸範圍變更、文件紀錄與 git 狀態，準備執行 diff/JSON/build 驗證後再提交、接遠端並推送。

[2026-05-16] 檢查：同步到 git 前執行 git diff --check 與 default_raman_peaks JSON 解析，兩者通過；目前工具環境找不到 node/npm，未執行 cd web/frontend && npm run build。

[2026-05-16] 重要判斷：同步 rebase origin/main 時僅 AGENTS.md / CLAUDE.md 發生文件紀錄衝突；已移除 conflict marker 並保留遠端 2026-05-15 紀錄、本地 2026-05-14 Raman Y 軸範圍紀錄與 2026-05-16 同步檢查紀錄。

[2026-05-16] 同步完成：已將 Raman 繪圖 Y 軸範圍控制變更 rebase 到 origin/main v26.1 後推送；遠端 main 由 e59617f 更新到 59aaa37。推送前確認 conflict marker 掃描、git diff --check origin/main..HEAD 與 default_raman_peaks JSON 解析通過；工具環境仍找不到 node/npm，未執行 npm run build。

[2026-05-16] 檢查：開始修改 XES 分點扣背與能量校正；已確認現有 XES 後端 interpolated 背景權重依 sample index 計算，X 軸校正仍為線性 offset/slope。接續改為可填量測序號/總量測次數與上傳 pixel-energy 校正檔。

[2026-05-16] 實作：準備修改 XES 前後端。後端新增 measurement_order/total_measurements 計算 BG 權重與 table calibration；前端新增能量校正檔 parser、校正摘要、energy order、逐 sample 量測序號與 calibrated CSV 匯出。

[2026-05-16] 檢查：XES 分點扣背與能量校正改動完成初版，開始執行後端 py_compile、前端 npm build 與 diff 檢查。

[2026-05-16] 實作完成：XES 新增能量校正檔上傳與自動套用 table calibration。前端 `XES.tsx` 可解析 .dat/.txt/.csv 的 channel-energy 兩欄校正檔，顯示 points、energy min/max 與遞增/遞減方向，支援 Energy order increasing/decreasing/original，未上傳時顯示「目前 XES 尚未套用能量校正，X 軸可能為 channel / pixel。」；後端 `routers/xes.py` 新增 `calibration_points`，點數相同時一對一使用 calibration energy，點數不同時依 raw channel 插值，raw intensity-only 檔案 fallback 以 index 作 channel。XES 分點扣背新增每筆 sample `measurement_order` 與 `total_measurements`，權重改為 `(order-1)/(total-1)`，例如第 5/10 筆為 5/9 BG1 + 4/9 BG2。匯出新增 `Export calibrated XES data`，欄位含 energy_eV、intensity、sampleName、original_x。驗證：`uv run python -m py_compile .\web\backend\routers\xes.py`（需非沙盒 uv cache 權限）通過，`git diff --check -- web/backend/routers/xes.py web/frontend/src/pages/XES.tsx web/frontend/src/types/xes.ts` 通過；目前環境找不到 npm，未能執行 `cd web/frontend && npm run build`。

[2026-05-16] 檢查：使用者回報 XES process 500；開始以最小 process_xes request 重現，重點檢查 table calibration 與 energy_order 排序時的 x_ev/y 長度一致性。

[2026-05-16] 實作：針對 XES process 500 補強。判斷可能來自校正後 x/y 長度或未知資料形狀造成未捕捉例外，準備加入長度一致性檢查、per-dataset 422 錯誤回報，以及前端 BG overlay 使用校正後 x 軸。

[2026-05-16] 修正：XES process 500 補強完成。web/backend/routers/xes.py 對每筆 sample 加入 x/y 長度、有限值、點數檢查，table calibration 與排序前會確保 x_ev/y arrays 長度一致，未知資料形狀改回 422 詳細錯誤而非 500；背景扣除缺 BG 檔時也明確回報。web/frontend/src/pages/XES.tsx 新增 calibrated BG overlay 軸轉換，Energy calibrated 模式下 BG1/BG2 參考線與主圖同用 eV 軸。驗證 uv run python -m py_compile .\web\backend\routers\xes.py 與 XES 相關檔案 git diff --check 通過；目前工具環境仍找不到 node/npm，未執行 npm run build。

[2026-05-16] 實作：定位並修正 XES 歸一化錯誤。`routers/xes.py` 仍以舊介面呼叫 `apply_normalization`（錯用 `x_start/x_end` 且嘗試解包回傳值），導致啟用 Max/Min-Max/Area/參考區間歸一化時失敗；已改成新參數 `norm_x_start/norm_x_end` 與單一回傳 `y`，並將 XES UI 的 `reference_region` 對應為後端 `mean_region`。


[2026-05-16] 檢查：XES 歸一化修正後完成驗證。uv run python -m py_compile .\web\backend\routers\xes.py 通過，git diff --check -- web/backend/routers/xes.py web/frontend/src/pages/XES.tsx web/frontend/src/types/xes.ts AGENTS.md 通過，conflict marker 掃描通過；目前環境找不到 npm，未執行 npm run build。

[2026-05-19] 檢查：開始新增繪製圖檔 XAS 模塊的 XES/XAS 疊圖與 Band gap 線性外推功能；先定位 PlotFileTool 現有 XAS/XES 繪圖架構。

[2026-05-19] 重要判斷：繪製圖檔 XAS band gap 功能採前端純計算；XES VBM 使用下降邊最陡切線與 baseline 交點，XAS CBM 使用上升邊最陡切線與 baseline 交點，兩者差值為 Eg。

[2026-05-19] 實作：在繪製圖檔 XAS 分頁啟用 XES/XAS band gap overlay。新增 XES/XAS 檔案匯入、樣品配對、VBM/CBM 線性外推、Eg 計算、白底 stacked 疊圖、PNG/SVG 與 CSV/TXT 匯出設定。

[2026-05-19] 檢查：前端 build 首次執行失敗；原因一是工作目錄在 web/frontend 時讀取 .\\CLAUDE.md 路徑錯誤，原因二是目前 PowerShell 環境找不到 npm。接續改以 root 路徑讀取紀錄並做靜態檢查。

[2026-05-19] 檢查：XAS/XES band gap 改動後執行 git diff --check 通過，conflict marker 掃描無結果；目前環境找不到 node/npm/pnpm/yarn，因此無法執行 npm run build。

[2026-05-19] 實作：同步更新 AGENTS.md，記錄繪製圖檔 XAS 分頁新增 XES/XAS band gap 疊圖、VBM/CBM 線性外推與匯出功能。

[2026-05-19] 檢查：清理前端 build 失敗時誤建立的 web/frontend/CLAUDE.md 暫存殘留，避免留下非專案文件。

[2026-05-19] 檢查完成：XAS/XES band gap 繪圖改動完成後，git diff --check 通過、conflict marker 掃描無結果、工作樹僅 AGENTS.md / CLAUDE.md / PlotFileTool.tsx 有預期修改；目前環境找不到 node/npm，未執行 npm run build。

[2026-05-19] 檢查：開始同步至 Git；目前 main 比 origin/main behind 1，且本地有 AGENTS.md、CLAUDE.md、web/frontend/src/pages/PlotFileTool.tsx 修改，先檢查差異避免覆蓋使用者變更。

[2026-05-19] 檢查：本地主要變更為 PlotFileTool.tsx 新增 XES/XAS band gap 繪圖功能，文件有同步紀錄；遠端 origin/main 位於 v26.5，本地 main 位於 v26.4，準備檢查遠端提交後再整合。

[2026-05-19] 檢查：執行 git fetch origin，確認同步前遠端 main 是否仍停在 v26.5 或已有更新。

[2026-05-19] 檢查：git fetch origin 因 .git/FETCH_HEAD 權限遭拒，改用非沙盒執行以完成遠端同步檢查。

[2026-05-19] 重要判斷：遠端只領先 1 個提交（v26.5，主要修改 XAS.tsx 與文件），本地變更在 PlotFileTool.tsx 與文件；採用 stash → fast-forward pull → stash pop，避免覆蓋本地未提交變更。

[2026-05-19] 檢查：git stash 因 .git/index.lock 權限遭拒，改用非沙盒執行 stash 以保護本地變更後接上遠端。

[2026-05-19] 檢查：已將本地 XES/XAS band gap 繪圖變更套回 origin/main v26.5 後的工作目錄，未出現程式碼衝突；待檢查後提交並推送。

[2026-05-19] 檢查：同步提交前嘗試在 web/frontend 執行 npm run build，但目前 PowerShell 環境找不到 npm；另外從 web/frontend 寫回根目錄 CLAUDE.md 被拒，已回到 repo root 補記錄。

[2026-05-19] 檢查：同步提交前 git diff --check 通過，conflict marker 掃描無結果；npm 仍不可用，未能執行 npm run build。

[2026-05-19] 檢查：清理同步過程中暫存的 pull 後紀錄 stash，避免留下不再需要的暫存項目。

[2026-05-19] 檢查：提交前最終確認 git diff --check 通過、conflict marker 掃描無結果；差異為 AGENTS.md、CLAUDE.md 與 PlotFileTool.tsx 的 XES/XAS band gap 繪圖功能。

[2026-05-19] 檢查：使用者要求繪製圖檔 XAS/XES band gap 圖新增 Panel 標題、標籤、標註的位置調整；準備檢查 PlotFileTool 目前 XasBandFigureStyle 與 UI。

[2026-05-19] 實作：準備在 XasBandFigureStyle 加入 panel 標題、樣品標籤與 VBM/CBM/Eg 標註位置控制，並套用到 Plotly annotations。

[2026-05-19] 實作：XAS/XES band gap 圖面設定新增 Panel 標題文字與位置、樣品標籤字體/位置，以及 VBM/CBM/Eg 標註位置控制；Plotly annotation 已改用這些設定。

[2026-05-19] 檢查完成：Panel 標題/標籤/標註位置控制完成後，git diff --check 通過、conflict marker 掃描無結果；目前環境仍找不到 node/npm/pnpm/yarn，未執行 npm run build。

[2026-05-19] 檢查：使用者要求新增 VBM / CBM / Eg 標註文字大小獨立控制；準備修改 PlotFileTool XasBandFigureStyle 與右側設定 UI。

[2026-05-19] 實作：XAS/XES band gap 圖新增 VBM、CBM、Eg 標註文字大小獨立控制；右側設定新增 VBM 字體、CBM 字體、Eg 字體，Plotly annotations 改用各自字體大小。

[2026-05-19] 檢查完成：VBM/CBM/Eg 標註字體大小控制完成後，git diff --check 通過、conflict marker 掃描無結果；目前環境仍找不到 node/npm/pnpm/yarn，未執行 npm run build。

[2026-05-19] 檢查：使用者要求新增 XES 檔與 XAS 檔各自 X 軸顯示範圍；準備在 PlotFileTool 的 XasBandEdgeFile 加入 per-file display range，並讓圖上曲線依各自範圍裁切。

[2026-05-19] 實作：XAS/XES band gap 的每個 XES/XAS 檔案新增獨立顯示 X 起/迄控制；圖上 XES 與 XAS 曲線會各自依 display range 裁切，CSV/TXT summary 也輸出 display range。

[2026-05-19] 檢查完成：XES/XAS 各自 X 軸顯示範圍控制完成後，git diff --check 通過、conflict marker 掃描無結果；目前環境仍找不到 node/npm/pnpm/yarn，未執行 npm run build。

[2026-05-19] 檢查：使用者回報 XAS/XES band gap 圖中已歸一化資料峰值未維持 1；準備檢查並修正 PlotFileTool 的 band intensity normalization。

[2026-05-19] 實作：修正繪製圖檔 XAS/XES band gap 圖強制百分位數重歸一化，改為保留已歸一化資料峰值。

[2026-05-19] 檢查：修正 XAS/XES band intensity normalization 後，執行衝突標記、diff whitespace 與前端建置可用性檢查。

[2026-05-19] 檢查結果：XAS/XES band gap 強度修正後，衝突標記掃描無結果、git diff --check 通過；目前工具環境找不到 node/npm/pnpm/yarn，未能執行 npm run build。
