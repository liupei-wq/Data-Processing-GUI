import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import Plot, { type PlotRelayoutEvent } from '../components/PlotlyChart'
import {
  buildAthenaAverageCsv,
  buildAthenaOriginProjectPython,
  buildAthenaRawCsv,
  buildAthenaSummaryTxt,
  DEFAULT_ATHENA_AUTO_REMOVAL_OPTIONS,
  DEFAULT_ATHENA_REFINEMENT_SETTINGS,
  applyAthenaRefinementToScan,
  downloadTextFile,
  makeAthenaAverage,
  processAthenaFiles,
  safeAthenaFilename,
  type AthenaAverageResult,
  type AthenaAutoRemovalOptions,
  type AthenaManualRemovalRegion,
  type AthenaManualRestoreRegion,
  type AthenaProcessResult,
  type AthenaRefinementSettings,
  type AthenaSampleGroup,
  type AthenaScanResult,
} from '../features/athena/athenaXmu'
import { timestampForUtc8Filename } from '../utils/time'

type AthenaPreviewMode = 'normalized' | 'flattened'
type AthenaManualEditMode = 'remove' | 'restore'
type RemovalDraft = { start: number; end: number; scan: AthenaManualRemovalRegion['scan'] }
type RestoreDraft = { start: number; end: number; scan: AthenaManualRestoreRegion['scan'] }
type AthenaRemovalSensitivity = 'standard' | 'loose' | 'very-loose' | 'extra-loose'
type AthenaRefinementNumberKey = 'backgroundSlope' | 'backgroundOffset' | 'normalizationScale' | 'normalizationOffset'
type EditablePlotlyShape = Partial<Plotly.Shape> & { editable?: boolean }

const ATHENA_TRACE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5']
const ATHENA_AVERAGE_COLOR = '#111827'
const ATHENA_REMOVAL_FILL = 'rgba(245, 158, 11, 0.18)'
const ATHENA_REMOVAL_LINE = 'rgba(245, 158, 11, 0.72)'
const ATHENA_DRAFT_REMOVAL_FILL = 'rgba(59, 130, 246, 0.16)'
const ATHENA_DRAFT_REMOVAL_LINE = 'rgba(37, 99, 235, 0.78)'
const ATHENA_RESTORE_FILL = 'rgba(34, 197, 94, 0.16)'
const ATHENA_RESTORE_LINE = 'rgba(22, 163, 74, 0.78)'
const ATHENA_DRAFT_RESTORE_FILL = 'rgba(20, 184, 166, 0.16)'
const ATHENA_DRAFT_RESTORE_LINE = 'rgba(13, 148, 136, 0.78)'
const ATHENA_REMOVAL_SENSITIVITY_OPTIONS: Array<{
  id: AthenaRemovalSensitivity
  label: string
  detail: string
  options: AthenaAutoRemovalOptions
}> = [
  {
    id: 'loose',
    label: '寬鬆',
    detail: '目前建議值，較容易抓出差異峰',
    options: DEFAULT_ATHENA_AUTO_REMOVAL_OPTIONS,
  },
  {
    id: 'very-loose',
    label: '很寬鬆',
    detail: '適合想多抓一些肩峰與小尖峰',
    options: { diffMadFactor: 2.2, edgeThresholdRatio: 0.18, minPeakSegmentPoints: 1 },
  },
  {
    id: 'extra-loose',
    label: '極寬鬆',
    detail: '會抓更多疑似差異段，適合先大量清除再手動調整',
    options: { diffMadFactor: 1.6, edgeThresholdRatio: 0.12, minPeakSegmentPoints: 1 },
  },
  {
    id: 'standard',
    label: '標準',
    detail: '較保守，接近原本自動刪峰',
    options: { diffMadFactor: 4.5, edgeThresholdRatio: 0.35, minPeakSegmentPoints: 1 },
  },
]

const directoryInputProps = {
  webkitdirectory: '',
  directory: '',
} as Record<string, string>

