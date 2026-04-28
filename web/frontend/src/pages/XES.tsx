import { useCallback, useEffect, useRef, useState } from 'react'
import Plot from 'react-plotly.js'
import type { AnalysisModuleId } from '../components/AnalysisModuleNav'
import AnalysisModuleNav from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import { parseFiles, processData, detectPeaks, listReferences, getReferencePeaks } from '../api/xes'
import type {
  BandAlignParams,
  BandAlignResult,
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
  smooth_method: 'none',
  smooth_window: 5,
  smooth_poly: 3,
  norm_method: 'none',
  norm_x_start: null,
  norm_x_end: null,
  axis_calibration: 'none',
  energy_offset: 0,
  energy_slope: 1,
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
function SidebarCard({ step, title, hint, children, defaultOpen = true }: {
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

// ── label / input helpers ──────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-xs font-medium text-[var(--text-soft)]">{children}</div>
}
function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-strong)] ${props.className ?? ''}`}
    />
  )
}
function Select({ ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-strong)] ${props.className ?? ''}`}
    />
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function XES({ onModuleSelect }: { onModuleSelect?: (m: AnalysisModuleId) => void }) {
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

  const [peakParams, setPeakParams] = useState({ enabled: false, prominence: 0.05, minDistance: 1.0, maxPeaks: 20 })
  const [detectedPeaks, setDetectedPeaks] = useState<DetectedPeak[]>([])

  const [availableMaterials, setAvailableMaterials] = useState<string[]>([])
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([])
  const [refPeaks, setRefPeaks] = useState<ReferencePeak[]>([])

  const [bandParams, setBandParams] = useState<BandAlignParams>(DEFAULT_BAND)

  const [sampleFiles, setSampleFiles] = useState<File[]>([])
  const [bg1File, setBg1File] = useState<File | null>(null)
  const [bg2File, setBg2File] = useState<File | null>(null)

  // load references on mount
  useEffect(() => {
    listReferences().then(setAvailableMaterials).catch(() => {})
  }, [])

  useEffect(() => {
    if (selectedMaterials.length === 0) { setRefPeaks([]); return }
    getReferencePeaks(selectedMaterials).then(setRefPeaks).catch(() => {})
  }, [selectedMaterials])

  const handleUpload = async (files: File[]) => {
    setSampleFiles(files)
  }
  const handleBg1Upload = (files: File[]) => { setBg1File(files[0] ?? null) }
  const handleBg2Upload = (files: File[]) => { setBg2File(files[0] ?? null) }

  const handleParse = useCallback(async () => {
    if (sampleFiles.length === 0) return
    try {
      const res = await parseFiles(sampleFiles, bg1File, bg2File)
      setSamples(res.samples)
      setBg1(res.bg1)
      setBg2(res.bg2)
      setParseErrors(res.errors)
      setProcessed([])
      setAverage(null)
      setDetectedPeaks([])
    } catch (e) {
      setParseErrors([(e as Error).message])
    }
  }, [sampleFiles, bg1File, bg2File])

  const handleProcess = useCallback(async () => {
    if (samples.length === 0) return
    setProcessing(true)
    setProcessError(null)
    try {
      const dsInputs: DatasetInput[] = samples.map(s => ({ name: s.name, x: s.x, y: s.y }))
      const bg1Input = bg1 ? { name: bg1.name, x: bg1.x, y: bg1.y } : null
      const bg2Input = bg2 ? { name: bg2.name, x: bg2.x, y: bg2.y } : null
      const res = await processData(dsInputs, bg1Input, bg2Input, params)
      setProcessed(res.datasets)
      setAverage(res.average)
      setDetectedPeaks([])
    } catch (e) {
      setProcessError((e as Error).message)
    } finally {
      setProcessing(false)
    }
  }, [samples, bg1, bg2, params])

  const handleDetectPeaks = useCallback(async () => {
    const target = average ?? processed[0]
    if (!target) return
    const xArr = params.axis_calibration === 'linear' && target.x_ev ? target.x_ev : target.x_pixel
    try {
      const peaks = await detectPeaks(xArr, target.y_processed, peakParams.prominence, peakParams.minDistance, peakParams.maxPeaks)
      setDetectedPeaks(peaks)
    } catch (e) { /* ignore */ }
  }, [processed, average, params.axis_calibration, peakParams])

  const p = (k: keyof ProcessParams, v: unknown) => setParams(prev => ({ ...prev, [k]: v }))
  const bp = (k: keyof BandAlignParams, v: unknown) => setBandParams(prev => ({ ...prev, [k]: v }))

  const useEv = params.axis_calibration === 'linear'
  const xLabel = useEv ? 'Emission Energy (eV)' : 'Input X'

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
    yaxis: { title: { text: 'Intensity' }, gridcolor: gridColor, zerolinecolor: gridColor },
    legend: { orientation: 'h' as const, y: -0.15, font: { size: 11 } },
    margin: { l: 55, r: 20, t: 46, b: 50 },
    height: 340,
  })

  const getX = (ds: ProcessedDataset) =>
    useEv && ds.x_ev ? ds.x_ev : ds.x_pixel

  const hasSamples = samples.length > 0
  const hasProcessed = processed.length > 0

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-canvas)]">
      {/* sidebar */}
      <div
        className="module-sidebar relative flex flex-shrink-0 flex-col overflow-hidden border-r border-[var(--card-border)] bg-[var(--panel-bg)]"
        style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_PEEK : sidebarWidth }}
      >
        {!sidebarCollapsed && (
          <div className="module-sidebar__content flex flex-1 flex-col overflow-y-auto">
            {/* brand + modules */}
            <div className="px-6 pt-6 pb-2">
              <div className="text-xl font-bold tracking-tight text-[var(--text-main)]">Nigiro Pro</div>
              <div className="text-xs text-[var(--text-soft)]">data processing</div>
            </div>
            <AnalysisModuleNav activeModule="xes" onSelectModule={onModuleSelect} />
            <div className="mx-4 border-t border-[var(--card-border)]" />

            {/* steps */}
            <div className="flex-1 px-4 py-4">
              {/* Step 1 */}
              <SidebarCard step={1} title="載入資料">
                <Label>Sample 光譜（可多選）</Label>
                <FileUpload onFiles={handleUpload} moduleLabel="XES" />
                <Label>BG1（樣品前背景，可選）</Label>
                <FileUpload onFiles={handleBg1Upload} moduleLabel="BG1" />
                <Label>BG2（樣品後背景，可選）</Label>
                <FileUpload onFiles={handleBg2Upload} moduleLabel="BG2" />
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={sampleFiles.length === 0}
                  className="pressable mt-3 w-full rounded-xl bg-[var(--accent-strong)] py-2 text-sm font-semibold text-[var(--bg-canvas)] disabled:opacity-40"
                >
                  解析檔案
                </button>
                {parseErrors.map((e, i) => (
                  <div key={i} className="mt-1 rounded-lg bg-red-900/30 px-3 py-1.5 text-xs text-red-300">{e}</div>
                ))}
              </SidebarCard>

              {/* Step 2 */}
              <SidebarCard step={2} title="內插 / 多檔平均" defaultOpen={false}>
                <label className="flex items-center gap-2 text-sm text-[var(--text-main)]">
                  <input type="checkbox" checked={params.interpolate} onChange={e => p('interpolate', e.target.checked)} />
                  內插至均勻網格
                </label>
                {params.interpolate && (
                  <div className="mt-2">
                    <Label>點數</Label>
                    <Input type="number" value={params.n_points} min={100} max={5000} step={100}
                      onChange={e => p('n_points', Number(e.target.value))} />
                  </div>
                )}
                <label className="mt-2 flex items-center gap-2 text-sm text-[var(--text-main)]">
                  <input type="checkbox" checked={params.average} onChange={e => p('average', e.target.checked)} />
                  多檔平均
                </label>
              </SidebarCard>

              {/* Step 3 */}
              <SidebarCard step={3} title="BG1/BG2 背景扣除" defaultOpen={false}>
                <Label>扣除方式</Label>
                <Select value={params.bg_method} onChange={e => p('bg_method', e.target.value)}>
                  <option value="none">不扣除</option>
                  <option value="bg1">只用 BG1</option>
                  <option value="bg2">只用 BG2</option>
                  <option value="average">BG1+BG2 平均</option>
                  <option value="interpolated">分點插值（依上傳順序）</option>
                </Select>
              </SidebarCard>

              {/* Step 4 */}
              <SidebarCard step={4} title="平滑" defaultOpen={false}>
                <Label>平滑方式</Label>
                <Select value={params.smooth_method} onChange={e => p('smooth_method', e.target.value as ProcessParams['smooth_method'])}>
                  <option value="none">不平滑</option>
                  <option value="moving_average">移動平均</option>
                  <option value="savitzky_golay">Savitzky-Golay</option>
                </Select>
                {params.smooth_method !== 'none' && (
                  <div className="mt-2 space-y-2">
                    <Label>視窗點數</Label>
                    <Input type="number" value={params.smooth_window} min={3} max={101} step={2}
                      onChange={e => p('smooth_window', Number(e.target.value))} />
                    {params.smooth_method === 'savitzky_golay' && (
                      <>
                        <Label>多項式階次</Label>
                        <Input type="number" value={params.smooth_poly} min={1} max={9} step={1}
                          onChange={e => p('smooth_poly', Number(e.target.value))} />
                      </>
                    )}
                  </div>
                )}
              </SidebarCard>

              {/* Step 5 */}
              <SidebarCard step={5} title="歸一化" defaultOpen={false}>
                <Select value={params.norm_method} onChange={e => p('norm_method', e.target.value as ProcessParams['norm_method'])}>
                  <option value="none">不歸一化</option>
                  <option value="min_max">Min-Max</option>
                  <option value="max">最大值 = 1</option>
                  <option value="area">面積 = 1</option>
                  <option value="reference_region">參考區間</option>
                </Select>
                {params.norm_method === 'reference_region' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <Label>X 起始</Label>
                      <Input type="number" step="any" value={params.norm_x_start ?? ''} placeholder="auto"
                        onChange={e => p('norm_x_start', e.target.value === '' ? null : Number(e.target.value))} />
                    </div>
                    <div>
                      <Label>X 結束</Label>
                      <Input type="number" step="any" value={params.norm_x_end ?? ''} placeholder="auto"
                        onChange={e => p('norm_x_end', e.target.value === '' ? null : Number(e.target.value))} />
                    </div>
                  </div>
                )}
              </SidebarCard>

              {/* Step 6 */}
              <SidebarCard step={6} title="X 軸校正（pixel → eV）" defaultOpen={false}>
                <Label>校正方式</Label>
                <Select value={params.axis_calibration} onChange={e => p('axis_calibration', e.target.value as ProcessParams['axis_calibration'])}>
                  <option value="none">不校正（保留 pixel / 原始 X）</option>
                  <option value="linear">線性：eV = offset + slope × X</option>
                </Select>
                {params.axis_calibration === 'linear' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <Label>Offset (eV)</Label>
                      <Input type="number" step="any" value={params.energy_offset}
                        onChange={e => p('energy_offset', Number(e.target.value))} />
                    </div>
                    <div>
                      <Label>Slope</Label>
                      <Input type="number" step="any" value={params.energy_slope}
                        onChange={e => p('energy_slope', Number(e.target.value))} />
                    </div>
                  </div>
                )}
              </SidebarCard>

              {/* Step 7 */}
              <SidebarCard step={7} title="參考峰" defaultOpen={false}>
                <Label>選擇材料</Label>
                <div className="space-y-1">
                  {availableMaterials.map(m => (
                    <label key={m} className="flex items-center gap-2 text-sm text-[var(--text-main)]">
                      <input
                        type="checkbox"
                        checked={selectedMaterials.includes(m)}
                        onChange={e => setSelectedMaterials(prev =>
                          e.target.checked ? [...prev, m] : prev.filter(x => x !== m)
                        )}
                      />
                      {m}
                    </label>
                  ))}
                </div>
              </SidebarCard>

              {/* Step 8 */}
              <SidebarCard step={8} title="峰值偵測" defaultOpen={false}>
                <label className="flex items-center gap-2 text-sm text-[var(--text-main)]">
                  <input type="checkbox" checked={peakParams.enabled}
                    onChange={e => setPeakParams(p => ({ ...p, enabled: e.target.checked }))} />
                  啟用峰值偵測
                </label>
                {peakParams.enabled && (
                  <div className="mt-2 space-y-2">
                    <Label>Prominence（相對最大值）</Label>
                    <Input type="number" step={0.01} min={0.01} max={1} value={peakParams.prominence}
                      onChange={e => setPeakParams(p => ({ ...p, prominence: Number(e.target.value) }))} />
                    <Label>最小峰距（X 單位）</Label>
                    <Input type="number" step={0.1} min={0.1} value={peakParams.minDistance}
                      onChange={e => setPeakParams(p => ({ ...p, minDistance: Number(e.target.value) }))} />
                    <Label>最多峰數</Label>
                    <Input type="number" step={1} min={1} max={50} value={peakParams.maxPeaks}
                      onChange={e => setPeakParams(p => ({ ...p, maxPeaks: Number(e.target.value) }))} />
                    <button
                      type="button"
                      onClick={handleDetectPeaks}
                      disabled={!hasProcessed}
                      className="pressable w-full rounded-xl border border-[var(--accent-strong)] py-1.5 text-sm font-semibold text-[var(--accent-strong)] disabled:opacity-40"
                    >
                      偵測峰值
                    </button>
                  </div>
                )}
              </SidebarCard>

              {/* Step 9 */}
              <SidebarCard step={9} title="能帶對齊（XES/XAS）" defaultOpen={false}>
                <label className="flex items-center gap-2 text-sm text-[var(--text-main)]">
                  <input type="checkbox" checked={bandParams.enabled} onChange={e => bp('enabled', e.target.checked)} />
                  啟用能帶對齊計算
                </label>
                {bandParams.enabled && (
                  <div className="mt-2 space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label>材料 A</Label><Input value={bandParams.mat_a} onChange={e => bp('mat_a', e.target.value)} /></div>
                      <div><Label>材料 B</Label><Input value={bandParams.mat_b} onChange={e => bp('mat_b', e.target.value)} /></div>
                    </div>
                    <p className="text-xs font-semibold text-[var(--text-soft)]">材料 A</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label>VBM (eV)</Label><Input type="number" step="any" value={bandParams.vbm_a} onChange={e => bp('vbm_a', Number(e.target.value))} /></div>
                      <div><Label>CBM (eV)</Label><Input type="number" step="any" value={bandParams.cbm_a} onChange={e => bp('cbm_a', Number(e.target.value))} /></div>
                      <div><Label>σ(VBM)</Label><Input type="number" step="any" min={0} value={bandParams.sigma_vbm_a} onChange={e => bp('sigma_vbm_a', Number(e.target.value))} /></div>
                      <div><Label>σ(CBM)</Label><Input type="number" step="any" min={0} value={bandParams.sigma_cbm_a} onChange={e => bp('sigma_cbm_a', Number(e.target.value))} /></div>
                    </div>
                    <p className="text-xs font-semibold text-[var(--text-soft)]">材料 B</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label>VBM (eV)</Label><Input type="number" step="any" value={bandParams.vbm_b} onChange={e => bp('vbm_b', Number(e.target.value))} /></div>
                      <div><Label>CBM (eV)</Label><Input type="number" step="any" value={bandParams.cbm_b} onChange={e => bp('cbm_b', Number(e.target.value))} /></div>
                      <div><Label>σ(VBM)</Label><Input type="number" step="any" min={0} value={bandParams.sigma_vbm_b} onChange={e => bp('sigma_vbm_b', Number(e.target.value))} /></div>
                      <div><Label>σ(CBM)</Label><Input type="number" step="any" min={0} value={bandParams.sigma_cbm_b} onChange={e => bp('sigma_cbm_b', Number(e.target.value))} /></div>
                    </div>
                  </div>
                )}
              </SidebarCard>

              {/* Run */}
              <button
                type="button"
                onClick={handleProcess}
                disabled={!hasSamples || processing}
                className="pressable mb-4 w-full rounded-xl bg-[var(--accent-strong)] py-2.5 text-sm font-bold text-[var(--bg-canvas)] disabled:opacity-40"
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
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-6">

          {/* header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[var(--text-main)]">XES</h1>
            <p className="text-sm text-[var(--text-soft)]">X-ray Emission Spectroscopy — 1D 光譜模式</p>
          </div>

          {/* status pills */}
          {hasSamples && (
            <div className="mb-5 flex flex-wrap gap-2">
              <span className="rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">
                {samples.length} 個 sample
              </span>
              {bg1 && <span className="rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">BG1: {bg1.name}</span>}
              {bg2 && <span className="rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">BG2: {bg2.name}</span>}
              {hasProcessed && <span className="rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-xs text-green-400">已處理</span>}
              {useEv && <span className="rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">X 軸校正 ON</span>}
            </div>
          )}

          {processError && (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{processError}</div>
          )}

          {!hasSamples ? (
            <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-bg)]">
              <div className="text-center text-[var(--text-soft)]">
                <div className="mb-2 text-3xl opacity-30">⚗</div>
                <p className="text-sm">在左側上傳 XES 1D 光譜檔案，然後點擊「解析檔案」。</p>
                <p className="mt-1 text-xs opacity-60">支援 CSV / DAT / TXT，兩欄格式（X, intensity）</p>
              </div>
            </div>
          ) : !hasProcessed ? (
            <div className="flex min-h-[32vh] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-bg)]">
              <div className="text-center text-[var(--text-soft)]">
                <p className="text-sm">已載入 {samples.length} 個 sample，調整左側參數後點擊「執行處理」。</p>
              </div>
            </div>
          ) : (
            <>
              {/* Main spectra chart */}
              <div className="mb-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow)]">
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
                      x: bg1.x, y: bg1.y,
                      type: 'scatter' as const, mode: 'lines' as const, name: 'BG1',
                      line: { color: '#19D3F3', width: 1.2, dash: 'dash' as const }, opacity: 0.6,
                    }] : []),
                    ...(bg2 && params.bg_method !== 'none' ? [{
                      x: bg2.x, y: bg2.y,
                      type: 'scatter' as const, mode: 'lines' as const, name: 'BG2',
                      line: { color: '#FFA15A', width: 1.2, dash: 'dash' as const }, opacity: 0.6,
                    }] : []),
                    // reference peak markers
                    ...refPeaks.map(rp => ({
                      x: [rp.energy_eV, rp.energy_eV],
                      y: [0, 1],
                      type: 'scatter' as const, mode: 'lines' as const,
                      name: `${rp.material} ${rp.label}`,
                      line: { color: '#a78bfa', width: 1, dash: 'dot' as const },
                      yaxis: 'y' as const,
                      showlegend: false,
                      hovertemplate: `${rp.material}: ${rp.label}<br>${rp.energy_eV} eV<extra></extra>`,
                    })),
                    // detected peaks
                    ...(detectedPeaks.length > 0 ? [{
                      x: detectedPeaks.map(pk => pk.x),
                      y: detectedPeaks.map(pk => pk.intensity),
                      type: 'scatter' as const, mode: 'markers' as const, name: '偵測峰',
                      marker: { color: '#f59e0b', size: 9, symbol: 'triangle-down' },
                    }] : []),
                  ]}
                  layout={{
                    ...chartLayout('處理後光譜', xLabel),
                    yaxis: {
                      ...(chartLayout('', '').yaxis),
                      ...(refPeaks.length > 0 ? {} : {}),
                    },
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                />
              </div>

              {/* BG subtraction comparison chart */}
              {params.bg_method !== 'none' && (
                <div className="mb-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow)]">
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
                        name: `${ds.name} (BG)`,
                        line: { color: COLORS[i % COLORS.length], width: 1, dash: 'dash' as const },
                        opacity: 0.5,
                      }] : []),
                      {
                        x: getX(ds), y: ds.y_corrected,
                        type: 'scatter' as const, mode: 'lines' as const,
                        name: `${ds.name} (扣 BG 後)`,
                        line: { color: COLORS[i % COLORS.length], width: 1.8 },
                      },
                    ])}
                    layout={chartLayout('BG1/BG2 扣除比較', xLabel)}
                    config={{ responsive: true, displayModeBar: false }}
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              {/* Detected peaks table */}
              {detectedPeaks.length > 0 && (
                <div className="mb-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow)]">
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text-main)]">偵測峰</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--card-border)] text-[var(--text-soft)]">
                          <th className="py-2 pr-4 text-left">#</th>
                          <th className="py-2 pr-4 text-left">{xLabel}</th>
                          <th className="py-2 pr-4 text-left">強度</th>
                          <th className="py-2 pr-4 text-left">相對強度 (%)</th>
                          <th className="py-2 text-left">FWHM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detectedPeaks.map((pk, i) => (
                          <tr key={i} className="border-b border-[var(--card-border)]/50">
                            <td className="py-1.5 pr-4">{i + 1}</td>
                            <td className="py-1.5 pr-4">{pk.x.toFixed(3)}</td>
                            <td className="py-1.5 pr-4">{pk.intensity.toFixed(2)}</td>
                            <td className="py-1.5 pr-4">{pk.rel_intensity.toFixed(1)}</td>
                            <td className="py-1.5">{pk.fwhm != null ? pk.fwhm.toFixed(3) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Reference peaks table */}
              {refPeaks.length > 0 && (
                <div className="mb-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow)]">
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text-main)]">參考峰</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--card-border)] text-[var(--text-soft)]">
                          <th className="py-2 pr-4 text-left">材料</th>
                          <th className="py-2 pr-4 text-left">標籤</th>
                          <th className="py-2 pr-4 text-left">Energy (eV)</th>
                          <th className="py-2 pr-4 text-left">容差 (eV)</th>
                          <th className="py-2 text-left">相對強度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {refPeaks.map((rp, i) => (
                          <tr key={i} className="border-b border-[var(--card-border)]/50">
                            <td className="py-1.5 pr-4 font-medium text-[var(--text-main)]">{rp.material}</td>
                            <td className="py-1.5 pr-4">{rp.label}</td>
                            <td className="py-1.5 pr-4">{rp.energy_eV.toFixed(1)}</td>
                            <td className="py-1.5 pr-4">±{rp.tolerance_eV}</td>
                            <td className="py-1.5">{rp.relative_intensity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Band alignment result */}
              {bandParams.enabled && bandResult && (
                <div className="mb-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow)]">
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text-main)]">能帶對齊結果</h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: `Eg (${bandParams.mat_a})`, val: bandResult.eg_a, sig: bandResult.sigma_eg_a },
                      { label: `Eg (${bandParams.mat_b})`, val: bandResult.eg_b, sig: bandResult.sigma_eg_b },
                      { label: 'ΔEV', val: bandResult.delta_ev, sig: bandResult.sigma_delta_ev },
                      { label: 'ΔEC', val: bandResult.delta_ec, sig: bandResult.sigma_delta_ec },
                    ].map(item => (
                      <div key={item.label} className="rounded-xl border border-[var(--card-border)] bg-[var(--panel-bg)] px-4 py-3">
                        <div className="text-xs text-[var(--text-soft)]">{item.label}</div>
                        <div className="mt-1 text-lg font-bold text-[var(--text-main)]">{item.val.toFixed(3)} eV</div>
                        <div className="text-[10px] text-[var(--text-soft)]">±{item.sig.toFixed(3)} eV</div>
                      </div>
                    ))}
                  </div>
                  <table className="mt-4 w-full text-xs">
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
              )}

              {/* Export */}
              <div className="mb-8 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow)]">
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
                  {detectedPeaks.length > 0 && (
                    <button
                      type="button"
                      className="pressable rounded-xl border border-[var(--card-border)] bg-[var(--panel-bg)] px-4 py-2 text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-strong)]"
                      onClick={() => {
                        const rows = detectedPeaks.map((pk, i) => ({
                          Peak: i + 1,
                          [xLabel]: pk.x,
                          Intensity: pk.intensity,
                          'Rel_Intensity_%': pk.rel_intensity,
                          FWHM: pk.fwhm ?? '',
                        }))
                        downloadFile('xes_peaks.csv', toCsv(rows))
                      }}
                    >
                      峰值表 CSV
                    </button>
                  )}
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
