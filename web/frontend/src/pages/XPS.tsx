import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import Plot from 'react-plotly.js'
import type { AnalysisModuleId } from '../components/AnalysisModuleNav'
import AnalysisModuleNav from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import { parseFiles, processData, fitPeaks, computeVbm, lookupRsf, fetchElementPeaks, listElements } from '../api/xps'
import type {
  DatasetInput,
  ElementListItem,
  FitResult,
  InitPeak,
  ParsedFile,
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

function buildMainTraces(dataset: ProcessedDataset, showRaw: boolean, showBg: boolean): Plotly.Data[] {
  const traces: Plotly.Data[] = []
  if (showRaw) {
    traces.push({ x: dataset.x, y: dataset.y_raw, type: 'scatter', mode: 'lines', name: '原始', line: { color: '#94a3b8', width: 1.4 } })
  }
  if (showBg && dataset.y_background) {
    traces.push({ x: dataset.x, y: dataset.y_background, type: 'scatter', mode: 'lines', name: '背景', line: { color: '#eab308', width: 1.3, dash: 'dot' } })
  }
  traces.push({ x: dataset.x, y: dataset.y_processed, type: 'scatter', mode: 'lines', name: '處理後', line: { color: '#38bdf8', width: 2.0 } })
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

function Section({ step, title, hint, children, defaultOpen = true }: {
  step: number; title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="theme-block mb-3 overflow-hidden rounded-[22px]">
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

  // element selection
  const [elementsList, setElementsList] = useState<ElementListItem[]>([])
  const [selectedElement, setSelectedElement] = useState('')
  const [elementsLoading, setElementsLoading] = useState(false)

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
      .then(r => { if (!cancelled) { setResult(r); setFitResult(null) } })
      .catch(e => { if (!cancelled) setError(String(e.message)) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [rawFiles, params])

  // load elements list on mount
  useEffect(() => {
    listElements().then(setElementsList).catch(console.error)
  }, [])

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
            <div className="flex items-center justify-between border-b border-[var(--card-divider)] px-5 py-4">
              <span className="font-display text-base font-semibold tracking-wide text-[var(--text-main)]">XPS</span>
              <button type="button" onClick={() => setSidebarCollapsed(true)} className="text-xs text-[var(--text-soft)] hover:text-[var(--text-main)]">‹</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <AnalysisModuleNav activeModule="xps" onSelectModule={onModuleSelect} />

              {/* Mode toggle */}
              <div className="border-b border-[var(--card-divider)] px-4 py-3">
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
                      <button onClick={() => { setRawFiles([]); setResult(null); setFitResult(null); setPeakCandidates([]) }} className="text-xs text-rose-400 hover:text-rose-300">清除全部</button>
                    </div>
                  )}
                </Section>

                <Section step={2} title="內插 / 平均" hint="多檔統一點數後平均" defaultOpen={false}>
                  <CheckRow label="啟用內插" checked={params.interpolate} onChange={set('interpolate')} />
                  {params.interpolate && <NumInput label="點數" value={params.n_points} onChange={set('n_points')} min={200} max={5000} step={100} />}
                  {rawFiles.length > 1 && <CheckRow label="多檔平均" checked={params.average} onChange={set('average')} />}
                </Section>

                <Section step={3} title="能量校正" hint="C 1s = 284.8 eV" defaultOpen={false}>
                  <NumInput label="BE 位移 (eV)" value={params.energy_shift} onChange={set('energy_shift')} step={0.01} />
                  <p className="text-[10px] text-[var(--text-soft)]">正值向高 BE 方向移。常見校正：C 1s = 284.8 eV。</p>
                </Section>

                <Section step={4} title="背景扣除" hint="Shirley / Tougaard / Linear" defaultOpen={false}>
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
                </Section>

                <Section step={5} title="歸一化" hint="統一強度尺度" defaultOpen={false}>
                  <SelectInput label="方法" value={params.norm_method} onChange={v => set('norm_method')(v as ProcessParams['norm_method'])}
                    options={[
                      { value: 'none', label: '不歸一化' },
                      { value: 'min_max', label: 'Min–Max' },
                      { value: 'max', label: 'Max' },
                      { value: 'area', label: 'Area' },
                      { value: 'mean_region', label: '算術平均' },
                    ]}
                  />
                  {(params.norm_method === 'min_max' || params.norm_method === 'area' || params.norm_method === 'mean_region') && (
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="起始 (eV)" value={params.norm_x_start ?? beMin} onChange={v => set('norm_x_start')(v)} step={0.1} />
                      <NumInput label="結束 (eV)" value={params.norm_x_end ?? beMax} onChange={v => set('norm_x_end')(v)} step={0.1} />
                    </div>
                  )}
                </Section>

                <Section step={6} title="峰擬合" hint="元素資料庫選峰 / 手動新增 / Voigt" defaultOpen={false}>
                  <SelectInput label="峰形" value={fitProfile} onChange={setFitProfile}
                    options={[{ value: 'voigt', label: 'Voigt' }, { value: 'gaussian', label: 'Gaussian' }, { value: 'lorentzian', label: 'Lorentzian' }]}
                  />
                  <div className="space-y-1.5">
                    <span className="block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">從元素資料庫載入</span>
                    <div className="flex gap-2">
                      <select
                        value={selectedElement}
                        onChange={e => setSelectedElement(e.target.value)}
                        className="flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none"
                      >
                        <option value="">選擇元素…</option>
                        {elementsList.filter(el => el.has_peaks).map(el => (
                          <option key={el.symbol} value={el.symbol}>{el.symbol} — {el.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={loadElementPeaks}
                        disabled={!selectedElement || elementsLoading}
                        className="rounded-lg border border-[var(--accent-strong)] px-3 py-1.5 text-xs text-[var(--accent-strong)] hover:bg-[var(--accent-soft)] disabled:opacity-50 pressable"
                      >
                        {elementsLoading ? '…' : '載入'}
                      </button>
                    </div>
                  </div>
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
                  <Section step={7} title="VBM 線性外推" hint="外推至基準線水平" defaultOpen={false}>
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
                  <Section step={8} title="能帶偏移" hint="VBM 差值法 / Kraut Method" defaultOpen={false}>
                    <SelectInput label="方法" value={bandOffsetMethod}
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
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">擬合峰數</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-main)]">{fitResult ? `${fitResult.peaks.length} 個` : '—'}</p>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-4">
              <CheckRow label="顯示原始" checked={showRaw} onChange={setShowRaw} />
              {params.bg_enabled && <CheckRow label="顯示背景線" checked={showBg} onChange={setShowBg} />}
            </div>

            <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
              <p className="mb-2 text-sm font-semibold text-[var(--text-main)]">
                {activeDataset.name} — 光譜
                {fitResult && <span className="ml-2 text-xs font-normal text-[var(--text-soft)]">（含擬合結果）</span>}
              </p>
              <Plot
                data={(fitResult ? buildFitTraces(activeDataset, fitResult) : buildMainTraces(activeDataset, showRaw, showBg)) as Plotly.Data[]}
                layout={chartLayout() as Plotly.Layout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%', height: 380 }}
              />
            </div>

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

            {xpsMode === 'valence_band' && vbmResult?.success && (
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

            {xpsMode === 'valence_band' && bandOffsetResult && (
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

            {fitResult && fitResult.peaks.length > 0 && rsfRows.length > 0 && (
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

            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出</p>
              <div className="flex flex-wrap gap-2">
                <ExportBtn label="處理後光譜 CSV" onClick={() => {
                  const ds = activeDataset
                  const headers = ['binding_energy_eV', 'intensity_raw', 'intensity_processed']
                  const rows = ds.x.map((x, i) => [x, ds.y_raw[i], ds.y_processed[i]])
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
          </>
        )}
      </main>
    </div>
  )
}
