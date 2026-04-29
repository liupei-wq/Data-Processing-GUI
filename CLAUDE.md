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

## XPS 大改版（2026-04-29）

對齊離線版 XPS 操作流程，完整重構 `web/frontend/src/pages/XPS.tsx`：

- **移除「自動尋峰」步驟**：原 Step 7（自動尋峰）完全移除；消除所有 `detectedPeaks`/`peakEnabled` 相關 state、useEffect、函式
- **移除「平滑」步驟**：原 Step 5（平滑）從 sidebar 移除（後端 ProcessParams 保留）
- **步驟重新編號**：載入=1, 內插平均=2, 能量校正=3, 背景扣除=4, 歸一化=5, 峰擬合=6, VBM=7, 能帶偏移=8
- **歸一化新增「算術平均」**：Step 5 新增 `mean_region` 選項；選擇後顯示起始/結束 eV 輸入欄
- **峰擬合改為元素資料庫模式**（Step 6）：
  - 上方「從元素資料庫載入」：dropdown 選元素（自動載入 `/api/xps/elements`），按「載入」按 `/api/xps/element-peaks/{element}` 取回峰位一次加入 peakCandidates
  - 下方保留「手動新增峰」按鈕
  - peakCandidates 的 label（如「Ni 2p3/2」）透過 `peak_labels` 傳給後端，擬合結果峰名稱即為 label
- **主內容改動**：
  - 摘要卡「偵測峰數」改為「擬合峰數」（顯示 fitResult.peaks.length）
  - 移除「自動偵測峰位」表格區塊
  - 移除「偵測峰位 CSV」匯出按鈕
- 後端 `routers/xps.py`：`InitPeak` 加 `label`；`FitRequest` 加 `peak_labels`；峰名稱優先使用 `peak_labels`
- `types/xps.ts`：`norm_method` 加 `mean_region`；`InitPeak` 加 `label?`；新增 `ElementDbPeak`/`ElementPeaksResponse`/`ElementListItem`
- `api/xps.ts`：新增 `fetchElementPeaks`/`listElements`；`fitPeaks` 加 `peakLabels?` 參數；保留 `detectPeaks`（api 層保留但 XPS 頁面不使用）
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

## 側欄 UI 統一改版（2026-04-29）

所有模組的左側步驟欄已統一改為 XRD 的可折疊卡片風格。

| 模組 | 改動說明 |
|---|---|
| **Raman** | `SidebarCard` 改為可折疊，加 `defaultOpen`、+/− 切換鈕 |
| **XES** | `SidebarCard` 重新設計：`theme-block rounded-[22px]`，加 hint 和 +/− |
| **XPS** | `SectionHeader` + 平鋪 div 全部換成 `Section` 可折疊元件；加 `px-4 pt-4` wrapper |
| **XAS** | 原本無卡片結構，`SectionHeader` 換成 `Section` 元件，9 個 steps 全部可折疊 |

共用 `Section` 元件設計：
- `theme-block mb-3 overflow-hidden rounded-[22px]`
- 步驟徽章：`accent-tertiary` 底色（16% mix）
- 預設：step 1 展開，其他 `defaultOpen={false}`
- +/− toggle，`hover:bg-[var(--card-ghost)]`

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

---

## XPS 修正與補強（2026-04-29, 本輪）

### 問題修正
- 修正 `web/backend/routers/xps.py` 的 XPS 處理 bug：
  - `smooth_signal()` 被錯當成回傳 tuple，改回單一陣列
  - `apply_normalization()` 被錯當成回傳 tuple，且參數名改為 `norm_x_start / norm_x_end`
- 這個錯誤會讓 `/api/xps/process` 在部分流程直接失敗，前端上傳後中間圖表不顯示的主因在這裡

### XPS 能量校正
- 新增 `POST /api/xps/calibrate`
- 前端 `XPS.tsx` 的步驟 3 保留原本手動 `BE 位移 (eV)` 輸入
- 同時新增「標準樣品資料庫校正」：
  - 可上傳標準樣品光譜（`xy/txt/csv/vms/pro/dat`）
  - 可從 XPS DB 選標準樣品元素與參考峰（例如 `Au 4f7/2`）
  - 後端會在參考 BE 附近搜尋峰位，自動估計觀測峰中心
  - 偏移量 `offset = reference_be - observed_be`
  - 成功後自動累加到手動 `energy_shift`
- 峰中心估計做法：
  - 先依 `reference_be ± search_window` 截區間
  - 區間內先做小視窗 Savitzky-Golay 平滑
  - 取最大值附近三點做二次曲線頂點估計，失敗則退回最大值位置

