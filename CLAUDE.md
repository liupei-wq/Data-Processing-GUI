# Nigiro Pro 專案紀錄

## 協作規則

- 回答使用者時一律使用繁體中文。
- 每次動作前先讀取 `CLAUDE.md`，每次實作後記錄變更。
- 不要修改使用者未要求修改的既有程式。
- 本資料夾只有 `web/` 網頁版；離線 Streamlit 版在獨立 repo：`https://github.com/liupei-wq/Data-Processing-GUI-Desktop`

---

## 倉庫與部署

| 用途 | 網址 |
|---|---|
| 網頁版（Render 主力） | https://github.com/liupei-wq/Data-Processing-GUI |
| Streamlit 離線版 | https://github.com/liupei-wq/Data-Processing-GUI-Desktop |
| Render 線上站 | https://data-processing-gui-web.onrender.com/ |

**本機啟動**
```bash
# Terminal 1
cd web && uvicorn backend.main:app --reload --port 8000
# Terminal 2
cd web/frontend && npm run dev   # → http://localhost:3000
```

**部署注意**
- `railway.toml`：`builder=DOCKERFILE`，不要設 startCommand
- Dockerfile 在 `web/Dockerfile`（多階段 build）
- `python3 -m py_compile web/backend/main.py web/backend/routers/*.py` 可驗證後端語法

---

## 目錄結構

```
web/
├── backend/
│   ├── main.py              # FastAPI 入口
│   ├── requirements.txt     # 含 lmfit（XANES 去卷積需要）
│   ├── core/                # parsers / processing / peak_fitting / spectrum_ops
│   ├── db/                  # raman / xrd / xps / xes database
│   └── routers/
│       ├── xrd.py / raman.py / xas.py / xps.py / xes.py
└── frontend/src/
    ├── App.tsx              # 主題 / 字體 / workspace 路由
    ├── index.css            # CSS 變數主題（6 主題：杏桃/柔白/海霧/黑曜/暮焰/森夜）
    ├── pages/               # XRD / Raman / XAS / XPS / XES / SingleProcessTool
    ├── components/          # AnalysisModuleNav / FileUpload / SpectrumChart / ...
    ├── api/                 # xrd / raman / xas / xps / xes
    └── types/               # xrd / raman / xas / xps / xes
```

---

## API 端點

| Prefix | 端點 |
|---|---|
| `/api/xrd` | parse / process / peaks / references / reference-peaks |
| `/api/raman` | parse / process / peaks / references / reference-peaks / fit |
| `/api/xas` | parse / process / deconv |
| `/api/xps` | parse / process / calibrate / fit / vbm / rsf / elements / element-peaks / periodic-table |
| `/api/xes` | parse / process / peaks / references / reference-peaks |

---

## 各模組完成度

| 模組 | 狀態 |
|---|---|
| **XRD** | ✅ 完整：Scherrer / 高斯模板扣除 / log 弱峰 / 參考峰匹配 |
| **Raman** | ✅ 完整：Si 應力估算 / Preset 匯入/匯出 / 峰擬合 |
| **XAS** | ✅ 完整：TEY+TFY / 高斯模板扣除 / 二階微分 / XANES 去卷積 |
| **XPS** | ✅ 完整：見下方詳述 |
| **XES** | ⚠️ 僅 1D 光譜模式，缺 FITS 影像模式 |
| **SEM** | ⏳ 未實作 |

---

## XPS 現況（最完整的模組）

### 步驟流程（sidebar）
1. 載入：`.xy / .txt / .csv / .vms / .pro / .dat`
2. 內插：每筆各自 linspace（不建共同 x 軸），`INTERP_POINTS_MIN=50 / MAX=5000`
3. 多檔平均：疊圖模式限定，平均前先對齊到同一內插網格
4. 能量校正：手動位移 + 標準樣品資料庫自動校正（`POST /api/xps/calibrate`）
5. 背景扣除：Shirley / Tougaard(B=2866,C=1643) / Linear / Polynomial / AsLS / airPLS；`?` 按鈕有方法說明
6. 歸一化：None / Min-Max / Max / Area / Mean Region；`?` 按鈕有方法說明
7. 峰擬合：元素資料庫 + 手動新增；Voigt / Gaussian / Lorentzian；`POST /api/xps/fit`
8. VBM（VB 模式）：線性外推 → `POST /api/xps/vbm`
9. 能帶偏移（VB 模式）：VBM 差值法 / Kraut Method（前端純計算）
10. RSF 定量：`POST /api/xps/rsf`，Scofield 1976 Al Kα

