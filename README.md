# Data-Processing-GUI

Nigiro Pro 光譜資料處理平台 — 支援 XRD、Raman、XAS、XPS、XES 等分析模組的網頁應用。

| 項目 | 說明 |
|---|---|
| 網頁版主倉庫 | `https://github.com/liupei-wq/Data-Processing-GUI` |
| 離線桌面版 | `https://github.com/liupei-wq/Data-Processing-GUI-Desktop` |
| 線上站 | `https://data-processing-gui-web.onrender.com/` |

---

## 功能模組

| 模組 | 狀態 | 主要功能 |
|---|---|---|
| **XRD** | ✅ 完整 | MAD 自動尋峰、參考峰匹配、Scherrer、Thin film on Si preset |
| **Raman** | ✅ 完整 | Si 應力估算、Preset 匯入匯出、峰擬合、背景扣除、平滑 |
| **XAS** | ✅ 完整 | TEY+TFY、高斯模板扣除、二階微分、XANES 去卷積 |
| **XPS** | ✅ 最完整 | 能量校正、Shirley/Tougaard/AsLS/airPLS 背景、峰擬合、VBM、RSF 定量 |
| **XES** | ✅ 1D 完整 | I0 正規化、背景扣除、峰偵測；缺 FITS 影像模式 |
| **單一處理** | ✅ 可用 | 背景扣除、歸一化、高斯模板扣除 |
| SEM | ⏳ 未實作 | — |

---

## 技術棧

| 層級 | 技術 |
|---|---|
| 前端 | React 18 + Vite + TypeScript + Tailwind CSS |
| 圖表 | Plotly.js |
| 後端 | FastAPI + Python 3.11 |
| 科學計算 | NumPy, SciPy, pandas, lmfit |
| 部署 | Docker 多階段 build → Render |

---

## 環境設定

### 必要工具

- Node.js LTS：建議 Node 24；Node 22 也可使用。
- npm：建議 npm 10 或以上。
- Python 3.10 或以上。

本專案已加入：

- `.nvmrc`：指定 Node major version `24`。
- `web/frontend/package.json`：指定 `engines.node: >=22 <25`、`engines.npm: >=10`。

### Windows PowerShell 快速啟動

從 repo root 執行：

```powershell
# 初次設定
.\scripts\setup_frontend.ps1
.\scripts\setup_backend.ps1

# 執行（分開兩個 PowerShell 視窗）
.\scripts\run_backend.ps1
.\scripts\run_frontend.ps1
```

前端預設網址：`http://localhost:3000`

後端 health check：`http://127.0.0.1:8000/health`

> PowerShell 可能因 ExecutionPolicy 擋住 `npm.ps1`，本專案腳本使用 `npm.cmd`。若被擋住，可用：
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\scripts\setup_frontend.ps1
> ```

### macOS / Linux 快速啟動

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

### 手動指令

**前端：**

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

**後端：**

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

---

## 部署

專案根目錄已提供 `render.yaml`，Render 可以直接讀取。

### Render 部署步驟

1. 把目前專案 push 到 GitHub
2. 到 Render 建立新服務
3. 選 `Blueprint` 或直接連接這個 GitHub repo
4. Render 會讀取根目錄 `render.yaml`
5. 部署完成後，Render 會提供一個 `onrender.com` 網址

### Render 目前使用的設定

- Runtime：Docker
- Dockerfile：`web/Dockerfile`
- Docker build context：repo root
- Health check：`/health`
- Plan：`free`

### Railway

`railway.toml` 使用 `builder=DOCKERFILE`，不要設定 `startCommand`。

### 注意

- Render 免費 web service 閒置一段時間後會休眠
- 再次開啟時，第一次請求會比較慢

---

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

---

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

---

## 專案結構

```text
web/
├── backend/
│   ├── main.py              # FastAPI 入口
│   ├── requirements.txt     # Python 依賴
│   ├── core/                # 資料處理核心（解析、處理、擬合）
│   ├── db/                  # 各模組資料庫（參考峰、元素資料）
│   └── routers/             # API 路由（xrd / raman / xas / xps / xes）
├── frontend/
│   ├── package.json         # Node 依賴
│   ├── src/
│   │   ├── App.tsx          # 主應用（主題、路由）
│   │   ├── pages/           # 各分析模組頁面
│   │   ├── components/      # 共用元件
│   │   ├── api/             # API client
│   │   └── types/           # TypeScript 型別定義
│   └── public/              # 靜態資源
├── Dockerfile               # 多階段 Docker build
└── static/                  # production 靜態檔案（由 Dockerfile 產生）

scripts/                     # 快速啟動腳本（PowerShell + Bash）
render.yaml                  # Render 部署設定
railway.toml                 # Railway 部署設定
```

---

## 目前已驗證環境

截至 2026-05-03：

- Node.js LTS：`v24.15.0`
- npm：可透過 `npm.cmd` 使用。
- Python virtual environment：`.venv` 使用 Python `3.12.10`。
- 後端 health check：`/health` 回傳 `{"status":"ok"}`。
- 前端 build：`npm.cmd run build` 通過。
- 前端 dev server：`http://localhost:3000` 回傳 HTTP 200。

目前仍有非阻塞警告：前端 bundle 較大，主要和 Plotly / chart-heavy 頁面有關，後續可評估 lazy loading 或 code splitting。

---

## 協作文件

| 文件 | 用途 |
|---|---|
| `CLAUDE.md` | 詳細協作手冊（架構、API、技術備忘、動作紀錄） |
| `AGENTS.md` | AI Agent 快速參考（技術棧、目錄、關鍵約定） |
| `ENV_SETUP.zh-TW.md` | 環境設定細節（本文件已整合其內容） |
