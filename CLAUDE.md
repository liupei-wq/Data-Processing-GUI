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

## 快速啟動與驗證

**本機啟動**

```bash
# Terminal 1
cd web && uvicorn backend.main:app --reload --port 8000

# Terminal 2
cd web/frontend && npm run dev
```

前端預設位址：`http://localhost:3000`

**常用驗證**

```bash
# 前端建置
cd web/frontend && npm run build

# 後端語法檢查
python3 -m py_compile web/backend/main.py web/backend/routers/*.py
```

**部署注意**

- `railway.toml` 使用 `builder=DOCKERFILE`，不要設定 `startCommand`。
- Dockerfile 位於 `web/Dockerfile`，採多階段 build。
- Render 線上站是目前網頁版主要部署目標。

---

## 架構與目錄

**資料流**

`Browser` → `React/Vite frontend` → `FastAPI backend` → `core processing / db`

**目錄結構**

```text
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

## API 概覽

| Prefix | 端點 |
|---|---|
| `/api/xrd` | parse / process / peaks / references / reference-peaks |
| `/api/raman` | parse / process / peaks / references / reference-peaks / fit |
| `/api/xas` | parse / process / deconv |
| `/api/xps` | parse / process / calibrate / fit / vbm / rsf / elements / element-peaks / periodic-table |
| `/api/xes` | parse / process / peaks / references / reference-peaks |

---

## 模組狀態

| 模組 | 狀態 |
|---|---|
| **XRD** | ✅ 完整：Scherrer / log 弱峰 / 參考峰匹配 |
| **Raman** | ✅ 完整：Si 應力估算 / Preset 匯入匯出 / 峰擬合 |
| **XAS** | ✅ 完整：TEY+TFY / 高斯模板扣除 / 二階微分 / XANES 去卷積 |
| **XPS** | ✅ 完整，且目前是功能最完整的模組 |
| **XES** | ⚠️ 僅 1D 光譜模式，缺 FITS 影像模式 |
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
- `ModuleTabs`：位於 logo 下方的水平 pill tabs，隨側欄捲動

---

## 重要技術備忘

### XPS x 軸反轉

XPS binding energy 習慣高 BE 在左，因此後端峰偵測先 flip，前端圖表使用 `autorange: 'reversed'`。

### Plotly legend 點擊隱藏

`applyHidden(traces, hidden[])` 會把 trace 設成 `visible: 'legendonly'`；`makeLegendClick` 需 `return false` 來阻止 Plotly 內建切換；各張圖各自維護 `xxxHidden` state。

### XRD 防抖

`processData` / `detectPeaks` 的 effect 加了 300ms debounce；`SpectrumChart` 的 CSS vars 用 `useMemo([], [])`，只在 mount 時讀取一次。

### XAS parser

不要 import `modules/xas_auto.py`（含 Streamlit 依賴）；parser helpers 直接維護在 `routers/xas.py`。

### 高斯面積換算

`area = peak_height × fwhm × 1.0645`，XAS / XRD 高斯模板共用這個換算。

### 後端 core / db 來源

`web/backend/core/` 與 `web/backend/db/` 是從 Desktop repo 複製過來的，但不包含 `core/ui_helpers.py`。

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
| ~~XES I0 正規化~~ | ✅ 已實作：步驟 6 sidebar textarea 輸入，後端 ProcessParams i0_values |
| SEM 模組 | 尚未開始 |

---

## 紀錄規範

- 有實作或明確驗證動作時，請在下方「動作紀錄」追加一筆。
- 建議格式：`YYYY-MM-DD HH:MM TZ：動作 + 影響檔案 + 驗證結果`
- 純討論若沒有修改檔案，可視情況省略；若內容會影響後續判斷，仍建議記錄。

---

## 動作紀錄

### 2026-04-30

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
- 2026-04-30 20:46 CST：讀取 `CLAUDE.md` 後回覆使用者目前網站版可用的前端與後端網址資訊，包含 Render 線上站與本機開發預設位址。
- 2026-04-30 15:42 UTC：整理 `CLAUDE.md` 結構，將內容重編為協作規則、專案定位、啟動驗證、架構/API、模組狀態、技術備忘、資料庫格式、待實作與紀錄規範等區塊；未改動任何程式碼。

### 2026-05-01

- 2026-05-01 CST：修改 `web/frontend/src/pages/XPS.tsx`，將疊圖模式的單一 `overlayStage` 圖卡拆分為：前處理、背景扣除（含橘色區間 shading）、歸一化（含綠色區間 shading）、最終結果（無前述 stage 時的 fallback）四張獨立圖卡；新增 `overlayBgHidden`、`overlayNormHidden` 狀態與 `overlayBgLayout`、`overlayNormLayout` 版面，並補上 `overlayBg`、`overlayNorm` 線色選項。
- 2026-05-01 CST：修改 `web/backend/routers/xps.py`，修正 `/fit` 端點讀取 `fit_peaks()` 回傳結果時的 key 大小寫錯誤（`Area`→`area`、`Center`→`center`、`FWHM`→`fwhm`、`Height`→`amplitude`、`Peak_Name`→`label`），並補上 numpy array `tolist()` 轉換，防止 Pydantic 序列化失敗；同步加入 `success` 欄位判斷，讓後端明確回 422 而非返回全零結果。
- 2026-05-01 CST：執行 `python3 -m py_compile` 與 `npm run build` 驗證，兩者均通過，未新增錯誤。
- 2026-05-01 14:13 CST：讀取 `CLAUDE.md` 並檢視 `web/backend/routers/xrd.py`、`web/frontend/src/types/xrd.ts`、`web/frontend/src/api/xrd.ts`、`web/frontend/src/components/ProcessingPanel.tsx`、`web/frontend/src/pages/XRD.tsx`，開始把 XRD 自動找峰改成資料驅動的簡化介面與 MAD 雜訊估算流程。
- 2026-05-02 00:24 CST：讀取 `CLAUDE.md` 並補強 `web/frontend/src/pages/XPS.tsx` 的疊圖模式流程，將 `overlayState` 預設固定為啟用內插與多檔平均，新增 `overlayFitResult / overlayRsfRows`，讓疊圖模式的峰擬合、RSF 表格、最終圖卡與匯出都改為吃「多檔平均後的單一結果」，同時保留單筆模式各自 session 的原邏輯。
- 2026-05-02 00:27 CST：執行 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/peak_fitting.py` 與 `cd web/frontend && npm run build` 驗證 XPS 疊圖平均擬合調整；後端語法檢查與前端建置皆通過，僅保留既有 Vite chunk size 警告。
- 2026-05-02 00:33 CST：讀取 `CLAUDE.md` 並檢查 `git pull` 被擋下的工作樹狀態，確認目前未提交的本地修改為 `web/frontend/src/pages/XPS.tsx` 與 `CLAUDE.md`，因此 Git 為避免覆蓋本地 XPS 變更而中止合併；暫未執行任何破壞性 git 操作。
- 2026-05-02 00:37 CST：將本地 `web/frontend/src/pages/XPS.tsx` 與 `CLAUDE.md` 提交為 `Update XPS overlay fitting workflow`，接著執行 `git pull --rebase`；遠端同步修改了 `XPS.tsx`，因此在最終處理圖卡區塊發生 rebase conflict。
- 2026-05-02 00:42 CST：解決 `web/frontend/src/pages/XPS.tsx` 的 rebase conflict，保留遠端新增的最終圖表彈出功能，同時把本地新增的疊圖平均擬合資料來源、RSF/匯出共用邏輯整合回同一份檔案，之後成功完成 `git rebase --continue`。
- 2026-05-02 00:44 CST：執行 `cd web/frontend && npm run build` 驗證 rebase 後的 XPS 前端，建置通過；工作樹已回到乾淨狀態，僅保留既有 Vite chunk size 警告。
- 2026-05-01 14:13 CST：修改 `web/backend/routers/xrd.py`，將 `/api/xrd/peaks` 的請求參數改為 `sensitivity / min_distance / width_min / width_max / exclude_ranges / min_snr`，以 `MAD` 估算 noise、自動換算 height/prominence/width/distance 門檻，並用 `high / medium / low` 信心等級取代舊的弱峰參數邏輯。
- 2026-05-01 14:13 CST：修改 `web/frontend/src/types/xrd.ts`、`web/frontend/src/api/xrd.ts`、`web/frontend/src/components/ProcessingPanel.tsx`、`web/frontend/src/pages/XRD.tsx`，把 XRD 尋峰 UI 改成 GPT 建議的簡化樣式：只保留偵測靈敏度、最小峰距、峰寬範圍、排除區間、最小 S/N 等直覺控制；同步移除舊的 `prominence / weak peak threshold / min prominence` 介面，預設加入 `68–70°` Si 排除區，並把結果表與匯出邏輯改成新的 `high / medium / low / unmatched` 信心分類。
- 2026-05-01 14:13 CST：刪除 `web/frontend/src/pages/XRD.tsx` 內重複的第二張簡化峰表，只保留整合後的最終峰表；同時更新「找不到峰」提示文案，改為引導調整靈敏度、排除區間與峰寬範圍。
- 2026-05-01 14:13 CST：執行 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py` 與 `cd web/frontend && npm run build` 驗證 XRD 自動找峰改版；後端語法檢查與前端建置皆通過，僅保留既有的 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 14:26 CST：再次讀取 `CLAUDE.md` 並檢視 `web/frontend/src/pages/XRD.tsx`、`web/frontend/src/components/ProcessingPanel.tsx`、`web/frontend/src/types/xrd.ts`，接續實作 XRD 第二階段工作流補強。
- 2026-05-01 14:26 CST：修改 `web/frontend/src/components/ProcessingPanel.tsx` 與 `web/frontend/src/pages/XRD.tsx`，在 XRD 自動尋峰區新增 `Thin film on Si` 與 `一般掃描` 兩個快速 preset；其中 `Thin film on Si` 會套用較適合薄膜樣品的峰距、峰寬、S/N 與 `68–70°` Si 排除區設定。
- 2026-05-01 14:26 CST：修改 `web/frontend/src/types/xrd.ts` 與 `web/frontend/src/pages/XRD.tsx`，在最終峰表新增 `near_reference` 與 `candidate_count` 欄位，並同步補進畫面表格、CSV/Excel 匯出與處理報告 JSON，讓使用者更容易判斷每個峰是否靠近參考峰與可能候選數量。
- 2026-05-01 14:26 CST：調整 `web/frontend/src/pages/XRD.tsx` 的 `processingReport`，新增 `peak_detection.workflow_preset` 追蹤目前使用的是 `thin_film_si / general / custom` 哪種尋峰工作流。
- 2026-05-01 14:26 CST：再次執行 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py` 與 `cd web/frontend && npm run build` 驗證 XRD 第二階段補強；後端語法檢查與前端建置皆通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 14:26 CST：再次讀取 `CLAUDE.md` 並檢視 `web/backend/core/peak_fitting.py`、`web/backend/routers/raman.py`、`web/backend/routers/xps.py` 與 `web/frontend/src/pages/XRD.tsx`，確認可沿用既有的 `fit_peaks()` 架構來新增 XRD 的 Pseudo-Voigt 峰擬合流程。
- 2026-05-01 14:26 CST：修改 `web/backend/routers/xrd.py`，新增 `/api/xrd/fit` 端點與對應的 `FitRequest / FitResponse` 模型，讓 XRD 可直接使用目前尋峰結果作為 seed，透過 `core/peak_fitting.py` 執行 `pseudo_voigt / voigt / gaussian / lorentzian` 峰擬合，並回傳總擬合、各組件、殘差與擬合指標。
- 2026-05-01 14:26 CST：修改 `web/frontend/src/types/xrd.ts`、`web/frontend/src/api/xrd.ts`、`web/frontend/src/components/ProcessingPanel.tsx`、`web/frontend/src/pages/XRD.tsx`，新增 XRD 峰擬合參數、fit API client、sidebar「峰擬合」步驟卡、單筆資料模式的擬合圖卡、擬合結果表與 `xrd_peak_fit.csv` 匯出；seed 可選擇來自全部偵測峰、近參考峰或高/中信心峰，範圍支援自動包住峰群或手動指定。
- 2026-05-01 14:26 CST：更新 `web/frontend/src/pages/XRD.tsx` 的處理報告 JSON，加入 `peak_fitting` 區塊，保存擬合參數、fit window、seed labels 與完整擬合結果摘要，方便之後追溯。
- 2026-05-01 14:26 CST：執行 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py` 與 `cd web/frontend && npm run build` 驗證 XRD 峰擬合功能；後端語法檢查與前端建置皆通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 14:40 CST：讀取 `CLAUDE.md` 並檢視 `web/frontend/src/pages/SingleProcessTool.tsx`、`web/frontend/src/components/GaussianSubtractionChart.tsx`、`web/backend/core/spectrum_ops.py`，確認使用者指的是「數據單一處理」頁面的高斯模板扣除區，而不是 XRD 模組；定位目前滑桿步進過大、主要控制放在側欄，以及右側圖上雖已有高斯模型但顯示不夠明顯的問題。
- 2026-05-01 14:40 CST：修改 `web/frontend/src/pages/SingleProcessTool.tsx`，將單一處理頁高斯模板扣除的 `FWHM / 固定高度 / 搜尋半寬 / 中心位置` 全部改成 `0.01` 步進，並把 `固定高度` 預設值從固定 `100` 改為較保守的 `1`，上傳檔案後再依資料最大強度自動帶入約 `8%` 的初始高度，降低一開始就扣成負值的機率。
- 2026-05-01 14:40 CST：修改 `web/frontend/src/pages/SingleProcessTool.tsx`，將高斯模板的主要滑桿與中心設定從側邊欄移到中間結果欄圖表上方，拉長滑桿可操作區域；側欄改為簡短提示說明，保留上傳與工具設定的整體節奏。
- 2026-05-01 14:40 CST：修改 `web/frontend/src/pages/SingleProcessTool.tsx` 的高斯圖 trace，將原本的「高斯模型」改名為更明確的「被扣掉的高斯曲線」，並加粗、改成橘色虛線，讓使用者更清楚看到實際被扣除的模板曲線。
- 2026-05-01 14:40 CST：執行 `cd web/frontend && npm run build` 驗證單一處理頁高斯模板 UI 調整；前端建置通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 14:46 CST：讀取 `CLAUDE.md` 並檢視 `web/frontend/src/pages/SingleProcessTool.tsx`、`web/frontend/src/types/xrd.ts`、`web/frontend/src/components/ProcessingPanel.tsx`、`web/backend/routers/xrd.py`、`web/backend/core/spectrum_ops.py`，規劃將「避免扣成負值」做成真正的共用處理參數，而不是只在前端顯示限制。
- 2026-05-01 14:46 CST：修改 `web/backend/core/spectrum_ops.py` 與 `web/backend/routers/xrd.py`，為高斯模板扣除新增 `gaussian_nonnegative_guard` 保護參數；啟用後若模板扣除量超過目前訊號，後端會自動縮小高斯模板並把殘值夾回非負範圍，同步回傳是否觸發保護與縮放倍率。
- 2026-05-01 14:46 CST：修改 `web/frontend/src/types/xrd.ts`、`web/frontend/src/components/ProcessingPanel.tsx`、`web/frontend/src/pages/SingleProcessTool.tsx`，補上 `gaussian_nonnegative_guard` 型別與預設值，並在單一處理頁高斯模板區新增預設開啟的「避免負值保護」勾選；結果圖上方也會顯示本次是否真的介入，以及高斯模板被縮放到多少倍。
- 2026-05-01 14:46 CST：執行 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py` 與 `cd web/frontend && npm run build` 驗證單一處理頁高斯模板負值保護；後端語法檢查與前端建置皆通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 14:49 CST：讀取 `CLAUDE.md` 並再次檢視 `web/frontend/src/pages/SingleProcessTool.tsx`，將單一處理頁高斯模板扣除的 `固定高度` 滑桿改成依目前資料與已設定高斯中心動態估算安全上限；當「避免負值保護」開啟時，前端會自動把滑桿最大值限制在安全範圍，並在高度超出時自動拉回安全值。
- 2026-05-01 14:49 CST：修改 `web/frontend/src/pages/SingleProcessTool.tsx`，新增以目前 `y_raw` 與高斯中心組合估算安全高度上限的 `useMemo`，並在高斯模板區塊顯示當前安全上限數值，讓使用者在拖拉前就知道可用範圍。
- 2026-05-01 14:49 CST：執行 `cd web/frontend && npm run build` 驗證單一處理頁高斯模板動態安全上限；前端建置通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 15:04 CST：讀取 `CLAUDE.md` 並再次修改 `web/frontend/src/pages/SingleProcessTool.tsx`，補回單一處理頁高斯模板扣除的 `匯出處理 CSV` 按鈕，匯出內容包含 `raw / gaussian_model / gaussian_subtracted / processed`，並在摘要列附上指定區間最低點的座標。
- 2026-05-01 15:04 CST：修改 `web/frontend/src/pages/SingleProcessTool.tsx`，新增 `403–406` 區間最低點偵測卡與圖上標記，會在原始數據中找出該區間最低點、顯示 X/Y 數值，並同步在圖上以紅色標記與標註顯示。
- 2026-05-01 15:04 CST：修改 `web/frontend/src/pages/SingleProcessTool.tsx` 的圖表互動設定，將單一處理頁改為較穩定的縮放模式：左鍵拖曳框選放大、雙擊重置；同時停用滑鼠滾輪縮放，避免使用者先前回報的縮放異常。
- 2026-05-01 15:04 CST：依使用者補充需求，再次修改 `web/frontend/src/pages/SingleProcessTool.tsx`，將最低點綁定邏輯從「綁第一個高斯中心」改為「綁高斯曲線切到最低點」：第一個中心仍可自由移動，但當綁定開啟時，系統會依最低點與目前中心/FWHM 自動重算高度，讓高斯曲線持續通過該最低點；畫面也會顯示該點在扣高斯後目前剩餘的 Y 值，方便判斷是否接近 0。
- 2026-05-01 15:04 CST：執行 `cd web/frontend && npm run build` 驗證單一處理頁高斯模板的匯出、最低點偵測、縮放修正與最新綁定邏輯；前端建置通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 15:15 CST：依使用者回饋再次修改 `web/frontend/src/pages/SingleProcessTool.tsx`，將原本持續自動綁定的「鎖定到最低點」改成一次性的「對齊到最低點」按鈕：按下時只會根據目前中心位置、FWHM 與 403–406 區間最低點計算一次建議高度並套用到 `gaussianHeight`，之後高度滑桿仍可自由手動調整，不再被固定。
- 2026-05-01 15:15 CST：同步移除圖上最低點標記與註解，只保留區間陰影與下方數值卡，避免標示遮住曲線；相關說明文字也改成「先移動中心，再按按鈕對齊」的操作方式。
- 2026-05-01 15:15 CST：執行 `cd web/frontend && npm run build` 驗證單一處理頁高斯模板的一次性對齊按鈕與解除持續綁定後的交互；前端建置通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 15:25 CST：依使用者最新需求再次修改 `web/frontend/src/pages/SingleProcessTool.tsx`，將單一處理頁高斯模板的最低點功能改回「一鍵綁定最低點」的持續綁定模式：按下 `鎖定到最低點` 後，高斯中心仍可移動，但系統會持續依 403–406 區間最低點與目前中心/FWHM 自動重算高度；按 `解除綁定` 則回到手動高度模式。
- 2026-05-01 15:25 CST：針對使用者回報的數值調整卡頓，修改 `web/frontend/src/pages/SingleProcessTool.tsx`，為單一處理頁的 `processData` 參數新增前端防抖機制（高斯模式 180ms），避免拖動滑桿時每一小格都立即重跑後端處理，降低畫面延遲感。
- 2026-05-01 15:25 CST：同步在 `web/frontend/src/pages/SingleProcessTool.tsx` 的 Plotly 版面加入穩定的 `uirevision`，讓單一處理頁在調整參數時更能保留目前縮放視角，不會每次更新都跳回初始視圖。
- 2026-05-01 15:25 CST：執行 `cd web/frontend && npm run build` 驗證單一處理頁高斯模板的持續最低點綁定與效能優化；前端建置通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 15:35 CST：依使用者最新要求再次修改 `web/frontend/src/pages/SingleProcessTool.tsx`，把 `403–406` 區間最低點重新顯示回高斯模板圖上，新增明確的粉紅色最低點 marker，讓使用者一開始就能直接看到目前綁定目標。
- 2026-05-01 15:35 CST：為改善單一處理頁高斯模板拖動滑桿時的延遲，重寫 `SliderRow` 的互動方式：數值框改成輸入後於 `blur / Enter` 才提交，range 滑桿改成拖動時先只更新本地顯示、放開滑鼠或觸控後才真正觸發參數更新與後端重算，大幅減少每次拖動產生的重算次數。
- 2026-05-01 15:35 CST：執行 `cd web/frontend && npm run build` 驗證單一處理頁高斯模板的最低點重新顯示與滑桿提交模式優化；前端建置通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 15:52 CST：依使用者最新需求再次調整 `web/frontend/src/pages/SingleProcessTool.tsx`，把「高斯模板調整 / 403–406 區間綁定最低點 / 高斯中心」三塊控制區全部移回左側欄，並將側邊欄改為 `sticky + overflow-y-auto` 版型，方便一邊盯著右側圖表一邊調整左側參數。
- 2026-05-01 15:52 CST：為徹底解決單一處理頁高斯模板調整時圖表反應過慢的問題，新增獨立的 `gaussianDraft` 編輯狀態與「套用到圖表 / 還原成已套用」工作流；左側拉桿與輸入框只會改動草稿值，不會立即重跑處理流程，只有按下套用後才會把參數送進圖表與後端處理。
- 2026-05-01 CST：完整重寫 `web/frontend/src/pages/SingleProcessTool.tsx`（v17.8），移除破損的 `gaussianDraft` 草稿系統（舊系統引用了大量未定義變數導致執行期崩潰）；改回即時顯示（150ms debounce 送後端）；修正「鎖定最低點」邏輯：移動最近中心到 x_min、height = y_min / unit_profile 使曲線切過最低點，y_min ≤ 0 時夾回 0；高斯與背景扣除工具各自拆成兩張圖（原始+模型 / 扣除後結果）；TypeScript `tsc && vite build` 全通過，推送 v17.8。
- 2026-05-01 15:52 CST：同步保留先前加入的最低點 marker 與持續綁定邏輯，並將其改成左側草稿模式下也能先預覽最低點座標與建議高度，再決定是否套用到右側圖表。
- 2026-05-01 15:52 CST：執行 `cd web/frontend && npm run build` 驗證單一處理頁高斯模板的左欄重排與手動套用模式；前端建置通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 17:30 CST：依使用者要求完整重構 `web/frontend/src/pages/SingleProcessTool.tsx`：①版型改為 `flex h-screen overflow-hidden`，左側固定可捲動側欄（300px）+ 右側可捲動主區，高斯工具全部控制移入左欄，隨時可對照右側圖表調整；②高斯工具改為手動「套用到扣除結果」按鈕觸發後端呼叫（bg/normalize 仍自動），拖動滑桿只更新即時預覽不觸發後端；③鎖定最低點模式改為前端純計算：`lockedAfterY = max(0, y_raw - clientGaussianModel)`，下圖立即反映精確結果（y_min ≤ 0 夾回 0），不需按套用；TypeScript 及前端建置均通過。
- 2026-05-01 17:10 CST：讀取 `CLAUDE.md` 後實作 XES I0 正規化功能；修改 `web/backend/routers/xes.py`（ProcessParams 新增 `i0_values: Dict[str, float]`，處理迴圈在 BG 扣除前先除以對應 I0）、`web/frontend/src/types/xes.ts`（同步型別）、`web/frontend/src/pages/XES.tsx`（新增步驟 6「I0 正規化」sidebar 卡片，含 textarea 輸入、套用按鈕、已套用值列表與清除按鈕，原步驟 6/7/8 順延為 7/8/9）；後端語法檢查與前端建置皆通過。
- 2026-05-01 18:00 CST：依使用者回饋完整重構 `web/frontend/src/pages/SingleProcessTool.tsx` 高斯模板功能：①鎖定最低點演算法改為歸一化歐式距離（x 軸除以 xRange、y 軸除以 yRange）找出高斯曲線上最近點，再平移整條曲線使該點落在最低點（而非舊版的峰頂對齊最低點）；②新增高斯面積顯示：`area = H × FWHM × 1.0645`；③移除「搜尋半寬」滑桿，後端 `gaussian_search_half_width` 固定為 0；④左側高斯控制區新增 `clientAfterY` 即時預覽（前端純計算），扣除結果圖不需觸發後端；執行 `python3 -m py_compile` 與 `npm run build` 均通過。
- 2026-05-01 18:12 CST：讀取 `CLAUDE.md` 並檢查現行 `web/frontend/src/pages/SingleProcessTool.tsx` 後，確認高斯模板頁目前已是雙圖模式：上圖顯示「原始訊號 + 高斯模型」，下圖獨立顯示「扣除後結果」；本輪未再重寫該頁結構，避免和已重構完成的版本衝突。
- 2026-05-01 18:12 CST：修正 `web/backend/core/peak_fitting.py` 的共用擬合目標函式，將 Voigt 寬度懲罰項改為固定長度輸出；舊版會依擬合過程是否觸發懲罰而動態改變 residual 向量長度，導致 SciPy 在 XPS 峰擬合時拋出 `could not broadcast input array from shape (602,) into shape (601,)`。
- 2026-05-01 18:12 CST：執行 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/peak_fitting.py` 與 `cd web/frontend && npm run build` 驗證 XPS 共用峰擬合修正；後端語法檢查與前端建置皆通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-01 18:24 CST：讀取 `CLAUDE.md` 後檢查 `web/frontend/src/pages/XRD.tsx`、`web/frontend/src/pages/Raman.tsx`、`web/frontend/src/components/WorkspaceUi.tsx`、`web/frontend/src/components/ProcessingPanel.tsx` 與 `web/frontend/src/index.css`，分析 XRD / Raman 畫面卡頓來源；初步判斷 XRD 主要成本來自同頁同時掛載多張 `Plotly` 圖表加上大量 `useMemo/useEffect` 衍生計算，Raman 則除了多張圖外，sidebar 全開時會一次掛出大量表單與步驟內容，造成 React 重繪與瀏覽器版面計算壓力上升。
- 2026-05-01 18:31 CST：依前述分析開始實作前端優化；修改 `web/frontend/src/components/WorkspaceUi.tsx`，新增共用 `DeferredRender` 元件，使用 `IntersectionObserver` 讓圖卡接近視窗時才真正掛載，降低 XRD / Raman 一進頁面就同時初始化多張 Plotly 的成本。
- 2026-05-01 18:31 CST：修改 `web/frontend/src/pages/XRD.tsx`，將除首張原始圖外的主要次級圖卡（疊圖、前處理、高斯模板、對數弱峰、最終圖、peak fitting）改用 `DeferredRender` 延後掛載，減少 XRD 首次進頁的卡頓。
- 2026-05-01 18:31 CST：修改 `web/frontend/src/pages/Raman.tsx`，把主區所有 stage 圖與擬合圖的 `scrollZoom` 全部關閉，並將疊圖、前處理、背景、最終、擬合圖卡改用 `DeferredRender` 延後掛載，降低 Raman 主區 Plotly 互動與初始化負擔。
- 2026-05-01 18:31 CST：修改 `web/frontend/src/index.css`，為 `.step-content` 加上 `content-visibility: auto` 與 `contain`，讓 Raman 側邊欄步驟全開時，展開內容也能延後渲染、降低版面計算成本。
- 2026-05-01 18:31 CST：執行 `cd web/frontend && npm run build` 驗證 XRD / Raman 畫面效能優化；前端建置通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-02 00:26 CST：讀取 `CLAUDE.md` 後依使用者要求修改 `web/frontend/src/components/ProcessingPanel.tsx`，將 XRD 側邊欄中的「高斯模板扣除」與「峰擬合」兩個步驟整段移除，並重新整理其餘步驟編號，避免 XRD 流程再暴露這兩套控制。
- 2026-05-02 00:26 CST：修改 `web/frontend/src/pages/XRD.tsx`，同步移除 XRD 頁面內所有高斯模板扣除與峰擬合相關的 state、`useMemo`、`useEffect`、圖卡、結果表、匯出按鈕與處理報告欄位；另把詳細 CSV 匯出中的 `gaussian_model / gaussian_subtracted` 欄位刪除，讓畫面與匯出一致。
- 2026-05-02 00:26 CST：為降低 XRD 捲動卡頓，進一步將自動尋峰表、Scherrer 表、參考峰匹配表與匯出區改用 `DeferredRender` 延後掛載，並在 `web/frontend/src/index.css` 新增 `.workspace-main-scroll`，為主捲動區補上 `overscroll-behavior`、`scrollbar-gutter` 與 `contain`，減少滑鼠滾輪捲動時的版面與重繪負擔。
- 2026-05-02 00:26 CST：更新 `CLAUDE.md` 模組狀態中的 XRD 描述，移除已不再保留於前端流程的「高斯模板扣除」項目，讓文件與目前網站版 UI 一致。
- 2026-05-02 00:26 CST：執行 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/peak_fitting.py` 與 `cd web/frontend && npm run build` 驗證本輪 XRD 簡化與捲動優化；後端語法檢查與前端建置皆通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-02 01:05 CST：讀取 `CLAUDE.md` 後依使用者要求啟動本地測試；先執行 `npm run dev -- --host 127.0.0.1 --port 3000` 成功開起前端 Vite 開發伺服器，網址為 `http://127.0.0.1:3000/`。
- 2026-05-02 01:05 CST：發現本機 Python 環境尚未安裝 `uvicorn` 等後端依賴，依 `web/backend/requirements.txt` 執行 `python3 -m pip install -r web/backend/requirements.txt` 補齊 FastAPI 後端所需套件。
- 2026-05-02 01:05 CST：安裝完成後執行 `python3 -m uvicorn backend.main:app --reload --port 8000`，成功開起本地 FastAPI 後端，網址為 `http://127.0.0.1:8000/`。
- 2026-05-02 01:16 CST：讀取 `CLAUDE.md` 後檢查 `web/frontend/src/pages/XPS.tsx`、`web/frontend/src/api/xps.ts`、`web/backend/routers/xps.py` 與 `web/backend/core/peak_fitting.py`，追查使用者回報的「XPS 按下峰擬合後圖跑不出來」問題；確認主因不是後端回傳格式，而是前端有一個清空擬合結果的 `useEffect` 將 `fitResult` 自己也放進依賴陣列，導致剛完成擬合就立刻被清空。
- 2026-05-02 01:16 CST：修改 `web/frontend/src/pages/XPS.tsx`，將該 `useEffect` 改成只在單筆模式的處理參數或內插設定真正改變時，才透過函式型 `setFitResult` / `setRsfRows` 清掉既有結果；避免 `fitResult` 一更新就自我觸發清空，讓 XPS 擬合曲線可以正常留在主圖上。
- 2026-05-02 01:16 CST：執行 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/peak_fitting.py` 與 `cd web/frontend && npm run build` 驗證 XPS 擬合結果顯示修正；後端語法檢查與前端建置皆通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-02 01:24 CST：為了讓 XPS 擬合結果更明顯，進一步修改 `web/frontend/src/pages/XPS.tsx`，新增獨立的「峰擬合光譜」圖卡，專門顯示擬合輸入、總擬合、各峰組件與殘差，不再只把擬合結果疊在最終處理圖裡。
- 2026-05-02 01:24 CST：同步在 `web/frontend/src/pages/XPS.tsx` 的 `handleFit()` 補上單筆模式保護；若目前在疊圖模式按下擬合，會直接顯示「峰擬合目前只支援單筆資料模式」的錯誤訊息，避免使用者誤以為按鈕沒反應。
- 2026-05-02 01:24 CST：再次執行 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/peak_fitting.py` 與 `cd web/frontend && npm run build` 驗證 XPS 獨立擬合圖卡與模式保護；後端語法檢查與前端建置皆通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
- 2026-05-02 01:29 CST：依使用者回饋再次調整 `web/frontend/src/pages/XPS.tsx` 的 `handleFit()`；將原本「疊圖模式下直接擋住不讓擬合」的做法改成按下後自動呼叫 `enterSingleMode(activeDatasetIdx)`，切回目前那筆單筆資料後直接繼續執行擬合，省去使用者手動切模式的步驟。
- 2026-05-02 01:29 CST：執行 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/peak_fitting.py` 與 `cd web/frontend && npm run build` 驗證 XPS 擬合自動切回單筆模式；後端語法檢查與前端建置皆通過，僅保留既有 Vite chunk size 警告，未新增錯誤。
