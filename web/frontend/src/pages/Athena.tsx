import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Plot from '../components/PlotlyChart'
import {
  buildAthenaAverageCsv,
  buildAthenaRawCsv,
  buildAthenaSummaryTxt,
  downloadTextFile,
  makeAthenaAverage,
  processAthenaFiles,
  safeAthenaFilename,
  type AthenaAverageResult,
  type AthenaManualRemovalRegion,
  type AthenaProcessResult,
  type AthenaSampleGroup,
  type AthenaScanResult,
} from '../features/athena/athenaXmu'

type AthenaPreviewMode = 'normalized' | 'flattened'
type RemovalDraft = { start: number; end: number; scan: AthenaManualRemovalRegion['scan'] }

const ATHENA_TRACE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5']
const ATHENA_AVERAGE_COLOR = '#111827'
const ATHENA_REMOVAL_FILL = 'rgba(245, 158, 11, 0.18)'
const ATHENA_REMOVAL_LINE = 'rgba(245, 158, 11, 0.72)'

const directoryInputProps = {
  webkitdirectory: '',
  directory: '',
} as Record<string, string>

function timestampForFilename() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')
}

function triggerDownload(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  downloadTextFile(filename, content, type)
}

function downloadRawScan(scan: AthenaScanResult) {
  triggerDownload(
    `athena_raw_${safeAthenaFilename(scan.sampleName)}_${safeAthenaFilename(scan.fileName.replace(/\.xmu$/i, ''))}.csv`,
    buildAthenaRawCsv(scan),
    'text/csv;charset=utf-8',
  )
}

function downloadAverageResult(average: AthenaAverageResult) {
  triggerDownload(
    `athena_average_${safeAthenaFilename(average.sampleName)}.csv`,
    buildAthenaAverageCsv(average),
    'text/csv;charset=utf-8',
  )
}

