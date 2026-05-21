# Nigiro Pro — AI Agent 快速參考

> 這份文件與 `CLAUDE.md` 同步，提供給 AI Agent 快速了解本專案核心資訊。

## 專案簡介

Nigiro Pro 是光譜資料處理網頁應用，目前維護 `web/` 目錄內的 FastAPI + React/Vite 網頁版。離線 Streamlit 桌面版在獨立 repo。

- 網頁版主倉庫：`https://github.com/liupei-wq/Data-Processing-GUI`
- Render 線上站：`https://data-processing-gui-web.onrender.com/`

## 技術棧

| 層級 | 技術 |
|---|---|
| 前端 | React 18.3 + Vite 8.0 + TypeScript 5.2 + Tailwind CSS 3.4 |
| 圖表 | Plotly.js 2.32 + react-plotly.js 2.6（必須走 `PlotlyChart.tsx` 兼容層） |
| 後端 | FastAPI 0.111 + Python 3.11 |
| 科學計算 | NumPy 1.26, SciPy 1.12, pandas 2.0, lmfit 1.3 |
| 部署 | Docker 多階段 build → Render (free) |

## 目錄結構

```text
web/
├── backend/
│   ├── main.py              # FastAPI 入口（CORS、health、static files）
│   ├── requirements.txt
│   ├── core/                # parsers / processing / peak_fitting / spectrum_ops
│   ├── db/                  # raman / xrd / xps / xes database
│   └── routers/             # xrd.py / raman.py / xas.py / xps.py / xes.py
├── frontend/
│   ├── package.json         # engines: node >=22 <25, npm >=10
│   ├── src/
│   │   ├── App.tsx          # 主題(12) / 字體(3) / 大小(3) / workspace 路由
│   │   ├── main.tsx         # RootErrorBoundary
│   │   ├── index.css        # CSS 變數主題
│   │   ├── pages/           # XRD / Raman / XAS / XPS / XES / SingleProcessTool
│   │   ├── components/      # WorkspaceUi / ProcessingPanel / PlotlyChart / ...
│   │   ├── api/             # xrd / raman / xas / xps / xes / http client
│   │   ├── types/           # TypeScript interfaces
│   │   └── hooks/           # usePlotPopups
│   └── public/              # nigiro-icon.svg / nigiro-icon-light.svg
├── Dockerfile               # node:24-alpine → python:3.11-slim 多階段
└── static/                  # production build output（Dockerfile 產生）

scripts/                     # PowerShell + Bash 快速啟動腳本
render.yaml                  # Render Blueprint
railway.toml                 # Railway 設定
```

## 分析模組與狀態

| 模組 | 狀態 | 後端 Prefix | 前端 Page |
|---|---|---|---|
| XRD | ✅ 完整 | `/api/xrd` | `pages/XRD.tsx`（含弱峰轉換圖譜匯出） |
| Raman | ✅ 完整 | `/api/raman` | `pages/Raman.tsx` |
| XAS | ✅ 完整 | `/api/xas` | `pages/XAS.tsx` |
| XPS | ✅ 最完整 | `/api/xps` | `pages/XPS.tsx` |
| XES | ✅ 1D 完整 | `/api/xes` | `pages/XES.tsx` |
| SEM | ⏳ 未實作 | — | — |

**SingleProcessTool（單一處理）：** 背景扣除 / 歸一化 / 高斯模板扣除

## 關鍵約定

1. **只修改 `web/` 目錄**；桌面版在獨立 repo
2. **Plotly 必須走兼容層**：所有 `Plot` 匯入應來自 `components/PlotlyChart.tsx`，避免 production React #130
3. **XPS x 軸反轉**：binding energy 高 BE 在左，`autorange: 'reversed'`
4. **高斯面積換算**：`area = peak_height × fwhm × 1.0645`
5. **不可變資料優先**：建立新物件，不直接修改現有物件
6. **錯誤處理**：每一層都要處理錯誤，禁止靜默吞掉例外
7. **輸入驗證**：在系統邊界驗證所有輸入
8. **Excel 匯入**：後端 parser 支援 `.xlsx` / `.xls`，部署需包含 `openpyxl` / `xlrd`
9. **XAS 分階段圖卡**：XAS 主圖以階段顯示，且每階段仍維持 TEY / TFY 左右並排；背景與歸一化需用 Plotly shape/annotation 標示取量範圍
10. **XPS 疊圖分支**：疊圖模式預設不平均，會讓多筆資料各自套同一組處理參數後分階段疊圖；第 3 步「平均所有疊圖數據」開啟後才用平均光譜做峰擬合 / RSF。不平均疊圖時峰擬合與 RSF 必須鎖定停用。
11. **XPS 第 2 步 UI**：XPS 的單筆 / 疊圖入口要整合在 sidebar 第 2 步「內插 / 資料模式」，不要在中間欄再放第二套模式切換；XPS 疊圖圖卡維持上下堆疊，不照搬 XAS 左右並排

## 常用指令

```bash
# 後端啟動（repo root）
cd web && uvicorn backend.main:app --reload --port 8000

# 前端啟動
cd web/frontend && npm run dev

# 前端建置
cd web/frontend && npm run build

# 後端語法檢查
python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py

# PowerShell 快速啟動
.\scripts\run_backend.ps1
.\scripts\run_frontend.ps1
```

## 部署

- **Render**：讀取 `render.yaml`，Docker runtime，free plan
- **Railway**：讀取 `railway.toml`，`builder=DOCKERFILE`
- Dockerfile 多階段 build，context 為 repo root
- Production 靜態檔由 FastAPI `StaticFiles` 從 `static/` 目錄提供

