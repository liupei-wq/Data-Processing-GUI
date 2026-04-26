# Data Processing GUI 專案紀錄

## 協作規則

- 回答使用者時一律使用繁體中文。
- 每一次動作前都要先讀取 `CLAUDE.md`。
- 每一次實作、檢查或重要判斷都要記錄在專案根目錄的 `CLAUDE.md`。
- 不要回復或覆蓋使用者未要求修改的既有變更。

## 專案概覽

這是一個以 Streamlit 製作的光譜資料處理 GUI，入口檔為 `app.py`。目前支援或已建立工作流程的資料類型：

- XPS：X-ray Photoelectron Spectroscopy
- XES：X-ray Emission Spectroscopy
- Raman：Raman Spectroscopy
- XRD：X-ray Diffraction
- XAS / XANES：X-ray Absorption Spectroscopy
- Gaussian subtraction：獨立高斯模板扣除工具
- SEM：保留為未來模組

## 啟動與環境

- Windows 啟動檔：`啟動_Windows.bat`
- Mac 啟動檔：`啟動_Mac.command`
- 安裝套件：`安裝套件.bat`
- 手動啟動：`streamlit run app.py`
- 依賴套件：`requirements.txt`
- Streamlit 設定：`.streamlit/config.toml`

## 主要檔案結構

- `app.py`：Streamlit 入口、全域 UI 設定、資料類型切換與模組 dispatch。
- `modules/raman.py`：Raman workflow。
- `modules/xps.py`：XPS workflow，含 Core Level / Valence Band 相關分析。
- `modules/xes.py`：XES workflow。
- `modules/xrd.py`：XRD workflow。
- `modules/xas_auto.py`：目前 app 使用的 XAS / XANES 自動解析 workflow。
- `modules/xas.py`：較早期 XAS workflow 與共用邏輯。
- `modules/xas_fit.py`：XAS Gaussian fitting helper。
- `modules/gaussian_subtraction.py`：獨立高斯扣除工具。
- `core/parsers.py`：光譜檔案解析。
- `core/processing.py`：背景扣除、平滑、正規化等處理。
- `core/spectrum_ops.py`：峰值偵測、插值、平均等共用運算。
- `core/peak_fitting.py`：Gaussian / Lorentzian / Voigt fitting。
- `core/read_fits_image.py`：XES FITS 影像讀取。
- `core/ui_helpers.py`：UI helper。
- `db/raman_database.py`：Raman reference database。
- `db/xps_database.py`：XPS reference / RSF database。
- `db/xrd_database.py`：XRD reference database。

## 已知設計重點

- `app.py` 是所有模組共同入口，適合放全域主題、語言、字級等偏好設定。
- 各分析模組以 `run_*_ui()` 函式由 `app.py` dispatch。
- XAS 目前由 `modules/xas_auto.py` 接管，`app.py` 匯入 `run_xas_ui` 自該檔。
- Windows launcher 近期改為使用 dedicated ports 8511-8520，避免 stale Streamlit session。
- `.streamlit/config.toml` 已調整過 Streamlit watcher、CORS、toolbar、upload size 與錯誤顯示設定。

## 近期重要功能摘要

- XAS / XANES：
  - 自動解析 DAT 欄位，Energy=第 1 欄，TFY=CurMD-03/I0，TEY=CurMD-01/I0，I0=CurMD-02。
  - 支援 TEY / TFY 並排顯示、平均、能量校正、高斯扣除、背景扣除、正規化、white-line 摘要、Gaussian fitting 與 CSV / JSON 匯出。
  - `modules/xas_auto.py` 採用類 XPS 的 sidebar step workflow。
- XPS：
  - 新增 Valence Band / VBM workflow。
  - 新增 Band Offset / Kraut Method 計算區塊。
  - XPS RSF 資料庫擴充 orbital-level RSF 與 `get_orbital_rsf()`。
- XRD：
  - 新增 Scherrer crystallite size 計算與匯出欄位。
- XES：
  - 新增 preset 匯入/匯出、QC 報告與處理結果匯出。
