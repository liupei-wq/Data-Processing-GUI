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
import Plot, { type PlotClickEvent } from '../components/PlotlyChart'
import type {
  DetectedPeak,
  FinalPeakRow,
  LogViewParams,
  ParsedFile,
  PeakDetectionParams,
  ProcessResult,
  RefPeak,
  ReferenceMatchParams,
  ReferenceMatchRow,
  ScherrerParams,
  XMode,
  XAxisCorrectionParams,
  WavelengthPreset,
} from '../types/xrd'
import { detectPeaks, parseFiles, processData, fetchReferences, fetchReferencePeaks } from '../api/xrd'
import { type AnalysisModuleId } from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import ProcessingPanel, {
  DEFAULT_PARAMS,
  WAVELENGTH_MAP,
} from '../components/ProcessingPanel'
import {
  applyHidden,
  ChartToolbar,
  DEFAULT_SERIES_PALETTE_KEYS,
  DatasetSelectionModal,
  DeferredRender,
  EmptyWorkspaceState,
  InfoCardGrid,
  LINE_COLOR_OPTIONS,
  LINE_COLOR_PALETTES,
  makeLegendClick,
  MODULE_CONTENT,
  ModuleTopBar,
  ProcessingWorkspaceHeader,
  StickySidebarHeader,
} from '../components/WorkspaceUi'
import { withPlotFullscreen } from '../components/plotConfig'
import type { PlotPopupRequest } from '../hooks/usePlotPopups'
import type { ProcessParams } from '../types/xrd'
import { buildWeakPeaksTxt, downloadTextFile } from '../features/xrd/exportWeakPeaksTxt'

type CsvCell = string | number | null | undefined

type RefPeakCustomData = [
  material: string,
  phase: string,
  hkl: string,
  twoTheta: number,
  dSpacing: number,
  relI: number,
  source: string,
  tolerance: number,
]

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

