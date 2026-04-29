import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import Plot from 'react-plotly.js'
import type { AnalysisModuleId } from '../components/AnalysisModuleNav'
import { ANALYSIS_MODULES } from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import { calibrateEnergy, fetchPeriodicTable, parseFiles, processData, fitPeaks, computeVbm, lookupRsf, fetchElementPeaks, listElements } from '../api/xps'
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
  VbmResult,
  RsfRequestItem,
  RsfResultRow,
} from '../types/xps'

const SIDEBAR_MIN_WIDTH = 300
const SIDEBAR_MAX_WIDTH = 540
const SIDEBAR_DEFAULT_WIDTH = 360
const SIDEBAR_COLLAPSED_PEEK = 28
const INTERP_POINTS_MIN = 600
const INTERP_POINTS_MAX = 2400
const INTERP_POINTS_DEFAULT = 1000

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

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
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
  const target = Math.round(median(estimated) / 50) * 50
  return clamp(target || INTERP_POINTS_DEFAULT, INTERP_POINTS_MIN, INTERP_POINTS_MAX)
}

const DEFAULT_SERIES_PALETTE_KEYS = ['blue', 'teal', 'orange', 'rose', 'violet']

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
      opacity: 0.14,
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
      line: { color, width: 1.2, dash: 'dot' },
    },
    {
      type: 'line' as const,
      xref: 'x' as const,
      yref: 'paper' as const,
      x0: x1,
      x1,
      y0: 0,
      y1: 1,
      line: { color, width: 1.2, dash: 'dot' },
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

function chartLayout(xReversed = true): Partial<Plotly.Layout> {
  const grid = cssVar('--chart-grid', 'rgba(148,163,184,0.14)')
  const text = cssVar('--chart-text', '#d9e4f0')
  const bg = cssVar('--chart-bg', 'rgba(15,23,42,0.52)')
  const legendBg = cssVar('--chart-legend-bg', 'rgba(15,23,42,0.72)')
  const hoverBg = cssVar('--chart-hover-bg', 'rgba(15,23,42,0.95)')
  const hoverBorder = cssVar('--chart-hover-border', 'rgba(148,163,184,0.22)')
  return {
    xaxis: {
      title: { text: 'Binding Energy (eV)' },
      autorange: xReversed ? 'reversed' : true,
      showgrid: true, gridcolor: grid, zeroline: false, color: text,
    },
    yaxis: { title: { text: 'Intensity (a.u.)' }, showgrid: true, gridcolor: grid, zeroline: false, color: text },
    legend: { x: 1, xanchor: 'right', y: 1, bgcolor: legendBg, bordercolor: hoverBorder, borderwidth: 1, font: { color: text } },
    margin: { l: 60, r: 20, t: 28, b: 58 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: bg,
    font: { color: text },
    hovermode: 'x unified',
    hoverlabel: { bgcolor: hoverBg, bordercolor: hoverBorder, font: { color: text } },
    autosize: true,
  }
}

function buildMainTraces(dataset: ProcessedDataset, showRaw: boolean, showBg: boolean, paletteKey: string): Plotly.Data[] {
  const palette = LINE_COLOR_PALETTES[paletteKey] ?? LINE_COLOR_PALETTES.blue
  const traces: Plotly.Data[] = []
  if (showRaw) {
    traces.push({ x: dataset.x, y: dataset.y_raw, type: 'scatter', mode: 'lines', name: '原始', line: { color: palette.secondary, width: 1.4 } })
  }
  if (showBg && dataset.y_background) {
    traces.push({ x: dataset.x, y: dataset.y_background, type: 'scatter', mode: 'lines', name: '背景', line: { color: palette.tertiary, width: 1.3, dash: 'dot' } })
  }
  traces.push({ x: dataset.x, y: dataset.y_processed, type: 'scatter', mode: 'lines', name: '處理後', line: { color: palette.primary, width: 2.0 } })
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

function Section({ step, title, hint, children, defaultOpen = true }: {
  step: number; title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-3 overflow-hidden rounded-[22px] bg-[var(--card-bg)] [box-shadow:var(--card-shadow)]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
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

function ChartToolbar({
  title,
  colorValue,
  onColorChange,
}: {
  title: string
  colorValue: string
  onColorChange: (value: string) => void
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-semibold text-[var(--text-main)]">{title}</p>
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-soft)]">線色</span>
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

function createPeakId() { return `XP${Math.random().toString(36).slice(2, 7)}` }

interface PeakCandidate extends InitPeak {
  id: string
  label: string
  enabled: boolean
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
    normalization: null,
    signature,
    error: null,
  }
}

function createDefaultOverlayState(): OverlayProcessState {
  return {
    params: { ...DEFAULT_PARAMS },
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

function buildOverlayTraces(datasets: { name: string; x: number[]; y: number[] }[], paletteKey: string): Plotly.Data[] {
  const colors = (LINE_COLOR_PALETTES[paletteKey] ?? LINE_COLOR_PALETTES.blue).series
  return datasets.map((dataset, index) => ({
    x: dataset.x,
    y: dataset.y,
    type: 'scatter',
    mode: 'lines',
    name: dataset.name,
    line: {
      color: colors[index % colors.length],
      width: 2,
    },
  }))
}

function getStageDisplayLabel(params: ProcessParams) {
  const parts: string[] = []
  if (params.interpolate) parts.push('內插')
  if (params.average) parts.push('平均')
  if (Math.abs(params.energy_shift) > 1e-8) parts.push('校正')
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
  return stage.datasets.map(dataset => ({ name: dataset.name, x: dataset.x, y: dataset.y_processed }))
}

// ── main component ────────────────────────────────────────────────────────────

export default function XPS({ onModuleSelect }: { onModuleSelect?: (m: AnalysisModuleId) => void }) {
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
    background: 'orange',
    normalization: 'teal',
    final: 'blue',
  })
  const [rawFileColors, setRawFileColors] = useState<string[]>([])
  const [moduleDropdownOpen, setModuleDropdownOpen] = useState(false)
  const [parseLoading, setParseLoading] = useState(false)
  const [processingKeys, setProcessingKeys] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [autoInterpPoints, setAutoInterpPoints] = useState(true)

  // display
  const [showRaw, setShowRaw] = useState(true)
  const [showBg, setShowBg] = useState(true)
  const [activeDatasetIdx, setActiveDatasetIdx] = useState(0)

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
  const [peakCandidates, setPeakCandidates] = useState<PeakCandidate[]>([])
  const [fitResult, setFitResult] = useState<FitResult | null>(null)
  const [isFitting, setIsFitting] = useState(false)
  const [fitError, setFitError] = useState<string | null>(null)

  // mode
  const [xpsMode, setXpsMode] = useState<'core_level' | 'valence_band'>('core_level')

  // VBM extrapolation
  const [vbmEdgeLo, setVbmEdgeLo] = useState(1.0)
  const [vbmEdgeHi, setVbmEdgeHi] = useState(5.0)
  const [vbmBaselineLo, setVbmBaselineLo] = useState(10.0)
  const [vbmBaselineHi, setVbmBaselineHi] = useState(15.0)
  const [vbmResult, setVbmResult] = useState<VbmResult | null>(null)
  const [vbmLoading, setVbmLoading] = useState(false)
  const [vbmError, setVbmError] = useState<string | null>(null)

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

  // RSF quantification
  const [rsfRows, setRsfRows] = useState<{ peakName: string; element: string; orbitalLabel: string; rsf: number | null; source: string }[]>([])
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

  const activeDataset = getStageDataset(result, activeDatasetIdx, false)
  const preprocessDataset = getStageDataset(preprocessResult, activeDatasetIdx, false)
  const backgroundDataset = getStageDataset(backgroundResult, activeDatasetIdx, false)
  const normalizationDataset = getStageDataset(normalizationResult, activeDatasetIdx, false)
  const overlayPrimaryDataset = getStageDataset(overlayBundle?.final ?? null, 0, false)
  const beMin = processingViewMode === 'overlay'
    ? (overlayPrimaryDataset ? Math.min(...overlayPrimaryDataset.x) : 0)
    : (activeDataset ? Math.min(...activeDataset.x) : 0)
  const beMax = processingViewMode === 'overlay'
    ? (overlayPrimaryDataset ? Math.max(...overlayPrimaryDataset.x) : 1000)
    : (activeDataset ? Math.max(...activeDataset.x) : 1000)
  const estimatedInterpPoints = estimateInterpolationPoints(processingViewMode === 'overlay' && overlayFiles.length > 0 ? overlayFiles : rawFiles)
  const effectiveNPoints = currentAutoInterpPoints ? estimatedInterpPoints : currentParams.n_points
  const standardDataset = standardFiles[calibrationDatasetIdx] ?? standardFiles[0] ?? null
  const calibrationPeak = calibrationPeaks.find(item => item.label === calibrationPeakLabel) ?? null
  const interpolationEnabled = currentParams.interpolate || (processingViewMode === 'overlay' && currentParams.average)
  const hasPreprocessStage = interpolationEnabled || Math.abs(currentParams.energy_shift) > 1e-8
  const hasBackgroundStage = currentParams.bg_enabled
  const hasNormalizationStage = currentParams.norm_method !== 'none'
  const rawPreview = processingViewMode === 'overlay'
    ? (overlayFiles[0] ?? null)
    : (rawFiles[activeDatasetIdx] ?? rawFiles[0] ?? null)

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
    setPeakCandidates(session.peakCandidates)
    setFitResult(session.fitResult)
    setRsfRows(session.rsfRows)
    window.setTimeout(() => {
      restoringSessionRef.current = false
    }, 0)
  }, [activeDatasetKey, datasetSessions])

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
    if (fitResult) setFitResult(null)
    if (rsfRows.length > 0) setRsfRows([])
  }, [processingViewMode, activeDatasetKey, params, autoInterpPoints, fitResult, rsfRows])

  // process active single dataset
  useEffect(() => {
    if (processingViewMode !== 'single') return
    if (rawFiles.length === 0) {
      setResult(null)
      setPreprocessResult(null)
      setBackgroundResult(null)
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
        const session = datasetSessions[key]
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
        const normalizationParams: ProcessParams = {
          ...backgroundParams,
          norm_method: session.params.norm_method,
          norm_x_start: session.params.norm_x_start,
          norm_x_end: session.params.norm_x_end,
        }

        try {
          const [finalResult, preprocessStage, backgroundStage, normalizationStage] = await Promise.all([
            processData(datasets, effectiveParams),
            sessionHasPreprocessStage || sessionHasBackgroundStage || sessionHasNormalizationStage ? processData(datasets, preprocessParams) : Promise.resolve(null),
            sessionHasBackgroundStage ? processData(datasets, backgroundParams) : Promise.resolve(null),
            sessionHasNormalizationStage ? processData(datasets, normalizationParams) : Promise.resolve(null),
          ])

          results.push({
            key,
            bundle: {
              final: finalResult,
              preprocess: preprocessStage,
              background: backgroundStage,
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
  }, [processingViewMode, rawFiles, rawFileKeys, datasetSessions, activeDatasetKey])

  // process overlay selection with an independent transient state
  useEffect(() => {
    if (processingViewMode !== 'overlay') return
    if (overlayFiles.length < 2) {
      setOverlayBundle(null)
      return
    }

        const overlayParams: ProcessParams = {
          ...overlayState.params,
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
    const overlayInterpolationEnabled = overlayParams.interpolate
    const overlayHasPreprocessStage = overlayInterpolationEnabled || Math.abs(overlayParams.energy_shift) > 1e-8
    const overlayHasBackgroundStage = overlayParams.bg_enabled
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
    const overlayNormalizationParams: ProcessParams = {
      ...overlayBackgroundParams,
      norm_method: overlayParams.norm_method,
      norm_x_start: overlayParams.norm_x_start,
      norm_x_end: overlayParams.norm_x_end,
    }

    Promise.all([
      processData(datasets, overlayParams),
      overlayHasPreprocessStage || overlayHasBackgroundStage || overlayHasNormalizationStage ? processData(datasets, overlayPreprocessParams) : Promise.resolve(null),
      overlayHasBackgroundStage ? processData(datasets, overlayBackgroundParams) : Promise.resolve(null),
      overlayHasNormalizationStage ? processData(datasets, overlayNormalizationParams) : Promise.resolve(null),
    ])
      .then(([finalResult, preprocessStage, backgroundStage, normalizationStage]) => {
        if (cancelled) return
        setOverlayBundle({
          final: finalResult,
          preprocess: preprocessStage,
          background: backgroundStage,
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
      setNormalizationResult(null)
      setError(null)
      return
    }
    const bundle = datasetBundles[activeDatasetKey]
    setResult(bundle?.final ?? null)
    setPreprocessResult(bundle?.preprocess ?? null)
    setBackgroundResult(bundle?.background ?? null)
    setNormalizationResult(bundle?.normalization ?? null)
    setError(bundle?.error ?? null)
  }, [processingViewMode, activeDatasetKey, datasetBundles])

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
    if (!fitResult) { setRsfRows([]); return }
    setRsfRows(prev => {
      const prevMap = new Map(prev.map(r => [r.peakName, r]))
      return fitResult.peaks.map(pk => {
        const existing = prevMap.get(pk.Peak_Name)
        return existing ?? { peakName: pk.Peak_Name, element: '', orbitalLabel: '', rsf: null, source: '' }
      })
    })
  }, [fitResult])

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
    setOverlayState(createDefaultOverlayState())
    setFitResult(null)
    setPeakCandidates([])
    setRsfRows([])
  }

  const set = <K extends keyof ProcessParams>(key: K) => (val: ProcessParams[K]) => {
    if (processingViewMode === 'overlay') {
      setOverlayState(current => ({ ...current, params: { ...current.params, [key]: val } }))
      return
    }
    setParams(p => ({ ...p, [key]: val }))
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
        4,
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
            energy_shift: Number((current.params.energy_shift + res.offset_ev).toFixed(4)),
          },
        }))
      } else {
        setParams(current => ({ ...current, energy_shift: Number((current.energy_shift + res.offset_ev).toFixed(4)) }))
      }
    } catch (e: unknown) {
      setCalibrationError((e as Error).message)
    } finally {
      setCalibrationLoading(false)
    }
  }

  const computeVbmFn = async () => {
    if (!activeDataset) return
    setVbmLoading(true); setVbmError(null)
    try {
      const res = await computeVbm(activeDataset.x, activeDataset.y_processed, vbmEdgeLo, vbmEdgeHi, vbmBaselineLo, vbmBaselineHi)
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
    const validCount = rsfRows.filter(r => r.element.trim() && r.orbitalLabel.trim()).length
    if (validCount === 0) { setRsfError('請先填入元素與軌域標籤'); return }
    setRsfLoading(true); setRsfError(null)
    try {
      const items: RsfRequestItem[] = rsfRows.map(r => ({ element: r.element.trim(), label: r.orbitalLabel.trim() }))
      const results: RsfResultRow[] = await lookupRsf(items)
      setRsfRows(prev => prev.map((row, idx) => ({
        ...row,
        rsf: results[idx]?.rsf ?? null,
        source: results[idx]?.source ?? '',
      })))
    } catch (e: unknown) { setRsfError((e as Error).message) }
    finally { setRsfLoading(false) }
  }

  const loadElementPeaks = async () => {
    if (!selectedElement) return
    setElementsLoading(true); setFitError(null)
    try {
      const data = await fetchElementPeaks(selectedElement)
      const maxY = activeDataset ? Math.max(...activeDataset.y_processed) : 1000
      const newPeaks: PeakCandidate[] = data.peaks.map(pk => ({
        id: createPeakId(),
        label: `${selectedElement} ${pk.label}`,
        enabled: true,
        center: pk.be,
        fwhm: pk.fwhm,
        amplitude: maxY * 0.5,
      }))
      setPeakCandidates(prev => [...prev, ...newPeaks])
    } catch (e: unknown) { setFitError((e as Error).message) }
    finally { setElementsLoading(false) }
  }

  const addManualPeak = () => {
    const center = activeDataset ? (beMin + beMax) / 2 : 500
    setPeakCandidates(prev => [...prev, {
      id: createPeakId(), label: `峰 ${prev.length + 1}`, enabled: true,
      center, fwhm: 1.5, amplitude: 1000,
    }])
  }

  const handleFit = async () => {
    if (!activeDataset) return
    const activePeaks = peakCandidates.filter(p => p.enabled)
    if (activePeaks.length === 0) { setFitError('請先新增至少一個峰'); return }
    setIsFitting(true); setFitError(null)
    try {
      const initPeaks: InitPeak[] = activePeaks.map(p => ({ center: p.center, fwhm: p.fwhm, amplitude: p.amplitude, label: p.label }))
      const peakLabels = activePeaks.map(p => p.label)
      const res = await fitPeaks(activeDataset.x, activeDataset.y_processed, initPeaks, fitProfile, peakLabels)
      setFitResult(res)
    } catch (e: unknown) { setFitError((e as Error).message) }
    finally { setIsFitting(false) }
  }

  const datasetTabs = rawFiles
  const stageDisplayLabel = getStageDisplayLabel(currentParams)
  const rawChartSourceFiles = processingViewMode === 'overlay'
    ? overlayFiles
    : rawFiles
  const rawChartActiveIndex = processingViewMode === 'overlay' ? 0 : activeDatasetIdx
  const rawStageDatasets = rawChartSourceFiles.map(file => ({ name: file.name, x: file.x, y: file.y }))
  const preprocessStageDatasets = rawPreview && preprocessDataset
    ? [{ name: preprocessDataset.name, x: preprocessDataset.x, y: preprocessDataset.y_processed }]
    : []
  const backgroundStageDatasets = backgroundDataset
    ? [{ name: backgroundDataset.name, x: backgroundDataset.x, y: backgroundDataset.y_processed }]
    : []
  const normalizationStageDatasets = normalizationDataset
    ? [{ name: normalizationDataset.name, x: normalizationDataset.x, y: normalizationDataset.y_processed }]
    : []
  const finalStageDatasets = processingViewMode === 'single' && activeDataset
    ? [{ name: activeDataset.name, x: activeDataset.x, y: activeDataset.y_processed }]
    : []
  const overlayFinalDatasets = getOverlayStageDatasets(overlayBundle?.final ?? null, overlayState.params.average)
  const overlayBackgroundDatasets = getOverlayStageDatasets(overlayBundle?.background ?? null, overlayState.params.average)
  const overlayNormalizationDatasets = getOverlayStageDatasets(overlayBundle?.normalization ?? null, overlayState.params.average)
  const overlayPreprocessDatasets = getOverlayStageDatasets(overlayBundle?.preprocess ?? null, overlayState.params.average)
  const overlayMinCount = overlayState.params.average ? 1 : 2
  const overlayStage = overlayNormalizationDatasets.length >= overlayMinCount
    ? { title: '多筆疊圖比較：歸一化後', description: '這裡疊的是各筆資料經過各自設定的歸一化結果。', datasets: overlayNormalizationDatasets }
    : overlayBackgroundDatasets.length >= overlayMinCount
      ? { title: '多筆疊圖比較：背景扣除後', description: '這裡疊的是各筆資料經過各自設定的背景扣除結果。', datasets: overlayBackgroundDatasets }
      : overlayPreprocessDatasets.length >= overlayMinCount
        ? { title: '多筆疊圖比較：內插 / 平均 / 校正後', description: '這裡疊的是各筆資料在進入背景扣除前的前處理結果。', datasets: overlayPreprocessDatasets }
        : overlayFinalDatasets.length >= overlayMinCount
          ? { title: '多筆疊圖比較：最終處理後', description: '這裡疊的是各筆資料目前最新的處理結果。', datasets: overlayFinalDatasets }
          : null
  const isOverlayView = processingViewMode === 'overlay' && Boolean(overlayStage && overlaySelection.length >= 2)
  const rawChartTraces = buildRawFileTraces(rawChartSourceFiles, rawChartActiveIndex, rawFileColors)
  const preprocessChartTraces = rawPreview && preprocessDataset
    ? buildPipelineOverlayTraces(
        { x: rawPreview.x, y: rawPreview.y, name: `${rawPreview.name} 原始` },
        { x: preprocessDataset.x, y: preprocessDataset.y_processed, name: `${preprocessDataset.name} 前處理` },
        stageDisplayLabel ? `${stageDisplayLabel}後` : '前處理後',
        chartLineColors.preprocess,
      )
    : []
  const backgroundChartTraces = backgroundDataset
    ? [
        {
          x: backgroundDataset.x,
          y: backgroundDataset.y_raw,
          type: 'scatter',
          mode: 'lines',
          name: '背景扣除前',
          line: { color: (LINE_COLOR_PALETTES[chartLineColors.background] ?? LINE_COLOR_PALETTES.orange).secondary, width: 1.4 },
          opacity: 0.82,
        },
        ...(backgroundDataset.y_background ? [{
          x: backgroundDataset.x,
          y: backgroundDataset.y_background,
          type: 'scatter' as const,
          mode: 'lines' as const,
          name: '背景線',
          line: { color: (LINE_COLOR_PALETTES[chartLineColors.background] ?? LINE_COLOR_PALETTES.orange).tertiary, width: 1.3, dash: 'dot' as const },
        }] : []),
        {
          x: backgroundDataset.x,
          y: backgroundDataset.y_processed,
          type: 'scatter',
          mode: 'lines',
          name: '背景扣除後',
          line: { color: (LINE_COLOR_PALETTES[chartLineColors.background] ?? LINE_COLOR_PALETTES.orange).primary, width: 2.1 },
        },
      ]
    : []
  const normalizationInput = hasBackgroundStage ? backgroundDataset : preprocessDataset
  const normalizationChartTraces = normalizationDataset && normalizationInput
    ? buildPipelineOverlayTraces(
        { x: normalizationInput.x, y: normalizationInput.y_processed, name: '歸一化前' },
        { x: normalizationDataset.x, y: normalizationDataset.y_processed, name: '歸一化後' },
        '歸一化後',
        chartLineColors.normalization,
      )
    : []
  const backgroundLayout = {
    ...(chartLayout() as Plotly.Layout),
    shapes: buildRegionShapes(currentParams.bg_x_start ?? beMin, currentParams.bg_x_end ?? beMax, 'rgba(245, 158, 11, 0.55)'),
    annotations: buildRegionAnnotations(currentParams.bg_x_start ?? beMin, currentParams.bg_x_end ?? beMax, '背景區間', '#f59e0b'),
  }
  const normalizationLayout = {
    ...(chartLayout() as Plotly.Layout),
    shapes: buildRegionShapes(currentParams.norm_x_start ?? beMin, currentParams.norm_x_end ?? beMax, 'rgba(20, 184, 166, 0.55)'),
    annotations: buildRegionAnnotations(currentParams.norm_x_start ?? beMin, currentParams.norm_x_end ?? beMax, '歸一化區間', '#14b8a6'),
  }

  const sidebarStyle: CSSProperties = sidebarCollapsed
    ? { width: SIDEBAR_COLLAPSED_PEEK, minWidth: SIDEBAR_COLLAPSED_PEEK, overflow: 'hidden' }
    : { width: sidebarWidth, minWidth: SIDEBAR_MIN_WIDTH, maxWidth: SIDEBAR_MAX_WIDTH }

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
            {/* ── Logo header ── */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[color:color-mix(in_srgb,var(--accent-strong)_14%,var(--card-bg))]">
                  <svg width="18" height="16" viewBox="0 0 18 16" fill="none">
                    <path d="M1 13 L4.5 13 L6.5 8 L9 1 L11.5 8 L13.5 13 L17 13"
                      stroke="var(--accent-strong)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold leading-tight text-[var(--text-main)]">Nigiro Pro</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-[var(--text-soft)]">Spectroscopy Analysis</div>
                </div>
              </div>
              <button type="button" onClick={() => setSidebarCollapsed(true)} className="text-xs text-[var(--text-soft)] hover:text-[var(--text-main)]">‹</button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* ── Compact module selector ── */}
              <div className="px-4 pb-2 pt-1">
                <div
                  className="relative"
                  onMouseEnter={() => setModuleDropdownOpen(true)}
                  onMouseLeave={() => setModuleDropdownOpen(false)}
                >
                  <button type="button" className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-[10px] text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)]">
                    <span className="uppercase tracking-[0.14em]">分析模組</span>
                    <span className="rounded-md bg-[color:color-mix(in_srgb,var(--accent-strong)_13%,var(--card-bg))] px-1.5 py-0.5 font-semibold text-[var(--accent-strong)]">XPS</span>
                    <span className="text-[8px]">▾</span>
                  </button>
                  {moduleDropdownOpen && (
                    <div className="absolute left-0 top-[calc(100%+2px)] z-30 min-w-[160px] rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-1.5 [box-shadow:var(--card-shadow)]">
                      {ANALYSIS_MODULES.map(mod => {
                        const isActive = mod.id === 'xps'
                        return (
                          <button
                            key={mod.id}
                            type="button"
                            disabled={isActive}
                            onClick={() => { if (!isActive) { onModuleSelect?.(mod.id); setModuleDropdownOpen(false) } }}
                            className={[
                              'flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs transition-colors pressable',
                              isActive
                                ? 'bg-[var(--accent-soft)] font-semibold text-[var(--text-main)]'
                                : 'text-[var(--text-main)] hover:bg-[var(--card-ghost)]',
                            ].join(' ')}
                          >
                            <span>{mod.label}</span>
                            {isActive && <span className="text-[10px] text-[var(--accent-strong)]">●</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Mode toggle */}
              <div className="px-4 py-3">
                <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">分析模式</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['core_level', 'valence_band'] as const).map(m => (
                    <button key={m} type="button" onClick={() => setXpsMode(m)}
                      className={['rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors pressable',
                        xpsMode === m ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-main)]' : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-soft)]'].join(' ')}
                    >
                      {m === 'core_level' ? 'Core Level' : 'Valence Band'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-4 pt-4">
                <Section step={1} title="載入檔案" hint="XY / VMS / TXT / CSV">
                  <FileUpload onFiles={handleFiles} isLoading={isLoading} moduleLabel="XPS" accept={['.xy', '.txt', '.csv', '.vms', '.pro', '.dat']} />
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

                <Section step={2} title="內插" hint="先統一點數，再進到後續流程" defaultOpen={false}>
                  <CheckRow label="啟用內插" checked={currentParams.interpolate} onChange={set('interpolate')} />
                  {rawFiles.length > 0 && (
                    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-3 text-xs">
                      <p className="font-medium text-[var(--text-main)]">原始資料共 {rawFiles.length} 筆</p>
                      <div className="mt-2 space-y-1 text-[var(--text-soft)]">
                        {rawFiles.map(file => (
                          <div key={file.name} className="flex items-center justify-between gap-3">
                            <span className="truncate">{file.name}</span>
                            <span className="shrink-0">{file.x.length} 點</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {interpolationEnabled && (
                    <>
                      <CheckRow label="自動調整點數" checked={currentAutoInterpPoints} onChange={setCurrentAutoInterpPoints} />
                      {currentAutoInterpPoints ? (
                        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--accent-soft)] px-3 py-3 text-xs">
                          <p className="font-medium text-[var(--text-main)]">本次將使用 {effectiveNPoints} 點</p>
                          <p className="mt-1 text-[var(--text-soft)]">
                            依上傳光譜的原始點密度自動估算，並限制在 {INTERP_POINTS_MIN}–{INTERP_POINTS_MAX} 點之間。
                          </p>
                        </div>
                      ) : (
                        <NumInput label="點數" value={currentParams.n_points} onChange={set('n_points')} min={200} max={5000} step={100} />
                      )}
                    </>
                  )}
                </Section>

                <Section step={3} title="多檔平均" hint="平均前會沿用上一步的內插網格" defaultOpen={false}>
                  {processingViewMode === 'single' ? (
                    <p className="text-[10px] text-[var(--text-soft)]">單筆資料處理只會處理目前這一筆，所以這一步固定停用。</p>
                  ) : overlayFiles.length > 1 ? (
                    <>
                      <CheckRow
                        label="啟用多檔平均"
                        checked={currentParams.average}
                        onChange={value => setOverlayState(current => ({
                          ...current,
                          params: {
                            ...current.params,
                            average: value,
                            interpolate: value ? true : current.params.interpolate,
                          },
                        }))}
                      />
                      <p className="text-[10px] text-[var(--text-soft)]">疊圖模式下可對目前選取的多筆資料做平均，平均前會先對齊到同一組內插點數。</p>
                    </>
                  ) : (
                    <p className="text-[10px] text-[var(--text-soft)]">請先在多筆疊圖模式選至少 2 筆資料，這一步才可啟用。</p>
                  )}
                </Section>

                <Section step={4} title="能量校正" hint="手動位移 + 標準樣品自動校正" defaultOpen={false}>
                  <CheckRow label="手動調整偏移量" checked={currentManualEnergyShiftEnabled} onChange={setCurrentManualEnergyShiftEnabled} />
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
                        accept={['.xy', '.txt', '.csv', '.vms', '.pro', '.dat']}
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
                            觀測 {calibrationResult.observed_be?.toFixed(3)} eV
                          </p>
                          <p className="mt-1 text-[var(--text-soft)]">
                            參考 {calibrationResult.reference_be.toFixed(3)} eV，已套用偏移 {calibrationResult.offset_ev >= 0 ? '+' : ''}
                            {calibrationResult.offset_ev.toFixed(3)} eV。
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </Section>

                <Section step={5} title="背景扣除" hint="Shirley / Tougaard / Linear" defaultOpen={false}>
                  <CheckRow label="啟用背景扣除" checked={currentParams.bg_enabled} onChange={set('bg_enabled')} />
                  {currentParams.bg_enabled && (
                    <>
                      <CustomSelect label="方法" value={currentParams.bg_method} onChange={v => set('bg_method')(v as ProcessParams['bg_method'])}
                        options={[
                          { value: 'linear', label: 'Linear' },
                          { value: 'shirley', label: 'Shirley' },
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
                      <DualRangeInput
                        label="背景區間拉桿"
                        min={beMin}
                        max={beMax}
                        start={currentParams.bg_x_start ?? beMin}
                        end={currentParams.bg_x_end ?? beMax}
                        step={0.1}
                        onChange={({ start, end }) => {
                          set('bg_x_start')(start)
                          set('bg_x_end')(end)
                        }}
                      />
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

                <Section step={6} title="歸一化" hint="統一強度尺度" defaultOpen={false}>
                  <CustomSelect label="方法" value={currentParams.norm_method} onChange={v => set('norm_method')(v as ProcessParams['norm_method'])}
                    options={[
                      { value: 'none', label: '不歸一化' },
                      { value: 'min_max', label: 'Min–Max' },
                      { value: 'max', label: 'Max' },
                      { value: 'area', label: 'Area' },
                      { value: 'mean_region', label: 'Mean Region' },
                    ]}
                  />
                  {(currentParams.norm_method === 'min_max' || currentParams.norm_method === 'max' || currentParams.norm_method === 'area' || currentParams.norm_method === 'mean_region') && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <NumInput label="起始 (eV)" value={currentParams.norm_x_start ?? beMin} onChange={v => set('norm_x_start')(v)} step={0.1} />
                        <NumInput label="結束 (eV)" value={currentParams.norm_x_end ?? beMax} onChange={v => set('norm_x_end')(v)} step={0.1} />
                      </div>
                      <DualRangeInput
                        label="歸一化區間拉桿"
                        min={beMin}
                        max={beMax}
                        start={currentParams.norm_x_start ?? beMin}
                        end={currentParams.norm_x_end ?? beMax}
                        step={0.1}
                        onChange={({ start, end }) => {
                          set('norm_x_start')(start)
                          set('norm_x_end')(end)
                        }}
                      />
                    </>
                  )}
                </Section>

                <Section step={7} title="峰擬合" hint="元素資料庫選峰 / 手動新增 / Voigt" defaultOpen={false}>
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
                    <div key={pk.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <CheckRow label={pk.label} checked={pk.enabled} onChange={v => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, enabled: v } : p))} />
                        <button type="button" onClick={() => setPeakCandidates(prev => prev.filter(p => p.id !== pk.id))} className="text-rose-400 hover:text-rose-300">✕</button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <NumInput label="中心 (eV)" value={pk.center} onChange={v => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, center: v } : p))} step={0.1} />
                        <NumInput label="FWHM (eV)" value={pk.fwhm} onChange={v => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, fwhm: v } : p))} min={0.01} step={0.1} />
                        <NumInput label="強度" value={pk.amplitude} onChange={v => setPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, amplitude: v } : p))} min={0} step={100} />
                      </div>
                    </div>
                  ))}
                  {peakCandidates.length > 0 && (
                    <>
                      {peakCandidates.length > 1 && (
                        <button type="button" onClick={() => setPeakCandidates([])} className="text-xs text-rose-400 hover:text-rose-300">清除全部峰</button>
                      )}
                      <button type="button" onClick={handleFit} disabled={isFitting}
                        className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
                      >
                        {isFitting ? '擬合中…' : '執行擬合'}
                      </button>
                    </>
                  )}
                  {fitError && <p className="text-xs text-rose-400">{fitError}</p>}
                </Section>

                {xpsMode === 'valence_band' && (
                  <Section step={8} title="VBM 線性外推" hint="外推至基準線水平" defaultOpen={false}>
                    <p className="text-[10px] text-[var(--text-soft)]">在 VB 邊緣區做線性擬合，外推至基準線水平即為 VBM。</p>
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="邊緣起 (eV)" value={vbmEdgeLo} onChange={setVbmEdgeLo} step={0.1} />
                      <NumInput label="邊緣終 (eV)" value={vbmEdgeHi} onChange={setVbmEdgeHi} step={0.1} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="基準起 (eV)" value={vbmBaselineLo} onChange={setVbmBaselineLo} step={0.1} />
                      <NumInput label="基準終 (eV)" value={vbmBaselineHi} onChange={setVbmBaselineHi} step={0.1} />
                    </div>
                    <button type="button" onClick={computeVbmFn} disabled={vbmLoading || !activeDataset}
                      className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 pressable"
                    >
                      {vbmLoading ? '計算中…' : '計算 VBM'}
                    </button>
                    {vbmError && <p className="text-xs text-rose-400">{vbmError}</p>}
                    {vbmResult?.success && (
                      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--accent-soft)] p-3 text-xs space-y-1">
                        <p className="font-semibold text-[var(--text-main)]">VBM = {vbmResult.vbm_ev?.toFixed(3)} eV</p>
                        <p className="text-[var(--text-soft)]">斜率 = {vbmResult.slope.toFixed(4)} · 基準線 = {vbmResult.baseline_level.toFixed(2)}</p>
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
      <main className="flex flex-1 flex-col overflow-y-auto bg-[var(--bg-canvas)] p-4 sm:p-5">
        {error && (
          <div className="mb-4 rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">⚠ {error}</div>
        )}
        {isBusy && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-strong)]" /> 處理中…
          </div>
        )}

        {rawFiles.length === 0 && !isBusy && (
          <div className="flex flex-1 flex-col items-center justify-center rounded-[28px] border border-dashed border-[var(--card-border)] bg-[var(--card-bg)] px-6 py-20 text-center">
            <div className="mb-4 text-5xl opacity-30">⚛</div>
            <p className="font-display text-xl tracking-wide text-[var(--text-main)]">XPS 分析</p>
            <p className="mt-3 max-w-md text-sm leading-6 text-[var(--text-soft)]">
              上傳 XPS 光譜檔（.xy / .txt / .csv / .vms），支援 Shirley / Tougaard 背景扣除與 Voigt 峰擬合。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs text-[var(--text-soft)]">
              {['.XY', '.TXT', '.CSV', '.VMS', '.PRO'].map(ext => (
                <span key={ext} className="rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5">{ext}</span>
              ))}
            </div>
          </div>
        )}

        {rawFiles.length > 0 && (
          <>
            {datasetTabs.length > 1 && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">單筆資料處理</p>
                      {isOverlayView && (
                        <span className="rounded-full border border-[var(--accent-secondary)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_14%,transparent)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--accent-secondary)]">
                          目前顯示疊圖模式
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {datasetTabs.map((ds, idx) => (
                        <button key={ds.name} type="button" onClick={() => enterSingleMode(idx)}
                          className={['rounded-full border px-3 py-1 text-xs font-medium transition-colors pressable',
                            !isOverlayView && idx === activeDatasetIdx
                              ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-main)]'
                              : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-soft)]'].join(' ')}
                        >{ds.name}</button>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 lg:pl-4">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">多筆疊圖處理</p>
                    <button
                      type="button"
                      onClick={() => setOverlaySelectorOpen(true)}
                      className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 text-left transition-colors hover:border-[var(--accent-secondary)] hover:bg-[color:color-mix(in_srgb,var(--accent-secondary)_10%,transparent)] pressable"
                    >
                      <span className="block text-sm font-semibold text-[var(--text-main)]">選擇疊圖資料</span>
                      <span className="mt-1 block text-xs text-[var(--text-soft)]">
                        {processingViewMode === 'overlay' ? '目前疊圖模式獨立計算，不沿用單筆參數。' : ''}
                        {processingViewMode === 'overlay' ? ' ' : ''}
                        已選 {overlaySelection.length} 筆
                        {overlaySelection.length >= 2 ? '，可直接看中間欄疊圖結果' : '，至少選 2 筆才會顯示疊圖'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">資料集</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-main)]">{rawFiles.length} 個</p>
              </div>
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">BE 範圍</p>
                <p className="mt-1 text-base font-semibold text-[var(--text-main)]">
                  {rawPreview ? `${Math.min(...rawPreview.x).toFixed(1)} – ${Math.max(...rawPreview.x).toFixed(1)} eV` : '—'}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">內插點數</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-main)]">
                  {currentParams.interpolate || (processingViewMode === 'overlay' && currentParams.average) ? `${effectiveNPoints} 點` : '未啟用'}
                </p>
              </div>
            </div>

            {rawChartTraces.length > 0 && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <p className="mb-2 text-sm font-semibold text-[var(--text-main)]">1. 原始光譜</p>
                {rawChartSourceFiles.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {rawChartSourceFiles.map((file, idx) => {
                      const globalIdx = processingViewMode === 'overlay'
                        ? rawFiles.indexOf(file)
                        : idx
                      const colorKey = rawFileColors[globalIdx >= 0 ? globalIdx : idx] ?? DEFAULT_SERIES_PALETTE_KEYS[idx % DEFAULT_SERIES_PALETTE_KEYS.length]
                      const palette = LINE_COLOR_PALETTES[colorKey] ?? LINE_COLOR_PALETTES.blue
                      const isActive = idx === rawChartActiveIndex
                      return (
                        <div key={`${file.name}-${idx}`} className="flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: palette.primary, opacity: isActive ? 1 : 0.65 }}
                          />
                          <span className={`max-w-[100px] truncate text-[10px] ${isActive ? 'font-semibold text-[var(--text-main)]' : 'text-[var(--text-soft)]'}`}>
                            {file.name}
                          </span>
                          <select
                            value={colorKey}
                            onChange={e => {
                              const targetIdx = globalIdx >= 0 ? globalIdx : idx
                              setRawFileColors(prev => {
                                const next = [...prev]
                                next[targetIdx] = e.target.value
                                return next
                              })
                            }}
                            className="rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1 py-0.5 text-[10px] text-[var(--input-text)] focus:outline-none"
                          >
                            {LINE_COLOR_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                )}
                <Plot
                  data={rawChartTraces as Plotly.Data[]}
                  layout={chartLayout() as Plotly.Layout}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: 340 }}
                />
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(rawStageDatasets, 'binding_energy_eV', 'intensity_raw'), 'xps_raw_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}

            {overlayStage && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <ChartToolbar
                  title={overlayStage.title}
                  colorValue={chartLineColors.overlay}
                  onColorChange={value => setChartLineColors(current => ({ ...current, overlay: value }))}
                />
                <p className="mb-3 text-xs text-[var(--text-soft)]">{overlayStage.description}</p>
                <Plot
                  data={buildOverlayTraces(overlayStage.datasets, chartLineColors.overlay) as Plotly.Data[]}
                  layout={chartLayout() as Plotly.Layout}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: 340 }}
                />
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(overlayStage.datasets, 'binding_energy_eV', 'intensity_processed'), 'xps_overlay_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}

            {processingViewMode === 'single' && hasPreprocessStage && preprocessChartTraces.length > 0 && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <ChartToolbar
                  title={`2. ${stageDisplayLabel || '前處理'}後疊圖`}
                  colorValue={chartLineColors.preprocess}
                  onColorChange={value => setChartLineColors(current => ({ ...current, preprocess: value }))}
                />
                <p className="mb-3 text-xs text-[var(--text-soft)]">這張圖把原始光譜和前處理後結果疊在一起，方便對照點數與能量軸變化。</p>
                <Plot
                  data={preprocessChartTraces as Plotly.Data[]}
                  layout={chartLayout() as Plotly.Layout}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: 340 }}
                />
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(preprocessStageDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_preprocess_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}

            {processingViewMode === 'single' && hasBackgroundStage && backgroundChartTraces.length > 0 && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <ChartToolbar
                      title="3. 背景扣除"
                      colorValue={chartLineColors.background}
                      onColorChange={value => setChartLineColors(current => ({ ...current, background: value }))}
                    />
                  </div>
                  <CheckRow label="顯示背景線" checked={showBg} onChange={setShowBg} />
                </div>
                <p className="mb-3 text-xs text-[var(--text-soft)]">輸入是前一階段的結果。圖上橘色區塊是你目前選擇的背景區間。</p>
                <Plot
                  data={(showBg ? backgroundChartTraces : backgroundChartTraces.filter(trace => trace.name !== '背景線')) as Plotly.Data[]}
                  layout={backgroundLayout as Plotly.Layout}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: 340 }}
                />
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(backgroundStageDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_background_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}

            {processingViewMode === 'single' && hasNormalizationStage && normalizationChartTraces.length > 0 && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <ChartToolbar
                  title="4. 歸一化"
                  colorValue={chartLineColors.normalization}
                  onColorChange={value => setChartLineColors(current => ({ ...current, normalization: value }))}
                />
                <p className="mb-3 text-xs text-[var(--text-soft)]">輸入是背景扣除後的光譜；若未啟用背景扣除，則直接使用前處理結果。綠色區塊是歸一化區間。</p>
                <Plot
                  data={normalizationChartTraces as Plotly.Data[]}
                  layout={normalizationLayout as Plotly.Layout}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: 340 }}
                />
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(normalizationStageDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_normalization_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}

            {processingViewMode === 'single' && result && activeDataset && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <ChartToolbar
                      title={`最終處理光譜${fitResult ? '（含擬合結果）' : ''}`}
                      colorValue={chartLineColors.final}
                      onColorChange={value => setChartLineColors(current => ({ ...current, final: value }))}
                    />
                  </div>
                  <CheckRow label="顯示原始" checked={showRaw} onChange={setShowRaw} />
                </div>
                <Plot
                  data={(fitResult ? buildFitTraces(activeDataset, fitResult, chartLineColors.final) : buildMainTraces(activeDataset, showRaw, showBg, chartLineColors.final)) as Plotly.Data[]}
                  layout={chartLayout() as Plotly.Layout}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: 380 }}
                />
                <div className="mt-3 flex justify-start">
                  <ExportBtn
                    label="下載此步驟 CSV"
                    onClick={() => downloadFile(buildStageCsv(finalStageDatasets, 'binding_energy_eV', 'intensity_processed'), 'xps_final_stage.csv', 'text/csv')}
                  />
                </div>
              </div>
            )}

            {processingViewMode === 'single' && fitResult && fitResult.peaks.length > 0 && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">峰擬合結果</p>
                <table className="w-full text-xs">
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
                    {fitResult.peaks.map(pk => (
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
            )}

            {processingViewMode === 'single' && xpsMode === 'valence_band' && vbmResult?.success && activeDataset && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <p className="mb-2 text-sm font-semibold text-[var(--text-main)]">VBM 線性外推</p>
                <Plot
                  data={[
                    { x: activeDataset.x, y: activeDataset.y_processed, type: 'scatter', mode: 'lines', name: '光譜', line: { color: '#38bdf8', width: 1.8 } },
                    { x: vbmResult.x_fit, y: vbmResult.y_fit, type: 'scatter', mode: 'lines', name: '外推線', line: { color: '#f97316', width: 1.5, dash: 'dash' } },
                    { x: vbmResult.x_fit.length > 0 ? [vbmResult.x_fit[0], vbmResult.x_fit[vbmResult.x_fit.length - 1]] : [], y: [vbmResult.baseline_level, vbmResult.baseline_level], type: 'scatter', mode: 'lines', name: '基準線', line: { color: '#a855f7', width: 1.2, dash: 'dot' } },
                    ...(vbmResult.vbm_ev != null ? [{ x: [vbmResult.vbm_ev], y: [vbmResult.baseline_level], type: 'scatter' as const, mode: 'markers' as const, name: 'VBM', marker: { color: '#f97316', size: 10, symbol: 'diamond' as const } }] : []),
                  ] as Plotly.Data[]}
                  layout={{
                    ...(chartLayout() as Plotly.Layout),
                    margin: { l: 60, r: 20, t: 20, b: 50 },
                    annotations: vbmResult.vbm_ev != null ? [{
                      x: vbmResult.vbm_ev, y: vbmResult.baseline_level,
                      text: `VBM = ${vbmResult.vbm_ev.toFixed(3)} eV`,
                      showarrow: true, arrowhead: 2, ax: 50, ay: -35,
                      font: { color: '#f97316', size: 11 }, arrowcolor: '#f97316',
                    }] : [],
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%', height: 280 }}
                />
              </div>
            )}

            {processingViewMode === 'single' && xpsMode === 'valence_band' && bandOffsetResult && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">能帶偏移結果</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--accent-soft)_50%,var(--card-bg))] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">ΔEV</p>
                    <p className="mt-1 text-xl font-semibold text-[var(--text-main)]">{bandOffsetResult.deltaEv.toFixed(3)} eV</p>
                    {bandOffsetResult.sigmaEv > 0 && <p className="text-[11px] text-[var(--text-soft)]">± {bandOffsetResult.sigmaEv.toFixed(3)} eV</p>}
                  </div>
                  <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">方法</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">
                      {bandOffsetMethod === 'vbm_diff' ? 'VBM 差值法' : 'Kraut Method'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {processingViewMode === 'single' && fitResult && fitResult.peaks.length > 0 && rsfRows.length > 0 && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-[var(--text-main)]">RSF 定量分析</p>
                  <button type="button" onClick={lookupRsfFn} disabled={rsfLoading}
                    className="rounded-lg border border-[var(--accent-strong)] px-3 py-1 text-xs text-[var(--accent-strong)] hover:bg-[var(--accent-soft)] disabled:opacity-50 pressable"
                  >
                    {rsfLoading ? '查詢中…' : '查詢 RSF & 計算'}
                  </button>
                </div>
                {rsfError && <p className="mb-2 text-xs text-rose-400">{rsfError}</p>}
                <table className="w-full text-xs">
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
                    {rsfRows.map((row, idx) => {
                      const pk = fitResult.peaks[idx]
                      const totalRsfArea = rsfRows.reduce((acc, r, i) => {
                        const a = fitResult.peaks[i]?.Area ?? 0
                        return acc + (r.rsf ? Math.abs(a) / r.rsf : 0)
                      }, 0)
                      const rsfArea = row.rsf ? Math.abs(pk?.Area ?? 0) / row.rsf : null
                      const atomicPct = rsfArea != null && totalRsfArea > 0 ? rsfArea / totalRsfArea * 100 : null
                      return (
                        <tr key={row.peakName} className="border-b border-[var(--card-divider)]">
                          <td className="py-1.5 font-medium">{row.peakName}</td>
                          <td className="py-1">
                            <input value={row.element} placeholder="e.g. Ni"
                              onChange={e => setRsfRows(prev => prev.map((r, i) => i === idx ? { ...r, element: e.target.value } : r))}
                              className="w-14 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1.5 py-0.5 text-xs text-[var(--input-text)]"
                            />
                          </td>
                          <td className="py-1">
                            <input value={row.orbitalLabel} placeholder="2p3/2"
                              onChange={e => setRsfRows(prev => prev.map((r, i) => i === idx ? { ...r, orbitalLabel: e.target.value } : r))}
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
                {rsfRows.some(r => r.rsf != null) && (
                  <p className="mt-2 text-[10px] text-[var(--text-soft)]">
                    RSF 來源：Scofield (1976)，Al Kα。Atomic% = (Area/RSF) / Σ(Area/RSF) × 100。
                  </p>
                )}
              </div>
            )}

            {processingViewMode === 'single' && activeDataset && (
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出</p>
                <div className="flex flex-wrap gap-2">
                  <ExportBtn label="處理後光譜 CSV" onClick={() => {
                    const headers = ['binding_energy_eV', 'intensity_raw', 'intensity_processed']
                    const rows = activeDataset.x.map((x, i) => [x, activeDataset.y_raw[i], activeDataset.y_processed[i]])
                    downloadFile(toCsv(headers, rows), 'xps_processed.csv', 'text/csv')
                  }} />
                  {fitResult && fitResult.peaks.length > 0 && (
                    <ExportBtn label="擬合結果 CSV" onClick={() => {
                      const headers = ['Peak', 'Center_eV', 'FWHM_eV', 'Area', 'Area_pct']
                      const rows: (string | number | null)[][] = fitResult.peaks.map(pk => [pk.Peak_Name, pk.Center_eV, pk.FWHM_eV, pk.Area, pk.Area_pct])
                      downloadFile(toCsv(headers, rows), 'xps_fit.csv', 'text/csv')
                    }} />
                  )}
                  {rsfRows.some(r => r.rsf != null) && fitResult && (
                    <ExportBtn label="RSF 定量 CSV" onClick={() => {
                      const totalRsfArea = rsfRows.reduce((acc, r, i) => {
                        const a = fitResult.peaks[i]?.Area ?? 0
                        return acc + (r.rsf ? Math.abs(a) / r.rsf : 0)
                      }, 0)
                      const headers = ['Peak', 'Element', 'Orbital', 'Area', 'RSF', 'RSF_Area', 'Atomic_pct']
                      const rows: (string | number | null)[][] = rsfRows.map((row, idx) => {
                        const pk = fitResult.peaks[idx]
                        const rsfArea = row.rsf ? Math.abs(pk?.Area ?? 0) / row.rsf : null
                        const atomicPct = rsfArea != null && totalRsfArea > 0 ? rsfArea / totalRsfArea * 100 : null
                        return [row.peakName, row.element, row.orbitalLabel, pk?.Area ?? 0, row.rsf, rsfArea, atomicPct]
                      })
                      downloadFile(toCsv(headers, rows), 'xps_rsf_quantification.csv', 'text/csv')
                    }} />
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {overlaySelectorOpen && (
        <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/35 px-4 py-8 backdrop-blur-[2px]">
          <div className="theme-block max-h-[calc(100vh-4rem)] w-full max-w-4xl overflow-hidden rounded-[28px]">
            <div className="flex items-center justify-between border-b border-[var(--card-divider)] px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-[var(--text-main)]">多筆數據疊圖處理</p>
                <p className="mt-1 text-xs text-[var(--text-soft)]">會列出目前所有資料，你可以從中選取要一起比較的光譜。</p>
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
                      setOverlaySelection(overlayDraftSelection)
                      setProcessingViewMode('single')
                    }
                    setOverlaySelectorOpen(false)
                  }}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:opacity-90 pressable"
                >
                  套用疊圖選擇
                </button>
              </div>
              <p className="text-xs text-[var(--text-soft)]">多筆疊圖模式會使用獨立的一套內插、背景扣除與歸一化參數，不會沿用單筆資料處理時的設定。</p>
            </div>
          </div>
        </div>
      )}

      {periodicTableOpen && (
        <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/35 px-4 py-8 backdrop-blur-[2px]">
          <div className="theme-block max-h-[calc(100vh-4rem)] w-full max-w-6xl overflow-hidden rounded-[28px]">
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
