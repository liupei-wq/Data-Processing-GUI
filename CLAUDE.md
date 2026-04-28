# Nigiro Pro 專案紀錄

## 協作規則

- 回答使用者時一律使用繁體中文。
- 每一次動作前都要先讀取 `CLAUDE.md`。
- 每一次實作、檢查、重啟、重要判斷都要記錄在專案根目錄的 `CLAUDE.md`。
- 不要回復或覆蓋使用者未要求修改的既有變更。
- **本資料夾只剩 `web/` 網頁版**，離線 Streamlit 版已移至獨立 GitHub repo：
  `https://github.com/liupei-wq/Data-Processing-GUI-Desktop`

---

## 兩個 GitHub 倉庫

| 倉庫 | 網址 | 用途 |
|---|---|---|
| **Data-Processing-GUI** | https://github.com/liupei-wq/Data-Processing-GUI | 網頁版（Render / Railway 部署） |
| **Data-Processing-GUI-Desktop** | https://github.com/liupei-wq/Data-Processing-GUI-Desktop | Streamlit 離線版 |

---

## 網頁版目錄結構

```
web/
├── backend/
│   ├── main.py              # FastAPI 入口，掛載 xrd/raman/xas/xps/xes router
│   ├── requirements.txt
│   └── routers/
│       ├── xrd.py           # XRD 5 個 endpoints（含 Scherrer、Gaussian）
│       ├── raman.py         # Raman parse/process/peaks/references/fit
│       ├── xas.py           # XAS parse/process（TEY/TFY 雙通道）
│       ├── xps.py           # XPS parse/process/peaks/fit/vbm/rsf
│       └── xes.py           # XES parse/process/peaks/references（1D 光譜模式）
├── frontend/
│   ├── package.json         # React 18 + Vite + Tailwind + Plotly.js
│   ├── vite.config.ts       # dev proxy /api → port 8000
│   └── src/
│       ├── App.tsx          # 根元件，主題 / 字體 / workspace 路由
│       ├── index.css        # CSS 變數主題系統（6 主題：杏桃/柔白/海霧/黑曜/暮焰/森夜）
│       ├── pages/
│       │   ├── XRD.tsx
│       │   ├── Raman.tsx
│       │   ├── XAS.tsx
│       │   ├── XPS.tsx
│       │   ├── XES.tsx
│       │   └── SingleProcessTool.tsx  # 背景扣除 / 歸一化 / 高斯扣除 單一工具
│       ├── components/
│       │   ├── AnalysisModuleNav.tsx  # 固定順序模組切換
│       │   ├── FileUpload.tsx
│       │   ├── ProcessingPanel.tsx
│       │   ├── SpectrumChart.tsx
│       │   └── GaussianSubtractionChart.tsx
│       ├── api/             # xrd.ts / raman.ts / xas.ts / xps.ts / xes.ts
│       └── types/           # xrd.ts / raman.ts / xas.ts / xps.ts / xes.ts
├── Dockerfile               # 多階段 build（Node → Python + 靜態服務）
railway.toml                 # builder=DOCKERFILE，healthcheckPath=/health
render.yaml                  # Render Blueprint，plan=free
```

---

## 本機啟動

```bash
# Terminal 1：後端
cd web && uvicorn backend.main:app --reload --port 8000

# Terminal 2：前端
cd web/frontend && npm install && npm run dev
# 開 http://localhost:3000
```

## 部署

- **Render**（目前主力）：`render.yaml` 自動讀取，free plan，15 分鐘無流量 spin down
- **Railway**：`railway.toml`，`builder=DOCKERFILE`，`$PORT` 由 Dockerfile CMD 的 `sh -c` 展開
- Render 網址：`https://data-processing-gui-web.onrender.com/`

---

## API 端點總覽

| Prefix | 端點 | 說明 |
|---|---|---|
| `/api/xrd` | parse / process / peaks / references / reference-peaks | XRD 完整流程 |
| `/api/raman` | parse / process / peaks / references / reference-peaks / fit | Raman + 峰擬合 |
| `/api/xas` | parse / process | TEY+TFY 雙通道，energy/bg/norm/white-line |
| `/api/xps` | parse / process / peaks / fit / vbm / rsf | Shirley/Tougaard 背景，峰擬合含 Area%，VBM 外推，RSF 定量 |
| `/api/xes` | parse / process / peaks / references / reference-peaks | 1D 光譜模式，BG1/BG2 扣除，能帶對齊 |

