import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import Plot from '../components/PlotlyChart'
import type { AnalysisModuleId } from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import { EmptyWorkspaceState, InfoCardGrid, MODULE_CONTENT, ModuleTopBar, StickySidebarHeader } from '../components/WorkspaceUi'
import { withPlotFullscreen } from '../components/plotConfig'
import type { PlotPopupRequest } from '../hooks/usePlotPopups'
import { fetchXasSamplePeaks, fitXasPeaks, listXasSamples, parseFiles, processData } from '../api/xas'
import type {
  DatasetInput,
  GaussPeak,
  ParsedXasFile,
  ProcessParams,
  ProcessResult,
  ProcessedDataset,
  XasFitResult,
  XasInitPeak,
  XasSampleListItem,
} from '../types/xas'

const SIDEBAR_MIN_WIDTH = 300
const SIDEBAR_MAX_WIDTH = 520
const SIDEBAR_DEFAULT_WIDTH = 340
const SIDEBAR_COLLAPSED_PEEK = 28
const INTERP_POINTS_MIN = 200
const INTERP_POINTS_MAX = 10000
const INTERP_POINTS_DEFAULT = 2000

const DEFAULT_PARAMS: ProcessParams = {
  interpolate: false,
  n_points: INTERP_POINTS_DEFAULT,
  average: false,
  energy_shift: 0,
  bg_enabled: false,
  bg_channel: 'both',
  bg_method: 'linear',
  bg_x_start: null,
  bg_x_end: null,
  bg_poly_deg: 3,
  bg_baseline_lambda: 1e5,
  bg_baseline_p: 0.01,
  bg_baseline_iter: 20,
  norm_method: 'none',
  norm_x_start: null,
  norm_x_end: null,
  norm_pre_start: null,
  norm_pre_end: null,
  white_line_start: null,
  white_line_end: null,
  gauss_enabled: false,
  gauss_channel: 'both',
  gauss_peaks: [],
  gauss_search: 0.5,
}

const BACKGROUND_METHOD_HELP: Record<Exclude<ProcessParams['bg_method'], 'none'>, string> = {
  linear: '用選定區間的兩端連線作為背景，適合前後緩慢傾斜的 baseline。',
  polynomial: '以多項式追蹤彎曲背景，適合較平滑但非線性的趨勢。',
  asls: 'AsLS 透過不對稱加權與平滑懲罰估計背景，會盡量讓基線落在峰形下方。',
  airpls: 'airPLS 是自適應迭代版的懲罰最小平方法，對複雜基線通常更穩健，手動參數也更少。',
}

const OVERLAY_COLORS = [
  '#38bdf8', '#a78bfa', '#34d399', '#f97316',
  '#fb7185', '#facc15', '#22d3ee', '#818cf8',
]

const CHANNEL_COLORS: Record<'TEY' | 'TFY', string> = {
  TEY: '#38bdf8',
  TFY: '#a78bfa',
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

function getFileStats(file: ParsedXasFile) {
  const xs = file.x
  if (!xs || xs.length < 2) return null
  const finite = xs.filter(Number.isFinite)
  if (finite.length < 2) return null
  const xStart = finite[0]
  const xEnd = finite[finite.length - 1]
  const span = Math.abs(xEnd - xStart)
  const nPts = finite.length
  const step = span / Math.max(nPts - 1, 1)
  return { xStart, xEnd, span, nPts, step }
}

function estimateInterpolationPoints(files: ParsedXasFile[]) {
  if (files.length === 0) return INTERP_POINTS_DEFAULT
  const estimated = files.map(file => {
    if (!file.x || file.x.length < 2) return file.x.length || INTERP_POINTS_DEFAULT
    const xs = [...file.x].filter(Number.isFinite).sort((a, b) => a - b)
    if (xs.length < 2) return file.x.length || INTERP_POINTS_DEFAULT
    const diffs: number[] = []
    for (let i = 1; i < xs.length; i += 1) {
      const diff = xs[i] - xs[i - 1]
      if (Number.isFinite(diff) && diff > 0) diffs.push(diff)
    }
    const step = median(diffs)
    const span = xs[xs.length - 1] - xs[0]
    if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(span) || span <= 0) {
      return file.x.length || INTERP_POINTS_DEFAULT
    }
    return Math.round(span / step) + 1
  })
  const raw = median(estimated)
  const roundTo = raw < 300 ? 10 : 50
  const target = Math.round(raw / roundTo) * roundTo
  return clamp(target || INTERP_POINTS_DEFAULT, INTERP_POINTS_MIN, INTERP_POINTS_MAX)
}

function chartLayout(xLabel: string, yLabel: string): Partial<Plotly.Layout> {
  const css = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const grid = css?.getPropertyValue('--chart-grid').trim() || 'rgba(148,163,184,0.14)'
  const text = css?.getPropertyValue('--chart-text').trim() || '#d9e4f0'
  const bg = css?.getPropertyValue('--chart-bg').trim() || 'rgba(15,23,42,0.52)'
  const legendBg = css?.getPropertyValue('--chart-legend-bg').trim() || 'rgba(15,23,42,0.72)'
  const hoverBg = css?.getPropertyValue('--chart-hover-bg').trim() || 'rgba(15,23,42,0.95)'
  const hoverBorder = css?.getPropertyValue('--chart-hover-border').trim() || 'rgba(148,163,184,0.22)'
  return {
    xaxis: { title: { text: xLabel }, showgrid: true, gridcolor: grid, zeroline: false, color: text },
    yaxis: { title: { text: yLabel }, showgrid: true, gridcolor: grid, zeroline: false, color: text },
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

function getChannelRaw(dataset: ProcessedDataset, channel: 'TEY' | 'TFY') {
  return channel === 'TEY' ? dataset.tey_raw : dataset.tfy_raw
}

function getChannelProcessed(dataset: ProcessedDataset, channel: 'TEY' | 'TFY') {
  return channel === 'TEY' ? dataset.tey_processed : dataset.tfy_processed
}

function getChannelAfterGaussian(dataset: ProcessedDataset, channel: 'TEY' | 'TFY') {
  return channel === 'TEY' ? dataset.tey_after_gauss : dataset.tfy_after_gauss
}

function buildTraces(dataset: ProcessedDataset, channel: 'TEY' | 'TFY', showRaw: boolean): Plotly.Data[] {
  const raw = getChannelRaw(dataset, channel)
  const processed = getChannelProcessed(dataset, channel)
  const traces: Plotly.Data[] = []
  if (showRaw) {
    traces.push({ x: dataset.x, y: raw, type: 'scatter', mode: 'lines', name: '原始', line: { color: '#94a3b8', width: 1.4 } })
  }
  traces.push({ x: dataset.x, y: processed, type: 'scatter', mode: 'lines', name: '處理後', line: { color: CHANNEL_COLORS[channel], width: 2.0 } })
  const wl = channel === 'TEY' ? dataset.white_line_tey : dataset.white_line_tfy
  if (wl != null) {
    traces.push({
      x: [wl, wl],
      y: [Math.min(...processed), Math.max(...processed)],
      type: 'scatter',
      mode: 'lines',
      name: `White Line ${wl.toFixed(2)} eV`,
      line: { color: '#f97316', width: 1.4, dash: 'dash' },
    })
  }
  return traces
}

function buildRawTraces(dataset: ProcessedDataset, channel: 'TEY' | 'TFY'): Plotly.Data[] {
  return [{
    x: dataset.x,
    y: getChannelRaw(dataset, channel),
    type: 'scatter',
    mode: 'lines',
    name: `原始 ${channel}`,
    line: { color: CHANNEL_COLORS[channel], width: 1.9 },
  }]
}

function buildComparisonTraces(
  x: number[],
  beforeY: number[] | null | undefined,
  afterY: number[] | null | undefined,
  channel: 'TEY' | 'TFY',
  beforeName: string,
  afterName: string,
): Plotly.Data[] {
  const traces: Plotly.Data[] = []
  if (beforeY && beforeY.length > 0) {
    traces.push({
      x,
      y: beforeY,
      type: 'scatter',
      mode: 'lines',
      name: beforeName,
      line: { color: '#94a3b8', width: 1.35, dash: 'dot' },
      opacity: 0.78,
    })
  }
  if (afterY && afterY.length > 0) {
    traces.push({
      x,
      y: afterY,
      type: 'scatter',
      mode: 'lines',
      name: afterName,
      line: { color: CHANNEL_COLORS[channel], width: 2.05 },
    })
  }
  return traces
}

function buildMultiTraces(datasets: ProcessedDataset[], channel: 'TEY' | 'TFY', showRaw: boolean): Plotly.Data[] {
  const traces: Plotly.Data[] = []
  datasets.forEach((ds, i) => {
    const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length]
    const raw = channel === 'TEY' ? ds.tey_raw : ds.tfy_raw
    const processed = channel === 'TEY' ? ds.tey_processed : ds.tfy_processed
    const shortName = ds.name.replace(/\.[^.]+$/, '').slice(-24)
    if (showRaw) {
      traces.push({
        x: ds.x, y: raw, type: 'scatter', mode: 'lines',
        name: `${shortName} 原始`,
        line: { color, width: 1.2, dash: 'dot' },
        opacity: 0.45,
      })
    }
    traces.push({
      x: ds.x, y: processed, type: 'scatter', mode: 'lines',
      name: shortName,
      line: { color, width: 2.0 },
    })
    const wl = channel === 'TEY' ? ds.white_line_tey : ds.white_line_tfy
    if (wl != null) {
      traces.push({
        x: [wl, wl],
        y: [Math.min(...processed), Math.max(...processed)],
        type: 'scatter', mode: 'lines',
        name: `${shortName} WL ${wl.toFixed(2)} eV`,
        line: { color, width: 1.2, dash: 'dash' },
        showlegend: false,
      })
    }
  })
  return traces
}

function buildOverlayValueTraces(
  datasets: ProcessedDataset[],
  channel: 'TEY' | 'TFY',
  valueGetter: (dataset: ProcessedDataset, channel: 'TEY' | 'TFY') => number[] | null | undefined,
  suffix: string,
): Plotly.Data[] {
  return datasets.flatMap((ds, i) => {
    const y = valueGetter(ds, channel)
    if (!y || y.length === 0) return []
    const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length]
    const shortName = ds.name.replace(/\.[^.]+$/, '').slice(-24)
    return [{
      x: ds.x,
      y,
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: `${shortName} ${suffix}`,
      line: { color, width: 1.9 },
    }]
  })
}