- Raman：
  - 強化 peak review 與 Si stress estimate 相關輸出。

## 本次變更紀錄

- 2026-04-26：已依規則先讀取 `CLAUDE.md`，確認 `app.py` 是全域 UI 入口。
- 2026-04-26：修改 `app.py`，新增右下角齒輪設定 `st.popover`。
- 2026-04-26：新增顏色主題切換：淺色、深色、海洋藍、森林綠、玫瑰紅。
- 2026-04-26：新增語言切換：繁體中文 / English。此版本先套用 `app.py` 入口層、sidebar 標籤、設定面板、主標題與提示文字；各分析模組內部文字可後續逐步接 `st.session_state["ui_language"]` 擴充。
- 2026-04-26：新增字體大小切換：小 / 中 / 大，透過全域 CSS 變數套用。
- 2026-04-26：新增全域 CSS 變數，讓 sidebar、expander、slider、button、divider、主背景與右下角齒輪跟隨主題色。
- 2026-04-26：使用 `uv run python -m py_compile app.py` 完成語法檢查，結果通過。
- 2026-04-26：執行 `git diff --check`，結果通過；僅出現 Git 的 LF/CRLF 換行提示。
- 2026-04-26：依使用者要求重新整理 `CLAUDE.md`，移除舊亂碼紀錄，改成可讀的繁中專案摘要與本次變更紀錄。

- 2026-04-26：重新讀取整理後的 CLAUDE.md；以已核准方式重跑 uv run python -m py_compile app.py，語法檢查通過。

- 2026-04-26：重新讀取 CLAUDE.md；已用 uv run streamlit run app.py --server.port 8504 --server.headless true 啟動本機 Streamlit，輸出記錄在 streamlit_ui_settings.out.log / streamlit_ui_settings.err.log。

- 2026-04-26：收到使用者回報 KeyError；已重新讀取 CLAUDE.md 與 app.py 錯誤位置，判斷原因是 Streamlit session_state 保留了不合法的 ui_theme / ui_language / ui_font_size 舊值。

- 2026-04-26：已修正 app.py 的 _init_preferences()，改為檢查 session_state 值是否在允許清單內，不合法時自動重設為預設值，避免 ui_theme KeyError。

- 2026-04-26：依使用者截圖回饋，準備調整 app.py CSS：齒輪固定到真正右下角並加入 hover 旋轉；sidebar 資料類型與資料處理控制加入 hover 微亮框線效果。

- 2026-04-26：已修改 app.py CSS，將齒輪 popover 容器鎖定為右下角 52px 小範圍，按鈕 hover 旋轉並移開回復；sidebar radio / checkbox label 新增 hover 淡底、框線與柔光效果。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓齒輪位置與 sidebar hover CSS 生效。

- 2026-04-26：依使用者回報，準備修正切換非深色主題後部分 Streamlit 元件仍保留深色底或深色字，導致 file uploader、expander、number input 等文字對比不足。

- 2026-04-26：已修改 app.py CSS，將 h/p/span/div/label、button 內文、expander、file uploader、input/select/textarea、number input、alert 等 Streamlit 元件的背景與文字色統一套用主題變數，改善非深色主題的文字對比。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓主題對比色 CSS 生效。

- 2026-04-26：依使用者要求，準備將 sidebar 資料類型 radio 改為 hover 自動向下展開的選單，減少頂部佔用高度，讓後續載入檔案等處理步驟往上移。

- 2026-04-26：已修改 app.py，新增 _read_selected_type_from_query() 與 _render_data_type_menu()，用自製 HTML/CSS hover 下拉選單取代 sidebar 資料類型 radio，平常只佔一列高度，滑鼠移上去向下展開，點選後用 query parameter 切換資料類型。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓資料類型 hover 下拉選單生效。

- 2026-04-26：依使用者追加需求，準備將資料類型 hover 選單改為 sidebar 完整寬度，並新增右側 hover 抽屜式最近資料頁紀錄；切換仍使用同一 Streamlit session，以保留已調整的模組參數。

