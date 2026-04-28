import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import Plot from 'react-plotly.js'
import type { AnalysisModuleId } from '../components/AnalysisModuleNav'
import AnalysisModuleNav from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import { parseFiles, processData, detectPeaks, fitPeaks } from '../api/xps'
import type {
  DatasetInput,
  DetectedPeak,
  FitPeakRow,
  FitResult,
  InitPeak,
  ParsedFile,
  ProcessParams,
  ProcessResult,
  ProcessedDataset,
} from '../types/xps'

const SIDEBAR_MIN_WIDTH = 300
const SIDEBAR_MAX_WIDTH = 540
const SIDEBAR_DEFAULT_WIDTH = 360
const SIDEBAR_COLLAPSED_PEEK = 28

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

function buildMainTraces(dataset: ProcessedDataset, showRaw: boolean, showBg: boolean, detectedPeaks: DetectedPeak[]): Plotly.Data[] {
  const traces: Plotly.Data[] = []
  if (showRaw) {
    traces.push({ x: dataset.x, y: dataset.y_raw, type: 'scatter', mode: 'lines', name: '原始', line: { color: '#94a3b8', width: 1.4 } })
  }
  if (showBg && dataset.y_background) {
    traces.push({ x: dataset.x, y: dataset.y_background, type: 'scatter', mode: 'lines', name: '背景', line: { color: '#eab308', width: 1.3, dash: 'dot' } })
  }
  traces.push({ x: dataset.x, y: dataset.y_processed, type: 'scatter', mode: 'lines', name: '處理後', line: { color: '#38bdf8', width: 2.0 } })

  // detected peak markers
  if (detectedPeaks.length > 0) {
    const yValues = dataset.y_processed
    const yMin = Math.min(...yValues)
    const yMax = Math.max(...yValues)
    const span = Math.max(yMax - yMin, 1)
    const xs: (number | null)[] = []
    const ys: (number | null)[] = []
    detectedPeaks.forEach(pk => {
      xs.push(pk.binding_energy, pk.binding_energy, null)
      ys.push(yMin, yMin + span * 0.12, null)
    })
    traces.push({
      x: xs, y: ys, type: 'scatter', mode: 'lines', name: '偵測峰位',
      line: { color: '#f97316', width: 1.2, dash: 'dash' },
    })
  }
  return traces
}

function buildFitTraces(dataset: ProcessedDataset, fitResult: FitResult): Plotly.Data[] {
  const traces: Plotly.Data[] = [
    { x: dataset.x, y: dataset.y_processed, type: 'scatter', mode: 'lines', name: '擬合輸入', line: { color: '#94a3b8', width: 1.4 } },
    { x: dataset.x, y: fitResult.y_fit, type: 'scatter', mode: 'lines', name: '總擬合', line: { color: '#38bdf8', width: 2.2 } },
    { x: dataset.x, y: fitResult.residuals, type: 'scatter', mode: 'lines', name: '殘差', line: { color: '#f97316', width: 1.2, dash: 'dot' }, opacity: 0.7 },
  ]
  fitResult.y_individual.forEach((yLine, idx) => {
    const pk = fitResult.peaks[idx]
    traces.push({
      x: dataset.x, y: yLine, type: 'scatter', mode: 'lines',
      name: pk?.Peak_Name || `Peak ${idx + 1}`, line: { width: 1.3 }, opacity: 0.8,
    })
  })
  return traces
}

// ── small UI pieces ───────────────────────────────────────────────────────────