function buildOverlayComparisonTraces(
  beforeDatasets: ProcessedDataset[],
  afterDatasets: ProcessedDataset[],
  channel: 'TEY' | 'TFY',
  beforeGetter: (dataset: ProcessedDataset, channel: 'TEY' | 'TFY') => number[] | null | undefined,
  afterGetter: (dataset: ProcessedDataset, channel: 'TEY' | 'TFY') => number[] | null | undefined,
  beforeSuffix: string,
  afterSuffix: string,
): Plotly.Data[] {
  const beforeByName = new Map(beforeDatasets.map(ds => [ds.name, ds]))
  const fallbackBefore = beforeDatasets[0]
  const traces: Plotly.Data[] = []
  afterDatasets.forEach((afterDs, i) => {
    const beforeDs = beforeByName.get(afterDs.name) ?? fallbackBefore
    const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length]
    const shortName = afterDs.name.replace(/\.[^.]+$/, '').slice(-24)
    const beforeY = beforeDs ? beforeGetter(beforeDs, channel) : null
    const afterY = afterGetter(afterDs, channel)
    if (beforeY && beforeY.length > 0) {
      traces.push({
        x: beforeDs?.x ?? afterDs.x,
        y: beforeY,
        type: 'scatter',
        mode: 'lines',
        name: `${shortName} ${beforeSuffix}`,
        line: { color, width: 1.1, dash: 'dot' },
        opacity: 0.36,
        showlegend: false,
      })
    }
    if (afterY && afterY.length > 0) {
      traces.push({
        x: afterDs.x,
        y: afterY,
        type: 'scatter',
        mode: 'lines',
        name: `${shortName} ${afterSuffix}`,
        line: { color, width: 1.9 },
      })
    }
  })
  return traces
}

function buildOverlayBackgroundComparisonTraces(
  preprocessDatasets: ProcessedDataset[],
  backgroundDatasets: ProcessedDataset[],
  channel: 'TEY' | 'TFY',
): Plotly.Data[] {
  const preprocessByName = new Map(preprocessDatasets.map(ds => [ds.name, ds]))
  const fallbackPreprocess = preprocessDatasets[0]
  const traces: Plotly.Data[] = []
  backgroundDatasets.forEach((afterDs, i) => {
    const beforeDs = preprocessByName.get(afterDs.name) ?? fallbackPreprocess
    const beforeY = getChannelAfterGaussian(afterDs, channel) ?? (beforeDs ? getChannelProcessed(beforeDs, channel) : null)
    const afterY = getChannelProcessed(afterDs, channel)
    const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length]
    const shortName = afterDs.name.replace(/\.[^.]+$/, '').slice(-24)
    if (beforeY && beforeY.length > 0) {
      traces.push({
        x: getChannelAfterGaussian(afterDs, channel) ? afterDs.x : (beforeDs?.x ?? afterDs.x),
        y: beforeY,
        type: 'scatter',
        mode: 'lines',
        name: `${shortName} 扣背景前`,
        line: { color, width: 1.1, dash: 'dot' },
        opacity: 0.36,
        showlegend: false,
      })
    }
    traces.push({
      x: afterDs.x,
      y: afterY,
      type: 'scatter',
      mode: 'lines',
      name: `${shortName} 扣背景後`,
      line: { color, width: 1.9 },
    })
  })
  return traces
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

