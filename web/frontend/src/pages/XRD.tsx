/**
 * XRD 桌面版主流程 – React 前端本地計算
 *
 * 7個獨立步驟：
 * 1. 上傳數據 (Upload)
 * 2. X軸偏移量微調 (X Shift)
 * 3. 背景扣除與強度轉換 (Signal Transform / Log)
 * 4. 強度歸一化 (Normalization)
 * 5. 疊圖設定 (Plot Settings)
 * 6. 固定參考峰 / 圖例 (Reference Markers)
 * 7. 峰位偏移報告與匯出 (Peak Offset Report / Export)
 */

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, defaultAnimateLayoutChanges, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import Plot, { PlotlyApi } from '../components/PlotlyChart'
import { type AnalysisModuleId } from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import {
  ChartToolbar,
  DEFAULT_SERIES_PALETTE_KEYS,
  DeferredRender,
  EmptyWorkspaceState,
  GuidedSidebarSection,
  LINE_COLOR_PALETTES,
  MODULE_CONTENT,
  StickySidebarHeader,
} from '../components/WorkspaceUi'
import { SampleBasketsButton, SampleBasketsPanel, type BasketFileItem, type SampleBasket } from '../components/SampleBaskets'
import { formatUtc8Iso, timestampForUtc8Filename } from '../utils/time'
import { type XrdDesktopInputFile, type XrdDesktopReferenceDbRow } from '../types/xrdDesktop'

// Origin Pro 經典繪圖配色調色盤
export const ORIGIN_PRO_COLORS = [
  '#000000', // 黑色
  '#ff0000', // 紅色
  '#0000ff', // 藍色
  '#008000', // 綠色
  '#ff00ff', // 洋紅色 (Magenta)
  '#008080', // 深青色 (Dark Cyan)
  '#808000', // 深黃色 (Dark Yellow)
  '#808080', // 深灰色 (Dark Gray)
]

// 固定參考峰的代表色
export const PHASE_COLORS: Record<string, string> = {
  'β-Ga2O3': '#f43f5e',
  'Si': '#10b981',
  'NiO': '#a855f7',
  'Ti3CN': '#eab308',
  'Mo2Ti2C3': '#f97316',
  'TiO2 (Anatase)': '#3b82f6',
  'TiO2 (Rutile)': '#06b6d4',
  'ZnO': '#14b8a6',
}

// 擴充後且補齊的參考峰特徵資料庫 (REFERENCE_DB)
export const REFERENCE_DB: Record<string, Omit<XrdDesktopReferenceDbRow, 'phase'>[]> = {
  'β-Ga2O3': [
    { hkl: '-201', twoTheta: 18.9, intensity: 100, tolerance: 0.3 },
    { hkl: '400', twoTheta: 30.1, intensity: 45, tolerance: 0.3 },
    { hkl: '-111', twoTheta: 31.7, intensity: 35, tolerance: 0.3 },
    { hkl: '111', twoTheta: 35.2, intensity: 60, tolerance: 0.3 },
    { hkl: '-402', twoTheta: 38.4, intensity: 85, tolerance: 0.3 },
    { hkl: '-311', twoTheta: 45.8, intensity: 25, tolerance: 0.3 },
    { hkl: '600', twoTheta: 46.2, intensity: 20, tolerance: 0.3 },
    { hkl: '002', twoTheta: 48.6, intensity: 15, tolerance: 0.3 },
    { hkl: '-603', twoTheta: 59.1, intensity: 40, tolerance: 0.3 },
    { hkl: '311', twoTheta: 60.9, intensity: 30, tolerance: 0.3 },
    { hkl: '403', twoTheta: 64.6, intensity: 22, tolerance: 0.3 },
    { hkl: '-202', twoTheta: 23.5, intensity: 10, tolerance: 0.3 },
    { hkl: '310', twoTheta: 32.8, intensity: 12, tolerance: 0.3 },
    { hkl: '110', twoTheta: 33.2, intensity: 8, tolerance: 0.3 },
    { hkl: '-601', twoTheta: 41.7, intensity: 14, tolerance: 0.3 },
    { hkl: '020', twoTheta: 58.2, intensity: 18, tolerance: 0.3 },
    { hkl: '510', twoTheta: 62.1, intensity: 9, tolerance: 0.3 },
    { hkl: '710', twoTheta: 68.3, intensity: 7, tolerance: 0.3 },
    { hkl: '-801', twoTheta: 71.5, intensity: 11, tolerance: 0.3 },
    { hkl: '021', twoTheta: 74.2, intensity: 13, tolerance: 0.3 },
  ],
  'Si': [
    { hkl: '111', twoTheta: 28.44, intensity: 100, tolerance: 0.3 },
    { hkl: '220', twoTheta: 47.30, intensity: 55, tolerance: 0.3 },
    { hkl: '311', twoTheta: 56.12, intensity: 30, tolerance: 0.3 },
    { hkl: '400', twoTheta: 69.13, intensity: 6, tolerance: 0.3 },
    { hkl: '331', twoTheta: 76.38, intensity: 11, tolerance: 0.3 },
    { hkl: '422', twoTheta: 88.03, intensity: 12, tolerance: 0.3 },
    { hkl: '511', twoTheta: 94.95, intensity: 6, tolerance: 0.3 },
  ],
  'NiO': [
    { hkl: '111', twoTheta: 37.2, intensity: 60, tolerance: 0.3 },
    { hkl: '200', twoTheta: 43.3, intensity: 100, tolerance: 0.3 },
    { hkl: '220', twoTheta: 62.9, intensity: 57, tolerance: 0.3 },
    { hkl: '311', twoTheta: 75.4, intensity: 16, tolerance: 0.3 },
    { hkl: '222', twoTheta: 79.4, intensity: 15, tolerance: 0.3 },
  ],
  'Ti3CN': [
    { hkl: '002', twoTheta: 6.1, intensity: 100, tolerance: 0.3 },
    { hkl: '004', twoTheta: 12.3, intensity: 40, tolerance: 0.3 },
    { hkl: '006', twoTheta: 18.5, intensity: 20, tolerance: 0.3 },
    { hkl: '008', twoTheta: 24.8, intensity: 15, tolerance: 0.3 },
    { hkl: '0010', twoTheta: 31.2, intensity: 10, tolerance: 0.3 },
    { hkl: '110', twoTheta: 61.5, intensity: 35, tolerance: 0.3 },
  ],
  'Mo2Ti2C3': [
    { hkl: '002', twoTheta: 5.8, intensity: 100, tolerance: 0.3 },
    { hkl: '004', twoTheta: 11.7, intensity: 45, tolerance: 0.3 },
    { hkl: '006', twoTheta: 17.6, intensity: 25, tolerance: 0.3 },
    { hkl: '008', twoTheta: 23.6, intensity: 18, tolerance: 0.3 },
    { hkl: '0010', twoTheta: 29.7, intensity: 12, tolerance: 0.3 },
    { hkl: '0012', twoTheta: 35.9, intensity: 8, tolerance: 0.3 },
    { hkl: '110', twoTheta: 61.2, intensity: 30, tolerance: 0.3 },
  ],
  'TiO2 (Anatase)': [
    { hkl: '101', twoTheta: 25.28, intensity: 100, tolerance: 0.3 },
    { hkl: '103', twoTheta: 36.95, intensity: 10, tolerance: 0.3 },
    { hkl: '004', twoTheta: 37.80, intensity: 20, tolerance: 0.3 },
    { hkl: '200', twoTheta: 48.05, intensity: 35, tolerance: 0.3 },
    { hkl: '105', twoTheta: 53.89, intensity: 20, tolerance: 0.3 },
    { hkl: '211', twoTheta: 55.06, intensity: 20, tolerance: 0.3 },
    { hkl: '204', twoTheta: 62.69, intensity: 14, tolerance: 0.3 },
    { hkl: '116', twoTheta: 68.76, intensity: 6, tolerance: 0.3 },
    { hkl: '220', twoTheta: 70.31, intensity: 6, tolerance: 0.3 },
  ],
  'TiO2 (Rutile)': [
    { hkl: '110', twoTheta: 27.44, intensity: 100, tolerance: 0.3 },
    { hkl: '101', twoTheta: 36.08, intensity: 50, tolerance: 0.3 },
    { hkl: '200', twoTheta: 39.22, intensity: 8, tolerance: 0.3 },
    { hkl: '111', twoTheta: 41.25, intensity: 25, tolerance: 0.3 },
    { hkl: '210', twoTheta: 44.08, intensity: 10, tolerance: 0.3 },
    { hkl: '211', twoTheta: 54.34, intensity: 60, tolerance: 0.3 },
    { hkl: '220', twoTheta: 56.64, intensity: 20, tolerance: 0.3 },
    { hkl: '002', twoTheta: 62.74, intensity: 10, tolerance: 0.3 },
    { hkl: '310', twoTheta: 64.04, intensity: 10, tolerance: 0.3 },
    { hkl: '301', twoTheta: 69.01, intensity: 20, tolerance: 0.3 },
  ],
  'ZnO': [
    { hkl: '100', twoTheta: 31.77, intensity: 57, tolerance: 0.3 },
    { hkl: '002', twoTheta: 34.42, intensity: 40, tolerance: 0.3 },
    { hkl: '101', twoTheta: 36.25, intensity: 100, tolerance: 0.3 },
    { hkl: '102', twoTheta: 47.54, intensity: 23, tolerance: 0.3 },
    { hkl: '110', twoTheta: 56.60, intensity: 32, tolerance: 0.3 },
    { hkl: '103', twoTheta: 62.86, intensity: 29, tolerance: 0.3 },
    { hkl: '200', twoTheta: 66.38, intensity: 4, tolerance: 0.3 },
    { hkl: '112', twoTheta: 67.96, intensity: 23, tolerance: 0.3 },
    { hkl: '201', twoTheta: 69.10, intensity: 11, tolerance: 0.3 },
  ],
}

// 側邊欄收折高度與最大寬度定義
const SIDEBAR_MIN_WIDTH = 320
const SIDEBAR_MAX_WIDTH = 560
const SIDEBAR_DEFAULT_WIDTH = 368
const SIDEBAR_COLLAPSED_PEEK = 28

// 取得第 P 百分位數的輔助函數 (基線扣除使用)
function getPercentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[index]
}

// 本地尋峰輔助函數
/**
 * 從 (x, y) 中針對給定峰位 x_p 計算 FWHM。
 * 演算法：① 找最接近 x_p 的索引 pi；② 在 ±2° 視窗內取最小值當 baseline；
 *        ③ y_half = baseline + (y[pi] − baseline)/2；
 *        ④ 自 pi 向左/右走到第一個 y ≤ y_half 的點，線性內插求交點 X；
 *        ⑤ FWHM = rightX − leftX。
 */
function calcFwhmFromTrace(x: number[], y: number[], peakX: number): {
  fwhm: number
  leftHalfX: number
  rightHalfX: number
  peakX: number
  peakHeight: number
  baseline: number
} | null {
  if (x.length === 0 || x.length !== y.length) return null
  let pi = 0
  let pd = Infinity
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs(x[i] - peakX)
    if (d < pd) { pd = d; pi = i }
  }
  // ±2° baseline 視窗
  let lo = pi, hi = pi
  while (lo > 0 && x[pi] - x[lo - 1] < 2) lo--
  while (hi < x.length - 1 && x[hi + 1] - x[pi] < 2) hi++
  let baseline = y[pi]
  for (let i = lo; i <= hi; i++) {
    if (y[i] < baseline) baseline = y[i]
  }
  const peakHeight = y[pi] - baseline
  if (peakHeight <= 0) return null
  const yHalf = baseline + peakHeight / 2

  let leftIdx = -1
  for (let i = pi - 1; i >= 0; i--) {
    if (y[i] <= yHalf) { leftIdx = i; break }
  }
  let rightIdx = -1
  for (let i = pi + 1; i < x.length; i++) {
    if (y[i] <= yHalf) { rightIdx = i; break }
  }
  if (leftIdx < 0 || rightIdx < 0) return null

  const interp = (i1: number, i2: number) => {
    const y1 = y[i1], y2 = y[i2]
    if (y1 === y2) return x[i1]
    const t = (yHalf - y1) / (y2 - y1)
    return x[i1] + t * (x[i2] - x[i1])
  }
  const leftX = interp(leftIdx, leftIdx + 1)
  const rightX = interp(rightIdx - 1, rightIdx)

  return { fwhm: rightX - leftX, leftHalfX: leftX, rightHalfX: rightX, peakX: x[pi], peakHeight, baseline }
}

/** Bragg's law: d = λ / (2 sin θ)，θ = 2θ/2 度→弧度 */
function calcDSpacing(twoThetaDeg: number, lambdaAng: number): number {
  const theta = (twoThetaDeg / 2) * Math.PI / 180
  const s = Math.sin(theta)
  if (s <= 0) return NaN
  return lambdaAng / (2 * s)
}

/** Scherrer: D = K·λ / (β·cos θ)，β 為 FWHM (rad)，θ = 2θ/2 (rad)；D 以 Å 為單位 */
function calcScherrerD(twoThetaDeg: number, fwhmDeg: number, K: number, lambdaAng: number): number {
  const theta = (twoThetaDeg / 2) * Math.PI / 180
  const beta = fwhmDeg * Math.PI / 180
  const c = Math.cos(theta)
  if (beta <= 0 || c <= 0) return NaN
  return (K * lambdaAng) / (beta * c)
}

/**
 * SciPy-style prominence：自 peak 向左右走，遇到不低於 peak 的點或邊界停下，
 * 取兩側區段內最小值，prominence = peak − max(leftMin, rightMin)。
 */
function computeProminence(y: number[], peakIdx: number): number {
  const peakY = y[peakIdx]
  let leftBase = 0
  for (let i = peakIdx - 1; i >= 0; i--) {
    if (y[i] >= peakY) { leftBase = i + 1; break }
  }
  let leftMin = peakY
  for (let i = leftBase; i < peakIdx; i++) {
    if (y[i] < leftMin) leftMin = y[i]
  }
  let rightBase = y.length - 1
  for (let i = peakIdx + 1; i < y.length; i++) {
    if (y[i] >= peakY) { rightBase = i - 1; break }
  }
  let rightMin = peakY
  for (let i = peakIdx + 1; i <= rightBase; i++) {
    if (y[i] < rightMin) rightMin = y[i]
  }
  return peakY - Math.max(leftMin, rightMin)
}

/**
 * 升級版尋峰：
 *   - 5-point local max（避免兩點抖動誤判）
 *   - SciPy 式 prominence 篩選（門檻 = global max × 0.5%）擋掉雜訊上的假峰
 *   - 拋物線細修（quadratic refinement）求亞取樣峰位
 */
function findLocalPeaks(x: number[], y: number[], minRelIntensity: number): { x: number; y: number }[] {
  const peaks: { x: number; y: number }[] = []
  if (y.length < 5) return []
  const maxY = Math.max(...y)
  if (maxY <= 0) return []
  const intensityThreshold = maxY * (minRelIntensity / 100)
  const prominenceThreshold = maxY * 0.005

  for (let i = 2; i < y.length - 2; i++) {
    if (
      y[i] > intensityThreshold &&
      y[i] > y[i - 1] && y[i] > y[i - 2] &&
      y[i] > y[i + 1] && y[i] > y[i + 2]
    ) {
      const prom = computeProminence(y, i)
      if (prom < prominenceThreshold) continue

      // 拋物線細修：以 (i-1, i, i+1) 三點擬合二次曲線，求頂點
      const yL = y[i - 1], yM = y[i], yR = y[i + 1]
      const denom = yL - 2 * yM + yR
      let refinedX = x[i]
      let refinedY = yM
      if (denom !== 0 && Number.isFinite(denom)) {
        const offset = 0.5 * (yL - yR) / denom
        if (Math.abs(offset) <= 1) {
          const dx = x[i + 1] - x[i]
          refinedX = x[i] + offset * dx
          refinedY = yM - 0.25 * (yL - yR) * offset
        }
      }
      peaks.push({ x: refinedX, y: refinedY })
    }
  }
  return peaks.sort((a, b) => b.y - a.y)
}

function isDefaultSingleCardWide(index: number, total: number) {
  return total % 2 === 1 && index === total - 1
}

function isSingleCardWide(id: string, override: Record<string, boolean>) {
  return override[id] === true
}

function getSingleCardSpanClass(wide: boolean) {
  return wide ? 'md:col-span-2' : ''
}

type XrdProcessedTrace = XrdDesktopInputFile & {
  xProcessed: number[]
  yProcessed: number[]
  yStacked: number[]
  baseline: number
}

function XrdSingleChartCardBody({
  trace,
  index,
  total,
  wide,
  selected,
  sortingGhost = false,
  overlay = false,
  useOriginStyle,
  attributes,
  listeners,
  activatorRef,
  onSelect,
  onToggleWide,
  buildChartTraces,
  buildChartLayout,
}: {
  trace: XrdProcessedTrace
  index: number
  total: number
  wide: boolean
  selected: boolean
  sortingGhost?: boolean
  overlay?: boolean
  useOriginStyle: boolean
  attributes?: HTMLAttributes<HTMLButtonElement>
  listeners?: Record<string, unknown>
  activatorRef?: (node: HTMLButtonElement | null) => void
  onSelect?: () => void
  onToggleWide?: () => void
  buildChartTraces: (chartTraces: XrdProcessedTrace[], chartMode: 'single' | 'offset' | 'overlay') => Plotly.Data[]
  buildChartLayout: (chartTraces: XrdProcessedTrace[], chartMode: 'single' | 'offset' | 'overlay', height?: number) => Partial<Plotly.Layout>
}) {
  const cardHeight = wide ? 430 : 360

  return (
    <div
      onClick={onSelect}
      className={[
        'analysis-section-card p-4 transition-all duration-200 ease-out',
        'hover:border-[var(--accent-strong)]/35 hover:shadow-[0_18px_48px_rgba(15,23,42,0.28)]',
        useOriginStyle ? 'bg-white/95 border-slate-300' : '',
        selected ? 'ring-1 ring-[var(--accent-strong)]/45' : '',
        sortingGhost ? 'opacity-30' : '',
        overlay ? 'shadow-[0_34px_110px_rgba(15,23,42,0.48)] ring-1 ring-[var(--accent-strong)]/50' : '',
      ].filter(Boolean).join(' ')}
    >
      <ChartToolbar
        title={`單筆處理結果 - ${trace.name}`}
        actions={
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[var(--card-border)] bg-[var(--card-ghost)] px-2 py-1 text-[10px] font-semibold text-[var(--text-soft)]">
              #{index + 1}
            </span>
            {overlay ? (
              <span className="rounded-lg border border-[var(--accent-strong)]/35 bg-[var(--accent-strong)]/10 px-2 py-1 text-[10px] font-bold text-[var(--accent-strong)]">
                拖曳中
              </span>
            ) : (
              <>
                {onToggleWide && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleWide() }}
                    className={[
                      'flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors pressable',
                      wide
                        ? 'border-[var(--accent-strong)]/45 bg-[var(--accent-strong)]/10 text-[var(--accent-strong)] hover:bg-[var(--accent-strong)]/15'
                        : 'border-[var(--card-border)] bg-[var(--card-ghost)] text-[var(--text-soft)] hover:border-[var(--accent-strong)]/50 hover:text-[var(--text-main)]',
                    ].join(' ')}
                    title={wide ? '縮回半寬卡' : '拉寬為整列大卡'}
                    aria-label={wide ? '縮回半寬卡' : '拉寬為整列大卡'}
                  >
                    {wide ? '⤡ 縮回' : '⤢ 拉寬'}
                  </button>
                )}
                <button
                  ref={activatorRef}
                  type="button"
                  className="flex h-8 w-8 cursor-grab touch-none items-center justify-center rounded-lg border border-[var(--card-border)] bg-[var(--card-ghost)] text-sm font-bold text-[var(--text-soft)] transition-colors hover:border-[var(--accent-strong)]/50 hover:text-[var(--text-main)] active:cursor-grabbing pressable"
                  title="拖曳排序"
                  aria-label={`拖曳排序 ${trace.name}`}
                  {...attributes}
                  {...(listeners as any)}
                >
                  ↕
                </button>
              </>
            )}
          </div>
        }
      />

      <DeferredRender minHeight={cardHeight - 40}>
        <Plot
          data={buildChartTraces([trace], 'single')}
          layout={buildChartLayout([trace], 'single', cardHeight)}
          config={{
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['select2d', 'lasso2d'],
          }}
          className="w-full"
        />
      </DeferredRender>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--card-divider)] pt-3 text-[10px] text-[var(--text-soft)]">
        <span className="rounded-full bg-[var(--card-ghost)] px-2 py-0.5">基線 {trace.baseline.toFixed(2)}</span>
        <span className="rounded-full bg-[var(--card-ghost)] px-2 py-0.5">X Shift {(trace.xShift || 0).toFixed(3)}°</span>
        <span className="rounded-full bg-[var(--card-ghost)] px-2 py-0.5">{trace.xProcessed.length} 點</span>
      </div>
    </div>
  )
}