function makeRemovalId() {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function clampRangeValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function formatEnergy(value: number) {
  return Number.isFinite(value) ? value.toFixed(3) : '-'
}

function Section({
  title,
  description,
  children,
  compact = false,
}: {
  title: string
  description?: string
  children: ReactNode
  compact?: boolean
}) {
  return (
    <section className={`workspace-stage-card rounded-[20px] ${compact ? 'p-3.5' : 'p-4'}`}>
      <div className={compact ? 'mb-2' : 'mb-3'}>
        <h2 className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-[var(--text-main)]`}>{title}</h2>
        {description && <p className={`mt-1 ${compact ? 'text-xs leading-5' : 'text-sm leading-6'} text-[var(--text-soft)]`}>{description}</p>}
      </div>
      {children}
    </section>
  )
}

export default function Athena() {
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [result, setResult] = useState<AthenaProcessResult | null>(null)
  const [selectedSampleName, setSelectedSampleName] = useState('')
  const [previewMode, setPreviewMode] = useState<AthenaPreviewMode>('normalized')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [manualRemovals, setManualRemovals] = useState<Record<string, AthenaManualRemovalRegion[]>>({})
  const [removalDraft, setRemovalDraft] = useState<RemovalDraft>({ start: 0, end: 0, scan: 'both' })

  const adjustedResult = useMemo<AthenaProcessResult | null>(() => {
    if (!result) return null
    return {
      ...result,
      groups: result.groups.map(group => {
        const sortedScans = group.scans.slice().sort((a, b) => a.fileName.localeCompare(b.fileName))
        if (sortedScans.length < 2) return group
        try {
          return {
            ...group,
            scans: sortedScans,
            average: makeAthenaAverage(group.sampleName, sortedScans[0], sortedScans[1], manualRemovals[group.sampleName] ?? []),
          }
        } catch {
          return group
        }
      }),
    }
  }, [manualRemovals, result])

  const selectedGroup = useMemo<AthenaSampleGroup | null>(() => {
    if (!adjustedResult?.groups.length) return null
    return adjustedResult.groups.find(group => group.sampleName === selectedSampleName) ?? adjustedResult.groups[0]
  }, [adjustedResult, selectedSampleName])

  const selectedEnergyRange = useMemo(() => {
    const energy = selectedGroup?.average?.energy ?? selectedGroup?.scans[0]?.energy ?? []
    if (!energy.length) return null
    return { min: Math.min(...energy), max: Math.max(...energy), step: Math.max((Math.max(...energy) - Math.min(...energy)) / 600, 0.001) }
  }, [selectedGroup])

  const selectedManualRemovals = selectedGroup ? manualRemovals[selectedGroup.sampleName] ?? [] : []

  useEffect(() => {
    if (!selectedEnergyRange) return
    setRemovalDraft(current => {
      const currentStart = current.start || selectedEnergyRange.min
      const currentEnd = current.end || selectedEnergyRange.max
      const nextStart = clampRangeValue(currentStart, selectedEnergyRange.min, selectedEnergyRange.max)
      const nextEnd = clampRangeValue(currentEnd, selectedEnergyRange.min, selectedEnergyRange.max)
      if (nextStart === current.start && nextEnd === current.end) return current
      return { ...current, start: nextStart, end: nextEnd }
    })
  }, [selectedEnergyRange])

  const previewFigure = useMemo(() => {
    if (!selectedGroup) return null

    const data: Plotly.Data[] = selectedGroup.scans.map((scan, index) => ({
      x: scan.energy,
      y: previewMode === 'normalized' ? scan.normalizedMu : scan.flattenedMu,
      type: 'scatter',
      mode: 'lines',
      name: `${scan.fileName}`,
      line: { width: 1.9, color: ATHENA_TRACE_COLORS[index % ATHENA_TRACE_COLORS.length] },
      opacity: index < 2 ? 0.9 : 0.55,
      hovertemplate: 'Energy：%{x:.3f} eV<br>μ(E)：%{y:.6f}<extra></extra>',
    }))

    if (selectedGroup.average) {
      data.push({
        x: selectedGroup.average.energy,
        y: previewMode === 'normalized'
          ? selectedGroup.average.averageNormalized
          : selectedGroup.average.averageFlattened,
        type: 'scatter',
        mode: 'lines',
        name: previewMode === 'normalized' ? '平均 Normalized μ(E)' : '平均 Flattened μ(E)',
        line: { width: 3.2, color: ATHENA_AVERAGE_COLOR },
        hovertemplate: 'Energy：%{x:.3f} eV<br>平均 μ(E)：%{y:.6f}<extra></extra>',
      })
    }

    const removalShapes = selectedManualRemovals.map(region => ({
      type: 'rect' as const,
      xref: 'x' as const,
      yref: 'paper' as const,
      x0: Math.min(region.start, region.end),
      x1: Math.max(region.start, region.end),
      y0: 0,
      y1: 1,
      fillcolor: ATHENA_REMOVAL_FILL,
      line: { color: ATHENA_REMOVAL_LINE, width: 1 },
      layer: 'below' as const,
    }))

    return {
      data,
      layout: {
        autosize: true,
        height: 500,
        margin: { l: 66, r: 28, t: 46, b: 70 },
        title: { text: `Athena ${selectedGroup.sampleName} ${previewMode === 'normalized' ? 'Normalized' : 'Flattened'} 預覽` },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: 'var(--text-main)' },
        shapes: removalShapes,
        xaxis: {
          title: { text: 'Energy（eV）' },
          gridcolor: 'rgba(148,163,184,0.18)',
          zerolinecolor: 'rgba(148,163,184,0.24)',
        },
        yaxis: {
          title: { text: previewMode === 'normalized' ? 'Normalized μ(E)' : 'Flattened μ(E)' },
          gridcolor: 'rgba(148,163,184,0.18)',
          zerolinecolor: 'rgba(148,163,184,0.24)',
        },
        legend: { orientation: 'h', x: 0, y: -0.18, xanchor: 'left', yanchor: 'top' },
      } satisfies Partial<Plotly.Layout>,
      config: { responsive: true, displaylogo: false } satisfies Partial<Plotly.Config>,
    }
  }, [previewMode, selectedGroup, selectedManualRemovals])

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return
    setIsLoading(true)
    setMessage('正在讀取 Athena .xmu 檔案...')
    try {
      const nextResult = await processAthenaFiles(files)
      setResult(nextResult)
      setManualRemovals({})
      setSelectedSampleName(nextResult.groups[0]?.sampleName ?? '')
      setMessage(`完成：讀取 ${nextResult.scans.length} 筆 .xmu，建立 ${nextResult.groups.length} 個樣品群組。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Athena 檔案處理失敗。')
    } finally {
      setIsLoading(false)
    }
  }

  const exportAllRawScans = () => {
    if (!result?.scans.length) return
    result.scans.forEach(downloadRawScan)
  }

  const exportAllAverages = () => {
    if (!adjustedResult) return
    adjustedResult.groups.forEach(group => {
      if (group.average) downloadAverageResult(group.average)
    })
  }

  const exportSummary = () => {
    if (!adjustedResult) return
    triggerDownload(`athena_summary_${timestampForFilename()}.txt`, buildAthenaSummaryTxt(adjustedResult))
  }

  const addManualRemoval = () => {
    if (!selectedGroup || !selectedEnergyRange) return
    const start = clampRangeValue(removalDraft.start, selectedEnergyRange.min, selectedEnergyRange.max)
    const end = clampRangeValue(removalDraft.end, selectedEnergyRange.min, selectedEnergyRange.max)
    setManualRemovals(current => ({
      ...current,
      [selectedGroup.sampleName]: [
        ...(current[selectedGroup.sampleName] ?? []),
        { id: makeRemovalId(), start: Math.min(start, end), end: Math.max(start, end), scan: removalDraft.scan },
      ],
    }))
  }

  const removeManualRemoval = (sampleName: string, regionId: string) => {
    setManualRemovals(current => ({
      ...current,
      [sampleName]: (current[sampleName] ?? []).filter(region => region.id !== regionId),
    }))
  }

  const clearSelectedManualRemovals = () => {
    if (!selectedGroup) return
    setManualRemovals(current => ({ ...current, [selectedGroup.sampleName]: [] }))
  }

  const averageCount = adjustedResult?.groups.filter(group => group.average).length ?? 0

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-6 lg:px-8">
      <div className="topbar-panel">
        <div className="topbar-eyebrow">Data Tool</div>
        <div className="module-title-row">
          <h1 className="module-title">Athena</h1>
          <span className="module-subtitle">Athena .xmu folder processor</span>
        </div>
        <p className="module-description max-w-4xl">
          讀取整個資料夾中的 Athena .xmu 檔案，依子資料夾分樣品，計算 Normalized μ(E) 與 Flattened μ(E)，並可把每個處理動作匯出成檔案。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="status-chip">資料夾讀取</span>
          <span className="status-chip">Normalized / Flattened</span>
          <span className="status-chip">重複量測平均</span>
          <span className="status-chip">手動刪峰</span>
          <span className="status-chip">CSV / TXT 匯出</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Section
            title="1. 讀取 Athena 資料"
            description="資料夾上傳會依子資料夾分樣品。"
            compact
          >
            <div className="space-y-2">
              <input
                ref={folderInputRef}
                type="file"
                multiple
                accept=".xmu"
                className="hidden"
                {...directoryInputProps}
                onChange={event => {
                  void handleFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xmu"
                className="hidden"
                onChange={event => {
                  void handleFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                disabled={isLoading}
                onClick={() => folderInputRef.current?.click()}
                className="w-full rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                讀取整個資料夾
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm font-semibold text-[var(--text-main)] transition-colors hover:border-[var(--accent-secondary)] disabled:opacity-50"
              >
                選擇多個 .xmu 檔案
              </button>
              {message && <p className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs leading-5 text-[var(--text-soft)]">{message}</p>}
            </div>
          </Section>

          <Section title="2. 匯出動作" compact>
            <div className="grid gap-2">
              <button
                type="button"
                disabled={!result?.scans.length}
                onClick={exportAllRawScans}
                className="rounded-xl border border-[var(--card-border)] px-3 py-2 text-left text-xs font-semibold text-[var(--text-main)] disabled:opacity-40"
              >
                匯出全部原始轉換 CSV
              </button>
              <button
                type="button"
                disabled={averageCount === 0}
                onClick={exportAllAverages}
                className="rounded-xl border border-[var(--card-border)] px-3 py-2 text-left text-xs font-semibold text-[var(--text-main)] disabled:opacity-40"
              >
                匯出全部平均結果 CSV
              </button>
              <button
                type="button"
                disabled={!result}
                onClick={exportSummary}
                className="rounded-xl border border-[var(--card-border)] px-3 py-2 text-left text-xs font-semibold text-[var(--text-main)] disabled:opacity-40"
              >
                匯出處理摘要 TXT
              </button>
            </div>
          </Section>

          <Section title="3. 手動刪峰" description="用滑桿選取要刪掉的 energy 區間。" compact>
            {selectedGroup && selectedEnergyRange ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                  <div className="mb-3 grid gap-2">
                    <label className="text-xs font-semibold text-[var(--text-soft)]">
                      刪除對象
                      <select
                        value={removalDraft.scan}
                        onChange={event => setRemovalDraft(current => ({ ...current, scan: event.target.value as AthenaManualRemovalRegion['scan'] }))}
                        className="mt-1 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--input-text)]"
                      >
                        <option value="both">兩筆 scan</option>
                        <option value="scan1">只刪 scan 1</option>
                        <option value="scan2">只刪 scan 2</option>
                      </select>
                    </label>
                    <div className="rounded-xl border border-[var(--card-border)] px-3 py-1.5">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">Start</div>
                      <div className="font-mono text-sm text-[var(--text-main)]">{formatEnergy(Math.min(removalDraft.start, removalDraft.end))} eV</div>
                    </div>
                    <div className="rounded-xl border border-[var(--card-border)] px-3 py-1.5">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">End</div>
                      <div className="font-mono text-sm text-[var(--text-main)]">{formatEnergy(Math.max(removalDraft.start, removalDraft.end))} eV</div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-[var(--text-soft)]">
                      左邊界
                      <input
                        type="range"
                        min={selectedEnergyRange.min}
                        max={selectedEnergyRange.max}
                        step={selectedEnergyRange.step}
                        value={clampRangeValue(removalDraft.start, selectedEnergyRange.min, selectedEnergyRange.max)}
                        onChange={event => setRemovalDraft(current => ({ ...current, start: Number(event.target.value) }))}
                        className="mt-2 w-full accent-[var(--accent-secondary)]"
                      />
                    </label>
                    <label className="block text-xs font-semibold text-[var(--text-soft)]">
                      右邊界
                      <input
                        type="range"
                        min={selectedEnergyRange.min}
                        max={selectedEnergyRange.max}
                        step={selectedEnergyRange.step}
                        value={clampRangeValue(removalDraft.end, selectedEnergyRange.min, selectedEnergyRange.max)}
                        onChange={event => setRemovalDraft(current => ({ ...current, end: Number(event.target.value) }))}
                        className="mt-2 w-full accent-[var(--accent-secondary)]"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={addManualRemoval}
                    className="mt-3 w-full rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)]"
                  >
                    加入刪峰區間
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">Manual regions</p>
                    <button type="button" disabled={selectedManualRemovals.length === 0} onClick={clearSelectedManualRemovals} className="text-xs font-semibold text-rose-400 disabled:opacity-40">
                      清除全部
                    </button>
                  </div>
                  {selectedManualRemovals.length ? selectedManualRemovals.map(region => (
                    <div key={region.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--card-border)] px-3 py-2 text-xs">
                      <span className="text-[var(--text-main)]">
                        {region.scan === 'both' ? '兩筆' : region.scan === 'scan1' ? 'scan 1' : 'scan 2'} · {formatEnergy(region.start)}–{formatEnergy(region.end)} eV
                      </span>
                      <button type="button" onClick={() => removeManualRemoval(selectedGroup.sampleName, region.id)} className="font-semibold text-rose-400">
                        移除
                      </button>
                    </div>
                  )) : (
                    <div className="rounded-xl border border-dashed border-[var(--card-border)] px-3 py-3 text-xs text-[var(--text-soft)]">
                      目前沒有手動刪峰區間。
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--card-border)] px-3 py-4 text-sm text-[var(--text-soft)]">
                讀取至少兩筆同一樣品的 .xmu 後，這裡會出現刪峰滑桿。
              </div>
            )}
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="4. 樣品與預覽">
            {adjustedResult ? (
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {adjustedResult.groups.map(group => (
                    <button
                      key={group.sampleName}
                      type="button"
                      onClick={() => setSelectedSampleName(group.sampleName)}
                      className={[
                        'rounded-xl border px-3 py-2 text-left transition-colors',
                        selectedGroup?.sampleName === group.sampleName
                          ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)]'
                          : 'border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--accent-secondary)]',
                      ].join(' ')}
                    >
                      <span className="block text-sm font-semibold text-[var(--text-main)]">{group.sampleName}</span>
                      <span className="mt-0.5 block text-[11px] text-[var(--text-soft)]">{group.scans.length} scans / {group.average ? '已有平均' : '無平均'}</span>
                    </button>
                  ))}
                </div>

                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewMode('normalized')}
                        className={`rounded-full px-4 py-2 text-xs font-semibold ${previewMode === 'normalized' ? 'bg-[var(--accent)] text-[var(--accent-contrast)]' : 'border border-[var(--card-border)] text-[var(--text-main)]'}`}
                      >
                        Normalized μ(E)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode('flattened')}
                        className={`rounded-full px-4 py-2 text-xs font-semibold ${previewMode === 'flattened' ? 'bg-[var(--accent)] text-[var(--accent-contrast)]' : 'border border-[var(--card-border)] text-[var(--text-main)]'}`}
                      >
                        Flattened μ(E)
                      </button>
                    </div>
                    {selectedGroup && (
                      <div className="flex flex-wrap gap-2">
                        {selectedGroup.scans[0] && (
                          <button type="button" onClick={() => downloadRawScan(selectedGroup.scans[0])} className="rounded-full border border-[var(--card-border)] px-3 py-2 text-xs font-semibold text-[var(--text-main)]">
                            匯出目前第一筆 scan
                          </button>
                        )}
                        {selectedGroup.average && (
                          <button type="button" onClick={() => downloadAverageResult(selectedGroup.average as AthenaAverageResult)} className="rounded-full border border-[var(--card-border)] px-3 py-2 text-xs font-semibold text-[var(--text-main)]">
                            匯出目前平均 CSV
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {previewFigure ? (
                    <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-2">
                      <Plot data={previewFigure.data} layout={previewFigure.layout} config={previewFigure.config} />
                    </div>
                  ) : (
                    <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] text-sm text-[var(--text-soft)]">
                      讀取 Athena .xmu 資料夾後，預覽圖會顯示在這裡。
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-6 text-center text-sm leading-7 text-[var(--text-soft)]">
                尚未讀取資料。請先點選「讀取整個資料夾」，或選擇多個 Athena .xmu 檔案。
              </div>
            )}
          </Section>

          {selectedGroup && (
            <Section title="5. 處理狀態">
              <div className="overflow-hidden rounded-2xl border border-[var(--card-border)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[var(--card-ghost)] text-xs text-[var(--text-soft)]">
                    <tr>
                      <th className="px-3 py-2">檔名</th>
                      <th className="px-3 py-2">E0</th>
                      <th className="px-3 py-2">edge step</th>
                      <th className="px-3 py-2">點數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedGroup.scans.map(scan => (
                      <tr key={scan.id} className="border-t border-[var(--card-border)]">
                        <td className="px-3 py-2 text-[var(--text-main)]">{scan.fileName}</td>
                        <td className="px-3 py-2 text-[var(--text-soft)]">{scan.e0 ?? '-'}</td>
                        <td className="px-3 py-2 text-[var(--text-soft)]">{scan.edgeStep}</td>
                        <td className="px-3 py-2 text-[var(--text-soft)]">{scan.energy.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedGroup.warning && <p className="mt-3 text-sm text-amber-300">{selectedGroup.warning}</p>}
              {adjustedResult?.errors.length ? (
                <div className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-200">
                  {adjustedResult.errors.map(error => <div key={error}>{error}</div>)}
                </div>
              ) : null}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