## 注意事項

- 2026-05-15：`XAS Athena 處理` 新增線性背景扣除與歸一化微調；左側新增全域微調卡，可開關線性扣背景並調整背景斜率/截距、歸一化倍率/平移。微調會套用到所有 scan 的 normalized / flattened 曲線，並同步進入平均、手動刪峰/加回、CSV 匯出與 OriginPro 產檔腳本。驗證 `cd web/frontend && npm run build` 通過。
- 2026-05-15：`XAS Athena 處理` 的手動刪峰 / 加回資料 draft 區間支援直接在 Plotly 預覽圖上拖曳；藍色刪峰區與青綠色加回區可拖整塊或左右邊界，左側 start/end 拉桿數值會同步更新。`PlotlyChart.tsx` 兼容層新增 `onRelayout` 轉發。驗證 `cd web/frontend && npm run build` 通過。
- 2026-05-15：`XAS Athena 處理` 右側預覽新增最終結果圖；上方保留 raw/平均與可拖曳區間，下方獨立顯示目前 selected sample 經微調、刪峰/加回後的 clean scan1、clean scan2 與 final average 曲線，並跟 Normalized / Flattened 切換同步。驗證 `cd web/frontend && npm run build` 通過。
- 2026-05-15：`Athena` 入口新增到分析頁左側 module tabs，顯示為 `Athena`，選取後進入既有 `tool-athena` workspace；右側 floating 選單依使用者要求暫時保留 Athena 入口。同步補 `MODULE_CONTENT.athena` metadata。驗證 `cd web/frontend && npm run build` 通過。
- 每次任務結束後即時更新 `CLAUDE.md` 與 `AGENTS.md`
- `README.md` 預設使用繁體中文
- Render 免費方案閒置後會休眠，首次請求較慢
- 前端 bundle 較大（Plotly），目前尚未實作 lazy loading
- 2026-05-05：新增 Excel 匯入、Area 歸一化正面積相容修正、XPS Area 歸一化單點/重複 x fallback 與右側 y 軸顯示、XPS VBM 外推線顯示範圍修正；驗證 `py_compile`、`npm run build`、`git diff --check` 通過。
- 2026-05-06：XAS 新增 `Mean Region` 歸一化；確認 `Post-edge Step` 與 XPS `Mean Region` 不同，前者為 `(y-pre_mean)/(post_mean-pre_mean)`，後者為 `y/mean(region)`；XAS 主圖改為原始/前處理/背景/歸一化/最終分階段 TEY+TFY 並排圖卡，背景與歸一化取量範圍會顯示在圖上。驗證 `py_compile`、`npm run build`、`git diff --check` 通過。
- 2026-05-06：修正 XAS 背景扣除造成 `/api/xas/process` 500：`apply_background` 需用 `bg_x_start/bg_x_end`，且回傳第一值才是扣背景後光譜；背景區間未設定時後端 fallback 到全譜。
- 2026-05-06：XAS 內插新增像 XPS 的自動偵測點數；前端依 energy 軸 median step 估算有效點數（200–10000），側欄顯示自動建議與每檔步距變化，所有分階段處理共用同一個 `effectiveNPoints`。
- 2026-05-06：XPS 疊圖模式改為預設不平均，多筆資料會各自處理後分階段疊圖；Section 3 可明確啟用「平均所有疊圖數據」，啟用後才用後端 `average` 單一光譜做峰擬合與 RSF。不平均疊圖分支會鎖定峰擬合 / RSF。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-07：XPS 第 2 步改為「內插 / 資料模式」，把中間欄的單筆 / 疊圖入口搬回 sidebar；XPS 圖卡改為上下堆疊顯示；疊圖各階段改用逐筆獨立線色，圖卡上方可手動改每筆線色，右上角色盤選單可重排整組疊圖色盤。驗證 `npm run build` 通過。
- 2026-05-07：XPS 資料庫更新 Ga 3d 與 O 1s：Ga 新增 reduced Ga（Ga+ / Ga0 / oxygen-deficient, 18.5-20.0 eV）與 Ga3+ in Ga2O3（20.3-20.9 eV）；O 1s 改為 OI Ga-O-Ga lattice、OII defect / oxygen vacancy、OIII OH / adsorbed O / H2O、NiO lattice reference。驗證 `.venv\Scripts\python.exe -m py_compile web\backend\db\xps_database.py` 通過。
- 2026-05-07：追加 XPS Ga 區 `O 2s reference (22.8-23.8 eV)`，初始 BE 使用 23.3 eV。驗證 `.venv\Scripts\python.exe -m py_compile web\backend\db\xps_database.py` 與 `git diff --check` 通過。
- 2026-05-07：依使用者指定修正 XPS Ga 區 O 2s 參考峰：將單一 `O 2s reference` 拆成 `O 2s beta-Ga2O3 (23.1-23.8 eV)` 與 `O 2s NiO (22.8-23.4 eV)`，初始 BE 分別為 23.45 與 23.1 eV。驗證 `.venv\Scripts\python.exe -m py_compile web\backend\db\xps_database.py` 與 `git diff --check` 通過。
- 2026-05-07：XPS VBM 算法再改為更貼近使用者操作的版本：先把兩個輸入 x 值映射到實際光譜點，再以各點附近 20% 搜尋窗組候選點對；切線取最大正斜率，基準線取最平斜率，兩條線交點作為 VBM。前端中間欄明確顯示輸入對應點（空心 marker）、實際選點（實心 marker）、兩條線與 VBM，Sidebar / TXT / JSON 也同步顯示搜尋窗與選點資訊。驗證 `py_compile`、`npm run build`、`git diff --check` 通過。
- 2026-05-07：確認 XPS「VBM 控制有出現，但中間欄圖卡沒出現」的主因是 render 條件不一致：Step 8 sidebar 在 overlay 模式也會顯示，但中間欄 `VBM 線性外推圖` 仍硬鎖 `processingViewMode === 'single'`。已改為統一使用 `vbmDataset`（single 用 `activeDataset`，overlay 用 `overlayPrimaryDataset`），讓 VBM 預覽、建議區間、計算按鈕與圖卡都跟同一筆資料走；疊圖模式會明確提示目前使用哪筆資料畫線。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-07：XPS `VBM 線性外推圖` 改為局部視窗顯示。根因是切線 / 基準線原本沿整張光譜寬度外推，導致 Plotly 的 y 軸 autoscale 被遠端外推值撐爆，原始光譜幾乎看不見；現已在 `web/frontend/src/pages/XPS.tsx` 新增 `buildVbmPreviewWindow()`，依切線區間、基準線區間、實際選點與 VBM 交點動態決定局部 x/y 範圍，並讓兩條線只在這個局部範圍內繪製。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-07：依使用者回饋精簡 XPS `Leading edge 提示`。已移除 `建議切線區間 / 建議基準線區間` 文案、兩顆 `自動建議...` 按鈕，以及背後整套自動建議 helper / effect / callback，避免畫面雜訊與系統自動改動手動區間；目前僅保留全域光譜與切線區間內的高低點資訊。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-07：合併 `origin/main` 時僅 `CLAUDE.md` 與 `AGENTS.md` 發生衝突，已手動整理為同時保留遠端 XPS 資料庫更新紀錄與本地 VBM/UI 修正紀錄；另確認 `web/backend/db/xps_database.py` 無衝突，驗證 `python3 -m py_compile web/backend/db/xps_database.py` 與 `git diff --check` 通過。
- 2026-05-07：XPS 峰擬合新增 Paper-style 擬合結果圖輸出；完成擬合後可在網頁預覽論文風格 component panel，調整原始/總擬合/component 顏色、字體、標籤位置、峰位標線、X/Y 範圍與 PNG/SVG 匯出尺寸。後續修正 dev 空白頁：匯出 API 改由 `PlotlyChart.tsx` 兼容層提供 `PlotlyApi`，避免動態匯入 `plotly.js` 原始包造成 Vite `buffer/` 解析錯誤。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-07：新增右側「選單 → 繪製圖檔」工作區，先啟用 XPS 多檔 fit spectra 繪圖：可匯入多個含 `Binding_Energy_eV` / `Observed` / `Total_Fit` / component 欄位的 TXT/CSV，輸出多 panel component figure、area ratio 堆疊圖與 component ratio 折線圖；支援 X 軸範圍、X/Y 軸字體大小、標籤位置、component 顏色、樣品名稱與 PNG/SVG 匯出設定。Raman/XRD/XAS/XES 分頁已預留。XPS 分析頁原本 paper-style 卡片改集中到此工作區。驗證 `npm run build` 通過。
- 2026-05-07：調整「繪製圖檔」介面為三欄：左側檔案清單、中間圖表預覽、右側 sticky 參數面板；component 樣式改為可展開細項，減少橫向表單壓縮。修正比例圖 subplot：`xaxis/yaxis` 與 `xaxis2/yaxis2` 明確 anchor，並加大左右 margin，避免 ratio 圖 Y 軸 title 跑位。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-07：繪製圖檔新增 X/Y 軸標題與軸線間距控制，對 component panels 與 area/ratio 圖的軸 title 套用 Plotly `title.standoff`；右側圖面設定新增「X 標題距離」「Y 標題距離」。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-07：繪製圖檔新增「框線粗細」控制，套用到 component panels 與 area/ratio 圖所有 X/Y 軸的 Plotly `axis.linewidth`。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-07：繪製圖檔 component 標籤文字支援下標；標籤輸入可用 `O_{latt}` 或 `O_latt` 自動轉成 Plotly HTML `<sub>`，也保留直接輸入 `<sub>` 的能力；套用於 panels annotation、summary legend 與 ratio 軸標題。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-07：修正繪製圖檔下方比例圖跑版：summary figure 左右 domain 改為 bar `[0, 0.44]`、ratio `[0.63, 1]`，加大中間留白；X 軸固定為 category 並使用 sample 順序；legend 移到左側 bar 圖內，ratio 線不顯示 legend。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-07：繪製圖檔新增 XPS combined publication figure 輸出，將左側 a 的多 panel XPS 圖與右側 b/c 的 area ratio、component ratio 合併成單張圖；Raw data 可切換線、圓圈、線+圓圈並調整圓圈大小/線寬/填色，Component 樣式新增一鍵套用 `O<sub>Ⅰ</sub>` / `O<sub>Ⅱ</sub>` / `O<sub>Ⅲ</sub>` 標籤、顏色與標籤位置。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-07：繪製圖檔 component 標籤連線改為指向標籤文字底部，讓 OⅠ/OⅡ/OⅢ 百分比括號下方作為連線終點，而不是標籤文字中央。
- 2026-05-07：取消繪製圖檔的 Combined publication figure 顯示與匯出入口，保留分開的 XPS component panels 與 Area ratio / component ratio 圖；Raw 圓圈與 OⅠ/OⅡ/OⅢ 標籤控制仍保留。驗證 `npm run build` 通過。
- 2026-05-07：繪製圖檔 summary 圖 b 的 component legend 從 bar plot 框線內移到框線外右側空白區，避免與柱狀圖重疊。
- 2026-05-08：改善右側選單入口可見性；「分析模組」與「工具」改為同時顯示，並標示目前 workspace，讓「繪製圖檔」固定出現在右側選單的工具區，避免進入「繪製圖檔」或單一處理工具後看不到工具入口；選單面板新增最大高度與內部滾動。驗證 `npm run build`、`git diff --check` 通過。
- 2026-05-08：繪製圖檔工作區新增獨立 XPS `VBM 線性外推` 子模式，與既有 XPS 峰擬合圖分開；可匯入多個 VBM CSV/TXT/TSV，前端自動判斷 Binding Energy / intensity 欄位、最大值歸一化、依各樣品 baseline / tangent 區間計算 VBM，並輸出 stacked 外推圖、單張外推圖、VBM summary 圖與 CSV/TXT summary；支援圖面顏色、字體、軸範圍、線寬、區間透明度、匯出尺寸與 PNG/SVG 匯出。驗證 `npm run build` 通過。
- 2026-05-08：繪製圖檔 XPS `VBM 線性外推` 新增 VBM 標籤位置控制；右側 VBM 圖面設定可調整 `VBM = ... eV` 標註的 X/Y 像素偏移，並同步套用到 stacked 圖與每組單張外推圖。
- 2026-05-08：繪製圖檔 XPS `VBM 線性外推` 算法改為與 XPS 分析區一致：輸入範圍先映射到最近光譜點，起終點附近各取 20% 搜尋窗；切線選最大正斜率候選點對，基準線選最平斜率候選點對，兩線交點作為 VBM。圖上的 baseline 改為斜率線而非水平平均線，CSV/TXT summary 同步輸出切線與基準線 slope/intercept/實際選點。
- 2026-05-09：Raman 新增 Si 基板訊號校正扣除模組：`reference_fit` 會把 Si reference 插值到樣品 x 軸並最佳化 scale `a`、shift `dx`、局部線性 baseline，`fit_si_peak` 會直接以 Voigt 擬合樣品 520 cm⁻¹ Si peak；前端新增 Step 3 參數、Si residual region 診斷圖、扣除後疊圖、每樣品 corrected CSV 與 `si_subtraction_report.csv`。同時改善背景扣除卡頓：前端 Raman process 加 300 ms debounce 與 AbortController 取消過期請求，後端 Whittaker baseline penalty matrix 加 LRU cache。驗證 `py_compile`、`npm run build` 與合成 Si reference sanity check 通過。
- 2026-05-09：依使用者要求將 Raman 圖檔輸出集中到「繪製圖檔」Raman 分頁；Raman 分析頁移除 PNG 圖檔輸出入口，保留資料處理與 CSV/report 匯出。`PlotFileTool.tsx` 啟用 Raman 模組，可匯入 Raman fit JSON，重建 original spectrum、baseline、baseline-corrected spectrum、total fit、individual components 與 residual，下方獨立 residual panel，白底無 grid，支援字體/顏色/線寬/峰位標籤/歸一化/尺寸控制與 PNG/SVG 匯出。驗證 `py_compile`、`npm run build`、`git diff --check` 通過。
- 2026-05-09：Raman peak fitting 改為 staged fitting：後端 `/api/raman/fit` 先依 fitting window 裁切資料，檢查過曝、負值異常與 cosmic ray，再對裁切資料做 baseline correction；啟用的 literature/manual candidates 只在各自 center ± tolerance 內用局部最大值更新初始值，接著以 least-squares global constrained fitting 搭配 robust loss（linear 會轉為 soft_l1）擬合。新增 reduced chi-square 與 staged diagnostics；auto peak 僅在 residual 呈系統性峰形且 AIC/BIC 明顯改善時加入。前端預設 robust loss 改為 `soft_l1`，fitting window 裁切結果改用回傳 x/y 繪圖，並顯示 reduced χ²。驗證 `py_compile`、`npm run build`、`git diff --check` 通過。
- 2026-05-09：Raman 峰擬合最終結果圖新增單峰 contribution curves。後端 `/api/raman/fit` 新增 `components`、`total_fit_corrected`、`total_fit_raw`，每個 fitted peak 會保留 `center`、`fwhm`、`amplitude`、`area`、`area_percent`、`profile`、`component_label/group/material`、`y_component_corrected` 與 `y_component_raw`，並保證 `total_fit_corrected = sum(y_component_corrected)`、`total_fit_raw = baseline + total_fit_corrected`；report JSON 也一併帶出曲線資料，讓 Raman publication plot 可直接讀取。前端 `Raman.tsx` 主圖改為上方主圖 + 下方 residual 子圖，新增 `show components` / `fill components` / `show peak labels` 開關，主圖可畫每個 raw component curve 與峰位文字；summary table 與 Excel/CSV/report 欄位補入 `area`、`area_percent`、`component_label`、`component_group`。`PlotFileTool.tsx` 的 Raman publication plot 同步支援新 component/raw fit 結構與 fill toggle。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`cd web/frontend && npm run build` 通過。
- 2026-05-09：依使用者回饋調整 Raman component 標示方式：分析頁與 `PlotFileTool.tsx` 的 Raman publication plot 不再把 component label 疊寫在主圖曲線上，改為在結果圖上方保留獨立 component 對照區；各 component 對照會自動依寬度換行，分析頁文字顏色會對應各條 component 曲線色，避免圖內文字遮到峰形。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-10：Raman fitting 結果圖標籤改為逐 component 標示。後端在 `raman_database.py` 集中建立 `RAMAN_PEAK_ASSIGNMENTS`，`/api/raman/fit` 依 fitted center 自動匹配 assignment，統一輸出 `Peak_Name`、`component_label`、`assignment`、`label_type` 與 report CSV；tentative/NiO/defect 類 peak 會標示為 possible/tentative。前端 `Raman.tsx` 與 `PlotFileTool.tsx` 移除上方大型分類文字，改讓每條 fitted component 在 legend 與 peak center annotation 使用同一 label、同一顏色，並用垂直虛線/箭頭指向對應 peak，近峰標籤會自動上下錯開。驗證 `python3 -m py_compile web/backend/routers/raman.py web/backend/db/raman_database.py`、`cd web/frontend && npm run build` 通過。
- 2026-05-10：改善 XAS 扣背景時卡頓。`web/frontend/src/api/xas.ts` 的 `processData` 支援 `AbortSignal`，`web/frontend/src/pages/XAS.tsx` 的自動處理 effect 會取消過期 `/api/xas/process` 請求，並依實際開啟的前處理 / Gaussian / 背景 / 歸一化階段重用等價 stage 結果，避免背景扣除被最終圖與背景預覽重複計算。驗證 `cd web/frontend && npm run build` 通過。
- 2026-05-11：Raman 分析頁擬合結果圖新增全螢幕 overlay，component peak labels 改為圖框上方標籤帶避免遮住曲線；「繪製圖檔」Raman 分頁新增單一擬合圖 / 多樣品疊圖模式、峰顯示勾選、可信度篩選，並移除 publication plot 下方 residual panel。驗證 `git diff --check` 通過；目前工具環境找不到 Node/npm，未能執行 `npm run build`。
- 2026-05-11：依使用者要求復原上一輪 Raman fitting 修改（v23.2 反向套用），回到 v23.1 的 Raman fitting 狀態；保留 v23.1 的 Raman 圖表全螢幕、峰顯示篩選與多樣品疊圖功能。
- 2026-05-11：已將 Raman fitting 復原提交推送到 origin/main，用於同步線上網頁；目前保留 v23.1 的 Raman 圖表全螢幕、峰顯示篩選與多樣品疊圖功能。
- 2026-05-12：右側選單在「分析模組」區新增明確的 `XAS Athena 處理` 入口，排在 XAS 後方，用於 Athena `.xmu` 資料夾分樣品處理、normalized / flattened 預覽與 Origin CSV/TXT 匯出；驗證 `cd web/frontend && npm run build` 通過。
- 2026-05-12：`XAS Athena 處理` 預覽圖改用高對比線色，平均曲線改深色；新增「手動刪峰」滑桿，可選 scan1 / scan2 / 兩筆 scan 的 energy 區間，加入後會在圖上以淡橘色區塊標示，並於平均前將該區間併入 removal mask 內插處理，CSV/TXT 匯出同步反映手動刪峰結果。驗證 `cd web/frontend && npm run build` 通過。
- 2026-05-12：收斂 `XAS Athena 處理` 版面，左側上傳/匯出/手動刪峰卡片改為 compact，主 grid 左欄由 22rem 縮至 18–19rem；樣品清單從圖左側移到圖上方橫向按鈕，避免吃掉 Plotly 寬度造成圖跑版；預覽圖高度固定 500px，legend 移到下方左側。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-12：`XAS Athena 處理` 手動刪峰滑桿拖拉時新增藍色半透明 draft 區間，與已加入的橘色刪峰區間區分，讓使用者拖曳左右邊界時能即時看見目前選取範圍。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-12：`XAS Athena 處理` 新增「匯出 OriginPro 產檔腳本」；網頁會將目前處理結果、手動刪峰後平均資料與 raw scan 嵌入 `.py`，使用者在有 OriginPro / originpro package 的 Windows 電腦執行後會自動建立 worksheet、normalized / flattened overlay graph，並輸出 `Athena_XMU_processed.opju`。瀏覽器/Render 無法直接寫 `.opju`，需靠本機 OriginPro API 產檔。驗證 `cd web/frontend && npm run build` 通過。
- 2026-05-12：放寬 `XAS Athena 處理` 自動刪峰判定：`SPIKE_DIFF_MAD_FACTOR` 由 4.5 降至 3.0，`PEAK_EDGE_THRESHOLD_RATIO` 由 0.35 降至 0.25，讓差異峰更容易被偵測且峰腳區段更容易納入 removal mask；手動滑桿刪峰不變。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-12：修正 `XAS Athena 處理` 匯出的 OriginPro 產檔腳本相容性：raw scan worksheet 改用樣品+檔名避免重名，`wks.from_list` 與線色設定加入 fallback；已同步修補 `C:\Users\User\Downloads\athena_create_origin_project_20260511_204722.py` 並成功產生 `C:\Users\User\Downloads\Athena_XMU_processed.opju`。驗證下載腳本 `py_compile`、`cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-12：`XAS Athena 處理` 自動刪峰改為可調靈敏度，於手動刪峰區新增「標準 / 寬鬆 / 很寬鬆 / 極寬鬆」選單；寬鬆為目前預設（MAD 3.0 / 邊界 0.25），很寬鬆為 MAD 2.2 / 邊界 0.18，極寬鬆為 MAD 1.6 / 邊界 0.12，讓使用者可先用更寬鬆自動 removal mask 多抓峰，再用手動滑桿補刪或微調。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-12：`XAS Athena 處理` 新增加回誤刪資料功能；在手動刪峰區新增 Restore 綠色拉條，可選 scan1 / scan2 / 兩筆 scan 的 energy 區間，最終 mask 流程為自動刪峰 → 手動刪峰 → 手動加回，restore 區間會將 removal mask 清為 0，使該段使用原始資料參與平均；圖上加回區間以綠色顯示，拖拉中的加回區間以青綠色顯示。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-12：`XAS Athena 處理` 右側「樣品與預覽」圖卡在桌面版改為 sticky，使用者捲動左側自動刪峰/手動刪峰/加回資料控制時，處理圖會固定在視窗內；sticky 容器加上 `max-height: calc(100vh - 2rem)` 與內部滾動，避免矮視窗卡住。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-12：改善 `XAS Athena 處理` 刪峰/加回滑桿拖曳頓挫；滑桿數值仍即時更新，但圖上的 draft 區間改用 80ms debounce 後才觸發 Plotly 重畫，降低拖曳時的 Plotly relayout 頻率。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-12：`繪製圖檔` Raman 多樣品疊圖新增可勾選參考峰資料庫 `web/frontend/public/peak_database/default_raman_peaks.json`；疊圖可顯示 Ga2O3 / NiO / Si 參考峰垂直線、結構底色標籤、Si interference 灰區與 zoom-in 子圖，並支援匯出所選峰表與各樣品參考峰附近實測最大值比對 CSV；Raman 匯入同時支援 fit JSON 與兩欄式 TXT/CSV/DAT。驗證 JSON 解析與 `git diff --check` 通過；目前工具環境找不到 npm，未能執行 `npm run build`。
- 2026-05-12：XAS Athena 網頁 parser 支援 8 欄與 9 欄 Athena .xmu；8 欄缺少 chi(e) 時自動以 0.0 補入，錯誤訊息改為至少 8 欄。另補 PlotFileTool Raman local maximum 回傳型別，驗證 cd web/frontend && npm run build、git diff --check 通過。
- 2026-05-12：依使用者要求擴充 `繪製圖檔` Raman 疊圖參考峰：β-Ga2O3 / NiO 資料庫加入共振態欄位並預設全選，標籤改為純文字並依材料著色，不再使用四面體/八面體底色；右側可逐一調整每個共振峰標籤 X/Y 位置，並可調整整體標籤視窗位置。Raman 檔案清單新增每筆數據線色、垂直位置、數據名稱 X/Y 位置控制。驗證 JSON 解析與 `git diff --check` 通過；目前工具環境找不到 npm，未能執行 `npm run build`。
- 2026-05-12：同步前確認本地 Raman 疊圖參考峰與文件紀錄變更；git diff --check 與 JSON 解析通過，準備提交後接上 origin/main V25.1。
- 2026-05-12：本地提交已建立（Enhance Raman overlay reference controls），準備 rebase 到 origin/main V25.1 接上遠端最新變更。
- 2026-05-12：同步 rebase 時 AGENTS.md / CLAUDE.md 文件紀錄衝突，已保留遠端 V25.1 Athena parser 紀錄與本地 Raman 疊圖同步紀錄。
- 2026-05-12：同步 rebase origin/main V25.1 成功，已解決 AGENTS.md / CLAUDE.md 文件紀錄衝突；準備最終檢查與推送。
- 2026-05-12：推送前 conflict marker 掃描、git diff --check origin/main..HEAD、Raman reference JSON 解析通過；目前工具環境找不到 npm，未執行 npm run build。
- 2026-05-12：同步完成，已將 Raman 疊圖參考峰控制變更推送到 origin/main（eeafcbd..e07da12），遠端已接上 V25.1 後的新提交。
- 2026-05-12：Raman 繪圖 overlay 參考峰新增可編輯理論值與自訂顯示名稱；每峰可單獨還原，整體預設會還原所有理論值/名稱；右上角 overlay legend 預設關閉並新增顯示開關。驗證 git diff --check 與 JSON 解析通過；目前工具環境找不到 npm，未執行 npm run build。
- 2026-05-15：依使用者要求以 GitHub 為主同步本地 repo；確認 `main` 原本 `ahead 1, behind 43`，已建立備份分支 `backup_github_sync_20260515_2265a2b` 後執行 `git fetch origin` 與 `git reset --hard origin/main`，目前 `HEAD=8a0ae72`（`v25.3`）且 `main` 已對齊 `origin/main`。
- 2026-05-15: XAS Athena manual removal/restore editor was unified behind a two-option mode selector. Only the selected mode now shows its editable draft range on the Plotly preview, and drag relayout updates only that active draft. Verification: `cd web/frontend && npm run build` passed.
- 2026-05-15: XAS Athena OriginPro export script now creates per-sample final normalized and final flattened graphs that match the web final-result view: clean scan1, clean scan2, and final average. Existing all-sample average overlay graphs are still exported. Verification: `cd web/frontend && npm run build` passed.
- 2026-05-15：依使用者要求 merge GitHub 檔案；執行 `git fetch origin` 後將 `origin/main` merge 到本地 `main`，程式碼檔自動合併完成，僅 `CLAUDE.md` 與 `AGENTS.md` 需要手動解決文件衝突，已保留遠端 `v25.4/v25.5` 與本地 `v25.6` 相關紀錄。
- 2026-05-15：修正 XPS Valence Band `VBM 線性外推圖` 的視窗抖動 bug；`web/frontend/src/pages/XPS.tsx` 原本會依切線/基準線當前選點動態重算 VBM 圖的 `xaxis.range`、`yaxis.range` 與外推線 `lineX`，造成拉動 slider 時整張圖跟著跑。現改為 `buildVbmStablePlotWindow()` 只依光譜本身範圍固定圖框，讓使用者調整切線/基準線時只更新線條與 marker，不再改變整張數據圖。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-15：將 XPS 的多檔平均 UI 併回第 2 步「內插 / 資料模式」，改成和 XAS 一樣在切到疊圖後直接顯示「平均所有疊圖數據」按鈕，移除原本獨立的第 3 步 `多檔平均` section，後續步驟編號整體前移，並把疊圖 modal 提示改成「第 2 步啟用多檔平均」。`web/frontend/src/pages/XPS.tsx` 仍保留 XPS 現有的「取消平均，改回疊圖比較」能力。驗證 `cd web/frontend && npm run build`、`git diff --check` 通過。
- 2026-05-15：全面檢查 XPS 前後端流程與 UI 狀態，覆核 `web/frontend/src/pages/XPS.tsx`、`web/frontend/src/api/xps.ts`、`web/frontend/src/types/xps.ts`、`web/backend/routers/xps.py`、`web/backend/core/processing.py`；`npm run build`、`python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`git diff --check` 通過。Review 發現主要風險為：疊圖平均模式的 average dataset 未保留 `y_raw/y_background` 診斷資訊，會讓平均背景圖與匯出 raw 欄位語意錯誤；`apply_background()` 與 `apply_normalization()` 仍存在靜默 fallback，錯誤時只會回原始/零值光譜而不明確報錯。
- 2026-05-15：已修正 XPS 全檢查找到的主要 bug。`web/backend/routers/xps.py` 的 average dataset 現在會分別平均並保留 `y_raw`、`y_background`、`y_processed`，平均背景圖可正確顯示「扣背景前」與平均背景線，最終匯出的 raw 欄位不再誤寫成 processed。`web/backend/core/processing.py` 為背景扣除與歸一化補上 `strict` 模式，XPS router 改以 strict 呼叫，遇到無效區間、未知方法、無效 normalization factor 時會直接回 422，而非靜默回原值或全零。`web/frontend/src/pages/XPS.tsx` 新增 overlay error → `error` 同步，讓疊圖模式也能直接看到後端錯誤；另外移除主圖卡標題中的固定數字前綴，避免跟 sidebar step 編號再次脫節。驗證 `python3 -m py_compile web/backend/main.py web/backend/routers/*.py web/backend/core/*.py`、`cd web/frontend && npm run build`、`git diff --check` 通過。

