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
