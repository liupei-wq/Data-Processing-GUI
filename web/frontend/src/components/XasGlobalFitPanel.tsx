import { useEffect, useMemo, useState } from 'react'
import Plot from './PlotlyChart'
import { downloadXasGlobalExport, fitXasGlobal } from '../api/xas'
import type {
  ProcessedDataset,
  XasGlobalDatasetInput,
  XasGlobalFitRequest,
  XasGlobalFitResult,
  XasGlobalMainPeakSettings,
  XasGlobalSmallPeakSettings,
} from '../types/xas'

const DEFAULT_MAIN_PEAKS: XasGlobalMainPeakSettings[] = [
  { label: 'A2', center: 531.5, center_min: 530.8, center_max: 532.2, lock_center: false, fwhm: 1.2, fwhm_min: 0.6, fwhm_max: 2.0, lock_fwhm: false },
  { label: 'B2', center: 534.31, center_min: 533.6, center_max: 535.0, lock_center: false, fwhm: 1.2, fwhm_min: 0.6, fwhm_max: 2.0, lock_fwhm: false },
  { label: 'P3', center: 537.0, center_min: 536.3, center_max: 537.7, lock_center: false, fwhm: 1.2, fwhm_min: 0.6, fwhm_max: 2.0, lock_fwhm: false },
  { label: 'P4', center: 539.5, center_min: 538.8, center_max: 540.2, lock_center: false, fwhm: 1.2, fwhm_min: 0.6, fwhm_max: 2.0, lock_fwhm: false },
  { label: 'C2', center: 541.0, center_min: 540.3, center_max: 541.7, lock_center: false, fwhm: 1.2, fwhm_min: 0.6, fwhm_max: 2.0, lock_fwhm: false },
]

const DEFAULT_SMALL_PEAK: XasGlobalSmallPeakSettings = {
  range: [544.0, 545.9],
  center: 545.0,
  center_min: 544.0,
  center_max: 545.9,
  lock_center: false,
  fwhm: 1.0,
  fwhm_min: 0.2,
  fwhm_max: 2.0,
  lock_fwhm: false,
  background: 'linear',
}

const PEAK_COLORS = ['#a78bfa', '#22d3ee', '#f59e0b', '#ec4899', '#10b981', '#8b5cf6', '#06b6d4']

function inputClass() {
  return 'theme-input w-full rounded-lg px-2 py-1.5 text-xs'
}

function numberValue(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function parseMultiSampleCsv(text: string, fileName: string): XasGlobalDatasetInput[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length < 4) throw new Error('檔案至少需要 3 列數值資料')
  const delimiter = lines[0].includes('\t') ? /\t+/ : lines[0].includes(',') ? /\s*,\s*/ : lines[0].includes(';') ? /\s*;\s*/ : /\s+/
  const rows = lines.map(line => line.split(delimiter))
  const firstNumeric = rows[0].every(cell => Number.isFinite(Number(cell)))
  const dataRows = firstNumeric ? rows : rows.slice(1)
  const columnCount = Math.max(...dataRows.map(row => row.length))
  if (columnCount < 2) throw new Error('需要至少兩欄：X 與一組樣品 Y')
  const headers = firstNumeric
    ? ['Energy', ...Array.from({ length: columnCount - 1 }, (_, index) => `Sample ${index + 1}`)]
    : rows[0].map((value, index) => value.trim() || (index === 0 ? 'Energy' : `Sample ${index}`))
  const parsed = dataRows
    .map(row => row.map(cell => Number(cell)))
    .filter(row => row.length >= 2 && Number.isFinite(row[0]))
  const baseName = fileName.replace(/\.[^.]+$/, '')
  return Array.from({ length: columnCount - 1 }, (_, sampleIndex) => {
    const points = parsed
      .filter(row => Number.isFinite(row[sampleIndex + 1]))
      .map(row => [row[0], row[sampleIndex + 1]] as [number, number])
      .sort((a, b) => a[0] - b[0])
    if (points.length < 3) return null
    return {
      name: headers[sampleIndex + 1] || `${baseName}_${sampleIndex + 1}`,
      x: points.map(point => point[0]),
      y: points.map(point => point[1]),
    }
  }).filter((dataset): dataset is XasGlobalDatasetInput => dataset !== null)
}

