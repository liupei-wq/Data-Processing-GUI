/**
 * XRD page – main state management + layout.
 *
 * Layout:
 *   [Left sidebar: ProcessingPanel]  [Right main: chart + export]
 *
 * Data flow:
 *   1. User uploads files → parseFiles() → store in `rawFiles` state
 *   2. Any param change → processData() → update `result` state → chart re-renders
 *   3. On reference material select → fetchReferencePeaks() → overlay on chart
 */

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
import Plot from 'react-plotly.js'
import type {
  DetectedPeak,
  LogViewParams,
  ParsedFile,
  PeakDetectionParams,
  ProcessResult,
  RefPeak,
  ReferenceMatchParams,
  ReferenceMatchRow,
  ScherrerParams,
  XMode,
  WavelengthPreset,
} from '../types/xrd'
import { detectPeaks, parseFiles, processData, fetchReferences, fetchReferencePeaks } from '../api/xrd'
import { type AnalysisModuleId } from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import GaussianSubtractionChart from '../components/GaussianSubtractionChart'
import ProcessingPanel, {
  DEFAULT_PARAMS,
  WAVELENGTH_MAP,
} from '../components/ProcessingPanel'
import {
  applyHidden,
  ChartToolbar,
  DEFAULT_SERIES_PALETTE_KEYS,
  DatasetSelectionModal,
  LINE_COLOR_OPTIONS,
  LINE_COLOR_PALETTES,
  makeLegendClick,
  ProcessingWorkspaceHeader,
  StickySidebarHeader,
} from '../components/WorkspaceUi'
import type { ProcessParams } from '../types/xrd'

type CsvCell = string | number | null | undefined

function csvEscape(value: CsvCell): string {
  if (value == null) return ''
  const raw = String(value)
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [
    headers.map(csvEscape).join(','),
    ...rows.map(row => row.map(csvEscape).join(',')),
  ].join('\n')
}

