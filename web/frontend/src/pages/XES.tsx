import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { formatUtc8Iso } from '../utils/time'
import Plot from '../components/PlotlyChart'
import type { AnalysisModuleId } from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import { EmptyWorkspaceState, InfoCardGrid, MODULE_CONTENT, ModuleTopBar, StickySidebarHeader } from '../components/WorkspaceUi'
import { withPlotFullscreen } from '../components/plotConfig'
import type { PlotPopupRequest } from '../hooks/usePlotPopups'
import { parseFiles, processData } from '../api/xes'
import type {
  BandAlignParams,
  BandAlignResult,
  CalibrationPoint,
  CalibrationSummary,
  DatasetInput,
  DetectedPeak,
  ParsedSpectrum,
  ProcessParams,
  ProcessedDataset,
  ReferencePeak,
} from '../types/xes'

const SIDEBAR_MIN_WIDTH = 300
const SIDEBAR_MAX_WIDTH = 520
const SIDEBAR_DEFAULT_WIDTH = 340
const SIDEBAR_COLLAPSED_PEEK = 28

const DEFAULT_PARAMS: ProcessParams = {
  interpolate: false,
  n_points: 1000,
  average: false,
  bg_method: 'none',
  bg_order: 'upload',
  total_measurements: null,
  smooth_method: 'none',
  smooth_window: 5,
  smooth_poly: 3,
  norm_method: 'none',
  norm_x_start: null,
  norm_x_end: null,
  i0_values: {},
  axis_calibration: 'none',
  energy_offset: 0,
  energy_slope: 1,
  energy_order: 'increasing',
  calibration_points: [],
}

const DEFAULT_BAND: BandAlignParams = {
  enabled: false,
  mat_a: 'p-NiO',
  mat_b: 'n-Ga2O3',
  vbm_a: 0,
  cbm_a: 3.70,
  vbm_b: 0,
  cbm_b: 4.80,
  sigma_vbm_a: 0,
  sigma_cbm_a: 0,
  sigma_vbm_b: 0,
  sigma_cbm_b: 0,
}

const BG_SUBTRACTION_HELP: Record<string, string> = {
  none: '不做背景扣除，直接保留處理前的訊號。',
  bg1: '扣除匯入的背景檔案。',
}

function parseNumericTable(text: string): number[][] {
  const rows: number[][] = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue
    const parts = trimmed.split(/[,\t\s]+/).filter(Boolean)
    const nums = parts.map(v => Number(v))
    if (nums.length >= 2 && nums.slice(0, 2).every(Number.isFinite)) {
      rows.push(nums)
    }
  }
  return rows
}

function parseXesCalibrationFile(text: string): CalibrationPoint[] {
  const rows = parseNumericTable(text)
  if (rows.length < 10) {
    throw new Error('校正檔有效點數過少，無法進行 XES 能量校正。')
  }
  const points = rows.map(row => ({ channel: row[0], energy: row[1] }))
  points.sort((a, b) => a.channel - b.channel)
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].channel === points[i - 1].channel) {
      throw new Error('校正檔中有重複的 channel / pixel index。')
    }
  }
  return points
}

function getCalibrationSummary(calibration: CalibrationPoint[]): CalibrationSummary {
  const energies = calibration.map(p => p.energy)
  const channels = calibration.map(p => p.channel)
  const inc = energies.every((e, i) => i === 0 || e >= energies[i - 1])
  const dec = energies.every((e, i) => i === 0 || e <= energies[i - 1])
  return {
    points: calibration.length,
    channelMin: Math.min(...channels),
    channelMax: Math.max(...channels),
    energyMin: Math.min(...energies),
    energyMax: Math.max(...energies),
    direction: inc ? 'increasing' : dec ? 'decreasing' : 'non-monotonic',
  }
}

function estimateBgWeights(order: number | null | undefined, total: number | null | undefined) {
  if (!order || !total || total < 2) return null
  const wBg2 = Math.min(1, Math.max(0, (order - 1) / (total - 1)))
  return { bg1: 1 - wBg2, bg2: wBg2 }
}

function buildCalibratedAxis(originalX: number[], calibration: CalibrationPoint[]): number[] | null {
  if (calibration.length < 2 || originalX.length === 0) return null
  if (originalX.length === calibration.length) {
    return calibration.map(p => p.energy)
  }
  const sorted = [...calibration].sort((a, b) => a.channel - b.channel)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const result: number[] = []
  for (const x of originalX) {
    if (x <= first.channel) {
      result.push(first.energy)
      continue
    }
    if (x >= last.channel) {
      result.push(last.energy)
      continue
    }
    let lo = 0
    let hi = sorted.length - 1
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      if (sorted[mid].channel <= x) lo = mid
      else hi = mid
    }
    const p0 = sorted[lo]
    const p1 = sorted[hi]
    const t = (x - p0.channel) / (p1.channel - p0.channel)
    result.push(p0.energy + t * (p1.energy - p0.energy))
  }
  return result
}

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function computeBandAlign(p: BandAlignParams): BandAlignResult {
  const eg_a = p.cbm_a - p.vbm_a
  const eg_b = p.cbm_b - p.vbm_b
  const delta_ev = p.vbm_a - p.vbm_b
  const delta_ec = p.cbm_a - p.cbm_b
  return {
    eg_a, eg_b, delta_ev, delta_ec,
    sigma_eg_a: Math.hypot(p.sigma_vbm_a, p.sigma_cbm_a),
    sigma_eg_b: Math.hypot(p.sigma_vbm_b, p.sigma_cbm_b),
    sigma_delta_ev: Math.hypot(p.sigma_vbm_a, p.sigma_vbm_b),
    sigma_delta_ec: Math.hypot(p.sigma_cbm_a, p.sigma_cbm_b),
  }
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const keys = Object.keys(rows[0])
  return [keys.join(','), ...rows.map(r => keys.map(k => csvEscape(r[k])).join(','))].join('\n')
}
function downloadFile(name: string, content: string, mime = 'text/csv') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: mime }))
  a.download = name
  a.click()
}

function parseTwoColumnText(text: string, fileName: string): { name: string; x: number[]; y: number[] } | null {
  const lines = text.split(/\r?\n/)
  const pairs: [number, number][] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue
    const parts = trimmed.split(/[,\t\s]+/).filter(Boolean)
    if (parts.length < 2) continue
    const x = Number(parts[0])
    const y = Number(parts[1])
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y])
  }
  if (pairs.length < 3) return null
  pairs.sort((a, b) => a[0] - b[0])
  return { name: fileName.replace(/\.[^.]+$/, ''), x: pairs.map(p => p[0]), y: pairs.map(p => p[1]) }
}

interface XesLineFit {
  slope: number
  intercept: number
  point_count: number
  start_window_point_count: number
  end_window_point_count: number
  candidate_pair_count: number
  anchor_start_point: { x: number; y: number }
  anchor_end_point: { x: number; y: number }
  start_point: { x: number; y: number }
  end_point: { x: number; y: number }
}

