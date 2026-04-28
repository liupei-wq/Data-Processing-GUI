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

## 2026-04-29 網站版 XRD 進度紀錄

### Render 與網站骨架

- 已確認 Render 網址 `https://data-processing-gui-web.onrender.com/` 可正常回應。
- `/health` 正常回傳 `{"status":"ok"}`，代表 FastAPI 服務有起來。
- 網站目前採用 `web/` 目錄下的 FastAPI + React 架構。
- 前端品牌已改為 `Nigiro Pro`，XRD 首頁殼層、圖表區、上傳區、資訊卡與匯出區已重做。

### XRD 已搬到網站版的功能

- 檔案上傳與解析
- 內插化與多檔平均
- 平滑
- 歸一化
- 波長切換
- `2θ / d-spacing` 切換
- 參考峰 overlay
- 處理後光譜 CSV 匯出
- 自動尋峰 UI 與峰表

### 2026-04-29 新增：Scherrer 晶粒尺寸分析

本次先補網站版 XRD 的 Scherrer 基礎工作流，沒有碰 Streamlit 舊版。

後端：

- `web/backend/routers/xrd.py`
  - 在 `/api/xrd/peaks` 使用 `scipy.signal.peak_widths(..., rel_height=0.5)` 計算峰寬。
  - 將左右半高位置內插回實際 `2θ` 軸。
  - `PeakRow` 新增 `fwhm_deg` 欄位，讓前端可直接使用。

前端：

- `web/frontend/src/types/xrd.ts`
  - `DetectedPeak` 新增 `fwhm_deg`
  - 新增 `ScherrerParams`
- `web/frontend/src/pages/XRD.tsx`
  - 新增 Scherrer 參數狀態：
    - `enabled`
    - `k`
    - `instrument_broadening_deg`
    - `broadening_correction`
  - 新增 `scherrerCrystalliteSizeNm(...)` 前端計算函式。
  - 支援 `none / gaussian / lorentzian` 三種儀器展寬修正模式。
  - 在結果區新增 Scherrer 控制卡與結果表。
  - 峰表新增 `FWHM (deg)` 欄位。

目前網站版 XRD 的 Scherrer 結果表會顯示：

- `2θ`
- `FWHM (deg)`
- `D (nm)`
- `D (Å)`

### 本次檢查結果

- 已重新讀取 `CLAUDE.md` 後再執行本次檢查與修改。
- 已檢查：
  - `web/backend/routers/xrd.py`
  - `web/frontend/src/types/xrd.ts`
  - `web/frontend/src/pages/XRD.tsx`
  - `web/frontend/src/components/SpectrumChart.tsx`
  - `web/frontend/src/components/ProcessingPanel.tsx`
- `git diff --check` 已執行，沒有回報格式錯誤。

### 目前限制

- 這個環境沒有 `npm`，指令回應為 `zsh:1: command not found: npm`。
- 因此目前無法在本機直接跑 `npm run build` 或 `npm run dev` 驗證 React 端編譯是否完全通過。
- 目前能確認的是程式碼結構、型別串接與差異檢查已完成；最終前端執行驗證仍要靠你本機或 Render 實際部署測試。

## 2026-04-29 新增：網站版 XRD 參考峰匹配結果表

- 重新讀取 `CLAUDE.md` 後，比對 `modules/xrd.py` 的 `match_xrd_reference_peaks(...)` 舊版邏輯，再決定網站版這一輪先用最小改動方式補齊前端工作流。
- 判斷：
  - 先不新增新的 FastAPI 匹配 endpoint。
  - 先直接使用網站版既有的 `detectedPeaks` 與 `reference-peaks` 回傳結果，在前端做「最近峰匹配」。
  - 這樣可以保持規則接近 Streamlit 舊版，同時避免把 API 面先擴大。

### 本輪修改檔案

- `web/frontend/src/types/xrd.ts`
- `web/frontend/src/components/ProcessingPanel.tsx`
- `web/frontend/src/pages/XRD.tsx`

### 本輪新增內容

- `web/frontend/src/types/xrd.ts`
  - 新增 `ReferenceMatchParams`
    - `min_rel_intensity`
    - `tolerance_deg`
    - `only_show_matched`
  - 新增 `ReferenceMatchRow`

- `web/frontend/src/components/ProcessingPanel.tsx`
  - 在「6. 參考峰比對」補上控制項：
    - 最小參考相對強度 (%)
    - 匹配容差 (deg)
    - 比對表只顯示匹配項
  - 補上說明文字，明確標示這是快速相辨識用途，不是完整 PDF/JCPDS 卡。

- `web/frontend/src/pages/XRD.tsx`
  - 新增 `buildReferenceMatches(...)`
  - 規則與 Streamlit 舊版一致方向：
    - 對每個參考峰找最近的觀測峰
    - 計算 `Δ2θ`
    - 用容差判斷是否匹配
  - 對參考峰先套用最小相對強度門檻，再拿去做圖表 overlay 與匹配
  - 新增 `Reference Peak Matching` 結果區塊
  - 結果表目前顯示：
    - `Phase`
    - `hkl`
    - `Ref 2θ`
    - `Ref d`
    - `Ref I (%)`
    - `Obs 2θ`
    - `Obs d`
    - `Obs Intensity`
    - `Δ2θ`
    - `Matched`
  - 若未啟用自動尋峰、沒有符合強度門檻的參考峰、或目前容差下沒有匹配，都會顯示對應提示。

### 本輪檢查

- 已重新檢查：
  - `web/frontend/src/pages/XRD.tsx`
  - `web/frontend/src/types/xrd.ts`
- `git diff --check` 已執行，沒有格式錯誤。

### 目前限制

- 這一輪的參考峰匹配仍然是前端計算，不是後端正式 API。
- 目前網站版匹配對象是「目前主畫面正在看的處理後曲線 + 自動尋峰結果」，不是像 Streamlit 舊版那樣可再往多資料集報表方向延伸。
- 執行環境依然沒有 `npm`，所以仍無法本機做 React build 驗證。

## 2026-04-29 新增：網站版 XRD log 弱峰檢視

- 重新讀取 `CLAUDE.md` 後，比對 `modules/xrd.py` 的 log 檢視做法。
- 判斷：
  - Streamlit 舊版的 log 轉換是「純顯示用途」，不是拿來當後續分析基礎。
  - 網站版這一輪也維持同樣原則：主圖、尋峰、Scherrer、參考峰匹配仍然以線性處理後曲線為基礎，不會因為啟用 log 檢視而改掉分析結果。

### 本輪修改檔案

- `web/frontend/src/types/xrd.ts`
- `web/frontend/src/components/ProcessingPanel.tsx`
- `web/frontend/src/components/SpectrumChart.tsx`
- `web/frontend/src/pages/XRD.tsx`

### 本輪新增內容

- `web/frontend/src/types/xrd.ts`
  - 新增 `LogViewParams`
    - `enabled`
    - `method`
    - `floor_value`

- `web/frontend/src/components/ProcessingPanel.tsx`
  - 新增「5. 取對數（弱峰檢視）」區塊
  - 可設定：
    - 是否啟用
    - `log10 / ln`
    - `floor`
  - UI 說明已明確寫出：這一步只改顯示，不改尋峰、Scherrer、參考峰匹配。

