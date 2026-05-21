# Nigiro Pro 協作手冊（精簡版）

最後整理：2026-05-21

> 這份 `CLAUDE.md` 是本專案的短版協作手冊。舊版過長的逐筆流水帳已彙整為「近期重點」與「動作紀錄」，後續請延續這個精簡格式更新。

## 協作規則

- 回答使用者時一律使用繁體中文。
- 每次動作前先讀取本檔案；每次完成工作後，把摘要記錄回本檔案。
- 只修改 `web/` 網頁版；桌面版在獨立 repo：`https://github.com/liupei-wq/Data-Processing-GUI-Desktop`
- 不要修改使用者未要求修改的既有程式。
- Plotly 一律走 `web/frontend/src/components/PlotlyChart.tsx` 兼容層。

## 專案定位

- 主 repo：`https://github.com/liupei-wq/Data-Processing-GUI`
- 線上站：`https://data-processing-gui-web.onrender.com/`
- 維護範圍：`web/` 內的 FastAPI + React/Vite 網頁版

## 技術棧

- 前端：React 18.3 + Vite 8.0 + TypeScript 5.2 + Tailwind CSS 3.4
- 圖表：Plotly.js 2.32 + react-plotly.js 2.6
- 後端：FastAPI 0.111 + Python 3.11
- 科學計算：NumPy 1.26、SciPy 1.12、pandas 2.0、lmfit 1.3
- 部署：Docker 多階段 build → Render / Railway

## 目錄速覽

```text
web/
├── backend/
│   ├── main.py
│   ├── core/
│   ├── db/
│   └── routers/
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── api/
│   │   ├── hooks/
│   │   └── types/
│   └── public/
└── Dockerfile
```

## 常用指令

```bash
# 後端
cd web
uvicorn backend.main:app --reload --port 8000

# 前端
cd web/frontend
npm run dev

# 前端建置
cd web/frontend && npm run build

# 後端語法檢查
python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py
```

## 模組現況

| 模組 | 狀態 | 備註 |
|---|---|---|
| XRD | 穩定 | 含弱峰轉換圖譜匯出 |
| Raman | 穩定 | 含 Si 基板扣除、峰擬合、繪圖輸出 |
| XAS | 穩定且近期變動最多 | 含 Athena、Conduction Band、峰擬合匯入 |
| XPS | 最完整 | Core Level / Valence Band / VBM / 峰擬合功能齊全 |
| XES | 穩定 | 1D 完整，含能量校正與分點扣背 |
| SEM | 未實作 | — |

## 關鍵約定

- XPS x 軸必須維持 `autorange: 'reversed'`
- 高斯面積換算：`area = peak_height × fwhm × 1.0645`
- 優先使用不可變資料，不要直接 mutate 現有 state / dataset
- 每層都要做錯誤處理，不可靜默吞例外
- 輸入驗證放在系統邊界
- Excel 匯入需維持 `.xlsx` / `.xls` 支援，部署端要有 `openpyxl` / `xlrd`

## 近期重點

### XPS

- Valence Band 支援匯入已處理光譜後做 VBM 線性外推。
- VBM 匯出改為 Origin Pro 風格預覽 modal，並支援 TXT 匯出。
- Core Level 在背景扣除後新增「有效數據範圍」步驟。
- 峰擬合支援 Center / FWHM 固定值或範圍限制。

### XAS

- 新增 `Conduction Band` 模式，可做 CBM 線性外推與 TXT 匯出。
- 峰擬合支援匯入已處理光譜資料來源。
- Athena 模式支援微調、手動刪峰 / 加回、Plotly 拖曳區間與最終結果圖。
- XAS 欄位對應改為明確的使用者選擇流程。

### XES

- 新增能量校正檔匯入與 calibrated CSV 匯出。
- 分點扣背改為支援 `measurement_order / total_measurements` 權重。
- 修正 process 500 與歸一化參數錯接問題。

### 繪製圖檔 / 工具

- Raman 疊圖支援參考峰資料庫、標籤位置控制與更多匯出。
- XAS 分頁新增 XES/XAS band gap overlay、VBM/CBM/Eg 標註控制。
- Single Process Tool 的高斯模板扣除 CSV 匯出已改為前端即時計算值。

## 驗證慣例

