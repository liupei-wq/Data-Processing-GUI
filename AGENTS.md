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
| XRD | ✅ 完整 | `/api/xrd` | `pages/XRD.tsx` |
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
