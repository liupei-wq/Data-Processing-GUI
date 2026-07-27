# Nigiro Pro 協作手冊

最後整理：2026-07-27

> 這份檔案只保留仍有效的協作規則、專案狀態、驗證方式與近期重要變更。後續請避免重新累積逐步流水帳；每次只追加精簡的「實作 / 檢查 / 重啟 / 重要判斷」紀錄。

## 協作規則

- 回答使用者時一律使用繁體中文。
- 每一次動作前先讀取本檔案。
- 每一次實作、檢查、重啟、重要判斷，都要記錄在本檔案。
- 不要回復或覆蓋使用者未要求修改的既有變更。
- 只修改 `web/` 網頁版；桌面版在獨立 repo：`https://github.com/liupei-wq/Data-Processing-GUI-Desktop`
- Plotly 一律走 `web/frontend/src/components/PlotlyChart.tsx` 兼容層。
- 目前 PowerShell profile 可能出現執行原則警告，通常不影響指令結果。
- 畫任何數據圖的疊圖時，顏色設定固定為：
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

## 驗證慣例

- 前端改動優先跑：`cd web/frontend && npm run build`
- 後端改動優先跑：`python3 -m py_compile ...`
- DFT Streamlit 改動優先跑：`uv run python -m py_compile Ga2O3_VB_Analyzer/app.py Ga2O3_VB_Analyzer/src/*.py`
- 送出前至少確認：`git diff --check`
- 若環境缺少 `npm` / `node`，在紀錄中明確註明「未能執行 build」。
- 近期環境狀態：多次在本機 PowerShell 找不到 `node` / `npm` / `pnpm`，前端 build 常需改以靜態檢視與 `git diff --check` 替代；若使用者環境恢復 Node，仍應優先跑 build。

## 關鍵約定

- XPS x 軸必須維持 `autorange: 'reversed'`。
- DFT Streamlit 的 XPS / VB 相關輸出圖與 CSV 需維持 Binding Energy 或 relative energy 由大到小。
- 高斯面積換算：`area = peak_height × fwhm × 1.0645`。
- 優先使用不可變資料，不要直接 mutate 現有 state / dataset。
- 每層都要做錯誤處理，不可靜默吞例外。
- 輸入驗證放在系統邊界。
- Excel 匯入需維持 `.xlsx` / `.xls` 支援，部署端要有 `openpyxl` / `xlrd`。
- XAS / XES band gap 線性外推需對齊 XPS VBM 的 tangent / baseline 候選點邏輯。
- PlotFileTool XPS 疊圖的 X offset 是「每筆 fit spectra 的 X 軸位移」，不是裁切範圍。
- XAS EXAFS 若選 `larch_autobk`，需要後端 Python 環境安裝 `xraylarch`；前端不需安裝 Larch。

## 模組現況

| 模組 | 狀態 | 備註 |
|---|---|---|
| Raman | 穩定 | 含 Si 基板扣除、峰擬合、參考峰資料庫與繪圖輸出 |
| XRD | 穩定，近期持續小改 | 含美化匯出、參考峰、d-spacing / FWHM / Scherrer 與計算記錄 |
| XAS | 穩定且功能多 | 含 XANES / EXAFS / CBM、Athena、峰擬合、Band gap overlay、531 eV 特殊擬合 |
| XPS | 最完整，近期修過上傳解析 | 含 Core Level / Valence Band / VBM / 峰擬合 / DFT Streamlit 入口 |
| XES | 穩定 | 含 1D 分析、能量校正、Valence Band / VBM 流程 |
| PlotFileTool | 持續擴充 | 含 Raman / XPS / XRD / XAS / XES 繪圖與匯出工具 |
| Single Process Tool | 穩定 | 高斯模板扣除、Arctan 扣除與 CSV 匯出 |
| SEM | 未實作 | - |

## 近期重要變更

### 2026-07-16：XPS 上傳後無法分析

- 修正 XPS 文字檔解析流程：structured 格式解析失敗時不再提前返回，改由通用兩欄 parser 接手，支援空白、Tab、逗號分隔與多種文字編碼。
- XPS 樣品分類面板選檔後會立即關閉面板並載入分析資料；檔案仍保留於未分類清單，可再分組與套用。
- 補上「解析成功但無資料」時的明確錯誤提示。
- 驗證：parser 四格式回歸與 Python py_compile 通過；`git diff --check` 無錯。前端因本機缺 Node/npm 未跑 build。

### 2026-06-18：XRD 匯出圖表 Y 軸省略