function plotLayout(title: string): Partial<Plotly.Layout> {
  const css = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const text = css?.getPropertyValue('--chart-text').trim() || '#d9e4f0'
  const grid = css?.getPropertyValue('--chart-grid').trim() || 'rgba(148,163,184,0.14)'
  const bg = css?.getPropertyValue('--chart-bg').trim() || 'rgba(15,23,42,0.52)'
  return {
    title: { text: title, font: { size: 13 } },
    xaxis: { title: { text: 'Energy (eV)' }, color: text, gridcolor: grid, zeroline: false },
    yaxis: { title: { text: '強度' }, color: text, gridcolor: grid, zeroline: false },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: bg, font: { color: text },
    legend: { orientation: 'h', y: -0.22 }, margin: { l: 58, r: 20, t: 44, b: 82 },
    hovermode: 'x unified', autosize: true, uirevision: 'xas-global-fit',
  }
}

export default function XasGlobalFitPanel({ pipelineDatasets }: { pipelineDatasets: ProcessedDataset[] }) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<'pipeline' | 'csv'>('pipeline')
  const [channel, setChannel] = useState<'TEY' | 'TFY'>('TEY')
  const [csvDatasets, setCsvDatasets] = useState<XasGlobalDatasetInput[]>([])
  const [csvName, setCsvName] = useState('')
  const [smallPeak, setSmallPeak] = useState<XasGlobalSmallPeakSettings>({ ...DEFAULT_SMALL_PEAK })
  const [mainPeaks, setMainPeaks] = useState<XasGlobalMainPeakSettings[]>(DEFAULT_MAIN_PEAKS.map(peak => ({ ...peak })))
  const [fitRange, setFitRange] = useState<[number, number]>([529.0, 546.0])
  const [mainBackground, setMainBackground] = useState<'constant' | 'linear'>('linear')
  const [ratioNumerator, setRatioNumerator] = useState('C2')
  const [ratioDenominator, setRatioDenominator] = useState('B2')
  const [result, setResult] = useState<XasGlobalFitResult | null>(null)
  const [lastConfig, setLastConfig] = useState<XasGlobalFitRequest | null>(null)
  const [selectedSample, setSelectedSample] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pipelineInputs = useMemo<XasGlobalDatasetInput[]>(() => pipelineDatasets.map(dataset => ({
    name: dataset.name,
    x: dataset.x,
    y: channel === 'TEY' ? dataset.tey_processed : dataset.tfy_processed,
  })), [pipelineDatasets, channel])
  const datasets = source === 'pipeline' ? pipelineInputs : csvDatasets
  const peakLabels = mainPeaks.map(peak => peak.label).filter(Boolean)
  const selectedResult = result?.datasets.find(dataset => dataset.name === selectedSample) ?? result?.datasets[0] ?? null

  useEffect(() => {
    if (result?.datasets.length && !result.datasets.some(dataset => dataset.name === selectedSample)) {
      setSelectedSample(result.datasets[0].name)
    }
  }, [result, selectedSample])

  const updateSmall = <K extends keyof XasGlobalSmallPeakSettings>(key: K, value: XasGlobalSmallPeakSettings[K]) => {
    setSmallPeak(previous => ({ ...previous, [key]: value }))
    setResult(null)
  }

  const updatePeak = (index: number, patch: Partial<XasGlobalMainPeakSettings>) => {
    setMainPeaks(previous => previous.map((peak, peakIndex) => peakIndex === index ? { ...peak, ...patch } : peak))
    setResult(null)
  }

  const handleFit = async () => {
    if (!datasets.length) { setError('請先完成 XAS 處理，或上傳多樣品 CSV'); return }
    if (!mainPeaks.length) { setError('請至少保留一個主峰'); return }
    const config: XasGlobalFitRequest = {
      datasets,
      small_peak: smallPeak,
      main_peaks: mainPeaks,
      fit_range: fitRange,
      main_background: mainBackground,
      ratio_numerator: ratioNumerator || null,
      ratio_denominator: ratioDenominator || null,
      max_nfev: 30000,
    }
    setRunning(true); setError(null)
    try {
      const next = await fitXasGlobal(config)
      setResult(next); setLastConfig(config)
      setSelectedSample(next.datasets[0]?.name ?? '')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '全域擬合失敗')
    } finally {
      setRunning(false)
    }
  }

  const traces = useMemo<Plotly.Data[]>(() => {
    if (!selectedResult) return []
    const peakTraces = selectedResult.components.map((component, index) => ({
      x: selectedResult.x, y: component, type: 'scatter' as const, mode: 'lines' as const,
      name: selectedResult.peaks[index]?.label ?? `Peak ${index + 1}`,
      line: { color: PEAK_COLORS[index % PEAK_COLORS.length], width: 1.5 },
      fill: 'tozeroy' as const, opacity: 0.7,
    }))
    return [
      { x: selectedResult.x, y: selectedResult.original, type: 'scatter', mode: 'lines', name: '原始曲線', line: { color: '#94a3b8', width: 1.2 } },
      { x: selectedResult.x, y: selectedResult.corrected, type: 'scatter', mode: 'lines', name: '僅扣小高斯後', line: { color: '#136DE4', width: 2.0 } },
      { x: selectedResult.x, y: selectedResult.small_peak.component, type: 'scatter', mode: 'lines', name: '小高斯', line: { color: '#E42213', width: 1.4, dash: 'dot' } },
      ...peakTraces,
      { x: selectedResult.x, y: selectedResult.background, type: 'scatter', mode: 'lines', name: '主擬合背景', line: { color: '#252526', width: 1.5, dash: 'dash' } },
      { x: selectedResult.x, y: selectedResult.total_fit, type: 'scatter', mode: 'lines', name: 'Total fit', line: { color: '#f8fafc', width: 2.2 } },
      { x: selectedResult.x, y: selectedResult.residual, type: 'scatter', mode: 'lines', name: 'Residual', line: { color: '#f97316', width: 1.2, dash: 'dot' } },
    ]
  }, [selectedResult])

  return (
    <div className="analysis-section-card mb-4 overflow-hidden">
      <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div>
          <p className="text-sm font-semibold text-[var(--text-main)]">全域成分擬合</p>
          <p className="mt-0.5 text-[10px] text-[var(--text-soft)]">多樣品共用峰中心 / FWHM · 小峰僅扣高斯 · 面積比定量</p>
        </div>
        <span className="text-sm text-[var(--accent-secondary)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--card-divider)] p-4 space-y-5">
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs leading-5 text-[var(--text-soft)]">
            科學規則：544.0–545.9 eV 局部擬合的背景只用於估計小峰；校正光譜只扣除小高斯成分，不扣除局部背景。定量使用峰面積比，不是峰高比。
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
              <p className="text-xs font-semibold text-[var(--text-main)]">1. 資料來源</p>
              <div className="flex gap-2">
                {(['pipeline', 'csv'] as const).map(value => (
                  <button key={value} type="button" onClick={() => { setSource(value); setResult(null) }} className={[
                    'flex-1 rounded-full px-3 py-1.5 text-xs transition-colors',
                    source === value ? 'bg-[var(--accent-soft)] text-[var(--accent-secondary)]' : 'border border-[var(--card-border)] text-[var(--text-soft)]',
                  ].join(' ')}>{value === 'pipeline' ? 'XAS 處理結果' : '多樣品 CSV'}</button>
                ))}
              </div>
              {source === 'pipeline' ? (
                <>
                  <label className="block text-[10px] text-[var(--text-soft)]">擬合通道
                    <select value={channel} onChange={event => { setChannel(event.target.value as 'TEY' | 'TFY'); setResult(null) }} className={`${inputClass()} mt-1`}>
                      <option value="TEY">TEY</option><option value="TFY">TFY</option>
                    </select>
                  </label>
                  <p className="text-[10px] text-[var(--text-soft)]">{pipelineInputs.length ? `已載入 ${pipelineInputs.length} 組處理後光譜` : '尚無處理後光譜'}</p>
                </>
              ) : (
                <>
                  <label className="block cursor-pointer rounded-xl border-2 border-dashed border-[var(--card-border)] px-3 py-4 text-center text-xs text-[var(--text-soft)] hover:border-[var(--accent-secondary)]">
                    上傳 CSV（第一欄 X，後續每欄一個樣品）
                    <input type="file" accept=".csv,.txt,.dat" className="hidden" onChange={async event => {
                      const file = event.target.files?.[0]; if (!file) return
                      try {
                        const parsed = parseMultiSampleCsv(await file.text(), file.name)
                        if (!parsed.length) throw new Error('找不到可用的樣品欄')
                        setCsvDatasets(parsed); setCsvName(file.name); setError(null); setResult(null)
                      } catch (reason) { setError(reason instanceof Error ? reason.message : 'CSV 解析失敗') }
                      event.target.value = ''
                    }} />
                  </label>
                  <p className="text-[10px] text-[var(--text-soft)]">{csvDatasets.length ? `${csvName}：${csvDatasets.length} 組樣品` : '支援有/無標題列，逗號、Tab、分號或空白分隔'}</p>
                </>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
              <p className="text-xs font-semibold text-[var(--text-main)]">2. 小高斯與局部背景</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([['範圍起點', smallPeak.range[0], (value: number) => updateSmall('range', [value, smallPeak.range[1]])], ['範圍終點', smallPeak.range[1], (value: number) => updateSmall('range', [smallPeak.range[0], value])], ['中心', smallPeak.center, (value: number) => updateSmall('center', value)], ['FWHM', smallPeak.fwhm, (value: number) => updateSmall('fwhm', value)]] as const).map(([label, value, onChange]) => (
                  <label key={label} className="text-[10px] text-[var(--text-soft)]">{label} (eV)<input type="number" step="0.05" value={value} onChange={event => onChange(numberValue(event.target.value, value))} className={`${inputClass()} mt-1`} /></label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="text-[10px] text-[var(--text-soft)]">中心 min<input type="number" step="0.05" value={smallPeak.center_min} onChange={event => updateSmall('center_min', numberValue(event.target.value, smallPeak.center_min))} className={`${inputClass()} mt-1`} /></label>
                <label className="text-[10px] text-[var(--text-soft)]">中心 max<input type="number" step="0.05" value={smallPeak.center_max} onChange={event => updateSmall('center_max', numberValue(event.target.value, smallPeak.center_max))} className={`${inputClass()} mt-1`} /></label>
                <label className="text-[10px] text-[var(--text-soft)]">FWHM min<input type="number" step="0.05" value={smallPeak.fwhm_min} onChange={event => updateSmall('fwhm_min', numberValue(event.target.value, smallPeak.fwhm_min))} className={`${inputClass()} mt-1`} /></label>
                <label className="text-[10px] text-[var(--text-soft)]">FWHM max<input type="number" step="0.05" value={smallPeak.fwhm_max} onChange={event => updateSmall('fwhm_max', numberValue(event.target.value, smallPeak.fwhm_max))} className={`${inputClass()} mt-1`} /></label>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-[var(--text-soft)]">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={smallPeak.lock_center} onChange={event => updateSmall('lock_center', event.target.checked)} />固定中心</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={smallPeak.lock_fwhm} onChange={event => updateSmall('lock_fwhm', event.target.checked)} />固定 FWHM</label>
                <label className="flex items-center gap-1.5">背景
                  <select value={smallPeak.background} onChange={event => updateSmall('background', event.target.value as 'constant' | 'linear')} className={inputClass()}><option value="constant">常數</option><option value="linear">線性</option></select>
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--text-main)]">3. 主峰全域約束（中心 / FWHM 跨樣品共用）</p>
              <button type="button" onClick={() => setMainPeaks(previous => [...previous, { label: `P${previous.length + 1}`, center: 535, center_min: 534, center_max: 536, lock_center: false, fwhm: 1.2, fwhm_min: 0.6, fwhm_max: 2.0, lock_fwhm: false }])} className="rounded-lg border border-[var(--accent-secondary)] px-3 py-1 text-xs text-[var(--accent-secondary)]">＋ 新增主峰</button>
            </div>
            <div className="overflow-x-auto">
              <table className="analysis-data-table min-w-[900px]">
                <thead><tr><th>峰名</th><th>中心</th><th>中心 min</th><th>中心 max</th><th>中心固定</th><th>FWHM</th><th>FWHM min</th><th>FWHM max</th><th>FWHM 固定</th><th /></tr></thead>
                <tbody>{mainPeaks.map((peak, index) => (
                  <tr key={`${index}-${peak.label}`}>
                    <td><input value={peak.label} onChange={event => updatePeak(index, { label: event.target.value })} className={inputClass()} /></td>
                    {(['center', 'center_min', 'center_max', 'fwhm', 'fwhm_min', 'fwhm_max'] as const).map(key => (
                      <td key={key} className={key === 'fwhm' ? 'border-l border-[var(--card-divider)]' : ''}><input type="number" step="0.05" value={peak[key]} onChange={event => updatePeak(index, { [key]: numberValue(event.target.value, peak[key]) })} className={inputClass()} /></td>
                    )).reduce<React.ReactNode[]>((cells, cell, cellIndex) => {
                      cells.push(cell)
                      if (cellIndex === 2) cells.push(<td key="lock-center" className="text-center"><input type="checkbox" checked={peak.lock_center} onChange={event => updatePeak(index, { lock_center: event.target.checked })} /></td>)
                      if (cellIndex === 5) cells.push(<td key="lock-fwhm" className="text-center"><input type="checkbox" checked={peak.lock_fwhm} onChange={event => updatePeak(index, { lock_fwhm: event.target.checked })} /></td>)
                      return cells
                    }, [])}
                    <td><button type="button" onClick={() => { setMainPeaks(previous => previous.filter((_, peakIndex) => peakIndex !== index)); setResult(null) }} className="text-rose-400">✕</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-[10px] text-[var(--text-soft)]">主擬合起點 (eV)<input type="number" step="0.1" value={fitRange[0]} onChange={event => { setFitRange([numberValue(event.target.value, fitRange[0]), fitRange[1]]); setResult(null) }} className={`${inputClass()} mt-1`} /></label>
            <label className="text-[10px] text-[var(--text-soft)]">主擬合終點 (eV)<input type="number" step="0.1" value={fitRange[1]} onChange={event => { setFitRange([fitRange[0], numberValue(event.target.value, fitRange[1])]); setResult(null) }} className={`${inputClass()} mt-1`} /></label>
            <label className="text-[10px] text-[var(--text-soft)]">主背景<select value={mainBackground} onChange={event => { setMainBackground(event.target.value as 'constant' | 'linear'); setResult(null) }} className={`${inputClass()} mt-1`}><option value="constant">常數</option><option value="linear">線性</option></select></label>
            <label className="text-[10px] text-[var(--text-soft)]">面積比分子<select value={ratioNumerator} onChange={event => { setRatioNumerator(event.target.value); setResult(null) }} className={`${inputClass()} mt-1`}>{peakLabels.map(label => <option key={label}>{label}</option>)}</select></label>
            <label className="text-[10px] text-[var(--text-soft)]">面積比分母<select value={ratioDenominator} onChange={event => { setRatioDenominator(event.target.value); setResult(null) }} className={`${inputClass()} mt-1`}>{peakLabels.map(label => <option key={label}>{label}</option>)}</select></label>
          </div>

          <button type="button" onClick={() => void handleFit()} disabled={running || !datasets.length || !mainPeaks.length} className="rounded-xl bg-[var(--accent-strong)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{running ? '全域擬合中…' : `執行全域擬合（${datasets.length} 組樣品）`}</button>
          {error && <p className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

          {result && selectedResult && (
            <div className="space-y-4 border-t border-[var(--card-divider)] pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2"><p className="text-sm font-semibold text-[var(--text-main)]">全域擬合結果</p><select value={selectedResult.name} onChange={event => setSelectedSample(event.target.value)} className={inputClass()}>{result.datasets.map(dataset => <option key={dataset.name}>{dataset.name}</option>)}</select></div>
                <div className="flex flex-wrap gap-2 text-[10px]"><span className="rounded-full border border-[var(--card-border)] px-2 py-1">R² {selectedResult.r_squared.toFixed(5)}</span><span className="rounded-full border border-[var(--card-border)] px-2 py-1">RMSE {selectedResult.rmse.toExponential(3)}</span><span className="rounded-full border border-[var(--accent-secondary)] px-2 py-1 text-[var(--accent-secondary)]">{ratioNumerator}/{ratioDenominator} = {selectedResult.area_ratio?.toFixed(5) ?? 'N/A'}</span></div>
              </div>
              <Plot data={traces} layout={plotLayout(`${selectedResult.name} — 成分擬合`)} config={{ responsive: true, displaylogo: false }} style={{ width: '100%', height: 500 }} />
              <div className="overflow-x-auto"><table className="analysis-data-table"><thead><tr><th>樣品</th><th>R²</th><th>RMSE</th><th>{ratioNumerator}/{ratioDenominator} 面積比</th><th>小峰中心</th><th>小峰 FWHM</th></tr></thead><tbody>{result.datasets.map(dataset => <tr key={dataset.name}><td>{dataset.name}</td><td>{dataset.r_squared.toFixed(5)}</td><td>{dataset.rmse.toExponential(3)}</td><td>{dataset.area_ratio?.toFixed(5) ?? '—'}</td><td>{dataset.small_peak.center.toFixed(4)}</td><td>{dataset.small_peak.fwhm.toFixed(4)}</td></tr>)}</tbody></table></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => lastConfig && downloadJson(lastConfig, 'xas_global_fit_settings.json')} className="rounded-lg border border-[var(--card-border)] px-3 py-2 text-xs">設定 JSON</button>
                <button type="button" onClick={() => lastConfig && void downloadXasGlobalExport('xlsx', lastConfig, result).catch(reason => setError(reason instanceof Error ? reason.message : '匯出失敗'))} className="rounded-lg border border-[var(--card-border)] px-3 py-2 text-xs">Excel 結果</button>
                <button type="button" onClick={() => lastConfig && void downloadXasGlobalExport('zip', lastConfig, result).catch(reason => setError(reason instanceof Error ? reason.message : '匯出失敗'))} className="rounded-lg border border-[var(--accent-secondary)] px-3 py-2 text-xs text-[var(--accent-secondary)]">完整 ZIP</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