- 前端改動優先跑：`cd web/frontend && npm run build`
- 後端改動優先跑：`python3 -m py_compile ...`
- 送出前至少確認：`git diff --check`
- 若環境缺少 `npm` / `node`，在紀錄中明確註明「未能執行 build」

## 維護方式

- 這份檔案只保留：
  - 固定專案規則
  - 目前仍有效的重要狀態
  - 近期 1～2 週內的重要功能變更
  - 精簡版動作紀錄
- 太細的逐步操作、重複檢查過程、同步細節，不要無限累積；請改寫成 1～3 行摘要。

## 精簡動作紀錄

### 2026-05-22

- Athena 入口位置修正：右側 workspace launcher 的分析模組區恢復 `XAS Athena 處理` 快捷鍵；首頁左上品牌卡片下方的 `ModuleTabs` 改為隱藏 `Athena`，保留 `Raman / XRD / XPS / XAS / XES`；驗證 `cd web/frontend && npm run build` 通過。
- 合併 `Nigiro Pro Design System` 主介面樣式：不新增獨立展示頁，直接把 design system 的殼層語言套回現有前端；`ModuleTopBar` 改為首顆 chip 內嵌標題列、空狀態改為玻璃內卡、`info-card / module-tab / upload-zone` 補上更明顯的玻璃卡片感與 hover；驗證 `cd web/frontend && npm run build` 通過。
- 持續合併 `Nigiro Pro Design System` 主介面樣式：進一步強化 `workspace surface / workspace launcher / sidebar header / module tabs / workspace stage card / theme dock` 的玻璃殼層與高光表現，加入更明顯的網格場域、頂部高光、active 導引條與 launcher tab 光澤；驗證 `cd web/frontend && npm run build` 通過，`git diff --check` 只有既有 LF/CRLF 警告。
- 持續合併 `Nigiro Pro Design System` 主介面樣式：把共用 `theme-block / theme-block-soft / theme-input / sidebar-stage-card / plot-popup / FileUpload` 再往同一套視覺統一，補上卡面高光、輸入框景深、upload format chips 與彈出圖表玻璃層次；驗證 `cd web/frontend && npm run build` 通過，`git diff --check` 只有既有 LF/CRLF 警告。
- 持續合併 `Nigiro Pro Design System` 主介面樣式：新增共用 `analysis-section-card / analysis-metric-card / analysis-subcard / analysis-table-wrap / analysis-data-table`，並套用到 `XAS / XPS` 內容層的大卡片、結果表、匯出區與 VBM/CBM 預覽資訊卡，讓分析結果區也跟外層 shell 使用同一套玻璃卡與表格語言；驗證 `cd web/frontend && npm run build` 通過，`git diff --check` 只有既有 LF/CRLF 警告。
- 持續合併 `Nigiro Pro Design System` 主介面樣式：將 `XRD` 的流程結果卡、弱峰分析、參考峰比對、匯出區，以及 `Raman` 的峰候選表、峰擬合結果區、校正摘要、group diagnostics 與編輯 modal 一起切換到共用 `analysis-*` 卡片/表格語言，讓主要分析頁內容層視覺一致；驗證 `cd web/frontend && npm run build` 通過，`git diff --check` 只有既有 LF/CRLF 警告。

- 持續合併 `Nigiro Pro Design System` 主介面樣式：將 `XES` 的主圖、BG 比較圖、偵測峰表、參考峰表、band alignment 結果與匯出區切換到共用 `analysis-*` 卡片/表格語言，並同步把 `SingleProcessTool` 的側欄控制卡、空狀態與匯出預覽 modal 改成相同的玻璃卡層次；驗證 `cd web/frontend && npm run build` 成功，`git diff --check` 仍只有既有 LF/CRLF 警告。
- 持續合併 `Nigiro Pro Design System` 主介面樣式：補收尾 `PlotFileTool`、`XPS` overlay/periodic modal、`Raman` 圖表結果卡、`XRD` / `Raman` 頁首統計卡，以及 `XAS` / `XES` 側欄折疊卡的共用玻璃卡語言，將一批重複的舊 `rounded-2xl + card-bg` 卡片改為 `analysis-section-card / analysis-metric-card / analysis-subcard`；驗證 `cd web/frontend && npm run build` 成功，`git diff --check` 仍只有既有 LF/CRLF 警告。
### 2026-05-21（續）

