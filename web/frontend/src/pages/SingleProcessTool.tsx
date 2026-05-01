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

const TOOL_META: Record<SingleToolKind, {
  title: string
  subtitle: string
  description: string
  accent: string
}> = {
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

function gaussianUnitProfile(x: number[], center: number, fwhm: number): number[] {
  const safeFwhm = Math.max(fwhm, 1e-6)
  const sigma = safeFwhm / (2 * Math.sqrt(2 * Math.log(2)))
  return x.map(value => Math.exp(-0.5 * ((value - center) / sigma) ** 2))
}

function findMinimumInRange(x: number[], y: number[], start: number, end: number): RangeMinimum | null {
  const rangeStart = Math.min(start, end)
  const rangeEnd = Math.max(start, end)
  let best: RangeMinimum | null = null
  for (let idx = 0; idx < x.length; idx += 1) {
    const xv = x[idx]
    const yv = y[idx]
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue
    if (xv < rangeStart || xv > rangeEnd) continue
    if (!best || yv < best.y) best = { x: xv, y: yv, index: idx }
  }
  return best
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function buildSingleToolCsv(
  tool: SingleToolKind,
  dataset: ProcessedDataset,
  rangeStart: number,
  rangeEnd: number,
  minimum: RangeMinimum | null,
): string {
  const header = [
    'x',
    'raw',
    'background',
    'gaussian_model',
    'gaussian_subtracted',
    'processed',
  ]
  const rows = dataset.x.map((xv, idx) => [
    xv.toFixed(6),
    dataset.y_raw[idx]?.toFixed(6) ?? '',
    dataset.y_background?.[idx]?.toFixed(6) ?? '',
    dataset.y_gaussian_model?.[idx]?.toFixed(6) ?? '',
    dataset.y_gaussian_subtracted?.[idx]?.toFixed(6) ?? '',
    dataset.y_processed[idx]?.toFixed(6) ?? '',
  ])

  const summary = minimum
    ? [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        `minimum_range_${rangeStart.toFixed(3)}_${rangeEnd.toFixed(3)}`,
        minimum.x.toFixed(6),
        minimum.y.toFixed(6),
      ]
    : ['', '', '', '', '', '', '', `minimum_range_${rangeStart.toFixed(3)}_${rangeEnd.toFixed(3)}`, 'not_found', '']

  return [
    header.join(','),
    ...rows.map(row => row.join(',')),
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
  const base: ProcessParams = {
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
  return base
}

function buildTraces(
  tool: SingleToolKind,
  dataset: ProcessedDataset,
  minimumPoint?: RangeMinimum | null,
): Plotly.Data[] {
  const traces: Plotly.Data[] = [
    {
      x: dataset.x,
      y: dataset.y_raw,
      type: 'scatter',
      mode: 'lines',
      name: '原始',
      line: { color: '#94a3b8', width: 1.7 },
    },
  ]

  if (tool === 'background' && dataset.y_background) {
    traces.push({
      x: dataset.x,
      y: dataset.y_background,
      type: 'scatter',
      mode: 'lines',
      name: '背景基準線',
      line: { color: '#f97316', width: 1.6, dash: 'dot' },
    })
    traces.push({
      x: dataset.x,
      y: dataset.y_processed,
      type: 'scatter',
      mode: 'lines',
      name: '扣背景後',
      line: { color: '#38bdf8', width: 2.2 },
    })
  } else if (tool === 'gaussian' && dataset.y_gaussian_model && dataset.y_gaussian_subtracted) {
    traces.push({
      x: dataset.x,
      y: dataset.y_gaussian_model,
      type: 'scatter',
      mode: 'lines',
      name: '被扣掉的高斯曲線',
      line: { color: '#f97316', width: 2.4, dash: 'dash' },
    })
    traces.push({
      x: dataset.x,
      y: dataset.y_gaussian_subtracted,
      type: 'scatter',
      mode: 'lines',
      name: '扣高斯後',
      line: { color: '#38bdf8', width: 2.2 },
    })
  } else {
    traces.push({
      x: dataset.x,
      y: dataset.y_processed,
      type: 'scatter',
      mode: 'lines',
      name: tool === 'normalize' ? '歸一化後' : '處理後',
      line: { color: '#38bdf8', width: 2.2 },
    })
  }

  if (tool === 'gaussian' && minimumPoint) {
    traces.push({
      x: [minimumPoint.x],
      y: [minimumPoint.y],
      type: 'scatter',
      mode: 'markers',
      name: '403–406 最低點',
      marker: {
        color: '#fb7185',
        size: 11,
        line: { color: '#fff1f2', width: 1.5 },
      },
    })
  }

  return traces
}

function chartLayout(): Partial<Plotly.Layout> {
  const cssVars = typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement)
    : null
  const chartGrid = cssVars?.getPropertyValue('--chart-grid').trim() || 'rgba(148, 163, 184, 0.14)'
  const chartText = cssVars?.getPropertyValue('--chart-text').trim() || '#d9e4f0'
  const chartBg = cssVars?.getPropertyValue('--chart-bg').trim() || 'rgba(15, 23, 42, 0.52)'
  const chartLegendBg = cssVars?.getPropertyValue('--chart-legend-bg').trim() || 'rgba(15, 23, 42, 0.72)'
  const chartHoverBg = cssVars?.getPropertyValue('--chart-hover-bg').trim() || 'rgba(15, 23, 42, 0.95)'
  const chartHoverBorder = cssVars?.getPropertyValue('--chart-hover-border').trim() || 'rgba(148, 163, 184, 0.22)'

  return {
    xaxis: {
      title: { text: 'X' },
      showgrid: true,
      gridcolor: chartGrid,
      zeroline: false,
      color: chartText,
    },
    yaxis: {
      title: { text: 'Intensity' },
      showgrid: true,
      gridcolor: chartGrid,
      zeroline: false,
      color: chartText,
    },
    legend: {
      x: 1,
      xanchor: 'right',
      y: 1,
      bgcolor: chartLegendBg,
      bordercolor: chartHoverBorder,
      borderwidth: 1,
      font: { color: chartText },
    },
    margin: { l: 60, r: 20, t: 28, b: 58 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: chartBg,
    font: { color: chartText },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: chartHoverBg,
      bordercolor: chartHoverBorder,
      font: { color: chartText },
    },
    autosize: true,
  }
}

function SliderRow({
  label, value, min, max, step, decimals = 3, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; decimals?: number; onChange: (v: number) => void
}) {
  const fmt = (v: number) => v.toFixed(decimals)
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commitValue = useCallback((raw: string) => {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(Math.max(parsed, min), max)
    setDraft(String(clamped))
    if (Math.abs(clamped - value) > step / 10) onChange(clamped)
  }, [max, min, onChange, step, value])

  const displayValue = Number.isFinite(Number(draft)) ? Number(draft) : value

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-soft)]">{label}</span>
        <span className="font-mono text-xs text-[var(--text-main)]">{fmt(displayValue)}</span>
      </div>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => commitValue(draft)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitValue(draft)
          }
        }}
        className="theme-input w-full rounded-xl px-3 py-2 text-sm"
      />
      <input
        type="range"
        value={displayValue}
        min={min}
        max={max}
        step={step}
        onChange={e => setDraft(e.target.value)}
        onMouseUp={() => commitValue(draft)}
        onTouchEnd={() => commitValue(draft)}
        onKeyUp={() => commitValue(draft)}
        className="w-full cursor-pointer"
        style={{ accentColor: 'var(--accent-strong)' }}
      />
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
    if (result.length === 0) {
      setSelectedDatasetName('')
      return
    }
    const matched = result.some(dataset => dataset.name === selectedDatasetName)
    if (!matched) setSelectedDatasetName(result[0].name)
  }, [result, selectedDatasetName])

  const activeDataset =
    result.find(dataset => dataset.name === selectedDatasetName) ??
    result[0] ??
    null

  const anchorMinimum = useMemo(
    () => (
      tool === 'gaussian' && activeDataset
        ? findMinimumInRange(activeDataset.x, activeDataset.y_raw, minimumRangeStart, minimumRangeEnd)
        : null
    ),
    [tool, activeDataset, minimumRangeStart, minimumRangeEnd],
  )

  const effectiveGaussianHeight = useMemo(() => {
    if (!bindCurveToMinimum) return gaussianHeight
    const firstCenter = gaussianCenters[0]?.center
    if (firstCenter == null || !anchorMinimum || gaussianFwhm <= 0) return gaussianHeight
    const sigma = gaussianFwhm / (2 * Math.sqrt(2 * Math.log(2)))
    const attenuation = Math.exp(-0.5 * ((anchorMinimum.x - firstCenter) / sigma) ** 2)
    if (!Number.isFinite(attenuation) || attenuation <= 1e-9) return gaussianHeight
    return Math.max(anchorMinimum.y / attenuation, 0)
  }, [bindCurveToMinimum, gaussianHeight, gaussianCenters, anchorMinimum, gaussianFwhm])

  const params = buildParams(
    tool,
    backgroundMethod,
    bgRangeStart,
    bgRangeEnd,
    bgPolyDeg,
    bgLambdaExp,
    bgP,
    bgIter,
    normalizeMethod,
    normStart,
    normEnd,
    gaussianFwhm,
    effectiveGaussianHeight,
    gaussianNonnegativeGuard,
    gaussianSearchHalfWidth,
    gaussianCenters,
  )

  const [debouncedParams, setDebouncedParams] = useState(params)

  useEffect(() => {
    const debounceMs = tool === 'gaussian' ? 180 : 80
    const timer = window.setTimeout(() => {
      setDebouncedParams(params)
    }, debounceMs)
    return () => {
      window.clearTimeout(timer)
    }
  }, [params, tool])

  useEffect(() => {
    if (rawFiles.length === 0) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    processData(rawFiles, debouncedParams)
      .then(response => {
        if (cancelled) return
        setResult(response.datasets)
      })
      .catch(e => {
        if (!cancelled) setError(String((e as Error).message))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
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

  const gSliderXMin = rawFiles.length > 0 ? Math.min(...rawFiles.flatMap(f => f.x)) : 0
  const gSliderXMax = rawFiles.length > 0 ? Math.max(...rawFiles.flatMap(f => f.x)) : 180
  const gSliderXRange = Math.max(gSliderXMax - gSliderXMin, 1)
  const gSliderYMax = rawFiles.length > 0 ? Math.max(...rawFiles.flatMap(f => f.y)) : 10000
  const fwhmSliderMax = Math.max(gSliderXRange / 4, 2)
  const fwhmSliderStep = 0.01
  const heightSliderStep = 0.01
  const searchHwSliderMax = Math.max(gSliderXRange / 2, 5)
  const searchHwSliderStep = 0.01
  const centerSliderStep = 0.01
  const gaussianSafeHeightMax = useMemo(() => {
    if (tool !== 'gaussian' || !activeDataset || gaussianFwhm <= 0) return null

    const enabledCenters = gaussianCenters.filter(center => center.enabled && Number.isFinite(center.center))
    if (enabledCenters.length === 0) return null

    const totalUnitModel = new Array(activeDataset.x.length).fill(0)
    for (const center of enabledCenters) {
      const unit = gaussianUnitProfile(activeDataset.x, center.center, gaussianFwhm)
      for (let idx = 0; idx < unit.length; idx += 1) totalUnitModel[idx] += unit[idx]
    }

    const maxUnit = Math.max(...totalUnitModel, 0)
    if (!Number.isFinite(maxUnit) || maxUnit <= 0) return null

    let minRatio = Number.POSITIVE_INFINITY
    for (let idx = 0; idx < totalUnitModel.length; idx += 1) {
      const modelValue = totalUnitModel[idx]
      const rawValue = activeDataset.y_raw[idx]
      if (!Number.isFinite(modelValue) || !Number.isFinite(rawValue)) continue
      if (modelValue <= maxUnit * 1e-4) continue
      if (rawValue < 0) continue
      minRatio = Math.min(minRatio, rawValue / modelValue)
    }

    if (!Number.isFinite(minRatio)) return null
    return Math.max(Math.floor(Math.max(minRatio, 0.01) * 100) / 100, 0.01)
  }, [tool, activeDataset, gaussianCenters, gaussianFwhm])
  const gaussianHeightSliderMax = gaussianNonnegativeGuard
    ? Math.max(gaussianSafeHeightMax ?? 0.01, 0.01)
    : Math.max(gSliderYMax, 1)

  useEffect(() => {
    if (tool !== 'gaussian' || !gaussianNonnegativeGuard || bindCurveToMinimum) return
    if (gaussianSafeHeightMax == null) return
    if (gaussianHeight > gaussianSafeHeightMax) {
      setGaussianHeight(gaussianSafeHeightMax)
    }
  }, [tool, gaussianNonnegativeGuard, bindCurveToMinimum, gaussianSafeHeightMax, gaussianHeight])

  const gaussianMinTargetY = activeDataset?.y_gaussian_subtracted ?? activeDataset?.y_processed ?? null
  const autoBoundGaussianHeight = useMemo(() => {
    if (tool !== 'gaussian' || !anchorMinimum || gaussianFwhm <= 0) return null
    const firstCenter = gaussianCenters[0]?.center
    if (firstCenter == null || !Number.isFinite(firstCenter)) return null
    const sigma = gaussianFwhm / (2 * Math.sqrt(2 * Math.log(2)))
    const attenuation = Math.exp(-0.5 * ((anchorMinimum.x - firstCenter) / sigma) ** 2)
    if (!Number.isFinite(attenuation) || attenuation <= 1e-9) return null
    return Math.max(anchorMinimum.y / attenuation, 0)
  }, [tool, anchorMinimum, gaussianCenters, gaussianFwhm])
  const boundPointResidual = useMemo(
    () => (anchorMinimum && gaussianMinTargetY ? gaussianMinTargetY[anchorMinimum.index] ?? null : null),
    [anchorMinimum, gaussianMinTargetY],
  )
  const plotTraces = useMemo(
    () => (activeDataset ? buildTraces(tool, activeDataset, anchorMinimum) : []),
    [activeDataset, tool, anchorMinimum],
  )

  const plotLayout = useMemo(() => {
    const base = chartLayout()
    base.dragmode = 'zoom'
    base.uirevision = `${tool}:${selectedDatasetName || 'default'}`
    base.xaxis = {
      ...base.xaxis,
      fixedrange: false,
    }
    base.yaxis = {
      ...base.yaxis,
      fixedrange: false,
    }
    if (tool === 'gaussian') {
      base.shapes = [
        {
          type: 'rect',
          xref: 'x',
          yref: 'paper',
          x0: Math.min(minimumRangeStart, minimumRangeEnd),
          x1: Math.max(minimumRangeStart, minimumRangeEnd),
          y0: 0,
          y1: 1,
          fillcolor: 'rgba(251, 113, 133, 0.08)',
          line: { color: 'rgba(251, 113, 133, 0.32)', width: 1, dash: 'dot' },
        },
      ]
    }
    return base
  }, [tool, minimumRangeStart, minimumRangeEnd, selectedDatasetName])

  const handleExport = useCallback(() => {
    if (!activeDataset) return
    const csv = buildSingleToolCsv(tool, activeDataset, minimumRangeStart, minimumRangeEnd, anchorMinimum)
    downloadFile(csv, `${activeDataset.name.replace(/\.[^.]+$/, '')}_${tool}_processed.csv`, 'text/csv;charset=utf-8')
  }, [activeDataset, tool, minimumRangeStart, minimumRangeEnd, anchorMinimum])

  return (
    <div className="px-5 py-8 sm:px-8 xl:px-10 xl:py-10">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-soft)]">
              單一處理工具
            </div>
            <h1 className="font-display text-4xl font-semibold text-[var(--text-muted)]">{meta.title}</h1>
            <p className="mt-2 text-base text-[var(--text-soft)]">{meta.subtitle}</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-soft)]">{meta.description}</p>
          </div>
          <div className="theme-pill rounded-[22px] px-4 py-3 text-sm text-[var(--text-main)] shadow-[var(--card-shadow-soft)]">
            上傳檔案後只執行這一個處理，不帶完整流程其他步驟。
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="glass-panel rounded-[30px] p-4 sm:p-5">
            <div className="theme-block mb-4 overflow-hidden rounded-[24px]">
              <div className="border-b border-[var(--card-divider)] px-4 py-3">
                <div className="text-sm font-semibold text-[var(--text-muted)]">上傳檔案</div>
                <div className="mt-1 text-[11px] text-[var(--text-soft)]">每個工具頁都能直接上傳與預覽</div>
              </div>
              <div className="p-4">
                <FileUpload onFiles={handleFiles} isLoading={isLoading} />
                {rawFiles.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {rawFiles.map(file => (
                      <div key={file.name} className="theme-block-soft rounded-[16px] px-3 py-2 text-xs text-[var(--text-main)]">
                        {file.name}
                      </div>
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
              <div className="theme-block rounded-[24px] p-4">
                <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">高斯模板設定</div>
                <div className="rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-4 py-3 text-sm leading-6 text-[var(--text-soft)]">
                  高斯模板的主要滑桿已移到右側結果區，滑動距離更長，現在每次調整都是 `0.01`，比較不會一下扣太多。
                </div>
              </div>
            )}
          </aside>

          <section className="glass-panel rounded-[30px] p-4 sm:p-5 lg:p-6">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-[var(--text-muted)]">處理結果</div>
                <div className="mt-1 text-xs text-[var(--text-soft)]">
                  {tool === 'background' && '顯示原始訊號、背景基準線與扣背景後結果。'}
                  {tool === 'normalize' && '顯示原始訊號與歸一化後曲線，快速確認尺度變化。'}
                  {tool === 'gaussian' && '顯示原始訊號、被扣掉的高斯曲線與扣除後曲線。'}
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {activeDataset && (
                  <button
                    type="button"
                    onClick={handleExport}
                    className="theme-pill pressable rounded-xl px-4 py-2 text-sm font-medium text-[var(--accent)]"
                  >
                    匯出處理 CSV
                  </button>
                )}
                {result.length > 1 && (
                  <select
                    value={selectedDatasetName}
                    onChange={e => setSelectedDatasetName(e.target.value)}
                    className="theme-input rounded-xl px-3 py-2 text-sm"
                  >
                    {result.map(dataset => (
                      <option key={dataset.name} value={dataset.name}>{dataset.name}</option>
                    ))}
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
              <div className="theme-block-soft flex min-h-[32rem] flex-col items-center justify-center rounded-[28px] px-6 text-center">
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

            {activeDataset && (
              <>
                {tool === 'gaussian' && (
                  <div className="mb-4 space-y-4">
                    <div className="theme-block-soft rounded-[24px] p-4 sm:p-5">
                      <div className="mb-4 flex flex-col gap-1">
                        <div className="text-sm font-semibold text-[var(--text-muted)]">高斯模板調整</div>
                        <div className="text-xs leading-6 text-[var(--text-soft)]">
                          滑桿已改成每次 `0.01` 微調，避免模板一口氣扣太深。建議先調 `固定高度`，再微調 `FWHM` 和 `搜尋半寬`。
                        </div>
                      </div>
                      <label className="mb-4 flex items-start gap-3 rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-4 py-3 text-sm text-[var(--text-main)]">
                        <input
                          type="checkbox"
                          checked={gaussianNonnegativeGuard}
                          onChange={e => setGaussianNonnegativeGuard(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-[var(--card-border)]"
                          style={{ accentColor: 'var(--accent-strong)' }}
                        />
                        <span className="leading-6">
                          啟用避免負值保護
                          <span className="block text-xs text-[var(--text-soft)]">
                            扣除量超過原始訊號時，系統會自動縮小高斯模板，避免結果整段掉到 0 以下。
                          </span>
                        </span>
                      </label>
                      <div className="grid gap-4 lg:grid-cols-3">
                        <SliderRow
                          label="固定 FWHM"
                          value={gaussianFwhm}
                          min={0.001}
                          max={fwhmSliderMax}
                          step={fwhmSliderStep}
                          decimals={2}
                          onChange={setGaussianFwhm}
                        />
                        {bindCurveToMinimum ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-[var(--text-soft)]">固定高度</span>
                              <span className="font-mono text-xs text-[var(--text-main)]">
                                {autoBoundGaussianHeight != null ? autoBoundGaussianHeight.toFixed(2) : '無法計算'}
                              </span>
                            </div>
                            <div className="rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-4 py-3 text-sm leading-6 text-[var(--text-soft)]">
                              已綁定最低點。你移動中心或改 `FWHM` 時，系統會自動重算高度，讓高斯曲線持續切到那個最低點。
                            </div>
                          </div>
                        ) : (
                          <SliderRow
                            label="固定高度"
                            value={gaussianHeight}
                            min={0}
                            max={gaussianHeightSliderMax}
                            step={heightSliderStep}
                            decimals={2}
                            onChange={setGaussianHeight}
                          />
                        )}
                        <SliderRow
                          label="搜尋半寬"
                          value={gaussianSearchHalfWidth}
                          min={0.001}
                          max={searchHwSliderMax}
                          step={searchHwSliderStep}
                          decimals={2}
                          onChange={setGaussianSearchHalfWidth}
                        />
                      </div>
                      {gaussianNonnegativeGuard && gaussianSafeHeightMax != null && !bindCurveToMinimum && (
                        <div className="mt-3 text-xs leading-6 text-[var(--text-soft)]">
                          目前這筆資料的安全高度上限約為 <span className="font-mono text-[var(--text-main)]">{gaussianSafeHeightMax.toFixed(2)}</span>，滑桿已自動限制在這個範圍內。
                        </div>
                      )}
                    </div>

                    <div className="theme-block-soft rounded-[24px] p-4 sm:p-5">
                      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-[var(--text-muted)]">403–406 區間綁定最低點</div>
                          <div className="mt-1 text-xs leading-6 text-[var(--text-soft)]">
                            會先從原始數據找出指定區間內的最低點。你可以先自由移動高斯中心，確認位置後再按按鈕，讓高斯曲線鎖定切到這個最低點。
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="mb-1 block text-xs text-[var(--text-soft)]">起點</span>
                            <input
                              type="number"
                              value={minimumRangeStart}
                              step={0.01}
                              onChange={e => setMinimumRangeStart(Number(e.target.value))}
                              className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs text-[var(--text-soft)]">終點</span>
                            <input
                              type="number"
                              value={minimumRangeEnd}
                              step={0.01}
                              onChange={e => setMinimumRangeEnd(Number(e.target.value))}
                              className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                            />
                          </label>
                        </div>
                      </div>
                      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setBindCurveToMinimum(true)}
                          disabled={autoBoundGaussianHeight == null}
                          className="theme-pill pressable rounded-xl px-4 py-2 text-sm font-medium text-[var(--accent)]"
                        >
                          鎖定到最低點
                        </button>
                        <button
                          type="button"
                          onClick={() => setBindCurveToMinimum(false)}
                          className="theme-pill pressable rounded-xl px-4 py-2 text-sm font-medium text-[var(--text-main)]"
                        >
                          解除綁定
                        </button>
                        <div className="text-sm text-[var(--text-main)]">
                          {autoBoundGaussianHeight != null
                            ? `建議高度 ${autoBoundGaussianHeight.toFixed(2)}`
                            : '目前無法計算建議高度'}
                        </div>
                        <div className="w-full text-xs leading-6 text-[var(--text-soft)]">
                          按下「鎖定到最低點」後，高斯中心仍可移動，但系統會持續自動重算高度；按「解除綁定」就會回到手動高度模式。
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-soft)]">最低點 X</div>
                          <div className="mt-2 font-mono text-lg text-[var(--text-main)]">
                            {anchorMinimum ? anchorMinimum.x.toFixed(4) : '未找到'}
                          </div>
                        </div>
                        <div className="rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-soft)]">最低點 Y</div>
                          <div className="mt-2 font-mono text-lg text-[var(--text-main)]">
                            {anchorMinimum ? anchorMinimum.y.toFixed(4) : '未找到'}
                          </div>
                        </div>
                        <div className="rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-soft)]">區間</div>
                          <div className="mt-2 font-mono text-lg text-[var(--text-main)]">
                            {Math.min(minimumRangeStart, minimumRangeEnd).toFixed(2)}–{Math.max(minimumRangeStart, minimumRangeEnd).toFixed(2)}
                          </div>
                        </div>
                        <div className="rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] px-4 py-3 md:col-span-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-soft)]">該點扣高斯後目前 Y</div>
                          <div className="mt-2 font-mono text-lg text-[var(--text-main)]">
                            {boundPointResidual != null && Number.isFinite(boundPointResidual) ? boundPointResidual.toFixed(4) : '未找到'}
                          </div>
                          <div className="mt-2 text-xs leading-6 text-[var(--text-soft)]">
                            你可以直接看這個值是否接近 `0`，來判斷目前高斯模板是不是已經切到你要的最低點。
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="theme-block-soft rounded-[24px] p-4 sm:p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-[var(--text-muted)]">高斯中心</div>
                          <div className="mt-1 text-xs text-[var(--text-soft)]">
                            每個中心位置也改成 `0.01` 步進，右側橘線就是目前要扣掉的高斯曲線。
                            {bindCurveToMinimum
                              ? ' 目前已綁定；你移動中心時，系統會自動調整高度讓曲線維持切到最低點。'
                              : ' 你可以先移動中心，再按上方按鈕把高斯曲線綁定到最低點。'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setGaussianCenters([
                            ...gaussianCenters,
                            {
                              enabled: true,
                              name: `Peak ${gaussianCenters.length + 1}`,
                              center: gaussianCenters[gaussianCenters.length - 1]?.center ?? 30,
                            },
                          ])}
                          className="theme-pill pressable rounded-xl px-3 py-2 text-sm font-medium text-[var(--accent)]"
                        >
                          新增中心
                        </button>
                      </div>

                      <div className="grid gap-3 xl:grid-cols-2">
                        {gaussianCenters.map((center, idx) => (
                          <div key={`${center.name}-${idx}`} className="rounded-[20px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_90%,transparent)] p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <div className="text-xs font-semibold text-[var(--text-main)]">中心 {idx + 1}</div>
                              {gaussianCenters.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setGaussianCenters(gaussianCenters.filter((_, itemIdx) => itemIdx !== idx))}
                                  className="text-xs text-[var(--accent-secondary)]"
                                >
                                  刪除
                                </button>
                              )}
                            </div>
                            <div className="space-y-3">
                              <input
                                type="text"
                                value={center.name}
                                onChange={e => setGaussianCenters(gaussianCenters.map((item, itemIdx) => itemIdx === idx ? { ...item, name: e.target.value } : item))}
                                className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                              />
                              <SliderRow
                                label="中心位置"
                                value={center.center}
                                min={gSliderXMin}
                                max={gSliderXMax}
                                step={centerSliderStep}
                                decimals={2}
                                onChange={value => setGaussianCenters(gaussianCenters.map((item, itemIdx) => itemIdx === idx ? { ...item, center: value } : item))}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="theme-block-soft rounded-[28px] p-3 sm:p-4">
                  {tool === 'gaussian' && activeDataset.gaussian_guard_enabled && (
                    <div className="mb-3 rounded-[18px] border border-[color:color-mix(in_srgb,var(--accent-strong)_24%,var(--card-border))] bg-[color:color-mix(in_srgb,var(--accent-strong)_12%,transparent)] px-4 py-3 text-sm text-[var(--text-main)]">
                      {activeDataset.gaussian_guard_applied
                        ? `避免負值保護已介入，這次高斯模板自動縮放為 ${(activeDataset.gaussian_guard_scale ?? 1).toFixed(2)}x。`
                        : '避免負值保護已啟用，目前這組參數不需要額外縮放高斯模板。'}
                    </div>
                  )}
                  <div className="mb-3 rounded-[18px] border border-[var(--card-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-4 py-3 text-xs leading-6 text-[var(--text-soft)]">
                    縮放已改成穩定模式：左鍵拖曳可框選放大，雙擊圖面可重置；同時保留目前視角，不會因為每次小幅調整數值就整張圖跳回初始狀態。
                  </div>
                  <Plot
                    data={plotTraces}
                    layout={plotLayout}
                    config={withPlotFullscreen({
                      scrollZoom: false,
                      displayModeBar: true,
                      doubleClick: 'reset+autosize',
                    })}
                    style={{ width: '100%', minHeight: '520px' }}
                    useResizeHandler
                  />
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
                          <tr key={`${row.Peak_Name}-${idx}`} className="border-b border-white/5 text-[var(--text-main)] last:border-b-0">
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
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
