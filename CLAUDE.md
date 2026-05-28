# Nigiro Pro 協作手冊（精簡版）

- 2026-05-27：協助修復本地前端啟動時的 `@dnd-kit` import 失敗。確認 `web/frontend/package.json` 與 `package-lock.json` 已宣告 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`，但使用者本地 `node_modules` 缺少實際套件目錄，導致 Vite 報 `[plugin:vite:import-analysis] Failed to resolve import "@dnd-kit/core"`。在 `web/frontend` 以提升權限執行 `npm install @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2` 後，`npm run build` 已恢復通過；`git diff --check` 通過。建置僅剩既有 chunk size warning，非錯誤。

- 2026-05-27：調整 `Single Process Tool` 單一處理右側選單。`web/frontend/src/pages/SingleProcessTool.tsx` 新增 `arctan` 工具型別與前端即時計算 `Arctan 扣除` 流程，比照高斯模板扣除提供兩張圖卡（原始+模型、扣除後）與 3 個主參數：中心位置、轉折寬度、高度；共用既有非負值保護。同步把高斯模板區的「匯入高斯曲線資料」改為較中性的「匯入外部模板曲線」，並把 CSV 匯出欄位補上 `arctan_model` / `arctan_subtracted`。`web/frontend/src/App.tsx` 新增 `tool-arctan` 工作區入口。驗證：`git diff --check` 通過；`cd web/frontend && npm run build` 仍被專案既有缺件卡住，錯誤為 `@dnd-kit/core` / `@dnd-kit/sortable` 缺模組與既有 `implicit any`，非本次修改新引入。

- 2026-05-27：重作先前遺失的導引式左側步驟流程。新增共用 `GuidedSidebarSection` 到 `web/frontend/src/components/WorkspaceUi.tsx`，支援狀態點、受控展開/收合、說明彈窗，以及 `onOpenChange`。XPS、XAS、XES 改接此共用元件；XPS/XAS/XES 的 Step 1 在首次載入資料後會自動收合並打開 Step 2，並依各分析步驟狀態顯示 on/off/locked。驗證：`npm run build` 通過，`git diff --check` 僅有既有 LF/CRLF 轉換提示；本機瀏覽器工具回報 `iab` 不可用，未做視覺截圖驗證。

最後整理：2026-05-24

> 這份 `CLAUDE.md` 是本專案的短版協作手冊。請只保留仍有效的規則、重要狀態、近期 1～2 週的功能摘要與精簡動作紀錄；避免重新累積逐步流水帳。

## 協作規則

- 回答使用者時一律使用繁體中文。
- 每一次動作前先讀取本檔案。
- 每一次實作、檢查、重啟、重要判斷，都要記錄在本檔案。
- 不要回復或覆蓋使用者未要求修改的既有變更。
- 只修改 `web/` 網頁版；桌面版在獨立 repo：`https://github.com/liupei-wq/Data-Processing-GUI-Desktop`
- Plotly 一律走 `web/frontend/src/components/PlotlyChart.tsx` 兼容層。
- 目前 PowerShell profile 可能出現執行原則警告，通常不影響指令結果。
- 畫任何數據圖的疊圖時，顏色設定須固定為：
  - `50-0`：藍色 `#136DE4`
  - `45-5`：紅色 `#E42213`
  - `40-10`：黑色 `#252526`

## 專案定位

- 主 repo：`https://github.com/liupei-wq/Data-Processing-GUI`
- 線上站：`https://data-processing-gui-web.onrender.com/`
- 維護範圍：`web/` 內的 FastAPI + React/Vite 網頁版
- DFT 子專案：`Ga2O3_VB_Analyzer/`，以 Streamlit 承載 XPS Valence Band / DFT-informed 分析流程

## 技術棧

- 前端：React 18.3 + Vite 8.0 + TypeScript 5.2 + Tailwind CSS 3.4
- 圖表：Plotly.js 2.32 + react-plotly.js 2.6
- 後端：FastAPI 0.111 + Python 3.11
- 科學計算：NumPy 1.26、SciPy 1.12、pandas 2.0、lmfit 1.3
- DFT / pDOS：Streamlit、mp-api、pymatgen
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

Ga2O3_VB_Analyzer/
├── app.py
├── requirements.txt
├── src/
└── example_data/
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