function toExcelHtml(headers: string[], rows: CsvCell[][]): string {
  const esc = (value: CsvCell) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><table><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`
}

function downloadFile(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function safeFilenamePart(value: string | null | undefined) {
  return (value || 'xrd').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'xrd'
}

function timestampForFilename(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function formatNumber(value: number | null | undefined, digits = 4) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '-'
}

function refPeakToCustomData(peak: RefPeak): RefPeakCustomData {
  return [
    peak.material,
    peak.phase,
    peak.hkl,
    peak.two_theta,
    peak.d_spacing,
    peak.rel_i,
    peak.source,
    peak.tolerance,
  ]
}

function customDataToRefPeak(customdata: unknown, fallbackX?: number | string | null): RefPeak | null {
  if (!Array.isArray(customdata) || customdata.length < 8) return null
  const [material, phase, hkl, twoTheta, dSpacing, relI, source, tolerance] = customdata
  if (
    typeof material !== 'string'
    || typeof phase !== 'string'
    || typeof hkl !== 'string'
    || typeof source !== 'string'
  ) {
    return null
  }
  if (!material && !phase && !hkl) return null
  return {
    material: String(material ?? ''),
    phase: String(phase ?? ''),
    hkl: String(hkl ?? ''),
    two_theta: Number(twoTheta ?? fallbackX ?? 0),
    d_spacing: Number(dSpacing ?? 0),
    rel_i: Number(relI ?? 0),
    source: String(source ?? ''),
    tolerance: Number(tolerance ?? 0),
  }
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
  yTitle = '強度（a.u.）',
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
    title: {
      text: 'XRD 繞射圖譜分析',
      font: { color: chartText, size: 16 },
    },
    xaxis: {
      title: { text: xMode === 'dspacing' ? '晶面間距 d（Å）' : '2θ（degree）' },
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
    margin: { l: 60, r: 20, t: 52, b: 60 },
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

function xAxisCorrectionCoefficients(params: XAxisCorrectionParams) {
  if (!params.enabled) return { slope: 1, intercept: 0, description: '未啟用' }
  if (params.mode === 'manual') {
    return { slope: 1, intercept: params.manual_offset, description: `偏移 ${params.manual_offset.toFixed(4)} degree` }
  }

  const points = params.calibration_points.filter(point =>
    Number.isFinite(point.expected) && Number.isFinite(point.measured) && point.measured > 0 && point.expected > 0,
  )
  if (points.length === 0) return { slope: 1, intercept: 0, description: '沒有有效校正峰' }

  if (params.correction_type === 'linear' && points.length >= 2) {
    const meanMeasured = points.reduce((sum, point) => sum + point.measured, 0) / points.length
    const meanExpected = points.reduce((sum, point) => sum + point.expected, 0) / points.length
    const denom = points.reduce((sum, point) => sum + (point.measured - meanMeasured) ** 2, 0)
    if (denom > 0) {
      const slope = points.reduce((sum, point) => sum + (point.measured - meanMeasured) * (point.expected - meanExpected), 0) / denom
      const intercept = meanExpected - slope * meanMeasured
      return { slope, intercept, description: `線性校正 ${slope.toFixed(6)}x + ${intercept.toFixed(4)}` }
    }
  }

  const offset = points.reduce((sum, point) => sum + (point.expected - point.measured), 0) / points.length
  return { slope: 1, intercept: offset, description: `偏移 ${offset.toFixed(4)} degree` }
}

function applyXAxisCorrection(values: number[], params: XAxisCorrectionParams) {
  const { slope, intercept } = xAxisCorrectionCoefficients(params)
  return values.map(value => slope * value + intercept)
}

function isNearReference(peak: DetectedPeak, referencePeaks: RefPeak[], toleranceDeg: number) {
  return referencePeaks.some(ref => Math.abs(peak.two_theta - ref.two_theta) <= (ref.tolerance || toleranceDeg))
}

function confidenceLabel(value: FinalPeakRow['confidence'] | ReferenceMatchRow['confidence'] | DetectedPeak['confidence']) {
  switch (value) {
    case 'high':
      return '高'
    case 'medium':
      return '中'
    case 'low':
      return '低'
    case 'unmatched':
      return '未匹配'
    default:
      return value
  }
}

function localizePeakNote(note: string) {
  return note
    .replace(/multiple candidates/g, '多個候選峰')
    .replace(/unmatched reference peak/g, '未匹配參考峰')
    .replace(/unmatched peak/g, '未匹配峰')
    .replace(/close to noise floor/g, '接近雜訊底線')
    .replace(/moderate confidence peak/g, '中等信心峰')
    .replace(/manual confirmation suggested/g, '建議人工確認')
    .replace(/true/g, '是')
    .replace(/false/g, '否')
}

const THIN_FILM_SI_PEAK_PRESET: Omit<PeakDetectionParams, 'enabled' | 'show_unmatched_peaks' | 'export_weak_peaks'> = {
  sensitivity: 'medium',
  min_distance: 0.2,
  width_min: 0.03,
  width_max: 1.5,
  exclude_ranges: [{ start: 68, end: 70 }],
  max_peaks: 30,
  min_snr: 3,
}

const GENERAL_XRD_PEAK_PRESET: Omit<PeakDetectionParams, 'enabled' | 'show_unmatched_peaks' | 'export_weak_peaks'> = {
  sensitivity: 'medium',
  min_distance: 0.12,
  width_min: 0.02,
  width_max: 1.2,
  exclude_ranges: [],
  max_peaks: 30,
  min_snr: 3,
}

function inferPeakWorkflowPreset(params: PeakDetectionParams): 'thin_film_si' | 'general' | 'custom' {
  const hasThinFilmSiMask = params.exclude_ranges.some(range => {
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    return Math.abs(start - 68) <= 0.05 && Math.abs(end - 70) <= 0.05
  })
  if (
    hasThinFilmSiMask
    && params.sensitivity === THIN_FILM_SI_PEAK_PRESET.sensitivity
    && Math.abs(params.min_distance - THIN_FILM_SI_PEAK_PRESET.min_distance) <= 1e-6
    && Math.abs(params.width_min - THIN_FILM_SI_PEAK_PRESET.width_min) <= 1e-6
    && Math.abs(params.width_max - THIN_FILM_SI_PEAK_PRESET.width_max) <= 1e-6
    && Math.abs(params.min_snr - THIN_FILM_SI_PEAK_PRESET.min_snr) <= 1e-6
  ) {
    return 'thin_film_si'
  }
  if (
    params.exclude_ranges.length === 0
    && params.sensitivity === GENERAL_XRD_PEAK_PRESET.sensitivity
    && Math.abs(params.min_distance - GENERAL_XRD_PEAK_PRESET.min_distance) <= 1e-6
    && Math.abs(params.width_min - GENERAL_XRD_PEAK_PRESET.width_min) <= 1e-6
    && Math.abs(params.width_max - GENERAL_XRD_PEAK_PRESET.width_max) <= 1e-6
    && Math.abs(params.min_snr - GENERAL_XRD_PEAK_PRESET.min_snr) <= 1e-6
  ) {
    return 'general'
  }
  return 'custom'
}

function buildStageCsv(datasets: { name: string; x: number[]; y: number[] }[], xLabel: string, yLabel: string) {
  const rows: CsvCell[][] = []
  datasets.forEach(dataset => {
    dataset.x.forEach((x, index) => {
      rows.push([dataset.name, x.toFixed(6), dataset.y[index]?.toFixed(6) ?? ''])
    })
  })
  return toCsv(['資料集', xLabel, yLabel], rows)
}

function processedSpectrumCsv(result: ProcessResult): string {
  const ds = result.average ?? result.datasets[0]
  if (!ds) return ''
  const headers = ['2θ（degree）', ...result.datasets.map(d => `${d.name}_處理後強度`)]
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
  const headers = ['2θ（degree）', '晶面間距 d（Å）', '原始強度', '處理後強度']
  const processedMin = dataset.y_processed.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY)
  const logShift = logViewParams.enabled && processedMin <= 0
    ? Math.abs(processedMin) + logViewParams.floor_value
    : logViewParams.floor_value
  if (logViewParams.enabled) headers.push(`${logViewParams.method} 處理後強度`)
  const rows = dataset.x.map((x, idx) => {
    const processed = dataset.y_processed[idx]
    const dSpacing = twoThetaToD(x, wavelength)
    const row: CsvCell[] = [
      x.toFixed(4),
      dSpacing == null ? '' : dSpacing.toFixed(4),
      dataset.y_raw[idx]?.toFixed(6) ?? '',
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
          confidence: 'unmatched',
          candidates: '',
          note: '未匹配參考峰',
        }
      }

      const tolerance = refPeak.tolerance || toleranceDeg
      const candidates = observedPeaks
        .map(peak => ({ peak, delta: Math.abs(peak.two_theta - refPeak.two_theta) }))
        .filter(item => item.delta <= tolerance)
        .sort((a, b) => a.delta - b.delta)
      const closest = candidates[0] ?? observedPeaks.reduce((best, peak) => {
        const delta = Math.abs(peak.two_theta - refPeak.two_theta)
        if (best == null || delta < best.delta) return { peak, delta }
        return best
      }, null as { peak: DetectedPeak; delta: number } | null)
      const matched = closest != null && closest.delta <= tolerance
      const confidence: ReferenceMatchRow['confidence'] = !matched
        ? 'unmatched'
        : closest.peak.confidence === 'high' && closest.delta <= tolerance * 0.5
          ? 'high'
          : closest.peak.confidence === 'low'
            ? 'low'
            : 'medium'

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
        matched,
        confidence,
        candidates: candidates.map(item => `${item.peak.two_theta.toFixed(4)}（${confidenceLabel(item.peak.confidence)}，Δ=${item.delta.toFixed(4)}）`).join('；'),
        note: candidates.length > 1 ? '多個候選峰' : matched ? localizePeakNote(closest.peak.note) : '未匹配參考峰',
      }
    })
}

function buildFinalPeakRows(
  peaks: DetectedPeak[],
  referencePeaks: RefPeak[],
  toleranceDeg: number,
  showUnmatched: boolean,
): FinalPeakRow[] {
  return peaks
    .map(peak => {
      const candidates = referencePeaks
        .map(ref => ({ ref, delta: Math.abs(peak.two_theta - ref.two_theta), tolerance: ref.tolerance || toleranceDeg }))
        .filter(item => item.delta <= item.tolerance)
        .sort((a, b) => a.delta - b.delta)
      const best = candidates[0]
      const candidateText = candidates.map(item => `${item.ref.phase || item.ref.material} ${item.ref.hkl} Δ=${item.delta.toFixed(4)}`).join('；')
      const noteParts = [localizePeakNote(peak.note)].filter(Boolean)
      if (candidates.length > 1) noteParts.push(`多個候選峰：${candidateText}`)
      if (!best) noteParts.push('未匹配峰')
      const confidence: FinalPeakRow['confidence'] = best
        ? (peak.confidence === 'high' && best.delta <= best.tolerance * 0.5 ? 'high' : peak.confidence)
        : 'unmatched'
      return {
        two_theta: peak.two_theta,
        intensity: peak.intensity,
        fwhm_deg: peak.fwhm_deg,
        snr: peak.snr,
        prominence: peak.prominence,
        phase: best ? (best.ref.phase || best.ref.material) : '未匹配峰',
        hkl: best?.ref.hkl ?? '',
        reference_2theta: best?.ref.two_theta ?? null,
        delta_2theta: best?.delta ?? null,
        near_reference: Boolean(best),
        candidate_count: candidates.length,
        confidence,
        note: noteParts.join('；'),
      }
    })
    .filter(row => showUnmatched || row.phase !== '未匹配峰')
}

const SIDEBAR_MIN_WIDTH = 320
const SIDEBAR_MAX_WIDTH = 560
const SIDEBAR_DEFAULT_WIDTH = 368
const SIDEBAR_COLLAPSED_PEEK = 28

export default function XRD({
  onModuleSelect,
  onOpenPlotPopup,
}: {
  onModuleSelect?: (module: AnalysisModuleId) => void
  onOpenPlotPopup?: (popup: PlotPopupRequest) => void
}) {
  const moduleContent = MODULE_CONTENT.xrd
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
  const [selectedRefPeak, setSelectedRefPeak] = useState<RefPeak | null>(null)
  const [refPeaks, setRefPeaks] = useState<RefPeak[]>([])
  const [logViewParams, setLogViewParams] = useState<LogViewParams>({
    enabled: false,
    method: 'log10',
    floor_value: 0.000001,
  })
  const [refMatchParams, setRefMatchParams] = useState<ReferenceMatchParams>({
    min_rel_intensity: 10,
    tolerance_deg: 0.3,
    only_show_matched: false,
  })
  const [xAxisCorrection, setXAxisCorrection] = useState<XAxisCorrectionParams>({
    enabled: false,
    mode: 'manual',
    manual_offset: 0,
    correction_type: 'constant',
    calibration_points: [{ expected: 0, measured: 0 }],
    show_raw_curve: true,
    show_corrected_curve: true,
    show_reference_markers: true,
  })
  const [xMode, setXMode] = useState<XMode>('twotheta')
  const [wavelengthPreset, setWavelengthPreset] = useState<WavelengthPreset>('Cu Kα (1.5406 Å)')
  const [customWavelength, setCustomWavelength] = useState(1.5406)
  const [peakParams, setPeakParams] = useState<PeakDetectionParams>({
    enabled: false,
    ...THIN_FILM_SI_PEAK_PRESET,
    show_unmatched_peaks: true,
    export_weak_peaks: true,
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
    log: 'violet',
    final: 'blue',
  })
  const [rawHidden, setRawHidden] = useState<string[]>([])
  const [overlayHidden, setOverlayHidden] = useState<string[]>([])
  const [preprocessHidden, setPreprocessHidden] = useState<string[]>([])
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
    wavelengthPreset === '自訂' ? customWavelength : WAVELENGTH_MAP[wavelengthPreset]
  const xAxisCorrectionInfo = useMemo(
    () => xAxisCorrectionCoefficients(xAxisCorrection),
    [xAxisCorrection],
  )
  const correctedRawFiles = useMemo(
    () => rawFiles.map(file => ({
      ...file,
      x: xAxisCorrection.enabled ? applyXAxisCorrection(file.x, xAxisCorrection) : file.x,
    })),
    [rawFiles, xAxisCorrection],
  )
  const activeDataset = useMemo(
    () => result?.datasets.find(dataset => dataset.name === selectedDatasetName) ?? result?.datasets[0] ?? result?.average ?? null,
    [result, selectedDatasetName],
  )
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
    ? `${Math.min(...activeDataset.x).toFixed(1)} – ${Math.max(...activeDataset.x).toFixed(1)} ${xMode === 'dspacing' ? 'Å' : 'degree'}`
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
    () => rawChartSourceFiles.flatMap((file, index) => {
      const paletteKey = rawFileColors[rawFiles.findIndex(item => item.name === file.name)] ?? DEFAULT_SERIES_PALETTE_KEYS[index % DEFAULT_SERIES_PALETTE_KEYS.length]
      const palette = LINE_COLOR_PALETTES[paletteKey] ?? LINE_COLOR_PALETTES.blue
      const correctedX = xAxisCorrection.enabled ? applyXAxisCorrection(file.x, xAxisCorrection) : file.x
      const traces: Plotly.Data[] = []
      if (!xAxisCorrection.enabled || xAxisCorrection.show_raw_curve) traces.push({
        x: convertXValues(file.x, xMode, wavelength),
        y: file.y,
        type: 'scatter',
        mode: 'lines',
        name: '原始資料',
        line: { color: palette.secondary, width: 1.5, dash: xAxisCorrection.enabled ? 'dot' : 'solid' },
      })
      if (xAxisCorrection.enabled && xAxisCorrection.show_corrected_curve) traces.push({
        x: convertXValues(correctedX, xMode, wavelength),
        y: file.y,
        type: 'scatter',
        mode: 'lines',
        name: '校正後資料',
        line: { color: palette.primary, width: 2 },
      })
      return traces
    }),
    [rawChartSourceFiles, rawFileColors, rawFiles, wavelength, xAxisCorrection, xMode],
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
  const logStageDatasets = useMemo(() => {
    if (!activeDataset || !logViewParams.enabled) return []
    const minValue = activeDataset.y_processed.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY)
    const shift = minValue <= 0 ? Math.abs(minValue) + logViewParams.floor_value : logViewParams.floor_value
    return [{
      name: '弱峰',
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
    const activeRawFile = rawFiles.find(file => file.name === activeDataset.name)
    const traces: Plotly.Data[] = [
      {
        x: xValues,
        y: activeDataset.y_processed,
        type: 'scatter',
        mode: 'lines',
        name: '校正後資料',
        line: { color: palette.primary, width: 2.3 },
      },
    ]
    if (xAxisCorrection.enabled && xAxisCorrection.show_raw_curve && activeRawFile) {
      traces.unshift({
        x: convertXValues(activeRawFile.x, xMode, wavelength),
        y: activeRawFile.y,
        type: 'scatter',
        mode: 'lines',
        name: '原始資料',
        line: { color: palette.secondary, width: 1.25, dash: 'dot' },
      })
    }
    if (filteredRefPeaks.length > 0 && (!xAxisCorrection.enabled || xAxisCorrection.show_reference_markers)) {
      const yMax = activeDataset.y_processed.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY)
      const xPoints: Array<number | null> = []
      const yPoints: Array<number | null> = []
      const refCustomData: Array<RefPeakCustomData | null> = []
      filteredRefPeaks.forEach(peak => {
        xPoints.push(xMode === 'dspacing' ? peak.d_spacing : peak.two_theta, xMode === 'dspacing' ? peak.d_spacing : peak.two_theta, null)
        yPoints.push(0, yMax * (peak.rel_i / 100) * 0.8, null)
        const customData = refPeakToCustomData(peak)
        refCustomData.push(customData, customData, null)
      })
      traces.push({
        x: xPoints,
        y: yPoints,
        type: 'scatter',
        mode: 'lines',
        name: '參考峰',
        line: { color: palette.accent, width: 1.4, dash: 'dot' },
        customdata: refCustomData as unknown as Plotly.Datum[],
        hovertemplate: [
          'Material: %{customdata[0]}',
          'Phase: %{customdata[1]}',
          'HKL: %{customdata[2]}',
          '2θ: %{customdata[3]:.4f}°',
          'd: %{customdata[4]:.4f} Å',
          'Rel. I: %{customdata[5]:.1f}%',
          '<extra></extra>',
        ].join('<br>'),
      })
      traces.push({
        x: filteredRefPeaks.map(peak => (xMode === 'dspacing' ? peak.d_spacing : peak.two_theta)),
        y: filteredRefPeaks.map(peak => yMax * (peak.rel_i / 100) * 0.8),
        type: 'scatter',
        mode: 'markers',
        name: '參考峰點擊區',
        showlegend: false,
        customdata: filteredRefPeaks.map(refPeakToCustomData) as unknown as Plotly.Datum[],
        marker: {
          color: palette.accent,
          size: 9,
          symbol: 'line-ns-open',
          opacity: 0.85,
          line: { color: palette.accent, width: 1.5 },
        },
        hovertemplate: [
          'Material: %{customdata[0]}',
          'Phase: %{customdata[1]}',
          'HKL: %{customdata[2]}',
          '2θ: %{customdata[3]:.4f}°',
          'd: %{customdata[4]:.4f} Å',
          'Rel. I: %{customdata[5]:.1f}%',
          '<extra></extra>',
        ].join('<br>'),
      })
    }
    if (detectedPeaks.length > 0 && peakParams.enabled) {
      const regularPeaks = detectedPeaks.filter(peak => peak.confidence !== 'low' && (filteredRefPeaks.length === 0 || isNearReference(peak, filteredRefPeaks, refMatchParams.tolerance_deg)))
      const weakPeaks = detectedPeaks.filter(peak => peak.confidence === 'low')
      const unmatchedPeaks = filteredRefPeaks.length > 0
        ? detectedPeaks.filter(peak => peak.confidence !== 'low' && !isNearReference(peak, filteredRefPeaks, refMatchParams.tolerance_deg))
        : []
      if (regularPeaks.length > 0) {
        traces.push({
          x: regularPeaks.map(peak => (xMode === 'dspacing' ? peak.d_spacing : peak.two_theta)),
          y: regularPeaks.map(peak => peak.intensity),
          type: 'scatter',
          mode: 'markers',
          name: '偵測峰',
          marker: {
            color: '#f8fafc',
            size: 8,
            symbol: 'diamond-open',
            line: { color: palette.primary, width: 1.5 },
          },
        })
      }
      if (weakPeaks.length > 0) {
        traces.push({
          x: weakPeaks.map(peak => (xMode === 'dspacing' ? peak.d_spacing : peak.two_theta)),
          y: weakPeaks.map(peak => peak.intensity),
          type: 'scatter',
          mode: 'markers',
          name: '弱峰',
          marker: {
            color: '#fde68a',
            size: 8,
            symbol: 'circle-open',
            line: { color: '#f59e0b', width: 1.5 },
          },
        })
      }
      if (unmatchedPeaks.length > 0) {
        traces.push({
          x: unmatchedPeaks.map(peak => (xMode === 'dspacing' ? peak.d_spacing : peak.two_theta)),
          y: unmatchedPeaks.map(peak => peak.intensity),
          type: 'scatter',
          mode: 'markers',
          name: '未匹配峰',
          marker: {
            color: '#fecaca',
            size: 8,
            symbol: 'x',
            line: { color: '#fb7185', width: 1.5 },
          },
        })
      }
    }
    return traces
  }, [activeDataset, chartLineColors.final, detectedPeaks, filteredRefPeaks, peakParams.enabled, rawFiles, refMatchParams.tolerance_deg, wavelength, xAxisCorrection.enabled, xAxisCorrection.show_raw_curve, xAxisCorrection.show_reference_markers, xMode])
  const finalStageDatasets = useMemo(
    () => activeDataset ? [{ name: activeDataset.name, x: convertXValues(activeDataset.x, xMode, wavelength), y: activeDataset.y_processed }] : [],
    [activeDataset, wavelength, xMode],
  )
  const handlePlotClick = useCallback((event: PlotClickEvent) => {
    const point = event.points?.[0] as (Plotly.PlotDatum & {
      customdata?: unknown
      data?: { customdata?: unknown[] }
      pointIndex?: number
      pointNumber?: number
    }) | undefined
    const pointIndex = point?.pointIndex ?? point?.pointNumber
    const traceCustomData = typeof pointIndex === 'number' && Array.isArray(point?.data?.customdata)
      ? point.data.customdata[pointIndex]
      : undefined
    const fallbackX = typeof point?.x === 'number' || typeof point?.x === 'string' ? point.x : undefined
    const refPeak = customDataToRefPeak(point?.customdata ?? traceCustomData, fallbackX)
    if (refPeak) setSelectedRefPeak(refPeak)
  }, [])
  const weakPeakPlotData = useMemo(
    () => applyHidden(logChartTraces, logHidden),
    [logChartTraces, logHidden],
  )
  const weakPeakPlotLayout = useMemo(
    () => chartLayout({ xMode, wavelength, yTitle: `${logViewParams.method} 強度` }),
    [logViewParams.method, wavelength, xMode],
  )
  const weakPeakPlotConfig = useMemo(
    () => withPlotFullscreen({ scrollZoom: false }),
    [],
  )
  const renderWeakPeakChart = useCallback((height: number, bindLegend = true) => (
    <Plot
      data={weakPeakPlotData}
      layout={{ ...weakPeakPlotLayout, height }}
      config={weakPeakPlotConfig}
      style={{ width: '100%', height }}
      onLegendClick={bindLegend ? (makeLegendClick(setLogHidden) as never) : undefined}
      onLegendDoubleClick={bindLegend ? (() => false) : undefined}
      onClick={handlePlotClick}
      useResizeHandler
    />
  ), [handlePlotClick, weakPeakPlotConfig, weakPeakPlotData, weakPeakPlotLayout])
  const openWeakPeakChartPopup = useCallback(() => {
    if (!onOpenPlotPopup || logChartTraces.length === 0) return
    onOpenPlotPopup({
      title: 'XRD 弱峰分析圖',
      content: renderWeakPeakChart(650, false),
    })
  }, [logChartTraces.length, onOpenPlotPopup, renderWeakPeakChart])
  const renderFinalChart = useCallback((height: number, bindLegend = true) => {
    return (
      <Plot
        data={applyHidden(finalChartTraces, finalHidden)}
        layout={chartLayout({ xMode, wavelength, height })}
        config={withPlotFullscreen({ scrollZoom: false })}
        style={{ width: '100%', height }}
        onLegendClick={bindLegend ? (makeLegendClick(setFinalHidden) as never) : undefined}
        onLegendDoubleClick={bindLegend ? (() => false) : undefined}
        onClick={handlePlotClick}
        useResizeHandler
      />
    )
  }, [finalChartTraces, finalHidden, handlePlotClick, wavelength, xMode])
  const openFinalChartPopup = useCallback(() => {
    if (!onOpenPlotPopup || finalChartTraces.length === 0) return

    onOpenPlotPopup({
      title: `XRD 繞射圖譜分析 - ${activeDataset?.name ?? '資料集'}`,
      content: renderFinalChart(460, false),
    })
  }, [activeDataset?.name, finalChartTraces.length, onOpenPlotPopup, renderFinalChart])
  const referenceMatches = useMemo(
    () => buildReferenceMatches(filteredRefPeaks, detectedPeaks, refMatchParams.tolerance_deg),
    [filteredRefPeaks, detectedPeaks, refMatchParams.tolerance_deg],
  )
  const visibleReferenceMatches = useMemo(
    () => refMatchParams.only_show_matched ? referenceMatches.filter(row => row.matched) : referenceMatches,
    [referenceMatches, refMatchParams.only_show_matched],
  )
  const finalPeakRows = useMemo(
    () => buildFinalPeakRows(detectedPeaks, filteredRefPeaks, refMatchParams.tolerance_deg, peakParams.show_unmatched_peaks),
    [detectedPeaks, filteredRefPeaks, peakParams.show_unmatched_peaks, refMatchParams.tolerance_deg],
  )
  const handleExportWeakPeaksTxt = useCallback(() => {
    const datasetName = activeDataset?.name ?? 'xrd'
    const content = buildWeakPeaksTxt({
      datasetName,
      wavelength,
      detectedPeaks,
      finalPeakRows,
      referencePeaks: filteredRefPeaks,
    })
    const filename = `xrd_weak_peaks_${safeFilenamePart(datasetName)}_${timestampForFilename()}.txt`
    downloadTextFile(filename, content)
  }, [activeDataset?.name, detectedPeaks, filteredRefPeaks, finalPeakRows, wavelength])
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
    x_axis_correction: {
      ...xAxisCorrection,
      slope: xAxisCorrectionInfo.slope,
      intercept: xAxisCorrectionInfo.intercept,
      description: xAxisCorrectionInfo.description,
    },
    log_view: logViewParams,
    reference_matching: {
      selected_refs: selectedRefs,
      ...refMatchParams,
      matched_count: matchedReferenceCount,
      total_reference_lines: referenceMatches.length,
    },
    peak_detection: {
      workflow_preset: inferPeakWorkflowPreset(peakParams),
      ...peakParams,
      detected_count: detectedPeaks.length,
    },
    scherrer: {
      ...scherrerParams,
      rows: scherrerRows,
    },
    reference_peaks: filteredRefPeaks,
    reference_matches: referenceMatches,
    final_peaks: finalPeakRows,
  }

  useEffect(() => {
    fetchReferences()
      .then(materials => {
        setRefMaterials(materials)
        setSelectedRefs(current => current.length > 0 ? current : materials.filter(material =>
          material.includes('β-Ga₂O₃') || material.includes('NiO') || material.includes('Si 基板'),
        ))
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (rawFiles.length === 0) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    const timer = setTimeout(() => {
      processData(correctedRawFiles, params)
        .then(r => { if (!cancelled) setResult(r) })
        .catch(e => { if (!cancelled) setError(String(e.message)) })
        .finally(() => { if (!cancelled) setIsLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [rawFiles.length, correctedRawFiles, params])

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
        sensitivity: peakParams.sensitivity,
        min_distance: peakParams.min_distance,
        width_min: peakParams.width_min,
        width_max: peakParams.width_max,
        exclude_ranges: peakParams.exclude_ranges,
        max_peaks: peakParams.max_peaks,
        min_snr: peakParams.min_snr,
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

  const applyPeakPreset = useCallback((preset: 'thin_film_si' | 'general') => {
    const nextPreset = preset === 'thin_film_si' ? THIN_FILM_SI_PEAK_PRESET : GENERAL_XRD_PEAK_PRESET
    setPeakParams(current => ({
      enabled: current.enabled,
      show_unmatched_peaks: current.show_unmatched_peaks,
      export_weak_peaks: current.export_weak_peaks,
      ...nextPreset,
      exclude_ranges: nextPreset.exclude_ranges.map(range => ({ ...range })),
    }))
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
          className={[
            'pressable absolute right-2 top-5 z-30 h-10 w-10 items-center justify-center rounded-full border border-[var(--pill-border)] bg-[color:color-mix(in_srgb,var(--panel-bg)_88%,transparent)] text-lg text-[var(--text-main)] shadow-[var(--card-shadow)]',
            sidebarCollapsed ? 'hidden xl:flex' : 'hidden',
          ].join(' ')}
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
              subtitle="Material Intelligence Engine"
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
                  if (p !== '自訂') setCustomWavelength(WAVELENGTH_MAP[p])
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
                xAxisCorrection={xAxisCorrection}
                onXAxisCorrectionChange={setXAxisCorrection}
                peakParams={peakParams}
                onPeakParamsChange={setPeakParams}
                onApplyPeakPreset={applyPeakPreset}
                scherrerParams={scherrerParams}
                onScherrerParamsChange={setScherrerParams}
              />
            </div>
          </div>
        </div>
      </aside>

      <div className="workspace-main-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-8 sm:px-8 xl:px-10 xl:py-10">
        <div className="mx-auto w-full max-w-[1500px]">
          <ModuleTopBar
            title={moduleContent.title}
            subtitle={moduleContent.subtitle}
            description={moduleContent.description}
            chips={[
              { label: `資料量 ${rawFiles.length}` },
              { label: `平均 ${params.average ? '開啟' : '關閉'}` },
              { label: `參考峰 ${refPeaks.length}` },
            ]}
          />

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

          <InfoCardGrid
            items={[
              { label: '資料集', value: rawFiles.length > 0 ? `${rawFiles.length} 個` : '未載入' },
              { label: xMode === 'dspacing' ? 'd 範圍' : '2θ 範圍', value: result ? xRangeLabel : '未建立' },
              { label: '參考峰', value: `${refPeaks.length}` },
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
            <EmptyWorkspaceState
              module="xrd"
              title={moduleContent.uploadTitle}
              description="左側已提供內插、多檔平均、背景扣除、平滑、峰值偵測、參考卡比對與結晶尺寸分析。上傳之後會在這裡顯示 XRD 圖譜與分析結果。"
              formats={moduleContent.formats}
            />
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
                    config={withPlotFullscreen({ scrollZoom: false })}
                    style={{ width: '100%', height: 360 }}
                    onLegendClick={makeLegendClick(setRawHidden) as never}
                    onLegendDoubleClick={() => false}
                    useResizeHandler
                  />
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(rawStageDatasets, xMode === 'dspacing' ? '晶面間距 d（Å）' : '2θ（degree）', '原始強度'), 'xrd_raw_stage.csv', 'text/csv')}
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
                  <DeferredRender minHeight={360}>
                    <Plot
                      data={applyHidden(overlayChartTraces, overlayHidden)}
                      layout={chartLayout({ xMode, wavelength })}
                      config={withPlotFullscreen({ scrollZoom: false })}
                      style={{ width: '100%', height: 360 }}
                      onLegendClick={makeLegendClick(setOverlayHidden) as never}
                      onLegendDoubleClick={() => false}
                      useResizeHandler
                    />
                  </DeferredRender>
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(overlayStageDatasets, xMode === 'dspacing' ? '晶面間距 d（Å）' : '2θ（degree）', '處理後強度'), 'xrd_overlay_stage.csv', 'text/csv')}
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
                  <DeferredRender minHeight={360}>
                    <Plot
                      data={applyHidden(preprocessChartTraces, preprocessHidden)}
                      layout={chartLayout({ xMode, wavelength })}
                      config={withPlotFullscreen({ scrollZoom: false })}
                      style={{ width: '100%', height: 360 }}
                      onLegendClick={makeLegendClick(setPreprocessHidden) as never}
                      onLegendDoubleClick={() => false}
                      useResizeHandler
                    />
                  </DeferredRender>
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(preprocessStageDatasets, xMode === 'dspacing' ? '晶面間距 d（Å）' : '2θ（degree）', '強度'), 'xrd_preprocess_stage.csv', 'text/csv')}
                      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                    >
                      下載此步驟 CSV
                    </button>
                  </div>
                </div>
              )}

              {!isOverlayView && logChartTraces.length > 0 && (
                <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <ChartToolbar
                    title="3. 對數弱峰檢視"
                    colorValue={chartLineColors.log}
                    onColorChange={value => setChartLineColors(current => ({ ...current, log: value }))}
                    actions={onOpenPlotPopup ? (
                      <button type="button" className="chart-popup-button" onClick={openWeakPeakChartPopup}>
                        彈出圖表
                      </button>
                    ) : undefined}
                  />
                  <p className="mb-3 text-xs text-[var(--text-soft)]">
                    此顯示模式只改變圖表縮放方式，方便觀察弱峰與寬尾巴。不影響尋峰、Scherrer 或參考峰匹配的計算基礎。
                  </p>
                  <DeferredRender minHeight={360}>
                    {renderWeakPeakChart(360)}
                  </DeferredRender>
                </div>
              )}

              {!isOverlayView && finalChartTraces.length > 0 && (
                <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <ChartToolbar
                    title="4. 最終處理光譜"
                    colorValue={chartLineColors.final}
                    onColorChange={value => setChartLineColors(current => ({ ...current, final: value }))}
                    actions={onOpenPlotPopup ? (
                      <button type="button" className="chart-popup-button" onClick={openFinalChartPopup}>
                        彈出圖表
                      </button>
                    ) : undefined}
                  />
                  <p className="mb-3 text-xs text-[var(--text-soft)]">把最終處理結果、參考峰與偵測到的峰位放在同一張圖上，顯示方式對齊 XPS 的最終圖卡。</p>
                  <DeferredRender minHeight={380}>
                    {renderFinalChart(380)}
                  </DeferredRender>
                  {selectedRefPeak && (
                    <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-slate-950/35 px-4 py-3 text-sm text-slate-200">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="font-semibold text-white">參考峰資訊</p>
                        <button
                          type="button"
                          onClick={() => setSelectedRefPeak(null)}
                          className="rounded-full border border-white/10 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          關閉
                        </button>
                      </div>
                      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                        <p>物質：{selectedRefPeak.material}</p>
                        <p>相：{selectedRefPeak.phase}</p>
                        <p>晶面 HKL：{selectedRefPeak.hkl || '-'}</p>
                        <p>2θ：{formatNumber(selectedRefPeak.two_theta, 4)}°</p>
                        <p>d-spacing：{formatNumber(selectedRefPeak.d_spacing, 4)} Å</p>
                        <p>相對強度：{formatNumber(selectedRefPeak.rel_i, 1)}%</p>
                        <p>容許誤差：{formatNumber(selectedRefPeak.tolerance, 4)}°</p>
                        <p className="sm:col-span-2">來源：{selectedRefPeak.source}</p>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(finalStageDatasets, xMode === 'dspacing' ? '晶面間距 d（Å）' : '2θ（degree）', '處理後強度'), 'xrd_final_stage.csv', 'text/csv')}
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
                  <div className="mb-4 flex justify-start">
                    <button
                      type="button"
                      disabled={detectedPeaks.length === 0}
                      onClick={handleExportWeakPeaksTxt}
                      className={[
                        'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                        detectedPeaks.length === 0
                          ? 'cursor-not-allowed border-white/5 bg-white/5 text-slate-500'
                          : 'border-white/10 bg-white/5 text-slate-100 hover:border-cyan-300/40 hover:text-cyan-100',
                      ].join(' ')}
                    >
                      匯出弱峰 .txt
                    </button>
                  </div>

                  {detectedPeaks.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      目前條件下沒有找到可用峰位。可以提高偵測靈敏度、放寬排除區間，或重新調整峰寬範圍後再試一次。
                    </div>
                  ) : (
                    <DeferredRender minHeight={320}>
                      <div className="mb-4 overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">2θ（degree）</th>
                            <th className="px-3 py-3 font-medium">強度</th>
                            <th className="px-3 py-3 font-medium">半高寬</th>
                            <th className="px-3 py-3 font-medium">訊雜比</th>
                            <th className="px-3 py-3 font-medium">峰突出度</th>
                            <th className="px-3 py-3 font-medium">相位</th>
                            <th className="px-3 py-3 font-medium">晶面指數</th>
                            <th className="px-3 py-3 font-medium">接近參考峰</th>
                            <th className="px-3 py-3 font-medium">候選數</th>
                            <th className="px-3 py-3 font-medium">參考 2θ</th>
                            <th className="px-3 py-3 font-medium">Δ2θ</th>
                            <th className="px-3 py-3 font-medium">信心等級</th>
                            <th className="px-3 py-3 font-medium">備註</th>
                          </tr>
                        </thead>
                        <tbody>
                          {finalPeakRows.map((peak, idx) => (
                            <tr key={`final-${peak.two_theta}-${idx}`} className="border-b border-white/5 text-slate-200 last:border-b-0">
                              <td className="px-3 py-3 font-medium">{peak.two_theta.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.intensity.toFixed(2)}</td>
                              <td className="px-3 py-3">{peak.fwhm_deg.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.snr.toFixed(2)}</td>
                              <td className="px-3 py-3">{peak.prominence.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.phase}</td>
                              <td className="px-3 py-3">{peak.hkl || '-'}</td>
                              <td className="px-3 py-3">
                                <span
                                  className={[
                                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                                    peak.near_reference
                                      ? 'border border-emerald-300/20 bg-emerald-400/10 text-emerald-200'
                                      : 'border border-slate-300/10 bg-slate-400/10 text-slate-300',
                                  ].join(' ')}
                                >
                                  {peak.near_reference ? '是' : '否'}
                                </span>
                              </td>
                              <td className="px-3 py-3">{peak.candidate_count}</td>
                              <td className="px-3 py-3">{peak.reference_2theta == null ? '無' : peak.reference_2theta.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.delta_2theta == null ? '無' : peak.delta_2theta.toFixed(4)}</td>
                              <td className="px-3 py-3">{confidenceLabel(peak.confidence)}</td>
                              <td className="px-3 py-3">{peak.note || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </DeferredRender>
                  )}
                </div>
              )}

              {scherrerParams.enabled && peakParams.enabled && (
                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Scherrer 晶粒尺寸</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        使用目前偵測峰的半高寬與 Scherrer 公式估算晶粒尺寸。結果對展寬假設非常敏感，僅供快速篩選。
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
                    <DeferredRender minHeight={280}>
                      <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">序號</th>
                            <th className="px-3 py-3 font-medium">2θ（degree）</th>
                            <th className="px-3 py-3 font-medium">半高寬（degree）</th>
                            <th className="px-3 py-3 font-medium">晶粒尺寸（nm）</th>
                            <th className="px-3 py-3 font-medium">晶粒尺寸（Å）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scherrerRows.map((peak, idx) => (
                            <tr key={`scherrer-${peak.two_theta}-${idx}`} className="border-b border-white/5 text-slate-200 last:border-b-0">
                              <td className="px-3 py-3 text-slate-500">{idx + 1}</td>
                              <td className="px-3 py-3 font-medium">{peak.two_theta.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.fwhm_deg.toFixed(4)}</td>
                              <td className="px-3 py-3">
                                {peak.crystallite_nm == null ? '無' : peak.crystallite_nm.toFixed(3)}
                              </td>
                              <td className="px-3 py-3">
                                {peak.crystallite_nm == null ? '無' : (peak.crystallite_nm * 10).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </DeferredRender>
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
                    <DeferredRender minHeight={320}>
                      <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">相位</th>
                            <th className="px-3 py-3 font-medium">晶面指數</th>
                            <th className="px-3 py-3 font-medium">參考 2θ</th>
                            <th className="px-3 py-3 font-medium">參考 d</th>
                            <th className="px-3 py-3 font-medium">參考相對強度 (%)</th>
                            <th className="px-3 py-3 font-medium">觀測 2θ</th>
                            <th className="px-3 py-3 font-medium">觀測 d</th>
                            <th className="px-3 py-3 font-medium">觀測強度</th>
                            <th className="px-3 py-3 font-medium">Δ2θ</th>
                            <th className="px-3 py-3 font-medium">信心等級</th>
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
                                {row.observed_two_theta == null ? '無' : row.observed_two_theta.toFixed(4)}
                              </td>
                              <td className="px-3 py-3">
                                {row.observed_d_spacing == null ? '無' : row.observed_d_spacing.toFixed(4)}
                              </td>
                              <td className="px-3 py-3">
                                {row.observed_intensity == null ? '無' : row.observed_intensity.toFixed(2)}
                              </td>
                              <td className="px-3 py-3">
                                {row.delta_two_theta == null ? '無' : row.delta_two_theta.toFixed(4)}
                              </td>
                              <td className="px-3 py-3">{confidenceLabel(row.confidence)}</td>
                              <td className="px-3 py-3">
                                <span
                                  className={[
                                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                                    row.matched
                                      ? 'border border-emerald-300/20 bg-emerald-400/10 text-emerald-200'
                                      : 'border border-rose-300/20 bg-rose-400/10 text-rose-200',
                                  ].join(' ')}
                                >
                                  {row.matched ? '匹配' : '不匹配'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </DeferredRender>
                  )}
                </div>
              )}

              <DeferredRender minHeight={260}>
                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                <div className="mb-4">
                  <p className="text-sm font-semibold text-white">匯出</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    下載處理後光譜、峰位表、匹配表，以及目前 XRD 流程的 JSON 紀錄。
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
                                ['2θ（degree）', '晶面間距 d（Å）', '強度', '相對強度（%）', '半高寬（degree）', '晶粒尺寸（nm）', '晶粒尺寸（Å）'],
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
                                ['2θ（degree）', '強度', '半高寬', '訊雜比', '峰突出度', '相位', '晶面指數', '接近參考峰', '候選數', '參考 2θ', 'Δ2θ', '信心等級', '備註'],
                                finalPeakRows
                                  .filter(row => peakParams.export_weak_peaks || row.confidence !== 'low')
                                  .map(row => [
                                  row.two_theta.toFixed(4),
                                  row.intensity.toFixed(2),
                                  row.fwhm_deg.toFixed(4),
                                  row.snr.toFixed(2),
                                  row.prominence.toFixed(4),
                                  row.phase,
                                  row.hkl,
                                  row.near_reference ? '是' : '否',
                                  row.candidate_count,
                                  row.reference_2theta == null ? '' : row.reference_2theta.toFixed(4),
                                  row.delta_2theta == null ? '' : row.delta_2theta.toFixed(4),
                                  confidenceLabel(row.confidence),
                                  localizePeakNote(row.note),
                                ]),
                              ),
                              'xrd_final_peaks.csv',
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載自動尋峰 CSV
                        </button>
                      )}
                      {peakParams.enabled && finalPeakRows.length > 0 && (
                        <button
                          onClick={() => {
                            const headers = ['2θ（degree）', '強度', '半高寬', '訊雜比', '峰突出度', '相位', '晶面指數', '接近參考峰', '候選數', '參考 2θ', 'Δ2θ', '信心等級', '備註']
                            const rows = finalPeakRows
                              .filter(row => peakParams.export_weak_peaks || row.confidence !== 'low')
                              .map(row => [
                                row.two_theta.toFixed(4),
                                row.intensity.toFixed(2),
                                row.fwhm_deg.toFixed(4),
                                row.snr.toFixed(2),
                                row.prominence.toFixed(4),
                                row.phase,
                                row.hkl,
                                row.near_reference ? '是' : '否',
                                row.candidate_count,
                                row.reference_2theta == null ? '' : row.reference_2theta.toFixed(4),
                                row.delta_2theta == null ? '' : row.delta_2theta.toFixed(4),
                                confidenceLabel(row.confidence),
                                localizePeakNote(row.note),
                              ])
                            downloadFile(toExcelHtml(headers, rows), 'xrd_final_peaks.xls', 'application/vnd.ms-excel')
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載最終峰表 Excel
                        </button>
                      )}
                      {filteredRefPeaks.length > 0 && (
                        <button
                          onClick={() => {
                            downloadFile(
                              toCsv(
                                ['相位', '晶面指數', '參考 2θ', '相對強度', '來源', '容差'],
                                filteredRefPeaks.map(row => [
                                  row.phase || row.material,
                                  row.hkl,
                                  row.two_theta.toFixed(4),
                                  row.rel_i.toFixed(1),
                                  row.source,
                                  row.tolerance.toFixed(3),
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
                                ['相位', '晶面指數', '參考 2θ（degree）', '參考 d（Å）', '參考相對強度（%）', '觀測 2θ（degree）', '觀測 d（Å）', '觀測強度', 'Δ2θ（degree）', '是否匹配', '信心等級', '候選峰', '備註'],
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
                                  row.matched ? '是' : '否',
                                  confidenceLabel(row.confidence),
                                  row.candidates,
                                  localizePeakNote(row.note),
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
                        會保存目前波長、處理參數、log 設定、尋峰結果、匹配結果與 Scherrer 結果摘要。
                      </p>
                      <span className="text-xs text-slate-500">
                        {result.datasets.length} 個資料集
                        {result.average ? ' (含平均)' : ''}
                      </span>
                    </div>
                  </div>
                </div>
                </div>
              </DeferredRender>
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