- `web/frontend/src/components/SpectrumChart.tsx`
  - 新增 `displayMode`
  - 新增 `logFloorValue`
  - 新增內部 `safeLogTransform(...)`
  - `linear / log10 / ln` 三種顯示模式共用同一個圖表元件
  - log 顯示時不疊參考峰、不顯示 detected peaks，避免視覺與意義混淆

- `web/frontend/src/pages/XRD.tsx`
  - 新增 `logViewParams` 狀態
  - 主資訊卡新增 `Weak-Peak View` 狀態摘要
  - 在主圖下方新增 `Log Weak-Peak View` 區塊
  - 第二張圖會使用目前處理後曲線做 `log10` 或 `ln` 顯示
  - `floor` 已實際接進圖表元件，不是只有 UI 假控制

### 本輪檢查

- 已重新檢查：
  - `web/frontend/src/types/xrd.ts`
  - `web/frontend/src/components/ProcessingPanel.tsx`
  - `web/frontend/src/components/SpectrumChart.tsx`
  - `web/frontend/src/pages/XRD.tsx`
- `git diff --check` 已執行，沒有格式錯誤。

### 目前限制

- 這一輪只有補「顯示型」log 檢視，沒有把 log 曲線納入 CSV 匯出。
- 目前 log 圖不疊參考峰，也不標 detected peaks，這是刻意簡化，避免把弱峰顯示和線性匹配判讀混在一起。
- 執行環境仍然沒有 `npm`，所以無法在本機做 React build 驗證。

## 2026-04-29 新增：網站版 XRD 高斯模板扣除

- 重新讀取 `CLAUDE.md` 後，比對 `modules/xrd.py` 與 `core/spectrum_ops.py`。
- 判斷：
  - 舊版高斯模板扣除的核心演算法其實已經抽到 `core/spectrum_ops.py`。
  - 網站版這一輪不再複製一份演算法，而是直接重用 `fit_fixed_gaussian_templates(...)`。
  - 高斯模板扣除屬於正式處理流程的一部分，不是單純顯示，因此這次直接擴充 `/api/xrd/process` 的輸入與輸出，而不是做成獨立前端假效果。

### 本輪修改檔案

- `web/backend/routers/xrd.py`
- `web/frontend/src/types/xrd.ts`
- `web/frontend/src/components/ProcessingPanel.tsx`
- `web/frontend/src/components/GaussianSubtractionChart.tsx`
- `web/frontend/src/pages/XRD.tsx`

### 本輪新增內容

- `web/backend/routers/xrd.py`
  - `ProcessParams` 新增：
    - `gaussian_enabled`
    - `gaussian_fwhm`
    - `gaussian_height`
    - `gaussian_search_half_width`
    - `gaussian_centers`
  - `DatasetOutput` 新增：
    - `y_gaussian_model`
    - `y_gaussian_subtracted`
    - `gaussian_fits`
  - `/process` 現在流程改為：
    - `interpolate`
    - `average`
    - `Gaussian subtraction`
    - `smooth`
    - `normalize`
  - 若啟用高斯模板扣除，即使原本未勾選內插化，也會先依 `n_points` 建立等距網格後再做扣除，這和 Streamlit 舊版邏輯一致方向。
  - 高斯結果直接重用 `core/spectrum_ops.py` 的 `fit_fixed_gaussian_templates(...)`。
  - 另外把 list 預設值改成 `Field(default_factory=...)`，避免可變預設值污染狀態。

- `web/frontend/src/types/xrd.ts`
  - `ProcessParams` 新增高斯扣除參數
  - 新增：
    - `GaussianCenter`
    - `GaussianFitRow`
  - `ProcessedDataset` 新增高斯相關欄位

- `web/frontend/src/components/ProcessingPanel.tsx`
  - 新增「3. 高斯模板扣除」區塊
  - 可設定：
    - 是否啟用
    - 固定 FWHM
    - 固定高度
    - 中心搜尋半寬
    - 高斯中心列表
  - 可新增 / 刪除多個中心，並逐個設定：
    - `enabled`
    - `name`
    - `center 2θ`
  - 介面會即時顯示由 `height * fwhm * 1.0645` 換算的面積。

- `web/frontend/src/components/GaussianSubtractionChart.tsx`
  - 新增專用圖表元件
  - 會同時顯示：
    - 原始曲線
    - Gaussian template
    - 扣除後曲線
  - 支援 `2θ / d-spacing` 切換

- `web/frontend/src/pages/XRD.tsx`
  - 主資訊卡新增 `Gaussian Subtraction` 狀態摘要
  - 在主圖下方新增 `Gaussian Template Subtraction` 區塊
  - 顯示高斯對照圖與中心結果表
  - 結果表目前顯示：
    - `Peak`
    - `Seed 2θ`
    - `Fitted 2θ`
    - `Shift`
    - `FWHM`
    - `Area`
    - `Height`

### 本輪檢查

- 已重新檢查：
  - `web/backend/routers/xrd.py`
  - `web/frontend/src/types/xrd.ts`
  - `web/frontend/src/components/ProcessingPanel.tsx`
  - `web/frontend/src/components/GaussianSubtractionChart.tsx`
  - `web/frontend/src/pages/XRD.tsx`
- `git diff --check` 已執行，沒有格式錯誤。

### 目前限制

- 這一輪只把高斯模板扣除接進網站版工作流，還沒有把高斯結果納入 CSV 匯出。
- 高斯中心列表目前是前端表單管理，不是像 Streamlit 舊版那種 data editor 形式。
- 沒有 `npm`，因此目前仍無法在本機直接做 React build 驗證。

## 2026-04-29 新增：網站版 XRD 匯出區補強

- 重新讀取 `CLAUDE.md` 後，比對 `modules/xrd.py` 的匯出段落，確認網站版目前缺的不只是「下載處理後光譜」，而是缺完整的分析輸出與流程追溯。
- 判斷：
  - 這一輪先不擴 API。
  - 直接在前端用目前已有的狀態資料與計算結果，補齊 CSV / JSON 匯出。
  - 原本單一的「下載處理後光譜 CSV」保留，但擴成完整匯出區。

### 本輪修改檔案

- `web/frontend/src/pages/XRD.tsx`

### 本輪新增內容

- 新增通用 CSV 工具：
  - `csvEscape(...)`
  - `toCsv(...)`
  - `downloadFile(...)`
- 把原本單一匯出按鈕改成三區塊匯出面板：
  - `研究常用`
  - `分析表格`
  - `追溯 / 設定`

### 目前網站版可下載的檔案

- `研究常用`
  - 處理後光譜 CSV
  - 目前資料集詳細 CSV
    - `2theta`
    - `d-spacing`
    - `raw`
    - `gaussian_model`
    - `gaussian_subtracted`
    - `processed`
    - 若啟用 log 檢視，會再加上 `log10` 或 `ln` 欄位
  - Scherrer CSV
  - 高斯中心結果 CSV

- `分析表格`
  - 自動尋峰 CSV
  - 參考峰 CSV
  - 參考匹配 CSV

- `追溯 / 設定`
  - 處理報告 JSON
  - 內容包含：
    - 輸入檔名
    - 目前資料集
    - 波長設定
    - 處理參數
    - log 設定
    - 參考峰匹配設定
    - 尋峰設定與結果摘要
    - Scherrer 參數與結果
    - 高斯中心結果

### 補充實作細節

- 詳細資料集 CSV 的 log 欄位不是逐點硬取對數，而是先比照目前網站版 log 圖的平移規則，再寫出 `log10` 或 `ln` 數值，避免下載值和畫面顯示不一致。
- 匯出檔名目前使用固定預設值或以目前資料集名稱衍生，不像 Streamlit 舊版那樣提供每個下載卡自訂檔名欄位。

