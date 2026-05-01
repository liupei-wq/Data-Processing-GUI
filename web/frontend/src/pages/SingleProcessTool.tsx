import { useCallback, useEffect, useMemo, useState } from 'react'
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
  tool: SingleToolKind,
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

function SliderRow({
  label, value, min, max, step, decimals = 3, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; decimals?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-soft)]">{label}</span>
        <span className="font-mono text-xs text-[var(--text-main)]">{value.toFixed(decimals)}</span>
      </div>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
      <input type="range" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full cursor-pointer" style={{ accentColor: 'var(--accent-strong)' }} />
    </div>
  )
}

export default function SingleProcessTool({ tool }: { tool: SingleToolKind }) {
  const meta = TOOL_META[tool]
  const [rawFiles, setRawFiles] = useState<ParsedFile[]>([])
  const [result, setResult] = useState<ProcessedDataset[]>([])
  const [selectedDatasetName, setSelectedDatasetName] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [backgroundMethod, setBackgroundMethod] = useState<BackgroundMethod>('linear')
  const [bgRangeStart, setBgRangeStart] = useState<number | null>(null)
  const [bgRangeEnd, setBgRangeEnd] = useState<number | null>(null)
  const [bgPolyDeg, setBgPolyDeg] = useState(3)
  const [bgLambdaExp, setBgLambdaExp] = useState(5)
  const [bgP, setBgP] = useState(0.01)
  const [bgIter, setBgIter] = useState(20)

  const [normalizeMethod, setNormalizeMethod] = useState<NormalizeMethod>('min_max')
  const [normStart, setNormStart] = useState<number | null>(null)
  const [normEnd, setNormEnd] = useState<number | null>(null)

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

  useEffect(() => {
    setRawFiles([])
    setResult([])
    setSelectedDatasetName('')
    setError(null)
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

  const activeDataset = result.find(d => d.name === selectedDatasetName) ?? result[0] ?? null

  // Minimum point in the raw data within the specified range
  const anchorMinimum = useMemo(
    () => tool === 'gaussian' && activeDataset
      ? findMinimumInRange(activeDataset.x, activeDataset.y_raw, minimumRangeStart, minimumRangeEnd)
      : null,
    [tool, activeDataset, minimumRangeStart, minimumRangeEnd],
  )

  // Index of the nearest center to the minimum point
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

  // When locked: move the nearest center onto the minimum point
  const effectiveGaussianCenters = useMemo(() => {
    if (!bindCurveToMinimum || !anchorMinimum || lockedCenterIndex == null) return gaussianCenters
    return gaussianCenters.map((c, i) =>
      i === lockedCenterIndex ? { ...c, center: anchorMinimum.x } : c,
    )
  }, [bindCurveToMinimum, anchorMinimum, gaussianCenters, lockedCenterIndex])

  // When locked: height = y_min / (sum of unit-gaussians evaluated at x_min)
  // This ensures the combined Gaussian model passes exactly through the minimum point.
  // Clamp to 0 so height is never negative when y_min <= 0.
  const effectiveGaussianHeight = useMemo(() => {
    if (!bindCurveToMinimum || !anchorMinimum || gaussianFwhm <= 0) return gaussianHeight
    const sigma = gaussianFwhm / (2 * Math.sqrt(2 * Math.log(2)))
    const totalAttenuation = effectiveGaussianCenters
      .filter(c => c.enabled && Number.isFinite(c.center))
      .reduce((sum, c) => sum + Math.exp(-0.5 * ((anchorMinimum.x - c.center) / sigma) ** 2), 0)
    if (totalAttenuation <= 1e-9) return gaussianHeight
    return Math.max(anchorMinimum.y / totalAttenuation, 0)
  }, [bindCurveToMinimum, gaussianHeight, anchorMinimum, gaussianFwhm, effectiveGaussianCenters])

  // Residual at the minimum point after Gaussian subtraction
  const boundPointResidual = useMemo(() => {
    if (!anchorMinimum || !activeDataset?.y_gaussian_subtracted) return null
    const v = activeDataset.y_gaussian_subtracted[anchorMinimum.index]
    return v != null && Number.isFinite(v) ? v : null
  }, [anchorMinimum, activeDataset])

  const params = buildParams(
    tool,
    backgroundMethod, bgRangeStart, bgRangeEnd, bgPolyDeg, bgLambdaExp, bgP, bgIter,
    normalizeMethod, normStart, normEnd,
    gaussianFwhm,
    effectiveGaussianHeight,
    bindCurveToMinimum ? false : gaussianNonnegativeGuard,
    gaussianSearchHalfWidth,
    effectiveGaussianCenters,
  )

  const [debouncedParams, setDebouncedParams] = useState(params)
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedParams(params), tool === 'gaussian' ? 150 : 80)
    return () => window.clearTimeout(t)
  }, [params, tool])

  useEffect(() => {
    if (rawFiles.length === 0) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    processData(rawFiles, debouncedParams)
      .then(r => { if (!cancelled) setResult(r.datasets) })
      .catch(e => { if (!cancelled) setError(String((e as Error).message)) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [rawFiles, debouncedParams])

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
      }
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Slider bounds derived from loaded data
  const gSliderXMin = rawFiles.length > 0 ? Math.min(...rawFiles.flatMap(f => f.x)) : 0
  const gSliderXMax = rawFiles.length > 0 ? Math.max(...rawFiles.flatMap(f => f.x)) : 180
  const gSliderXRange = Math.max(gSliderXMax - gSliderXMin, 1)
  const gSliderYMax = rawFiles.length > 0 ? Math.max(...rawFiles.flatMap(f => f.y)) : 10000
  const fwhmSliderMax = Math.max(gSliderXRange / 4, 2)
  const searchHwSliderMax = Math.max(gSliderXRange / 2, 5)
  const heightSliderMax = Math.max(gSliderYMax * 1.5, 1)

  // Chart 1 ("before"): raw + gaussian model / background line + minimum marker
  const beforeTraces = useMemo((): Plotly.Data[] => {
    if (!activeDataset) return []
    const traces: Plotly.Data[] = [{
      x: activeDataset.x, y: activeDataset.y_raw,
      type: 'scatter', mode: 'lines', name: '原始',
      line: { color: '#94a3b8', width: 1.7 },
    }]
    if (tool === 'gaussian' && activeDataset.y_gaussian_model) {
      traces.push({
        x: activeDataset.x, y: activeDataset.y_gaussian_model,
        type: 'scatter', mode: 'lines', name: '高斯模型（被扣除）',
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
  }, [activeDataset, tool, anchorMinimum])

  // Chart 2 ("after"): result after subtraction
  const afterTraces = useMemo((): Plotly.Data[] => {
    if (!activeDataset) return []
    if (tool === 'gaussian' && activeDataset.y_gaussian_subtracted) {
      return [{
        x: activeDataset.x, y: activeDataset.y_gaussian_subtracted,
        type: 'scatter', mode: 'lines', name: '扣高斯後',
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
  }, [activeDataset, tool])

  const beforeLayout = useMemo(() => {
    const base = chartLayout()
    base.dragmode = 'zoom'
    base.uirevision = `${tool}:${selectedDatasetName || 'default'}:before`
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
    base.uirevision = `${tool}:${selectedDatasetName || 'default'}:after`
    return base
  }, [tool, selectedDatasetName])

  const handleExport = useCallback(() => {
    if (!activeDataset) return
    const csv = buildSingleToolCsv(tool, activeDataset, minimumRangeStart, minimumRangeEnd, anchorMinimum)
    downloadFile(csv, `${activeDataset.name.replace(/\.[^.]+$/, '')}_${tool}_processed.csv`, 'text/csv;charset=utf-8')
  }, [activeDataset, tool, minimumRangeStart, minimumRangeEnd, anchorMinimum])

  const showTwoCharts = tool === 'gaussian' || tool === 'background'
  const plotConfig = withPlotFullscreen({ scrollZoom: false, displayModeBar: true, doubleClick: 'reset+autosize' })

  return (
    <div className="px-5 py-8 sm:px-8 xl:px-10 xl:py-10">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-soft)]">單一處理工具</div>
            <h1 className="font-display text-4xl font-semibold text-[var(--text-muted)]">{meta.title}</h1>
            <p className="mt-2 text-base text-[var(--text-soft)]">{meta.subtitle}</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-soft)]">{meta.description}</p>
          </div>
          <div className="theme-pill rounded-[22px] px-4 py-3 text-sm text-[var(--text-main)] shadow-[var(--card-shadow-soft)]">
            上傳檔案後只執行這一個處理，不帶完整流程其他步驟。
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
          {/* ── Sidebar ── */}
          <aside className="glass-panel rounded-[30px] p-4 sm:p-5 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto">
            <div className="theme-block mb-4 overflow-hidden rounded-[24px]">
              <div className="border-b border-[var(--card-divider)] px-4 py-3">
                <div className="text-sm font-semibold text-[var(--text-muted)]">上傳檔案</div>
                <div className="mt-1 text-[11px] text-[var(--text-soft)]">每個工具頁都能直接上傳與預覽</div>
              </div>
              <div className="p-4">
                <FileUpload onFiles={handleFiles} isLoading={isLoading} />
                {rawFiles.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {rawFiles.map(f => (
                      <div key={f.name} className="theme-block-soft rounded-[16px] px-3 py-2 text-xs text-[var(--text-main)]">{f.name}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {tool === 'background' && (
              <div className="theme-block rounded-[24px] p-4">
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

            {tool === 'normalize' && (
              <div className="theme-block rounded-[24px] p-4">
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

            {tool === 'gaussian' && (
              <div className="space-y-4">
                {/* Template controls */}
                <div className="theme-block rounded-[24px] p-4">
                  <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">高斯模板調整</div>
                  <label className="mb-4 flex items-start gap-3 rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-4 py-3 text-sm text-[var(--text-main)]">
                    <input type="checkbox" checked={gaussianNonnegativeGuard}
                      onChange={e => setGaussianNonnegativeGuard(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-[var(--card-border)]"
                      style={{ accentColor: 'var(--accent-strong)' }}
                    />
                    <span className="leading-6">
                      啟用避免負值保護
                      <span className="block text-xs text-[var(--text-soft)]">
                        扣除量超過原始訊號時，系統會自動縮小高斯模板，避免整段掉到 0 以下。
                      </span>
                    </span>
                  </label>
                  <div className="space-y-4">
                    <SliderRow label="固定 FWHM" value={gaussianFwhm}
                      min={0.001} max={fwhmSliderMax} step={0.01} decimals={2}
                      onChange={setGaussianFwhm} />
                    {bindCurveToMinimum ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--text-soft)]">固定高度（自動）</span>
                          <span className="font-mono text-xs text-[var(--text-main)]">{effectiveGaussianHeight.toFixed(3)}</span>
                        </div>
                        <div className="rounded-[14px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-3 py-2 text-xs text-[var(--text-soft)]">
                          已鎖定，高度自動計算使曲線切過最低點。
                        </div>
                      </div>
                    ) : (
                      <SliderRow label="固定高度" value={gaussianHeight}
                        min={0} max={heightSliderMax} step={0.01} decimals={2}
                        onChange={setGaussianHeight} />
                    )}
                    <SliderRow label="搜尋半寬" value={gaussianSearchHalfWidth}
                      min={0.001} max={searchHwSliderMax} step={0.01} decimals={2}
                      onChange={setGaussianSearchHalfWidth} />
                  </div>
                </div>

                {/* Minimum range + lock */}
                <div className="theme-block rounded-[24px] p-4">
                  <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">最低點搜尋區間</div>
                  <div className="grid grid-cols-2 gap-3 mb-4">
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
                  <div className="flex flex-wrap gap-3 mb-4">
                    <button type="button"
                      onClick={() => setBindCurveToMinimum(true)}
                      disabled={!anchorMinimum}
                      className={[
                        'theme-pill pressable rounded-xl px-4 py-2 text-sm font-medium transition-all',
                        bindCurveToMinimum ? 'text-[var(--accent-secondary)]' : 'text-[var(--accent)]',
                        !anchorMinimum ? 'cursor-not-allowed opacity-50' : '',
                      ].join(' ')}
                    >
                      {bindCurveToMinimum ? '✓ 已鎖定最低點' : '鎖定到最低點'}
                    </button>
                    {bindCurveToMinimum && (
                      <button type="button"
                        onClick={() => setBindCurveToMinimum(false)}
                        className="theme-pill pressable rounded-xl px-4 py-2 text-sm font-medium text-[var(--text-soft)]"
                      >
                        解除綁定
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3">
                    <div className="rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-soft)]">最低點 X / Y（原始）</div>
                      <div className="mt-1.5 font-mono text-sm text-[var(--text-main)]">
                        {anchorMinimum ? `${anchorMinimum.x.toFixed(4)} / ${anchorMinimum.y.toFixed(4)}` : '未找到'}
                      </div>
                    </div>
                    {bindCurveToMinimum && (
                      <div className="rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-soft)]">扣除後該點殘值 Y</div>
                        <div className="mt-1.5 font-mono text-sm text-[var(--text-main)]">
                          {boundPointResidual != null ? boundPointResidual.toFixed(4) : '—'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Gaussian centers */}
                <div className="theme-block rounded-[24px] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text-muted)]">高斯中心</div>
                    <button type="button"
                      onClick={() => setGaussianCenters(prev => [
                        ...prev,
                        { enabled: true, name: `Peak ${prev.length + 1}`, center: prev[prev.length - 1]?.center ?? 30 },
                      ])}
                      className="theme-pill pressable rounded-xl px-3 py-2 text-sm font-medium text-[var(--accent)]"
                    >
                      新增中心
                    </button>
                  </div>
                  <div className="space-y-3">
                    {gaussianCenters.map((center, idx) => (
                      <div key={`center-${idx}`} className="rounded-[20px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-semibold text-[var(--text-main)]">中心 {idx + 1}</div>
                            {bindCurveToMinimum && lockedCenterIndex === idx && (
                              <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent-secondary)_18%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-secondary)]">
                                已鎖定
                              </span>
                            )}
                          </div>
                          {gaussianCenters.length > 1 && (
                            <button type="button"
                              onClick={() => setGaussianCenters(prev => prev.filter((_, i) => i !== idx))}
                              className="text-xs text-[var(--accent-secondary)]"
                            >
                              刪除
                            </button>
                          )}
                        </div>
                        <div className="space-y-3">
                          <input type="text" value={center.name}
                            onChange={e => setGaussianCenters(prev => prev.map((c, i) => i === idx ? { ...c, name: e.target.value } : c))}
                            className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                          <SliderRow
                            label="中心位置"
                            value={bindCurveToMinimum && lockedCenterIndex === idx && anchorMinimum
                              ? anchorMinimum.x
                              : center.center}
                            min={gSliderXMin} max={gSliderXMax} step={0.01} decimals={2}
                            onChange={v => {
                              if (bindCurveToMinimum && lockedCenterIndex === idx) return
                              setGaussianCenters(prev => prev.map((c, i) => i === idx ? { ...c, center: v } : c))
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </aside>

          {/* ── Main content ── */}
          <section className="space-y-5">
            {/* Header bar */}
            <div className="glass-panel rounded-[30px] p-4 sm:p-5 lg:p-6">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-muted)]">處理結果</div>
                  <div className="mt-1 text-xs text-[var(--text-soft)]">
                    {tool === 'gaussian' && '原始訊號與高斯模型顯示在上方圖，扣除後的結果顯示在下方圖。'}
                    {tool === 'background' && '上方圖顯示原始訊號與背景基準線，下方圖顯示扣除後結果。'}
                    {tool === 'normalize' && '原始訊號與歸一化後曲線同圖比對。'}
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  {activeDataset && (
                    <button type="button" onClick={handleExport}
                      className="theme-pill pressable rounded-xl px-4 py-2 text-sm font-medium text-[var(--accent)]">
                      匯出處理 CSV
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
                <div className="mb-4 rounded-[18px] border border-[color:color-mix(in_srgb,var(--accent-secondary)_28%,var(--card-border))] bg-[color:color-mix(in_srgb,var(--accent-secondary)_12%,transparent)] px-4 py-3 text-sm text-[var(--text-main)]">
                  {error}
                </div>
              )}

              {!activeDataset && !isLoading && (
                <div className="theme-block-soft flex min-h-[28rem] flex-col items-center justify-center rounded-[28px] px-6 text-center">
                  <div className="mb-4 text-5xl" style={{ color: meta.accent }}>◌</div>
                  <div className="text-xl font-semibold text-[var(--text-muted)]">先上傳檔案</div>
                  <div className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-soft)]">
                    這個工具頁只做 {meta.title}。把檔案拖進左側區塊後，右邊會立即顯示處理結果。
                  </div>
                </div>
              )}

              {isLoading && (
                <div className="theme-pill inline-flex rounded-full px-4 py-2 text-sm font-medium text-[var(--accent)]">
                  處理中…
                </div>
              )}

              {/* Chart 1: before */}
              {activeDataset && (
                <div className="theme-block-soft rounded-[28px] p-3 sm:p-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                    {tool === 'gaussian' ? '原始訊號 + 高斯模型' : tool === 'background' ? '原始訊號 + 背景基準線' : '處理前後對比'}
                  </div>
                  {tool === 'gaussian' && activeDataset.gaussian_guard_enabled && (
                    <div className="mb-3 rounded-[18px] border border-[color:color-mix(in_srgb,var(--accent-strong)_24%,var(--card-border))] bg-[color:color-mix(in_srgb,var(--accent-strong)_12%,transparent)] px-4 py-3 text-sm text-[var(--text-main)]">
                      {activeDataset.gaussian_guard_applied
                        ? `避免負值保護已介入，高斯模板縮放為 ${(activeDataset.gaussian_guard_scale ?? 1).toFixed(2)}x。`
                        : '避免負值保護已啟用，目前這組參數不需要額外縮放。'}
                    </div>
                  )}
                  <Plot data={beforeTraces} layout={beforeLayout} config={plotConfig}
                    style={{ width: '100%', minHeight: '420px' }} useResizeHandler />
                </div>
              )}
            </div>

            {/* Chart 2: after (gaussian / background) */}
            {activeDataset && showTwoCharts && afterTraces.length > 0 && (
              <div className="glass-panel rounded-[30px] p-4 sm:p-5 lg:p-6">
                <div className="theme-block-soft rounded-[28px] p-3 sm:p-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                    {tool === 'gaussian' ? '高斯扣除後結果' : '扣背景後結果'}
                  </div>
                  <Plot data={afterTraces} layout={afterLayout} config={plotConfig}
                    style={{ width: '100%', minHeight: '420px' }} useResizeHandler />
                </div>
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
          </section>
        </div>
      </div>
    </div>
  )
}