- 2026-05-15: Web export/report timestamps now use a fixed UTC+8 timezone. Added `web/frontend/src/utils/time.ts` for `+08:00` ISO strings and UTC+8 filename timestamps, then applied it to Athena, XRD, and XPS exports/reports. Verification: `cd web/frontend && npm run build` passed.
- 2026-05-15: XAS Athena final average now respects manual removal/restore source selection. Removed points no longer contribute through interpolated clean curves, and restoring only scan1 or scan2 forces the final average in that interval to use that selected scan as the source. Verification: `cd web/frontend && npm run build` passed.
- 2026-05-14：Raman 繪圖區新增 Y 下限/Y 上限與 X 自動/Y 自動控制；X 左端/X 右端維持既有功能，Y 軸手動範圍套用到 single publication plot 與 overlay 主圖。驗證 git diff --check 與 JSON 解析通過；目前工具環境找不到 npm，未執行 npm run build。
- 2026-05-16：同步到 git 前執行 git diff --check 與 default_raman_peaks JSON 解析，兩者通過；目前工具環境找不到 node/npm，未執行 cd web/frontend && npm run build。
- 2026-05-16：同步 rebase origin/main 時僅 AGENTS.md / CLAUDE.md 發生文件紀錄衝突；已保留遠端 2026-05-15 紀錄、本地 2026-05-14 Raman Y 軸範圍紀錄與 2026-05-16 同步檢查紀錄。
- 2026-05-16：同步完成，已將 Raman 繪圖 Y 軸範圍控制變更 rebase 到 origin/main v26.1 後推送；遠端 main 由 e59617f 更新到 59aaa37。推送前確認 conflict marker 掃描、git diff --check origin/main..HEAD 與 default_raman_peaks JSON 解析通過；工具環境仍找不到 node/npm，未執行 npm run build。
- 2026-05-16：XES 新增能量校正檔上傳與自動套用 table calibration；前端可解析 channel-energy 校正檔、顯示校正摘要與 Energy order，後端依點數相同一對一或點數不同插值產生 `x_ev`。XES 分點扣背新增每筆 sample 量測序號與總量測次數，權重採 `(order-1)/(total-1)`，例如第 5/10 筆為 5/9 BG1 + 4/9 BG2。新增 calibrated CSV 匯出欄位 energy_eV、intensity、sampleName、original_x。驗證 `uv run python -m py_compile web/backend/routers/xes.py` 與 XES 相關檔案 `git diff --check` 通過；目前環境找不到 npm，未執行 `npm run build`。

