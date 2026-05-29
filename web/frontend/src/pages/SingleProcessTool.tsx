import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Plot from '../components/PlotlyChart'
import { withPlotFullscreen } from '../components/plotConfig'
import { WorkspaceMenuButton } from '../components/WorkspaceUi'
import type { PlotPopupRequest } from '../hooks/usePlotPopups'
import { parseFiles, processData } from '../api/xrd'
import FileUpload from '../components/FileUpload'
import type { ParsedFile, ProcessParams, ProcessedDataset } from '../types/xrd'
import { DEFAULT_PARAMS } from '../components/ProcessingPanel'

export type SingleToolKind = 'background' | 'normalize' | 'gaussian' | 'arctan'

type BackgroundMethod = 'linear' | 'shirley' | 'polynomial' | 'asls' | 'airpls'
type NormalizeMethod = 'min_max' | 'max' | 'area'
type RangeMinimum = { x: number; y: number; index: number }

const TOOL_META: Record<SingleToolKind, { title: string; subtitle: string; description: string; accent: string }> = {
  background: {
    title: '背景扣除',
    subtitle: 'Background Subtraction',
    description: '針對單一批資料只做 baseline / background 處理，不進入完整 XRD workflow。',
    accent: 'var(--accent-secondary)',
  },
  normalize: {
    title: '歸一化',
    subtitle: 'Normalization',
    description: '只做強度尺度整理，適合快速把不同量測條件下的曲線拉到可比較狀態。',
    accent: 'var(--accent-strong)',
  },
  gaussian: {
    title: '高斯模板扣除',
    subtitle: 'Gaussian Template Subtraction',
    description: '固定 FWHM 與高度，手動定位中心；或用「切到最低點」自動對齊。',
    accent: 'var(--accent-tertiary)',
  },
  arctan: {
    title: 'Arctan 扣除',
    subtitle: 'Arctan Subtraction',
    description: '用三個主參數建立階梯型 Arctan 模型，適合扣除 step-like 或緩慢轉折訊號。',
    accent: '#f59e0b',
  },
}

function buildArctanModel(x: number[], center: number, width: number, height: number): number[] {
  const safeWidth = Math.max(Math.abs(width), 0.001)
  return x.map(xv => height * (Math.atan((xv - center) / safeWidth) / Math.PI + 0.5))
}

function findMinimumInRange(x: number[], y: number[], start: number, end: number): RangeMinimum | null {
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  let best: RangeMinimum | null = null
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue
    if (x[i] < lo || x[i] > hi) continue
    if (!best || y[i] < best.y) best = { x: x[i], y: y[i], index: i }
  }
  return best
}

function extractGaussianParams(x: number[], y: number[]): { center: number; fwhm: number; height: number } {
  const maxIdx = y.reduce((best, v, i) => v > y[best] ? i : best, 0)
  const height = y[maxIdx]
  const center = x[maxIdx]
  if (height <= 0 || x.length < 3) return { center, fwhm: 1, height }
  const halfMax = height / 2
  let leftX = x[0]
  for (let i = maxIdx; i >= 1; i--) {
    if (y[i - 1] <= halfMax) {
      const t = (halfMax - y[i]) / (y[i - 1] - y[i])
      leftX = x[i] + t * (x[i - 1] - x[i])
      break
    }
  }
  let rightX = x[x.length - 1]
  for (let i = maxIdx; i < x.length - 1; i++) {
    if (y[i + 1] <= halfMax) {
      const t = (halfMax - y[i]) / (y[i + 1] - y[i])
      rightX = x[i] + t * (x[i + 1] - x[i])
      break
    }
  }
  return { center, fwhm: Math.max(rightX - leftX, 0.001), height }
}

function interpolateY(xNew: number[], xSrc: number[], ySrc: number[]): number[] {
  return xNew.map(x => {
    if (x <= xSrc[0]) return ySrc[0]
    if (x >= xSrc[xSrc.length - 1]) return ySrc[ySrc.length - 1]
    let lo = 0, hi = xSrc.length - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xSrc[mid] <= x) lo = mid; else hi = mid }
    const t = (x - xSrc[lo]) / (xSrc[hi] - xSrc[lo])
    return ySrc[lo] + t * (ySrc[hi] - ySrc[lo])
  })
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function buildSingleToolCsv(
  dataset: ProcessedDataset,
  rangeStart: number,
  rangeEnd: number,
  minimum: RangeMinimum | null,
  modelOverride?: number[] | null,
  subtractedOverride?: number[] | null,
): string {
  const header = ['x', 'raw', 'background', 'template_model', 'template_subtracted', 'processed']
  const templateModel = modelOverride ?? dataset.y_gaussian_model
  const templateSubtracted = subtractedOverride ?? dataset.y_gaussian_subtracted
  const processedCol = subtractedOverride ? templateSubtracted : dataset.y_processed
  const rows = dataset.x.map((xv, i) => [
    xv.toFixed(6),
    dataset.y_raw[i]?.toFixed(6) ?? '',
    dataset.y_background?.[i]?.toFixed(6) ?? '',
    templateModel?.[i]?.toFixed(6) ?? '',
    templateSubtracted?.[i]?.toFixed(6) ?? '',
    processedCol?.[i]?.toFixed(6) ?? '',
  ])
  const summary = minimum
    ? ['', '', '', '', '', '', '', `minimum_range_${rangeStart.toFixed(3)}_${rangeEnd.toFixed(3)}`, minimum.x.toFixed(6), minimum.y.toFixed(6)]
    : ['', '', '', '', '', '', '', `minimum_range_${rangeStart.toFixed(3)}_${rangeEnd.toFixed(3)}`, 'not_found', '']
  return [
    header.join(','),
    ...rows.map(r => r.join(',')),
    '',
    ['summary', '', '', '', '', '', '', 'label', 'minimum_x', 'minimum_y'].join(','),
    summary.join(','),
  ].join('\n')
}

// search_half_width is always 0 (exact center, no backend drift)
function buildParams(
  tool: SingleToolKind,
  backgroundMethod: BackgroundMethod,
  bgRangeStart: number | null,
  bgRangeEnd: number | null,
  bgPolyDeg: number,
  bgLambdaExp: number,
  bgP: number,
  bgIter: number,
  normalizeMethod: NormalizeMethod,
  normStart: number | null,
  normEnd: number | null,
  gaussianFwhm: number,
  gaussianHeight: number,
  gaussianNonnegativeGuard: boolean,
  gaussianCenter: number,
): ProcessParams {
  const isTemplateTool = tool === 'gaussian' || tool === 'arctan'
  return {
    ...DEFAULT_PARAMS,
    interpolate: isTemplateTool,
    n_points: isTemplateTool ? 1200 : 1000,
    average: false,
    bg_enabled: tool === 'background',
    bg_method: tool === 'background' ? backgroundMethod : 'none',
    bg_x_start: tool === 'background' ? bgRangeStart : null,
    bg_x_end: tool === 'background' ? bgRangeEnd : null,
    bg_poly_deg: bgPolyDeg,
    bg_baseline_lambda: 10 ** bgLambdaExp,
    bg_baseline_p: bgP,
    bg_baseline_iter: bgIter,
    gaussian_enabled: tool === 'gaussian',
    gaussian_fwhm: gaussianFwhm,
    gaussian_height: gaussianHeight,
    gaussian_nonnegative_guard: tool === 'gaussian' ? gaussianNonnegativeGuard : false,
    gaussian_search_half_width: 0,  // exact center, no backend search drift
    gaussian_centers: tool === 'gaussian' ? [{ enabled: true, name: 'Peak 1', center: gaussianCenter }] : [],
    smooth_method: 'none',
    norm_method: tool === 'normalize' ? normalizeMethod : 'none',
    norm_x_start: tool === 'normalize' ? normStart : null,
    norm_x_end: tool === 'normalize' ? normEnd : null,
  }
}