function timestampForFilename() {
  return timestampForUtc8Filename()
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

function formatSettingValue(value: number, digits = 6) {
  if (!Number.isFinite(value)) return '0'
  return Number(value.toFixed(digits)).toString()
}

function updateNumericSetting(
  setter: Dispatch<SetStateAction<AthenaRefinementSettings>>,
  key: AthenaRefinementNumberKey,
  value: string,
) {
  const parsed = Number(value)
  setter(current => ({
    ...current,
    [key]: Number.isFinite(parsed) ? parsed : DEFAULT_ATHENA_REFINEMENT_SETTINGS[key],
  }))
}

function relayoutNumber(event: PlotRelayoutEvent, key: string) {
  const value = event[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function relayoutShapeRange(event: PlotRelayoutEvent, shapeIndex: number) {
  const directX0 = relayoutNumber(event, `shapes[${shapeIndex}].x0`)
  const directX1 = relayoutNumber(event, `shapes[${shapeIndex}].x1`)
  if (directX0 != null || directX1 != null) return { x0: directX0, x1: directX1 }

  const shape = event[`shapes[${shapeIndex}]`]
  if (!shape || typeof shape !== 'object') return null
  const maybeShape = shape as { x0?: unknown; x1?: unknown }
  const x0 = typeof maybeShape.x0 === 'number' && Number.isFinite(maybeShape.x0) ? maybeShape.x0 : null
  const x1 = typeof maybeShape.x1 === 'number' && Number.isFinite(maybeShape.x1) ? maybeShape.x1 : null
  if (x0 == null && x1 == null) return null
  return { x0, x1 }
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, value])

  return debouncedValue
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
  const [manualRestores, setManualRestores] = useState<Record<string, AthenaManualRestoreRegion[]>>({})
  const [manualEditMode, setManualEditMode] = useState<AthenaManualEditMode>('remove')
  const [removalDraft, setRemovalDraft] = useState<RemovalDraft>({ start: 0, end: 0, scan: 'both' })
  const [restoreDraft, setRestoreDraft] = useState<RestoreDraft>({ start: 0, end: 0, scan: 'both' })
  const [removalSensitivity, setRemovalSensitivity] = useState<AthenaRemovalSensitivity>('loose')
  const [refinementSettings, setRefinementSettings] = useState<AthenaRefinementSettings>(DEFAULT_ATHENA_REFINEMENT_SETTINGS)
  const chartRemovalDraft = useDebouncedValue(removalDraft, 80)
  const chartRestoreDraft = useDebouncedValue(restoreDraft, 80)
  const autoRemovalOptions = useMemo(
    () => ATHENA_REMOVAL_SENSITIVITY_OPTIONS.find(option => option.id === removalSensitivity)?.options ?? DEFAULT_ATHENA_AUTO_REMOVAL_OPTIONS,
    [removalSensitivity],
  )
  const activeRemovalSensitivity = ATHENA_REMOVAL_SENSITIVITY_OPTIONS.find(option => option.id === removalSensitivity) ?? ATHENA_REMOVAL_SENSITIVITY_OPTIONS[0]

  const adjustedResult = useMemo<AthenaProcessResult | null>(() => {
    if (!result) return null
    const refinedScans = result.scans.map(scan => applyAthenaRefinementToScan(scan, refinementSettings))
    const refinedScanById = new Map(refinedScans.map(scan => [scan.id, scan]))
    return {
      ...result,
      scans: refinedScans,
      groups: result.groups.map(group => {
        const sortedScans = group.scans
          .map(scan => refinedScanById.get(scan.id) ?? scan)
          .sort((a, b) => a.fileName.localeCompare(b.fileName))
        if (sortedScans.length < 2) return group
        try {
          return {
            ...group,
            scans: sortedScans,
            average: makeAthenaAverage(
              group.sampleName,
              sortedScans[0],
              sortedScans[1],
              manualRemovals[group.sampleName] ?? [],
              manualRestores[group.sampleName] ?? [],
              autoRemovalOptions,
            ),
          }
        } catch {
          return group
        }
      }),
    }
  }, [autoRemovalOptions, manualRemovals, manualRestores, refinementSettings, result])

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
  const selectedManualRestores = selectedGroup ? manualRestores[selectedGroup.sampleName] ?? [] : []

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
    setRestoreDraft(current => {
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

    const removalShapes: EditablePlotlyShape[] = selectedManualRemovals.map(region => ({
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
      editable: false,
    }))

    for (const region of selectedManualRestores) {
      removalShapes.push({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: Math.min(region.start, region.end),
        x1: Math.max(region.start, region.end),
        y0: 0,
        y1: 1,
        fillcolor: ATHENA_RESTORE_FILL,
        line: { color: ATHENA_RESTORE_LINE, width: 1 },
        layer: 'below',
        editable: false,
      })
    }

    if (selectedEnergyRange && manualEditMode === 'remove') {
      const draftStart = clampRangeValue(chartRemovalDraft.start, selectedEnergyRange.min, selectedEnergyRange.max)
      const draftEnd = clampRangeValue(chartRemovalDraft.end, selectedEnergyRange.min, selectedEnergyRange.max)
      if (Math.abs(draftEnd - draftStart) > selectedEnergyRange.step / 2) {
        removalShapes.push({
          type: 'rect',
          xref: 'x',
          yref: 'paper',
          x0: Math.min(draftStart, draftEnd),
          x1: Math.max(draftStart, draftEnd),
          y0: 0,
          y1: 1,
          fillcolor: ATHENA_DRAFT_REMOVAL_FILL,
          line: { color: ATHENA_DRAFT_REMOVAL_LINE, width: 1.5 },
          layer: 'below',
          editable: true,
        })
      }
    }

    if (selectedEnergyRange && manualEditMode === 'restore') {
      const draftRestoreStart = clampRangeValue(chartRestoreDraft.start, selectedEnergyRange.min, selectedEnergyRange.max)
      const draftRestoreEnd = clampRangeValue(chartRestoreDraft.end, selectedEnergyRange.min, selectedEnergyRange.max)
      if (Math.abs(draftRestoreEnd - draftRestoreStart) > selectedEnergyRange.step / 2) {
        removalShapes.push({
          type: 'rect',
          xref: 'x',
          yref: 'paper',
          x0: Math.min(draftRestoreStart, draftRestoreEnd),
          x1: Math.max(draftRestoreStart, draftRestoreEnd),
          y0: 0,
          y1: 1,
          fillcolor: ATHENA_DRAFT_RESTORE_FILL,
          line: { color: ATHENA_DRAFT_RESTORE_LINE, width: 1.5 },
          layer: 'below',
          editable: true,
        })
      }
    }

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
      config: {
        responsive: true,
        displaylogo: false,
        editable: true,
        edits: { shapePosition: true },
      } satisfies Partial<Plotly.Config>,
    }
  }, [
    previewMode,
    chartRemovalDraft.end,
    chartRemovalDraft.start,
    chartRestoreDraft.end,
    chartRestoreDraft.start,
    manualEditMode,
    selectedEnergyRange,
    selectedGroup,
    selectedManualRemovals,
    selectedManualRestores,
  ])

  const finalResultFigure = useMemo(() => {
    if (!selectedGroup?.average) return null
    const average = selectedGroup.average
    const isNormalized = previewMode === 'normalized'
    const yTitle = isNormalized ? 'Final Normalized mu(E)' : 'Final Flattened mu(E)'
    const data: Plotly.Data[] = [
      {
        x: average.energy,
        y: isNormalized ? average.scan1NormalizedClean : average.scan1FlattenedClean,
        type: 'scatter',
        mode: 'lines',
        name: `${average.sourceScan1} clean`,
        line: { width: 1.4, color: ATHENA_TRACE_COLORS[0], dash: 'dot' },
        opacity: 0.75,
        hovertemplate: 'Energy: %{x:.3f} eV<br>Clean scan 1: %{y:.6f}<extra></extra>',
      },
      {
        x: average.energy,
        y: isNormalized ? average.scan2NormalizedClean : average.scan2FlattenedClean,
        type: 'scatter',
        mode: 'lines',
        name: `${average.sourceScan2} clean`,
        line: { width: 1.4, color: ATHENA_TRACE_COLORS[1], dash: 'dot' },
        opacity: 0.75,
        hovertemplate: 'Energy: %{x:.3f} eV<br>Clean scan 2: %{y:.6f}<extra></extra>',
      },
      {
        x: average.energy,
        y: isNormalized ? average.averageNormalized : average.averageFlattened,
        type: 'scatter',
        mode: 'lines',
        name: isNormalized ? 'Final average normalized' : 'Final average flattened',
        line: { width: 3.4, color: ATHENA_AVERAGE_COLOR },
        hovertemplate: 'Energy: %{x:.3f} eV<br>Final average: %{y:.6f}<extra></extra>',
      },
    ]

    return {
      data,
      layout: {
        autosize: true,
        height: 360,
        margin: { l: 66, r: 28, t: 42, b: 66 },
        title: { text: `${selectedGroup.sampleName} final ${isNormalized ? 'normalized' : 'flattened'} result` },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: 'var(--text-main)' },
        xaxis: {
          title: { text: 'Energy (eV)' },
          gridcolor: 'rgba(148,163,184,0.18)',
          zerolinecolor: 'rgba(148,163,184,0.24)',
        },
        yaxis: {
          title: { text: yTitle },
          gridcolor: 'rgba(148,163,184,0.18)',
          zerolinecolor: 'rgba(148,163,184,0.24)',
        },
        legend: { orientation: 'h', x: 0, y: -0.2, xanchor: 'left', yanchor: 'top' },
      } satisfies Partial<Plotly.Layout>,
      config: { responsive: true, displaylogo: false } satisfies Partial<Plotly.Config>,
    }
  }, [previewMode, selectedGroup])

  const handlePreviewRelayout = (event: PlotRelayoutEvent) => {
    if (!selectedEnergyRange) return

    const draftIsVisible = (draft: RemovalDraft | RestoreDraft) => {
      const start = clampRangeValue(draft.start, selectedEnergyRange.min, selectedEnergyRange.max)
      const end = clampRangeValue(draft.end, selectedEnergyRange.min, selectedEnergyRange.max)
      return Math.abs(end - start) > selectedEnergyRange.step / 2
    }
    const applyDraftRange = <T extends RemovalDraft | RestoreDraft>(
      setter: Dispatch<SetStateAction<T>>,
      currentDraft: T,
      range: { x0: number | null; x1: number | null } | null,
    ) => {
      if (!range) return
      const nextStart = clampRangeValue(range.x0 ?? currentDraft.start, selectedEnergyRange.min, selectedEnergyRange.max)
      const nextEnd = clampRangeValue(range.x1 ?? currentDraft.end, selectedEnergyRange.min, selectedEnergyRange.max)
      setter(current => ({ ...current, start: nextStart, end: nextEnd }))
    }

    const savedShapeCount = selectedManualRemovals.length + selectedManualRestores.length
    const removalVisible = manualEditMode === 'remove' && draftIsVisible(removalDraft)
    const restoreVisible = manualEditMode === 'restore' && draftIsVisible(restoreDraft)
    if (removalVisible) {
      applyDraftRange(setRemovalDraft, removalDraft, relayoutShapeRange(event, savedShapeCount))
    }
    if (restoreVisible) {
      applyDraftRange(
        setRestoreDraft,
        restoreDraft,
        relayoutShapeRange(event, savedShapeCount),
      )
    }
  }

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return
    setIsLoading(true)
    setMessage('正在讀取 Athena .xmu 檔案...')
    try {
      const nextResult = await processAthenaFiles(files)
      setResult(nextResult)
      setManualRemovals({})
      setManualRestores({})
      setSelectedSampleName(nextResult.groups[0]?.sampleName ?? '')
      setMessage(`完成：讀取 ${nextResult.scans.length} 筆 .xmu，建立 ${nextResult.groups.length} 個樣品群組。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Athena 檔案處理失敗。')
    } finally {
      setIsLoading(false)
    }
  }

  const exportAllRawScans = () => {
    if (!adjustedResult?.scans.length) return
    adjustedResult.scans.forEach(downloadRawScan)
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

  const exportOriginProjectScript = () => {
    if (!adjustedResult) return
    triggerDownload(
      `athena_create_origin_project_${timestampForFilename()}.py`,
      buildAthenaOriginProjectPython(adjustedResult),
      'text/x-python;charset=utf-8',
    )
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

  const addManualRestore = () => {
    if (!selectedGroup || !selectedEnergyRange) return
    const start = clampRangeValue(restoreDraft.start, selectedEnergyRange.min, selectedEnergyRange.max)
    const end = clampRangeValue(restoreDraft.end, selectedEnergyRange.min, selectedEnergyRange.max)
    setManualRestores(current => ({
      ...current,
      [selectedGroup.sampleName]: [
        ...(current[selectedGroup.sampleName] ?? []),
        { id: makeRemovalId(), start: Math.min(start, end), end: Math.max(start, end), scan: restoreDraft.scan },
      ],
    }))
  }

  const removeManualRemoval = (sampleName: string, regionId: string) => {
    setManualRemovals(current => ({
      ...current,
      [sampleName]: (current[sampleName] ?? []).filter(region => region.id !== regionId),
    }))
  }

  const removeManualRestore = (sampleName: string, regionId: string) => {
    setManualRestores(current => ({
      ...current,
      [sampleName]: (current[sampleName] ?? []).filter(region => region.id !== regionId),
    }))
  }

  const clearSelectedManualRemovals = () => {
    if (!selectedGroup) return
    setManualRemovals(current => ({ ...current, [selectedGroup.sampleName]: [] }))
  }

  const clearSelectedManualRestores = () => {
    if (!selectedGroup) return
    setManualRestores(current => ({ ...current, [selectedGroup.sampleName]: [] }))
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
                disabled={!adjustedResult?.scans.length}
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
              <button
                type="button"
                disabled={!adjustedResult}
                onClick={exportOriginProjectScript}
                className="rounded-xl border border-[var(--accent-secondary)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_10%,transparent)] px-3 py-2 text-left text-xs font-semibold text-[var(--text-main)] disabled:opacity-40"
              >
                匯出 OriginPro 產檔腳本
              </button>
            </div>
          </Section>

          <Section title="3. 線性背景 / 歸一化微調" description="套用到目前所有 Athena scan；平均、刪峰、CSV 與 Origin script 會同步使用微調後曲線。" compact>
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-sm font-semibold text-[var(--text-main)]">
                <span>線性扣背景</span>
                <input
                  type="checkbox"
                  checked={refinementSettings.linearBackgroundEnabled}
                  onChange={event => setRefinementSettings(current => ({ ...current, linearBackgroundEnabled: event.target.checked }))}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-[var(--text-soft)]">
                  背景斜率 / eV
                  <input
                    type="number"
                    step="0.0001"
                    value={formatSettingValue(refinementSettings.backgroundSlope)}
                    onChange={event => updateNumericSetting(setRefinementSettings, 'backgroundSlope', event.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--input-text)]"
                  />
                </label>
                <label className="text-xs font-semibold text-[var(--text-soft)]">
                  背景截距
                  <input
                    type="number"
                    step="0.001"
                    value={formatSettingValue(refinementSettings.backgroundOffset)}
                    onChange={event => updateNumericSetting(setRefinementSettings, 'backgroundOffset', event.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--input-text)]"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-[var(--text-soft)]">
                  歸一化倍率
                  <input
                    type="number"
                    step="0.001"
                    value={formatSettingValue(refinementSettings.normalizationScale)}
                    onChange={event => updateNumericSetting(setRefinementSettings, 'normalizationScale', event.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--input-text)]"
                  />
                </label>
                <label className="text-xs font-semibold text-[var(--text-soft)]">
                  歸一化平移
                  <input
                    type="number"
                    step="0.001"
                    value={formatSettingValue(refinementSettings.normalizationOffset)}
                    onChange={event => updateNumericSetting(setRefinementSettings, 'normalizationOffset', event.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--input-text)]"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-[var(--card-border)] px-3 py-2 text-xs leading-5 text-[var(--text-soft)]">
                線性背景以每筆 scan 的 E0 為中心；若檔案沒有 E0，則使用第一個 energy 點。
              </div>

              <button
                type="button"
                onClick={() => setRefinementSettings(DEFAULT_ATHENA_REFINEMENT_SETTINGS)}
                className="w-full rounded-xl border border-[var(--card-border)] px-3 py-2 text-xs font-semibold text-[var(--text-main)]"
              >
                重設微調參數
              </button>
            </div>
          </Section>

          <Section title="4. 手動刪峰" description="用滑桿選取要刪掉的 energy 區間。" compact>
            {selectedGroup && selectedEnergyRange ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setManualEditMode('remove')}
                      className={[
                        'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                        manualEditMode === 'remove'
                          ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                          : 'border border-[var(--card-border)] text-[var(--text-main)]',
                      ].join(' ')}
                    >
                      刪峰
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualEditMode('restore')}
                      className={[
                        'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                        manualEditMode === 'restore'
                          ? 'bg-emerald-500 text-white'
                          : 'border border-[var(--card-border)] text-[var(--text-main)]',
                      ].join(' ')}
                    >
                      加回
                    </button>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[var(--text-soft)]">
                    先選擇刪峰或加回，右側預覽圖只會顯示目前選項的可拖曳區間。
                  </p>
                </div>
                <div className={manualEditMode === 'remove' ? 'rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3' : 'hidden'}>
                  <label className="text-xs font-semibold text-[var(--text-soft)]">
                    自動刪峰靈敏度
                    <select
                      value={removalSensitivity}
                      onChange={event => setRemovalSensitivity(event.target.value as AthenaRemovalSensitivity)}
                      className="mt-1 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--input-text)]"
                    >
                      {ATHENA_REMOVAL_SENSITIVITY_OPTIONS.map(option => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-2 text-xs leading-5 text-[var(--text-soft)]">{activeRemovalSensitivity.detail}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[var(--text-soft)]">
                    <span className="rounded-lg border border-[var(--card-border)] px-2 py-1">MAD {autoRemovalOptions.diffMadFactor}</span>
                    <span className="rounded-lg border border-[var(--card-border)] px-2 py-1">邊界 {autoRemovalOptions.edgeThresholdRatio}</span>
                  </div>
                </div>

                <div className={manualEditMode === 'remove' ? 'rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3' : 'hidden'}>
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

                <div className={manualEditMode === 'restore' ? 'rounded-xl border border-[color:color-mix(in_srgb,#16a34a_34%,var(--card-border))] bg-[color:color-mix(in_srgb,#16a34a_8%,transparent)] p-3' : 'hidden'}>
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-main)]">加回誤刪資料</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">綠色區間會把自動/手動 removal mask 清掉，改用原始資料參與平均。</p>
                    </div>
                    <span className="rounded-full border border-[color:color-mix(in_srgb,#16a34a_45%,var(--card-border))] px-2 py-1 text-[10px] font-semibold text-[var(--text-soft)]">
                      Restore
                    </span>
                  </div>

                  <div className="mb-3 grid gap-2">
                    <label className="text-xs font-semibold text-[var(--text-soft)]">
                      加回對象
                      <select
                        value={restoreDraft.scan}
                        onChange={event => setRestoreDraft(current => ({ ...current, scan: event.target.value as AthenaManualRestoreRegion['scan'] }))}
                        className="mt-1 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--input-text)]"
                      >
                        <option value="both">兩筆 scan</option>
                        <option value="scan1">只加回 scan 1</option>
                        <option value="scan2">只加回 scan 2</option>
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-[var(--card-border)] px-3 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">Start</div>
                        <div className="font-mono text-sm text-[var(--text-main)]">{formatEnergy(Math.min(restoreDraft.start, restoreDraft.end))} eV</div>
                      </div>
                      <div className="rounded-xl border border-[var(--card-border)] px-3 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">End</div>
                        <div className="font-mono text-sm text-[var(--text-main)]">{formatEnergy(Math.max(restoreDraft.start, restoreDraft.end))} eV</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-[var(--text-soft)]">
                      加回左邊界
                      <input
                        type="range"
                        min={selectedEnergyRange.min}
                        max={selectedEnergyRange.max}
                        step={selectedEnergyRange.step}
                        value={clampRangeValue(restoreDraft.start, selectedEnergyRange.min, selectedEnergyRange.max)}
                        onChange={event => setRestoreDraft(current => ({ ...current, start: Number(event.target.value) }))}
                        className="mt-2 w-full accent-emerald-500"
                      />
                    </label>
                    <label className="block text-xs font-semibold text-[var(--text-soft)]">
                      加回右邊界
                      <input
                        type="range"
                        min={selectedEnergyRange.min}
                        max={selectedEnergyRange.max}
                        step={selectedEnergyRange.step}
                        value={clampRangeValue(restoreDraft.end, selectedEnergyRange.min, selectedEnergyRange.max)}
                        onChange={event => setRestoreDraft(current => ({ ...current, end: Number(event.target.value) }))}
                        className="mt-2 w-full accent-emerald-500"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={addManualRestore}
                    className="mt-3 w-full rounded-xl border border-[color:color-mix(in_srgb,#16a34a_45%,var(--card-border))] px-3 py-2 text-sm font-semibold text-[var(--text-main)]"
                  >
                    加入加回區間
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">Restore regions</p>
                    <button type="button" disabled={selectedManualRestores.length === 0} onClick={clearSelectedManualRestores} className="text-xs font-semibold text-emerald-500 disabled:opacity-40">
                      清除全部
                    </button>
                  </div>
                  {selectedManualRestores.length ? selectedManualRestores.map(region => (
                    <div key={region.id} className="flex items-center justify-between gap-3 rounded-xl border border-[color:color-mix(in_srgb,#16a34a_34%,var(--card-border))] px-3 py-2 text-xs">
                      <span className="text-[var(--text-main)]">
                        {region.scan === 'both' ? '兩筆' : region.scan === 'scan1' ? 'scan 1' : 'scan 2'} · {formatEnergy(region.start)}–{formatEnergy(region.end)} eV
                      </span>
                      <button type="button" onClick={() => removeManualRestore(selectedGroup.sampleName, region.id)} className="font-semibold text-emerald-500">
                        移除
                      </button>
                    </div>
                  )) : (
                    <div className="rounded-xl border border-dashed border-[var(--card-border)] px-3 py-3 text-xs text-[var(--text-soft)]">
                      目前沒有加回區間。
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
          <div className="lg:sticky lg:top-4 lg:z-20 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
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
                        <Plot data={previewFigure.data} layout={previewFigure.layout} config={previewFigure.config} onRelayout={handlePreviewRelayout} />
                      </div>
                    ) : (
                      <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] text-sm text-[var(--text-soft)]">
                        讀取 Athena .xmu 資料夾後，預覽圖會顯示在這裡。
                      </div>
                    )}

                    {finalResultFigure ? (
                      <div className="mt-4 min-w-0 overflow-hidden rounded-2xl border border-[var(--accent-secondary)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_7%,var(--card-bg))] p-2">
                        <Plot data={finalResultFigure.data} layout={finalResultFigure.layout} config={finalResultFigure.config} />
                      </div>
                    ) : selectedGroup ? (
                      <div className="mt-4 flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-4 text-center text-sm leading-6 text-[var(--text-soft)]">
                        需要同一樣品至少兩筆 .xmu，才會產生最終平均結果圖。
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-6 text-center text-sm leading-7 text-[var(--text-soft)]">
                  尚未讀取資料。請先點選「讀取整個資料夾」，或選擇多個 Athena .xmu 檔案。
                </div>
              )}
            </Section>
          </div>

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