function fitXesEdgeLine(x: number[], y: number[], start: number, end: number, mode: 'tangent' | 'baseline'): XesLineFit | null {
  if (x.length !== y.length) return null
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const points = x
    .map((xi, index) => ({ x: xi, y: y[index] }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
  if (points.length < 2) return null
  const nearestPoint = (targetX: number) => {
    let bestIndex = 0; let bestDistance = Infinity
    for (let i = 0; i < points.length; i += 1) {
      const d = Math.abs(points[i].x - targetX)
      if (d < bestDistance) { bestDistance = d; bestIndex = i }
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
  let bestPair: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; slope: number; span: number; meanY: number } | null = null
  let candidatePairCount = 0
  for (const startPoint of startWindow) {
    for (const endPoint of endWindow) {
      const dx = endPoint.x - startPoint.x
      if (dx <= 1e-10) continue
      const slope = (endPoint.y - startPoint.y) / dx
      const span = Math.abs(dx)
      const meanY = (startPoint.y + endPoint.y) / 2
      candidatePairCount += 1
      if (!bestPair) { bestPair = { startPoint, endPoint, slope, span, meanY }; continue }
      if (mode === 'tangent') {
        const absSlope = Math.abs(slope); const bestAbsSlope = Math.abs(bestPair.slope)
        if (absSlope > bestAbsSlope + 1e-10 || (Math.abs(absSlope - bestAbsSlope) <= 1e-10 && span > bestPair.span))
          bestPair = { startPoint, endPoint, slope, span, meanY }
      } else {
        const absSlope = Math.abs(slope); const bestAbsSlope = Math.abs(bestPair.slope)
        if (absSlope < bestAbsSlope - 1e-10 || (Math.abs(absSlope - bestAbsSlope) <= 1e-10 && meanY < bestPair.meanY - 1e-10) || (Math.abs(absSlope - bestAbsSlope) <= 1e-10 && Math.abs(meanY - bestPair.meanY) <= 1e-10 && span > bestPair.span))
          bestPair = { startPoint, endPoint, slope, span, meanY }
      }
    }
  }
  if (!bestPair) return null
  const intercept = bestPair.startPoint.y - bestPair.slope * bestPair.startPoint.x
  return {
    slope: bestPair.slope, intercept,
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

function intersectXesEdgeLines(line1: XesLineFit | null, line2: XesLineFit | null): { x: number; y: number } | null {
  if (!line1 || !line2) return null
  const slopeDelta = line1.slope - line2.slope
  if (Math.abs(slopeDelta) < 1e-10) return null
  const x = (line2.intercept - line1.intercept) / slopeDelta
  if (!Number.isFinite(x)) return null
  const y = line1.slope * x + line1.intercept
  if (!Number.isFinite(y)) return null
  return { x, y }
}

function buildVbmStablePlotWindow(x: number[], y: number[]) {
  const points = x
    .map((xi, index) => ({ x: xi, y: y[index] }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x)
  if (points.length < 2) return null
  const xs = points.map(p => p.x); const ys = points.map(p => p.y)
  const xMin = xs[0]; const xMax = xs[xs.length - 1]
  const yMin = Math.min(...ys); const yMax = Math.max(...ys)
  const xPad = (xMax - xMin) * 0.04; const yPad = (yMax - yMin) * 0.08
  const lineX = [xMin - xPad, xMax + xPad]
  return {
    xAxisRange: [xMin - xPad, xMax + xPad] as [number, number],
    yAxisRange: [yMin - yPad, yMax + yPad] as [number, number],
    lineX,
  }
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
      opacity: 0.24,
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
      line: { color, width: 1.45, dash: 'dot' as const },
    },
    {
      type: 'line' as const,
      xref: 'x' as const,
      yref: 'paper' as const,
      x0: x1,
      x1,
      y0: 0,
      y1: 1,
      line: { color, width: 1.45, dash: 'dot' as const },
    },
  ]
}

function buildRegionAnnotations(start: number | null | undefined, end: number | null | undefined, label: string, color: string) {
  if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end) || start === end) return []
  return [{
    x: (start + end) / 2,
    y: 1.04,
    xref: 'x' as const,
    yref: 'paper' as const,
    text: label,
    showarrow: false,
    font: { size: 11, color },
  }]
}

function DualRangeInput({
  label, min, max, start, end, step = 0.1, onChange, disabled = false,
}: {
  label: string; min: number; max: number; start: number; end: number
  step?: number; onChange: (next: { start: number; end: number }) => void; disabled?: boolean
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
        <div className="xps-range-selection" style={{ left: `${startPct}%`, width: `${Math.max(endPct - startPct, 0)}%` }} />
        <input type="range" min={boundedMin} max={boundedMax} step={step} value={low} disabled={disabled}
          onChange={e => onChange({ start: Math.min(Number(e.target.value), high), end: high })}
          className="xps-range-slider xps-range-slider--primary"
        />
        <input type="range" min={boundedMin} max={boundedMax} step={step} value={high} disabled={disabled}
          onChange={e => onChange({ start: low, end: Math.max(Number(e.target.value), low) })}
          className="xps-range-slider xps-range-slider--secondary"
        />
      </div>
    </div>
  )
}

// ── SidebarCard ───────────────────────────────────────────────────────────────
function SidebarCard({ step, title, hint, children, defaultOpen = true, onOpen }: {
  step: number; title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean
  onOpen?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const handleToggle = () => {
    const next = !open
    setOpen(next)
    if (next && onOpen) onOpen()
  }
  return (
    <div className="analysis-section-card mb-3 overflow-hidden rounded-[22px] p-0">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--card-ghost)]"
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
      {open && <div className="space-y-3 p-4 pt-2">{children}</div>}
    </div>
  )
}

// ── label / input helpers ──────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{children}</span>
}
function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none disabled:opacity-40 ${props.className ?? ''}`}
    />
  )
}
function Select({ ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none disabled:opacity-40 ${props.className ?? ''}`}
    >
      {props.children}
    </select>
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

function TextInput({ label, value, onChange, placeholder, disabled = false }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <input
        type="text" value={value} placeholder={placeholder} disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none disabled:opacity-40"
      />
    </label>
  )
}

function NumInput({ label, value, onChange, min, max, step = 1, disabled = false, placeholder }: {
  label: string; value: number | null; onChange: (v: number | null) => void
  min?: number; max?: number; step?: number; disabled?: boolean; placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <input
        type="number" value={value ?? ''} min={min} max={max} step={step} disabled={disabled}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none disabled:opacity-40"
      />
    </label>
  )
}