### XPS 背景 / 歸一化 UI
- 背景扣除與歸一化區間都新增雙滑桿控制
- 仍保留原本數值輸入框
- `max` 歸一化也補上區間控制，避免後端支援但前端沒開

### XPS 內插點數
- XPS 網頁版新增「自動調整點數」
- 目前 repo 內沒有找到離線版原本的點數函式，所以這裡先採 heuristic：
  - 依每條原始光譜的點距中位數估算目標點數
  - 再取中位數並四捨五入到 50 的倍數
  - 最後限制在 `600–2400` 點之間
- 目標是避免點數太少導致失真，也避免無意義過密造成效能浪費
- 若之後找到離線版的原始公式，再直接換成同一套

### 驗證
- `npm run build`：通過

---

## XPS 疊圖選取卡死修正（2026-04-29, 續）

### 問題原因
- `web/frontend/src/pages/XPS.tsx`
  - 疊圖選擇原本是即時寫入 `overlaySelection`
  - 使用者在 modal 內每勾一筆，就會立刻觸發 processing effect
  - 若一次要選很多筆，例如 30~50 筆，等於在勾選過程中連續重算大量 session
  - 很容易讓前端卡住，看起來像整頁崩潰

### 修正
- 新增 `overlayDraftSelection`
  - modal 內勾選只改草稿，不直接動到真正的 `overlaySelection`
  - 按 `套用疊圖選擇` 才一次提交
  - `取消 / 關閉` 則丟棄草稿，保留原本已套用的疊圖清單
- modal 內的：
  - `全選`
  - `清空`
  - `只留目前`
  也全部改成只操作草稿

### 背景處理節流
- 將疊圖相關 session 的處理從 `Promise.all(keysToProcess.map(...))`
  改成逐筆排隊執行
- 目的：
  - 避免一次對很多資料同時開大量 `/api/xps/process` 請求
  - 降低前端和後端同時被壓爆的風險

### 驗證
- `npm run build`：通過

---

## XPS 回歸修正與上傳文案調整（2026-04-29, 續）

### 修正：中間欄上方資料列消失
- 問題原因：
  - `web/frontend/src/pages/XPS.tsx`
  - 上方資料列仍用 `result?.datasets` 當來源
  - 但切到單筆 session 後，單筆處理回來的 `result.datasets` 只會有 1 筆
  - 導致原本多筆資料的資料列誤判成只有 1 筆，整塊 UI 消失
- 修正：
  - `datasetTabs` 改回直接使用 `rawFiles`

### 修正：內插 / 階段結果取值失效
- 問題原因：
  - active dataset 與 preprocess / background / normalization 仍沿用舊的 `activeDatasetIdx` 對整批結果取值
  - 但現在很多情況是單筆 session bundle，只會回傳單筆 dataset
  - 直接用原索引去抓時會抓不到，連帶讓內插等步驟看起來像失效
- 修正：
  - 新增 `getStageDataset()`
  - 單筆 bundle 時直接取唯一那筆
  - 多筆 / average 時再依條件取 average 或 index 對應結果
  - overlay 圖層也改用同一套 helper，不再混用舊索引邏輯

### 上傳區文案
- `web/frontend/src/components/FileUpload.tsx`
  - 文字從 `拖曳或點擊上傳` 改成 `拖曳或上傳`
- `web/frontend/src/pages/XPS.tsx`
  - XPS 主上傳區明確傳入 `moduleLabel="XPS"`
  - 顯示為 `拖曳或上傳 XPS 檔案`

### 其他
- 移除 XPS 頁面已不再使用的 `pickDataset()` 舊 helper

### 驗證
- `npm run build`：通過

---

## XPS 多筆疊圖卡頓修正與入口精簡（2026-04-29, 續）

### 多筆疊圖卡住原因
- `web/frontend/src/pages/XPS.tsx`
  - 原本多筆疊圖一旦選到多筆資料，前端會對每個被選中的 session 重跑整批 `rawFiles`
  - 同時處理 effect 也把 `datasetBundles` 放在 dependency 裡，會造成不必要的連續重算
- 這在資料筆數很多時會變成非常重，容易讓頁面卡死或看起來像崩潰

### 修正方式
- 新增 `datasetBundlesRef`，處理流程改從 ref 讀 cache，不再因 `datasetBundles` 更新反覆觸發 effect
- 新增 `buildDatasetsForSession()`：
  - 一般單筆處理時，只送該筆資料去 `/api/xps/process`
  - 只有該 session 自己啟用 `average` 且確實有多筆資料時，才送整批資料
- `getBundleDataset()` 補上單筆 bundle 的安全取值邏輯，避免用原始 index 去抓只有 1 筆的結果

### 多筆疊圖入口改成彈窗
- 中間欄最上方原本把：
  - `單筆資料處理`
  - `多筆疊圖比較`
  直接都展開在同一塊
