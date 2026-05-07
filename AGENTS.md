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
