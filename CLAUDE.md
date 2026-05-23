# Nigiro Pro 協作手冊（精簡版）

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

### 2026-05-24

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

- 重要判斷：回覆使用者 DFT 後續操作時，確認目前模組為 Ga2O3_VB_Analyzer 的 DFT-informed Streamlit 流程；已上傳實驗 VB 檔後，先做 VBM 對齊與區域積分，若有 pDOS reference 才進行 pDOS-based fitting。

- 重要判斷：使用者要求 DFT Streamlit 工具內嵌於目前 XPS/DFT 介面、操作選項中文化，且所有輸出數據/圖的 X 軸需由大到小；開始檢查前端入口與 DFT Streamlit 子專案。

- 實作：XPS DFT 工作區改為內嵌 Streamlit iframe，來源使用 VITE_DFT_STREAMLIT_URL 或預設 http://127.0.0.1:8505/?embed=true；側欄不再只顯示啟動指令。

- 實作：DFT Streamlit 的光譜圖、VBM 對齊圖、導數圖與 fitting 圖強制 X 軸反向顯示；CSV 匯出依 Binding_Energy / E_rel / Energy_rel 降冪排序，確保 X 軸數值大在左、小在右。

- 實作：DFT Streamlit UI 中文化，涵蓋頁面標題、側欄、檔案匯入、前處理、積分區域、pDOS 來源、截面校正、展寬/fitting、分頁、匯出按鈕、報告與 Materials Project 提示。

- 實作：移除 DFT Streamlit 未使用的舊版英文 pDOS panel，並中文化前處理警告、圖表標籤與預設積分區域名稱。

- 檢查：DFT Streamlit 相關 Python 檔以 uv run python -m py_compile 驗證通過；一般沙盒內 uv cache 權限失敗，已改用非沙盒執行。
- 檢查：前端 build 因環境找不到 npm/node 未能執行；已確認 web/frontend 具備 vite/client 型別設定，並以 git diff --check 檢查 patch，僅出現既有 LF/CRLF 提醒。

- 檢查：確認 DFT Streamlit 服務 http://127.0.0.1:8505/_stcore/health 回傳 200 ok，可供 XPS/DFT iframe 內嵌載入。
