import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import Plot from 'react-plotly.js'
import { type AnalysisModuleId } from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import {
  applyHidden,
  ChartToolbar,
  DEFAULT_SERIES_PALETTE_KEYS,
  DatasetSelectionModal,
  EmptyWorkspaceState,
  GlassSection,
  InfoCardGrid,
  LINE_COLOR_OPTIONS,
  LINE_COLOR_PALETTES,
  makeLegendClick,
  MODULE_CONTENT,
  ModuleTopBar,
  ProcessingWorkspaceHeader,
  StickySidebarHeader,
  ThemeSelect,
  TogglePill,
} from '../components/WorkspaceUi'
import { withPlotFullscreen } from '../components/plotConfig'
import {
  detectPeaks,
  fetchPeakLibrary,
  fetchReferencePeaks,
  fetchReferences,
  fitSpectrum,
  parseFiles,
  processData,
} from '../api/raman'
import type {
  DetectedPeak,
  FitParams,
  FitPeakCandidate,
  FitResult,
  ParsedFile,
  PeakDetectionParams,
  ProcessParams,
  ProcessResult,
  ProcessedDataset,
  RamanProfile,
  RefPeak,
  SegmentWeight,
} from '../types/raman'

const SIDEBAR_MIN_WIDTH = 320
const SIDEBAR_MAX_WIDTH = 560
const SIDEBAR_DEFAULT_WIDTH = 368
const SIDEBAR_COLLAPSED_PEEK = 28

const DEFAULT_PARAMS: ProcessParams = {
  despike_enabled: false,
  despike_method: 'median',
  despike_threshold: 8,
  despike_window: 7,
  despike_passes: 1,
  interpolate: false,
  n_points: 1000,
  average: false,
  bg_enabled: false,
  bg_method: 'none',
  bg_x_start: null,
  bg_x_end: null,
  bg_poly_deg: 3,
  bg_baseline_lambda: 1e5,
  bg_baseline_p: 0.01,
  bg_baseline_iter: 20,
  bg_anchor_x: [],
  bg_anchor_y: [],
  smooth_method: 'none',
  smooth_window: 11,
  smooth_poly: 3,
  norm_method: 'none',
  norm_x_start: null,
  norm_x_end: null,
}

const DEFAULT_PEAK_PARAMS: PeakDetectionParams = {
  enabled: false,
  prominence: 0.05,
  height_ratio: 0,
  min_distance: 8,
  max_peaks: 25,
}

const DEFAULT_FIT_PARAMS: FitParams = {
  profile: 'voigt',
  maxfev: 20000,
  fit_lo: null,
  fit_hi: null,
  robust_loss: 'linear',
  segment_weights: [],
  residual_target_enabled: false,
  residual_target: 0.05,
  residual_target_rounds: 4,
}

const BACKGROUND_METHOD_HELP: Record<ProcessParams['bg_method'], string> = {
  none: '不進行扣背，保留原始基線。',
  constant: '以固定常數當背景，適合整條基線大致平移的情況。',
  linear: '用起點與終點連成直線當背景，適合緩慢傾斜的基線。',
  shirley: '背景大小與高結合能端累積訊號相關，常用於具階梯或尾巴的光譜背景。',
  polynomial: '以多項式擬合彎曲基線，適合緩慢但非線性的背景漂移。',
  asls: 'AsLS 以平滑懲罰和不對稱權重估計基線，盡量讓背景貼在峰下方。',
  airpls: 'airPLS 會反覆調整權重，自動把峰當成異常值壓低，對複雜基線通常更穩健。',
  rubber_band: '把光譜想成由下方橡皮筋撐住，適合寬而平滑的下包絡背景。',
  manual_anchor: '由你指定 anchor points，再用這些點建出背景線，適合已知基線位置的情況。',
}

type ReviewRule = 'area_zero' | 'low_area' | 'large_delta' | 'boundary' | 'broad' | 'low_confidence'

const REVIEW_RULE_OPTIONS: { id: ReviewRule; label: string }[] = [
  { id: 'area_zero', label: 'Area = 0' },
  { id: 'low_area', label: 'Area% 過低' },
  { id: 'large_delta', label: '|Δ| 過大' },
  { id: 'boundary', label: '中心撞邊界' },
  { id: 'broad', label: 'FWHM 過寬' },
  { id: 'low_confidence', label: 'Low confidence' },
]

const PROFILE_OPTIONS: { value: RamanProfile; label: string }[] = [
  { value: 'voigt', label: 'Voigt' },
  { value: 'pseudo_voigt', label: 'pseudo-Voigt' },
  { value: 'super_gaussian', label: 'flat-top / super-Gaussian (model component)' },
  { value: 'split_pseudo_voigt', label: 'asymmetric / split pseudo-Voigt' },
  { value: 'gaussian', label: 'Gaussian' },
  { value: 'lorentzian', label: 'Lorentzian' },
]

const BACKGROUND_METHOD_OPTIONS: { value: ProcessParams['bg_method']; label: string }[] = [
  { value: 'none', label: '不扣背景' },
  { value: 'constant', label: 'Constant' },
  { value: 'linear', label: 'Linear' },
  { value: 'shirley', label: 'Shirley' },
  { value: 'polynomial', label: 'Polynomial' },
  { value: 'asls', label: 'AsLS' },
  { value: 'airpls', label: 'airPLS' },
  { value: 'rubber_band', label: 'Rubber band' },
  { value: 'manual_anchor', label: 'Manual anchor baseline' },
]

const SMOOTH_METHOD_OPTIONS: { value: ProcessParams['smooth_method']; label: string }[] = [
  { value: 'none', label: '不平滑' },
  { value: 'moving_average', label: 'Moving Average' },
  { value: 'savitzky_golay', label: 'Savitzky-Golay' },
]

const NORMALIZATION_OPTIONS: { value: ProcessParams['norm_method']; label: string }[] = [
  { value: 'none', label: '不歸一化' },
  { value: 'min_max', label: 'Min-Max' },
  { value: 'max', label: 'Divide by max' },
  { value: 'area', label: 'Divide by area' },
]

const ROBUST_LOSS_OPTIONS: { value: FitParams['robust_loss']; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'soft_l1', label: 'soft_l1' },
  { value: 'huber', label: 'Huber' },
  { value: 'cauchy', label: 'Cauchy' },
  { value: 'arctan', label: 'Arctan' },
]

const BATCH_NORMALIZE_OPTIONS = [
  { value: 'si_520', label: 'Normalize to Si 520' },
  { value: 'total_area', label: 'Normalize to total area' },
  { value: 'none', label: 'No normalize' },
]

const OXIDATION_INFERENCE_OPTIONS: { value: FitPeakCandidate['oxidation_state_inference']; label: string }[] = [
  { value: 'Direct', label: 'Direct' },
  { value: 'Inferred', label: 'Inferred' },
  { value: 'Not applicable', label: 'Not applicable' },
]

function createPeakCandidateId() {
  return `RPK${Math.random().toString(36).slice(2, 9)}`
}

function roleFromStrength(strength: number) {
  if (strength >= 90) return '主峰'
  if (strength >= 70) return '強峰'
  if (strength <= 25) return '弱峰'
  return '次峰'
}

function refPeakToCandidate(peak: RefPeak, defaultFwhm: number): FitPeakCandidate {
  const label = peak.label || `${peak.position_cm.toFixed(1)} cm⁻¹`
  const role = roleFromStrength(peak.strength)
  const fwhm = Math.min(Math.max(defaultFwhm, peak.fwhm_min), peak.fwhm_max)
  return {
    peak_id: createPeakCandidateId(),
    enabled: true,
    material: peak.material,
    phase: peak.phase || peak.material,
    phase_group: peak.phase_group || `${peak.material} group`,
    label,
    display_name: `${peak.material} ${label}`.trim(),
    position_cm: peak.position_cm,
    fwhm_cm: fwhm,
    tolerance_cm: peak.tolerance_cm,
    fwhm_min: peak.fwhm_min,
    fwhm_max: peak.fwhm_max,
    profile: peak.profile || '',
    allowed_profiles: peak.allowed_profiles || [],
    peak_type: peak.peak_type || '',
    anchor_peak: peak.anchor_peak || false,
    can_be_quantified: peak.can_be_quantified ?? true,
    species: peak.species || '',
    theoretical_center: peak.theoretical_center ?? peak.position_cm,
    related_technique: peak.related_technique || 'Raman',
    reference: peak.reference || '',
    oxidation_state: peak.oxidation_state || 'N/A',
    oxidation_state_inference: peak.oxidation_state_inference || 'Not applicable',
    role,
    mode_label: peak.mode || peak.label || '',
    note: peak.note || '',
    ref_position_cm: peak.position_cm,
    lock_center: false,
    lock_fwhm: false,
    lock_area: false,
    lock_profile: false,
  }
}

function normalizeCandidate(candidate: Partial<FitPeakCandidate>): FitPeakCandidate {
  const position = Number(candidate.position_cm ?? candidate.ref_position_cm ?? 0)
  const material = candidate.material ?? candidate.phase ?? ''
  const label = candidate.label || candidate.display_name || `${position.toFixed(1)} cm⁻¹`
  const tolerance = Number(candidate.tolerance_cm ?? 10)
  const fwhmMin = Number(candidate.fwhm_min ?? 0.5)
  const fwhmMax = Number(candidate.fwhm_max ?? Math.max(Number(candidate.fwhm_cm ?? 8) * 6, fwhmMin + 0.1))
  return {
    peak_id: candidate.peak_id || createPeakCandidateId(),
    enabled: candidate.enabled ?? true,
    material,
    phase: candidate.phase || material,
    phase_group: candidate.phase_group || (material ? `${material} group` : ''),
    label,
    display_name: candidate.display_name || label,
    position_cm: position,
    fwhm_cm: Number(candidate.fwhm_cm ?? Math.min(Math.max(8, fwhmMin), fwhmMax)),
    tolerance_cm: tolerance,
    fwhm_min: fwhmMin,
    fwhm_max: fwhmMax,
    profile: candidate.profile || '',
    allowed_profiles: candidate.allowed_profiles || [],
    peak_type: candidate.peak_type || '',
    anchor_peak: candidate.anchor_peak ?? false,
    can_be_quantified: candidate.can_be_quantified ?? true,
    species: candidate.species || '',
    theoretical_center: candidate.theoretical_center ?? candidate.ref_position_cm ?? position,
    related_technique: candidate.related_technique || 'Raman',
    reference: candidate.reference || '',
    oxidation_state: candidate.oxidation_state || 'N/A',
    oxidation_state_inference: candidate.oxidation_state_inference || 'Not applicable',
    role: candidate.role || '',
    mode_label: candidate.mode_label || '',
    note: candidate.note || '',
    ref_position_cm: candidate.ref_position_cm ?? candidate.theoretical_center ?? position,
    lock_center: candidate.lock_center ?? false,
    lock_fwhm: candidate.lock_fwhm ?? false,
    lock_area: candidate.lock_area ?? false,
    lock_profile: candidate.lock_profile ?? false,
  }
}

function fitChartTraces(dataset: ProcessedDataset, fitResult: FitResult): Plotly.Data[] {
  const traces: Plotly.Data[] = [
    {
      x: dataset.x,
      y: dataset.y_processed,
      type: 'scatter',
      mode: 'lines',
      name: '實驗曲線',
      line: { color: '#e5e7eb', width: 1.35, dash: 'dot' },
    },
  ]

  fitResult.y_individual.forEach((yLine, idx) => {
    const row = fitResult.peaks[idx]
    traces.push({
      x: dataset.x,
      y: yLine,
      type: 'scatter',
      mode: 'lines',
      name: row ? fitPeakLabel(row) : `Peak ${idx + 1}`,
      line: { width: 1.75, dash: 'dash' },
      opacity: 0.95,
    })
  })

  traces.push(
    {
      x: dataset.x,
      y: fitResult.y_fit,
      type: 'scatter',
      mode: 'lines',
      name: '擬合包絡',
      line: { color: '#f8c65a', width: 2.7 },
    },
    {
      x: dataset.x,
      y: fitResult.residuals,
      type: 'scatter',
      mode: 'lines',
      name: '殘差',
      yaxis: 'y2',
      line: { color: '#8b949e', width: 1.05 },
    },
  )

  return traces
}

function fitPeakLabel(row: FitResult['peaks'][number]) {
  return `${row.Peak_Name} ${row.Center_cm.toFixed(1)} cm⁻¹`
}

function fitChartLayout(): Partial<Plotly.Layout> {
  const base = chartLayout()
  const legendColor =
    base.font && typeof base.font === 'object' && 'color' in base.font
      ? base.font.color
      : '#d9e4f0'
  const legendFamily =
    base.font && typeof base.font === 'object' && 'family' in base.font
      ? base.font.family
      : 'Times New Roman, Noto Sans TC, serif'
  return {
    ...base,
    margin: { l: 68, r: 76, t: 126, b: 70 },
    legend: {
      orientation: 'h',
      x: 0.5,
      xanchor: 'center',
      y: 1.18,
      yanchor: 'bottom',
      bgcolor: 'rgba(0,0,0,0)',
      borderwidth: 0,
      font: { color: legendColor, family: legendFamily, size: 12 },
      traceorder: 'normal',
    },
    yaxis2: {
      title: { text: '殘差' },
      overlaying: 'y',
      side: 'right',
      showgrid: false,
      zeroline: true,
      zerolinecolor: 'rgba(148, 163, 184, 0.35)',
      color: base.yaxis && 'color' in base.yaxis ? base.yaxis.color : '#d9e4f0',
    },
  }
}

function getFitQualityFlags(
  row: FitResult['peaks'][number],
  minAreaPct: number,
  maxAbsDelta: number,
) {
  const flags: string[] = [...(row.Quality_Flags ?? [])]
  if (Math.abs(row.Area) <= 1e-9) flags.push('Area=0')
  else if (row.Area_pct < minAreaPct) flags.push(`Area%<${minAreaPct}`)
  if (row.Delta_cm != null && Math.abs(row.Delta_cm) > maxAbsDelta) flags.push(`|Δ|>${maxAbsDelta}`)
  if (row.Boundary_Peak) flags.push('boundary peak')
  if (row.Broad_Background_Like) flags.push('broad/background-like peak')
  return Array.from(new Set(flags))
}

function peakStatusLabel(row: FitResult['peaks'][number] | undefined, maxAbsDelta: number) {
  if (!row) return '待擬合'
  const flags = row.Quality_Flags ?? []
  if (flags.includes('boundary peak')) return 'Boundary'
  if (flags.includes('broad/background-like peak')) return 'Broad'
  if (row.Delta_cm != null && Math.abs(row.Delta_cm) > maxAbsDelta) return `|Δ|>${maxAbsDelta}`
  if (row.Confidence === 'Low') return 'Low confidence'
  return 'OK'
}

function isSuggestedEdit(row: FitResult['peaks'][number] | undefined, maxAbsDelta: number) {
  if (!row) return false
  return peakStatusLabel(row, maxAbsDelta) !== 'OK'
}