# DFT Streamlit
cd Ga2O3_VB_Analyzer
streamlit run app.py --server.port 8505
```

## 模組現況

| 模組 | 狀態 | 備註 |
|---|---|---|
| XRD | 穩定，近期大幅重構 | 已回歸桌面版純淨 7 步驟前端本地計算流程，含參考峰標記與匯出 |
| Raman | 穩定 | 含 Si 基板扣除、峰擬合、參考峰資料庫與繪圖輸出 |
| XAS | 穩定且近期變動多 | 含 Athena、Conduction Band、峰擬合匯入、Band Gap overlay |
| XPS | 最完整，近期新增 DFT 入口 | Core Level / Valence Band / VBM / 峰擬合 / DFT Streamlit 入口 |
| XES | 穩定 | 1D 完整，近期簡化背景扣除與移除參考峰 / 峰值偵測 UI |
| Single Process Tool | 穩定 | 高斯模板扣除、最低點 snap-drag 對齊與 CSV 匯出 |
| SEM | 未實作 | - |

## 關鍵約定

- XPS x 軸必須維持 `autorange: 'reversed'`。
- 高斯面積換算：`area = peak_height × fwhm × 1.0645`。
- 優先使用不可變資料，不要直接 mutate 現有 state / dataset。
- 每層都要做錯誤處理，不可靜默吞例外。
- 輸入驗證放在系統邊界。
- Excel 匯入需維持 `.xlsx` / `.xls` 支援，部署端要有 `openpyxl` / `xlrd`。
- XAS / XES band gap 線性外推需對齊 XPS VBM 的 tangent / baseline 候選點邏輯。
- PlotFileTool XPS 疊圖的 X offset 是「每筆 fit spectra 的 X 軸位移」，不是裁切範圍。

## 近期重點

### XPS

- Valence Band 支援匯入已處理光譜後做 VBM 線性外推。
- VBM 匯出改為 Origin Pro 風格預覽 modal，並支援 TXT 匯出。
- Core Level 在背景扣除後新增「有效數據範圍」步驟。
- 峰擬合支援 Center / FWHM 固定值或範圍限制。
- 新增 DFT 模式入口，密碼解鎖後可連到 `Ga2O3_VB_Analyzer` Streamlit 分析工具。

### XAS

- 新增 `Conduction Band` 模式，可做 CBM 線性外推與 TXT 匯出。
- 峰擬合支援匯入已處理光譜資料來源。
- Athena 模式支援微調、手動刪峰 / 加回、Plotly 拖曳區間與最終結果圖。
- XAS 欄位對應改為明確的使用者選擇流程。
- Band gap 線性外推邏輯已對齊 XPS VBM。

### XRD

- 頁面已改回桌面版純淨 7 步驟流程：上傳、`x_shift`、歸一化、訊號轉換、偏移疊加、參考峰、匯出。
- 移除複雜自定義化合物 modal，回到左側步驟欄直接勾選參考峰。
- 內建參考峰資料庫擴充常用化合物：β-Ga2O3、Si、NiO、Ti3CN、Mo2Ti2C3、TiO2 Anatase/Rutile、ZnO。
- 匯出使用 Origin Pro 風格預覽 modal，並支援 PNG / CSV。

### XES

- 新增能量校正檔匯入與 calibrated CSV 匯出。
- 背景扣除已簡化為單一背景檔案流程。
- 移除平滑、參考峰與峰值偵測 UI，保留主要 1D 分析流程。
- 修正 process 500 與歸一化參數錯接問題。

### 繪製圖檔 / 工具

- Raman 疊圖支援參考峰資料庫、標籤位置控制與更多匯出。
- PlotFileTool 新增 XES/XAS band gap overlay、VBM/CBM/Eg 標註控制。
- PlotFileTool XAS 左側調整欄已改為獨立捲動，避免調整數值時中央圖表位移。
- PlotFileTool XPS 疊圖支援每筆 fit spectra 的 X offset，並可對齊共同 Binding Energy grid 匯出 CSV。
- Single Process Tool 的高斯模板扣除 CSV 匯出已改為前端即時計算值。

### DFT Streamlit

- `Ga2O3_VB_Analyzer` 已建立為獨立 Streamlit 子專案。
- 已包含 app、分析模組、README、requirements、example_data 與 `.gitignore`。
- pDOS reference acquisition 支援三種來源：使用者 CSV、Materials Project / pymatgen、digitized literature pDOS。
- Materials Project 依賴 `mp_api` / `pymatgen` 已驗證可載入。

## 驗證慣例

- 前端改動優先跑：`cd web/frontend && npm run build`
- 後端改動優先跑：`python3 -m py_compile ...`
- DFT Streamlit 改動優先跑：`uv run python -m py_compile Ga2O3_VB_Analyzer/app.py Ga2O3_VB_Analyzer/src/*.py`
- 送出前至少確認：`git diff --check`
- 若環境缺少 `npm` / `node`，在紀錄中明確註明「未能執行 build」。

## 精簡動作紀錄

### 2026-05-29

- 重要判斷：使用者要求「繪製圖檔」XAS 區上傳數據時不要強制歸一化；檢查後確認 `PlotFileTool.tsx` 的上傳解析保留 raw y，但 XES/XAS band gap 結果生成會固定套用最大值歸一化，需改成預設保留原始強度並把歸一化變成手動選項。
- 實作：`web/frontend/src/pages/PlotFileTool.tsx` 的 XES/XAS band gap 外推改為預設保留上傳檔案原始強度；新增 `normalizeIntensity` 圖面設定與「最大值歸一化」checkbox，只有勾選時才做 max=1 歸一化。同步把預設 Y 軸標題改為 `Intensity (a.u.)`，歸一化開啟時顯示 `Normalized intensity (a.u.)`，且原始強度模式下會依每個 panel 的實際強度自動撐開 Y 軸上限。
- 實作：`PlotFileTool` 的 XES/XAS band gap 圖面設定新增手動 Y 軸範圍；加入 `yMin` 與 `manualYRange` 設定，預設仍自動依數據撐開 Y 軸，開啟「手動 Y 範圍」時才固定使用使用者輸入的 Y 下限 / Y 上限，並同步調整 Eg 線、VBM/CBM/Eg 標註與垂直形狀的 Y 位置。
- 檢查：嘗試執行 `web/frontend` 的 `npm run build`，但目前 shell 找不到 `npm` / `node`，未能執行前端建置；改以 `git diff --check` 驗證通過，僅有既有 LF/CRLF 提醒。同步以 `rg` 確認 XES/XAS band gap 只剩手動 `normalizeIntensity` 路徑會觸發歸一化。
- 檢查：完成手動 Y 軸範圍後再次確認目前 shell 的 `node` / `npm` 皆為 NOT_FOUND，因此仍無法執行前端 build；`git diff --check` 通過，工作區變更範圍限於 `CLAUDE.md` 與 `web/frontend/src/pages/PlotFileTool.tsx`，僅有既有 LF/CRLF 提醒。
- 重要判斷：使用者截圖顯示 XES/XAS band gap 圖的自動 Y 軸會被數值最大值、外推輔助線或遠端高值牽動，導致主要光譜沒有落在正常視覺範圍；決定自動範圍改以實際顯示光譜的穩健百分位數估算，手動 Y 範圍仍維持最高優先權。
- 實作：`PlotFileTool.tsx` 新增 `percentileValue` 與 `resolveXasBandAutoYRange`，XES/XAS band gap 自動 Y 軸只採用顯示中的 XES/XAS 主光譜曲線估算，排除 tangent/baseline 外推輔助線與 edgeY 對 range 的牽制；raw 強度模式也不再強制套用 0.3 或預設 yMax 作為上限，避免資料因配合極值而被壓扁。
- 檢查：完成 XES/XAS band gap 自動 Y 軸範圍修正後，`git diff --check` 通過且變更範圍仍限於 `CLAUDE.md` 與 `PlotFileTool.tsx`；目前 shell 仍找不到 `node` / `npm`，未能執行前端 build，僅有既有 LF/CRLF 提醒。

### 2026-05-27（續）

- XPS 背景扣除與歸一化「啟用即套用」改為「請先選擇方法」：使用者反映「啟動後直接套用裡面的方法，後續切換方法時可能會有 bug」。改動：① 新增 `bgMethodAwaiting`、`normMethodAwaiting` 兩個 state；② 包裝 `handleBgEnabledToggle`（toggle ON 只設 awaiting=true、不動 `bg_enabled`；OFF 才真的關）+ `handlePickBgMethod`（使用者真的從下拉選方法時，才 set `bg_method` + `bg_enabled=true`）；歸一化同樣加 `handlePickNormMethod`、改寫 `setNormalizationEnabled`（之前會自動套用 ref 最後一次方法）。③ UI：TogglePill 視 `enabled || awaiting` 為 checked；方法下拉在 awaiting 時值為 `''` 並多一個首選項 `— 請先選擇方法 —`；起始/結束 BE、多項式次數、Tougaard B/C、norm 區間滑桿等其他欄位都改為「實際選好方法後才出現」，未選方法時改為虛線提示卡。這樣使用者按 Toggle 開啟後不會直接觸發某個 default 方法的處理流程，徹底解掉「方法切換時跳跳」的根因。後端演算法本身（Linear / Tougaard / Polynomial / AsLS / airPLS）尚未動，等使用者確認 UX 後再針對最常用的方法做穩定性優化。前端 `npm run build` 通過 0 錯誤。

- 「論文風格」更名為「📄 標記點視圖 (Markers View)」：使用者反映 label 太口語化，換成 CasaXPS 等專業軟體的標準用詞「Markers View」。涉及 5 處按鈕 label、5 處 `title` hover 提示、5 處卡內描述段落（4338/4339、4502、4619、4746、4818），描述也把「散點」改為「標記點」、「符合 paper 中常見的表示方式」改為「期刊圖說常見格式」。背景扣除 / 歸一化 / 峰擬合 三類卡片共 5 個按鈕全部統一。前端 `npm run build` 通過 0 錯誤。

- 「📄 論文風格」toggle 擴大套用到 XPS 歸一化與峰擬合卡：① 新增 `normPaperMode` 與 `fitPaperMode` state；② 修改 `buildFitTraces(dataset, fitResult, paletteKey, paperMode=false)` 新增第四個參數，paperMode 時把擬合輸入由 line 改為 markers + 主擬合/組件線寬略加粗（殘差仍 dot 線），其他擬合計算完全不變；③ 新增 `buildOverlayNormPaperTraces`（多檔：對應 input 散點 yaxis='y2' + output 實線）；single 模式則直接從既有 `normalizationChartTraces` 取出歸一化前/後兩條 traces inline 轉換為散點+線；④ overlay 歸一化、single 歸一化、峰擬合三張卡都加上「📄 論文風格」toggle 按鈕（位置：右卡標題列、放在 PairCardChromeButtons 旁邊；峰擬合卡在標題與描述之間）；⑤ 論文風格切換為純視覺，不影響擬合計算或歸一化處理流程，使用者切過去後總擬合 / 各峰組件 / 殘差 / 參數表全部保持原狀。前端 `npm run build` 通過 0 錯誤。

- XPS 能量校正二次確認 modal + Valence Band 模式精簡步驟：
  ① 能量校正：新增 `calibrationConfirmOpen` state 與 `requestAutoCalibration` 包裝。第一次按「計算偏移並套用」直接執行；已成功一次後（`calibrationResult?.success`）再按 → 彈確認 modal 提示「再次校正會把偏移量累加」，按鈕文字也會從「計算偏移並套用」改成「再次校正 (累加偏移)」，避免使用者誤連按造成 BE 校正過頭。
  ② Valence Band 模式步驟精簡：根據使用者「VB 只留下內插/能量校正/有效範圍/歸一化/VBM 外推/能帶偏移」要求，在 `XPS.tsx` 中：背景扣除（原 step 4）與峰擬合（原 step 7）以 `xpsMode !== 'valence_band'` 包住整段隱藏；有效數據範圍（原 step 5 → VB step 4）、歸一化（原 step 6 → VB step 5）、VBM 線性外推（原 step 8 → VB step 6）、能帶偏移（原 step 9 → VB step 7）改為條件 step number `step={xpsMode === 'valence_band' ? X : Y}`。Core Level 模式維持原來的 step 編號 1~9。
  前端 `npm run build` 通過 0 錯誤。

### 2026-05-27（重做）

- 盤點先前工作：使用者反映「歸一化沒有像背景扣除一樣有左右拖拉伸縮」。檢查後確認 v33.9 的 GuidedSidebarSection 重構意外砍掉了：① 共用元件 `web/frontend/src/components/SortableCardGrid.tsx`；② XPS.tsx 中 4 對 sortable pair cards 的接線。**XRD 完整保留**（XRD 用內部 dnd-kit 沒透過共用元件、未受影響：beautify Step 8、exportPreview 統一預覽、refMarkerLabelSize、5 分類側欄、衍生計算 Step 9~11、Tier 1 演算法、offset useEffect、漸進式引導等全在）。**XES/XAS 其他特性**（VBM 線性外推、Conduction Band 等）也都在。
- 重建 `SortableCardGrid.tsx` 共用元件（功能等同先前版本：items array、可選 storageKey、selectedId 受控、render prop ctx 含 attributes/listeners/activatorRef/wide/onToggleWide/sortingGhost/overlay，內部 dnd-kit + DragOverlay + 半透明 ghost + 拖曳取消還原）。
- 重新把 XPS 4 對「左右並排對卡」接上 `SortableCardGrid`：① overlay 背景扣除（含論文風格 toggle）② overlay 歸一化 ③ single 背景扣除（含論文風格 toggle）④ single 歸一化。每對用 `items={PAIR_ITEMS}` 與獨立 `storageKey` (`xps-pair-bg-overlay / xps-pair-norm-overlay / xps-pair-bg-single / xps-pair-norm-single`)。每張卡新增右上角 `⤡/⤢ 拉寬 + ↕ 拖曳手柄`（`PairCardChromeButtons` 共用 helper），左卡透過 `ChartToolbar.actions` slot 注入、右卡直接放在原本的標題列 flex 內（論文風格 toggle 旁邊）。前端 `npm run build` 通過 0 錯誤。

### 2026-05-22（重建）

- 由於使用者誤刪檔案、先前改動消失，依對話紀錄全部重做 XPS 背景扣除 / 歸一化 / 最終光譜卡片相關改動：
  1. **`buildMainTraces`** 新增 `showProcessed: boolean = true` 參數，並在 `renderFinalChart` 內強制傳入 `true` 避免空圖 bug。
  2. **`buildOverlayBackgroundTracesWithSeriesColors`** 新增 `showAfter: boolean = true` 參數。
  3. 新增兩個 helper：`buildSinglePaperStyleTraces`、`buildOverlayPaperStyleTraces`（原始光譜散點 + Shirley 基線實線，符合 paper 慣用呈現）。
  4. 新增 `bgPaperMode` state。
  5. **背景扣除步驟（single / overlay 兩模式）** 改為「左右並排」：左卡顯示原始 + Shirley 基線（保留線色與 SeriesColorControls），右卡顯示扣背景後乾淨光譜；右卡右上角有 `📄 論文風格` toggle，啟用後切換為散點 + 實線基線。範圍滑桿與 CSV 匯出移到右卡底部（兩卡共用同一條背景區間 state）。標題統一為「背景扣除」，右卡移除重複的線色選擇器（與左卡同步顯示反而誤導）。
  6. **歸一化步驟（single / overlay 兩模式）** 同樣改為「左右並排」：左卡顯示歸一化前（保留線色與 SeriesColorControls），右卡顯示歸一化後。範圍滑桿與 CSV 匯出移到右卡底部。標題統一為「歸一化」，右卡移除重複線色選擇器。
  7. **最終處理光譜圖卡** 整段刪除（各階段卡片已能各自輸出 paper 圖）。保留 `renderFinalChart` 與 `openFinalChartPopup` 函式定義（避免破壞他處引用）。
- 因 `node_modules` 隨檔案被刪一併消失，重跑 `npm install` 後 `npm run build` 順利通過 0 TypeScript 錯誤。

### 2026-05-24

- 解決 Git 合併衝突並完成 Merge：順利處理 `CLAUDE.md` 的三路合併衝突。在確認內容完整且無衝突標記後，將其加入暫存並執行 `git commit`，成功提交了 "Merge branch 'main' of https://github.com/liupei-wq/Data-Processing-GUI" 合併 commit，使當前工作區狀態完全恢復乾淨。

- XRD 匯出流程統一預覽 + 美化卡資料源選擇 + 參考峰標籤可調字體：四件事一起做。① **匯出統一預覽**：新增 `exportPreview` state（kind: 'png' | 'text'）與 `previewPng / previewText / confirmExportDownload` helpers；舊 `showExportPreview` 整段 Origin Pro 風格 modal 移除，改為 generic ExportPreviewModal（PNG 顯示 dataURL 圖；CSV/TXT 顯示前 18 行 + 總行數）。主圖卡與美化卡所有匯出按鈕（PNG / CSV / TXT）一律走預覽，使用者按「⬇ 確定下載」才真正下載。② **主圖卡新增 PNG/TXT**：原本只有 CSV（走舊預覽），現在 offset/overlay 模式下加入 `📷 匯出 PNG`、`📥 CSV`、`📄 TXT (Tab)` 三顆 + 既有的 `📋 峰位偏移報告 (TXT)`；單筆模式因每張卡獨立、PNG 暫不提供（請用美化卡），CSV/TXT 仍可用。主圖 `Plot` 新增 `onInitialized/onUpdate` 將 graphDiv 存入 `mainGraphDivRef`。③ **美化卡資料源**：新增 `beautifySourceMode` state 與資料源 dropdown（「跟隨主圖」或直接挑某個 rawFile 單筆呈現），覆寫 `beautifyEffective` 解析、`beautifyTraces` 與 `beautifyLayout` 使用此選擇。④ **參考峰 (hkl) 字體可調**：新增 `refMarkerLabelSize` state（預設 11pt，原寫死 9pt），Step 6 開啟「顯示參考峰」後出現一個 7~24 pt 的 slider；同步加入 `buildChartTraces` useCallback deps。前端 `npm run build` 通過 0 錯誤。

- XRD 衍生計算工具順序依物理依賴鏈重排：依使用者反饋「目前步驟邏輯有問題」，重新對齊到 XRD 教科書自然順序 → Step 9 d-spacing (Bragg，最基本)、Step 10 FWHM 計算 (純測量)、Step 11 晶粒尺寸 D (Scherrer，需要 FWHM 作 β)。同步調整 sidebar 三個 Section 的 step 編號 + title hint，以及中間欄 3 張計算卡的渲染順序。功能本身無變動，只是視覺與編號重排。前端 `npm run build` 通過 0 錯誤。

- XRD 新增「衍生計算工具」分類（Step 9/10/11）與 3 張獨立計算卡：① 側欄新增分組標籤「🧮 衍生計算工具」，含 Step 9 FWHM 計算、Step 10 晶粒尺寸 D (Scherrer)、Step 11 d-spacing (Bragg)；每個 Step 只放一個 toggle 與說明，控件全在中間欄計算卡內。② 新增 `calcFwhmFromTrace`（左右走找半高交點＋線性內插）、`calcScherrerD`（D=K·λ/(β·cosθ)）、`calcDSpacing`（d=λ/(2sinθ)）三個 helper。③ 新增 `CalcCardShell` 通用元件處理 source picker（imported + 主流程光譜共用 dropdown）、單檔匯入按鈕（每卡獨立，比照 XPS Valence Band 模式）、自動偵測峰下拉（findLocalPeaks 5% 門檻取前 30）、Plotly 圖（高亮選定峰 + FWHM 範圍 overlay）、結果格子 `ResultCell`、匯出按鈕列（左下對齊既有規範）；以及 `CalcEmptyHint`、`CalcQuickPreset (Cu Kα 預設)`。④ 各卡片獨立匯出 CSV / TXT (Tab 分隔)，**檔名各自分離**（XRD_FWHM_/XRD_Scherrer_/XRD_dspacing_ + timestamp）。⑤ Scherrer 卡允許「β 自動量自選峰」或「手動 override」雙模式。前端 `npm run build` 通過 0 錯誤。

- XRD 峰位偏移比對 Tier 1 演算法升級：① `findLocalPeaks` 加入 SciPy 式 prominence 篩選（門檻 = global max × 0.5%）與拋物線細修（quadratic refinement，以 i-1/i/i+1 三點擬合二次曲線求頂點），達到「擋雜訊假峰 + 亞取樣峰位精度」雙重提升；新增 `computeProminence` helper。② `peakOffsetReport` 從原本「對每個 observed 各自找最近 ref」的多對一貪心配對，改成「列出所有容忍度內 (observed, ref) 候選對 → 按 \|Δ\| 升序 → 1:1 互斥貪心配對」，徹底解決同一個 ref 被多個 observed 重複指到的 bug。③ 移除寫死的 top-10 截斷限制（現在所有通過 prominence 的峰都會進入候選池）。UI 未動。前端 `npm run build` 通過 0 錯誤。

- XRD 側欄分區重洗（5 分類）與漸進式引導（策略 A + B）：① 分類重整為 📊 數據準備與校正（Step 1）、🎨 顯示與外觀（顯示模式 + Step 5）、⚡ 訊號變換與前處理（Step 2/3/4，Step 2 從原本「數據準備」改入此分類）、🔬 物相比對與峰位分析（Step 6/7）、📐 圖表輸出與美化（Step 8）。② `Section` 元件擴充支援 `status: 'on' \| 'off' \| 'locked'`（右上角小狀態點：綠 ●＝已啟用、空圈 ○＝預設未啟、灰 ◌＝前置條件未到 + opacity 0.5），以及 `open`/`onOpenChange` 受控介面。③ 漸進式引導：除 Step 1 預設展開外，所有 Section 預設 collapsed；當 `rawFiles.length` 由 0 → ≥1 時透過 `useEffect + hasTriggeredFirstUploadRef` 自動 collapse Step 1、open Step 5。④ 新增 `Advanced` 小元件做 Step 內部二層進階折疊；套用於 Step 7 的「偏移比對容忍度」、美化卡 B/C/D 群組（A 軸設定保持外露為首推控件）。前端 `npm run build` 通過 0 錯誤。

- XRD 新增「圖表美化與匯出」步驟與美化預覽圖卡（Step 8）：依使用者規格實作 Beautify & Export 流程。① 側欄新增分組標籤「📐 圖表輸出與美化」與 Step 8 toggle，啟用後中間欄底部會出現一張全寬「📐 美化預覽（出報告用）」圖卡。② 美化卡內含完整組控件（A 軸：X/Y tick 數字開關、tick 數量、軸標題文字、X/Y grid 開關；B 字體：軸刻度/軸標題/圖例三組獨立字級；C：線寬倍率 slider、背景白/透明/深、圖例位置 5 種；D：PNG 寬高與縮放倍率）。③ 三顆匯出按鈕：PNG（用 `PlotlyApi.toImage` 所見即所得，含美化參數）、CSV（純數據逗號分隔）、TXT（純數據 Tab 分隔，Origin Pro 標準）。④ 美化卡資料源跟隨主圖 viewMode（Offset/疊圖/單筆同步）。⑤ 在 `web/frontend/src/components/PlotlyChart.tsx` 已有 `PlotlyApi` export 可直接呼叫 `toImage`；用 `onInitialized/onUpdate` 將 graphDiv 存入 `beautifyGraphDivRef`。前端 `npm run build` 通過 0 錯誤。

- XRD 疊圖外觀設定上移與歸一化 bug 修正：① 把 Step 5「疊圖外觀設定」整段 JSX 從原本位置移到 Step 2「X 軸偏移微調」前面（step 編號保留為 5，未強制重編號）。② 歸一化邏輯原本用「1%~99.7% 百分位 Min-Max」（為了去噪），但 XRD 銳峰本身就是訊號，會被 99.7 percentile 裁掉、歸一化後峰值會 >1（與 UI 上「啟用 0~1 Min-Max 歸一化」的承諾不符）。改為使用嚴格 actual `Math.min`/`Math.max`，最大值保證為 1、最小值為 0；Step 4 內的說明文字同步更新。前端 `npm run build` 通過 0 錯誤。

- XRD Offset 模式 stackGap 自動分配修正：原本 `handleFilesUpload` 在上傳時硬寫死用 `log10(y)` 估算最大值來算 stackGap，但實際 yProcessed 走的是當前 `transformMode`／`normalizeCurves`。當使用者沒開 log（如原始 counts 峰值 ~150k），算出來的 offset 只有 3.6~7.2，加在 150k 峰上看不出來、三條曲線變成幾乎完全疊在一起。改法：把上傳當下的 offset 計算邏輯移除（只保留 `setViewMode('offset')`），改為新增一個 `useEffect`（搭配 `lastAutoStackKeyRef`）在 `processedTraces` 算好後、依「檔案集合 + transformMode + normalizeCurves」為 key，當 key 變動時用真實 yProcessed 峰值重新分配 offset。手動編輯單檔 offset 不會被覆蓋（key 不變）；切換 log/sqrt/歸一化會自動重算 offset 以適配新尺度。前端 `npm run build` 通過 0 錯誤。

- XRD 顯示模式擴充為三種：單筆 / Offset / 疊圖，預設 Offset：`web/frontend/src/pages/XRD.tsx` 的 `viewMode` 從 `'single' \| 'overlay'` 擴成 `'single' \| 'offset' \| 'overlay'`，default 改 `'offset'`、多檔上傳也自動切到 offset。`buildChartTraces` / `buildChartLayout` 與 `getReferenceMarkerY` 等內部判斷把「用 yStacked」的條件從 `chartMode === 'overlay'` 改為 `chartMode === 'offset'`，純疊圖模式直接吃 yProcessed（無 offset）。`plotlyTraces` / `plotlyLayout` 把實際 viewMode 傳給 builder。UI：顯示模式 toggle 三顆按鈕、主圖標題依模式切換為「Offset 偏移疊圖比較結果 / 純疊圖比較結果（無 offset）」、Step 5 的「一鍵均勻分配垂直疊加高度」與每檔「Y 疊加偏移」輸入欄只在 offset 模式顯示（純疊圖模式線條設定改單欄寬）、InfoCardGrid 顯示三種模式名稱。CSV 匯出 `_Y_Stacked` 欄改為只在 offset 模式輸出；Origin Pro 匯出預覽 modal 的 yRange 計算同步分流 offset/overlay。前端 `npm run build` 通過 0 錯誤。

- XRD「顯示模式」切換上移並去殼：把 `web/frontend/src/pages/XRD.tsx` 中 Step 5 內的「單筆處理 / 多檔疊圖」切換從 Section 卡內取出，移到 Step 1 與 Step 2 之間，直接以「背景內嵌、小標題 + 右側 toggle」的形式呈現（無 `Section` 卡片殼、無 step 編號），跟分組標籤一致使用 `px-4.5` 與 Mono uppercase 小標題；Step 5 內原本同名區塊一併刪除。前端 `npm run build` 通過 0 錯誤。

- XRD 單筆圖卡寬度狀態改為「跟著卡片走」，排序不再自動改變寬度：依使用者反饋「按拉寬後調整位置 他又會自動變成填滿」，把寬度從 position-based default fallback 改為完全 per-card 的顯式狀態。`web/frontend/src/pages/XRD.tsx` 的 `isSingleCardWide(id, override)` 簡化為純 lookup，移除 `index/total` 參數；rawFiles 變動的 useEffect 只在「卡片首次出現」時用 `isDefaultSingleCardWide(i, length)` 算一次預設（奇數最後一張預設 wide），既有卡片狀態完全保留；`toggleSingleCardWide(id)` 簡化為直接翻轉。效果：上傳 3 檔預設仍是「兩小一大」，但 reorder 後 wide 卡會跟著移動、其它卡不會被牽連縮放，使用者可以自由組出 3 大卡、3 小卡（2+1 並列）、或任意混合版型。前端 `npm run build` 通過 0 錯誤。

- XRD 單筆圖卡寬度切換改為顯式 toggle 按鈕（方案 A，試用版本）：依使用者反饋「大卡變小卡 / 變並排」的拖曳邏輯怪，將「拖曳排序」與「半寬 / 全寬切換」徹底解耦。`web/frontend/src/pages/XRD.tsx` 中：① 把 `singleCardManualWideIds: string[]` 改為 `singleCardWideOverride: Record<string, boolean>`，允許強制 narrow（可覆寫「奇數最後一張預設大卡」），② 移除拖曳手勢觸發版型切換的 `splitSingleCardPairToWide` 與 `getSingleCardLayoutMeta` 啟發式邏輯，③ 每張單筆卡片 toolbar 新增 `⤢ 拉寬 / ⤡ 縮回` 顯式 toggle 按鈕（active 時藍色高亮），點擊只切換該卡寬度、`stopPropagation` 不觸發排序，④ 拖曳 drag handle 純粹用於排序、不再改寬度，⑤ 檔案刪除後 override map 同步清除對應 id。前端 `npm run build` 通過 0 TypeScript 錯誤。屬實驗性改動，使用者試用後若不滿意可整段 revert。

- XRD 單筆圖卡跟手拖曳預覽：依使用者補充需求，將單筆模式拖曳排序從「grid 內原卡半透明」升級為完整圖卡浮動預覽。`web/frontend/src/pages/XRD.tsx` 的 `singleCardDrag` 現在記錄游標座標、抓取偏移與原卡寬高；拖曳時 grid 內保留半透明佔位卡，另以 fixed 高 z-index 的完整 Plotly 圖卡跟隨滑鼠移動，放開後提交排序、Escape/pointer cancel 還原。未新增依賴、不改疊圖模式與匯出順序；前端 `npm run build` 通過。

- XRD 單筆模式多圖卡與原生拖曳排序：依使用者草圖與實作計畫，重構 `web/frontend/src/pages/XRD.tsx` 中間欄顯示邏輯。保留「多檔疊圖」為單張合併 Plotly 圖；「單筆處理」改為每筆資料各自生成一張圖卡，2 筆並排、奇數最後一張橫跨整列、4 筆以上兩兩並排。新增 `singleCardOrder` 與 Pointer Events 原生拖曳排序，不新增依賴；拖曳只影響單筆模式畫面順序，不改 rawFiles、疊圖 offset、CSV/TXT 匯出順序。單筆卡片各自套用強度轉換、歸一化、參考峰與獨立 Y 軸範圍；前端 `npm run build` 通過。

- XRD 歸一化步驟獨立與預設關閉：依使用者反饋，將 `web/frontend/src/pages/XRD.tsx` 中原本藏在 Step 3「強度轉換與基線扣除」內的 1%~99.7% Min-Max 歸一化拆成獨立 Step 4「強度歸一化 (Normalization)」，並將 `normalizeCurves` 預設值改為 `false`。現在使用者可只做 Log10/Ln/Sqrt 轉換而不重新縮放峰值強度；需要多檔疊圖形狀比對時再手動啟用 0~1 歸一化。同步更新側欄問號說明、頁首資訊卡、圖表與匯出預覽 Y 軸標題、峰位偏移 TXT 報告的歸一化狀態紀錄；前端 `npm run build` 通過。

- XRD 側邊欄引進三階段科研分組標籤（Category Headers）：依據使用者同意，為了在 6 個複雜步驟中梳理出清晰的物理因果層次，我們在側欄引入了極具學術大廠質感的分組標籤。將步驟劃分為：① **【📊 數據準備與校正】** (包含 Step 1-2)；② **【⚡ 訊號變換與前處理】** (包含 Step 3-4)；③ **【🔬 晶體物相與偏移分析】** (包含 Step 5-6)。每個分類標籤皆配有微型科學 Emoji、`tracking-[0.16em]` 的 Mono 寬字距加粗字體，並在右側拉出一條溫和漸層的極細分割線。這不僅讓使用者能直觀區分「整理數據」、「訊號前處理」與「晶相比對」三階段工作流，也極大強化了介面的論文出版美學層次。

- XRD 歸一化獨立為 Step 4（預設關閉）與圖表 Origin Pro 白底風格切換按鈕：① **歸一化獨立步驟**：將「強度歸一化 (0~1 Min-Max)」從 Step 3 中分離出來，成為獨立的 Step 4，預設折疊且關閉，並加入說明提示文字，避免僅需取對數時因誤開歸一化而改變峰值強度比例；② **圖表風格切換 (Origin Pro Style Toggle)**：新增 `useOriginStyle` 布林 state，並重構 `buildChartLayout` callback 讓其在切換後輸出兩套完全不同的 Plotly Layout：深色主題（預設，`rgba(15,23,42,0.55)` 背景 + 淡藍網格線）與 Origin Pro 白底科研風格（純白背景、黑色框線 mirror 雙軸、Times New Roman 字體、無網格線、外刻度）。在疊圖模式 ChartToolbar 右側加入「📄 Origin Pro 風格 / 🌙 深色模式」高質感切換按鈕，點擊一鍵切換圖表外觀，且在 Origin Pro 風格下圖卡背景也自動轉為 `bg-white/95 border-slate-300`。

- XRD 參考峰折疊膠囊防重疊與大 Modal 防意外關閉終極修復：為了解決用戶在折疊 Modal 後懸浮小卡片與 Theme Dock 設定按鈕重疊，以及點擊背景時視窗意外關閉的交互 Bug，進行了高規格的終極修復：① **膠囊防重疊**：將懸浮控制小膠囊的預設擺放位置由 `bottom-6` 向上調整為 `bottom-24`，使其剛好以右對齊方式精美懸浮在 Theme Dock 齒輪設定按鈕的上方，徹底消除了與設定按鈕的重疊與誤觸衝突；② **大 Modal 防意外關閉 (極淡防誤觸遮罩)**：為大 Modal 展開狀態的最外層容器加回了 `pointer-events-auto bg-slate-950/[0.03]` 極淡高對比防誤觸背景遮罩，並保持無 `onClick` 關閉事件。這不僅利用極淡遮罩保持了後方 Plotly 比對圖譜 100% 清晰可見的頂級視覺，同時徹底攔截了穿透點擊外部引起的點擊事件，100% 杜絕了「點擊背景 Modal 意外消失」的重大交互 Bug。同時，用戶如需操作 Plotly 圖表，可一鍵點擊 Modal 右上角的「折疊 ➖」最小化為懸浮小膠囊，此時背景完全穿透，操作完畢後再一鍵「展開還原 ⚡」，極致契合大廠學術分析工作流。

- XRD 參考峰大 Modal 移除背景點擊關閉與遮罩以實作全透明無干擾穿透：為了解決用戶在拖曳或縮放視窗時滑鼠超出邊界點擊背景，導致 Modal 意外消失的交互 Bug，進行了終極修復：① **去 onClick 關閉**：徹底移除了最外層 `fixed` 容器的背景點擊關閉 `onClick` 函數，Modal 只有在點擊右上角「關閉」按鈕時才會被收起，保證安全無誤；② **全透明無干擾穿透 (Pointer-Events-None Backdrop)**：移除了全螢幕 `bg-black/10` 遮罩層，改為設置 `pointer-events-none bg-transparent`，同時在 `glass-panel` 卡片上加上 `pointer-events-auto shadow-[0_20px_50px_rgba(0,0,0,0.5)]`。這使用戶在大 Modal 展開並被拖曳到一旁的狀態下，可以直接、無障礙地用滑鼠穿透點擊與縮放後方的 Plotly 圖表，完全不需要做任何最小化切換，大廠交互感步入神壇。

- XRD 參考峰套用設定按鈕 onClick 保持開啟並新增成功發光回饋：將原本按下「套用設定」會自動關閉 Modal 的設定進行了交互優化：點擊時不再強行關閉視窗，而是利用新增的 `isAppliedSuccess` 狀態觸發微互動回饋，按鈕背景在 1.2 秒內平滑轉化為發光綠色且文字顯示為 `✨ 已實時套用 ✓`（隨後溫和還原）。這允許用戶在拖曳對比數據時，一鍵確認狀態實時同步，且視窗巍然不動留在原地，確保了最流暢的連續性晶面調整體驗。

- XRD 參考峰選擇 Modal 實作大小調整手柄與折疊膠囊自由拖曳：為實現頂級桌面軟體的極致操控感，再次進行了兩項高階交互升級：① **大視窗縮放大小 (Resizable Modal)**：在 Modal 容器右下角實作了拖曳調整大小手柄 (Resize Handle)，內嵌極具科學美學的三斜線向量 SVG Resize 圖示，大於 md 螢幕下用戶可滑動右下角任意拉伸大視窗的寬度與高度（設有 680x480 的防呆最小尺寸保護）；② **折疊膠囊自由拖曳 (Draggable Minimized Capsule)**：為最小化懸浮小卡片綁定獨立的拖曳位置狀態 `minimizedCapsulePos` 與 `handleMinimizedCapsuleMouseDown` 函數，用戶可用滑鼠按住懸浮小膠囊將其流暢拖動擺放到螢幕上的任意角落，給予 100% 無遮擋的靈活科研圖譜比對體驗。

- XRD 參考峰選擇 Modal 背景去模糊與遮罩調淡：依據使用者要求，將打開標準化合物 Modal 後背景變糊而無法清晰比對數據圖的問題徹底修復。移除了最外層包裹容器的 `backdrop-blur-[5px]` 毛玻璃模糊效果，並將黑色半透明遮罩背景由 `bg-black/70` 調淺為極淡的 `bg-black/10`，保證大 Modal 展開並被拖曳至一旁時，背後所有的 Plotly 繞射圖譜曲線、文字標記與座標軸皆 100% 清晰銳利，完美支援學術對照。

- XRD 參考峰選擇 Modal 實作滑動拖曳與折疊縮小懸浮膠囊：為支持用戶在調整標準峰晶面時能即時對比後方 Plotly 數據圖譜，進行了重大交互升級：① **滑動拖曳 (Draggable Modal)**：在 Modal Header 上綁定 `onMouseDown={handleRefMarkersHeaderMouseDown}` 事件監聽，並使用 GPU `transform: translate` 加速，使用戶可按住 Header 任意拖動視窗位置，無重繪閃爍；② **折疊最小化 (Minimize Modal)**：在 Header 右上角新增「折疊 ➖」按鈕，點擊後大視窗會平滑最小化為右下角精緻的「懸浮控制小膠囊」，背景遮罩與毛玻璃淡去（pointer-events-none），允許用戶無障礙與後方 Plotly 圖表進行放大/縮小/懸停交互；③ **精緻膠囊資訊**：懸浮小卡片配有 animate-ping 發光 LED 狀態小綠點以提示啟用中，並以化合物相位各自代表色渲染出當前已啟用的縮略彩章標籤，配有「展開還原 ⚡」按鈕一鍵恢復大視窗。

- XRD 參考峰選擇卡片美學再重構（解決多重色彩重疊與溢出碰撞）：依據使用者截圖反饋，徹底重構並解決了四個極致微觀的 UI 美學缺陷：① **代表色 100% 融合**：將 Active 卡片寫死的主題色邊框和 boxShadow 陰影發光，全面改為動態連動該化合物相位的「專屬代表色 (color)」，當選中時散發出各相位專屬的弱光高發光邊框，色彩純淨一致，消除了與小色條、Toggle 背景色衝突雜亂的重疊感；② **去 redundant 高光邊條**：徹底移除了容易與卡片圓角、代表色小條重合碰撞的左側 `absolute` 高光邊條；③ **Toggle 白色圓點溢出微調**：將白色圓點的滑動偏移量由 `translate-x-4` 微調為 `translate-x-3.5`，當滑至最右側時保留 2px 的空氣邊距，消除「快要掉出外框」的重疊碰撞感；④ **狀態行排版對齊**：狀態行 padding 增加 `pr-0.5`，使右下角 `晶面 20/20` 徽章與右上角 Toggle 按鈕垂直縱向完美對齊，不再擠壓碰撞到卡片最右側邊緣。
- XRD 參考峰選擇 Modal 大類與晶面卡片防擠壓重疊優化：為了解決在窄視窗、中低解析度或大類名稱極長時產生的「框框擠壓重疊」不美觀 Bug，實作了三項健全排版防護：① 在左側化合物大類卡片名稱中引入 `flex-1 min-w-0` 與 `truncate pr-2` 限制，使超長名稱自動以 `...` 省略且留有安全間距，絕不橫向碰撞 Toggle Switch；② 將右側晶面列表 Grid 由 `sm:grid-cols-2` 升級為寬大螢幕才啟用的 `xl:grid-cols-2`，並在大類內層使用 `min-w-0 flex-1 pr-2` 與右側強度標籤 `shrink-0`，保證兩者永遠分立兩側、互不侵佔；③ 將 Modal 外圍高度 `h-[620px]` 精調為 `md:h-[620px] h-auto` 響應式配置，確保小螢幕垂直堆疊時不會垂直擠壓重疊。
- XRD 參考峰選擇 Modal 去除 Low 勾選框並升級為發光 Toggle Switch：將原本標準化合物大類卡片左上角顯得極其廉價的 CheckRow (傳統 checkbox 勾選框) 徹底移除，取而代之的是實作了一個超高質感、具備 iOS/macOS 科研美學的微型發光滑動 Toggle Switch 撥鈕。當開關開啟時，其背景色平滑且精確地連動該化合物相位的代表顏色 (透過 style 綁定自適應 color)；未開啟時呈現磨砂灰黑。透過 e.stopPropagation() 實現點擊事件防冒泡防干擾，並將卡片下方的狀態行縮排由 pl-6 精調為 pl-3.5，使整體介面佈局優雅緊實、高級感拉滿。
- XRD 步驟說明清爽化與標準化合物選擇 Modal 尺寸固定防抖：依據使用者反饋，進行了兩項關鍵的 UI 體驗升級：① 徹底移除 `XRD.tsx` 側邊欄中 Step 3 與 Step 6 原本寫死的冗餘計算管線說明與尋峰邏輯說明文字區塊，使步驟控制欄恢復極致簡潔清爽；② 將「標準化合物與參考峰細緻選擇」Modal 的外層玻璃面板容器加上固定高度 `h-[620px]`（並保持 max-h 響應式配置與彈性布局），使得在切換不同大類化合物（如特徵峰極多的 β-Ga2O3 與特徵峰較少的 Si 等）時，視窗尺寸巍然不動，而內部列表在局域滾動條下流暢滾動，徹底消除了視窗頻繁縮放和重開感，極大提升了大廠體驗質感。
- XRD 步驟問號說明與問答彈窗功能實作：依據使用者要求，將 XRD 模組的側邊欄所有 6 個步驟卡片說明，升級為與 XPS 對齊的「問號說明問答彈窗」功能。首先，重構了 `XRD.tsx` 本地定義的 `Section` 元件，加入 `infoContent?: React.ReactNode` 與 `createPortal` 置頂遮罩 Modal 控制邏輯。其次，針對 XRD 的 6 大核心處理流程，編撰了極具學術嚴謹度、排版精美且配有 Times New Roman 與 Mono 混合字體的科學原理與操作指導 JSX 區塊。最後，在側邊欄所有 Section 步驟卡片中引入並傳入該 `infoContent`。點擊各標題右側精緻的問號 `?` 按鈕後，即能彈出對齊 XPS 風格的高規格磨砂玻璃彈出視窗說明。前端建置打包（`npm run build`）完美通過 0 錯誤。
- XRD 固定參考峰區簡化為彈出視窗（Modal）：為了解決左側側邊欄因展示標準化合物 Checkbox 清單而產生的擁擠問題，重構了 `XRD.tsx` 的 Step 5 「固定參考峰/圖例 (Markers)」區塊。將側邊欄簡化為僅包含顯示參考峰的開關與一個高質感的彈出視窗按鈕「🔬 選擇標準化合物」。點擊後會彈出一個玻璃風格的互動選擇 Modal（`showRefMarkersModal`）。Modal 內實作了一鍵全選、全部清除功能，並以漸層高亮卡片呈現標準化合物，同時在每張卡片上精美渲染出該化合物所包含的所有特徵峰 (hkl) 與對應角度的科學預覽。點擊套用後隨即重新渲染 Plotly 圖表，既維持了強大的標記能力，又賦予了側欄極致清爽與精緻的視覺感。前端建置打包（`npm run build`）順利通過且 0 錯誤。
- XRD 數據匯出區重構與 Origin Pro 科研風格預覽：依據使用者要求，將原本左側側邊欄的 Step 7 數據匯出 Section 完全移除，使側欄流程更簡潔清爽。將「📥 匯出最終光譜數據 (CSV)」以及「📄 匯出峰位偏移報告 (TXT)」兩大數據導出入口，完美移至右側中間欄 Plotly 大圖卡的左下角，對齊高質感 Nigiro Pro 設計規範。同時，為 CSV 導出實作了對齊 XAS Conduction Band 規格的互動預覽 Modal（`showExportPreview`）：在點擊匯出後，會先跳出一個預覽視窗，視窗上半部會繪製 Origin Pro 經典科研風格圖表（純白背景、黑色主線與刻度、刻度朝外、雙軸鏡像格線與 Times New Roman 科研字體，並完美疊加勾選之化合物參考峰與防壓峰標籤文字），視窗下半部展示 CSV 檔案的前 15 行文字數據。使用者在 Modal 點擊「確定匯出」後才會真正下載 CSV，完美升級了科學論文出版級 the 數據匯出流程。前端建置打包（`npm run build`）順利通過且 0 錯誤。
- XRD 疊圖自適應高度與間距優化：針對多筆疊圖時曲線與標籤過度擁擠，以及少筆數據（2~3 筆）時畫面顯得空曠的問題，於 `XRD.tsx` 實作了雙向自適應排版與渲染優化。首先，在 `plotlyLayout` 渲染管線中引入與檔案數量動態關聯的 `chartHeight` 自適應高度算法（每多一檔增加 60px，上限設為 1000px，單檔或單圖時維持 480px 的黃金高度）；其次，將 `handleFilesUpload` 與 `handleAutoStackOffsets` 中預設的疊加 Y 軸偏移量間距 `stackGap` 改為與檔案數量自適應關聯 the `stackGapFactor` 算法（2檔拉大至 0.85，3檔拉大至 0.70，4檔 0.58，5檔以上維持緊湊的 0.45）。同時重構共用元件 `WorkspaceUi.tsx` 中的 `ChartToolbar` 將 `colorValue` 和 `onColorChange` 調整為 optional，以完美相容不需單獨設定線色的光譜圖卡，並修復了 XRD 模組的 TypeScript 型別編譯錯誤。前端執行打包建置（`npm run build`）完美通過 0 錯誤。
- XRD 預設光譜色調 Origin Pro 經典化與圖例右上角選單清理：於 `XRD.tsx` 中新增 `ORIGIN_PRO_COLORS` 經典八色科研調色盤，多檔上傳時依據索引序為每條曲線精準預設指派經典顏色（第一條黑色、第二條紅色、第三條藍色...），徹底對齊 Origin Pro。同時重構 `ChartToolbar` 移除中間圖卡右上角已冗餘無用之單一「線色」下拉選單，並完全清除已棄用之 `chartLineColors` 狀態。
- XRD 疊圖外觀設定新增「線條顏色」修改功能：於 `XRD.tsx` 的 Step 4 疊圖設定的每條光譜控制卡片中，成功引入並設計高質感玻璃底座的 HTML5 原生顏色選擇器。使用者可點擊高光色點，隨意自訂修改各曲線之顏色，Plotly 隨即即時渲染更新，提供論文級配色的極佳自由度。
- XRD 桌面繪圖邏輯深度對齊與科學繪圖精細化升級：全面升級 `XRD.tsx` 前端數據處理與 Plotly 渲染管線。完美移植桌面版 `XRD_Program.py` 四大繪圖美學靈魂：① 實作 `xMin`/`xMax` 角度過濾裁剪與 X 軸 range 對齊；② 實作對數強度 $1\% \sim 99.7\%$ 百分位數去噪 Min-Max 歸一化開關與演算法，徹底對齊振幅；③ 實作大師級 `getReferenceMarkerY` 參考峰防壓峰防重疊動態標籤定位算法，線段停留在文字下方不穿透；④ 實作化合物點虛線專屬圖例與 Times New Roman 科研字體。同時完美整合多檔上傳自動啟用疊圖，且自動依桌面版方向（第一個在最上、最後在最下）自適應分配 Y 軸 offset。
- XRD 側邊欄 UI 控制與樣式 100% 完美統一為 XPS 模式：重構 `XRD.tsx` 的左側控制側欄所有 7 個步驟卡片結構，成功封裝並引入與 XPS 完全對齊之精緻高規格玻璃化 UI 元件（`Section`、`CustomSelect`、`TogglePill`、`NumInput`、`CheckRow`）。徹底替換原本寫死的原生控制件及顏色類別：將強度轉換下拉選單升級為玻璃風格 `CustomSelect`；化合物選擇升級為具代表色提示之 `CheckRow`；尋峰與容忍度參數升級為雙 `NumInput` 數值欄位；匯出 CSV 與 TXT 按鈕分別同步為 XPS 高質感的主按鈕與次級按鈕。前端執行打包建置（`npm run build`）順利完成，0 TypeScript 錯誤。

### 2026-05-23（續二）

- XRD 主內容區與滾動排版結構 100% 完美對齊 XAS：重構 `XRD.tsx` 的右側主內容欄 `<main>` 結構，將其調整為與 XAS 一致的外層滾動容器，並移除了寫死的背景色（改由系統 CSS 變數控制），同時在外圍包裹 `mx-auto w-full max-w-[1500px]` 置中與寬度限制容器；在 `ModuleTopBar` 下方成功引入並配置對齊 XAS 規格的 `InfoCardGrid` 狀態指標卡片，即時反映已載入光譜數、顯示模式、強度轉換方式與角度範圍 (2θ)。移除原本中間欄多餘的內部滾動層，並修復了 `EmptyWorkspaceState` 的擺放層級。前端打包建置（`npm run build`）順利通過且 0 錯誤。

### 2026-05-23（續）

- XRD 數據處理邏輯對齊桌面版實作計畫制定：針對使用者要求將網頁版數據處理公式完全照抄桌面版 `XRD-繪圖`（保留 Step 5 固定參考峰）之需求，撰寫了詳細的 [implementation_plan.md](file:///C:/Users/peili/.gemini/antigravity-cli/brain/b0fa53fc-f7a6-4485-8f61-12ebceeb5eae/implementation_plan.md) 計畫。由於 CLI 本地沙盒對於 Workspace 外的桌面資料夾 `XRD-繪圖` 的讀取權限及指令執行在非互動環境下皆超時失敗，已在計畫中列出 Open Question，懇請使用者在回覆中直接提供桌面版 `XRD_Program.py` 的核心處理邏輯與計算公式，以便我們進行 100% 精準對齊與移植。

### 2026-05-22（續五）

- XRD 中間欄按鈕與結構全面對齊 XAS：調整中間主內容區各圖卡內的「導出此步驟 CSV」、「一鍵自動疊線」以及「匯出最終光譜 CSV」等按鈕的 className 樣式，徹底對齊 XAS 與 Nigiro Pro 規範之邊框、背景與 hover 亮色微發光樣式（採用 `--card-border`、`--accent-strong` 與 `--accent-secondary` 等 CSS 變數）；將左側側邊欄 `<aside>` 與展開按鈕完全替換為 XAS 規格的 `border-[var(--card-divider)] bg-[var(--panel-bg)]` 主題樣式；並徹底清除側邊欄底端在先前重構中殘留的損毀重複舊 Step 6/7 代碼。前端執行打包建置（`npm run build`）順利通過且 0 錯誤。

### 2026-05-23

- XES 新增 Valence Band 模式（VBM 外推）與型別修復：成功將 XAS 的 Conduction Band 模式外推邏輯完整移植到 XES，建立 Valence Band (VBM) 模式。於前端 `XES.tsx` 實作了 VBM 核心分析演算法、極致精美 Nigiro Pro 玻璃卡、雙區間滑桿、雙模式條件渲染分流、以及 Origin Pro 相容之 Tab-separated TXT 導出預覽與下載 Modal。同時修復了 VBM 繪圖與匯出預覽中數個 `map` 箭頭函式隱含 `any` 的型別錯誤，前端打包建置（`npm run build`）順利通過且 0 錯誤。

### 2026-05-22（續四）

- XRD 中間欄重構為 4 個獨立玻璃圖卡之分步條件渲染：徹底還原如同 XPS/XAS 模組的分步驟多圖卡視覺對比模式。將原本單一的綜合 Plotly 圖表，解耦重構成：① 原始繞射光譜與 X 軸微調圖卡（對比展示 x_shift 角度微調前後的變化）、② 強度訊號轉換結果圖卡（展示 log/sqrt 訊號轉換與背景扣除後的演化，僅在非 none 模式顯示）、③ 多檔疊圖比較圖卡（當啟用 overlay 模式時顯示，內嵌 XAS 風格的「一鍵自動疊線」快捷按鈕）、④ 最終處理光譜與參考峰比對圖卡（疊加勾選之化合物標準垂直虛線與 (hkl) text 結晶面標誌）。各圖卡皆配置獨立高質感玻璃 ChartToolbar、專屬 Plotly Traces / Layouts、以及特化之步驟 CSV 導出按鈕。同時修復 activeTrace.xShift 可能為 undefined 的嚴格 TS 型別錯誤，前端打包建置（`npm run build`）順利通過且 0 錯誤。

### 2026-05-22（續三）

- DFT：新增 `Ga2O3_VB_Analyzer` Streamlit 子專案，建立 app、分析模組、README、requirements、example_data 與 `.gitignore`，並在 XPS 前端加入 DFT 模式、密碼解鎖與 Streamlit 入口。
- DFT：新增 `src/pdos_acquisition.py`，整合 user CSV、Materials Project / pymatgen 與 digitized literature pDOS 三種來源；同步更新 Streamlit UI、README 與範例資料說明。
- 檢查：`uv run python -m py_compile` 已通過 `Ga2O3_VB_Analyzer/app.py`、`src/pdos_acquisition.py`、`src/pdos_model.py` 等 DFT 模組；`mp_api` 與 `pymatgen` 依賴可載入。
- 重啟：`Ga2O3_VB_Analyzer` Streamlit 服務已於 `http://127.0.0.1:8505` 通過 `_stcore/health` 檢查。
- 整理：重新整理 `CLAUDE.md`，將 2026-05-22 至 2026-05-24 的逐筆流水帳壓縮成短版紀錄，移除亂碼紀錄並改寫成可讀摘要。

### 2026-05-23

- PlotFileTool XPS 疊圖新增 offset 功能：每筆 fit spectra 可設定 X offset，圖表、標線、範圍與匯出 CSV 均使用位移後資料，並可對齊共同 Binding Energy grid。
- 重要判斷：X offset 的意義調整為每筆資料的 X 軸位移，避免被誤解為只調整圖表裁切範圍。
- 檢查：當時 shell 找不到 `node` / `npm` / `pnpm` / `yarn`，未執行前端 build；改以 `git diff --check` 驗證 patch 格式，僅有既有 LF/CRLF 提醒。

### 2026-05-22

- PlotFileTool XAS 左側調整欄新增獨立垂直捲動，避免調整參數時中央圖表跟著位移；曾誤改 Raman 左欄 class，已還原。
- XRD 回歸純淨桌面版 7 步驟前端本地計算流程，清除複雜自定義化合物 modal，保留擴充後的常用參考峰資料庫與左側勾選模式。
- Theme Dock 改為 React state 控制 hover / click toggle / 外部點擊關閉，並加入 180ms 延遲關閉改善滑鼠移動容錯。
- XES sidebar 與中間欄視覺對齊 XAS，補齊 `TogglePill`、`NumInput`、`TextInput` 等一致元件樣式。
- XES 移除平滑、參考峰與峰值偵測 UI，並將雙背景簡化成單一背景檔案流程。
- XPS 圖卡條件渲染簡化：避免原始、前處理後與最終結果圖重複顯示，減輕中間欄視覺負擔。
- 全面修正 XAS / XES / XRD / SingleProcessTool 的 flex 捲動與圖表裁切問題。
- 檢查：多次 `cd web/frontend && npm run build` 通過；部分情境因 PATH 找不到 node/npm，改以 `git diff --check` 驗證。

### 2026-05-21

- 整理：將舊版 `CLAUDE.md` 從大型流水帳重構為精簡版協作手冊，保留核心規則、模組現況、近期重點與短版紀錄；`AGENTS.md` 也同步改成短版摘要結構。
- Athena 入口位置修正：右側 workspace launcher 恢復 `XAS Athena 處理` 快捷鍵；首頁左上品牌卡片下方的 `ModuleTabs` 隱藏 `Athena`。
- XAS 峰擬合結果圖卡新增「放大選定範圍」功能，並修正擬合範圍拖動時範圍框消失問題。
- SingleProcessTool 切到最低點 snap-drag 對齊模式，支援設定搜尋範圍、生成高斯曲線與圖中拖曳微調中心。
- XRD 初步改為桌面版流程，後續再移除內插、多檔平均與峰位偏移報告卡，保留主圖與匯出。
- 檢查：相關前端修改均以 `cd web/frontend && npm run build` 驗證通過，`git diff --check` 只有既有 LF/CRLF 提醒。

### 2026-05-20

- Single Process Tool：修正高斯模板扣除 CSV 匯出與非負保護問題，並將匯出入口改為各圖卡底部。
- XAS：移除高斯模板扣除步驟，重新整理步驟編號，並在歸一化圖卡加入 TEY / TFY 匯出。

### 2026-05-15 至 2026-05-19

- XAS Athena：完成微調、手動刪峰 / 加回、拖曳區間、最終結果圖、OriginPro 匯出與欄位對應流程整理。
- XPS / XAS：峰擬合加入自動收斂、重設峰、收斂歷史與更穩定的 seed 回寫流程。
- XES：完成能量校正、分點扣背權重、process 500 補強與歸一化修正。
- PlotFileTool：完成 Raman 參考峰疊圖增強與 XAS/XES band gap 圖功能。

### 2026-05-24（補充：DFT Streamlit 與 XRD 單筆圖卡拖曳）

- XRD 單筆圖卡拖曳排序參考 `RX5950XT/Token-Anxiety-Dashboard` 的實作，改用 dnd-kit 的 `DndContext`、`SortableContext(rectSortingStrategy)`、`useSortable` 與 `DragOverlay`，讓拖曳中的完整圖卡可以跟著滑鼠移動，原位置保留半透明佔位卡，其他圖卡依游標落點即時推開與補位。同步新增前端依賴 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`，保留 XRD 多檔疊圖模式單張合併圖、資料上傳順序與 CSV/TXT 匯出順序不受 UI 排序影響；已執行 `npm run build` 通過，僅有 Vite chunk size 提醒。
- XRD 單筆圖卡版型新增手動滿寬狀態：奇數筆資料仍預設為兩張半寬並排、最後一張滿寬，但拖曳同一列的半寬卡往另一張卡下方移動時，會把該列兩張卡改為滿寬，支援三筆資料由「兩小一大」改成「三張大卡」的瀏覽習慣；取消拖曳會還原拖曳前版型，刪除或清空資料會同步清理版型 id，匯出與疊圖順序不受影響；已執行 `npm run build` 通過，僅有 Vite chunk size 提醒。

- 重要判斷：回覆使用者 DFT 後續操作時，確認目前模組為 Ga2O3_VB_Analyzer 的 DFT-informed Streamlit 流程；已上傳實驗 VB 檔後，先做 VBM 對齊與區域積分，若有 pDOS reference 才進行 pDOS-based fitting。
- 重要判斷：使用者要求 DFT Streamlit 工具內嵌於目前 XPS/DFT 介面、操作選項中文化，且所有輸出數據/圖的 X 軸需由大到小；開始檢查前端入口與 DFT Streamlit 子專案。
- 實作：XPS DFT 工作區改為內嵌 Streamlit iframe，來源使用 VITE_DFT_STREAMLIT_URL 或預設 http://127.0.0.1:8505/?embed=true；側欄不再只顯示啟動指令。
- 實作：DFT Streamlit 的光譜圖、VBM 對齊圖、導數圖與 fitting 圖強制 X 軸反向顯示；CSV 匯出依 Binding_Energy / E_rel / Energy_rel 降冪排序，確保 X 軸數值大在左、小在右。
- 實作：DFT Streamlit UI 中文化，涵蓋頁面標題、側欄、檔案匯入、前處理、積分區域、pDOS 來源、截面校正、展寬/fitting、分頁、匯出按鈕、報告與 Materials Project 提示。
- 實作：移除 DFT Streamlit 未使用的舊版英文 pDOS panel，並中文化前處理警告、圖表標籤與預設積分區域名稱。
- 檢查：DFT Streamlit 相關 Python 檔以 uv run python -m py_compile 驗證通過；一般沙盒內 uv cache 權限失敗，已改用非沙盒執行。
- 檢查：前端 build 因環境找不到 npm/node 未能執行；已確認 web/frontend 具備 vite/client 型別設定，並以 git diff --check 檢查 patch，僅出現既有 LF/CRLF 提醒。
- 檢查：確認 DFT Streamlit 服務 http://127.0.0.1:8505/_stcore/health 回傳 200 ok，可供 XPS/DFT iframe 內嵌載入。

- 檢查：開始檢視 PlotFileTool / XPS 繪圖區結構，準備新增 VB-DOS 初步峰來源指認功能。

- 重要判斷：VB-DOS 初步峰來源指認放在繪製圖檔區 PlotFileTool 的 XPS 子模式內，與峰擬合圖 / VBM 線性外推並列；因屬 XPS 圖，ΔE 軸仍採 XPS 慣例反向顯示，並保留使用者可調範圍。

- 實作：PlotFileTool 的 XPS 子模式新增 VB-DOS 初步指認工作區，包含前兩數值欄自動讀取、min-subtract/max 歸一化、VBM ΔE 對齊、固定樣品配色、pDOS/DFT 區域、peak/shoulder 自動偵測與可編輯標註、峰表 CSV 與 PNG/PDF/SVG 匯出。

- 檢查：嘗試執行 web/frontend 的 npm run build，但目前 shell 找不到 npm，未能進行前端建置。

- 檢查：git diff --check 通過，僅顯示既有 LF/CRLF 提醒；再次確認 npm/node/本地 node_modules 目前不可用，因此仍無法執行前端 build。

- 重要判斷：VB-DOS 區域由固定常數升級為可編輯 state；區域名稱斜體採用使用者輸入關鍵詞後自動套用 <i>...</i>，避免要求使用者直接寫 HTML。

- 實作：VB-DOS 新增可調整 pDOS/DFT 區域顏色、區域起訖、圖上區域名稱、完整 CSV 指認名稱、區域名稱位置，以及指定詞語自動斜體；同時每筆樣品新增數據名稱 X/Y 位置控制。

- 檢查：VB-DOS 區域/名稱位置調整功能完成後再次嘗試 npm run build，但目前 shell 仍找不到 npm；改以 git diff --check 驗證格式，僅有既有 LF/CRLF 提醒。

- 檢查：使用者回報 XPS 分析流程不順暢，開始檢視 XPS 前端流程、API 串接、圖卡條件渲染與建置狀態。

- 檢查：前端建置嘗試未完成；從 web/frontend 以相對路徑寫入 CLAUDE.md 被拒絕，且目前 shell 找不到 npm，因此暫以靜態檢查與 git diff 檢查替代。

- 重要判斷：XPS 多檔疊圖流程不順的主因之一是切換疊圖時會先進入 overlay 空狀態，若尚未套用或取消選擇，中央工作區容易變成無資料感；決定改為預設全選並在無有效選擇時回單筆。

- 實作：調整 XPS 多檔疊圖切換流程，新增 openOverlaySelector；按疊圖時預設選取全部可用檔案並立即建立 overlay 狀態，套用少於 2 筆時改用 enterSingleMode 乾淨回到單筆，避免中央工作區空白。

- 檢查：完成 XPS 疊圖流程調整後執行 git diff --check，確認 patch 格式與空白問題。

- 檢查：執行 XPS 後端相關 Python 語法檢查，確認 routers/xps.py、core/parsers.py、core/peak_fitting.py 未受流程調整影響。

- 檢查：沙盒內 python -m py_compile 因 Windows logon session 錯誤失敗，改用非沙盒重跑 XPS 後端語法檢查。

- 檢查：確認目前 python/py 為 WindowsApps stub，改嘗試使用既有 uv 入口執行 XPS 後端 py_compile。

- 檢查：uv run python -m py_compile 因 uv cache 權限失敗，改用非沙盒執行 XPS 後端語法檢查。

- 檢查：XPS 疊圖流程調整與後端 py_compile 後，再次執行 git diff --check 與 git status 確認變更範圍。

- 檢查：XPS 後端相關 py_compile 已以 uv run 在非沙盒通過；git diff --check 通過，僅有既有 LF/CRLF 提醒。前端 build 因目前 shell 找不到 npm/node 未執行。

- 重要判斷：XPS 只匯入 VBM 已處理光譜後切回 Core Level 會因 imported VBM 被當作工作區資料而造成中央空白；決定將 imported VBM 資料可用性限定在 Valence Band 模式。

- 實作：XPS 工作區資料判斷新增 hasImportedVbmWorkspaceData / hasXpsWorkspaceData，將 imported VBM 光譜只限定於 Valence Band 模式，避免 Core Level 無 raw file 時中央空白。

- 檢查：完成 XPS 工作區資料判斷調整後，再次執行 git diff --check。

- 2026-05-29：實作 PlotFileTool XPS 位置調整模式，將 X/Y 軸標題距離與 panel/樣品標籤改為可點選框，並新增右下角 360 度搖桿依選取項目微調；同時開啟 PlotFileTool XRD，新增多欄 XRD 匯入、log10 baseline/normalize/offset 疊圖、固定參考峰與 PNG/SVG/PDF/CSV 匯出。

- 2026-05-29：檢查 PlotFileTool XPS/XRD 改動；npm run build 因當前 shell 找不到 npm 且前端子目錄無 CLAUDE.md 讀取失敗未能執行，改於專案根目錄跑 git diff --check，結果僅有既有 LF/CRLF warning，無 whitespace error。

- 2026-05-29：複查 PlotFileTool XPS/XRD JSX 與 diff 範圍，補上 XRD 狀態 chips；再次執行 git diff --check，僅回報 LF/CRLF warning，無 whitespace error。