### 中間欄圖表
- 原始光譜 → 前處理後 → 背景扣除 → 歸一化 → 最終/擬合
- 背景/歸一化圖有 shaded region 標示區間（橘/青綠）
- 所有圖表支援 legend 點擊隱藏/顯示（`applyHidden` + `makeLegendClick`）
- 每張圖右上角有線色下拉（`ChartToolbar`）

### 匯出（三欄 grid）
- **研究常用**：最終 CSV / 背景後 CSV / 歸一化後 CSV / 原始 CSV
- **分析表格**：峰擬合 CSV / RSF 定量 CSV / VBM TXT
- **追溯/設定**：處理報告 JSON

### 單筆 / 疊圖雙模式
- `processingViewMode = 'single' | 'overlay'`
- 單筆：每筆資料各自保存 session（params / peaks / fitResult / rsfRows）
- 疊圖：獨立 `overlayState`，不共用單筆參數；`overlayDraftSelection` 避免勾選中途觸發處理
- 疊圖入口：右上角「選擇疊圖資料」按鈕 → modal 選取

### UI 元件
- `Section`：可折疊步驟卡，支援 `infoContent`（`?` 按鈕展開方法說明）
- `TogglePill`：玻璃感啟用按鈕（accent glow 亮起 / 暗沉停用），取代 CheckRow 的主要開關
  - 替換：啟用內插 / 自動調整點數 / 啟用多檔平均 / 手動調整偏移量 / 啟用背景扣除
  - 保留 CheckRow：顯示背景線 / 顯示原始（圖表工具列）
- 峰候選卡片：`enabled` 時整張卡亮起（accent border + bg glow）
- `CustomSelect`：`createPortal` + `position:fixed`，避免 `overflow-hidden` 裁切
- `ModuleTabs`：取代 `ModuleDropdown`，always-visible 水平 pill tabs，位於 logo 下方，隨側欄捲動（在 `flex-1 overflow-y-auto` 內）

---

## 重要技術細節

### XPS x 軸反轉
XPS binding energy 習慣高 BE 在左：後端峰偵測先 flip，前端圖表 `autorange: 'reversed'`

### Plotly legend 點擊隱藏
`applyHidden(traces, hidden[])` 設 `visible: 'legendonly'`；`makeLegendClick` return false 防 Plotly 內部切換；各圖各自維護 `xxxHidden` state

### XRD 防抖
`processData` / `detectPeaks` effect 加 300ms debounce；`SpectrumChart` CSS vars 用 `useMemo([], [])` 只在 mount 讀一次

### XAS parser
不可 import `modules/xas_auto.py`（含 Streamlit），parser helpers 直接寫在 `routers/xas.py`

### 高斯面積換算
`area = peak_height × fwhm × 1.0645`（XAS / XRD 高斯模板共用）

### 後端 core / db 位置
`web/backend/core/` 與 `web/backend/db/`（從 Desktop repo 複製，不含 `core/ui_helpers.py`）

---

## 各資料庫格式（供新增資料參考）

- **Raman DB**：`{ material: { peaks: [{position_cm, label, fwhm_cm, peak_type}] } }`
- **XRD DB**：`{ phase: { peaks: [{two_theta, relative_intensity, hkl}], color, ... } }`
- **XPS DB**：`ELEMENTS`（be/fwhm per orbital）、`ORBITAL_RSF`（格式：`"Ni 2p3/2": 14.07`）
- **XES DB**：`{ material: { peaks: [{label, energy_eV, tolerance_eV, relative_intensity, meaning}] } }`

---

## 待實作

| 項目 | 說明 |
|---|---|
| XES FITS 影像模式 | Dark/Bias 扣除 → hot pixel → 曲率校正 → ROI 積分；需 `astropy` |
| XES I0 正規化 | 上傳 CSV（dataset_name, i0_value），各光譜除以對應 I0 |
| SEM 模組 | 未開始 |

---

## 動作紀錄

