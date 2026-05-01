import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Plot from 'react-plotly.js'
import { withPlotFullscreen } from '../components/plotConfig'
import { parseFiles, processData } from '../api/xrd'
import FileUpload from '../components/FileUpload'
import type { GaussianCenter, ParsedFile, ProcessParams, ProcessedDataset } from '../types/xrd'
import { DEFAULT_PARAMS } from '../components/ProcessingPanel'

export type SingleToolKind = 'background' | 'normalize' | 'gaussian'

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
    description: '固定 FWHM 與面積，局部搜尋中心位置，快速扣掉已知峰影響。',
    accent: 'var(--accent-tertiary)',
  },
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
): string {
  const header = ['x', 'raw', 'background', 'gaussian_model', 'gaussian_subtracted', 'processed']
  const rows = dataset.x.map((xv, i) => [
    xv.toFixed(6),
    dataset.y_raw[i]?.toFixed(6) ?? '',
    dataset.y_background?.[i]?.toFixed(6) ?? '',
    dataset.y_gaussian_model?.[i]?.toFixed(6) ?? '',
    dataset.y_gaussian_subtracted?.[i]?.toFixed(6) ?? '',
    dataset.y_processed[i]?.toFixed(6) ?? '',
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
  gaussianSearchHalfWidth: number,
  gaussianCenters: GaussianCenter[],
): ProcessParams {
  return {
    ...DEFAULT_PARAMS,
    interpolate: tool === 'gaussian',
    n_points: tool === 'gaussian' ? 1200 : 1000,
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
    gaussian_search_half_width: gaussianSearchHalfWidth,
    gaussian_centers: tool === 'gaussian' ? gaussianCenters : [],
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

// Slider commits on mouseUp/touchEnd; number input commits on blur/Enter
function SliderRow({
  label, value, min, max, step, decimals = 3, disabled = false, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; decimals?: number; disabled?: boolean
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
        <span className={`text-xs ${disabled ? 'text-[var(--text-disabled)]' : 'text-[var(--text-soft)]'}`}>{label}</span>
        <span className="font-mono text-xs text-[var(--text-main)]">{local.toFixed(decimals)}</span>
      </div>
      <input type="number" value={local} min={min} max={max} step={step} disabled={disabled}
        onChange={e => setLocal(Number(e.target.value))}
        onBlur={e => commit(Number(e.target.value))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(Number((e.target as HTMLInputElement).value)) } }}
        className="theme-input w-full rounded-xl px-3 py-2 text-sm disabled:opacity-40" />
      <input type="range" value={local} min={min} max={max} step={step} disabled={disabled}
        onChange={e => setLocal(Number(e.target.value))}
        onMouseUp={e => commit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={e => commit(Number((e.target as HTMLInputElement).value))}
        className="w-full cursor-pointer disabled:cursor-default disabled:opacity-40"
        style={{ accentColor: 'var(--accent-strong)' }} />
    </div>
  )
}

export default function SingleProcessTool({ tool }: { tool: SingleToolKind }) {
  const meta = TOOL_META[tool]

  // ── Core state ──────────────────────────────────────────────────────────────
  const [rawFiles, setRawFiles] = useState<ParsedFile[]>([])
  const [result, setResult] = useState<ProcessedDataset[]>([])
  const [selectedDatasetName, setSelectedDatasetName] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Gaussian: manual apply trigger (incremented on button click)
  const [gaussianApplyVersion, setGaussianApplyVersion] = useState(0)

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
  const [gaussianSearchHalfWidth, setGaussianSearchHalfWidth] = useState(0.5)
  const [minimumRangeStart, setMinimumRangeStart] = useState(403)
  const [minimumRangeEnd, setMinimumRangeEnd] = useState(406)
  const [bindCurveToMinimum, setBindCurveToMinimum] = useState(false)
  const [gaussianCenters, setGaussianCenters] = useState<GaussianCenter[]>([
    { enabled: true, name: 'Peak 1', center: 30 },
  ])

  // ── Reset on tool change ─────────────────────────────────────────────────────
  useEffect(() => {
    setRawFiles([])
    setResult([])
    setSelectedDatasetName('')
    setError(null)
    setGaussianApplyVersion(0)
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
    setGaussianSearchHalfWidth(0.5)
    setMinimumRangeStart(403)
    setMinimumRangeEnd(406)
    setBindCurveToMinimum(false)
    setGaussianCenters([{ enabled: true, name: 'Peak 1', center: 30 }])
  }, [tool])

  useEffect(() => {
    if (result.length === 0) { setSelectedDatasetName(''); return }
    if (!result.some(d => d.name === selectedDatasetName)) setSelectedDatasetName(result[0].name)
  }, [result, selectedDatasetName])

  const activeDataset: ProcessedDataset | null =
    result.find(d => d.name === selectedDatasetName) ?? result[0] ?? null

  // ── Gaussian derived state ───────────────────────────────────────────────────

  const anchorMinimum = useMemo(
    () => tool === 'gaussian' && activeDataset
      ? findMinimumInRange(activeDataset.x, activeDataset.y_raw, minimumRangeStart, minimumRangeEnd)
      : null,
    [tool, activeDataset, minimumRangeStart, minimumRangeEnd],
  )

  const lockedCenterIndex = useMemo(() => {
    if (!bindCurveToMinimum || !anchorMinimum) return null
    let best: number | null = null
    let bestDist = Infinity
    gaussianCenters.forEach((c, i) => {
      if (!c.enabled || !Number.isFinite(c.center)) return
      const d = Math.abs(c.center - anchorMinimum.x)
      if (d < bestDist) { bestDist = d; best = i }
    })
    return best
  }, [bindCurveToMinimum, anchorMinimum, gaussianCenters])

  // When locked: snap nearest center onto the minimum x
  const effectiveGaussianCenters = useMemo(() => {
    if (!bindCurveToMinimum || !anchorMinimum || lockedCenterIndex == null) return gaussianCenters
    return gaussianCenters.map((c, i) =>
      i === lockedCenterIndex ? { ...c, center: anchorMinimum.x } : c,
    )
  }, [bindCurveToMinimum, anchorMinimum, gaussianCenters, lockedCenterIndex])

  // When locked: height = y_min / Σ unit_gaussian(x_min)  →  peak of curve is at y_min
  const effectiveGaussianHeight = useMemo(() => {
    if (!bindCurveToMinimum || !anchorMinimum || gaussianFwhm <= 0) return gaussianHeight
    const sigma = gaussianFwhm / (2 * Math.sqrt(2 * Math.log(2)))
    const totalAttenuation = effectiveGaussianCenters
      .filter(c => c.enabled && Number.isFinite(c.center))
      .reduce((s, c) => s + Math.exp(-0.5 * ((anchorMinimum.x - c.center) / sigma) ** 2), 0)
    if (totalAttenuation <= 1e-9) return gaussianHeight
    // clamp to 0 if y_min ≤ 0 (bypass negative issues as requested)
    return Math.max(anchorMinimum.y / totalAttenuation, 0)
  }, [bindCurveToMinimum, gaussianHeight, anchorMinimum, gaussianFwhm, effectiveGaussianCenters])

  // Client-side instant Gaussian preview (no backend call, <1ms for 1200pts)
  const clientGaussianModel = useMemo((): number[] | null => {
    if (tool !== 'gaussian' || !activeDataset || gaussianFwhm <= 0) return null
    const sigma = gaussianFwhm / (2 * Math.sqrt(2 * Math.log(2)))
    const model = new Array(activeDataset.x.length).fill(0) as number[]
    for (const c of effectiveGaussianCenters) {
      if (!c.enabled || !Number.isFinite(c.center)) continue
      for (let i = 0; i < activeDataset.x.length; i++) {
        model[i] += effectiveGaussianHeight * Math.exp(-0.5 * ((activeDataset.x[i] - c.center) / sigma) ** 2)
      }
    }
    return model
  }, [tool, activeDataset, gaussianFwhm, effectiveGaussianCenters, effectiveGaussianHeight])

  // When locked: client-side subtraction (instant, exact — bypasses backend for after-chart)
  const lockedAfterY = useMemo((): number[] | null => {
    if (!bindCurveToMinimum || !activeDataset || !clientGaussianModel) return null
    return activeDataset.y_raw.map((v, i) => Math.max(0, v - (clientGaussianModel[i] ?? 0)))
  }, [bindCurveToMinimum, activeDataset, clientGaussianModel])

  // Residual at the minimum after subtraction
  const boundPointResidual = useMemo(() => {
    if (!anchorMinimum || !activeDataset) return null
    if (bindCurveToMinimum && lockedAfterY) {
      const v = lockedAfterY[anchorMinimum.index]
      return v != null && Number.isFinite(v) ? v : null
    }
    const v = activeDataset.y_gaussian_subtracted?.[anchorMinimum.index]
    return v != null && Number.isFinite(v) ? v : null
  }, [anchorMinimum, activeDataset, bindCurveToMinimum, lockedAfterY])

  // ── Backend params ───────────────────────────────────────────────────────────
  const params = buildParams(
    tool,
    backgroundMethod, bgRangeStart, bgRangeEnd, bgPolyDeg, bgLambdaExp, bgP, bgIter,
    normalizeMethod, normStart, normEnd,
    gaussianFwhm,
    effectiveGaussianHeight,
    bindCurveToMinimum ? false : gaussianNonnegativeGuard,
    bindCurveToMinimum ? 0 : gaussianSearchHalfWidth,
    effectiveGaussianCenters,
  )

  // Debounced params (used by bg/normalize auto-process)
  const [debouncedParams, setDebouncedParams] = useState(params)
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedParams(params), 300)
    return () => window.clearTimeout(t)
  }, [params])

  // Auto-process: background / normalize only
  useEffect(() => {
    if (tool === 'gaussian') return
    if (rawFiles.length === 0) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    processData(rawFiles, debouncedParams)
      .then(r => { if (!cancelled) setResult(r.datasets) })
      .catch(e => { if (!cancelled) setError(String((e as Error).message)) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [tool, rawFiles, debouncedParams])

  // Gaussian: manual apply only (ref keeps latest params without re-triggering the effect)
  const gaussianParamsRef = useRef(params)
  gaussianParamsRef.current = params

  useEffect(() => {
    if (tool !== 'gaussian' || rawFiles.length === 0 || gaussianApplyVersion === 0) return
    const currentParams = gaussianParamsRef.current
    let cancelled = false
    setIsLoading(true)
    setError(null)
    processData(rawFiles, currentParams)
      .then(r => { if (!cancelled) setResult(r.datasets) })
      .catch(e => { if (!cancelled) setError(String((e as Error).message)) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [tool, rawFiles, gaussianApplyVersion])

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
        setGaussianCenters([{ enabled: true, name: 'Peak 1', center: (xMin + xMax) / 2 }])
        if (tool === 'gaussian') {
          // trigger initial backend call for gaussian after files are loaded
          setGaussianApplyVersion(v => v + 1)
        }
      }
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [tool])

  // ── Slider bounds ────────────────────────────────────────────────────────────
  const gSliderXMin = rawFiles.length > 0 ? Math.min(...rawFiles.flatMap(f => f.x)) : 0
  const gSliderXMax = rawFiles.length > 0 ? Math.max(...rawFiles.flatMap(f => f.x)) : 180
  const gSliderXRange = Math.max(gSliderXMax - gSliderXMin, 1)
  const gSliderYMax = rawFiles.length > 0 ? Math.max(...rawFiles.flatMap(f => f.y)) : 10000
  const fwhmSliderMax = Math.max(gSliderXRange / 4, 2)
  const searchHwSliderMax = Math.max(gSliderXRange / 2, 5)
  const heightSliderMax = Math.max(gSliderYMax * 1.5, 1)

  // ── Chart traces ─────────────────────────────────────────────────────────────

  const beforeTraces = useMemo((): Plotly.Data[] => {
    if (!activeDataset) return []
    const traces: Plotly.Data[] = [{
      x: activeDataset.x, y: activeDataset.y_raw,
      type: 'scatter', mode: 'lines', name: '原始',
      line: { color: '#94a3b8', width: 1.7 },
    }]
    if (tool === 'gaussian' && clientGaussianModel) {
      traces.push({
        x: activeDataset.x, y: clientGaussianModel,
        type: 'scatter', mode: 'lines', name: '高斯模型（即時預覽）',
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
    if (tool === 'gaussian' && anchorMinimum) {
      traces.push({
        x: [anchorMinimum.x], y: [anchorMinimum.y],
        type: 'scatter', mode: 'markers',
        name: `最低點 (${anchorMinimum.x.toFixed(3)}, ${anchorMinimum.y.toFixed(3)})`,
        marker: { color: '#fb7185', size: 11, line: { color: '#fff1f2', width: 1.5 } },
      })
    }
    return traces
  }, [activeDataset, tool, clientGaussianModel, anchorMinimum])

  const afterTraces = useMemo((): Plotly.Data[] => {
    if (!activeDataset) return []
    if (tool === 'gaussian') {
      // When locked: client-side subtraction is exact and instant
      // When unlocked: use backend result (updated by "套用" button)
      const yData = (bindCurveToMinimum && lockedAfterY)
        ? lockedAfterY
        : activeDataset.y_gaussian_subtracted
      if (!yData) return []
      return [{
        x: activeDataset.x, y: yData,
        type: 'scatter', mode: 'lines',
        name: bindCurveToMinimum ? '高斯扣除後（即時）' : '高斯扣除後',
        line: { color: '#38bdf8', width: 2.2 },
      }]
    }
    if (tool === 'background') {
      return [{
        x: activeDataset.x, y: activeDataset.y_processed,
        type: 'scatter', mode: 'lines', name: '扣背景後',
        line: { color: '#38bdf8', width: 2.2 },
      }]
    }
    return []
  }, [activeDataset, tool, bindCurveToMinimum, lockedAfterY])

  const beforeLayout = useMemo(() => {
    const base = chartLayout()
    base.dragmode = 'zoom'
    base.uirevision = `${tool}:${selectedDatasetName}:before`
    if (tool === 'gaussian') {
      base.shapes = [{
        type: 'rect', xref: 'x', yref: 'paper',
        x0: Math.min(minimumRangeStart, minimumRangeEnd),
        x1: Math.max(minimumRangeStart, minimumRangeEnd),
        y0: 0, y1: 1,
        fillcolor: 'rgba(251,113,133,0.08)',
        line: { color: 'rgba(251,113,133,0.32)', width: 1, dash: 'dot' },
      }]
    }
    return base
  }, [tool, minimumRangeStart, minimumRangeEnd, selectedDatasetName])

  const afterLayout = useMemo(() => {
    const base = chartLayout()
    base.dragmode = 'zoom'
    base.uirevision = `${tool}:${selectedDatasetName}:after`
    return base
  }, [tool, selectedDatasetName])

  const handleExport = useCallback(() => {
    if (!activeDataset) return
    const csv = buildSingleToolCsv(activeDataset, minimumRangeStart, minimumRangeEnd, anchorMinimum)
    downloadFile(csv, `${activeDataset.name.replace(/\.[^.]+$/, '')}_${tool}_processed.csv`, 'text/csv;charset=utf-8')
  }, [activeDataset, tool, minimumRangeStart, minimumRangeEnd, anchorMinimum])

  const plotConfig = withPlotFullscreen({ scrollZoom: false, displayModeBar: true, doubleClick: 'reset+autosize' })
  const showTwoCharts = tool === 'gaussian' || tool === 'background'

  // ── JSX ──────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">

      {/* ════════════════════════════ LEFT SIDEBAR ════════════════════════════ */}
      <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-[var(--card-border)] bg-[var(--panel-bg)]">

        {/* Sticky header */}
        <div className="sticky top-0 z-10 border-b border-[var(--card-border)] bg-[var(--panel-bg)] px-5 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-soft)]">單一處理工具</div>
          <div className="mt-1 text-lg font-semibold text-[var(--text-muted)]">{meta.title}</div>
          <div className="text-xs text-[var(--text-soft)]">{meta.subtitle}</div>
        </div>

        <div className="flex-1 space-y-3 p-4">

          {/* Upload */}
          <div className="theme-block overflow-hidden rounded-[20px]">
            <div className="border-b border-[var(--card-divider)] px-4 py-3 text-sm font-semibold text-[var(--text-muted)]">上傳檔案</div>
            <div className="p-4">
              <FileUpload onFiles={handleFiles} isLoading={isLoading} />
              {rawFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {rawFiles.map(f => (
                    <div key={f.name} className="theme-block-soft rounded-[12px] px-3 py-1.5 text-xs text-[var(--text-main)]">{f.name}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Background settings ── */}
          {tool === 'background' && (
            <div className="theme-block rounded-[20px] p-4">
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
            <div className="theme-block rounded-[20px] p-4">
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
          {tool === 'gaussian' && (
            <div className="space-y-3">

              {/* Template params */}
              <div className="theme-block rounded-[20px] p-4">
                <div className="mb-1 text-sm font-semibold text-[var(--text-muted)]">高斯模板調整</div>
                <div className="mb-3 text-[11px] leading-5 text-[var(--text-soft)]">
                  橘色虛線為即時預覽，拖動後立即更新。按下「<span className="font-semibold text-[var(--accent)]">套用到扣除結果</span>」才會呼叫後端更新右側下圖。
                </div>
                <div className="mb-3">
                  <label className="flex items-start gap-2.5 rounded-[14px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-3 py-2.5">
                    <input type="checkbox" checked={gaussianNonnegativeGuard} disabled={bindCurveToMinimum}
                      onChange={e => setGaussianNonnegativeGuard(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded" style={{ accentColor: 'var(--accent-strong)' }}
                    />
                    <span className="text-xs leading-5 text-[var(--text-main)]">
                      避免負值保護
                      <span className="block text-[var(--text-soft)]">
                        {bindCurveToMinimum ? '（鎖定時停用，由前端確保非負）' : '後端自動縮小過深模板'}
                      </span>
                    </span>
                  </label>
                </div>
                <div className="space-y-4">
                  <SliderRow label="固定 FWHM" value={gaussianFwhm}
                    min={0.001} max={fwhmSliderMax} step={0.01} decimals={3}
                    onChange={setGaussianFwhm} />
                  {bindCurveToMinimum ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-soft)]">固定高度（鎖定自動）</span>
                        <span className="font-mono text-xs font-semibold text-[var(--accent-secondary)]">{effectiveGaussianHeight.toFixed(3)}</span>
                      </div>
                      <div className="rounded-[12px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-3 py-2 text-[11px] text-[var(--text-soft)]">
                        由最低點自動計算，高斯峰頂恰好在最低點。
                      </div>
                    </div>
                  ) : (
                    <SliderRow label="固定高度" value={gaussianHeight}
                      min={0} max={heightSliderMax} step={0.01} decimals={3}
                      onChange={setGaussianHeight} />
                  )}
                  <SliderRow label="搜尋半寬（鎖定時停用）" value={gaussianSearchHalfWidth}
                    min={0.001} max={searchHwSliderMax} step={0.01} decimals={3}
                    disabled={bindCurveToMinimum}
                    onChange={setGaussianSearchHalfWidth} />
                </div>

                {/* Apply button */}
                {!bindCurveToMinimum && (
                  <button
                    type="button"
                    onClick={() => setGaussianApplyVersion(v => v + 1)}
                    disabled={rawFiles.length === 0 || isLoading}
                    className="pressable mt-4 w-full rounded-xl bg-[var(--accent-strong)] py-2 text-sm font-semibold text-[var(--bg-canvas)] disabled:opacity-40"
                  >
                    {isLoading ? '計算中…' : '套用到扣除結果'}
                  </button>
                )}
                {bindCurveToMinimum && (
                  <div className="mt-3 rounded-[12px] border border-[color:color-mix(in_srgb,var(--accent-secondary)_30%,var(--card-border))] bg-[color:color-mix(in_srgb,var(--accent-secondary)_8%,transparent)] px-3 py-2 text-[11px] leading-5 text-[var(--text-soft)]">
                    鎖定模式：右側下圖由前端即時計算（無需套用），結果精確切過最低點。
                  </div>
                )}
              </div>

              {/* Minimum range binding */}
              <div className="theme-block rounded-[20px] p-4">
                <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">最低點搜尋區間</div>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">起點</span>
                    <input type="number" value={minimumRangeStart} step={0.01}
                      onChange={e => setMinimumRangeStart(Number(e.target.value))}
                      className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">終點</span>
                    <input type="number" value={minimumRangeEnd} step={0.01}
                      onChange={e => setMinimumRangeEnd(Number(e.target.value))}
                      className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <button type="button"
                    onClick={() => setBindCurveToMinimum(true)}
                    disabled={!anchorMinimum}
                    className={[
                      'theme-pill pressable rounded-xl px-3 py-1.5 text-xs font-medium transition-all',
                      bindCurveToMinimum ? 'text-[var(--accent-secondary)]' : 'text-[var(--accent)]',
                      !anchorMinimum ? 'cursor-not-allowed opacity-50' : '',
                    ].join(' ')}
                  >
                    {bindCurveToMinimum ? '✓ 已鎖定到最低點' : '鎖定到最低點'}
                  </button>
                  {bindCurveToMinimum && (
                    <button type="button" onClick={() => setBindCurveToMinimum(false)}
                      className="theme-pill pressable rounded-xl px-3 py-1.5 text-xs font-medium text-[var(--text-soft)]">
                      解除綁定
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="rounded-[14px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">最低點 X / Y（原始）</div>
                    <div className="mt-1 font-mono text-sm text-[var(--text-main)]">
                      {anchorMinimum ? `${anchorMinimum.x.toFixed(4)} / ${anchorMinimum.y.toFixed(4)}` : '未找到'}
                    </div>
                  </div>
                  {anchorMinimum && (
                    <div className="rounded-[14px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-3 py-2.5">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">扣除後殘值（接近 0 即可）</div>
                      <div className="mt-1 font-mono text-sm text-[var(--text-main)]">
                        {boundPointResidual != null ? boundPointResidual.toFixed(4) : '—'}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Gaussian centers */}
              <div className="theme-block rounded-[20px] p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-[var(--text-muted)]">高斯中心</div>
                  <button type="button"
                    onClick={() => setGaussianCenters(prev => [
                      ...prev,
                      { enabled: true, name: `Peak ${prev.length + 1}`, center: prev[prev.length - 1]?.center ?? 30 },
                    ])}
                    className="theme-pill pressable rounded-xl px-3 py-1.5 text-xs font-medium text-[var(--accent)]">
                    新增中心
                  </button>
                </div>
                <div className="space-y-3">
                  {gaussianCenters.map((center, idx) => {
                    const isLocked = bindCurveToMinimum && lockedCenterIndex === idx
                    const displayCenter = isLocked && anchorMinimum ? anchorMinimum.x : center.center
                    return (
                      <div key={`c-${idx}`} className="rounded-[16px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[var(--text-main)]">中心 {idx + 1}</span>
                            {isLocked && (
                              <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent-secondary)_18%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-secondary)]">鎖定</span>
                            )}
                          </div>
                          {gaussianCenters.length > 1 && (
                            <button type="button"
                              onClick={() => setGaussianCenters(prev => prev.filter((_, i) => i !== idx))}
                              className="text-xs text-[var(--accent-secondary)]">
                              刪除
                            </button>
                          )}
                        </div>
                        <div className="space-y-2">
                          <input type="text" value={center.name}
                            onChange={e => setGaussianCenters(prev => prev.map((c, i) => i === idx ? { ...c, name: e.target.value } : c))}
                            className="theme-input w-full rounded-xl px-3 py-1.5 text-xs" />
                          <SliderRow
                            label="中心位置"
                            value={displayCenter}
                            min={gSliderXMin} max={gSliderXMax} step={0.01} decimals={2}
                            disabled={isLocked}
                            onChange={v => {
                              if (isLocked) return
                              setGaussianCenters(prev => prev.map((c, i) => i === idx ? { ...c, center: v } : c))
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

            </div>
          )}
        </div>
      </aside>

      {/* ════════════════════════════ RIGHT MAIN ════════════════════════════ */}
      <main className="flex flex-1 flex-col overflow-y-auto p-4 sm:p-5">
        <div className="space-y-4">

          {/* Status bar */}
          <div className="glass-panel rounded-[24px] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-[var(--text-muted)]">處理結果</div>
                <div className="mt-1 text-xs text-[var(--text-soft)]">
                  {tool === 'gaussian' && !bindCurveToMinimum && '上圖：原始 + 即時預覽；下圖：按「套用」後更新。'}
                  {tool === 'gaussian' && bindCurveToMinimum && '鎖定模式：下圖由前端即時計算（精確切過最低點），無需按套用。'}
                  {tool === 'background' && '上圖：原始 + 背景基準線；下圖：扣背景後結果。'}
                  {tool === 'normalize' && '原始訊號與歸一化後曲線同圖對比。'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeDataset && (
                  <button type="button" onClick={handleExport}
                    className="theme-pill pressable rounded-xl px-4 py-2 text-sm font-medium text-[var(--accent)]">
                    匯出 CSV
                  </button>
                )}
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
              <div className="theme-block-soft flex min-h-[22rem] flex-col items-center justify-center rounded-[20px] px-6 text-center">
                <div className="mb-4 text-5xl" style={{ color: meta.accent }}>◌</div>
                <div className="text-xl font-semibold text-[var(--text-muted)]">先上傳檔案</div>
                <div className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-soft)]">
                  {meta.description}
                </div>
              </div>
            </div>
          )}

          {/* Chart 1: raw + preview */}
          {activeDataset && (
            <div className="glass-panel rounded-[24px] p-4">
              <div className="mb-2 flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                  {tool === 'gaussian' ? '原始訊號 + 高斯模型（即時）' : tool === 'background' ? '原始訊號 + 背景基準線' : '處理前後'}
                </span>
                {isLoading && (
                  <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">更新中…</span>
                )}
              </div>
              <Plot data={beforeTraces} layout={beforeLayout} config={plotConfig}
                style={{ width: '100%', minHeight: '360px' }} useResizeHandler />
            </div>
          )}

          {/* Chart 2: after subtraction */}
          {activeDataset && showTwoCharts && (afterTraces.length > 0 || (tool === 'gaussian' && !bindCurveToMinimum)) && (
            <div className="glass-panel rounded-[24px] p-4">
              <div className="mb-2 flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                  {tool === 'gaussian'
                    ? bindCurveToMinimum ? '高斯扣除後（即時，前端計算）' : '高斯扣除後（後端）'
                    : '扣背景後結果'}
                </span>
                {isLoading && tool === 'gaussian' && !bindCurveToMinimum && (
                  <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">計算中…</span>
                )}
                {tool === 'gaussian' && !bindCurveToMinimum && !activeDataset.y_gaussian_subtracted && (
                  <span className="text-[11px] text-[var(--text-soft)]">按左側「套用到扣除結果」顯示</span>
                )}
                {tool === 'gaussian' && activeDataset.gaussian_guard_enabled && activeDataset.gaussian_guard_applied && (
                  <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent-strong)_14%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-strong)]">
                    保護已介入 × {(activeDataset.gaussian_guard_scale ?? 1).toFixed(2)}
                  </span>
                )}
              </div>
              {afterTraces.length > 0 ? (
                <Plot data={afterTraces} layout={afterLayout} config={plotConfig}
                  style={{ width: '100%', minHeight: '360px' }} useResizeHandler />
              ) : (
                <div className="flex min-h-[200px] items-center justify-center rounded-[18px] border border-dashed border-[var(--card-border)] text-sm text-[var(--text-soft)]">
                  按左側「套用到扣除結果」查看
                </div>
              )}

              {/* Gaussian fit table */}
              {tool === 'gaussian' && activeDataset.gaussian_fits.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                        <th className="px-3 py-3 font-medium">峰名稱</th>
                        <th className="px-3 py-3 font-medium">初始中心</th>
                        <th className="px-3 py-3 font-medium">擬合中心</th>
                        <th className="px-3 py-3 font-medium">位移</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDataset.gaussian_fits.map((row, idx) => (
                        <tr key={`fit-${idx}`} className="border-b border-white/5 text-[var(--text-main)] last:border-b-0">
                          <td className="px-3 py-3">{row.Peak_Name}</td>
                          <td className="px-3 py-3">{row.Seed_Center.toFixed(4)}</td>
                          <td className="px-3 py-3">{row.Fitted_Center.toFixed(4)}</td>
                          <td className="px-3 py-3">{row.Shift.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  )
}