---

## Docker Build 修復（2026-04-29）

- **問題**：`COPY db/ ./db/` 與 `COPY core/ ./core/` 失敗，因為這兩個目錄在離線版移走後從專案根目錄消失
- **解法**：將 `core/`（parsers/processing/peak_fitting/spectrum_ops）與 `db/`（raman/xrd/xps/xes database）從 Desktop repo 複製到 `web/backend/` 內；Dockerfile 改為 `COPY web/backend/core/` 與 `COPY web/backend/db/`
- `core/ui_helpers.py`（含 Streamlit import）不複製，只複製 web backend 需要的模組

---

## UI 修復紀錄（2026-04-29）

- **AnalysisModuleNav**：移除 SEM「Coming soon」項目，所有模組全部可點擊
- **右側 workspace-launcher**：新增「分析模組」區塊（Raman/XRD/XPS/XAS/XES），可直接切換回各分析頁面
- **側欄縮放平滑**：XAS.tsx / XPS.tsx 拖動時移除 `transition-[width]`，加入 `body.style.cursor/userSelect` 防文字選取
- **XAS 側欄框線**：移除各 section 的 `border-b border-[var(--card-divider)]`，改用 padding 分隔
- **FileUpload**：新增 `accept?: string[]` prop（XAS/XPS 使用），`isLoading` 改為 optional（XES 不傳也不報錯）
- **XES.tsx**：`onFilesSelected` → `onFiles`；`chartLayout` xaxis/yaxis title 改為 `{ text: ... }` 物件格式（Plotly v2 API）
- TypeScript 零錯誤

---

## 各模組完成度

| 模組 | 狀態 | 後端 Router | 前端頁面 |
|---|---|---|---|
| **Raman** | ✅ 核心完成，含 Si 應力估算 + preset 匯入/匯出 | `routers/raman.py` | `pages/Raman.tsx` |
| **XRD** | ✅ 最完整 | `routers/xrd.py` | `pages/XRD.tsx` |
| **XAS** | ✅ 核心＋高斯扣除＋二階微分＋XANES 去卷積全部完成 | `routers/xas.py` | `pages/XAS.tsx` |
| **XPS** | ✅ 含進階功能 | `routers/xps.py` | `pages/XPS.tsx` |
| **XES** | ⚠️ 僅 1D 光譜模式，缺 FITS 影像模式 | `routers/xes.py` | `pages/XES.tsx` |
| SEM | ⏳ 未實作 | — | — |

---

## 各模組待搬運功能詳細說明

### ① XAS — 高斯模板扣除（`fit_fixed_gaussian_templates`）

**用途**：在做背景扣除前，先用固定形狀的高斯模板扣掉已知的雜散峰（如 Bragg 峰、二階光）。

**演算法**（來自 `core/spectrum_ops.py: fit_fixed_gaussian_templates`）：
```
輸入：energy array, signal, centers=[{name, center, enabled}], fixed_fwhm, fixed_area, search_half_width
流程：
  對每個 center point（按能量排序）：
    1. 在 [seed_center ± search_half_width] 掃 161 個候選位置
    2. 對每個候選位置，計算 score = ∫ positive_residual × gaussian_template dx
    3. 選 score 最大的位置 → best_center
    4. 在 best_center 建高斯模板，從 residual 中扣除
  返回：(total_model, signal_after_subtraction, fit_rows)
```

**高斯模板參數**：
- User 在圖上讀取峰高（`peak_height`）和設定 FWHM
- `area = peak_height × fwhm × 1.0645`（高斯函數換算係數）
- 模板 amplitude = area / (σ × √(2π))，σ = fwhm / 2.3548

**網頁版後端需要新增**：
- `POST /api/xas/gaussian-subtract`
  - 輸入：`{ x, y, centers:[{name, center}], fwhm_ev, peak_height, search_half_width }`
  - 輸出：`{ y_model, y_after, fit_rows:[{name, seed, fitted_center, shift, fwhm, area}] }`
- 實作直接 copy `fit_fixed_gaussian_templates` 邏輯（不依賴 streamlit）

**前端新增（XAS.tsx）**：
- Sidebar 新步驟「高斯模板扣除」
- 可新增多個高斯中心點（表格：name, center_eV, enabled）
- 設定 FWHM 和峰高（告知使用者直接從圖上讀取）
- 顯示「高斯對照圖」：原始 / 高斯模板 / 扣除後

