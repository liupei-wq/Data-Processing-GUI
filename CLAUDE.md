# Nigiro Pro 專案紀錄

## 協作規則

- 回答使用者時一律使用繁體中文。
- 每一次動作前都要先讀取 `CLAUDE.md`。
- 每一次實作、檢查、重啟、重要判斷都要記錄在專案根目錄的 `CLAUDE.md`。
- 不要回復或覆蓋使用者未要求修改的既有變更。
- 目前 PowerShell profile 會出現執行原則警告，通常不影響指令結果。

## 專案定位

Nigiro Pro 是以 Streamlit 製作的科學數據處理 GUI，主軸是光譜與材料分析資料處理。入口檔為 `app.py`，目前支援：

- XPS：X-ray Photoelectron Spectroscopy
- XES：X-ray Emission Spectroscopy
- Raman：Raman Spectroscopy
- XRD：X-ray Diffraction
- XAS / XANES：X-ray Absorption Spectroscopy
- Gaussian subtraction：獨立高斯模板扣除工具
- SEM：目前只保留為未來模組，尚未開放

## 啟動與環境

- Windows 啟動：`啟動_Windows.bat`
- Mac 啟動：`啟動_Mac.command`
- 安裝套件：`安裝套件.bat`
- 手動啟動：`streamlit run app.py`
- 目前測試服務常用：`uv run streamlit run app.py --server.port 8504 --server.headless true`
- 依賴：`requirements.txt`
  - `streamlit`
  - `pandas`
  - `numpy`
  - `plotly`
  - `scipy`
  - `lmfit`
- Streamlit 設定：`.streamlit/config.toml`
  - `fileWatcherType = "none"`，所以修改後通常要重啟服務才會立即看到新版
  - `maxUploadSize = 500`
  - `toolbarMode = "minimal"`
  - `showErrorDetails = false`

## 架構總覽

- `app.py`
  - 全域入口、品牌、主題、語言、字級、右下角齒輪設定
  - 左上角 `Nigiro Pro` 品牌區與 SVG logo
  - 右側 hover「資料選單」抽屜，用同頁 query parameter 切換資料類型與工具
  - 主內容浮貼裝飾
  - dispatch 到各模組的 `run_*_ui()`
- `modules/`
  - 各資料類型的 Streamlit UI 與 workflow
- `core/`
  - parser、背景扣除、正規化、峰值偵測、峰擬合、FITS 讀取、UI helper
- `db/`
  - Raman、XPS、XRD 的參考資料庫

## 全域 UI 現況

- 產品名稱：`Nigiro Pro`
- 分頁名稱：`Nigiro Pro`
- 左上角品牌區：
  - 自製 SVG 數據處理 logo
  - `Nigiro Pro`
  - `data processing`
- 右下角齒輪設定：
  - 主題：淺色、深色、海洋藍、森林綠、玫瑰紅
  - 語言：繁體中文 / English
  - 字體大小：小 / 中 / 大
  - hover 時齒輪旋轉，移開會轉回
- 右側資料選單抽屜：
  - hover 從右往左滑出
  - 上區：資料類型 XPS / XES / Raman / XRD / XAS
  - 下區：工具，包含扣除高斯
  - 順序固定，不會因選取而跳到第一個
  - 使用 `target="_self"` 同頁切換，不開新分頁
- 左側 sidebar：
  - 只放目前模組的處理步驟
  - 不再放資料類型選單與扣除高斯入口

## 資料類型評估

### XPS

檔案：`modules/xps.py`

定位：最完整、功能最重的定量分析 workflow。適合處理 XPS core-level 與 valence-band 資料。

主要能力：

- XPS 檔案解析與載入
- 多檔平均
- 能量校正
- 背景扣除
- 正規化
- 峰值擬合
- Core Level / Valence Band 模式切換
- VBM 線性外推
- Band Offset / Kraut Method
- XPS 定量表格與 RSF review
- 匯出處理結果、報告與表格

資料來源：

- `core/parsers.py`
- `core/processing.py`
- `core/peak_fitting.py`
- `db/xps_database.py`

評估：

- 成熟度高，功能完整。
- 風險在於檔案很大、狀態很多，後續修改要避免破壞既有 session key。
- 若要做 UI 改版，應小步切分，不要一次重構整個 XPS。

### XES

檔案：`modules/xes.py`

定位：FITS 影像與 1D 光譜混合型 XES workflow，功能廣且偏儀器資料處理。

主要能力：

- FITS 原始影像讀取
- BG1/BG2 前後背景扣除
- Dark/Bias frame
- Hot pixel 修正
- ROI 積分
- side-band background
- 曲率校正 / image straightening
- 多檔平均
- 平滑
- 正規化
- X 軸校正
- 峰值偵測
- Preset 匯入/匯出
- QC 摘要與報告