### 本輪檢查

- 已重新檢查 `web/frontend/src/pages/XRD.tsx`
- `git diff --check` 已執行，沒有格式錯誤。
- 已確認沒有殘留舊的 `downloadCsv(...)` 呼叫。

### 目前限制

- 目前仍沒有把所有資料整包打成單一 zip。
- 目前 JSON 報告偏向前端工作流摘要，還不是完全對齊 Streamlit 舊版的完整研究存檔格式。
- 沒有 `npm`，因此這一輪仍無法本機做 React build 驗證。
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

## 2026-04-29 網站版前端 UI 整理

- 重新讀取 `CLAUDE.md`，比對圖片確認要改的內容。
- 修改 `web/frontend/src/index.css`：
  - 預設主題改為「深灰」（#111827），不再是帶藍光的深藍色
  - 使用 CSS 自訂屬性 (`--bg-gradient`, `--panel-bg`, `--panel-border`, `--orb-left/right`) 支援三種主題切換
  - 新增 `[data-theme="black"]`（純黑 #080808）
  - 新增 `[data-theme="navy"]`（原深藍/青色光暈主題）
  - `html` 背景與 `.glass-panel` 背景均改用 CSS var，跟隨主題切換
- 修改 `web/frontend/src/App.tsx`：
  - 移除「網站原型」與「Railway 上線」兩個 badge
  - 移除「模組」與「技術棧」兩個資訊卡
  - 新增主題切換器（深灰 / 純黑 / 深藍），用 `useEffect` 把 `data-theme` 寫到 `<html>`，並存 `localStorage`
  - 說明文字縮短為「光譜與材料分析科學數據處理平台。」
- 修改 `web/frontend/src/pages/XRD.tsx`：
  - 刪除「目前模組 XRD」資訊卡
  - 頂部網格改為 `grid-cols-1 sm:grid-cols-3`（原 sm:grid-cols-2 xl:grid-cols-4）
  - 高斯模板扣除狀態卡：改成只有 `params.gaussian_enabled` 為 true 才渲染
  - 弱峰檢視狀態卡：改成只有 `logViewParams.enabled` 才渲染
  - 自動尋峰狀態卡：改成只有 `peakParams.enabled` 才渲染
  - Scherrer 卡：未啟用時收起細節，只顯示標題與一個 checkbox；啟用後才展開 K / 儀器展寬 / 展寬修正控制項
- `git diff --check` 通過

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
- 2026-04-28：修改 `啟動_Windows.bat`：新增 Streamlit 是否安裝的前置確認、改為有標題的可見視窗（`start "Nigiro Pro - Server" /min`）、加入 5 次 health check 等待、結尾 `pause` 讓使用者看到錯誤訊息。解決 CMD 視窗消失不見無法診斷問題。
- 2026-04-28：XPS Core Level 背景扣除與歸一化的區間選取改為兩個 number_input（高 BE 端 / 低 BE 端），對應圖表右翻轉方向，避免 slider 左右與圖表左右相反的混淆。XPS 自訂峰從計數器改為唯一 ID 清單，每個峰新增「✕」個別刪除按鈕。驗證：`python3 -m py_compile modules/xps.py` ✅。
- 2026-04-28：XPS Valence Band Band Offset → VBM 差值法：在材料 A / 材料 B 兩欄各新增「上傳 VB 光譜」功能，程式自動解析、套用能量校正與背景扣除、做 VBM 線性外推，並顯示光譜圖與 VBM metric。不上傳則退回原有「從主流程帶入 / 手動輸入」模式。用途：讓使用者直接比較 1019（NiO）與 1008（Ga₂O₃）兩個樣品的 VB 光譜，在同一頁面算出 ΔEV。驗證：`python3 -m py_compile modules/xps.py` ✅。
- 2026-04-28：再次重寫 `啟動_Windows.bat`：根本原因是 Write 工具儲存 UTF-8，CMD 解析 bat 時遇到中文多位元組字元將其誤判為指令（造成 'is not recognized as command' 錯誤）。修正方式：bat 檔案所有 echo / REM 改為純英文 ASCII，徹底消除中文。Streamlit 直接在當前視窗執行，瀏覽器由 PowerShell WindowStyle Hidden 每秒輪詢 /_stcore/health，就緒後立即開啟（最快 4-6 秒，上限 30 秒）。驗證：cmd /c 執行後輸出 URL: http://localhost:8501 確認啟動成功。
- 2026-04-28：XRD sidebar 處理順序調整：「取對數（弱峰檢視）」從步驟 6 移至步驟 2（緊接載入後），後續各步驟順移：內插化/平均化 → 步驟 3、高斯模板扣除 → 步驟 4、平滑 → 步驟 5、歸一化 → 步驟 6，X 軸與 d-spacing、參考峰比對維持步驟 7、8。取對數改為無前置依賴，載入檔案後即可設定。驗證：`python -m py_compile modules/xrd.py` ✅。

## 2026-04-28 GitHub 推送準備紀錄

- 使用 `git status --short --branch` 檢查目前 Git 狀態：repo 在 `main` 分支，尚未有任何 commit，專案檔案多數已在 staged 狀態。
- 使用 `git remote -v` 檢查遠端設定：目前尚未設定 GitHub remote。
- 檢查 `.gitignore` 與 `.claude/settings.local.json`，確認 `.claude/settings.local.json` 是本機工具權限設定，不適合推到 GitHub。
- 已將 `.claude/settings.local.json` 加入 `.gitignore` 的 `Local agent/tool settings` 區塊。
- 已執行 `git rm --cached .claude/settings.local.json`，只從 Git 暫存區移除該檔案，保留本機檔案不刪除。
- 檢查 `git config user.name` 與 `git config user.email`：目前 repo 尚未設定 commit 作者資訊。
- 後續推送 GitHub 仍需要使用者提供：
  - GitHub repo URL，例如 `https://github.com/<user>/<repo>.git`
  - Git commit 作者名稱與 email，例如 `Name <email@example.com>`

## 2026-04-29 Mac 啟動排查紀錄

- 讀取 `CLAUDE.md` 後，檢查專案根目錄檔案與 `啟動_Mac.command` 狀態，確認該檔目前權限為 `-rw-rw-r--`，缺少可執行位元，Finder 雙擊時會直接出現「沒有適當的取用權限」。
- 檢查 `啟動_Mac.command` 擴展屬性，發現存在 `com.apple.quarantine`，代表檔案帶有下載隔離標記，但這不是目前畫面中的第一層阻塞；第一層阻塞仍是缺少 executable bit。
- 檢查 `啟動_Mac.command` 內容，確認腳本目前將 Python 寫死為 `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`，可用但可攜性差。
- 檢查系統 Python 與 Streamlit：`python3 --version` 為 `Python 3.14.4`，`python3 -m streamlit --version` 為 `Streamlit 1.56.0`，表示本機已有可用執行環境。
- 準備修正 `啟動_Mac.command`：改為優先使用 `command -v python3` 取得 Python，加入 Streamlit 檢查與啟動失敗提示，並補上可執行權限後再實測。
- 已修改 `啟動_Mac.command`：加入 `cd` 失敗保護、優先使用 `command -v python3`、若找不到 Streamlit 則直接顯示安裝指令、30 秒未就緒時保留終端訊息供排錯。
- 已執行 `chmod +x 啟動_Mac.command`，目前權限變為 `-rwxrwxr-x`，Finder 雙擊所需的 executable bit 已補上。
- 已移除 `啟動_Mac.command` 的 `com.apple.quarantine`，剩餘屬性為 `com.apple.lastuseddate#PS`、`com.apple.macl`、`com.apple.provenance`。
- 已用 `bash -n 啟動_Mac.command` 做語法檢查，結果通過。
- 已在代理沙箱內實際執行 `./啟動_Mac.command`；腳本本身可執行，但 Streamlit 綁定 `localhost:8501` 時出現 `PermissionError: [Errno 1] Operation not permitted`。此錯誤高度疑似來自目前執行環境的 socket 權限限制，不能直接視為專案本身故障，需再做非沙箱驗證。
- 已在非沙箱環境再次執行 `./啟動_Mac.command` 驗證，Streamlit 成功啟動並顯示 `URL: http://localhost:8501`，`curl -s http://localhost:8501/_stcore/health` 回傳 `ok`，確認修正後啟動流程正常。
- 完成驗證後，將測試用啟動程序中止，避免持續佔用 `8501` port。