function chartLayoutWithRegions(
  xLabel: string,
  yLabel: string,
  regions: { start: number | null | undefined; end: number | null | undefined; label: string; color: string }[],
): Partial<Plotly.Layout> {
  return {
    ...chartLayout(xLabel, yLabel),
    shapes: regions.flatMap(region => buildRegionShapes(region.start, region.end, region.color)),
    annotations: regions.flatMap(region => buildRegionAnnotations(region.start, region.end, region.label, region.color)),
  }
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

function Section({ step, title, hint, children, defaultOpen = true, onOpen }: {
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
    <div className="theme-block mb-3 overflow-hidden rounded-[22px]">
      <button type="button" onClick={handleToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--card-ghost)]">
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
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <input
        type="number" value={value} min={min} max={max} step={step} disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none disabled:opacity-40"
      />
    </label>
  )
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

function SelectInput({ label, value, onChange, options, disabled = false }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <select
        value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none disabled:opacity-40"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
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

// ── Peak fitting helpers ──────────────────────────────────────────────────────

function createPeakId() { return `XA${Math.random().toString(36).slice(2, 7)}` }

interface XasPeakCandidate extends XasInitPeak {
  id: string
  label: string
  enabled: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function XAS({
  onModuleSelect,
  onOpenPlotPopup,
}: {
  onModuleSelect?: (m: AnalysisModuleId) => void
  onOpenPlotPopup?: (popup: PlotPopupRequest) => void
}) {
  const moduleContent = MODULE_CONTENT.xas
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('nigiro-xas-sidebar-width'))
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH ? saved : SIDEBAR_DEFAULT_WIDTH
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('nigiro-xas-sidebar-collapsed') === 'true')
  const [sidebarResizing, setSidebarResizing] = useState(false)

  const [rawFiles, setRawFiles] = useState<ParsedXasFile[]>([])
  const [flipTfy, setFlipTfy] = useState(true)
  const [params, setParams] = useState<ProcessParams>(DEFAULT_PARAMS)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [preprocessResult, setPreprocessResult] = useState<ProcessResult | null>(null)
  const [preNormalizationResult, setPreNormalizationResult] = useState<ProcessResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(true)
  const [autoInterpPoints, setAutoInterpPoints] = useState(true)
  const [viewMode, setViewMode] = useState<'single' | 'overlay'>('single')
  const [overlaySelectedNames, setOverlaySelectedNames] = useState<string[]>([])
  const [showOverlayModal, setShowOverlayModal] = useState(false)
  const [selectedSingleIdx, setSelectedSingleIdx] = useState(0)

  // ── Peak fitting state ────────────────────────────────────────────────────
  const [fitChannel, setFitChannel] = useState<'TEY' | 'TFY'>('TEY')
  const [fitProfile, setFitProfile] = useState<string>('voigt')
  const [fitPeakCandidates, setFitPeakCandidates] = useState<XasPeakCandidate[]>([])
  const [fitResult, setFitResult] = useState<XasFitResult | null>(null)
  const [isFitting, setIsFitting] = useState(false)
  const [fitError, setFitError] = useState<string | null>(null)
  const [samplesList, setSamplesList] = useState<XasSampleListItem[]>([])
  const [selectedSample, setSelectedSample] = useState<string>('')
  const [selectedEdge, setSelectedEdge] = useState<string>('')
  const [samplesLoading, setSamplesLoading] = useState(false)
  const samplesLoaded = useRef(false)


  const isOverlayMode = viewMode === 'overlay'
  const clampedIdx = Math.min(selectedSingleIdx, Math.max(0, (result?.datasets.length ?? 1) - 1))
  const getActiveDataset = useCallback((target: ProcessResult | null) => (
    isOverlayMode ? null : (target?.average ?? target?.datasets[clampedIdx] ?? null)
  ), [clampedIdx, isOverlayMode])
  const getOverlayDatasets = useCallback((target: ProcessResult | null): ProcessedDataset[] => (
    isOverlayMode
      ? (target?.datasets.filter(d => overlaySelectedNames.length === 0 || overlaySelectedNames.includes(d.name)) ?? [])
      : []
  ), [isOverlayMode, overlaySelectedNames])
  const activeDataset = getActiveDataset(result)
  const preprocessDataset = getActiveDataset(preprocessResult)
  const preNormalizationDataset = getActiveDataset(preNormalizationResult)
  const overlayDatasets = getOverlayDatasets(result)
  const overlayPreprocessDatasets = getOverlayDatasets(preprocessResult)
  const overlayPreNormalizationDatasets = getOverlayDatasets(preNormalizationResult)
  const estimatedInterpPoints = estimateInterpolationPoints(rawFiles)
  const effectiveNPoints = autoInterpPoints ? estimatedInterpPoints : params.n_points
  const interpolationEnabled = params.interpolate

  // reprocess whenever rawFiles or params change
  useEffect(() => {
    if (rawFiles.length === 0) {
      setResult(null)
      setPreprocessResult(null)
      setPreNormalizationResult(null)
      return
    }
    let cancelled = false
    setIsLoading(true); setError(null)
    const datasets: DatasetInput[] = rawFiles.map(f => ({ name: f.name, x: f.x, tey: f.tey, tfy: f.tfy }))
    const effectiveParams: ProcessParams = {
      ...params,
      n_points: effectiveNPoints,
    }
    const preprocessParams: ProcessParams = {
      ...effectiveParams,
      bg_enabled: false,
      norm_method: 'none',
      norm_x_start: null,
      norm_x_end: null,
      norm_pre_start: null,
      norm_pre_end: null,
      white_line_start: null,
      white_line_end: null,
      gauss_enabled: false,
      gauss_peaks: [],
    }
    const preNormalizationParams: ProcessParams = {
      ...effectiveParams,
      norm_method: 'none',
      norm_x_start: null,
      norm_x_end: null,
      norm_pre_start: null,
      norm_pre_end: null,
      white_line_start: null,
      white_line_end: null,
    }
    Promise.all([
      processData(datasets, effectiveParams),
      processData(datasets, preprocessParams),
      processData(datasets, preNormalizationParams),
    ])
      .then(([finalStage, preprocessStage, preNormalizationStage]) => {
        if (!cancelled) {
          setResult(finalStage)
          setPreprocessResult(preprocessStage)
          setPreNormalizationResult(preNormalizationStage)
        }
      })
      .catch(e => { if (!cancelled) setError(String(e.message)) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [rawFiles, params, effectiveNPoints])

  // sidebar resize
  useEffect(() => {
    localStorage.setItem('nigiro-xas-sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])
  useEffect(() => {
    localStorage.setItem('nigiro-xas-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setSidebarResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const startX = e.clientX; const startW = sidebarWidth
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startW + ev.clientX - startX))
      setSidebarWidth(w)
    }
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
    setIsLoading(true); setError(null)
    try {
      const res = await parseFiles(files, flipTfy)
      if (res.errors.length) setError(res.errors.join('; '))
      setRawFiles(res.files)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setIsLoading(false) }
  }, [flipTfy])

  // load samples list once when fitting section is first needed
  const loadSamplesList = useCallback(async () => {
    if (samplesLoaded.current) return
    samplesLoaded.current = true
    setSamplesLoading(true)
    try {
      const data = await listXasSamples()
      setSamplesList(data)
    } catch {
      // silently ignore
    } finally {
      setSamplesLoading(false)
    }
  }, [])

  const loadSampleEdgePeaks = useCallback(async () => {
    if (!selectedSample || !selectedEdge || !activeDataset) return
    setSamplesLoading(true); setFitError(null)
    try {
      const data = await fetchXasSamplePeaks(selectedSample, selectedEdge)
      const yArr = fitChannel === 'TEY' ? activeDataset.tey_processed : activeDataset.tfy_processed
      const maxY = Math.max(...yArr)
      const newPeaks: XasPeakCandidate[] = data.peaks.map(pk => ({
        id: createPeakId(),
        label: pk.label,
        enabled: true,
        center: pk.energy_eV,
        fwhm: pk.fwhm_eV,
        amplitude: maxY * 0.3,
      }))
      setFitPeakCandidates(prev => [...prev, ...newPeaks])
    } catch (e: unknown) { setFitError((e as Error).message) }
    finally { setSamplesLoading(false) }
  }, [selectedSample, selectedEdge, activeDataset, fitChannel])

  const addManualFitPeak = useCallback(() => {
    const center = activeDataset
      ? (activeDataset.x[0] + activeDataset.x[activeDataset.x.length - 1]) / 2
      : 500
    setFitPeakCandidates(prev => [...prev, {
      id: createPeakId(), label: `峰 ${prev.length + 1}`, enabled: true,
      center, fwhm: 1.5, amplitude: 1.0,
    }])
  }, [activeDataset])

  const handleFit = useCallback(async () => {
    if (!activeDataset) return
    const activePeaks = fitPeakCandidates.filter(p => p.enabled)
    if (activePeaks.length === 0) { setFitError('請先新增至少一個峰'); return }
    setIsFitting(true); setFitError(null); setFitResult(null)
    try {
      const initPeaks: XasInitPeak[] = activePeaks.map(p => ({
        center: p.center, fwhm: p.fwhm, amplitude: p.amplitude, label: p.label,
      }))
      const y = fitChannel === 'TEY' ? activeDataset.tey_processed : activeDataset.tfy_processed
      const res = await fitXasPeaks(activeDataset.x, y, initPeaks, fitProfile, activePeaks.map(p => p.label))
      setFitResult(res)
    } catch (e: unknown) { setFitError((e as Error).message) }
    finally { setIsFitting(false) }
  }, [activeDataset, fitChannel, fitPeakCandidates, fitProfile])

  const set = <K extends keyof ProcessParams>(key: K) => (val: ProcessParams[K]) =>
    setParams(p => ({ ...p, [key]: val }))

  const energyMin = rawFiles.length > 0 ? Math.min(...rawFiles.map(f => f.x[0])) : 440
  const energyMax = rawFiles.length > 0 ? Math.max(...rawFiles.map(f => f.x[f.x.length - 1])) : 490

  const sidebarStyle: CSSProperties = sidebarCollapsed
    ? { width: SIDEBAR_COLLAPSED_PEEK, minWidth: SIDEBAR_COLLAPSED_PEEK, overflow: 'hidden' }
    : { width: sidebarWidth, minWidth: SIDEBAR_MIN_WIDTH, maxWidth: SIDEBAR_MAX_WIDTH }

  const backgroundRegions = [{
    start: params.bg_x_start ?? energyMin,
    end: params.bg_x_end ?? energyMax,
    label: '背景區間',
    color: '#f59e0b',
  }]
  const normalizationRegions = params.norm_method === 'post_edge'
    ? [
        {
          start: params.norm_pre_start ?? energyMin,
          end: params.norm_pre_end ?? (energyMin + (energyMax - energyMin) * 0.3),
          label: 'Pre-edge 區間',
          color: '#f97316',
        },
        {
          start: params.norm_x_start ?? (energyMin + (energyMax - energyMin) * 0.7),
          end: params.norm_x_end ?? energyMax,
          label: 'Post-edge 區間',
          color: '#14b8a6',
        },
      ]
    : [{
        start: params.norm_x_start ?? energyMin,
        end: params.norm_x_end ?? energyMax,
        label: params.norm_method === 'mean_region' ? 'Mean Region' : '歸一化區間',
        color: '#14b8a6',
      }]
  const plainTeyLayout = chartLayout('Energy (eV)', 'TEY Intensity')
  const plainTfyLayout = chartLayout('Energy (eV)', 'TFY Intensity')
  const backgroundTeyLayout = chartLayoutWithRegions('Energy (eV)', 'TEY Intensity', backgroundRegions)
  const backgroundTfyLayout = chartLayoutWithRegions('Energy (eV)', 'TFY Intensity', backgroundRegions)
  const normalizationTeyLayout = chartLayoutWithRegions('Energy (eV)', 'TEY Intensity', normalizationRegions)
  const normalizationTfyLayout = chartLayoutWithRegions('Energy (eV)', 'TFY Intensity', normalizationRegions)

  const rawStageSource = preprocessDataset ?? activeDataset
  const rawOverlaySource = overlayPreprocessDatasets.length > 0 ? overlayPreprocessDatasets : overlayDatasets
  const backgroundBeforeY = (dataset: ProcessedDataset, fallback: ProcessedDataset | null, channel: 'TEY' | 'TFY') => (
    getChannelAfterGaussian(dataset, channel) ?? (fallback ? getChannelProcessed(fallback, channel) : getChannelRaw(dataset, channel))
  )
  const hasBackgroundStage = params.bg_enabled && Boolean(preNormalizationDataset || overlayPreNormalizationDatasets.length > 0)
  const hasNormalizationStage = params.norm_method !== 'none' && Boolean(activeDataset || overlayDatasets.length > 0)
  const renderStagePlot = (data: Plotly.Data[], layout: Partial<Plotly.Layout>, height = 310) => (
    <Plot
      data={data}
      layout={layout as Plotly.Layout}
      config={withPlotFullscreen()}
      style={{ width: '100%', height }}
    />
  )
  const renderStageCard = (
    title: string,
    data: Plotly.Data[],
    layout: Partial<Plotly.Layout>,
    popupTitle: string,
  ) => (
    <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow-soft)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--text-main)]">{title}</p>
        {onOpenPlotPopup && (
          <button
            type="button"
            className="chart-popup-button"
            onClick={() => onOpenPlotPopup({
              title: popupTitle,
              content: renderStagePlot(data, layout, 440),
            })}
            aria-label="彈出圖表"
          />
        )}
      </div>
      {renderStagePlot(data, layout)}
    </div>
  )
  const renderStagePair = (
    title: string,
    teyData: Plotly.Data[],
    tfyData: Plotly.Data[],
    teyLayout: Partial<Plotly.Layout>,
    tfyLayout: Partial<Plotly.Layout>,
  ) => {
    if (teyData.length === 0 && tfyData.length === 0) return null
    return (
      <section className="mb-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--text-main)]">{title}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {renderStageCard('TEY（Total Electron Yield）', teyData, teyLayout, `${title} · TEY`)}
          {renderStageCard('TFY（Total Fluorescence Yield）', tfyData, tfyLayout, `${title} · TFY`)}
        </div>
      </section>
    )
  }

  return (
    <div className={`flex h-screen flex-row overflow-hidden${sidebarResizing ? ' select-none' : ''}`}>
      {/* ── sidebar ── */}
      <aside
        style={sidebarStyle}
        className={`relative flex shrink-0 flex-col overflow-hidden border-r border-[var(--card-divider)] bg-[var(--panel-bg)]${sidebarResizing ? '' : ' transition-[width] duration-200'}`}
      >
        {sidebarCollapsed ? (
          <button
            type="button" onClick={() => setSidebarCollapsed(false)}
            className="flex h-full w-full flex-col items-center justify-center gap-1 text-[var(--text-soft)] hover:text-[var(--text-main)]"
            title="展開側欄"
          >
            <span className="text-lg">›</span>
          </button>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <StickySidebarHeader
                activeModule="xas"
                subtitle="Material Intelligence Engine"
                onSelectModule={onModuleSelect}
                onCollapse={() => setSidebarCollapsed(true)}
              />

              <div className="px-4 pt-4">
              {/* 1. 載入 */}
              <Section step={1} title="載入資料" hint="DAT / XMU / NOR / TXT">
                <FileUpload onFiles={handleFiles} isLoading={isLoading} accept={['.dat', '.txt', '.csv', '.xmu', '.nor', '.xlsx', '.xls']} />
                <CheckRow label="TFY 使用 1 − TFY 翻轉" checked={flipTfy} onChange={v => { setFlipTfy(v); setRawFiles([]) }} />
                {rawFiles.length > 0 && (
                  <div className="space-y-1">
                    {rawFiles.map(f => (
                      <div key={f.name} className="flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs text-[var(--text-main)]">
                        <span className="text-[var(--accent-tertiary)]">✓</span>
                        <span className="truncate">{f.name}</span>
                        <span className="ml-auto shrink-0 text-[var(--text-soft)]">{f.x.length} pts</span>
                      </div>
                    ))}
                    <button onClick={() => { setRawFiles([]); setResult(null) }} className="text-xs text-rose-400 hover:text-rose-300">
                      清除全部
                    </button>
                  </div>
                )}
              </Section>

              {/* 2. 內插與資料模式 */}
              <Section step={2} title="內插 / 資料模式" hint="多檔：單筆 / 疊圖 / 平均" defaultOpen={false}>
                <CheckRow label="啟用內插" checked={params.interpolate} onChange={set('interpolate')} />
                {params.interpolate && (
                  <>
                    <CheckRow label="自動調整點數" checked={autoInterpPoints} onChange={setAutoInterpPoints} />
                    {autoInterpPoints ? (
                      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--accent-soft)] px-3 py-3 text-xs">
                        <p className="font-medium text-[var(--text-main)]">自動建議：{effectiveNPoints} 點</p>
                        <p className="mt-1 text-[var(--text-soft)]">
                          依各筆資料的能量 span 除以原始中位步距估算自然點數，取中位數後四捨五入。
                        </p>
                      </div>
                    ) : (
                      <NumInput
                        label="點數"
                        value={params.n_points}
                        onChange={set('n_points')}
                        min={INTERP_POINTS_MIN}
                        max={INTERP_POINTS_MAX}
                        step={100}
                      />
                    )}
                  </>
                )}
                {rawFiles.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 border-b border-[var(--card-divider)] px-2.5 py-1.5 text-[9px] uppercase tracking-[0.14em] text-[var(--text-soft)]">
                        <span>檔案</span>
                        <span className="text-right">點數</span>
                        <span className="text-right">Energy 範圍</span>
                        <span className="text-right">步距</span>
                      </div>
                      {rawFiles.map(file => {
                        const stats = getFileStats(file)
                        if (!stats) return null
                        const newStep = interpolationEnabled && effectiveNPoints > 1 ? stats.span / (effectiveNPoints - 1) : null
                        const stepChanged = newStep != null && Math.abs(newStep - stats.step) > 0.0005
                        return (
                          <div key={file.name} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 border-t border-[var(--card-divider)] px-2.5 py-1.5 text-[10px] first:border-t-0">
                            <span className="truncate text-[var(--text-main)]" title={file.name}>{file.name}</span>
                            <span className="text-right text-[var(--text-soft)]">
                              {stats.nPts}
                              {interpolationEnabled && <span className="ml-1 text-[var(--accent-strong)]">→ {effectiveNPoints}</span>}
                            </span>
                            <span className="text-right text-[var(--text-soft)]">{stats.xStart.toFixed(1)} – {stats.xEnd.toFixed(1)}</span>
                            <span className="text-right text-[var(--text-soft)]">
                              {stats.step.toFixed(3)}
                              {stepChanged && newStep != null && (
                                <span className={`ml-1 ${newStep < stats.step ? 'text-[var(--accent-strong)]' : 'text-amber-400'}`}>
                                  → {newStep.toFixed(3)}
                                </span>
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    {interpolationEnabled && (() => {
                      const statsAll = rawFiles.map(getFileStats)
                      const hasDenseStep = statsAll.some(stats => stats && effectiveNPoints > 1 && (stats.span / (effectiveNPoints - 1)) < stats.step * 0.9)
                      const hasSparseStep = statsAll.some(stats => stats && effectiveNPoints > 1 && (stats.span / (effectiveNPoints - 1)) > stats.step * 1.1)
                      if (!hasDenseStep && !hasSparseStep) return null
                      return (
                        <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-2 text-[10px] text-[var(--text-soft)]">
                          {hasDenseStep && <p className="text-[var(--accent-strong)]">點數增加：步距變小，內插會補出更密的能量網格。</p>}
                          {hasSparseStep && <p className="text-amber-400">點數減少：步距變大，解析度會下降。</p>}
                        </div>
                      )
                    })()}
                  </div>
                )}
                {rawFiles.length > 1 && (
                  <div className="space-y-2 pt-1">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">資料模式</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setViewMode('single'); setParams(p => ({ ...p, average: false })) }}
                        className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${viewMode === 'single' ? 'bg-[var(--accent-strong)] text-white' : 'border border-[var(--card-border)] text-[var(--text-soft)] hover:text-[var(--text-main)]'}`}
                      >
                        單筆
                      </button>
                      <button
                        type="button"
                        onClick={() => { setViewMode('overlay'); setShowOverlayModal(true) }}
                        className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${viewMode === 'overlay' ? 'bg-[var(--accent-strong)] text-white' : 'border border-[var(--card-border)] text-[var(--text-soft)] hover:text-[var(--text-main)]'}`}
                      >
                        疊圖
                      </button>
                    </div>
                    {viewMode === 'overlay' && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowOverlayModal(true)}
                          className="w-full rounded-lg border border-[var(--accent-soft)] py-1.5 text-xs text-[var(--accent-strong)] hover:bg-[var(--accent-soft)] transition-colors"
                        >
                          選擇疊圖資料（{overlaySelectedNames.length === 0 ? rawFiles.length : overlaySelectedNames.length} 筆）
                        </button>
                        <button
                          type="button"
                          onClick={() => { setParams(p => ({ ...p, average: true })); setViewMode('single') }}
                          className="w-full rounded-lg border border-[var(--card-border)] py-1.5 text-xs text-[var(--text-soft)] hover:border-[var(--accent-strong)] hover:text-[var(--text-main)] transition-colors"
                        >
                          平均所有疊圖數據
                        </button>
                      </>
                    )}
                    {viewMode === 'single' && rawFiles.length > 1 && (
                      <SelectInput
                        label="顯示資料"
                        value={String(clampedIdx)}
                        onChange={v => setSelectedSingleIdx(Number(v))}
                        options={rawFiles.map((f, i) => ({ value: String(i), label: f.name }))}
                      />
                    )}
                  </div>
                )}
              </Section>

              {/* 3. 能量校正 */}
              <Section step={3} title="能量校正" hint="校正能量軸零點" defaultOpen={false}>
                <NumInput label="能量位移 (eV)" value={params.energy_shift} onChange={set('energy_shift')} step={0.01} />
                <p className="text-[10px] text-[var(--text-soft)]">正值向高能方向移，負值向低能移。</p>
              </Section>

              {/* 4. 背景扣除 */}
              <Section step={4} title="背景扣除" hint="Linear / Polynomial / AsLS" defaultOpen={false}>
                <CheckRow label="啟用背景扣除" checked={params.bg_enabled} onChange={set('bg_enabled')} />
                {params.bg_enabled && (
                  <>
                    <SelectInput label="套用通道" value={params.bg_channel} onChange={v => set('bg_channel')(v as ProcessParams['bg_channel'])}
                      options={[{ value: 'both', label: 'TEY + TFY' }, { value: 'TEY', label: '僅 TEY' }, { value: 'TFY', label: '僅 TFY' }]}
                    />
                    <SelectInput label="方法" value={params.bg_method} onChange={v => set('bg_method')(v as ProcessParams['bg_method'])}
                      options={[{ value: 'linear', label: 'Linear' }, { value: 'polynomial', label: 'Polynomial' }, { value: 'asls', label: 'AsLS' }, { value: 'airpls', label: 'airPLS' }]}
                    />
                    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs leading-6 text-[var(--text-soft)]">
                      {BACKGROUND_METHOD_HELP[params.bg_method as Exclude<ProcessParams['bg_method'], 'none'>]}
                    </div>
                    <DualRangeInput
                      label="背景扣除區間"
                      min={energyMin} max={energyMax}
                      start={params.bg_x_start ?? energyMin}
                      end={params.bg_x_end ?? energyMax}
                      onChange={({ start, end }) => setParams(p => ({ ...p, bg_x_start: start, bg_x_end: end }))}
                    />
                    {params.bg_method === 'polynomial' && (
                      <NumInput label="多項式次數" value={params.bg_poly_deg} onChange={set('bg_poly_deg')} min={1} max={10} />
                    )}
                  </>
                )}
              </Section>

              {/* 5. 歸一化 */}
              <Section step={5} title="歸一化" hint="Post-edge Step / Mean Region / Min-Max" defaultOpen={false}>
                <SelectInput label="方法" value={params.norm_method} onChange={v => {
                  const method = v as ProcessParams['norm_method']
                  setParams(p => {
                    if (method === 'post_edge') {
                      return {
                        ...p,
                        norm_method: method,
                        norm_pre_start: p.norm_pre_start ?? energyMin,
                        norm_pre_end: p.norm_pre_end ?? (energyMin + (energyMax - energyMin) * 0.3),
                        norm_x_start: p.norm_x_start ?? (energyMin + (energyMax - energyMin) * 0.7),
                        norm_x_end: p.norm_x_end ?? energyMax,
                      }
                    }
                    if (method === 'min_max' || method === 'max' || method === 'area' || method === 'mean_region') {
                      return {
                        ...p,
                        norm_method: method,
                        norm_x_start: p.norm_x_start ?? energyMin,
                        norm_x_end: p.norm_x_end ?? energyMax,
                      }
                    }
                    return { ...p, norm_method: method }
                  })
                }}
                  options={[
                    { value: 'none', label: '不歸一化' },
                    { value: 'min_max', label: 'Min–Max' },
                    { value: 'max', label: 'Max' },
                    { value: 'area', label: 'Area' },
                    { value: 'post_edge', label: 'Post-edge Step' },
                    { value: 'mean_region', label: 'Mean Region' },
                  ]}
                />
                {params.norm_method === 'post_edge' && (
                  <>
                    <DualRangeInput
                      label="Pre-edge 區間"
                      min={energyMin} max={energyMax}
                      start={params.norm_pre_start ?? energyMin}
                      end={params.norm_pre_end ?? (energyMin + (energyMax - energyMin) * 0.3)}
                      onChange={({ start, end }) => setParams(p => ({ ...p, norm_pre_start: start, norm_pre_end: end }))}
                    />
                    <DualRangeInput
                      label="Post-edge 區間"
                      min={energyMin} max={energyMax}
                      start={params.norm_x_start ?? (energyMin + (energyMax - energyMin) * 0.7)}
                      end={params.norm_x_end ?? energyMax}
                      onChange={({ start, end }) => setParams(p => ({ ...p, norm_x_start: start, norm_x_end: end }))}
                    />
                  </>
                )}
                {(params.norm_method === 'area' || params.norm_method === 'min_max' || params.norm_method === 'max' || params.norm_method === 'mean_region') && (
                  <DualRangeInput
                    label="歸一化區間"
                    min={energyMin} max={energyMax}
                    start={params.norm_x_start ?? energyMin}
                    end={params.norm_x_end ?? energyMax}
                    onChange={({ start, end }) => setParams(p => ({ ...p, norm_x_start: start, norm_x_end: end }))}
                  />
                )}
              </Section>

              {/* 6. White Line */}
              <Section step={6} title="White Line 搜尋" hint="自動找最高點能量" defaultOpen={false}>
                <p className="text-[10px] text-[var(--text-soft)]">設定搜尋區間，自動找到最高點能量。</p>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="起始 (eV)" value={params.white_line_start ?? energyMin} onChange={v => set('white_line_start')(v)} step={0.1} />
                  <NumInput label="結束 (eV)" value={params.white_line_end ?? energyMax} onChange={v => set('white_line_end')(v)} step={0.1} />
                </div>
                <button
                  type="button"
                  onClick={() => setParams(p => ({ ...p, white_line_start: energyMin, white_line_end: energyMax }))}
                  className="text-[10px] text-[var(--accent-strong)] hover:underline"
                >
                  重設為全範圍
                </button>
              </Section>

              {/* 7. 高斯模板扣除 */}
              <Section step={7} title="高斯模板扣除" hint="扣除已知雜散峰" defaultOpen={false}>
                <CheckRow label="啟用高斯模板扣除" checked={params.gauss_enabled} onChange={set('gauss_enabled')} />
                {params.gauss_enabled && (
                  <>
                    <SelectInput
                      label="套用通道"
                      value={params.gauss_channel}
                      onChange={v => set('gauss_channel')(v as ProcessParams['gauss_channel'])}
                      options={[
                        { value: 'both', label: 'TEY + TFY' },
                        { value: 'TEY', label: '僅 TEY' },
                        { value: 'TFY', label: '僅 TFY' },
                      ]}
                    />
                    <NumInput
                      label="中心搜尋範圍 (±eV)"
                      value={params.gauss_search}
                      onChange={set('gauss_search')}
                      min={0} max={10} step={0.1}
                    />
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">模板列表</p>
                      {params.gauss_peaks.map((gp, i) => (
                        <div key={i} className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-2 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[var(--text-soft)]">模板 {i + 1}</span>
                            <button
                              type="button"
                              onClick={() => setParams(p => ({ ...p, gauss_peaks: p.gauss_peaks.filter((_, j) => j !== i) }))}
                              className="text-[10px] text-rose-400 hover:text-rose-300"
                            >
                              移除
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-1">
                            <NumInput
                              label="中心(eV)"
                              value={gp.center}
                              onChange={v => setParams(p => {
                                const peaks = [...p.gauss_peaks]
                                peaks[i] = { ...peaks[i], center: v }
                                return { ...p, gauss_peaks: peaks }
                              })}
                              step={0.1}
                            />
                            <NumInput
                              label="FWHM(eV)"
                              value={gp.fwhm}
                              onChange={v => setParams(p => {
                                const peaks = [...p.gauss_peaks]
                                peaks[i] = { ...peaks[i], fwhm: v }
                                return { ...p, gauss_peaks: peaks }
                              })}
                              min={0.01} step={0.1}
                            />
                            <NumInput
                              label="振幅"
                              value={gp.amplitude}
                              onChange={v => setParams(p => {
                                const peaks = [...p.gauss_peaks]
                                peaks[i] = { ...peaks[i], amplitude: v }
                                return { ...p, gauss_peaks: peaks }
                              })}
                              step={0.01}
                            />
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setParams(p => ({
                          ...p,
                          gauss_peaks: [...p.gauss_peaks, { center: (energyMin + energyMax) / 2, fwhm: 1.0, amplitude: 0.1 } as GaussPeak],
                        }))}
                        className="w-full rounded-lg border border-dashed border-[var(--accent-soft)] py-1.5 text-[10px] text-[var(--accent-strong)] hover:bg-[var(--accent-soft)] transition-colors"
                      >
                        + 新增模板
                      </button>
                    </div>
                  </>
                )}
              </Section>

              {/* 8. 峰擬合 */}
              {result && (
                <Section step={8} title={isOverlayMode ? '峰擬合（疊圖模式停用）' : '峰擬合'} hint="Voigt / Gaussian / Lorentzian" defaultOpen={false}
                  onOpen={isOverlayMode ? undefined : loadSamplesList}
                >
                  {isOverlayMode ? (
                    <p className="text-[10px] text-[var(--text-soft)]">疊圖模式下不可用。請切回單筆模式，或先平均數據後再擬合。</p>
                  ) : (<>
                  <SelectInput label="擬合通道" value={fitChannel}
                    onChange={v => { setFitChannel(v as 'TEY' | 'TFY'); setFitResult(null) }}
                    options={[{ value: 'TEY', label: 'TEY' }, { value: 'TFY', label: 'TFY' }]}
                  />
                  <SelectInput label="峰形" value={fitProfile} onChange={setFitProfile}
                    options={[
                      { value: 'voigt', label: 'Voigt' },
                      { value: 'gaussian', label: 'Gaussian' },
                      { value: 'lorentzian', label: 'Lorentzian' },
                    ]}
                  />

                  {/* 從樣品資料庫載入 */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">從樣品資料庫載入</p>
                    <SelectInput
                      label="樣品"
                      value={selectedSample}
                      onChange={v => { setSelectedSample(v); setSelectedEdge('') }}
                      options={[
                        { value: '', label: samplesLoading ? '載入中…' : '選擇樣品…' },
                        ...samplesList.map(s => ({ value: s.name, label: `${s.name} — ${s.description}` })),
                      ]}
                    />
                    {selectedSample && (
                      <SelectInput
                        label="吸收邊"
                        value={selectedEdge}
                        onChange={setSelectedEdge}
                        options={[
                          { value: '', label: '選擇吸收邊…' },
                          ...(samplesList.find(s => s.name === selectedSample)?.edges ?? []).map(e => ({ value: e, label: e })),
                        ]}
                      />
                    )}
                    {selectedSample && selectedEdge && (
                      <button
                        type="button"
                        onClick={() => void loadSampleEdgePeaks()}
                        disabled={samplesLoading}
                        className="w-full rounded-lg border border-[var(--accent-strong)] px-3 py-1.5 text-xs text-[var(--accent-strong)] hover:bg-[var(--accent-soft)] disabled:opacity-50 transition-colors"
                      >
                        {samplesLoading ? '載入中…' : '匯入參考峰'}
                      </button>
                    )}
                  </div>

                  {/* 手動新增 */}
                  <button type="button" onClick={addManualFitPeak}
                    className="w-full rounded-lg border border-dashed border-[var(--card-border)] py-2 text-xs text-[var(--text-soft)] hover:border-[var(--accent-strong)] hover:text-[var(--text-main)] transition-colors"
                  >
                    + 手動新增峰
                  </button>

                  {/* 峰列表 */}
                  {fitPeakCandidates.map(pk => (
                    <div
                      key={pk.id}
                      className={[
                        'rounded-xl p-3 text-xs space-y-2 transition-all duration-150',
                        pk.enabled
                          ? 'border border-[color:color-mix(in_srgb,var(--accent-secondary)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_7%,var(--card-bg))]'
                          : 'border border-[var(--card-border)] bg-[var(--card-bg)]',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setFitPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, enabled: !p.enabled } : p))}
                          className={['flex flex-1 items-center gap-2 text-xs font-medium transition-colors duration-150',
                            pk.enabled ? 'text-[var(--accent-secondary)]' : 'text-[var(--text-soft)] hover:text-[var(--text-main)]'].join(' ')}
                        >
                          <span className={['h-2.5 w-2.5 shrink-0 rounded-full transition-all duration-150',
                            pk.enabled ? 'bg-[var(--accent-secondary)]' : 'border border-[var(--card-border)]'].join(' ')} />
                          <span className="truncate">{pk.label}</span>
                        </button>
                        <button type="button" onClick={() => setFitPeakCandidates(prev => prev.filter(p => p.id !== pk.id))} className="text-rose-400 hover:text-rose-300">✕</button>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <NumInput label="中心(eV)" value={pk.center} onChange={v => setFitPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, center: v } : p))} step={0.1} />
                        <NumInput label="FWHM(eV)" value={pk.fwhm} onChange={v => setFitPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, fwhm: v } : p))} min={0.01} step={0.1} />
                        <NumInput label="強度" value={pk.amplitude} onChange={v => setFitPeakCandidates(prev => prev.map(p => p.id === pk.id ? { ...p, amplitude: v } : p))} min={0} step={0.01} />
                      </div>
                    </div>
                  ))}

                  {fitPeakCandidates.length > 0 && (
                    <>
                      {fitPeakCandidates.length > 1 && (
                        <button type="button" onClick={() => setFitPeakCandidates([])} className="text-xs text-rose-400 hover:text-rose-300">清除全部峰</button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleFit()}
                        disabled={isFitting || !activeDataset}
                        className="w-full rounded-lg bg-[var(--accent-strong)] py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        {isFitting ? '擬合中…' : '執行峰擬合'}
                      </button>
                    </>
                  )}
                  {fitError && <p className="text-[10px] text-rose-400">{fitError}</p>}
                  </>)}
                </Section>
              )}

              </div>
            </div>
          </>
        )}

        {/* resize handle */}
        {!sidebarCollapsed && (
          <div
            onMouseDown={startResize}
            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-[var(--accent-soft)]"
          />
        )}
      </aside>

      {/* ── main content ── */}
      <main className="flex flex-1 flex-col overflow-y-auto px-5 py-8 sm:px-8 xl:px-10 xl:py-10">
        <div className="mx-auto w-full max-w-[1500px]">
        <ModuleTopBar
          title={moduleContent.title}
          subtitle={moduleContent.subtitle}
          description={moduleContent.description}
          chips={[
            { label: `資料量 ${rawFiles.length}` },
            { label: `內插 ${params.interpolate ? `${effectiveNPoints} 點` : '未啟用'}` },
            { label: `平均 ${params.average ? '開啟' : '關閉'}` },
            { label: `White Line ${activeDataset?.white_line_tey != null || activeDataset?.white_line_tfy != null ? '已計算' : '未設定'}` },
          ]}
        />

        <InfoCardGrid
          items={[
            { label: '資料集', value: rawFiles.length > 0 ? `${rawFiles.length} 個` : '未載入' },
            { label: '平均模式', value: params.average ? '開啟' : '關閉' },
            { label: '內插點數', value: params.interpolate ? `${effectiveNPoints} 點${autoInterpPoints ? '（自動）' : ''}` : '未啟用' },
            { label: '能量範圍', value: activeDataset ? `${activeDataset.x[0].toFixed(1)} – ${activeDataset.x[activeDataset.x.length - 1].toFixed(1)} eV` : '未建立' },
          ]}
        />

        {/* error */}
        {error && (
          <div className="mb-4 rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            ⚠ {error}
          </div>
        )}

        {/* loading */}
        {isLoading && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-strong)]" />
            處理中…
          </div>
        )}

        {/* empty state */}
        {!result && !isLoading && (
          <EmptyWorkspaceState
            module="xas"
            title={moduleContent.uploadTitle}
            description="左側已提供內插、多檔平均、背景扣除、歸一化、White Line 搜尋、高斯模板扣除與峰擬合。上傳之後會在這裡顯示 XAS / XANES 圖譜與分析結果。"
            formats={['.DAT', '.XMU', '.NOR', '.TXT', '.CSV']}
          />
        )}

        {result && (activeDataset != null || overlayDatasets.length > 0) && (
          <>
            {/* summary cards */}
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 shadow-[var(--card-shadow-soft)]">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">資料集</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-main)]">{result.datasets.length} 個</p>
                {isOverlayMode
                  ? <p className="mt-1 text-xs text-[var(--accent-strong)]">疊圖模式（{overlayDatasets.length} 筆顯示）</p>
                  : params.average && result.average
                    ? <p className="mt-1 text-xs text-[var(--text-soft)]">已平均</p>
                    : null
                }
              </div>
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 shadow-[var(--card-shadow-soft)]">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">能量範圍</p>
                <p className="mt-1 text-base font-semibold text-[var(--text-main)]">
                  {activeDataset
                    ? `${activeDataset.x[0].toFixed(1)} – ${activeDataset.x[activeDataset.x.length - 1].toFixed(1)} eV`
                    : overlayDatasets.length > 0
                      ? `${Math.min(...overlayDatasets.map(d => d.x[0])).toFixed(1)} – ${Math.max(...overlayDatasets.map(d => d.x[d.x.length - 1])).toFixed(1)} eV`
                      : '未建立'
                  }
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 shadow-[var(--card-shadow-soft)]">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">White Line</p>
                {activeDataset ? (
                  <>
                    <p className="mt-1 text-base font-semibold text-[var(--text-main)]">
                      {activeDataset.white_line_tey != null
                        ? `TEY ${activeDataset.white_line_tey.toFixed(2)} eV`
                        : '未設定搜尋範圍'}
                    </p>
                    {activeDataset.white_line_tfy != null && (
                      <p className="text-xs text-[var(--text-soft)]">TFY {activeDataset.white_line_tfy.toFixed(2)} eV</p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-xs text-[var(--text-soft)]">疊圖模式</p>
                )}
              </div>
            </div>

            {/* display control */}
            <div className="mb-3 flex items-center gap-3">
              <CheckRow label="顯示原始資料" checked={showRaw} onChange={setShowRaw} />
            </div>

            {renderStagePair(
              '1. 原始光譜',
              isOverlayMode
                ? buildOverlayValueTraces(rawOverlaySource, 'TEY', getChannelRaw, '原始')
                : rawStageSource ? buildRawTraces(rawStageSource, 'TEY') : [],
              isOverlayMode
                ? buildOverlayValueTraces(rawOverlaySource, 'TFY', getChannelRaw, '原始')
                : rawStageSource ? buildRawTraces(rawStageSource, 'TFY') : [],
              plainTeyLayout,
              plainTfyLayout,
            )}

            {renderStagePair(
              '2. 前處理後',
              isOverlayMode
                ? buildOverlayComparisonTraces(rawOverlaySource, overlayPreprocessDatasets, 'TEY', getChannelRaw, getChannelProcessed, '原始', '前處理後')
                : preprocessDataset ? buildComparisonTraces(preprocessDataset.x, getChannelRaw(preprocessDataset, 'TEY'), getChannelProcessed(preprocessDataset, 'TEY'), 'TEY', '原始', '前處理後') : [],
              isOverlayMode
                ? buildOverlayComparisonTraces(rawOverlaySource, overlayPreprocessDatasets, 'TFY', getChannelRaw, getChannelProcessed, '原始', '前處理後')
                : preprocessDataset ? buildComparisonTraces(preprocessDataset.x, getChannelRaw(preprocessDataset, 'TFY'), getChannelProcessed(preprocessDataset, 'TFY'), 'TFY', '原始', '前處理後') : [],
              plainTeyLayout,
              plainTfyLayout,
            )}

            {hasBackgroundStage && renderStagePair(
              '3. 背景扣除',
              isOverlayMode
                ? buildOverlayBackgroundComparisonTraces(overlayPreprocessDatasets, overlayPreNormalizationDatasets, 'TEY')
                : preNormalizationDataset ? buildComparisonTraces(
                  preNormalizationDataset.x,
                  backgroundBeforeY(preNormalizationDataset, preprocessDataset, 'TEY'),
                  getChannelProcessed(preNormalizationDataset, 'TEY'),
                  'TEY',
                  '扣背景前',
                  '扣背景後',
                ) : [],
              isOverlayMode
                ? buildOverlayBackgroundComparisonTraces(overlayPreprocessDatasets, overlayPreNormalizationDatasets, 'TFY')
                : preNormalizationDataset ? buildComparisonTraces(
                  preNormalizationDataset.x,
                  backgroundBeforeY(preNormalizationDataset, preprocessDataset, 'TFY'),
                  getChannelProcessed(preNormalizationDataset, 'TFY'),
                  'TFY',
                  '扣背景前',
                  '扣背景後',
                ) : [],
              backgroundTeyLayout,
              backgroundTfyLayout,
            )}

            {hasNormalizationStage && renderStagePair(
              `${hasBackgroundStage ? 4 : 3}. 歸一化`,
              isOverlayMode
                ? buildOverlayComparisonTraces(overlayPreNormalizationDatasets, overlayDatasets, 'TEY', getChannelProcessed, getChannelProcessed, '歸一化前', '歸一化後')
                : activeDataset && preNormalizationDataset ? buildComparisonTraces(
                  activeDataset.x,
                  getChannelProcessed(preNormalizationDataset, 'TEY'),
                  getChannelProcessed(activeDataset, 'TEY'),
                  'TEY',
                  '歸一化前',
                  '歸一化後',
                ) : [],
              isOverlayMode
                ? buildOverlayComparisonTraces(overlayPreNormalizationDatasets, overlayDatasets, 'TFY', getChannelProcessed, getChannelProcessed, '歸一化前', '歸一化後')
                : activeDataset && preNormalizationDataset ? buildComparisonTraces(
                  activeDataset.x,
                  getChannelProcessed(preNormalizationDataset, 'TFY'),
                  getChannelProcessed(activeDataset, 'TFY'),
                  'TFY',
                  '歸一化前',
                  '歸一化後',
                ) : [],
              normalizationTeyLayout,
              normalizationTfyLayout,
            )}

            {renderStagePair(
              `${hasNormalizationStage ? (hasBackgroundStage ? 5 : 4) : (hasBackgroundStage ? 4 : 3)}. 最終光譜`,
              isOverlayMode
                ? buildMultiTraces(overlayDatasets, 'TEY', showRaw)
                : activeDataset ? buildTraces(activeDataset, 'TEY', showRaw) : [],
              isOverlayMode
                ? buildMultiTraces(overlayDatasets, 'TFY', showRaw)
                : activeDataset ? buildTraces(activeDataset, 'TFY', showRaw) : [],
              plainTeyLayout,
              plainTfyLayout,
            )}

            {/* Single-mode only sections */}
            {activeDataset && (<>
            {/* Gaussian subtraction comparison chart */}
            {(activeDataset.tey_gaussian != null || activeDataset.tfy_gaussian != null) && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow-soft)]">
                <p className="mb-2 text-sm font-semibold text-[var(--text-main)]">高斯模板扣除對比</p>
                {activeDataset.tey_gaussian != null && (
                  <>
                    <p className="mb-1 text-xs text-[var(--text-soft)]">TEY</p>
                    <Plot
                      data={[
                        { x: activeDataset.x, y: activeDataset.tey_raw, type: 'scatter', mode: 'lines', name: '原始 TEY', line: { color: '#94a3b8', width: 1.4 } },
                        { x: activeDataset.x, y: activeDataset.tey_gaussian, type: 'scatter', mode: 'lines', name: '高斯模板', line: { color: '#f97316', width: 1.8, dash: 'dash' } },
                        { x: activeDataset.x, y: activeDataset.tey_after_gauss, type: 'scatter', mode: 'lines', name: '扣除後 TEY', line: { color: '#38bdf8', width: 2 } },
                      ] as Plotly.Data[]}
                      layout={chartLayout('Energy (eV)', 'TEY Intensity') as Plotly.Layout}
                      config={withPlotFullscreen()}
                      style={{ width: '100%', height: 300 }}
                    />
                  </>
                )}
                {activeDataset.tfy_gaussian != null && (
                  <>
                    <p className="mb-1 mt-3 text-xs text-[var(--text-soft)]">TFY</p>
                    <Plot
                      data={[
                        { x: activeDataset.x, y: activeDataset.tfy_raw, type: 'scatter', mode: 'lines', name: '原始 TFY', line: { color: '#94a3b8', width: 1.4 } },
                        { x: activeDataset.x, y: activeDataset.tfy_gaussian, type: 'scatter', mode: 'lines', name: '高斯模板', line: { color: '#f97316', width: 1.8, dash: 'dash' } },
                        { x: activeDataset.x, y: activeDataset.tfy_after_gauss, type: 'scatter', mode: 'lines', name: '扣除後 TFY', line: { color: '#a78bfa', width: 2 } },
                      ] as Plotly.Data[]}
                      layout={chartLayout('Energy (eV)', 'TFY Intensity') as Plotly.Layout}
                      config={withPlotFullscreen()}
                      style={{ width: '100%', height: 300 }}
                    />
                  </>
                )}
              </div>
            )}

            {/* Peak fitting result */}
            {fitResult && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow-soft)]">
                <div className="mb-2 flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm font-semibold text-[var(--text-main)]">峰擬合結果（{fitChannel}）</p>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-[var(--card-border)] px-2 py-0.5 text-[10px] text-[var(--text-soft)]">
                      {fitProfile.toUpperCase()} · {fitResult.peaks.length} 峰
                    </span>
                    <button type="button" onClick={() => setFitResult(null)} className="text-[10px] text-rose-400 hover:text-rose-300">清除</button>
                  </div>
                </div>
                <Plot
                  data={[
                    {
                      x: activeDataset.x,
                      y: fitChannel === 'TEY' ? activeDataset.tey_processed : activeDataset.tfy_processed,
                      type: 'scatter', mode: 'lines', name: '原始',
                      line: { color: '#94a3b8', width: 1.4 },
                    },
                    {
                      x: activeDataset.x,
                      y: fitResult.y_fit,
                      type: 'scatter', mode: 'lines', name: '總擬合',
                      line: { color: '#38bdf8', width: 2.2 },
                    },
                    {
                      x: activeDataset.x,
                      y: fitResult.residuals,
                      type: 'scatter', mode: 'lines', name: '殘差',
                      line: { color: '#f97316', width: 1.2, dash: 'dot' as const },
                    },
                    ...fitResult.peaks.map((pk, i) => ({
                      x: activeDataset.x,
                      y: fitResult.y_individual[i] ?? [],
                      type: 'scatter' as const,
                      mode: 'lines' as const,
                      name: pk.Peak_Name,
                      line: { width: 1.6 },
                      opacity: 0.80,
                      fill: 'tozeroy' as const,
                    })),
                  ] as Plotly.Data[]}
                  layout={chartLayout('Energy (eV)', `${fitChannel} 強度`) as Plotly.Layout}
                  config={withPlotFullscreen()}
                  style={{ width: '100%', height: 360 }}
                />
                {/* result table */}
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--card-divider)] text-[var(--text-soft)]">
                        <th className="pb-2 text-left font-medium">峰名稱</th>
                        <th className="pb-2 text-right font-medium">中心 (eV)</th>
                        <th className="pb-2 text-right font-medium">FWHM (eV)</th>
                        <th className="pb-2 text-right font-medium">面積</th>
                        <th className="pb-2 text-right font-medium">面積%</th>
                      </tr>
                    </thead>
                    <tbody className="text-[var(--text-main)]">
                      {fitResult.peaks.map(pk => (
                        <tr key={pk.Peak_Name} className="border-b border-[var(--card-divider)]">
                          <td className="py-1.5 font-mono">{pk.Peak_Name}</td>
                          <td className="py-1.5 text-right">{pk.Center_eV.toFixed(3)}</td>
                          <td className="py-1.5 text-right">{pk.FWHM_eV.toFixed(3)}</td>
                          <td className="py-1.5 text-right">{pk.Area.toFixed(2)}</td>
                          <td className="py-1.5 text-right text-[var(--accent-strong)]">{pk.Area_pct?.toFixed(1) ?? '—'}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* export */}
                <div className="mt-3 flex justify-start">
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ['peak_name', 'center_eV', 'fwhm_eV', 'area', 'height', 'area_pct']
                      const rows = fitResult.peaks.map(pk => [pk.Peak_Name, pk.Center_eV, pk.FWHM_eV, pk.Area, pk.Height, pk.Area_pct ?? ''])
                      downloadFile(
                        [headers.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n'),
                        'xas_fit_result.csv', 'text/csv',
                      )
                    }}
                    className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)] transition-colors"
                  >
                    擬合結果 CSV
                  </button>
                </div>
              </div>
            )}

            {/* edge step table */}
            {activeDataset.edge_step_tey != null && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow-soft)]">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">Post-edge 歸一化摘要</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--card-divider)] text-[var(--text-soft)]">
                      <th className="pb-2 text-left font-medium">通道</th>
                      <th className="pb-2 text-right font-medium">Edge Step</th>
                      <th className="pb-2 text-right font-medium">White Line (eV)</th>
                    </tr>
                  </thead>
                  <tbody className="text-[var(--text-main)]">
                    <tr className="border-b border-[var(--card-divider)]">
                      <td className="py-2">TEY</td>
                      <td className="py-2 text-right">{activeDataset.edge_step_tey?.toFixed(4) ?? '—'}</td>
                      <td className="py-2 text-right">{activeDataset.white_line_tey?.toFixed(2) ?? '—'}</td>
                    </tr>
                    <tr>
                      <td className="py-2">TFY</td>
                      <td className="py-2 text-right">{activeDataset.edge_step_tfy?.toFixed(4) ?? '—'}</td>
                      <td className="py-2 text-right">{activeDataset.white_line_tfy?.toFixed(2) ?? '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* export */}
            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow-soft)]">
              <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const ds = activeDataset
                    const headers = ['energy_eV', 'TEY_raw', 'TFY_raw', 'TEY_processed', 'TFY_processed']
                    const rows = ds.x.map((x, i) => [x, ds.tey_raw[i], ds.tfy_raw[i], ds.tey_processed[i], ds.tfy_processed[i]])
                    downloadFile(toCsv(headers, rows), 'xas_processed.csv', 'text/csv')
                  }}
                  className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)] transition-colors"
                >
                  處理後光譜 CSV
                </button>
                {activeDataset.white_line_tey != null && (
                  <button
                    type="button"
                    onClick={() => {
                      const ds = activeDataset
                      const headers = ['channel', 'white_line_eV', 'edge_step']
                      const rows: (string | number | null)[][] = [
                        ['TEY', ds.white_line_tey, ds.edge_step_tey],
                        ['TFY', ds.white_line_tfy, ds.edge_step_tfy],
                      ]
                      downloadFile(toCsv(headers, rows), 'xas_summary.csv', 'text/csv')
                    }}
                    className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)] transition-colors"
                  >
                    摘要 CSV
                  </button>
                )}
              </div>
            </div>
            </>)}

            {/* Overlay mode export */}
            {isOverlayMode && overlayDatasets.length > 0 && (
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow-soft)]">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">疊圖匯出</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const allRows: (string | number | null)[][] = []
                      overlayDatasets.forEach(ds => {
                        ds.x.forEach((x, i) => {
                          allRows.push([ds.name, x, ds.tey_processed[i], ds.tfy_processed[i]])
                        })
                      })
                      downloadFile(
                        toCsv(['name', 'energy_eV', 'TEY_processed', 'TFY_processed'], allRows),
                        'xas_overlay.csv', 'text/csv',
                      )
                    }}
                    className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)] transition-colors"
                  >
                    所有疊圖數據 CSV
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </main>

      {/* Overlay selection modal */}
      {showOverlayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--card-border)] bg-[var(--panel-bg)] p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--text-main)]">選擇疊圖資料</h3>
              <button type="button" onClick={() => setShowOverlayModal(false)}
                className="text-lg leading-none text-[var(--text-soft)] hover:text-[var(--text-main)]"
              >✕</button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {rawFiles.map(f => {
                const allSelected = overlaySelectedNames.length === 0
                const isChecked = allSelected || overlaySelectedNames.includes(f.name)
                return (
                  <label
                    key={f.name}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 hover:bg-[var(--card-ghost)]"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={e => {
                        const current = allSelected ? rawFiles.map(x => x.name) : [...overlaySelectedNames]
                        if (e.target.checked) {
                          const next = current.includes(f.name) ? current : [...current, f.name]
                          setOverlaySelectedNames(next.length === rawFiles.length ? [] : next)
                        } else {
                          setOverlaySelectedNames(current.filter(n => n !== f.name))
                        }
                      }}
                      className="accent-[var(--accent-strong)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-main)]">{f.name}</span>
                    <span className="shrink-0 text-[10px] text-[var(--text-soft)]">{f.x.length} pts</span>
                  </label>
                )
              })}
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setOverlaySelectedNames([])}
                className="text-xs text-[var(--text-soft)] hover:text-[var(--text-main)]"
              >
                全選
              </button>
              <button
                type="button"
                onClick={() => setShowOverlayModal(false)}
                className="rounded-lg bg-[var(--accent-strong)] px-5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                確認
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