- 2026-05-16：修正 XES process 500：後端對 sample x/y 長度、有限值、點數與 table calibration 後 x_ev/y 長度加防護，未知資料形狀改回 422 詳細錯誤；背景扣除缺 BG 檔時明確報錯。前端 BG1/BG2 overlay 在 Energy calibrated 模式下改用同一組 eV 校正軸。驗證 `uv run python -m py_compile web/backend/routers/xes.py` 與 XES 相關檔案 `git diff --check` 通過；目前環境找不到 npm，未執行 `npm run build`。
- 2026-05-16：修正 XES 歸一化失敗：`web/backend/routers/xes.py` 改用新版 `apply_normalization()` 呼叫方式（`norm_x_start/norm_x_end`、單一回傳 `y`），解決 Max/Min-Max/Area/參考區間歸一化啟用時失敗；XES UI 的 `reference_region` 會映射為後端 `mean_region`。驗證 `uv run python -m py_compile web/backend/routers/xes.py` 通過；目前環境找不到 npm，未執行 `npm run build`。

- 2026-05-19：繪製圖檔 XAS 分頁新增 XES/XAS band gap 疊圖工具；支援匯入兩欄式 XES 與 XAS 檔案、自動/手動樣品配對、XES 下降邊 VBM 與 XAS 上升邊 CBM 線性外推、Eg 計算、白底 stacked 圖與 PNG/SVG/CSV/TXT 匯出。驗證 git diff --check 與 conflict marker 掃描通過；目前環境找不到 node/npm，未執行 npm run build。