function downloadFile(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function twoThetaToD(twoThetaDeg: number, wavelengthAngstrom: number): number | null {
  if (!(twoThetaDeg > 0 && wavelengthAngstrom > 0)) return null
  const theta = (twoThetaDeg * Math.PI) / 360
  const sinTheta = Math.sin(theta)
  if (!(sinTheta > 0)) return null
  return wavelengthAngstrom / (2 * sinTheta)
}

function safeLogValue(value: number, shift: number, method: LogViewParams['method'], floorValue: number) {
  const shifted = Math.max(value + shift, floorValue)
  return method === 'ln' ? Math.log(shifted) : Math.log10(shifted)
}

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function chartLayout({
  xMode,
  wavelength,
  height = 360,
  yTitle = 'Intensity (a.u.)',
  reversed = false,
}: {
  xMode: XMode
  wavelength: number
  height?: number
  yTitle?: string
  reversed?: boolean
}): Partial<Plotly.Layout> {
  const chartGrid = cssVar('--chart-grid', 'rgba(148, 163, 184, 0.14)')
  const chartText = cssVar('--chart-text', '#d9e4f0')
  const chartBg = cssVar('--chart-bg', 'rgba(15, 23, 42, 0.52)')
  const chartLegendBg = cssVar('--chart-legend-bg', 'rgba(15, 23, 42, 0.72)')
  const chartHoverBg = cssVar('--chart-hover-bg', 'rgba(15, 23, 42, 0.95)')
  const chartHoverBorder = cssVar('--chart-hover-border', 'rgba(148, 163, 184, 0.22)')

  return {
    xaxis: {
      title: { text: xMode === 'dspacing' ? 'd-spacing (Å)' : '2θ (degrees)' },
      showgrid: true,
      gridcolor: chartGrid,
      zeroline: false,
      color: chartText,
      autorange: reversed ? 'reversed' : (xMode === 'dspacing' ? 'reversed' : true),
    },
    yaxis: {
      title: { text: yTitle },
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
    margin: { l: 60, r: 20, t: 24, b: 60 },
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
    height,
  }
}

function convertXValues(values: number[], xMode: XMode, wavelength: number) {
  return xMode === 'dspacing' ? values.map(value => twoThetaToD(value, wavelength) ?? value) : values
}

function buildStageCsv(datasets: { name: string; x: number[]; y: number[] }[], xLabel: string, yLabel: string) {
  const rows: CsvCell[][] = []
  datasets.forEach(dataset => {
    dataset.x.forEach((x, index) => {
      rows.push([dataset.name, x.toFixed(6), dataset.y[index]?.toFixed(6) ?? ''])
    })
  })
  return toCsv(['dataset', xLabel, yLabel], rows)
}

function processedSpectrumCsv(result: ProcessResult): string {
  const ds = result.average ?? result.datasets[0]
  if (!ds) return ''
  const headers = ['2theta_deg', ...result.datasets.map(d => `${d.name}_processed`)]
  const rows = ds.x.map((x, i) => [
    x.toFixed(4),
    ...result.datasets.map(d => d.y_processed[i]?.toFixed(4) ?? ''),
  ])
  return toCsv(headers, rows)
}

function detailedDatasetCsv(
  dataset: ProcessResult['datasets'][number],
  wavelength: number,
  logViewParams: LogViewParams,
): string {
  const headers = ['2theta_deg', 'd_spacing_A', 'raw', 'gaussian_model', 'gaussian_subtracted', 'processed']
  const processedMin = dataset.y_processed.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY)
  const logShift = logViewParams.enabled && processedMin <= 0
    ? Math.abs(processedMin) + logViewParams.floor_value
    : logViewParams.floor_value
  if (logViewParams.enabled) headers.push(`${logViewParams.method}_processed`)
  const rows = dataset.x.map((x, idx) => {
    const processed = dataset.y_processed[idx]
    const dSpacing = twoThetaToD(x, wavelength)
    const row: CsvCell[] = [
      x.toFixed(4),
      dSpacing == null ? '' : dSpacing.toFixed(4),
      dataset.y_raw[idx]?.toFixed(6) ?? '',
      dataset.y_gaussian_model?.[idx]?.toFixed(6) ?? '',
      dataset.y_gaussian_subtracted?.[idx]?.toFixed(6) ?? '',
      processed?.toFixed(6) ?? '',
    ]
    if (logViewParams.enabled) {
      row.push(Number.isFinite(processed) ? safeLogValue(processed, logShift, logViewParams.method, logViewParams.floor_value).toFixed(6) : '')
    }
    return row
  })
  return toCsv(headers, rows)
}

function scherrerCrystalliteSizeNm(
  twoThetaDeg: number,
  fwhmDeg: number,
  wavelengthAngstrom: number,
  k: number,
  instrumentBroadeningDeg: number,
  broadeningCorrection: ScherrerParams['broadening_correction'],
) {
  if (!(twoThetaDeg > 0 && fwhmDeg > 0 && wavelengthAngstrom > 0)) return null

  let beta = fwhmDeg
  const bInst = instrumentBroadeningDeg
  if (broadeningCorrection === 'gaussian' && beta > bInst && bInst > 0) {
    beta = Math.sqrt(Math.max(0, beta ** 2 - bInst ** 2))
  } else if (broadeningCorrection === 'lorentzian' && beta > bInst && bInst > 0) {
    beta = beta - bInst
  }

  if (!(beta > 0)) return null

  const betaRad = (beta * Math.PI) / 180
  const thetaRad = (twoThetaDeg * Math.PI) / 360
  const cosTheta = Math.cos(thetaRad)
  if (!(betaRad > 0 && cosTheta > 0)) return null

  return (k * wavelengthAngstrom) / (betaRad * cosTheta) / 10
}

function buildReferenceMatches(
  referencePeaks: RefPeak[],
  observedPeaks: DetectedPeak[],
  toleranceDeg: number,
): ReferenceMatchRow[] {
  if (referencePeaks.length === 0) return []

  return [...referencePeaks]
    .sort((a, b) => a.two_theta - b.two_theta)
    .map((refPeak) => {
      if (observedPeaks.length === 0) {
        return {
          material: refPeak.material,
          hkl: refPeak.hkl,
          ref_two_theta: refPeak.two_theta,
          ref_d_spacing: refPeak.d_spacing,
          ref_rel_i: refPeak.rel_i,
          observed_two_theta: null,
          observed_d_spacing: null,
          observed_intensity: null,
          delta_two_theta: null,
          matched: false,
        }
      }

      const closest = observedPeaks.reduce((best, peak) => {
        const delta = Math.abs(peak.two_theta - refPeak.two_theta)
        if (best == null || delta < best.delta) return { peak, delta }
        return best
      }, null as { peak: DetectedPeak; delta: number } | null)

      return {
        material: refPeak.material,
        hkl: refPeak.hkl,
        ref_two_theta: refPeak.two_theta,
        ref_d_spacing: refPeak.d_spacing,
        ref_rel_i: refPeak.rel_i,
        observed_two_theta: closest?.peak.two_theta ?? null,
        observed_d_spacing: closest?.peak.d_spacing ?? null,
        observed_intensity: closest?.peak.intensity ?? null,
        delta_two_theta: closest?.delta ?? null,
        matched: closest != null && closest.delta <= toleranceDeg,
      }
    })
}

const SIDEBAR_MIN_WIDTH = 320
const SIDEBAR_MAX_WIDTH = 560
const SIDEBAR_DEFAULT_WIDTH = 368
const SIDEBAR_COLLAPSED_PEEK = 28

export default function XRD({
  onModuleSelect,
}: {
  onModuleSelect?: (module: AnalysisModuleId) => void
}) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('nigiro-xrd-sidebar-width'))
    if (Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH) {
      return saved
    }
    return SIDEBAR_DEFAULT_WIDTH
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem('nigiro-xrd-sidebar-collapsed') === 'true')
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const [rawFiles, setRawFiles] = useState<ParsedFile[]>([])
  const [params, setParams] = useState<ProcessParams>(DEFAULT_PARAMS)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [refMaterials, setRefMaterials] = useState<string[]>([])
  const [selectedRefs, setSelectedRefs] = useState<string[]>([])
  const [refPeaks, setRefPeaks] = useState<RefPeak[]>([])
  const [logViewParams, setLogViewParams] = useState<LogViewParams>({
    enabled: false,
    method: 'log10',
    floor_value: 0.000001,
  })
  const [refMatchParams, setRefMatchParams] = useState<ReferenceMatchParams>({
    min_rel_intensity: 10,
    tolerance_deg: 0.3,
    only_show_matched: true,
  })
  const [xMode, setXMode] = useState<XMode>('twotheta')
  const [wavelengthPreset, setWavelengthPreset] = useState<WavelengthPreset>('Cu Kα (1.5406 Å)')
  const [customWavelength, setCustomWavelength] = useState(1.5406)
  const [peakParams, setPeakParams] = useState<PeakDetectionParams>({
    enabled: false,
    prominence: 0.05,
    min_distance: 0.3,
    max_peaks: 30,
  })
  const [scherrerParams, setScherrerParams] = useState<ScherrerParams>({
    enabled: false,
    k: 0.9,
    instrument_broadening_deg: 0,
    broadening_correction: 'none',
  })
  const [selectedDatasetName, setSelectedDatasetName] = useState('')
  const [processingViewMode, setProcessingViewMode] = useState<'single' | 'overlay'>('single')
  const [overlaySelection, setOverlaySelection] = useState<string[]>([])
  const [overlayDraftSelection, setOverlayDraftSelection] = useState<string[]>([])
  const [overlaySelectorOpen, setOverlaySelectorOpen] = useState(false)
  const [detectedPeaks, setDetectedPeaks] = useState<DetectedPeak[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawFileColors, setRawFileColors] = useState<string[]>([])
  const [chartLineColors, setChartLineColors] = useState({
    overlay: 'blue',
    preprocess: 'teal',
    gaussian: 'orange',
    log: 'violet',
    final: 'blue',
  })
  const [rawHidden, setRawHidden] = useState<string[]>([])
  const [overlayHidden, setOverlayHidden] = useState<string[]>([])
  const [preprocessHidden, setPreprocessHidden] = useState<string[]>([])
  const [gaussianHidden, setGaussianHidden] = useState<string[]>([])
  const [logHidden, setLogHidden] = useState<string[]>([])
  const [finalHidden, setFinalHidden] = useState<string[]>([])

  useEffect(() => {
    localStorage.setItem('nigiro-xrd-sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    localStorage.setItem('nigiro-xrd-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    setRawFileColors(prev => rawFiles.map((_, index) => prev[index] ?? DEFAULT_SERIES_PALETTE_KEYS[index % DEFAULT_SERIES_PALETTE_KEYS.length]))
  }, [rawFiles])

  useEffect(() => {
    if (!sidebarResizing) return

    const handleMove = (event: MouseEvent) => {
      const nextWidth = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, event.clientX),
      )
      setSidebarWidth(nextWidth)
      if (sidebarCollapsed) setSidebarCollapsed(false)
    }

    const handleUp = () => {
      setSidebarResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [sidebarCollapsed, sidebarResizing])

  const wavelength =
    wavelengthPreset === 'Custom' ? customWavelength : WAVELENGTH_MAP[wavelengthPreset]
  const activeDataset = useMemo(
    () => result?.datasets.find(dataset => dataset.name === selectedDatasetName) ?? result?.datasets[0] ?? result?.average ?? null,
    [result, selectedDatasetName],
  )
  const activeGaussianFits = activeDataset?.gaussian_fits ?? []
  const overlayResult = useMemo(() => {
    if (!result) return null
    const datasets = result.datasets.filter(dataset => overlaySelection.includes(dataset.name))
    if (datasets.length < 2) return null
    return { datasets, average: null }
  }, [overlaySelection, result])
  const isOverlayView = processingViewMode === 'overlay' && Boolean(overlayResult)
  const topTabs = useMemo(
    () => rawFiles.map(file => ({
      key: file.name,
      label: file.name,
      active: !isOverlayView && activeDataset?.name === file.name,
      onClick: () => {
        setProcessingViewMode('single')
        setSelectedDatasetName(file.name)
      },
    })),
    [activeDataset?.name, isOverlayView, rawFiles],
  )
  const overlayItems = useMemo(
    () => rawFiles.map(file => ({ key: file.name, label: file.name })),
    [rawFiles],
  )
  const xRangeLabel = activeDataset
    ? `${Math.min(...activeDataset.x).toFixed(1)} – ${Math.max(...activeDataset.x).toFixed(1)} ${xMode === 'dspacing' ? 'Å' : 'deg'}`
    : '—'
  const interpolationLabel = params.interpolate ? `${params.n_points} 點` : '未啟用'
  const filteredRefPeaks = useMemo(
    () => refPeaks.filter(peak => peak.rel_i >= refMatchParams.min_rel_intensity),
    [refPeaks, refMatchParams.min_rel_intensity],
  )
  const rawChartSourceFiles = useMemo(
    () => (isOverlayView ? rawFiles.filter(file => overlaySelection.includes(file.name)) : rawFiles),
    [isOverlayView, overlaySelection, rawFiles],
  )
  const rawStageDatasets = useMemo(
    () => rawChartSourceFiles.map(file => ({
      name: file.name,
      x: convertXValues(file.x, xMode, wavelength),
      y: file.y,
    })),
    [rawChartSourceFiles, wavelength, xMode],
  )
  const rawChartTraces = useMemo(
    () => rawChartSourceFiles.map((file, index) => {
      const paletteKey = rawFileColors[rawFiles.findIndex(item => item.name === file.name)] ?? DEFAULT_SERIES_PALETTE_KEYS[index % DEFAULT_SERIES_PALETTE_KEYS.length]
      const palette = LINE_COLOR_PALETTES[paletteKey] ?? LINE_COLOR_PALETTES.blue
      return {
        x: convertXValues(file.x, xMode, wavelength),
        y: file.y,
        type: 'scatter',
        mode: 'lines',
        name: file.name,
        line: { color: palette.primary, width: 2 },
      } as Plotly.Data
    }),
    [rawChartSourceFiles, rawFileColors, rawFiles, wavelength, xMode],
  )
  const overlayStageDatasets = useMemo(
    () => isOverlayView && overlayResult
      ? overlayResult.datasets.map(dataset => ({
          name: dataset.name,
          x: convertXValues(dataset.x, xMode, wavelength),
          y: dataset.y_processed,
        }))
      : [],
    [isOverlayView, overlayResult, wavelength, xMode],
  )
  const overlayChartTraces = useMemo(() => {
    const colors = (LINE_COLOR_PALETTES[chartLineColors.overlay] ?? LINE_COLOR_PALETTES.blue).series
    return overlayStageDatasets.map((dataset, index) => ({
      x: dataset.x,
      y: dataset.y,
      type: 'scatter',
      mode: 'lines',
      name: dataset.name,
      line: { color: colors[index % colors.length], width: 2.2 },
    } as Plotly.Data))
  }, [chartLineColors.overlay, overlayStageDatasets])
  const preprocessStageDatasets = useMemo(
    () => activeDataset ? [
      { name: `${activeDataset.name} 原始`, x: convertXValues(activeDataset.x, xMode, wavelength), y: activeDataset.y_raw },
      { name: `${activeDataset.name} 處理後`, x: convertXValues(activeDataset.x, xMode, wavelength), y: activeDataset.y_processed },
    ] : [],
    [activeDataset, wavelength, xMode],
  )
  const preprocessChartTraces = useMemo(() => {
    if (!activeDataset) return []
    const palette = LINE_COLOR_PALETTES[chartLineColors.preprocess] ?? LINE_COLOR_PALETTES.teal
    const xValues = convertXValues(activeDataset.x, xMode, wavelength)
    return [
      {
        x: xValues,
        y: activeDataset.y_raw,
        type: 'scatter',
        mode: 'lines',
        name: '原始',
        line: { color: palette.secondary, width: 1.35, dash: 'dot' },
      },
      {
        x: xValues,
        y: activeDataset.y_processed,
        type: 'scatter',
        mode: 'lines',
        name: '處理後',
        line: { color: palette.primary, width: 2.2 },
      },
    ] as Plotly.Data[]
  }, [activeDataset, chartLineColors.preprocess, wavelength, xMode])
  const gaussianStageDatasets = useMemo(
    () => activeDataset?.y_gaussian_subtracted && activeDataset?.y_gaussian_model
      ? [
          { name: '原始', x: convertXValues(activeDataset.x, xMode, wavelength), y: activeDataset.y_raw },
          { name: '高斯模型', x: convertXValues(activeDataset.x, xMode, wavelength), y: activeDataset.y_gaussian_model },
          { name: '扣除後', x: convertXValues(activeDataset.x, xMode, wavelength), y: activeDataset.y_gaussian_subtracted },
        ]
      : [],
    [activeDataset, wavelength, xMode],
  )
  const gaussianChartTraces = useMemo(() => {
    if (gaussianStageDatasets.length === 0) return []
    const palette = LINE_COLOR_PALETTES[chartLineColors.gaussian] ?? LINE_COLOR_PALETTES.orange
    return [
      { x: gaussianStageDatasets[0].x, y: gaussianStageDatasets[0].y, type: 'scatter', mode: 'lines', name: '原始', line: { color: palette.secondary, width: 1.25, dash: 'dot' } },
      { x: gaussianStageDatasets[1].x, y: gaussianStageDatasets[1].y, type: 'scatter', mode: 'lines', name: '高斯模型', line: { color: palette.tertiary, width: 1.5 } },
      { x: gaussianStageDatasets[2].x, y: gaussianStageDatasets[2].y, type: 'scatter', mode: 'lines', name: '扣除後', line: { color: palette.primary, width: 2.2 } },
    ] as Plotly.Data[]
  }, [chartLineColors.gaussian, gaussianStageDatasets])
  const logStageDatasets = useMemo(() => {
    if (!activeDataset || !logViewParams.enabled) return []
    const minValue = activeDataset.y_processed.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY)
    const shift = minValue <= 0 ? Math.abs(minValue) + logViewParams.floor_value : logViewParams.floor_value
    return [{
      name: `${logViewParams.method} 處理後`,
      x: convertXValues(activeDataset.x, xMode, wavelength),
      y: activeDataset.y_processed.map(value => safeLogValue(value, shift, logViewParams.method, logViewParams.floor_value)),
    }]
  }, [activeDataset, logViewParams, wavelength, xMode])
  const logChartTraces = useMemo(() => {
    if (logStageDatasets.length === 0) return []
    const palette = LINE_COLOR_PALETTES[chartLineColors.log] ?? LINE_COLOR_PALETTES.violet
    return [{
      x: logStageDatasets[0].x,
      y: logStageDatasets[0].y,
      type: 'scatter',
      mode: 'lines',
      name: logStageDatasets[0].name,
      line: { color: palette.primary, width: 2.1 },
    }] as Plotly.Data[]
  }, [chartLineColors.log, logStageDatasets])
  const finalChartTraces = useMemo(() => {
    if (!activeDataset) return []
    const palette = LINE_COLOR_PALETTES[chartLineColors.final] ?? LINE_COLOR_PALETTES.blue
    const xValues = convertXValues(activeDataset.x, xMode, wavelength)
    const traces: Plotly.Data[] = [
      {
        x: xValues,
        y: activeDataset.y_processed,
        type: 'scatter',
        mode: 'lines',
        name: activeDataset.name,
        line: { color: palette.primary, width: 2.3 },
      },
    ]
    if (filteredRefPeaks.length > 0) {
      const yMax = activeDataset.y_processed.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY)
      const xPoints: Array<number | null> = []
      const yPoints: Array<number | null> = []
      filteredRefPeaks.forEach(peak => {
        xPoints.push(xMode === 'dspacing' ? peak.d_spacing : peak.two_theta, xMode === 'dspacing' ? peak.d_spacing : peak.two_theta, null)
        yPoints.push(0, yMax * (peak.rel_i / 100) * 0.8, null)
      })
      traces.push({
        x: xPoints,
        y: yPoints,
        type: 'scatter',
        mode: 'lines',
        name: '參考峰',
        line: { color: palette.accent, width: 1.4, dash: 'dot' },
        hoverinfo: 'skip',
      })
    }
    if (detectedPeaks.length > 0 && peakParams.enabled) {
      traces.push({
        x: detectedPeaks.map(peak => (xMode === 'dspacing' ? peak.d_spacing : peak.two_theta)),
        y: detectedPeaks.map(peak => peak.intensity),
        type: 'scatter',
        mode: 'markers',
        name: 'Detected peaks',
        marker: {
          color: '#f8fafc',
          size: 8,
          symbol: 'diamond-open',
          line: { color: palette.primary, width: 1.5 },
        },
      })
    }
    return traces
  }, [activeDataset, chartLineColors.final, detectedPeaks, filteredRefPeaks, peakParams.enabled, wavelength, xMode])
  const finalStageDatasets = useMemo(
    () => activeDataset ? [{ name: activeDataset.name, x: convertXValues(activeDataset.x, xMode, wavelength), y: activeDataset.y_processed }] : [],
    [activeDataset, wavelength, xMode],
  )
  const referenceMatches = useMemo(
    () => buildReferenceMatches(filteredRefPeaks, detectedPeaks, refMatchParams.tolerance_deg),
    [filteredRefPeaks, detectedPeaks, refMatchParams.tolerance_deg],
  )
  const visibleReferenceMatches = useMemo(
    () => refMatchParams.only_show_matched ? referenceMatches.filter(row => row.matched) : referenceMatches,
    [referenceMatches, refMatchParams.only_show_matched],
  )
  const matchedReferenceCount = useMemo(
    () => referenceMatches.filter(row => row.matched).length,
    [referenceMatches],
  )
  const scherrerRows = useMemo(
    () => detectedPeaks.map(peak => ({
      ...peak,
      crystallite_nm: scherrerCrystalliteSizeNm(
        peak.two_theta,
        peak.fwhm_deg,
        wavelength,
        scherrerParams.k,
        scherrerParams.instrument_broadening_deg,
        scherrerParams.broadening_correction,
      ),
    })),
    [detectedPeaks, wavelength, scherrerParams],
  )
  const processingReport = {
    report_type: 'xrd_processing_report',
    created_at: new Date().toISOString(),
    module: 'xrd',
    input_files: rawFiles.map(file => file.name),
    selected_dataset: activeDataset?.name ?? null,
    dataset_count: result?.datasets.length ?? 0,
    wavelength: {
      preset: wavelengthPreset,
      angstrom: wavelength,
    },
    processing: params,
    log_view: logViewParams,
    reference_matching: {
      selected_refs: selectedRefs,
      ...refMatchParams,
      matched_count: matchedReferenceCount,
      total_reference_lines: referenceMatches.length,
    },
    peak_detection: {
      ...peakParams,
      detected_count: detectedPeaks.length,
    },
    scherrer: {
      ...scherrerParams,
      rows: scherrerRows,
    },
    gaussian_fit_rows: activeGaussianFits,
    reference_peaks: filteredRefPeaks,
    reference_matches: referenceMatches,
  }

  useEffect(() => {
    fetchReferences().then(setRefMaterials).catch(console.error)
  }, [])

  useEffect(() => {
    if (rawFiles.length === 0) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    const timer = setTimeout(() => {
      processData(rawFiles, params)
        .then(r => { if (!cancelled) setResult(r) })
        .catch(e => { if (!cancelled) setError(String(e.message)) })
        .finally(() => { if (!cancelled) setIsLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [rawFiles, params])

  useEffect(() => {
    const validNames = new Set(rawFiles.map(file => file.name))
    setOverlaySelection(prev => prev.filter(name => validNames.has(name)))
    setOverlayDraftSelection(prev => prev.filter(name => validNames.has(name)))
    if (rawFiles.length === 0) {
      setSelectedDatasetName('')
      setProcessingViewMode('single')
      return
    }
    if (!validNames.has(selectedDatasetName)) {
      setSelectedDatasetName(rawFiles[0].name)
    }
  }, [rawFiles, selectedDatasetName])

  useEffect(() => {
    if (overlaySelectorOpen) setOverlayDraftSelection(overlaySelection)
  }, [overlaySelection, overlaySelectorOpen])

  useEffect(() => {
    if (selectedRefs.length === 0) {
      setRefPeaks([])
      return
    }
    fetchReferencePeaks(selectedRefs, wavelength)
      .then(setRefPeaks)
      .catch(console.error)
  }, [selectedRefs, wavelength])

  useEffect(() => {
    if (!peakParams.enabled || !activeDataset) {
      setDetectedPeaks([])
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      detectPeaks(activeDataset.x, activeDataset.y_processed, {
        prominence: peakParams.prominence,
        min_distance: peakParams.min_distance,
        max_peaks: peakParams.max_peaks,
        wavelength,
      })
        .then(peaks => {
          if (!cancelled) setDetectedPeaks(peaks)
        })
        .catch(e => {
          if (!cancelled) setError(String(e.message))
        })
    }, 300)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [activeDataset, peakParams, wavelength])

  const handleFiles = useCallback(async (files: File[]) => {
    setIsLoading(true)
    setError(null)
    try {
      const parsed = await parseFiles(files)
      setRawFiles(parsed)
      setDetectedPeaks([])
      setParams(p => ({ ...p, norm_x_start: null, norm_x_end: null }))
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const toggleOverlayDraft = useCallback((name: string) => {
    setOverlayDraftSelection(current =>
      current.includes(name) ? current.filter(item => item !== name) : [...current, name],
    )
  }, [])

  const applyOverlaySelection = useCallback(() => {
    setOverlaySelection(overlayDraftSelection)
    setProcessingViewMode(overlayDraftSelection.length >= 2 ? 'overlay' : 'single')
    setOverlaySelectorOpen(false)
  }, [overlayDraftSelection])

  const sidebarStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--sidebar-shift': sidebarCollapsed
      ? `calc(-1 * (var(--sidebar-width) - ${SIDEBAR_COLLAPSED_PEEK}px))`
      : '0px',
  } as CSSProperties

  return (
    <div className={`flex h-screen flex-col overflow-hidden xl:flex-row${sidebarResizing ? ' select-none' : ''}`}>
      <aside
        className={[
          'module-sidebar glass-panel relative z-20 flex min-h-0 w-full shrink-0 flex-col overflow-hidden xl:w-[var(--sidebar-width)] xl:transform-gpu xl:[transform:translateX(var(--sidebar-shift))] xl:rounded-none xl:border-l-0 xl:border-t-0 xl:border-b-0',
        ].join(' ')}
        style={sidebarStyle}
      >
        <button
          type="button"
          onClick={() => setSidebarCollapsed(value => !value)}
          className="pressable absolute right-2 top-5 z-30 hidden h-10 w-10 items-center justify-center rounded-full border border-[var(--pill-border)] bg-[color:color-mix(in_srgb,var(--panel-bg)_88%,transparent)] text-lg text-[var(--text-main)] shadow-[var(--card-shadow)] xl:flex"
          aria-label={sidebarCollapsed ? '展開左側欄' : '收合左側欄'}
          title={sidebarCollapsed ? '展開左側欄' : '收合左側欄'}
        >
          {sidebarCollapsed ? '→' : '←'}
        </button>

        <div
          className="absolute right-0 top-0 hidden h-full w-3 -translate-x-1/2 cursor-col-resize xl:block"
          onMouseDown={() => setSidebarResizing(true)}
          aria-hidden="true"
        >
          <div className="mx-auto h-full w-px bg-[linear-gradient(180deg,transparent,var(--card-border),transparent)]" />
        </div>

        <div
          className={[
            'module-sidebar__content flex h-full min-h-0 flex-col',
            sidebarCollapsed ? 'module-sidebar__content--collapsed xl:pointer-events-none xl:opacity-0' : 'opacity-100',
          ].join(' ')}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StickySidebarHeader
              activeModule="xrd"
              subtitle="Data Processing"
              onSelectModule={onModuleSelect}
              onCollapse={() => setSidebarCollapsed(true)}
            />

            <div className="px-4 py-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">檔案</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">{rawFiles.length}</p>
                </div>
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">X 軸</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">{xMode === 'twotheta' ? '2θ' : 'd'}</p>
                </div>
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">參考相</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">{selectedRefs.length}</p>
                </div>
              </div>
            </div>

            <div className="sidebar-scroll px-4 py-5">
              <div className="theme-block mb-3 overflow-hidden rounded-[24px]">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--accent-tertiary)_16%,transparent)] text-sm font-semibold text-[var(--accent-tertiary)]">
                      1
                    </span>
                    <div>
                      <div className="text-base font-semibold text-[var(--text-muted)]">載入檔案</div>
                      <div className="mt-0.5 text-[11px] text-[var(--text-soft)]">支援多檔上傳與後續平均</div>
                    </div>
                  </div>
                </div>

                <div className="p-4 pt-2">
                  <div className="mb-3 text-sm font-medium text-[var(--text-main)]">上傳 XRD 檔案（可多選）</div>
                  <FileUpload onFiles={handleFiles} isLoading={isLoading} />
                  {rawFiles.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {rawFiles.map(file => (
                        <div
                          key={file.name}
                          className="theme-block-soft flex items-center gap-2 rounded-[16px] px-3 py-2 text-xs text-[var(--text-main)]"
                        >
                          <span className="text-[var(--accent-tertiary)]">✓</span>
                          <span className="truncate">{file.name}</span>
                          <span className="shrink-0 text-[var(--text-soft)]">({file.x.length} pts)</span>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setRawFiles([])
                          setResult(null)
                          setRefPeaks([])
                          setDetectedPeaks([])
                        }}
                        className="text-xs font-medium text-[var(--accent-secondary)] transition-colors hover:opacity-80"
                      >
                        清除全部
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <ProcessingPanel
                params={params}
                onChange={setParams}
                fileCount={rawFiles.length}
                xMode={xMode}
                onXModeChange={setXMode}
                wavelengthPreset={wavelengthPreset}
                onWavelengthPresetChange={p => {
                  setWavelengthPreset(p)
                  if (p !== 'Custom') setCustomWavelength(WAVELENGTH_MAP[p])
                }}
                customWavelength={customWavelength}
                onCustomWavelengthChange={setCustomWavelength}
                refMaterials={refMaterials}
                selectedRefs={selectedRefs}
                onSelectedRefsChange={setSelectedRefs}
                logViewParams={logViewParams}
                onLogViewParamsChange={setLogViewParams}
                refMatchParams={refMatchParams}
                onRefMatchParamsChange={setRefMatchParams}
                peakParams={peakParams}
                onPeakParamsChange={setPeakParams}
                scherrerParams={scherrerParams}
                onScherrerParamsChange={setScherrerParams}
              />
            </div>
          </div>
        </div>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-8 sm:px-8 xl:px-10 xl:py-10">
        <div className="mx-auto w-full max-w-[1500px]">
          <div className="mb-8">
            <div className="flex flex-wrap items-baseline gap-3">
              <h1 className="font-display text-4xl font-semibold tracking-[0.02em] text-[var(--text-muted)]">
                XRD
              </h1>
              <span className="text-lg text-[var(--text-soft)]">X-ray Diffraction</span>
            </div>
            <div className="mt-6 h-px w-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--card-border)_85%,transparent),transparent)]" />
          </div>

          <ProcessingWorkspaceHeader
            tabs={topTabs}
            isOverlayView={isOverlayView}
            overlaySelectionCount={overlaySelection.length}
            onOpenOverlaySelector={() => setOverlaySelectorOpen(true)}
            stats={[
              { label: '資料集', value: `${rawFiles.length} 個` },
              { label: xMode === 'dspacing' ? 'd 範圍' : '2θ 範圍', value: xRangeLabel },
              { label: '內插點數', value: interpolationLabel },
            ]}
          />

          <div className="glass-panel rounded-[30px] p-4 sm:p-5 lg:p-6">
          {error && (
            <div className="mb-4 rounded-[22px] border border-[color:color-mix(in_srgb,var(--accent-secondary)_28%,var(--card-border))] bg-[color:color-mix(in_srgb,var(--accent-secondary)_12%,transparent)] px-4 py-3 text-sm text-[var(--text-main)]">
              ⚠️ {error}
            </div>
          )}

          {isLoading && (
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--pill-border)] bg-[var(--pill-bg)] px-3 py-1 text-xs font-medium text-[var(--accent)] shadow-[var(--card-shadow-soft)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-strong)]" />
              處理中…
            </div>
          )}

          {!result && !isLoading && (
            <div className="min-h-[38rem]">
              <div className="rounded-[24px] border border-[var(--pill-border)] bg-[var(--pill-bg)] px-6 py-5 text-xl font-semibold text-[var(--text-main)] shadow-[var(--card-shadow-soft)]">
                請在左側上傳一個或多個 XRD 檔案。
              </div>

              <div className="theme-block-soft relative mt-12 min-h-[26rem] overflow-hidden rounded-[32px]">
                <div className="workspace-float-card left-[24%] top-[6%] h-36 w-56 rounded-[26px] rotate-[-6deg] opacity-70" />
                <div className="workspace-float-card right-[18%] top-[2%] h-32 w-48 rounded-[24px] rotate-[7deg] opacity-70" />
                <div className="workspace-float-card left-[8%] bottom-[8%] h-32 w-44 rounded-[22px] rotate-[-8deg] opacity-65" />
                <div className="workspace-float-card right-[34%] bottom-[12%] h-36 w-52 rounded-[24px] rotate-[4deg] opacity-65" />

                <svg className="absolute left-[25%] top-[10%] h-28 w-52 opacity-40" viewBox="0 0 220 120" fill="none">
                  <path d="M10 92C34 70 56 66 74 72C86 76 95 69 101 58C107 47 117 41 131 45C164 54 196 42 208 34" stroke="#2f6fbd" strokeWidth="6" strokeLinecap="round" />
                  <circle cx="87" cy="67" r="5" fill="#5d85bb" />
                  <circle cx="149" cy="55" r="5" fill="#5d85bb" />
                </svg>
                <svg className="absolute right-[19%] top-[5%] h-24 w-36 opacity-35" viewBox="0 0 160 120" fill="none">
                  <rect x="18" y="34" width="20" height="44" rx="4" fill="#2f6fbd" />
                  <rect x="58" y="18" width="20" height="60" rx="4" fill="#73829a" />
                  <rect x="98" y="34" width="20" height="44" rx="4" fill="#25497b" />
                  <rect x="138" y="18" width="20" height="60" rx="4" fill="#5d6370" />
                </svg>
                <svg className="absolute left-[10%] bottom-[14%] h-24 w-36 opacity-35" viewBox="0 0 160 90" fill="none">
                  <path d="M18 60L114 44" stroke="#566270" strokeWidth="6" strokeLinecap="round" />
                  <path d="M26 82L122 66" stroke="#566270" strokeWidth="6" strokeLinecap="round" />
                  <path d="M30 34L126 62" stroke="#566270" strokeWidth="6" strokeLinecap="round" />
                  <circle cx="30" cy="34" r="9" fill="#2f6fbd" />
                  <circle cx="102" cy="66" r="9" fill="#2f6fbd" />
                  <circle cx="132" cy="56" r="9" fill="#25497b" />
                </svg>
                <svg className="absolute right-[28%] bottom-[15%] h-28 w-48 opacity-35" viewBox="0 0 200 120" fill="none">
                  <path d="M34 54L96 32L158 70" stroke="#2a3442" strokeWidth="6" strokeLinecap="round" />
                  <path d="M34 54L106 90L158 70" stroke="#2a3442" strokeWidth="6" strokeLinecap="round" />
                  <circle cx="34" cy="54" r="12" fill="#295189" />
                  <circle cx="96" cy="32" r="9" fill="#5d6370" />
                  <circle cx="106" cy="90" r="8" fill="#4a5565" />
                  <circle cx="158" cy="70" r="13" fill="#25497b" />
                </svg>
              </div>
            </div>
          )}

          {result && (
            <>
              {rawChartTraces.length > 0 && (
                <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <p className="mb-2 text-sm font-semibold text-[var(--text-main)]">1. 原始 XRD</p>
                  {rawChartSourceFiles.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {rawChartSourceFiles.map((file, index) => {
                        const globalIndex = rawFiles.findIndex(item => item.name === file.name)
                        const colorKey = rawFileColors[globalIndex >= 0 ? globalIndex : index] ?? DEFAULT_SERIES_PALETTE_KEYS[index % DEFAULT_SERIES_PALETTE_KEYS.length]
                        const palette = LINE_COLOR_PALETTES[colorKey] ?? LINE_COLOR_PALETTES.blue
                        return (
                          <div key={`${file.name}-${index}`} className="flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette.primary }} />
                            <span className="max-w-[108px] truncate text-[10px] text-[var(--text-main)]">{file.name}</span>
                            <select
                              value={colorKey}
                              onChange={event => {
                                const targetIndex = globalIndex >= 0 ? globalIndex : index
                                setRawFileColors(prev => {
                                  const next = [...prev]
                                  next[targetIndex] = event.target.value
                                  return next
                                })
                              }}
                              className="rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1 py-0.5 text-[10px] text-[var(--input-text)] focus:outline-none"
                            >
                              {LINE_COLOR_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <Plot
                    data={applyHidden(rawChartTraces, rawHidden)}
                    layout={chartLayout({ xMode, wavelength })}
                    config={{ responsive: true, displayModeBar: false, scrollZoom: true }}
                    style={{ width: '100%', height: 360 }}
                    onLegendClick={makeLegendClick(setRawHidden) as never}
                    onLegendDoubleClick={() => false}
                    useResizeHandler
                  />
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(rawStageDatasets, xMode === 'dspacing' ? 'd_spacing_A' : 'two_theta_deg', 'intensity_raw'), 'xrd_raw_stage.csv', 'text/csv')}
                      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                    >
                      下載此步驟 CSV
                    </button>
                  </div>
                </div>
              )}

              {isOverlayView && overlayChartTraces.length > 0 && (
                <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <ChartToolbar
                    title="2. 多筆疊圖處理"
                    colorValue={chartLineColors.overlay}
                    onColorChange={value => setChartLineColors(current => ({ ...current, overlay: value }))}
                  />
                  <p className="mb-3 text-xs text-[var(--text-soft)]">這裡直接比照 XPS 疊圖模式，顯示多筆 XRD 的最終處理結果，不改動既有後端步驟邏輯。</p>
                  <Plot
                    data={applyHidden(overlayChartTraces, overlayHidden)}
                    layout={chartLayout({ xMode, wavelength })}
                    config={{ responsive: true, displayModeBar: false, scrollZoom: true }}
                    style={{ width: '100%', height: 360 }}
                    onLegendClick={makeLegendClick(setOverlayHidden) as never}
                    onLegendDoubleClick={() => false}
                    useResizeHandler
                  />
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(overlayStageDatasets, xMode === 'dspacing' ? 'd_spacing_A' : 'two_theta_deg', 'intensity_processed'), 'xrd_overlay_stage.csv', 'text/csv')}
                      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                    >
                      下載此步驟 CSV
                    </button>
                  </div>
                </div>
              )}

              {!isOverlayView && preprocessChartTraces.length > 0 && (
                <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <ChartToolbar
                    title="2. 前處理後"
                    colorValue={chartLineColors.preprocess}
                    onColorChange={value => setChartLineColors(current => ({ ...current, preprocess: value }))}
                  />
                  <p className="mb-3 text-xs text-[var(--text-soft)]">把原始 XRD 與目前處理後結果疊在一起，方便對照內插、多檔平均、平滑與歸一化之後的整體變化。</p>
                  <Plot
                    data={applyHidden(preprocessChartTraces, preprocessHidden)}
                    layout={chartLayout({ xMode, wavelength })}
                    config={{ responsive: true, displayModeBar: false, scrollZoom: true }}
                    style={{ width: '100%', height: 360 }}
                    onLegendClick={makeLegendClick(setPreprocessHidden) as never}
                    onLegendDoubleClick={() => false}
                    useResizeHandler
                  />
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(preprocessStageDatasets, xMode === 'dspacing' ? 'd_spacing_A' : 'two_theta_deg', 'intensity_processed'), 'xrd_preprocess_stage.csv', 'text/csv')}
                      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                    >
                      下載此步驟 CSV
                    </button>
                  </div>
                </div>
              )}

              {!isOverlayView && params.gaussian_enabled && (
                <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <ChartToolbar
                    title="3. 高斯模板扣除"
                    colorValue={chartLineColors.gaussian}
                    onColorChange={value => setChartLineColors(current => ({ ...current, gaussian: value }))}
                  />
                  <p className="mb-3 text-xs text-[var(--text-soft)]">使用固定面積與固定 FWHM 的高斯模板，先扣除已知峰影響；視覺比照 XPS 分階段圖卡，但計算邏輯仍沿用現有 XRD 後端。</p>
                  {gaussianChartTraces.length > 0 ? (
                    <>
                      <Plot
                        data={applyHidden(gaussianChartTraces, gaussianHidden)}
                        layout={chartLayout({ xMode, wavelength })}
                        config={{ responsive: true, displayModeBar: false, scrollZoom: true }}
                        style={{ width: '100%', height: 360 }}
                        onLegendClick={makeLegendClick(setGaussianHidden) as never}
                        onLegendDoubleClick={() => false}
                        useResizeHandler
                      />
                      <div className="mt-3 flex justify-start">
                        <button
                          type="button"
                          onClick={() => downloadFile(buildStageCsv(gaussianStageDatasets, xMode === 'dspacing' ? 'd_spacing_A' : 'two_theta_deg', 'intensity_processed'), 'xrd_gaussian_stage.csv', 'text/csv')}
                          className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                        >
                          下載此步驟 CSV
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      高斯模板扣除已啟用，但目前結果集中還沒有可顯示的模型與扣除後曲線。
                    </div>
                  )}

                  {activeGaussianFits.length > 0 && (
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">峰名稱</th>
                            <th className="px-3 py-3 font-medium">初始 2θ</th>
                            <th className="px-3 py-3 font-medium">擬合 2θ</th>
                            <th className="px-3 py-3 font-medium">位移</th>
                            <th className="px-3 py-3 font-medium">FWHM</th>
                            <th className="px-3 py-3 font-medium">面積</th>
                            <th className="px-3 py-3 font-medium">峰高</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeGaussianFits.map((fit, idx) => (
                            <tr key={`${fit.Peak_Name}-${idx}`} className="border-b border-white/5 text-slate-200 last:border-b-0">
                              <td className="px-3 py-3 font-medium">{fit.Peak_Name}</td>
                              <td className="px-3 py-3">{fit.Seed_Center.toFixed(4)}</td>
                              <td className="px-3 py-3">{fit.Fitted_Center.toFixed(4)}</td>
                              <td className="px-3 py-3">{fit.Shift.toFixed(4)}</td>
                              <td className="px-3 py-3">{fit.Fixed_FWHM.toFixed(4)}</td>
                              <td className="px-3 py-3">{fit.Fixed_Area.toFixed(4)}</td>
                              <td className="px-3 py-3">{fit.Template_Height.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {!isOverlayView && logChartTraces.length > 0 && (
                <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <ChartToolbar
                    title="4. 對數弱峰檢視"
                    colorValue={chartLineColors.log}
                    onColorChange={value => setChartLineColors(current => ({ ...current, log: value }))}
                  />
                  <p className="mb-3 text-xs text-[var(--text-soft)]">
                    此顯示模式只改變圖表縮放方式，方便觀察弱峰與寬尾巴。不影響尋峰、Scherrer 或參考峰匹配的計算基礎。
                  </p>
                  <Plot
                    data={applyHidden(logChartTraces, logHidden)}
                    layout={chartLayout({ xMode, wavelength, yTitle: `${logViewParams.method} Intensity` })}
                    config={{ responsive: true, displayModeBar: false, scrollZoom: true }}
                    style={{ width: '100%', height: 360 }}
                    onLegendClick={makeLegendClick(setLogHidden) as never}
                    onLegendDoubleClick={() => false}
                    useResizeHandler
                  />
                </div>
              )}

              {!isOverlayView && finalChartTraces.length > 0 && (
                <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <ChartToolbar
                    title="5. 最終處理光譜"
                    colorValue={chartLineColors.final}
                    onColorChange={value => setChartLineColors(current => ({ ...current, final: value }))}
                  />
                  <p className="mb-3 text-xs text-[var(--text-soft)]">把最終處理結果、參考峰與偵測到的峰位放在同一張圖上，顯示方式對齊 XPS 的最終圖卡。</p>
                  <Plot
                    data={applyHidden(finalChartTraces, finalHidden)}
                    layout={chartLayout({ xMode, wavelength, height: 380 })}
                    config={{ responsive: true, displayModeBar: false, scrollZoom: true }}
                    style={{ width: '100%', height: 380 }}
                    onLegendClick={makeLegendClick(setFinalHidden) as never}
                    onLegendDoubleClick={() => false}
                    useResizeHandler
                  />
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(finalStageDatasets, xMode === 'dspacing' ? 'd_spacing_A' : 'two_theta_deg', 'intensity_processed'), 'xrd_final_stage.csv', 'text/csv')}
                      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                    >
                      下載此步驟 CSV
                    </button>
                  </div>
                </div>
              )}

              {peakParams.enabled && (
                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">自動偵測峰位</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        基於目前處理後光譜，可用於快速確認主要峰位，再做進一步解析。
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {detectedPeaks.length} 個峰
                    </span>
                  </div>

                  {detectedPeaks.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      目前條件下沒有找到可用峰位。可以降低 prominence，或調整平滑與歸一化後再試一次。
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">#</th>
                            <th className="px-3 py-3 font-medium">2θ (deg)</th>
                              <th className="px-3 py-3 font-medium">d-spacing (Å)</th>
                              <th className="px-3 py-3 font-medium">強度</th>
                              <th className="px-3 py-3 font-medium">相對強度 (%)</th>
                              <th className="px-3 py-3 font-medium">FWHM (deg)</th>
                            </tr>
                        </thead>
                        <tbody>
                          {detectedPeaks.map((peak, idx) => (
                            <tr key={`${peak.two_theta}-${idx}`} className="border-b border-white/5 text-slate-200 last:border-b-0">
                              <td className="px-3 py-3 text-slate-500">{idx + 1}</td>
                              <td className="px-3 py-3 font-medium">{peak.two_theta.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.d_spacing.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.intensity.toFixed(2)}</td>
                              <td className="px-3 py-3">{peak.rel_intensity.toFixed(1)}</td>
                              <td className="px-3 py-3">{peak.fwhm_deg.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {scherrerParams.enabled && peakParams.enabled && (
                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Scherrer 晶粒尺寸</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        使用目前偵測峰的 FWHM 與 Scherrer 公式估算晶粒尺寸。結果對展寬假設非常敏感，僅供快速篩選。
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      K = {scherrerParams.k.toFixed(2)}, λ = {wavelength.toFixed(4)} Å
                    </span>
                  </div>

                  {scherrerRows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      先啟用自動尋峰並確認有峰位結果，Scherrer 才能計算。
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">#</th>
                            <th className="px-3 py-3 font-medium">2θ (deg)</th>
                            <th className="px-3 py-3 font-medium">FWHM (deg)</th>
                            <th className="px-3 py-3 font-medium">D (nm)</th>
                            <th className="px-3 py-3 font-medium">D (Å)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scherrerRows.map((peak, idx) => (
                            <tr key={`scherrer-${peak.two_theta}-${idx}`} className="border-b border-white/5 text-slate-200 last:border-b-0">
                              <td className="px-3 py-3 text-slate-500">{idx + 1}</td>
                              <td className="px-3 py-3 font-medium">{peak.two_theta.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.fwhm_deg.toFixed(4)}</td>
                              <td className="px-3 py-3">
                                {peak.crystallite_nm == null ? 'N/A' : peak.crystallite_nm.toFixed(3)}
                              </td>
                              <td className="px-3 py-3">
                                {peak.crystallite_nm == null ? 'N/A' : (peak.crystallite_nm * 10).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {selectedRefs.length > 0 && (
                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">參考峰匹配</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        以目前自動偵測的峰位，為每條選定參考線找最近的觀測峰。這是快速相辨識篩選表，不是完整相鑑定報告。
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {matchedReferenceCount} / {referenceMatches.length} 匹配
                    </span>
                  </div>

                  {!peakParams.enabled ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      參考峰匹配需要先啟用自動尋峰，因為目前網站版會直接使用尋峰結果來做最近峰比對。
                    </div>
                  ) : filteredRefPeaks.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      目前條件下沒有符合最小相對強度門檻的參考峰。可以降低強度門檻或改選其他參考相位。
                    </div>
                  ) : visibleReferenceMatches.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      目前容差下沒有匹配到參考峰。可以放寬容差，或重新調整平滑與尋峰條件。
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">相位</th>
                            <th className="px-3 py-3 font-medium">hkl</th>
                            <th className="px-3 py-3 font-medium">Ref 2θ</th>
                            <th className="px-3 py-3 font-medium">Ref d</th>
                            <th className="px-3 py-3 font-medium">Ref I (%)</th>
                            <th className="px-3 py-3 font-medium">Obs 2θ</th>
                            <th className="px-3 py-3 font-medium">Obs d</th>
                            <th className="px-3 py-3 font-medium">Obs 強度</th>
                            <th className="px-3 py-3 font-medium">Δ2θ</th>
                            <th className="px-3 py-3 font-medium">匹配</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleReferenceMatches.map((row, idx) => (
                            <tr
                              key={`${row.material}-${row.hkl}-${row.ref_two_theta}-${idx}`}
                              className="border-b border-white/5 text-slate-200 last:border-b-0"
                            >
                              <td className="px-3 py-3 font-medium">{row.material}</td>
                              <td className="px-3 py-3">{row.hkl || '-'}</td>
                              <td className="px-3 py-3">{row.ref_two_theta.toFixed(4)}</td>
                              <td className="px-3 py-3">{row.ref_d_spacing.toFixed(4)}</td>
                              <td className="px-3 py-3">{row.ref_rel_i.toFixed(1)}</td>
                              <td className="px-3 py-3">
                                {row.observed_two_theta == null ? 'N/A' : row.observed_two_theta.toFixed(4)}
                              </td>
                              <td className="px-3 py-3">
                                {row.observed_d_spacing == null ? 'N/A' : row.observed_d_spacing.toFixed(4)}
                              </td>
                              <td className="px-3 py-3">
                                {row.observed_intensity == null ? 'N/A' : row.observed_intensity.toFixed(2)}
                              </td>
                              <td className="px-3 py-3">
                                {row.delta_two_theta == null ? 'N/A' : row.delta_two_theta.toFixed(4)}
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={[
                                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                                    row.matched
                                      ? 'border border-emerald-300/20 bg-emerald-400/10 text-emerald-200'
                                      : 'border border-rose-300/20 bg-rose-400/10 text-rose-200',
                                  ].join(' ')}
                                >
                                  {row.matched ? '✓ 匹配' : '✗ 不匹配'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                <div className="mb-4">
                  <p className="text-sm font-semibold text-white">匯出</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    下載處理後光譜、峰位表、匹配表、高斯中心結果，以及目前 XRD 流程的 JSON 紀錄。
                  </p>
                </div>

                <div className="grid gap-4 xl:grid-cols-3">
                  <div className="rounded-[22px] border border-white/10 bg-slate-950/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">研究常用</p>
                    <div className="mt-3 flex flex-col gap-2">
                      <button
                        onClick={() => {
                          downloadFile(processedSpectrumCsv(result), 'xrd_processed.csv', 'text/csv')
                        }}
                        className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition-transform hover:-translate-y-0.5 hover:bg-cyan-200"
                      >
                        下載處理後光譜 CSV
                      </button>
                      {activeDataset && (
                        <button
                          onClick={() => {
                            downloadFile(
                              detailedDatasetCsv(activeDataset, wavelength, logViewParams),
                              `${activeDataset.name.replace(/\.[^.]+$/, '')}_detailed.csv`,
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載目前資料集詳細 CSV
                        </button>
                      )}
                      {scherrerParams.enabled && scherrerRows.length > 0 && (
                        <button
                          onClick={() => {
                            downloadFile(
                              toCsv(
                                ['two_theta_deg', 'd_spacing_A', 'intensity', 'relative_intensity_pct', 'fwhm_deg', 'D_nm', 'D_A'],
                                scherrerRows.map(row => [
                                  row.two_theta.toFixed(4),
                                  row.d_spacing.toFixed(4),
                                  row.intensity.toFixed(2),
                                  row.rel_intensity.toFixed(1),
                                  row.fwhm_deg.toFixed(4),
                                  row.crystallite_nm == null ? '' : row.crystallite_nm.toFixed(6),
                                  row.crystallite_nm == null ? '' : (row.crystallite_nm * 10).toFixed(6),
                                ]),
                              ),
                              'xrd_scherrer.csv',
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載 Scherrer CSV
                        </button>
                      )}
                      {activeGaussianFits.length > 0 && (
                        <button
                          onClick={() => {
                            downloadFile(
                              toCsv(
                                ['peak_name', 'seed_center_2theta_deg', 'fitted_center_2theta_deg', 'shift_deg', 'fixed_fwhm_deg', 'fixed_area', 'template_height'],
                                activeGaussianFits.map(row => [
                                  row.Peak_Name,
                                  row.Seed_Center.toFixed(4),
                                  row.Fitted_Center.toFixed(4),
                                  row.Shift.toFixed(4),
                                  row.Fixed_FWHM.toFixed(4),
                                  row.Fixed_Area.toFixed(4),
                                  row.Template_Height.toFixed(4),
                                ]),
                              ),
                              'xrd_gaussian_centers.csv',
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載高斯中心結果 CSV
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-slate-950/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">分析表格</p>
                    <div className="mt-3 flex flex-col gap-2">
                      {peakParams.enabled && detectedPeaks.length > 0 && (
                        <button
                          onClick={() => {
                            downloadFile(
                              toCsv(
                                ['two_theta_deg', 'd_spacing_A', 'intensity', 'relative_intensity_pct', 'fwhm_deg'],
                                detectedPeaks.map(row => [
                                  row.two_theta.toFixed(4),
                                  row.d_spacing.toFixed(4),
                                  row.intensity.toFixed(2),
                                  row.rel_intensity.toFixed(1),
                                  row.fwhm_deg.toFixed(4),
                                ]),
                              ),
                              'xrd_detected_peaks.csv',
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載自動尋峰 CSV
                        </button>
                      )}
                      {filteredRefPeaks.length > 0 && (
                        <button
                          onClick={() => {
                            downloadFile(
                              toCsv(
                                ['material', 'hkl', 'two_theta_deg', 'd_spacing_A', 'relative_intensity_pct'],
                                filteredRefPeaks.map(row => [
                                  row.material,
                                  row.hkl,
                                  row.two_theta.toFixed(4),
                                  row.d_spacing.toFixed(4),
                                  row.rel_i.toFixed(1),
                                ]),
                              ),
                              'xrd_reference_peaks.csv',
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載參考峰 CSV
                        </button>
                      )}
                      {referenceMatches.length > 0 && (
                        <button
                          onClick={() => {
                            downloadFile(
                              toCsv(
                                ['material', 'hkl', 'ref_two_theta_deg', 'ref_d_spacing_A', 'ref_relative_intensity_pct', 'obs_two_theta_deg', 'obs_d_spacing_A', 'obs_intensity', 'delta_two_theta_deg', 'matched'],
                                referenceMatches.map(row => [
                                  row.material,
                                  row.hkl,
                                  row.ref_two_theta.toFixed(4),
                                  row.ref_d_spacing.toFixed(4),
                                  row.ref_rel_i.toFixed(1),
                                  row.observed_two_theta == null ? '' : row.observed_two_theta.toFixed(4),
                                  row.observed_d_spacing == null ? '' : row.observed_d_spacing.toFixed(4),
                                  row.observed_intensity == null ? '' : row.observed_intensity.toFixed(2),
                                  row.delta_two_theta == null ? '' : row.delta_two_theta.toFixed(4),
                                  row.matched ? 'true' : 'false',
                                ]),
                              ),
                              'xrd_reference_matches.csv',
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載參考匹配 CSV
                        </button>
                      )}
                      {!peakParams.enabled && filteredRefPeaks.length === 0 && (
                        <p className="text-xs leading-5 text-slate-500">
                          啟用自動尋峰或參考峰比對後，這裡才會有對應的分析表格可下載。
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-slate-950/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">追溯 / 設定</p>
                    <div className="mt-3 flex flex-col gap-2">
                      <button
                        onClick={() => {
                          downloadFile(
                            JSON.stringify(processingReport, null, 2),
                            'xrd_processing_report.json',
                            'application/json',
                          )
                        }}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                      >
                        下載處理報告 JSON
                      </button>
                      <p className="text-xs leading-5 text-slate-500">
                        會保存目前波長、處理參數、log 設定、高斯中心、尋峰結果、匹配結果與 Scherrer 結果摘要。
                      </p>
                      <span className="text-xs text-slate-500">
                        {result.datasets.length} 個資料集
                        {result.average ? ' (含平均)' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
          </div>
        </div>
      </div>

      <DatasetSelectionModal
        open={overlaySelectorOpen}
        title="選擇 XRD 疊圖資料"
        items={overlayItems}
        selectedKeys={overlayDraftSelection}
        onToggle={toggleOverlayDraft}
        onClose={() => setOverlaySelectorOpen(false)}
        onConfirm={applyOverlaySelection}
      />
    </div>
  )
}