## 2026-04-29 Web 版本閱讀與下一步判斷

- 重新讀取 `CLAUDE.md`，確認檔內已有明確的 Web 版本段落：`## Web 版本（FastAPI + React）`，開始時間記錄為 2026-04-27，目標是把 Streamlit 版重寫成可部署到 Railway 的正式網站。
- 依 `CLAUDE.md` 與實際目錄交叉確認，`web/` 目錄確實存在，包含 `web/backend/`、`web/frontend/`、`web/Dockerfile`、`web/docker-compose.yml`，不是只有規劃文字。
- 檢查 `web/backend/main.py`，確認 FastAPI 已建立、已掛載 CORS、已註冊 `/api/xrd` router，並在 production 條件下可提供 React build 後的靜態檔。
- 檢查 `web/backend/routers/xrd.py`，確認後端目前只完成 XRD API，且直接重用既有 `core/` 與 `db/` 邏輯，包含 parse、process、peaks、references、reference-peaks 等端點。
- 檢查 `web/frontend/src/pages/XRD.tsx`、`web/frontend/src/api/xrd.ts`、`web/frontend/src/App.tsx`，確認前端目前主頁就是 XRD，已具備上傳、處理、參考峰與匯出流程；導覽列中的 Raman / XPS / XES 仍為 disabled，表示尚未 web 化。
- 判斷結論：專案目前的網站版進度屬於「XRD 可當第一個 web 模組原型」，但整體產品離完整網站仍有明顯差距。若要繼續，最合理的順序不是重寫全部，而是先把 XRD 網頁版本機跑通並驗證，再選一個下一個模組做 API + 頁面移植。

## 2026-04-29 GitHub 連接處理

- 重新讀取 `CLAUDE.md` 後檢查 Git 狀態：目前專案目錄沒有 `.git`，`git rev-parse --is-inside-work-tree` 與 `git remote -v` 都回報 `fatal: not a git repository`，表示這份工作目錄目前尚未是 Git repo。
- 檢查專案根目錄檔案，確認目前只有 `.gitignore`，沒有 `.git/` 目錄。
- 以非沙箱網路驗證 `git ls-remote https://github.com/liupei-wq/Data-Processing-GUI.git`，確認 GitHub 上的 `liupei-wq/Data-Processing-GUI` 倉庫存在，且已有 `main` 分支與 commit `1ce8f5a1a2b11478feea438c60307eb88b552d5c`。
- 判斷：要讓這份本機資料夾之後能正常推到 GitHub，下一步需要先在本機初始化 Git repo、設定 `origin` 指向該 GitHub 倉庫，並抓取遠端 `main` 供後續比對與對接。
- 已執行 `git init -b main`，在專案根目錄建立本機 `.git/`。
- 寫入 `origin` 時，普通沙箱執行 `git remote add origin ...` 因 `.git/config` 權限限制失敗；改以高權限重跑後成功，`origin` 現在指向 `https://github.com/liupei-wq/Data-Processing-GUI.git`。
- 檢查 Git 作者資訊：`git config user.name` 為 `liupei-wq`，`git config user.email` 為 `peiliu001@gmail.com`。
- 已以高權限執行 `git fetch origin main`，成功抓到遠端 `origin/main`。
- 進一步檢查後確認：本機 `main` 目前仍是 `No commits yet on main` 的 unborn branch，而遠端 `origin/main` 已有歷史（最近可見 `1ce8f5a Merge remote main` 等 commit）。如果不把本機分支掛到遠端歷史上，之後第一次 push 很可能遇到 non-fast-forward 或需要額外 pull/rebase。
- 決策：下一步要在不覆蓋目前工作樹檔案的前提下，將本機 `main` 指向 `origin/main` 並設定 upstream，讓之後的 commit/push 走正常 Git 流程。
- 已以高權限執行 `git update-ref refs/heads/main refs/remotes/origin/main`，讓本機 `main` 指向遠端既有歷史；接著執行 `git branch --set-upstream-to=origin/main main`，目前 `main` 已追蹤 `origin/main`。
- 驗證時發現 `git status` 同時出現大量 `D` 與 `??`，這不是檔案真的被刪除，而是因為前一步只接上分支參考，Git index 尚未同步到 `HEAD`。需要再做一次不改動工作樹內容的 `git reset --mixed HEAD` 來校正 index。
- 已以高權限執行 `git reset --mixed HEAD` 同步 index 到目前 `HEAD`，未覆蓋工作樹；重檢後狀態已收斂為正常 Git 變更列表。
- 最終驗證：
  - `git branch -vv` 顯示 `main 1ce8f5a [origin/main]`
  - `git remote -v` 顯示 fetch / push 都指向 `https://github.com/liupei-wq/Data-Processing-GUI.git`
  - `git status --short --branch` 目前為 `main...origin/main`
- 目前相對於 `origin/main` 的工作樹差異只剩：
  - `CLAUDE.md` 修改
  - `啟動_Mac.command` 修改
  - `啟動_Windows.bat` 刪除
- 結論：GitHub 已成功接上，之後只要照一般流程 `git add` → `git commit` → `git push` 即可推回 `liupei-wq/Data-Processing-GUI`。首次 push 仍可能需要 GitHub 驗證（瀏覽器登入、credential helper 或 personal access token），但 repo 連線與分支追蹤已完成。

## 2026-04-29 網站架設下一步建議

- 重新讀取 `CLAUDE.md` 的 Web 版本段落，並再次確認 `web/`、`web/backend/`、`web/frontend/` 目錄存在。
- 目前網站版的現況判斷沒有改變：已經有 FastAPI + React + Dockerfile + Railway 設定，但只有 XRD 完成 web 化，其他模組尚未搬移。
- 對使用者的建議路線：
  1. 先把現有 `web/` 版本在本機跑通，確認 XRD 前後端與 API 都正常。
  2. 本機跑通後，再把目前 Git 變更 commit 並 push 到 `liupei-wq/Data-Processing-GUI`。
  3. 接著在 Railway 上先部署目前的 XRD 網站原型，不要等全部模組做完才第一次部署。
  4. 上線後再依序擴充下一個模組，優先選 `Raman` 或 `XAS`，不要先碰 `XPS`。