資料來源：

- `core/read_fits_image.py`
- `core/spectrum_ops.py`
- `core/processing.py`

評估：

- 功能完整但流程複雜。
- 最大風險是影像座標、ROI、曲率校正、I0 / exposure normalization 的交互關係。
- 適合保持目前 step workflow，不建議把影像與 1D 光譜流程混在同一個大函式之外再硬拆。

### Raman

檔案：`modules/raman.py`

定位：Raman 光譜處理與材料參考峰比對 workflow。

主要能力：

- Raman 檔案載入
- Preset 匯入/匯出
- 基板訊號扣除
- 去尖峰 / cosmic ray 處理
- 內插與多檔平均
- 背景扣除
- 平滑
- 正規化
- 峰候選管理
- 參考資料庫峰比對
- 峰擬合
- Si 峰位移應力估算
- 處理前後比較與匯出

資料來源：

- `db/raman_database.py`
- `core/processing.py`
- `core/spectrum_ops.py`
- `core/peak_fitting.py`

評估：

- 功能非常多，偏分析工作站型。
- 峰位候選與 reference mapping 是核心價值。
- 後續要新增材料或峰資料，優先改 `db/raman_database.py`，不要寫死在 UI。

### XRD

檔案：`modules/xrd.py`

定位：XRD pattern 處理、參考峰比對、晶粒尺寸分析。

主要能力：

- XRD 檔案載入
- 內插與多檔平均
- 高斯模板扣除
- 平滑
- 正規化
- log transform 弱峰檢視
- 2theta / d-spacing 軸切換
- 參考峰比對
- Scherrer crystallite size
- 匯出 peak table、Scherrer table、處理報告

資料來源：

- `db/xrd_database.py`
- `core/spectrum_ops.py`
- `core/processing.py`

評估：

- 結構相對清楚，功能集中。
- Scherrer 功能已具備，但需提醒使用者 FWHM、儀器展寬、波長與 K 值會強烈影響結果。
- 參考資料擴充應集中在 `db/xrd_database.py`。

### XAS / XANES

目前 app 使用檔案：`modules/xas_auto.py`

舊版 / helper 檔案：`modules/xas.py`、`modules/xas_fit.py`

定位：自動解析 DAT 欄位的 XAS / XANES workflow，主要處理 TEY / TFY。

目前欄位規則：

- Energy：第 1 欄
- TFY：CurMD-03 / I0
- TEY：CurMD-01 / I0
- I0：CurMD-02
- TFY 可選擇 `1 - TFY` 翻轉

目前 sidebar 順序：

1. 載入資料
2. 內插與多檔平均
3. 能量校正（可選）
4. 背景扣除
5. 歸一化
6. 扣除高斯曲線（可選）
7. XANES 去卷積擬合（可選）

主要能力：

- DAT 自動欄位解析
- TEY / TFY 雙通道處理
- 內插與平均
- 能量位移校正
- 背景扣除
- post-edge / min-max / max / area / mean-region 正規化
- White line 搜尋
- 高斯模板扣除
- XANES 去卷積擬合
- 二階微分輔助峰位識別
- CSV / JSON 匯出

評估：

- 目前是活躍開發中的模組，需求變動較頻繁。
- `modules/xas_auto.py` 是 app 實際入口，若改 XAS UI，優先改這個檔。
- `modules/xas.py` 保留了較早期邏輯與 helper，可作參考，但不要誤以為 app 正在直接使用它。
- 高斯扣除目前 UI 在歸一化後方，但實際 processing pipeline 仍是在背景與歸一化前先計算 gaussian model / after-gaussian，再用 after-gaussian 做背景與歸一化。若未來使用者要求「真正對 normalized 後曲線扣高斯」，需要調整計算順序，不只是 UI 順序。

### Gaussian Subtraction 工具

檔案：`modules/gaussian_subtraction.py`

定位：獨立工具，不綁定單一資料類型，用於兩欄光譜資料的固定高斯模板扣除。

主要能力：

- 載入兩欄光譜
- 設定中心、FWHM、峰高 / 面積
- 固定模板扣除
- 結果繪圖與 CSV 匯出

評估：

- 適合作為快速工具入口。
- 目前入口在右側資料選單的「工具」區，使用 `?tool=gaussian` 同頁切換。

## 共用核心評估

### `core/parsers.py`

- 負責通用兩欄光譜解析與 XPS 結構化解析。
- 會嘗試多種編碼與格式。
- 建議所有新光譜 parser 優先集中到這裡或呼叫這裡的 helper。

### `core/processing.py`

- 背景扣除：linear、polynomial、AsLS、airPLS、Shirley、Tougaard。
- 去尖峰、平滑、正規化。
- 是多個模組共用的核心，修改需保守。

