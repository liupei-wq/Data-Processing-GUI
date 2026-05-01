# Data-Processing-GUI 測試與使用性檢查筆記

## 測試目標

確認目前環境設定、前端建置、前後端啟動，以及 plot popup 的低風險使用性改善不會破壞既有頁面。

## 已執行或建議執行的指令

### Windows PowerShell

```powershell
.\scripts\setup_frontend.ps1
.\scripts\setup_backend.ps1
.\scripts\run_backend.ps1
.\scripts\run_frontend.ps1
```

### 手動驗證

```powershell
cd web\frontend
npm.cmd install
npm.cmd run build
```

```powershell
cd web
..\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000
```

```powershell
cd web\frontend
npm.cmd run dev
```

## 使用性改善紀錄

- plot popup 開啟後可用 `Esc` 一次關閉所有浮動圖表。
- 瀏覽器視窗縮放時，plot popup 會自動限制在可視範圍內，避免拖到畫面外後無法操作。
- 沒有 popup 時不渲染 popup host，減少不必要的頁面節點。
- `SpectrumChart` 與 `GaussianSubtractionChart` 的 popup 按鈕補上 `aria-label`。
- 手機寬度下微調 popup 寬度與內距，避免浮動視窗擠出畫面。

## 尚未完成或需要真實資料驗證的項目

- 使用真實 Raman、XRD、XAS、XPS、XES 檔案逐頁跑完整流程。
- 檢查大型資料集在圖表 popup 中的互動效能。
- 評估是否要把 chart-heavy 頁面或 Plotly 圖表改成 lazy loading，以降低初次載入體積。
- 整理數字輸入欄位的共用 parser，避免空字串被 `Number('')` 轉成 `0`。
- 補上 Playwright 或其他端到端測試，覆蓋上傳、處理、彈出圖表與關閉流程。

## 2026-05-02 實測結果

- `scripts/setup_frontend.ps1`：通過，`npm audit` 顯示 `0 vulnerabilities`。
- `scripts/setup_backend.ps1`：通過，後端依賴已安裝於 `.venv`。
- `npm.cmd run build`：通過。
- 後端 health check：`curl http://127.0.0.1:8000/health` 回傳 `{"status":"ok"}`。
- 前端 dev server：`curl -I http://localhost:3000` 回傳 `HTTP/1.1 200 OK`。
- `git diff --check`：沒有 whitespace error，僅有 Windows CRLF 提醒。

非阻塞警告：

- Vite build 提醒 bundle 大於 500 kB，目前主要是 Plotly / chart-heavy page 體積造成。
- PowerShell `Invoke-WebRequest` 在本環境測 `localhost:3000` 時出現一次物件參考錯誤；改用 `curl.exe` 可正常取得 HTTP 200。
