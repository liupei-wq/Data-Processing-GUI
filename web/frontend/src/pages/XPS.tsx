import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Plot from '../components/PlotlyChart'
import type { AnalysisModuleId } from '../components/AnalysisModuleNav'
import { ANALYSIS_MODULES } from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import { EmptyWorkspaceState, InfoCardGrid, MODULE_CONTENT, ModuleTopBar, StickySidebarHeader } from '../components/WorkspaceUi'
import { withPlotFullscreen } from '../components/plotConfig'
import type { PlotPopupRequest } from '../hooks/usePlotPopups'
import { calibrateEnergy, downloadXpsFitReport, fetchPeriodicTable, parseFiles, processData, fitPeaks, computeVbm, lookupRsf, fetchElementPeaks, listElements } from '../api/xps'
import type {
  CalibrationResult,
  DatasetInput,
  ElementDbPeak,
  ElementListItem,
  FitResult,
  InitPeak,
  ParsedFile,
  PeriodicTableItem,
  ProcessParams,
  ProcessResult,
  ProcessedDataset,
  VbmLineFit,
  VbmResult,
  RsfRequestItem,
  RsfResultRow,
} from '../types/xps'
import { formatUtc8Iso } from '../utils/time'

const SIDEBAR_MIN_WIDTH = 300
const SIDEBAR_MAX_WIDTH = 540
const SIDEBAR_DEFAULT_WIDTH = 360
const SIDEBAR_COLLAPSED_PEEK = 28
const INTERP_POINTS_MIN = 50
const INTERP_POINTS_MAX = 5000
const INTERP_POINTS_DEFAULT = 1000
const PEAK_CENTER_DB_TOLERANCE_EV = 0.45
const PEAK_CENTER_MANUAL_TOLERANCE_EV = 1.2
const PEAK_MIN_GAP_EV = 0.12
const PEAK_FWHM_MIN_ABS = 0.12
const PEAK_FWHM_MAX_MULTIPLIER = 2.2
const PEAK_FWHM_MIN_RATIO = 0.55
const PEAK_AMPLITUDE_MAX_MULTIPLIER = 4.0
type XpsMode = 'core_level' | 'valence_band' | 'dft'
const XPS_MODE_LABELS: Record<XpsMode, string> = {
  core_level: 'Core Level',
  valence_band: 'Valence Band',
  dft: 'DFT',
}
const XPS_DFT_PASSWORD = '931130'
const DFT_STREAMLIT_URL = import.meta.env.VITE_DFT_STREAMLIT_URL ?? 'http://127.0.0.1:8505/?embed=true'

const LINE_COLOR_OPTIONS = [
  { value: 'blue', label: 'Blue' },
  { value: 'teal', label: 'Teal' },
  { value: 'orange', label: 'Orange' },
  { value: 'rose', label: 'Rose' },
  { value: 'violet', label: 'Violet' },
]

const LINE_COLOR_PALETTES: Record<string, { primary: string; secondary: string; tertiary: string; accent: string; series: string[] }> = {
  blue: {
    primary: '#38bdf8',
    secondary: '#94a3b8',
    tertiary: '#f59e0b',
    accent: '#14b8a6',
    series: ['#38bdf8', '#94a3b8', '#60a5fa', '#818cf8', '#22d3ee', '#f59e0b', '#fb7185', '#f472b6'],
  },
  teal: {
    primary: '#14b8a6',
    secondary: '#9ca3af',
    tertiary: '#f97316',
    accent: '#2dd4bf',
    series: ['#14b8a6', '#2dd4bf', '#5eead4', '#60a5fa', '#f59e0b', '#a78bfa', '#fb7185', '#84cc16'],
  },
  orange: {
    primary: '#f97316',
    secondary: '#94a3b8',
    tertiary: '#facc15',
    accent: '#fb923c',
    series: ['#f97316', '#fb923c', '#facc15', '#38bdf8', '#818cf8', '#fb7185', '#2dd4bf', '#a3e635'],
  },
  rose: {
    primary: '#fb7185',
    secondary: '#94a3b8',
    tertiary: '#f59e0b',
    accent: '#f472b6',
    series: ['#fb7185', '#f472b6', '#f9a8d4', '#38bdf8', '#f59e0b', '#2dd4bf', '#a78bfa', '#84cc16'],
  },
  violet: {
    primary: '#a78bfa',
    secondary: '#94a3b8',
    tertiary: '#f59e0b',
    accent: '#c084fc',
    series: ['#a78bfa', '#c084fc', '#818cf8', '#38bdf8', '#2dd4bf', '#f59e0b', '#fb7185', '#a3e635'],
  },
}

const DEFAULT_PARAMS: ProcessParams = {
  interpolate: false,
  n_points: 1000,
  average: false,
  energy_shift: 0,
  bg_enabled: false,
  bg_method: 'shirley',
  bg_x_start: null,
  bg_x_end: null,
  bg_poly_deg: 3,
  bg_baseline_lambda: 1e5,
  bg_baseline_p: 0.01,
  bg_baseline_iter: 20,
  bg_tougaard_B: 2866,
  bg_tougaard_C: 1643,
  valid_range_enabled: false,
  valid_x_start: null,
  valid_x_end: null,
  smooth_method: 'none',
  smooth_window: 5,
  smooth_poly: 3,
  norm_method: 'none',
  norm_x_start: null,
  norm_x_end: null,
}

// ── chart helpers ─────────────────────────────────────────────────────────────

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function fitVbmLine(x: number[], y: number[], start: number, end: number, mode: 'tangent' | 'baseline'): VbmLineFit | null {
  if (x.length !== y.length) return null
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const points = x
    .map((xi, index) => ({ x: xi, y: y[index] }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
  if (points.length < 2) return null

  const nearestPoint = (targetX: number) => {
    let bestIndex = 0
    let bestDistance = Infinity
    for (let i = 0; i < points.length; i += 1) {
      const distance = Math.abs(points[i].x - targetX)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }
    return { index: bestIndex, point: points[bestIndex] }
  }

  const anchorStart = nearestPoint(lo)
  const anchorEnd = nearestPoint(hi)
  const spanPoints = Math.max(Math.abs(anchorEnd.index - anchorStart.index) + 1, 5)
  const windowPointCount = Math.max(3, Math.min(points.length, Math.round(spanPoints * 0.2)))
  const buildWindow = (anchorIndex: number) => {
    const startIndex = Math.max(0, Math.min(points.length - windowPointCount, anchorIndex - Math.floor(windowPointCount / 2)))
    return points.slice(startIndex, startIndex + windowPointCount)
  }

  const startWindow = buildWindow(anchorStart.index)
  const endWindow = buildWindow(anchorEnd.index)

  let bestPair: { startPoint: VbmLineFit['start_point']; endPoint: VbmLineFit['end_point']; slope: number; span: number; meanY: number } | null = null
  let candidatePairCount = 0
  for (const startPoint of startWindow) {
    for (const endPoint of endWindow) {
      const dx = endPoint.x - startPoint.x
      if (dx <= 1e-10) continue
      const slope = (endPoint.y - startPoint.y) / dx
      const span = Math.abs(dx)
      const meanY = (startPoint.y + endPoint.y) / 2
      candidatePairCount += 1
      if (!bestPair) {
        bestPair = { startPoint, endPoint, slope, span, meanY }
        continue
      }

      if (mode === 'tangent') {
        if (slope > bestPair.slope + 1e-10 || (Math.abs(slope - bestPair.slope) <= 1e-10 && span > bestPair.span)) {
          bestPair = { startPoint, endPoint, slope, span, meanY }
        }
      } else {
        const absSlope = Math.abs(slope)
        const bestAbsSlope = Math.abs(bestPair.slope)
        if (
          absSlope < bestAbsSlope - 1e-10
          || (Math.abs(absSlope - bestAbsSlope) <= 1e-10 && meanY < bestPair.meanY - 1e-10)
          || (Math.abs(absSlope - bestAbsSlope) <= 1e-10 && Math.abs(meanY - bestPair.meanY) <= 1e-10 && span > bestPair.span)
        ) {
          bestPair = { startPoint, endPoint, slope, span, meanY }
        }
      }
    }
  }

  if (!bestPair) return null
  const intercept = bestPair.startPoint.y - bestPair.slope * bestPair.startPoint.x
  return {
    slope: bestPair.slope,
    intercept,
    point_count: startWindow.length + endWindow.length,
    start_window_point_count: startWindow.length,
    end_window_point_count: endWindow.length,
    candidate_pair_count: candidatePairCount,
    anchor_start_point: anchorStart.point,
    anchor_end_point: anchorEnd.point,
    start_point: bestPair.startPoint,
    end_point: bestPair.endPoint,
  }
}

function intersectVbmLines(edgeLine: VbmLineFit | null, baselineLine: VbmLineFit | null) {
  if (!edgeLine || !baselineLine) return null
  const slopeDelta = edgeLine.slope - baselineLine.slope
  if (Math.abs(slopeDelta) < 1e-10) return null
  const x = (baselineLine.intercept - edgeLine.intercept) / slopeDelta
  if (!Number.isFinite(x)) return null
  const y = edgeLine.slope * x + edgeLine.intercept
  if (!Number.isFinite(y)) return null
  return { x, y }
}

function buildVbmStablePlotWindow(x: number[], y: number[]) {
  const points = x
    .map((xi, index) => ({ x: xi, y: y[index] }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
  if (points.length === 0) return null

  const datasetMinX = points[0].x
  const datasetMaxX = points[points.length - 1].x
  const spectrumY = points.map(point => point.y)
  const minY = Math.min(...spectrumY)
  const maxY = Math.max(...spectrumY)
  const ySpan = Math.max(maxY - minY, 1e-3)
  const yPadding = Math.max(ySpan * 0.08, Math.max(Math.abs(minY), Math.abs(maxY), 1) * 0.03)

  return {
    lineX: [datasetMinX, datasetMaxX] as [number, number],
    xAxisRange: [datasetMaxX, datasetMinX] as [number, number],
    yAxisRange: [minY - yPadding, maxY + yPadding] as [number, number],
  }
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function getFileStats(file: ParsedFile) {
  const xs = file.x
  if (!xs || xs.length < 2) return null
  const xStart = xs[0]
  const xEnd = xs[xs.length - 1]
  const span = Math.abs(xEnd - xStart)
  const nPts = xs.length
  const step = span / (nPts - 1)
  return { xStart, xEnd, span, nPts, step }
}

function estimateInterpolationPoints(files: ParsedFile[]) {
  if (files.length === 0) return INTERP_POINTS_DEFAULT
  const estimated = files.map(file => {
    if (!file.x || file.x.length < 2) return file.n_points || INTERP_POINTS_DEFAULT
    const xs = [...file.x].filter(Number.isFinite).sort((a, b) => a - b)
    if (xs.length < 2) return file.n_points || INTERP_POINTS_DEFAULT
    const diffs: number[] = []
    for (let i = 1; i < xs.length; i += 1) {
      const diff = xs[i] - xs[i - 1]
      if (Number.isFinite(diff) && diff > 0) diffs.push(diff)
    }
    const step = median(diffs)
    const span = xs[xs.length - 1] - xs[0]
    if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(span) || span <= 0) {
      return file.n_points || INTERP_POINTS_DEFAULT
    }
    return Math.round(span / step) + 1
  })
  const raw = median(estimated)
  // Round to nearest 10 for small counts, nearest 50 for large
  const roundTo = raw < 300 ? 10 : 50
  const target = Math.round(raw / roundTo) * roundTo
  return clamp(target || INTERP_POINTS_DEFAULT, INTERP_POINTS_MIN, INTERP_POINTS_MAX)
}

const DEFAULT_SERIES_PALETTE_KEYS = ['blue', 'orange', 'rose', 'teal', 'violet']

function buildRawFileTraces(files: ParsedFile[], activeIndex: number, fileColorKeys: string[]): Plotly.Data[] {
  return files.map((file, index) => {
    const paletteKey = fileColorKeys[index] ?? DEFAULT_SERIES_PALETTE_KEYS[index % DEFAULT_SERIES_PALETTE_KEYS.length]
    const palette = LINE_COLOR_PALETTES[paletteKey] ?? LINE_COLOR_PALETTES.blue
    const isActive = index === activeIndex
    return {
      x: file.x,
      y: file.y,
      type: 'scatter',
      mode: 'lines',
      name: file.name,
      line: {
        color: palette.primary,
        width: isActive ? 2.0 : 1.2,
      },
      opacity: isActive ? 1.0 : 0.65,
    }
  })
}

function buildPipelineOverlayTraces(
  inputDataset: { x: number[]; y: number[]; name: string },
  outputDataset: { x: number[]; y: number[]; name: string },
  outputLabel: string,
  paletteKey: string,
  outputYAxis: 'y' | 'y2' = 'y',
): Plotly.Data[] {
  const palette = LINE_COLOR_PALETTES[paletteKey] ?? LINE_COLOR_PALETTES.blue
  return [
    {
      x: inputDataset.x,
      y: inputDataset.y,
      type: 'scatter',
      mode: 'lines',
      name: inputDataset.name,
      line: { color: palette.secondary, width: 1.4 },
      opacity: 0.8,
    },
    {
      x: outputDataset.x,
      y: outputDataset.y,
      type: 'scatter',
      mode: 'lines',
      name: outputLabel,
      line: { color: palette.primary, width: 2.1 },
      yaxis: outputYAxis,
    },
  ]
}

function buildRegionShapes(start: number | null | undefined, end: number | null | undefined, color: string) {
  if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end) || start === end) return []
  const x0 = Math.min(start, end)
  const x1 = Math.max(start, end)
  return [
    {
      type: 'rect' as const,
      xref: 'x' as const,
      yref: 'paper' as const,
      x0,
      x1,
      y0: 0,
      y1: 1,
      fillcolor: color,
      opacity: 0.28,
      line: { width: 0 },
      layer: 'below' as const,
    },
    {
      type: 'line' as const,
      xref: 'x' as const,
      yref: 'paper' as const,
      x0,
      x1: x0,
      y0: 0,
      y1: 1,
      line: { color, width: 1.6, dash: 'dot' },
    },
    {
      type: 'line' as const,
      xref: 'x' as const,
      yref: 'paper' as const,
      x0: x1,
      x1,
      y0: 0,
      y1: 1,
      line: { color, width: 1.6, dash: 'dot' },
    },
  ]
}

function buildRegionAnnotations(start: number | null | undefined, end: number | null | undefined, label: string, color: string) {
  if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end) || start === end) return []
  return [{
    x: (start + end) / 2,
    y: 1.03,
    xref: 'x' as const,
    yref: 'paper' as const,
    text: label,
    showarrow: false,
    font: { size: 11, color },
  }]
}

function findSpectrumExtrema(
  x: number[],
  y: number[],
  range?: { start: number; end: number },
) {
  if (x.length === 0 || y.length === 0 || x.length !== y.length) return null
  const low = range ? Math.min(range.start, range.end) : Number.NEGATIVE_INFINITY
  const high = range ? Math.max(range.start, range.end) : Number.POSITIVE_INFINITY
  const candidates: Array<{ x: number; y: number }> = []
  for (let i = 0; i < x.length; i += 1) {
    const xi = x[i]
    const yi = y[i]
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue
    if (xi < low || xi > high) continue
    candidates.push({ x: xi, y: yi })
  }
  if (candidates.length === 0) return null
  let maxPoint = candidates[0]
  let minPoint = candidates[0]
  for (const point of candidates) {
    if (point.y > maxPoint.y) maxPoint = point
    if (point.y < minPoint.y) minPoint = point
  }
  return { maxPoint, minPoint }
}

function chartLayout(xReversed = true, yAxisTitle = 'Intensity (a.u.)', secondaryYAxisTitle?: string): Partial<Plotly.Layout> {
  const grid = cssVar('--chart-grid', 'rgba(148,163,184,0.14)')
  const text = cssVar('--chart-text', '#d9e4f0')
  const bg = cssVar('--chart-bg', 'rgba(15,23,42,0.52)')
  const legendBg = cssVar('--chart-legend-bg', 'rgba(15,23,42,0.72)')
  const hoverBg = cssVar('--chart-hover-bg', 'rgba(15,23,42,0.95)')
  const hoverBorder = cssVar('--chart-hover-border', 'rgba(148,163,184,0.22)')
  const layout: Partial<Plotly.Layout> = {
    xaxis: {
      title: { text: 'Binding Energy (eV)' },
      autorange: xReversed ? 'reversed' : true,
      showgrid: true, gridcolor: grid, zeroline: false, color: text,
    },
    yaxis: { title: { text: yAxisTitle }, showgrid: true, gridcolor: grid, zeroline: false, color: text },
    legend: { x: 1, xanchor: 'right', y: 1, bgcolor: legendBg, bordercolor: hoverBorder, borderwidth: 1, font: { color: text } },
    margin: { l: 60, r: secondaryYAxisTitle ? 72 : 20, t: 28, b: 58 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: bg,
    font: { color: text },
    hovermode: 'x unified',
    hoverlabel: { bgcolor: hoverBg, bordercolor: hoverBorder, font: { color: text } },
    autosize: true,
  }
  if (secondaryYAxisTitle) {
    layout.yaxis2 = {
      title: { text: secondaryYAxisTitle },
      overlaying: 'y',
      side: 'right',
      showgrid: false,
      zeroline: false,
      color: text,
    }
  }
  return layout
}

function buildMainTraces(dataset: ProcessedDataset, showRaw: boolean, showBg: boolean, paletteKey: string, processedYAxis: 'y' | 'y2' = 'y'): Plotly.Data[] {
  const palette = LINE_COLOR_PALETTES[paletteKey] ?? LINE_COLOR_PALETTES.blue
  const traces: Plotly.Data[] = []
  if (showRaw) {
    traces.push({ x: dataset.x, y: dataset.y_raw, type: 'scatter', mode: 'lines', name: '原始', line: { color: palette.secondary, width: 1.4 } })
  }
  if (showBg && dataset.y_background) {
    traces.push({ x: dataset.x, y: dataset.y_background, type: 'scatter', mode: 'lines', name: '背景', line: { color: palette.tertiary, width: 1.3, dash: 'dot' } })
  }
  traces.push({ x: dataset.x, y: dataset.y_processed, type: 'scatter', mode: 'lines', name: '處理後', line: { color: palette.primary, width: 2.0 }, yaxis: processedYAxis })
  return traces
}

function buildFitTraces(dataset: ProcessedDataset, fitResult: FitResult, paletteKey: string): Plotly.Data[] {
  const palette = LINE_COLOR_PALETTES[paletteKey] ?? LINE_COLOR_PALETTES.blue
  const traces: Plotly.Data[] = [
    { x: dataset.x, y: dataset.y_processed, type: 'scatter', mode: 'lines', name: '擬合輸入', line: { color: palette.secondary, width: 1.4 } },
    { x: dataset.x, y: fitResult.y_fit, type: 'scatter', mode: 'lines', name: '總擬合', line: { color: palette.primary, width: 2.2 } },
    { x: dataset.x, y: fitResult.residuals, type: 'scatter', mode: 'lines', name: '殘差', line: { color: palette.tertiary, width: 1.2, dash: 'dot' }, opacity: 0.7 },
  ]
  fitResult.y_individual.forEach((yLine, idx) => {
    const pk = fitResult.peaks[idx]
    traces.push({
      x: dataset.x, y: yLine, type: 'scatter', mode: 'lines',
      name: pk?.Peak_Name || `Peak ${idx + 1}`, line: { width: 1.3, color: palette.series[idx % palette.series.length] }, opacity: 0.8,
    })
  })
  return traces
}

// ── small UI pieces ───────────────────────────────────────────────────────────

function Section({ step, title, hint, children, defaultOpen = true, infoContent }: {
  step: number; title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean; infoContent?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [infoOpen, setInfoOpen] = useState(false)

  useEffect(() => {
    if (!infoOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInfoOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [infoOpen])

  const infoModal = infoOpen && infoContent && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-[3px]"
          onClick={() => setInfoOpen(false)}
        >
          <div
            className="glass-panel max-h-[min(84vh,calc(100vh-3rem))] w-full max-w-2xl overflow-hidden rounded-[30px]"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--card-divider)] px-5 py-4">
              <div>
                <p className="text-base font-semibold text-[var(--text-main)]">{title}說明</p>
                {hint && <p className="mt-1 text-sm text-[var(--text-soft)]">{hint}</p>}
              </div>
              <button
                type="button"
                onClick={() => setInfoOpen(false)}
                className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-sm text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)] pressable"
              >
                關閉
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-5 text-[15px] leading-7 text-[var(--text-soft)] sm:px-6 sm:text-base sm:leading-8">
              {infoContent}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
    <div className="sidebar-stage-card mb-3 overflow-hidden rounded-[24px]">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex flex-1 items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--card-ghost)]"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--accent-tertiary)_16%,transparent)] text-sm font-semibold text-[var(--accent-tertiary)]">
              {step}
            </span>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-[var(--text-muted)]">{title}</div>
              {hint && <div className="mt-0.5 text-[11px] text-[var(--text-soft)]">{hint}</div>}
            </div>
          </div>
          <span className="shrink-0 text-sm text-[var(--text-soft)]">{open ? '−' : '+'}</span>
        </button>
        {infoContent && (
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            title="查看方法說明"
            className={[
              'mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors',
              infoOpen
                ? 'border-[var(--accent-secondary)] bg-[var(--accent-soft)] text-[var(--accent-secondary)]'
                : 'border-[var(--card-border)] text-[var(--text-soft)] hover:border-[var(--accent-secondary)] hover:text-[var(--accent-secondary)]',
            ].join(' ')}
          >?</button>
        )}
      </div>
      {open && <div className="space-y-3 p-4 pt-2">{children}</div>}
    </div>
    {infoModal}
    </>
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

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-main)]">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-[var(--accent-strong)]" />
      {label}
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

function DualRangeInput({
  label,
  min,
  max,
  start,
  end,
  step = 0.1,
  onChange,
  disabled = false,
}: {
  label: string
  min: number
  max: number
  start: number
  end: number
  step?: number
  onChange: (next: { start: number; end: number }) => void
  disabled?: boolean
}) {
  const low = Math.min(start, end)
  const high = Math.max(start, end)
  const boundedMin = Number.isFinite(min) ? min : 0
  const boundedMax = Number.isFinite(max) && max > boundedMin ? max : boundedMin + 1
  const span = Math.max(boundedMax - boundedMin, 1e-9)
  const startPct = ((low - boundedMin) / span) * 100
  const endPct = ((high - boundedMin) / span) * 100

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
        <span className="text-[11px] font-medium text-[var(--text-main)]">
          {low.toFixed(1)} – {high.toFixed(1)} eV
        </span>
      </div>
      <div className="relative h-9">
        <div className="xps-range-track" />
        <div
          className="xps-range-selection"
          style={{
            left: `${startPct}%`,
            width: `${Math.max(endPct - startPct, 0)}%`,
          }}
        />
        <input
          type="range"
          min={boundedMin}
          max={boundedMax}
          step={step}
          value={low}
          disabled={disabled}
          onChange={e => onChange({ start: Math.min(Number(e.target.value), high), end: high })}
          className="xps-range-slider xps-range-slider--primary"
        />
        <input
          type="range"
          min={boundedMin}
          max={boundedMax}
          step={step}
          value={high}
          disabled={disabled}
          onChange={e => onChange({ start: low, end: Math.max(Number(e.target.value), low) })}
          className="xps-range-slider xps-range-slider--secondary"
        />
      </div>
    </div>
  )
}

function parseTwoColumnText(text: string, fileName: string): { x: number[]; y: number[]; name: string } | null {
  const lines = text.split(/\r?\n/)
  const dataLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || /^[#%!@]/.test(trimmed)) continue
    dataLines.push(trimmed)
  }
  if (dataLines.length < 2) return null
  const firstLine = dataLines[0]
  const sep = firstLine.includes('\t') ? '\t' : ','
  const parts0 = firstLine.split(sep)
  let startIdx = 0
  if (parts0.length >= 2 && isNaN(parseFloat(parts0[0].trim()))) startIdx = 1
  const pairs: [number, number][] = []
  for (let i = startIdx; i < dataLines.length; i++) {
    const parts = dataLines[i].split(sep)
    if (parts.length < 2) continue
    const x = parseFloat(parts[0].trim())
    const y = parseFloat(parts[1].trim())
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y])
  }
  if (pairs.length < 3) return null
  pairs.sort((a, b) => a[0] - b[0])
  return { x: pairs.map(p => p[0]), y: pairs.map(p => p[1]), name: fileName.replace(/\.[^/.]+$/, '') }
}

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers.map(csvEscape).join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n')
}
function downloadFile(content: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}
function ExportBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
    >{label}</button>
  )
}
function ExportBtnPrimary({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-85"
    >{label}</button>
  )
}
function ExportBtnSecondary({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 text-[13px] font-semibold text-[var(--text-main)] transition-colors hover:border-[var(--accent-secondary)] hover:text-[var(--accent-secondary)] disabled:pointer-events-none disabled:opacity-40"
    >{label}</button>
  )
}

function applyHidden(traces: Plotly.Data[], hidden: string[]): Plotly.Data[] {
  if (hidden.length === 0) return traces
  return traces.map(t => ({
    ...t,
    visible: hidden.includes((t as { name?: string }).name ?? '') ? ('legendonly' as const) : (true as const),
  }))
}