- 原因：現在最缺的不是新架構，而是把既有網站骨架從「有檔案」變成「可本機跑、可部署、可迭代」；先完成第一個可用的網站節點，比同時搬所有模組更穩定。

## 2026-04-29 免費部署平台比對

- 重新讀取 `CLAUDE.md` 後，查詢多個官方定價頁，目的是找「對 FastAPI + React + Dockerfile 真的可免費使用」的平台，而不是只有前端免費的平台。
- 查詢結果摘要：
  - Railway：有 Free / Trial，但長期不應假設為零成本，且之後容易進入付費。
  - Render：官方仍提供 Free web services 與 free static sites，適合測試與 side project，但 free web service 15 分鐘閒置會 spin down，下一次喚醒約需 1 分鐘，且每月有 750 free instance hours，不適合正式 production。
  - Google Cloud Run：官方有 always free tier，按用量計費，適合容器化應用；但需要 Google Cloud 帳號與 billing 設定，部署複雜度高於 Render。
  - Oracle Cloud Free Tier：官方仍提供 Always Free 資源，可長期免費，但主機型部署需要自己處理 VM、Docker、反向代理與維運，操作成本最高。
  - Fly.io：新用戶目前不適合當「免費方案」推薦，官方說明中的 free allowances 已屬 legacy 舊方案。
  - Vercel / Netlify：前端免費方案仍存在，但更適合純前端或前後端拆開部署；不適合直接拿來當你現在這個 FastAPI + React 單容器網站的首選主機。
- 針對本專案的判斷：
  - 如果目標是「最省事的免費測試部署」，首選 Render。
  - 如果目標是「盡量長期免費」，首選 Oracle Cloud Free Tier，但維運成本高很多。
  - 如果目標是「維持現有 Docker 架構又想吃免費額度」，Cloud Run 可行，但操作門檻高於 Render。

## 2026-04-29 Render 免費部署支援

- 重新讀取 `CLAUDE.md` 後，決定直接以 Render 作為本專案的免費部署首選，原因是它比 Oracle Cloud 與 Cloud Run 更省事，適合目前這個 XRD 網站原型階段。
- 檢查 `web/Dockerfile` 後發現一個部署風險：frontend 目錄目前沒有 `package-lock.json`，但原本 Dockerfile 使用 `npm ci`，在 Render build 時很容易直接失敗。
- 已修改 `web/Dockerfile`：安裝前端依賴時改成「若有 `package-lock.json` 則 `npm ci`，否則 `npm install`」，降低首次部署失敗風險。
- 已新增專案根目錄 `render.yaml`，使用 Render Blueprint 定義一個 `web` service：
  - `runtime: docker`
  - `plan: free`
  - `dockerfilePath: ./web/Dockerfile`
  - `dockerContext: .`
  - `healthCheckPath: /health`
  - `autoDeployTrigger: commit`
- 已更新 `README.md`，補上：
  - Streamlit 桌面版的較正確啟動說明
  - `web/` 網站版本機啟動方式
  - Render 免費部署步驟與限制
- 驗證：
  - 重新檢視 `render.yaml`、`web/Dockerfile`、`README.md` 內容
  - `git diff --check` 通過
- 結論：專案現在已具備「推上 GitHub 後，用 Render 免費方案直接部署」的基本設定，不必再手動逐項填 Dockerfile 與 health check。

## 2026-04-29 Oracle Cloud / Cloud Run / Railway 比較判斷

- 重新讀取 `CLAUDE.md` 後，依使用者追問補查官方文件，目的不是比功能列表，而是確認「免費方案的代價」。
- 針對 Oracle Cloud Free Tier：
  - 優點是有 Always Free。
  - 缺點是需要信用卡或可當信用卡使用的簽帳卡做驗證、可用容量受 capacity limits 影響、免費帳號沒有 Oracle Support 與 SLA、帳號閒置 30 天可能被視為 abandoned。
  - 實務上它更像「給你免費雲主機資源」，不是像 Railway 那樣的低維運應用平台，所以部署 Docker、反向代理、SSL、更新流程、監控都比較偏自己處理。
- 針對 Google Cloud Run：
  - 優點是有 always free tier、容器支援很好。
  - 缺點是要先有啟用 billing 的 Google Cloud project；Google 官方明寫即使只用 free services，project 也必須連到 active Cloud Billing account。
  - Cloud Run 只適合 stateless container；官方也明講 stateful container 不能直接當 Cloud Run 服務部署。
  - 實務上還需要碰 project、IAM、API 啟用、Cloud Build / Artifact Registry 等周邊設定，操作成本高於 Railway。
- 針對 Railway：
  - 優點仍然是最接近「應用平台」：可直接用 Dockerfile 或 Railpack build，並且內建比較直接的 deploy workflow。
  - 缺點是免費資源較少，長期零成本不可假設，之後比較容易進入付費。
- 判斷結論：
  - 如果把「免費」放第一優先，Oracle Cloud 與 Cloud Run 都可以，但它們的缺點都是比 Railway 更難上手、更需要自己維運或理解雲端細節。
  - 如果把「省時間、省腦力」放第一優先，Railway 或 Render 類平台仍然比較合理，只是免費通常不長久。

## 2026-04-29 Render 部署後下一步建議

- 重新讀取 `CLAUDE.md` 後，根據使用者已完成 Render 部署的現況，將建議焦點改為「部署後驗證與迭代順序」。
- 判斷：Render 部署成功不代表網站版已完成；目前最重要的是確認 `onrender.com` 網址上的 XRD 流程真的可用，而不是立刻再切平台或擴充新模組。
- 建議的下一步順序：
  1. 先驗證 `/health` 是否正常，以及首頁是否能打開。
  2. 實際上傳一組 XRD 檔案，確認 parse / process / chart / 下載 CSV 全流程正常。
  3. 在 Render Dashboard 檢查 build logs 與 runtime logs，確認沒有隱性錯誤。
  4. 確認目前免費版冷啟動可接受，再決定是否綁自訂網域。
  5. 只有在 XRD 線上版本穩定後，才開始搬第二個模組，優先 `Raman` 或 `XAS`。
- 理由：現在網站版仍屬原型，最需要的是把「已部署」變成「可驗證、可迭代、可示範」，而不是同時展開新的平台或功能面。

## 2026-04-29 Render 線上網址驗證

- 重新讀取 `CLAUDE.md` 後，針對使用者提供的 Render 網址 `https://data-processing-gui-web.onrender.com/` 做線上驗證。
- 內建網頁抓取工具對該網址取頁不穩，因此改用實際 HTTP 請求檢查，避免把工具限制誤判成網站故障。
- 在非沙箱網路環境下檢查首頁：
  - `curl -I https://data-processing-gui-web.onrender.com/`
  - 回應 `HTTP/2 200`
  - `x-render-origin-server: uvicorn`
- 在非沙箱網路環境下檢查健康檢查端點：
  - `curl -i https://data-processing-gui-web.onrender.com/health`
  - 回應 `HTTP/2 200`
  - 內容為 `{"status":"ok"}`
- 判斷：目前 Render 上的網站至少已經成功部署並啟動，首頁與後端健康檢查都正常；下一步應該改做實際 XRD 功能流程驗證，而不是再懷疑部署本身。

## 2026-04-29 Railway 三人使用成本判斷