---

### ② XAS — XANES 去卷積擬合（`run_xanes_fit`）

**用途**：對歸一化後的 XANES 光譜，擬合 Step function + 多峰，分解各特徵峰的位置與強度。

**演算法**（來自 `modules/xas_fit.py: run_xanes_fit`）：
```
輸入：energy, y_norm, peaks_df, fwhm_inst, fwhm_init, link_fwhm, include_step, e0, fit_range
模型：
  Step（Arctan）：center=E0(固定), amplitude=1.0(固定), sigma 自由擬合
  每個峰（Gaussian 或 Lorentzian）：
    center = 使用者指定 ± delta（偏移範圍）
    amplitude > 0
    sigma >= fwhm_inst/2.3548（儀器解析度下限）
    link_fwhm=True → 所有峰 sigma 連動到 step_sigma（或第一峰）
使用 lmfit 進行最小二乘擬合（method="leastsq"）
回傳：success, y_fit, components dict, residual, r_factor, params_table
```

**r_factor 計算**：`r = Σ(y - y_fit)² / Σy²`（越小越好）

**前端 peaks_df 格式**（DataFrame columns）：
- `啟用`：bool
- `峰形`：'Gaussian' | 'Lorentzian'
- `中心_eV`：float
- `偏移範圍_eV`：float（center 可偏移的 ±range）
- `Peak_Name`：str（可空白）

**網頁版後端需要新增**：
- `POST /api/xas/deconv`
  - 輸入：`{ x, y, peaks:[{center, delta, name, ptype}], fwhm_inst, fwhm_init, link_fwhm, include_step, e0, fit_lo, fit_hi }`
  - 輸出：`{ success, y_fit, components:{prefix: y[]}, residual, r_factor, params_table, message }`
- 需要 `lmfit` 依賴（已在 `web/backend/requirements.txt` 中）

**前端新增（XAS.tsx）**：
- Sidebar 新步驟「XANES 去卷積擬合」（僅在歸一化完成後啟用）
- 設定擬合範圍、E0（自動或手動）、FWHM 儀器下限、連動 FWHM checkbox
- 峰位管理表格（新增/刪除/啟用）
- 執行擬合按鈕 → 顯示擬合圖（含各分量）+ 結果表格

---

### ③ XAS — 二階微分輔助（`second_derivative`）

**用途**：二階微分峰谷對應邊緣特徵位置，輔助選取 XANES 峰位。

**演算法**（來自 `modules/xas_fit.py: second_derivative`）：
```python
dy  = np.gradient(y, x)   # 一階微分
d2y = np.gradient(dy, x)  # 二階微分（負值對應峰位）
```

**網頁版後端**：可在 `/api/xas/process` 回傳時加上 `y_d2y` 欄位，或獨立端點。
前端在主圖下方疊加二階微分曲線（不同 y 軸，用 plotly secondary y-axis）。

---

### ④ Raman — Si 峰位移 → 雙軸應力估算

**用途**：擬合後若有 Si 峰，自動計算薄膜應力。

**演算法**（Anastassakis et al., 1990）：
```
觸發條件：擬合結果中有 Material 含 "Si"（正則 n-Si/p-Si/Si）且峰位在 480–570 cm⁻¹
公式：
  Δω = center - ref_pos          （ref_pos 預設 520.7 cm⁻¹，體矽）
  σ (GPa) = Δω / coeff           （coeff 預設 -1.93 cm⁻¹/GPa，雙軸）
解讀：
  σ < -0.05 GPa → 壓應力（compressive）
  σ >  0.05 GPa → 拉應力（tensile）
  否則 → 接近無應力
```

**其他轉換係數參考**：
- 雙軸 (100) Si：−1.93 cm⁻¹/GPa（最常用）
- 單軸 [100]：約 −1.6 cm⁻¹/GPa

**網頁版實作**：前端純計算（不需要後端 API）。
在 Raman 擬合結果出現 Si 峰時，顯示應力計算卡片。
輸入：ref_pos、coeff → 輸出：Δω、σ、應力解讀。

---

### ⑤ Raman — Preset 匯入/匯出

