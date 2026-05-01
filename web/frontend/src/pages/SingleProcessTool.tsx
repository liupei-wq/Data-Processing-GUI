import { useCallback, useEffect, useState } from 'react'
import Plot from 'react-plotly.js'
import { withPlotFullscreen } from '../components/plotConfig'
import { parseFiles, processData } from '../api/xrd'
import FileUpload from '../components/FileUpload'
import type { GaussianCenter, ParsedFile, ProcessParams, ProcessedDataset } from '../types/xrd'
import { DEFAULT_PARAMS } from '../components/ProcessingPanel'

export type SingleToolKind = 'background' | 'normalize' | 'gaussian'

type BackgroundMethod = 'linear' | 'shirley' | 'polynomial' | 'asls' | 'airpls'
type NormalizeMethod = 'min_max' | 'max' | 'area'

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
    gaussian_search_half_width: gaussianSearchHalfWidth,
    gaussian_centers: tool === 'gaussian' ? gaussianCenters : [],
    smooth_method: 'none',
    norm_method: tool === 'normalize' ? normalizeMethod : 'none',
    norm_x_start: tool === 'normalize' ? normStart : null,
    norm_x_end: tool === 'normalize' ? normEnd : null,
  }
  return base
}

function buildTraces(tool: SingleToolKind, dataset: ProcessedDataset): Plotly.Data[] {
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
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-soft)]">{label}</span>
        <span className="font-mono text-xs text-[var(--text-main)]">{fmt(value)}</span>
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="theme-input w-full rounded-xl px-3 py-2 text-sm"
      />
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
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
  const [gaussianSearchHalfWidth, setGaussianSearchHalfWidth] = useState(0.5)
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
    setGaussianSearchHalfWidth(0.5)
    setGaussianCenters([{ enabled: true, name: 'Peak 1', center: 30 }])
  }, [tool])

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
    gaussianHeight,
    gaussianSearchHalfWidth,
    gaussianCenters,
  )

  useEffect(() => {
    if (rawFiles.length === 0) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    processData(rawFiles, params)
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
  }, [rawFiles, params])

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
                        <SliderRow
                          label="固定高度"
                          value={gaussianHeight}
                          min={0}
                          max={Math.max(gSliderYMax, 1)}
                          step={heightSliderStep}
                          decimals={2}
                          onChange={setGaussianHeight}
                        />
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
                    </div>

                    <div className="theme-block-soft rounded-[24px] p-4 sm:p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-[var(--text-muted)]">高斯中心</div>
                          <div className="mt-1 text-xs text-[var(--text-soft)]">
                            每個中心位置也改成 `0.01` 步進，右側橘線就是目前要扣掉的高斯曲線。
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
                  <Plot
                    data={buildTraces(tool, activeDataset)}
                    layout={chartLayout()}
                    config={withPlotFullscreen({ scrollZoom: true })}
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