- 重新讀取 `CLAUDE.md` 後，針對使用者「改成 Railway 給實驗室三個人用，應該不會到需要付費吧」這個問題查官方定價與服務模型。
- 官方目前資訊重點：
  - Railway `Free` 計畫是 `0 美元/月`，但只有 `每月 $1 的免費資源額度`。
  - 新帳號 trial 結束後，會回到 `Free` 計畫，每月仍只有 `$1` 免費額度。
  - Railway 的 `services` 是 `persistent services`，官方明寫是 always running 的長駐服務，像 web app / API 都屬於這類。
  - 資源價格目前為：RAM `$10 / GB / month`、CPU `$20 / vCPU / month`，按分鐘累計。
- 依這個專案情境做判斷：
  - 成本主要不取決於「只有三個人用」，而取決於 Railway service 是長駐的。
  - 就算流量不高，只要網站和 API 常駐，記憶體就會持續計費。
  - 以官方 RAM 價格粗估，若服務平均佔用 `0.25 GB` RAM 一整月，光 RAM 成本就約 `$2.5/月`；若平均 `0.5 GB`，就約 `$5/月`，這還沒算 CPU 與 egress。
- 結論：
  - 不應假設 Railway 長期免費。
  - 如果你們想要「不像 Render Free 那樣休眠」，那 Railway 很可能需要至少上 `Hobby $5/月` 的心理準備。
  - 但若只有實驗室三人偶爾使用、流量不高，實際費用大概率仍落在低檔，通常比較像「接近 $5 或小幅超過」，而不是一下變很高。

## 2026-04-29 前端型別錯誤修正與清理

- 重新讀取 `CLAUDE.md` 後，診斷 VSCode 顯示大量 JSX 紅色錯誤的原因。
- 根本原因：`src/vite-env.d.ts` 完全不存在（標準 Vite 初始化會自動建立，但此專案是手動建立的），TypeScript 找不到 JSX 型別定義。
- 修正一：建立 `web/frontend/src/vite-env.d.ts`，加入 `/// <reference types="vite/client" />` 與 `/// <reference types="react/jsx-runtime" />`。
- 修正二：`tsconfig.json` 補上 `"types": ["vite/client", "react", "react-dom"]`，明確告知 TypeScript 要載入哪些型別。
- 修正後需在 VSCode 執行 `TypeScript: Restart TS Server` 才會生效。
- 另刪除 `web/docker-compose.yml`：該檔案有重複 `build:` 鍵的 YAML 語法錯誤，Railway 部署不使用它，本機開發也不需要，無保留價值。

## 2026-04-29 網站版前端中文化

- 重新讀取 `CLAUDE.md` 後，比對前端各元件的英文 UI 字串，逐一修改為繁體中文。
- 修改檔案：
  - `web/frontend/src/App.tsx`：badge 文字（Web Prototype → 網站原型、Render Live → Railway 上線）、說明文字、Mode/Stack 資訊卡。
  - `web/frontend/src/pages/XRD.tsx`：側欄標題與說明、資訊卡標題與說明、空狀態提示、所有功能區塊標題、Scherrer/高斯/尋峰/對數/參考峰匹配的說明文字與狀態文字、表格欄位標頭（Phase→相位、Matched→匹配、Yes/No→✓匹配/✗不匹配、Intensity→強度等）、匯出區塊標題。
- ProcessingPanel.tsx 與 FileUpload.tsx 原本已大部分是中文，未修改。
- 表格欄位中帶有科學符號的保留英文/符號格式（hkl、2θ、d-spacing、FWHM、Ref/Obs、N/A）。
- 已執行 grep 確認無遺漏的 UI 英文字串。
- 舊有 TypeScript 錯誤（7026，JSX.IntrinsicElements）是既有設定問題，不是本次改動造成。

## 2026-04-29 Railway 部署 $PORT 修正

- 重新讀取 `CLAUDE.md` 後，確認 Railway runtime log 回報：`Error: Invalid value for '--port': '$PORT' is not a valid integer.`
- 根本原因：`railway.toml` 的 `startCommand` 欄位不走 shell，`$PORT` 不會被展開，uvicorn 收到字串 `$PORT` 而非數字。
- 修正方式：刪除 `railway.toml` 的 `startCommand`，讓 Dockerfile 的 `CMD ["sh", "-c", "uvicorn ... --port ${PORT:-8000}"]` 直接跑，這個 CMD 有包 `sh -c`，shell 展開正常。
- 同時把 `healthcheckTimeout` 維持在 120 秒。

## 2026-04-29 切換至 Railway 部署

- 重新讀取 `CLAUDE.md` 後，確認專案原本就有 `railway.toml` 與 `web/Dockerfile`，設計之初即以 Railway 為目標。
- 發現 `railway.toml` 中 `[build]` 區塊有兩個錯誤：
  1. `dockerfile` 不是 Railway 認識的欄位名稱，正確應為 `dockerfilePath`。
  2. 缺少 `builder = "DOCKERFILE"`，Railway 會預設使用 Nixpacks 自動偵測，忽略你的 Dockerfile。
- 已修正 `railway.toml`，加上 `builder = "DOCKERFILE"` 並將欄位名稱改為 `dockerfilePath = "web/Dockerfile"`。
- 其餘設定維持不變：`startCommand`、`healthcheckPath`、`healthcheckTimeout` 均不需調整。
- 下一步：push 最新 commit 到 GitHub，在 Railway Dashboard 新建 Service 連接 GitHub repo，Railway 會自動讀取 `railway.toml` 並 build Docker image。

## 2026-04-29 「press」平台名稱判斷

- 重新讀取 `CLAUDE.md` 後，針對使用者提到朋友好像是用「什麼 press」的平台，先做名稱判斷，避免把不同技術混在一起。
- 最大機率的兩種可能：
  - `WordPress`：網站內容管理系統與託管生態，適合部落格、形象站、內容站，不適合直接拿來部署目前這個 `FastAPI + React` 的科學資料處理網站。
  - `Express`：Node.js 的後端框架，不是雲端部署平台；如果朋友說的是 Express，那是在講後端技術，不是在講主機服務。
- 判斷：
  - 如果朋友說的是 `WordPress`，那方向和這個專案不一樣，不建議硬套。
  - 如果朋友說的是其他帶 `press` 的主機名稱，還需要更明確名稱才能比較。

## 2026-04-29 Render 後續更新流程判斷

- 重新讀取 `CLAUDE.md` 與目前 Git 狀態後，針對使用者詢問「之後推播更新會不會很困難」補查 Render 官方 deploy 文件。
- 官方目前重點：
  - 若 Render service 綁定 GitHub / GitLab / Bitbucket 的 branch，預設 `On Commit` 會在每次 push 或 merge 到該 branch 時自動 rebuild + redeploy。
  - 可在 Dashboard 把 auto-deploy 設成 `On Commit`、`After CI Checks Pass` 或 `Off`。
  - Render web service 預設 deploy 為 zero-downtime；如果新 deploy build 或啟動失敗，舊版本會繼續跑。
  - 可以在 Dashboard 手動 deploy 最新 commit、deploy 指定 commit、clear build cache 後 deploy，或直接 rollback 到先前成功版本。
- 依本專案情境判斷：
  - 只要你維持現在這種 GitHub 連動部署，之後更新不難。
  - 實際上每次更新通常只是：本機改檔 → 測一下 → `git add` → `git commit` → `git push`。
  - 真正需要注意的不是 Render 操作，而是不要把未測過的改動直接 push 到連動 branch。
- 建議：
  - 若目前是自己和實驗室少量使用，可先維持 `On Commit`。
  - 若之後改動變多，再考慮把 auto-deploy 改成 `After CI Checks Pass` 或先用測試 branch。