- 在 `web/frontend/src/pages/XRD.tsx` 美化預覽 / PNG 匯出流程加入可開關 Y 軸省略區間，預設 2000 到 50000。
- 實作方式為資料壓縮轉換加自訂 tick label，讓預覽與匯出一致。
- 驗證：`git diff --check` 通過；前端 build 因本機缺 Node/npm 未執行。
- 同步狀態：當時 `main` 落後 `origin/main` 2 個 commit，已執行 `git pull --rebase origin main`，本機 ahead 1，準備推送該 commit。

### 2026-06-09：XRD 參考峰與美化輸出

- 刪除 XRD 分析 β-Ga2O3 參考峰清單中 `twoTheta 48.6` 的 `002` 參考峰。
- XRD 美化輸出新增 Y 軸刻度顯示控制、參考峰顏色設定，並將美化預覽刻度方向改為向內。
- 驗證：`git diff --check` 通過；前端 build 因本機缺 Node/npm 未執行。

### 2026-06-04：PlotFileTool XAS Band Gap 名稱

- `PlotFileTool` XAS Band gap 圖面設定新增 VBM 名稱與 CBM 名稱輸入欄。
- `buildXasBandOverlayFigure` 與 531 eV 特殊外推圖的 VBM / CBM 標註改讀取自訂名稱；空白 fallback 為 VBM / CBM。
- 使用 `escapePlotlyText` 避免特殊字元破壞 Plotly annotation。
- 驗證：`git diff --check` 通過；前端 build 因本機缺 Node/npm 未執行。

### 2026-06-01：XRD 計算記錄

- 修正 β-Ga2O3 參考峰 hkl：31.7° 由 `-111` 改 `002`，33.2° 由 `110` 改 `-111`。
- XRD 衍生計算工具新增記錄彙整：d-spacing、FWHM、Scherrer 的 `+` 記錄、預覽、移除、清空與 Excel 相容 `.xls` / TSV 匯出。
- 驗證：`git diff --check` 通過；前端 build 因本機缺 Node/npm 未執行。

### 2026-05-29：樣品分類、EXAFS、PlotFileTool 大量擴充

- 樣品分類面板推到 Raman / XRD / XAS / XPS / XES；sidebar 改為資料來源摘要卡，並支援分組套用。
- XAS 樣品分類新增可拖曳 / 可調尺寸的疊圖比對 modal，支援 TEY / TFY 通道與籃子快取。
- XAS 拆成 XANES / EXAFS / CBM；EXAFS 從前端 preview 進化成後端 `/api/xas/exafs`，支援 SciPy preview 與 Larch autobk / xftf 路線。
- 已安裝 `xraylarch 2026.2.0` 並在 `web/backend/requirements.txt` 新增 `xraylarch>=2026.2.0`。
- XAS / XPS 峰擬合新增「回上一步」snapshot stack。
- PlotFileTool 新增 XRD 多檔 trace 模式、XAS 531 eV leading edge 特殊擬合、XPS 位置調整模式。
- 多數前端改動當時以 `npm run build` 通過；後續本機 Node/npm 狀態曾變成不可用。

### 2026-05-24 至 2026-05-27：DFT Streamlit 與左側流程

- XPS DFT 工作區改為內嵌 Streamlit iframe，來源使用 `VITE_DFT_STREAMLIT_URL` 或預設 `http://127.0.0.1:8505/?embed=true`。
- DFT Streamlit UI 中文化，所有 XPS / VB 相關圖與 CSV 維持 X 軸由大到小。
- `Ga2O3_VB_Analyzer` 相關 Python 檔以 `uv run python -m py_compile` 驗證通過。
- 重作導引式左側步驟流程，新增共用 `GuidedSidebarSection`，XPS / XAS / XES / Raman / XRD 逐步接入。
- 本地曾補裝 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities` 解決 Vite import 失敗。

## 精簡動作紀錄

- [2026-07-27] 重要判斷：使用者要求整理 `CLAUDE.md`；確認原檔案同時包含前置流水帳與舊版短手冊，資訊重複且近期紀錄分散，決定整份重組為短版協作手冊。
- [2026-07-27] 實作：重寫 `CLAUDE.md` 結構，保留協作規則、專案定位、技術棧、驗證慣例、關鍵約定、模組現況與 2026-05-24 至 2026-07-16 的重要變更摘要；刪除重複逐步流水帳。
- [2026-07-27] 檢查：整理後執行 `git diff --check` 通過，僅有既有 LF/CRLF 換行提示；`git diff --stat` 顯示 `CLAUDE.md` 大幅精簡。
- [2026-07-27] 檢查：最終確認工作樹只有 `CLAUDE.md` 修改；整理後檔案長度約 178 行。