function chartLayout(): Partial<Plotly.Layout> {
  const cv = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const grid = cv?.getPropertyValue('--chart-grid').trim() || 'rgba(148,163,184,0.14)'
  const text = cv?.getPropertyValue('--chart-text').trim() || '#d9e4f0'
  const bg = cv?.getPropertyValue('--chart-bg').trim() || 'rgba(15,23,42,0.52)'
  const legendBg = cv?.getPropertyValue('--chart-legend-bg').trim() || 'rgba(15,23,42,0.72)'
  const hoverBg = cv?.getPropertyValue('--chart-hover-bg').trim() || 'rgba(15,23,42,0.95)'
  const hoverBorder = cv?.getPropertyValue('--chart-hover-border').trim() || 'rgba(148,163,184,0.22)'
  return {
    xaxis: { title: { text: 'X' }, showgrid: true, gridcolor: grid, zeroline: false, color: text },
    yaxis: { title: { text: 'Intensity' }, showgrid: true, gridcolor: grid, zeroline: false, color: text },
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

function buildOriginProLayout(): Partial<Plotly.Layout> {
  return {
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    font: { color: '#000000', family: 'Arial, sans-serif', size: 11 },
    xaxis: { title: { text: 'X' }, showgrid: false, zeroline: false, linecolor: '#000000', linewidth: 1.5, mirror: true, ticks: 'inside', tickcolor: '#000000', color: '#000000' },
    yaxis: { title: { text: 'Intensity' }, showgrid: false, zeroline: false, linecolor: '#000000', linewidth: 1.5, mirror: true, ticks: 'inside', tickcolor: '#000000', color: '#000000' },
    legend: { x: 0.98, xanchor: 'right', y: 0.98, yanchor: 'top', bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#888888', borderwidth: 1, font: { color: '#000000', size: 11 } },
    margin: { l: 70, r: 30, t: 30, b: 60 },
    autosize: true,
  }
}

// Slider: range commits on mouseUp/touchEnd; number input commits on blur/Enter
function SliderRow({
  label, value, min, max, step, decimals = 3, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; decimals?: number
  onChange: (v: number) => void
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  const commit = (raw: number) => {
    const clamped = Math.min(Math.max(Number.isFinite(raw) ? raw : value, min), max)
    setLocal(clamped)
    onChange(clamped)
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-soft)]">{label}</span>
        <span className="font-mono text-xs text-[var(--text-main)]">{local.toFixed(decimals)}</span>
      </div>
      <input type="number" value={local} min={min} max={max} step={step}
        onChange={e => setLocal(Number(e.target.value))}
        onBlur={e => commit(Number(e.target.value))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(Number((e.target as HTMLInputElement).value)) } }}
        className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
      <input type="range" value={local} min={min} max={max} step={step}
        onChange={e => setLocal(Number(e.target.value))}
        onMouseUp={e => commit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={e => commit(Number((e.target as HTMLInputElement).value))}
        className="w-full cursor-pointer" style={{ accentColor: 'var(--accent-strong)' }} />
    </div>
  )
}

export default function SingleProcessTool({
  tool,
  onOpenPlotPopup,
  currentWorkspace,
  onSelectWorkspace,
}: {
  tool: SingleToolKind
  onOpenPlotPopup?: (popup: PlotPopupRequest) => void
  currentWorkspace?: string
  onSelectWorkspace?: (id: string) => void
}) {
  const meta = TOOL_META[tool]

  // ── Core state ──────────────────────────────────────────────────────────────
  const [rawFiles, setRawFiles] = useState<ParsedFile[]>([])
  const [result, setResult] = useState<ProcessedDataset[]>([])
  const [selectedDatasetName, setSelectedDatasetName] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templateApplyVersion, setTemplateApplyVersion] = useState(0)
  const [snapToMinimumEnabled, setSnapToMinimumEnabled] = useState(false)
  const [snapPhase, setSnapPhase] = useState<'idle' | 'minimum_found' | 'gaussian_generated'>('idle')
  const [confirmedSnapRange, setConfirmedSnapRange] = useState<{ start: number; end: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const [exportPreviewKind, setExportPreviewKind] = useState<'chart1' | 'chart2' | null>(null)

  // ── Background state ─────────────────────────────────────────────────────────
  const [backgroundMethod, setBackgroundMethod] = useState<BackgroundMethod>('linear')
  const [bgRangeStart, setBgRangeStart] = useState<number | null>(null)
  const [bgRangeEnd, setBgRangeEnd] = useState<number | null>(null)
  const [bgPolyDeg, setBgPolyDeg] = useState(3)
  const [bgLambdaExp, setBgLambdaExp] = useState(5)
  const [bgP, setBgP] = useState(0.01)
  const [bgIter, setBgIter] = useState(20)

  // ── Normalize state ──────────────────────────────────────────────────────────
  const [normalizeMethod, setNormalizeMethod] = useState<NormalizeMethod>('min_max')
  const [normStart, setNormStart] = useState<number | null>(null)
  const [normEnd, setNormEnd] = useState<number | null>(null)

  // ── Gaussian state ───────────────────────────────────────────────────────────
  const [gaussianFwhm, setGaussianFwhm] = useState(0.2)
  const [gaussianHeight, setGaussianHeight] = useState(1)
  const [gaussianNonnegativeGuard, setGaussianNonnegativeGuard] = useState(true)
  const [minimumRangeStart, setMinimumRangeStart] = useState(403)
  const [minimumRangeEnd, setMinimumRangeEnd] = useState(406)
  const [gaussianCenter, setGaussianCenter] = useState(30)
  const [importedGaussianCurve, setImportedGaussianCurve] = useState<{ x: number[]; y: number[]; name: string } | null>(null)
  const [arctanCenter, setArctanCenter] = useState(30)
  const [arctanWidth, setArctanWidth] = useState(1)
  const [arctanHeight, setArctanHeight] = useState(1)

  // ── Reset on tool change ─────────────────────────────────────────────────────
  useEffect(() => {
    setRawFiles([])
    setResult([])
    setSelectedDatasetName('')
    setError(null)
    setTemplateApplyVersion(0)
    setBackgroundMethod('linear')
    setBgRangeStart(null)
    setBgRangeEnd(null)
    setBgPolyDeg(3)
    setBgLambdaExp(5)
    setBgP(0.01)
    setBgIter(20)
    setNormalizeMethod('min_max')
    setNormStart(null)
    setNormEnd(null)
    setGaussianFwhm(0.2)
    setGaussianHeight(1)
    setGaussianNonnegativeGuard(true)
    setMinimumRangeStart(403)
    setMinimumRangeEnd(406)
    setGaussianCenter(30)
    setImportedGaussianCurve(null)
    setArctanCenter(30)
    setArctanWidth(1)
    setArctanHeight(1)
    setSnapToMinimumEnabled(false)
    setSnapPhase('idle')
    setConfirmedSnapRange(null)
    setIsDragging(false)
    setExportPreviewKind(null)
  }, [tool])

  // Reset snap phase when snap mode is toggled off
  useEffect(() => {
    if (!snapToMinimumEnabled) { setSnapPhase('idle'); setConfirmedSnapRange(null) }
  }, [snapToMinimumEnabled])

  useEffect(() => {
    if (result.length === 0) { setSelectedDatasetName(''); return }
    if (!result.some(d => d.name === selectedDatasetName)) setSelectedDatasetName(result[0].name)
  }, [result, selectedDatasetName])

  const activeDataset: ProcessedDataset | null =
    result.find(d => d.name === selectedDatasetName) ?? result[0] ?? null

  const isGaussianTool = tool === 'gaussian'
  const isArctanTool = tool === 'arctan'
  const isTemplateTool = isGaussianTool || isArctanTool

  // ── Gaussian derived state ───────────────────────────────────────────────────

  // Minimum in the confirmed search range — only when snap is enabled and range confirmed
  const anchorMinimum = useMemo(
    () => tool === 'gaussian' && activeDataset && snapToMinimumEnabled && confirmedSnapRange
      ? findMinimumInRange(activeDataset.x, activeDataset.y_raw, confirmedSnapRange.start, confirmedSnapRange.end)
      : null,
    [tool, activeDataset, snapToMinimumEnabled, confirmedSnapRange],
  )

  // Gaussian area: height × FWHM × sqrt(π / 4ln2) ≈ height × FWHM × 1.0645
  const gaussianArea = useMemo(
    () => gaussianHeight * gaussianFwhm * 1.0645,
    [gaussianHeight, gaussianFwhm],
  )

  // Client-side Gaussian model: use imported curve if available, otherwise compute from params
  const clientGaussianModel = useMemo((): number[] | null => {
    if (!isGaussianTool || !activeDataset) return null
    // Imported gaussian curve takes priority
    if (importedGaussianCurve) {
      return interpolateY(activeDataset.x, importedGaussianCurve.x, importedGaussianCurve.y)
    }
    if (gaussianFwhm <= 0) return null
    const sigma = gaussianFwhm / (2 * Math.sqrt(2 * Math.log(2)))
    const model = new Array(activeDataset.x.length).fill(0) as number[]
    if (Number.isFinite(gaussianCenter)) {
      for (let i = 0; i < activeDataset.x.length; i++) {
        model[i] = gaussianHeight * Math.exp(-0.5 * ((activeDataset.x[i] - gaussianCenter) / sigma) ** 2)
      }
    }
    return model
  }, [isGaussianTool, activeDataset, importedGaussianCurve, gaussianFwhm, gaussianCenter, gaussianHeight])

  const clientArctanModel = useMemo((): number[] | null => {
    if (!isArctanTool || !activeDataset) return null
    return buildArctanModel(activeDataset.x, arctanCenter, arctanWidth, arctanHeight)
  }, [isArctanTool, activeDataset, arctanCenter, arctanWidth, arctanHeight])

  const currentTemplateModel = isGaussianTool ? clientGaussianModel : isArctanTool ? clientArctanModel : null
  const templateLabel = isGaussianTool ? '高斯' : isArctanTool ? 'Arctan' : '模板'
  const templateCenter = isGaussianTool ? gaussianCenter : arctanCenter
  const templateWidth = isGaussianTool ? gaussianFwhm : arctanWidth
  const templateHeight = isGaussianTool ? gaussianHeight : arctanHeight
  const templateWidthLabel = isGaussianTool ? '半高寬 FWHM' : '轉折寬度'

  // Client-side subtraction — always instant, exact when center is manually placed
  const clientAfterY = useMemo((): number[] | null => {
    if (!activeDataset || !currentTemplateModel) return null
    return activeDataset.y_raw.map((v, i) => {
      const sub = v - (currentTemplateModel[i] ?? 0)
      return gaussianNonnegativeGuard ? Math.max(0, sub) : sub
    })
  }, [activeDataset, currentTemplateModel, gaussianNonnegativeGuard])

  // Residual at the minimum (from client-side after)
  const minimumResidual = useMemo(() => {
    if (!anchorMinimum || !clientAfterY) return null
    const v = clientAfterY[anchorMinimum.index]
    return v != null && Number.isFinite(v) ? v : null
  }, [anchorMinimum, clientAfterY])

  // Origin Pro–style preview traces for export modal
  const previewChart1Traces = useMemo((): Plotly.Data[] => {
    if (!activeDataset) return []
    const traces: Plotly.Data[] = [{
      x: activeDataset.x, y: activeDataset.y_raw,
      type: 'scatter', mode: 'lines', name: 'Raw',
      line: { color: '#000000', width: 1.5 },
    }]
    if (isTemplateTool && currentTemplateModel) {
      traces.push({
        x: activeDataset.x,
        y: currentTemplateModel,
        type: 'scatter',
        mode: 'lines',
        name: isGaussianTool ? 'Gaussian model' : 'Arctan model',
        line: { color: '#cc0000', width: 1.5, dash: 'dash' },
      })
    } else if (tool === 'background' && activeDataset.y_background) {
      traces.push({ x: activeDataset.x, y: activeDataset.y_background, type: 'scatter', mode: 'lines', name: 'Background', line: { color: '#cc0000', width: 1.5, dash: 'dash' } })
    }
    return traces
  }, [activeDataset, tool, isTemplateTool, isGaussianTool, currentTemplateModel])

  const previewChart2Traces = useMemo((): Plotly.Data[] => {
    if (!activeDataset) return []
    if (isTemplateTool && clientAfterY) {
      return [{ x: activeDataset.x, y: clientAfterY, type: 'scatter', mode: 'lines', name: `${templateLabel} subtracted`, line: { color: '#000000', width: 1.5 } }]
    }
    if (tool === 'background' && activeDataset.y_processed) {
      return [{ x: activeDataset.x, y: activeDataset.y_processed, type: 'scatter', mode: 'lines', name: 'Background subtracted', line: { color: '#000000', width: 1.5 } }]
    }
    return []
  }, [activeDataset, tool, isTemplateTool, clientAfterY, templateLabel])

  // ── Snap-to-minimum handlers ─────────────────────────────────────────────────

  const handleConfirmSnapRange = useCallback(() => {
    setConfirmedSnapRange({ start: minimumRangeStart, end: minimumRangeEnd })
    setSnapPhase('minimum_found')
  }, [minimumRangeStart, minimumRangeEnd])

  const handleGenerateSnapGaussian = useCallback(() => {
    if (!anchorMinimum) return
    setGaussianCenter(anchorMinimum.x)
    setGaussianHeight(anchorMinimum.y)
    const xMin = rawFiles.length > 0 ? Math.min(...rawFiles.flatMap(f => f.x)) : 0
    const xMax = rawFiles.length > 0 ? Math.max(...rawFiles.flatMap(f => f.x)) : 180
    setGaussianFwhm(Math.max(xMax - xMin, 1) * 0.05)
    setImportedGaussianCurve(null)
    setSnapPhase('gaussian_generated')
  }, [anchorMinimum, rawFiles])

  // ── Backend params ───────────────────────────────────────────────────────────
  const params = buildParams(
    tool,
    backgroundMethod, bgRangeStart, bgRangeEnd, bgPolyDeg, bgLambdaExp, bgP, bgIter,
    normalizeMethod, normStart, normEnd,
    gaussianFwhm,
    gaussianHeight,
    gaussianNonnegativeGuard,
    gaussianCenter,
  )

  // Debounced params for background/normalize auto-process
  const [debouncedParams, setDebouncedParams] = useState(params)
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedParams(params), 300)
    return () => window.clearTimeout(t)
  }, [params])

  // Auto-process: background/normalize only
  useEffect(() => {
    if (isTemplateTool) return
    if (rawFiles.length === 0) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    processData(rawFiles, debouncedParams)
      .then(r => { if (!cancelled) setResult(r.datasets) })
      .catch(e => { if (!cancelled) setError(String((e as Error).message)) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [isTemplateTool, rawFiles, debouncedParams])

  // Gaussian: initial backend call to get interpolated x/y_raw (manual apply via button)
  const templateParamsRef = useRef(params)
  templateParamsRef.current = params

  useEffect(() => {
    if (!isTemplateTool || rawFiles.length === 0 || templateApplyVersion === 0) return
    const currentParams = templateParamsRef.current
    let cancelled = false
    setIsLoading(true)
    setError(null)
    processData(rawFiles, currentParams)
      .then(r => { if (!cancelled) setResult(r.datasets) })
      .catch(e => { if (!cancelled) setError(String((e as Error).message)) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [isTemplateTool, rawFiles, templateApplyVersion])

  // ── File upload ──────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: File[]) => {
    setIsLoading(true)
    setError(null)
    try {
      const parsed = await parseFiles(files)
      setRawFiles(parsed)
      const sample = parsed[0]
      if (sample) {
        const xMin = Math.min(...sample.x)
        const xMax = Math.max(...sample.x)
        const yMax = Math.max(...sample.y)
        setBgRangeStart(xMin)
        setBgRangeEnd(xMax)
        setNormStart(xMin)
        setNormEnd(xMax)
        setGaussianHeight(Math.max(yMax * 0.08, 0.01))
        setGaussianCenter((xMin + xMax) / 2)
        setArctanCenter((xMin + xMax) / 2)
        setArctanWidth(Math.max((xMax - xMin) * 0.05, 0.01))
        setArctanHeight(Math.max(yMax * 0.08, 0.01))
        if (isTemplateTool) {
          setTemplateApplyVersion(v => v + 1)
        }
      }
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [isTemplateTool])

  // ── Slider bounds ────────────────────────────────────────────────────────────
  const gSliderXMin = rawFiles.length > 0 ? Math.min(...rawFiles.flatMap(f => f.x)) : 0
  const gSliderXMax = rawFiles.length > 0 ? Math.max(...rawFiles.flatMap(f => f.x)) : 180
  const gSliderXRange = Math.max(gSliderXMax - gSliderXMin, 1)
  const gSliderYMax = rawFiles.length > 0 ? Math.max(...rawFiles.flatMap(f => f.y)) : 10000
  const fwhmSliderMax = Math.max(gSliderXRange / 4, 2)
  const heightSliderMax = Math.max(gSliderYMax * 1.5, 1)

  // ── Chart traces ─────────────────────────────────────────────────────────────

  const beforeTraces = useMemo((): Plotly.Data[] => {
    if (!activeDataset) return []
    const traces: Plotly.Data[] = [{
      x: activeDataset.x, y: activeDataset.y_raw,
      type: 'scatter', mode: 'lines', name: '原始',
      line: { color: '#94a3b8', width: 1.7 },
    }]
    if (isTemplateTool && currentTemplateModel) {
      traces.push({
        x: activeDataset.x, y: currentTemplateModel,
        type: 'scatter', mode: 'lines',
        name: isGaussianTool
          ? (importedGaussianCurve ? '高斯模型（匯入）' : '高斯模型（即時）')
          : 'Arctan 模型（即時）',
        line: { color: '#f97316', width: 2.4, dash: 'dash' },
      })
    }
    if (tool === 'background' && activeDataset.y_background) {
      traces.push({
        x: activeDataset.x, y: activeDataset.y_background,
        type: 'scatter', mode: 'lines', name: '背景基準線',
        line: { color: '#f97316', width: 1.6, dash: 'dot' },
      })
    }
    if (tool === 'normalize') {
      traces.push({
        x: activeDataset.x, y: activeDataset.y_processed,
        type: 'scatter', mode: 'lines', name: '歸一化後',
        line: { color: '#38bdf8', width: 2.2 },
      })
    }
    if (tool === 'gaussian' && anchorMinimum && snapPhase === 'minimum_found') {
      traces.push({
        x: [anchorMinimum.x], y: [anchorMinimum.y],
        type: 'scatter', mode: 'markers',
        name: `最低點 (${anchorMinimum.x.toFixed(3)}, ${anchorMinimum.y.toFixed(3)})`,
        marker: { color: '#fb7185', size: 11, line: { color: '#fff1f2', width: 1.5 } },
      })
    }
    return traces
  }, [activeDataset, tool, isTemplateTool, isGaussianTool, currentTemplateModel, importedGaussianCurve, anchorMinimum])

  // After chart always uses client-side subtraction (instant, exact)
  const afterTraces = useMemo((): Plotly.Data[] => {
    if (!activeDataset) return []
    if (isTemplateTool && clientAfterY) {
      return [{
        x: activeDataset.x, y: clientAfterY,
        type: 'scatter', mode: 'lines', name: `${templateLabel} 扣除後（即時）`,
        line: { color: '#38bdf8', width: 2.2 },
      }]
    }
    if (tool === 'background' && activeDataset.y_processed) {
      return [{
        x: activeDataset.x, y: activeDataset.y_processed,
        type: 'scatter', mode: 'lines', name: '扣背景後',
        line: { color: '#38bdf8', width: 2.2 },
      }]
    }
    return []
  }, [activeDataset, tool, isTemplateTool, clientAfterY, templateLabel])

  const beforeLayout = useMemo(() => {
    const base = chartLayout()
    base.dragmode = 'zoom'
    base.uirevision = `${tool}:${selectedDatasetName}:before`
    const shapes: Plotly.Shape[] = []
    if (tool === 'gaussian' && snapToMinimumEnabled && snapPhase === 'minimum_found' && confirmedSnapRange) {
      shapes.push({
        type: 'rect', xref: 'x', yref: 'paper',
        x0: Math.min(confirmedSnapRange.start, confirmedSnapRange.end),
        x1: Math.max(confirmedSnapRange.start, confirmedSnapRange.end),
        y0: 0, y1: 1,
        fillcolor: 'rgba(251,113,133,0.08)',
        line: { color: 'rgba(251,113,133,0.32)', width: 1, dash: 'dot' },
      } as Plotly.Shape)
    }
    // Only show parameter indicator lines in manual mode (no imported curve, snap not active)
    if (isGaussianTool && !importedGaussianCurve && !snapToMinimumEnabled && Number.isFinite(gaussianCenter)) {
      // Center vertical line (solid orange)
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: gaussianCenter, x1: gaussianCenter, y0: 0, y1: 1, line: { color: '#f97316', width: 1.5 } } as Plotly.Shape)
      // FWHM left boundary (dashed orange)
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: gaussianCenter - gaussianFwhm / 2, x1: gaussianCenter - gaussianFwhm / 2, y0: 0, y1: 1, line: { color: '#f97316', width: 1, dash: 'dash' } } as Plotly.Shape)
      // FWHM right boundary (dashed orange)
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: gaussianCenter + gaussianFwhm / 2, x1: gaussianCenter + gaussianFwhm / 2, y0: 0, y1: 1, line: { color: '#f97316', width: 1, dash: 'dash' } } as Plotly.Shape)
      // Height horizontal line (dotted blue)
      shapes.push({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: gaussianHeight, y1: gaussianHeight, line: { color: '#38bdf8', width: 1, dash: 'dot' } } as Plotly.Shape)
      // FWHM bracket at y = height/2 (dotted orange)
      shapes.push({ type: 'line', xref: 'x', yref: 'y', x0: gaussianCenter - gaussianFwhm / 2, x1: gaussianCenter + gaussianFwhm / 2, y0: gaussianHeight / 2, y1: gaussianHeight / 2, line: { color: '#f97316', width: 1.5, dash: 'dot' } } as Plotly.Shape)
    }
    if (isArctanTool && Number.isFinite(arctanCenter)) {
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: arctanCenter, x1: arctanCenter, y0: 0, y1: 1, line: { color: '#f97316', width: 1.5 } } as Plotly.Shape)
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: arctanCenter - arctanWidth, x1: arctanCenter - arctanWidth, y0: 0, y1: 1, line: { color: '#f97316', width: 1, dash: 'dash' } } as Plotly.Shape)
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: arctanCenter + arctanWidth, x1: arctanCenter + arctanWidth, y0: 0, y1: 1, line: { color: '#f97316', width: 1, dash: 'dash' } } as Plotly.Shape)
      shapes.push({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: arctanHeight, y1: arctanHeight, line: { color: '#38bdf8', width: 1, dash: 'dot' } } as Plotly.Shape)
    }
    if (shapes.length > 0) base.shapes = shapes
    return base
  }, [tool, selectedDatasetName, isGaussianTool, isArctanTool, gaussianCenter, gaussianFwhm, gaussianHeight, snapToMinimumEnabled, snapPhase, confirmedSnapRange, importedGaussianCurve, arctanCenter, arctanWidth, arctanHeight])

  const afterLayout = useMemo(() => {
    const base = chartLayout()
    base.dragmode = 'zoom'
    base.uirevision = `${tool}:${selectedDatasetName}:after`
    return base
  }, [tool, selectedDatasetName])

  const handleExport = useCallback(() => {
    if (!activeDataset) return
    const csv = buildSingleToolCsv(
      activeDataset, minimumRangeStart, minimumRangeEnd, anchorMinimum,
      isTemplateTool ? currentTemplateModel : null,
      isTemplateTool ? clientAfterY : null,
    )
    downloadFile(csv, `${activeDataset.name.replace(/\.[^.]+$/, '')}_${tool}_processed.csv`, 'text/csv;charset=utf-8')
  }, [activeDataset, tool, minimumRangeStart, minimumRangeEnd, anchorMinimum, isTemplateTool, currentTemplateModel, clientAfterY])

  const handleExportChart1 = useCallback(() => {
    if (!activeDataset) return
    const stem = activeDataset.name.replace(/\.[^.]+$/, '')
    if (isGaussianTool && clientGaussianModel) {
      const header = 'x,raw,gaussian_model'
      const rows = activeDataset.x.map((xv, i) =>
        `${xv.toFixed(6)},${activeDataset.y_raw[i]?.toFixed(6) ?? ''},${clientGaussianModel[i]?.toFixed(6) ?? ''}`)
      downloadFile([header, ...rows].join('\n'), `${stem}_raw_gaussian_model.csv`, 'text/csv;charset=utf-8')
    } else if (isArctanTool && clientArctanModel) {
      const header = 'x,raw,arctan_model'
      const rows = activeDataset.x.map((xv, i) =>
        `${xv.toFixed(6)},${activeDataset.y_raw[i]?.toFixed(6) ?? ''},${clientArctanModel[i]?.toFixed(6) ?? ''}`)
      downloadFile([header, ...rows].join('\n'), `${stem}_raw_arctan_model.csv`, 'text/csv;charset=utf-8')
    } else if (tool === 'background' && activeDataset.y_background) {
      const header = 'x,raw,background'
      const rows = activeDataset.x.map((xv, i) =>
        `${xv.toFixed(6)},${activeDataset.y_raw[i]?.toFixed(6) ?? ''},${activeDataset.y_background![i]?.toFixed(6) ?? ''}`)
      downloadFile([header, ...rows].join('\n'), `${stem}_raw_background.csv`, 'text/csv;charset=utf-8')
    }
  }, [activeDataset, tool, isGaussianTool, isArctanTool, clientGaussianModel, clientArctanModel])

  const handleExportChart2 = useCallback(() => {
    if (!activeDataset) return
    const stem = activeDataset.name.replace(/\.[^.]+$/, '')
    if (isGaussianTool && clientAfterY) {
      const header = 'x,gaussian_subtracted'
      const rows = activeDataset.x.map((xv, i) =>
        `${xv.toFixed(6)},${clientAfterY[i]?.toFixed(6) ?? ''}`)
      downloadFile([header, ...rows].join('\n'), `${stem}_gaussian_subtracted.csv`, 'text/csv;charset=utf-8')
    } else if (isArctanTool && clientAfterY) {
      const header = 'x,arctan_subtracted'
      const rows = activeDataset.x.map((xv, i) =>
        `${xv.toFixed(6)},${clientAfterY[i]?.toFixed(6) ?? ''}`)
      downloadFile([header, ...rows].join('\n'), `${stem}_arctan_subtracted.csv`, 'text/csv;charset=utf-8')
    } else if (tool === 'background' && activeDataset.y_processed) {
      const header = 'x,background_subtracted'
      const rows = activeDataset.x.map((xv, i) =>
        `${xv.toFixed(6)},${activeDataset.y_processed[i]?.toFixed(6) ?? ''}`)
      downloadFile([header, ...rows].join('\n'), `${stem}_background_subtracted.csv`, 'text/csv;charset=utf-8')
    }
  }, [activeDataset, tool, isGaussianTool, isArctanTool, clientAfterY])

  const handleDownloadGaussianCsv = useCallback(() => {
    if (!activeDataset || !clientGaussianModel) return
    const stem = activeDataset.name.replace(/\.[^.]+$/, '')
    const header = 'x,gaussian_model'
    const rows = activeDataset.x.map((xv, i) =>
      `${xv.toFixed(6)},${clientGaussianModel[i]?.toFixed(6) ?? ''}`)
    downloadFile([header, ...rows].join('\n'), `${stem}_gaussian_curve.csv`, 'text/csv;charset=utf-8')
  }, [activeDataset, clientGaussianModel])

  const handleImportGaussianData = useCallback((files: File[]) => {
    if (files.length === 0) return
    const file = files[0]
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      if (!text) return
      const lines = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
      const parsed: { x: number; y: number }[] = []
      for (const line of lines) {
        const parts = line.trim().split(/[\t,\s]+/)
        if (parts.length >= 2) {
          const x = parseFloat(parts[0])
          const y = parseFloat(parts[1])
          if (Number.isFinite(x) && Number.isFinite(y)) parsed.push({ x, y })
        }
      }
      if (parsed.length < 3) { setError('匯入失敗：有效資料點不足 3 點'); return }
      parsed.sort((a, b) => a.x - b.x)
      const xs = parsed.map(p => p.x)
      const ys = parsed.map(p => p.y)
      // Extract gaussian params so sliders show accurate reference values
      const params = extractGaussianParams(xs, ys)
      setGaussianCenter(params.center)
      setGaussianFwhm(params.fwhm)
      setGaussianHeight(params.height)
      setImportedGaussianCurve({ x: xs, y: ys, name: file.name })
      setError(null)
    }
    reader.readAsText(file)
  }, [])

  // ── Drag-in-chart helpers ────────────────────────────────────────────────────

  const getDataXFromClientX = useCallback((clientX: number): number | null => {
    if (!chartContainerRef.current) return null
    const plotDiv = chartContainerRef.current.querySelector('.js-plotly-plot') as (HTMLElement & { _fullLayout?: { xaxis?: { _offset?: number; _length?: number; range?: [number, number] } } }) | null
    if (!plotDiv?._fullLayout?.xaxis) return null
    const xaxis = plotDiv._fullLayout.xaxis
    const rect = plotDiv.getBoundingClientRect()
    const pixelInPlot = clientX - rect.left - (xaxis._offset ?? 0)
    if (!xaxis._length) return null
    const fraction = pixelInPlot / xaxis._length
    const [x0, x1] = xaxis.range ?? [0, 1]
    return x0 + fraction * (x1 - x0)
  }, [])

  const getDataYFromClientY = useCallback((clientY: number): number | null => {
    if (!chartContainerRef.current) return null
    const plotDiv = chartContainerRef.current.querySelector('.js-plotly-plot') as (HTMLElement & { _fullLayout?: { yaxis?: { _offset?: number; _length?: number; range?: [number, number] } } }) | null
    if (!plotDiv?._fullLayout?.yaxis) return null
    const yaxis = plotDiv._fullLayout.yaxis
    const rect = plotDiv.getBoundingClientRect()
    const pixelInPlot = clientY - rect.top - (yaxis._offset ?? 0)
    if (!yaxis._length) return null
    const fraction = pixelInPlot / yaxis._length
    const [y0, y1] = yaxis.range ?? [0, 1]
    // screen y increases downward; data y0=bottom, y1=top
    return y1 - fraction * (y1 - y0)
  }, [])

  // Anchored snap: mouse position is treated as the Gaussian peak (center, height).
  // sigma is back-computed so the curve always passes through the anchor minimum.
  const applyAnchoredSnap = useCallback((mouseX: number, mouseY: number) => {
    if (!anchorMinimum) return
    const { x: xa, y: ya } = anchorMinimum
    const center = mouseX
    const height = mouseY
    // height must be above the anchor y for a valid solution
    if (height <= ya) return
    const dx = Math.abs(xa - center)
    let fwhm: number
    if (dx < 1e-10) {
      // mouse is at anchor x → very wide Gaussian; keep previous fwhm
      setGaussianCenter(center)
      setGaussianHeight(height)
      return
    }
    const sigma = dx / Math.sqrt(2 * Math.log(height / ya))
    fwhm = 2 * Math.sqrt(2 * Math.log(2)) * sigma
    setGaussianCenter(center)
    setGaussianHeight(height)
    setGaussianFwhm(fwhm)
  }, [anchorMinimum])

  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    const x = getDataXFromClientX(e.clientX)
    const y = getDataYFromClientY(e.clientY)
    if (x !== null && y !== null) applyAnchoredSnap(x, y)
  }, [getDataXFromClientX, getDataYFromClientY, applyAnchoredSnap])

  // Global mouse tracking for drag
  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      const x = getDataXFromClientX(e.clientX)
      const y = getDataYFromClientY(e.clientY)
      if (x !== null && y !== null) applyAnchoredSnap(x, y)
    }
    const onUp = () => setIsDragging(false)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [isDragging, getDataXFromClientX, getDataYFromClientY, applyAnchoredSnap])

  const plotConfig = withPlotFullscreen({ scrollZoom: false, displayModeBar: true, doubleClick: 'reset+autosize' })
  const showTwoCharts = isTemplateTool || tool === 'background'
  const renderBeforeChart = (minHeight = 360) => (
    <Plot
      data={beforeTraces}
      layout={beforeLayout}
      config={plotConfig}
      style={{ width: '100%', minHeight: `${minHeight}px` }}
      useResizeHandler
    />
  )
  const renderAfterChart = (minHeight = 360) => (
    <Plot
      data={afterTraces}
      layout={afterLayout}
      config={plotConfig}
      style={{ width: '100%', minHeight: `${minHeight}px` }}
      useResizeHandler
    />
  )
  const openSingleToolPopup = (kind: 'before' | 'after') => {
    if (!onOpenPlotPopup || !activeDataset) return
    const isAfter = kind === 'after'

    onOpenPlotPopup({
      title: `${TOOL_META[tool].subtitle} - ${isAfter ? 'After' : 'Before'} - ${activeDataset.name}`,
      content: isAfter ? renderAfterChart(420) : renderBeforeChart(420),
    })
  }

  // ── JSX ──────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">

      {/* ════════════════════════════ LEFT SIDEBAR ════════════════════════════ */}
      <aside className="min-h-0 flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-[var(--card-border)] bg-[var(--panel-bg)]">

        {/* Sticky title */}
        <div className="sticky top-0 z-10 border-b border-[var(--card-border)] bg-[var(--panel-bg)] px-5 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-soft)]">單一處理工具</div>
          <div className="mt-1 text-lg font-semibold text-[var(--text-muted)]">{meta.title}</div>
          <div className="text-xs text-[var(--text-soft)]">{meta.subtitle}</div>
          {onSelectWorkspace && (
            <div className="mt-3">
              <WorkspaceMenuButton currentWorkspace={currentWorkspace} onSelectWorkspace={onSelectWorkspace} variant="compact" />
            </div>
          )}
        </div>

        <div className="flex-1 space-y-3 p-4">

          {/* Upload */}
          <div className="analysis-section-card overflow-hidden rounded-[20px] p-0">
            <div className="border-b border-[var(--card-divider)] px-4 py-3 text-sm font-semibold text-[var(--text-muted)]">上傳檔案</div>
            <div className="p-4">
              <FileUpload onFiles={handleFiles} isLoading={isLoading} />
              {rawFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {rawFiles.map(f => (
                    <div key={f.name} className="analysis-subcard rounded-[12px] px-3 py-1.5 text-xs text-[var(--text-main)]">{f.name}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Background settings ── */}
          {tool === 'background' && (
            <div className="analysis-section-card rounded-[20px] p-4">
              <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">背景扣除設定</div>
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">方法</span>
                  <select value={backgroundMethod} onChange={e => setBackgroundMethod(e.target.value as BackgroundMethod)} className="theme-input w-full rounded-xl px-3 py-2 text-sm">
                    <option value="linear">Linear</option>
                    <option value="shirley">Shirley</option>
                    <option value="polynomial">Polynomial</option>
                    <option value="asls">AsLS</option>
                    <option value="airpls">airPLS</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">範圍起點</span>
                    <input type="number" value={bgRangeStart ?? ''} onChange={e => setBgRangeStart(Number(e.target.value))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">範圍終點</span>
                    <input type="number" value={bgRangeEnd ?? ''} onChange={e => setBgRangeEnd(Number(e.target.value))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                </div>
                {backgroundMethod === 'polynomial' && (
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">多項式階數</span>
                    <input type="number" value={bgPolyDeg} min={1} max={8} onChange={e => setBgPolyDeg(Number(e.target.value))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                )}
                {(backgroundMethod === 'asls' || backgroundMethod === 'airpls') && (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--text-soft)]">平滑強度 log10(λ)</span>
                      <input type="number" value={bgLambdaExp} min={2} max={9} step={0.5} onChange={e => setBgLambdaExp(Number(e.target.value))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                    </label>
                    {backgroundMethod === 'asls' && (
                      <label className="block">
                        <span className="mb-1 block text-xs text-[var(--text-soft)]">峰值抑制 p</span>
                        <input type="number" value={bgP} min={0.001} max={0.2} step={0.001} onChange={e => setBgP(Number(e.target.value))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                      </label>
                    )}
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--text-soft)]">迭代次數</span>
                      <input type="number" value={bgIter} min={5} max={50} onChange={e => setBgIter(Number(e.target.value))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                    </label>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Normalize settings ── */}
          {tool === 'normalize' && (
            <div className="analysis-section-card rounded-[20px] p-4">
              <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">歸一化設定</div>
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">方法</span>
                  <select value={normalizeMethod} onChange={e => setNormalizeMethod(e.target.value as NormalizeMethod)} className="theme-input w-full rounded-xl px-3 py-2 text-sm">
                    <option value="min_max">Min-Max</option>
                    <option value="max">Divide by max</option>
                    <option value="area">Divide by area</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">區間起點</span>
                    <input type="number" value={normStart ?? ''} onChange={e => setNormStart(Number(e.target.value))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">區間終點</span>
                    <input type="number" value={normEnd ?? ''} onChange={e => setNormEnd(Number(e.target.value))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ── Gaussian controls ── */}
          {isGaussianTool && (
            <div className="space-y-3">

              {/* Template params */}
              <div className="analysis-section-card rounded-[20px] p-4">
                <div className="mb-1 text-sm font-semibold text-[var(--text-muted)]">高斯模板</div>
                <div className="mb-3 text-[11px] leading-5 text-[var(--text-soft)]">
                  圖中橘線即時預覽；拉桿移至中間欄，左側僅顯示數值輸入。
                </div>
                <label className="mb-3 flex items-start gap-2.5 rounded-[14px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-3 py-2.5">
                  <input type="checkbox" checked={gaussianNonnegativeGuard}
                    onChange={e => setGaussianNonnegativeGuard(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded" style={{ accentColor: 'var(--accent-strong)' }}
                  />
                  <span className="text-xs leading-5 text-[var(--text-main)]">
                    避免負值保護
                    <span className="block text-[var(--text-soft)]">扣除後自動縮小過深的模板</span>
                  </span>
                </label>
                {/* Mode indicator when using imported curve */}
                {importedGaussianCurve && (
                  <div className="mb-3 flex items-center gap-2 rounded-[14px] bg-[color:color-mix(in_srgb,var(--accent-tertiary)_12%,transparent)] px-3 py-2 border border-[color:color-mix(in_srgb,var(--accent-tertiary)_30%,var(--card-border))]">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--accent-tertiary)] font-semibold">匯入模式</span>
                    <span className="text-[10px] text-[var(--text-soft)] flex-1">數值為提取結果，調整後自動切換手動</span>
                  </div>
                )}
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">中心位置</span>
                    <input type="number" value={gaussianCenter} step={0.01}
                      disabled={snapToMinimumEnabled && snapPhase !== 'gaussian_generated'}
                      onChange={e => { setGaussianCenter(Number(e.target.value)); setImportedGaussianCurve(null) }}
                      className="theme-input w-full rounded-xl px-3 py-2 text-sm disabled:opacity-40" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">半高寬 FWHM</span>
                    <input type="number" value={gaussianFwhm} min={0.001} step={0.01}
                      disabled={snapToMinimumEnabled && snapPhase !== 'gaussian_generated'}
                      onChange={e => { setGaussianFwhm(Math.max(0.001, Number(e.target.value))); setImportedGaussianCurve(null) }}
                      className="theme-input w-full rounded-xl px-3 py-2 text-sm disabled:opacity-40" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">峰高度</span>
                    <input type="number" value={gaussianHeight} min={0} step={0.01}
                      disabled={snapToMinimumEnabled && snapPhase !== 'gaussian_generated'}
                      onChange={e => { setGaussianHeight(Math.max(0, Number(e.target.value))); setImportedGaussianCurve(null) }}
                      className="theme-input w-full rounded-xl px-3 py-2 text-sm disabled:opacity-40" />
                  </label>
                  <div className="rounded-[14px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">高斯面積 (H × FWHM × 1.0645)</div>
                    <div className="mt-0.5 font-mono text-sm text-[var(--accent)]">{gaussianArea.toFixed(4)}</div>
                  </div>
                </div>

                {/* Download gaussian curve */}
                <button
                  type="button"
                  onClick={handleDownloadGaussianCsv}
                  disabled={!activeDataset || !clientGaussianModel}
                  className="pressable mt-3 w-full rounded-xl border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] py-2 text-xs font-medium text-[var(--accent)] disabled:opacity-40 hover:opacity-80"
                >
                  ↓ 下載高斯曲線 CSV
                </button>

                {/* Import gaussian curve */}
                <div className="mt-2">
                  <div className="mb-1 text-xs text-[var(--text-soft)]">匯入外部模板曲線</div>
                  {importedGaussianCurve ? (
                    <div className="flex items-center gap-2 rounded-[14px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-main)]">{importedGaussianCurve.name}</span>
                      <button type="button" onClick={() => setImportedGaussianCurve(null)}
                        className="shrink-0 text-xs text-[var(--accent-secondary)]">移除</button>
                    </div>
                  ) : (
                    <label className="pressable flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--card-border)] px-3 py-2.5 text-xs text-[var(--text-soft)] hover:text-[var(--text-muted)]">
                      <span>+ 選擇 CSV / TXT 檔案</span>
                      <input type="file" accept=".csv,.txt,.dat,.xy" className="hidden"
                        onChange={e => { if (e.target.files) handleImportGaussianData(Array.from(e.target.files)); if (e.target) (e.target as HTMLInputElement).value = '' }} />
                    </label>
                  )}
                </div>
              </div>

              {/* Cut-point mode */}
              <div className="analysis-section-card rounded-[20px] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-[var(--text-muted)]">切點模式</div>
                  <label className="flex cursor-pointer items-center gap-2">
                    <span className="text-xs text-[var(--text-soft)]">{snapToMinimumEnabled ? '已啟用' : '啟用'}</span>
                    <input type="checkbox" checked={snapToMinimumEnabled}
                      onChange={e => setSnapToMinimumEnabled(e.target.checked)}
                      className="h-4 w-4 rounded" style={{ accentColor: 'var(--accent-strong)' }} />
                  </label>
                </div>

                {!snapToMinimumEnabled && (
                  <div className="text-[11px] leading-5 text-[var(--text-soft)]">
                    啟用後設定搜尋範圍 → 確定 → 生成高斯 → 圖中拖動，高斯曲線始終通過最低點。
                  </div>
                )}

                {snapToMinimumEnabled && (
                  <div className="space-y-3">
                    {/* Step 1: set range + confirm */}
                    <div>
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-soft)]">① 設定搜尋範圍</div>
                      <div className="mb-2 grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-xs text-[var(--text-soft)]">起點</span>
                          <input type="number" value={minimumRangeStart} step={0.01}
                            onChange={e => { setMinimumRangeStart(Number(e.target.value)); setSnapPhase('idle') }}
                            className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs text-[var(--text-soft)]">終點</span>
                          <input type="number" value={minimumRangeEnd} step={0.01}
                            onChange={e => { setMinimumRangeEnd(Number(e.target.value)); setSnapPhase('idle') }}
                            className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={handleConfirmSnapRange}
                        disabled={!activeDataset}
                        className="pressable w-full rounded-xl border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] py-2 text-sm font-semibold text-[var(--text-muted)] disabled:opacity-40 hover:opacity-80"
                      >
                        確定
                      </button>
                    </div>

                    {/* Step 2: minimum found info + generate gaussian */}
                    {(snapPhase === 'minimum_found' || snapPhase === 'gaussian_generated') && anchorMinimum && (
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-soft)]">② 最低點</div>
                        <div className="mb-2 rounded-[14px] border border-[color:color-mix(in_srgb,#fb7185_30%,var(--card-border))] bg-[color:color-mix(in_srgb,#fb7185_06%,transparent)] px-3 py-2">
                          <div className="text-[10px] uppercase tracking-[0.12em] text-[#fb7185]">X / Y</div>
                          <div className="mt-0.5 font-mono text-sm text-[var(--text-main)]">
                            {anchorMinimum.x.toFixed(4)} / {anchorMinimum.y.toFixed(4)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleGenerateSnapGaussian}
                          disabled={snapPhase === 'gaussian_generated'}
                          className="pressable w-full rounded-xl bg-[var(--accent-strong)] py-2 text-sm font-semibold text-[var(--bg-canvas)] disabled:opacity-50"
                        >
                          {snapPhase === 'gaussian_generated' ? '✓ 高斯已生成' : '生成高斯曲線'}
                        </button>
                      </div>
                    )}

                    {/* Step 3: drag fine-tune + residual */}
                    {snapPhase === 'gaussian_generated' && (
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-soft)]">③ 圖中按住拖動塑形</div>
                        <div className="mb-2 rounded-[14px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-3 py-2 text-[11px] leading-5 text-[var(--text-soft)]">
                          按住左鍵拖動，滑鼠位置即為高斯峰頂。曲線自動維持通過最低點，可斜向/上下移動自由伸縮。
                        </div>
                        {clientAfterY && (
                          <div className="rounded-[14px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-3 py-2.5">
                            <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">扣除後殘值（接近 0 即目標）</div>
                            <div className={`mt-0.5 font-mono text-sm ${(minimumResidual ?? 99) < 1 ? 'text-[var(--accent-secondary)]' : 'text-[var(--text-main)]'}`}>
                              {minimumResidual != null ? minimumResidual.toFixed(4) : '—'}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          )}

          {isArctanTool && (
            <div className="analysis-section-card rounded-[20px] p-4">
              <div className="mb-1 text-sm font-semibold text-[var(--text-muted)]">Arctan 模板</div>
              <div className="mb-3 text-[11px] leading-5 text-[var(--text-soft)]">
                這裡保留 3 個主參數輸入；拉桿在中間圖下，方便你一邊看圖一邊調。
              </div>
              <label className="mb-3 flex items-start gap-2.5 rounded-[14px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-3 py-2.5">
                <input type="checkbox" checked={gaussianNonnegativeGuard}
                  onChange={e => setGaussianNonnegativeGuard(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded" style={{ accentColor: 'var(--accent-strong)' }}
                />
                <span className="text-xs leading-5 text-[var(--text-main)]">
                  避免負值保護
                  <span className="block text-[var(--text-soft)]">扣除太深時，結果會限制在 0 以上</span>
                </span>
              </label>
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">中心位置</span>
                  <input type="number" value={arctanCenter} step={0.01}
                    onChange={e => setArctanCenter(Number(e.target.value))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">轉折寬度</span>
                  <input type="number" value={arctanWidth} min={0.001} step={0.01}
                    onChange={e => setArctanWidth(Math.max(0.001, Number(e.target.value)))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">高度</span>
                  <input type="number" value={arctanHeight} min={0} step={0.01}
                    onChange={e => setArctanHeight(Math.max(0, Number(e.target.value)))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                </label>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ════════════════════════════ RIGHT MAIN ════════════════════════════ */}
      <main className="min-h-0 flex flex-1 flex-col overflow-y-auto p-4 sm:p-5">
        <div className="space-y-4">

          {/* Status bar */}
          <div className="glass-panel rounded-[24px] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-[var(--text-muted)]">處理結果</div>
                <div className="mt-1 text-xs text-[var(--text-soft)]">
                  {isGaussianTool && '上圖：原始 + 高斯模型（即時）；下圖：扣除後（前端即時計算，無需套用）。'}
                  {isArctanTool && '上圖：原始 + Arctan 模型（即時）；下圖：Arctan 扣除後結果。'}
                  {tool === 'background' && '上圖：原始 + 背景基準線；下圖：扣背景後結果。'}
                  {tool === 'normalize' && '原始訊號與歸一化後曲線同圖對比。'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {result.length > 1 && (
                  <select value={selectedDatasetName} onChange={e => setSelectedDatasetName(e.target.value)}
                    className="theme-input rounded-xl px-3 py-2 text-sm">
                    {result.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                  </select>
                )}
              </div>
            </div>
            {error && (
              <div className="mt-3 rounded-[16px] border border-[color:color-mix(in_srgb,var(--accent-secondary)_28%,var(--card-border))] bg-[color:color-mix(in_srgb,var(--accent-secondary)_12%,transparent)] px-4 py-3 text-sm text-[var(--text-main)]">
                {error}
              </div>
            )}
            {isLoading && !activeDataset && (
              <div className="mt-3 theme-pill inline-flex rounded-full px-4 py-2 text-sm font-medium text-[var(--accent)]">處理中…</div>
            )}
          </div>

          {/* Empty state */}
          {!activeDataset && !isLoading && (
            <div className="glass-panel rounded-[24px] p-4">
              <div className="analysis-subcard flex min-h-[22rem] flex-col items-center justify-center rounded-[20px] px-6 text-center">
                <div className="mb-4 text-5xl" style={{ color: meta.accent }}>◌</div>
                <div className="text-xl font-semibold text-[var(--text-muted)]">先上傳檔案</div>
                <div className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-soft)]">{meta.description}</div>
              </div>
            </div>
          )}

          {/* Chart 1: raw + preview */}
          {activeDataset && (
            <div className="glass-panel rounded-[24px] p-4">
              <div className="mb-2 flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                  {isGaussianTool ? '原始訊號 + 高斯模型（即時）'
                    : isArctanTool ? '原始訊號 + Arctan 模型（即時）'
                    : tool === 'background' ? '原始訊號 + 背景基準線' : '處理前後'}
                </span>
                {onOpenPlotPopup && (
                  <button type="button" className="chart-popup-button" onClick={() => openSingleToolPopup('before')}>
                    彈出圖表
                  </button>
                )}
                {isLoading && (
                  <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">更新中…</span>
                )}
              </div>

              {/* Gaussian: chart + right-side vertical height slider */}
              {isTemplateTool ? (
                <>
                  <div className="flex items-stretch gap-1">
                    <div
                      ref={chartContainerRef}
                      className="relative min-w-0 flex-1"
                      style={{ cursor: isGaussianTool && snapPhase === 'gaussian_generated' ? (isDragging ? 'grabbing' : 'ew-resize') : undefined }}
                    >
                      {renderBeforeChart(320)}
                      {/* Transparent overlay for drag-to-reposition gaussian in snap mode */}
                      {isGaussianTool && snapToMinimumEnabled && snapPhase === 'gaussian_generated' && (
                        <div
                          className="absolute inset-0"
                          style={{ zIndex: 10, cursor: isDragging ? 'grabbing' : 'ew-resize' }}
                          onMouseDown={handleOverlayMouseDown}
                        />
                      )}
                    </div>
                    {/* Vertical height slider (rotated) */}
                    <div className="flex w-10 flex-col items-center justify-center gap-1">
                      <span className="text-[9px] text-[var(--text-soft)]" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>高度 H</span>
                      <input
                        type="range"
                        value={templateHeight}
                        min={0}
                        max={heightSliderMax}
                        step={heightSliderMax / 500}
                        disabled={isGaussianTool && snapToMinimumEnabled && snapPhase !== 'gaussian_generated'}
                        onChange={e => {
                          const value = Number(e.target.value)
                          if (isGaussianTool) {
                            setGaussianHeight(value)
                            setImportedGaussianCurve(null)
                          } else {
                            setArctanHeight(value)
                          }
                        }}
                        style={{
                          writingMode: 'vertical-lr',
                          direction: 'rtl',
                          width: '28px',
                          height: '260px',
                          cursor: (isGaussianTool && snapToMinimumEnabled && snapPhase !== 'gaussian_generated') ? 'not-allowed' : 'pointer',
                          accentColor: '#38bdf8',
                          opacity: (isGaussianTool && snapToMinimumEnabled && snapPhase !== 'gaussian_generated') ? 0.4 : undefined,
                        }}
                      />
                      <span className="font-mono text-[9px] text-[var(--text-soft)]">{templateHeight.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Horizontal center slider */}
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-soft)]">
                        中心位置{isGaussianTool && snapToMinimumEnabled && snapPhase === 'gaussian_generated' && <span className="ml-1 text-[var(--accent-secondary)]">（按住圖中拖動）</span>}
                      </span>
                      <span className="font-mono text-xs text-[var(--text-main)]">{templateCenter.toFixed(3)}</span>
                    </div>
                    <input
                      type="range"
                      value={templateCenter}
                      min={gSliderXMin}
                      max={gSliderXMax}
                      step={gSliderXRange / 1000}
                      disabled={isGaussianTool && snapToMinimumEnabled && snapPhase !== 'gaussian_generated'}
                      onChange={e => {
                        const value = Number(e.target.value)
                        if (isGaussianTool) {
                          setGaussianCenter(value)
                          setImportedGaussianCurve(null)
                        } else {
                          setArctanCenter(value)
                        }
                      }}
                      className="w-full cursor-pointer"
                      style={{ accentColor: '#f97316', opacity: (isGaussianTool && snapToMinimumEnabled && snapPhase !== 'gaussian_generated') ? 0.4 : undefined }}
                    />
                  </div>

                  {/* Horizontal width slider */}
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-soft)]">{templateWidthLabel}</span>
                      <span className="font-mono text-xs text-[var(--text-main)]">{templateWidth.toFixed(3)}</span>
                    </div>
                    <input
                      type="range"
                      value={templateWidth}
                      min={0.001}
                      max={fwhmSliderMax}
                      step={fwhmSliderMax / 500}
                      disabled={isGaussianTool && snapToMinimumEnabled && snapPhase !== 'gaussian_generated'}
                      onChange={e => {
                        const value = Number(e.target.value)
                        if (isGaussianTool) {
                          setGaussianFwhm(value)
                          setImportedGaussianCurve(null)
                        } else {
                          setArctanWidth(value)
                        }
                      }}
                      className="w-full cursor-pointer"
                      style={{ accentColor: '#f97316', opacity: (isGaussianTool && snapToMinimumEnabled && snapPhase !== 'gaussian_generated') ? 0.4 : undefined }}
                    />
                    <div className="flex justify-between text-[10px] text-[var(--text-soft)]">
                      <span>← {(templateCenter - templateWidth / 2).toFixed(3)}</span>
                      <span>{(templateCenter + templateWidth / 2).toFixed(3)} →</span>
                    </div>
                  </div>
                </>
              ) : (
                renderBeforeChart()
              )}

              {showTwoCharts && (
                <div className="mt-2 flex">
                  <button type="button" onClick={() => setExportPreviewKind('chart1')}
                    className="theme-pill pressable rounded-xl px-3 py-1.5 text-xs font-medium text-[var(--accent)]">
                    ↓ 匯出此圖數據
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Chart 2: after subtraction */}
          {activeDataset && showTwoCharts && afterTraces.length > 0 && (
            <div className="glass-panel rounded-[24px] p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                {isTemplateTool ? `${templateLabel} 扣除後結果（前端即時）` : '扣背景後結果'}
              </div>
              {onOpenPlotPopup && (
                <div className="mb-2 flex justify-end">
                  <button type="button" className="chart-popup-button" onClick={() => openSingleToolPopup('after')}>
                    彈出圖表
                  </button>
                </div>
              )}
              {renderAfterChart()}
              <div className="mt-2 flex">
                <button type="button" onClick={() => setExportPreviewKind('chart2')}
                  className="theme-pill pressable rounded-xl px-3 py-1.5 text-xs font-medium text-[var(--accent)]">
                  ↓ 匯出此圖數據
                </button>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ════════ Export preview modal ════════ */}
      {exportPreviewKind && activeDataset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setExportPreviewKind(null)}>
          <div className="analysis-section-card flex w-full max-w-2xl flex-col overflow-hidden rounded-[24px] p-0 shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="border-b border-[var(--card-divider)] px-6 py-4">
              <div className="text-sm font-semibold text-[var(--text-main)]">
                {exportPreviewKind === 'chart1'
                  ? (isGaussianTool ? '原始訊號 + 高斯模型' : isArctanTool ? '原始訊號 + Arctan 模型' : '原始訊號 + 背景基準線')
                  : (isGaussianTool ? '高斯扣除後' : isArctanTool ? 'Arctan 扣除後' : '背景扣除後')}
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-soft)]">{activeDataset.name} — Origin Pro 風格預覽</div>
            </div>
            {/* Preview chart */}
            <div className="px-4 pt-3">
              <div className="analysis-subcard overflow-hidden p-2">
                <Plot
                  data={exportPreviewKind === 'chart1' ? previewChart1Traces : previewChart2Traces}
                  layout={buildOriginProLayout()}
                  config={{ scrollZoom: false, displayModeBar: false }}
                  style={{ width: '100%', height: '320px' }}
                  useResizeHandler
                />
              </div>
            </div>
            {/* Actions */}
            <div className="flex justify-end gap-3 border-t border-[var(--card-divider)] px-6 py-4">
              <button type="button" onClick={() => setExportPreviewKind(null)}
                className="pressable rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-4 py-2 text-sm text-[var(--text-main)] hover:border-[var(--accent-strong)]">
                取消
              </button>
              <button type="button"
                onClick={() => {
                  if (exportPreviewKind === 'chart1') handleExportChart1()
                  else handleExportChart2()
                  setExportPreviewKind(null)
                }}
                className="pressable rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_46%,transparent)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_92%,transparent),color-mix(in_srgb,var(--accent-strong)_78%,transparent))] px-5 py-2 text-sm font-semibold text-[var(--bg-canvas)] shadow-[0_16px_32px_-24px_color-mix(in_srgb,var(--accent)_78%,transparent)] hover:brightness-110">
                確定匯出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