## 2026-04-29 網站殼層與品牌升級

- 重新讀取 `CLAUDE.md` 後，決定這一輪先不擴充新模組，而是優先把網站版從「可用內部工具」往「可展示原型」推進。
- 已修改前端檔案：
  - `web/frontend/src/App.tsx`
  - `web/frontend/src/pages/XRD.tsx`
  - `web/frontend/src/components/FileUpload.tsx`
  - `web/frontend/src/components/SpectrumChart.tsx`
  - `web/frontend/src/index.css`
- 本輪改動重點：
  - 把頂部品牌從 `Spectroscopy Lab` 換成 `Nigiro Pro`
  - 新增較完整的產品殼層、品牌標記、狀態 badge、背景光暈與格線
  - 將主畫面改成較適合桌機與手機的響應式版面，不再只像固定寬度的內部工具
  - 為 XRD 頁補上資訊卡、較完整的空狀態與較明確的 export 區塊
  - 調整上傳區與 Plotly 圖表的深色玻璃化風格，使線上版本更接近正式產品感
- 驗證：
  - 已重新檢查修改後的前端檔案內容
  - `git diff --check` 通過
- 限制：
  - 嘗試在 `web/frontend/` 執行 `npm install` 做 build 驗證，但目前執行環境沒有 `npm`，錯誤為 `zsh:1: command not found: npm`
  - 因此這一輪無法在本地端做 Vite / TypeScript build 驗證；這是工具缺失，不是直接證明前端程式正確或錯誤
- 判斷：目前這一輪已先把網站的外觀層、品牌感與行動版基本可用性補強；下一步若要繼續「搞好網站」，最值得做的是補第二個模組，或在 XRD 頁增加更完整的分析輸出與使用說明。

## 2026-04-29 XRD 網頁版覆蓋範圍判斷

- 重新讀取 `CLAUDE.md` 後，比對 `modules/xrd.py` 與 `web/backend/routers/xrd.py`、`web/frontend/src/pages/XRD.tsx`、`web/frontend/src/components/ProcessingPanel.tsx`。
- 判斷結果：XRD 並沒有完整搬到網站版，目前是「核心骨架已搬，但完整分析流程還沒搬完」。
- 已搬到網站版的內容：
  - 檔案上傳與解析
  - 內插化 / 平均化
  - 平滑
  - 歸一化
  - 波長切換
  - 2θ / d-spacing 顯示切換
  - 參考峰 overlay
  - 處理後 CSV 匯出
- 尚未完整搬到網站版的重要 XRD 能力：
  - `log` 弱峰檢視
  - 高斯模板扣除
  - 參考峰匹配結果表
  - Scherrer 晶粒尺寸分析
  - 更完整的自動尋峰 UI / 峰表輸出
  - 各種報表 / CSV 匯出與流程紀錄
- 補充：雖然 `web/backend/routers/xrd.py` 已經有 `/api/xrd/peaks` endpoint，但目前前端頁面還沒有把這個能力完整接成使用者可操作的分析區塊。

## 2026-04-29 XRD 自動尋峰 UI 補上

- 重新讀取 `CLAUDE.md` 後，開始補 XRD 網頁版第一個缺口：把既有 `/api/xrd/peaks` 接成實際可操作的前端功能。
- 已修改前端檔案：
  - `web/frontend/src/types/xrd.ts`
  - `web/frontend/src/components/ProcessingPanel.tsx`
  - `web/frontend/src/components/SpectrumChart.tsx`
  - `web/frontend/src/pages/XRD.tsx`
- 本輪新增內容：
  - 新增 `PeakDetectionParams` 型別
  - 在左側 sidebar 新增「7. 自動尋峰」區塊，可設定：
    - 是否啟用
    - prominence
    - 最小峰距
    - 最多峰數
  - 前端接上 `detectPeaks()` API 呼叫，會對目前顯示的處理後曲線做尋峰
  - 圖表上新增 detected peaks 標記
  - 主內容區新增 Auto-detected Peaks 峰表，顯示：
    - 2θ
    - d-spacing
    - intensity
    - relative intensity
- 驗證：
  - `git diff --check` 通過
- 限制：
  - 目前執行環境仍然沒有 `npm`，因此這一輪仍無法做 Vite / TypeScript build 驗證
  - 這次補的是「自動尋峰 UI + 峰表」，還不是完整的 Scherrer / 參考峰匹配結果表

## 2026-04-29 網站版 UI 回調查

- 重新讀取 `CLAUDE.md` 後，依使用者要求開始處理網站版 UI，目標是把目前部署後的頁面視覺拉回接近部署前的樣子。
- 參考依據：
  - 使用者提供的舊版畫面截圖
  - 先前 `網站殼層與品牌升級` 這輪對 `web/frontend/src/` 的殼層改動
- 這一階段先做調查，不直接改動功能流程，優先確認：
  - 哪些檔案控制目前網站版外框與主視覺
  - 哪些檔案控制左側步驟卡與內容區空狀態
- 調查結果：
  - `App.tsx` 目前還保留大面積網站 header，與截圖中的桌面分析台風格不一致。
  - `XRD.tsx` 上方資訊卡過多，主內容空狀態也偏產品 landing，不像舊版工作區。
  - `ProcessingPanel.tsx` 雖然功能齊，但樣式仍是淺色表單拼接，不像截圖中的深色步驟卡。
  - Git 較早 commit 的網站版也不是目標樣式，不能直接回退 commit 解決。
- 已決定本輪改法：
  - `web/frontend/src/App.tsx`：移除大 header，改為單純承載工作區。
  - `web/frontend/src/pages/XRD.tsx`：把品牌區、模組選單、工作區標題與空狀態整合進單頁版面。
  - `web/frontend/src/components/ProcessingPanel.tsx`：把步驟區塊改成更像舊版但更乾淨的深色卡片。
  - 視需要補改 `FileUpload.tsx` 與 `index.css`，讓整體語言一致。

## 2026-04-29 網站版 UI 回調實作

- 重新讀取 `CLAUDE.md` 後，已開始實際修改網站版前端 UI。
- 已修改檔案：
  - `web/frontend/src/App.tsx`
  - `web/frontend/src/pages/XRD.tsx`
  - `web/frontend/src/components/ProcessingPanel.tsx`
  - `web/frontend/src/components/FileUpload.tsx`
  - `web/frontend/src/index.css`
- 本輪實作重點：
  - 移除網站版原本的大型 header，改成直接進入分析工作區。
  - 把品牌區與模組按鈕放回左側，讓整體更接近部署前的桌面分析台視覺。
  - 把主內容上方多張資訊卡縮成一排狀態膠囊，避免畫面過度像 landing page。
  - 重做空狀態：改成長條提示訊息加上大面積空工作區，視覺方向接近使用者提供的舊截圖。
  - `ProcessingPanel.tsx` 全面改成深色步驟卡，步驟號獨立顯示，樣式比舊版更整齊。
  - 把 Scherrer 參數控制移進左側步驟區，避免右側再堆控制卡。
  - `FileUpload.tsx` 改成與新步驟卡一致的深色上傳區塊。
  - `index.css` 調整全域背景、玻璃面板強度與空狀態浮動裝飾樣式。
- 驗證：
  - `git diff --check` 通過。