function isAnchorCandidate(candidate: FitPeakCandidate) {
  const center = candidate.ref_position_cm ?? candidate.theoretical_center ?? candidate.position_cm
  const phase = `${candidate.phase} ${candidate.material}`.toLowerCase()
  return Boolean(candidate.anchor_peak) ||
    (phase.includes('si') && Math.abs(center - 520.7) <= 3) ||
    (phase.includes('ga₂o₃') && (Math.abs(center - 416) <= 3 || Math.abs(center - 651) <= 3))
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function csvEscape(value: unknown) {
  if (value == null) return ''
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function toCsv(headers: string[], rows: Array<Array<unknown>>) {
  return [headers.join(','), ...rows.map(row => row.map(csvEscape).join(','))].join('\n')
}

function buildStageCsv(datasets: { name: string; x: number[]; y: number[] }[], xLabel: string, yLabel: string) {
  return toCsv(
    ['dataset', xLabel, yLabel],
    datasets.flatMap(dataset => dataset.x.map((x, index) => [dataset.name, x, dataset.y[index] ?? null])),
  )
}

function parseAnchorText(text: string): { x: number[]; y: number[] } {
  const x: number[] = []
  const y: number[] = []
  text
    .split(/\n|;/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const [xRaw, yRaw] = line.split(/,|\s+/)
      const xv = Number(xRaw)
      const yv = Number(yRaw)
      if (Number.isFinite(xv) && Number.isFinite(yv)) {
        x.push(xv)
        y.push(yv)
      }
    })
  return { x, y }
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
  const chartFont = cssVars?.getPropertyValue('--body-font').trim() || 'Times New Roman, Noto Sans TC, serif'

  return {
    xaxis: {
      title: { text: 'Raman Shift (cm⁻¹)' },
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
      font: { color: chartText, family: chartFont },
    },
    margin: { l: 60, r: 20, t: 28, b: 58 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: chartBg,
    font: { color: chartText, family: chartFont },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: chartHoverBg,
      bordercolor: chartHoverBorder,
      font: { color: chartText, family: chartFont },
    },
    autosize: true,
  }
}

function buildTraces(dataset: ProcessedDataset | null, params: ProcessParams, refPeaks: RefPeak[]): Plotly.Data[] {
  if (!dataset) return []
  const normalizedView = params.norm_method !== 'none'
  const comparisonTraceVisibility: boolean | 'legendonly' = normalizedView ? 'legendonly' : true

  const traces: Plotly.Data[] = [
    {
      x: dataset.x,
      y: dataset.y_raw,
      type: 'scatter',
      mode: 'lines',
      name: '原始',
      line: { color: '#94a3b8', width: 1.5 },
      visible: comparisonTraceVisibility,
    },
  ]

  const despikedAvailable =
    params.despike_enabled &&
    dataset.y_despiked != null &&
    dataset.y_despiked.some((value, idx) => Math.abs(value - dataset.y_raw[idx]) > 1e-9)

  if (despikedAvailable) {
    traces.push({
      x: dataset.x,
      y: dataset.y_despiked ?? [],
      type: 'scatter',
      mode: 'lines',
      name: '去尖峰後',
      line: { color: '#f97316', width: 1.7 },
      visible: comparisonTraceVisibility,
    })
  }

  if (params.bg_enabled && dataset.y_background) {
    traces.push({
      x: dataset.x,
      y: dataset.y_background,
      type: 'scatter',
      mode: 'lines',
      name: '背景基準線',
      line: { color: '#eab308', width: 1.4, dash: 'dot' },
      visible: comparisonTraceVisibility,
    })
  }

  traces.push({
    x: dataset.x,
    y: dataset.y_processed,
    type: 'scatter',
    mode: 'lines',
    name: '處理後',
    line: { color: '#38bdf8', width: 2.2 },
  })

  if (refPeaks.length > 0) {
    const yValues = dataset.y_processed
    const yMin = Math.min(...yValues)
    const yMax = Math.max(...yValues)
    const span = Math.max(yMax - yMin, 1)
    const base = yMin - span * 0.12
    const xs: Array<number | null> = []
    const ys: Array<number | null> = []

    refPeaks.forEach(peak => {
      const height = span * 0.18 * (peak.strength / 100)
      xs.push(peak.position_cm, peak.position_cm, null)
      ys.push(base, base + height, null)
    })

    traces.push({
      x: xs,
      y: ys,
      type: 'scatter',
      mode: 'lines',
      name: '參考峰',
      line: { color: '#22c55e', width: 1.4 },
      hoverinfo: 'skip',
    })
  }

  return traces
}

function buildOverlayTraces(datasets: ProcessedDataset[]): Plotly.Data[] {
  const palette = ['#38bdf8', '#f97316', '#a855f7', '#22c55e', '#ef4444', '#14b8a6']
  return datasets.map((dataset, index) => ({
    x: dataset.x,
    y: dataset.y_processed,
    type: 'scatter',
    mode: 'lines',
    name: dataset.name,
    line: { color: palette[index % palette.length], width: 2.1 },
  }))
}

function SidebarCard({
  step,
  title,
  hint,
  children,
  defaultOpen = true,
  infoContent,
}: {
  step: number
  title: string
  hint: string
  children: ReactNode
  defaultOpen?: boolean
  infoContent?: ReactNode
}) {
  return (
    <GlassSection step={step} title={title} hint={hint} defaultOpen={defaultOpen} infoContent={infoContent}>
      {children}
    </GlassSection>
  )
}

export default function Raman({
  onModuleSelect,
}: {
  onModuleSelect?: (module: AnalysisModuleId) => void
}) {
  const moduleContent = MODULE_CONTENT.raman
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('nigiro-raman-sidebar-width'))
    if (Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH) {
      return saved
    }
    return SIDEBAR_DEFAULT_WIDTH
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem('nigiro-raman-sidebar-collapsed') === 'true')
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const [rawFiles, setRawFiles] = useState<ParsedFile[]>([])
  const [params, setParams] = useState<ProcessParams>(DEFAULT_PARAMS)
  const [peakParams, setPeakParams] = useState<PeakDetectionParams>(DEFAULT_PEAK_PARAMS)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [selectedSeries, setSelectedSeries] = useState<string>('')
  const [processingViewMode, setProcessingViewMode] = useState<'single' | 'overlay'>('single')
  const [overlaySelection, setOverlaySelection] = useState<string[]>([])
  const [overlayDraftSelection, setOverlayDraftSelection] = useState<string[]>([])
  const [overlaySelectorOpen, setOverlaySelectorOpen] = useState(false)
  const [refMaterials, setRefMaterials] = useState<string[]>([])
  const [selectedRefs, setSelectedRefs] = useState<string[]>([])
  const [refPeaks, setRefPeaks] = useState<RefPeak[]>([])
  const [peakLibrary, setPeakLibrary] = useState<RefPeak[]>([])
  const [detectedPeaks, setDetectedPeaks] = useState<DetectedPeak[]>([])
  const [fitParams, setFitParams] = useState<FitParams>(DEFAULT_FIT_PARAMS)
  const [fitCandidates, setFitCandidates] = useState<FitPeakCandidate[]>([])
  const [fitDefaultFwhm, setFitDefaultFwhm] = useState(8)
  const [manualAnchorText, setManualAnchorText] = useState('')
  const [manualPeakMaterial, setManualPeakMaterial] = useState('')
  const [manualPeakLabel, setManualPeakLabel] = useState('')
  const [manualPeakPosition, setManualPeakPosition] = useState<number | null>(null)
  const [manualPeakFwhm, setManualPeakFwhm] = useState(8)
  const [manualPeakTolerance, setManualPeakTolerance] = useState(10)
  const [manualPeakFwhmMin, setManualPeakFwhmMin] = useState(1)
  const [manualPeakFwhmMax, setManualPeakFwhmMax] = useState(80)
  const [manualPeakProfile, setManualPeakProfile] = useState<RamanProfile>('pseudo_voigt')
  const [segmentWeightLo, setSegmentWeightLo] = useState(480)
  const [segmentWeightHi, setSegmentWeightHi] = useState(570)
  const [segmentWeightValue, setSegmentWeightValue] = useState(0.35)
  const [batchResults, setBatchResults] = useState<FitResult[]>([])
  const [batchNormalize, setBatchNormalize] = useState<'none' | 'si_520' | 'total_area'>('si_520')
  const [editingPeakId, setEditingPeakId] = useState<string | null>(null)
  const [reviewMinAreaPct, setReviewMinAreaPct] = useState(1)
  const [reviewMaxAbsDelta, setReviewMaxAbsDelta] = useState(10)
  const [selectedReviewRules, setSelectedReviewRules] = useState<ReviewRule[]>(['area_zero', 'low_area', 'large_delta'])
  const [autoRefitMaxRounds, setAutoRefitMaxRounds] = useState(3)
  const [autoRefitStopWhenClean, setAutoRefitStopWhenClean] = useState(true)
  const [autoRefitSummary, setAutoRefitSummary] = useState<{
    rounds: number
    disabledPeakIds: string[]
    disabledPeakNames: string[]
    stopReason: string
  } | null>(null)
  const [autoDebugSummary, setAutoDebugSummary] = useState<{
    rounds: number
    actions: string[]
    beforeMaxResidual: number | null
    afterMaxResidual: number | null
    stopReason: string
  } | null>(null)
  const [fitResult, setFitResult] = useState<FitResult | null>(null)
  const [fitTargetName, setFitTargetName] = useState<string>('')
  const [isFitting, setIsFitting] = useState(false)
  const [siRefPos, setSiRefPos] = useState(520.7)
  const [siCoeff, setSiCoeff] = useState(-1.93)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawFileColors, setRawFileColors] = useState<string[]>([])
  const [chartLineColors, setChartLineColors] = useState({
    overlay: 'blue',
    preprocess: 'teal',
    background: 'orange',
    final: 'blue',
  })
  const [rawHidden, setRawHidden] = useState<string[]>([])
  const [overlayHidden, setOverlayHidden] = useState<string[]>([])
  const [preprocessHidden, setPreprocessHidden] = useState<string[]>([])
  const [backgroundHidden, setBackgroundHidden] = useState<string[]>([])
  const [finalHidden, setFinalHidden] = useState<string[]>([])

  useEffect(() => {
    localStorage.setItem('nigiro-raman-sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    localStorage.setItem('nigiro-raman-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    setRawFileColors(prev => rawFiles.map((_, index) => prev[index] ?? DEFAULT_SERIES_PALETTE_KEYS[index % DEFAULT_SERIES_PALETTE_KEYS.length]))
  }, [rawFiles])

  useEffect(() => {
    if (!sidebarResizing) return

    const handleMove = (event: MouseEvent) => {
      const nextWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, event.clientX))
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

  useEffect(() => {
    fetchReferences().then(setRefMaterials).catch(console.error)
    fetchPeakLibrary().then(setPeakLibrary).catch(console.error)
  }, [])

  useEffect(() => {
    if (rawFiles.length === 0) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    processData(rawFiles, params)
      .then(response => {
        if (!cancelled) setResult(response)
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
    if (selectedRefs.length === 0) {
      setRefPeaks([])
      return
    }
    fetchReferencePeaks(selectedRefs).then(setRefPeaks).catch(console.error)
  }, [selectedRefs])

  useEffect(() => {
    setFitResult(null)
    setAutoRefitSummary(null)
    setAutoDebugSummary(null)
    setBatchResults([])
  }, [selectedSeries, params, result, fitTargetName])

  useEffect(() => {
    const options = result?.datasets.map(dataset => dataset.name) ?? []
    if (!options.length) {
      setSelectedSeries('')
      return
    }
    if (!options.includes(selectedSeries)) {
      setSelectedSeries(options[0])
    }
  }, [result, selectedSeries])

  const activeDataset = useMemo(() => {
    if (!result) return null
    return result.datasets.find(dataset => dataset.name === selectedSeries) ?? result.datasets[0] ?? result.average ?? null
  }, [result, selectedSeries])
  const datasetTabItems = useMemo(
    () => (result?.datasets ?? []).map(dataset => ({ key: dataset.name, label: dataset.name })),
    [result],
  )
  const overlayDatasets = useMemo(
    () => result?.datasets.filter(dataset => overlaySelection.includes(dataset.name)) ?? [],
    [overlaySelection, result],
  )
  const isOverlayView = processingViewMode === 'overlay' && overlayDatasets.length >= 2
  const topTabs = useMemo(
    () => datasetTabItems.map(item => ({
      ...item,
      active: !isOverlayView && selectedSeries === item.key,
      onClick: () => {
        setProcessingViewMode('single')
        setSelectedSeries(item.key)
      },
    })),
    [datasetTabItems, isOverlayView, selectedSeries],
  )
  const overlayItems = useMemo(
    () => datasetTabItems.map(item => ({ key: item.key, label: item.label })),
    [datasetTabItems],
  )
  const ramanRangeLabel = activeDataset
    ? `${Math.min(...activeDataset.x).toFixed(1)} – ${Math.max(...activeDataset.x).toFixed(1)} cm⁻¹`
    : '—'
  const interpolationLabel = params.interpolate ? `${params.n_points} 點` : '未啟用'
  const rawChartSourceFiles = useMemo(
    () => (isOverlayView ? rawFiles.filter(file => overlaySelection.includes(file.name)) : rawFiles),
    [isOverlayView, overlaySelection, rawFiles],
  )
  const rawStageDatasets = useMemo(
    () => rawChartSourceFiles.map(file => ({ name: file.name, x: file.x, y: file.y })),
    [rawChartSourceFiles],
  )
  const rawChartTraces = useMemo(
    () => rawChartSourceFiles.map((file, index) => {
      const globalIndex = rawFiles.findIndex(item => item.name === file.name)
      const paletteKey = rawFileColors[globalIndex >= 0 ? globalIndex : index] ?? DEFAULT_SERIES_PALETTE_KEYS[index % DEFAULT_SERIES_PALETTE_KEYS.length]
      const palette = LINE_COLOR_PALETTES[paletteKey] ?? LINE_COLOR_PALETTES.blue
      return {
        x: file.x,
        y: file.y,
        type: 'scatter',
        mode: 'lines',
        name: file.name,
        line: { color: palette.primary, width: 2 },
      } as Plotly.Data
    }),
    [rawChartSourceFiles, rawFileColors, rawFiles],
  )
  const overlayStageDatasets = useMemo(
    () => overlayDatasets.map(dataset => ({ name: dataset.name, x: dataset.x, y: dataset.y_processed })),
    [overlayDatasets],
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
  const preprocessStageDatasets = useMemo(() => {
    if (!activeDataset) return []
    const comparison = activeDataset.y_despiked ?? activeDataset.y_processed
    const comparisonLabel = activeDataset.y_despiked ? '去尖峰後' : '前處理後'
    return [
      { name: '原始', x: activeDataset.x, y: activeDataset.y_raw },
      { name: comparisonLabel, x: activeDataset.x, y: comparison },
    ]
  }, [activeDataset])
  const preprocessChartTraces = useMemo(() => {
    if (preprocessStageDatasets.length === 0) return []
    const palette = LINE_COLOR_PALETTES[chartLineColors.preprocess] ?? LINE_COLOR_PALETTES.teal
    return [
      { x: preprocessStageDatasets[0].x, y: preprocessStageDatasets[0].y, type: 'scatter', mode: 'lines', name: preprocessStageDatasets[0].name, line: { color: palette.secondary, width: 1.35, dash: 'dot' } },
      { x: preprocessStageDatasets[1].x, y: preprocessStageDatasets[1].y, type: 'scatter', mode: 'lines', name: preprocessStageDatasets[1].name, line: { color: palette.primary, width: 2.2 } },
    ] as Plotly.Data[]
  }, [chartLineColors.preprocess, preprocessStageDatasets])
  const backgroundStageDatasets = useMemo(() => {
    if (!activeDataset || !params.bg_enabled || !activeDataset.y_background) return []
    return [
      { name: '原始', x: activeDataset.x, y: activeDataset.y_raw },
      { name: '背景基準線', x: activeDataset.x, y: activeDataset.y_background },
      { name: '背景扣除後', x: activeDataset.x, y: activeDataset.y_processed },
    ]
  }, [activeDataset, params.bg_enabled])
  const backgroundChartTraces = useMemo(() => {
    if (backgroundStageDatasets.length === 0) return []
    const palette = LINE_COLOR_PALETTES[chartLineColors.background] ?? LINE_COLOR_PALETTES.orange
    return [
      { x: backgroundStageDatasets[0].x, y: backgroundStageDatasets[0].y, type: 'scatter', mode: 'lines', name: '原始', line: { color: palette.secondary, width: 1.25, dash: 'dot' } },
      { x: backgroundStageDatasets[1].x, y: backgroundStageDatasets[1].y, type: 'scatter', mode: 'lines', name: '背景基準線', line: { color: palette.tertiary, width: 1.45, dash: 'dot' } },
      { x: backgroundStageDatasets[2].x, y: backgroundStageDatasets[2].y, type: 'scatter', mode: 'lines', name: '背景扣除後', line: { color: palette.primary, width: 2.2 } },
    ] as Plotly.Data[]
  }, [backgroundStageDatasets, chartLineColors.background])
  const finalStageDatasets = useMemo(
    () => activeDataset ? [{ name: activeDataset.name, x: activeDataset.x, y: activeDataset.y_processed }] : [],
    [activeDataset],
  )
  const finalChartTraces = useMemo(() => {
    if (!activeDataset) return []
    const palette = LINE_COLOR_PALETTES[chartLineColors.final] ?? LINE_COLOR_PALETTES.blue
    const traces: Plotly.Data[] = [
      {
        x: activeDataset.x,
        y: activeDataset.y_processed,
        type: 'scatter',
        mode: 'lines',
        name: activeDataset.name,
        line: { color: palette.primary, width: 2.25 },
      },
    ]
    if (refPeaks.length > 0) {
      const yMin = Math.min(...activeDataset.y_processed)
      const yMax = Math.max(...activeDataset.y_processed)
      const span = Math.max(yMax - yMin, 1)
      const base = yMin - span * 0.12
      const xs: Array<number | null> = []
      const ys: Array<number | null> = []
      refPeaks.forEach(peak => {
        const height = span * 0.18 * (peak.strength / 100)
        xs.push(peak.position_cm, peak.position_cm, null)
        ys.push(base, base + height, null)
      })
      traces.push({
        x: xs,
        y: ys,
        type: 'scatter',
        mode: 'lines',
        name: '參考峰',
        line: { color: palette.accent, width: 1.4, dash: 'dot' },
        hoverinfo: 'skip',
      })
    }
    if (peakParams.enabled && detectedPeaks.length > 0) {
      traces.push({
        x: detectedPeaks.map(peak => peak.shift_cm),
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
  }, [activeDataset, chartLineColors.final, detectedPeaks, peakParams.enabled, refPeaks])

  useEffect(() => {
    if (!peakParams.enabled || !activeDataset) {
      setDetectedPeaks([])
      return
    }
    let cancelled = false
    detectPeaks(activeDataset.x, activeDataset.y_processed, peakParams)
      .then(peaks => {
        if (!cancelled) setDetectedPeaks(peaks)
      })
      .catch(e => {
        if (!cancelled) setError(String((e as Error).message))
      })
    return () => {
      cancelled = true
    }
  }, [activeDataset, peakParams])

  useEffect(() => {
    if (!activeDataset) {
      setFitTargetName('')
      return
    }
    setFitTargetName(activeDataset.name)
    if (manualPeakPosition == null) {
      const xMin = Math.min(...activeDataset.x)
      const xMax = Math.max(...activeDataset.x)
      setManualPeakPosition((xMin + xMax) / 2)
    }
  }, [activeDataset, manualPeakPosition, selectedSeries])

  const handleFiles = useCallback(async (files: File[]) => {
    setIsLoading(true)
    setError(null)
    try {
      const parsed = await parseFiles(files)
      setRawFiles(parsed)
      setDetectedPeaks([])
      const sample = parsed[0]
      if (sample) {
        const xMin = Math.min(...sample.x)
        const xMax = Math.max(...sample.x)
        setParams(current => ({
          ...current,
          bg_x_start: xMin,
          bg_x_end: xMax,
          norm_x_start: xMin,
          norm_x_end: xMax,
        }))
      }
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const validNames = new Set(rawFiles.map(file => file.name))
    setOverlaySelection(prev => prev.filter(name => validNames.has(name)))
    setOverlayDraftSelection(prev => prev.filter(name => validNames.has(name)))
    if (rawFiles.length === 0) {
      setProcessingViewMode('single')
      return
    }
    if (!validNames.has(selectedSeries)) {
      setSelectedSeries(rawFiles[0].name)
    }
  }, [rawFiles, selectedSeries])

  useEffect(() => {
    if (overlaySelectorOpen) setOverlayDraftSelection(overlaySelection)
  }, [overlaySelection, overlaySelectorOpen])

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

  const loadReferencePeaksToCandidates = useCallback(() => {
    if (refPeaks.length === 0) return
    setFitCandidates(current => {
      const existing = new Set(
        current.map(item => `${item.material}::${item.ref_position_cm?.toFixed(2) ?? item.position_cm.toFixed(2)}::${item.label}`),
      )
      const incoming = refPeaks
        .map(peak => refPeakToCandidate(peak, fitDefaultFwhm))
        .filter(candidate => {
          const key = `${candidate.material}::${candidate.ref_position_cm?.toFixed(2) ?? candidate.position_cm.toFixed(2)}::${candidate.label}`
          return !existing.has(key)
        })
      return [...current, ...incoming]
    })
  }, [fitDefaultFwhm, refPeaks])

  const loadPeakLibraryToCandidates = useCallback(() => {
    const source = selectedRefs.length > 0
      ? peakLibrary.filter(peak => selectedRefs.includes(peak.material) || selectedRefs.includes(peak.phase))
      : peakLibrary
    if (source.length === 0) return
    setFitCandidates(current => {
      const existing = new Set(
        current.map(item => `${item.material}::${item.ref_position_cm?.toFixed(2) ?? item.position_cm.toFixed(2)}::${item.label}`),
      )
      const incoming = source
        .map(peak => refPeakToCandidate(peak, fitDefaultFwhm))
        .filter(candidate => {
          const key = `${candidate.material}::${candidate.ref_position_cm?.toFixed(2) ?? candidate.position_cm.toFixed(2)}::${candidate.label}`
          return !existing.has(key)
        })
      return [...current, ...incoming]
    })
  }, [fitDefaultFwhm, peakLibrary, selectedRefs])

  const addManualPeakCandidate = useCallback(() => {
    if (manualPeakPosition == null || !Number.isFinite(manualPeakPosition)) return
    const label = manualPeakLabel.trim() || `${manualPeakPosition.toFixed(1)} cm⁻¹`
    setFitCandidates(current => [
      ...current,
      {
        peak_id: createPeakCandidateId(),
        enabled: true,
        material: manualPeakMaterial.trim(),
        phase: manualPeakMaterial.trim(),
        phase_group: manualPeakMaterial.trim() ? `${manualPeakMaterial.trim()} group` : '',
        label,
        display_name: label,
        position_cm: manualPeakPosition,
        fwhm_cm: manualPeakFwhm,
        tolerance_cm: manualPeakTolerance,
        fwhm_min: manualPeakFwhmMin,
        fwhm_max: manualPeakFwhmMax,
        profile: manualPeakProfile,
        allowed_profiles: ['gaussian', 'lorentzian', 'voigt', 'pseudo_voigt', 'split_pseudo_voigt'],
        peak_type: 'custom',
        anchor_peak: false,
        can_be_quantified: true,
        species: '',
        theoretical_center: manualPeakPosition,
        related_technique: 'Raman',
        reference: 'User custom peak',
        oxidation_state: 'N/A',
        oxidation_state_inference: 'Not applicable',
        role: manualPeakMaterial.trim() ? '自訂' : '',
        mode_label: '',
        note: '',
        ref_position_cm: null,
        lock_center: false,
        lock_fwhm: false,
        lock_area: false,
        lock_profile: false,
      },
    ])
    setManualPeakLabel('')
  }, [
    manualPeakFwhm,
    manualPeakFwhmMax,
    manualPeakFwhmMin,
    manualPeakLabel,
    manualPeakMaterial,
    manualPeakPosition,
    manualPeakProfile,
    manualPeakTolerance,
  ])

  const activeFitDataset = useMemo(() => {
    if (!result) return null
    return result.datasets.find(dataset => dataset.name === fitTargetName) ?? null
  }, [fitTargetName, result])

  const updateFitCandidate = useCallback((peakId: string, patch: Partial<FitPeakCandidate>) => {
    setFitCandidates(current => current.map(item => item.peak_id === peakId ? { ...item, ...patch } : item))
  }, [])

  const removeFitCandidate = useCallback((peakId: string) => {
    setFitCandidates(current => current.filter(item => item.peak_id !== peakId))
    setEditingPeakId(current => current === peakId ? null : current)
  }, [])

  const fitRowsById = useMemo(() => {
    const map = new Map<string, FitResult['peaks'][number]>()
    fitResult?.peaks.forEach(row => {
      if (row.Peak_ID) map.set(row.Peak_ID, row)
    })
    return map
  }, [fitResult])

  const peakTableRows = useMemo(() => fitCandidates.map(candidate => {
    const row = fitRowsById.get(candidate.peak_id)
    const status = peakStatusLabel(row, reviewMaxAbsDelta)
    return {
      candidate,
      row,
      status,
      suggested: isSuggestedEdit(row, reviewMaxAbsDelta),
      position: row?.Center_cm ?? candidate.position_cm,
      profile: (row?.Profile ?? candidate.profile) || fitParams.profile,
      theoretical: row?.Ref_cm ?? candidate.ref_position_cm ?? candidate.theoretical_center,
      delta: row?.Delta_cm ?? null,
      fwhm: row?.FWHM_cm ?? candidate.fwhm_cm,
      areaPct: row?.Area_pct ?? null,
    }
  }), [fitCandidates, fitParams.profile, fitRowsById, reviewMaxAbsDelta])

  const applyProfileToSuggestedPeaks = useCallback((nextProfile: RamanProfile) => {
    const suggestedIds = new Set(
      peakTableRows
        .filter(item => item.suggested)
        .map(item => item.candidate.peak_id),
    )
    if (suggestedIds.size === 0) return
    setFitCandidates(current => current.map(item => (
      item.enabled && suggestedIds.has(item.peak_id)
        ? { ...item, profile: nextProfile }
        : item
    )))
  }, [peakTableRows])

  const applyFlexibleProfileToLowShiftPeaks = useCallback(() => {
    setFitCandidates(current => current.map(item => {
      const center = item.ref_position_cm ?? item.theoretical_center ?? item.position_cm
      return item.enabled && Number.isFinite(center) && center <= 500
        ? { ...item, profile: 'split_pseudo_voigt' }
        : item
    }))
  }, [])

  const editingCandidate = useMemo(
    () => fitCandidates.find(item => item.peak_id === editingPeakId) ?? null,
    [editingPeakId, fitCandidates],
  )

  const fitPeakFlags = useMemo(() => {
    if (!fitResult?.success) return []
    return fitResult.peaks.map(row => ({
      row,
      flags: getFitQualityFlags(row, reviewMinAreaPct, reviewMaxAbsDelta),
    }))
  }, [fitResult, reviewMaxAbsDelta, reviewMinAreaPct])

  const cleanFitPeaks = useMemo(
    () => fitPeakFlags.filter(item => item.flags.length === 0),
    [fitPeakFlags],
  )

  const suspiciousFitPeaks = useMemo(
    () => fitPeakFlags.filter(item => item.flags.length > 0),
    [fitPeakFlags],
  )

  const siPeak = useMemo(() => {
    if (!fitResult?.success) return null
    return fitResult.peaks.find(pk => pk.Center_cm >= 480 && pk.Center_cm <= 570) ?? null
  }, [fitResult])

  const runPeakFit = useCallback(async () => {
    if (!activeFitDataset) {
      setError('目前沒有可用於擬合的曲線')
      return
    }
    const enabledCandidates = fitCandidates.filter(item => item.enabled)
    if (enabledCandidates.length === 0) {
      setError('請先在峰位表啟用至少一個峰')
      return
    }
    setIsFitting(true)
    setError(null)
    try {
      const response = await fitSpectrum(
        activeFitDataset.name,
        activeFitDataset.x,
        activeFitDataset.y_processed,
        enabledCandidates,
        fitParams,
      )
      if (!response.success) {
        throw new Error(response.message || '峰擬合失敗')
      }
      setFitResult(response)
      setAutoRefitSummary(null)
      setAutoDebugSummary(null)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setIsFitting(false)
    }
  }, [activeFitDataset, fitCandidates, fitParams])

  const runAutoRefit = useCallback(async () => {
    if (!activeFitDataset) {
      setError('目前沒有可用於擬合的曲線')
      return
    }
    if (selectedReviewRules.length === 0) {
      setError('請至少勾選一個停用條件')
      return
    }

    let workingCandidates = fitCandidates.map(item => ({ ...item }))
    let finalResult: FitResult | null = null
    const disabledPeakIds = new Set<string>()
    const disabledPeakNames = new Set<string>()
    let rounds = 0
    let stopReason = '未開始'

    setIsFitting(true)
    setError(null)
    try {
      for (let round = 1; round <= Math.max(1, autoRefitMaxRounds); round += 1) {
        rounds = round
        const enabledCandidates = workingCandidates.filter(item => item.enabled)
        if (enabledCandidates.length === 0) {
          stopReason = '所有峰位都已被停用'
          break
        }

        const response = await fitSpectrum(
          activeFitDataset.name,
          activeFitDataset.x,
          activeFitDataset.y_processed,
          enabledCandidates,
          fitParams,
        )
        if (!response.success) {
          throw new Error(response.message || '峰擬合失敗')
        }
        finalResult = response

        const candidateById = new Map(workingCandidates.map(item => [item.peak_id, item]))
        const toDisable = response.peaks
          .filter(row => {
            const candidate = candidateById.get(row.Peak_ID)
            if (candidate && isAnchorCandidate(candidate)) return false
            const flags = getFitQualityFlags(row, reviewMinAreaPct, reviewMaxAbsDelta)
            return flags.some(flag => (
              (selectedReviewRules.includes('area_zero') && flag === 'Area=0') ||
              (selectedReviewRules.includes('low_area') && flag.startsWith('Area%<')) ||
              (selectedReviewRules.includes('large_delta') && flag.startsWith('|Δ|>')) ||
              (selectedReviewRules.includes('boundary') && flag === 'boundary peak') ||
              (selectedReviewRules.includes('broad') && flag === 'broad/background-like peak') ||
              (selectedReviewRules.includes('low_confidence') && row.Confidence === 'Low')
            ))
          })
          .map(row => row.Peak_ID)

        if (toDisable.length === 0) {
          stopReason = '沒有新的可疑峰符合停用條件'
          if (autoRefitStopWhenClean) break
          break
        }

        const nextCandidates = workingCandidates.map(item => {
          if (toDisable.includes(item.peak_id) && item.enabled) {
            disabledPeakIds.add(item.peak_id)
            disabledPeakNames.add(item.display_name || item.label)
            return { ...item, enabled: false }
          }
          return item
        })

        const changed = nextCandidates.some((item, idx) => item.enabled !== workingCandidates[idx].enabled)
        workingCandidates = nextCandidates

        if (!changed) {
          stopReason = '停用條件沒有造成新的變更'
          break
        }

        if (round === Math.max(1, autoRefitMaxRounds)) {
          stopReason = '已達自動二次擬合回合上限'
        }
      }

      setFitCandidates(workingCandidates)
      setFitResult(finalResult)
      setAutoRefitSummary({
        rounds,
        disabledPeakIds: Array.from(disabledPeakIds),
        disabledPeakNames: Array.from(disabledPeakNames),
        stopReason,
      })
      setAutoDebugSummary(null)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setIsFitting(false)
    }
  }, [
    activeFitDataset,
    autoRefitMaxRounds,
    autoRefitStopWhenClean,
    fitCandidates,
    fitParams,
    reviewMaxAbsDelta,
    reviewMinAreaPct,
    selectedReviewRules,
  ])

  const runAutoDebugRefit = useCallback(async () => {
    if (!activeFitDataset) {
      setError('目前沒有可用於擬合的曲線')
      return
    }
    if (fitCandidates.filter(item => item.enabled).length === 0) {
      setError('請先在峰位表啟用至少一個峰')
      return
    }

    let workingCandidates = fitCandidates.map(item => ({ ...item }))
    let finalResult: FitResult | null = null
    let rounds = 0
    let stopReason = '未開始'
    let beforeMaxResidual: number | null = null
    let afterMaxResidual: number | null = null
    let needsFinalFit = false
    const actions: string[] = []
    const target = Math.max(Number(fitParams.residual_target || 0.05), 1e-6)
    const maxRounds = Math.max(1, Math.min(8, Math.round(fitParams.residual_target_rounds || autoRefitMaxRounds || 4)))
    const debugFitParams: FitParams = { ...fitParams, residual_target_enabled: false }

    const fitWorkingCandidates = async (candidates: FitPeakCandidate[]) => {
      const enabledCandidates = candidates.filter(item => item.enabled)
      if (enabledCandidates.length === 0) {
        throw new Error('所有峰位都已被停用')
      }
      const response = await fitSpectrum(
        activeFitDataset.name,
        activeFitDataset.x,
        activeFitDataset.y_processed,
        enabledCandidates,
        debugFitParams,
      )
      if (!response.success) {
        throw new Error(response.message || '峰擬合失敗')
      }
      return response
    }

    const peakCenter = (candidate: FitPeakCandidate) => (
      candidate.ref_position_cm ?? candidate.theoretical_center ?? candidate.position_cm
    )

    setIsFitting(true)
    setError(null)
    try {
      for (let round = 1; round <= maxRounds; round += 1) {
        rounds = round
        const response = await fitWorkingCandidates(workingCandidates)
        finalResult = response
        needsFinalFit = false
        const maxResidual = response.residual_diagnostics.Global_MaxAbs
        beforeMaxResidual ??= maxResidual
        afterMaxResidual = maxResidual

        if (maxResidual <= target) {
          stopReason = `已低於目標 residual ${target.toFixed(3)}`
          break
        }

        const rowsById = new Map(response.peaks.map(row => [row.Peak_ID, row]))
        let changed = false
        let nextCandidates = workingCandidates.map(candidate => {
          if (!candidate.enabled) return candidate
          const row = rowsById.get(candidate.peak_id)
          if (!row) return candidate

          const flags = getFitQualityFlags(row, reviewMinAreaPct, reviewMaxAbsDelta)
          const patch: Partial<FitPeakCandidate> = {}
          const label = candidate.display_name || candidate.label || candidate.peak_id
          const absDelta = row.Delta_cm == null ? 0 : Math.abs(row.Delta_cm)

          if (
            row.Boundary_Peak ||
            flags.includes('boundary peak') ||
            flags.includes('center outside tolerance') ||
            absDelta > reviewMaxAbsDelta
          ) {
            if (candidate.lock_center) {
              patch.lock_center = false
              actions.push(`R${round}: ${label} 解除中心鎖定；保留 hard center range ±${candidate.tolerance_cm.toFixed(1)} cm⁻¹`)
            } else {
              actions.push(`R${round}: ${label} 撞中心 hard limit，未自動放寬`)
            }
          }

          const fwhmLimitHit =
            flags.includes('FWHM at limit') ||
            flags.includes('broad/background-like peak') ||
            row.FWHM_cm >= candidate.fwhm_max * 0.92
          if (fwhmLimitHit) {
            if (candidate.lock_fwhm) {
              patch.lock_fwhm = false
              actions.push(`R${round}: ${label} 解除 FWHM 鎖定；保留 hard FWHM range`)
            }
            if (candidate.profile !== 'split_pseudo_voigt' && candidate.peak_type !== 'residual_assist') {
              patch.profile = 'split_pseudo_voigt'
              patch.lock_profile = false
              actions.push(`R${round}: ${label} 改用 asymmetric / split pseudo-Voigt`)
            }
          }

          if (
            !isAnchorCandidate(candidate) &&
            row.Confidence === 'Low' &&
            row.Area_pct < Math.max(reviewMinAreaPct, 1) &&
            (row.SNR == null || row.SNR < 3)
          ) {
            patch.enabled = false
            actions.push(`R${round}: ${label} 低 SNR/低面積，暫停用`)
          }

          if (Object.keys(patch).length === 0) return candidate
          changed = true
          return { ...candidate, ...patch }
        })

        const residualCenter = response.residual_diagnostics.Max_Residual_Center_cm
        if (typeof residualCenter === 'number' && Number.isFinite(residualCenter) && maxResidual > target) {
          let nearestIdx = -1
          let nearestDistance = Number.POSITIVE_INFINITY
          nextCandidates.forEach((candidate, idx) => {
            if (!candidate.enabled) return
            const center = peakCenter(candidate)
            if (center == null || !Number.isFinite(center)) return
            const distance = Math.abs(center - residualCenter)
            if (distance < nearestDistance) {
              nearestDistance = distance
              nearestIdx = idx
            }
          })

          if (nearestIdx >= 0 && nearestDistance <= 32) {
            const candidate = nextCandidates[nearestIdx]
            nextCandidates[nearestIdx] = {
              ...candidate,
              profile: candidate.peak_type === 'residual_assist'
                ? 'super_gaussian'
                : (candidate.profile === 'split_pseudo_voigt' ? candidate.profile : 'split_pseudo_voigt'),
              lock_profile: false,
              lock_fwhm: false,
            }
            actions.push(`R${round}: 最大殘差 ${residualCenter.toFixed(1)} cm⁻¹ 附近峰改為更可變形`)
            changed = true
          } else {
            const duplicateAssist = nextCandidates.some(candidate => (
              candidate.peak_type === 'residual_assist' &&
              Math.abs(candidate.position_cm - residualCenter) <= 10
            ))
            if (!duplicateAssist) {
              const xSpan = Math.max(...activeFitDataset.x) - Math.min(...activeFitDataset.x)
              const assistFwhm = Math.max(6, Math.min(35, xSpan / 35))
              nextCandidates = [
                ...nextCandidates,
                {
                  peak_id: createPeakCandidateId(),
                  enabled: true,
                  material: 'Residual assist',
                  phase: 'Residual assist',
                  phase_group: 'Residual assist',
                  label: `Residual assist ${residualCenter.toFixed(1)} cm⁻¹`,
                  display_name: `Residual assist ${residualCenter.toFixed(1)} cm⁻¹`,
                  position_cm: residualCenter,
                  fwhm_cm: assistFwhm,
                  tolerance_cm: 18,
                  fwhm_min: 2,
                  fwhm_max: 90,
                  profile: 'super_gaussian',
                  allowed_profiles: ['super_gaussian'],
                  peak_type: 'residual_assist',
                  anchor_peak: false,
                  can_be_quantified: false,
                  species: 'model residual',
                  theoretical_center: residualCenter,
                  related_technique: 'Model',
                  reference: 'Auto debug mode',
                  oxidation_state: 'N/A',
                  oxidation_state_inference: 'Not applicable',
                  role: 'model correction',
                  mode_label: 'residual assist',
                  note: 'Automatically added by auto debug mode; treat as possible overfit, not a physical assignment.',
                  ref_position_cm: null,
                  lock_center: false,
                  lock_fwhm: false,
                  lock_area: false,
                  lock_profile: false,
                },
              ]
              actions.push(`R${round}: 新增 residual-assist ${residualCenter.toFixed(1)} cm⁻¹`)
              changed = true
            }
          }
        }

        if (!changed) {
          stopReason = '沒有找到可安全自動修改的項目'
          break
        }

        workingCandidates = nextCandidates
        needsFinalFit = true
        if (round === maxRounds) {
          stopReason = '已達自動偵錯回合上限'
        }
      }

      if (needsFinalFit) {
        finalResult = await fitWorkingCandidates(workingCandidates)
        afterMaxResidual = finalResult.residual_diagnostics.Global_MaxAbs
        const residualImprovement = beforeMaxResidual == null ? Number.POSITIVE_INFINITY : beforeMaxResidual - afterMaxResidual
        const assistCount = workingCandidates.filter(item => item.peak_type === 'residual_assist').length
        if (assistCount > 0 && residualImprovement < Math.max(0.005, (beforeMaxResidual ?? 0) * 0.02)) {
          workingCandidates = workingCandidates.filter(item => item.peak_type !== 'residual_assist')
          finalResult = await fitWorkingCandidates(workingCandidates)
          afterMaxResidual = finalResult.residual_diagnostics.Global_MaxAbs
          actions.push('Model selection: residual-assist 改善有限，已拒絕並移除')
          stopReason = '新增 component 改善有限，已依 model selection rule 拒絕'
        }
        if (afterMaxResidual <= target) {
          stopReason = `已低於目標 residual ${target.toFixed(3)}`
        }
      }

      setFitCandidates(workingCandidates)
      setFitResult(finalResult)
      setAutoRefitSummary(null)
      setAutoDebugSummary({
        rounds,
        actions,
        beforeMaxResidual,
        afterMaxResidual,
        stopReason,
      })
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setIsFitting(false)
    }
  }, [
    activeFitDataset,
    autoRefitMaxRounds,
    fitCandidates,
    fitParams,
    reviewMaxAbsDelta,
    reviewMinAreaPct,
  ])

  const exportPreset = useCallback(() => {
    const preset = { version: 2, params, peaks: fitCandidates }
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'raman_preset.json'; a.click()
    URL.revokeObjectURL(url)
  }, [params, fitCandidates])

  const importPreset = useCallback((file: File) => {
    file.text().then(text => {
      try {
        const preset = JSON.parse(text)
        if (![1, 2].includes(preset.version)) throw new Error('不支援的 preset 版本')
        if (preset.params) setParams(p => ({ ...p, ...preset.params }))
        if (Array.isArray(preset.peaks)) setFitCandidates(preset.peaks.map(normalizeCandidate))
      } catch (e: unknown) {
        setError(`Preset 匯入失敗：${(e as Error).message}`)
      }
    }).catch(() => setError('無法讀取檔案'))
  }, [])

  const exportPeakLibrary = useCallback(() => {
    downloadFile(JSON.stringify(peakLibrary, null, 2), 'raman_peak_library.json', 'application/json')
  }, [peakLibrary])

  const importPeakLibrary = useCallback((file: File) => {
    file.text().then(text => {
      try {
        const parsed = JSON.parse(text)
        if (!Array.isArray(parsed)) throw new Error('Peak library 必須是 array')
        setPeakLibrary(parsed.map(item => ({
          material: String(item.material ?? item.phase ?? ''),
          phase: String(item.phase ?? item.material ?? ''),
          phase_group: String(item.phase_group ?? `${item.material ?? item.phase ?? ''} group`),
          position_cm: Number(item.position_cm ?? item.pos ?? item.theoretical_center ?? 0),
          theoretical_center: Number(item.theoretical_center ?? item.position_cm ?? item.pos ?? 0),
          label: String(item.label ?? item.mode ?? ''),
          mode: String(item.mode ?? item.label ?? ''),
          species: String(item.species ?? ''),
          tolerance_cm: Number(item.tolerance_cm ?? 10),
          fwhm_min: Number(item.fwhm_min ?? 0.5),
          fwhm_max: Number(item.fwhm_max ?? 80),
          profile: (item.profile ?? 'pseudo_voigt') as RamanProfile,
          allowed_profiles: Array.isArray(item.allowed_profiles) ? item.allowed_profiles as RamanProfile[] : [],
          peak_type: String(item.peak_type ?? 'custom'),
          anchor_peak: Boolean(item.anchor_peak),
          can_be_quantified: item.can_be_quantified !== false,
          related_technique: String(item.related_technique ?? 'Raman'),
          reference: String(item.reference ?? 'User imported library'),
          oxidation_state: String(item.oxidation_state ?? 'N/A'),
          oxidation_state_inference: item.oxidation_state_inference ?? 'Not applicable',
          strength: Number(item.strength ?? 50),
          note: String(item.note ?? ''),
        })))
      } catch (e: unknown) {
        setError(`Peak library 匯入失敗：${(e as Error).message}`)
      }
    }).catch(() => setError('無法讀取 peak library 檔案'))
  }, [])

  const exportFitCsv = useCallback(() => {
    if (!fitResult?.success) return
    const headers = [
      'Dataset', 'Peak', 'Phase', 'Mode', 'Species', 'Oxidation_State', 'Oxidation_Inference',
      'Profile', 'Ref_cm', 'Center_cm', 'Delta_cm', 'FWHM_cm', 'Area', 'Area_pct',
      'SNR', 'Fit_Status', 'Physical_Confidence', 'Flags', 'Group_Status',
    ]
    const rows = fitResult.peaks.map(row => [
      fitResult.dataset_name,
      row.Peak_Name,
      row.Phase,
      row.Mode_Label,
      row.Species,
      row.Oxidation_State,
      row.Oxidation_State_Inference,
      row.Profile,
      row.Ref_cm,
      row.Center_cm,
      row.Delta_cm,
      row.FWHM_cm,
      row.Area,
      row.Area_pct,
      row.SNR,
      row.Fit_Status,
      row.Physical_Confidence || row.Confidence,
      row.Quality_Flags.join(' / '),
      row.Group_Status,
    ])
    downloadFile(toCsv(headers, rows), 'raman_fit_results.csv', 'text/csv')
  }, [fitResult])

  const exportFitJson = useCallback(() => {
    if (!fitResult?.success) return
    downloadFile(JSON.stringify(fitResult, null, 2), 'raman_fit_report.json', 'application/json')
  }, [fitResult])

  const exportFitExcel = useCallback(() => {
    if (!fitResult?.success) return
    const headers = ['Dataset', 'Peak', 'Phase', 'Mode', 'Center_cm', 'FWHM_cm', 'Area', 'Area_pct', 'Fit_Status', 'Physical_Confidence', 'Flags']
    const rows = fitResult.peaks.map(row => [
      fitResult.dataset_name,
      row.Peak_Name,
      row.Phase,
      row.Mode_Label,
      row.Center_cm,
      row.FWHM_cm,
      row.Area,
      row.Area_pct,
      row.Fit_Status,
      row.Physical_Confidence || row.Confidence,
      row.Quality_Flags.join(' / '),
    ])
    downloadFile(toCsv(headers, rows).replace(/,/g, '\t'), 'raman_fit_results.xls', 'application/vnd.ms-excel')
  }, [fitResult])

  const runBatchFit = useCallback(async () => {
    if (!result) {
      setError('目前沒有可批次擬合的資料')
      return
    }
    const enabledCandidates = fitCandidates.filter(item => item.enabled)
    if (enabledCandidates.length === 0) {
      setError('請先啟用至少一個峰再批次擬合')
      return
    }
    setIsFitting(true)
    setError(null)
    try {
      const datasets = [...result.datasets]
      const outputs: FitResult[] = []
      for (const dataset of datasets) {
        const response = await fitSpectrum(
          dataset.name,
          dataset.x,
          dataset.y_processed,
          enabledCandidates,
          fitParams,
        )
        if (!response.success) throw new Error(`${dataset.name}: ${response.message || '峰擬合失敗'}`)
        outputs.push(response)
      }
      setBatchResults(outputs)
      if (outputs[0]) setFitResult(outputs[0])
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setIsFitting(false)
    }
  }, [fitCandidates, fitParams, result])

  const batchTrendRows = useMemo(() => {
    return batchResults.flatMap(batch => {
      const totalArea = batch.peaks.reduce((sum, row) => sum + Math.abs(row.Area), 0)
      const siArea = batch.peaks.find(row => row.Center_cm >= 510 && row.Center_cm <= 530)?.Area ?? null
      return batch.peaks.map(row => {
        const normBase = batchNormalize === 'si_520'
          ? Math.abs(siArea ?? 0)
          : batchNormalize === 'total_area'
            ? totalArea
            : 0
        return {
          dataset: batch.dataset_name,
          peak: row.Peak_Name,
          phase: row.Phase,
          center: row.Center_cm,
          fwhm: row.FWHM_cm,
          area: row.Area,
          normalizedArea: normBase > 0 ? row.Area / normBase : null,
          confidence: row.Confidence,
        }
      })
    })
  }, [batchNormalize, batchResults])

  const exportBatchCsv = useCallback(() => {
    const headers = ['Dataset', 'Peak', 'Phase', 'Center_cm', 'FWHM_cm', 'Area', 'Normalized_Area', 'Confidence']
    const rows = batchTrendRows.map(row => [
      row.dataset,
      row.peak,
      row.phase,
      row.center,
      row.fwhm,
      row.area,
      row.normalizedArea,
      row.confidence,
    ])
    downloadFile(toCsv(headers, rows), 'raman_batch_trends.csv', 'text/csv')
  }, [batchTrendRows])

  const sidebarStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--sidebar-shift': sidebarCollapsed
      ? `calc(-1 * (var(--sidebar-width) - ${SIDEBAR_COLLAPSED_PEEK}px))`
      : '0px',
  } as CSSProperties

  return (
    <div className="min-h-screen xl:flex">
      <aside
        className="module-sidebar glass-panel relative z-20 flex min-h-screen w-full flex-col overflow-hidden xl:w-[var(--sidebar-width)] xl:transform-gpu xl:[transform:translateX(var(--sidebar-shift))] xl:rounded-none xl:border-l-0 xl:border-t-0 xl:border-b-0"
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

        <div className={[
          'module-sidebar__content flex h-full flex-col',
          sidebarCollapsed ? 'module-sidebar__content--collapsed xl:pointer-events-none xl:opacity-0' : 'opacity-100',
        ].join(' ')}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StickySidebarHeader
              activeModule="raman"
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
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">參考</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">{selectedRefs.length}</p>
                </div>
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">峰數</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">{detectedPeaks.length}</p>
                </div>
              </div>
            </div>

            <div className="sidebar-scroll px-4 py-5">
            <SidebarCard step={1} title="載入檔案" hint="支援 TXT / CSV / ASC / DAT" infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">載入檔案說明</p>
                <p>可同時上傳多筆 Raman 光譜，後續是否平均或個別處理，仍由下方步驟控制。</p>
              </div>
            }>
              <div className="mb-3 text-sm font-medium text-[var(--text-main)]">{moduleContent.uploadTitle}（可多選）</div>
              <FileUpload onFiles={handleFiles} isLoading={isLoading} moduleLabel="Raman" accept={['.txt', '.csv', '.asc', '.dat']} />
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
                </div>
              )}
            </SidebarCard>

            <SidebarCard step={2} title="去尖峰" hint="先處理極端尖刺" defaultOpen={false} infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">去尖峰說明</p>
                <p>先把 Raman 光譜中明顯偏離鄰近點的尖刺壓掉，避免後續背景與擬合被單點異常值主導。</p>
              </div>
            }>
              <TogglePill
                checked={params.despike_enabled}
                onChange={value => setParams(current => ({ ...current, despike_enabled: value }))}
                label="啟用去尖峰"
              />
              {params.despike_enabled && (
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">門檻</span>
                    <input type="number" value={params.despike_threshold} step={0.5} min={2} max={20} onChange={e => setParams(current => ({ ...current, despike_threshold: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">視窗點數</span>
                    <input type="number" value={params.despike_window} step={2} min={3} max={31} onChange={e => setParams(current => ({ ...current, despike_window: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                </div>
              )}
            </SidebarCard>

            <SidebarCard step={3} title="內插" hint="統一點數網格" defaultOpen={false} infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">內插說明</p>
                <p>把每筆 Raman 光譜重取樣到固定點數，方便切換資料時維持一致解析度，也方便後續多筆比較。</p>
              </div>
            }>
              <TogglePill
                checked={params.interpolate}
                onChange={value => setParams(current => ({ ...current, interpolate: value }))}
                label="先內插到固定點數"
              />
              {params.interpolate && (
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">內插點數</span>
                  <input type="number" value={params.n_points} min={200} max={5000} step={50} onChange={e => setParams(current => ({ ...current, n_points: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                </label>
              )}
            </SidebarCard>

            <SidebarCard step={4} title="多檔平均" hint="共用同一網格平均" defaultOpen={false} infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">多檔平均說明</p>
                <p>把已載入的多筆 Raman 光譜對齊後做平均，適合重複量測的穩定化比較。</p>
              </div>
            }>
              <TogglePill
                checked={params.average}
                onChange={value => setParams(current => ({ ...current, average: value }))}
                label="對所有檔案做平均"
              />
              {(params.interpolate || params.average) && (
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">內插點數</span>
                  <input type="number" value={params.n_points} min={200} max={5000} step={50} onChange={e => setParams(current => ({ ...current, n_points: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                </label>
              )}
            </SidebarCard>

            <SidebarCard step={5} title="背景扣除" hint="baseline 修正" defaultOpen={false} infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">背景扣除說明</p>
                <p>背景扣除用來去除基線漂移，讓主峰輪廓更清楚；這一步只影響光譜形狀呈現，不改你的步驟邏輯。</p>
                <div className="space-y-2 text-sm">
                  <div><span className="font-medium text-[var(--text-main)]">Constant / Linear</span>：適合簡單平移或傾斜基線。</div>
                  <div><span className="font-medium text-[var(--text-main)]">Shirley</span>：用累積訊號估背景，常見於有台階或長尾的光譜。</div>
                  <div><span className="font-medium text-[var(--text-main)]">Polynomial</span>：用多項式追蹤彎曲基線。</div>
                  <div><span className="font-medium text-[var(--text-main)]">AsLS / airPLS</span>：用懲罰最小平方法估計平滑背景，airPLS 更偏自動化。</div>
                  <div><span className="font-medium text-[var(--text-main)]">Rubber band / Manual anchor</span>：前者抓下包絡，後者由手動錨點決定背景。</div>
                </div>
              </div>
            }>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">背景方法</span>
                <ThemeSelect
                  value={params.bg_method}
                  onChange={value => setParams(current => ({ ...current, bg_enabled: value !== 'none', bg_method: value as ProcessParams['bg_method'] }))}
                  options={BACKGROUND_METHOD_OPTIONS}
                  buttonClassName="text-sm"
                />
              </label>
              <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs leading-6 text-[var(--text-soft)]">
                {BACKGROUND_METHOD_HELP[params.bg_method]}
              </div>
              {params.bg_method !== 'none' && (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--text-soft)]">起點</span>
                      <input type="number" value={params.bg_x_start ?? ''} onChange={e => setParams(current => ({ ...current, bg_x_start: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--text-soft)]">終點</span>
                      <input type="number" value={params.bg_x_end ?? ''} onChange={e => setParams(current => ({ ...current, bg_x_end: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                    </label>
                  </div>
                  {params.bg_method === 'polynomial' && (
                    <label className="mt-3 block">
                      <span className="mb-1 block text-xs text-[var(--text-soft)]">多項式階數</span>
                      <input type="number" value={params.bg_poly_deg} min={2} max={8} onChange={e => setParams(current => ({ ...current, bg_poly_deg: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                    </label>
                  )}
                  {(params.bg_method === 'asls' || params.bg_method === 'airpls') && (
                    <>
                      <label className="mt-3 block">
                        <span className="mb-1 block text-xs text-[var(--text-soft)]">log10(λ)</span>
                        <input type="number" value={Math.log10(params.bg_baseline_lambda)} min={2} max={9} step={0.5} onChange={e => setParams(current => ({ ...current, bg_baseline_lambda: 10 ** Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                      </label>
                      {params.bg_method === 'asls' && (
                        <label className="mt-3 block">
                          <span className="mb-1 block text-xs text-[var(--text-soft)]">峰值抑制 p</span>
                          <input type="number" value={params.bg_baseline_p} min={0.001} max={0.2} step={0.001} onChange={e => setParams(current => ({ ...current, bg_baseline_p: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                        </label>
                      )}
                      <label className="mt-3 block">
                        <span className="mb-1 block text-xs text-[var(--text-soft)]">迭代次數</span>
                        <input type="number" value={params.bg_baseline_iter} min={5} max={50} onChange={e => setParams(current => ({ ...current, bg_baseline_iter: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                      </label>
                    </>
                  )}
                  {params.bg_method === 'manual_anchor' && (
                    <label className="mt-3 block">
                      <span className="mb-1 block text-xs text-[var(--text-soft)]">Anchor points</span>
                      <textarea
                        value={manualAnchorText}
                        onChange={e => {
                          setManualAnchorText(e.target.value)
                          const parsed = parseAnchorText(e.target.value)
                          setParams(current => ({ ...current, bg_anchor_x: parsed.x, bg_anchor_y: parsed.y }))
                        }}
                        className="theme-input min-h-24 w-full rounded-xl px-3 py-2 text-sm"
                        placeholder={'480 0.12\n570 0.10'}
                      />
                    </label>
                  )}
                </>
              )}
            </SidebarCard>

            <SidebarCard step={6} title="平滑" hint="降低高頻雜訊" defaultOpen={false} infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">平滑說明</p>
                <p>平滑用來降低高頻雜訊，但視窗過大可能會把弱峰洗平；建議把它當作視覺輔助而不是過度依賴。</p>
              </div>
            }>
              <label className="mt-4 block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">平滑方法</span>
                <ThemeSelect
                  value={params.smooth_method}
                  onChange={value => setParams(current => ({ ...current, smooth_method: value as ProcessParams['smooth_method'] }))}
                  options={SMOOTH_METHOD_OPTIONS}
                  buttonClassName="text-sm"
                />
              </label>
              {params.smooth_method !== 'none' && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">視窗</span>
                    <input type="number" value={params.smooth_window} min={3} max={301} step={2} onChange={e => setParams(current => ({ ...current, smooth_window: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                  {params.smooth_method === 'savitzky_golay' && (
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--text-soft)]">多項式</span>
                      <input type="number" value={params.smooth_poly} min={2} max={5} onChange={e => setParams(current => ({ ...current, smooth_poly: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                    </label>
                  )}
                </div>
              )}
            </SidebarCard>

            <SidebarCard step={7} title="歸一化" hint="設定強度正規化方式" defaultOpen={false} infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">歸一化說明</p>
                <p>歸一化方便比較不同 Raman 光譜的峰型與相對強度，但不適合用來保留絕對訊號高低。</p>
              </div>
            }>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">歸一化方法</span>
                <ThemeSelect
                  value={params.norm_method}
                  onChange={value => setParams(current => ({ ...current, norm_method: value as ProcessParams['norm_method'] }))}
                  options={NORMALIZATION_OPTIONS}
                  buttonClassName="text-sm"
                />
              </label>
              {params.norm_method !== 'none' && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">起點</span>
                    <input type="number" value={params.norm_x_start ?? ''} onChange={e => setParams(current => ({ ...current, norm_x_start: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">終點</span>
                    <input type="number" value={params.norm_x_end ?? ''} onChange={e => setParams(current => ({ ...current, norm_x_end: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                </div>
              )}

            </SidebarCard>

            <SidebarCard step={8} title="峰偵測與參考峰" hint="快速掃峰、選擇參考材料" defaultOpen={false} infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">峰偵測與參考峰說明</p>
                <p>先找出可能峰位，再用參考材料或 peak library 輔助建立後續擬合模型。</p>
              </div>
            }>
              <TogglePill
                checked={peakParams.enabled}
                onChange={value => setPeakParams(current => ({ ...current, enabled: value }))}
                label="啟用峰偵測"
              />
              {peakParams.enabled && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">Prominence</span>
                    <input type="number" value={peakParams.prominence} min={0.001} max={1} step={0.01} onChange={e => setPeakParams(current => ({ ...current, prominence: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">Height ratio</span>
                    <input type="number" value={peakParams.height_ratio} min={0} max={1} step={0.01} onChange={e => setPeakParams(current => ({ ...current, height_ratio: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">最小峰距</span>
                    <input type="number" value={peakParams.min_distance} min={1} max={200} step={1} onChange={e => setPeakParams(current => ({ ...current, min_distance: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">最大峰數</span>
                    <input type="number" value={peakParams.max_peaks} min={1} max={100} step={1} onChange={e => setPeakParams(current => ({ ...current, max_peaks: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                  </label>
                </div>
              )}

              <label className="mt-4 block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">參考材料</span>
                <select
                  multiple
                  value={selectedRefs}
                  onChange={e => setSelectedRefs(Array.from(e.target.selectedOptions).map(option => option.value))}
                  className="theme-input min-h-40 w-full rounded-2xl px-3 py-2 text-sm"
                >
                  {refMaterials.map(material => (
                    <option key={material} value={material}>{material}</option>
                  ))}
                </select>
              </label>
              <div className="mt-2 text-[11px] text-[var(--text-soft)]">可多選。圖上會加參考峰線，並可直接載入到下方峰位表。</div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={loadReferencePeaksToCandidates}
                  className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]"
                >
                  載入參考峰
                </button>
                <button
                  type="button"
                  onClick={loadPeakLibraryToCandidates}
                  className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]"
                >
                  載入 library
                </button>
              </div>

              <div className="mt-4 rounded-[18px] border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                  Peak library
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={exportPeakLibrary}
                    className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]"
                  >
                    匯出 library JSON
                  </button>
                  <label className="theme-pill pressable cursor-pointer rounded-xl px-3 py-2 text-center text-xs font-semibold text-[var(--accent)]">
                    匯入 library JSON
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) importPeakLibrary(f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
                <div className="mt-2 text-[11px] text-[var(--text-soft)]">{peakLibrary.length} peaks loaded</div>
              </div>
            </SidebarCard>

            <SidebarCard step={9} title="峰位管理與擬合" hint="載入參考峰、手動加峰、執行擬合" defaultOpen={false} infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">峰位管理與擬合說明</p>
                <p>這一步負責整理峰位表、加入手動峰與執行擬合；我這次只改外觀與資訊層，不改擬合流程。</p>
              </div>
            }>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">預設 FWHM</span>
                <input
                  type="number"
                  value={fitDefaultFwhm}
                  min={0.5}
                  max={200}
                  step={0.5}
                  onChange={e => setFitDefaultFwhm(Number(e.target.value))}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setFitCandidates([])}
                  className="theme-block-soft pressable w-full rounded-xl px-3 py-2 text-sm font-medium text-[var(--text-main)]"
                >
                  清空峰位表
                </button>
              </div>

              <details className="mt-3 rounded-[18px] border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--text-main)]">手動新增峰</summary>
                <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">手動材料</span>
                  <input
                    type="text"
                    value={manualPeakMaterial}
                    onChange={e => setManualPeakMaterial(e.target.value)}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                    placeholder="可留白"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">峰名稱</span>
                  <input
                    type="text"
                    value={manualPeakLabel}
                    onChange={e => setManualPeakLabel(e.target.value)}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                    placeholder="可留白"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">峰位 cm⁻¹</span>
                  <input
                    type="number"
                    value={manualPeakPosition ?? ''}
                    onChange={e => setManualPeakPosition(Number(e.target.value))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">FWHM</span>
                  <input
                    type="number"
                    value={manualPeakFwhm}
                    min={0.5}
                    max={200}
                    step={0.5}
                    onChange={e => setManualPeakFwhm(Number(e.target.value))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">容許 ±cm⁻¹</span>
                  <input
                    type="number"
                    value={manualPeakTolerance}
                    min={0}
                    max={100}
                    step={0.5}
                    onChange={e => setManualPeakTolerance(Number(e.target.value))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">Profile</span>
                  <ThemeSelect
                    value={manualPeakProfile}
                    onChange={value => setManualPeakProfile(value as RamanProfile)}
                    options={PROFILE_OPTIONS}
                    buttonClassName="text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">FWHM min</span>
                  <input
                    type="number"
                    value={manualPeakFwhmMin}
                    min={0.1}
                    max={300}
                    step={0.5}
                    onChange={e => setManualPeakFwhmMin(Number(e.target.value))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">FWHM max</span>
                  <input
                    type="number"
                    value={manualPeakFwhmMax}
                    min={0.2}
                    max={400}
                    step={1}
                    onChange={e => setManualPeakFwhmMax(Number(e.target.value))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                  />
                </label>
                </div>

                <button
                  type="button"
                  onClick={addManualPeakCandidate}
                  className="theme-pill pressable mt-3 w-full rounded-xl px-3 py-2 text-sm font-medium text-[var(--accent)]"
                >
                  新增手動峰
                </button>
              </details>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">擬合對象</span>
                  <ThemeSelect
                    value={fitTargetName}
                    onChange={setFitTargetName}
                    options={(result?.datasets ?? []).map(dataset => ({ value: dataset.name, label: dataset.name }))}
                    buttonClassName="text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">擬合輪廓</span>
                  <ThemeSelect
                    value={fitParams.profile}
                    onChange={value => setFitParams(current => ({ ...current, profile: value as FitParams['profile'] }))}
                    options={PROFILE_OPTIONS}
                    buttonClassName="text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">單次擬合迭代上限</span>
                  <input
                    type="number"
                    value={fitParams.maxfev}
                    min={1000}
                    max={100000}
                    step={1000}
                    onChange={e => setFitParams(current => ({ ...current, maxfev: Number(e.target.value) }))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">Robust loss</span>
                  <ThemeSelect
                    value={fitParams.robust_loss}
                    onChange={value => setFitParams(current => ({ ...current, robust_loss: value as FitParams['robust_loss'] }))}
                    options={ROBUST_LOSS_OPTIONS}
                    buttonClassName="text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => applyProfileToSuggestedPeaks('split_pseudo_voigt')}
                  disabled={peakTableRows.every(row => !row.suggested)}
                  className="theme-pill pressable self-end rounded-xl px-3 py-2 text-sm font-medium text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  建議峰用 asymmetric
                </button>
                <button
                  type="button"
                  onClick={applyFlexibleProfileToLowShiftPeaks}
                  className="theme-pill pressable self-end rounded-xl px-3 py-2 text-sm font-medium text-[var(--accent)]"
                >
                  ≤500 cm⁻¹ 用 asymmetric
                </button>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">自動二次擬合最多回合</span>
                  <input
                    type="number"
                    value={autoRefitMaxRounds}
                    min={1}
                    max={20}
                    step={1}
                    onChange={e => setAutoRefitMaxRounds(Number(e.target.value))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                  />
                </label>
                <label className="theme-block-soft flex items-center gap-2 self-end rounded-xl px-3 py-2 text-sm text-[var(--text-main)]">
                  <input
                    type="checkbox"
                    checked={fitParams.residual_target_enabled}
                    onChange={e => setFitParams(current => ({ ...current, residual_target_enabled: e.target.checked }))}
                    className="h-4 w-4 accent-[var(--accent-strong)]"
                  />
                  <span>強制 residual 目標</span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">Max |residual| 目標</span>
                  <input
                    type="number"
                    value={fitParams.residual_target}
                    min={0.001}
                    max={1}
                    step={0.005}
                    onChange={e => setFitParams(current => ({ ...current, residual_target: Number(e.target.value) }))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">Residual 強制回合</span>
                  <input
                    type="number"
                    value={fitParams.residual_target_rounds}
                    min={1}
                    max={8}
                    step={1}
                    onChange={e => setFitParams(current => ({ ...current, residual_target_rounds: Number(e.target.value) }))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">局部擬合起點</span>
                  <input
                    type="number"
                    value={fitParams.fit_lo ?? ''}
                    onChange={e => setFitParams(current => ({ ...current, fit_lo: e.target.value === '' ? null : Number(e.target.value) }))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                    placeholder="全域"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">局部擬合終點</span>
                  <input
                    type="number"
                    value={fitParams.fit_hi ?? ''}
                    onChange={e => setFitParams(current => ({ ...current, fit_hi: e.target.value === '' ? null : Number(e.target.value) }))}
                    className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                    placeholder="全域"
                  />
                </label>
              </div>

              <div className="mt-3 rounded-[18px] border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                  區段權重
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    value={segmentWeightLo}
                    onChange={e => setSegmentWeightLo(Number(e.target.value))}
                    className="theme-input rounded-xl px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    value={segmentWeightHi}
                    onChange={e => setSegmentWeightHi(Number(e.target.value))}
                    className="theme-input rounded-xl px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    value={segmentWeightValue}
                    min={0}
                    max={10}
                    step={0.05}
                    onChange={e => setSegmentWeightValue(Number(e.target.value))}
                    className="theme-input rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const segment: SegmentWeight = { lo: segmentWeightLo, hi: segmentWeightHi, weight: segmentWeightValue }
                    setFitParams(current => ({ ...current, segment_weights: [segment] }))
                  }}
                  className="theme-pill pressable mt-2 w-full rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]"
                >
                  套用區段權重（可降低 Si 520 權重）
                </button>
              </div>

              <button
                type="button"
                onClick={() => void runPeakFit()}
                disabled={isFitting || !activeFitDataset}
                className="theme-pill pressable mt-3 w-full rounded-xl px-3 py-2 text-sm font-semibold text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isFitting ? '峰擬合中…' : `執行峰擬合 (${fitCandidates.filter(item => item.enabled).length})`}
              </button>

              <button
                type="button"
                onClick={() => void runBatchFit()}
                disabled={isFitting || !result}
                className="theme-block-soft pressable mt-2 w-full rounded-xl px-3 py-2 text-sm font-semibold text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                批次套用同一套 peak model
              </button>

              <div className="mt-4 rounded-[18px] border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                  可疑峰停用條件
                </div>
                <div className="space-y-2">
                  {REVIEW_RULE_OPTIONS.map(option => (
                    <label key={option.id} className="theme-block-soft flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-[var(--text-main)]">
                      <input
                        type="checkbox"
                        checked={selectedReviewRules.includes(option.id)}
                        onChange={e => {
                          setSelectedReviewRules(current => (
                            e.target.checked
                              ? [...current, option.id]
                              : current.filter(item => item !== option.id)
                          ))
                        }}
                        className="h-4 w-4 accent-[var(--accent-strong)]"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">Area% 門檻</span>
                    <input
                      type="number"
                      value={reviewMinAreaPct}
                      min={0}
                      max={100}
                      step={0.1}
                      onChange={e => setReviewMinAreaPct(Number(e.target.value))}
                      className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--text-soft)]">|Δ| 門檻 cm⁻¹</span>
                    <input
                      type="number"
                      value={reviewMaxAbsDelta}
                      min={0}
                      max={200}
                      step={0.5}
                      onChange={e => setReviewMaxAbsDelta(Number(e.target.value))}
                      className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <label className="theme-block-soft mt-3 flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-[var(--text-main)]">
                  <input
                    type="checkbox"
                    checked={autoRefitStopWhenClean}
                    onChange={e => setAutoRefitStopWhenClean(e.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-strong)]"
                  />
                  <span>沒有新的可疑峰時自動停止</span>
                </label>

                <button
                  type="button"
                  onClick={() => void runAutoRefit()}
                  disabled={isFitting || !activeFitDataset}
                  className="theme-pill pressable mt-3 w-full rounded-xl px-3 py-2 text-sm font-semibold text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isFitting ? '自動二次擬合中…' : '依停用條件自動二次擬合'}
                </button>

                <button
                  type="button"
                  onClick={() => void runAutoDebugRefit()}
                  disabled={isFitting || !activeFitDataset}
                  className="theme-block-soft pressable mt-2 w-full rounded-xl px-3 py-2 text-sm font-semibold text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isFitting ? '自動偵錯中…' : '自動偵錯並修改後再擬合'}
                </button>
              </div>

              <div className="mt-4 rounded-[18px] border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                  Preset 匯入 / 匯出
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={exportPreset}
                    className="theme-pill pressable flex-1 rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]"
                  >
                    匯出 JSON
                  </button>
                  <label className="theme-pill pressable flex-1 cursor-pointer rounded-xl px-3 py-2 text-center text-xs font-semibold text-[var(--accent)]">
                    匯入 JSON
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) importPreset(f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
                <p className="mt-2 text-[10px] text-[var(--text-soft)]">儲存目前的處理參數與峰位表，下次可直接載入。</p>
              </div>
            </SidebarCard>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-8 sm:px-8 xl:px-10 xl:py-10">
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

          <InfoCardGrid
            items={[
              { label: '資料集', value: activeDataset?.name ?? '未載入' },
              { label: '平均模式', value: params.average ? '開啟' : '關閉' },
              { label: '參考峰', value: `${refPeaks.length}` },
            ]}
          />

          {error && (
            <div className="mb-5 rounded-[18px] border border-[color:color-mix(in_srgb,var(--accent-secondary)_28%,var(--card-border))] bg-[color:color-mix(in_srgb,var(--accent-secondary)_12%,transparent)] px-4 py-3 text-sm text-[var(--text-main)]">
              {error}
            </div>
          )}

          {!activeDataset && !isLoading && (
            <EmptyWorkspaceState
              module="raman"
              title={moduleContent.uploadTitle}
              description="左側已提供去尖峰、多檔平均、背景扣除、平滑、歸一化、參考峰與峰值偵測。上傳之後會在這裡顯示 Raman 圖譜與分析結果。"
              formats={moduleContent.formats}
            />
          )}

          {isLoading && (
            <div className="theme-pill inline-flex rounded-full px-4 py-2 text-sm font-medium text-[var(--accent)]">
              處理中…
            </div>
          )}

          {activeDataset && (
            <>
              <ProcessingWorkspaceHeader
                tabs={topTabs}
                isOverlayView={isOverlayView}
                overlaySelectionCount={overlaySelection.length}
                onOpenOverlaySelector={() => setOverlaySelectorOpen(true)}
                stats={[
                  { label: '資料集', value: `${rawFiles.length} 個` },
                  { label: 'Raman 範圍', value: ramanRangeLabel },
                  { label: '內插點數', value: interpolationLabel },
                ]}
              />

              {rawChartTraces.length > 0 && (
                <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <p className="mb-2 text-sm font-semibold text-[var(--text-main)]">1. 原始 Raman</p>
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
                            <ThemeSelect
                              value={colorKey}
                              onChange={value => {
                                const targetIndex = globalIndex >= 0 ? globalIndex : index
                                setRawFileColors(prev => {
                                  const next = [...prev]
                                  next[targetIndex] = value
                                  return next
                                })
                              }}
                              options={LINE_COLOR_OPTIONS}
                              className="w-[5.6rem]"
                              buttonClassName="min-h-7 rounded-lg px-2 py-0.5 text-[10px]"
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <Plot
                    data={applyHidden(rawChartTraces, rawHidden)}
                    layout={chartLayout()}
                    config={withPlotFullscreen({ scrollZoom: true })}
                    style={{ width: '100%', minHeight: '340px' }}
                    onLegendClick={makeLegendClick(setRawHidden) as never}
                    onLegendDoubleClick={() => false}
                    useResizeHandler
                  />
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(rawStageDatasets, 'raman_shift_cm-1', 'intensity_raw'), 'raman_raw_stage.csv', 'text/csv')}
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
                  <p className="mb-3 text-xs text-[var(--text-soft)]">這裡改成跟 XPS 一樣的疊圖卡片流程，直接比對多筆 Raman 的最終處理結果。</p>
                  <Plot
                    data={applyHidden(overlayChartTraces, overlayHidden)}
                    layout={chartLayout()}
                    config={withPlotFullscreen({ scrollZoom: true })}
                    style={{ width: '100%', minHeight: '340px' }}
                    onLegendClick={makeLegendClick(setOverlayHidden) as never}
                    onLegendDoubleClick={() => false}
                    useResizeHandler
                  />
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(overlayStageDatasets, 'raman_shift_cm-1', 'intensity_processed'), 'raman_overlay_stage.csv', 'text/csv')}
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
                  <p className="mb-3 text-xs text-[var(--text-soft)]">把原始訊號與去尖峰或前處理後結果疊在一起，方便快速檢查變化量。</p>
                  <Plot
                    data={applyHidden(preprocessChartTraces, preprocessHidden)}
                    layout={chartLayout()}
                    config={withPlotFullscreen({ scrollZoom: true })}
                    style={{ width: '100%', minHeight: '340px' }}
                    onLegendClick={makeLegendClick(setPreprocessHidden) as never}
                    onLegendDoubleClick={() => false}
                    useResizeHandler
                  />
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(preprocessStageDatasets, 'raman_shift_cm-1', 'intensity_processed'), 'raman_preprocess_stage.csv', 'text/csv')}
                      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                    >
                      下載此步驟 CSV
                    </button>
                  </div>
                </div>
              )}

              {!isOverlayView && backgroundChartTraces.length > 0 && (
                <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <ChartToolbar
                    title="3. 背景扣除"
                    colorValue={chartLineColors.background}
                    onColorChange={value => setChartLineColors(current => ({ ...current, background: value }))}
                  />
                  <p className="mb-3 text-xs text-[var(--text-soft)]">這張圖把背景基準線和扣除後光譜分開標出，顯示方式比照 XPS 背景步驟。</p>
                  <Plot
                    data={applyHidden(backgroundChartTraces, backgroundHidden)}
                    layout={chartLayout()}
                    config={withPlotFullscreen({ scrollZoom: true })}
                    style={{ width: '100%', minHeight: '340px' }}
                    onLegendClick={makeLegendClick(setBackgroundHidden) as never}
                    onLegendDoubleClick={() => false}
                    useResizeHandler
                  />
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(backgroundStageDatasets, 'raman_shift_cm-1', 'intensity_processed'), 'raman_background_stage.csv', 'text/csv')}
                      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                    >
                      下載此步驟 CSV
                    </button>
                  </div>
                </div>
              )}

              {!isOverlayView && finalChartTraces.length > 0 && (
                <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <ChartToolbar
                    title="4. 最終處理光譜"
                    colorValue={chartLineColors.final}
                    onColorChange={value => setChartLineColors(current => ({ ...current, final: value }))}
                  />
                  <p className="mb-3 text-xs text-[var(--text-soft)]">把最終 Raman、參考峰和偵測峰位收斂到同一張圖卡，互動方式與 XPS 最終圖一致。</p>
                  <Plot
                    data={applyHidden(finalChartTraces, finalHidden)}
                    layout={chartLayout()}
                    config={withPlotFullscreen({ scrollZoom: true })}
                    style={{ width: '100%', minHeight: '420px' }}
                    onLegendClick={makeLegendClick(setFinalHidden) as never}
                    onLegendDoubleClick={() => false}
                    useResizeHandler
                  />
                  <div className="mt-3 flex justify-start">
                    <button
                      type="button"
                      onClick={() => downloadFile(buildStageCsv(finalStageDatasets, 'raman_shift_cm-1', 'intensity_processed'), 'raman_final_stage.csv', 'text/csv')}
                      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                    >
                      下載此步驟 CSV
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-5 theme-block rounded-[20px] p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-muted)]">峰位表</div>
                    <div className="mt-1 text-xs text-[var(--text-soft)]">點擊峰名稱可修改詳細設定；建議修改項會在狀態欄標記。</div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="theme-pill rounded-full px-3 py-1.5 text-[var(--text-main)]">總峰數 {fitCandidates.length}</span>
                    <span className="theme-pill rounded-full px-3 py-1.5 text-[var(--text-main)]">建議修改 {peakTableRows.filter(row => row.suggested).length}</span>
                  </div>
                </div>
                {fitCandidates.length > 0 ? (
                  <div className="overflow-hidden">
                    <table className="min-w-0 w-full table-fixed border-collapse text-left text-xs sm:text-sm">
                      <colgroup>
                        <col style={{ width: '4%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '19%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '17%' }} />
                      </colgroup>
                      <thead className="bg-[color:color-mix(in_srgb,var(--card-bg-strong)_72%,transparent)]">
                        <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.06em] text-slate-400">
                          <th className="px-2 py-3 text-center font-medium">啟用</th>
                          <th className="px-2 py-3 font-medium">ID</th>
                          <th className="px-2 py-3 font-medium">峰名稱</th>
                          <th className="px-2 py-3 text-right font-medium">位置 cm⁻¹</th>
                          <th className="px-2 py-3 font-medium">Profile</th>
                          <th className="px-2 py-3 text-right font-medium">理論 cm⁻¹</th>
                          <th className="px-2 py-3 text-right font-medium">Δ cm⁻¹</th>
                          <th className="px-2 py-3 text-right font-medium">FWHM</th>
                          <th className="px-2 py-3 text-right font-medium">Area%</th>
                          <th className="px-2 py-3 font-medium">狀態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {peakTableRows.map(({ candidate, row, status, suggested, position, profile, theoretical, delta, fwhm, areaPct }) => (
                          <tr
                            key={candidate.peak_id}
                            className={[
                              'border-b border-white/5 text-[var(--text-main)] last:border-b-0',
                              suggested ? 'bg-[color:color-mix(in_srgb,var(--accent-secondary)_10%,transparent)]' : '',
                            ].join(' ')}
                          >
                            <td className="px-2 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={candidate.enabled}
                                onChange={e => updateFitCandidate(candidate.peak_id, { enabled: e.target.checked })}
                                className="h-4 w-4 accent-[var(--accent-strong)]"
                              />
                            </td>
                            <td className="break-all px-2 py-3 font-mono text-[11px]">{candidate.peak_id}</td>
                            <td className="px-2 py-3">
                              <button
                                type="button"
                                onClick={() => setEditingPeakId(candidate.peak_id)}
                                className="break-words text-left font-semibold leading-snug text-[var(--text-muted)] underline-offset-4 hover:text-[var(--accent)] hover:underline"
                              >
                                {candidate.display_name || candidate.label}
                              </button>
                              <div className="mt-1 break-words text-[11px] leading-snug text-[var(--text-soft)]">
                                {candidate.phase || candidate.material || '未指定 phase'} · {candidate.species || 'species 未設定'}
                              </div>
                            </td>
                            <td className="px-2 py-3 text-right tabular-nums">{position.toFixed(1)}</td>
                            <td className="break-words px-2 py-3">{profile}</td>
                            <td className="px-2 py-3 text-right tabular-nums">{theoretical == null ? 'None' : theoretical.toFixed(1)}</td>
                            <td className="px-2 py-3 text-right tabular-nums">{delta == null ? 'None' : delta.toFixed(1)}</td>
                            <td className="px-2 py-3 text-right tabular-nums">{fwhm.toFixed(1)}</td>
                            <td className="px-2 py-3 text-right tabular-nums">{areaPct == null ? '—' : areaPct.toFixed(2)}</td>
                            <td className="px-2 py-3 align-middle">
                              <span className={[
                                'inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
                                status === 'OK'
                                  ? 'bg-[color:color-mix(in_srgb,var(--accent-tertiary)_14%,transparent)] text-[var(--accent-tertiary)]'
                                  : status === '待擬合'
                                    ? 'bg-white/5 text-[var(--text-soft)]'
                                    : 'bg-[color:color-mix(in_srgb,var(--accent-secondary)_18%,transparent)] text-[var(--accent-secondary)]',
                              ].join(' ')}
                              >
                                {status}
                              </span>
                              {row?.Quality_Flags?.length ? (
                                <div className="mt-1 break-words text-[11px] leading-relaxed text-[var(--text-soft)]">{row.Quality_Flags.join(' / ')}</div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-6 text-sm text-[var(--text-soft)]">
                    先在左側「峰偵測與參考峰」載入 reference/library，或在「峰位管理與擬合」新增手動峰。
                  </div>
                )}
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="theme-block rounded-[28px] p-4">
                  <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">偵測到的峰</div>
                  {peakParams.enabled && detectedPeaks.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">位置 cm⁻¹</th>
                            <th className="px-3 py-3 font-medium">強度</th>
                            <th className="px-3 py-3 font-medium">相對強度 %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detectedPeaks.map((peak, idx) => (
                            <tr key={`${peak.shift_cm}-${idx}`} className="border-b border-white/5 text-[var(--text-main)] last:border-b-0">
                              <td className="px-3 py-3">{peak.shift_cm.toFixed(2)}</td>
                              <td className="px-3 py-3">{peak.intensity.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.rel_intensity.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--text-soft)]">尚未啟用峰偵測，或目前沒有可列出的結果。</div>
                  )}
                </div>

                <div className="theme-block rounded-[28px] p-4">
                  <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">參考峰清單</div>
                  {refPeaks.length > 0 ? (
                    <div className="max-h-[26rem] overflow-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">材料</th>
                            <th className="px-3 py-3 font-medium">位置</th>
                            <th className="px-3 py-3 font-medium">標籤</th>
                          </tr>
                        </thead>
                        <tbody>
                          {refPeaks.map((peak, idx) => (
                            <tr key={`${peak.material}-${peak.position_cm}-${idx}`} className="border-b border-white/5 text-[var(--text-main)] last:border-b-0">
                              <td className="px-3 py-3">{peak.material}</td>
                              <td className="px-3 py-3">{peak.position_cm.toFixed(1)}</td>
                              <td className="px-3 py-3">{peak.label || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--text-soft)]">左側選擇參考材料後，這裡會列出對應 Raman reference peaks。</div>
                  )}
                </div>
              </div>

              <div className="mt-5 theme-block rounded-[28px] p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-muted)]">峰擬合結果</div>
                    <div className="mt-1 text-xs text-[var(--text-soft)]">
                      這裡保留最近一次擬合結果，修改峰位表時可先對照；重新執行擬合後更新。
                    </div>
                  </div>
                  {fitResult?.success && (
                    <div className="flex flex-wrap gap-2">
                      <div className="theme-pill rounded-full px-4 py-2 text-sm text-[var(--text-main)]">
                        R² <span className="ml-2 font-semibold text-[var(--text-muted)]">{fitResult.r_squared.toFixed(5)}</span>
                      </div>
                      <div className="theme-pill rounded-full px-4 py-2 text-sm text-[var(--text-main)]">
                        adj R² <span className="ml-2 font-semibold text-[var(--text-muted)]">{fitResult.adjusted_r_squared.toFixed(5)}</span>
                      </div>
                      <div className="theme-pill rounded-full px-4 py-2 text-sm text-[var(--text-main)]">
                        RMSE <span className="ml-2 font-semibold text-[var(--text-muted)]">{fitResult.rmse.toExponential(2)}</span>
                      </div>
                      <div className="theme-pill rounded-full px-4 py-2 text-sm text-[var(--text-main)]">
                        AIC/BIC <span className="ml-2 font-semibold text-[var(--text-muted)]">{fitResult.aic.toFixed(1)} / {fitResult.bic.toFixed(1)}</span>
                      </div>
                      {autoRefitSummary && (
                        <div className="theme-pill rounded-full px-4 py-2 text-sm text-[var(--text-main)]">
                          自動回合 <span className="ml-2 font-semibold text-[var(--text-muted)]">{autoRefitSummary.rounds}</span>
                        </div>
                      )}
                      {autoDebugSummary && (
                        <div className="theme-pill rounded-full px-4 py-2 text-sm text-[var(--text-main)]">
                          偵錯回合 <span className="ml-2 font-semibold text-[var(--text-muted)]">{autoDebugSummary.rounds}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {fitResult?.success && activeFitDataset ? (
                  <>
                    {fitResult.message && (
                      <div className="mb-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-4 py-3 text-sm text-[var(--text-main)]">
                        {fitResult.message}
                      </div>
                    )}
                    <div className="theme-block-soft rounded-[24px] p-3 sm:p-4">
                      <Plot
                        data={fitChartTraces(activeFitDataset, fitResult)}
                        layout={fitChartLayout()}
                        config={withPlotFullscreen({ scrollZoom: true })}
                        style={{ width: '100%', minHeight: '520px' }}
                        useResizeHandler
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={exportFitCsv} className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]">匯出 CSV</button>
                      <button type="button" onClick={exportFitExcel} className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]">匯出 Excel</button>
                      <button type="button" onClick={exportFitJson} className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]">匯出 JSON summary</button>
                    </div>

                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">峰名稱</th>
                            <th className="px-3 py-3 font-medium">Phase / Mode</th>
                            <th className="px-3 py-3 font-medium">Species</th>
                            <th className="px-3 py-3 font-medium">Oxidation</th>
                            <th className="px-3 py-3 font-medium">Profile</th>
                            <th className="px-3 py-3 font-medium">中心 cm⁻¹</th>
                            <th className="px-3 py-3 font-medium">Δ cm⁻¹</th>
                            <th className="px-3 py-3 font-medium">FWHM</th>
                            <th className="px-3 py-3 font-medium">Area %</th>
                            <th className="px-3 py-3 font-medium">Fit status</th>
                            <th className="px-3 py-3 font-medium">Physical confidence</th>
                            <th className="px-3 py-3 font-medium">Flags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fitResult.peaks.map(row => (
                            <tr key={row.Peak_ID || `${row.Peak_Name}-${row.Center_cm}`} className="border-b border-white/5 text-[var(--text-main)] last:border-b-0">
                              <td className="px-3 py-3">
                                <div>{row.Peak_Name}</div>
                                <div className="text-[11px] text-[var(--text-soft)]">{row.Center_cm.toFixed(1)} cm⁻¹</div>
                              </td>
                              <td className="px-3 py-3">{row.Phase || row.Material}<div className="text-[11px] text-[var(--text-soft)]">{row.Mode_Label || '—'}</div></td>
                              <td className="px-3 py-3">{row.Species || '—'}</td>
                              <td className="px-3 py-3">{row.Oxidation_State}<div className="text-[11px] text-[var(--text-soft)]">{row.Oxidation_State_Inference}</div></td>
                              <td className="px-3 py-3">{row.Profile}</td>
                              <td className="px-3 py-3">{row.Center_cm.toFixed(3)}</td>
                              <td className="px-3 py-3">{row.Delta_cm == null ? '—' : row.Delta_cm.toFixed(3)}</td>
                              <td className="px-3 py-3">{row.FWHM_cm.toFixed(3)}</td>
                              <td className="px-3 py-3">{row.Area_pct.toFixed(2)}</td>
                              <td className="px-3 py-3">{row.Fit_Status}</td>
                              <td className="px-3 py-3">{row.Physical_Confidence || row.Confidence}</td>
                              <td className="px-3 py-3">{row.Quality_Flags.length ? row.Quality_Flags.join(' / ') : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="theme-block-soft rounded-[22px] p-4">
                        <div className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Residual diagnostics</div>
                        <div className="grid grid-cols-2 gap-2 text-sm text-[var(--text-main)]">
                          <div>Global RMSE</div>
                          <div>{fitResult.residual_diagnostics.Global_RMSE.toExponential(2)}</div>
                          <div>Max |residual|</div>
                          <div>{fitResult.residual_diagnostics.Global_MaxAbs.toExponential(2)}</div>
                          <div>Max region</div>
                          <div>{fitResult.residual_diagnostics.Max_Residual_Range || '—'}</div>
                          <div>480–570 RMSE</div>
                          <div>{fitResult.residual_diagnostics.Segment_480_570_RMSE == null ? '—' : fitResult.residual_diagnostics.Segment_480_570_RMSE.toExponential(2)}</div>
                        </div>
                        {fitResult.residual_diagnostics.Suggestions.length > 0 && (
                          <div className="mt-3 space-y-1 text-xs text-[var(--text-soft)]">
                            {fitResult.residual_diagnostics.Suggestions.map(item => (
                              <div key={item}>{item}</div>
                            ))}
                          </div>
                        )}
                        {fitResult.residual_diagnostics.Local_Ranges?.length > 0 && (
                          <div className="mt-3 grid gap-2">
                            {fitResult.residual_diagnostics.Local_Ranges.map(item => (
                              <div key={item.Range} className="rounded-xl border border-[var(--card-border)] px-3 py-2 text-xs text-[var(--text-main)]">
                                <span className="font-semibold">{item.Range}</span>
                                <span className="ml-2 text-[var(--text-soft)]">
                                  RMSE {item.RMSE == null ? '—' : item.RMSE.toExponential(2)} · Max {item.MaxAbs == null ? '—' : item.MaxAbs.toExponential(2)}
                                </span>
                                {item.Warning && <span className="ml-2 text-[var(--accent-secondary)]">{item.Warning}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="theme-block-soft rounded-[22px] p-4">
                        <div className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Phase group consistency</div>
                        {fitResult.group_summaries.length > 0 ? (
                          <div className="space-y-2">
                            {fitResult.group_summaries.map(group => (
                              <div key={group.Phase_Group} className="rounded-xl border border-[var(--card-border)] px-3 py-2 text-sm text-[var(--text-main)]">
                                <div className="font-medium">{group.Phase_Group}</div>
                                <div className="mt-1 text-xs text-[var(--text-soft)]">
                                  shift {group.Group_Shift_cm.toFixed(2)} cm⁻¹ · spacing error {group.Mean_Spacing_Error_cm.toFixed(2)} · score {group.Group_Consistency_Score.toFixed(0)} · {group.Status}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-[var(--text-soft)]">同一 phase 至少需要兩個參考峰才會計算 spacing consistency。</div>
                        )}
                      </div>
                    </div>

                    {/* Si stress card */}
                    {siPeak && (
                      <div className="mt-4 rounded-[22px] border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                        <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">Si 應力估算</div>
                        <p className="mb-3 text-xs text-[var(--text-soft)]">
                          偵測到 Si 峰（{siPeak.Center_cm.toFixed(2)} cm⁻¹）。Anastassakis et al. (1990) 方法。
                        </p>
                        <div className="mb-3 grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">參考位置 (cm⁻¹)</span>
                            <input
                              type="number"
                              value={siRefPos}
                              step={0.1}
                              onChange={e => setSiRefPos(Number(e.target.value))}
                              className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">係數 (cm⁻¹/GPa)</span>
                            <input
                              type="number"
                              value={siCoeff}
                              step={0.01}
                              onChange={e => setSiCoeff(Number(e.target.value))}
                              className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                            />
                          </label>
                        </div>
                        {(() => {
                          const deltaOmega = siPeak.Center_cm - siRefPos
                          const stress = Math.abs(siCoeff) > 1e-10 ? deltaOmega / siCoeff : null
                          const label = stress == null
                            ? '係數為零，無法計算'
                            : stress < -0.05
                              ? '壓應力 (Compressive)'
                              : stress > 0.05
                                ? '拉應力 (Tensile)'
                                : '接近無應力'
                          return (
                            <div className="grid grid-cols-3 gap-3">
                              <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">Δω</p>
                                <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">{deltaOmega.toFixed(2)} cm⁻¹</p>
                              </div>
                              <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">σ</p>
                                <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">{stress != null ? `${stress.toFixed(3)} GPa` : '—'}</p>
                              </div>
                              <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">類型</p>
                                <p className="mt-1 text-xs font-semibold text-[var(--text-main)]">{label}</p>
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    )}

                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="theme-block-soft rounded-[22px] p-4">
                        <div className="mb-2 text-sm font-semibold text-[var(--text-muted)]">非可疑峰名稱</div>
                        {cleanFitPeaks.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {cleanFitPeaks.map(item => (
                              <span key={item.row.Peak_ID || item.row.Peak_Name} className="theme-pill rounded-full px-3 py-1.5 text-sm text-[var(--text-main)]">
                                {fitPeakLabel(item.row)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-[var(--text-soft)]">目前沒有被判定為非可疑的峰。</div>
                        )}
                      </div>

                      <div className="theme-block-soft rounded-[22px] p-4">
                        <div className="mb-2 text-sm font-semibold text-[var(--text-muted)]">可疑峰清單</div>
                        {suspiciousFitPeaks.length > 0 ? (
                          <div className="space-y-2">
                            {suspiciousFitPeaks.map(item => (
                              <div key={item.row.Peak_ID || item.row.Peak_Name} className="rounded-xl border border-[var(--card-border)] px-3 py-2 text-sm text-[var(--text-main)]">
                                <span className="font-medium">{fitPeakLabel(item.row)}</span>
                                <span className="ml-2 text-[var(--text-soft)]">{item.flags.join(' / ')}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-[var(--text-soft)]">目前沒有可疑峰。</div>
                        )}
                      </div>
                    </div>

                    {autoRefitSummary && (
                      <div className="mt-4 theme-block-soft rounded-[22px] p-4">
                        <div className="mb-2 text-sm font-semibold text-[var(--text-muted)]">自動二次擬合摘要</div>
                        <div className="text-sm text-[var(--text-main)]">
                          停止原因：{autoRefitSummary.stopReason}
                        </div>
                        <div className="mt-2 text-sm text-[var(--text-main)]">
                          停用峰數：{autoRefitSummary.disabledPeakIds.length}
                        </div>
                        {autoRefitSummary.disabledPeakNames.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {autoRefitSummary.disabledPeakNames.map(name => (
                              <span key={name} className="theme-pill rounded-full px-3 py-1.5 text-sm text-[var(--text-main)]">
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {autoDebugSummary && (
                      <div className="mt-4 theme-block-soft rounded-[22px] p-4">
                        <div className="mb-2 text-sm font-semibold text-[var(--text-muted)]">自動偵錯修改摘要</div>
                        <div className="grid gap-2 text-sm text-[var(--text-main)] sm:grid-cols-3">
                          <div>停止原因：{autoDebugSummary.stopReason}</div>
                          <div>修改前 Max |residual|：{autoDebugSummary.beforeMaxResidual == null ? '—' : autoDebugSummary.beforeMaxResidual.toFixed(4)}</div>
                          <div>修改後 Max |residual|：{autoDebugSummary.afterMaxResidual == null ? '—' : autoDebugSummary.afterMaxResidual.toFixed(4)}</div>
                        </div>
                        {autoDebugSummary.actions.length > 0 ? (
                          <div className="mt-3 space-y-1 text-xs text-[var(--text-soft)]">
                            {autoDebugSummary.actions.slice(0, 12).map((action, idx) => (
                              <div key={`${action}-${idx}`}>{action}</div>
                            ))}
                            {autoDebugSummary.actions.length > 12 && (
                              <div>另有 {autoDebugSummary.actions.length - 12} 項修改。</div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-3 text-xs text-[var(--text-soft)]">沒有套用額外修改。</div>
                        )}
                      </div>
                    )}

                    {batchResults.length > 0 && (
                      <div className="mt-4 theme-block-soft rounded-[22px] p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-[var(--text-muted)]">Batch comparison</div>
                            <div className="mt-1 text-xs text-[var(--text-soft)]">同一套 peak model 套用到所有資料集的 position / FWHM / Area 趨勢。</div>
                          </div>
                          <div className="flex gap-2">
                            <ThemeSelect
                              value={batchNormalize}
                              onChange={value => setBatchNormalize(value as typeof batchNormalize)}
                              options={BATCH_NORMALIZE_OPTIONS}
                              className="min-w-[12rem]"
                              buttonClassName="text-xs"
                            />
                            <button
                              type="button"
                              onClick={exportBatchCsv}
                              className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]"
                            >
                              匯出 trend CSV
                            </button>
                          </div>
                        </div>
                        <div className="max-h-80 overflow-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                                <th className="px-3 py-3 font-medium">Dataset</th>
                                <th className="px-3 py-3 font-medium">Peak</th>
                                <th className="px-3 py-3 font-medium">Center</th>
                                <th className="px-3 py-3 font-medium">FWHM</th>
                                <th className="px-3 py-3 font-medium">Area</th>
                                <th className="px-3 py-3 font-medium">Norm area</th>
                                <th className="px-3 py-3 font-medium">Confidence</th>
                              </tr>
                            </thead>
                            <tbody>
                              {batchTrendRows.map((row, idx) => (
                                <tr key={`${row.dataset}-${row.peak}-${idx}`} className="border-b border-white/5 text-[var(--text-main)] last:border-b-0">
                                  <td className="px-3 py-3">{row.dataset}</td>
                                  <td className="px-3 py-3">{row.peak}</td>
                                  <td className="px-3 py-3">{row.center.toFixed(3)}</td>
                                  <td className="px-3 py-3">{row.fwhm.toFixed(3)}</td>
                                  <td className="px-3 py-3">{row.area.toExponential(3)}</td>
                                  <td className="px-3 py-3">{row.normalizedArea == null ? '—' : row.normalizedArea.toFixed(4)}</td>
                                  <td className="px-3 py-3">{row.confidence}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-[var(--text-soft)]">
                    目前還沒有峰擬合結果。左側先載入參考峰或手動新增峰位，再按「執行峰擬合」。
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {editingCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-sm">
          <div className="theme-block max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-[24px] p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-[var(--text-muted)]">{editingCandidate.display_name || editingCandidate.label}</div>
                <div className="mt-1 text-xs text-[var(--text-soft)]">{editingCandidate.peak_id} · {editingCandidate.phase || editingCandidate.material || '未指定 phase'}</div>
              </div>
              <button
                type="button"
                onClick={() => setEditingPeakId(null)}
                className="theme-block-soft pressable h-9 w-9 rounded-full text-sm text-[var(--text-main)]"
                aria-label="關閉峰設定"
              >
                ×
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">名稱</span>
                <input
                  type="text"
                  value={editingCandidate.display_name}
                  onChange={e => updateFitCandidate(editingCandidate.peak_id, { display_name: e.target.value, label: e.target.value || editingCandidate.label })}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">Phase</span>
                <input
                  type="text"
                  value={editingCandidate.phase || editingCandidate.material}
                  onChange={e => updateFitCandidate(editingCandidate.peak_id, { phase: e.target.value, material: e.target.value })}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">Phase group</span>
                <input
                  type="text"
                  value={editingCandidate.phase_group}
                  onChange={e => updateFitCandidate(editingCandidate.peak_id, { phase_group: e.target.value })}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">Species</span>
                <input
                  type="text"
                  value={editingCandidate.species}
                  onChange={e => updateFitCandidate(editingCandidate.peak_id, { species: e.target.value })}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">理論中心 cm⁻¹</span>
                <input
                  type="number"
                  value={editingCandidate.position_cm}
                  onChange={e => {
                    const value = Number(e.target.value)
                    updateFitCandidate(editingCandidate.peak_id, { position_cm: value, theoretical_center: value, ref_position_cm: value })
                  }}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">容許 ±cm⁻¹</span>
                <input
                  type="number"
                  value={editingCandidate.tolerance_cm}
                  min={0}
                  step={0.5}
                  onChange={e => updateFitCandidate(editingCandidate.peak_id, { tolerance_cm: Number(e.target.value) })}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">FWHM init</span>
                <input
                  type="number"
                  value={editingCandidate.fwhm_cm}
                  min={0.1}
                  step={0.5}
                  onChange={e => updateFitCandidate(editingCandidate.peak_id, { fwhm_cm: Number(e.target.value) })}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">Profile</span>
                <ThemeSelect
                  value={editingCandidate.profile || fitParams.profile}
                  onChange={value => updateFitCandidate(editingCandidate.peak_id, { profile: value as RamanProfile })}
                  options={PROFILE_OPTIONS}
                  buttonClassName="text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">FWHM min</span>
                <input
                  type="number"
                  value={editingCandidate.fwhm_min}
                  min={0.1}
                  step={0.5}
                  onChange={e => updateFitCandidate(editingCandidate.peak_id, { fwhm_min: Number(e.target.value) })}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">FWHM max</span>
                <input
                  type="number"
                  value={editingCandidate.fwhm_max}
                  min={0.2}
                  step={1}
                  onChange={e => updateFitCandidate(editingCandidate.peak_id, { fwhm_max: Number(e.target.value) })}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              {[
                ['lock_center', '鎖中心'],
                ['lock_fwhm', '鎖 FWHM'],
                ['lock_area', '鎖 Area'],
                ['lock_profile', '鎖 profile mix'],
              ].map(([key, label]) => (
                <label key={key} className="theme-block-soft flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--text-main)]">
                  <input
                    type="checkbox"
                    checked={Boolean(editingCandidate[key as keyof FitPeakCandidate])}
                    onChange={e => updateFitCandidate(editingCandidate.peak_id, { [key]: e.target.checked } as Partial<FitPeakCandidate>)}
                    className="h-4 w-4 accent-[var(--accent-strong)]"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">Oxidation inference</span>
                <ThemeSelect
                  value={editingCandidate.oxidation_state_inference}
                  onChange={value => updateFitCandidate(editingCandidate.peak_id, { oxidation_state_inference: value as FitPeakCandidate['oxidation_state_inference'] })}
                  options={OXIDATION_INFERENCE_OPTIONS}
                  buttonClassName="text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">Oxidation state</span>
                <input
                  type="text"
                  value={editingCandidate.oxidation_state}
                  onChange={e => updateFitCandidate(editingCandidate.peak_id, { oxidation_state: e.target.value })}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap justify-between gap-2">
              <button
                type="button"
                onClick={() => removeFitCandidate(editingCandidate.peak_id)}
                className="theme-block-soft pressable rounded-xl px-4 py-2 text-sm font-semibold text-[var(--accent-secondary)]"
              >
                刪除此峰
              </button>
              <button
                type="button"
                onClick={() => setEditingPeakId(null)}
                className="theme-pill pressable rounded-xl px-4 py-2 text-sm font-semibold text-[var(--accent)]"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
      <DatasetSelectionModal
        open={overlaySelectorOpen}
        title="選擇 Raman 疊圖資料"
        items={overlayItems}
        selectedKeys={overlayDraftSelection}
        onToggle={toggleOverlayDraft}
        onClose={() => setOverlaySelectorOpen(false)}
        onConfirm={applyOverlaySelection}
      />
    </div>
  )
}