- 2026-05-19：同步至 Git 前已接上 origin/main v26.5，保留本地繪製圖檔 XAS/XES band gap 變更；git diff --check 與 conflict marker 掃描通過。目前 PowerShell 環境找不到 npm，未執行 npm run build。

- 2026-05-19：繪製圖檔 XAS/XES band gap 圖新增 Panel 標題文字與位置、樣品標籤字體/位置、VBM/CBM/Eg 標註位置控制；右側 XAS 圖面設定可調整 XES/XAS 標題座標、樣品標籤座標、VBM/CBM X 偏移與 Y 位置、Eg 文字與水平線 Y 位置。驗證 git diff --check 通過；目前環境找不到 npm，未執行 npm run build。

- 2026-05-19：繪製圖檔 XAS/XES band gap 圖新增 VBM、CBM、Eg 標註文字大小獨立控制；右側 XAS 圖面設定可分別調整 VBM 字體、CBM 字體與 Eg 字體。

- 2026-05-19：繪製圖檔 XAS/XES band gap 圖新增 XES 檔與 XAS 檔各自的 X 軸顯示範圍控制；每個檔案卡可調整顯示 X 起/迄並一鍵還原完整範圍，圖上曲線依各自範圍裁切，CSV/TXT summary 會輸出 display range。