### `core/spectrum_ops.py`

- 峰值偵測、內插、平均、高斯模板扣除。
- XRD / Raman / XES / XAS 都可能使用其中功能。

### `core/peak_fitting.py`

- Gaussian / Lorentzian / Voigt profile 與 fitting。
- XPS、Raman 等峰擬合依賴它。

### `core/read_fits_image.py`

- XES FITS 讀取核心。
- 支援 primary image、header parsing、row/column sums。

### `core/ui_helpers.py`

- step header、skip button、scroll helper。
- 現有 step workflow 高度依賴這些 UI helper。

## 資料庫評估

- `db/raman_database.py`
  - Raman 材料與 reference peaks。
  - 新增材料應優先改這裡。
- `db/xps_database.py`
  - XPS 元素資訊、RSF、orbital-level RSF。
  - `get_orbital_rsf()` 是目前 XPS 定量 review 的重要 helper。
- `db/xrd_database.py`
  - XRD reference sticks。
  - 新增相、材料、reference peak 應改這裡。

## 目前主要風險與注意事項

- 多數檔案中的中文在終端顯示會 mojibake，但 Python 檔通常仍可執行；修改中文字串時要小心編碼。
- `CLAUDE.md` 曾多次出現亂碼，現在已重新整理為乾淨版本；後續應盡量用 UTF-8 寫入。
- `fileWatcherType = "none"`，修改後請重啟 Streamlit。
- `app.py` 的右側抽屜使用 query parameter 切換：
  - `?data_type=XPS`
  - `?tool=gaussian`
- 同頁切換通常會保留 `st.session_state`，但上傳檔案 widget 可能受 Streamlit widget 生命週期限制；若要完全保存跨模組上傳檔案，需要額外做資料快取層。
- XPS、Raman、XES 檔案很大，重構要分段做。
- XAS 目前 UI 順序已改為高斯扣除在歸一化後，但實際計算順序仍需另行評估。

## 近期重要變更紀錄

- 2026-04-26：將產品名稱與頁籤名稱調整為 `Nigiro Pro`。
- 2026-04-26：新增左上角 Nigiro Pro SVG logo 與品牌區，並放大 logo 與字體。
- 2026-04-26：新增右下角齒輪設定，支援主題、語言、字級切換。
- 2026-04-26：新增多主題 CSS，改善淺色與彩色主題的文字對比。
- 2026-04-26：新增右側 hover 資料選單抽屜，資料類型與工具統一由右側切換。
- 2026-04-26：移除左側頂部資料類型與扣除高斯入口，左側只保留模組處理步驟。
- 2026-04-26：資料選單固定順序，不再依最近點選移動。
- 2026-04-26：新增主畫面低透明度資料處理浮貼裝飾。
- 2026-04-26：XAS sidebar 順序調整為背景扣除、歸一化、高斯扣除、XANES 去卷積擬合。
- 2026-04-26：本次重新評估所有資料處理類型，並重寫 `CLAUDE.md`。
- 2026-04-28：整理根目錄：刪除 `CLAUDE拷貝.md`（舊格式版本）、刪除 4 個 runtime log 檔（streamlit_launcher / streamlit_ui_settings），並在 `.gitignore` 補上 `*.log / *.err.log / *.out.log` 排除規則。
- 2026-04-27：XPS Valence Band Band Offset 區塊重構：新增「VBM 差值法（僅表面量測）」與「Kraut Method」兩種方法，透過 radio 切換。VBM 差值法適用於 XPS 穿透深度 < 3 nm（如 620 eV 同步輻射）、無法同時量兩材料 CL 的情況；Kraut 保留給有界面樣品的使用者。兩者均支援從已外推的 VB 資料集自動帶入 VBM、σ 誤差輸入、quadrature 誤差傳播、能帶示意圖與 CSV 匯出。

## Web 版本（FastAPI + React）

> 2026-04-27 開始開發，目標：將 Streamlit 版本重寫為可部署到 Railway 的正式 Web App。

### 目錄結構

```
web/
├── backend/
│   ├── main.py              # FastAPI 入口，自動 import core/ + db/
│   ├── requirements.txt
│   └── routers/
│       └── xrd.py           # XRD 5 個 API endpoints
├── frontend/
│   ├── package.json         # React 18 + Vite + Tailwind + Plotly.js
│   ├── vite.config.ts       # dev 模式 proxy /api → port 8000
│   └── src/
│       ├── pages/XRD.tsx    # 主頁面（所有狀態在這）
│       ├── components/
│       │   ├── FileUpload.tsx       # 拖曳上傳（react-dropzone）
│       │   ├── SpectrumChart.tsx    # Plotly.js 互動圖表
│       │   └── ProcessingPanel.tsx  # 側欄步驟控制項
│       ├── api/xrd.ts        # API 呼叫函式
│       └── types/xrd.ts      # TypeScript 型別定義
├── Dockerfile               # 多階段 build：Node → Python + 靜態服務
└── docker-compose.yml
railway.toml                 # Railway 部署設定
```