function SortableXrdSingleChartCard({
  trace,
  index,
  total,
  wide,
  selected,
  useOriginStyle,
  onSelect,
  onToggleWide,
  buildChartTraces,
  buildChartLayout,
}: {
  trace: XrdProcessedTrace
  index: number
  total: number
  wide: boolean
  selected: boolean
  useOriginStyle: boolean
  onSelect: () => void
  onToggleWide: () => void
  buildChartTraces: (chartTraces: XrdProcessedTrace[], chartMode: 'single' | 'offset' | 'overlay') => Plotly.Data[]
  buildChartLayout: (chartTraces: XrdProcessedTrace[], chartMode: 'single' | 'offset' | 'overlay', height?: number) => Partial<Plotly.Layout>
}) {
  const sortable = useSortable({
    id: trace.id,
    transition: {
      duration: 140,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
    animateLayoutChanges(args) {
      return defaultAnimateLayoutChanges(args)
    },
  })
  const spanClass = getSingleCardSpanClass(wide)

  return (
    <div
      ref={sortable.setNodeRef}
      className={[spanClass, 'will-change-transform'].filter(Boolean).join(' ')}
      style={{
        transform: sortable.transform
          ? `translate3d(${Math.round(sortable.transform.x)}px, ${Math.round(sortable.transform.y)}px, 0)`
          : undefined,
        transition: sortable.isDragging ? 'none' : sortable.transition,
      }}
    >
      <XrdSingleChartCardBody
        trace={trace}
        index={index}
        total={total}
        wide={wide}
        selected={selected}
        sortingGhost={sortable.isDragging}
        useOriginStyle={useOriginStyle}
        activatorRef={sortable.setActivatorNodeRef}
        attributes={sortable.attributes as HTMLAttributes<HTMLButtonElement>}
        listeners={sortable.listeners as Record<string, unknown>}
        onSelect={onSelect}
        onToggleWide={onToggleWide}
        buildChartTraces={buildChartTraces}
        buildChartLayout={buildChartLayout}
      />
    </div>
  )
}

// 漸進式引導：Section 內的「進階折疊」子區塊（預設折疊）
function Advanced({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-ghost)]/60">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)] font-mono"
      >
        <span>{open ? '▼' : '▶'} {title}</span>
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  )
}

// 計算工具：小結果顯示格
function ResultCell({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={['rounded-lg border px-3 py-2',
      accent ? 'border-[var(--accent-strong)]/45 bg-[var(--accent-strong)]/10' : 'border-[var(--card-border)] bg-[var(--card-ghost)]',
    ].join(' ')}>
      <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</p>
      <p className={['mt-0.5 font-mono text-sm font-bold',
        accent ? 'text-[var(--accent-strong)]' : 'text-[var(--text-main)]',
      ].join(' ')}>{value}</p>
    </div>
  )
}

function CalcEmptyHint() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)]/50 px-3 py-3 text-center text-[11px] text-[var(--text-soft)]">
      請先選擇資料源與峰位（或匯入一份檔案）
    </div>
  )
}

function CalcQuickPreset({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <div className="flex items-end">
      <button type="button" onClick={onClick}
        className="rounded-full border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-1.5 text-[10px] font-semibold text-[var(--text-soft)] transition-colors hover:border-[var(--accent-strong)]/50 hover:text-[var(--text-main)] pressable">
        {label}
      </button>
    </div>
  )
}

// 計算工具：通用卡片殼（source picker + import + peak picker + Plotly + 結果 + 匯出按鈕列）
function CalcCardShell({
  title,
  mod,
  setMod,
  processedTraces,
  resolveSource,
  detectedPeaks,
  handleImport,
  paramsRow,
  overlayShapes,
  resultBlock,
  exportButtons,
}: {
  title: string
  mod: { enabled: boolean; imported: { id: string; name: string; x: number[]; y: number[]; color: string } | null; selectedSourceId: string; selectedPeakX: number | null }
  setMod: (updater: any) => void
  processedTraces: XrdProcessedTrace[]
  resolveSource: (mod: any) => { x: number[]; y: number[]; name: string; color: string } | null
  detectedPeaks: { x: number; y: number }[]
  handleImport: (files: File[]) => void
  paramsRow: React.ReactNode
  overlayShapes: any[]
  resultBlock: React.ReactNode
  exportButtons: React.ReactNode
}) {
  const src = resolveSource(mod)
  const sourceOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = []
    if (mod.imported) opts.push({ value: 'imported', label: `📥 ${mod.imported.name}` })
    processedTraces.forEach(t => opts.push({ value: t.id, label: t.name }))
    return opts
  }, [mod.imported, processedTraces])

  return (
    <div className="analysis-section-card p-4">
      <ChartToolbar title={title} actions={null} />

      {/* Source / Import / Peak picker */}
      <div className="mb-3 space-y-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <CustomSelect
            label="資料來源"
            value={mod.selectedSourceId}
            onChange={v => setMod((p: any) => ({ ...p, selectedSourceId: v, selectedPeakX: null }))}
            options={sourceOptions.length > 0 ? sourceOptions : [{ value: '', label: '尚無可選資料源' }]}
          />
          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">匯入光譜（單檔，僅本卡片用）</span>
            <label className="flex h-[34px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--card-border)] bg-[var(--input-bg)] px-2 text-[11px] font-semibold text-[var(--text-soft)] transition-colors hover:border-[var(--accent-strong)]/50 hover:text-[var(--text-main)] pressable">
              <span>📂 選擇 .txt / .xy / .csv</span>
              <input type="file" accept=".txt,.xy,.csv" className="hidden" onChange={e => {
                const files = e.target.files ? Array.from(e.target.files) : []
                if (files.length > 0) handleImport(files)
                e.currentTarget.value = ''
              }} />
            </label>
          </div>
          <CustomSelect
            label={`選擇峰位（自動偵測 ${detectedPeaks.length} 個）`}
            value={mod.selectedPeakX != null ? String(mod.selectedPeakX) : ''}
            onChange={v => setMod((p: any) => ({ ...p, selectedPeakX: v ? parseFloat(v) : null }))}
            options={detectedPeaks.length > 0
              ? detectedPeaks.map(p => ({ value: String(p.x), label: `${p.x.toFixed(3)}°  (I=${p.y.toFixed(2)})` }))
              : [{ value: '', label: src ? '沒有偵測到峰，請降低強度門檻或換資料源' : '請先選資料源' }]
            }
            disabled={detectedPeaks.length === 0}
          />
        </div>
        {paramsRow}
      </div>

      {/* Plotly */}
      <DeferredRender minHeight={360}>
        <Plot
          data={src ? [{
            x: src.x, y: src.y, type: 'scatter', mode: 'lines',
            name: src.name, line: { color: src.color, width: 1.6 },
          },
          ...(mod.selectedPeakX != null ? [{
            x: [mod.selectedPeakX], y: [(() => {
              const idx = src.x.findIndex(xv => Math.abs(xv - mod.selectedPeakX!) === Math.min(...src.x.map(xv => Math.abs(xv - mod.selectedPeakX!))))
              return idx >= 0 ? src.y[idx] : 0
            })()],
            type: 'scatter', mode: 'markers', name: '選定峰',
            marker: { size: 12, color: '#f59e0b', symbol: 'star', line: { color: '#0f172a', width: 1 } },
          }] : []),
          ] as any : []}
          layout={{
            xaxis: { title: { text: '2θ (degree)' }, color: '#cbd5e1', showgrid: true, gridcolor: 'rgba(148,163,184,0.12)', zeroline: false },
            yaxis: { title: { text: '強度 (a.u.)' }, color: '#cbd5e1', showgrid: true, gridcolor: 'rgba(148,163,184,0.12)', zeroline: false },
            shapes: overlayShapes,
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(15,23,42,0.55)',
            font: { color: '#cbd5e1' },
            margin: { l: 60, r: 24, t: 24, b: 52 },
            showlegend: false,
            height: 360,
            autosize: true,
            hovermode: 'x unified',
          } as any}
          config={{ responsive: true, displaylogo: false, modeBarButtonsToRemove: ['select2d', 'lasso2d'] }}
          className="w-full"
        />
      </DeferredRender>

      {/* 計算結果 */}
      <div className="mt-3">{resultBlock}</div>

      {/* 匯出按鈕列（左下對齊既有規範） */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--card-divider)] pt-3">
        <div className="flex flex-wrap gap-2">{exportButtons}</div>
        <p className="text-[10px] text-[var(--text-soft)] italic">* 結果為當前選峰計算值，匯出為單列 CSV / TXT</p>
      </div>
    </div>
  )
}

// ── small UI pieces (100% 同步自 XPS) ───────────────────────────────────────────

function Section(props: Parameters<typeof GuidedSidebarSection>[0]) {
  return (
    <div className="px-4">
      <GuidedSidebarSection {...props} />
    </div>
  )
}

function NumInput({ label, value, onChange, min, max, step = 1, disabled = false }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none disabled:opacity-40"
      />
    </label>
  )
}

function TextInput({ label, value, onChange, placeholder, disabled = false, title, onBlur, onKeyDown }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; title?: string
  onBlur?: () => void; onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="block" title={title}>
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <input type="text" value={value} placeholder={placeholder} disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] placeholder:text-[var(--text-soft)] focus:outline-none disabled:opacity-40"
      />
    </label>
  )
}