- 2026-04-30 17:24 CST：讀取 `CLAUDE.md`、確認專案根目錄內容，準備只針對 `web/` 網頁版調整 XPS 前端說明彈窗與玻璃感外框。
- 2026-04-30 17:26 CST：再次讀取 `CLAUDE.md`，搜尋並定位 `web/frontend/src/pages/XPS.tsx` 內的 `Section`、`infoContent`、內插／背景扣除／歸一化／峰擬合相關程式。
- 2026-04-30 17:35 CST：修改 `web/frontend/src/pages/XPS.tsx`，將 XPS `Section` 的 `?` 說明改為中央覆蓋式 modal，新增內插說明問號視窗，並把步驟卡外框改為玻璃感樣式；同步將元素週期表 modal 改為畫面置中。
- 2026-04-30 17:37 CST：執行 `cd web/frontend && npm run build` 驗證前端編譯，結果通過；僅出現既有的 Vite chunk size 警告，未新增 TypeScript 或建置錯誤。
- 2026-04-30 17:41 CST：再次讀取 `CLAUDE.md` 並檢查 XPS 左上角 header，確認目前仍為 `ModuleTabs`；準備改成放大 logo/標題、下方中央標籤式感應下拉選單，且整塊在側欄內 sticky 隨捲動維持可見。
- 2026-04-30 17:44 CST：依使用者補充，將 XPS 左上角 header 改為「跟著側邊欄捲動區」的 sticky 區塊；放大 logo 與 Nigiro Pro 標題，並把分析模組改成長在卡片底部中央的感應式下拉標籤。
- 2026-04-30 17:46 CST：再次執行 `cd web/frontend && npm run build` 驗證 sticky 側欄 header 與分析模組下拉選單調整，編譯通過；僅保留既有 Vite chunk size 警告。
- 2026-04-30 17:58 CST：依使用者要求擴散 XPS UI 到 Raman / XRD，並確認本次只改 UI、不改步驟處理邏輯；新增共用 `WorkspaceUi.tsx`，提供 sticky sidebar header、分析模組下拉、玻璃感步驟卡與說明 modal。
- 2026-04-30 18:00 CST：修改 `web/frontend/src/components/ProcessingPanel.tsx` 與 `web/frontend/src/pages/XRD.tsx`，將 XRD 側欄 header、步驟卡、主要開關樣式與中間欄上方狀態卡改成接近 XPS 的視覺。
- 2026-04-30 18:02 CST：修改 `web/frontend/src/pages/Raman.tsx`，將 Raman 側欄 header、步驟卡、部分主要開關、步驟說明 modal 與中間欄資料切換區改成接近 XPS 的視覺。
- 2026-04-30 18:05 CST：執行 `cd web/frontend && npm run build` 驗證 Raman / XRD UI 套版結果，編譯通過；僅保留既有 Vite chunk size 警告，未新增 TypeScript 或建置錯誤。
- 2026-04-30 18:09 CST：依使用者回饋，確認 Raman / XRD 中間欄最上方尚未完全對齊 XPS，且缺少真正的多筆資料疊圖入口；準備補上前端模式切換、資料選取 modal 與疊圖顯示，但不更動既有步驟處理邏輯。

