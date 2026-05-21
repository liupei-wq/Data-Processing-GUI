import { useCallback, useEffect, useRef, useState } from 'react'
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

            {/* steps */}
            <div className="flex-1 px-4 py-4">
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
            title={moduleContent.title}
            subtitle={moduleContent.subtitle}
            description={moduleContent.description}
            chips={[
              { label: `資料量 ${samples.length}` },
              { label: `平均 ${params.average ? '開啟' : '關閉'}` },
            ]}
          />

          <InfoCardGrid
            items={[
              { label: '資料集', value: samples.length > 0 ? `${samples.length} 個` : '未載入' },
              { label: '平均模式', value: params.average ? '開啟' : '關閉' },
            ]}
          />

          {/* status pills */}
          {hasSamples && (
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
          )}

          {processError && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{processError}</div>
          )}

          {!hasSamples ? (
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
          )}
        </div>
      </div>
    </div>
  )
}