- 2026-05-19：修正繪製圖檔 XAS/XES band gap 疊圖的強度處理；已歸一化到峰值 1 的上傳資料不再被 2%/98% 百分位數重新縮放，XAS 與 XES 最終圖會保留原始 normalized peak。驗證衝突標記掃描與 git diff --check 通過；目前工具環境找不到 node/npm/pnpm/yarn，未能執行 npm run build。

- 2026-05-21：XPS 峰擬合區新增「限制擬合範圍」功能；前端新增擬合範圍開關、DualRange slider、起迄 BE 數值輸入與全範圍重設，執行擬合 / 自動收斂時會傳送 fitRange 給既有 /api/xps/fit，單筆 dataset session 與處理報告 JSON 會保存範圍設定。驗證 git diff --check 通過、conflict marker 掃描無結果；目前環境找不到 npm/node/pnpm/yarn，未執行 npm run build。

- 2026-05-21：確認 XPS 擬合範圍功能已在 origin/main v26.9；為避免折疊狀態不易發現，將 XPS 第 6 步峰擬合 section hint 加上「擬合範圍」。

- 2026-05-21：同步完成，XPS 擬合範圍可見性補強已推送到 origin/main；遠端原 v26.9 已含功能本體，本次補強第 6 步峰擬合折疊 hint 顯示「擬合範圍」。