function CustomSelect({ label, value, onChange, options, disabled = false }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current && !triggerRef.current.contains(target) &&
          panelRef.current && !panelRef.current.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = () => {
    if (disabled) return
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const panelH = Math.min(options.length * 36 + 8, 200)
      if (spaceBelow < panelH && rect.top > panelH) {
        setPanelStyle({ position: 'fixed', bottom: window.innerHeight - rect.top + 4, left: rect.left, width: rect.width, zIndex: 9999 })
      } else {
        setPanelStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999 })
      }
    }
    setOpen(o => !o)
  }

  const selectedLabel = options.find(o => o.value === value)?.label ?? value
  const panel = open && !disabled ? (
    <div
      ref={panelRef}
      style={panelStyle}
      className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-1 [box-shadow:var(--card-shadow)]"
    >
      <div className="max-h-48 overflow-y-auto">
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            onClick={() => { onChange(o.value); setOpen(false) }}
            className={[
              'flex w-full items-center rounded-lg px-3 py-1.5 text-xs transition-all duration-100',
              o.value === value
                ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)] ring-1 ring-inset ring-[var(--accent-strong)]/40'
                : 'text-[var(--text-main)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] hover:ring-1 hover:ring-inset hover:ring-[var(--accent-strong)]/40',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div className="relative block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        className="flex w-full items-center justify-between rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] transition-colors hover:border-[var(--accent-strong)]/60 focus:outline-none disabled:opacity-40"
      >
        <span>{selectedLabel}</span>
        <span className={`ml-2 text-[8px] text-[var(--text-soft)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </div>
  )
}

function CheckRow({ label, checked, onChange, color }: { label: string; checked: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-main)] transition-colors hover:text-white">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-[var(--accent-strong)] rounded" />
      {color && <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/10" style={{ backgroundColor: color }} />}
      <span className="truncate">{label}</span>
    </label>
  )
}

function TogglePill({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={[
        'flex w-full items-center justify-between gap-3 rounded-[14px] px-4 py-2.5 text-sm font-medium transition-all duration-150',
        checked
          ? [
              'bg-[color:color-mix(in_srgb,var(--accent-secondary)_18%,transparent)]',
              'text-[var(--accent-secondary)]',
              '[box-shadow:inset_0_0_0_1.5px_color-mix(in_srgb,var(--accent-secondary)_55%,transparent),0_2px_12px_-2px_color-mix(in_srgb,var(--accent-secondary)_30%,transparent)]',
            ].join(' ')
          : [
              'bg-[color:color-mix(in_srgb,var(--card-bg)_70%,transparent)]',
              'text-[var(--text-soft)]',
              '[box-shadow:inset_0_0_0_1px_var(--card-border)]',
              'hover:text-[var(--text-main)] hover:[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--accent-secondary)_40%,var(--card-border))]',
            ].join(' '),
      ].join(' ')}
    >
      <span>{label}</span>
      <span
        className={[
          'h-3.5 w-3.5 shrink-0 rounded-full transition-all duration-150',
          checked
            ? 'bg-[var(--accent-secondary)] [box-shadow:0_0_8px_color-mix(in_srgb,var(--accent-secondary)_75%,transparent)]'
            : 'border border-[var(--card-border)]',
        ].join(' ')}
      />
    </button>
  )
}

export default function XRD({
  onModuleSelect,
  currentWorkspace,
  onSelectWorkspace,
}: {
  onModuleSelect?: (module: AnalysisModuleId) => void
  onOpenPlotPopup?: (popup: any) => void
  currentWorkspace?: string
  onSelectWorkspace?: (id: string) => void
}) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('nigiro-xrd-sidebar-width'))
    if (Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH) {
      return saved
    }
    return SIDEBAR_DEFAULT_WIDTH
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem('nigiro-xrd-sidebar-collapsed') === 'true')
  const [sidebarResizing, setSidebarResizing] = useState(false)

  // 原始數據
  const [rawFiles, setRawFiles] = useState<XrdDesktopInputFile[]>([])

  // 強度強度轉換模式
  const [transformMode, setTransformMode] = useState<'log10' | 'ln' | 'sqrt' | 'none'>('none')

  // 疊圖與查看模式
  const [viewMode, setViewMode] = useState<'single' | 'offset' | 'overlay'>('offset')
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null)
  const [singleCardOrder, setSingleCardOrder] = useState<string[]>([])
  const [singleCardWideOverride, setSingleCardWideOverride] = useState<Record<string, boolean>>({})
  const [activeSingleCardId, setActiveSingleCardId] = useState<string | null>(null)
  const [dragStartSingleCardOrder, setDragStartSingleCardOrder] = useState<string[] | null>(null)
  const singleCardSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 1 } }))

  // 參考峰設定
  const [enabledRefCompounds, setEnabledRefCompounds] = useState<Record<string, boolean>>({
    'β-Ga2O3': false,
    'Si': false,
    'NiO': false,
  })
  // 細緻晶面 (hkl) 單獨勾選狀態
  const [enabledRefPeaks, setEnabledRefPeaks] = useState<Record<string, boolean>>({})
  // 參考峰 Modal 內目前選中的左側化合物大類
  const [activeCompName, setActiveCompName] = useState<string>('β-Ga2O3')
  const [showReferenceMarkers, setShowReferenceMarkers] = useState<boolean>(true)

  // 峰位偏移比對設定
  const [peakIntensityThreshold, setPeakIntensityThreshold] = useState<number>(10)
  const [peakOffsetTolerance, setPeakOffsetTolerance] = useState<number>(0.3)

  // 角度顯示範圍過濾與裁剪限制 (對齊桌面版)
  const [xMin, setXMin] = useState<number>(15)
  const [xMax, setXMax] = useState<number>(80)

  // 強度歸一化開關：預設關閉，避免只取 log 時改變峰值強度比例。
  const [normalizeCurves, setNormalizeCurves] = useState<boolean>(false)

  // 圖表風格切換：false = 深色模式（預設），true = Origin Pro 白底科研風格
  const [useOriginStyle, setUseOriginStyle] = useState<boolean>(false)

  // （舊版 showExportPreview 已移除，改用統一 exportPreview state）

  // 參考峰選擇彈窗開關
  const [showRefMarkersModal, setShowRefMarkersModal] = useState<boolean>(false)

  // ── 漸進式引導：受控的 Section 開合狀態（只控 Step 1, 5；其餘 Section 各自管理） ──
  const [sectionOpen, setSectionOpen] = useState<Record<number, boolean>>({ 1: true, 5: false })
  const setStepOpen = (step: number, next: boolean) => setSectionOpen(prev => ({ ...prev, [step]: next }))
  const hasTriggeredFirstUploadRef = useRef<boolean>(false)
  useEffect(() => {
    if (hasTriggeredFirstUploadRef.current) return
    if (rawFiles.length > 0) {
      hasTriggeredFirstUploadRef.current = true
      setSectionOpen(prev => ({ ...prev, 1: false, 5: true }))
    }
  }, [rawFiles.length])

  // ── 圖表美化與匯出（美化預覽圖卡） ─────────────────────────────
  const [beautifyEnabled, setBeautifyEnabled] = useState<boolean>(false)
  const [beautify, setBeautify] = useState({
    showXTickLabels: true,
    showYTickLabels: true,
    xNTicks: 8,
    yNTicks: 6,
    xAxisTitle: '2θ (degree)',
    yAxisTitle: '強度 (a.u.)',
    showLegend: true,
    legendPos: 'top-right' as 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'hidden',
    axisFontSize: 12,
    titleFontSize: 13,
    legendFontSize: 11,
    lineWidthScale: 1.0,
    background: 'white' as 'white' | 'transparent' | 'dark',
    showXGrid: false,
    showYGrid: false,
    pngWidth: 1600,
    pngHeight: 900,
    pngScale: 2,
  })
  const beautifyGraphDivRef = useRef<HTMLElement | null>(null)
  const mainGraphDivRef = useRef<HTMLElement | null>(null)

  // 參考峰 (hkl) 標籤字體大小（沿用至主圖、美化卡與 Origin Pro 風格匯出）
  const [refMarkerLabelSize, setRefMarkerLabelSize] = useState<number>(11)

  // Beautify 卡資料源：'auto' = 跟隨主圖；或某個 rawFile.id 表示「單筆指定」
  const [beautifySourceMode, setBeautifySourceMode] = useState<string>('auto')

  // 統一匯出預覽 state（PNG 或 文字）
  type ExportPreviewState = null
    | { kind: 'png'; dataUrl: string; filename: string; width: number; height: number }
    | { kind: 'text'; content: string; filename: string; ext: 'csv' | 'txt' }
  const [exportPreview, setExportPreview] = useState<ExportPreviewState>(null)

  // ── 計算工具：3 個獨立模組（FWHM / Scherrer D / d-spacing） ──
  type CalcTrace = { id: string; name: string; x: number[]; y: number[]; color: string }
  type CalcModule = {
    enabled: boolean
    imported: CalcTrace | null
    selectedSourceId: string  // 'imported' 或 rawFiles[].id
    selectedPeakX: number | null
  }
  const [calcFwhm, setCalcFwhm] = useState<CalcModule>({
    enabled: false, imported: null, selectedSourceId: '', selectedPeakX: null,
  })
  const [calcScherrer, setCalcScherrer] = useState<CalcModule & { K: number; lambda: number; fwhmOverride: string }>({
    enabled: false, imported: null, selectedSourceId: '', selectedPeakX: null,
    K: 0.9, lambda: 1.5406, fwhmOverride: '',
  })
  const [calcDspacing, setCalcDspacing] = useState<CalcModule & { lambda: number }>({
    enabled: false, imported: null, selectedSourceId: '', selectedPeakX: null,
    lambda: 1.5406,
  })

  // 參考峰選擇彈窗拖曳與折疊折疊狀態
  const [refMarkersModalPos, setRefMarkersModalPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isRefMarkersMinimized, setIsRefMarkersMinimized] = useState<boolean>(false)

  // 新增：參考峰選擇彈窗的自訂尺寸與最小化膠囊拖曳位置
  const [refMarkersModalSize, setRefMarkersModalSize] = useState<{ width: number; height: number }>({ width: 896, height: 620 })
  const [minimizedCapsulePos, setMinimizedCapsulePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isAppliedSuccess, setIsAppliedSuccess] = useState<boolean>(false)

  // 參考峰選擇彈窗 Header 按下滑鼠拖曳處理
  const handleRefMarkersHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // 若點擊的是按鈕或控制件則不觸發拖曳
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return

    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startPos = { ...refMarkersModalPos }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      setRefMarkersModalPos({
        x: startPos.x + dx,
        y: startPos.y + dy,
      })
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  // 新增：參考峰選擇彈窗右下角拖曳縮放處理
  const handleRefMarkersResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const startWidth = refMarkersModalSize.width
    const startHeight = refMarkersModalSize.height
    const startX = e.clientX
    const startY = e.clientY

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      setRefMarkersModalSize({
        width: Math.max(680, startWidth + dx), // 最小寬度限制為 680px
        height: Math.max(480, startHeight + dy), // 最小高度限制為 480px
      })
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  // 新增：最小化懸浮小膠囊按下滑鼠拖曳處理
  const handleMinimizedCapsuleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return

    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startPos = { ...minimizedCapsulePos }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      setMinimizedCapsulePos({
        x: startPos.x + dx,
        y: startPos.y + dy,
      })
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }



  useEffect(() => {
    localStorage.setItem('nigiro-xrd-sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    localStorage.setItem('nigiro-xrd-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    const ids = rawFiles.map(file => file.id)
    setSingleCardOrder(prev => {
      const kept = prev.filter(id => ids.includes(id))
      const missing = ids.filter(id => !kept.includes(id))
      const next = [...kept, ...missing]
      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) return prev
      return next
    })
    setSingleCardWideOverride(prev => {
      const next: Record<string, boolean> = {}
      // 保留已存在卡片的既有狀態（不會因為新增/刪除其它卡片而改變）
      for (const id of ids) {
        if (Object.prototype.hasOwnProperty.call(prev, id)) {
          next[id] = prev[id]
        }
      }
      // 新加入的卡片：按上傳當下的位置決定預設值（奇數最後一張預設為 wide）
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        if (!Object.prototype.hasOwnProperty.call(next, id)) {
          next[id] = isDefaultSingleCardWide(i, ids.length)
        }
      }
      // 判斷是否真的有變動
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      if (prevKeys.length === nextKeys.length) {
        let same = true
        for (const id of nextKeys) {
          if (!Object.prototype.hasOwnProperty.call(prev, id) || prev[id] !== next[id]) {
            same = false
            break
          }
        }
        if (same) return prev
      }
      return next
    })
  }, [rawFiles])

  // 拖曳改變側邊欄寬度
  useEffect(() => {
    if (!sidebarResizing) return

    const handleMove = (event: MouseEvent) => {
      const nextWidth = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, event.clientX),
      )
      setSidebarWidth(nextWidth)
      if (sidebarCollapsed) setSidebarCollapsed(false)
    }

    const handleUp = () => {
      setSidebarResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [sidebarCollapsed, sidebarResizing])

  // 強健的 XRD 文字檔解析器
  const handleFilesUpload = useCallback((files: File[]) => {
    const currentCount = rawFiles.length
    const newFilesPromises = files.map((file, idx) => {
      return new Promise<XrdDesktopInputFile>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = e => {
          const content = e.target?.result as string
          const lines = content.split('\n')
          const x: number[] = []
          const y: number[] = []

          for (let line of lines) {
            line = line.trim()
            if (!line || line.startsWith('#') || line.startsWith('*')) continue
            const parts = line.split(/[\s,;\t]+/)
            if (parts.length >= 2) {
              const xVal = parseFloat(parts[0])
              const yVal = parseFloat(parts[1])
              if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
                x.push(xVal)
                y.push(yVal)
              }
            }
          }

          if (x.length === 0) {
            reject(new Error(`${file.name} 中沒有找到有效數據點`))
            return
          }

          const fileId = Math.random().toString(36).substr(2, 9)
          const colorIdx = (currentCount + idx) % ORIGIN_PRO_COLORS.length
          const color = ORIGIN_PRO_COLORS[colorIdx] ?? '#38bdf8'

          resolve({
            id: fileId,
            name: file.name,
            x,
            y,
            label: file.name,
            shortLabel: file.name.substring(0, 8),
            color,
            offset: 0,
            linewidth: 2,
            labelX: x[Math.floor(x.length / 2)] || 0,
            labelYAdd: 0,
            xShift: 0,
          })
        }
        reader.onerror = () => reject(new Error('檔案讀取失敗'))
        reader.readAsText(file)
      })
    })

    Promise.all(newFilesPromises)
      .then(parsed => {
        setRawFiles(prev => {
          let updated = [...prev, ...parsed]

          // 如果有多個檔案，預設切換至 Offset 模式（實際 offset 由 useEffect 在
          // processedTraces 算好後依當前 transformMode / normalizeCurves 真實尺度分配）
          if (updated.length > 1) {
            setViewMode('offset')
          }

          if (!selectedDatasetId && updated.length > 0) {
            setSelectedDatasetId(updated[0].id)
          }
          return updated
        })
      })
      .catch(err => {
        alert(err.message)
      })
  }, [selectedDatasetId, rawFiles.length, normalizeCurves])

  // ── Sample baskets ──────────────────────────────────────────────────────
  const [basketsPanelOpen, setBasketsPanelOpen] = useState(true)
  const [basketItems, setBasketItems] = useState<BasketFileItem[]>([])
  const [baskets, setBaskets] = useState<SampleBasket[]>([])

  const handleApplyBasket = useCallback(async (_basket: SampleBasket, basketFiles: File[]) => {
    if (basketFiles.length === 0) return
    setBasketsPanelOpen(false)
    handleFilesUpload(basketFiles)
  }, [handleFilesUpload])

  // 1. 本地數據前處理管線 (Pipeline)
  const processedTraces = useMemo(() => {
    return rawFiles.map(file => {
      // 1. 根據 xMin 與 xMax 以及 xShift 限制與過濾 X/Y 數據點 (對齊桌面版)
      const rawPoints: { xVal: number; yVal: number }[] = []
      file.x.forEach((xVal, idx) => {
        const xShifted = xVal + (file.xShift || 0)
        // 限制在過濾角度區間內
        if (xShifted >= xMin && xShifted <= xMax) {
          rawPoints.push({ xVal: xShifted, yVal: file.y[idx] ?? 0 })
        }
      })

      // 如果過濾後沒有點，回傳空區間
      if (rawPoints.length === 0) {
        return {
          ...file,
          xProcessed: [],
          yProcessed: [],
          yStacked: [],
          baseline: 0,
        }
      }

      const xProcessed = rawPoints.map(p => p.xVal)
      const ySel = rawPoints.map(p => p.yVal)

      // 2. 基線扣除：計算強度之 1st percentile 得到背景
      const sortedY = [...ySel].sort((a, b) => a - b)
      const pct1Index = Math.floor((sortedY.length - 1) * 0.01)
      const baseline = sortedY[pct1Index] || 0

      let yProcessed = ySel.map(yVal => {
        // y_corr = y - baseline + 1.0
        let yCorr = yVal - baseline + 1.0
        if (yCorr <= 0) yCorr = 1.0 // 壓成 1 防止 log 出錯

        if (transformMode === 'log10') {
          return Math.log10(yCorr)
        } else if (transformMode === 'ln') {
          return Math.log(yCorr)
        } else if (transformMode === 'sqrt') {
          return Math.sqrt(yCorr)
        }
        return yCorr
      })

      // 3. 強度歸一化（嚴格 0~1 Min-Max，最大值保證為 1）
      // 註：XRD 銳峰本身就是訊號，不能用 99.7% 百分位裁掉，否則峰值會被歸一化成 >1
      if (normalizeCurves && yProcessed.length > 0) {
        const finiteVals = yProcessed.filter(v => Number.isFinite(v))
        if (finiteVals.length > 0) {
          const lo = Math.min(...finiteVals)
          const hi = Math.max(...finiteVals)
          const denom = hi > lo ? hi - lo : 1.0
          yProcessed = yProcessed.map(v => (v - lo) / denom)
        }
      }

      // 4. Y 軸疊加偏移 (yStacked)
      const yStacked = yProcessed.map(yVal => yVal + (file.offset || 0))

      return {
        ...file,
        xProcessed,
        yProcessed,
        yStacked,
        baseline,
      }
    })
  }, [rawFiles, transformMode, xMin, xMax, normalizeCurves])

  // 當前選中的 active trace
  const activeTrace = useMemo(() => {
    return processedTraces.find(t => t.id === selectedDatasetId) || processedTraces[0] || null
  }, [processedTraces, selectedDatasetId])

  // 2. 峰位偏移自動偵測與比對報告（Tier 1 升級版：全域 1:1 最佳配對）
  //    - 由 findLocalPeaks 取得已 prominence 篩選 + 拋物線細修的偵測峰
  //    - 列出所有「容忍度內」(observed, ref) 候選對，依 |Δ| 升序貪心配對且互斥
  //      → 同一個 ref 不會被多個 observed 重複指到，反之亦然
  const peakOffsetReport = useMemo(() => {
    const reports: Record<string, {
      observedPeak2Theta: number
      observedIntensity: number
      refPeak2Theta: number
      hkl: string
      delta: number
      phase: string
    }[]> = {}

    processedTraces.forEach(trace => {
      const peaks = findLocalPeaks(trace.xProcessed, trace.yProcessed, peakIntensityThreshold)

      // 收集所有「已啟用」的標準峰
      const refList: { compName: string; ref: { hkl: string; twoTheta: number; intensity: number; tolerance: number } }[] = []
      Object.keys(enabledRefCompounds).forEach(compName => {
        if (!enabledRefCompounds[compName]) return
        const refPeaks = REFERENCE_DB[compName] || []
        refPeaks.forEach(ref => {
          const peakKey = `${compName}_${ref.hkl}`
          const isPeakEnabled = enabledRefPeaks[peakKey] ?? true
          if (!isPeakEnabled) return
          refList.push({ compName, ref })
        })
      })

      // 候選對集合：filter 容忍度內 → 按 |Δ| 升序 → 1:1 貪心配對
      type Pair = { peakIdx: number; refIdx: number; delta: number; absDelta: number }
      const pairs: Pair[] = []
      peaks.forEach((peak, pi) => {
        refList.forEach((r, ri) => {
          const delta = peak.x - r.ref.twoTheta
          const absDelta = Math.abs(delta)
          if (absDelta < peakOffsetTolerance) {
            pairs.push({ peakIdx: pi, refIdx: ri, delta, absDelta })
          }
        })
      })
      pairs.sort((a, b) => a.absDelta - b.absDelta)

      const usedPeaks = new Set<number>()
      const usedRefs = new Set<number>()
      const traceReport: typeof reports[string] = []
      for (const p of pairs) {
        if (usedPeaks.has(p.peakIdx) || usedRefs.has(p.refIdx)) continue
        const peak = peaks[p.peakIdx]
        const { compName, ref } = refList[p.refIdx]
        traceReport.push({
          observedPeak2Theta: peak.x,
          observedIntensity: peak.y,
          refPeak2Theta: ref.twoTheta,
          hkl: ref.hkl,
          delta: p.delta,
          phase: compName,
        })
        usedPeaks.add(p.peakIdx)
        usedRefs.add(p.refIdx)
      }

      reports[trace.id] = traceReport.sort((a, b) => a.observedPeak2Theta - b.observedPeak2Theta)
    })

    return reports
  }, [processedTraces, enabledRefCompounds, enabledRefPeaks, peakIntensityThreshold, peakOffsetTolerance])

  // Offset 模式：當檔案集合或實際 yProcessed 尺度（transformMode / normalizeCurves）改變時，
  // 用 processedTraces 的真實峰值自動分配偏移量。手動編輯單檔 offset 不會被覆蓋（因為 key 不變）。
  const lastAutoStackKeyRef = useRef<string>('')
  useEffect(() => {
    if (viewMode !== 'offset') return
    if (processedTraces.length < 2) return

    const key = [
      processedTraces.map(t => t.id).join('|'),
      transformMode,
      normalizeCurves ? '1' : '0',
    ].join('::')
    if (key === lastAutoStackKeyRef.current) return
    lastAutoStackKeyRef.current = key

    const maxVals = processedTraces.map(t =>
      t.yProcessed.length > 0 ? Math.max(...t.yProcessed) : 0,
    )
    const avgMax = maxVals.reduce((sum, v) => sum + v, 0) / maxVals.length
    let stackGapFactor = 0.45
    if (processedTraces.length <= 2) stackGapFactor = 0.85
    else if (processedTraces.length === 3) stackGapFactor = 0.70
    else if (processedTraces.length === 4) stackGapFactor = 0.58
    const stackGap = normalizeCurves ? stackGapFactor : (avgMax * stackGapFactor || 1.0)

    setRawFiles(prev =>
      prev.map((file, idx) => ({
        ...file,
        offset: (prev.length - 1 - idx) * stackGap,
      })),
    )
  }, [processedTraces, viewMode, transformMode, normalizeCurves])

  // 3. 一鍵均勻分配 Y 軸偏移量
  const handleAutoStackOffsets = () => {
    if (processedTraces.length === 0) return

    // 計算處理後最大強度的平均，作為偏移的推薦間隔
    const maxVals = processedTraces.map(t => Math.max(...t.yProcessed))
    const avgMax = maxVals.reduce((sum, v) => sum + v, 0) / maxVals.length
    // 根據檔案數自適應優化疊加間距 (2檔 0.85, 3檔 0.70, 4檔 0.58, 5檔以上 0.45 緊湊)
    let stackGapFactor = 0.45
    if (processedTraces.length <= 2) {
      stackGapFactor = 0.85
    } else if (processedTraces.length === 3) {
      stackGapFactor = 0.70
    } else if (processedTraces.length === 4) {
      stackGapFactor = 0.58
    }
    const stackGap = normalizeCurves ? stackGapFactor : (avgMax * stackGapFactor || 1.0)

    setRawFiles(prev =>
      prev.map((file, idx) => ({
        ...file,
        offset: (prev.length - 1 - idx) * stackGap,
      }))
    )
  }

  const buildChartTraces = useCallback((chartTraces: typeof processedTraces, chartMode: 'single' | 'offset' | 'overlay') => {
    const traces: Plotly.Data[] = []

    chartTraces.forEach(trace => {
      traces.push({
        x: trace.xProcessed,
        y: chartMode === 'offset' ? trace.yStacked : trace.yProcessed,
        type: 'scatter',
        mode: 'lines',
        name: trace.name,
        line: {
          color: trace.color,
          width: trace.linewidth,
        },
      })
    })

    // 2. 繪製固定參考峰垂直虛線 (垂直高度按相位分組，legend group 控制)
    if (showReferenceMarkers && chartTraces.length > 0) {
      // 取得全圖強度範圍，供高度自適應使用
      const allYVals = chartTraces.flatMap(t => chartMode === 'offset' ? t.yStacked : t.yProcessed)

      const figYMin = allYVals.length > 0 ? Math.min(...allYVals) : 0
      const figYMax = allYVals.length > 0 ? Math.max(...allYVals) : 1
      const ySpan = figYMax - figYMin || 1

      // 完美移植桌面版 get_reference_marker_y 防重疊防壓峰定位演算法
      const getReferenceMarkerY = (twoTheta: number, textYFrac: number = 0.80) => {
        const targetY = figYMin + ySpan * textYFrac
        const localValues: number[] = []

        chartTraces.forEach(trace => {
          const yData = chartMode === 'offset' ? trace.yStacked : trace.yProcessed
          trace.xProcessed.forEach((xVal, xIdx) => {
            // 偵測該參考峰角度周圍 0.25 度內的所有光譜最高點
            if (Math.abs(xVal - twoTheta) <= 0.25) {
              const yVal = yData[xIdx]
              if (yVal !== undefined && Number.isFinite(yVal)) {
                localValues.push(yVal)
              }
            }
          })
        })

        if (localValues.length === 0) {
          return Math.min(figYMax - 0.05 * ySpan, targetY)
        }

        const maxLocalY = Math.max(...localValues)
        // 在強繞射峰上方保留一定的美學高度間距
        const dataY = maxLocalY + 0.08 * ySpan
        return Math.min(figYMax - 0.02 * ySpan, Math.max(targetY, dataY))
      }

      Object.keys(enabledRefCompounds).forEach(compName => {
        if (enabledRefCompounds[compName]) {
          const peaks = REFERENCE_DB[compName] || []
          const phaseColor = PHASE_COLORS[compName] || '#ef4444'

          peaks.forEach((peak, peakIdx) => {
            // 參考峰主要在 xMin 到 xMax 角度限制內才繪製 (對齊桌面版)
            if (peak.twoTheta < xMin || peak.twoTheta > xMax) return

            // 晶面單獨勾選過濾
            const peakKey = `${compName}_${peak.hkl}`
            const isPeakEnabled = enabledRefPeaks[peakKey] ?? true
            if (!isPeakEnabled) return

            const textYFrac = peak.hkl === '400' ? 0.85 : 0.78
            const labelY = getReferenceMarkerY(peak.twoTheta, textYFrac)
            // 線段頂端停留在文字下方，確保虛線不穿透標籤
            const lineTop = labelY - 0.025 * ySpan

            traces.push({
              x: [peak.twoTheta, peak.twoTheta],
              y: [figYMin, lineTop],
              type: 'scatter',
              mode: 'lines+text',
              text: ['', `(${peak.hkl})`],
              textposition: 'top center',
              textfont: {
                color: phaseColor,
                size: refMarkerLabelSize,
                family: 'Times New Roman, serif',
              },
              line: {
                color: phaseColor,
                dash: 'dot',
                width: 1.2,
              },
              legendgroup: compName,
              showlegend: peakIdx === 0, // 圖例僅顯示該相位的首個 trace (對齊桌面版圖例)
              name: compName,
              hoverinfo: 'none',
            } as any)
          })
        }
      })
    }

    return traces
  }, [showReferenceMarkers, enabledRefCompounds, enabledRefPeaks, xMin, xMax, refMarkerLabelSize])

  const buildChartLayout = useCallback((chartTraces: typeof processedTraces, chartMode: 'single' | 'offset' | 'overlay', height = 480) => {
    let yTitle = '強度（a.u.）'
    if (transformMode === 'log10') yTitle = '強度對數 Log10（a.u.）'
    else if (transformMode === 'ln') yTitle = '強度對數 Ln（a.u.）'
    else if (transformMode === 'sqrt') yTitle = '強度開根號 Sqrt（a.u.）'
    if (normalizeCurves) yTitle = `${yTitle} / 歸一化 0-1`

    // 取得 Y 軸全圖顯示範圍並預留 15% 頂部空間給標籤 (對齊桌面版)
    const allYVals = chartTraces.flatMap(t => chartMode === 'offset' ? t.yStacked : t.yProcessed)
    let yRange: any = undefined
    if (allYVals.length > 0) {
      const yMinVal = Math.min(...allYVals)
      const yMaxVal = Math.max(...allYVals)
      const ySpanVal = yMaxVal - yMinVal || 1
      yRange = [yMinVal - 0.02 * ySpanVal, yMaxVal + 0.15 * ySpanVal]
    }

    if (useOriginStyle) {
      // ── Origin Pro 白底科研風格 ──
      return {
        xaxis: {
          title: { text: '2θ (degree)', font: { size: 12, family: 'Times New Roman, serif', color: '#111111' } },
          showgrid: false,
          zeroline: false,
          color: '#111111',
          linecolor: '#111111',
          linewidth: 1.5,
          ticks: 'outside' as const,
          tickcolor: '#111111',
          showline: true,
          range: [xMin, xMax],
          tickfont: { color: '#111111', family: 'Times New Roman, serif', size: 11 },
          mirror: true,
        },
        yaxis: {
          title: { text: yTitle, font: { size: 12, family: 'Times New Roman, serif', color: '#111111' } },
          showgrid: false,
          zeroline: false,
          color: '#111111',
          linecolor: '#111111',
          linewidth: 1.5,
          ticks: 'outside' as const,
          tickcolor: '#111111',
          showline: true,
          range: yRange,
          tickfont: { color: '#111111', family: 'Times New Roman, serif', size: 11 },
          mirror: true,
        },
        legend: {
          x: 0.98, xanchor: 'right', y: 0.98, yanchor: 'top',
          bgcolor: 'rgba(255,255,255,0.9)', bordercolor: '#aaaaaa', borderwidth: 1,
          font: { color: '#111111', family: 'Times New Roman, serif', size: 11 },
        },
        margin: { l: 65, r: 20, t: 20, b: 55 },
        paper_bgcolor: '#ffffff',
        plot_bgcolor: '#ffffff',
        font: { color: '#111111', family: 'Times New Roman, serif' },
        hovermode: 'x unified',
        autosize: true,
        height,
      } as Partial<Plotly.Layout>
    }

    // ── 深色模式（預設） ──
    const chartGrid = 'rgba(148, 163, 184, 0.12)'
    const chartText = '#cbd5e1'
    const chartBg = 'rgba(15, 23, 42, 0.55)'
    const chartLegendBg = 'rgba(15, 23, 42, 0.8)'
    const chartHoverBorder = 'rgba(148, 163, 184, 0.2)'
    return {
      xaxis: {
        title: { text: '2θ（degree）', font: { size: 12 } },
        showgrid: true, gridcolor: chartGrid, zeroline: false,
        color: chartText, range: [xMin, xMax],
      },
      yaxis: {
        title: { text: yTitle, font: { size: 12 } },
        showgrid: true, gridcolor: chartGrid, zeroline: false,
        color: chartText, range: yRange,
      },
      legend: {
        x: 1, xanchor: 'right', y: 1,
        bgcolor: chartLegendBg, bordercolor: chartHoverBorder, borderwidth: 1,
        font: { color: chartText, size: 11 },
      },
      margin: { l: 60, r: 24, t: 36, b: 52 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: chartBg,
      font: { color: chartText },
      hovermode: 'x unified',
      autosize: true,
      height,
    } as Partial<Plotly.Layout>
  }, [transformMode, normalizeCurves, xMin, xMax, useOriginStyle])

  // 4. Plotly Traces 渲染
  const plotlyTraces = useMemo(() => {
    if (viewMode === 'single' && activeTrace) {
      return buildChartTraces([activeTrace], 'single')
    }
    return buildChartTraces(processedTraces, viewMode)
  }, [viewMode, activeTrace, processedTraces, buildChartTraces])

  // Plotly 圖表外觀 Layout 設定
  const plotlyLayout = useMemo(() => {
    const height = viewMode !== 'single' && processedTraces.length > 1
      ? Math.min(1000, 480 + (processedTraces.length - 1) * 60)
      : 480
    if (viewMode === 'single' && activeTrace) {
      return buildChartLayout([activeTrace], 'single', height)
    }
    return buildChartLayout(processedTraces, viewMode, height)
  }, [viewMode, activeTrace, processedTraces, buildChartLayout])

  const orderedSingleTraces = useMemo(() => {
    const byId = new Map(processedTraces.map(trace => [trace.id, trace]))
    const order = singleCardOrder
    const orderedIds = order.filter(id => byId.has(id))
    const missingIds = processedTraces.map(trace => trace.id).filter(id => !orderedIds.includes(id))
    return [...orderedIds, ...missingIds].map(id => byId.get(id)).filter(Boolean) as typeof processedTraces
  }, [processedTraces, singleCardOrder])

  const draggedSingleTrace = useMemo(() => {
    if (!activeSingleCardId) return null
    return processedTraces.find(trace => trace.id === activeSingleCardId) ?? null
  }, [processedTraces, activeSingleCardId])

  const draggedSingleTraceIndex = activeSingleCardId && draggedSingleTrace
    ? Math.max(0, orderedSingleTraces.findIndex(trace => trace.id === draggedSingleTrace.id)) + 1
    : 0
  const draggedSingleTraceWide = activeSingleCardId && draggedSingleTrace
    ? isSingleCardWide(draggedSingleTrace.id, singleCardWideOverride)
    : false

  const normalizeSingleCardOrder = useCallback((order: string[]) => {
    const ids = processedTraces.map(trace => trace.id)
    const kept = order.filter(id => ids.includes(id))
    const missing = ids.filter(id => !kept.includes(id))
    return [...kept, ...missing]
  }, [processedTraces])

  const toggleSingleCardWide = useCallback((id: string) => {
    setSingleCardWideOverride(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const handleSingleCardDragStart = useCallback((event: DragStartEvent) => {
    const draggedId = String(event.active.id)
    setActiveSingleCardId(draggedId)
    setSelectedDatasetId(draggedId)
    setDragStartSingleCardOrder(orderedSingleTraces.map(trace => trace.id))
  }, [orderedSingleTraces])

  const handleSingleCardDragOver = useCallback((event: DragOverEvent) => {
    const activeId = String(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : null
    if (!overId || activeId === overId) return

    setSingleCardOrder(current => {
      const order = normalizeSingleCardOrder(current)
      const oldIndex = order.indexOf(activeId)
      const newIndex = order.indexOf(overId)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return order
      return arrayMove(order, oldIndex, newIndex)
    })
  }, [normalizeSingleCardOrder])

  const handleSingleCardDragEnd = useCallback((event: DragEndEvent) => {
    if (!event.over && dragStartSingleCardOrder) {
      setSingleCardOrder(dragStartSingleCardOrder)
    }
    setActiveSingleCardId(null)
    setDragStartSingleCardOrder(null)
  }, [dragStartSingleCardOrder])

  const handleSingleCardDragCancel = useCallback(() => {
    if (dragStartSingleCardOrder) {
      setSingleCardOrder(dragStartSingleCardOrder)
    }
    setActiveSingleCardId(null)
    setDragStartSingleCardOrder(null)
  }, [dragStartSingleCardOrder])

  const singleCardCollisionDetection = useCallback((args: Parameters<typeof pointerWithin>[0]) => {
    const pointerHits = pointerWithin(args)
    return pointerHits.length > 0 ? pointerHits : closestCenter(args)
  }, [])

  // 5. 建立導出的 CSV 內容
  const buildExportCsvContent = () => {
    if (processedTraces.length === 0) return ''

    const includeStacked = viewMode === 'offset'
    let csvContent = '2Theta(degree)'
    processedTraces.forEach(t => {
      csvContent += `,${t.name}_Y_Processed`
      if (includeStacked) {
        csvContent += `,${t.name}_Y_Stacked`
      }
    })
    csvContent += '\n'

    // 以第一筆 Trace 的長度做基準
    const baseTrace = processedTraces[0]
    for (let i = 0; i < baseTrace.xProcessed.length; i++) {
      let line = baseTrace.xProcessed[i].toFixed(4)
      processedTraces.forEach(t => {
        const yVal = t.yProcessed[i]
        line += `,${yVal != null ? yVal.toFixed(6) : ''}`
        if (includeStacked) {
          const yStack = t.yStacked[i]
          line += `,${yStack != null ? yStack.toFixed(6) : ''}`
        }
      })
      csvContent += line + '\n'
    }
    return csvContent
  }

  const handleExportDataCsv = () => {
    const csvContent = buildExportCsvContent()
    if (!csvContent) return

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `XRD_Processed_Data_${timestampForUtc8Filename()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // 6. 匯出峰位偏移報告文字檔
  const handleExportOffsetReport = () => {
    if (processedTraces.length === 0) return

    let reportTxt = `Nigiro Pro XRD 峰位偏移比對報告\n產生日期的：${formatUtc8Iso(new Date())}\n`
    reportTxt += `比對設定：最小相對強度 ${peakIntensityThreshold}%，容忍度 ${peakOffsetTolerance}°\n`
    reportTxt += `強度轉換方式：${transformMode}\n`
    reportTxt += `強度歸一化：${normalizeCurves ? '啟用 (0-1)' : '未啟用'}\n`
    reportTxt += `=========================================\n\n`

    processedTraces.forEach(trace => {
      reportTxt += `檔案名稱：${trace.name}\n`
      reportTxt += `背景估算值 (baseline)：${trace.baseline.toFixed(2)}\n`
      reportTxt += `X軸偏移值 (X Shift)：${(trace.xShift || 0).toFixed(4)}°\n`
      reportTxt += `-----------------------------------------\n`

      const reps = peakOffsetReport[trace.id] || []
      if (reps.length === 0) {
        reportTxt += `  在此比對設定下未找到可匹配的峰位。\n`
      } else {
        reportTxt += `  偵測峰位(2θ)  |  匹配相/晶面  |  參考峰位(2θ)  |  偏移量(Δ2θ)\n`
        reps.forEach(r => {
          reportTxt += `  ${r.observedPeak2Theta.toFixed(3).padEnd(14)}|  ${(r.phase + ' ' + r.hkl).padEnd(14)}|  ${r.refPeak2Theta.toFixed(3).padEnd(16)}|  ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(3)}°\n`
        })
      }
      reportTxt += `=========================================\n\n`
    })

    const blob = new Blob([reportTxt], { type: 'text/plain;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `XRD_Peak_Offset_Report_${timestampForUtc8Filename()}.txt`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // ── 計算工具：source resolver + import handler + per-card 結果計算 ──
  const resolveCalcSource = useCallback((mod: CalcModule): { x: number[]; y: number[]; name: string; color: string } | null => {
    if (mod.selectedSourceId === 'imported' && mod.imported) {
      return { x: mod.imported.x, y: mod.imported.y, name: mod.imported.name, color: mod.imported.color }
    }
    const trace = processedTraces.find(t => t.id === mod.selectedSourceId)
    if (trace) return { x: trace.xProcessed, y: trace.yProcessed, name: trace.name, color: trace.color }
    return null
  }, [processedTraces])

  const handleCalcImport = useCallback((files: File[], setMod: (updater: any) => void) => {
    const file = files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      const lines = content.split('\n')
      const x: number[] = []
      const y: number[] = []
      for (let line of lines) {
        line = line.trim()
        if (!line || line.startsWith('#') || line.startsWith('*')) continue
        const parts = line.split(/[\s,;\t]+/)
        if (parts.length >= 2) {
          const xv = parseFloat(parts[0])
          const yv = parseFloat(parts[1])
          if (Number.isFinite(xv) && Number.isFinite(yv)) { x.push(xv); y.push(yv) }
        }
      }
      if (x.length === 0) return
      const trace: CalcTrace = { id: 'imp_' + Date.now(), name: file.name, x, y, color: '#38bdf8' }
      setMod((prev: any) => ({ ...prev, imported: trace, selectedSourceId: 'imported', selectedPeakX: null }))
    }
    reader.readAsText(file)
  }, [])

  // 各 calc 的偵測峰下拉清單（用 findLocalPeaks，門檻 5%；最多列前 30 個）
  const calcPeaksFromMod = useCallback((mod: CalcModule) => {
    const src = resolveCalcSource(mod)
    if (!src) return [] as { x: number; y: number }[]
    return findLocalPeaks(src.x, src.y, 5).slice(0, 30).sort((a, b) => a.x - b.x)
  }, [resolveCalcSource])

  // 計算結果（依當前選峰）
  const fwhmResult = useMemo(() => {
    const src = resolveCalcSource(calcFwhm)
    if (!src || calcFwhm.selectedPeakX == null) return null
    return calcFwhmFromTrace(src.x, src.y, calcFwhm.selectedPeakX)
  }, [calcFwhm, resolveCalcSource])

  const scherrerResult = useMemo(() => {
    const src = resolveCalcSource(calcScherrer)
    if (!src || calcScherrer.selectedPeakX == null) return null
    // β 來源：使用者輸入 override，否則自動量
    const fwhmOverride = parseFloat(calcScherrer.fwhmOverride)
    const useOverride = Number.isFinite(fwhmOverride) && fwhmOverride > 0
    const measured = calcFwhmFromTrace(src.x, src.y, calcScherrer.selectedPeakX)
    const fwhmDeg = useOverride ? fwhmOverride : (measured?.fwhm ?? NaN)
    if (!Number.isFinite(fwhmDeg)) return null
    const D = calcScherrerD(calcScherrer.selectedPeakX, fwhmDeg, calcScherrer.K, calcScherrer.lambda)
    return { D, fwhmDeg, usedOverride: useOverride, measured, peakX: calcScherrer.selectedPeakX }
  }, [calcScherrer, resolveCalcSource])

  const dspacingResult = useMemo(() => {
    if (calcDspacing.selectedPeakX == null) return null
    const d = calcDSpacing(calcDspacing.selectedPeakX, calcDspacing.lambda)
    if (!Number.isFinite(d)) return null
    return { d, peakX: calcDspacing.selectedPeakX }
  }, [calcDspacing])

  // ── 統一匯出預覽：先彈視窗，使用者按「確定下載」才真正下載 ──
  const previewPng = async (graphDiv: HTMLElement | null, opts: { width: number; height: number; scale: number; filename: string }) => {
    if (!graphDiv) return
    try {
      const dataUrl = await PlotlyApi.toImage(graphDiv, { format: 'png', width: opts.width, height: opts.height, scale: opts.scale })
      setExportPreview({ kind: 'png', dataUrl, filename: opts.filename, width: opts.width, height: opts.height })
    } catch (e) {
      console.error('PNG preview failed', e)
    }
  }
  const previewText = (content: string, filename: string, ext: 'csv' | 'txt') => {
    if (!content) return
    setExportPreview({ kind: 'text', content, filename, ext })
  }
  const confirmExportDownload = () => {
    if (!exportPreview) return
    if (exportPreview.kind === 'png') {
      const link = document.createElement('a')
      link.href = exportPreview.dataUrl
      link.download = exportPreview.filename
      document.body.appendChild(link); link.click(); document.body.removeChild(link)
    } else {
      const mime = exportPreview.ext === 'csv' ? 'text/csv' : 'text/plain'
      const blob = new Blob([exportPreview.content], { type: mime + ';charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = exportPreview.filename
      document.body.appendChild(link); link.click(); document.body.removeChild(link)
    }
    setExportPreview(null)
  }

  // 匯出 helpers
  const downloadText = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime + ';charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = filename
    document.body.appendChild(link); link.click(); document.body.removeChild(link)
  }
  const handleFwhmExport = (sep: string, ext: string) => {
    if (!fwhmResult) return
    const lines = [
      ['peak_2theta_deg', 'peak_height', 'baseline', 'fwhm_deg', 'left_half_2theta', 'right_half_2theta'].join(sep),
      [fwhmResult.peakX.toFixed(4), fwhmResult.peakHeight.toFixed(4), fwhmResult.baseline.toFixed(4),
       fwhmResult.fwhm.toFixed(5), fwhmResult.leftHalfX.toFixed(4), fwhmResult.rightHalfX.toFixed(4)].join(sep),
    ]
    downloadText(`XRD_FWHM_${timestampForUtc8Filename()}.${ext}`, lines.join('\n'), ext === 'csv' ? 'text/csv' : 'text/plain')
  }
  const handleScherrerExport = (sep: string, ext: string) => {
    if (!scherrerResult) return
    const lines = [
      ['peak_2theta_deg', 'fwhm_deg', 'K', 'lambda_angstrom', 'D_angstrom', 'D_nm', 'fwhm_source'].join(sep),
      [scherrerResult.peakX.toFixed(4), scherrerResult.fwhmDeg.toFixed(5),
       calcScherrer.K.toString(), calcScherrer.lambda.toString(),
       scherrerResult.D.toFixed(3), (scherrerResult.D / 10).toFixed(4),
       scherrerResult.usedOverride ? 'manual_override' : 'auto_measured'].join(sep),
    ]
    downloadText(`XRD_Scherrer_${timestampForUtc8Filename()}.${ext}`, lines.join('\n'), ext === 'csv' ? 'text/csv' : 'text/plain')
  }
  const handleDspacingExport = (sep: string, ext: string) => {
    if (!dspacingResult) return
    const lines = [
      ['peak_2theta_deg', 'lambda_angstrom', 'd_spacing_angstrom', 'd_spacing_nm'].join(sep),
      [dspacingResult.peakX.toFixed(4), calcDspacing.lambda.toString(),
       dspacingResult.d.toFixed(4), (dspacingResult.d / 10).toFixed(5)].join(sep),
    ]
    downloadText(`XRD_dspacing_${timestampForUtc8Filename()}.${ext}`, lines.join('\n'), ext === 'csv' ? 'text/csv' : 'text/plain')
  }

  // ── 美化預覽資料源解析（'auto' 跟隨主圖；否則指定 rawFile.id） ──
  const beautifyEffective = useMemo(() => {
    if (beautifySourceMode === 'auto') {
      if (viewMode === 'single' && activeTrace) return { traces: [activeTrace], mode: 'single' as const }
      return { traces: processedTraces, mode: viewMode }
    }
    const picked = processedTraces.find(t => t.id === beautifySourceMode)
    if (picked) return { traces: [picked], mode: 'single' as const }
    // 找不到（檔案被刪），退回 auto
    if (viewMode === 'single' && activeTrace) return { traces: [activeTrace], mode: 'single' as const }
    return { traces: processedTraces, mode: viewMode }
  }, [beautifySourceMode, viewMode, activeTrace, processedTraces])

  // ── 美化預覽 traces（套用 lineWidthScale） ────────────────────
  const beautifyTraces = useMemo(() => {
    const base = buildChartTraces(beautifyEffective.traces, beautifyEffective.mode)
    return base.map((t: any) => {
      if (t && t.type === 'scatter' && t.mode === 'lines' && t.line) {
        return { ...t, line: { ...t.line, width: (t.line.width || 2) * beautify.lineWidthScale } }
      }
      return t
    })
  }, [beautifyEffective, buildChartTraces, beautify.lineWidthScale])

  // ── 美化預覽 layout（覆寫 axis / legend / 字體 / 背景） ──────────
  const beautifyLayout = useMemo(() => {
    const traces = beautifyEffective.traces
    const mode = beautifyEffective.mode
    const allYVals = traces.flatMap(t => mode === 'offset' ? t.yStacked : t.yProcessed)
    let yRange: any = undefined
    if (allYVals.length > 0) {
      const yMinVal = Math.min(...allYVals)
      const yMaxVal = Math.max(...allYVals)
      const ySpan = yMaxVal - yMinVal || 1
      yRange = [yMinVal - 0.02 * ySpan, yMaxVal + 0.15 * ySpan]
    }

    const isLight = beautify.background !== 'dark'
    const axisColor = isLight ? '#111111' : '#cbd5e1'
    const gridColor = isLight ? '#e5e7eb' : 'rgba(148,163,184,0.18)'
    const paperBg = beautify.background === 'transparent' ? 'rgba(0,0,0,0)'
      : beautify.background === 'dark' ? 'rgba(15,23,42,0.8)' : '#ffffff'
    const plotBg = beautify.background === 'transparent' ? 'rgba(0,0,0,0)'
      : beautify.background === 'dark' ? 'rgba(15,23,42,0.55)' : '#ffffff'
    const legendBg = beautify.background === 'transparent' ? 'rgba(255,255,255,0)' : isLight ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.85)'

    const legendXY = (() => {
      switch (beautify.legendPos) {
        case 'top-left':     return { x: 0.02, xanchor: 'left',  y: 0.98, yanchor: 'top' }
        case 'bottom-right': return { x: 0.98, xanchor: 'right', y: 0.02, yanchor: 'bottom' }
        case 'bottom-left':  return { x: 0.02, xanchor: 'left',  y: 0.02, yanchor: 'bottom' }
        case 'top-right':
        default:             return { x: 0.98, xanchor: 'right', y: 0.98, yanchor: 'top' }
      }
    })()

    const showLegend = beautify.showLegend && beautify.legendPos !== 'hidden'

    return {
      xaxis: {
        title: { text: beautify.xAxisTitle, font: { size: beautify.titleFontSize, family: 'Times New Roman, serif', color: axisColor } },
        showgrid: beautify.showXGrid, gridcolor: gridColor, zeroline: false,
        linecolor: axisColor, linewidth: 1.5, mirror: true,
        tickcolor: axisColor, ticks: 'outside', showline: true,
        showticklabels: beautify.showXTickLabels,
        nticks: beautify.xNTicks,
        range: [xMin, xMax],
        tickfont: { color: axisColor, family: 'Times New Roman, serif', size: beautify.axisFontSize },
      },
      yaxis: {
        title: { text: beautify.yAxisTitle, font: { size: beautify.titleFontSize, family: 'Times New Roman, serif', color: axisColor } },
        showgrid: beautify.showYGrid, gridcolor: gridColor, zeroline: false,
        linecolor: axisColor, linewidth: 1.5, mirror: true,
        tickcolor: axisColor, ticks: 'outside', showline: true,
        showticklabels: beautify.showYTickLabels,
        nticks: beautify.yNTicks,
        range: yRange,
        tickfont: { color: axisColor, family: 'Times New Roman, serif', size: beautify.axisFontSize },
      },
      showlegend: showLegend,
      legend: {
        ...legendXY,
        bgcolor: legendBg, bordercolor: isLight ? '#aaaaaa' : 'rgba(148,163,184,0.3)', borderwidth: 1,
        font: { color: axisColor, family: 'Times New Roman, serif', size: beautify.legendFontSize },
      },
      margin: { l: 70, r: 24, t: 24, b: 60 },
      paper_bgcolor: paperBg,
      plot_bgcolor: plotBg,
      font: { color: axisColor, family: 'Times New Roman, serif' },
      hovermode: 'x unified',
      autosize: true,
      height: 540,
    } as Partial<Plotly.Layout>
  }, [beautifyEffective, xMin, xMax, beautify])

  // ── 美化卡：PNG / TXT / CSV 匯出（一律走預覽） ──
  const handleBeautifyExportPng = () => {
    previewPng(beautifyGraphDivRef.current, {
      width: beautify.pngWidth, height: beautify.pngHeight, scale: beautify.pngScale,
      filename: `XRD_Beautified_${timestampForUtc8Filename()}.png`,
    })
  }

  const buildPlainDataText = (sep: string) => {
    if (processedTraces.length === 0) return ''
    const includeStacked = viewMode === 'offset'
    let lines: string[] = []
    let header = '2Theta(degree)'
    processedTraces.forEach(t => {
      header += sep + `${t.name}_Y_Processed`
      if (includeStacked) header += sep + `${t.name}_Y_Stacked`
    })
    lines.push(header)
    const base = processedTraces[0]
    for (let i = 0; i < base.xProcessed.length; i++) {
      let line = base.xProcessed[i].toFixed(4)
      processedTraces.forEach(t => {
        const yVal = t.yProcessed[i]
        line += sep + (yVal != null ? yVal.toFixed(6) : '')
        if (includeStacked) {
          const yStack = t.yStacked[i]
          line += sep + (yStack != null ? yStack.toFixed(6) : '')
        }
      })
      lines.push(line)
    }
    return lines.join('\n')
  }

  const handleBeautifyExportTxt = () => {
    previewText(buildPlainDataText('\t'), `XRD_Data_${timestampForUtc8Filename()}.txt`, 'txt')
  }
  const handleBeautifyExportCsv = () => {
    previewText(buildPlainDataText(','), `XRD_Data_${timestampForUtc8Filename()}.csv`, 'csv')
  }

  // ── 主圖卡：PNG / TXT / CSV 匯出（一律走預覽） ──
  const handleMainExportPng = () => {
    previewPng(mainGraphDivRef.current, {
      width: beautify.pngWidth, height: beautify.pngHeight, scale: beautify.pngScale,
      filename: `XRD_Main_${timestampForUtc8Filename()}.png`,
    })
  }
  const handleMainExportCsv = () => {
    previewText(buildExportCsvContent(), `XRD_Processed_Data_${timestampForUtc8Filename()}.csv`, 'csv')
  }
  const handleMainExportTxt = () => {
    previewText(buildPlainDataText('\t'), `XRD_Data_${timestampForUtc8Filename()}.txt`, 'txt')
  }

  // ── Step 1 ~ Step 7 的問號說明內容 ──
  const step1Info = (
    <div className="space-y-4">
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">🔬 科學原理：X光繞射圖譜 (XRD)</h5>
        <p className="text-[13px] leading-relaxed text-slate-300">
          X光繞射 (X-ray Diffraction, XRD) 是利用晶體對 X 光進行繞射，來分析材料的晶體結構、相組成、晶格常數等的重要表徵手段。
          上傳檔案應包含兩欄數據：橫軸為繞射角 2θ（通常以度為單位），縱軸為繞射強度（以計數或 arbitrary units a.u. 為單位）。
        </p>
      </div>
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">💡 操作指南與支援格式</h5>
        <ul className="list-disc pl-5 text-[13px] text-slate-300 space-y-1">
          <li>支援上傳 <span className="font-mono text-[var(--accent)] font-bold">.TXT</span>、<span className="font-mono text-[var(--accent)] font-bold">.XY</span>、<span className="font-mono text-[var(--accent)] font-bold">.CSV</span> 等純文字多欄光譜檔案。</li>
          <li>支援多檔同時上傳。當您上傳多個檔案時，系統將自動啟用「多檔疊圖 (Overlay) 」模式。</li>
        </ul>
      </div>
    </div>
  )

  const step2Info = (
    <div className="space-y-4">
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">🔬 科學原理：角度校正與系統位移</h5>
        <p className="text-[13px] leading-relaxed text-slate-300">
          在 XRD 實際測試中，由於樣品表面的高度偏差（Sample Displacement）或儀器本身的機械零點漂移，
          會造成測量出的繞射峰角度（2θ）整體向左或向右偏移。此偏移通常很小（約 ±0.1° ~ ±0.5° 之間），
          但會直接影響晶面指數的判定與晶格常數計算的準確性。
        </p>
      </div>
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">💡 操作指南</h5>
        <ul className="list-disc pl-5 text-[13px] text-slate-300 space-y-1">
          <li>您可以單獨微調每個檔案的 <span className="font-mono text-[var(--accent)] font-bold">x_shift (Δ2θ)</span> 偏移角度（度）。</li>
          <li>圖表會即時動態平移曲線，以便您手動與標準化合物的垂直點虛線參考峰進行精準對齊。</li>
        </ul>
      </div>
    </div>
  )

  const step3Info = (
    <div className="space-y-4">
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">🔬 科學原理：基線扣除與強度對數</h5>
        <p className="text-[13px] leading-relaxed text-slate-300">
          在 XRD 圖譜中，基質或基板的強繞射峰（主峰）強度可能高達數萬，而微量雜相的特徵峰強度只有幾十，
          主峰與弱峰的強度可能相差三個數量級以上。在線性坐標下，弱峰會被壓縮成一條平線，極難觀察。
          系統會先以 1% 百分位數估算基線並做 <span className="font-mono text-[var(--accent)] font-bold">y_corr = y - baseline + 1</span>，
          再採用 <span className="font-mono text-[var(--accent)] font-bold">Log10</span> 或 <span className="font-mono text-[var(--accent)] font-bold">Ln</span> 對數強度轉換，
          可以壓制強峰的振幅，同時極大拉高弱相特徵峰的可視度。
        </p>
      </div>
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">💡 操作指南</h5>
        <ul className="list-disc pl-5 text-[13px] text-slate-300 space-y-1">
          <li>**強度轉換方式**：可切換 None（不轉換）、Log10（對數）、Ln（自然對數）、Sqrt（平方根）。</li>
          <li>若今天只需要觀察 log 後的相對峰強，請在下一步維持「不歸一化」。</li>
        </ul>
      </div>
    </div>
  )

  const step4Info = (
    <div className="space-y-4">
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">🔬 科學原理：Min-Max 去噪歸一化</h5>
        <p className="text-[13px] leading-relaxed text-slate-300">
          本系統的歸一化使用 <span className="font-mono text-[var(--accent)] font-bold">1% ~ 99.7%</span> 百分位數去噪 Min-Max 演算法，
          會將每條曲線依自身強度範圍重新拉到 0~1。這適合多檔疊圖時做形狀比較，但會改變原本峰值強度比例。
        </p>
        <p className="text-[13px] leading-relaxed text-slate-300 mt-2">
          因此歸一化現在獨立成一個可克制啟用的步驟，預設關閉；只有在需要壓平不同量測幅度、專注比較峰位與峰形時再開啟。
        </p>
      </div>
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">💡 操作指南</h5>
        <ul className="list-disc pl-5 text-[13px] text-slate-300 space-y-1">
          <li>**不歸一化**：保留 log / sqrt / raw 轉換後的峰值強度比例，適合需要比較峰強的資料。</li>
          <li>**啟用歸一化**：各曲線進入 0~1 統一尺度，適合多檔疊圖、弱峰檢視或純形狀比對。</li>
        </ul>
      </div>
    </div>
  )

  const step5Info = (
    <div className="space-y-4">
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">🔬 科學原理：自適應多檔疊圖與數據裁剪</h5>
        <p className="text-[13px] leading-relaxed text-slate-300">
          多檔數據比較時，如果將多條曲線重疊在同一個 Y 軸起點，會導致曲線互相覆蓋，無法進行特徵比對。
          本系統內建自適應高度與 Y 軸間距排版算法。當檔案數量增加時，圖表會動態垂直拉長（最大限制至 1000px），並根據檔案數自適應優化 Y 軸疊加偏移量間距，
          使 2~3 筆少檔數據飽滿撐滿視覺空間，而 5 筆以上多檔時保持緊湊精美，滿足論文發表美學要求。
        </p>
        <p className="text-[13px] leading-relaxed text-slate-300 mt-2">
          限制繞射角 $x\_min$ 與 $x\_max$ 可在數據管線源頭裁剪掉無用區間點，大幅減少渲染負載並使視域聚焦。
        </p>
      </div>
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">💡 操作指南</h5>
        <ul className="list-disc pl-5 text-[13px] text-slate-300 space-y-1">
          <li>**角度限制 (x_min / x_max)**：直接輸入數值以裁剪圖譜角度範圍。</li>
          <li>**一鍵自動疊線**：點擊一鍵分配，系統會自動依上傳檔案數最佳化偏移量，讓第一個在最上、最後一個在最下層。</li>
          <li>**線條自訂顏色**：在下方點選精緻色點，直接使用 HTML5 原生調色盤自訂每一條光譜線條顏色。</li>
        </ul>
      </div>
    </div>
  )

  const step6Info = (
    <div className="space-y-4">
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">🔬 科學原理：物相鑑定與防壓峰標籤定位演算法</h5>
        <p className="text-[13px] leading-relaxed text-slate-300">
          相鑑定是 XRD 分析的最核心任務。通過將樣品的繞射峰與標準 PDF (Powder Diffraction File) 卡片的標準角度與晶面進行對齊比對，
          可以精確識別材料所包含的相組成（晶體結構種類）。
        </p>
        <p className="text-[13px] leading-relaxed text-slate-300 mt-2">
          **大師級防壓峰標籤定位演算法**：在繪製參考峰垂直虛線時，系統會自動掃描該角度周圍 $0.25^\circ$ 內所有載入光譜曲線的最高強度值。
          標籤文字將自動浮於其上方，且點虛線停留在文字下方不穿透，使圖例極度美觀，絕不壓在繞射峰上。
        </p>
      </div>
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">💡 操作指南</h5>
        <ul className="list-disc pl-5 text-[13px] text-slate-300 space-y-1">
          <li>開啟「在圖表中顯示參考峰」後，點擊「🔬 選擇標準化合物」按鈕。</li>
          <li>將會開啟一個高質感的雙欄選擇 Modal，您可以在左側選中化合物，在右側**單獨勾選或取消特定的結晶面 (hkl)**，進行高自由度客製化，圖表會即時動態渲染。</li>
        </ul>
      </div>
    </div>
  )

  const step7Info = (
    <div className="space-y-4">
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">🔬 科學原理：峰位偏移與晶格畸變分析</h5>
        <p className="text-[13px] leading-relaxed text-slate-300">
          在多晶體材料中，當晶格受到摻雜原子引起的應力（Stress）、晶格畸變（Lattice Distortion）、或者化學組分微小漂移時，
          特徵繞射峰的角度會發生微小的平移。
        </p>
        <p className="text-[13px] leading-relaxed text-slate-300 mt-2">
          系統會自動對您的處理後數據執行五點局部二次導數極值尋峰，並與您勾選啟用的標準特徵晶面進行鄰近比對，
          自動匯報 $\Delta 2\theta$ 偏移量（綠色代表正向偏移、紅色代表負向偏移），供研究者分析晶格常數的變化趨勢。
        </p>
      </div>
      <div>
        <h5 className="text-sm font-bold text-white mb-1.5 font-mono">💡 操作指南</h5>
        <ul className="list-disc pl-5 text-[13px] text-slate-300 space-y-1">
          <li>**尋峰強度門檻**：用以調整局部峰位偵測的敏感度。</li>
          <li>**偏移比對容忍度**：調整偵測峰與標準參考峰進行對齊時的最大搜尋半徑。超出此半徑將不被回報。</li>
        </ul>
      </div>
    </div>
  )

  // 側邊欄寬度設定樣式
  const sidebarStyle = sidebarCollapsed
    ? { width: `${SIDEBAR_COLLAPSED_PEEK}px` }
    : { width: `${sidebarWidth}px` }

  return (
    <div className={`flex h-screen flex-row overflow-hidden${sidebarResizing ? ' select-none' : ''}`}>

      {/* ── 左側控制側欄 (aside) ── */}
      <aside
        style={sidebarStyle}
        className={`relative flex shrink-0 flex-col overflow-hidden border-r border-[var(--card-divider)] bg-[var(--panel-bg)]${
          sidebarResizing ? '' : ' transition-[width] duration-200'
        }`}
      >
        {sidebarCollapsed ? (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="flex h-full w-full flex-col items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <span className="text-lg">›</span>
          </button>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <StickySidebarHeader
                activeModule="xrd"
                subtitle="桌面版流程模擬器"
                onSelectModule={onModuleSelect}
                onCollapse={() => setSidebarCollapsed(true)}
                currentWorkspace={currentWorkspace}
                onSelectWorkspace={onSelectWorkspace}
              />

              {/* 選擇當前顯示的光譜（XRD 特有：可單筆檢視某一筆） */}
              {rawFiles.length > 0 && (
                <div className="mx-4 mb-3 space-y-1 max-h-44 overflow-y-auto pr-1">
                  <p className="px-1 pb-0.5 text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">已載入光譜（點選切換）</p>
                  {rawFiles.map(f => (
                    <button key={f.id} type="button" onClick={() => setSelectedDatasetId(f.id)}
                      className={['flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors pressable',
                        selectedDatasetId === f.id ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-main)]' : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-soft)]'].join(' ')}>
                      <span className="w-2.5 h-2.5 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: f.color }} />
                      <span className="truncate flex-1">{f.name}</span>
                      <span className="text-[10px] text-[var(--text-soft)] shrink-0">{f.x.length} 點</span>
                    </button>
                  ))}
                </div>
              )}

              {/* 🎨 顯示與外觀 分組標籤 */}
              <div className="px-4 pt-4 pb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent-strong)] font-mono flex items-center gap-1.5">
                    <span className="text-xs">🎨</span> 顯示與外觀
                  </span>
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-[color-mix(in_srgb,var(--accent-strong)_25%,transparent)] to-transparent" />
                </div>
              </div>

              {/* 顯示模式（背景內嵌、無卡片殼） */}
              <div className="px-4 pt-1 pb-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-soft)] font-mono">
                    顯示模式
                  </span>
                  <div className="flex rounded-lg border border-[var(--card-border)] bg-[var(--card-ghost)] p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode('single')}
                      className={`rounded px-2.5 py-1 text-[10px] font-semibold transition-all ${
                        viewMode === 'single'
                          ? 'bg-[var(--accent-secondary)] text-white shadow'
                          : 'text-[var(--text-soft)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      單筆
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('offset')}
                      className={`rounded px-2.5 py-1 text-[10px] font-semibold transition-all ${
                        viewMode === 'offset'
                          ? 'bg-[var(--accent-secondary)] text-white shadow'
                          : 'text-[var(--text-soft)] hover:text-[var(--text-main)]'
                      }`}
                      title="多檔垂直 offset 等距分開"
                    >
                      Offset
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('overlay')}
                      className={`rounded px-2.5 py-1 text-[10px] font-semibold transition-all ${
                        viewMode === 'overlay'
                          ? 'bg-[var(--accent-secondary)] text-white shadow'
                          : 'text-[var(--text-soft)] hover:text-[var(--text-main)]'
                      }`}
                      title="多檔直接疊圖（無 offset）"
                    >
                      疊圖
                    </button>
                  </div>
                </div>
              </div>

              {/* 疊圖外觀設定（已上移至 Step 2 前） */}
              <Section step={4} title="疊圖外觀設定" infoContent={step5Info} defaultOpen={false}
                status={rawFiles.length === 0 ? 'locked' : 'on'}
                open={sectionOpen[5]}
                onOpenChange={v => setStepOpen(5, v)}>
                {rawFiles.length === 0 ? (
                  <p className="text-xs text-[var(--text-soft)] italic">請先載入 XRD 光譜數據</p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 pb-2 border-b border-[var(--card-divider)]">
                      <NumInput
                        label="最小角度 (x_min) °"
                        value={xMin}
                        onChange={val => setXMin(Math.max(0, val))}
                      />
                      <NumInput
                        label="最大角度 (x_max) °"
                        value={xMax}
                        onChange={val => setXMax(Math.max(xMin + 1, val))}
                      />
                    </div>

                    {viewMode === 'offset' && (
                      <div className="pb-2 border-b border-[var(--card-divider)]">
                        <button
                          type="button"
                          onClick={handleAutoStackOffsets}
                          className="w-full rounded-lg bg-[color:color-mix(in_srgb,var(--accent-secondary)_10%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--accent-secondary)_15%,transparent)] border border-[color:color-mix(in_srgb,var(--accent-secondary)_20%,transparent)] px-3 py-1.5 text-center text-xs font-bold text-[var(--accent-secondary)] transition-all pressable"
                        >
                          ⚡ 一鍵均勻分配垂直疊加高度
                        </button>
                      </div>
                    )}

                    <div className="max-h-48 overflow-y-auto space-y-3 pr-1">
                      {rawFiles.map(f => (
                        <div key={f.id} className="space-y-1.5 border border-[var(--card-border)] bg-[var(--card-ghost)] p-2.5 rounded-xl">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
                            <span className="text-xs font-semibold text-[var(--text-main)] truncate">{f.name}</span>
                          </div>

                          <div className={viewMode === 'offset' ? 'grid grid-cols-2 gap-2' : ''}>
                            <div>
                              <span className="text-[9px] text-[var(--text-soft)] uppercase tracking-[0.18em] mb-1 block">線寬 (px)</span>
                              <input
                                type="number"
                                min="1"
                                max="8"
                                value={f.linewidth}
                                onChange={e => {
                                  const val = parseInt(e.target.value) || 2
                                  setRawFiles(prev => prev.map(item => item.id === f.id ? { ...item, linewidth: val } : item))
                                }}
                                className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1 text-xs text-[var(--input-text)] focus:outline-none"
                              />
                            </div>
                            {viewMode === 'offset' && (
                              <div>
                                <span className="text-[9px] text-[var(--text-soft)] uppercase tracking-[0.18em] mb-1 block">Y 疊加偏移</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={f.offset}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0
                                    setRawFiles(prev => prev.map(item => item.id === f.id ? { ...item, offset: val } : item))
                                  }}
                                  className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1 text-xs text-[var(--input-text)] focus:outline-none"
                                />
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--card-divider)]/40">
                            <span className="text-[9px] text-[var(--text-soft)] uppercase tracking-[0.18em]">線條顏色</span>
                            <div className="flex items-center gap-2">
                              <label className="relative flex h-6 w-12 cursor-pointer items-center justify-center rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] transition-colors hover:border-[var(--accent-strong)]/60">
                                <span className="h-3 w-3 rounded-full border border-white/10" style={{ backgroundColor: f.color }} />
                                <input
                                  type="color"
                                  value={f.color.startsWith('#') ? f.color : '#38bdf8'}
                                  onChange={e => {
                                    const val = e.target.value
                                    setRawFiles(prev => prev.map(item => item.id === f.id ? { ...item, color: val } : item))
                                  }}
                                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                />
                              </label>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Section>

              {/* ⚡ 訊號變換與前處理 */}
              <div className="px-4 pt-4 pb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent-strong)] font-mono flex items-center gap-1.5">
                    <span className="text-xs">⚡</span> 訊號變換與前處理
                  </span>
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-[color-mix(in_srgb,var(--accent-strong)_25%,transparent)] to-transparent" />
                </div>
              </div>

              {/* Step 2: X軸偏移微調 */}
              <Section step={1} title="X 軸偏移量微調" infoContent={step2Info} defaultOpen={false}
                status={rawFiles.length === 0 ? 'locked' : (rawFiles.some(f => (f.xShift || 0) !== 0) ? 'on' : 'off')}>
                {rawFiles.length === 0 ? (
                  <p className="text-xs text-[var(--text-soft)] italic">請先載入 XRD 光譜數據</p>
                ) : (
                  <div className="space-y-2.5">
                    {rawFiles.map(f => (
                      <div key={f.id} className="flex items-center justify-between gap-3 bg-[var(--card-ghost)] border border-[var(--card-border)] rounded-[14px] px-2.5 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
                          <span className="text-[11px] font-medium text-[var(--text-main)] truncate" title={f.name}>{f.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] text-[var(--text-soft)]">Δ2θ:</span>
                          <input
                            type="number"
                            step="0.01"
                            value={f.xShift || 0}
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0
                              setRawFiles(prev => prev.map(item => item.id === f.id ? { ...item, xShift: val } : item))
                            }}
                            className="w-16 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1.5 py-0.5 text-center text-xs text-[var(--input-text)] focus:outline-none focus:border-[var(--accent-strong)]/60"
                          />
                          <span className="text-[10px] text-[var(--text-soft)]">°</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Step 3: 背景校正與信號轉換 */}
              <Section step={2} title="強度轉換與基線扣除" infoContent={step3Info} defaultOpen={false}
                status={rawFiles.length === 0 ? 'locked' : (transformMode !== 'none' ? 'on' : 'off')}>
                <div className="space-y-3">
                  <CustomSelect
                    label="強度轉換方式"
                    value={transformMode}
                    onChange={val => setTransformMode(val as any)}
                    options={[
                      { value: 'none', label: '無 (Raw Intensity)' },
                      { value: 'log10', label: 'Log10 強度對數' },
                      { value: 'ln', label: 'Ln 自然對數' },
                      { value: 'sqrt', label: 'Sqrt 強度開根號' },
                    ]}
                  />
                </div>
              </Section>

              {/* Step 4: 強度歸一化 */}
              <Section step={3} title="強度歸一化" infoContent={step4Info} defaultOpen={false}
                status={rawFiles.length === 0 ? 'locked' : (normalizeCurves ? 'on' : 'off')}>
                <div className="space-y-3">
                  <TogglePill
                    label="啟用 0~1 Min-Max 歸一化"
                    checked={normalizeCurves}
                    onChange={setNormalizeCurves}
                  />
                  <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-[11px] leading-5 text-[var(--text-soft)]">
                    {normalizeCurves
                      ? '目前會在強度轉換後做嚴格 0~1 Min-Max 歸一化（最大值＝1、最小值＝0）。'
                      : '目前只保留基線扣除與強度轉換結果，不會把峰值強度拉到 0~1。'}
                  </div>
                </div>
              </Section>

              {/* Step 6: 固定參考峰 / 圖例 */}
              {/* 🔬 物相比對與峰位分析 */}
              <div className="px-4 pt-4 pb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent-strong)] font-mono flex items-center gap-1.5">
                    <span className="text-xs">🔬</span> 物相比對與峰位分析
                  </span>
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-[color-mix(in_srgb,var(--accent-strong)_25%,transparent)] to-transparent" />
                </div>
              </div>

              <Section step={5} title="固定參考峰 / 圖例" infoContent={step6Info} defaultOpen={false}
                status={rawFiles.length === 0 ? 'locked' : (Object.values(enabledRefCompounds).some(Boolean) ? 'on' : 'off')}>
                <div className="space-y-3">
                  <TogglePill
                    label="在圖表中顯示參考峰"
                    checked={showReferenceMarkers}
                    onChange={setShowReferenceMarkers}
                  />

                  {showReferenceMarkers && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowRefMarkersModal(true)}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent-strong)] hover:opacity-90 px-4 py-2 text-center text-xs font-bold text-white shadow-lg transition-all pressable"
                      >
                        🔬 選擇標準化合物 ({Object.values(enabledRefCompounds).filter(Boolean).length} 已選)
                      </button>
                      <div>
                        <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">
                          (hkl) 標籤字體大小：{refMarkerLabelSize} pt
                        </span>
                        <input
                          type="range"
                          min={7}
                          max={24}
                          step={1}
                          value={refMarkerLabelSize}
                          onChange={e => setRefMarkerLabelSize(parseInt(e.target.value) || 11)}
                          className="w-full"
                        />
                      </div>
                    </>
                  )}
                </div>
              </Section>

              {/* Step 7: 峰位偏移報告 */}
              <Section step={6} title="峰位偏移比對" infoContent={step7Info} defaultOpen={false}
                status={!Object.values(enabledRefCompounds).some(Boolean) ? 'locked' : 'on'}>
                <div className="space-y-3">
                  <NumInput
                    label="尋峰強度門檻 (%)"
                    value={peakIntensityThreshold}
                    onChange={val => setPeakIntensityThreshold(Math.max(1, Math.min(50, val)))}
                    min={1}
                    max={50}
                  />
                  <Advanced title="進階：偏移比對容忍度">
                    <NumInput
                      label="偏移比對容忍度 (°)"
                      value={peakOffsetTolerance}
                      onChange={val => setPeakOffsetTolerance(Math.max(0.05, Math.min(1.5, val)))}
                      min={0.05}
                      max={1.5}
                      step={0.05}
                    />
                  </Advanced>
                </div>
              </Section>

              {/* 📐 圖表輸出與美化 分組標籤 */}
              <div className="px-4 pt-4 pb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent-strong)] font-mono flex items-center gap-1.5">
                    <span className="text-xs">📐</span> 圖表輸出與美化
                  </span>
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-[color-mix(in_srgb,var(--accent-strong)_25%,transparent)] to-transparent" />
                </div>
              </div>

              {/* 美化預覽圖卡 開關（控件在中間欄的美化卡內，這裡只有 enable toggle） */}
              <Section step={7} title="圖表美化與匯出" defaultOpen={false}
                status={rawFiles.length === 0 ? 'locked' : (beautifyEnabled ? 'on' : 'off')}>
                <div className="space-y-2">
                  <TogglePill
                    label="顯示美化預覽圖卡"
                    checked={beautifyEnabled}
                    onChange={setBeautifyEnabled}
                  />
                  <p className="text-[11px] leading-5 text-[var(--text-soft)]">
                    開啟後請在中間欄底部的「📐 美化預覽（出報告用）」圖卡內調整所有美化參數與匯出。
                    PNG 會所見即所得依美化後外觀輸出；CSV / TXT 只包含純數據。
                  </p>
                </div>
              </Section>

              {/* 🧮 衍生計算工具 分組標籤 */}
              <div className="px-4 pt-4 pb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent-strong)] font-mono flex items-center gap-1.5">
                    <span className="text-xs">🧮</span> 衍生計算工具
                  </span>
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-[color-mix(in_srgb,var(--accent-strong)_25%,transparent)] to-transparent" />
                </div>
              </div>

              <Section step={8} title="d-spacing" defaultOpen={false}
                status={calcDspacing.enabled ? 'on' : 'off'}>
                <TogglePill label="顯示 d-spacing 計算卡" checked={calcDspacing.enabled} onChange={v => setCalcDspacing(p => ({ ...p, enabled: v }))} />
                <p className="mt-2 text-[11px] leading-5 text-[var(--text-soft)]">
                  啟用後出現「📐 d-spacing 計算卡」。只需要峰位 2θ 與波長 λ（預設 Cu Kα）。
                </p>
              </Section>

              <Section step={9} title="FWHM 計算" defaultOpen={false}
                status={calcFwhm.enabled ? 'on' : 'off'}>
                <TogglePill label="顯示 FWHM 計算卡" checked={calcFwhm.enabled} onChange={v => setCalcFwhm(p => ({ ...p, enabled: v }))} />
                <p className="mt-2 text-[11px] leading-5 text-[var(--text-soft)]">
                  啟用後在中間欄底部出現「📏 FWHM 計算卡」。可選主流程光譜或匯入單一檔案，從下拉選峰即量測 FWHM、輸出 CSV/TXT。
                </p>
              </Section>

              <Section step={10} title="晶粒尺寸 D" defaultOpen={false}
                status={calcScherrer.enabled ? 'on' : 'off'}>
                <TogglePill label="顯示 Scherrer 計算卡" checked={calcScherrer.enabled} onChange={v => setCalcScherrer(p => ({ ...p, enabled: v }))} />
                <p className="mt-2 text-[11px] leading-5 text-[var(--text-soft)]">
                  啟用後出現「💎 晶粒尺寸 D 計算卡」。β 預設自動量自選峰，也可手動輸入 override。
                </p>
              </Section>
            </div>

            {/* 側邊欄拖曳手柄 */}
            <div
              onMouseDown={e => {
                e.preventDefault()
                setSidebarResizing(true)
              }}
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent)] bg-transparent z-50 transition-colors duration-150"
            />
          </>
        )}
      </aside>

      {/* ── 右側主內容欄 ── */}
      <main className="min-h-0 flex flex-1 flex-col overflow-y-auto px-5 py-8 sm:px-8 xl:px-10 xl:py-10">
        <div className="mx-auto w-full max-w-[1500px]">

          {rawFiles.length === 0 ? (
            <EmptyWorkspaceState
              module="xrd"
              title="尚未匯入 XRD 繞射圖譜"
              description="請由左側面板第 1 步匯入一或多個 .txt, .xy, .csv 檔案，系統將在前端立即執行基線扣除與疊圖繪製。"
              formats={['.TXT', '.XY', '.CSV']}
            />
          ) : (
            <div className="space-y-4">

              {viewMode !== 'single' ? (
                <div className={`analysis-section-card p-4 transition-colors duration-300 ${useOriginStyle ? 'bg-white/95 border-slate-300' : ''}`}>
                  <ChartToolbar
                    title={viewMode === 'offset' ? 'Offset 偏移疊圖比較結果' : '純疊圖比較結果（無 offset）'}
                    actions={
                      <button
                        type="button"
                        onClick={() => setUseOriginStyle(s => !s)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all pressable ${
                          useOriginStyle
                            ? 'border-slate-400 bg-white text-slate-700 hover:bg-slate-50'
                            : 'border-[var(--card-border)] bg-[var(--card-ghost)] text-[var(--text-soft)] hover:text-[var(--text-main)]'
                        }`}
                        title={useOriginStyle ? '切換回深色模式' : '切換為 Origin Pro 白底科研風格'}
                      >
                        {useOriginStyle ? '🌙 深色模式' : '📄 Origin Pro 風格'}
                      </button>
                    }
                  />

                  <DeferredRender minHeight={400}>
                    <Plot
                      data={plotlyTraces}
                      layout={plotlyLayout}
                      config={{
                        responsive: true,
                        displaylogo: false,
                        modeBarButtonsToRemove: ['select2d', 'lasso2d'],
                      }}
                      onInitialized={(_fig, gd) => { mainGraphDivRef.current = gd as unknown as HTMLElement }}
                      onUpdate={(_fig, gd) => { mainGraphDivRef.current = gd as unknown as HTMLElement }}
                      className="w-full"
                    />
                  </DeferredRender>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--card-divider)] pt-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={handleMainExportPng}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--accent-strong)] hover:opacity-90 px-4 py-1.8 text-xs font-semibold text-white transition-all pressable">
                        📷 匯出 PNG（預覽後下載）
                      </button>
                      <button type="button" onClick={handleMainExportCsv}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] hover:bg-[var(--card-ghost)] px-4 py-1.8 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all pressable">
                        📥 匯出 CSV
                      </button>
                      <button type="button" onClick={handleMainExportTxt}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] hover:bg-[var(--card-ghost)] px-4 py-1.8 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all pressable">
                        📄 匯出 TXT (Tab)
                      </button>
                      <button type="button" onClick={handleExportOffsetReport}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] hover:bg-[var(--card-ghost)] px-4 py-1.8 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all pressable">
                        📋 匯出峰位偏移報告 (TXT)
                      </button>
                    </div>
                    <p className="text-[10px] text-[var(--text-soft)] italic">
                      * PNG / CSV / TXT 會先彈出預覽，確認後再下載
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <DndContext
                    sensors={singleCardSensors}
                    collisionDetection={singleCardCollisionDetection}
                    onDragStart={handleSingleCardDragStart}
                    onDragOver={handleSingleCardDragOver}
                    onDragEnd={handleSingleCardDragEnd}
                    onDragCancel={handleSingleCardDragCancel}
                  >
                    <SortableContext items={orderedSingleTraces.map(trace => trace.id)} strategy={rectSortingStrategy}>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {orderedSingleTraces.map((trace, index) => (
                          <SortableXrdSingleChartCard
                            key={trace.id}
                            trace={trace}
                            index={index}
                            total={orderedSingleTraces.length}
                            wide={isSingleCardWide(trace.id, singleCardWideOverride)}
                            selected={selectedDatasetId === trace.id}
                            useOriginStyle={useOriginStyle}
                            onSelect={() => setSelectedDatasetId(trace.id)}
                            onToggleWide={() => toggleSingleCardWide(trace.id)}
                            buildChartTraces={buildChartTraces}
                            buildChartLayout={buildChartLayout}
                          />
                        ))}
                      </div>
                    </SortableContext>
                    <DragOverlay dropAnimation={null}>
                      {draggedSingleTrace ? (
                        <XrdSingleChartCardBody
                          trace={draggedSingleTrace}
                          index={draggedSingleTraceIndex > 0 ? draggedSingleTraceIndex - 1 : 0}
                          total={orderedSingleTraces.length}
                          wide={draggedSingleTraceWide}
                          selected
                          overlay
                          useOriginStyle={useOriginStyle}
                          buildChartTraces={buildChartTraces}
                          buildChartLayout={buildChartLayout}
                        />
                      ) : null}
                    </DragOverlay>
                  </DndContext>

                  <div className="analysis-section-card flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={handleMainExportCsv}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--accent-strong)] hover:opacity-90 px-4 py-1.8 text-xs font-semibold text-white transition-all pressable">
                        📥 匯出 CSV
                      </button>
                      <button type="button" onClick={handleMainExportTxt}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] hover:bg-[var(--card-ghost)] px-4 py-1.8 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all pressable">
                        📄 匯出 TXT (Tab)
                      </button>
                      <button type="button" onClick={handleExportOffsetReport}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] hover:bg-[var(--card-ghost)] px-4 py-1.8 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all pressable">
                        📋 匯出峰位偏移報告 (TXT)
                      </button>
                    </div>
                    <p className="text-[10px] text-[var(--text-soft)] italic">
                      * 單筆模式無 PNG（請使用美化卡輸出）；CSV/TXT 會先彈預覽
                    </p>
                  </div>
                </>
              )}

              {/* 📐 美化預覽圖卡（出報告用） */}
              {beautifyEnabled && processedTraces.length > 0 && (
                <div className={`analysis-section-card p-4 ${beautify.background === 'white' ? 'bg-white/95 border-slate-300' : ''}`}>
                  <ChartToolbar
                    title="📐 美化預覽（出報告用）"
                    actions={
                      <span className="rounded-full border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-1 text-[10px] font-semibold text-[var(--text-soft)]">
                        資料源：{viewMode === 'single' ? '單筆' : viewMode === 'offset' ? 'Offset 偏移疊圖' : '純疊圖'}
                      </span>
                    }
                  />

                  {/* 控件群組 */}
                  <div className="mb-3 space-y-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">

                    {/* 資料源選擇（決定美化卡要畫哪些 trace） */}
                    <div>
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-soft)] font-mono">資料源（與主圖獨立）</p>
                      <CustomSelect
                        label=""
                        value={beautifySourceMode}
                        onChange={v => setBeautifySourceMode(v)}
                        options={[
                          { value: 'auto', label: `跟隨主圖（${viewMode === 'single' ? '單筆' : viewMode === 'offset' ? 'Offset' : '純疊圖'}）` },
                          ...processedTraces.map(t => ({ value: t.id, label: `單筆：${t.name}` })),
                        ]}
                      />
                    </div>

                    {/* 群組 A：軸 */}
                    <div>
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-soft)] font-mono">A · 軸設定</p>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <label className="flex items-center gap-2 text-[11px] text-[var(--text-soft)]">
                          <input type="checkbox" checked={beautify.showXTickLabels} onChange={e => setBeautify(b => ({ ...b, showXTickLabels: e.target.checked }))} />
                          顯示 X 軸數字
                        </label>
                        <label className="flex items-center gap-2 text-[11px] text-[var(--text-soft)]">
                          <input type="checkbox" checked={beautify.showYTickLabels} onChange={e => setBeautify(b => ({ ...b, showYTickLabels: e.target.checked }))} />
                          顯示 Y 軸數字
                        </label>
                        <NumInput label="X tick 數量" value={beautify.xNTicks} onChange={v => setBeautify(b => ({ ...b, xNTicks: Math.max(2, Math.min(30, v)) }))} min={2} max={30} />
                        <NumInput label="Y tick 數量" value={beautify.yNTicks} onChange={v => setBeautify(b => ({ ...b, yNTicks: Math.max(2, Math.min(30, v)) }))} min={2} max={30} />
                        <TextInput label="X 軸標題" value={beautify.xAxisTitle} onChange={v => setBeautify(b => ({ ...b, xAxisTitle: v }))} />
                        <TextInput label="Y 軸標題" value={beautify.yAxisTitle} onChange={v => setBeautify(b => ({ ...b, yAxisTitle: v }))} />
                        <label className="flex items-center gap-2 text-[11px] text-[var(--text-soft)]">
                          <input type="checkbox" checked={beautify.showXGrid} onChange={e => setBeautify(b => ({ ...b, showXGrid: e.target.checked }))} />
                          X 網格
                        </label>
                        <label className="flex items-center gap-2 text-[11px] text-[var(--text-soft)]">
                          <input type="checkbox" checked={beautify.showYGrid} onChange={e => setBeautify(b => ({ ...b, showYGrid: e.target.checked }))} />
                          Y 網格
                        </label>
                      </div>
                    </div>

                    {/* 群組 B：字體（進階） */}
                    <Advanced title="B · 字體大小（進階）">
                      <div className="grid grid-cols-3 gap-2">
                        <NumInput label="軸刻度 (pt)" value={beautify.axisFontSize} onChange={v => setBeautify(b => ({ ...b, axisFontSize: Math.max(6, Math.min(28, v)) }))} min={6} max={28} />
                        <NumInput label="軸標題 (pt)" value={beautify.titleFontSize} onChange={v => setBeautify(b => ({ ...b, titleFontSize: Math.max(6, Math.min(36, v)) }))} min={6} max={36} />
                        <NumInput label="圖例 (pt)" value={beautify.legendFontSize} onChange={v => setBeautify(b => ({ ...b, legendFontSize: Math.max(6, Math.min(28, v)) }))} min={6} max={28} />
                      </div>
                    </Advanced>

                    {/* 群組 C：線條 / 背景 / 圖例（進階） */}
                    <Advanced title="C · 線條 / 背景 / 圖例（進階）">
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                        <div>
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">線寬倍率 ({beautify.lineWidthScale.toFixed(1)}×)</span>
                          <input type="range" min={0.5} max={3} step={0.1} value={beautify.lineWidthScale}
                            onChange={e => setBeautify(b => ({ ...b, lineWidthScale: parseFloat(e.target.value) }))}
                            className="w-full" />
                        </div>
                        <CustomSelect
                          label="背景色"
                          value={beautify.background}
                          onChange={v => setBeautify(b => ({ ...b, background: v as any }))}
                          options={[
                            { value: 'white', label: '白色（出報告）' },
                            { value: 'transparent', label: '透明' },
                            { value: 'dark', label: '深色' },
                          ]}
                        />
                        <CustomSelect
                          label="圖例位置"
                          value={beautify.legendPos}
                          onChange={v => setBeautify(b => ({ ...b, legendPos: v as any, showLegend: v !== 'hidden' }))}
                          options={[
                            { value: 'top-right', label: '右上' },
                            { value: 'top-left', label: '左上' },
                            { value: 'bottom-right', label: '右下' },
                            { value: 'bottom-left', label: '左下' },
                            { value: 'hidden', label: '隱藏' },
                          ]}
                        />
                      </div>
                    </Advanced>

                    {/* 群組 D：PNG 解析度（進階） */}
                    <Advanced title="D · PNG 解析度（進階；預設 1600×900 ×2 已適用大多場合）">
                      <div className="grid grid-cols-3 gap-2">
                        <NumInput label="寬 (px)" value={beautify.pngWidth} onChange={v => setBeautify(b => ({ ...b, pngWidth: Math.max(200, Math.min(8000, v)) }))} min={200} max={8000} step={50} />
                        <NumInput label="高 (px)" value={beautify.pngHeight} onChange={v => setBeautify(b => ({ ...b, pngHeight: Math.max(200, Math.min(8000, v)) }))} min={200} max={8000} step={50} />
                        <NumInput label="縮放倍率 (×DPI)" value={beautify.pngScale} onChange={v => setBeautify(b => ({ ...b, pngScale: Math.max(1, Math.min(6, v)) }))} min={1} max={6} />
                      </div>
                    </Advanced>
                  </div>

                  {/* 美化預覽 Plotly */}
                  <DeferredRender minHeight={540}>
                    <Plot
                      data={beautifyTraces}
                      layout={beautifyLayout}
                      config={{
                        responsive: true,
                        displaylogo: false,
                        modeBarButtonsToRemove: ['select2d', 'lasso2d'],
                      }}
                      onInitialized={(_fig, gd) => { beautifyGraphDivRef.current = gd as unknown as HTMLElement }}
                      onUpdate={(_fig, gd) => { beautifyGraphDivRef.current = gd as unknown as HTMLElement }}
                      className="w-full"
                    />
                  </DeferredRender>

                  {/* 匯出按鈕列 */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--card-divider)] pt-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={handleBeautifyExportPng}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--accent-strong)] hover:opacity-90 px-4 py-1.8 text-xs font-semibold text-white transition-all pressable">
                        📷 匯出 PNG（依美化外觀）
                      </button>
                      <button type="button" onClick={handleBeautifyExportCsv}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] hover:bg-[var(--card-ghost)] px-4 py-1.8 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all pressable">
                        📥 匯出 CSV（純數據）
                      </button>
                      <button type="button" onClick={handleBeautifyExportTxt}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] hover:bg-[var(--card-ghost)] px-4 py-1.8 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all pressable">
                        📄 匯出 TXT（Tab 分隔，Origin Pro）
                      </button>
                    </div>
                    <p className="text-[10px] text-[var(--text-soft)] italic">
                      * PNG 所見即所得；CSV/TXT 只含純數據，不含圖表外觀
                    </p>
                  </div>
                </div>
              )}

              {/* ── 🧮 衍生計算工具：3 張獨立卡片（依物理順序：d-spacing → FWHM → Scherrer） ── */}
              {calcDspacing.enabled && (
                <CalcCardShell
                  title="📐 d-spacing 計算 (Bragg)"
                  mod={calcDspacing}
                  setMod={setCalcDspacing as any}
                  processedTraces={processedTraces}
                  resolveSource={resolveCalcSource}
                  detectedPeaks={calcPeaksFromMod(calcDspacing)}
                  handleImport={files => handleCalcImport(files, setCalcDspacing)}
                  paramsRow={
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="波長 λ (Å)" value={calcDspacing.lambda} step={0.0001} onChange={v => setCalcDspacing(p => ({ ...p, lambda: v }))} />
                      <CalcQuickPreset onClick={() => setCalcDspacing(p => ({ ...p, lambda: 1.5406 }))} label="Cu Kα (1.5406 Å)" />
                    </div>
                  }
                  overlayShapes={[]}
                  resultBlock={dspacingResult ? (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 text-xs">
                      <ResultCell label="峰位 2θ" value={`${dspacingResult.peakX.toFixed(3)}°`} />
                      <ResultCell label="d (Å)" value={dspacingResult.d.toFixed(4)} accent />
                      <ResultCell label="d (nm)" value={(dspacingResult.d / 10).toFixed(5)} accent />
                    </div>
                  ) : <CalcEmptyHint />}
                  exportButtons={
                    <>
                      <button type="button" onClick={() => handleDspacingExport(',', 'csv')} disabled={!dspacingResult}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed px-4 py-1.8 text-xs font-semibold text-white transition-all pressable">
                        📥 匯出 CSV
                      </button>
                      <button type="button" onClick={() => handleDspacingExport('\t', 'txt')} disabled={!dspacingResult}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] hover:bg-[var(--card-ghost)] disabled:opacity-30 disabled:cursor-not-allowed px-4 py-1.8 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all pressable">
                        📄 匯出 TXT (Tab)
                      </button>
                    </>
                  }
                />
              )}

              {calcFwhm.enabled && (
                <CalcCardShell
                  title="📏 FWHM 計算"
                  mod={calcFwhm}
                  setMod={setCalcFwhm as any}
                  processedTraces={processedTraces}
                  resolveSource={resolveCalcSource}
                  detectedPeaks={calcPeaksFromMod(calcFwhm)}
                  handleImport={files => handleCalcImport(files, setCalcFwhm)}
                  paramsRow={null}
                  overlayShapes={fwhmResult ? [
                    { type: 'rect', xref: 'x', yref: 'paper', x0: fwhmResult.leftHalfX, x1: fwhmResult.rightHalfX, y0: 0, y1: 1, fillcolor: 'rgba(56,189,248,0.12)', line: { width: 0 } },
                    { type: 'line', xref: 'x', yref: 'y', x0: fwhmResult.leftHalfX, x1: fwhmResult.rightHalfX, y0: fwhmResult.baseline + fwhmResult.peakHeight / 2, y1: fwhmResult.baseline + fwhmResult.peakHeight / 2, line: { color: '#38bdf8', width: 1.5, dash: 'dash' } },
                  ] as any : []}
                  resultBlock={fwhmResult ? (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 text-xs">
                      <ResultCell label="峰位 2θ" value={`${fwhmResult.peakX.toFixed(3)}°`} />
                      <ResultCell label="峰高" value={fwhmResult.peakHeight.toFixed(3)} />
                      <ResultCell label="基線" value={fwhmResult.baseline.toFixed(3)} />
                      <ResultCell label="FWHM" value={`${fwhmResult.fwhm.toFixed(4)}°`} accent />
                    </div>
                  ) : <CalcEmptyHint />}
                  exportButtons={
                    <>
                      <button type="button" onClick={() => handleFwhmExport(',', 'csv')} disabled={!fwhmResult}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed px-4 py-1.8 text-xs font-semibold text-white transition-all pressable">
                        📥 匯出 CSV
                      </button>
                      <button type="button" onClick={() => handleFwhmExport('\t', 'txt')} disabled={!fwhmResult}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] hover:bg-[var(--card-ghost)] disabled:opacity-30 disabled:cursor-not-allowed px-4 py-1.8 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all pressable">
                        📄 匯出 TXT (Tab)
                      </button>
                    </>
                  }
                />
              )}

              {calcScherrer.enabled && (
                <CalcCardShell
                  title="💎 晶粒尺寸 D 計算 (Scherrer)"
                  mod={calcScherrer}
                  setMod={setCalcScherrer as any}
                  processedTraces={processedTraces}
                  resolveSource={resolveCalcSource}
                  detectedPeaks={calcPeaksFromMod(calcScherrer)}
                  handleImport={files => handleCalcImport(files, setCalcScherrer)}
                  paramsRow={
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      <NumInput label="形狀因子 K" value={calcScherrer.K} step={0.01} onChange={v => setCalcScherrer(p => ({ ...p, K: v }))} />
                      <NumInput label="波長 λ (Å)" value={calcScherrer.lambda} step={0.0001} onChange={v => setCalcScherrer(p => ({ ...p, lambda: v }))} />
                      <TextInput label="β 手動 override (°，空＝自動)" value={calcScherrer.fwhmOverride} onChange={v => setCalcScherrer(p => ({ ...p, fwhmOverride: v }))} placeholder="留空表示自動量測" />
                      <CalcQuickPreset onClick={() => setCalcScherrer(p => ({ ...p, lambda: 1.5406 }))} label="Cu Kα (1.5406 Å)" />
                    </div>
                  }
                  overlayShapes={scherrerResult?.measured && !scherrerResult.usedOverride ? [
                    { type: 'rect', xref: 'x', yref: 'paper', x0: scherrerResult.measured.leftHalfX, x1: scherrerResult.measured.rightHalfX, y0: 0, y1: 1, fillcolor: 'rgba(244,114,182,0.12)', line: { width: 0 } },
                  ] as any : []}
                  resultBlock={scherrerResult ? (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 text-xs">
                      <ResultCell label="峰位 2θ" value={`${scherrerResult.peakX.toFixed(3)}°`} />
                      <ResultCell label="β (FWHM)" value={`${scherrerResult.fwhmDeg.toFixed(4)}° ${scherrerResult.usedOverride ? '(手動)' : '(自動)'}`} />
                      <ResultCell label="D (Å)" value={scherrerResult.D.toFixed(2)} accent />
                      <ResultCell label="D (nm)" value={(scherrerResult.D / 10).toFixed(3)} accent />
                    </div>
                  ) : <CalcEmptyHint />}
                  exportButtons={
                    <>
                      <button type="button" onClick={() => handleScherrerExport(',', 'csv')} disabled={!scherrerResult}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed px-4 py-1.8 text-xs font-semibold text-white transition-all pressable">
                        📥 匯出 CSV
                      </button>
                      <button type="button" onClick={() => handleScherrerExport('\t', 'txt')} disabled={!scherrerResult}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] hover:bg-[var(--card-ghost)] disabled:opacity-30 disabled:cursor-not-allowed px-4 py-1.8 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all pressable">
                        📄 匯出 TXT (Tab)
                      </button>
                    </>
                  }
                />
              )}

              {/* 峰位偏移比對結果表格 (與 XPS 視覺對齊的玻璃卡片與資料表格) */}
              {rawFiles.length > 0 && Object.values(enabledRefCompounds).some(Boolean) && (
                <div className="analysis-section-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white">峰位偏移分析報告 (Peak Shift Analysis)</h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        自動尋峰門檻：{peakIntensityThreshold}%，比對容忍值：{peakOffsetTolerance}°。
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
                    {processedTraces.map(trace => {
                      const reps = peakOffsetReport[trace.id] || []
                      return (
                        <div key={trace.id} className="space-y-2 border-b border-slate-800/40 pb-3 last:border-b-0 last:pb-0">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trace.color }} />
                            <span className="text-xs font-semibold text-slate-200 truncate">{trace.name}</span>
                            <span className="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded-full">
                              基線估算：{trace.baseline.toFixed(2)}
                            </span>
                          </div>

                          {reps.length === 0 ? (
                            <div className="text-[11px] text-slate-500 italic bg-slate-900/10 px-3 py-2 rounded-lg border border-dashed border-slate-800/50">
                              在此尋峰與容忍度設定下，未找到可匹配已啟用參考峰的訊號。請提高尋峰靈敏度或勾選對應化合物。
                            </div>
                          ) : (
                            <div className="analysis-table-wrap">
                              <table className="analysis-data-table min-w-full text-left text-xs">
                                <thead>
                                  <tr className="border-b border-slate-800 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                    <th className="px-3 py-2">偵測峰位 (2θ)</th>
                                    <th className="px-3 py-2">偵測強度 (a.u.)</th>
                                    <th className="px-3 py-2">匹配化合物</th>
                                    <th className="px-3 py-2">標準晶面</th>
                                    <th className="px-3 py-2">標準峰位 (2θ)</th>
                                    <th className="px-3 py-2">偏移量 (Δ2θ)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {reps.map((r, rIdx) => (
                                    <tr key={rIdx} className="border-b border-slate-800/30 text-slate-300 hover:bg-slate-900/20 transition-all font-mono">
                                      <td className="px-3 py-2 font-bold text-slate-200">{r.observedPeak2Theta.toFixed(3)}°</td>
                                      <td className="px-3 py-2">{r.observedIntensity.toFixed(3)}</td>
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-1.5">
                                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PHASE_COLORS[r.phase] }} />
                                          <span>{r.phase}</span>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 font-bold text-[var(--accent)]">{r.hkl}</td>
                                      <td className="px-3 py-2">{r.refPeak2Theta.toFixed(3)}°</td>
                                      <td className={`px-3 py-2 font-bold ${r.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {r.delta >= 0 ? '+' : ''}
                                        {r.delta.toFixed(3)}°
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

            </div>
          )}
      {/* ── 統一匯出預覽 Modal：PNG 或 文字（CSV / TXT） ── */}
      {exportPreview && (() => {
        const isPng = exportPreview.kind === 'png'
        let textPreview = ''
        let totalLines = 0
        if (!isPng) {
          const allLines = (exportPreview as any).content.split('\n')
          totalLines = allLines.length
          const headerAndData = allLines.slice(0, 18)
          if (allLines.length > 18) headerAndData.push(`... (共 ${totalLines - 1} 行數據)`)
          textPreview = headerAndData.join('\n')
        }
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-[3px]"
            onClick={() => setExportPreview(null)}>
            <div className="glass-panel flex max-h-[min(92vh,calc(100vh-3rem))] w-full max-w-3xl flex-col overflow-hidden rounded-[30px]"
              onClick={e => e.stopPropagation()}>
              <div className="flex shrink-0 items-center justify-between border-b border-[var(--card-divider)] px-5 py-4">
                <div>
                  <p className="text-base font-semibold text-[var(--text-main)]">匯出預覽 — {exportPreview.filename}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-soft)]">
                    {isPng
                      ? `${(exportPreview as any).width} × ${(exportPreview as any).height} px PNG，確認後下載`
                      : `共 ${totalLines - 1} 行數據，確認後下載 ${exportPreview.ext.toUpperCase()}`}
                  </p>
                </div>
                <button type="button" onClick={() => setExportPreview(null)}
                  className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-sm text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)] pressable">
                  關閉
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {isPng ? (
                  <div className="rounded-2xl border border-[var(--card-border)] overflow-hidden bg-white p-2">
                    <img src={(exportPreview as any).dataUrl} alt="export preview"
                      className="w-full h-auto object-contain" style={{ maxHeight: '60vh' }} />
                  </div>
                ) : (
                  <pre className="overflow-x-auto rounded-xl bg-[var(--card-ghost)] p-3 text-[10.5px] leading-5 text-[var(--text-soft)] font-mono">{textPreview}</pre>
                )}
              </div>

              <div className="flex shrink-0 justify-end gap-3 border-t border-[var(--card-divider)] px-5 py-4">
                <button type="button" onClick={() => setExportPreview(null)}
                  className="rounded-full border border-[var(--card-border)] px-4 py-1.5 text-sm text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)] pressable">
                  取消
                </button>
                <button type="button" onClick={confirmExportDownload}
                  className="rounded-full bg-[var(--accent-strong)] px-5 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 pressable">
                  ⬇ 確定下載
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── XRD 標準化合物與參考峰細緻選擇 Modal (雙欄學術大廠風格) ── */}
      {showRefMarkersModal && (() => {
        const activePeaks = REFERENCE_DB[activeCompName] || []
        const activeColor = PHASE_COLORS[activeCompName] || '#38bdf8'

        // 若是最小化折疊狀態，渲染一個極其精緻的懸浮控制膠囊
        if (isRefMarkersMinimized) {
          return (
            <div
              onMouseDown={handleMinimizedCapsuleMouseDown}
              className="fixed bottom-24 right-6 z-50 pointer-events-auto cursor-grab active:cursor-grabbing select-none"
              style={{
                transform: `translate(${minimizedCapsulePos.x}px, ${minimizedCapsulePos.y}px)`,
                transition: 'transform 0.05s linear',
              }}
            >
              <div
                className="glass-panel flex items-center gap-3.5 px-4.5 py-3 rounded-2xl border border-[var(--accent)] shadow-[0_4px_25px_rgba(56,189,248,0.2)] bg-slate-900/90 backdrop-blur-md transition-all duration-300 hover:scale-[1.02]"
              >
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-xs font-bold text-white font-mono">🔬 標準物相標記 (已折疊)</span>
                </div>

                <div className="h-4 w-[1px] bg-slate-800" />

                <div className="flex items-center gap-1.5">
                  {Object.keys(enabledRefCompounds).filter(k => enabledRefCompounds[k]).length === 0 ? (
                    <span className="text-[10px] text-slate-500 italic">無啟用相位</span>
                  ) : (
                    <div className="flex gap-1">
                      {Object.keys(enabledRefCompounds).filter(k => enabledRefCompounds[k]).map(name => (
                        <span key={name} className="px-1.5 py-0.5 rounded text-[9px] font-bold text-white font-mono shrink-0" style={{ backgroundColor: PHASE_COLORS[name] || '#38bdf8' }}>
                          {name.split(' ')[0]}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setIsRefMarkersMinimized(false)}
                  className="rounded-lg border border-[var(--card-border)] bg-slate-950/40 px-2.5 py-1 text-[10.5px] font-bold text-[var(--accent)] transition-all hover:bg-[var(--accent)] hover:text-white pressable"
                >
                  展開還原 ⚡
                </button>
              </div>
            </div>
          )
        }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/[0.03] pointer-events-auto px-4 py-6">
            <div className="glass-panel flex max-h-[min(95vh,calc(100vh-2rem))] max-w-[95vw] flex-col overflow-hidden rounded-[30px] relative pointer-events-auto shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
              onClick={e => e.stopPropagation()}
              style={{
                width: `${refMarkersModalSize.width}px`,
                height: `${refMarkersModalSize.height}px`,
                transform: `translate(${refMarkersModalPos.x}px, ${refMarkersModalPos.y}px)`,
                transition: 'transform 0.05s linear',
              }}
            >

              {/* Modal Header (可滑動拖曳) */}
              <div
                onMouseDown={handleRefMarkersHeaderMouseDown}
                className="flex shrink-0 items-center justify-between border-b border-[var(--card-divider)] px-6 py-4 bg-slate-900/40 cursor-grab active:cursor-grabbing select-none"
              >
                <div>
                  <p className="text-base font-semibold text-[var(--text-main)] font-mono">🔬 標準繞射峰 (Markers) 細緻客製化</p>
                  <p className="mt-0.5 text-xs text-[var(--text-soft)]">
                    已支援「晶面級別」單獨勾選！依論文發表需求，自由顯示或隱藏特定結晶面點虛線。（按住標頭可拖曳移動）
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsRefMarkersMinimized(true)}
                    className="rounded-full border border-[var(--card-border)] bg-slate-900/60 px-3 py-1.5 text-xs text-[var(--text-soft)] transition-colors hover:text-white hover:border-slate-700 hover:bg-slate-800 pressable"
                    title="將視窗折疊為右下角懸浮小條，以便對照圖表"
                  >
                    折疊 ➖
                  </button>
                  <button type="button" onClick={() => setShowRefMarkersModal(false)}
                    className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-sm text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)] pressable">
                    關閉
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="min-h-0 flex-1 grid grid-cols-1 md:grid-cols-3">

                {/* 左側欄：標準化合物大類 (佔 1/3) */}
                <div className="col-span-1 border-r border-[var(--card-divider)] bg-slate-950/20 p-5 overflow-y-auto space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--text-soft)] uppercase tracking-wider">標準化合物</span>
                    <span className="text-[10px] text-slate-500 font-mono">共 {Object.keys(REFERENCE_DB).length} 個相位</span>
                  </div>

                  <div className="space-y-2.5">
                    {Object.keys(REFERENCE_DB).map(compName => {
                      const color = PHASE_COLORS[compName] || '#38bdf8'
                      const peaks = REFERENCE_DB[compName] || []
                      const isCompChecked = enabledRefCompounds[compName] || false
                      const isActive = activeCompName === compName

                      // 計算該化合物有多少個晶面已被啟用
                      const enabledPeaksCount = peaks.filter(p => {
                        const peakKey = `${compName}_${p.hkl}`
                        return enabledRefPeaks[peakKey] ?? isCompChecked
                      }).length

                      return (
                        <div
                          key={compName}
                          onClick={() => setActiveCompName(compName)}
                          className={`group relative rounded-2xl border p-4 cursor-pointer transition-all duration-200 hover:scale-[1.01] ${
                            isActive
                              ? 'bg-[var(--card-ghost)]'
                              : 'border-[var(--card-border)] bg-[var(--card-ghost)] hover:border-slate-700'
                          }`}
                          style={isActive ? { borderColor: color, boxShadow: `0 4px 20px ${color}20` } : undefined}
                        >
                          <div className="flex items-center justify-between mb-3">
                            {/* 化合物名稱與代表色標籤 */}
                            <div className="flex items-center gap-2 flex-1 min-w-0 pr-2">
                              <span className="w-1.5 h-4 rounded-full shrink-0 transition-transform group-hover:scale-y-110" style={{ backgroundColor: color }} />
                              <span className="text-sm font-semibold text-white font-mono tracking-wide truncate">{compName}</span>
                            </div>

                            {/* 微型科研發光 Toggle Switch */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation() // 阻止冒泡，避免點擊開關時切換 Active 分頁
                                const nextChecked = !isCompChecked
                                setEnabledRefCompounds({
                                  ...enabledRefCompounds,
                                  [compName]: nextChecked,
                                })
                                // 同步自動啟用或禁用所有晶面
                                const updatedPeaks = { ...enabledRefPeaks }
                                peaks.forEach(p => {
                                  updatedPeaks[`${compName}_${p.hkl}`] = nextChecked
                                })
                                setEnabledRefPeaks(updatedPeaks)
                              }}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-slate-700/50 p-0.5 transition-colors duration-300 ease-in-out focus:outline-none ${
                                isCompChecked ? '' : 'bg-slate-900/80 hover:bg-slate-800'
                              }`}
                              style={{ backgroundColor: isCompChecked ? color : undefined }}
                            >
                              <span
                                className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.4)] transition duration-300 ease-in-out ${
                                  isCompChecked ? 'translate-x-3.5' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pl-3.5 pr-0.5">
                            <span>顯示標記：{isCompChecked ? '已開啟' : '已關閉'}</span>
                            <span className={`px-2 py-0.5 rounded-full transition-colors duration-200 ${
                              enabledPeaksCount > 0 && isCompChecked ? 'bg-emerald-500/10 text-emerald-400 font-bold' : 'bg-slate-900/30'
                            }`}>
                              晶面 {isCompChecked ? `${enabledPeaksCount}/${peaks.length}` : `0/${peaks.length}`}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 右側欄：特定晶面細緻客製化 (佔 2/3) */}
                <div className="col-span-2 p-5 flex flex-col min-h-0 bg-slate-900/10">

                  {/* 右側標頭 */}
                  <div className="flex shrink-0 items-center justify-between border-b border-[var(--card-divider)] pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeColor }} />
                      <h4 className="text-sm font-bold text-white font-mono">{activeCompName} 晶面列表</h4>
                    </div>

                    <div className="flex gap-3 text-[10.5px]">
                      <button
                        type="button"
                        onClick={() => {
                          const updated = { ...enabledRefPeaks }
                          activePeaks.forEach(p => {
                            updated[`${activeCompName}_${p.hkl}`] = true
                          })
                          setEnabledRefPeaks(updated)
                          // 同步自動開啟該化合物
                          setEnabledRefCompounds({ ...enabledRefCompounds, [activeCompName]: true })
                        }}
                        className="text-[var(--accent)] hover:underline font-medium"
                      >
                        一鍵全選晶面
                      </button>
                      <span className="text-slate-800">|</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = { ...enabledRefPeaks }
                          activePeaks.forEach(p => {
                            updated[`${activeCompName}_${p.hkl}`] = false
                          })
                          setEnabledRefPeaks(updated)
                        }}
                        className="text-[var(--text-soft)] hover:underline font-medium"
                      >
                        全部清除
                      </button>
                    </div>
                  </div>

                  {/* 晶面列表滾動區域 */}
                  <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-2">
                    {activePeaks.length === 0 ? (
                      <p className="text-xs text-[var(--text-soft)] italic">無可用晶面數據</p>
                    ) : (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        {activePeaks.map((peak, idx) => {
                          const peakKey = `${activeCompName}_${peak.hkl}`
                          const isCompEnabled = enabledRefCompounds[activeCompName] || false
                          // 如果化合物勾選了，預設為 true。否則由 enabledRefPeaks 決定
                          const isPeakEnabled = enabledRefPeaks[peakKey] ?? isCompEnabled

                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                const nextState = !isPeakEnabled
                                setEnabledRefPeaks({
                                  ...enabledRefPeaks,
                                  [peakKey]: nextState,
                                })
                                // 自動化人性化設計：如果勾選了某個晶面，自動開啟對應的化合物
                                if (nextState && !isCompEnabled) {
                                  setEnabledRefCompounds({
                                    ...enabledRefCompounds,
                                    [activeCompName]: true,
                                  })
                                }
                              }}
                              className={`flex items-center justify-between rounded-xl border p-3.5 cursor-pointer transition-all duration-150 select-none hover:scale-[1.015] ${
                                isPeakEnabled && isCompEnabled
                                  ? 'border-[var(--accent-strong)]/30 bg-[var(--accent-strong)]/5 shadow-[0_2px_12px_rgba(56,189,248,0.06)]'
                                  : 'border-slate-800/40 bg-slate-900/10 opacity-60 hover:opacity-100 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                                {/* 磨砂發光小複選徽章 */}
                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
                                  isPeakEnabled && isCompEnabled
                                    ? 'border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--accent)]'
                                    : 'border-slate-600 bg-transparent text-transparent'
                                }`}>
                                  <span className="text-[10px] leading-none">✓</span>
                                </div>

                                <div className="space-y-0.5 min-w-0 flex-1">
                                  <p className="text-xs font-bold text-white font-mono truncate">
                                    面指數：<span className="text-[var(--accent)] font-extrabold font-serif">({peak.hkl})</span>
                                  </p>
                                  <p className="text-[10px] text-slate-500 font-mono truncate">
                                    角度：{peak.twoTheta.toFixed(3)}°
                                  </p>
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <span className="text-[10px] font-mono text-slate-400 px-2 py-0.5 rounded-full bg-slate-900/40">
                                  強度 {Math.round(peak.intensity * 100)}%
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* 右側底端說明 */}
                  {!enabledRefCompounds[activeCompName] && (
                    <div className="mt-4 shrink-0 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] text-amber-300 font-medium">
                      ⚠️ 提示：您已選中或修改該化合物的特定晶面，但「{activeCompName}」大類總開關目前尚未啟用。請在左側勾選該化合物以在 Plotly 圖譜中顯示這些虛線。
                    </div>
                  )}
                </div>

              </div>

              {/* Modal Footer */}
              <div className="flex shrink-0 justify-end border-t border-[var(--card-divider)] px-6 py-4 bg-slate-950/20 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    // 一鍵重設：所有晶面皆跟隨化合物預設值
                    setEnabledRefPeaks({})
                  }}
                  className="rounded-full border border-[var(--card-border)] px-4 py-1.8 text-xs font-semibold text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)] pressable"
                >
                  重設為預設晶面
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsAppliedSuccess(true)
                    setTimeout(() => setIsAppliedSuccess(false), 1200)
                  }}
                  className={`rounded-full px-6 py-1.8 text-xs font-semibold text-white transition-all duration-300 pressable shadow-md ${
                    isAppliedSuccess
                      ? 'bg-emerald-500 hover:bg-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                      : 'bg-[var(--accent-strong)] hover:opacity-90'
                  }`}
                >
                  {isAppliedSuccess
                    ? '✨ 已實時套用 ✓'
                    : `套用設定 (${Object.values(enabledRefCompounds).filter(Boolean).length} 相位已選)`
                  }
                </button>
              </div>

              {/* 右下角拖曳調整大小 Handle */}
              <div
                onMouseDown={handleRefMarkersResizeMouseDown}
                className="absolute right-0 bottom-0 w-6 h-6 cursor-se-resize flex items-end justify-end p-1.5 z-50 select-none group"
                title="拖曳右下角可調整視窗大小"
              >
                <svg className="w-3.5 h-3.5 text-slate-600 transition-colors group-hover:text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="6" y1="21" x2="21" y2="6" />
                  <line x1="12" y1="21" x2="21" y2="12" />
                  <line x1="18" y1="21" x2="21" y2="18" />
                </svg>
              </div>

            </div>
          </div>
        )
      })()}
        </div>
      </main>

      <SampleBasketsPanel
        open={basketsPanelOpen}
        onClose={() => setBasketsPanelOpen(false)}
        items={basketItems}
        baskets={baskets}
        onChangeItems={setBasketItems}
        onChangeBaskets={setBaskets}
        onApplyBasket={handleApplyBasket}
        moduleLabel="XRD"
        acceptFileExts={['.txt', '.csv', '.xy', '.dat', '.xlsx', '.xls']}
      />

      {!basketsPanelOpen && (
        <SampleBasketsButton
          open={basketsPanelOpen}
          onToggle={() => setBasketsPanelOpen(true)}
          basketCount={baskets.length}
          unassignedCount={basketItems.filter(i => i.basketId === null).length}
        />
      )}
    </div>
  )
}