function SectionHeader({ n, label }: { n: number; label: string }) {
  return (
    <div className="border-b border-[var(--card-divider)] bg-[color:color-mix(in_srgb,var(--card-bg)_60%,transparent)] px-4 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-soft)]">
        {n}. {label}
      </span>
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

function SelectInput({ label, value, onChange, options, disabled = false }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
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

function createPeakId() { return `XP${Math.random().toString(36).slice(2, 7)}` }

interface PeakCandidate extends InitPeak {
  id: string
  label: string
  enabled: boolean
}

// ── main component ────────────────────────────────────────────────────────────

export default function XPS({ onModuleSelect }: { onModuleSelect?: (m: AnalysisModuleId) => void }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('nigiro-xps-sidebar-width'))
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH ? saved : SIDEBAR_DEFAULT_WIDTH
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('nigiro-xps-sidebar-collapsed') === 'true')
  const [sidebarResizing, setSidebarResizing] = useState(false)

  const [rawFiles, setRawFiles] = useState<ParsedFile[]>([])
  const [params, setParams] = useState<ProcessParams>(DEFAULT_PARAMS)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // display
  const [showRaw, setShowRaw] = useState(true)
  const [showBg, setShowBg] = useState(true)
  const [activeDatasetIdx, setActiveDatasetIdx] = useState(0)

  // peak detection
  const [peakEnabled, setPeakEnabled] = useState(false)
  const [peakProminence, setPeakProminence] = useState(0.05)
  const [peakMinDist, setPeakMinDist] = useState(0.3)
  const [peakMaxPeaks, setPeakMaxPeaks] = useState(20)
  const [detectedPeaks, setDetectedPeaks] = useState<DetectedPeak[]>([])

  // fitting
  const [fitEnabled, setFitEnabled] = useState(false)
  const [fitProfile, setFitProfile] = useState<string>('voigt')
  const [peakCandidates, setPeakCandidates] = useState<PeakCandidate[]>([])
  const [fitResult, setFitResult] = useState<FitResult | null>(null)
  const [isFitting, setIsFitting] = useState(false)
  const [fitError, setFitError] = useState<string | null>(null)

  const activeDataset = result
    ? (result.average && params.average ? result.average : result.datasets[activeDatasetIdx] ?? null)
    : null
  const beMin = activeDataset ? Math.min(...activeDataset.x) : 0
  const beMax = activeDataset ? Math.max(...activeDataset.x) : 1000

  // process when files or params change
  useEffect(() => {
    if (rawFiles.length === 0) { setResult(null); return }
    let cancelled = false
    setIsLoading(true); setError(null)
    const datasets: DatasetInput[] = rawFiles.map(f => ({ name: f.name, x: f.x, y: f.y }))
    processData(datasets, params)
      .then(r => { if (!cancelled) { setResult(r); setFitResult(null); setDetectedPeaks([]) } })
      .catch(e => { if (!cancelled) setError(String(e.message)) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [rawFiles, params])

  // auto peak detection when enabled + active dataset changes
  useEffect(() => {
    if (!peakEnabled || !activeDataset) { setDetectedPeaks([]); return }
    let cancelled = false
    detectPeaks(activeDataset.x, activeDataset.y_processed, peakProminence, peakMinDist, peakMaxPeaks)
      .then(pks => { if (!cancelled) setDetectedPeaks(pks) })
      .catch(console.error)
    return () => { cancelled = true }
  }, [peakEnabled, activeDataset, peakProminence, peakMinDist, peakMaxPeaks])

  useEffect(() => { localStorage.setItem('nigiro-xps-sidebar-width', String(sidebarWidth)) }, [sidebarWidth])
  useEffect(() => { localStorage.setItem('nigiro-xps-sidebar-collapsed', String(sidebarCollapsed)) }, [sidebarCollapsed])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); setSidebarResizing(true)
    const startX = e.clientX; const startW = sidebarWidth
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startW + ev.clientX - startX)))
    const onUp = () => { setSidebarResizing(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  const handleFiles = useCallback(async (files: File[]) => {
    setIsLoading(true); setError(null)
    try {
      const res = await parseFiles(files)
      if (res.errors.length) setError(res.errors.join('; '))
      setRawFiles(res.files)
      setActiveDatasetIdx(0)
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setIsLoading(false) }
  }, [])

  const set = <K extends keyof ProcessParams>(key: K) => (val: ProcessParams[K]) =>
    setParams(p => ({ ...p, [key]: val }))

  const addPeakFromDetected = (pk: DetectedPeak) => {
    if (!activeDataset) return
    const candidate: PeakCandidate = {
      id: createPeakId(),
      label: `${pk.binding_energy.toFixed(1)} eV`,
      enabled: true,
      center: pk.binding_energy,
      fwhm: 1.0,
      amplitude: pk.intensity,
    }
    setPeakCandidates(prev => [...prev, candidate])
    setFitEnabled(true)
  }

  const addManualPeak = () => {
    const center = activeDataset ? (beMin + beMax) / 2 : 500
    setPeakCandidates(prev => [...prev, {
      id: createPeakId(), label: `峰 ${prev.length + 1}`, enabled: true,
      center, fwhm: 1.5, amplitude: 1000,
    }])
    setFitEnabled(true)
  }

  const handleFit = async () => {
    if (!activeDataset) return
    const activePeaks = peakCandidates.filter(p => p.enabled)
    if (activePeaks.length === 0) { setFitError('請先新增至少一個峰'); return }
    setIsFitting(true); setFitError(null)
    try {
      const initPeaks: InitPeak[] = activePeaks.map(p => ({ center: p.center, fwhm: p.fwhm, amplitude: p.amplitude }))
      const res = await fitPeaks(activeDataset.x, activeDataset.y_processed, initPeaks, fitProfile)
      setFitResult(res)
    } catch (e: unknown) { setFitError((e as Error).message) }
    finally { setIsFitting(false) }
  }

  const sidebarStyle: CSSProperties = sidebarCollapsed
    ? { width: SIDEBAR_COLLAPSED_PEEK, minWidth: SIDEBAR_COLLAPSED_PEEK, overflow: 'hidden' }
    : { width: sidebarWidth, minWidth: SIDEBAR_MIN_WIDTH, maxWidth: SIDEBAR_MAX_WIDTH }

  return (
    <div className={`flex h-screen flex-row overflow-hidden${sidebarResizing ? ' select-none' : ''}`}>
      {/* ── sidebar ── */}
      <aside style={sidebarStyle} className="relative flex shrink-0 flex-col overflow-hidden border-r border-[var(--card-divider)] bg-[var(--panel-bg)] transition-[width] duration-200">
        {sidebarCollapsed ? (
          <button type="button" onClick={() => setSidebarCollapsed(false)}
            className="flex h-full w-full flex-col items-center justify-center text-[var(--text-soft)] hover:text-[var(--text-main)]"
          >
            <span className="text-lg">›</span>
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-[var(--card-divider)] px-5 py-4">
              <span className="font-display text-base font-semibold tracking-wide text-[var(--text-main)]">XPS</span>
              <button type="button" onClick={() => setSidebarCollapsed(true)} className="text-xs text-[var(--text-soft)] hover:text-[var(--text-main)]">‹</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <AnalysisModuleNav activeModule="xps" onSelectModule={onModuleSelect} />

              {/* 1. 載入 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={1} label="載入檔案" />
                <div className="space-y-3 p-4">
                  <FileUpload onFiles={handleFiles} isLoading={isLoading} accept={['.xy', '.txt', '.csv', '.vms', '.pro', '.dat']} />
                  {rawFiles.length > 0 && (
                    <div className="space-y-1">
                      {rawFiles.map(f => (
                        <div key={f.name} className="flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs text-[var(--text-main)]">
                          <span className="text-[var(--accent-tertiary)]">✓</span>
                          <span className="truncate">{f.name}</span>
                          <span className="ml-auto shrink-0 text-[var(--text-soft)]">{f.x.length} pts</span>
                        </div>
                      ))}
                      <button onClick={() => { setRawFiles([]); setResult(null); setDetectedPeaks([]); setFitResult(null); setPeakCandidates([]) }} className="text-xs text-rose-400 hover:text-rose-300">清除全部</button>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. 內插 / 平均 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={2} label="內插 / 平均" />
                <div className="space-y-3 p-4">
                  <CheckRow label="啟用內插" checked={params.interpolate} onChange={set('interpolate')} />
                  {params.interpolate && <NumInput label="點數" value={params.n_points} onChange={set('n_points')} min={200} max={5000} step={100} />}
                  {rawFiles.length > 1 && <CheckRow label="多檔平均" checked={params.average} onChange={set('average')} />}
                </div>
              </div>

              {/* 3. 能量校正 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={3} label="能量校正" />
                <div className="p-4">
                  <NumInput label="BE 位移 (eV)" value={params.energy_shift} onChange={set('energy_shift')} step={0.01} />
                  <p className="mt-2 text-[10px] text-[var(--text-soft)]">正值向高 BE 方向移。常見校正：C 1s = 284.8 eV。</p>
                </div>
              </div>

              {/* 4. 背景扣除 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={4} label="背景扣除" />
                <div className="space-y-3 p-4">
                  <CheckRow label="啟用背景扣除" checked={params.bg_enabled} onChange={set('bg_enabled')} />
                  {params.bg_enabled && (
                    <>
                      <SelectInput label="方法" value={params.bg_method} onChange={v => set('bg_method')(v as ProcessParams['bg_method'])}
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
                        <NumInput label="起始 BE (eV)" value={params.bg_x_start ?? beMin} onChange={v => set('bg_x_start')(v)} step={0.1} />
                        <NumInput label="結束 BE (eV)" value={params.bg_x_end ?? beMax} onChange={v => set('bg_x_end')(v)} step={0.1} />
                      </div>
                      {params.bg_method === 'polynomial' && <NumInput label="多項式次數" value={params.bg_poly_deg} onChange={set('bg_poly_deg')} min={1} max={10} />}
                      {params.bg_method === 'tougaard' && (
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput label="B" value={params.bg_tougaard_B} onChange={set('bg_tougaard_B')} step={10} />
                          <NumInput label="C" value={params.bg_tougaard_C} onChange={set('bg_tougaard_C')} step={10} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 5. 平滑 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={5} label="平滑" />
                <div className="space-y-3 p-4">
                  <SelectInput label="方法" value={params.smooth_method} onChange={v => set('smooth_method')(v as ProcessParams['smooth_method'])}
                    options={[{ value: 'none', label: '不平滑' }, { value: 'moving_average', label: '移動平均' }, { value: 'savitzky_golay', label: 'Savitzky-Golay' }]}
                  />
                  {params.smooth_method !== 'none' && (
                    <NumInput label="窗口大小" value={params.smooth_window} onChange={set('smooth_window')} min={3} max={51} step={2} />
                  )}
                </div>
              </div>

              {/* 6. 歸一化 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={6} label="歸一化" />
                <div className="space-y-3 p-4">
                  <SelectInput label="方法" value={params.norm_method} onChange={v => set('norm_method')(v as ProcessParams['norm_method'])}
                    options={[{ value: 'none', label: '不歸一化' }, { value: 'min_max', label: 'Min–Max' }, { value: 'max', label: 'Max' }, { value: 'area', label: 'Area' }]}
                  />
                  {(params.norm_method === 'min_max' || params.norm_method === 'area') && (
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="起始 (eV)" value={params.norm_x_start ?? beMin} onChange={v => set('norm_x_start')(v)} step={0.1} />
                      <NumInput label="結束 (eV)" value={params.norm_x_end ?? beMax} onChange={v => set('norm_x_end')(v)} step={0.1} />
                    </div>
                  )}
                </div>
              </div>

              {/* 7. 尋峰 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={7} label="自動尋峰" />
                <div className="space-y-3 p-4">
                  <CheckRow label="啟用自動尋峰" checked={peakEnabled} onChange={setPeakEnabled} />
                  {peakEnabled && (
                    <>
                      <NumInput label="Prominence" value={peakProminence} onChange={setPeakProminence} min={0.001} max={1} step={0.01} />
                      <NumInput label="最小峰距 (eV)" value={peakMinDist} onChange={setPeakMinDist} min={0.1} max={10} step={0.1} />
                      <NumInput label="最多峰數" value={peakMaxPeaks} onChange={setPeakMaxPeaks} min={1} max={50} step={1} />
                    </>
                  )}
                </div>
              </div>

              {/* 8. 峰擬合 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={8} label="峰擬合" />
                <div className="space-y-3 p-4">
                  <SelectInput label="峰形" value={fitProfile} onChange={setFitProfile}
                    options={[{ value: 'voigt', label: 'Voigt' }, { value: 'gaussian', label: 'Gaussian' }, { value: 'lorentzian', label: 'Lorentzian' }]}
                  />
                  <button type="button" onClick={addManualPeak}
                    className="w-full rounded-lg border border-dashed border-[var(--card-border)] py-2 text-xs text-[var(--text-soft)] hover:border-[var(--accent-strong)] hover:text-[var(--text-main)]"
                  >
                    + 新增峰
                  </button>
                  {peakCandidates.map((pk, idx) => (
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
                    <button type="button" onClick={handleFit} disabled={isFitting}
                      className="w-full rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
                    >
                      {isFitting ? '擬合中…' : '執行擬合'}
                    </button>
                  )}
                  {fitError && <p className="text-xs text-rose-400">{fitError}</p>}
                </div>
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
        {isLoading && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-strong)]" /> 處理中…
          </div>
        )}

        {!result && !isLoading && (
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

        {result && activeDataset && (
          <>
            {/* dataset selector */}
            {result.datasets.length > 1 && !params.average && (
              <div className="mb-3 flex gap-2 flex-wrap">
                {result.datasets.map((ds, idx) => (
                  <button key={ds.name} type="button" onClick={() => setActiveDatasetIdx(idx)}
                    className={['rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      idx === activeDatasetIdx ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-main)]' : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-soft)]'].join(' ')}
                  >{ds.name}</button>
                ))}
              </div>
            )}

            {/* summary cards */}
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">資料集</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-main)]">{result.datasets.length} 個</p>
              </div>
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">BE 範圍</p>
                <p className="mt-1 text-base font-semibold text-[var(--text-main)]">
                  {beMin.toFixed(1)} – {beMax.toFixed(1)} eV
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">偵測峰數</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-main)]">{detectedPeaks.length > 0 ? `${detectedPeaks.length} 個` : '—'}</p>
              </div>
            </div>

            {/* display controls */}
            <div className="mb-3 flex flex-wrap items-center gap-4">
              <CheckRow label="顯示原始" checked={showRaw} onChange={setShowRaw} />
              {params.bg_enabled && <CheckRow label="顯示背景線" checked={showBg} onChange={setShowBg} />}
            </div>

            {/* main spectrum chart */}
            <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
              <p className="mb-2 text-sm font-semibold text-[var(--text-main)]">
                {activeDataset.name} — 光譜
                {fitResult && <span className="ml-2 text-xs font-normal text-[var(--text-soft)]">（含擬合結果）</span>}
              </p>
              <Plot
                data={(fitResult ? buildFitTraces(activeDataset, fitResult) : buildMainTraces(activeDataset, showRaw, showBg, detectedPeaks)) as Plotly.Data[]}
                layout={chartLayout() as Plotly.Layout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%', height: 380 }}
              />
            </div>

            {/* detected peaks table */}
            {detectedPeaks.length > 0 && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-[var(--text-main)]">自動偵測峰位</p>
                  <button type="button" onClick={() => { detectedPeaks.forEach(pk => addPeakFromDetected(pk)) }}
                    className="text-xs text-[var(--accent-strong)] hover:underline"
                  >全部加入擬合</button>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--card-divider)] text-[var(--text-soft)]">
                      <th className="pb-2 text-left font-medium">BE (eV)</th>
                      <th className="pb-2 text-right font-medium">強度</th>
                      <th className="pb-2 text-right font-medium">相對強度 (%)</th>
                      <th className="pb-2 text-right font-medium" />
                    </tr>
                  </thead>
                  <tbody className="text-[var(--text-main)]">
                    {detectedPeaks.map(pk => (
                      <tr key={pk.binding_energy} className="border-b border-[var(--card-divider)]">
                        <td className="py-1.5">{pk.binding_energy.toFixed(2)}</td>
                        <td className="py-1.5 text-right">{pk.intensity.toFixed(1)}</td>
                        <td className="py-1.5 text-right">{pk.rel_intensity.toFixed(1)}</td>
                        <td className="py-1.5 text-right">
                          <button type="button" onClick={() => addPeakFromDetected(pk)} className="text-[var(--accent-strong)] hover:underline">加入擬合</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* fit result table */}
            {fitResult && fitResult.peaks.length > 0 && (
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

            {/* export */}
            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出</p>
              <div className="flex flex-wrap gap-2">
                <ExportBtn label="處理後光譜 CSV" onClick={() => {
                  const ds = activeDataset
                  const headers = ['binding_energy_eV', 'intensity_raw', 'intensity_processed']
                  const rows = ds.x.map((x, i) => [x, ds.y_raw[i], ds.y_processed[i]])
                  downloadFile(toCsv(headers, rows), 'xps_processed.csv', 'text/csv')
                }} />
                {detectedPeaks.length > 0 && (
                  <ExportBtn label="偵測峰位 CSV" onClick={() => {
                    const headers = ['binding_energy_eV', 'intensity', 'rel_intensity_pct']
                    const rows = detectedPeaks.map(pk => [pk.binding_energy, pk.intensity, pk.rel_intensity])
                    downloadFile(toCsv(headers, rows), 'xps_peaks.csv', 'text/csv')
                  }} />
                )}
                {fitResult && fitResult.peaks.length > 0 && (
                  <ExportBtn label="擬合結果 CSV" onClick={() => {
                    const headers = ['Peak', 'Center_eV', 'FWHM_eV', 'Area', 'Area_pct']
                    const rows: (string | number | null)[][] = fitResult.peaks.map(pk => [pk.Peak_Name, pk.Center_eV, pk.FWHM_eV, pk.Area, pk.Area_pct])
                    downloadFile(toCsv(headers, rows), 'xps_fit.csv', 'text/csv')
                  }} />
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