- 現在改成精簡版：
  - 左邊保留單筆資料切換 chip
  - 右邊只留一個 `選擇疊圖資料` 按鈕
- 點按鈕後會像元素週期表一樣開一個 overlay / modal：
  - 列出目前所有上傳資料
  - 筆數多也會完整顯示，可捲動
  - 可逐筆勾選
  - 提供 `全選` / `清空` / `只留目前`
- 目的：
  - 讓中間欄最上方那一列精簡，不要被大量資料 chip 塞滿

### 驗證
- `npm run build`：通過

---

## XPS 分析模組下拉縮小（2026-04-29, 續）

### 左上角感應式分析模組入口
- `web/frontend/src/components/AnalysisModuleNav.tsx`
  - 保留 `mode="dropdown"` 的感應式展開邏輯
  - 但把原本太大的整塊卡片改成小型浮出式入口
- 調整內容：
  - 移除原本大張的 `XPS + 全稱` 顯示方式
  - 改成只顯示：
    - `分析模組`
    - 目前模組縮寫（例如 `XPS`）
  - 整體高度與 padding 縮小
  - 左側加一小段凸出的 tab 視覺，讓它看起來是掛在左上角欄位邊緣
  - dropdown 展開面板保留，但 item 文字細節再縮一點
- 目的：
  - 在側欄往下捲動時，頂部保留一個小型且不擋畫面的模組切換入口
  - 不再像原本那樣吃掉一整塊空間

### 驗證
- `npm run build`：通過
- `python3 -m py_compile web/backend/main.py web/backend/routers/xps.py`：通過

---

## XPS 中間欄多筆疊圖與單筆記憶（2026-04-29, 續）

### 單筆資料各自保存流程設定
- `web/frontend/src/pages/XPS.tsx`
  - 新增 `datasetSessions`，以 `index::fileName` 為 key 保存每一筆資料自己的：
    - `params`
    - `autoInterpPoints`
    - `manualEnergyShiftEnabled`
    - `selectedElement`
    - `fitProfile`
    - `peakCandidates`
    - `fitResult`
    - `rsfRows`
- 切換上方單筆資料按鈕時：
  - 左欄會載入該筆資料自己之前調過的內容
  - 不再把第一筆的背景扣除 / 歸一化 / 能量位移同步套到第二筆
- 切回前一筆資料時：
  - 原本的左欄設定與已完成的峰擬合結果會保留

### 中間欄新增多筆疊圖選擇
- 上方資料列改成兩段：
  - `單筆資料處理`：維持一次只切一筆來細調
  - `多筆疊圖比較`：可多選資料做疊圖
- 多筆疊圖區新增：
  - 各資料 toggle chip
  - `全選`
  - `只看目前`
- 疊圖說明明確標示：
  - 每筆資料都使用各自目前保存的流程參數
  - 疊圖不是共用一套左欄設定強壓到全部資料

### 中間欄疊圖顯示邏輯
- 新增 `datasetBundles`，為每筆資料分別快取：
  - `final`
  - `preprocess`
  - `background`
  - `normalization`
- 會依每筆資料自己的流程設定自動挑選最合適的疊圖層級：
  - 優先顯示 `歸一化後`
  - 否則顯示 `背景扣除後`
  - 否則顯示 `內插 / 平均 / 校正後`
  - 最後才退回 `最終處理後`
- 中間欄會出現一張新的 `多筆疊圖比較` 卡片，用同一張圖疊多筆光譜

### 其他細節
- 切換資料時避免把剛恢復的 `fitResult` 立即清掉，補上 session restore guard
- 前端 build 驗證維持通過

### 驗證
- `npm run build`：通過

---

## XPS 分析模組下拉改感應式（2026-04-29）

- `web/frontend/src/components/AnalysisModuleNav.tsx`
  - dropdown mode 原本是原生 `select`
  - 改成 hover / focus 展開的感應式下拉面板
  - 面板顯示目前模組與其他可切換模組
  - 滑鼠移入展開、移出收起；點選模組後切換並關閉
- XPS 頁面維持使用 `mode="dropdown"`，因此左上角模組切換現在是感應式，不會再是原生 select 外觀
- `npm run build`：通過

---

## 部署未更新排查（2026-04-29）

- 重新讀取 `CLAUDE.md` 後檢查 git 狀態與最近提交
- `git status --short` 顯示目前仍有 **未提交** 的本機修改：
  - `web/backend/routers/xps.py`
  - `web/frontend/src/api/xps.ts`
  - `web/frontend/src/pages/XPS.tsx`
  - `web/frontend/src/types/xps.ts`