### 後端 API（XRD）

| Endpoint | 說明 |
|---|---|
| `POST /api/xrd/parse` | 上傳檔案 → 解析 x/y 陣列 |
| `POST /api/xrd/process` | 平滑 + 歸一化 → 處理後資料 |
| `POST /api/xrd/peaks` | 自動偵測峰值 |
| `GET /api/xrd/references` | 取得參考材料清單 |
| `POST /api/xrd/reference-peaks` | 取得參考峰 2θ 位置 |

後端直接 import `core/` + `db/`，**不需重寫任何運算邏輯**。

### 本機啟動

```bash
# Terminal 1：後端
cd web && uvicorn backend.main:app --reload --port 8000

# Terminal 2：前端
cd web/frontend && npm install && npm run dev
# 瀏覽器開 http://localhost:3000
```

### 部署到 Railway

1. Push 整個 repo 到 GitHub
2. Railway 新建 Service → 選「Deploy from GitHub」
3. Railway 自動讀取 `railway.toml`，使用 `web/Dockerfile` build
4. 環境變數不需額外設定（PORT 由 Railway 自動注入）

### 開發規則

- 前端只做 UI 與 API 呼叫，**不做任何科學運算**
- 新增模組時：先在 `web/backend/routers/` 加 router，再加 React page
- 現有 Streamlit 版本（`app.py`）繼續維護，兩版並行

## 驗證紀錄

- XAS 步驟重排後曾執行：`uv run python -m py_compile modules\xas_auto.py`，通過。
- 最近曾執行：`git diff --check`，通過，僅有 Git LF/CRLF 提示。
- 最近曾重啟 8504 Streamlit 服務，health check 回傳 `ok`。

- 2026-04-26：重新讀取 CLAUDE.md 後完成驗證；uv run python -m py_compile app.py modules\xas_auto.py 通過，git diff --check 通過。

- 2026-04-26：依使用者回報，準備調暗非深色主題（light/ocean/forest/rose），降低背景、surface、sidebar 亮度，保留可讀性但避免刺眼。

- 2026-04-26：已修改 app.py 的 light/ocean/forest/rose 主題色，降低背景、surface、sidebar 亮度，改用較柔和的中低亮度配色，避免非深色主題過亮刺眼。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓調暗後的非深色主題生效。

- 2026-04-26：修正右下角設定齒輪 popover 在非深色主題下對比不足的問題；新增 popover 內容層、標題、radio label、選取與 hover 狀態的主題化 CSS，讓設定面板背景、文字、邊框跟隨目前主題並維持可讀性。驗證：`uv run python -m py_compile app.py` 通過，`git diff --check` 通過。

- 2026-04-26：修正右下角設定 popover 出現厚黑外框的問題；將 BaseWeb popover 外層改為透明、移除外層 padding/border/shadow，並把卡片背景、邊框、陰影套在 stPopoverBody / stVerticalBlockBorderWrapper 內容層。驗證：`uv run python -m py_compile app.py` 通過，`git diff --check` 通過。

- 2026-04-26：依使用者回饋微調右下角設定 popover；保留外框但將外框 padding 縮到 8px，內部設定卡改為 12px 圓角與緊湊 padding，並重新整理標題、radio 標籤、選項 pill 的字距與行距。驗證：`uv run python -m py_compile app.py` 通過，`git diff --check` 通過。
- 2026-04-27：建立 Web 版本骨架（FastAPI + React）。後端 `web/backend/` 直接 import 現有 `core/` + `db/`，提供 XRD 五個 API endpoints；前端 `web/frontend/` 使用 React 18 + Vite + Tailwind + Plotly.js，實作拖曳上傳、平滑/歸一化/波長/參考峰 sidebar、互動圖表與 CSV 匯出。部署方案：`web/Dockerfile`（多階段 build）+ `railway.toml`（Railway 一鍵部署）。驗證：`python3 -m py_compile web/backend/main.py web/backend/routers/xrd.py` ✅。
- 2026-04-28：XPS Valence Band Band Offset → VBM 差值法：在材料 A / 材料 B 兩欄各新增「上傳 VB 光譜」功能，程式自動解析、套用能量校正與背景扣除、做 VBM 線性外推，並顯示光譜圖與 VBM metric。不上傳則退回原有「從主流程帶入 / 手動輸入」模式。用途：讓使用者直接比較 1019（NiO）與 1008（Ga₂O₃）兩個樣品的 VB 光譜，在同一頁面算出 ΔEV。驗證：`python3 -m py_compile modules/xps.py` ✅。