**格式**（JSON）：`_build_raman_preset_payload` 產生的結構：
```json
{
  "version": 1,
  "params": { "smooth_method": ..., "bg_method": ..., "norm_method": ..., ... },
  "peaks": [
    { "Peak_ID": "P001", "Material": "NiO", "Peak_Name": "TO", "Center_cm": 395.0,
      "FWHM_cm": 50.0, "amplitude": 1000.0, "enabled": true, "peak_type": "Lorentzian" }
  ]
}
```

**網頁版實作**：
- 匯出：前端直接把當前 params + peakCandidates 序列化成 JSON 下載
- 匯入：上傳 JSON → 解析 → 還原 params + peakCandidates 到 state

---

### ⑥ XES — FITS 原始影像模式（暫緩，最複雜）

**流程**（已記錄，待實作）：
```
FITS → Dark/Bias 扣除 → Hot pixel（MAD × 1.4826 threshold，median_filter 替換）
→ 曝光正規化 → 曲率校正（每 row 找 subpixel 中心 → 多項式擬合 → 橫移拉直）
→ ROI 積分（沿列 sum/mean） → Sideband BG 扣除
→ BG1/BG2 1D 分點插值扣除
```
**依賴**：`astropy` (FITS 讀取)、`scipy.ndimage.median_filter`（hot pixel）
**建議**：需先新增 `POST /api/xes/parse-fits` 端點，處理 FITS 影像解析。

---

### ⑦ XES — I0 正規化（暫緩，可後補）

使用者上傳一個 CSV（兩欄：dataset_name, i0_value），
對各光譜除以對應的 I0 值（入射光通量），實作簡單。

---

## 各 Web 模組實作重點（現況）

### XRD（最完整）
- parse / process（含 Gaussian template 扣除） / peaks（含 fwhm_deg 供 Scherrer） / references / reference-peaks
- Scherrer 晶粒分析、log 弱峰視圖、高斯模板扣除圖、參考峰匹配表

### Raman
- parse / process（去尖峰/interpolate/avg/bg/smooth/norm） / peaks / references / reference-peaks / fit
- 峰位管理（從 DB 載入 / 手動新增 / 逐峰編輯）、峰擬合、可疑峰多選停用
- **Si 應力估算**（已完成）：前端純計算，偵測 480–570 cm⁻¹ 峰，Δω = center − ref_pos，σ = Δω / coeff（預設 ref_pos=520.7，coeff=−1.93 GPa/cm⁻¹）
- **Preset 匯入/匯出**（已完成）：前端純計算，JSON 格式 `{version:1, params, peaks}`，匯出下載 / 匯入還原

### XAS（TEY/TFY 雙通道）
- parser：`_is_numeric_line` / `_parse_xas_table_bytes` / `_prepare_tey_tfy_auto` 直接寫在 router
- 支援 6 欄同步輻射 DAT（Energy/Phase/Gap/TFY/TEY/I0）與 3 欄格式
- 後邊緣歸一化：`(y - pre_mean) / edge_step`，E0 自動由最大導數決定
- 前端：TEY（藍）+ TFY（紫）分開繪圖，White Line 橘色虛線標記
- **高斯模板扣除**（已完成）：ProcessParams 加入 `gauss_enabled/gauss_channel/gauss_peaks/gauss_search`，ProcessedDataset 輸出 `tey_gaussian/tfy_gaussian/tey_after_gauss/tfy_after_gauss`；後端 `_gaussian()` + `_fit_gaussian_center()` 實作，在背景扣除前執行；前端 Sidebar Step 7 + 對照圖
- **二階微分**（已完成）：ProcessParams 加入 `d2y_enabled`，ProcessedDataset 輸出 `tey_d2y/tfy_d2y`；`np.gradient(np.gradient(y, x), x)`，歸一化後計算；前端 Sidebar Step 8 + 獨立圖表
- **XANES 去卷積擬合**（已完成）：`POST /api/xas/deconv`，lmfit Step(arctan)+Gaussian/Lorentzian，sigma 下限=fwhm_inst/2.3548，link_fwhm 選項；前端 Sidebar Step 9（峰位管理表格+擬合按鈕）+ 結果圖（原始/總擬合/各分量/殘差）+ 參數表；lmfit 已加入 requirements.txt

### XPS（含進階分析）
- 背景：Shirley / Tougaard(B=2866/C=1643) / Linear / Polynomial / AsLS / airPLS
- 峰偵測時自動偵測並翻轉反向 x 軸（高 BE 在左），圖表 `autorange: 'reversed'`
- **Core Level / Valence Band 模式切換**（sidebar 頂端 toggle）
- **VBM 外推**（步驟 9，VB 模式）：`POST /api/xps/vbm`
  - edge 區域線性擬合 → 外推至 baseline level → VBM
  - `vbm = (baseline_mean - intercept) / slope`