// ── Main Page ─────────────────────────────────────────────────────────────────
export default function XES({
  onModuleSelect,
  onOpenPlotPopup,
}: {
  onModuleSelect?: (m: AnalysisModuleId) => void
  onOpenPlotPopup?: (popup: PlotPopupRequest) => void
}) {
  const moduleContent = MODULE_CONTENT.xes
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('nigiro-xes-sidebar-width')
    return saved ? Number(saved) : SIDEBAR_DEFAULT_WIDTH
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    localStorage.getItem('nigiro-xes-sidebar-collapsed') === 'true',
  )
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartWidth.current = sidebarWidth
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientX - dragStartX.current
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, dragStartWidth.current + delta))
      setSidebarWidth(next)
    }
    const onUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setSidebarWidth(w => { localStorage.setItem('nigiro-xes-sidebar-width', String(w)); return w })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // data state
  const [samples, setSamples] = useState<ParsedSpectrum[]>([])
  const [bg1, setBg1] = useState<ParsedSpectrum | null>(null)
  const [bg2, setBg2] = useState<ParsedSpectrum | null>(null)
  const [parseErrors, setParseErrors] = useState<string[]>([])

  const [params, setParams] = useState<ProcessParams>(DEFAULT_PARAMS)
  const [processed, setProcessed] = useState<ProcessedDataset[]>([])
  const [average, setAverage] = useState<ProcessedDataset | null>(null)
  const [processing, setProcessing] = useState(false)
  const [processError, setProcessError] = useState<string | null>(null)

  const [bandParams, setBandParams] = useState<BandAlignParams>(DEFAULT_BAND)

  const [sampleFiles, setSampleFiles] = useState<File[]>([])
  const [sampleOrders, setSampleOrders] = useState<Record<string, number>>({})
  const [i0CsvText, setI0CsvText] = useState('')
  const [i0ParseError, setI0ParseError] = useState<string | null>(null)
  const [bg1File, setBg1File] = useState<File | null>(null)
  const [bg2File, setBg2File] = useState<File | null>(null)
  const [calibrationFile, setCalibrationFile] = useState<File | null>(null)
  const [calibrationSummary, setCalibrationSummary] = useState<CalibrationSummary | null>(null)
  const [calibrationError, setCalibrationError] = useState<string | null>(null)
  // ── Valence Band mode states ──
  const [xesMode, setXesMode] = useState<'xes' | 'valence_band'>('xes')
  const [vbmDataSource, setVbmDataSource] = useState<'pipeline' | 'imported'>('pipeline')
  const [importedVbmDataset, setImportedVbmDataset] = useState<{ x: number[]; y: number[]; name: string } | null>(null)
  const [importedVbmError, setImportedVbmError] = useState<string | null>(null)
  const [vbmEdgeLo, setVbmEdgeLo] = useState<number>(0)
  const [vbmEdgeHi, setVbmEdgeHi] = useState<number>(0)
  const [vbmBaselineLo, setVbmBaselineLo] = useState<number>(0)
  const [vbmBaselineHi, setVbmBaselineHi] = useState<number>(0)
  const [showVbmExportPreview, setShowVbmExportPreview] = useState(false)
  const vbmRangeInitKeyRef = useRef<string | null>(null)

  const handleUpload = async (files: File[]) => {
    setSampleFiles(files)
  }
  const handleBg1Upload = (files: File[]) => { setBg1File(files[0] ?? null) }
  const handleBg2Upload = (files: File[]) => { setBg2File(files[0] ?? null) }
  const handleCalibrationUpload = async (files: File[]) => {
    const file = files[0] ?? null
    setCalibrationFile(file)
    setCalibrationSummary(null)
    setCalibrationError(null)
    if (!file) {
      setParams(prev => ({ ...prev, axis_calibration: 'none', calibration_points: [] }))
      return
    }
    try {
      const text = await file.text()
      const points = parseXesCalibrationFile(text)
      const summary = getCalibrationSummary(points)
      setCalibrationSummary(summary)
      setParams(prev => ({
        ...prev,
        axis_calibration: 'table',
        calibration_points: points,
        energy_order: prev.energy_order ?? 'increasing',
      }))
    } catch (e) {
      setCalibrationError((e as Error).message)
      setParams(prev => ({ ...prev, axis_calibration: 'none', calibration_points: [] }))
    }
  }

  const handleParse = useCallback(async () => {
    if (sampleFiles.length === 0) return
    try {
      const res = await parseFiles(sampleFiles, bg1File, null)
      setSamples(res.samples)
      setBg1(res.bg1)
      setBg2(null)
      setParseErrors(res.errors)
      setSampleOrders({})
      setProcessed([])
      setAverage(null)
    } catch (e) {
      setParseErrors([(e as Error).message])
    }
  }, [sampleFiles, bg1File])

  const handleProcess = useCallback(async () => {
    if (samples.length === 0) return
    setProcessing(true)
    setProcessError(null)
    try {
      const dsInputs: DatasetInput[] = samples.map(s => ({
        name: s.name,
        x: s.x,
        y: s.y,
        measurement_order: null,
      }))
      const bg1Input = bg1 ? { name: bg1.name, x: bg1.x, y: bg1.y } : null
      const res = await processData(dsInputs, bg1Input, null, params)
      setProcessed(res.datasets)
      setAverage(res.average)
    } catch (e) {
      setProcessError((e as Error).message)
    } finally {
      setProcessing(false)
    }
  }, [samples, bg1, params])

  const p = (k: keyof ProcessParams, v: unknown) => setParams(prev => ({ ...prev, [k]: v }))
  const bp = (k: keyof BandAlignParams, v: unknown) => setBandParams(prev => ({ ...prev, [k]: v }))

  const applyI0Csv = (text: string) => {
    const result: Record<string, number> = {}
    const errors: string[] = []
    text.split('\n').forEach((line, idx) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const parts = trimmed.split(',')
      if (parts.length < 2) { errors.push(`第 ${idx + 1} 行格式錯誤`); return }
      const name = parts[0].trim()
      const val = parseFloat(parts.slice(1).join(',').trim())
      if (!name || !Number.isFinite(val) || val <= 0) { errors.push(`第 ${idx + 1} 行數值無效`); return }
      result[name] = val
    })
    setI0ParseError(errors.length > 0 ? errors.join('；') : null)
    setParams(prev => ({ ...prev, i0_values: result }))
  }

  const energyCalibrated = params.axis_calibration === 'table' && params.calibration_points.length > 0
  const useEv = params.axis_calibration !== 'none'
  const xLabel = useEv ? 'Energy (eV)' : 'Input X'
  const yLabel = params.norm_method === 'none' ? 'Intensity (arb. units)' : 'Normalized Intensity (arb. units)'

  const bandResult = bandParams.enabled ? computeBandAlign(bandParams) : null

  const vbmSpectrum = useMemo(() => {
    if (vbmDataSource === 'imported') {
      return importedVbmDataset
    }
    const target = average ?? processed[0]
    if (!target) return null
    return {
      x: getX(target),
      y: target.y_processed,
      name: target.name,
    }
  }, [vbmDataSource, importedVbmDataset, processed, average, useEv, params.axis_calibration, params.calibration_points])

  // Auto-initialize VBM energy ranges when dataset first becomes available
  useEffect(() => {
    if (!vbmSpectrum) return
    const key = `${vbmSpectrum.x[0]?.toFixed(2)}-${vbmSpectrum.x[vbmSpectrum.x.length - 1]?.toFixed(2)}`
    if (vbmRangeInitKeyRef.current === key) return
    vbmRangeInitKeyRef.current = key
    const eMin = Math.min(...vbmSpectrum.x.filter(Number.isFinite))
    const eMax = Math.max(...vbmSpectrum.x.filter(Number.isFinite))
    const span = eMax - eMin
    // VBM is on the high-energy descent edge
    setVbmEdgeLo(parseFloat((eMin + span * 0.70).toFixed(1)))
    setVbmEdgeHi(parseFloat((eMin + span * 0.88).toFixed(1)))
    setVbmBaselineLo(parseFloat((eMin + span * 0.90).toFixed(1)))
    setVbmBaselineHi(parseFloat((eMin + span * 0.99).toFixed(1)))
  }, [vbmSpectrum])

  const vbmTangent = useMemo(() => {
    if (!vbmSpectrum) return null
    return fitXesEdgeLine(vbmSpectrum.x, vbmSpectrum.y, vbmEdgeLo, vbmEdgeHi, 'tangent')
  }, [vbmSpectrum, vbmEdgeLo, vbmEdgeHi])

  const vbmBaseline = useMemo(() => {
    if (!vbmSpectrum) return null
    return fitXesEdgeLine(vbmSpectrum.x, vbmSpectrum.y, vbmBaselineLo, vbmBaselineHi, 'baseline')
  }, [vbmSpectrum, vbmBaselineLo, vbmBaselineHi])

  const vbmIntersect = useMemo(() => {
    return intersectXesEdgeLines(vbmTangent, vbmBaseline)
  }, [vbmTangent, vbmBaseline])

  // Plotly stable plot helper
  const vbmPlotWindow = useMemo(() => {
    if (!vbmSpectrum) return null
    return buildVbmStablePlotWindow(vbmSpectrum.x, vbmSpectrum.y)
  }, [vbmSpectrum])

  // 價帶頂線性外推 Plot Traces
  const vbmPlotTraces = useMemo(() => {
    if (!vbmSpectrum) return []
    const traces: any[] = [
      {
        x: vbmSpectrum.x,
        y: vbmSpectrum.y,
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: vbmSpectrum.name,
        line: { color: '#38bdf8', width: 2.2 },
      }
    ]

    const win = vbmPlotWindow
    if (win) {
      if (vbmTangent) {
        traces.push({
          x: win.lineX,
          y: win.lineX.map((xi: number) => vbmTangent.slope * xi + vbmTangent.intercept),
          type: 'scatter' as const,
          mode: 'lines' as const,
          name: '切線 (外推)',
          line: { color: '#fb923c', width: 2, dash: 'dash' as const },
        })
      }
      if (vbmBaseline) {
        traces.push({
          x: win.lineX,
          y: win.lineX.map((xi: number) => vbmBaseline.slope * xi + vbmBaseline.intercept),
          type: 'scatter' as const,
          mode: 'lines' as const,
          name: '基準線',
          line: { color: '#a78bfa', width: 1.8, dash: 'dot' as const },
        })
      }
      if (vbmIntersect) {
        traces.push({
          x: [vbmIntersect.x],
          y: [vbmIntersect.y],
          type: 'scatter' as const,
          mode: 'markers' as const,
          name: 'VBM 交點',
          marker: { color: '#f472b6', size: 10, symbol: 'diamond' as const },
        })
      }
    }
    return traces
  }, [vbmSpectrum, vbmTangent, vbmBaseline, vbmIntersect, vbmPlotWindow])

  // chart colors
  const COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fb923c', '#f472b6', '#facc15', '#60a5fa', '#4ade80']
  const bgColor = cssVar('--chart-bg', '#1e293b')
  const gridColor = cssVar('--chart-grid', 'rgba(255,255,255,0.06)')
  const textColor = cssVar('--text-soft', '#94a3b8')

  const chartLayout = (title: string, xTitle: string) => ({
    paper_bgcolor: bgColor,
    plot_bgcolor: bgColor,
    font: { color: textColor, size: 12 },
    title: { text: title, font: { size: 13 }, x: 0.02 },
    xaxis: { title: { text: xTitle }, gridcolor: gridColor, zerolinecolor: gridColor },
    yaxis: { title: { text: yLabel }, gridcolor: gridColor, zerolinecolor: gridColor },
    legend: { orientation: 'h' as const, y: -0.15, font: { size: 11 } },
    margin: { l: 55, r: 20, t: 46, b: 50 },
    height: 340,
  })

  const getX = (ds: ProcessedDataset) =>
    useEv && ds.x_ev ? ds.x_ev : ds.x_pixel
  const getReferenceX = (s: ParsedSpectrum) =>
    useEv && params.calibration_points.length > 0
      ? (buildCalibratedAxis(s.x, params.calibration_points) ?? s.x)
      : s.x

  const hasSamples = samples.length > 0
  const hasProcessed = processed.length > 0
  const renderMainSpectraChart = (height = 340) => (
    <Plot
      data={[
        ...processed.map((ds, i) => ({
          x: getX(ds),
          y: ds.y_processed,
          type: 'scatter' as const,
          mode: 'lines' as const,
          name: ds.name,
          line: { color: COLORS[i % COLORS.length], width: 1.8 },
        })),
        ...(average ? [{
          x: getX(average),
          y: average.y_processed,
          type: 'scatter' as const,
          mode: 'lines' as const,
          name: '平均',
          line: { color: '#f59e0b', width: 2.5, dash: 'dot' as const },
        }] : []),
        ...(bg1 && params.bg_method !== 'none' ? [{
          x: getReferenceX(bg1), y: bg1.y,
          type: 'scatter' as const, mode: 'lines' as const, name: '背景',
          line: { color: '#19D3F3', width: 1.2, dash: 'dash' as const }, opacity: 0.6,
        }] : []),
      ]}
      layout={{
        ...chartLayout('處理後光譜', xLabel),
        height,
        yaxis: {
          ...(chartLayout('', '').yaxis),
        },
      }}
      config={withPlotFullscreen()}
      style={{ width: '100%' }}
    />
  )
  const openMainSpectraPopup = () => {
    if (!onOpenPlotPopup || !hasProcessed) return

    onOpenPlotPopup({
      title: 'XES 主光譜圖表',
      content: renderMainSpectraChart(420),
    })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-canvas)]">
      {/* sidebar */}
      <div
        className="module-sidebar relative flex flex-shrink-0 flex-col overflow-hidden border-r border-[var(--card-border)] bg-[var(--panel-bg)]"
        style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_PEEK : sidebarWidth }}
      >
        {!sidebarCollapsed && (
          <div className="module-sidebar__content min-h-0 flex flex-1 flex-col overflow-y-auto">
            <StickySidebarHeader
              activeModule="xes"
              subtitle="Material Intelligence Engine"
              onSelectModule={onModuleSelect}
              onCollapse={() => setSidebarCollapsed(true)}
            />

            <div className="px-4 pt-2">
              <div className="flex rounded-xl bg-[var(--card-ghost)] p-1 border border-[var(--card-border)]">
                {(['xes', 'valence_band'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setXesMode(m)}
                    className={`flex-1 rounded-[10px] py-1.5 text-center text-xs font-semibold transition-all ${
                      xesMode === m
                        ? 'bg-[var(--accent-secondary)] text-white shadow-sm'
                        : 'text-[var(--text-soft)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    {m === 'xes' ? 'XES 分析' : 'Valence Band'}
                  </button>
                ))}
              </div>
            </div>

            {/* steps */}
            <div className="flex-1 px-4 py-4">
              {xesMode === 'xes' && (
                <>
                  {/* Step 1 */}
                  <SidebarCard step={1} title="載入資料" hint="載入光譜、背景與能量校正檔">
                    <Label>Sample 光譜（可多選）</Label>
                    <FileUpload onFiles={handleUpload} moduleLabel="XES" />
                    <Label>背景檔案（可選）</Label>
                    <FileUpload onFiles={handleBg1Upload} moduleLabel="背景" />
                    <Label>XES 能量校正檔 (.dat / .txt / .csv)</Label>
                    <FileUpload onFiles={handleCalibrationUpload} moduleLabel="XES 能量校正" accept={['.dat', '.txt', '.csv']} />
                    {calibrationFile && (
                      <div className="mt-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs text-[var(--text-soft)]">
                        <div className="font-medium text-[var(--text-main)]">{calibrationFile.name}</div>
                        {calibrationSummary && (
                          <div className="mt-1 leading-5">
                            points {calibrationSummary.points}；energy {calibrationSummary.energyMin.toFixed(3)}–{calibrationSummary.energyMax.toFixed(3)} eV；
                            {calibrationSummary.direction === 'increasing' ? '遞增' : calibrationSummary.direction === 'decreasing' ? '遞減' : '非單調'}
                          </div>
                        )}
                      </div>
                    )}
                    {calibrationError && (
                      <div className="mt-2 rounded-lg bg-red-900/30 px-3 py-1.5 text-xs text-red-300">{calibrationError}</div>
                    )}
                    <button
                      type="button"
                      onClick={handleParse}
                      disabled={sampleFiles.length === 0}
                      className="w-full rounded-lg text-white font-bold bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-50 transition-opacity py-2 text-sm mt-3"
                    >
                      解析檔案
                    </button>
                    {parseErrors.map((e, i) => (
                      <div key={i} className="mt-1 rounded-lg bg-red-900/30 px-3 py-1.5 text-xs text-red-300">{e}</div>
                    ))}
                  </SidebarCard>

                  {/* Step 2 */}
                  <SidebarCard step={2} title="內插 / 多檔平均" hint="均勻網格內插與資料集平均" defaultOpen={false}>
                    <TogglePill label="內插至均勻網格" checked={params.interpolate} onChange={v => p('interpolate', v)} />
                    {params.interpolate && (
                      <div className="mt-2">
                        <NumInput label="點數" value={params.n_points} min={100} max={5000} step={100}
                          onChange={v => p('n_points', v)} />
                      </div>
                    )}
                    <div className="mt-2">
                      <TogglePill label="多檔平均" checked={params.average} onChange={v => p('average', v)} />
                    </div>
                  </SidebarCard>

                  {/* Step 3 — I0 正規化 */}
                  <SidebarCard step={3} title="I0 正規化（每筆除以監視訊號）" hint="每筆強度除以監視訊號" defaultOpen={false}>
                    <div className="text-xs leading-5 text-[var(--text-soft)]">
                      每行輸入：<code className="rounded px-1 py-0.5 bg-[var(--card-ghost)]">檔名,I0數值</code>，I0 值須為正數。
                      套用後各曲線原始強度會先除以對應 I0，再進行背景扣除與歸一化。
                    </div>
                    <textarea
                      rows={4}
                      placeholder={'sample1.txt,12345\nsample2.txt,13456'}
                      value={i0CsvText}
                      onChange={e => setI0CsvText(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-xs text-[var(--input-text)] focus:outline-none disabled:opacity-40"
                    />
                    <button
                      type="button"
                      onClick={() => applyI0Csv(i0CsvText)}
                      className="w-full rounded-lg text-white font-bold bg-[var(--accent-strong)] hover:opacity-90 transition-opacity py-1.5 text-xs mt-1"
                    >
                      套用 I0 值
                    </button>
                    {i0ParseError && (
                      <div className="mt-1 rounded-lg bg-red-900/30 px-3 py-1.5 text-xs text-red-300">{i0ParseError}</div>
                    )}
                    {Object.keys(params.i0_values).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {Object.entries(params.i0_values).map(([name, val]) => (
                          <div key={name} className="flex items-center justify-between rounded-lg border border-[var(--card-border)] bg-[var(--card-ghost)] px-2 py-1 text-xs">
                            <span className="truncate text-[var(--text-main)]">{name}</span>
                            <span className="ml-2 shrink-0 font-mono text-[var(--accent)]">{val.toExponential(3)}</span>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => { setI0CsvText(''); setParams(prev => ({ ...prev, i0_values: {} })); setI0ParseError(null) }}
                          className="w-full rounded-lg border border-[var(--card-border)] hover:border-[var(--accent-secondary)] py-1.5 text-xs text-[var(--text-soft)] hover:text-[var(--accent-secondary)] transition-all mt-1"
                        >
                          清除 I0 設定
                        </button>
                      </div>
                    )}
                  </SidebarCard>

                  {/* Step 4 — X 軸校正 */}
                  <SidebarCard step={4} title="X 軸校正（pixel → eV）" hint="能量校正：pixel 轉 eV" defaultOpen={false}>
                    <Label>校正狀態</Label>
                    <Select
                      value={params.axis_calibration === 'table' ? 'table' : 'none'}
                      onChange={e => p('axis_calibration', e.target.value as ProcessParams['axis_calibration'])}
                    >
                      <option value="none">不校正（保留 channel / pixel）</option>
                      <option value="table" disabled={params.calibration_points.length === 0}>使用上傳校正檔</option>
                    </Select>
                    {params.calibration_points.length === 0 ? (
                      <div className="mt-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-200">
                        目前 XES 尚未套用能量校正，X 軸可能為 channel / pixel。
                      </div>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <div className={`rounded-xl border px-3 py-2 text-xs ${
                          params.axis_calibration === 'table'
                            ? 'border-green-500/40 bg-green-500/10 text-green-300'
                            : 'border-amber-400/40 bg-amber-400/10 text-amber-200'
                        }`}>
                          {params.axis_calibration === 'table' ? 'Energy calibrated' : '已解析校正檔，尚未套用校正'}
                        </div>
                        <div>
                          <Label>Energy order</Label>
                          <Select
                            value={params.energy_order}
                            onChange={e => p('energy_order', e.target.value as ProcessParams['energy_order'])}
                          >
                            <option value="increasing">increasing（建議）</option>
                            <option value="decreasing">decreasing</option>
                            <option value="original">original</option>
                          </Select>
                        </div>
                        {calibrationSummary && (
                          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs leading-5 text-[var(--text-soft)]">
                            calibration points：{calibrationSummary.points}<br />
                            channel：{calibrationSummary.channelMin.toFixed(3)}–{calibrationSummary.channelMax.toFixed(3)}<br />
                            energy：{calibrationSummary.energyMin.toFixed(3)}–{calibrationSummary.energyMax.toFixed(3)} eV<br />
                            direction：{calibrationSummary.direction}
                          </div>
                        )}
                      </div>
                    )}
                  </SidebarCard>

                  {/* Step 5 — 背景扣除 */}
                  <SidebarCard step={5} title="背景扣除" hint="扣除對應背景檔案" defaultOpen={false}>
                    <Label>扣除方式</Label>
                    <Select value={params.bg_method} onChange={e => p('bg_method', e.target.value)}>
                      <option value="none">不扣除</option>
                      <option value="bg1">扣除背景檔案</option>
                    </Select>
                    <div className="mt-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs leading-6 text-[var(--text-soft)]">
                      {BG_SUBTRACTION_HELP[params.bg_method]}
                    </div>
                  </SidebarCard>

                  {/* Step 6 — 歸一化 */}
                  <SidebarCard step={6} title="歸一化" hint="歸一化數據範圍" defaultOpen={false}>
                    <Label>歸一化方式</Label>
                    <Select value={params.norm_method} onChange={e => p('norm_method', e.target.value as ProcessParams['norm_method'])}>
                      <option value="none">不歸一化</option>
                      <option value="min_max">Min-Max</option>
                      <option value="max">最大值 = 1</option>
                      <option value="area">面積 = 1</option>
                      <option value="reference_region">參考區間</option>
                    </Select>
                    {params.norm_method === 'reference_region' && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <NumInput label="X 起始" value={params.norm_x_start} placeholder="auto"
                          onChange={v => p('norm_x_start', v)} />
                        <NumInput label="X 結束" value={params.norm_x_end} placeholder="auto"
                          onChange={v => p('norm_x_end', v)} />
                      </div>
                    )}
                  </SidebarCard>

                  {/* Step 7 — 能帶對齊 */}
                  <SidebarCard step={7} title="能帶對齊（XES/XAS）" hint="計算異質結價帶/導帶偏置" defaultOpen={false}>
                    <TogglePill label="啟用能帶對齊計算" checked={bandParams.enabled} onChange={v => bp('enabled', v)} />
                    {bandParams.enabled && (
                      <div className="mt-2 space-y-2 text-sm">
                        <div className="grid grid-cols-2 gap-2">
                          <TextInput label="材料 A" value={bandParams.mat_a} onChange={v => bp('mat_a', v)} />
                          <TextInput label="材料 B" value={bandParams.mat_b} onChange={v => bp('mat_b', v)} />
                        </div>
                        <p className="text-xs font-semibold text-[var(--text-soft)]">材料 A</p>
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput label="VBM (eV)" step={0.01} value={bandParams.vbm_a} onChange={v => bp('vbm_a', v ?? 0)} />
                          <NumInput label="CBM (eV)" step={0.01} value={bandParams.cbm_a} onChange={v => bp('cbm_a', v ?? 0)} />
                          <NumInput label="σ(VBM)" min={0} step={0.01} value={bandParams.sigma_vbm_a} onChange={v => bp('sigma_vbm_a', v ?? 0)} />
                          <NumInput label="σ(CBM)" min={0} step={0.01} value={bandParams.sigma_cbm_a} onChange={v => bp('sigma_cbm_a', v ?? 0)} />
                        </div>
                        <p className="text-xs font-semibold text-[var(--text-soft)]">材料 B</p>
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput label="VBM (eV)" step={0.01} value={bandParams.vbm_b} onChange={v => bp('vbm_b', v ?? 0)} />
                          <NumInput label="CBM (eV)" step={0.01} value={bandParams.cbm_b} onChange={v => bp('cbm_b', v ?? 0)} />
                          <NumInput label="σ(VBM)" min={0} step={0.01} value={bandParams.sigma_vbm_b} onChange={v => bp('sigma_vbm_b', v ?? 0)} />
                          <NumInput label="σ(CBM)" min={0} step={0.01} value={bandParams.sigma_cbm_b} onChange={v => bp('sigma_cbm_b', v ?? 0)} />
                        </div>
                      </div>
                    )}
                  </SidebarCard>

                  {/* Run */}
                  <button
                    type="button"
                    onClick={handleProcess}
                    disabled={!hasSamples || processing}
                    className="w-full rounded-lg text-white font-bold bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-50 transition-opacity py-2.5 text-sm"
                  >
                    {processing ? '處理中…' : '執行處理'}
                  </button>
                </>
              )}

              {xesMode === 'valence_band' && (
                <>
                  {/* Step 1: 資料來源 */}
                  <SidebarCard step={1} title="資料來源" hint="選擇或匯入價帶光譜數據">
                    <Label>資料來源模式</Label>
                    <Select
                      value={vbmDataSource}
                      onChange={e => {
                        const val = e.target.value as 'pipeline' | 'imported'
                        setVbmDataSource(val)
                      }}
                    >
                      <option value="pipeline">使用處理管線光譜 (Pipeline)</option>
                      <option value="imported">手動上傳已處理光譜 (Imported)</option>
                    </Select>

                    {vbmDataSource === 'pipeline' && (
                      <div className="mt-2 text-xs leading-5 text-[var(--text-soft)]">
                        {hasProcessed ? (
                          <div className="rounded-xl border border-green-500/40 bg-green-500/10 px-3 py-2 text-green-300">
                            已自動連接當前 XES 處理管線光譜資料：<strong className="text-white">{(average ?? processed[0])?.name}</strong>。
                          </div>
                        ) : (
                          <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-amber-200">
                            當前管線無有效光譜。請先切換至「XES 分析」載入並執行處理。
                          </div>
                        )}
                      </div>
                    )}

                    {vbmDataSource === 'imported' && (
                      <div className="mt-2 space-y-2">
                        <Label>上傳雙欄光譜數據 (.dat / .txt / .csv)</Label>
                        <FileUpload
                          onFiles={async files => {
                            const file = files[0]
                            if (!file) return
                            setImportedVbmError(null)
                            try {
                              const text = await file.text()
                              const parsed = parseTwoColumnText(text, file.name)
                              if (!parsed) {
                                throw new Error('檔案解析失敗，必須為兩欄數值（能量與強度）格式。')
                              }
                              setImportedVbmDataset(parsed)
                              vbmRangeInitKeyRef.current = null
                            } catch (e) {
                              setImportedVbmError((e as Error).message)
                            }
                          }}
                          moduleLabel="VBM 數據"
                          accept={['.dat', '.txt', '.csv']}
                        />
                        {importedVbmDataset && (
                          <div className="flex items-center justify-between rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-[var(--text-main)]">{importedVbmDataset.name}</div>
                              <div className="text-[10px] text-[var(--text-soft)]">點數：{importedVbmDataset.x.length}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setImportedVbmDataset(null)
                                vbmRangeInitKeyRef.current = null
                              }}
                              className="text-red-400 hover:text-red-300 text-xs font-semibold"
                            >
                              清除
                            </button>
                          </div>
                        )}
                        {importedVbmError && (
                          <div className="rounded-lg bg-red-900/30 px-3 py-1.5 text-xs text-red-300">{importedVbmError}</div>
                        )}
                      </div>
                    )}
                  </SidebarCard>

                  {/* Step 2: VBM 線性外推設定 */}
                  <SidebarCard step={2} title="VBM 線性外推" hint="設定切線與基準線區間">
                    {vbmSpectrum ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput
                            label="切線起始 (eV)"
                            value={vbmEdgeLo}
                            onChange={v => setVbmEdgeLo(v ?? 0)}
                            step={0.1}
                          />
                          <NumInput
                            label="切線結束 (eV)"
                            value={vbmEdgeHi}
                            onChange={v => setVbmEdgeHi(v ?? 0)}
                            step={0.1}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput
                            label="基準線起始 (eV)"
                            value={vbmBaselineLo}
                            onChange={v => setVbmBaselineLo(v ?? 0)}
                            step={0.1}
                          />
                          <NumInput
                            label="基準線結束 (eV)"
                            value={vbmBaselineHi}
                            onChange={v => setVbmBaselineHi(v ?? 0)}
                            step={0.1}
                          />
                        </div>

                        {vbmIntersect && (
                          <div className="mt-2 rounded-xl border border-[var(--accent-secondary)]/40 bg-[var(--accent-secondary)]/10 p-3 text-xs">
                            <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--accent-secondary)] font-semibold">外推 VBM 結果</span>
                            <div className="text-[15px] font-bold text-white leading-relaxed">
                              VBM = {vbmIntersect.x.toFixed(4)} eV
                            </div>
                            <div className="mt-1 text-[10px] text-[var(--text-soft)]">
                              交點座標：({vbmIntersect.x.toFixed(3)}, {vbmIntersect.y.toFixed(3)})
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--text-soft)] leading-5">
                        請先在步驟 1 載入有效的價帶光譜數據。
                      </div>
                    )}
                  </SidebarCard>
                </>
              )}
            </div>
          </div>
        )}

        {/* drag handle */}
        {!sidebarCollapsed && (
          <div
            className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize hover:bg-[var(--accent-strong)] opacity-0 hover:opacity-60 transition-opacity"
            onMouseDown={onMouseDown}
          />
        )}

        {/* collapse toggle */}
        <button
          type="button"
          onClick={() => {
            const next = !sidebarCollapsed
            setSidebarCollapsed(next)
            localStorage.setItem('nigiro-xes-sidebar-collapsed', String(next))
          }}
          className="pressable absolute right-1 top-4 z-10 rounded-full border border-[var(--card-border)] bg-[var(--panel-bg)] p-1 text-xs text-[var(--text-soft)] hover:text-[var(--text-main)]"
        >
          {sidebarCollapsed ? '▶' : '◀'}
        </button>
      </div>

      {/* main content */}
      <div className="min-h-0 flex flex-1 flex-col overflow-y-auto px-5 py-8 sm:px-8 xl:px-10 xl:py-10">
        <div className="mx-auto w-full max-w-[1500px]">
          <ModuleTopBar
            title={xesMode === 'valence_band' ? "Valence Band 分析" : moduleContent.title}
            subtitle={xesMode === 'valence_band' ? "XES VBM 線性外推" : moduleContent.subtitle}
            description={xesMode === 'valence_band' ? "將 XES 光譜做 Min-Max 歸一化後，以切線與基準線交點決定 VBM 能量。" : moduleContent.description}
            chips={xesMode === 'valence_band' ? [
              { label: `資料來源：${vbmDataSource === 'imported' ? '匯入光譜' : '處理流程結果'}` },
              { label: vbmSpectrum ? `${vbmSpectrum.x.length} pts` : '未載入' },
            ] : [
              { label: `資料量 ${samples.length}` },
              { label: `平均 ${params.average ? '開啟' : '關閉'}` },
            ]}
          />

          <InfoCardGrid
            items={xesMode === 'valence_band' ? [
              { label: '資料來源', value: vbmDataSource === 'imported' ? '手動匯入' : '管線光譜' },
              { label: 'VBM 能量 (eV)', value: vbmIntersect ? `${vbmIntersect.x.toFixed(4)} eV` : '未計算' },
            ] : [
              { label: '資料集', value: samples.length > 0 ? `${samples.length} 個` : '未載入' },
              { label: '平均模式', value: params.average ? '開啟' : '關閉' },
            ]}
          />

          {/* status pills */}
          {xesMode === 'xes' ? (
            hasSamples && (
              <div className="mb-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">
                  {samples.length} 個 sample
                </span>
                {bg1 && <span className="rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">背景: {bg1.name}</span>}
                {hasProcessed && <span className="rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-xs text-green-400">已處理</span>}
                {energyCalibrated ? (
                  <span className="rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-xs text-green-400">Energy calibrated</span>
                ) : (
                  <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
                    目前 XES 尚未套用能量校正，X 軸可能為 channel / pixel。
                  </span>
                )}
              </div>
            )
          ) : (
            vbmSpectrum && (
              <div className="mb-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">
                  價帶光譜: {vbmSpectrum.name}
                </span>
                {vbmIntersect ? (
                  <span className="rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-xs text-green-400">
                    VBM 已計算: {vbmIntersect.x.toFixed(3)} eV
                  </span>
                ) : (
                  <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
                    請調整區間以計算 VBM 交點
                  </span>
                )}
              </div>
            )
          )}

          {processError && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{processError}</div>
          )}

          {xesMode === 'xes' ? (
            !hasSamples ? (
              <EmptyWorkspaceState
                module="xes"
                title={moduleContent.uploadTitle}
                description="左側已提供多檔平均、BG1/BG2 背景扣除、平滑、歸一化、X 軸校正、參考峰、峰值偵測與能帶對齊。上傳之後會在這裡顯示 XES 圖譜與分析結果。"
                formats={moduleContent.formats}
              />
            ) : !hasProcessed ? (
              <div className="analysis-subcard flex min-h-[32vh] items-center justify-center rounded-2xl border-dashed">
                <div className="text-center text-[var(--text-soft)]">
                  <p className="text-sm">已載入 {samples.length} 個 sample，調整左側參數後點擊「執行處理」。</p>
                </div>
              </div>
            ) : (
              <>
                {/* Main spectra chart */}
                <div className="analysis-section-card mb-4 p-4">
                  <div className="mb-2 flex justify-end">
                    {onOpenPlotPopup && (
                      <button type="button" className="chart-popup-button" onClick={openMainSpectraPopup}>
                        彈出圖表
                      </button>
                    )}
                  </div>
                  <Plot
                    data={[
                      ...processed.map((ds, i) => ({
                        x: getX(ds),
                        y: ds.y_processed,
                        type: 'scatter' as const,
                        mode: 'lines' as const,
                        name: ds.name,
                        line: { color: COLORS[i % COLORS.length], width: 1.8 },
                      })),
                      ...(average ? [{
                        x: getX(average),
                        y: average.y_processed,
                        type: 'scatter' as const,
                        mode: 'lines' as const,
                        name: '平均',
                        line: { color: '#f59e0b', width: 2.5, dash: 'dot' as const },
                      }] : []),
                      // BG reference overlays
                      ...(bg1 && params.bg_method !== 'none' ? [{
                        x: getReferenceX(bg1), y: bg1.y,
                        type: 'scatter' as const, mode: 'lines' as const, name: '背景',
                        line: { color: '#19D3F3', width: 1.2, dash: 'dash' as const }, opacity: 0.6,
                      }] : []),
                    ]}
                    layout={{
                      ...chartLayout('處理後光譜', xLabel),
                      yaxis: {
                        ...(chartLayout('', '').yaxis),
                      },
                    }}
                    config={withPlotFullscreen()}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* BG subtraction comparison chart */}
                {params.bg_method !== 'none' && (
                  <div className="analysis-section-card mb-4 p-4">
                    <Plot
                      data={processed.flatMap((ds, i) => [
                        {
                          x: getX(ds), y: ds.y_raw,
                          type: 'scatter' as const, mode: 'lines' as const,
                          name: `${ds.name} (原始)`,
                          line: { color: COLORS[i % COLORS.length], width: 1.2, dash: 'dot' as const },
                          opacity: 0.6,
                        },
                        ...(ds.y_bg ? [{
                          x: getX(ds), y: ds.y_bg,
                          type: 'scatter' as const, mode: 'lines' as const,
                          name: `${ds.name} (背景)`,
                          line: { color: COLORS[i % COLORS.length], width: 1, dash: 'dash' as const },
                          opacity: 0.5,
                        }] : []),
                        {
                          x: getX(ds), y: ds.y_corrected,
                          type: 'scatter' as const, mode: 'lines' as const,
                          name: `${ds.name} (扣背景後)`,
                          line: { color: COLORS[i % COLORS.length], width: 1.8 },
                        },
                      ])}
                      layout={chartLayout('背景扣除比較', xLabel)}
                      config={withPlotFullscreen()}
                      style={{ width: '100%' }}
                    />
                  </div>
                )}

                {/* Band alignment result */}
                {bandParams.enabled && bandResult && (
                  <div className="analysis-section-card mb-4 p-4">
                    <h2 className="mb-3 text-sm font-semibold text-[var(--text-main)]">能帶對齊結果</h2>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        { label: `Eg (${bandParams.mat_a})`, val: bandResult.eg_a, sig: bandResult.sigma_eg_a },
                        { label: `Eg (${bandParams.mat_b})`, val: bandResult.eg_b, sig: bandResult.sigma_eg_b },
                        { label: 'ΔEV', val: bandResult.delta_ev, sig: bandResult.sigma_delta_ev },
                        { label: 'ΔEC', val: bandResult.delta_ec, sig: bandResult.sigma_delta_ec },
                      ].map(item => (
                        <div key={item.label} className="analysis-subcard px-4 py-3">
                          <div className="text-xs text-[var(--text-soft)]">{item.label}</div>
                          <div className="mt-1 text-lg font-bold text-[var(--text-main)]">{item.val.toFixed(3)} eV</div>
                          <div className="text-[10px] text-[var(--text-soft)]">±{item.sig.toFixed(3)} eV</div>
                        </div>
                      ))}
                    </div>
                    <div className="analysis-table-wrap mt-4">
                      <table className="analysis-data-table min-w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-[var(--card-border)] text-[var(--text-soft)]">
                            <th className="py-2 pr-4 text-left">量</th>
                            <th className="py-2 pr-4 text-left">值 (eV)</th>
                            <th className="py-2 text-left">σ (eV)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            [`${bandParams.mat_a} VBM`, bandParams.vbm_a, bandParams.sigma_vbm_a],
                            [`${bandParams.mat_a} CBM`, bandParams.cbm_a, bandParams.sigma_cbm_a],
                            [`${bandParams.mat_a} Eg`, bandResult.eg_a, bandResult.sigma_eg_a],
                            [`${bandParams.mat_b} VBM`, bandParams.vbm_b, bandParams.sigma_vbm_b],
                            [`${bandParams.mat_b} CBM`, bandParams.cbm_b, bandParams.sigma_cbm_b],
                            [`${bandParams.mat_b} Eg`, bandResult.eg_b, bandResult.sigma_eg_b],
                            ['ΔEV', bandResult.delta_ev, bandResult.sigma_delta_ev],
                            ['ΔEC', bandResult.delta_ec, bandResult.sigma_delta_ec],
                          ].map(([label, val, sig], i) => (
                            <tr key={i} className="border-b border-[var(--card-border)]/50">
                              <td className="py-1.5 pr-4">{label as string}</td>
                              <td className="py-1.5 pr-4">{(val as number).toFixed(4)}</td>
                              <td className="py-1.5">±{(sig as number).toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Export */}
                <div className="analysis-section-card mb-4 p-4">
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出</h2>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="pressable rounded-xl border border-[var(--card-border)] bg-[var(--panel-bg)] px-4 py-2 text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-strong)]"
                      onClick={() => {
                        const target = average ?? processed[0]
                        if (!target) return
                        const xArr = getX(target)
                        const rows = xArr.map((x, i) => ({ [xLabel]: x, Intensity: target.y_processed[i] }))
                        downloadFile('xes_processed.csv', toCsv(rows))
                      }}
                    >
                      處理後光譜 CSV
                    </button>
                    {energyCalibrated && (
                      <button
                        type="button"
                        className="pressable rounded-xl border border-[var(--card-border)] bg-[var(--panel-bg)] px-4 py-2 text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-strong)]"
                        onClick={() => {
                          if (processed.length === 0) return
                          const rows = processed.flatMap(ds => {
                            const energy = ds.x_ev ?? []
                            const original = ds.original_x ?? ds.x_pixel
                            return energy.map((e, i) => ({
                              energy_eV: e,
                              intensity: ds.y_processed[i] ?? '',
                              sampleName: ds.name,
                              original_x: original[i] ?? '',
                            }))
                          })
                          downloadFile('xes_calibrated.csv', toCsv(rows))
                        }}
                      >
                        Export calibrated XES data
                      </button>
                    )}
                    <button
                      type="button"
                      className="pressable rounded-xl border border-[var(--card-border)] bg-[var(--panel-bg)] px-4 py-2 text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-strong)]"
                      onClick={() => {
                        if (processed.length === 0) return
                        const xRef = getX(processed[0])
                        const header = [xLabel, ...processed.map(d => d.name), ...(average ? ['平均'] : [])]
                        const rows = xRef.map((x, i) => {
                          const row: Record<string, unknown> = { [xLabel]: x }
                          processed.forEach(d => { row[d.name] = d.y_processed[i] ?? '' })
                          if (average) row['平均'] = average.y_processed[i] ?? ''
                          return row
                        })
                        downloadFile('xes_all_datasets.csv', toCsv(rows))
                      }}
                    >
                      全部資料集 CSV
                    </button>

                    {bandParams.enabled && bandResult && (
                      <button
                        type="button"
                        className="pressable rounded-xl border border-[var(--card-border)] bg-[var(--panel-bg)] px-4 py-2 text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-strong)]"
                        onClick={() => {
                          const rows = [
                            { Quantity: `${bandParams.mat_a} VBM`, Value_eV: bandParams.vbm_a, Sigma_eV: bandParams.sigma_vbm_a },
                            { Quantity: `${bandParams.mat_a} CBM`, Value_eV: bandParams.cbm_a, Sigma_eV: bandParams.sigma_cbm_a },
                            { Quantity: `${bandParams.mat_a} Eg`, Value_eV: bandResult.eg_a, Sigma_eV: bandResult.sigma_eg_a },
                            { Quantity: `${bandParams.mat_b} VBM`, Value_eV: bandParams.vbm_b, Sigma_eV: bandParams.sigma_vbm_b },
                            { Quantity: `${bandParams.mat_b} CBM`, Value_eV: bandParams.cbm_b, Sigma_eV: bandParams.sigma_cbm_b },
                            { Quantity: `${bandParams.mat_b} Eg`, Value_eV: bandResult.eg_b, Sigma_eV: bandResult.sigma_eg_b },
                            { Quantity: 'Delta_EV', Value_eV: bandResult.delta_ev, Sigma_eV: bandResult.sigma_delta_ev },
                            { Quantity: 'Delta_EC', Value_eV: bandResult.delta_ec, Sigma_eV: bandResult.sigma_delta_ec },
                          ]
                          downloadFile('xes_band_alignment.csv', toCsv(rows))
                        }}
                      >
                        能帶對齊 CSV
                      </button>
                    )}
                  </div>
                </div>
              </>
            )
          ) : (
            // Valence Band mode main content
            !vbmSpectrum ? (
              <EmptyWorkspaceState
                module="xes"
                title="請先設定 VBM 資料來源"
                description="在左側步驟 1 選擇「使用處理管線光譜」或「手動上傳已處理光譜」，完成後這裡會顯示歸一化光譜與 VBM 外推圖。"
                formats={[]}
              />
            ) : (() => {
              const { x, y } = vbmSpectrum
              const tangent = vbmTangent
              const baseline = vbmBaseline
              const intersect = vbmIntersect
              const lineXArr = vbmPlotWindow?.lineX ?? [Math.min(...x.filter(Number.isFinite)), Math.max(...x.filter(Number.isFinite))]
              const eMin = Math.min(...x.filter(Number.isFinite))
              const eMax = Math.max(...x.filter(Number.isFinite))
              return (
                <div className="space-y-4">
                  <div className="analysis-section-card p-4">
                    <p className="mb-1 text-sm font-semibold text-[var(--text-main)]">VBM 線性外推圖</p>
                    <p className="mb-3 text-xs text-[var(--text-soft)]">空心 marker 是輸入 x 值對應的光譜點，實心 marker 是在附近 20% 搜尋窗實際選到的點。</p>
                    <Plot
                      data={[
                        { x, y, type: 'scatter', mode: 'lines', name: '歸一化光譜', line: { color: '#38bdf8', width: 2.2 } },
                        ...(tangent ? [
                          { x: [tangent.anchor_start_point.x], y: [tangent.anchor_start_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '切線輸入起點', marker: { color: '#fb923c', size: 11, symbol: 'circle-open' as const, line: { color: '#fb923c', width: 2 } } },
                          { x: [tangent.anchor_end_point.x], y: [tangent.anchor_end_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '切線輸入終點', marker: { color: '#fb923c', size: 11, symbol: 'circle-open' as const, line: { color: '#fb923c', width: 2 } } },
                          { x: [tangent.start_point.x], y: [tangent.start_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '切線實際起點', marker: { color: '#fb923c', size: 9, symbol: 'circle' as const, line: { color: '#fff7ed', width: 1.5 } } },
                          { x: [tangent.end_point.x], y: [tangent.end_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '切線實際終點', marker: { color: '#fb923c', size: 9, symbol: 'circle' as const, line: { color: '#fff7ed', width: 1.5 } } },
                          { x: lineXArr, y: lineXArr.map((xi: number) => tangent.slope * xi + tangent.intercept), type: 'scatter' as const, mode: 'lines' as const, name: '切線 (外推)', line: { color: '#fb923c', width: 2, dash: 'dash' as const } },
                        ] : []),
                        ...(baseline ? [
                          { x: [baseline.anchor_start_point.x], y: [baseline.anchor_start_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '基準輸入起點', marker: { color: '#a78bfa', size: 11, symbol: 'square-open' as const, line: { color: '#a78bfa', width: 2 } } },
                          { x: [baseline.anchor_end_point.x], y: [baseline.anchor_end_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '基準輸入終點', marker: { color: '#a78bfa', size: 11, symbol: 'square-open' as const, line: { color: '#a78bfa', width: 2 } } },
                          { x: [baseline.start_point.x], y: [baseline.start_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '基準實際起點', marker: { color: '#a78bfa', size: 9, symbol: 'square' as const, line: { color: '#f5f3ff', width: 1.5 } } },
                          { x: [baseline.end_point.x], y: [baseline.end_point.y], type: 'scatter' as const, mode: 'markers' as const, name: '基準實際終點', marker: { color: '#a78bfa', size: 9, symbol: 'square' as const, line: { color: '#f5f3ff', width: 1.5 } } },
                          { x: lineXArr, y: lineXArr.map((xi: number) => baseline.slope * xi + baseline.intercept), type: 'scatter' as const, mode: 'lines' as const, name: '基準線', line: { color: '#a78bfa', width: 1.8, dash: 'dot' as const } },
                        ] : []),
                        ...(intersect !== null ? [
                          { x: [intersect.x], y: [intersect.y], type: 'scatter' as const, mode: 'markers' as const, name: `VBM ≈ ${intersect.x.toFixed(3)} eV`, marker: { color: '#f472b6', size: 11, symbol: 'diamond' as const } },
                        ] : []),
                      ]}
                      layout={(() => {
                        const base = chartLayout('Energy (eV)', '強度 (歸一化)') as any
                        return {
                          ...base,
                          margin: { l: 60, r: 20, t: 20, b: 50 },
                          ...(vbmPlotWindow ? {
                            xaxis: { ...(base.xaxis ?? {}), autorange: false, range: vbmPlotWindow.xAxisRange },
                            yaxis: { ...(base.yaxis ?? {}), autorange: false, range: vbmPlotWindow.yAxisRange },
                          } : {}),
                          shapes: [
                            ...buildRegionShapes(Math.min(vbmEdgeLo, vbmEdgeHi), Math.max(vbmEdgeLo, vbmEdgeHi), '#fb923c'),
                            ...buildRegionShapes(Math.min(vbmBaselineLo, vbmBaselineHi), Math.max(vbmBaselineLo, vbmBaselineHi), '#a78bfa'),
                          ] as any[],
                          annotations: [
                            ...buildRegionAnnotations(Math.min(vbmEdgeLo, vbmEdgeHi), Math.max(vbmEdgeLo, vbmEdgeHi), '切線區間', '#fb923c'),
                            ...buildRegionAnnotations(Math.min(vbmBaselineLo, vbmBaselineHi), Math.max(vbmBaselineLo, vbmBaselineHi), '基準線區間', '#a78bfa'),
                            ...(intersect !== null ? [{
                              x: intersect.x, y: intersect.y,
                              text: `VBM ≈ ${intersect.x.toFixed(3)} eV`,
                              showarrow: true, arrowhead: 2, ax: 50, ay: -35,
                              font: { color: '#f472b6', size: 11 }, arrowcolor: '#f472b6',
                            }] : []),
                          ],
                        }
                      })()}
                      config={withPlotFullscreen()}
                      style={{ width: '100%', height: 360 }}
                    />
                    {/* Range control DualRangeInput sliders */}
                    <div className="mt-3 grid gap-3 xl:grid-cols-2">
                      <DualRangeInput
                        label="切線區間" min={eMin} max={eMax}
                        start={vbmEdgeLo} end={vbmEdgeHi}
                        onChange={({ start, end }) => { setVbmEdgeLo(start); setVbmEdgeHi(end) }}
                      />
                      <DualRangeInput
                        label="基準線區間" min={eMin} max={eMax}
                        start={vbmBaselineLo} end={vbmBaselineHi}
                        onChange={({ start, end }) => { setVbmBaselineLo(start); setVbmBaselineHi(end) }}
                      />
                    </div>
                    {/* Export bar */}
                    {tangent && baseline && (
                      <div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-4 py-2.5">
                        <div className="text-xs text-[var(--text-soft)]">
                          {intersect !== null
                            ? <span>預覽 VBM = <span className="font-semibold text-emerald-400">{intersect.x.toFixed(3)} eV</span></span>
                            : '切線與基準線已就緒'}
                        </div>
                        <button type="button" onClick={() => setShowVbmExportPreview(true)}
                          className="rounded-full border border-[var(--accent-secondary)] px-4 py-1.5 text-[12px] font-semibold text-[var(--accent-secondary)] transition-colors hover:bg-[var(--accent-soft)] pressable">
                          ↓ 匯出 TXT（Origin Pro）
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()
          )}
        </div>
      </div>

      {/* ── VBM Export Preview Modal ── */}
      {showVbmExportPreview && vbmSpectrum && vbmTangent && vbmBaseline && (() => {
        const { x, y, name } = vbmSpectrum
        const tangent = vbmTangent
        const baseline = vbmBaseline
        const intersect = vbmIntersect
        const sm = 0.4
        const tangentLineLo = Math.min(vbmEdgeLo, intersect !== null ? intersect.x : vbmEdgeLo) - sm
        const tangentLineHi = Math.max(vbmEdgeHi, intersect !== null ? intersect.x : vbmEdgeHi) + sm
        const baselineLineLo = Math.min(vbmBaselineLo, intersect !== null ? intersect.x : vbmBaselineLo) - sm
        const baselineLineHi = Math.max(vbmBaselineHi, intersect !== null ? intersect.x : vbmBaselineHi) + sm
        const vbmSampleName = vbmDataSource === 'imported' && importedVbmDataset
          ? importedVbmDataset.name
          : (name ?? 'spectrum')
        const buildVbmExportContent = () => {
          const headerLines = [
            `# XES Valence Band - VBM Linear Extrapolation`,
            `# Exported: ${formatUtc8Iso()}`,
            `# Sample: ${vbmSampleName}`,
            `# Data source: ${vbmDataSource === 'imported' ? 'imported spectrum' : 'pipeline processed spectrum'}`,
            `# Normalization: Min-Max (y = (y - min) / (max - min))`,
            `# Tangent region: ${vbmEdgeLo.toFixed(3)} - ${vbmEdgeHi.toFixed(3)} eV`,
            `# Baseline region: ${vbmBaselineLo.toFixed(3)} - ${vbmBaselineHi.toFixed(3)} eV`,
            `# Tangent slope: ${tangent.slope.toFixed(6)},  intercept: ${tangent.intercept.toFixed(4)}`,
            `# Baseline slope: ${baseline.slope.toFixed(6)},  intercept: ${baseline.intercept.toFixed(4)}`,
            `# Preview VBM: ${intersect !== null ? `${intersect.x.toFixed(4)} eV` : 'N/A'}`,
            `# Tangent_Line: [${tangentLineLo.toFixed(3)}, ${tangentLineHi.toFixed(3)}] eV only; Baseline: [${baselineLineLo.toFixed(3)}, ${baselineLineHi.toFixed(3)}] eV only; NaN outside`,
            `#`,
            `Energy_eV\tSpectrum_normalized\tTangent_Line\tBaseline`,
          ]
          const dataRows = x.map((xi: number, i: number) => {
            const yi = y[i]
            const tY = (xi >= tangentLineLo && xi <= tangentLineHi) ? (tangent.slope * xi + tangent.intercept).toFixed(6) : 'NaN'
            const bY = (xi >= baselineLineLo && xi <= baselineLineHi) ? (baseline.slope * xi + baseline.intercept).toFixed(6) : 'NaN'
            return `${xi.toFixed(4)}\t${yi.toFixed(6)}\t${tY}\t${bY}`
          })
          const vbmRows = intersect !== null ? [
            `# VBM intersection point:`,
            `${intersect.x.toFixed(4)}\tNaN\t${(tangent.slope * intersect.x + tangent.intercept).toFixed(6)}\t${(baseline.slope * intersect.x + baseline.intercept).toFixed(6)}`,
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
        const mkLineX = (lo: number, hi: number, n = 60) =>
          Array.from({ length: n }, (_, i) => lo + (hi - lo) * i / (n - 1))
        const tangentChartX = mkLineX(tangentLineLo, tangentLineHi)
        const baselineChartX = mkLineX(baselineLineLo, baselineLineHi)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-[3px]"
            onClick={() => setShowVbmExportPreview(false)}>
            <div className="glass-panel flex max-h-[min(92vh,calc(100vh-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[30px]"
              onClick={e => e.stopPropagation()}>
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
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                {/* Origin Pro-style chart */}
                <Plot
                  data={[
                    { x, y, type: 'scatter', mode: 'lines', name: 'Spectrum', line: { color: '#222222', width: 1.5 } },
                    { x: tangentChartX, y: tangentChartX.map((xi: number) => tangent.slope * xi + tangent.intercept), type: 'scatter' as const, mode: 'lines' as const, name: 'Tangent_Line', line: { color: '#e53e3e', width: 1.8 } },
                    { x: baselineChartX, y: baselineChartX.map((xi: number) => baseline.slope * xi + baseline.intercept), type: 'scatter' as const, mode: 'lines' as const, name: 'Baseline', line: { color: '#2b6cb0', width: 1.8 } },
                    ...(intersect !== null ? [{ x: [intersect.x], y: [intersect.y], type: 'scatter' as const, mode: 'markers' as const, name: `VBM = ${intersect.x.toFixed(3)} eV`, marker: { color: '#22863a', size: 10, symbol: 'diamond' as const } }] : []),
                  ] as any[]}
                  layout={{
                    paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff',
                    font: { color: '#111111', family: 'Arial, sans-serif', size: 12 },
                    margin: { l: 65, r: 20, t: 20, b: 55 },
                    xaxis: {
                      title: { text: 'Energy_eV', font: { color: '#111111', size: 13 } },
                      showgrid: true, gridcolor: '#e0e0e0', gridwidth: 1,
                      linecolor: '#111111', linewidth: 1.5, mirror: true,
                      tickcolor: '#111111', ticks: 'outside', showline: true,
                    },
                    yaxis: {
                      title: { text: 'Spectrum_normalized', font: { color: '#111111', size: 13 } },
                      showgrid: true, gridcolor: '#e0e0e0', gridwidth: 1,
                      linecolor: '#111111', linewidth: 1.5, mirror: true,
                      tickcolor: '#111111', ticks: 'outside', showline: true,
                    },
                    showlegend: true,
                    legend: {
                      bgcolor: 'rgba(255,255,255,0.9)', bordercolor: '#aaaaaa', borderwidth: 1,
                      font: { color: '#111111', size: 11 }, x: 0.98, y: 0.98, xanchor: 'right', yanchor: 'top',
                    },
                  } as any}
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
                {intersect !== null && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <p className="text-sm font-semibold text-emerald-400">預覽 VBM = {intersect.x.toFixed(4)} eV</p>
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
                  downloadFile(`xes_vbm_${safeName}.txt`, content, 'text/plain')
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
    </div>
  )
}
