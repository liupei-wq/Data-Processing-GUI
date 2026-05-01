# Data-Processing-GUI 重構筆記

## Refactor goal

在盡量保留既有 UI 外觀與操作流程的前提下，逐步把 spectroscopy data processing GUI 拆成更容易維護的架構。短期重點是先建立模組化 processing layer 的骨架，並加入可重用的 plot popup infrastructure；後續再把各頁大型 inline processing logic 慢慢移入模組。

## New folder structure

```text
web/frontend/src/hooks/
web/frontend/src/components/plots/
web/frontend/src/modules/
web/frontend/src/modules/processing/
web/frontend/src/modules/processing/common/
web/frontend/src/modules/processing/raman/
web/frontend/src/modules/processing/xrd/
web/frontend/src/modules/processing/xas/
web/frontend/src/modules/processing/xps/
web/frontend/src/modules/processing/xes/
```

## New files added

- `src/hooks/usePlotPopups.ts`
- `src/components/plots/PlotPopup.tsx`
- `src/components/plots/PlotPopupHost.tsx`
- `src/modules/processing/common/types.ts`
- `src/modules/processing/common/pipeline.ts`
- `src/modules/processing/common/index.ts`
- `src/modules/processing/index.ts`
- `src/modules/processing/raman/index.ts`
- `src/modules/processing/xrd/index.ts`
- `src/modules/processing/xas/index.ts`
- `src/modules/processing/xps/index.ts`
- `src/modules/processing/xes/index.ts`
- `TESTING_NOTES.zh-TW.md`

## Existing files modified

- `src/App.tsx`
- `src/components/SpectrumChart.tsx`
- `src/components/GaussianSubtractionChart.tsx`
- `src/components/WorkspaceUi.tsx`
- `src/pages/Raman.tsx`
- `src/pages/XRD.tsx`
- `src/pages/XAS.tsx`
- `src/pages/XPS.tsx`
- `src/pages/XES.tsx`
- `src/pages/SingleProcessTool.tsx`
- `src/index.css`

## Processing module design

`modules/processing/common/types.ts` 定義共用資料型別：`XYPoint`、`SpectrumSeries`、`ProcessingStepResult`、`ProcessingHistoryItem`。

`modules/processing/common/pipeline.ts` 提供 frontend-only 的 `runProcessingPipeline`，會依序執行 enabled steps、略過 disabled steps，並回傳 final data 與 processing history。目前先不改 backend API，也不大搬頁面內既有 processing logic。

各 module folder 目前先放 adapter entry point，後續可逐步加入 normalization、background subtraction、smoothing、range cropping、data conversion 等 wrapper。

## Plot popup design

`usePlotPopups` 在 App 層管理 popup plot 狀態，提供：

- `popupPlots`
- `openPlotPopup({ title, content })`
- `closePlotPopup(id)`
- `closeAllPlotPopups()`

`PlotPopupHost` 使用 portal 掛到 `document.body`，避免被 App layout 的 overflow 影響。`PlotPopup` 使用 `position: fixed`、高 z-index、可拖曳 header、關閉按鈕，並保持背景頁面可捲動與可互動。

## Current implementation status

- 已新增 popup infrastructure。
- 已在 `SpectrumChart` 與 `GaussianSubtractionChart` 加入 optional `onOpenPopup`。
- 已在 App 層加入 popup host。
- Raman、XRD、XAS、XPS、XES 與 SingleProcessTool 目前已有 popup entry。
- 已新增 processing module scaffold 與 pipeline helper。
- 已保留 backend 行為不變。

## 2026-05-02 low-risk UX updates

- Plot popup 開啟後可用 `Esc` 一次關閉所有浮動圖表。
- 瀏覽器視窗縮放時，plot popup 會自動限制在可視範圍內。
- 沒有 popup 時 `PlotPopupHost` 會回傳 `null`，減少不必要的頁面節點。
- `SpectrumChart` 與 `GaussianSubtractionChart` popup 按鈕補上 `aria-label`。
- 手機寬度下微調 popup 寬度與內距。

## Remaining TODO items

- 用真實 Raman、XRD、XAS、XPS、XES 檔案逐頁跑完整流程。
- 檢查大型資料集在 popup 中的互動效能。
- 評估 Plotly / chart-heavy 頁面的 lazy loading，降低初次 bundle 體積。
- 把常見數字輸入 parser 抽成共用 helper，避免空字串被 `Number('')` 轉成 `0`。
- 將各頁 processing trace / data conversion 逐步搬進 module adapters。
- 補上 focused unit tests 與端到端測試。

## How to test

```bash
cd web/frontend
npm install
npm run build
```

```bash
cd web
python -m uvicorn backend.main:app --reload --port 8000
```

```bash
cd web/frontend
npm run dev
```

手動檢查：

- 開啟 Raman、XRD、XAS、XPS、XES、SingleProcessTool。
- 上傳或載入測試資料並產生圖表。
- 點擊「彈出圖表」。
- 確認浮動圖表可拖曳、可關閉、可用 `Esc` 關閉。
- 確認背景頁面仍可捲動與互動。
