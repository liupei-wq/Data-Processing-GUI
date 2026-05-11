import { useMemo, useRef, useState, type ReactNode } from 'react'
import Plot from '../components/PlotlyChart'
import {
  buildAthenaAverageCsv,
  buildAthenaRawCsv,
  buildAthenaSummaryTxt,
  downloadTextFile,
  processAthenaFiles,
  safeAthenaFilename,
  type AthenaAverageResult,
  type AthenaProcessResult,
  type AthenaSampleGroup,
  type AthenaScanResult,
} from '../features/athena/athenaXmu'

type AthenaPreviewMode = 'normalized' | 'flattened'

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

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="workspace-stage-card rounded-[28px] p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-[var(--text-main)]">{title}</h2>
        {description && <p className="mt-1 text-sm leading-6 text-[var(--text-soft)]">{description}</p>}
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

  const selectedGroup = useMemo<AthenaSampleGroup | null>(() => {
    if (!result?.groups.length) return null
    return result.groups.find(group => group.sampleName === selectedSampleName) ?? result.groups[0]
  }, [result, selectedSampleName])

  const previewFigure = useMemo(() => {
    if (!selectedGroup) return null

    const data: Plotly.Data[] = selectedGroup.scans.map((scan, index) => ({
      x: scan.energy,
      y: previewMode === 'normalized' ? scan.normalizedMu : scan.flattenedMu,
      type: 'scatter',
      mode: 'lines',
      name: `${scan.fileName}`,
      line: { width: 1.5 },
      opacity: index < 2 ? 0.72 : 0.35,
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
        line: { width: 3, color: '#f97316' },
        hovertemplate: 'Energy：%{x:.3f} eV<br>平均 μ(E)：%{y:.6f}<extra></extra>',
      })
    }

    return {
      data,
      layout: {
        autosize: true,
        height: 420,
        margin: { l: 62, r: 24, t: 48, b: 58 },
        title: { text: `Athena ${selectedGroup.sampleName} ${previewMode === 'normalized' ? 'Normalized' : 'Flattened'} 預覽` },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: 'var(--text-main)' },
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
        legend: { orientation: 'h', y: -0.22 },
      } satisfies Partial<Plotly.Layout>,
      config: { responsive: true, displaylogo: false } satisfies Partial<Plotly.Config>,
    }
  }, [previewMode, selectedGroup])

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return
    setIsLoading(true)
    setMessage('正在讀取 Athena .xmu 檔案...')
    try {
      const nextResult = await processAthenaFiles(files)
      setResult(nextResult)
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
    if (!result) return
    result.groups.forEach(group => {
      if (group.average) downloadAverageResult(group.average)
    })
  }

  const exportSummary = () => {
    if (!result) return
    triggerDownload(`athena_summary_${timestampForFilename()}.txt`, buildAthenaSummaryTxt(result))
  }

  const averageCount = result?.groups.filter(group => group.average).length ?? 0

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-6 lg:px-8">
      <div className="topbar-panel">
        <div className="topbar-eyebrow">Data Tool</div>
        <div className="module-title-row">
          <h1 className="module-title">Athena</h1>
          <span className="module-subtitle">Athena .xmu folder processor</span>
        </div>
        <p className="module-description">
          讀取整個資料夾中的 Athena .xmu 檔案，依子資料夾分樣品，計算 Normalized μ(E) 與 Flattened μ(E)，並可把每個處理動作匯出成檔案。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="status-chip">資料夾讀取</span>
          <span className="status-chip">Normalized / Flattened</span>
          <span className="status-chip">重複量測平均</span>
          <span className="status-chip">CSV / TXT 匯出</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section
            title="1. 讀取 Athena 資料"
            description="建議使用資料夾上傳；每個子資料夾會視為一個樣品，子資料夾內的 .xmu 會視為重複量測。"
          >
            <div className="space-y-3">
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
                className="w-full rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--accent-contrast)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                讀取整個資料夾
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-main)] transition-colors hover:border-[var(--accent-secondary)] disabled:opacity-50"
              >
                選擇多個 .xmu 檔案
              </button>
              {message && <p className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-4 py-3 text-sm leading-6 text-[var(--text-soft)]">{message}</p>}
            </div>
          </Section>

          <Section title="2. 匯出動作" description="每個處理階段都可直接下載；大量下載時瀏覽器可能會詢問是否允許多檔下載。">
            <div className="grid gap-2">
              <button
                type="button"
                disabled={!result?.scans.length}
                onClick={exportAllRawScans}
                className="rounded-xl border border-[var(--card-border)] px-4 py-2.5 text-left text-sm font-semibold text-[var(--text-main)] disabled:opacity-40"
              >
                匯出全部原始轉換 CSV
              </button>
              <button
                type="button"
                disabled={averageCount === 0}
                onClick={exportAllAverages}
                className="rounded-xl border border-[var(--card-border)] px-4 py-2.5 text-left text-sm font-semibold text-[var(--text-main)] disabled:opacity-40"
              >
                匯出全部平均結果 CSV
              </button>
              <button
                type="button"
                disabled={!result}
                onClick={exportSummary}
                className="rounded-xl border border-[var(--card-border)] px-4 py-2.5 text-left text-sm font-semibold text-[var(--text-main)] disabled:opacity-40"
              >
                匯出處理摘要 TXT
              </button>
            </div>
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="3. 樣品與預覽">
            {result ? (
              <div className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
                <div className="space-y-2">
                  {result.groups.map(group => (
                    <button
                      key={group.sampleName}
                      type="button"
                      onClick={() => setSelectedSampleName(group.sampleName)}
                      className={[
                        'w-full rounded-2xl border px-4 py-3 text-left transition-colors',
                        selectedGroup?.sampleName === group.sampleName
                          ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)]'
                          : 'border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--accent-secondary)]',
                      ].join(' ')}
                    >
                      <span className="block text-sm font-semibold text-[var(--text-main)]">{group.sampleName}</span>
                      <span className="mt-1 block text-xs text-[var(--text-soft)]">{group.scans.length} scans / {group.average ? '已有平均' : '無平均'}</span>
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
                    <Plot data={previewFigure.data} layout={previewFigure.layout} config={previewFigure.config} />
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
            <Section title="4. 處理狀態">
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
              {result?.errors.length ? (
                <div className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-200">
                  {result.errors.map(error => <div key={error}>{error}</div>)}
                </div>
              ) : null}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