- 2026-04-30 18:16 CST：修改 `web/frontend/src/pages/XRD.tsx` 頁面骨架，將根容器改為固定視窗高度並補上 `min-h-0` / `overflow-hidden`，讓 XRD 側邊欄與中間欄改成比照 XPS 的分離捲動。
- 2026-04-30 18:18 CST：執行 `cd web/frontend && npm run build` 驗證 XRD 分離捲動調整，前端編譯通過；僅保留既有的 Vite chunk size 警告與 package module type warning，未新增 TypeScript 或建置錯誤。
- 2026-04-30 18:34 CST：修改 `web/frontend/src/components/WorkspaceUi.tsx`、`web/frontend/src/pages/XRD.tsx`、`web/frontend/src/pages/Raman.tsx`，新增共用的 XPS 式中間欄頂部切換區與疊圖資料選取 modal，並將 Raman / XRD 補上比照 XPS 的單筆／多筆疊圖前端狀態流程與主圖切換。
- 2026-04-30 18:36 CST：修正 `web/frontend/src/pages/XRD.tsx` 的 JSX 包裹層級後重新執行 `cd web/frontend && npm run build`，前端編譯通過；僅保留既有的 Vite chunk size 警告與 package module type warning，未新增 TypeScript 或建置錯誤。
- 2026-04-30 18:48 CST：讀取 `CLAUDE.md` 並檢視 `web/frontend/src/pages/XRD.tsx`、`web/frontend/src/components/ProcessingPanel.tsx`、`web/backend/routers/xrd.py`、`web/backend/core/parsers.py`、`web/backend/core/processing.py`、`web/backend/core/spectrum_ops.py`，逐項比對目前 XRD 實作與使用者提供的理想流程差異，整理已具備、部分具備與缺少功能。
- 2026-04-30 19:02 CST：讀取 `CLAUDE.md` 後修改 `web/frontend/src/components/WorkspaceUi.tsx`、`web/frontend/src/index.css`、`web/frontend/src/pages/XPS.tsx`，把 sidebar 步驟卡與 sticky header 換成較輕量的表面層，加入 `sidebar-scroll` 的 `content-visibility` / `overscroll-behavior` / `scrollbar-gutter` 等優化，降低 XPS / XRD / Raman 側邊欄捲動時的重繪成本。
- 2026-04-30 19:08 CST：修改 `web/frontend/src/components/ProcessingPanel.tsx` 與 `web/frontend/src/pages/Raman.tsx`，將 XRD 的「內插 / 多檔平均」拆成獨立步驟，並把 Raman 側邊欄重新拆成「去尖峰 / 內插 / 多檔平均 / 背景扣除 / 平滑 / 歸一化 / 峰偵測與參考峰 / 峰位管理與擬合」，比照 XPS 的單步驟結構，但不改動後端處理邏輯。
- 2026-04-30 19:14 CST：修改 `web/frontend/src/pages/XRD.tsx` 與 `web/frontend/src/pages/Raman.tsx`，新增共用 ChartToolbar / legend hide / 線色切換與 stage CSV 匯出，將中間欄主圖改成比照 XPS 的多張分階段圖卡：原始、前處理、疊圖、背景或高斯模板、最終結果；多筆資料模式也統一用 XPS 式卡片顯示流程。
- 2026-04-30 19:16 CST：再次讀取 `CLAUDE.md` 後執行 `cd web/frontend && npm run build` 驗證本輪 sidebar 效能優化、Raman/XRD 圖卡重構與步驟拆分；前端編譯通過，僅保留既有 Vite chunk size 警告與 package module type warning，未新增 TypeScript 或建置錯誤。
- 2026-04-30 19:24 CST：讀取 `CLAUDE.md` 並依使用者截圖調整 `web/frontend/src/components/WorkspaceUi.tsx`，縮小 sidebar sticky header 的 logo、標題字級與分析模組標籤尺寸，同時增加 header 底部保留空間，避免模組標籤被下方區塊裁切。
- 2026-04-30 19:27 CST：檢視 `web/frontend/src/pages/XRD.tsx` 與 Plotly 設定後，確認 XRD 卡頓主因較偏向「同時掛載多張 Plotly 圖表且每張都啟用 scrollZoom / resize handler」，不是單純因為 sidebar 步驟數量太多；先將 XRD 分階段圖卡的 `scrollZoom` 全部關閉，降低滾輪與重繪負擔。
- 2026-04-30 19:29 CST：再次讀取 `CLAUDE.md` 後執行 `cd web/frontend && npm run build` 驗證 header 尺寸調整與 XRD Plotly 減負設定；前端編譯通過，僅保留既有 Vite chunk size 警告與 package module type warning，未新增 TypeScript 或建置錯誤。
- 2026-04-30 19:34 CST：讀取 `CLAUDE.md` 並檢視 `web/backend/main.py`、`web/backend/requirements.txt`、`web/frontend` 相關檔案，整理目前網站版專案的前後端架構、主要語言與關鍵套件，回覆使用者目前技術棧概況。
- 2026-04-30 20:36 CST：讀取 `CLAUDE.md` 後依使用者要求補充一版更直觀的網站版架構圖，整理成「瀏覽器 → React/Vite 前端 → FastAPI 後端 → core processing / db」的資料流與目錄對照說明。
- 2026-04-30 20:42 CST：讀取 `CLAUDE.md` 後審閱使用者貼上的 XRD 自動找峰推薦方案；雖然外部 share link 本體未成功抓取，但使用者貼出的內容已足夠，先整理可實作項目、分階段導入建議與需要和使用者確認的企劃方向，暫不先修改 XRD 程式。