function makeLegendClick(setHidden: React.Dispatch<React.SetStateAction<string[]>>) {
  return (data: { curveNumber: number; data: Array<{ name?: string }> }) => {
    const name = data.data[data.curveNumber]?.name
    if (name != null) setHidden(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
    return false
  }
}

function ChartToolbar({
  title,
  colorValue,
  onColorChange,
  actions,
}: {
  title: string
  colorValue: string
  onColorChange: (value: string) => void
  actions?: ReactNode
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-semibold text-[var(--text-main)]">{title}</p>
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-soft)]">線色</span>
        {actions}
        <select
          value={colorValue}
          onChange={e => onColorChange(e.target.value)}
          className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1 text-xs text-[var(--input-text)] focus:outline-none"
        >
          {LINE_COLOR_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

function SeriesColorControls({
  items,
  colorKeys,
  onColorChange,
  activeName,
}: {
  items: Array<{ key: string; label: string }>
  colorKeys: string[]
  onColorChange: (key: string, value: string) => void
  activeName?: string | null
}) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => {
        const colorKey = colorKeys[index] ?? DEFAULT_SERIES_PALETTE_KEYS[index % DEFAULT_SERIES_PALETTE_KEYS.length]
        const palette = LINE_COLOR_PALETTES[colorKey] ?? LINE_COLOR_PALETTES.blue
        const isActive = activeName === item.key
        return (
          <div
            key={item.key}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: palette.primary, opacity: isActive == null || isActive ? 1 : 0.72 }}
            />
            <span className={`max-w-[112px] truncate text-[10px] ${isActive == null || isActive ? 'font-semibold text-[var(--text-main)]' : 'text-[var(--text-soft)]'}`}>
              {item.label}
            </span>
            <select
              value={colorKey}
              onChange={e => onColorChange(item.key, e.target.value)}
              className="rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1 py-0.5 text-[10px] text-[var(--input-text)] focus:outline-none"
            >
              {LINE_COLOR_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}

function ModuleDropdownTag({ activeModule, onSelect }: { activeModule: AnalysisModuleId; onSelect?: (m: AnalysisModuleId) => void }) {
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | null>(null)

  const activeLabel = ANALYSIS_MODULES.find(mod => mod.id === activeModule)?.label ?? activeModule.toUpperCase()

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const updatePanelPosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPanelStyle({
      position: 'fixed',
      top: rect.bottom + 10,
      left: rect.left + rect.width / 2,
      transform: 'translateX(-50%)',
      width: Math.min(240, Math.max(rect.width + 28, 188)),
      zIndex: 9999,
    })
  }, [])

  const openMenu = useCallback(() => {
    clearCloseTimer()
    updatePanelPosition()
    setOpen(true)
  }, [updatePanelPosition])

  const closeMenuSoon = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false)
      closeTimerRef.current = null
    }, 120)
  }, [])

  useEffect(() => () => clearCloseTimer(), [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onReposition = () => updatePanelPosition()

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    window.addEventListener('keydown', onKeyDown)
    updatePanelPosition()

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, updatePanelPosition])

  const panel = open ? (
    <div
      ref={panelRef}
      style={panelStyle}
      onMouseEnter={clearCloseTimer}
      onMouseLeave={closeMenuSoon}
      className="glass-panel overflow-hidden rounded-[22px] p-1.5"
    >
      <div className="px-3 pb-1.5 pt-2 text-center text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">
        切換分析模組
      </div>
      {ANALYSIS_MODULES.map(mod => {
        const isActive = mod.id === activeModule
        return (
          <button
            key={mod.id}
            type="button"
            disabled={isActive}
            onClick={() => {
              setOpen(false)
              if (!isActive) onSelect?.(mod.id)
            }}
            className={[
              'flex w-full items-center justify-between rounded-2xl px-3 py-2 text-sm transition-all duration-150 pressable',
              isActive
                ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-secondary)]'
                : 'text-[var(--text-main)] hover:bg-[var(--card-ghost)] hover:text-[var(--accent-secondary)]',
            ].join(' ')}
          >
            <span>{mod.label}</span>
            <span className="text-[11px] text-[var(--text-soft)]">{mod.detail}</span>
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <>
      <div className="relative flex justify-center">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            if (open) {
              setOpen(false)
            } else {
              openMenu()
            }
          }}
          onMouseEnter={openMenu}
          onMouseLeave={closeMenuSoon}
          className="glass-panel flex min-h-[52px] min-w-[168px] items-center justify-center gap-2 rounded-[18px] px-5 py-2.5 text-sm font-semibold text-[var(--text-main)] transition-all duration-150 hover:-translate-y-0.5"
        >
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">分析模組</span>
          <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent-secondary)_18%,transparent)] px-3 py-1 text-sm text-[var(--accent-secondary)]">
            {activeLabel}
          </span>
          <span className={`text-[10px] text-[var(--text-soft)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▼</span>
        </button>
      </div>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </>
  )
}

function createPeakId() { return `XP${Math.random().toString(36).slice(2, 7)}` }

function formatMetric(value: number | null | undefined, decimals = 4): string {
  if (value == null || !Number.isFinite(value)) return 'N/A'
  const abs = Math.abs(value)
  if (abs >= 1e5 || (abs > 0 && abs < 1e-3)) return value.toExponential(2)
  return value.toFixed(decimals)
}

type PeakSourceType = 'database' | 'manual'

interface PeakCandidate extends InitPeak {
  id: string
  label: string
  enabled: boolean
  sourceType: PeakSourceType
  cardLocked: boolean
  originalCenter?: number
  originalFwhm?: number
  originalAmplitude?: number
}

type PeakConstraintTarget = 'center' | 'fwhm'

type ParsedPeakConstraint =
  | { mode: 'fixed'; value: number }
  | { mode: 'range'; min: number; max: number }

function formatPeakNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  return Number(value.toFixed(4)).toString()
}

function formatPeakConstraint(peak: PeakCandidate, target: PeakConstraintTarget): string {
  if (target === 'center') {
    if (peak.lock_center) return formatPeakNumber(peak.center)
    return `${formatPeakNumber(peak.center_min ?? peak.center)}~${formatPeakNumber(peak.center_max ?? peak.center)}`
  }
  if (peak.lock_fwhm) return formatPeakNumber(peak.fwhm)
  return `${formatPeakNumber(peak.fwhm_min ?? peak.fwhm)}~${formatPeakNumber(peak.fwhm_max ?? peak.fwhm)}`
}

function parsePeakConstraint(text: string, target: PeakConstraintTarget): ParsedPeakConstraint | null {
  const cleaned = text.trim().replace(/\s*eV\s*$/i, '')
  if (!cleaned) return null
  const parts = cleaned.split(/(?:~|～|至|到|\.\.|–|—|\s+-\s+)/).map(part => part.trim()).filter(Boolean)
  const parseValue = (value: string) => Number(value.replace(/\s*eV\s*$/i, ''))
  const minAllowed = target === 'fwhm' ? PEAK_FWHM_MIN_ABS : -Infinity
  if (parts.length >= 2) {
    const a = parseValue(parts[0])
    const b = parseValue(parts[1])
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    const lo = Math.max(Math.min(a, b), minAllowed)
    const hi = Math.max(Math.max(a, b), minAllowed)
    if (Math.abs(hi - lo) < 1e-9) return { mode: 'fixed', value: lo }
    return { mode: 'range', min: lo, max: hi }
  }
  const value = parseValue(cleaned)
  if (!Number.isFinite(value) || value < minAllowed) return null
  return { mode: 'fixed', value }
}

function createPeakCandidate(
  input: {
    label: string
    center: number
    fwhm: number
    amplitude: number
    sourceType: PeakSourceType
    enabled?: boolean
    theoretical_center?: number
    lock_center?: boolean
    lock_fwhm?: boolean
    lock_area?: boolean
  },
  datasetMax = 1000,
): PeakCandidate {
  const center = Number.isFinite(input.center) ? input.center : 0
  const fwhm = Math.max(Number.isFinite(input.fwhm) ? input.fwhm : 1.0, PEAK_FWHM_MIN_ABS)
  const amplitude = Math.max(Number.isFinite(input.amplitude) ? input.amplitude : datasetMax * 0.5, 0)
  const theoreticalCenter = Number.isFinite(input.theoretical_center) ? Number(input.theoretical_center) : center
  const centerTolerance = input.sourceType === 'database'
    ? PEAK_CENTER_DB_TOLERANCE_EV
    : PEAK_CENTER_MANUAL_TOLERANCE_EV
  const amplitudeMax = Math.max(amplitude * PEAK_AMPLITUDE_MAX_MULTIPLIER, datasetMax * 1.5, 1)
  return {
    id: createPeakId(),
    label: input.label,
    enabled: input.enabled ?? true,
    center,
    fwhm,
    amplitude,
    sourceType: input.sourceType,
    theoretical_center: theoreticalCenter,
    lock_center: input.lock_center ?? true,
    lock_fwhm: input.lock_fwhm ?? true,
    lock_area: input.lock_area ?? false,
    cardLocked: true,
    center_min: theoreticalCenter - centerTolerance,
    center_max: theoreticalCenter + centerTolerance,
    fwhm_min: Math.max(PEAK_FWHM_MIN_ABS, fwhm * PEAK_FWHM_MIN_RATIO),
    fwhm_max: Math.max(fwhm * PEAK_FWHM_MAX_MULTIPLIER, fwhm + 0.2),
    amplitude_max: amplitudeMax,
    originalCenter: center,
    originalFwhm: fwhm,
    originalAmplitude: amplitude,
  }
}

function sanitizePeakCandidate(peak: PeakCandidate, datasetMax = 1000): PeakCandidate {
  const sourceType = peak.sourceType ?? 'database'
  const base = createPeakCandidate({
    label: peak.label,
    center: peak.center,
    fwhm: peak.fwhm,
    amplitude: peak.amplitude,
    sourceType,
    enabled: peak.enabled,
    theoretical_center: peak.theoretical_center,
    lock_center: peak.lock_center,
    lock_fwhm: peak.lock_fwhm,
    lock_area: peak.lock_area,
  }, datasetMax)
  return {
    ...base,
    id: peak.id || createPeakId(),
    cardLocked: peak.cardLocked ?? true,
    center_min: peak.center_min ?? base.center_min,
    center_max: peak.center_max ?? base.center_max,
    fwhm_min: peak.fwhm_min ?? base.fwhm_min,
    fwhm_max: peak.fwhm_max ?? base.fwhm_max,
    amplitude_max: peak.amplitude_max ?? Math.max(peak.amplitude * PEAK_AMPLITUDE_MAX_MULTIPLIER, datasetMax * 1.5, 1),
    originalCenter: peak.originalCenter ?? base.originalCenter,
    originalFwhm: peak.originalFwhm ?? base.originalFwhm,
    originalAmplitude: peak.originalAmplitude ?? base.originalAmplitude,
  }
}

function updatePeakCenterSeed(peak: PeakCandidate, center: number, datasetMax = 1000, options: { preserveBounds?: boolean } = {}): PeakCandidate {
  const sourceType = peak.sourceType ?? 'database'
  const theoreticalCenter = center
  const centerTolerance = sourceType === 'database'
    ? PEAK_CENTER_DB_TOLERANCE_EV
    : PEAK_CENTER_MANUAL_TOLERANCE_EV
  return sanitizePeakCandidate({
    ...peak,
    center,
    theoretical_center: options.preserveBounds ? peak.theoretical_center : theoreticalCenter,
    center_min: options.preserveBounds ? peak.center_min : theoreticalCenter - centerTolerance,
    center_max: options.preserveBounds ? peak.center_max : theoreticalCenter + centerTolerance,
  }, datasetMax)
}

function updatePeakFwhmSeed(peak: PeakCandidate, fwhm: number, datasetMax = 1000, options: { preserveBounds?: boolean } = {}): PeakCandidate {
  const nextFwhm = Math.max(fwhm, PEAK_FWHM_MIN_ABS)
  return sanitizePeakCandidate({
    ...peak,
    fwhm: nextFwhm,
    fwhm_min: options.preserveBounds ? peak.fwhm_min : Math.max(PEAK_FWHM_MIN_ABS, nextFwhm * PEAK_FWHM_MIN_RATIO),
    fwhm_max: options.preserveBounds ? peak.fwhm_max : Math.max(nextFwhm * PEAK_FWHM_MAX_MULTIPLIER, nextFwhm + 0.2),
  }, datasetMax)
}

function updatePeakAmplitudeSeed(peak: PeakCandidate, amplitude: number, datasetMax = 1000): PeakCandidate {
  const nextAmplitude = Math.max(amplitude, 0)
  return sanitizePeakCandidate({
    ...peak,
    amplitude: nextAmplitude,
    amplitude_max: Math.max(nextAmplitude * PEAK_AMPLITUDE_MAX_MULTIPLIER, datasetMax * 1.5, 1),
  }, datasetMax)
}

function applyPeakConstraintText(peak: PeakCandidate, target: PeakConstraintTarget, text: string, datasetMax = 1000): PeakCandidate {
  const parsed = parsePeakConstraint(text, target)
  if (!parsed) return peak
  if (target === 'center') {
    if (parsed.mode === 'fixed') {
      return sanitizePeakCandidate({
        ...peak,
        center: parsed.value,
        theoretical_center: parsed.value,
        lock_center: true,
        center_min: parsed.value,
        center_max: parsed.value,
      }, datasetMax)
    }
    const center = clamp(peak.center, parsed.min, parsed.max)
    return sanitizePeakCandidate({
      ...peak,
      center,
      theoretical_center: center,
      lock_center: false,
      center_min: parsed.min,
      center_max: parsed.max,
    }, datasetMax)
  }
  if (parsed.mode === 'fixed') {
    const fwhm = Math.max(parsed.value, PEAK_FWHM_MIN_ABS)
    return sanitizePeakCandidate({
      ...peak,
      fwhm,
      lock_fwhm: true,
      fwhm_min: fwhm,
      fwhm_max: fwhm,
    }, datasetMax)
  }
  const fwhmMin = Math.max(parsed.min, PEAK_FWHM_MIN_ABS)
  const fwhmMax = Math.max(parsed.max, fwhmMin + 0.01)
  return sanitizePeakCandidate({
    ...peak,
    fwhm: clamp(peak.fwhm, fwhmMin, fwhmMax),
    lock_fwhm: false,
    fwhm_min: fwhmMin,
    fwhm_max: fwhmMax,
  }, datasetMax)
}

function PeakConstraintInput({ label, peak, target, disabled, onApply }: {
  label: string
  peak: PeakCandidate
  target: PeakConstraintTarget
  disabled?: boolean
  onApply: (text: string) => void
}) {
  const formatted = formatPeakConstraint(peak, target)
  const [draft, setDraft] = useState(formatted)

  useEffect(() => {
    setDraft(formatted)
  }, [formatted])

  const commit = () => {
    const parsed = parsePeakConstraint(draft, target)
    if (!parsed) {
      setDraft(formatted)
      return
    }
    onApply(draft)
  }

  return (
    <TextInput
      label={label}
      value={draft}
      disabled={disabled}
      placeholder={target === 'fwhm' ? '固定: 1.2 或範圍: 1~1.8' : '固定: 531.2 或範圍: 530~532'}
      title="輸入單一數值會固定；輸入下限~上限會限制擬合範圍"
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function buildFitPeakPayloads(peaks: PeakCandidate[], dataset: ProcessedDataset): InitPeak[] {
  const datasetMax = Math.max(...dataset.y_processed.map(v => Number.isFinite(v) ? Math.abs(v) : 0), 1)
  const sanitized = peaks.map(pk => sanitizePeakCandidate(pk, datasetMax))
  const indexed = sanitized.map((peak, index) => ({ peak, index })).sort((a, b) => a.peak.center - b.peak.center)
  const payloads = sanitized.map(pk => ({ ...pk }))

  indexed.forEach((entry, sortedIndex) => {
    const current = entry.peak
    const prevCenter = indexed[sortedIndex - 1]?.peak.center
    const nextCenter = indexed[sortedIndex + 1]?.peak.center
    let centerMin = current.center_min ?? current.center
    let centerMax = current.center_max ?? current.center
    if (!current.lock_center) {
      if (Number.isFinite(prevCenter)) centerMin = Math.max(centerMin, (prevCenter as number) + PEAK_MIN_GAP_EV)
      if (Number.isFinite(nextCenter)) centerMax = Math.min(centerMax, (nextCenter as number) - PEAK_MIN_GAP_EV)
      if (centerMax - centerMin < 0.02) {
        const safeCenter = clamp(current.center, centerMin, centerMax)
        centerMin = safeCenter - 0.01
        centerMax = safeCenter + 0.01
      }
    } else {
      centerMin = current.center
      centerMax = current.center
    }

    payloads[entry.index] = {
      ...current,
      center_min: centerMin,
      center_max: centerMax,
      fwhm_min: current.lock_fwhm ? current.fwhm : Math.max(current.fwhm_min ?? PEAK_FWHM_MIN_ABS, PEAK_FWHM_MIN_ABS),
      fwhm_max: current.lock_fwhm ? current.fwhm : Math.max(current.fwhm_max ?? current.fwhm, current.fwhm + 0.05),
      amplitude_max: current.lock_area ? Math.max(current.amplitude, 1) : Math.max(current.amplitude_max ?? 0, current.amplitude * PEAK_AMPLITUDE_MAX_MULTIPLIER, datasetMax * 1.5, 1),
    }
  })

  return payloads.map(({ id: _id, enabled: _enabled, sourceType: _sourceType, cardLocked: _cardLocked, originalCenter: _oC, originalFwhm: _oF, originalAmplitude: _oA, ...peak }) => peak)
}

interface DatasetSessionState {
  params: ProcessParams
  autoInterpPoints: boolean
  manualEnergyShiftEnabled: boolean
  selectedElement: string
  fitProfile: string
  peakCandidates: PeakCandidate[]
  fitResult: FitResult | null
  rsfRows: { peakName: string; element: string; orbitalLabel: string; rsf: number | null; source: string }[]
}

interface DatasetPipelineBundle {
  final: ProcessResult | null
  preprocess: ProcessResult | null
  background: ProcessResult | null
  validRange: ProcessResult | null
  normalization: ProcessResult | null
  signature: string
  error: string | null
}

interface OverlayProcessState {
  params: ProcessParams
  autoInterpPoints: boolean
  manualEnergyShiftEnabled: boolean
}

function getDatasetKey(file: ParsedFile, index: number) {
  return `${index}::${file.name}`
}

function createDefaultSession(): DatasetSessionState {
  return {
    params: { ...DEFAULT_PARAMS },
    autoInterpPoints: true,
    manualEnergyShiftEnabled: false,
    selectedElement: '',
    fitProfile: 'voigt',
    peakCandidates: [],
    fitResult: null,
    rsfRows: [],
  }
}

function createEmptyBundle(signature = ''): DatasetPipelineBundle {
  return {
    final: null,
    preprocess: null,
    background: null,
    validRange: null,
    normalization: null,
    signature,
    error: null,
  }
}

function createDefaultOverlayState(): OverlayProcessState {
  return {
    params: { ...DEFAULT_PARAMS, average: false, interpolate: true },
    autoInterpPoints: true,
    manualEnergyShiftEnabled: false,
  }
}

function getSessionPointCount(files: ParsedFile[], session: DatasetSessionState) {
  return session.autoInterpPoints ? estimateInterpolationPoints(files) : session.params.n_points
}

function buildSessionSignature(files: ParsedFile[], index: number, session: DatasetSessionState) {
  return JSON.stringify({
    file: files[index]?.name ?? '',
    points: files.map(file => file.x.length),
    params: session.params,
    autoInterpPoints: session.autoInterpPoints,
    effectiveNPoints: getSessionPointCount(files, session),
  })
}

function buildDatasetsForSession(files: ParsedFile[], index: number, session: DatasetSessionState): DatasetInput[] {
  const file = files[index]
  return file ? [{ name: file.name, x: file.x, y: file.y }] : []
}

function getStageDataset(stage: ProcessResult | null | undefined, index: number, useAverage: boolean) {
  if (!stage) return null
  if (useAverage && stage.average) return stage.average
  if (stage.datasets.length === 1) return stage.datasets[0]
  return stage.datasets[index] ?? stage.datasets[0] ?? null
}

function getBundleDataset(bundle: DatasetPipelineBundle | null | undefined, index: number, useAverage: boolean) {
  return getStageDataset(bundle?.final, index, useAverage)
}

function buildOverlayTracesWithSeriesColors(
  datasets: { name: string; x: number[]; y: number[] }[],
  resolveColorKey: (name: string, index: number) => string,
): Plotly.Data[] {
  return datasets.map((dataset, index) => {
    const paletteKey = resolveColorKey(dataset.name, index)
    const palette = LINE_COLOR_PALETTES[paletteKey] ?? LINE_COLOR_PALETTES.blue
    return {
      x: dataset.x,
      y: dataset.y,
      type: 'scatter',
      mode: 'lines',
      name: dataset.name,
      line: {
        color: palette.primary,
        width: 2,
      },
    }
  })
}

function getStageDisplayLabel(params: ProcessParams) {
  const parts: string[] = []
  if (params.interpolate) parts.push('內插')
  if (params.average) parts.push('平均')
  if (Math.abs(params.energy_shift) > 1e-8) parts.push('能量校正')
  return parts.join(' / ')
}

function buildStageCsv(datasets: { name: string; x: number[]; y: number[] }[], xLabel: string, yLabel: string) {
  if (datasets.length === 0) return ''
  const maxLen = Math.max(...datasets.map(dataset => Math.max(dataset.x.length, dataset.y.length)))
  const headers = datasets.flatMap(dataset => [`${dataset.name}_${xLabel}`, `${dataset.name}_${yLabel}`])
  const rows: (string | number | null)[][] = []
  for (let i = 0; i < maxLen; i += 1) {
    rows.push(
      datasets.flatMap(dataset => [
        dataset.x[i] ?? null,
        dataset.y[i] ?? null,
      ]),
    )
  }
  return toCsv(headers, rows)
}

function getOverlayStageDatasets(stage: ProcessResult | null | undefined, useAverage: boolean) {
  if (!stage) return []
  if (useAverage && stage.average) {
    return [{ name: `${stage.average.name || '平均光譜'}（平均）`, x: stage.average.x, y: stage.average.y_processed }]
  }
  if (useAverage) return []
  return stage.datasets.map(dataset => ({ name: dataset.name, x: dataset.x, y: dataset.y_processed }))
}

function getOverlayProcessedStageDatasets(stage: ProcessResult | null | undefined, useAverage: boolean) {
  if (!stage) return []
  if (useAverage && stage.average) {
    return [{
      ...stage.average,
      name: `${stage.average.name || '平均光譜'}（平均）`,
    }]
  }
  if (useAverage) return []
  return stage.datasets
}

function buildOverlayBackgroundTracesWithSeriesColors(
  datasets: ProcessedDataset[],
  resolveColorKey: (name: string, index: number) => string,
  showBefore: boolean,
  showBackground: boolean,
): Plotly.Data[] {
  return datasets.flatMap((dataset, index) => {
    const paletteKey = resolveColorKey(dataset.name, index)
    const palette = LINE_COLOR_PALETTES[paletteKey] ?? LINE_COLOR_PALETTES.blue
    const traces: Plotly.Data[] = []
    if (showBefore) {
      traces.push({
        x: dataset.x,
        y: dataset.y_raw,
        type: 'scatter',
        mode: 'lines',
        name: `${dataset.name}｜扣背景前`,
        line: { color: palette.secondary, width: 1.3, dash: 'dot' },
        opacity: 0.82,
      })
    }
    if (showBackground && dataset.y_background) {
      traces.push({
        x: dataset.x,
        y: dataset.y_background,
        type: 'scatter',
        mode: 'lines',
        name: `${dataset.name}｜背景線`,
        line: { color: palette.tertiary, width: 1.25, dash: 'dash' },
        opacity: 0.94,
      })
    }
    traces.push({
      x: dataset.x,
      y: dataset.y_processed,
      type: 'scatter',
      mode: 'lines',
      name: `${dataset.name}｜扣背景後`,
      line: { color: palette.primary, width: 2 },
    })
    return traces
  })
}

// ── main component ────────────────────────────────────────────────────────────

export default function XPS({
  onModuleSelect,
  onOpenPlotPopup,
}: {
  onModuleSelect?: (m: AnalysisModuleId) => void
  onOpenPlotPopup?: (popup: PlotPopupRequest) => void
}) {
  const moduleContent = MODULE_CONTENT.xps
  const restoringSessionRef = useRef(false)
  const lastLoadedSessionKeyRef = useRef<string | null>(null)
  const datasetBundlesRef = useRef<Record<string, DatasetPipelineBundle>>({})
  const overlayBundleRef = useRef<DatasetPipelineBundle | null>(null)

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('nigiro-xps-sidebar-width'))
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH ? saved : SIDEBAR_DEFAULT_WIDTH
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('nigiro-xps-sidebar-collapsed') === 'true')
  const [sidebarResizing, setSidebarResizing] = useState(false)

  const [rawFiles, setRawFiles] = useState<ParsedFile[]>([])
  const [standardFiles, setStandardFiles] = useState<ParsedFile[]>([])
  const [params, setParams] = useState<ProcessParams>(DEFAULT_PARAMS)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [preprocessResult, setPreprocessResult] = useState<ProcessResult | null>(null)
  const [backgroundResult, setBackgroundResult] = useState<ProcessResult | null>(null)
  const [validRangeResult, setValidRangeResult] = useState<ProcessResult | null>(null)
  const [normalizationResult, setNormalizationResult] = useState<ProcessResult | null>(null)
  const [datasetSessions, setDatasetSessions] = useState<Record<string, DatasetSessionState>>({})
  const [datasetBundles, setDatasetBundles] = useState<Record<string, DatasetPipelineBundle>>({})
  const [processingViewMode, setProcessingViewMode] = useState<'single' | 'overlay'>('single')
  const [overlaySelection, setOverlaySelection] = useState<string[]>([])
  const [overlayDraftSelection, setOverlayDraftSelection] = useState<string[]>([])
  const [overlaySelectorOpen, setOverlaySelectorOpen] = useState(false)
  const [overlayState, setOverlayState] = useState<OverlayProcessState>(createDefaultOverlayState)
  const [overlayBundle, setOverlayBundle] = useState<DatasetPipelineBundle | null>(null)
  const [chartLineColors, setChartLineColors] = useState({
    raw: 'blue',
    preprocess: 'blue',
    overlay: 'teal',
    overlayBg: 'orange',
    overlayNorm: 'teal',
    background: 'orange',
    normalization: 'teal',
    final: 'blue',
  })
  const [rawFileColors, setRawFileColors] = useState<string[]>([])
  const [parseLoading, setParseLoading] = useState(false)
  const [processingKeys, setProcessingKeys] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [autoInterpPoints, setAutoInterpPoints] = useState(true)

  // display
  const [showRaw, setShowRaw] = useState(true)
  const [showBg, setShowBg] = useState(true)
  const [showXpsBgBefore, setShowXpsBgBefore] = useState(true)
  const [activeDatasetIdx, setActiveDatasetIdx] = useState(0)
  const [rawHidden, setRawHidden] = useState<string[]>([])
  const [overlayHidden, setOverlayHidden] = useState<string[]>([])
  const [overlayBgHidden, setOverlayBgHidden] = useState<string[]>([])
  const [overlayValidRangeHidden, setOverlayValidRangeHidden] = useState<string[]>([])
  const [overlayNormHidden, setOverlayNormHidden] = useState<string[]>([])
  const [preprocessHidden, setPreprocessHidden] = useState<string[]>([])
  const [bgHidden, setBgHidden] = useState<string[]>([])
  const [validRangeHidden, setValidRangeHidden] = useState<string[]>([])
  const [normHidden, setNormHidden] = useState<string[]>([])
  const [finalHidden, setFinalHidden] = useState<string[]>([])
  const [fitHidden, setFitHidden] = useState<string[]>([])

  // element selection
  const [elementsList, setElementsList] = useState<ElementListItem[]>([])
  const [periodicTable, setPeriodicTable] = useState<PeriodicTableItem[]>([])
  const [selectedElement, setSelectedElement] = useState('')
  const [elementsLoading, setElementsLoading] = useState(false)
  const [periodicTableOpen, setPeriodicTableOpen] = useState(false)
  const [calibrationElement, setCalibrationElement] = useState('Au')
  const [calibrationPeaks, setCalibrationPeaks] = useState<ElementDbPeak[]>([])
  const [calibrationPeakLabel, setCalibrationPeakLabel] = useState('')
  const [manualEnergyShiftEnabled, setManualEnergyShiftEnabled] = useState(false)
  const [calibrationDatasetIdx, setCalibrationDatasetIdx] = useState(0)
  const [calibrationResult, setCalibrationResult] = useState<CalibrationResult | null>(null)
  const [calibrationLoading, setCalibrationLoading] = useState(false)
  const [calibrationError, setCalibrationError] = useState<string | null>(null)

  // fitting
  const [fitProfile, setFitProfile] = useState<string>('voigt')
  const [fitNRestarts, setFitNRestarts] = useState<number>(1)
  const [peakCandidates, setPeakCandidates] = useState<PeakCandidate[]>([])
  const [fitResult, setFitResult] = useState<FitResult | null>(null)
  const [overlayFitResult, setOverlayFitResult] = useState<FitResult | null>(null)
  const [isFitting, setIsFitting] = useState(false)
  const [fitError, setFitError] = useState<string | null>(null)
  const [fitHistory, setFitHistory] = useState<{ iter: number; r2: number; rmse: number; delta: number }[]>([])
  const [autoConverging, setAutoConverging] = useState(false)

  // mode
  const [xpsMode, setXpsMode] = useState<XpsMode>('core_level')
  const [dftPassword, setDftPassword] = useState('')
  const [dftUnlocked, setDftUnlocked] = useState(() => localStorage.getItem('nigiro-xps-dft-unlocked') === 'true')
  const [dftPasswordError, setDftPasswordError] = useState<string | null>(null)

  // VBM extrapolation
  const [vbmEdgeLo, setVbmEdgeLo] = useState(1.0)
  const [vbmEdgeHi, setVbmEdgeHi] = useState(3.0)
  const [vbmBaselineLo, setVbmBaselineLo] = useState(0.0)
  const [vbmBaselineHi, setVbmBaselineHi] = useState(0.5)
  const [vbmResult, setVbmResult] = useState<VbmResult | null>(null)
  const [vbmLoading, setVbmLoading] = useState(false)
  const [vbmError, setVbmError] = useState<string | null>(null)
  const [vbmDataSource, setVbmDataSource] = useState<'pipeline' | 'imported'>('pipeline')
  const [importedVbmDataset, setImportedVbmDataset] = useState<{ x: number[]; y: number[]; name: string } | null>(null)
  const [importedVbmError, setImportedVbmError] = useState<string | null>(null)
  const [showVbmExportPreview, setShowVbmExportPreview] = useState(false)

  // Band Offset
  const [bandOffsetMethod, setBandOffsetMethod] = useState<'vbm_diff' | 'kraut'>('vbm_diff')
  const [boVbmA, setBoVbmA] = useState(0.0)
  const [boSigmaA, setBoSigmaA] = useState(0.0)
  const [boVbmB, setBoVbmB] = useState(0.0)
  const [boSigmaB, setBoSigmaB] = useState(0.0)
  const [boClA, setBoClA] = useState(0.0)
  const [boVbmAPure, setBoVbmAPure] = useState(0.0)
  const [boClB, setBoClB] = useState(0.0)
  const [boVbmBPure, setBoVbmBPure] = useState(0.0)
  const [boClAInt, setBoClAInt] = useState(0.0)
  const [boClBInt, setBoClBInt] = useState(0.0)
  const [bandOffsetResult, setBandOffsetResult] = useState<{ deltaEv: number; sigmaEv: number } | null>(null)
  const singleNormMethodRef = useRef<Exclude<ProcessParams['norm_method'], 'none'>>('max')
  const overlayNormMethodRef = useRef<Exclude<ProcessParams['norm_method'], 'none'>>('max')

  // RSF quantification
  const [rsfRows, setRsfRows] = useState<{ peakName: string; element: string; orbitalLabel: string; rsf: number | null; source: string }[]>([])
  const [overlayRsfRows, setOverlayRsfRows] = useState<{ peakName: string; element: string; orbitalLabel: string; rsf: number | null; source: string }[]>([])
  const [rsfLoading, setRsfLoading] = useState(false)
  const [rsfError, setRsfError] = useState<string | null>(null)

  const rawFileKeys = rawFiles.map((file, index) => getDatasetKey(file, index))
  const activeFile = rawFiles[activeDatasetIdx] ?? rawFiles[0] ?? null
  const activeDatasetKey = activeFile ? getDatasetKey(activeFile, activeDatasetIdx) : null
  const overlayFiles = overlaySelection
    .map(key => {
      const index = rawFileKeys.indexOf(key)
      return index >= 0 ? rawFiles[index] : null
    })
    .filter((file): file is ParsedFile => file != null)
  const isLoading = parseLoading || (activeDatasetKey ? processingKeys.includes(activeDatasetKey) : false)
  const overlayLoading = processingKeys.includes('__overlay__')
  const isBusy = isLoading || overlayLoading
  const currentParams = processingViewMode === 'overlay' ? overlayState.params : params
  const currentAutoInterpPoints = processingViewMode === 'overlay' ? overlayState.autoInterpPoints : autoInterpPoints
  const currentManualEnergyShiftEnabled = processingViewMode === 'overlay' ? overlayState.manualEnergyShiftEnabled : manualEnergyShiftEnabled
  const overlayAverageEnabled = processingViewMode === 'overlay' && overlayState.params.average
  const overlayNonAverageMode = processingViewMode === 'overlay' && !overlayState.params.average

  const activeDataset = getStageDataset(result, activeDatasetIdx, false)
  const preprocessDataset = getStageDataset(preprocessResult, activeDatasetIdx, false)
  const backgroundDataset = getStageDataset(backgroundResult, activeDatasetIdx, false)
  const validRangeDataset = getStageDataset(validRangeResult, activeDatasetIdx, false)
  const normalizationDataset = getStageDataset(normalizationResult, activeDatasetIdx, false)
  const activeSessionForProcessing = activeDatasetKey
    ? {
        ...(datasetSessions[activeDatasetKey] ?? createDefaultSession()),
        params: { ...params, average: false },
        autoInterpPoints,
        manualEnergyShiftEnabled,
        selectedElement,
        fitProfile,
        peakCandidates,
        fitResult,
        rsfRows,
      }
    : null
  const overlayPrimaryDataset = getStageDataset(overlayBundle?.final ?? null, 0, overlayState.params.average)
  const overlayAverageDataset = overlayBundle?.final?.average ?? null
  const fitTargetDataset = processingViewMode === 'overlay'
    ? (overlayState.params.average ? overlayAverageDataset : null)
    : activeDataset
  const fitTargetPeakScale = fitTargetDataset
    ? Math.max(...fitTargetDataset.y_processed.map(v => Number.isFinite(v) ? Math.abs(v) : 0), 1)
    : 1000
  const currentFitResult = processingViewMode === 'overlay' ? (overlayState.params.average ? overlayFitResult : null) : fitResult
  const currentRsfRows = processingViewMode === 'overlay' ? (overlayState.params.average ? overlayRsfRows : []) : rsfRows
  const currentDisplayDataset = processingViewMode === 'overlay' ? (overlayState.params.average ? fitTargetDataset : null) : activeDataset
  const vbmDataset = processingViewMode === 'overlay'
    ? overlayPrimaryDataset
    : activeDataset
  const effectiveVbmDataset: { x: number[]; y_processed: number[] } | null =
    vbmDataSource === 'imported' && importedVbmDataset
      ? { x: importedVbmDataset.x, y_processed: importedVbmDataset.y }
      : vbmDataset
  const effectiveVbmBeMin = effectiveVbmDataset ? Math.min(...effectiveVbmDataset.x) : 0
  const effectiveVbmBeMax = effectiveVbmDataset ? Math.max(...effectiveVbmDataset.x) : 1000
  const currentReportFileName = processingViewMode === 'overlay'
    ? (overlayFiles.length > 0
      ? `${overlayState.params.average ? 'overlay_average' : 'overlay'}__${overlayFiles.map(file => file.name).join('__')}`
      : (overlayState.params.average ? 'overlay_average' : 'overlay'))
    : (activeFile?.name ?? '')
  const axisRangeDataset = processingViewMode === 'overlay'
    ? (getStageDataset(overlayBundle?.preprocess ?? null, 0, overlayState.params.average) ?? overlayPrimaryDataset)
    : (preprocessDataset ?? activeDataset)
  const beMin = processingViewMode === 'overlay'
    ? (axisRangeDataset ? Math.min(...axisRangeDataset.x) : 0)
    : (axisRangeDataset ? Math.min(...axisRangeDataset.x) : 0)
  const beMax = processingViewMode === 'overlay'
    ? (axisRangeDataset ? Math.max(...axisRangeDataset.x) : 1000)
    : (axisRangeDataset ? Math.max(...axisRangeDataset.x) : 1000)
  const fitDataMin = fitTargetDataset ? Math.min(...fitTargetDataset.x) : beMin
  const fitDataMax = fitTargetDataset ? Math.max(...fitTargetDataset.x) : beMax
  const vbmGlobalExtrema = effectiveVbmDataset
    ? findSpectrumExtrema(effectiveVbmDataset.x, effectiveVbmDataset.y_processed)
    : null
  const vbmEdgeExtrema = effectiveVbmDataset
    ? findSpectrumExtrema(effectiveVbmDataset.x, effectiveVbmDataset.y_processed, { start: vbmEdgeLo, end: vbmEdgeHi })
    : null

  const vbmPreviewTangent = useMemo(() => {
    if (!effectiveVbmDataset || xpsMode !== 'valence_band') return null
    return fitVbmLine(effectiveVbmDataset.x, effectiveVbmDataset.y_processed, vbmEdgeLo, vbmEdgeHi, 'tangent')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveVbmDataset, vbmEdgeLo, vbmEdgeHi, xpsMode])

  const vbmPreviewBaselineLine = useMemo(() => {
    if (!effectiveVbmDataset || xpsMode !== 'valence_band') return null
    return fitVbmLine(effectiveVbmDataset.x, effectiveVbmDataset.y_processed, vbmBaselineLo, vbmBaselineHi, 'baseline')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveVbmDataset, vbmBaselineLo, vbmBaselineHi, xpsMode])

  const vbmPreviewVbm = useMemo(() => {
    return intersectVbmLines(vbmPreviewTangent, vbmPreviewBaselineLine)
  }, [vbmPreviewTangent, vbmPreviewBaselineLine])
  const vbmPlotWindow = useMemo(() => {
    if (!effectiveVbmDataset || xpsMode !== 'valence_band') return null
    return buildVbmStablePlotWindow(effectiveVbmDataset.x, effectiveVbmDataset.y_processed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveVbmDataset, xpsMode])

  const estimatedInterpPoints = estimateInterpolationPoints(processingViewMode === 'overlay' && overlayFiles.length > 0 ? overlayFiles : rawFiles)
  const effectiveNPoints = currentAutoInterpPoints ? estimatedInterpPoints : currentParams.n_points
  const standardDataset = standardFiles[calibrationDatasetIdx] ?? standardFiles[0] ?? null
  const calibrationPeak = calibrationPeaks.find(item => item.label === calibrationPeakLabel) ?? null
  const interpolationEnabled = currentParams.interpolate || (processingViewMode === 'overlay' && currentParams.average)
  const hasPreprocessStage = interpolationEnabled || Math.abs(currentParams.energy_shift) > 1e-8
  const hasBackgroundStage = currentParams.bg_enabled
  const hasValidRangeStage = currentParams.valid_range_enabled
  const hasNormalizationStage = currentParams.norm_method !== 'none'
  const rawPreview = processingViewMode === 'overlay'
    ? (overlayFiles[0] ?? null)
    : (rawFiles[activeDatasetIdx] ?? rawFiles[0] ?? null)

  useEffect(() => {
    if (params.norm_method !== 'none') {
      singleNormMethodRef.current = params.norm_method
    }
  }, [params.norm_method])

  useEffect(() => {
    if (overlayState.params.norm_method !== 'none') {
      overlayNormMethodRef.current = overlayState.params.norm_method
    }
  }, [overlayState.params.norm_method])

  useEffect(() => {
    datasetBundlesRef.current = datasetBundles
  }, [datasetBundles])

  useEffect(() => {
    setRawFileColors(prev => {
      if (prev.length === rawFiles.length) return prev
      const next = [...prev]
      for (let i = prev.length; i < rawFiles.length; i++) {
        next.push(DEFAULT_SERIES_PALETTE_KEYS[i % DEFAULT_SERIES_PALETTE_KEYS.length])
      }
      return next.slice(0, rawFiles.length)
    })
  }, [rawFiles.length])

  useEffect(() => {
    setVbmResult(null)
    setVbmError(null)
  }, [vbmDataset, processingViewMode, xpsMode, vbmEdgeLo, vbmEdgeHi, vbmBaselineLo, vbmBaselineHi])

  useEffect(() => {
    overlayBundleRef.current = overlayBundle
  }, [overlayBundle])

  useEffect(() => {
    if (overlaySelectorOpen) {
      setOverlayDraftSelection(overlaySelection)
    }
  }, [overlaySelectorOpen, overlaySelection])

  useEffect(() => {
    const nextKeys = new Set(rawFileKeys)
    setDatasetSessions(prev => {
      if (rawFileKeys.length === 0) return {}
      const next: Record<string, DatasetSessionState> = {}
      rawFiles.forEach((file, index) => {
        const key = getDatasetKey(file, index)
        next[key] = prev[key] ?? createDefaultSession()
      })
      return next
    })
    setDatasetBundles(prev => {
      if (rawFileKeys.length === 0) return {}
      const next: Record<string, DatasetPipelineBundle> = {}
      Object.entries(prev).forEach(([key, bundle]) => {
        if (nextKeys.has(key)) next[key] = bundle
      })
      return next
    })
    setOverlaySelection(prev => prev.filter(key => nextKeys.has(key)))
    setOverlayDraftSelection(prev => prev.filter(key => nextKeys.has(key)))
    if (rawFiles.length === 0) {
      lastLoadedSessionKeyRef.current = null
      setResult(null)
      setPreprocessResult(null)
      setBackgroundResult(null)
      setValidRangeResult(null)
      setNormalizationResult(null)
      setOverlayBundle(null)
      setOverlayState(createDefaultOverlayState())
      setProcessingViewMode('single')
      setError(null)
    }
  }, [rawFiles])

  useEffect(() => {
    if (!activeDatasetKey) {
      lastLoadedSessionKeyRef.current = null
      return
    }
    const session = datasetSessions[activeDatasetKey]
    if (!session) return
    if (lastLoadedSessionKeyRef.current === activeDatasetKey) return
    restoringSessionRef.current = true
    lastLoadedSessionKeyRef.current = activeDatasetKey
    setParams({ ...session.params, average: false })
    setAutoInterpPoints(session.autoInterpPoints)
    setManualEnergyShiftEnabled(session.manualEnergyShiftEnabled)
    setSelectedElement(session.selectedElement)
    setFitProfile(session.fitProfile)
    setPeakCandidates(session.peakCandidates.map(pk => sanitizePeakCandidate(pk, fitTargetPeakScale)))
    setFitResult(session.fitResult)
    setRsfRows(session.rsfRows)
    window.setTimeout(() => {
      restoringSessionRef.current = false
    }, 0)
  }, [activeDatasetKey, datasetSessions, fitTargetPeakScale])

  useEffect(() => {
    if (processingViewMode !== 'single' || !activeDatasetKey || restoringSessionRef.current) return
    setDatasetSessions(prev => ({
      ...prev,
      [activeDatasetKey]: {
        params: { ...params, average: false },
        autoInterpPoints,
        manualEnergyShiftEnabled,
        selectedElement,
        fitProfile,
        peakCandidates,
        fitResult,
        rsfRows,
      },
    }))
  }, [processingViewMode, activeDatasetKey, params, autoInterpPoints, manualEnergyShiftEnabled, selectedElement, fitProfile, peakCandidates, fitResult, rsfRows])

  useEffect(() => {
    if (processingViewMode !== 'single' || !activeDatasetKey) return
    if (restoringSessionRef.current) return
    setFitResult(current => (current ? null : current))
    setRsfRows(current => (current.length > 0 ? [] : current))
  }, [processingViewMode, activeDatasetKey, params, autoInterpPoints])

  useEffect(() => {
    if (processingViewMode !== 'overlay') return
    setOverlayFitResult(current => (current ? null : current))
    setOverlayRsfRows(current => (current.length > 0 ? [] : current))
  }, [processingViewMode, overlaySelection, overlayState.params, overlayState.autoInterpPoints])

  // process active single dataset
  useEffect(() => {
    if (processingViewMode !== 'single') return
    if (rawFiles.length === 0) {
      setResult(null)
      setPreprocessResult(null)
      setBackgroundResult(null)
      setValidRangeResult(null)
      setNormalizationResult(null)
      return
    }
    const keysToProcess = Array.from(new Set([activeDatasetKey].filter((key): key is string => Boolean(key))))
    if (keysToProcess.length === 0) return
    let cancelled = false
    setProcessingKeys(prev => {
      const merged = Array.from(new Set([...prev, ...keysToProcess]))
      return merged.length === prev.length && merged.every((key, index) => key === prev[index]) ? prev : merged
    })

    ;(async () => {
      const results: Array<{ key: string; bundle: DatasetPipelineBundle; error?: string } | null> = []

      for (const key of keysToProcess) {
        if (cancelled) return
        const index = rawFileKeys.indexOf(key)
        const session = key === activeDatasetKey && activeSessionForProcessing
          ? activeSessionForProcessing
          : datasetSessions[key]
        if (index < 0 || !session) {
          results.push(null)
          continue
        }

        const signature = buildSessionSignature(rawFiles, index, session)
        const cachedBundle = datasetBundlesRef.current[key]
        if (cachedBundle && cachedBundle.signature === signature) {
          results.push({ key, bundle: cachedBundle })
          continue
        }

        const datasets = buildDatasetsForSession(rawFiles, index, session)
        if (datasets.length === 0) {
          results.push(null)
          continue
        }

        const sessionNPoints = getSessionPointCount(rawFiles, session)
        const sessionInterpolationEnabled = session.params.interpolate || session.params.average
        const sessionHasPreprocessStage = sessionInterpolationEnabled || Math.abs(session.params.energy_shift) > 1e-8
        const sessionHasBackgroundStage = session.params.bg_enabled
        const sessionHasValidRangeStage = session.params.valid_range_enabled
        const sessionHasNormalizationStage = session.params.norm_method !== 'none'
        const effectiveParams = { ...session.params, n_points: sessionNPoints }
        const preprocessParams: ProcessParams = {
          ...DEFAULT_PARAMS,
          interpolate: sessionInterpolationEnabled,
          n_points: sessionNPoints,
          average: session.params.average,
          energy_shift: session.params.energy_shift,
        }
        const backgroundParams: ProcessParams = {
          ...preprocessParams,
          bg_enabled: sessionHasBackgroundStage,
          bg_method: session.params.bg_method,
          bg_x_start: session.params.bg_x_start,
          bg_x_end: session.params.bg_x_end,
          bg_poly_deg: session.params.bg_poly_deg,
          bg_baseline_lambda: session.params.bg_baseline_lambda,
          bg_baseline_p: session.params.bg_baseline_p,
          bg_baseline_iter: session.params.bg_baseline_iter,
          bg_tougaard_B: session.params.bg_tougaard_B,
          bg_tougaard_C: session.params.bg_tougaard_C,
        }
        const validRangeParams: ProcessParams = {
          ...backgroundParams,
          valid_range_enabled: sessionHasValidRangeStage,
          valid_x_start: session.params.valid_x_start,
          valid_x_end: session.params.valid_x_end,
        }
        const normalizationParams: ProcessParams = {
          ...validRangeParams,
          norm_method: session.params.norm_method,
          norm_x_start: session.params.norm_x_start,
          norm_x_end: session.params.norm_x_end,
        }

        try {
          const [finalResult, preprocessStage, backgroundStage, validRangeStage, normalizationStage] = await Promise.all([
            processData(datasets, effectiveParams),
            sessionHasPreprocessStage || sessionHasBackgroundStage || sessionHasValidRangeStage || sessionHasNormalizationStage ? processData(datasets, preprocessParams) : Promise.resolve(null),
            sessionHasBackgroundStage ? processData(datasets, backgroundParams) : Promise.resolve(null),
            sessionHasValidRangeStage ? processData(datasets, validRangeParams) : Promise.resolve(null),
            sessionHasNormalizationStage ? processData(datasets, normalizationParams) : Promise.resolve(null),
          ])

          results.push({
            key,
            bundle: {
              final: finalResult,
              preprocess: preprocessStage,
              background: backgroundStage,
              validRange: validRangeStage,
              normalization: normalizationStage,
              signature,
              error: null,
            } satisfies DatasetPipelineBundle,
          })
        } catch (sessionError: unknown) {
          results.push({
            key,
            bundle: createEmptyBundle(signature),
            error: String((sessionError as Error).message ?? sessionError),
          })
        }
      }

      if (cancelled) return
      setDatasetBundles(prev => {
        let changed = false
        const next = { ...prev }
        results.forEach(item => {
          if (!item) return
          const nextBundle = item.error
            ? { ...item.bundle, error: item.error }
            : item.bundle
          if (prev[item.key] !== nextBundle) {
            next[item.key] = nextBundle
            changed = true
          }
        })
        return changed ? next : prev
      })
      setProcessingKeys(prev => {
        const next = prev.filter(key => !keysToProcess.includes(key))
        return next.length === prev.length ? prev : next
      })
    })()

    return () => { cancelled = true }
  }, [processingViewMode, rawFiles, rawFileKeys, datasetSessions, activeDatasetKey, activeSessionForProcessing])

  // process overlay selection with an independent transient state
  useEffect(() => {
    if (processingViewMode !== 'overlay') return
    if (overlayFiles.length < 2) {
      setOverlayBundle(null)
      return
    }

    const overlayParams: ProcessParams = {
      ...overlayState.params,
      interpolate: overlayState.params.interpolate || overlayState.params.average,
      n_points: overlayState.autoInterpPoints ? effectiveNPoints : overlayState.params.n_points,
    }
    const signature = JSON.stringify({
      mode: 'overlay',
      files: overlayFiles.map(file => `${file.name}:${file.x.length}`),
      params: overlayParams,
      autoInterpPoints: overlayState.autoInterpPoints,
      manualEnergyShiftEnabled: overlayState.manualEnergyShiftEnabled,
    })
    if (overlayBundleRef.current && overlayBundleRef.current.signature === signature) return

    let cancelled = false
    setProcessingKeys(prev => (prev.includes('__overlay__') ? prev : [...prev, '__overlay__']))

    const datasets: DatasetInput[] = overlayFiles.map(file => ({ name: file.name, x: file.x, y: file.y }))
    const overlayInterpolationEnabled = overlayParams.interpolate || overlayParams.average
    const overlayHasPreprocessStage = overlayInterpolationEnabled || Math.abs(overlayParams.energy_shift) > 1e-8
    const overlayHasBackgroundStage = overlayParams.bg_enabled
    const overlayHasValidRangeStage = overlayParams.valid_range_enabled
    const overlayHasNormalizationStage = overlayParams.norm_method !== 'none'
    const overlayPreprocessParams: ProcessParams = {
      ...DEFAULT_PARAMS,
      interpolate: overlayInterpolationEnabled,
      n_points: overlayParams.n_points,
      average: overlayParams.average,
      energy_shift: overlayParams.energy_shift,
    }
    const overlayBackgroundParams: ProcessParams = {
      ...overlayPreprocessParams,
      bg_enabled: overlayHasBackgroundStage,
      bg_method: overlayParams.bg_method,
      bg_x_start: overlayParams.bg_x_start,
      bg_x_end: overlayParams.bg_x_end,
      bg_poly_deg: overlayParams.bg_poly_deg,
      bg_baseline_lambda: overlayParams.bg_baseline_lambda,
      bg_baseline_p: overlayParams.bg_baseline_p,
      bg_baseline_iter: overlayParams.bg_baseline_iter,
      bg_tougaard_B: overlayParams.bg_tougaard_B,
      bg_tougaard_C: overlayParams.bg_tougaard_C,
    }
    const overlayValidRangeParams: ProcessParams = {
      ...overlayBackgroundParams,
      valid_range_enabled: overlayHasValidRangeStage,
      valid_x_start: overlayParams.valid_x_start,
      valid_x_end: overlayParams.valid_x_end,
    }
    const overlayNormalizationParams: ProcessParams = {
      ...overlayValidRangeParams,
      norm_method: overlayParams.norm_method,
      norm_x_start: overlayParams.norm_x_start,
      norm_x_end: overlayParams.norm_x_end,
    }

    Promise.all([
      processData(datasets, overlayParams),
      overlayHasPreprocessStage || overlayHasBackgroundStage || overlayHasValidRangeStage || overlayHasNormalizationStage ? processData(datasets, overlayPreprocessParams) : Promise.resolve(null),
      overlayHasBackgroundStage ? processData(datasets, overlayBackgroundParams) : Promise.resolve(null),
      overlayHasValidRangeStage ? processData(datasets, overlayValidRangeParams) : Promise.resolve(null),
      overlayHasNormalizationStage ? processData(datasets, overlayNormalizationParams) : Promise.resolve(null),
    ])
      .then(([finalResult, preprocessStage, backgroundStage, validRangeStage, normalizationStage]) => {
        if (cancelled) return
        setOverlayBundle({
          final: finalResult,
          preprocess: preprocessStage,
          background: backgroundStage,
          validRange: validRangeStage,
          normalization: normalizationStage,
          signature,
          error: null,
        })
      })
      .catch((overlayErrorValue: unknown) => {
        if (cancelled) return
        setOverlayBundle({
          ...createEmptyBundle(signature),
          error: String((overlayErrorValue as Error).message ?? overlayErrorValue),
        })
      })
      .finally(() => {
        if (cancelled) return
        setProcessingKeys(prev => prev.filter(key => key !== '__overlay__'))
      })

    return () => { cancelled = true }
  }, [processingViewMode, overlayFiles, overlayState, effectiveNPoints])

  useEffect(() => {
    if (processingViewMode !== 'single') return
    if (!activeDatasetKey) {
      setResult(null)
      setPreprocessResult(null)
      setBackgroundResult(null)
      setValidRangeResult(null)
      setNormalizationResult(null)
      setError(null)
      return
    }
    const bundle = datasetBundles[activeDatasetKey]
    setResult(bundle?.final ?? null)
    setPreprocessResult(bundle?.preprocess ?? null)
    setBackgroundResult(bundle?.background ?? null)
    setValidRangeResult(bundle?.validRange ?? null)
    setNormalizationResult(bundle?.normalization ?? null)
    setError(bundle?.error ?? null)
  }, [processingViewMode, activeDatasetKey, datasetBundles])

  useEffect(() => {
    if (processingViewMode !== 'overlay') return
    setError(overlayBundle?.error ?? null)
  }, [processingViewMode, overlayBundle])

  // load elements list on mount
  useEffect(() => {
    Promise.all([listElements(), fetchPeriodicTable()])
      .then(([elements, periodic]) => {
        setElementsList(elements)
        setPeriodicTable(periodic)
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchElementPeaks(calibrationElement)
      .then(data => {
        if (cancelled) return
        setCalibrationPeaks(data.peaks)
        const firstPeak = data.peaks[0]
        setCalibrationPeakLabel(firstPeak?.label ?? '')
      })
      .catch(err => {
        if (cancelled) return
        setCalibrationPeaks([])
        setCalibrationPeakLabel('')
        setCalibrationError(String(err.message ?? err))
      })
    return () => { cancelled = true }
  }, [calibrationElement])

  useEffect(() => { localStorage.setItem('nigiro-xps-sidebar-width', String(sidebarWidth)) }, [sidebarWidth])
  useEffect(() => { localStorage.setItem('nigiro-xps-sidebar-collapsed', String(sidebarCollapsed)) }, [sidebarCollapsed])

  useEffect(() => {
    if (processingViewMode === 'overlay') {
      if (!overlayFitResult) { setOverlayRsfRows([]); return }
      setOverlayRsfRows(prev => {
        const prevMap = new Map(prev.map(r => [r.peakName, r]))
        return overlayFitResult.peaks.map(pk => {
          const existing = prevMap.get(pk.Peak_Name)
          return existing ?? { peakName: pk.Peak_Name, element: '', orbitalLabel: '', rsf: null, source: '' }
        })
      })
      return
    }
    if (!fitResult) { setRsfRows([]); return }
    setRsfRows(prev => {
      const prevMap = new Map(prev.map(r => [r.peakName, r]))
      return fitResult.peaks.map(pk => {
        const existing = prevMap.get(pk.Peak_Name)
        return existing ?? { peakName: pk.Peak_Name, element: '', orbitalLabel: '', rsf: null, source: '' }
      })
    })
  }, [processingViewMode, fitResult, overlayFitResult])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setSidebarResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const startX = e.clientX; const startW = sidebarWidth
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startW + ev.clientX - startX)))
    const onUp = () => {
      setSidebarResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  const handleFiles = useCallback(async (files: File[]) => {
    setParseLoading(true)
    setError(null)
    try {
      const res = await parseFiles(files)
      const nextFiles = res.files
      const nextSessions: Record<string, DatasetSessionState> = {}
      nextFiles.forEach((file, index) => {
        nextSessions[getDatasetKey(file, index)] = createDefaultSession()
      })
      lastLoadedSessionKeyRef.current = null
      setDatasetSessions(nextSessions)
      setDatasetBundles({})
      setOverlaySelection([])
      setRawFiles(nextFiles)
      setActiveDatasetIdx(0)
      if (res.errors.length) setError(res.errors.join('; '))
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setParseLoading(false)
    }
  }, [])

  const handleStandardFiles = useCallback(async (files: File[]) => {
    setCalibrationLoading(true)
    setCalibrationError(null)
    try {
      const res = await parseFiles(files)
      if (res.errors.length) setCalibrationError(res.errors.join('; '))
      setStandardFiles(res.files)
      setCalibrationDatasetIdx(0)
      setCalibrationResult(null)
    } catch (e: unknown) {
      setCalibrationError((e as Error).message)
    } finally {
      setCalibrationLoading(false)
    }
  }, [])

  const enterSingleMode = (nextIndex: number) => {
    setProcessingViewMode('single')
    setOverlaySelection([])
    setOverlayDraftSelection([])
    setOverlayBundle(null)
    setOverlayState(createDefaultOverlayState())
    setActiveDatasetIdx(nextIndex)
  }

  const enterOverlayMode = (selection: string[]) => {
    setProcessingViewMode('overlay')
    setOverlaySelection(selection)
    setOverlayDraftSelection(selection)
    setOverlayBundle(null)
    setOverlayState(current => ({
      ...createDefaultOverlayState(),
      params: {
        ...createDefaultOverlayState().params,
        bg_enabled: current.params.bg_enabled,
        bg_method: current.params.bg_method,
        bg_x_start: current.params.bg_x_start,
        bg_x_end: current.params.bg_x_end,
        bg_poly_deg: current.params.bg_poly_deg,
        bg_baseline_lambda: current.params.bg_baseline_lambda,
        bg_baseline_p: current.params.bg_baseline_p,
        bg_baseline_iter: current.params.bg_baseline_iter,
        bg_tougaard_B: current.params.bg_tougaard_B,
        bg_tougaard_C: current.params.bg_tougaard_C,
        smooth_method: current.params.smooth_method,
        smooth_window: current.params.smooth_window,
        smooth_poly: current.params.smooth_poly,
        norm_method: current.params.norm_method,
        norm_x_start: current.params.norm_x_start,
        norm_x_end: current.params.norm_x_end,
        energy_shift: current.params.energy_shift,
      },
    }))
    setOverlayFitResult(null)
    setOverlayRsfRows([])
  }

  const openOverlaySelector = () => {
    const fallbackSelection = overlaySelection.length >= 2 ? overlaySelection : rawFileKeys
    const nextSelection = fallbackSelection.length >= 2 ? fallbackSelection : rawFileKeys.slice(0, 2)
    setOverlayDraftSelection(nextSelection)
    if (nextSelection.length >= 2) {
      enterOverlayMode(nextSelection)
    }
    setOverlaySelectorOpen(true)
  }

  const updateSingleSessionState = (patch: Partial<DatasetSessionState>) => {
    if (!activeDatasetKey || restoringSessionRef.current) return
    setDatasetSessions(prev => {
      const currentSession = prev[activeDatasetKey] ?? createDefaultSession()
      return {
        ...prev,
        [activeDatasetKey]: {
          ...currentSession,
          ...patch,
        },
      }
    })
  }

  const updateSingleParams = (updater: (current: ProcessParams) => ProcessParams) => {
    setParams(current => {
      const next = updater(current)
      updateSingleSessionState({ params: { ...next, average: false } })
      return next
    })
  }

  const set = <K extends keyof ProcessParams>(key: K) => (val: ProcessParams[K]) => {
    if (processingViewMode === 'overlay') {
      setOverlayState(current => ({ ...current, params: { ...current.params, [key]: val } }))
      return
    }
    updateSingleParams(current => ({ ...current, [key]: val }))
  }

  const applyNormalizationMethod = (method: Exclude<ProcessParams['norm_method'], 'none'>) => {
    const nextNormStart = currentParams.norm_x_start ?? beMin
    const nextNormEnd = currentParams.norm_x_end ?? beMax
    if (processingViewMode === 'overlay') {
      setOverlayState(current => ({
        ...current,
        params: {
          ...current.params,
          norm_method: method,
          norm_x_start: current.params.norm_x_start ?? nextNormStart,
          norm_x_end: current.params.norm_x_end ?? nextNormEnd,
        },
      }))
      return
    }
    updateSingleParams(current => ({
      ...current,
      norm_method: method,
      norm_x_start: current.norm_x_start ?? nextNormStart,
      norm_x_end: current.norm_x_end ?? nextNormEnd,
    }))
  }

  const setNormalizationEnabled = (enabled: boolean) => {
    if (!enabled) {
      set('norm_method')('none')
      return
    }
    const fallbackMethod = processingViewMode === 'overlay' ? overlayNormMethodRef.current : singleNormMethodRef.current
    applyNormalizationMethod(fallbackMethod)
  }

  const setCurrentAutoInterpPoints = (value: boolean) => {
    if (processingViewMode === 'overlay') {
      setOverlayState(current => ({ ...current, autoInterpPoints: value }))
      return
    }
    setAutoInterpPoints(value)
  }

  const setCurrentManualEnergyShiftEnabled = (value: boolean) => {
    if (processingViewMode === 'overlay') {
      setOverlayState(current => ({ ...current, manualEnergyShiftEnabled: value }))
      return
    }
    setManualEnergyShiftEnabled(value)
  }

  const setCalibrationPeak = (label: string) => {
    setCalibrationPeakLabel(label)
  }

  const handleAutoCalibration = async () => {
    if (!standardDataset) {
      setCalibrationError('請先上傳標準樣品光譜')
      return
    }
    if (!calibrationPeakLabel || !calibrationPeak) {
      setCalibrationError('請先選擇標準峰')
      return
    }
    setCalibrationLoading(true)
    setCalibrationError(null)
    try {
      const res = await calibrateEnergy(
        standardDataset.x,
        standardDataset.y,
        calibrationElement,
        calibrationPeakLabel,
        calibrationPeak.be,
        10,
      )
      setCalibrationResult(res)
      if (!res.success) {
        setCalibrationError(res.message || '自動校正失敗')
        return
      }
      if (processingViewMode === 'overlay') {
        setOverlayState(current => ({
          ...current,
          params: {
            ...current.params,
            energy_shift: Number((current.params.energy_shift + res.offset_ev).toFixed(2)),
          },
        }))
      } else {
        setParams(current => ({ ...current, energy_shift: Number((current.energy_shift + res.offset_ev).toFixed(2)) }))
      }
    } catch (e: unknown) {
      setCalibrationError((e as Error).message)
    } finally {
      setCalibrationLoading(false)
    }
  }

  const computeVbmFn = async () => {
    if (!effectiveVbmDataset) return
    setVbmLoading(true); setVbmError(null)
    try {
      const res = await computeVbm(effectiveVbmDataset.x, effectiveVbmDataset.y_processed, vbmEdgeLo, vbmEdgeHi, vbmBaselineLo, vbmBaselineHi)
      setVbmResult(res)
      if (!res.success) setVbmError(res.message || '計算失敗')
    } catch (e: unknown) { setVbmError((e as Error).message) }
    finally { setVbmLoading(false) }
  }

  const computeBandOffset = () => {
    if (bandOffsetMethod === 'vbm_diff') {
      const deltaEv = boVbmA - boVbmB
      const sigmaEv = Math.sqrt(boSigmaA * boSigmaA + boSigmaB * boSigmaB)
      setBandOffsetResult({ deltaEv, sigmaEv })
    } else {
      const deltaEv = (boClA - boVbmAPure) - (boClB - boVbmBPure) - (boClAInt - boClBInt)
      setBandOffsetResult({ deltaEv, sigmaEv: 0 })
    }
  }

  const lookupRsfFn = async () => {
    if (processingViewMode === 'overlay' && !overlayState.params.average) {
      setRsfError('疊圖不平均模式下 RSF 定量已停用。請先啟用多檔平均，或切回單筆資料。')
      return
    }
    const validCount = currentRsfRows.filter(r => r.element.trim() && r.orbitalLabel.trim()).length
    if (validCount === 0) { setRsfError('請先填入元素與軌域標籤'); return }
    setRsfLoading(true); setRsfError(null)
    try {
      const items: RsfRequestItem[] = currentRsfRows.map(r => ({ element: r.element.trim(), label: r.orbitalLabel.trim() }))
      const results: RsfResultRow[] = await lookupRsf(items)
      if (processingViewMode === 'overlay') {
        setOverlayRsfRows(prev => prev.map((row, idx) => ({
          ...row,
          rsf: results[idx]?.rsf ?? null,
          source: results[idx]?.source ?? '',
        })))
      } else {
        setRsfRows(prev => prev.map((row, idx) => ({
          ...row,
          rsf: results[idx]?.rsf ?? null,
          source: results[idx]?.source ?? '',
        })))
      }
    } catch (e: unknown) { setRsfError((e as Error).message) }
    finally { setRsfLoading(false) }
  }

  const loadElementPeaks = async () => {
    if (!selectedElement) return
    setElementsLoading(true); setFitError(null)
    try {
      const data = await fetchElementPeaks(selectedElement)
      const newPeaks: PeakCandidate[] = data.peaks.map(pk => createPeakCandidate({
        label: `${selectedElement} ${pk.label}`,
        center: pk.be,
        fwhm: pk.fwhm,
        amplitude: fitTargetPeakScale * 0.5,
        sourceType: 'database',
        theoretical_center: pk.be,
      }, fitTargetPeakScale))
      setPeakCandidates(prev => [...prev.filter(p => p.sourceType !== 'database'), ...newPeaks])
    } catch (e: unknown) { setFitError((e as Error).message) }
    finally { setElementsLoading(false) }
  }

  const addManualPeak = () => {
    const center = fitTargetDataset ? (fitDataMin + fitDataMax) / 2 : 500
    setPeakCandidates(prev => [...prev, createPeakCandidate({
      label: `峰 ${prev.length + 1}`,
      center,
      fwhm: 1.5,
      amplitude: Math.max(fitTargetPeakScale * 0.35, 100),
      sourceType: 'manual',
      theoretical_center: center,
      lock_center: false,
    }, fitTargetPeakScale)])
  }

  const handleFit = async (): Promise<FitResult | null> => {
    if (processingViewMode === 'overlay' && !overlayState.params.average) {
      setFitError('疊圖不平均模式下峰擬合已停用。請先啟用多檔平均，或切回單筆資料。')
      return null
    }
    if (!fitTargetDataset) return null
    const activePeaks = peakCandidates.filter(p => p.enabled)
    if (activePeaks.length === 0) { setFitError('請先新增至少一個峰'); return null }
    setIsFitting(true); setFitError(null)
    try {
      const initPeaks = buildFitPeakPayloads(activePeaks, fitTargetDataset)
      const peakLabels = initPeaks.map(p => p.label ?? '')
      const res = await fitPeaks(
        fitTargetDataset.x,
        fitTargetDataset.y_processed,
        initPeaks,
        fitProfile,
        peakLabels,
        { maxfev: 8000, nRestarts: fitNRestarts },
      )
      const r2 = res.r_squared ?? 0
      const rmse = res.rmse ?? 0
      setFitHistory(prev => {
        const delta = prev.length > 0 ? Math.abs(r2 - prev[prev.length - 1].r2) : 1
        return [...prev, { iter: prev.length + 1, r2, rmse, delta }]
      })
      // Update unlocked peak params with fitted values (OriginPro-style iterative refinement)
      const scale = fitTargetPeakScale
      setPeakCandidates(prev => prev.map(pk => {
        const activeIdx = activePeaks.indexOf(pk)
        if (activeIdx < 0) return pk
        const fitted = res.peaks[activeIdx]
        if (!fitted) return pk
        let updated = pk
        if (!pk.lock_center) updated = updatePeakCenterSeed(updated, fitted.Center_eV, scale, { preserveBounds: true })
        if (!pk.lock_fwhm)   updated = updatePeakFwhmSeed(updated, fitted.FWHM_eV, scale, { preserveBounds: true })
        if (!pk.lock_area)   updated = updatePeakAmplitudeSeed(updated, fitted.Height, scale)
        return updated
      }))
      if (processingViewMode === 'overlay') {
        setOverlayFitResult(res)
      } else {
        setFitResult(res)
      }
      return res
    } catch (e: unknown) { setFitError((e as Error).message); return null }
    finally { setIsFitting(false) }
  }

  const handleAutoConverge = async () => {
    if (processingViewMode === 'overlay' && !overlayState.params.average) {
      setFitError('疊圖不平均模式下自動收斂已停用。')
      return
    }
    if (!fitTargetDataset) return
    setAutoConverging(true); setIsFitting(true); setFitError(null); setFitHistory([])
    let currentCandidates = peakCandidates
    let prevR2 = 0
    const scale = fitTargetPeakScale
    try {
      for (let iter = 0; iter < 10; iter++) {
        const activePeaks = currentCandidates.filter(p => p.enabled)
        if (activePeaks.length === 0) break
        const initPeaks = buildFitPeakPayloads(activePeaks, fitTargetDataset)
        const peakLabels = initPeaks.map(p => p.label ?? '')
        const res = await fitPeaks(
          fitTargetDataset.x,
          fitTargetDataset.y_processed,
          initPeaks,
          fitProfile,
          peakLabels,
          { maxfev: 8000, nRestarts: 1 },
        )
        const r2 = res.r_squared ?? 0
        const rmse = res.rmse ?? 0
        const delta = Math.abs(r2 - prevR2)
        setFitHistory(prev => [...prev, { iter: iter + 1, r2, rmse, delta }])
        currentCandidates = currentCandidates.map(pk => {
          const activeIdx = activePeaks.indexOf(pk)
          if (activeIdx < 0) return pk
          const fitted = res.peaks[activeIdx]
          if (!fitted) return pk
          let updated = pk
          if (!pk.lock_center) updated = updatePeakCenterSeed(updated, fitted.Center_eV, scale, { preserveBounds: true })
          if (!pk.lock_fwhm)   updated = updatePeakFwhmSeed(updated, fitted.FWHM_eV, scale, { preserveBounds: true })
          if (!pk.lock_area)   updated = updatePeakAmplitudeSeed(updated, fitted.Height, scale)
          return updated
        })
        if (processingViewMode === 'overlay') setOverlayFitResult(res)
        else setFitResult(res)
        if (delta < 0.00005 && iter > 0) break
        prevR2 = r2
      }
    } catch (e: unknown) { setFitError((e as Error).message) }
    finally {
      setPeakCandidates(currentCandidates)
      setAutoConverging(false); setIsFitting(false)
    }
  }

  const stageDisplayLabel = getStageDisplayLabel(currentParams)
  const rawChartSourceFiles = processingViewMode === 'overlay'
    ? overlayFiles
    : rawFiles
  const rawChartActiveIndex = processingViewMode === 'overlay' ? 0 : activeDatasetIdx
  const getDatasetColorKey = (name: string, fallbackIndex: number) => {
    const globalIdx = rawFiles.findIndex(file => file.name === name)
    if (globalIdx >= 0) return rawFileColors[globalIdx] ?? DEFAULT_SERIES_PALETTE_KEYS[globalIdx % DEFAULT_SERIES_PALETTE_KEYS.length]
    return rawFileColors[fallbackIndex] ?? DEFAULT_SERIES_PALETTE_KEYS[fallbackIndex % DEFAULT_SERIES_PALETTE_KEYS.length]
  }
  const rawSeriesItems = rawChartSourceFiles.map(file => ({ key: file.name, label: file.name }))
  const rawSeriesColorKeys = rawChartSourceFiles.map((file, index) => getDatasetColorKey(file.name, index))
  const overlaySeriesItems = overlayFiles.map(file => ({ key: file.name, label: file.name }))
  const overlaySeriesColorKeys = overlayFiles.map((file, index) => getDatasetColorKey(file.name, index))
  const rawStageDatasets = rawChartSourceFiles.map(file => ({ name: file.name, x: file.x, y: file.y }))
  const preprocessStageDatasets = rawPreview && preprocessDataset
    ? [{ name: preprocessDataset.name, x: preprocessDataset.x, y: preprocessDataset.y_processed }]
    : []
  const backgroundStageDatasets = backgroundDataset
    ? [{ name: backgroundDataset.name, x: backgroundDataset.x, y: backgroundDataset.y_processed }]
    : []
  const validRangeStageDatasets = validRangeDataset
    ? [{ name: validRangeDataset.name, x: validRangeDataset.x, y: validRangeDataset.y_processed }]
    : []
  const normalizationStageDatasets = normalizationDataset
    ? [{ name: normalizationDataset.name, x: normalizationDataset.x, y: normalizationDataset.y_processed }]
    : []
  const finalStageDatasets = currentDisplayDataset
    ? [{ name: currentDisplayDataset.name, x: currentDisplayDataset.x, y: currentDisplayDataset.y_processed }]
    : []
  const renderFinalChart = (height = 380, bindLegend = true) => {
    if (!currentDisplayDataset) return null
    const usesAreaNormalization = currentParams.norm_method === 'area'
    const showReferenceScale = processingViewMode === 'single' && (showRaw || (showBg && !!currentDisplayDataset.y_background))
    const useAreaSecondaryAxis = usesAreaNormalization && !currentFitResult && showReferenceScale
    const finalLayout = useAreaSecondaryAxis
      ? chartLayout(true, '原始 / 背景強度 (a.u.)', 'Area 歸一化強度')
      : chartLayout(true, usesAreaNormalization ? 'Area 歸一化強度' : 'Intensity (a.u.)')

    return (
      <Plot
        data={applyHidden((currentFitResult
          ? buildFitTraces(currentDisplayDataset, currentFitResult, chartLineColors.final)
          : buildMainTraces(
              currentDisplayDataset,
              processingViewMode === 'single' ? showRaw : false,
              processingViewMode === 'single' ? showBg : false,
              chartLineColors.final,
              useAreaSecondaryAxis ? 'y2' : 'y',
            )) as Plotly.Data[], finalHidden)}
        layout={finalLayout as Plotly.Layout}
        config={withPlotFullscreen()}
        style={{ width: '100%', height }}
        onLegendClick={bindLegend ? (makeLegendClick(setFinalHidden) as never) : undefined}
        onLegendDoubleClick={bindLegend ? (() => false) : undefined}
      />
    )
  }
  const openFinalChartPopup = () => {
    if (!onOpenPlotPopup || !currentDisplayDataset) return

    onOpenPlotPopup({
      title: `XPS 最終圖表 - ${currentDisplayDataset.name}`,
      content: renderFinalChart(440, false),
    })
  }
  const overlayFinalDatasets = getOverlayStageDatasets(overlayBundle?.final ?? null, overlayState.params.average)
  const overlayBackgroundDatasets = getOverlayStageDatasets(overlayBundle?.background ?? null, overlayState.params.average)
  const overlayValidRangeDatasets = getOverlayStageDatasets(overlayBundle?.validRange ?? null, overlayState.params.average)
  const overlayNormalizationDatasets = getOverlayStageDatasets(overlayBundle?.normalization ?? null, overlayState.params.average)
  const overlayPreprocessDatasets = getOverlayStageDatasets(overlayBundle?.preprocess ?? null, overlayState.params.average)
  const overlayBackgroundProcessedDatasets = getOverlayProcessedStageDatasets(overlayBundle?.background ?? null, overlayState.params.average)
  const overlayPreprocessProcessedDatasets = getOverlayProcessedStageDatasets(overlayBundle?.preprocess ?? null, overlayState.params.average)
  const overlayMinCount = overlayState.params.average ? 1 : 2
  const rawChartTraces = buildRawFileTraces(rawChartSourceFiles, rawChartActiveIndex, rawSeriesColorKeys)
  const preprocessChartTraces = rawPreview && preprocessDataset
    ? buildPipelineOverlayTraces(
        { x: rawPreview.x, y: rawPreview.y, name: `${rawPreview.name} 原始` },
        { x: preprocessDataset.x, y: preprocessDataset.y_processed, name: `${preprocessDataset.name} 前處理` },
        stageDisplayLabel ? `${stageDisplayLabel}後` : '前處理後',
        chartLineColors.preprocess,
      )
    : []
  const backgroundChartInput = preprocessDataset
  const backgroundChartOutput = backgroundDataset ?? preprocessDataset
  const backgroundChartTraces = backgroundChartInput && backgroundChartOutput
    ? [
        {
          x: backgroundChartInput.x,
          y: backgroundChartInput.y_processed,
          type: 'scatter',
          mode: 'lines',
          name: '背景扣除前',
          line: { color: (LINE_COLOR_PALETTES[chartLineColors.background] ?? LINE_COLOR_PALETTES.orange).secondary, width: 1.4 },
          opacity: 0.82,
        },
        ...(backgroundDataset?.y_background ? [{
          x: backgroundDataset.x,
          y: backgroundDataset.y_background,
          type: 'scatter' as const,
          mode: 'lines' as const,
          name: '背景線',
          line: { color: (LINE_COLOR_PALETTES[chartLineColors.background] ?? LINE_COLOR_PALETTES.orange).tertiary, width: 1.3, dash: 'dot' as const },
        }] : []),
        {
          x: backgroundChartOutput.x,
          y: backgroundChartOutput.y_processed,
          type: 'scatter',
          mode: 'lines',
          name: '背景扣除後',
          line: { color: (LINE_COLOR_PALETTES[chartLineColors.background] ?? LINE_COLOR_PALETTES.orange).primary, width: 2.1 },
        },
      ]
    : []
  const validRangeInput = hasBackgroundStage ? backgroundDataset : preprocessDataset
  const validRangeChartTraces = validRangeDataset && validRangeInput
    ? buildPipelineOverlayTraces(
        { x: validRangeInput.x, y: validRangeInput.y_processed, name: '有效範圍前' },
        { x: validRangeDataset.x, y: validRangeDataset.y_processed, name: '有效範圍後' },
        '有效範圍後',
        chartLineColors.normalization,
      )
    : []
  const normalizationInput = hasValidRangeStage ? validRangeDataset : (hasBackgroundStage ? backgroundDataset : preprocessDataset)
  const usesAreaNormalization = currentParams.norm_method === 'area'
  const normalizationChartTraces = normalizationDataset && normalizationInput
    ? buildPipelineOverlayTraces(
        { x: normalizationInput.x, y: normalizationInput.y_processed, name: '歸一化前' },
        { x: normalizationDataset.x, y: normalizationDataset.y_processed, name: '歸一化後' },
        '歸一化後',
        chartLineColors.normalization,
        usesAreaNormalization ? 'y2' : 'y',
      )
    : []
  const bgDataXMin = backgroundChartOutput ? Math.min(...backgroundChartOutput.x) : beMin
  const bgDataXMax = backgroundChartOutput ? Math.max(...backgroundChartOutput.x) : beMax
  const normDataXMin = normalizationInput ? Math.min(...normalizationInput.x) : beMin
  const normDataXMax = normalizationInput ? Math.max(...normalizationInput.x) : beMax
  const validRangeDataXMin = validRangeInput ? Math.min(...validRangeInput.x) : beMin
  const validRangeDataXMax = validRangeInput ? Math.max(...validRangeInput.x) : beMax
  const backgroundLayout = {
    ...(chartLayout() as Plotly.Layout),
    shapes: buildRegionShapes(currentParams.bg_x_start ?? bgDataXMin, currentParams.bg_x_end ?? bgDataXMax, '#f59e0b'),
    annotations: buildRegionAnnotations(currentParams.bg_x_start ?? bgDataXMin, currentParams.bg_x_end ?? bgDataXMax, '背景區間', '#f59e0b'),
  }
  const normalizationLayout = {
    ...(usesAreaNormalization
      ? chartLayout(true, '歸一化前強度 (a.u.)', 'Area 歸一化強度')
      : chartLayout()),
    shapes: buildRegionShapes(currentParams.norm_x_start ?? normDataXMin, currentParams.norm_x_end ?? normDataXMax, '#14b8a6'),
    annotations: buildRegionAnnotations(currentParams.norm_x_start ?? normDataXMin, currentParams.norm_x_end ?? normDataXMax, '歸一化區間', '#14b8a6'),
  }
  const validRangeLayout = {
    ...(chartLayout() as Plotly.Layout),
    shapes: buildRegionShapes(currentParams.valid_x_start ?? validRangeDataXMin, currentParams.valid_x_end ?? validRangeDataXMax, '#38bdf8'),
    annotations: buildRegionAnnotations(currentParams.valid_x_start ?? validRangeDataXMin, currentParams.valid_x_end ?? validRangeDataXMax, '有效數據範圍', '#38bdf8'),
  }
  const overlayBgLayout = {
    ...(chartLayout() as Plotly.Layout),
    shapes: buildRegionShapes(overlayState.params.bg_x_start ?? beMin, overlayState.params.bg_x_end ?? beMax, '#f59e0b'),
    annotations: buildRegionAnnotations(overlayState.params.bg_x_start ?? beMin, overlayState.params.bg_x_end ?? beMax, '背景區間', '#f59e0b'),
  }
  const overlayNormLayout = {
    ...(chartLayout() as Plotly.Layout),
    shapes: buildRegionShapes(overlayState.params.norm_x_start ?? beMin, overlayState.params.norm_x_end ?? beMax, '#14b8a6'),
    annotations: buildRegionAnnotations(overlayState.params.norm_x_start ?? beMin, overlayState.params.norm_x_end ?? beMax, '歸一化區間', '#14b8a6'),
  }
  const overlayValidRangeLayout = {
    ...(chartLayout() as Plotly.Layout),
    shapes: buildRegionShapes(overlayState.params.valid_x_start ?? beMin, overlayState.params.valid_x_end ?? beMax, '#38bdf8'),
    annotations: buildRegionAnnotations(overlayState.params.valid_x_start ?? beMin, overlayState.params.valid_x_end ?? beMax, '有效數據範圍', '#38bdf8'),
  }
  const renderRangeControlCard = (
    label: string,
    accentText: string,
    min: number,
    max: number,
    start: number,
    end: number,
    onChange: (next: { start: number; end: number }) => void,
  ) => (
    <div className="mt-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-[var(--text-main)]">{label}</p>
        <span className="text-[10px] text-[var(--text-soft)]">{accentText}</span>
      </div>
      <DualRangeInput
        label={label}
        min={min}
        max={max}
        start={start}
        end={end}
        step={0.1}
        onChange={onChange}
      />
    </div>
  )
  const handleSeriesColorChange = (targetName: string, value: string) => {
    const targetIdx = rawFiles.findIndex(file => file.name === targetName)
    if (targetIdx < 0) return
    setRawFileColors(prev => {
      const next = [...prev]
      next[targetIdx] = value
      return next
    })
  }
  const applyOverlayPalette = (baseKey: string) => {
    if (overlayFiles.length === 0) return
    const orderedKeys = [baseKey, ...DEFAULT_SERIES_PALETTE_KEYS.filter(key => key !== baseKey)]
    setRawFileColors(prev => {
      const next = [...prev]
      overlayFiles.forEach((file, index) => {
        const targetIdx = rawFiles.findIndex(rawFile => rawFile.name === file.name)
        if (targetIdx >= 0) next[targetIdx] = orderedKeys[index % orderedKeys.length]
      })
      return next
    })
  }

  const sidebarStyle: CSSProperties = sidebarCollapsed
    ? { width: SIDEBAR_COLLAPSED_PEEK, minWidth: SIDEBAR_COLLAPSED_PEEK, overflow: 'hidden' }
    : { width: sidebarWidth, minWidth: SIDEBAR_MIN_WIDTH, maxWidth: SIDEBAR_MAX_WIDTH }

  const overlayHasPreprocess = overlayState.params.interpolate || overlayState.params.average || Math.abs(overlayState.params.energy_shift) > 1e-8
  const overlayAnyStageEnabled = overlayHasPreprocess || overlayState.params.bg_enabled || overlayState.params.valid_range_enabled || hasNormalizationStage
  const hasImportedVbmWorkspaceData = xpsMode === 'valence_band' && vbmDataSource === 'imported' && !!importedVbmDataset
  const hasXpsWorkspaceData = rawFiles.length > 0 || hasImportedVbmWorkspaceData

  const showRawSpectrumCard = processingViewMode === 'single'
    ? !hasPreprocessStage
    : !overlayHasPreprocess

  const showFinalSpectrumCard = processingViewMode === 'single'
    ? (hasPreprocessStage || hasBackgroundStage || hasValidRangeStage || hasNormalizationStage)
    : overlayAnyStageEnabled

  const unlockDftAnalyzer = () => {
    if (dftPassword.trim() === XPS_DFT_PASSWORD) {
      setDftUnlocked(true)
      setDftPassword('')
      setDftPasswordError(null)
      localStorage.setItem('nigiro-xps-dft-unlocked', 'true')
      return
    }
    setDftPasswordError('密碼錯誤，請重新輸入。')
  }

  return (
    <div className={`flex h-screen flex-row overflow-hidden${sidebarResizing ? ' select-none' : ''}`}>
      {/* ── sidebar ── */}
      <aside style={sidebarStyle} className={`relative flex shrink-0 flex-col overflow-hidden border-r border-[var(--card-divider)] bg-[var(--panel-bg)]${sidebarResizing ? '' : ' transition-[width] duration-200'}`}>
        {sidebarCollapsed ? (
          <button type="button" onClick={() => setSidebarCollapsed(false)}
            className="flex h-full w-full flex-col items-center justify-center text-[var(--text-soft)] hover:text-[var(--text-main)]"
          >
            <span className="text-lg">›</span>
          </button>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <StickySidebarHeader
                activeModule="xps"
                subtitle="Material Intelligence Engine"
                onSelectModule={onModuleSelect}
                onCollapse={() => setSidebarCollapsed(true)}
              />

              {/* Mode toggle */}
              <div className="px-4 py-3">
                <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">分析模式</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['core_level', 'valence_band', 'dft'] as const).map(m => (
                    <button key={m} type="button" onClick={() => setXpsMode(m)}
                      className={['rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors pressable',
                        xpsMode === m ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-main)]' : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-soft)]'].join(' ')}
                    >
                      {XPS_MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              {xpsMode === 'dft' && (
                <div className="px-4 pt-2">
                  <Section step={0} title="DFT 加密模組" hint="Valence Band DFT-informed Analyzer">
                    <p className="mb-3 text-xs leading-5 text-[var(--text-soft)]">
                      此區連結到 Ga2O3/NiO/p-Si valence band DFT-informed spectral analysis。此工具不執行 VASP/DFT，
                      而是進行 VBM 對齊、分區積分、pDOS 展寬與 pDOS-based fitting。
                    </p>
                    {!dftUnlocked ? (
                      <div className="space-y-2">
                        <input
                          type="password"
                          value={dftPassword}
                          onChange={event => {
                            setDftPassword(event.target.value)
                            setDftPasswordError(null)
                          }}
                          onKeyDown={event => {
                            if (event.key === 'Enter') unlockDftAnalyzer()
                          }}
                          placeholder="輸入密碼"
                          className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-strong)]"
                        />
                        {dftPasswordError && <p className="text-[10px] text-rose-300">{dftPasswordError}</p>}
                        <button
                          type="button"
                          onClick={unlockDftAnalyzer}
                          className="w-full rounded-lg bg-[var(--accent-secondary)] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-85"
                        >
                          解鎖 DFT Analyzer
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 text-xs text-[var(--text-soft)]">
                        <p className="font-semibold text-[var(--text-main)]">已解鎖</p>
                        <p>DFT 工具會在中央工作區直接載入。</p>
                      </div>
                    )}
                  </Section>
                </div>
              )}

              <div className="px-4 pt-4">
                <Section step={1} title="載入檔案" hint="XY / VMS / TXT / CSV / ASC / XLSX">
                  <div className="mb-3 text-sm font-medium text-[var(--text-main)]">{moduleContent.uploadTitle}</div>
                  <FileUpload onFiles={handleFiles} isLoading={isLoading} moduleLabel="XPS" accept={['.xy', '.txt', '.csv', '.vms', '.pro', '.dat', '.asc', '.xlsx', '.xls']} />
                  {rawFiles.length > 0 && (
                    <div className="space-y-1">
                      {rawFiles.map(f => (
                        <div key={f.name} className="flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs text-[var(--text-main)]">
                          <span className="text-[var(--accent-tertiary)]">✓</span>
                          <span className="truncate">{f.name}</span>
                          <span className="ml-auto shrink-0 text-[var(--text-soft)]">{f.x.length} pts</span>
                        </div>
                      ))}
                      <button onClick={() => { setRawFiles([]); setResult(null); setFitResult(null); setPeakCandidates([]) }} className="text-xs text-rose-400 hover:text-rose-300">清除全部</button>
                    </div>
                  )}
                </Section>

                <Section step={2} title="內插 / 資料模式" hint="多檔：單筆 / 疊圖 / 平均" defaultOpen={false} infoContent={
                  <div className="space-y-3">
                    <p className="font-semibold text-[var(--text-main)]">內插說明</p>
                    <p>
                      對每筆資料<span className="font-semibold text-[var(--text-main)]">各自</span>建立等間距 x 軸，也就是從該筆光譜的
                      BE 最小值到最大值做 `linspace`，重新取成 N 個點，不建立跨檔案共用的 x 軸。
                    </p>
                    <p>
                      如果不同檔案的能量範圍不同，內插後每筆資料的 x 軸仍然會不同；這一步是單筆重取樣，不是先把所有資料強制對齊。
                    </p>
                    <p>
                      只有在多檔平均時，後端才會以<span className="font-semibold text-[var(--text-main)]">第一筆資料</span>的 x 軸當基準，
                      再把其他資料插值到同一個網格上。
                    </p>
                  </div>
                }>
                  <TogglePill
                    label={overlayAverageEnabled ? '平均模式固定啟用內插' : '啟用內插'}
                    checked={interpolationEnabled}
                    onChange={value => {
                      if (overlayAverageEnabled) {
                        setOverlayState(current => ({
                          ...current,
                          params: { ...current.params, interpolate: true },
                        }))
                        return
                      }
                      set('interpolate')(value)
                    }}
                  />

                  {/* 每筆資料統計 */}
                  {rawFiles.length > 0 && (() => {
                    const statsAll = rawFiles.map(f => getFileStats(f))
                    const ref = statsAll[0]
                    const rangeMismatch = statsAll.some(s =>
                      s && ref && (Math.abs(s.xStart - ref.xStart) > 0.5 || Math.abs(s.xEnd - ref.xEnd) > 0.5)
                    )
                    const newStep = effectiveNPoints > 1
                      ? null // computed per file below
                      : null
                    return (
                      <div className="space-y-1.5">
                        {rangeMismatch && (
                          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-400">
                            ⚠ 各筆能量範圍不同，內插後 x 軸不一致，平均時以第一筆為基準。
                          </div>
                        )}
                        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
                          {/* 表頭 */}
                          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 border-b border-[var(--card-divider)] px-2.5 py-1.5 text-[9px] uppercase tracking-[0.14em] text-[var(--text-soft)]">
                            <span>檔案</span>
                            <span className="text-right">點數</span>
                            <span className="text-right">BE 範圍 (eV)</span>
                            <span className="text-right">步距</span>
                          </div>
                          {rawFiles.map((file, idx) => {
                            const s = statsAll[idx]
                            if (!s) return null
                            const newStepEv = effectiveNPoints > 1 ? s.span / (effectiveNPoints - 1) : null
                            const stepChanged = interpolationEnabled && newStepEv != null && Math.abs(newStepEv - s.step) > 0.001
                            return (
                              <div key={file.name} className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-2 px-2.5 py-1.5 text-[10px] ${idx > 0 ? 'border-t border-[var(--card-divider)]' : ''}`}>
                                <span className="truncate text-[var(--text-main)]" title={file.name}>{file.name}</span>
                                <span className="shrink-0 text-right text-[var(--text-soft)]">
                                  {s.nPts}
                                  {interpolationEnabled && <span className="ml-1 text-[var(--accent-strong)]">→ {effectiveNPoints}</span>}
                                </span>
                                <span className="shrink-0 text-right text-[var(--text-soft)]">
                                  {s.xStart.toFixed(1)} – {s.xEnd.toFixed(1)}
                                </span>
                                <span className="shrink-0 text-right text-[var(--text-soft)]">
                                  {s.step.toFixed(3)}
                                  {stepChanged && newStepEv != null && (
                                    <span className={`ml-1 ${newStepEv < s.step ? 'text-[var(--accent-strong)]' : 'text-amber-400'}`}>
                                      → {newStepEv.toFixed(3)}
                                    </span>
                                  )}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                        {interpolationEnabled && (() => {
                          const statsAll2 = rawFiles.map(f => getFileStats(f))
                          const hasDenseStep = statsAll2.some(s => s && effectiveNPoints > 1 && (s.span / (effectiveNPoints - 1)) < s.step * 0.9)
                          const hasSparseStep = statsAll2.some(s => s && effectiveNPoints > 1 && (s.span / (effectiveNPoints - 1)) > s.step * 1.1)
                          if (!hasDenseStep && !hasSparseStep) return null
                          return (
                            <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-2 text-[10px] text-[var(--text-soft)]">
                              {hasDenseStep && <p className="text-[var(--accent-strong)]">↑ 點數增加：步距變小，內插會平滑化細節。</p>}
                              {hasSparseStep && <p className="text-amber-400">↓ 點數減少：步距變大，解析度下降。</p>}
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })()}

                  {interpolationEnabled && (
                    <>
                      <TogglePill label="自動調整點數" checked={currentAutoInterpPoints} onChange={setCurrentAutoInterpPoints} />
                      {currentAutoInterpPoints ? (
                        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--accent-soft)] px-3 py-3 text-xs">
                          <p className="font-medium text-[var(--text-main)]">自動建議：{effectiveNPoints} 點</p>
                          <p className="mt-1 text-[var(--text-soft)]">
                            依各筆資料的 span ÷ 原始步距 估算自然點數，取中位數後四捨五入（小於 300 點取 10 倍數，否則取 50 倍數）。
                          </p>
                          {rawFiles.length > 0 && (() => {
                            const estimates = rawFiles.map(f => {
                              const s = getFileStats(f)
                              if (!s) return null
                              const xs = [...f.x].filter(Number.isFinite).sort((a, b) => a - b)
                              const diffs: number[] = []
                              for (let i = 1; i < xs.length; i++) {
                                const d = xs[i] - xs[i-1]
                                if (d > 0) diffs.push(d)
                              }
                              if (diffs.length === 0) return null
                              const medStep = [...diffs].sort((a,b)=>a-b)[Math.floor(diffs.length/2)]
                              const est = Math.round(s.span / medStep) + 1
                              return { name: f.name, est, clamped: clamp(est, INTERP_POINTS_MIN, INTERP_POINTS_MAX) !== est }
                            }).filter(Boolean)
                            return (
                              <div className="mt-2 space-y-0.5 text-[10px] text-[var(--text-soft)]">
                                {estimates.map((e, i) => e && (
                                  <div key={i} className="flex justify-between">
                                    <span className="truncate max-w-[140px]">{e.name}</span>
                                    <span className={e.clamped ? 'text-amber-400' : ''}>{e.est} 點{e.clamped ? '（已夾限）' : ''}</span>
                                  </div>
                                ))}
                              </div>
                            )
                          })()}
                        </div>
                      ) : (
                        <NumInput label="點數" value={currentParams.n_points} onChange={set('n_points')} min={50} max={5000} step={10} />
                      )}
                    </>
                  )}

                  {rawFiles.length > 1 && (
                    <div className="space-y-2 pt-1">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">資料模式</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => enterSingleMode(activeDatasetIdx)}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${processingViewMode === 'single' ? 'bg-[var(--accent-strong)] text-white' : 'border border-[var(--card-border)] text-[var(--text-soft)] hover:text-[var(--text-main)]'}`}
                        >
                          單筆
                        </button>
                        <button
                          type="button"
                          onClick={openOverlaySelector}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${processingViewMode === 'overlay' ? 'bg-[var(--accent-strong)] text-white' : 'border border-[var(--card-border)] text-[var(--text-soft)] hover:text-[var(--text-main)]'}`}
                        >
                          疊圖
                        </button>
                      </div>
                      {processingViewMode === 'overlay' ? (
                        <>
                          <button
                            type="button"
                            onClick={openOverlaySelector}
                            className="w-full rounded-lg border border-[var(--accent-soft)] py-1.5 text-xs text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft)]"
                          >
                            選擇疊圖資料（{overlaySelection.length} 筆）
                          </button>
                          {overlayFiles.length > 1 ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setOverlayState(current => ({
                                    ...current,
                                    autoInterpPoints: true,
                                    params: {
                                      ...current.params,
                                      average: !current.params.average,
                                      interpolate: !current.params.average ? true : current.params.interpolate,
                                    },
                                  }))
                                }}
                                className={`w-full rounded-lg border py-1.5 text-xs transition-colors ${
                                  overlayState.params.average
                                    ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] font-medium text-[var(--text-main)]'
                                    : 'border-[var(--card-border)] text-[var(--text-soft)] hover:border-[var(--accent-strong)] hover:text-[var(--text-main)]'
                                }`}
                              >
                                {overlayState.params.average ? '取消平均，改回疊圖比較' : '平均所有疊圖數據'}
                              </button>
                              <p className="text-[10px] leading-5 text-[var(--text-soft)]">
                                {overlayState.params.average
                                  ? '已啟用平均：目前選取資料會先對齊到同一組內插點數，再產生一條平均光譜；後續峰擬合與 RSF 只會使用這條平均光譜。'
                                  : '目前是不平均疊圖：每筆資料會各自套用同一組內插、能量校正、背景扣除與歸一化參數後疊圖比較；峰擬合與 RSF 會鎖定停用。'}
                              </p>
                            </>
                          ) : (
                            <p className="text-[10px] text-[var(--text-soft)]">請先在多筆疊圖模式選至少 2 筆資料，才可平均所有疊圖數據。</p>
                          )}
                        </>
                      ) : (
                        <CustomSelect
                          label="顯示資料"
                          value={String(activeDatasetIdx)}
                          onChange={value => enterSingleMode(Number(value))}
                          options={rawFiles.map((file, index) => ({ value: String(index), label: file.name }))}
                        />
                      )}
                    </div>
                  )}
                </Section>

                <Section step={3} title="能量校正" hint="手動位移 + 標準樣品自動校正" defaultOpen={false}>
                  <TogglePill label="手動調整偏移量" checked={currentManualEnergyShiftEnabled} onChange={setCurrentManualEnergyShiftEnabled} />
                  {currentManualEnergyShiftEnabled && (
                    <NumInput label="手動 BE 位移 (eV)" value={currentParams.energy_shift} onChange={set('energy_shift')} step={0.01} />
                  )}
                  <p className="text-[10px] text-[var(--text-soft)]">沒有標準樣品時可勾選手動調整，直接輸入要加或減多少 eV；若用標準樣品校正，會把計算出的偏移量自動加到目前值。</p>
                  <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                    <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">標準樣品資料庫校正</p>
                    <div className="space-y-3">
                      <FileUpload
                        onFiles={handleStandardFiles}
                        isLoading={calibrationLoading}
                        moduleLabel="標準樣品"
                        accept={['.xy', '.txt', '.csv', '.vms', '.pro', '.dat', '.asc', '.xlsx', '.xls']}
                      />
                      {standardFiles.length > 0 && (
                        <div className="space-y-1">
                          {standardFiles.map((file, idx) => (
                            <button
                              key={`${file.name}-${idx}`}
                              type="button"
                              onClick={() => setCalibrationDatasetIdx(idx)}
                              className={[
                                'flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors pressable',
                                idx === calibrationDatasetIdx
                                  ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-main)]'
                                  : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-soft)]',
                              ].join(' ')}
                            >
                              <span className="truncate">{file.name}</span>
                              <span className="ml-auto shrink-0">{file.x.length} pts</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <CustomSelect
                          label="標準樣品"
                          value={calibrationElement}
                          onChange={setCalibrationElement}
                          options={elementsList.filter(el => el.has_peaks).map(el => ({
                            value: el.symbol,
                            label: `${el.symbol} — ${el.name}`,
                          }))}
                        />
                        <CustomSelect
                          label="參考峰"
                          value={calibrationPeakLabel}
                          onChange={setCalibrationPeak}
                          options={calibrationPeaks.map(peak => ({
                            value: peak.label,
                            label: `${peak.label} (${peak.be.toFixed(1)} eV)`,
                          }))}
                          disabled={calibrationPeaks.length === 0}
                        />
                      </div>
                      {calibrationPeak && (
                        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs">
                          <p className="font-medium text-[var(--text-main)]">參考峰：{calibrationPeak.label}</p>
                          <p className="mt-1 text-[var(--text-soft)]">資料庫參考 BE：{calibrationPeak.be.toFixed(3)} eV</p>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={handleAutoCalibration}
                        disabled={calibrationLoading || !standardDataset || !calibrationPeakLabel || !calibrationPeak}
                        className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 pressable"
                      >
                        {calibrationLoading ? '校正中…' : '計算偏移並套用'}
                      </button>
                      {calibrationError && <p className="text-xs text-rose-400">{calibrationError}</p>}
                      {calibrationResult?.success && (
                        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--accent-soft)] px-3 py-3 text-xs text-[var(--text-main)]">
                          <p className="font-medium">
                            {calibrationResult.standard_element} {calibrationResult.peak_label}：
                            觀測 {calibrationResult.observed_be?.toFixed(2)} eV
                          </p>
                          <p className="mt-1 text-[var(--text-soft)]">
                            參考 {calibrationResult.reference_be.toFixed(2)} eV，已套用偏移 {calibrationResult.offset_ev >= 0 ? '+' : ''}
                            {calibrationResult.offset_ev.toFixed(2)} eV。
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </Section>

                <Section step={4} title="背景扣除" hint="Shirley / Tougaard / Linear" defaultOpen={false} infoContent={
                  <div className="space-y-3">
                    <p className="font-semibold text-[var(--text-main)]">背景扣除方法說明</p>
                    <div><span className="font-medium text-[var(--text-main)]">Linear</span> — 線性連接起點與終點 bg(E)=aE+b。適用背景緩慢線性變化的簡單情況。峰頂遠超出線性基線時可能低估背景。</div>
                    <div><span className="font-medium text-[var(--text-main)]">Shirley</span> — 迭代演算，背景正比於較高 BE 端的積分強度。業界最常用，適合對稱 XPS 核心能階峰，兩端自然歸零。峰形嚴重非對稱或有強散射時效果較差。</div>
                    <div><span className="font-medium text-[var(--text-main)]">Shirley + Linear Offset</span> — 在 Shirley 背景上再同時納入一個緩慢線性斜率，適合高 BE 側有輕微整體傾斜、但又不希望手動先扣一條斜線再做 Shirley 的情況。</div>
                    <div><span className="font-medium text-[var(--text-main)]">Tougaard</span> — 物理模型，基於能量損失函數 B(E)=B·∫J/(E′−E+C)² dE′，預設 B=2866、C=1643。適合寬能量範圍，對峰形無對稱假設。計算較慢，需選較大 BE 範圍。</div>
                    <div><span className="font-medium text-[var(--text-main)]">Polynomial</span> — 多項式擬合兩端背景。適合峰位不在邊緣、背景形狀較複雜的情況。次數過高容易過擬合，建議從 2–4 開始試。</div>
                    <div><span className="font-medium text-[var(--text-main)]">AsLS</span> — 非對稱最小二乘法（Asymmetric Least Squares）。以懲罰項讓估計背景平滑且盡量落在光譜下方。適合寬帶彎曲背景。</div>
                    <div><span className="font-medium text-[var(--text-main)]">airPLS</span> — 自適應迭代加權懲罰最小二乘法，自動調整各點權重，不需手動調非對稱參數。適合複雜背景形狀，通常比 AsLS 更穩健。</div>
                  </div>
                }>
                  <TogglePill label="啟用背景扣除" checked={currentParams.bg_enabled} onChange={set('bg_enabled')} />
                  {currentParams.bg_enabled && (
                    <>
                      <CustomSelect label="方法" value={currentParams.bg_method} onChange={v => set('bg_method')(v as ProcessParams['bg_method'])}
                        options={[
                          { value: 'linear', label: 'Linear' },
                          { value: 'shirley', label: 'Shirley' },
                          { value: 'shirley_linear', label: 'Shirley + Linear Offset' },
                          { value: 'tougaard', label: 'Tougaard' },
                          { value: 'polynomial', label: 'Polynomial' },
                          { value: 'asls', label: 'AsLS' },
                          { value: 'airpls', label: 'airPLS' },
                        ]}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <NumInput label="起始 BE (eV)" value={currentParams.bg_x_start ?? beMin} onChange={v => set('bg_x_start')(v)} step={0.1} />
                        <NumInput label="結束 BE (eV)" value={currentParams.bg_x_end ?? beMax} onChange={v => set('bg_x_end')(v)} step={0.1} />
                      </div>
                      {currentParams.bg_method === 'polynomial' && <NumInput label="多項式次數" value={currentParams.bg_poly_deg} onChange={set('bg_poly_deg')} min={1} max={10} />}
                      {currentParams.bg_method === 'tougaard' && (
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput label="B" value={currentParams.bg_tougaard_B} onChange={set('bg_tougaard_B')} step={10} />
                          <NumInput label="C" value={currentParams.bg_tougaard_C} onChange={set('bg_tougaard_C')} step={10} />
                        </div>
                      )}
                    </>
                  )}
                </Section>

                <Section step={5} title="有效數據範圍" hint="背景後裁切有效 BE 區間" defaultOpen={false} infoContent={
                  <div className="space-y-3">
                    <p className="font-semibold text-[var(--text-main)]">有效數據範圍</p>
                    <p>此步驟會在背景扣除後裁切資料，只保留指定 BE 區間。後續歸一化、峰擬合、RSF 與匯出都會使用裁切後的有效資料。</p>
                  </div>
                }>
                  <TogglePill label="啟用有效數據範圍" checked={currentParams.valid_range_enabled} onChange={set('valid_range_enabled')} />
                  {currentParams.valid_range_enabled && (
                    <>
                      <DualRangeInput
                        label="有效數據範圍"
                        min={beMin}
                        max={beMax}
                        start={currentParams.valid_x_start ?? beMin}
                        end={currentParams.valid_x_end ?? beMax}
                        step={0.1}
                        onChange={({ start, end }) => {
                          set('valid_x_start')(start)
                          set('valid_x_end')(end)
                        }}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <NumInput label="起始 BE (eV)" value={currentParams.valid_x_start ?? beMin} onChange={v => set('valid_x_start')(clamp(v, beMin, beMax))} step={0.1} />
                        <NumInput label="結束 BE (eV)" value={currentParams.valid_x_end ?? beMax} onChange={v => set('valid_x_end')(clamp(v, beMin, beMax))} step={0.1} />
                      </div>
                    </>
                  )}
                </Section>

                <Section step={6} title="歸一化" hint="統一強度尺度" defaultOpen={false} infoContent={
                  <div className="space-y-3">
                    <p className="font-semibold text-[var(--text-main)]">歸一化方法說明</p>
                    <div><span className="font-medium text-[var(--text-main)]">不歸一化 (None)</span> — 保留原始強度。適合已完成儀器強度校正的資料，或需比較絕對強度的情況。</div>
                    <div><span className="font-medium text-[var(--text-main)]">Min–Max</span> — y′=(y−min)/(max−min)，縮放至 [0, 1]。適合比較峰型，不保留相對強度。不建議用於定量比較。</div>
                    <div><span className="font-medium text-[var(--text-main)]">Max</span> — y′=y/max，最高峰縮放至 1。適合多組光譜疊圖比較峰型與相對強度比。</div>
                    <div><span className="font-medium text-[var(--text-main)]">Area</span> — y′=y/∫y dx，以積分面積歸一化。適合比較不同量測時間或通量下的峰強度，常用於 XPS 定量分析前的強度校正。</div>
                    <div><span className="font-medium text-[var(--text-main)]">Mean Region</span> — y′=y/mean(y[lo:hi])，以指定能量區間的平均值歸一化。適合有明確參考背景的情況，如費米邊緣歸一化或特定背景區間。</div>
                    <p className="mt-1 text-[var(--text-soft)]">注意：歸一化後的強度不再具有物理意義的絕對值，RSF 定量分析應在歸一化前進行，或確保各組資料採用相同歸一化條件。</p>
                  </div>
                }>
                  <TogglePill label="啟用歸一化" checked={hasNormalizationStage} onChange={setNormalizationEnabled} />
                  {hasNormalizationStage && (
                    <>
                      <CustomSelect label="方法" value={currentParams.norm_method} onChange={v => applyNormalizationMethod(v as Exclude<ProcessParams['norm_method'], 'none'>)}
                        options={[
                          { value: 'min_max', label: 'Min–Max' },
                          { value: 'max', label: 'Max' },
                          { value: 'area', label: 'Area' },
                          { value: 'mean_region', label: 'Mean Region' },
                        ]}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <NumInput label="起始 (eV)" value={currentParams.norm_x_start ?? beMin} onChange={v => set('norm_x_start')(v)} step={0.1} />
                        <NumInput label="結束 (eV)" value={currentParams.norm_x_end ?? beMax} onChange={v => set('norm_x_end')(v)} step={0.1} />
                      </div>
                    </>
                  )}
                </Section>

                <Section step={7} title={overlayNonAverageMode ? '峰擬合（疊圖不平均停用）' : '峰擬合'} hint="元素資料庫選峰 / 手動新增 / Voigt" defaultOpen={false}>
                  {overlayNonAverageMode && (
                    <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-3 text-[10px] leading-5 text-amber-300">
                      不平均疊圖模式下會同時存在多條處理後光譜，峰擬合與 RSF 需要單一輸入光譜，因此這裡先鎖定。請啟用「平均所有疊圖數據」，或切回單筆資料後再擬合。
                    </div>
                  )}
                  <div className={overlayNonAverageMode ? 'hidden' : 'space-y-3'}>
                  <CustomSelect label="峰形" value={fitProfile} onChange={setFitProfile}
                    options={[{ value: 'voigt', label: 'Voigt' }, { value: 'gaussian', label: 'Gaussian' }, { value: 'lorentzian', label: 'Lorentzian' }]}
                  />
                  <div className="space-y-2">
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <CustomSelect
                          label="從元素資料庫載入"
                          value={selectedElement}
                          onChange={setSelectedElement}
                          options={[
                            { value: '', label: '選擇元素…' },
                            ...elementsList.filter(el => el.has_peaks).map(el => ({ value: el.symbol, label: `${el.symbol} — ${el.name}` })),
                          ]}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={loadElementPeaks}
                        disabled={!selectedElement || elementsLoading}
                        className="mb-0 rounded-lg border border-[var(--accent-strong)] px-3 py-1.5 text-xs text-[var(--accent-strong)] hover:bg-[var(--accent-soft)] disabled:opacity-50 pressable"
                      >
                        {elementsLoading ? '…' : '載入'}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPeriodicTableOpen(true)}
                    className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-3 text-left text-sm text-[var(--text-main)] hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)] pressable"
                  >
                    <span className="block font-medium">元素週期表</span>
                    <span className="mt-1 block text-xs text-[var(--text-soft)]">
                      {selectedElement ? `目前選擇：${selectedElement}` : '點開後在主頁覆蓋層中選元素'}
                    </span>
                  </button>
                  <button type="button" onClick={addManualPeak}
                    className="w-full rounded-lg border border-dashed border-[var(--card-border)] py-2 text-xs text-[var(--text-soft)] hover:border-[var(--accent-strong)] hover:text-[var(--text-main)]"
                  >
                    + 手動新增峰
                  </button>
                  {peakCandidates.map(pk => (
                    <div
                      key={pk.id}
                      className={[
                        'rounded-xl p-3 text-xs space-y-2 transition-all duration-150',
                        pk.enabled
                          ? 'border border-[color:color-mix(in_srgb,var(--accent-secondary)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_7%,var(--card-bg))] [box-shadow:0_2px_10px_-2px_color-mix(in_srgb,var(--accent-secondary)_20%,transparent)]'
                          : 'border border-[var(--card-border)] bg-[var(--card-bg)]',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, enabled: !p.enabled } : p))}
                          className={[
                            'flex items-center gap-2 text-xs font-medium transition-colors duration-150',
                            pk.sourceType === 'manual' ? 'shrink-0' : 'flex-1',
                            pk.enabled ? 'text-[var(--accent-secondary)]' : 'text-[var(--text-soft)] hover:text-[var(--text-main)]',
                          ].join(' ')}
                        >
                          <span className={[
                            'h-2.5 w-2.5 shrink-0 rounded-full transition-all duration-150',
                            pk.enabled
                              ? 'bg-[var(--accent-secondary)] [box-shadow:0_0_6px_color-mix(in_srgb,var(--accent-secondary)_70%,transparent)]'
                              : 'border border-[var(--card-border)]',
                          ].join(' ')} />
                          {pk.sourceType !== 'manual' && pk.label}
                        </button>
                        {pk.sourceType === 'manual' && (
                          <input
                            type="text"
                            value={pk.label}
                            onChange={e => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, label: e.target.value } : p))}
                            disabled={pk.cardLocked}
                            placeholder="峰名稱"
                            className="flex-1 min-w-0 rounded border border-[var(--input-border)] bg-transparent px-2 py-0.5 text-xs font-medium text-[var(--text-main)] focus:outline-none focus:border-[var(--accent-secondary)] disabled:opacity-40"
                          />
                        )}
                        <button
                          type="button"
                          title={pk.cardLocked ? '點擊解鎖以編輯約束條件' : '點擊鎖定（防止誤觸）'}
                          onClick={() => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, cardLocked: !p.cardLocked } : p))}
                          className={[
                            'flex h-6 w-6 items-center justify-center rounded-full text-sm transition-colors',
                            pk.cardLocked
                              ? 'bg-[color:color-mix(in_srgb,var(--accent-secondary)_18%,transparent)] text-[var(--accent-secondary)]'
                              : 'border border-[var(--card-border)] text-[var(--text-soft)] hover:text-amber-400',
                          ].join(' ')}
                        >
                          {pk.cardLocked ? '🔒' : '🔓'}
                        </button>
                        {(pk.originalCenter != null || pk.originalFwhm != null || pk.originalAmplitude != null) && (
                          <button
                            type="button"
                            title="重設為初始值"
                            onClick={() => setPeakCandidates(prev => prev.map(p => p.id !== pk.id ? p : {
                              ...p,
                              center: p.originalCenter ?? p.center,
                              fwhm: p.originalFwhm ?? p.fwhm,
                              amplitude: p.originalAmplitude ?? p.amplitude,
                            }))}
                            className="text-sky-400 hover:text-sky-300 text-xs px-1"
                          >↺</button>
                        )}
                        <button type="button" onClick={() => setPeakCandidates(prev => prev.filter(p => p.id !== pk.id))} className="text-rose-400 hover:text-rose-300">✕</button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full border border-[var(--card-border)] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-[var(--text-soft)]">
                          {pk.sourceType === 'database' ? '理論峰' : '手動峰'}
                        </span>
                        <button
                          type="button"
                          disabled={pk.cardLocked}
                          onClick={() => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, lock_center: !p.lock_center } : p))}
                          className={[
                            'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors',
                            pk.cardLocked ? 'opacity-35 cursor-not-allowed border border-[var(--card-border)] text-[var(--text-soft)]' :
                            pk.lock_center
                              ? 'bg-[var(--accent-soft)] text-[var(--accent-secondary)]'
                              : 'border border-[var(--card-border)] text-[var(--text-soft)] hover:text-[var(--text-main)]',
                          ].join(' ')}
                        >
                          {pk.lock_center ? '中心固定' : '中心可調'}
                        </button>
                        <button
                          type="button"
                          disabled={pk.cardLocked}
                          onClick={() => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, lock_fwhm: !p.lock_fwhm } : p))}
                          className={[
                            'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors',
                            pk.cardLocked ? 'opacity-35 cursor-not-allowed border border-[var(--card-border)] text-[var(--text-soft)]' :
                            pk.lock_fwhm
                              ? 'bg-[var(--accent-soft)] text-[var(--accent-secondary)]'
                              : 'border border-[var(--card-border)] text-[var(--text-soft)] hover:text-[var(--text-main)]',
                          ].join(' ')}
                        >
                          {pk.lock_fwhm ? '寬度固定' : '寬度可調'}
                        </button>
                        <button
                          type="button"
                          disabled={pk.cardLocked}
                          onClick={() => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, lock_area: !p.lock_area } : p))}
                          className={[
                            'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors',
                            pk.cardLocked ? 'opacity-35 cursor-not-allowed border border-[var(--card-border)] text-[var(--text-soft)]' :
                            pk.lock_area
                              ? 'bg-[var(--accent-soft)] text-[var(--accent-secondary)]'
                              : 'border border-[var(--card-border)] text-[var(--text-soft)] hover:text-[var(--text-main)]',
                          ].join(' ')}
                        >
                          {pk.lock_area ? '高度固定' : '高度可調'}
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <NumInput label="中心 (eV)" value={pk.center} onChange={v => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? updatePeakCenterSeed(p, v, fitTargetPeakScale) : p))} step={0.1} />
                        <NumInput label="FWHM (eV)" value={pk.fwhm} onChange={v => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? updatePeakFwhmSeed(p, v, fitTargetPeakScale) : p))} min={0.01} step={0.1} />
                        <NumInput label="強度" value={pk.amplitude} onChange={v => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? updatePeakAmplitudeSeed(p, v, fitTargetPeakScale) : p))} min={0} step={100} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <PeakConstraintInput
                          label="中心限制"
                          peak={pk}
                          target="center"
                          disabled={pk.cardLocked}
                          onApply={text => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? applyPeakConstraintText(p, 'center', text, fitTargetPeakScale) : p))}
                        />
                        <PeakConstraintInput
                          label="FWHM限制"
                          peak={pk}
                          target="fwhm"
                          disabled={pk.cardLocked}
                          onApply={text => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? applyPeakConstraintText(p, 'fwhm', text, fitTargetPeakScale) : p))}
                        />
                      </div>
                      <p className="text-[10px] leading-5 text-[var(--text-soft)]">
                        {pk.lock_center
                          ? `中心將固定在 ${pk.center.toFixed(2)} eV`
                          : `中心可在 ${(pk.center_min ?? pk.center).toFixed(2)} – ${(pk.center_max ?? pk.center).toFixed(2)} eV 內位移`}
                        {' · '}
                        {pk.lock_fwhm
                          ? `FWHM 固定為 ${pk.fwhm.toFixed(2)} eV`
                          : `FWHM 可在 ${(pk.fwhm_min ?? pk.fwhm).toFixed(2)} – ${(pk.fwhm_max ?? pk.fwhm).toFixed(2)} eV 內調整`}
                        {' · '}
                        {pk.lock_area
                          ? `高度固定為 ${pk.amplitude.toFixed(0)}`
                          : `高度上限約 ${(pk.amplitude_max ?? pk.amplitude).toFixed(0)}`}
                      </p>
                    </div>
                  ))}
                  {peakCandidates.length > 0 && (
                    <>
                      <p className="text-[10px] leading-5 text-[var(--text-soft)]">
                        中心限制與 FWHM限制可填單一數值固定，或填 1~1.8 這類範圍；你仍可先手動改 seed。若同時放開多個峰，系統會自動維持最小峰距，避免峰位互相交叉。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setPeakCandidates(prev => prev.map(pk => ({
                            ...pk,
                            center: pk.originalCenter ?? pk.center,
                            fwhm: pk.originalFwhm ?? pk.fwhm,
                            amplitude: pk.originalAmplitude ?? pk.amplitude,
                          })))}
                          className="text-xs text-sky-400 hover:text-sky-300"
                          title="重設所有峰的中心/FWHM/強度回初始值"
                        >↺ 重設所有峰</button>
                        {peakCandidates.length > 1 && (
                          <button type="button" onClick={() => setPeakCandidates([])} className="text-xs text-rose-400 hover:text-rose-300">清除全部峰</button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-soft)] shrink-0">嘗試次數</span>
                        {([1, 3, 5] as const).map(n => (
                          <button key={n} type="button" onClick={() => setFitNRestarts(n)}
                            className={['rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors',
                              fitNRestarts === n
                                ? 'bg-[var(--accent-soft)] text-[var(--accent-secondary)]'
                                : 'border border-[var(--card-border)] text-[var(--text-soft)] hover:text-[var(--text-main)]'
                            ].join(' ')}
                          >{n}</button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={handleFit} disabled={isFitting || autoConverging}
                          className="flex-1 rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
                        >
                          {isFitting && !autoConverging ? `擬合中… ${fitNRestarts > 1 ? `(最多 ${fitNRestarts} 次)` : ''}` : '執行擬合'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setFitHistory([]); void handleAutoConverge() }}
                          disabled={isFitting || autoConverging}
                          title="自動重複擬合直到 R² 不再提升（最多 10 次）"
                          className="rounded-lg border border-[var(--accent-secondary)] px-3 py-2 text-xs font-medium text-[var(--accent-secondary)] hover:opacity-80 disabled:opacity-50"
                        >
                          {autoConverging ? '收斂中…' : '自動收斂'}
                        </button>
                      </div>
                      {fitHistory.length > 0 && (
                        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-2">
                          <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">收斂歷史</p>
                          <div className="flex flex-wrap gap-1">
                            {fitHistory.map(h => (
                              <span key={h.iter} className={[
                                'rounded-full px-2 py-0.5 text-[10px] font-mono',
                                h.r2 >= 0.99 ? 'bg-emerald-500/10 text-emerald-400'
                                : h.r2 >= 0.97 ? 'bg-sky-500/10 text-sky-400'
                                : h.r2 >= 0.90 ? 'bg-amber-500/10 text-amber-400'
                                : 'bg-rose-500/10 text-rose-400',
                              ].join(' ')}>
                                #{h.iter} R²={formatMetric(h.r2, 4)}
                                {h.iter > 1 && ` Δ${h.delta < 1e-5 ? h.delta.toExponential(1) : h.delta.toFixed(5)}`}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  </div>
                  {!overlayNonAverageMode && fitError && <p className="text-xs text-rose-400">{fitError}</p>}
                </Section>

                {xpsMode === 'valence_band' && (
                  <Section step={8} title="VBM 線性外推" hint="切線 x 基準線交點" defaultOpen={false}>
                    <p className="text-[10px] text-[var(--text-soft)]">先把你輸入的兩個 x 值映射到光譜點，再以各點附近 20% 搜尋窗挑選切線與基準線用點；切線取最大正斜率，基準線取最平斜率，兩條線交點就是 VBM。</p>

                    {/* data source toggle */}
                    <div className="flex rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-1 gap-1">
                      {(['pipeline', 'imported'] as const).map(src => (
                        <button key={src} type="button"
                          onClick={() => setVbmDataSource(src)}
                          className={['flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors',
                            vbmDataSource === src
                              ? 'bg-[var(--accent-soft)] text-[var(--accent-secondary)]'
                              : 'text-[var(--text-soft)] hover:text-[var(--text-main)]',
                          ].join(' ')}
                        >
                          {src === 'pipeline' ? '處理流程結果' : '匯入已處理光譜'}
                        </button>
                      ))}
                    </div>

                    {/* import file picker */}
                    {vbmDataSource === 'imported' && (
                      <div className="space-y-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3 text-xs">
                        <p className="text-[var(--text-soft)]">支援 CSV / TXT，第一欄為 x（eV），第二欄為 intensity；自動跳過 # 開頭注釋行。</p>
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[var(--card-border)] px-3 py-2 text-[var(--text-soft)] hover:border-[var(--accent-secondary)] hover:text-[var(--accent-secondary)] transition-colors">
                          <span>＋ 選擇檔案</span>
                          <input type="file" accept=".csv,.txt,.dat" className="hidden"
                            onChange={async e => {
                              const file = e.target.files?.[0]
                              if (!file) return
                              setImportedVbmError(null)
                              try {
                                const text = await file.text()
                                const parsed = parseTwoColumnText(text, file.name)
                                if (!parsed) { setImportedVbmError('無法解析：需要至少 3 個有效數據點（兩欄數值）'); return }
                                setImportedVbmDataset(parsed)
                              } catch { setImportedVbmError('讀取檔案失敗') }
                            }}
                          />
                        </label>
                        {importedVbmError && <p className="text-rose-400">{importedVbmError}</p>}
                        {importedVbmDataset && (
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-[var(--text-main)]">{importedVbmDataset.name}</p>
                              <p className="text-[var(--text-soft)]">{importedVbmDataset.x.length} 點 · {Math.min(...importedVbmDataset.x).toFixed(2)}–{Math.max(...importedVbmDataset.x).toFixed(2)} eV</p>
                            </div>
                            <button type="button" onClick={() => setImportedVbmDataset(null)}
                              className="shrink-0 rounded-lg border border-rose-500/30 px-2 py-1 text-rose-400 hover:bg-rose-500/10 text-[10px]">移除</button>
                          </div>
                        )}
                      </div>
                    )}

                    {effectiveVbmDataset ? (
                      <div className="space-y-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3 text-xs">
                        {processingViewMode === 'overlay' && (
                          <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-[11px] text-[var(--text-soft)]">
                            疊圖模式下，VBM 線性外推目前會使用{overlayState.params.average ? '平均後光譜' : '第一筆疊圖資料'}做預覽與畫線。
                          </div>
                        )}
                        <p className="font-semibold text-[var(--text-main)]">Leading edge 提示</p>
                        <div className="grid gap-2 md:grid-cols-2">
                          <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">全域光譜</p>
                            <p className="mt-1 text-[var(--text-main)]">
                              最高點：{vbmGlobalExtrema ? `${vbmGlobalExtrema.maxPoint.x.toFixed(3)} eV / ${vbmGlobalExtrema.maxPoint.y.toFixed(2)}` : 'N/A'}
                            </p>
                            <p className="text-[var(--text-soft)]">
                              最低點：{vbmGlobalExtrema ? `${vbmGlobalExtrema.minPoint.x.toFixed(3)} eV / ${vbmGlobalExtrema.minPoint.y.toFixed(2)}` : 'N/A'}
                            </p>
                          </div>
                          <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">切線區間內</p>
                            <p className="mt-1 text-[var(--text-main)]">
                              最高點：{vbmEdgeExtrema ? `${vbmEdgeExtrema.maxPoint.x.toFixed(3)} eV / ${vbmEdgeExtrema.maxPoint.y.toFixed(2)}` : '區間內無有效點'}
                            </p>
                            <p className="text-[var(--text-soft)]">
                              最低點：{vbmEdgeExtrema ? `${vbmEdgeExtrema.minPoint.x.toFixed(3)} eV / ${vbmEdgeExtrema.minPoint.y.toFixed(2)}` : '區間內無有效點'}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3 text-xs text-[var(--text-soft)]">
                        {vbmDataSource === 'imported' ? '請先匯入光譜檔案。' : '請先載入可用的 Valence Band 光譜，系統才會提示 leading edge 的高低點並畫出切線/基準線。'}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="切線起 (eV)" value={vbmEdgeLo} onChange={setVbmEdgeLo} step={0.1} />
                      <NumInput label="切線終 (eV)" value={vbmEdgeHi} onChange={setVbmEdgeHi} step={0.1} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="基準起 (eV)" value={vbmBaselineLo} onChange={setVbmBaselineLo} step={0.1} />
                      <NumInput label="基準終 (eV)" value={vbmBaselineHi} onChange={setVbmBaselineHi} step={0.1} />
                    </div>
                    {vbmPreviewVbm !== null && (
                      <p className="text-xs text-[var(--text-soft)]">
                        預覽 VBM ≈ <span className={`font-semibold ${vbmPreviewVbm.x < 0 ? 'text-amber-400' : 'text-green-400'}`}>{vbmPreviewVbm.x.toFixed(3)} eV</span>
                        {vbmPreviewVbm.x < 0 && <span className="text-amber-400"> ⚠ 負值</span>}
                      </p>
                    )}
                    <div className="grid gap-2 md:grid-cols-2">
                      {[
                        { label: '切線擬合', tone: '#f97316', slopeLabel: '最大正斜率', line: vbmPreviewTangent },
                        { label: '基準線擬合', tone: '#a855f7', slopeLabel: '最平斜率', line: vbmPreviewBaselineLine },
                      ].map(item => (
                        <div key={item.label} className="rounded-xl border border-[var(--card-border)] bg-black/10 p-3 text-[11px]">
                          <p className="font-semibold" style={{ color: item.tone }}>{item.label}</p>
                          {item.line ? (
                            <div className="mt-1 space-y-1 text-[var(--text-soft)]">
                              <p>{item.slopeLabel}：{item.line.slope.toFixed(5)}</p>
                              <p>輸入點對應：({item.line.anchor_start_point.x.toFixed(3)}, {item.line.anchor_start_point.y.toFixed(3)}) → ({item.line.anchor_end_point.x.toFixed(3)}, {item.line.anchor_end_point.y.toFixed(3)})</p>
                              <p>實際選點：({item.line.start_point.x.toFixed(3)}, {item.line.start_point.y.toFixed(3)}) → ({item.line.end_point.x.toFixed(3)}, {item.line.end_point.y.toFixed(3)})</p>
                              <p>搜尋窗：起點 {item.line.start_window_point_count} 點 / 終點 {item.line.end_window_point_count} 點</p>
                              <p>候選組合：{item.line.candidate_pair_count} 組</p>
                            </div>
                          ) : (
                            <p className="mt-1 text-[var(--text-soft)]">區間內有效點數不足</p>
                          )}
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={computeVbmFn} disabled={vbmLoading || !effectiveVbmDataset}
                      className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 pressable"
                    >
                      {vbmLoading ? '計算中…' : '計算 VBM（後端確認）'}
                    </button>
                    {vbmError && <p className="text-xs text-rose-400">{vbmError}</p>}
                    {vbmResult?.success && (
                      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--accent-soft)] p-3 text-xs space-y-2">
                        <p className="font-semibold text-[var(--text-main)]">VBM = {vbmResult.vbm_ev?.toFixed(3)} eV</p>
                        <p className="text-[var(--text-soft)]">
                          交點算法：輸入點附近 20% 搜尋窗選點後，以切線最大正斜率 x 基準線最平斜率聯立
                        </p>
                        <div className="grid gap-2 md:grid-cols-2">
                          <div className="rounded-lg border border-[var(--card-border)] bg-black/10 p-2">
                            <p className="font-medium text-[var(--text-main)]">切線</p>
                            <p className="text-[var(--text-soft)]">最大正斜率：{vbmResult.slope.toFixed(5)}</p>
                            <p className="text-[var(--text-soft)]">
                              輸入點對應：{vbmResult.edge_line ? `(${vbmResult.edge_line.anchor_start_point.x.toFixed(3)}, ${vbmResult.edge_line.anchor_start_point.y.toFixed(3)}) -> (${vbmResult.edge_line.anchor_end_point.x.toFixed(3)}, ${vbmResult.edge_line.anchor_end_point.y.toFixed(3)})` : 'N/A'}
                            </p>
                            <p className="text-[var(--text-soft)]">
                              實際選點：{vbmResult.edge_line ? `(${vbmResult.edge_line.start_point.x.toFixed(3)}, ${vbmResult.edge_line.start_point.y.toFixed(3)}) -> (${vbmResult.edge_line.end_point.x.toFixed(3)}, ${vbmResult.edge_line.end_point.y.toFixed(3)})` : 'N/A'}
                            </p>
                            <p className="text-[var(--text-soft)]">
                              搜尋窗：{vbmResult.edge_line ? `${vbmResult.edge_line.start_window_point_count} / ${vbmResult.edge_line.end_window_point_count} 點` : 'N/A'}
                            </p>
                          </div>
                          <div className="rounded-lg border border-[var(--card-border)] bg-black/10 p-2">
                            <p className="font-medium text-[var(--text-main)]">基準線</p>
                            <p className="text-[var(--text-soft)]">最平斜率：{vbmResult.baseline_slope.toFixed(5)}</p>
                            <p className="text-[var(--text-soft)]">平均強度：{vbmResult.baseline_level.toFixed(3)}</p>
                            <p className="text-[var(--text-soft)]">
                              輸入點對應：{vbmResult.baseline_line ? `(${vbmResult.baseline_line.anchor_start_point.x.toFixed(3)}, ${vbmResult.baseline_line.anchor_start_point.y.toFixed(3)}) -> (${vbmResult.baseline_line.anchor_end_point.x.toFixed(3)}, ${vbmResult.baseline_line.anchor_end_point.y.toFixed(3)})` : 'N/A'}
                            </p>
                            <p className="text-[var(--text-soft)]">
                              實際選點：{vbmResult.baseline_line ? `(${vbmResult.baseline_line.start_point.x.toFixed(3)}, ${vbmResult.baseline_line.start_point.y.toFixed(3)}) -> (${vbmResult.baseline_line.end_point.x.toFixed(3)}, ${vbmResult.baseline_line.end_point.y.toFixed(3)})` : 'N/A'}
                            </p>
                            <p className="text-[var(--text-soft)]">
                              搜尋窗：{vbmResult.baseline_line ? `${vbmResult.baseline_line.start_window_point_count} / ${vbmResult.baseline_line.end_window_point_count} 點` : 'N/A'}
                            </p>
                          </div>
                        </div>
                        {vbmResult.vbm_ev !== null && vbmResult.vbm_ev < 0 && (
                          <p className="text-amber-400 font-medium">⚠ VBM 為負值（低於費米能階），可能是切線區間未落在 Fermi edge 的線性上升段，請手動調整。</p>
                        )}
                      </div>
                    )}
                  </Section>
                )}

                {xpsMode === 'valence_band' && (
                  <Section step={9} title="能帶偏移" hint="VBM 差值法 / Kraut Method" defaultOpen={false}>
                    <CustomSelect label="方法" value={bandOffsetMethod}
                      onChange={v => setBandOffsetMethod(v as 'vbm_diff' | 'kraut')}
                      options={[{ value: 'vbm_diff', label: 'VBM 差值法' }, { value: 'kraut', label: 'Kraut Method' }]}
                    />
                    {bandOffsetMethod === 'vbm_diff' && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput label="VBM_A (eV)" value={boVbmA} onChange={setBoVbmA} step={0.01} />
                          <NumInput label="σ_A (eV)" value={boSigmaA} onChange={setBoSigmaA} min={0} step={0.001} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput label="VBM_B (eV)" value={boVbmB} onChange={setBoVbmB} step={0.01} />
                          <NumInput label="σ_B (eV)" value={boSigmaB} onChange={setBoSigmaB} min={0} step={0.001} />
                        </div>
                        <p className="text-[10px] text-[var(--text-soft)]">ΔEV = VBM_A − VBM_B</p>
                      </>
                    )}
                    {bandOffsetMethod === 'kraut' && (
                      <>
                        <p className="text-[10px] text-[var(--text-soft)]">ΔEV = (CL_A − VBM_A) − (CL_B − VBM_B) − (CL_A_int − CL_B_int)</p>
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput label="CL_A 純樣 (eV)" value={boClA} onChange={setBoClA} step={0.01} />
                          <NumInput label="VBM_A 純樣 (eV)" value={boVbmAPure} onChange={setBoVbmAPure} step={0.01} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput label="CL_B 純樣 (eV)" value={boClB} onChange={setBoClB} step={0.01} />
                          <NumInput label="VBM_B 純樣 (eV)" value={boVbmBPure} onChange={setBoVbmBPure} step={0.01} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput label="CL_A 介面 (eV)" value={boClAInt} onChange={setBoClAInt} step={0.01} />
                          <NumInput label="CL_B 介面 (eV)" value={boClBInt} onChange={setBoClBInt} step={0.01} />
                        </div>
                      </>
                    )}
                    <button type="button" onClick={computeBandOffset}
                      className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:opacity-90 pressable"
                    >
                      計算能帶偏移
                    </button>
                    {bandOffsetResult && (
                      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--accent-soft)] p-3 text-xs space-y-1">
                        <p className="font-semibold text-[var(--text-main)]">ΔEV = {bandOffsetResult.deltaEv.toFixed(3)} eV
                          {bandOffsetResult.sigmaEv > 0 && ` ± ${bandOffsetResult.sigmaEv.toFixed(3)} eV`}
                        </p>
                      </div>
                    )}
                  </Section>
                )}
              </div>
            </div>
          </>
        )}
        {!sidebarCollapsed && (
          <div onMouseDown={startResize} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-[var(--accent-soft)]" />
        )}
      </aside>

      {/* ── main content ── */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--bg-canvas)] p-4 sm:p-5">
        <ModuleTopBar
          title={moduleContent.title}
          subtitle={moduleContent.subtitle}
          description={moduleContent.description}
          chips={[
            { label: `資料量 ${rawFiles.length}` },
            { label: `模式 ${XPS_MODE_LABELS[xpsMode]}` },
            { label: `峰候選 ${peakCandidates.length}` },
          ]}
        />

        <InfoCardGrid
          items={[
            { label: '資料量', value: rawFiles.length > 0 ? `${rawFiles.length} 個` : '未載入' },
            { label: '分析模式', value: XPS_MODE_LABELS[xpsMode] },
            {
              label: '內插點數',
              value: currentParams.interpolate || (processingViewMode === 'overlay' && currentParams.average) ? `${effectiveNPoints} 點` : '未啟用',
            },
          ]}
        />

        {error && (
          <div className="mb-4 rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">⚠ {error}</div>
        )}
        {isBusy && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-strong)]" /> 處理中…
          </div>
        )}

        {xpsMode === 'dft' && (
          <div className="analysis-section-card mb-4 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--text-main)]">Valence Band DFT-informed Analyzer</p>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-soft)]">
                  Ga2O3/NiO/p-Si XPS valence band spectra 專用工具，支援 VBM 對齊、A-D 區域積分、DFT pDOS cross-section correction、
                  Gaussian/Lorentzian/Voigt broadening、non-negative pDOS fitting 與 Markdown/HTML report 匯出。
                </p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs ${dftUnlocked ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/40 bg-amber-400/10 text-amber-200'}`}>
                {dftUnlocked ? '已解鎖' : '需要密碼'}
              </span>
            </div>

            {!dftUnlocked ? (
              <div className="max-w-md space-y-3">
                <input
                  type="password"
                  value={dftPassword}
                  onChange={event => {
                    setDftPassword(event.target.value)
                    setDftPasswordError(null)
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') unlockDftAnalyzer()
                  }}
                  placeholder="輸入密碼以使用 DFT 模組"
                  className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-strong)]"
                />
                {dftPasswordError && <p className="text-xs text-rose-300">{dftPasswordError}</p>}
                <button
                  type="button"
                  onClick={unlockDftAnalyzer}
                  className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-85"
                >
                  解鎖
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]">
                  <iframe
                    title="Valence Band DFT-informed Analyzer"
                    src={DFT_STREAMLIT_URL}
                    className="h-[72vh] min-h-[620px] w-full bg-white"
                    loading="lazy"
                  />
                </div>
                <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-xs leading-5 text-[var(--text-soft)]">
                  <p className="mb-2 font-semibold text-[var(--text-main)]">DFT-informed，不是 DFT 計算</p>
                  <p>
                    內嵌視窗預設連線至 {DFT_STREAMLIT_URL}。若視窗未載入，請確認 Streamlit 服務已啟動；所有圖表與光譜資料匯出皆以 X 軸大值在左、小值在右為準。
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {xpsMode !== 'dft' && !hasXpsWorkspaceData && !isBusy && (
          <EmptyWorkspaceState
            module="xps"
            title={moduleContent.uploadTitle}
            description="左側已提供 Core Level / Valence Band 切換、Shirley / Tougaard 背景、Voigt 擬合與 chemical state 分析。上傳後會在這裡顯示 XPS 光譜與定量結果。"
            formats={moduleContent.formats}
          />
        )}

        {xpsMode !== 'dft' && hasXpsWorkspaceData && (
          <>
            {rawChartTraces.length > 0 && showRawSpectrumCard && (
              <div className="analysis-section-card mb-4 p-4">
                <p className="mb-2 text-sm font-semibold text-[var(--text-main)]">原始光譜</p>
                {rawChartSourceFiles.length > 0 && (
                  <div className="mb-3">
                    <SeriesColorControls
                      items={rawSeriesItems}
                      colorKeys={rawSeriesColorKeys}
                      onColorChange={handleSeriesColorChange}
                      activeName={rawChartSourceFiles[rawChartActiveIndex]?.name ?? null}
                    />
                  </div>
                )}
                <Plot
                  data={applyHidden(rawChartTraces as Plotly.Data[], rawHidden)}
                  layout={chartLayout() as Plotly.Layout}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 340 }}
                  onLegendClick={makeLegendClick(setRawHidden) as never}
                  onLegendDoubleClick={() => false}
                />
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(rawStageDatasets, 'binding_energy_eV', 'intensity_raw'), 'xps_raw_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}

            {/* ── overlay: preprocess stage ── */}
            {overlayPreprocessDatasets.length >= overlayMinCount && (overlayState.params.interpolate || overlayState.params.average || Math.abs(overlayState.params.energy_shift) > 1e-8) && (
              <div className="analysis-section-card mb-4 p-4">
                <ChartToolbar
                  title={overlayState.params.average ? '多筆疊圖：內插 / 平均 / 校正後' : '多筆疊圖：內插 / 校正後'}
                  colorValue={chartLineColors.overlay}
                  onColorChange={value => {
                    setChartLineColors(current => ({ ...current, overlay: value }))
                    applyOverlayPalette(value)
                  }}
                />
                <div className="mb-3">
                  <SeriesColorControls
                    items={overlaySeriesItems}
                    colorKeys={overlaySeriesColorKeys}
                    onColorChange={handleSeriesColorChange}
                  />
                </div>
                <p className="mb-3 text-xs text-[var(--text-soft)]">
                  {overlayState.params.average ? '多檔平均光譜在背景扣除前的前處理結果。' : '各筆資料在背景扣除前的前處理結果疊圖。'}
                </p>
                <Plot
                  data={applyHidden(buildOverlayTracesWithSeriesColors(overlayPreprocessDatasets, getDatasetColorKey) as Plotly.Data[], overlayHidden)}
                  layout={chartLayout() as Plotly.Layout}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 340 }}
                  onLegendClick={makeLegendClick(setOverlayHidden) as never}
                  onLegendDoubleClick={() => false}
                />
                <div className="mt-3 flex justify-start">
                  <ExportBtn label="下載此步驟 CSV" onClick={() => downloadFile(buildStageCsv(overlayPreprocessDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_overlay_preprocess.csv', 'text/csv')} />
                </div>
              </div>
            )}

            {/* ── overlay: background stage ── */}
            {overlayPreprocessDatasets.length >= overlayMinCount && overlayState.params.bg_enabled && (
              <div className="analysis-section-card mb-4 p-4">
                <ChartToolbar
                  title={overlayState.params.bg_enabled ? '多筆疊圖：背景扣除後' : '多筆疊圖：背景扣除（未啟用）'}
                  colorValue={chartLineColors.overlayBg}
                  onColorChange={value => {
                    setChartLineColors(current => ({ ...current, overlayBg: value }))
                    applyOverlayPalette(value)
                  }}
                />
                <div className="mb-3">
                  <SeriesColorControls
                    items={overlaySeriesItems}
                    colorKeys={overlaySeriesColorKeys}
                    onColorChange={handleSeriesColorChange}
                  />
                </div>
                <div className="mb-3 flex items-center gap-3">
                  <CheckRow label="顯示扣背景前" checked={showXpsBgBefore} onChange={setShowXpsBgBefore} />
                  <CheckRow label="顯示背景線" checked={showBg} onChange={setShowBg} />
                </div>
                <p className="mb-3 text-xs text-[var(--text-soft)]">
                  {overlayState.params.bg_enabled
                    ? `${overlayState.params.average ? '多檔平均光譜背景扣除後的結果。' : '各筆資料背景扣除後的結果疊圖。'}橘色區塊是目前設定的背景扣除區間。`
                    : '目前未啟用背景扣除，這一階段直接沿用前處理結果。'}
                </p>
                <Plot
                  data={applyHidden(buildOverlayBackgroundTracesWithSeriesColors(
                    overlayBackgroundProcessedDatasets.length >= overlayMinCount ? overlayBackgroundProcessedDatasets : overlayPreprocessProcessedDatasets,
                    getDatasetColorKey,
                    showXpsBgBefore,
                    showBg,
                  ) as Plotly.Data[], overlayBgHidden)}
                  layout={overlayBgLayout as Plotly.Layout}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 340 }}
                  onLegendClick={makeLegendClick(setOverlayBgHidden) as never}
                  onLegendDoubleClick={() => false}
                />
                {overlayState.params.bg_enabled && renderRangeControlCard(
                  '背景區間',
                  '看著疊圖調整共用背景範圍',
                  beMin,
                  beMax,
                  overlayState.params.bg_x_start ?? beMin,
                  overlayState.params.bg_x_end ?? beMax,
                  ({ start, end }) => {
                    setOverlayState(current => ({
                      ...current,
                      params: {
                        ...current.params,
                        bg_x_start: start,
                        bg_x_end: end,
                      },
                    }))
                  },
                )}
                <div className="mt-3 flex justify-start">
                  <ExportBtn label="下載此步驟 CSV" onClick={() => downloadFile(buildStageCsv(overlayBackgroundDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_overlay_bg.csv', 'text/csv')} />
                </div>
              </div>
            )}

            {/* ── overlay: effective range stage ── */}
            {overlayFinalDatasets.length >= overlayMinCount && overlayValidRangeDatasets.length >= overlayMinCount && overlayState.params.valid_range_enabled && (
              <div className="analysis-section-card mb-4 p-4">
                <ChartToolbar
                  title="多筆疊圖：有效數據範圍後"
                  colorValue={chartLineColors.overlayNorm}
                  onColorChange={value => {
                    setChartLineColors(current => ({ ...current, overlayNorm: value }))
                    applyOverlayPalette(value)
                  }}
                />
                <div className="mb-3">
                  <SeriesColorControls
                    items={overlaySeriesItems}
                    colorKeys={overlaySeriesColorKeys}
                    onColorChange={handleSeriesColorChange}
                  />
                </div>
                <p className="mb-3 text-xs text-[var(--text-soft)]">
                  {overlayState.params.average ? '多檔平均光譜裁切有效 BE 區間後的結果。' : '各筆資料裁切有效 BE 區間後的結果疊圖。'}藍色區塊是目前保留的有效資料範圍。
                </p>
                <Plot
                  data={applyHidden(buildOverlayTracesWithSeriesColors(overlayValidRangeDatasets, getDatasetColorKey) as Plotly.Data[], overlayValidRangeHidden)}
                  layout={overlayValidRangeLayout as Plotly.Layout}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 340 }}
                  onLegendClick={makeLegendClick(setOverlayValidRangeHidden) as never}
                  onLegendDoubleClick={() => false}
                />
                {renderRangeControlCard(
                  '有效數據範圍',
                  '共用這組 BE 區間裁切所有疊圖資料',
                  beMin,
                  beMax,
                  overlayState.params.valid_x_start ?? beMin,
                  overlayState.params.valid_x_end ?? beMax,
                  ({ start, end }) => {
                    setOverlayState(current => ({
                      ...current,
                      params: {
                        ...current.params,
                        valid_x_start: start,
                        valid_x_end: end,
                      },
                    }))
                  },
                )}
                <div className="mt-3 flex justify-start">
                  <ExportBtn label="下載此步驟 CSV" onClick={() => downloadFile(buildStageCsv(overlayValidRangeDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_overlay_valid_range.csv', 'text/csv')} />
                </div>
              </div>
            )}

            {/* ── overlay: normalization stage ── */}
            {overlayFinalDatasets.length >= overlayMinCount && overlayNormalizationDatasets.length >= overlayMinCount && hasNormalizationStage && (
              <div className="analysis-section-card mb-4 p-4">
                <ChartToolbar
                  title="多筆疊圖：歸一化後"
                  colorValue={chartLineColors.overlayNorm}
                  onColorChange={value => {
                    setChartLineColors(current => ({ ...current, overlayNorm: value }))
                    applyOverlayPalette(value)
                  }}
                />
                <div className="mb-3">
                  <SeriesColorControls
                    items={overlaySeriesItems}
                    colorKeys={overlaySeriesColorKeys}
                    onColorChange={handleSeriesColorChange}
                  />
                </div>
                <p className="mb-3 text-xs text-[var(--text-soft)]">
                  {overlayState.params.average ? '多檔平均光譜歸一化後的結果。' : '各筆資料歸一化後的結果疊圖。'}綠色區塊是目前設定的歸一化區間。
                </p>
                <Plot
                  data={applyHidden(buildOverlayTracesWithSeriesColors(overlayNormalizationDatasets, getDatasetColorKey) as Plotly.Data[], overlayNormHidden)}
                  layout={overlayNormLayout as Plotly.Layout}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 340 }}
                  onLegendClick={makeLegendClick(setOverlayNormHidden) as never}
                  onLegendDoubleClick={() => false}
                />
                {hasNormalizationStage && renderRangeControlCard(
                  '歸一化區間',
                  '共用這組區間套用到所有疊圖資料',
                  beMin,
                  beMax,
                  overlayState.params.norm_x_start ?? beMin,
                  overlayState.params.norm_x_end ?? beMax,
                  ({ start, end }) => {
                    setOverlayState(current => ({
                      ...current,
                      params: {
                        ...current.params,
                        norm_x_start: start,
                        norm_x_end: end,
                      },
                    }))
                  },
                )}
                <div className="mt-3 flex justify-start">
                  <ExportBtn label="下載此步驟 CSV" onClick={() => downloadFile(buildStageCsv(overlayNormalizationDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_overlay_norm.csv', 'text/csv')} />
                </div>
              </div>
            )}


            {processingViewMode === 'single' && hasPreprocessStage && preprocessChartTraces.length > 0 && (
              <div className="analysis-section-card mb-4 p-4">
                <ChartToolbar
                  title={stageDisplayLabel ? `${stageDisplayLabel}後` : '前處理後'}
                  colorValue={chartLineColors.preprocess}
                  onColorChange={value => setChartLineColors(current => ({ ...current, preprocess: value }))}
                />
                <p className="mb-3 text-xs text-[var(--text-soft)]">這張圖把原始光譜和前處理後結果疊在一起，方便對照點數與能量軸變化。</p>
                <Plot
                  data={applyHidden(preprocessChartTraces as Plotly.Data[], preprocessHidden)}
                  layout={chartLayout() as Plotly.Layout}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 340 }}
                  onLegendClick={makeLegendClick(setPreprocessHidden) as never}
                  onLegendDoubleClick={() => false}
                />
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(preprocessStageDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_preprocess_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}
            {processingViewMode === 'single' && backgroundChartTraces.length > 0 && hasBackgroundStage && (
              <div className="analysis-section-card mb-4 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <ChartToolbar
                      title="背景扣除"
                      colorValue={chartLineColors.background}
                      onColorChange={value => setChartLineColors(current => ({ ...current, background: value }))}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckRow label="顯示扣背景前" checked={showXpsBgBefore} onChange={setShowXpsBgBefore} />
                    <CheckRow label="顯示背景線" checked={showBg} onChange={setShowBg} />
                  </div>
                </div>
                <p className="mb-3 text-xs text-[var(--text-soft)]">輸入是前一階段的結果。圖上橘色區塊是你目前選擇的背景區間。</p>
                <Plot
                  data={applyHidden(backgroundChartTraces
                    .filter(t => showBg || t.name !== '背景線')
                    .filter(t => showXpsBgBefore || t.name !== '背景扣除前') as Plotly.Data[], bgHidden)}
                  layout={backgroundLayout as Plotly.Layout}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 340 }}
                  onLegendClick={makeLegendClick(setBgHidden) as never}
                  onLegendDoubleClick={() => false}
                />
                {hasBackgroundStage && renderRangeControlCard(
                  '背景區間',
                  '看著背景線與前後對照調整範圍',
                  bgDataXMin,
                  bgDataXMax,
                  currentParams.bg_x_start ?? bgDataXMin,
                  currentParams.bg_x_end ?? bgDataXMax,
                  ({ start, end }) => {
                    set('bg_x_start')(start)
                    set('bg_x_end')(end)
                  },
                )}
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(backgroundStageDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_background_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}

            {processingViewMode === 'single' && validRangeChartTraces.length > 0 && hasValidRangeStage && (
              <div className="analysis-section-card mb-4 p-4">
                <ChartToolbar
                  title="有效數據範圍"
                  colorValue={chartLineColors.normalization}
                  onColorChange={value => setChartLineColors(current => ({ ...current, normalization: value }))}
                />
                <p className="mb-3 text-xs text-[var(--text-soft)]">輸入是背景扣除後的光譜；若未啟用背景扣除，則直接使用前處理結果。藍色區塊是保留並送往後續步驟的有效資料範圍。</p>
                <Plot
                  data={applyHidden(validRangeChartTraces as Plotly.Data[], validRangeHidden)}
                  layout={validRangeLayout as Plotly.Layout}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 340 }}
                  onLegendClick={makeLegendClick(setValidRangeHidden) as never}
                  onLegendDoubleClick={() => false}
                />
                {renderRangeControlCard(
                  '有效數據範圍',
                  '直接在圖下微調要保留的 BE 區間',
                  validRangeDataXMin,
                  validRangeDataXMax,
                  currentParams.valid_x_start ?? validRangeDataXMin,
                  currentParams.valid_x_end ?? validRangeDataXMax,
                  ({ start, end }) => {
                    set('valid_x_start')(start)
                    set('valid_x_end')(end)
                  },
                )}
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(validRangeStageDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_valid_range_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}

            {processingViewMode === 'single' && normalizationChartTraces.length > 0 && hasNormalizationStage && (
              <div className="analysis-section-card mb-4 p-4">
                <ChartToolbar
                  title="歸一化"
                  colorValue={chartLineColors.normalization}
                  onColorChange={value => setChartLineColors(current => ({ ...current, normalization: value }))}
                />
                <p className="mb-3 text-xs text-[var(--text-soft)]">輸入是背景扣除後的光譜；若未啟用背景扣除，則直接使用前處理結果。綠色區塊是歸一化區間。</p>
                <Plot
                  data={applyHidden(normalizationChartTraces as Plotly.Data[], normHidden)}
                  layout={normalizationLayout as Plotly.Layout}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 340 }}
                  onLegendClick={makeLegendClick(setNormHidden) as never}
                  onLegendDoubleClick={() => false}
                />
                {hasNormalizationStage && renderRangeControlCard(
                  '歸一化區間',
                  '直接在圖下微調要採樣的能量範圍',
                  normDataXMin,
                  normDataXMax,
                  currentParams.norm_x_start ?? normDataXMin,
                  currentParams.norm_x_end ?? normDataXMax,
                  ({ start, end }) => {
                    set('norm_x_start')(start)
                    set('norm_x_end')(end)
                  },
                )}
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(normalizationStageDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_normalization_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}

            {currentDisplayDataset && (processingViewMode === 'single' ? result : fitTargetDataset) && showFinalSpectrumCard && (
              <div className="analysis-section-card mb-4 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <ChartToolbar
                      title={`最終處理光譜${currentFitResult ? '（含擬合結果）' : ''}`}
                      colorValue={chartLineColors.final}
                      onColorChange={value => setChartLineColors(current => ({ ...current, final: value }))}
                      actions={onOpenPlotPopup ? (
                        <button type="button" className="chart-popup-button" onClick={openFinalChartPopup}>
                          彈出圖表
                        </button>
                      ) : undefined}
                    />
                  </div>
                  {processingViewMode === 'single' ? (
                    <CheckRow label="顯示原始" checked={showRaw} onChange={setShowRaw} />
                  ) : (
                    <p className="text-xs text-[var(--text-soft)]">疊圖平均模式下這張圖顯示多檔平均後的單一結果。</p>
                  )}
                </div>
                {renderFinalChart()}
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(finalStageDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_final_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}

            {fitTargetDataset && currentFitResult && currentFitResult.peaks.length > 0 && (
              <div className="analysis-section-card mb-4 p-4">
                <p className="mb-2 text-sm font-semibold text-[var(--text-main)]">峰擬合光譜</p>
                <p className="mb-3 text-xs text-[var(--text-soft)]">
                  {processingViewMode === 'overlay'
                    ? '疊圖平均模式下這裡會直接對「多檔平均後的單一結果」做擬合，避免拿多條未平均光譜一起擬合。'
                    : '這張圖會獨立顯示擬合輸入、總擬合、各峰組件與殘差，避免只疊在最終圖上不明顯。'}
                </p>
                <Plot
                  data={applyHidden(buildFitTraces(fitTargetDataset, currentFitResult, chartLineColors.final) as Plotly.Data[], fitHidden)}
                  layout={chartLayout() as Plotly.Layout}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 380 }}
                  onLegendClick={makeLegendClick(setFitHidden) as never}
                  onLegendDoubleClick={() => false}
                />
              </div>
            )}

            {currentFitResult && currentFitResult.peaks.length > 0 && (() => {
              const r2 = currentFitResult.r_squared ?? 0
              const rmse = currentFitResult.rmse ?? 0
              const chiRed = currentFitResult.chi_red ?? null
              return (
              <div className="analysis-section-card mb-4 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-[var(--text-main)]">峰擬合結果</p>
                  <span className={[
                    'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
                    r2 >= 0.99 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : r2 >= 0.97 ? 'border-sky-500/40 bg-sky-500/10 text-sky-400'
                    : r2 >= 0.90 ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-400',
                  ].join(' ')}>
                    R² = {formatMetric(r2)}
                  </span>
                  <span className="rounded-full border border-[var(--card-border)] px-2.5 py-0.5 text-[11px] text-[var(--text-soft)]">
                    RMSE = {formatMetric(rmse)}
                  </span>
                  {chiRed != null && (
                    <span className="rounded-full border border-[var(--card-border)] px-2.5 py-0.5 text-[11px] text-[var(--text-soft)]">
                      χ²ᵣ = {formatMetric(chiRed)}
                    </span>
                  )}
                </div>
                <table className="analysis-data-table">
                  <thead>
                    <tr className="border-b border-[var(--card-divider)] text-[var(--text-soft)]">
                      <th className="pb-2 text-left font-medium">峰</th>
                      <th className="pb-2 text-right font-medium">中心 (eV)</th>
                      <th className="pb-2 text-right font-medium">FWHM (eV)</th>
                      <th className="pb-2 text-right font-medium">面積</th>
                      <th className="pb-2 text-right font-medium">面積 %</th>
                    </tr>
                  </thead>
                  <tbody className="text-[var(--text-main)]">
                    {currentFitResult.peaks.map(pk => (
                      <tr key={pk.Peak_Name} className="border-b border-[var(--card-divider)]">
                        <td className="py-1.5 font-medium">{pk.Peak_Name}</td>
                        <td className="py-1.5 text-right">{pk.Center_eV.toFixed(2)}</td>
                        <td className="py-1.5 text-right">{pk.FWHM_eV.toFixed(3)}</td>
                        <td className="py-1.5 text-right">{pk.Area.toFixed(1)}</td>
                        <td className="py-1.5 text-right">{pk.Area_pct?.toFixed(1) ?? '—'} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )
            })()}

            {xpsMode === 'valence_band' && effectiveVbmDataset && (
              <div className="analysis-section-card mb-4 p-4">
                <p className="mb-1 text-sm font-semibold text-[var(--text-main)]">VBM 線性外推圖</p>
                <p className="mb-3 text-xs text-[var(--text-soft)]">空心 marker 是你輸入 x 值對應到的光譜點，實心 marker 是在附近 20% 搜尋窗中實際被拿來畫線的點。</p>
                <Plot
                  data={(() => {
                    const lineXArr = vbmPlotWindow?.lineX ?? [effectiveVbmBeMin, effectiveVbmBeMax]
                    return [
                      { x: effectiveVbmDataset.x, y: effectiveVbmDataset.y_processed, type: 'scatter', mode: 'lines', name: '光譜', line: { color: '#38bdf8', width: 1.8 } },
                      ...(vbmPreviewTangent ? [
                        { x: [vbmPreviewTangent.anchor_start_point.x], y: [vbmPreviewTangent.anchor_start_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '切線輸入起點', marker: { color: '#f97316', size: 11, symbol: 'circle-open' as const, line: { color: '#f97316', width: 2 } } },
                        { x: [vbmPreviewTangent.anchor_end_point.x], y: [vbmPreviewTangent.anchor_end_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '切線輸入終點', marker: { color: '#fb923c', size: 11, symbol: 'circle-open' as const, line: { color: '#fb923c', width: 2 } } },
                        { x: [vbmPreviewTangent.start_point.x], y: [vbmPreviewTangent.start_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '切線實際起點', marker: { color: '#f97316', size: 9, symbol: 'circle' as const, line: { color: '#fff7ed', width: 1.5 } } },
                        { x: [vbmPreviewTangent.end_point.x], y: [vbmPreviewTangent.end_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '切線實際終點', marker: { color: '#fb923c', size: 9, symbol: 'circle' as const, line: { color: '#fff7ed', width: 1.5 } } },
                      ] : []),
                      ...(vbmPreviewTangent ? [
                        { x: lineXArr, y: lineXArr.map(xi => vbmPreviewTangent.slope * xi + vbmPreviewTangent.intercept), type: 'scatter' as const, mode: 'lines' as const, name: '切線 (外推)', line: { color: '#f97316', width: 2, dash: 'dash' as const } },
                      ] : []),
                      ...(vbmPreviewBaselineLine ? [
                        { x: [vbmPreviewBaselineLine.anchor_start_point.x], y: [vbmPreviewBaselineLine.anchor_start_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '基準輸入起點', marker: { color: '#a855f7', size: 11, symbol: 'square-open' as const, line: { color: '#a855f7', width: 2 } } },
                        { x: [vbmPreviewBaselineLine.anchor_end_point.x], y: [vbmPreviewBaselineLine.anchor_end_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '基準輸入終點', marker: { color: '#c084fc', size: 11, symbol: 'square-open' as const, line: { color: '#c084fc', width: 2 } } },
                        { x: [vbmPreviewBaselineLine.start_point.x], y: [vbmPreviewBaselineLine.start_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '基準實際起點', marker: { color: '#a855f7', size: 9, symbol: 'square' as const, line: { color: '#f5f3ff', width: 1.5 } } },
                        { x: [vbmPreviewBaselineLine.end_point.x], y: [vbmPreviewBaselineLine.end_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '基準實際終點', marker: { color: '#c084fc', size: 9, symbol: 'square' as const, line: { color: '#f5f3ff', width: 1.5 } } },
                        { x: lineXArr, y: lineXArr.map(xi => vbmPreviewBaselineLine.slope * xi + vbmPreviewBaselineLine.intercept), type: 'scatter' as const, mode: 'lines' as const, name: '基準線', line: { color: '#a855f7', width: 1.8, dash: 'dot' as const } },
                      ] : []),
                      ...(vbmPreviewVbm !== null ? [
                        { x: [vbmPreviewVbm.x], y: [vbmPreviewVbm.y], type: 'scatter' as const, mode: 'markers' as const, name: `VBM ≈ ${vbmPreviewVbm.x.toFixed(3)} eV`, marker: { color: '#22c55e', size: 11, symbol: 'diamond' as const } },
                      ] : []),
                    ] as Plotly.Data[]
                  })()}
                  layout={(() => {
                    const baseLayout = chartLayout() as Plotly.Layout
                    return {
                      ...baseLayout,
                      margin: { l: 60, r: 20, t: 20, b: 50 },
                      ...(vbmPlotWindow ? {
                        xaxis: {
                          ...(baseLayout.xaxis ?? {}),
                          autorange: false,
                          range: vbmPlotWindow.xAxisRange,
                        },
                        yaxis: {
                          ...(baseLayout.yaxis ?? {}),
                          autorange: false,
                          range: vbmPlotWindow.yAxisRange,
                        },
                      } : {}),
                      shapes: [
                        ...buildRegionShapes(Math.min(vbmEdgeLo, vbmEdgeHi), Math.max(vbmEdgeLo, vbmEdgeHi), '#f97316'),
                        ...buildRegionShapes(Math.min(vbmBaselineLo, vbmBaselineHi), Math.max(vbmBaselineLo, vbmBaselineHi), '#a855f7'),
                      ] as unknown as Plotly.Shape[],
                      annotations: [
                        ...buildRegionAnnotations(Math.min(vbmEdgeLo, vbmEdgeHi), Math.max(vbmEdgeLo, vbmEdgeHi), '切線區間', '#f97316'),
                        ...buildRegionAnnotations(Math.min(vbmBaselineLo, vbmBaselineHi), Math.max(vbmBaselineLo, vbmBaselineHi), '基準線區間', '#a855f7'),
                        ...(vbmPreviewVbm !== null ? [{
                          x: vbmPreviewVbm.x, y: vbmPreviewVbm.y,
                          text: `VBM ≈ ${vbmPreviewVbm.x.toFixed(3)} eV`,
                          showarrow: true, arrowhead: 2, ax: 50, ay: -35,
                          font: { color: '#22c55e', size: 11 }, arrowcolor: '#22c55e',
                        }] : []),
                      ],
                    }
                  })()}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 340 }}
                />
                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  {renderRangeControlCard(
                    '切線區間',
                    '看著 leading edge 直接微調切線範圍',
                    effectiveVbmBeMin,
                    effectiveVbmBeMax,
                    vbmEdgeLo,
                    vbmEdgeHi,
                    ({ start, end }) => {
                      setVbmEdgeLo(start)
                      setVbmEdgeHi(end)
                    },
                  )}
                  {renderRangeControlCard(
                    '基準線區間',
                    '在圖下調整 baseline 採樣範圍',
                    effectiveVbmBeMin,
                    effectiveVbmBeMax,
                    vbmBaselineLo,
                    vbmBaselineHi,
                    ({ start, end }) => {
                      setVbmBaselineLo(start)
                      setVbmBaselineHi(end)
                    },
                  )}
                </div>
                {vbmPreviewTangent && vbmPreviewBaselineLine && (
                  <div className="analysis-subcard mt-3 flex items-center justify-between px-4 py-2.5">
                    <div className="text-xs text-[var(--text-soft)]">
                      {vbmPreviewVbm !== null
                        ? <span>預覽 VBM = <span className={vbmPreviewVbm.x < 0 ? 'font-semibold text-amber-400' : 'font-semibold text-emerald-400'}>{vbmPreviewVbm.x.toFixed(3)} eV</span></span>
                        : '切線與基準線已就緒'}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowVbmExportPreview(true)}
                      className="rounded-full border border-[var(--accent-secondary)] px-4 py-1.5 text-[12px] font-semibold text-[var(--accent-secondary)] transition-colors hover:bg-[var(--accent-soft)] pressable"
                    >
                      ↓ 匯出 TXT（Origin Pro）
                    </button>
                  </div>
                )}
              </div>
            )}

            {processingViewMode === 'single' && xpsMode === 'valence_band' && bandOffsetResult && (
              <div className="analysis-section-card mb-4 p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">能帶偏移結果</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="analysis-subcard px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">ΔEV</p>
                    <p className="mt-1 text-xl font-semibold text-[var(--text-main)]">{bandOffsetResult.deltaEv.toFixed(3)} eV</p>
                    {bandOffsetResult.sigmaEv > 0 && <p className="text-[11px] text-[var(--text-soft)]">± {bandOffsetResult.sigmaEv.toFixed(3)} eV</p>}
                  </div>
                  <div className="analysis-subcard px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">方法</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">
                      {bandOffsetMethod === 'vbm_diff' ? 'VBM 差值法' : 'Kraut Method'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {currentFitResult && currentFitResult.peaks.length > 0 && currentRsfRows.length > 0 && (
              <div className="analysis-section-card mb-4 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-[var(--text-main)]">RSF 定量分析</p>
                  <button type="button" onClick={lookupRsfFn} disabled={rsfLoading}
                    className="rounded-lg border border-[var(--accent-strong)] px-3 py-1 text-xs text-[var(--accent-strong)] hover:bg-[var(--accent-soft)] disabled:opacity-50 pressable"
                  >
                    {rsfLoading ? '查詢中…' : '查詢 RSF & 計算'}
                  </button>
                </div>
                {rsfError && <p className="mb-2 text-xs text-rose-400">{rsfError}</p>}
                <table className="analysis-data-table">
                  <thead>
                    <tr className="border-b border-[var(--card-divider)] text-[var(--text-soft)]">
                      <th className="pb-2 text-left font-medium">峰</th>
                      <th className="pb-2 text-left font-medium">元素</th>
                      <th className="pb-2 text-left font-medium">軌域</th>
                      <th className="pb-2 text-right font-medium">面積</th>
                      <th className="pb-2 text-right font-medium">RSF</th>
                      <th className="pb-2 text-right font-medium">Atomic %</th>
                    </tr>
                  </thead>
                  <tbody className="text-[var(--text-main)]">
                    {currentRsfRows.map((row, idx) => {
                      const pk = currentFitResult.peaks[idx]
                      const totalRsfArea = currentRsfRows.reduce((acc, r, i) => {
                        const a = currentFitResult.peaks[i]?.Area ?? 0
                        return acc + (r.rsf ? Math.abs(a) / r.rsf : 0)
                      }, 0)
                      const rsfArea = row.rsf ? Math.abs(pk?.Area ?? 0) / row.rsf : null
                      const atomicPct = rsfArea != null && totalRsfArea > 0 ? rsfArea / totalRsfArea * 100 : null
                      return (
                        <tr key={row.peakName} className="border-b border-[var(--card-divider)]">
                          <td className="py-1.5 font-medium">{row.peakName}</td>
                          <td className="py-1">
                            <input value={row.element} placeholder="e.g. Ni"
                              onChange={e => (processingViewMode === 'overlay'
                                ? setOverlayRsfRows(prev => prev.map((r, i) => i === idx ? { ...r, element: e.target.value } : r))
                                : setRsfRows(prev => prev.map((r, i) => i === idx ? { ...r, element: e.target.value } : r)))}
                              className="w-14 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1.5 py-0.5 text-xs text-[var(--input-text)]"
                            />
                          </td>
                          <td className="py-1">
                            <input value={row.orbitalLabel} placeholder="2p3/2"
                              onChange={e => (processingViewMode === 'overlay'
                                ? setOverlayRsfRows(prev => prev.map((r, i) => i === idx ? { ...r, orbitalLabel: e.target.value } : r))
                                : setRsfRows(prev => prev.map((r, i) => i === idx ? { ...r, orbitalLabel: e.target.value } : r)))}
                              className="w-16 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1.5 py-0.5 text-xs text-[var(--input-text)]"
                            />
                          </td>
                          <td className="py-1.5 text-right">{(pk?.Area ?? 0).toFixed(1)}</td>
                          <td className="py-1.5 text-right">
                            {row.rsf != null ? <span title={row.source}>{row.rsf.toFixed(2)}</span> : '—'}
                          </td>
                          <td className="py-1.5 text-right font-semibold text-[var(--accent-strong)]">
                            {atomicPct != null ? `${atomicPct.toFixed(1)} %` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {currentRsfRows.some(r => r.rsf != null) && (
                  <p className="mt-2 text-[10px] text-[var(--text-soft)]">
                    RSF 來源：Scofield (1976)，Al Kα。Atomic% = (Area/RSF) / Σ(Area/RSF) × 100。
                  </p>
                )}
              </div>
            )}

            {currentDisplayDataset && (
              <div className="analysis-section-card p-4">
                <div className="mb-4">
                  <p className="text-sm font-semibold text-[var(--text-main)]">匯出</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">
                    下載各階段光譜、峰擬合結果、RSF 定量表，以及含完整處理參數的 JSON 報告。
                    {processingViewMode === 'overlay' ? ' 疊圖平均模式會匯出多檔平均後的單一分析結果；不平均疊圖的各階段 CSV 可直接從每張疊圖圖卡下載。' : ''}
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  {/* 研究常用 */}
                  <div className="analysis-subcard p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">研究常用</p>
                    <div className="mt-3 flex flex-col gap-2">
                      <ExportBtnPrimary label="最終處理光譜 CSV" onClick={() => {
                        const headers = ['binding_energy_eV', 'intensity_raw', 'intensity_processed']
                        const rows = currentDisplayDataset.x.map((x, i) => [x, currentDisplayDataset.y_raw[i], currentDisplayDataset.y_processed[i]])
                        downloadFile(toCsv(headers, rows), 'xps_processed.csv', 'text/csv')
                      }} />
                      {backgroundDataset && (
                        <ExportBtnSecondary label="背景扣除後 CSV" onClick={() => {
                          downloadFile(buildStageCsv(backgroundStageDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_background.csv', 'text/csv')
                        }} />
                      )}
                      {normalizationDataset && (
                        <ExportBtnSecondary label="歸一化後 CSV" onClick={() => {
                          downloadFile(buildStageCsv(normalizationStageDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_normalized.csv', 'text/csv')
                        }} />
                      )}
                      <ExportBtnSecondary label="原始光譜 CSV" onClick={() => {
                        downloadFile(buildStageCsv(rawStageDatasets, 'binding_energy_eV', 'intensity_raw'), 'xps_raw.csv', 'text/csv')
                      }} />
                    </div>
                  </div>
                  {/* 分析表格 */}
                  <div className="analysis-subcard p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">分析表格</p>
                    <div className="mt-3 flex flex-col gap-2">
                      {currentFitResult && currentFitResult.peaks.length > 0 ? (
                        <>
                          {/* 光譜數據 TXT for Origin Pro */}
                          <ExportBtnSecondary label="峰擬合光譜 TXT（Origin Pro）" onClick={() => {
                            const peakHeaders = currentFitResult.peaks.map(pk => pk.Peak_Name)
                            const header = ['Binding_Energy_eV', 'Observed', 'Total_Fit', 'Residuals', ...peakHeaders].join('\t')
                            const ds = fitTargetDataset
                            const lines = ds ? ds.x.map((x, i) => {
                              const obs = ds.y_processed[i] ?? ''
                              const fit = currentFitResult.y_fit[i] ?? ''
                              const res = currentFitResult.residuals[i] ?? ''
                              const pkVals = currentFitResult.y_individual.map(yi => yi[i] ?? '')
                              return [x, obs, fit, res, ...pkVals].join('\t')
                            }) : []
                            downloadFile([header, ...lines].join('\n'), 'xps_fit_spectra.txt', 'text/plain')
                          }} />
                          {/* 分析報告 Excel (3 sheets) */}
                          <ExportBtnSecondary label="分析報告 Excel" onClick={() => {
                            const _r2 = currentFitResult.r_squared ?? 0
                            const _rmse = currentFitResult.rmse ?? 0
                            const _chiRed = currentFitResult.chi_red ?? null
                            const hasRsf = currentRsfRows.some(r => r.rsf != null)
                            const totalRsfArea = hasRsf
                              ? currentRsfRows.reduce((acc, r, i) => {
                                  const a = currentFitResult.peaks[i]?.Area ?? 0
                                  return acc + (r.rsf ? Math.abs(a) / r.rsf : 0)
                                }, 0)
                              : 0
                            void downloadXpsFitReport({
                              channel: xpsMode === 'valence_band' ? 'VB' : 'XPS',
                              profile: fitProfile,
                              r2: _r2,
                              rmse: _rmse,
                              chi_red: _chiRed,
                              peaks: currentFitResult.peaks.map(pk => ({
                                name: pk.Peak_Name,
                                center: pk.Center_eV,
                                fwhm: pk.FWHM_eV,
                                area: pk.Area,
                                height: pk.Height ?? 0,
                                area_pct: pk.Area_pct,
                              })),
                              rsf_rows: hasRsf ? currentRsfRows.map((row, idx) => {
                                const pk = currentFitResult.peaks[idx]
                                const rsfArea = row.rsf ? Math.abs(pk?.Area ?? 0) / row.rsf : null
                                const atomicPct = rsfArea != null && totalRsfArea > 0 ? rsfArea / totalRsfArea * 100 : null
                                return {
                                  peak_name: row.peakName,
                                  element: row.element,
                                  orbital: row.orbitalLabel,
                                  area: pk?.Area ?? 0,
                                  rsf: row.rsf,
                                  rsf_area: rsfArea,
                                  atomic_pct: atomicPct,
                                }
                              }) : null,
                            })
                          }} />
                          {/* RSF 定量 CSV 保留 */}
                          {currentRsfRows.some(r => r.rsf != null) && (
                            <ExportBtnSecondary label="RSF 定量 CSV" onClick={() => {
                              const totalRsfArea = currentRsfRows.reduce((acc, r, i) => {
                                const a = currentFitResult.peaks[i]?.Area ?? 0
                                return acc + (r.rsf ? Math.abs(a) / r.rsf : 0)
                              }, 0)
                              const headers = ['Peak', 'Element', 'Orbital', 'Area', 'RSF', 'RSF_Area', 'Atomic_pct']
                              const rows: (string | number | null)[][] = currentRsfRows.map((row, idx) => {
                                const pk = currentFitResult.peaks[idx]
                                const rsfArea = row.rsf ? Math.abs(pk?.Area ?? 0) / row.rsf : null
                                const atomicPct = rsfArea != null && totalRsfArea > 0 ? rsfArea / totalRsfArea * 100 : null
                                return [row.peakName, row.element, row.orbitalLabel, pk?.Area ?? 0, row.rsf, rsfArea, atomicPct]
                              })
                              downloadFile(toCsv(headers, rows), 'xps_rsf_quantification.csv', 'text/csv')
                            }} />
                          )}
                        </>
                      ) : (
                        <p className="text-xs leading-5 text-[var(--text-soft)]">完成峰擬合後才有結果可下載。</p>
                      )}
                      {(effectiveVbmDataset && vbmPreviewTangent && vbmPreviewBaselineLine) && (
                        <ExportBtnSecondary label="VBM 外推光譜 TXT（Origin Pro）" onClick={() => setShowVbmExportPreview(true)} />
                      )}
                    </div>
                  </div>
                  {/* 追溯/設定 */}
                  <div className="analysis-subcard p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">追溯 / 設定</p>
                    <div className="mt-3 flex flex-col gap-2">
                      <ExportBtnSecondary label="處理報告 JSON" onClick={() => {
                        const report = {
                          generated: formatUtc8Iso(),
                          file: currentReportFileName,
                          processing_view_mode: processingViewMode,
                          overlay_selection: processingViewMode === 'overlay' ? overlayFiles.map(file => file.name) : null,
                          mode: xpsMode,
                          params: currentParams,
                          auto_interp_points: currentAutoInterpPoints,
                          effective_n_points: effectiveNPoints,
                          peaks: peakCandidates,
                          fit_profile: fitProfile,
                          fit_result: currentFitResult ? { peaks: currentFitResult.peaks } : null,
                          vbm: vbmResult?.success ? {
                            vbm_ev: vbmResult.vbm_ev,
                            tangent_slope: vbmResult.slope,
                            baseline_slope: vbmResult.baseline_slope,
                            edge_lo: vbmEdgeLo,
                            edge_hi: vbmEdgeHi,
                            baseline_lo: vbmBaselineLo,
                            baseline_hi: vbmBaselineHi,
                            edge_line: vbmResult.edge_line,
                            baseline_line: vbmResult.baseline_line,
                          } : null,
                          rsf: currentRsfRows.some(r => r.rsf != null) ? currentRsfRows : null,
                        }
                        downloadFile(JSON.stringify(report, null, 2), 'xps_report.json', 'application/json')
                      }} />
                      <p className="text-xs leading-5 text-[var(--text-soft)]">
                        包含處理參數、峰擬合設定與結果摘要，可用於重現分析流程。
                        共 {rawFiles.length} 個檔案。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {overlaySelectorOpen && (
        <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/35 px-4 py-8 backdrop-blur-[2px]">
          <div className="analysis-section-card max-h-[calc(100vh-4rem)] w-full max-w-4xl overflow-hidden rounded-[28px] p-0">
            <div className="flex items-center justify-between border-b border-[var(--card-divider)] px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-[var(--text-main)]">多筆數據疊圖處理</p>
                <p className="mt-1 text-xs text-[var(--text-soft)]">會列出目前所有資料，你可以從中選取要一起比較的光譜；套用後預設以不平均疊圖處理。</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOverlayDraftSelection(overlaySelection)
                  setOverlaySelectorOpen(false)
                }}
                className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs text-[var(--text-soft)] hover:text-[var(--text-main)] pressable"
              >
                關閉
              </button>
            </div>
            <div className="space-y-4 overflow-auto p-5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOverlayDraftSelection(rawFileKeys)}
                  className="rounded-full border border-[var(--card-border)] px-3 py-1 text-xs text-[var(--text-soft)] hover:border-[var(--accent-secondary)] hover:text-[var(--text-main)] pressable"
                >
                  全選
                </button>
                <button
                  type="button"
                  onClick={() => setOverlayDraftSelection([])}
                  className="rounded-full border border-[var(--card-border)] px-3 py-1 text-xs text-[var(--text-soft)] hover:border-[var(--accent-secondary)] hover:text-[var(--text-main)] pressable"
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => setOverlayDraftSelection(activeDatasetKey ? [activeDatasetKey] : [])}
                  className="rounded-full border border-[var(--card-border)] px-3 py-1 text-xs text-[var(--text-soft)] hover:border-[var(--accent-secondary)] hover:text-[var(--text-main)] pressable"
                >
                  只留目前
                </button>
                <span className="ml-auto text-xs text-[var(--text-soft)]">目前已選 {overlayDraftSelection.length} / {rawFiles.length} 筆</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {rawFiles.map((file, index) => {
                  const key = getDatasetKey(file, index)
                  const checked = overlayDraftSelection.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setOverlayDraftSelection(current => (
                          current.includes(key)
                            ? current.filter(item => item !== key)
                            : [...current, key]
                        ))
                      }}
                      className={[
                        'rounded-2xl border px-4 py-3 text-left transition-colors pressable',
                        checked
                          ? 'border-[var(--accent-secondary)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_14%,transparent)]'
                          : 'border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--accent-secondary)]',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text-main)]">{file.name}</p>
                          <p className="mt-1 text-xs text-[var(--text-soft)]">{file.x.length} 點</p>
                        </div>
                        <span className={[
                          'mt-0.5 h-5 w-5 shrink-0 rounded-full border text-[10px] leading-[18px] text-center',
                          checked
                            ? 'border-[var(--accent-secondary)] bg-[var(--accent-secondary)] text-[var(--accent-contrast)]'
                            : 'border-[var(--card-border)] text-[var(--text-soft)]',
                        ].join(' ')}>
                          {checked ? '✓' : ''}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-[var(--card-divider)] pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setOverlayDraftSelection(overlaySelection)
                    setOverlaySelectorOpen(false)
                  }}
                  className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs text-[var(--text-soft)] hover:text-[var(--text-main)] pressable"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (overlayDraftSelection.length >= 2) {
                      enterOverlayMode(overlayDraftSelection)
                    } else {
                      enterSingleMode(activeDatasetIdx)
                    }
                    setOverlaySelectorOpen(false)
                  }}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:opacity-90 pressable"
                >
                  套用疊圖選擇
                </button>
              </div>
              <p className="text-xs text-[var(--text-soft)]">多筆疊圖模式會使用獨立的一套內插、背景扣除與歸一化參數，不會沿用單筆資料處理時的設定；需要峰擬合或 RSF 時請在第 2 步啟用多檔平均。</p>
            </div>
          </div>
        </div>
      )}

      {showVbmExportPreview && effectiveVbmDataset && vbmPreviewTangent && vbmPreviewBaselineLine && (() => {
        const { x, y_processed } = effectiveVbmDataset
        const tangent = vbmPreviewTangent
        const baseline = vbmPreviewBaselineLine
        const vbm = vbmPreviewVbm
        const sm = 0.4
        // Tangent line: covers tangent region + extends to VBM (short)
        const tangentLineLo = Math.min(vbmEdgeLo, vbm !== null ? vbm.x : vbmEdgeLo) - sm
        const tangentLineHi = Math.max(vbmEdgeHi, vbm !== null ? vbm.x : vbmEdgeHi) + sm
        // Baseline: covers baseline region + extends to VBM
        const baselineLineLo = Math.min(vbmBaselineLo, vbm !== null ? vbm.x : vbmBaselineLo) - sm
        const baselineLineHi = Math.max(vbmBaselineHi, vbm !== null ? vbm.x : vbmBaselineHi) + sm
        const vbmSampleName = vbmDataSource === 'imported' && importedVbmDataset
          ? importedVbmDataset.name
          : (activeFile?.name ?? currentReportFileName ?? 'spectrum')
        const buildVbmExportContent = () => {
          const headerLines = [
            `# XPS Valence Band - VBM Linear Extrapolation`,
            `# Exported: ${formatUtc8Iso()}`,
            `# Sample: ${vbmSampleName}`,
            `# Tangent region: ${vbmEdgeLo.toFixed(3)} - ${vbmEdgeHi.toFixed(3)} eV`,
            `# Baseline region: ${vbmBaselineLo.toFixed(3)} - ${vbmBaselineHi.toFixed(3)} eV`,
            `# Tangent slope: ${tangent.slope.toFixed(6)},  intercept: ${tangent.intercept.toFixed(4)}`,
            `# Baseline slope: ${baseline.slope.toFixed(6)},  intercept: ${baseline.intercept.toFixed(4)}`,
            `# Preview VBM: ${vbm !== null ? `${vbm.x.toFixed(4)} eV` : 'N/A'}`,
            ...(vbmResult?.success ? [`# Backend confirmed VBM: ${vbmResult.vbm_ev?.toFixed(4) ?? 'N/A'} eV`] : []),
            `# Tangent_Line: [${tangentLineLo.toFixed(3)}, ${tangentLineHi.toFixed(3)}] eV only; Baseline: [${baselineLineLo.toFixed(3)}, ${baselineLineHi.toFixed(3)}] eV only; NaN outside`,
            `#`,
            `Binding_Energy_eV\tSpectrum\tTangent_Line\tBaseline`,
          ]
          const dataRows = x.map((xi, i) => {
            const yi = y_processed[i]
            const tY = (xi >= tangentLineLo && xi <= tangentLineHi) ? (tangent.slope * xi + tangent.intercept).toFixed(6) : 'NaN'
            const bY = (xi >= baselineLineLo && xi <= baselineLineHi) ? (baseline.slope * xi + baseline.intercept).toFixed(6) : 'NaN'
            return `${xi.toFixed(4)}\t${yi.toFixed(6)}\t${tY}\t${bY}`
          })
          const vbmRows = vbm !== null ? [
            `# VBM intersection point:`,
            `${vbm.x.toFixed(4)}\tNaN\t${(tangent.slope * vbm.x + tangent.intercept).toFixed(6)}\t${(baseline.slope * vbm.x + baseline.intercept).toFixed(6)}`,
          ] : []
          return [...headerLines, ...dataRows, ...vbmRows].join('\n')
        }
        const previewText = (() => {
          const allLines = buildVbmExportContent().split('\n')
          const firstDataIdx = allLines.findIndex(l => !l.startsWith('#'))
          const headerPart = allLines.slice(0, firstDataIdx + 1)
          const dataPart = allLines.slice(firstDataIdx + 1, firstDataIdx + 6)
          const suffix = x.length > 5 ? [`… (共 ${x.length} 行數據)`] : []
          return [...headerPart, ...dataPart, ...suffix].join('\n')
        })()
        // Build short line arrays for chart (matching what will be exported)
        const mkLineX = (lo: number, hi: number, n = 60) =>
          Array.from({ length: n }, (_, i) => lo + (hi - lo) * i / (n - 1))
        const tangentChartX = mkLineX(tangentLineLo, tangentLineHi)
        const baselineChartX = mkLineX(baselineLineLo, baselineLineHi)
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-[3px]"
            onClick={() => setShowVbmExportPreview(false)}
          >
            <div
              className="glass-panel flex max-h-[min(92vh,calc(100vh-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[30px]"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-[var(--card-divider)] px-5 py-4">
                <div>
                  <p className="text-base font-semibold text-[var(--text-main)]">匯出預覽 — VBM 外推光譜</p>
                  <p className="mt-0.5 text-xs text-[var(--text-soft)]">確認後將下載 tab-separated TXT（Origin Pro 格式）</p>
                </div>
                <button type="button" onClick={() => setShowVbmExportPreview(false)}
                  className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-sm text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)] pressable">
                  取消
                </button>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                {/* Origin Pro-style preview chart */}
                <Plot
                  data={[
                    { x, y: y_processed, type: 'scatter', mode: 'lines', name: 'Spectrum', line: { color: '#222222', width: 1.5 } },
                    { x: tangentChartX, y: tangentChartX.map(xi => tangent.slope * xi + tangent.intercept), type: 'scatter' as const, mode: 'lines' as const, name: 'Tangent_Line', line: { color: '#e53e3e', width: 1.8 } },
                    { x: baselineChartX, y: baselineChartX.map(xi => baseline.slope * xi + baseline.intercept), type: 'scatter' as const, mode: 'lines' as const, name: 'Baseline', line: { color: '#2b6cb0', width: 1.8 } },
                    ...(vbm !== null ? [{ x: [vbm.x], y: [vbm.y], type: 'scatter' as const, mode: 'markers' as const, name: `VBM = ${vbm.x.toFixed(3)} eV`, marker: { color: '#22863a', size: 10, symbol: 'diamond' as const } }] : []),
                  ] as Plotly.Data[]}
                  layout={{
                    paper_bgcolor: '#ffffff',
                    plot_bgcolor: '#ffffff',
                    font: { color: '#111111', family: 'Arial, sans-serif', size: 12 },
                    margin: { l: 65, r: 20, t: 20, b: 55 },
                    xaxis: {
                      title: { text: 'Binding_Energy_eV', font: { color: '#111111', size: 13 } },
                      autorange: 'reversed' as const,
                      showgrid: true, gridcolor: '#e0e0e0', gridwidth: 1,
                      linecolor: '#111111', linewidth: 1.5, mirror: true,
                      tickcolor: '#111111', ticks: 'outside',
                      showline: true,
                    },
                    yaxis: {
                      title: { text: 'Spectrum', font: { color: '#111111', size: 13 } },
                      showgrid: true, gridcolor: '#e0e0e0', gridwidth: 1,
                      linecolor: '#111111', linewidth: 1.5, mirror: true,
                      tickcolor: '#111111', ticks: 'outside',
                      showline: true,
                    },
                    showlegend: true,
                    legend: {
                      bgcolor: 'rgba(255,255,255,0.9)',
                      bordercolor: '#aaaaaa',
                      borderwidth: 1,
                      font: { color: '#111111', size: 11 },
                      x: 0.98, y: 0.98, xanchor: 'right', yanchor: 'top',
                    },
                  } as Plotly.Layout}
                  config={{ displayModeBar: false }}
                  style={{ width: '100%', height: 280 }}
                />
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="analysis-subcard space-y-1.5 p-3">
                    <p className="font-semibold text-[var(--text-main)]">切線參數</p>
                    <p className="text-[var(--text-soft)]">區間：{vbmEdgeLo.toFixed(3)} – {vbmEdgeHi.toFixed(3)} eV</p>
                    <p className="text-[var(--text-soft)]">斜率：{tangent.slope.toFixed(5)}</p>
                    <p className="text-[var(--text-soft)]">截距：{tangent.intercept.toFixed(4)}</p>
                    <p className="text-[var(--text-soft)] text-[10px]">TXT 輸出範圍：{tangentLineLo.toFixed(2)} – {tangentLineHi.toFixed(2)} eV</p>
                  </div>
                  <div className="analysis-subcard space-y-1.5 p-3">
                    <p className="font-semibold text-[var(--text-main)]">基準線參數</p>
                    <p className="text-[var(--text-soft)]">區間：{vbmBaselineLo.toFixed(3)} – {vbmBaselineHi.toFixed(3)} eV</p>
                    <p className="text-[var(--text-soft)]">斜率：{baseline.slope.toFixed(5)}</p>
                    <p className="text-[var(--text-soft)]">截距：{baseline.intercept.toFixed(4)}</p>
                    <p className="text-[var(--text-soft)] text-[10px]">TXT 輸出範圍：{baselineLineLo.toFixed(2)} – {baselineLineHi.toFixed(2)} eV</p>
                  </div>
                </div>
                {vbm !== null && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <p className="text-sm font-semibold text-emerald-400">預覽 VBM = {vbm.x.toFixed(4)} eV</p>
                    {vbmResult?.success && (
                      <p className="mt-0.5 text-xs text-[var(--text-soft)]">後端確認：{vbmResult.vbm_ev?.toFixed(4)} eV</p>
                    )}
                  </div>
                )}
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-[var(--text-main)]">檔案預覽</p>
                  <pre className="overflow-x-auto rounded-xl bg-[var(--card-ghost)] p-3 text-[10.5px] leading-5 text-[var(--text-soft)]">{previewText}</pre>
                </div>
              </div>
              <div className="flex shrink-0 justify-end gap-3 border-t border-[var(--card-divider)] px-5 py-4">
                <button type="button" onClick={() => setShowVbmExportPreview(false)}
                  className="rounded-full border border-[var(--card-border)] px-4 py-1.5 text-sm text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)] pressable">
                  取消
                </button>
                <button type="button" onClick={() => {
                  const content = buildVbmExportContent()
                  const safeName = vbmSampleName.replace(/[^a-zA-Z0-9_\-.]/g, '_').replace(/_+/g, '_').slice(0, 40)
                  downloadFile(content, `xps_vbm_${safeName}.txt`, 'text/plain')
                  setShowVbmExportPreview(false)
                }}
                  className="rounded-full bg-[var(--accent-strong)] px-5 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 pressable">
                  確定匯出
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {periodicTableOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-[2px]">
          <div className="analysis-section-card max-h-[calc(100vh-4rem)] w-full max-w-6xl overflow-hidden rounded-[28px] p-0">
            <div className="flex items-center justify-between border-b border-[var(--card-divider)] px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-[var(--text-main)]">元素週期表</p>
                <p className="mt-1 text-xs text-[var(--text-soft)]">直接點選元素回填到峰擬合資料庫選擇。</p>
              </div>
              <button
                type="button"
                onClick={() => setPeriodicTableOpen(false)}
                className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs text-[var(--text-soft)] hover:text-[var(--text-main)] pressable"
              >
                關閉
              </button>
            </div>
            <div className="overflow-auto p-5">
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: 'repeat(18, minmax(0, 1fr))' }}
              >
                {periodicTable.map(item => {
                  const selected = selectedElement === item.symbol
                  return (
                    <button
                      key={item.symbol}
                      type="button"
                      title={`${item.symbol} · ${item.name} · ${item.category_name_zh}${item.has_peaks ? '' : '（無峰資料）'}`}
                      disabled={!item.has_peaks}
                      onClick={() => {
                        setSelectedElement(item.symbol)
                        setPeriodicTableOpen(false)
                      }}
                      className={[
                        'aspect-square min-h-[44px] rounded-xl border text-[11px] font-semibold transition-all pressable',
                        item.has_peaks
                          ? 'text-[var(--text-main)] hover:-translate-y-0.5 hover:shadow-[var(--card-shadow-soft)]'
                          : 'cursor-not-allowed text-[var(--text-soft)] opacity-35',
                        selected ? 'ring-2 ring-[var(--accent-strong)] ring-offset-1 ring-offset-transparent' : '',
                      ].join(' ')}
                      style={{
                        gridColumn: item.col,
                        gridRow: item.row,
                        borderColor: item.has_peaks ? item.category_color : 'var(--card-border)',
                        background: item.has_peaks
                          ? `color-mix(in srgb, ${item.category_color} 16%, var(--card-bg))`
                          : 'var(--card-ghost)',
                      }}
                    >
                      {item.symbol}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
