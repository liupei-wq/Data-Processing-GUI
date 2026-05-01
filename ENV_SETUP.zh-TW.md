# Data-Processing-GUI 環境設定

本文件說明如何在本機啟動 Data-Processing-GUI 的前端與後端。專案根目錄包含 `web/frontend` 與 `web/backend`。

## 必要工具

- Node.js LTS：建議 Node 24；Node 22 也可使用。
- npm：建議 npm 10 或以上，通常會隨 Node.js 一起安裝。
- Python 3.10 或以上。
- pip。

本專案已加入：

- `.nvmrc`：指定 Node major version `24`。
- `web/frontend/package.json`：指定 `engines.node: >=22 <25`、`engines.npm: >=10`。

## Windows PowerShell 快速啟動

從 repo root 執行：

```powershell
.\scripts\setup_frontend.ps1
.\scripts\setup_backend.ps1
```

分別開兩個 PowerShell 視窗：

```powershell
.\scripts\run_backend.ps1
```

```powershell
.\scripts\run_frontend.ps1
```

前端預設網址：

```text
http://localhost:3000
```

後端 health check：

```text
http://127.0.0.1:8000/health
```

PowerShell 可能因為 ExecutionPolicy 擋住 `npm.ps1`，所以本專案腳本使用 `npm.cmd`。如果腳本被 PowerShell 擋住，可用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup_frontend.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\setup_backend.ps1
```

## macOS / Linux 快速啟動

從 repo root 執行：

```bash
chmod +x scripts/*.sh
./scripts/setup_frontend.sh
./scripts/setup_backend.sh
```

分別開兩個 terminal：

```bash
./scripts/run_backend.sh
```

```bash
./scripts/run_frontend.sh
```

## 手動前端指令

```bash
cd web/frontend
npm install
npm run dev
```

建置檢查：

```bash
cd web/frontend
npm run build
```

## 手動後端指令

建議從 repo root 建立 virtual environment：

```bash
python -m venv .venv
```

Windows PowerShell：

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r web\backend\requirements.txt
cd web
..\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000
```

macOS / Linux：

```bash
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r web/backend/requirements.txt
cd web
../.venv/bin/python -m uvicorn backend.main:app --reload --port 8000
```

## 常見錯誤排除

### `node: command not found` 或找不到 `node`

原因通常是 Node.js 尚未安裝，或安裝後目前 terminal 的 PATH 尚未更新。

解法：

- 安裝 Node.js LTS。
- 關閉並重新開啟 PowerShell / terminal。
- Windows 可確認 `C:\Program Files\nodejs` 是否存在。
- 本專案的 PowerShell frontend 腳本會在檢查前刷新 Machine/User PATH，並補上 `C:\Program Files\nodejs` 作為常見安裝路徑。

檢查：

```powershell
node --version
```

### `npm: command not found` 或找不到 `npm`

原因通常是 Node.js 安裝不完整，或 PATH 尚未更新。

Windows 建議使用：

```powershell
npm.cmd --version
```

若仍找不到，請重新安裝 Node.js LTS，並重新開啟 PowerShell。

### `uvicorn: command not found`

不要直接依賴全域 `uvicorn` 指令，優先使用：

```bash
python -m uvicorn backend.main:app --reload --port 8000
```

如果使用 `.venv`：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000
```

### `ModuleNotFoundError`

通常代表後端依賴尚未安裝到目前使用的 Python 環境。

解法：

```bash
python -m pip install -r web/backend/requirements.txt
```

若使用 `.venv`，請用 `.venv` 裡的 Python 執行安裝與啟動。

### frontend 無法連到 backend

請確認：

- 後端正在 `http://127.0.0.1:8000` 或 `http://localhost:8000` 執行。
- `http://127.0.0.1:8000/health` 回傳 `{"status":"ok"}`。
- 前端 Vite dev server 透過 `/api` proxy 轉發到 `http://localhost:8000`。

## 如何確認服務正常

後端：

```bash
curl http://127.0.0.1:8000/health
```

預期輸出：

```json
{"status":"ok"}
```

前端：

```bash
curl -I http://localhost:3000
```

預期看到 `HTTP/1.1 200 OK`。

## 目前已驗證環境

截至 2026-05-02：

- Node.js LTS：`v24.15.0`
- npm：可透過 `npm.cmd` 使用。
- Python virtual environment：`.venv` 使用 Python `3.12.10`。
- 後端 health check：`/health` 回傳 `{"status":"ok"}`。
- 前端 build：`npm.cmd run build` 通過。
- 前端 dev server：`http://localhost:3000` 回傳 HTTP 200。

目前仍有非阻塞警告：前端 bundle 較大，主要和 Plotly / chart-heavy 頁面有關，後續可評估 lazy loading 或 code splitting。