- 2026-05-21：XPS 移除峰擬合內部的限制擬合範圍 UI，改為背景扣除後新增第 5 步「有效數據範圍」處理程序；Core Level 流程現在為 7 項：載入檔案、內插/資料模式、能量校正、背景扣除、有效數據範圍、歸一化、峰擬合。後端 /api/xps/process 新增 valid_range_enabled/valid_x_start/valid_x_end，在背景扣除後裁切 x/y/y_raw/y_background，後續歸一化、峰擬合、匯出都使用裁切後資料。驗證 git diff --check、conflict marker 掃描、uv run python -m py_compile web/backend/routers/xps.py 通過；目前環境找不到 npm/node/pnpm/yarn，未執行 npm run build。

- 2026-05-21：同步完成，XPS 有效數據範圍第 5 步改動已推送到 origin/main（6702836）；Core Level 流程為 7 項，VBM/能帶偏移在 Valence Band 模式下接續為第 8/9 步。

- 2026-05-21：同步檢查：main 與 origin/main 差異為 0/0，最新提交為 f55aa91（Record XPS effective range sync）；補記本次同步確認紀錄。

- 2026-05-21：XPS 峰擬合的 Center 與 FWHM 限制新增固定值 / 範圍輸入；每個峰卡可在「中心限制」「FWHM限制」填單一數值固定，或填 `1~1.8` 這類範圍轉成 min/max bounds。自動收斂與擬合回寫 seed 時會保留自訂 bounds。驗證 git diff --check 通過、conflict marker 掃描無結果；目前環境找不到 npm/node，未執行 npm run build。