- `git log --oneline -n 8` 顯示目前最新 commit 是 `b4a615e (v14.9)`
- `git remote -v` 指向 `origin https://github.com/liupei-wq/Data-Processing-GUI.git`
- 結論：
  - 這些 XPS 改動目前只存在本機工作樹
  - 若部署平台是抓 GitHub / origin 的最新 commit，這批修改**不會上線**
  - 所以「部署後完全沒更新」是正常結果，不是前端快取造成

---

## XPS 中間欄流程圖與週期表補完（2026-04-29）

### 中間欄流程圖
- `web/frontend/src/pages/XPS.tsx`
  - 原本只有一張最終處理圖，改成多階段圖卡
  - 現在流程是：
    1. 原始光譜
    2. 內插 / 平均 / 能量校正後疊圖
    3. 背景扣除圖
    4. 歸一化圖
    5. 最終處理光譜（保留給擬合 / VBM / 匯出）
- 顯示邏輯：
  - 第 1 張圖：只要上傳檔案就顯示
  - 第 2 張圖：有啟用內插 / 平均 / 手動或自動能量校正才顯示
  - 第 3 張圖：啟用背景扣除才顯示
  - 第 4 張圖：選擇歸一化方法才顯示
- 背景扣除與歸一化圖都在圖上加了區間標示：
  - 背景區間：橘色 shaded region + 邊界線 + 標籤
  - 歸一化區間：青綠色 shaded region + 邊界線 + 標籤

### XPS 分階段結果計算
- 前端另外建立 3 組 stage result：
  - `preprocessResult`
  - `backgroundResult`
  - `normalizationResult`
- 不是只拿最後一個 `/process` 回傳值重用，而是分別呼叫：
  - 前處理參數組
  - 前處理 + 背景參數組
  - 前處理 + 背景 + 歸一化參數組
- 這樣中間欄每張圖都能對應正確的上一步輸入與本步輸出

### XPS 元素週期表
- 後端 `web/backend/routers/xps.py`
  - 新增 `GET /api/xps/periodic-table`
  - 回傳元素位置（row/col）、分類、中文分類名、分類色、是否有峰資料
- 前端 `web/frontend/src/api/xps.ts` / `types/xps.ts`
  - 新增 `fetchPeriodicTable()` 與 `PeriodicTableItem`
- `web/frontend/src/pages/XPS.tsx`
  - 在步驟 6 峰擬合區新增元素週期表
  - 有峰資料的元素可直接點選成 `selectedElement`
  - 無峰資料的元素顯示為 disabled
  - 仍保留原本 dropdown + 載入按鈕，不拆掉原操作

### 驗證
- `npm run build`：通過
- `python3 -m py_compile web/backend/main.py web/backend/routers/xps.py`：通過
- `git diff --check`：通過

### 可見性補充
- XPS 第 3 步「能量校正」的新版 UI 已在 `web/frontend/src/pages/XPS.tsx`
  - 含手動 `BE 位移`
  - 含標準樣品上傳
  - 含標準樣品 / 參考峰 / 參考 BE / 搜尋視窗 / 自動套用偏移
- XPS 第 4 步背景扣除拉桿只會在「啟用背景扣除」後顯示
- XPS 第 5 步歸一化拉桿只會在 `norm_method !== 'none'` 時顯示
- 如果看的是部署站而不是本機，仍然看不到是因為目前這批修改還沒 commit / push 到遠端

---

## XPS UI 調整（2026-04-29, 續）

### 能量校正
- 刪除前端手動輸入的：
  - `參考 BE`
  - `搜尋視窗`
- 改成：
  - 標準樣品模式：只選資料庫中的 `標準樣品` 與 `參考峰`
  - 參考 BE 直接用資料庫峰值
  - 搜尋視窗前端不再暴露，固定走預設值
- 另外新增 `手動調整偏移量` checkbox：
  - 沒有丟標準樣品時可勾選
  - 勾選後才顯示手動輸入 `BE 位移 (eV)`

### 背景扣除 / 歸一化拉桿
- 原本是上下兩條各一個 thumb，看起來像兩個軸
- 改成單一軸雙把手樣式：
  - 一條底軌
  - 中間高亮選取區
  - 左右各一個 thumb
- 補上 `xps-range-*` CSS 樣式到 `web/frontend/src/index.css`

### 元素週期表
- 左欄不再直接塞完整週期表
- 改成左欄只顯示一個 `元素週期表` 框框入口
- 點開後在 XPS 主頁上方顯示 overlay / modal 式週期表，不另開分頁
- 點元素後：
  - 回填 `selectedElement`
  - 關閉 overlay

### 驗證
- `npm run build`：通過
- `python3 -m py_compile web/backend/main.py web/backend/routers/xps.py`：通過
