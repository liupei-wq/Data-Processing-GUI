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
  - `40-10`：藍色 `#136DE4`
  - `45-5`：紅色 `#E42213`
  - `50-0`：黑色 `#252526`

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
- XAS / XES band gap 線性外推需與 XPS VBM 一致：切線與基準線都對區間內所有點做最小平方直線擬合（後端 `routers/xps.py` `_fit_vbm_line`，前端 `XPS.tsx` `fitVbmLine`、`XAS.tsx` `fitEdgeLine`、`PlotFileTool.tsx` `fitVbmPlotLine`）；不要再用「兩點最大斜率」候選點搜尋（有系統偏差）。
- 方法、文獻與數值驗證整理在 `docs/METHODS_AND_REFERENCES.md`；改動演算法時要同步更新該文件並在 `web/backend/tests/` 補已知答案的測試。
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

- [2026-11-10] 重要判斷：使用者要求全專案嚴謹度審查（只審不改）後，再要求「全部修正」。審查以合成資料實測確認 7 項主要問題與數項次要問題，本次全部修正如下（分支 `fix/xps-fitting-accuracy`，PR #1）。
- [2026-11-10] 實作（VBM / 能隙）：`routers/xps.py` `_fit_vbm_line` 由「兩小段各挑一點取最大斜率」改為區間內所有點的最小平方直線擬合，新增 `_intersection_error` 回報 `vbm_err_ev`（±1σ）；前端 `XPS.tsx` `fitVbmLine`、`XAS.tsx` `fitEdgeLine`、`PlotFileTool.tsx` `fitVbmPlotLine` 同步改為最小平方，並更新說明文字。實測舊版 VBM 平均偏高 0.19 eV、新版偏差 < 0.01 eV。
- [2026-11-10] 實作（擬合核心）：`core/peak_fitting.py` 新增參數標準誤差（`_parameter_covariance` s²(JᵀJ)⁻¹、`_propagate_errors` 數值 Jacobian 傳遞到峰高/峰位/FWHM/面積，碰邊界參數視為固定並標記）與連動峰（`link_to` / `link_center_offset` / `link_area_ratio`，共用峰形與寬度）；面積計算抽成 `_area_for_profile`。
- [2026-11-10] 實作（XPS）：`/api/xps/fit` 新增 `doublet_constraints`（`_auto_doublet_links` 依「元素 + 次殼層 + 化學態」配對 j = l±1/2，面積比 (2j+1)、ΔSO 取 DOUBLET_INFO 或初始峰位差）、回傳 `Center_err/FWHM_err/Area_err/Height_err/Linked_To/Note` 與 `notes`，重啟失敗原因不再被吞掉；`db/xps_database.py` `get_orbital_rsf` 子能階找不到時依簡併度由總量換算、Ga 2p/Ge 2p 等可疑值加 ⚠ 標記；`/api/xps/rsf` 新增 `photon_energy`、`ke_exponent` 動能校正（C 1s 維持 1）。前端 `XPS.tsx` 新增雙峰約束勾選、±1σ 欄位、notes、χ² 改標 Σr²/(n−p)、RSF 可手動輸入與 KE 校正指數。
- [2026-11-10] 實作（XES）：`routers/xes.py` 修正 `y, _ = smooth_signal(...)` 造成開平滑必定 422 的 bug；改為先在原始計數扣 BG1/BG2 再除 I0（raw / bg 曲線同步除 I0）。
- [2026-11-10] 實作（XAS）：`_normalize_athena` flatten 只套用在 E ≥ E0（與 Athena/Larch 一致）；新增 `_smoothed_derivative`（Savitzky–Golay，非均勻網格先重取樣），E0 偵測與二次微分改用它，`ProcessParams` 新增 `d2y_window`、`d2y_poly`；多檔平均失敗改回 422 而非靜默略過；XAS 峰擬合回傳 ±1σ 與 notes。
- [2026-11-10] 實作（XRD）：後端 `WAVELENGTHS` 與前端 `ProcessingPanel.tsx` / `types/xrd.ts` 改為一致的 Kα1 與加權 Kα 平均（ITC Vol. C）；新增 Rachinger Kα2 去除（後端 `core/processing.py` `strip_kalpha2` + `ProcessParams.kalpha2_*`，前端 `XRD.tsx` `stripKalpha2` + 開關）；`XRD.tsx` FWHM/Scherrer 改用線性強度 `yLinear`（舊版用 log/sqrt 顯示曲線量 FWHM）、Scherrer 新增儀器展寬 β_inst 與 Gaussian/Lorentzian 校正模型，記錄與匯出同步新增欄位。
- [2026-11-10] 實作（Raman）：`routers/raman.py` 峰位/FWHM 誤差優先用擬合共變異矩陣，新增 `Uncertainty_Method`；`db/raman_database.py` Kranert 引用改為 Sci. Rep. 6, 35964 (2016)；`Raman.tsx` Si 應力係數改為 De Wolf (1996) 單軸 −2.0 / 雙軸 −4.0 預設選項，Si 峰改依 Material/Phase_Group 為 Si 且最接近參考位置選取。
- [2026-11-10] 實作（共用與 Ga2O3）：`smooth_signal` 移動平均改用端點延伸而非補 0；`Ga2O3_VB_Analyzer/src/fitting.py` 比例改用「係數 × 成分積分」；`pdos_acquisition.py` 能量改對齊 DFT VBM（`dos.get_cbm_vbm()`，失敗才退回 E_F 並提示）；`pdos_model.py` 修正截面係數被平方的 bug、新增 Ga_4s 群組；`app.py` 未加權截面時顯示警告與截面文獻。
- [2026-11-10] 實作（文件與測試）：新增 `docs/METHODS_AND_REFERENCES.md`（各模組方法、程式位置、文獻、限制、驗證）、`web/backend/tests/test_rigor_audit.py`（16 項已知答案測試）；README 連到該文件。未實作：TFY 自吸收校正（需組成/角度/吸收係數，文件中列為限制）、內建光電離截面數值（無法查證，改為使用者輸入並警告）。
- [2026-11-10] 檢查：`uv run --no-project --with pytest --with numpy --with scipy --with pandas --with fastapi --with pydantic --with python-multipart python -m pytest tests -q` 24 passed；Python 3.11 + NumPy<2 + SciPy<1.14 再跑 24 passed；`py_compile` 後端與 Ga2O3 全部通過；前端 `npm.cmd ci` 後 `npm.cmd run build`（tsc + vite build）通過（僅既有 chunk 大小警告）。以原審查腳本重跑：XES 平滑不再報錯、移動平均邊緣維持 100、VBM 平均 3.002 eV、pre-edge flatten 0.000、pDOS 比例 90.9/9.1%。
- [2026-11-10] 重要判斷：使用者要把原始碼給教授檢查 XPS 擬合。以已知答案的合成光譜驗證後，確認擬合引擎與 Shirley 公式正確，但發現 Voigt / split pseudo-Voigt 面積被截尾低估（最多約 8%）、Tougaard 在結合能座標方向相反、Shirley 端點只取單點對雜訊敏感、Shirley 累積面積有半個取樣點的不對稱。
- [2026-11-10] 實作：`core/peak_fitting.py` 的 `area_voigt` 改為解析解 `A / V(0; σ, γ)`，`area_split_pseudo_voigt` 改為左右半邊 pseudo-Voigt 解析面積平均（同時移除 NumPy 1.26 沒有的 `np.trapezoid` 依賴）。注意：Raman / XPS 用 Voigt 的面積會比舊版大 1–8%。
- [2026-11-10] 實作：`core/processing.py` 新增 `_edge_level`；`shirley_background` 端點改為兩端各 `end_points`（預設 5）點平均、改用中點累積面積（正反序結果完全一致）並加入收斂判斷；`tougaard_background` 改為結合能座標的正確方向（由低 BE 往高 BE 積分）、先扣除低 BE 端常數，C≤0 會丟 ValueError；`apply_background` 新增 `edge_points` 參數。
- [2026-11-10] 實作：`routers/xps.py` 的 `ProcessParams` 新增 `bg_end_points`（預設 5，範圍 1–50）並傳入背景扣除；前端未改，沿用後端預設值。
- [2026-11-10] 實作：新增 `web/backend/tests/test_xps_fitting.py`（8 項中的 7 項 XPS 驗證：合成 O 1s 擬合回真值、Shirley 正反序一致、端點平均降噪、Voigt 面積解析解、split pseudo-Voigt 面積、Voigt 擬合回真面積、Tougaard 方向）；README 新增「XPS 擬合：程式碼位置與數值驗證」章節。
- [2026-11-10] 檢查：`uv run --no-project --with pytest --with numpy --with scipy python -m pytest tests -v` 8 passed（含既有 XAS 測試）；以 Python 3.11 + NumPy<2 + SciPy<1.14 再跑一次 8 passed；`py_compile` 通過。帶雜訊（σ=8）50 次重複：面積比標準差 端點 1 點 8.28% → 5 點 4.14%。前端未改動，未跑 build。
- [2026-08-07] 檢查：最終 `git diff --check` 通過（僅 LF/CRLF 提示）；確認變更範圍僅有 `CLAUDE.md`、XAS router/API/types/page、新增全域擬合引擎/面板/測試，未覆蓋其他既有修改。
- [2026-08-07] 檢查：以 tree-sitter TSX parser 檢查 `XasGlobalFitPanel.tsx`、`XAS.tsx`、`api/xas.ts`、`types/xas.ts` 全部語法正確；再檢查新檔無行尾空白，`git diff --check` 通過。
- [2026-08-07] 檢查：實際 import XAS router 並執行 `_global_fit_excel`，成功產生 7,349 bytes 且具有正確 ZIP/XLSX `PK` 檔頭的 Excel。
- [2026-08-07] 檢查：`uv run python -m py_compile web/backend/core/xas_global_fitting.py web/backend/routers/xas.py` 通過。本機無 Node/npm 且前端尚未安裝 `node_modules`，無法直接執行 Vite build，將另以 TSX parser 先檢查語法。
- [2026-08-07] 檢查：改用 `uv run --with pytest --with numpy --with scipy python -m pytest -q` 驗證 XAS 全域擬合，結果 `1 passed`。
- [2026-08-07] 檢查：`uv run ... pytest -q` 首次因 uv cache 權限改用非沙盒執行；依賴安裝成功，但 pytest console script 在含中文路徑下未將 backend 根目錄加入 import path，收集階段因 `No module named core` 失敗，改以 `python -m pytest` 再驗證。
- [2026-08-07] 檢查：首次 `git diff --check` 通過（僅既有 LF/CRLF 提示）；但當前 PowerShell PATH 的 `python.exe` 無法存取，且找不到 `node` / `npm`，需再搜尋專案或系統可用 runtime 後驗證。
- [2026-08-07] 實作：新增 XAS 全域擬合數值測試，覆蓋兩樣品共用峰形、小峰僅扣高斯、局部背景保留、C2/B2 面積比與擬合品質。
- [2026-08-07] 實作：將「全域成分擬合」面板掛入 XAS/XANES 主工作區，保留原有單光譜峰擬合區與結果顯示。
- [2026-08-07] 實作：新增原生 React `XasGlobalFitPanel`，支援直接使用 XAS TEY/TFY 處理結果或上傳第一欄 X/後續多樣品的 CSV；含小峰約束、可編輯主峰表、面積比選擇、分樣品曲線/結果表及 JSON/Excel/ZIP 匯出。
- [2026-08-07] 實作：補上 XAS 全域擬合的 TypeScript request/result 型別、擬合 API client 與 Excel/ZIP 下載 client。
- [2026-08-07] 實作：XAS 後端新增 `/api/xas/global-fit` 與 `/api/xas/global-fit-export/{xlsx|zip}`；匯出包含設定 JSON、結果 JSON、Excel 統計/光譜表與逐樣品 CSV。
- [2026-08-07] 實作：新增 `web/backend/core/xas_global_fitting.py`，完成多樣品高斯全域擬合引擎；小峰以局部常數/線性背景擬合但只扣除高斯成分，主峰中心與 FWHM 跨樣品共用，高度與背景各樣品獨立，並以峰面積計算指定比值。
- [2026-08-07] 重要判斷：XAS 已有單光譜峰擬合；新需求改以同一 XANES 分析區內的「全域成分擬合」獨立面板整合，保留原有擬合流程，並新增小峰僅扣高斯、背景分離、跨樣品共用中心/FWHM、面積比與完整匯出。
- [2026-07-27] 重要判斷：使用者要求整理 `CLAUDE.md`；確認原檔案同時包含前置流水帳與舊版短手冊，資訊重複且近期紀錄分散，決定整份重組為短版協作手冊。
- [2026-07-27] 實作：重寫 `CLAUDE.md` 結構，保留協作規則、專案定位、技術棧、驗證慣例、關鍵約定、模組現況與 2026-05-24 至 2026-07-16 的重要變更摘要；刪除重複逐步流水帳。
- [2026-07-27] 檢查：整理後執行 `git diff --check` 通過，僅有既有 LF/CRLF 換行提示；`git diff --stat` 顯示 `CLAUDE.md` 大幅精簡。
- [2026-07-27] 檢查：最終確認工作樹只有 `CLAUDE.md` 修改；整理後檔案長度約 178 行。