- 2026-04-26：已修改 app.py，資料類型 hover 選單改為 sidebar 完整寬度並移除頂部雙欄布局；新增 _remember_data_type_visit() 與 _render_page_history_drawer()，在網頁右側加入 hover 由右往左展開的資料頁紀錄抽屜，列出最近使用資料類型與可切換模組。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓 sidebar 完整寬度下拉選單與右側紀錄抽屜生效。

- 2026-04-26：依使用者要求，準備移除左側資料類型與資料處理區塊；資料類型切換與扣除高斯工具入口統一移到右側紀錄抽屜，左側只保留各模組處理步驟。

- 2026-04-26：已修改 app.py，移除 sidebar 左側頂部資料類型下拉與扣除高斯 checkbox；新增 _read_tool_from_query()，右側紀錄抽屜加入扣除高斯工具入口，使用 ?tool=gaussian 切換，資料類型頁面仍使用 ?data_type=... 切換。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓左側只保留處理步驟、右側抽屜統一切換資料類型與扣除高斯工具的變更生效。

- 2026-04-26：依使用者回報，準備修正右側抽屜連結點選會開新網頁的問題，改為 target=_self 同頁切換；同時將抽屜分成資料類型與工具兩區，扣除高斯移到工具區下方。

- 2026-04-26：已修改 app.py，右側紀錄抽屜改為資料類型與工具分區；資料類型連結加入 target=_self，扣除高斯移到工具區下方並同樣 target=_self，以避免切換時開新網頁。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓右側抽屜分區與同頁跳轉修正生效。

- 2026-04-26：依使用者要求，準備修正右側抽屜資料類型排序，改為固定 XPS/XES/Raman/XRD/XAS，不再把目前選到的項目移到最上方；同時將把手名稱由紀錄改為選單。

- 2026-04-26：已修改 app.py，右側抽屜資料類型排序固定使用 ready 清單順序，不再依最近使用移動位置；右側把手名稱由紀錄改為選單，標題改為資料選單。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓右側抽屜固定排序與選單命名生效。

- 2026-04-26：依使用者要求，準備在左上角新增 nigiro pro 品牌區塊，使用自製 SVG 數據處理 logo，並將 Streamlit page title 改為 nigiro pro。

- 2026-04-26：已修改 app.py，將 Streamlit page title 改為 nigiro pro；新增 _render_brand_header()，在 sidebar 左上角加入自製 SVG 數據處理 logo、nigiro pro 字樣與 data processing subtitle，logo 使用主題 accent 色。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓 nigiro pro 左上角 logo 與頁面標題變更生效。

- 2026-04-26：依使用者要求，準備將品牌字樣改為 Nigiro Pro，並在主內容中間加入低透明度、不可點擊的資料處理浮貼背景圖案，降低空白感。

- 2026-04-26：已修改 app.py，品牌文字由 nigiro pro 改為 Nigiro Pro；新增 _render_main_stickers() 與主畫面浮貼 CSS，在中間空白區加入低透明度的波形、長條圖、節點圖與資料列 SVG 裝飾。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓 Nigiro Pro 品牌大小寫與主畫面浮貼裝飾生效。

- 2026-04-26：依使用者要求，準備放大左上角 Nigiro Pro 品牌區，調整 logo、品牌名稱與 subtitle 尺寸。

- 2026-04-26：已修改 app.py CSS，將 Nigiro Pro logo 從 42px 放大到 54px，品牌名稱從 19px 放大到 24px，subtitle 從 11px 放大到 12px，並調整品牌區 gap/padding/margin。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓放大後的 Nigiro Pro 品牌區生效。

- 2026-04-26：依使用者回報，確認 app.py 的 Streamlit page_title 仍為 nigiro pro 小寫，準備改為 Nigiro Pro。

- 2026-04-26：已修改 app.py，將 st.set_page_config(page_title) 由 nigiro pro 改為 Nigiro Pro。

- 2026-04-26：重新讀取 CLAUDE.md；已重啟 8504 Streamlit 服務並確認 health check 回傳 ok，讓分頁標題 Nigiro Pro 生效。