- **能帶偏移**（步驟 10，VB 模式）：前端純計算
  - VBM差值法：ΔEV = VBM_A − VBM_B，σΔEV = √(σA²+σB²)
  - Kraut Method：ΔEV = (CL_A−VBM_A) − (CL_B−VBM_B) − (CL_A_int−CL_B_int)
- **RSF 定量分析**（擬合後）：`POST /api/xps/rsf`
  - 查 Scofield ORBITAL_RSF → Atomic% = (Area/RSF) / Σ(Area/RSF) × 100

### XES（1D 光譜模式）
- BG1/BG2 1D 插值扣除（依樣品位置加權：w = (pos+1)/(total+1)）
- 多檔平均 / 平滑 / 歸一化 / X 軸線性校正（eV = offset + slope × pixel）
- 峰值偵測 / 參考峰 overlay / 能帶對齊（Eg = CBM−VBM，ΔEV，ΔEC）

---

## 重要技術細節

### XPS x 軸反轉
XPS 資料 x 軸是 Binding Energy，習慣高 BE 在左。
- 後端峰偵測：先判斷 `x[-1] < x[0]`，若是則 flip x/y 再偵測
- 前端圖表：`autorange: 'reversed'`

### 高斯模板扣除（Gaussian template subtraction）計算順序
XRD / XAS 的高斯模板扣除都是在背景扣除 **之前** 進行。
UI 步驟順序與實際計算順序不同，若未來要求「對 normalized 後做扣除」需另外調整。

### XAS 高斯面積換算
`area = peak_height × fwhm × 1.0645`
（1.0645 = √(2π)/√(4ln2)，高斯函數的面積/峰高/FWHM 換算係數）

### XAS E0 自動偵測
`_derivative_edge_energy(energy, signal, window)` → 在 window 範圍內找一階導數最大值的能量。

### 後端 XAS parser 不可 import modules/xas_auto.py
那個檔案有 streamlit import，改成把 parser helper 直接寫在 `web/backend/routers/xas.py` 裡。

### lmfit 依賴
XANES 去卷積擬合需要 `lmfit`。確認已加入 `web/backend/requirements.txt`。

---

## 部署注意事項

- `railway.toml`：`builder=DOCKERFILE`，不要設 startCommand（`$PORT` 展開問題）
- Dockerfile 在 `web/Dockerfile`（多階段 build：Node build → Python serve）
- `node_modules` 不進 git（已在 `.gitignore`）
- `vite-env.d.ts` 必須存在（缺少時 VSCode 報大量 JSX TS7026）
- Vite chunk size warning（~5 MB）與 postcss warning 不阻擋 build
- `python3 -m py_compile web/backend/main.py web/backend/routers/*.py` 可驗證後端語法

---

## 前端 App 路由

```typescript
type WorkspaceId =
  | 'workflow-raman' | 'workflow-xrd' | 'workflow-xas' | 'workflow-xps' | 'workflow-xes'
  | 'tool-background' | 'tool-normalize' | 'tool-gaussian'
```

- 右下角齒輪（hover 展開）：主題 6 種 / 字體 3 種 / 字級 3 種
- 右側 hover 抽屜（`選單`）：單一處理工具

---

## 各資料庫鍵值說明（供未來新增資料使用）

### Raman DB（`db/raman_database.py` 在 Desktop repo）
格式：`{ material: { peaks: [{position_cm, label, fwhm_cm, peak_type}] } }`

### XRD DB（`db/xrd_database.py` 在 Desktop repo）
格式：`{ phase: { peaks: [{two_theta, relative_intensity, hkl}], color, ...} }`

### XPS DB（`db/xps_database.py` 在 Desktop repo）
- `ELEMENTS`：元素週期表 + peaks list（label, be, fwhm）
- `ORBITAL_RSF`：鍵格式 `"Ni 2p3/2": 14.07`（Al Kα，Scofield 1976）
- `ELEMENT_RSF`：元素層級近似

### XES DB（`db/xes_database.py` 在 Desktop repo）
格式：`{ material: { peaks: [{label, energy_eV, tolerance_eV, relative_intensity, meaning}] } }`
已知材料：NiO / Ga2O3 / n-Si