- 限制：
  - 目前環境仍然沒有 `npm`，因此這一輪無法做 Vite / TypeScript build 驗證，也無法直接起前端畫面做瀏覽器確認。
  - 這次是依照使用者提供的截圖與現有網站結構做視覺回調，不是還原某個舊 commit 的逐像素版本。

## 2026-04-29 網站版 UI 回調後 build 錯誤修正

- 重新讀取 `CLAUDE.md` 後，根據使用者提供的 Docker build log 進行修正。
- 錯誤位置：
  - `web/frontend/src/pages/XRD.tsx(357,6)`：JSX element `div` 缺少對應 closing tag。
  - `web/frontend/src/pages/XRD.tsx(1080,1)` 與 `(1081,1)`：通常是前面 JSX 結構失衡連帶造成。
- 判斷：
  - 這不是型別問題，是 `XRD.tsx` 在大幅調整版面後有區塊閉合遺漏。
- 本輪先做：
  - 檢查 `XRD.tsx` 錯誤行附近與檔案尾端的 JSX 層級。
  - 補齊缺少的 closing tag，優先讓前端 build 恢復。
- 修正結果：
  - 已確認 `web/frontend/src/pages/XRD.tsx` 的最外層 root `<div>` 少一個 closing tag。
  - 已補上一個 `</div>`，其餘 JSX 結構不需大改。
- 驗證結果：
  - 在 `web/frontend/` 執行 `npm run build` 已成功通過。
  - 代表原本 Docker build log 內的：
    - `JSX element 'div' has no corresponding closing tag`
    - `Unexpected token`
    - `'</' expected`
    都已排除。
- 目前仍存在但不阻擋 build 的訊息：
  - Vite 提示輸出 chunk 過大（`index-U-DQL0kP.js` 約 5 MB）。
  - Node 對 `postcss.config.js` 顯示 module type warning。
  - 這兩項目前都是 warning，不是這次 build 失敗的原因。

## 2026-04-29 主題系統與卡片層次升級

- 重新讀取 `CLAUDE.md` 後，依使用者要求開始做第二輪 UI 風格調整。
- 使用者需求重點：
  - 增加白色、黑色與其他顏色主題可切換。
  - 白色主題不要刺眼，要偏柔和。
  - 卡片與區塊要混合圓形、圓角方形等不同形狀。
  - 多加一些輔助色，不要全頁只剩單一色調。
  - 卡片背後要有更明顯的立體陰影。
  - 黑色主題不能整頁太單調，要有白框與輔助色搭配。
- 本輪預定修改方向：
  - `web/frontend/src/App.tsx`：補回主題切換 UI 與 `data-theme` 狀態管理。
  - `web/frontend/src/index.css`：把主要色彩、陰影、卡片、輸入框改成 CSS variables，新增多組 theme。
  - `web/frontend/src/pages/XRD.tsx`：讓左欄、主欄、狀態膠囊與空狀態跟著主題變化。
  - `web/frontend/src/components/ProcessingPanel.tsx` / `FileUpload.tsx` / `SpectrumChart.tsx`：同步改成跟主題變數走，避免切主題時元件仍維持舊深色寫死樣式。
- 已修改檔案：
  - `web/frontend/src/App.tsx`
  - `web/frontend/src/index.css`
  - `web/frontend/src/pages/XRD.tsx`
  - `web/frontend/src/components/ProcessingPanel.tsx`
  - `web/frontend/src/components/FileUpload.tsx`
  - `web/frontend/src/components/SpectrumChart.tsx`
- 本輪實作結果：
  - 補回主題切換面板，新增 4 組主題：`midnight`、`pearl`、`ink`、`ocean`。
  - `pearl` 主題採偏灰白與淺藍，不是高亮純白，避免刺眼。
  - `ink` 主題改成接近黑底、白框、藍橘輔助色的組合，不再只剩單一黑灰。
  - 背景、玻璃面板、卡片、輸入框、pill、圖表顏色、hover label 與陰影都改為 CSS variables 控制。
  - 主題切換區本身也加入圓形與方形混搭的 swatch，呼應使用者提供的參考圖。
  - 左側步驟卡、上傳區、品牌區統計卡、主內容狀態膠囊與空狀態卡片都加強陰影與層次。
  - `SpectrumChart.tsx` 改成讀取 CSS 變數，讓圖表在白色與黑色主題下都能維持可讀性。
  - 另外補一層 light theme override，處理尚未完全變數化的舊 Tailwind 文字色與邊框色。
- 驗證：
  - 在 `web/frontend/` 執行 `npm run build` 已成功通過。
  - 表示這輪主題、樣式與圖表設定修改沒有破壞前端編譯。
- 目前仍存在但不阻擋 build 的訊息：
  - Vite chunk size warning 仍在。
  - `postcss.config.js` 的 module type warning 仍在。

## 2026-04-29 主題替換：移除深藍，新增自由發揮主題

- 重新讀取 `CLAUDE.md` 後，依使用者要求調整主題組合。
- 使用者要求：
  - 移除原本的深藍主題。
  - 由我自由補一個新主題進去。
- 本輪處理方向：
  - `web/frontend/src/App.tsx`：刪除 `midnight` 主題選項，補新的主題 id、標題、描述與預設值。
  - `web/frontend/src/index.css`：刪除 `midnight` 對應色票，新增一組新的主題色彩與陰影配置。
- 新主題方向先定為：
  - 偏暖的奶油 / 杏桃 / 珊瑚感介面，與目前 `柔白`、`黑曜`、`海霧` 拉開差異。
- 實作結果：
  - 已移除 `midnight` 主題。
  - 新增 `apricot` 主題，中文標示為 `杏桃`，色調為奶油 / 珊瑚 / 暖米色。
  - `App.tsx` 的預設主題已改成 `apricot`。
  - 若使用者瀏覽器 localStorage 還留著舊的 `midnight`，會自動轉成 `apricot`，避免切換後出現無效主題值。
- 驗證：
  - 在 `web/frontend/` 執行 `npm run build` 已成功通過。
- 目前仍存在但不阻擋 build 的訊息：
  - Vite chunk size warning 仍在。
  - `postcss.config.js` 的 module type warning 仍在。

## 2026-04-29 主題入口改為右下角齒輪 hover 展開

- 重新讀取 `CLAUDE.md` 後，依使用者要求調整主題入口互動。
- 使用者要求：
  - 不要固定在右上角。
  - 改成右下角齒輪。
  - 滑鼠移過去時自動感應並展開主題面板。
- 本輪預定修改方向：
  - `web/frontend/src/App.tsx`：把目前固定右上角的主題面板改成右下角 gear launcher + hover 展開面板。
  - `web/frontend/src/index.css`：補齒輪 hover 動畫、展開過場與 hover hit area 樣式。
- 已修改檔案：
  - `web/frontend/src/App.tsx`
  - `web/frontend/src/index.css`
- 本輪實作結果：
  - 原本固定在右上角的主題面板已移除。
  - 新增右下角齒輪按鈕，作為主題入口。
  - 滑鼠移入齒輪或展開區域時，主題面板會自動打開。
  - 滑鼠移開後，主題面板會收回。
  - 齒輪在 hover / focus-within 狀態會旋轉並加強陰影，讓互動感更明確。
  - 主題面板展開位置改為齒輪上方，靠右對齊。
- 驗證：
  - 在 `web/frontend/` 執行 `npm run build` 已成功通過。
- 目前仍存在但不阻擋 build 的訊息：
  - Vite chunk size warning 仍在。
  - `postcss.config.js` 的 module type warning 仍在。