- 左上 workspace launcher 微調：移除分析模組區裡額外插在 XAS 後面的 `XAS Athena 處理` 快捷鍵；保留 `Raman / XRD / XPS / XAS / XES` 與 Athena 頁面本體；驗證 `cd web/frontend && npm run build` 通過。
- XAS 峰擬合結果圖卡新增「放大選定範圍」按鈕：會鎖定到最後一次執行擬合時的 range snapshot，結果圖 x 軸切到選定區間、y 軸依區間內原始/總擬合/殘差/各峰自動重算；保留「顯示/隱藏擬合範圍」覆蓋層；驗證 `cd web/frontend && npm run build` 通過。
- XAS 峰擬合結果圖卡微調：將「放大選定範圍」按鈕從左下匯出列移到結果表格上方、靠近「峰名稱」區；驗證 `cd web/frontend && npm run build` 通過。
- XAS 左側「擬合範圍」卡片視覺強化：啟用 range mode 時整張卡改為高亮背景、亮邊框與較明顯的提示文字，不再只靠右上角小型「已啟用」標籤辨識；驗證 `cd web/frontend && npm run build` 通過。
- SingleProcessTool 切到最低點全面重設計（branch: `feature/snap-drag-mode`）：移除舊版一次性對齊與持續綁定邏輯；改為三步驟對齊模式：①設定搜尋範圍→確定→②生成高斯曲線（以最低點為初始中心/高度，FWHM=x範圍×5%）→③圖中按住拖動微調中心（透明 overlay 攔截 mousedown/mousemove/mouseup）；snap 啟用時所有高斯模板輸入/滑桿 disabled；中心可超出搜尋範圍 ±50%；beforeTraces 最低點紅點僅在 minimum_found 階段顯示；beforeLayout 範圍標記僅在 minimum_found 階段且從 confirmedSnapRange 取值；build 驗證通過（0 TypeScript 錯誤）。
- XAS 擬合範圍修正：將擬合預覽圖的 traces/layout 從 JSX IIFE 改為 useMemo（加入 `uirevision: 'fit-preview'`），修正拖動 DualRangeInput 時範圍框框消失的問題；sidebar 擬合範圍區塊新增手動起點/終點數值輸入欄（eV）。

### 2026-05-21

- 清除：已刪除 `C:\Users\peili\.codex\archived_sessions` 內全部封存聊天，並同步清掉 `session_index.jsonl` / `history.jsonl` 對應封存 session id；未動 active sessions。
- 整理：將舊版 `CLAUDE.md` 從大型流水帳重構為精簡版協作手冊，保留核心規則、模組現況、近期重點與短版紀錄；`AGENTS.md` 也同步改成同樣的短版摘要結構。
- XPS：Valence Band 支援匯入已處理光譜做 VBM；新增 VBM 匯出預覽 modal、TXT 匯出、有效數據範圍步驟，以及峰擬合 Center / FWHM 固定值或範圍限制。
- XAS：新增 `Conduction Band` 模式與 CBM 線性外推；峰擬合支援匯入已處理光譜。
- SingleProcessTool 高斯模板改版：移除多峰支援，改為單峰架構；左側 sidebar 改為純數值輸入（中心位置/半高寬/峰高度/面積唯讀）、下載高斯曲線 CSV 按鈕、匯入插值資料 file picker；中間圖加入橫向中心 slider、橫向 FWHM slider（顯示 center±FWHM/2 邊界）、縱向高度 slider；圖上新增橘色中心/FWHM 邊界虛線、藍色高度水平線、FWHM bracket 標示；支援從外部 CSV/TXT 直接匯入插值資料（不需後端處理）；驗證 `cd web/frontend && npm run build` 通過。

### 2026-05-20

- Single Process Tool：修正高斯模板扣除 CSV 匯出與非負保護問題，並將匯出入口改為各圖卡底部。
- XAS：移除高斯模板扣除步驟，重新整理步驟編號，並在歸一化圖卡加入 TEY / TFY 匯出。

### 2026-05-15 至 2026-05-19

- XAS Athena：完成微調、手動刪峰 / 加回、拖曳區間、最終結果圖、OriginPro 匯出與欄位對應流程整理。
- XPS / XAS：峰擬合加入自動收斂、重設峰、收斂歷史與更穩定的 seed 回寫流程。
- XES：完成能量校正、分點扣背權重、process 500 補強與歸一化修正。
- PlotFileTool：完成 Raman 參考峰疊圖增強與 XAS/XES band gap 圖功能。
