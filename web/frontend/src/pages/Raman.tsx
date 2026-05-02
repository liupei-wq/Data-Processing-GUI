import { useCallback, useEffect, useMemo, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import Plot from '../components/PlotlyChart'
import { type AnalysisModuleId } from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import {
  applyHidden,
  ChartToolbar,
  DEFAULT_SERIES_PALETTE_KEYS,
  DatasetSelectionModal,
  DeferredRender,
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
import type { PlotPopupRequest } from '../hooks/usePlotPopups'
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
  baseline_method: 'arpls',
  baseline_lambda: 1e5,
  baseline_p: 0.01,
  baseline_iter: 20,
  bootstrap_rounds: 8,
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
  { id: 'area_zero', label: '面積為 0' },
  { id: 'low_area', label: '面積占比過低' },
  { id: 'large_delta', label: '峰位偏移過大' },
  { id: 'boundary', label: '中心撞到邊界' },
  { id: 'broad', label: '峰形過寬或像背景' },
  { id: 'low_confidence', label: '信心度低' },
]

const PROFILE_OPTIONS: { value: RamanProfile; label: string }[] = [
  { value: 'voigt', label: 'Voigt（高斯與洛倫茲混合）' },
  { value: 'pseudo_voigt', label: 'pseudo-Voigt（近似混合峰）' },
  { value: 'super_gaussian', label: '平頂 / super-Gaussian' },
  { value: 'split_pseudo_voigt', label: '非對稱 / split pseudo-Voigt' },
  { value: 'gaussian', label: 'Gaussian（高斯）' },
  { value: 'lorentzian', label: 'Lorentzian（洛倫茲）' },
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

const NORMALIZATION_OPTIONS: { value: ProcessParams['norm_method']; label: string }[] = [
  { value: 'none', label: '不歸一化' },
  { value: 'min_max', label: 'Min-Max' },
  { value: 'max', label: 'Divide by max' },
  { value: 'area', label: 'Divide by area' },
]

const ROBUST_LOSS_OPTIONS: { value: FitParams['robust_loss']; label: string }[] = [
  { value: 'linear', label: 'Linear（一般最小平方法）' },
  { value: 'soft_l1', label: 'soft_l1（溫和抑制離群值）' },
  { value: 'huber', label: 'Huber（中度抑制離群值）' },
  { value: 'cauchy', label: 'Cauchy（強抑制離群值）' },
  { value: 'arctan', label: 'Arctan（更保守抑制離群值）' },
]

const BATCH_NORMALIZE_OPTIONS = [
  { value: 'si_520', label: '以 Si 520 峰正規化' },
  { value: 'total_area', label: '以總面積正規化' },
  { value: 'none', label: '不正規化' },
]

const OXIDATION_INFERENCE_OPTIONS: { value: FitPeakCandidate['oxidation_state_inference']; label: string }[] = [
  { value: 'Direct', label: '直接判定' },
  { value: 'Inferred', label: '推定' },
  { value: 'Not applicable', label: '不適用' },
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
    reference_source: peak.reference_source || peak.reference || '',
    symmetry: peak.symmetry || '',
    oxidation_state: peak.oxidation_state || 'N/A',
    oxidation_state_inference: peak.oxidation_state_inference || 'Not applicable',
    enabled_by_default: peak.enabled_by_default ?? true,
    candidate_only: peak.candidate_only ?? false,
    artifact: peak.artifact ?? false,
    substrate: peak.substrate ?? false,
    disabled_until_user_selects: peak.disabled_until_user_selects ?? false,
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
    reference_source: candidate.reference_source || candidate.reference || '',
    symmetry: candidate.symmetry || '',
    oxidation_state: candidate.oxidation_state || 'N/A',
    oxidation_state_inference: candidate.oxidation_state_inference || 'Not applicable',
    enabled_by_default: candidate.enabled_by_default ?? true,
    candidate_only: candidate.candidate_only ?? false,
    artifact: candidate.artifact ?? false,
    substrate: candidate.substrate ?? false,
    disabled_until_user_selects: candidate.disabled_until_user_selects ?? false,
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
  const x = fitResult.x_calibrated?.length === dataset.x.length ? fitResult.x_calibrated : dataset.x
  const baselineHasSignal = (fitResult.y_baseline ?? []).some(value => Math.abs(value) > 1e-9)
  const correctedFitHasSignal = (fitResult.y_fit_corrected ?? []).some(value => Number.isFinite(value))
  const traces: Plotly.Data[] = [
    {
      x,
      y: dataset.y_processed,
      type: 'scatter',
      mode: 'lines',
      name: '處理後光譜',
      line: { color: '#e5e7eb', width: 1.45 },
    },
    {
      x,
      y: fitResult.y_fit,
      type: 'scatter',
      mode: 'lines',
      name: '總擬合',
      line: { color: '#f8c65a', width: 2.7 },
    },
    {
      x,
      y: fitResult.residuals,
      type: 'scatter',
      mode: 'lines',
      name: '殘差',
      yaxis: 'y2',
      line: { color: '#8b949e', width: 1.05 },
    },
  ]

  if (baselineHasSignal) {
    traces.splice(1, 0, {
      x,
      y: fitResult.y_baseline,
      type: 'scatter',
      mode: 'lines',
      name: 'Baseline',
      line: { color: '#f59e0b', width: 1.3, dash: 'dot' },
    })
  }

  if (correctedFitHasSignal && baselineHasSignal) {
    traces.splice(traces.length - 1, 0, {
      x,
      y: fitResult.y_fit_corrected,
      type: 'scatter',
      mode: 'lines',
      name: '擬合（baseline-corrected）',
      line: { color: '#7dd3fc', width: 1.25, dash: 'dash' },
    })
  }

  return traces
}

function groupStageChartTraces(stage: FitResult['group_fit_stages'][number]): Plotly.Data[] {
  const traces: Plotly.Data[] = [
    {
      x: stage.x,
      y: stage.y_current_spectrum,
      type: 'scatter',
      mode: 'lines',
      name: 'Current spectrum',
      line: { color: '#cbd5e1', width: 1.2 },
    },
    {
      x: stage.x,
      y: stage.y_locked_previous,
      type: 'scatter',
      mode: 'lines',
      name: 'Locked previous groups',
      line: { color: '#f59e0b', width: 1.2, dash: 'dot' },
    },
    {
      x: stage.x,
      y: stage.y_group_fit,
      type: 'scatter',
      mode: 'lines',
      name: `${stage.group_name} fit`,
      line: { color: '#38bdf8', width: 1.6 },
    },
    {
      x: stage.x,
      y: stage.y_combined_fit,
      type: 'scatter',
      mode: 'lines',
      name: 'Combined locked fit',
      line: { color: '#f8c65a', width: 2.4 },
    },
    {
      x: stage.x,
      y: stage.residuals,
      type: 'scatter',
      mode: 'lines',
      name: 'Residual',
      yaxis: 'y2',
      line: { color: '#94a3b8', width: 1.0 },
    },
  ]
  const probeRows = stage.probe_rows ?? []
  traces.push({
    x: probeRows.map(row => row.fitted_cm1 ?? row.reference_cm1),
    y: probeRows.map(row => {
      const idx = stage.x.findIndex(value => Math.abs(value - (row.fitted_cm1 ?? row.reference_cm1)) <= 0.5)
      return idx >= 0 ? stage.y_current_spectrum[idx] : null
    }),
    type: 'scatter',
    mode: 'text+markers',
    name: 'Theoretical probing',
    marker: {
      color: probeRows.map(row => alignmentStatusColor(row.status)),
      symbol: probeRows.map(row => alignmentStatusSymbol(row.status)),
      size: 10,
      line: { color: '#f8fafc', width: 1 },
    },
    text: probeRows.map(row => row.status),
    textposition: 'top center',
    hovertemplate: probeRows.map(row => `${row.peak_label}<br>ref ${row.reference_cm1.toFixed(1)} → fit ${row.fitted_cm1 == null ? '—' : row.fitted_cm1.toFixed(1)}<br>SNR ${row.SNR.toFixed(2)}<br>${row.rejection_reason}<extra></extra>`),
  } as Plotly.Data)
  return traces
}

function groupDiagnosticLayout(stage: FitResult['group_fit_stages'][number]): Partial<Plotly.Layout> {
  const base = fitChartLayout()
  const shapes: Partial<Plotly.Shape>[] = []
  ;(stage.probe_rows ?? []).forEach(row => {
    const color = alignmentStatusColor(row.status)
    shapes.push({
      type: 'rect',
      xref: 'x',
      yref: 'paper',
      x0: row.search_window_lo,
      x1: row.search_window_hi,
      y0: 0,
      y1: 1,
      fillcolor: color,
      opacity: row.status === 'accepted' ? 0.12 : 0.05,
      line: { width: 0 },
      layer: 'below',
    })
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: row.reference_cm1,
      x1: row.reference_cm1,
      y0: 0,
      y1: 1,
      line: {
        color,
        width: row.status === 'accepted' ? 1.5 : 1,
        dash: row.status === 'candidate' || row.status === 'uncertain' || row.status === 'ambiguous' ? 'dash' : 'solid',
      },
    })
  })
  return {
    ...base,
    margin: { l: 68, r: 76, t: 42, b: 70 },
    shapes,
  }
}

function fitPeakLabel(row: FitResult['peaks'][number]) {
  return `${row.Peak_Name} ${row.Center_cm.toFixed(1)} cm⁻¹`
}

function fmtFixed(value: number | null | undefined, digits: number, fallback = '—') {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : fallback
}

function fmtExp(value: number | null | undefined, digits: number, fallback = '—') {
  return typeof value === 'number' && Number.isFinite(value) ? value.toExponential(digits) : fallback
}

function fitChartLayout(dataset?: ProcessedDataset, fitResult?: FitResult): Partial<Plotly.Layout> {
  const base = chartLayout()
  const legendColor =
    base.font && typeof base.font === 'object' && 'color' in base.font
      ? base.font.color
      : '#d9e4f0'
  const legendFamily =
    base.font && typeof base.font === 'object' && 'family' in base.font
      ? base.font.family
      : 'Times New Roman, Noto Sans TC, serif'
  const processedSeries = dataset?.y_processed ?? []
  const normalizedWindow = processedSeries.length > 0
    ? processedSeries.filter(value => Number.isFinite(value))
    : []
  const isNormalizedScale = normalizedWindow.length > 0 &&
    Math.min(...normalizedWindow) >= -0.02 &&
    Math.max(...normalizedWindow) <= 1.05 &&
    ((fitResult?.y_baseline ?? []).every(value => Math.abs(value) <= 1e-9))
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
    yaxis: {
      ...base.yaxis,
      title: { text: isNormalizedScale ? 'Normalized intensity' : 'Intensity' },
      range: isNormalizedScale ? [0, 1.05] : undefined,
    },
    yaxis2: {
      title: { text: '殘差' },
      overlaying: 'y',
      side: 'right',
      showgrid: false,
      zeroline: true,
      rangemode: 'normal',
      zerolinecolor: 'rgba(148, 163, 184, 0.35)',
      color: base.yaxis && 'color' in base.yaxis ? base.yaxis.color : '#d9e4f0',
    },
  }
}

function alignmentStatusColor(status: string) {
  if (status === 'accepted' || status === 'matched') return '#22c55e'
  if (status === 'candidate' || status === 'shifted') return '#facc15'
  if (status === 'uncertain' || status === 'ambiguous') return '#f97316'
  if (status === 'overlapped') return '#38bdf8'
  if (status === 'rejected') return '#ef4444'
  return '#94a3b8'
}

function alignmentStatusSymbol(status: string) {
  if (status === 'accepted' || status === 'matched') return 'circle'
  if (status === 'candidate' || status === 'shifted') return 'circle-open'
  if (status === 'uncertain' || status === 'ambiguous') return 'triangle-up'
  if (status === 'overlapped') return 'diamond'
  if (status === 'rejected') return 'x'
  return 'x-thin'
}

function materialColor(material: string) {
  if (material.includes('Si')) return '#38bdf8'
  if (material.includes('Ga')) return '#22c55e'
  if (material.includes('NiO')) return '#f97316'
  return '#c084fc'
}

function alignmentMapTraces(rows: FitResult['alignment_rows']): Plotly.Data[] {
  const orderedMaterials = ['Si (基板)', 'β-Ga₂O₃', 'NiO']
  const orderedPresent = Array.from(new Set(rows.map(row => row.material))).sort((a, b) => {
    const ai = orderedMaterials.indexOf(a)
    const bi = orderedMaterials.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
  const yLevels = new Map<string, number>()
  orderedPresent.forEach((material, idx) => yLevels.set(material, idx))
  const lineX: Array<number | null> = []
  const lineY: Array<number | null> = []
  const theoryX: number[] = []
  const theoryY: number[] = []
  const fitX: number[] = []
  const fitY: number[] = []
  const fitText: string[] = []
  const fitColors: string[] = []
  const fitSymbols: string[] = []
  const missingX: number[] = []
  const missingY: number[] = []
  const missingText: string[] = []

  rows.forEach(row => {
    const y = yLevels.get(row.material) ?? 0
    theoryX.push(row.reference_cm1)
    theoryY.push(y)
    if (row.fitted_cm1 != null) {
      lineX.push(row.reference_cm1, row.fitted_cm1, null)
      lineY.push(y, y, null)
      fitX.push(row.fitted_cm1)
      fitY.push(y)
      fitColors.push(alignmentStatusColor(row.status))
      fitSymbols.push(alignmentStatusSymbol(row.status))
      fitText.push(`${row.mode}<br>ref ${row.reference_cm1.toFixed(1)} → fit ${row.fitted_cm1.toFixed(1)}<br>Δ ${row.delta_cm1 == null ? '—' : row.delta_cm1.toFixed(2)}<br>${row.note}<br>${row.status}`)
    } else {
      missingX.push(row.reference_cm1)
      missingY.push(y)
      missingText.push(`${row.mode}<br>ref ${row.reference_cm1.toFixed(1)}<br>fit —<br>${row.note}<br>${row.status}`)
    }
  })

  return [
    {
      x: theoryX,
      y: theoryY,
      type: 'scatter',
      mode: 'markers',
      name: 'Theoretical peaks',
      marker: { color: '#94a3b8', size: 10, symbol: 'line-ns-open', line: { color: '#cbd5e1', width: 2 } },
      hovertemplate: 'ref %{x:.2f} cm⁻¹<extra></extra>',
    },
    {
      x: lineX,
      y: lineY,
      type: 'scatter',
      mode: 'lines',
      name: 'Delta connector',
      line: { color: 'rgba(203, 213, 225, 0.55)', width: 1.2 },
      hoverinfo: 'skip',
    },
    {
      x: fitX,
      y: fitY,
      type: 'scatter',
      mode: 'markers',
      name: 'Measured / fitted peaks',
      marker: { color: fitColors, size: 11, symbol: fitSymbols, line: { color: '#f8fafc', width: 1.3 } },
      text: fitText,
      hovertemplate: '%{text}<extra></extra>',
    },
    {
      x: missingX,
      y: missingY,
      type: 'scatter',
      mode: 'markers',
      name: 'Not observed',
      marker: { color: '#94a3b8', size: 11, symbol: 'x-thin', line: { color: '#cbd5e1', width: 1.2 } },
      text: missingText,
      hovertemplate: '%{text}<extra></extra>',
    },
  ]
}

function alignmentMapLayout(rows: FitResult['alignment_rows']): Partial<Plotly.Layout> {
  const base = chartLayout()
  const orderedMaterials = ['Si (基板)', 'β-Ga₂O₃', 'NiO']
  const materials = Array.from(new Set(rows.map(row => row.material))).sort((a, b) => {
    const ai = orderedMaterials.indexOf(a)
    const bi = orderedMaterials.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
  return {
    ...base,
    yaxis: {
      ...(base.yaxis ?? {}),
      title: { text: 'Material / group' },
      tickmode: 'array',
      tickvals: materials.map((_, idx) => idx),
      ticktext: materials,
    },
    margin: { l: 110, r: 24, t: 36, b: 62 },
  }
}

function deltaPlotTraces(rows: FitResult['peaks']): Plotly.Data[] {
  const filtered = rows.filter(row => row.Ref_cm != null)
  const groups = Array.from(new Set(filtered.map(row => row.Material)))
  const traces = groups.map(group => {
    const groupRows = filtered.filter(row => row.Material === group)
    return {
      x: groupRows.map(row => `${row.Mode_Label || row.Peak_Name}\n${row.Ref_cm?.toFixed(1) ?? '—'}`),
      y: groupRows.map(row => row.Status === 'not_observed' || row.Status === 'rejected' ? null : row.Delta_cm),
      type: 'scatter',
      mode: 'markers',
      name: group,
      marker: {
        color: groupRows.map(row => alignmentStatusColor(row.Status)),
        size: 10,
        symbol: groupRows.map(row => alignmentStatusSymbol(row.Status)),
        line: { color: '#f8fafc', width: 1.1 },
      },
      error_y: {
        type: 'data',
        array: groupRows.map(row => row.Bootstrap_Center_STD ?? 0),
        visible: true,
        color: materialColor(group),
      },
      text: groupRows.map(row => `${row.Peak_Name}<br>ref ${row.Ref_cm?.toFixed(1) ?? '—'}<br>fit ${fmtFixed(row.Center_cm, 2)}<br>Δ ${row.Delta_cm == null ? '—' : row.Delta_cm.toFixed(2)}<br>SNR ${fmtFixed(row.SNR, 2)}<br>${row.Status}`),
      hovertemplate: '%{text}<extra></extra>',
    } as Plotly.Data
  })
  const notObserved = filtered.filter(row => row.Status === 'not_observed' || row.Status === 'rejected')
  if (notObserved.length > 0) {
    traces.push({
      x: notObserved.map(row => `${row.Mode_Label || row.Peak_Name}\n${row.Ref_cm?.toFixed(1) ?? '—'}`),
      y: notObserved.map(() => -0.5),
      type: 'scatter',
      mode: 'markers',
      name: 'not observed / rejected',
      marker: {
        color: notObserved.map(row => alignmentStatusColor(row.Status)),
        size: 9,
        symbol: notObserved.map(row => alignmentStatusSymbol(row.Status)),
        line: { color: '#cbd5e1', width: 1 },
      },
      text: notObserved.map(row => `${row.Peak_Name}<br>ref ${row.Ref_cm?.toFixed(1) ?? '—'}<br>${row.Note}<br>${row.Status}`),
      hovertemplate: '%{text}<extra></extra>',
    } as Plotly.Data)
  }
  return traces
}

function deltaPlotLayout(): Partial<Plotly.Layout> {
  const base = chartLayout()
  return {
    ...base,
    shapes: [
      {
        type: 'line',
        xref: 'paper',
        x0: 0,
        x1: 1,
        y0: 0,
        y1: 0,
        line: { color: 'rgba(203, 213, 225, 0.45)', dash: 'dash', width: 1.2 },
      },
    ],
    yaxis: {
      ...(base.yaxis ?? {}),
      title: { text: 'Δ = fitted - reference (cm⁻¹)' },
      zeroline: true,
    },
    margin: { l: 68, r: 20, t: 28, b: 110 },
  }
}

function groupConfidenceBarTraces(groups: FitResult['group_summaries']): Plotly.Data[] {
  return [
    {
      x: groups.map(group => group.Group_Consistency_Score),
      y: groups.map(group => group.Material || group.Phase_Group),
      type: 'bar',
      orientation: 'h',
      marker: {
        color: groups.map(group => materialColor(group.Material || group.Phase_Group)),
      },
      text: groups.map(group => `${group.Matched_Count}/${group.Candidate_Count}`),
      textposition: 'inside',
      hovertemplate: '%{y}<br>score %{x:.0f}<br>matched %{text}<extra></extra>',
    },
  ]
}

function batchDeltaComparisonTraces(batchResults: FitResult[]): Plotly.Data[] {
  const symbols: Record<string, string> = {
    'Si (基板)': 'circle',
    'β-Ga₂O₃': 'diamond',
    'NiO': 'square',
  }
  const traces: Plotly.Data[] = []
  batchResults.forEach((result, index) => {
    const sampleName = result.report?.sample_id || result.dataset_name
    const sampleColor = LINE_COLOR_PALETTES.blue.series[index % LINE_COLOR_PALETTES.blue.series.length]
    const materials = Array.from(new Set(result.alignment_rows.map(row => row.material)))
    materials.forEach(material => {
      const rows = result.alignment_rows.filter(row => row.material === material)
      traces.push({
        x: rows.map(row => `${row.mode}\n${row.reference_cm1.toFixed(1)}`),
        y: rows.map(row => row.delta_cm1),
        type: 'scatter',
        mode: 'markers',
        name: `${sampleName} · ${material}`,
        marker: {
          size: 10,
          color: sampleColor,
          symbol: symbols[material] ?? 'circle',
          line: { color: '#f8fafc', width: 1.2 },
        },
        text: rows.map(row => `${material}<br>${row.mode}<br>Δ ${row.delta_cm1 == null ? '—' : row.delta_cm1.toFixed(2)}`),
        hovertemplate: '%{text}<extra>%{fullData.name}</extra>',
      } as Plotly.Data)
    })
  })
  return traces
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

function translateQualityFlag(flag: string) {
  if (flag === 'boundary peak') return '中心撞邊界'
  if (flag === 'broad/background-like peak') return '峰形過寬或接近背景'
  if (flag === 'center outside tolerance') return '中心超出容許範圍'
  if (flag === 'FWHM at limit') return 'FWHM 碰到限制'
  if (flag === 'Area=0') return '面積為 0'
  if (flag.startsWith('Area%<')) return flag.replace('Area%<', '面積占比 < ')
  if (flag.startsWith('|Δ|>')) return flag.replace('|Δ|>', '峰位偏移 > ')
  return flag
}

function translateConfidenceLevel(value: string | undefined) {
  if (value === 'High') return '高'
  if (value === 'Medium') return '中'
  if (value === 'Low') return '低'
  return value || '—'
}

function translateOxidationInference(value: string | undefined) {
  if (value === 'Direct') return '直接判定'
  if (value === 'Inferred') return '推定'
  if (value === 'Not applicable') return '不適用'
  return value || '—'
}

function translateFitStatus(value: string | undefined) {
  if (value === 'Fit OK') return '擬合正常'
  return value || '—'
}

function peakStatusLabel(row: FitResult['peaks'][number] | undefined, maxAbsDelta: number) {
  if (!row) return '待擬合'
  const flags = row.Quality_Flags ?? []
  if (flags.includes('boundary peak')) return '中心撞邊界'
  if (flags.includes('broad/background-like peak')) return '峰形過寬'
  if (row.Delta_cm != null && Math.abs(row.Delta_cm) > maxAbsDelta) return `|Δ|>${maxAbsDelta}`
  if (row.Confidence === 'Low') return '信心度低'
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

function describeProcessedView(params: ProcessParams) {
  if (params.bg_method !== 'none' && params.norm_method !== 'none') return '背景扣除與歸一化後'
  if (params.bg_method !== 'none') return '背景扣除後'
  if (params.norm_method !== 'none') return '歸一化後'
  return '處理後'
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
  onOpenPlotPopup,
}: {
  onModuleSelect?: (module: AnalysisModuleId) => void
  onOpenPlotPopup?: (popup: PlotPopupRequest) => void
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
  const [batchResults, setBatchResults] = useState<FitResult[]>([])
  const [batchNormalize, setBatchNormalize] = useState<'none' | 'si_520' | 'total_area'>('si_520')
  const [editingPeakId, setEditingPeakId] = useState<string | null>(null)
  const [draggingPeakId, setDraggingPeakId] = useState<string | null>(null)
  const [dragOverPeakId, setDragOverPeakId] = useState<string | null>(null)
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
  const [peakGroupFilter, setPeakGroupFilter] = useState<string>('all')
  const [peakStatusFilter, setPeakStatusFilter] = useState<string>('all')
  const [peakMaterialFilter, setPeakMaterialFilter] = useState<string>('all')
  const [peakSortKey, setPeakSortKey] = useState<'ref' | 'fit' | 'delta' | 'confidence'>('ref')
  const [activeProbeGroup, setActiveProbeGroup] = useState<string>('Si group')
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
    return result.datasets.find(dataset => dataset.name === selectedSeries) ?? result.datasets[0] ?? null
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
  const backgroundMethodLabel = BACKGROUND_METHOD_OPTIONS.find(option => option.value === params.bg_method)?.label ?? '不扣背景'
  const normalizationLabel = NORMALIZATION_OPTIONS.find(option => option.value === params.norm_method)?.label ?? '不歸一化'
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
    const comparisonLabel = describeProcessedView(params)
    return [
      { name: '原始', x: activeDataset.x, y: activeDataset.y_raw },
      { name: comparisonLabel, x: activeDataset.x, y: activeDataset.y_processed },
    ]
  }, [activeDataset, params])
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
  const renderFinalChart = useCallback((minHeight: number, bindLegend = true) => (
    <Plot
      data={applyHidden(finalChartTraces, finalHidden)}
      layout={chartLayout()}
      config={withPlotFullscreen({ scrollZoom: false })}
      style={{ width: '100%', minHeight: `${minHeight}px` }}
      onLegendClick={bindLegend ? (makeLegendClick(setFinalHidden) as never) : undefined}
      onLegendDoubleClick={bindLegend ? (() => false) : undefined}
      useResizeHandler
    />
  ), [finalChartTraces, finalHidden])
  const openFinalChartPopup = useCallback(() => {
    if (!onOpenPlotPopup || finalChartTraces.length === 0) return

    onOpenPlotPopup({
      title: `Raman 最終圖表 - ${activeDataset?.name ?? 'dataset'}`,
      content: renderFinalChart(460, false),
    })
  }, [activeDataset?.name, finalChartTraces.length, onOpenPlotPopup, renderFinalChart])

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
        reference_source: 'User custom peak',
        symmetry: '',
        oxidation_state: 'N/A',
        oxidation_state_inference: 'Not applicable',
        enabled_by_default: true,
        candidate_only: false,
        artifact: false,
        substrate: false,
        disabled_until_user_selects: false,
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

  const moveFitCandidate = useCallback((sourcePeakId: string, targetPeakId: string) => {
    if (!sourcePeakId || !targetPeakId || sourcePeakId === targetPeakId) return
    setFitCandidates(current => {
      const sourceIndex = current.findIndex(item => item.peak_id === sourcePeakId)
      const targetIndex = current.findIndex(item => item.peak_id === targetPeakId)
      if (sourceIndex < 0 || targetIndex < 0) return current
      const next = [...current]
      const [moved] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
  }, [])

  const removeFitCandidate = useCallback((peakId: string) => {
    setFitCandidates(current => current.filter(item => item.peak_id !== peakId))
    setEditingPeakId(current => current === peakId ? null : current)
  }, [])

  const handlePeakDragStart = useCallback((event: DragEvent<HTMLButtonElement>, peakId: string) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', peakId)
    setDraggingPeakId(peakId)
    setDragOverPeakId(peakId)
  }, [])

  const handlePeakDragOver = useCallback((event: DragEvent<HTMLTableRowElement>, peakId: string) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (draggingPeakId && draggingPeakId !== peakId) {
      setDragOverPeakId(peakId)
    }
  }, [draggingPeakId])

  const handlePeakDrop = useCallback((event: DragEvent<HTMLTableRowElement>, peakId: string) => {
    event.preventDefault()
    const sourcePeakId = event.dataTransfer.getData('text/plain') || draggingPeakId
    if (sourcePeakId) moveFitCandidate(sourcePeakId, peakId)
    setDraggingPeakId(null)
    setDragOverPeakId(null)
  }, [draggingPeakId, moveFitCandidate])

  const handlePeakDragEnd = useCallback(() => {
    setDraggingPeakId(null)
    setDragOverPeakId(null)
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
    return (fitResult.peaks ?? []).map(row => ({
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
    return (fitResult.peaks ?? []).find(pk => pk.Center_cm >= 480 && pk.Center_cm <= 570) ?? null
  }, [fitResult])
  const peakTableFilterOptions = useMemo(() => ({
    groups: ['all', ...Array.from(new Set((fitResult?.peaks ?? []).map(row => row.Phase_Group))).filter(Boolean)],
    statuses: ['all', ...Array.from(new Set((fitResult?.peaks ?? []).map(row => row.Status))).filter(Boolean)],
    materials: ['all', ...Array.from(new Set((fitResult?.peaks ?? []).map(row => row.Material))).filter(Boolean)],
  }), [fitResult])
  const filteredFitRows = useMemo(() => {
    const source = fitResult?.peaks ?? []
    const filtered = source.filter(row => (
      (peakGroupFilter === 'all' || row.Phase_Group === peakGroupFilter) &&
      (peakStatusFilter === 'all' || row.Status === peakStatusFilter) &&
      (peakMaterialFilter === 'all' || row.Material === peakMaterialFilter)
    ))
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (peakSortKey === 'fit') return a.Center_cm - b.Center_cm
      if (peakSortKey === 'delta') return Math.abs(b.Delta_cm ?? 0) - Math.abs(a.Delta_cm ?? 0)
      if (peakSortKey === 'confidence') return (b.Confidence_Score ?? 0) - (a.Confidence_Score ?? 0)
      return (a.Ref_cm ?? a.Center_cm) - (b.Ref_cm ?? b.Center_cm)
    })
    return sorted
  }, [fitResult, peakGroupFilter, peakMaterialFilter, peakSortKey, peakStatusFilter])
  const probeGroups = useMemo(() => {
    const preferred = ['Si group', 'β-Ga₂O₃ group', 'NiO group']
    const available = Array.from(new Set((fitResult?.group_probe_rows ?? []).map(row => row.material_group)))
    const ordered = preferred.filter(group => available.includes(group))
    const ambiguous = (fitResult?.group_probe_rows ?? []).some(row => row.status === 'ambiguous' || row.status === 'overlapped')
    return [...ordered, ...available.filter(group => !ordered.includes(group)), ...(ambiguous ? ['Ambiguous'] : [])]
  }, [fitResult])
  const activeProbeRows = useMemo(() => {
    const rows = fitResult?.group_probe_rows ?? []
    if (activeProbeGroup === 'Ambiguous') return rows.filter(row => row.status === 'ambiguous' || row.status === 'overlapped')
    return rows.filter(row => row.material_group === activeProbeGroup)
  }, [activeProbeGroup, fitResult])
  const activeProbeStage = useMemo(() => {
    if (!fitResult) return null
    if (activeProbeGroup === 'Ambiguous') return (fitResult.group_fit_stages ?? []).find(stage => (stage.probe_rows ?? []).some(row => row.status === 'ambiguous' || row.status === 'overlapped')) ?? null
    return (fitResult.group_fit_stages ?? []).find(stage => stage.group_name === activeProbeGroup) ?? null
  }, [activeProbeGroup, fitResult])
  const activeProbeCounts = useMemo(() => {
    return activeProbeRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1
      return acc
    }, {})
  }, [activeProbeRows])

  useEffect(() => {
    if (probeGroups.length > 0 && !probeGroups.includes(activeProbeGroup)) {
      setActiveProbeGroup(probeGroups[0])
    }
  }, [activeProbeGroup, probeGroups])

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
                  reference_source: 'Auto debug mode',
                  symmetry: '',
                  oxidation_state: 'N/A',
                  oxidation_state_inference: 'Not applicable',
                  enabled_by_default: true,
                  candidate_only: false,
                  artifact: true,
                  substrate: false,
                  disabled_until_user_selects: false,
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
          reference_source: String(item.reference_source ?? item.reference ?? 'User imported library'),
          symmetry: String(item.symmetry ?? ''),
          oxidation_state: String(item.oxidation_state ?? 'N/A'),
          oxidation_state_inference: item.oxidation_state_inference ?? 'Not applicable',
          enabled_by_default: item.enabled_by_default !== false,
          candidate_only: Boolean(item.candidate_only),
          artifact: Boolean(item.artifact),
          substrate: Boolean(item.substrate),
          disabled_until_user_selects: Boolean(item.disabled_until_user_selects),
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
    const sampleId = fitResult.report?.sample_id || fitResult.dataset_name
    const content = fitResult.report?.peak_table_csv || toCsv(
      ['Dataset', 'Peak', 'Phase', 'Center_cm'],
      fitResult.peaks.map(row => [fitResult.dataset_name, row.Peak_Name, row.Phase, row.Center_cm]),
    )
    downloadFile(content, `report_${sampleId}.csv`, 'text/csv')
  }, [fitResult])

  const exportFitJson = useCallback(() => {
    if (!fitResult?.success) return
    const sampleId = fitResult.report?.sample_id || fitResult.dataset_name
    downloadFile(fitResult.report?.report_json || JSON.stringify(fitResult, null, 2), `report_${sampleId}.json`, 'application/json')
  }, [fitResult])

  const exportAlignmentCsv = useCallback(() => {
    if (!fitResult?.report?.alignment_csv) return
    const sampleId = fitResult.report.sample_id || fitResult.dataset_name
    downloadFile(fitResult.report.alignment_csv, `peak_alignment_${sampleId}.csv`, 'text/csv')
  }, [fitResult])

  const exportProbeCsv = useCallback(() => {
    if (!fitResult?.report?.group_probe_table_csv) return
    const sampleId = fitResult.report.sample_id || fitResult.dataset_name
    downloadFile(fitResult.report.group_probe_table_csv, `group_probe_table_${sampleId}.csv`, 'text/csv')
  }, [fitResult])

  const exportReportText = useCallback(() => {
    if (!fitResult?.report?.report_markdown) return
    const sampleId = fitResult.report.sample_id || fitResult.dataset_name
    downloadFile(fitResult.report.report_markdown, `report_${sampleId}.md`, 'text/markdown')
  }, [fitResult])

  const exportReportHtml = useCallback(() => {
    if (!fitResult?.report?.report_html) return
    const sampleId = fitResult.report.sample_id || fitResult.dataset_name
    downloadFile(fitResult.report.report_html, `report_${sampleId}.html`, 'text/html')
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
    <div className={`flex h-screen flex-col overflow-hidden xl:flex-row${sidebarResizing ? ' select-none' : ''}`}>
      <aside
        className="module-sidebar glass-panel relative z-20 flex h-[45vh] min-h-0 w-full shrink-0 flex-col overflow-hidden xl:h-full xl:w-[var(--sidebar-width)] xl:transform-gpu xl:[transform:translateX(var(--sidebar-shift))] xl:rounded-none xl:border-l-0 xl:border-t-0 xl:border-b-0"
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
          <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto">
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

            <div className="px-4 py-5">
            <SidebarCard step={1} title="載入檔案" hint="支援 TXT / CSV / ASC / DAT" infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">載入檔案說明</p>
                <p>可同時上傳多筆 Raman 光譜；後續可切換單檔查看或做疊圖比較，處理流程則會逐筆獨立執行。</p>
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

            <SidebarCard step={2} title="背景扣除" hint="baseline 修正" defaultOpen={false} infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">背景扣除說明</p>
                <p>Raman 現在保留最核心的前處理鏈，只做背景扣除與歸一化。這一步負責移除基線漂移，讓真正的峰形比較清楚。</p>
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

            <SidebarCard step={3} title="歸一化" hint="設定強度正規化方式" defaultOpen={false} infoContent={
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

            <SidebarCard step={4} title="峰偵測與參考峰" hint="快速掃峰、選擇參考材料" defaultOpen={false} infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">峰偵測與參考峰說明</p>
                <p>峰偵測會直接在目前的處理後光譜上找局部極大值。它適合拿來快速建立候選峰，不代表每一個點都一定是物理上成立的 Raman band。</p>
                <div className="space-y-2 text-sm leading-6 text-[var(--text-soft)]">
                  <div><span className="font-medium text-[var(--text-main)]">Prominence</span>：峰頂相對左右谷底要突出多少才算峰。值越大，越偏向留下真正明顯的峰。</div>
                  <div><span className="font-medium text-[var(--text-main)]">Height ratio</span>：峰高至少要達到整條光譜最大強度的多少比例，適合把很低的小起伏排掉。</div>
                  <div><span className="font-medium text-[var(--text-main)]">最小峰距</span>：兩個峰至少要相隔幾個 cm⁻¹，避免同一個寬峰被切成很多假峰。</div>
                  <div><span className="font-medium text-[var(--text-main)]">最大峰數</span>：最後只保留最有代表性的前幾個峰，避免候選峰表過度膨脹。</div>
                </div>
                <p className="text-sm text-[var(--text-soft)]">實務上建議先把背景扣好，再慢慢調高 `Prominence` 與 `最小峰距`，讓演算法先穩定抓到主峰，再補找弱峰。</p>
              </div>
            }>
              <TogglePill
                checked={peakParams.enabled}
                onChange={value => setPeakParams(current => ({ ...current, enabled: value }))}
                label="啟用峰偵測"
              />
              {peakParams.enabled && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--text-soft)]">峰顯著度 Prominence</span>
                      <input type="number" value={peakParams.prominence} min={0.001} max={1} step={0.01} onChange={e => setPeakParams(current => ({ ...current, prominence: Number(e.target.value) }))} className="theme-input w-full rounded-xl px-3 py-2 text-sm" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--text-soft)]">高度比例 Height ratio</span>
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
                  <div className="rounded-[18px] border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-3 text-xs leading-6 text-[var(--text-soft)]">
                    <div>判讀方向：`Prominence ↑` 會更嚴格，`Height ratio ↑` 會濾掉低峰，`最小峰距 ↑` 會合併太近的峰，`最大峰數 ↓` 會只留下最主要的候選峰。</div>
                  </div>
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
                  載入峰資料庫
                </button>
              </div>

              <div className="mt-4 rounded-[18px] border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                  峰資料庫
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={exportPeakLibrary}
                    className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]"
                  >
                    匯出資料庫 JSON
                  </button>
                  <label className="theme-pill pressable cursor-pointer rounded-xl px-3 py-2 text-center text-xs font-semibold text-[var(--accent)]">
                    匯入資料庫 JSON
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
                <div className="mt-2 text-[11px] text-[var(--text-soft)]">已載入 {peakLibrary.length} 筆峰資料</div>
              </div>
            </SidebarCard>

            <SidebarCard step={5} title="峰位管理與擬合" hint="載入參考峰、手動加峰、執行擬合" defaultOpen={false} infoContent={
              <div className="space-y-3">
                <p className="font-semibold text-[var(--text-main)]">峰位管理與擬合說明</p>
                <p>這一步負責整理峰位表、加入手動峰並執行 sequential grouped fitting。</p>
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
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">峰形模型 Profile</span>
                  <ThemeSelect
                    value={manualPeakProfile}
                    onChange={value => setManualPeakProfile(value as RamanProfile)}
                    options={PROFILE_OPTIONS}
                    buttonClassName="text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">FWHM 下限</span>
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
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">FWHM 上限</span>
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
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">穩健損失函數 Robust loss</span>
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
                  建議峰改用非對稱峰形
                </button>
                <button
                  type="button"
                  onClick={applyFlexibleProfileToLowShiftPeaks}
                  className="theme-pill pressable self-end rounded-xl px-3 py-2 text-sm font-medium text-[var(--accent)]"
                >
                  500 cm⁻¹ 以下改用非對稱峰形
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
                  <span>強制殘差目標</span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">最大殘差 |residual| 目標</span>
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
                  <span className="mb-1 block text-xs text-[var(--text-soft)]">殘差強制回合數</span>
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

              <div className="mt-3 rounded-[18px] border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-3 text-xs leading-6 text-[var(--text-soft)]">
                目前固定使用 sequential grouped fitting：Si 校正 → β-Ga₂O₃ → NiO → small global refinement。
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
                批次套用同一套峰模型
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

      <main className="workspace-main-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-8 sm:px-8 xl:px-10 xl:py-10">
        <div className="mx-auto w-full max-w-[1500px]">
            <ModuleTopBar
              title={moduleContent.title}
              subtitle={moduleContent.subtitle}
              description={moduleContent.description}
              chips={[
                { label: `資料量 ${rawFiles.length}` },
                { label: `背景 ${backgroundMethodLabel}` },
                { label: `參考峰 ${refPeaks.length}` },
              ]}
            />

          <InfoCardGrid
            items={[
              { label: '資料集', value: activeDataset?.name ?? '未載入' },
              { label: '背景扣除', value: backgroundMethodLabel },
              { label: '歸一化', value: normalizationLabel },
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
              description="左側提供背景扣除、歸一化、峰偵測、參考峰與峰擬合設定。上傳之後會在這裡顯示 Raman 圖譜與分析結果。"
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
                  { label: '背景方法', value: backgroundMethodLabel },
                  { label: '歸一化', value: normalizationLabel },
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
                    config={withPlotFullscreen({ scrollZoom: false })}
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
                  <DeferredRender minHeight={340}>
                    <Plot
                      data={applyHidden(overlayChartTraces, overlayHidden)}
                      layout={chartLayout()}
                      config={withPlotFullscreen({ scrollZoom: false })}
                      style={{ width: '100%', minHeight: '340px' }}
                      onLegendClick={makeLegendClick(setOverlayHidden) as never}
                      onLegendDoubleClick={() => false}
                      useResizeHandler
                    />
                  </DeferredRender>
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
                  <p className="mb-3 text-xs text-[var(--text-soft)]">把原始訊號與目前處理後結果疊在一起，方便快速檢查背景扣除與歸一化帶來的變化量。</p>
                  <DeferredRender minHeight={340}>
                    <Plot
                      data={applyHidden(preprocessChartTraces, preprocessHidden)}
                      layout={chartLayout()}
                      config={withPlotFullscreen({ scrollZoom: false })}
                      style={{ width: '100%', minHeight: '340px' }}
                      onLegendClick={makeLegendClick(setPreprocessHidden) as never}
                      onLegendDoubleClick={() => false}
                      useResizeHandler
                    />
                  </DeferredRender>
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
                  <DeferredRender minHeight={340}>
                    <Plot
                      data={applyHidden(backgroundChartTraces, backgroundHidden)}
                      layout={chartLayout()}
                      config={withPlotFullscreen({ scrollZoom: false })}
                      style={{ width: '100%', minHeight: '340px' }}
                      onLegendClick={makeLegendClick(setBackgroundHidden) as never}
                      onLegendDoubleClick={() => false}
                      useResizeHandler
                    />
                  </DeferredRender>
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
                    actions={onOpenPlotPopup ? (
                      <button type="button" className="chart-popup-button" onClick={openFinalChartPopup}>
                        彈出圖表
                      </button>
                    ) : undefined}
                  />
                  <p className="mb-3 text-xs text-[var(--text-soft)]">把最終 Raman、參考峰和偵測峰位收斂到同一張圖卡，互動方式與 XPS 最終圖一致。</p>
                  <DeferredRender minHeight={420}>
                    {renderFinalChart(420)}
                  </DeferredRender>
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
                    <div className="mt-1 text-xs text-[var(--text-soft)]">可拖曳最左側排序拉桿重排峰順序；點擊峰名稱可修改詳細設定，建議修改項會在狀態欄標記。</div>
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
                        <col style={{ width: '4%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '18%' }} />
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
                          <th className="px-2 py-3 text-center font-medium">排序</th>
                          <th className="px-2 py-3 text-center font-medium">啟用</th>
                          <th className="px-2 py-3 font-medium">ID</th>
                          <th className="px-2 py-3 font-medium">峰名稱</th>
                          <th className="px-2 py-3 text-right font-medium">位置 cm⁻¹</th>
                          <th className="px-2 py-3 font-medium">峰形模型</th>
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
                            onDragOver={event => handlePeakDragOver(event, candidate.peak_id)}
                            onDrop={event => handlePeakDrop(event, candidate.peak_id)}
                            className={[
                              'border-b border-white/5 text-[var(--text-main)] last:border-b-0',
                              suggested ? 'bg-[color:color-mix(in_srgb,var(--accent-secondary)_10%,transparent)]' : '',
                              draggingPeakId === candidate.peak_id ? 'opacity-60' : '',
                              dragOverPeakId === candidate.peak_id && draggingPeakId !== candidate.peak_id ? 'outline outline-1 outline-[var(--accent-strong)] outline-offset-[-1px]' : '',
                            ].join(' ')}
                          >
                            <td className="px-2 py-3 text-center">
                              <button
                                type="button"
                                draggable
                                onDragStart={event => handlePeakDragStart(event, candidate.peak_id)}
                                onDragEnd={handlePeakDragEnd}
                                className="theme-block-soft inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-lg text-sm text-[var(--text-soft)] transition-colors hover:text-[var(--accent)] active:cursor-grabbing"
                                aria-label={`拖曳排序 ${candidate.display_name || candidate.label}`}
                                title="拖曳排序"
                              >
                                ⋮⋮
                              </button>
                            </td>
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
                                {candidate.phase || candidate.material || '未指定相別'} · {candidate.species || '物種未設定'}
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
                                <div className="mt-1 break-words text-[11px] leading-relaxed text-[var(--text-soft)]">{row.Quality_Flags.map(translateQualityFlag).join(' / ')}</div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-6 text-sm text-[var(--text-soft)]">
                    先在左側「峰偵測與參考峰」載入參考峰或峰資料庫，或在「峰位管理與擬合」新增手動峰。
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
                    <div className="text-sm text-[var(--text-soft)]">左側選擇參考材料後，這裡會列出對應的 Raman 參考峰。</div>
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
                      <DeferredRender minHeight={520}>
                        <Plot
                          data={fitChartTraces(activeFitDataset, fitResult)}
                          layout={fitChartLayout(activeFitDataset, fitResult)}
                          config={withPlotFullscreen({ scrollZoom: false })}
                          style={{ width: '100%', minHeight: '520px' }}
                          useResizeHandler
                        />
                      </DeferredRender>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={exportFitCsv} className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]">匯出 CSV</button>
                      <button type="button" onClick={exportFitExcel} className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]">匯出 Excel</button>
                      <button type="button" onClick={exportAlignmentCsv} className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]">匯出 Alignment CSV</button>
                      <button type="button" onClick={exportProbeCsv} className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]">匯出 Probing CSV</button>
                      <button type="button" onClick={exportReportText} className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]">匯出報告 Markdown</button>
                      <button type="button" onClick={exportReportHtml} className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]">匯出報告 HTML</button>
                      <button type="button" onClick={exportFitJson} className="theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold text-[var(--accent)]">匯出 JSON 報告</button>
                    </div>

                    {fitResult.calibration && (
                      <div className="mt-4 grid gap-4 xl:grid-cols-4">
                        <div className="theme-block-soft rounded-[22px] p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-[var(--text-soft)]">校正方法</div>
                          <div className="mt-2 text-sm font-semibold text-[var(--text-main)]">{fitResult.calibration.method || 'none'}</div>
                        </div>
                        <div className="theme-block-soft rounded-[22px] p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-[var(--text-soft)]">Offset</div>
                          <div className="mt-2 text-sm font-semibold text-[var(--text-main)]">{fmtFixed(fitResult.calibration.offset_cm, 3)} cm⁻¹</div>
                        </div>
                        <div className="theme-block-soft rounded-[22px] p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-[var(--text-soft)]">Si 校正前</div>
                          <div className="mt-2 text-sm font-semibold text-[var(--text-main)]">{fitResult.calibration.si_peak_before_cm == null ? '—' : `${fitResult.calibration.si_peak_before_cm.toFixed(3)} cm⁻¹`}</div>
                        </div>
                        <div className="theme-block-soft rounded-[22px] p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-[var(--text-soft)]">Si 校正後</div>
                          <div className="mt-2 text-sm font-semibold text-[var(--text-main)]">{fitResult.calibration.si_peak_after_cm == null ? '—' : `${fitResult.calibration.si_peak_after_cm.toFixed(3)} cm⁻¹`}</div>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <ThemeSelect
                        value={peakGroupFilter}
                        onChange={value => setPeakGroupFilter(value)}
                        options={peakTableFilterOptions.groups.map(value => ({ value, label: value === 'all' ? '全部 group' : value }))}
                        className="min-w-[11rem]"
                        buttonClassName="text-xs"
                      />
                      <ThemeSelect
                        value={peakStatusFilter}
                        onChange={value => setPeakStatusFilter(value)}
                        options={peakTableFilterOptions.statuses.map(value => ({ value, label: value === 'all' ? '全部狀態' : value }))}
                        className="min-w-[10rem]"
                        buttonClassName="text-xs"
                      />
                      <ThemeSelect
                        value={peakMaterialFilter}
                        onChange={value => setPeakMaterialFilter(value)}
                        options={peakTableFilterOptions.materials.map(value => ({ value, label: value === 'all' ? '全部材料' : value }))}
                        className="min-w-[10rem]"
                        buttonClassName="text-xs"
                      />
                      <ThemeSelect
                        value={peakSortKey}
                        onChange={value => setPeakSortKey(value as typeof peakSortKey)}
                        options={[
                          { value: 'ref', label: '按理論峰位' },
                          { value: 'fit', label: '按實測峰位' },
                          { value: 'delta', label: '按 |Δ|' },
                          { value: 'confidence', label: '按信心分數' },
                        ]}
                        className="min-w-[10rem]"
                        buttonClassName="text-xs"
                      />
                    </div>

                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">峰名稱</th>
                            <th className="px-3 py-3 font-medium">group / material</th>
                            <th className="px-3 py-3 font-medium">理論 cm⁻¹</th>
                            <th className="px-3 py-3 font-medium">實測 cm⁻¹</th>
                            <th className="px-3 py-3 font-medium">Δ cm⁻¹</th>
                            <th className="px-3 py-3 font-medium">FWHM</th>
                            <th className="px-3 py-3 font-medium">SNR</th>
                            <th className="px-3 py-3 font-medium">anchor-related Δ</th>
                            <th className="px-3 py-3 font-medium">status</th>
                            <th className="px-3 py-3 font-medium">confidence</th>
                            <th className="px-3 py-3 font-medium">note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFitRows.map(row => (
                            <tr key={row.Peak_ID || `${row.Peak_Name}-${row.Center_cm}`} className="border-b border-white/5 text-[var(--text-main)] last:border-b-0">
                              <td className="px-3 py-3">
                                <div>{row.Peak_Name}</div>
                                <div className="text-[11px] text-[var(--text-soft)]">{row.Mode_Label || '—'}</div>
                              </td>
                              <td className="px-3 py-3">{row.Phase_Group}<div className="text-[11px] text-[var(--text-soft)]">{row.Material}</div></td>
                              <td className="px-3 py-3">{fmtFixed(row.Ref_cm, 3)}</td>
                              <td className="px-3 py-3">{row.Status === 'not_observed' || row.Status === 'rejected' ? '—' : fmtFixed(row.Center_cm, 3)}</td>
                              <td className="px-3 py-3">{fmtFixed(row.Delta_cm, 3)}</td>
                              <td className="px-3 py-3">{fmtFixed(row.FWHM_cm, 3)}</td>
                              <td className="px-3 py-3">{fmtFixed(row.SNR, 2)}</td>
                              <td className="px-3 py-3">{fmtFixed(row.Anchor_Related_Delta_cm, 3)}</td>
                              <td className="px-3 py-3">{row.Status}</td>
                              <td className="px-3 py-3">{fmtFixed(row.Confidence_Score, 0)}<div className="text-[11px] text-[var(--text-soft)]">{translateConfidenceLevel(row.Physical_Confidence || row.Confidence)}</div></td>
                              <td className="px-3 py-3 text-xs text-[var(--text-soft)]">{row.Note || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="theme-block-soft rounded-[22px] p-4">
                        <div className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Final Fit Overview</div>
                        <div className="grid grid-cols-2 gap-2 text-sm text-[var(--text-main)]">
                          <div>全域 RMSE</div>
                          <div>{fmtExp(fitResult.residual_diagnostics.Global_RMSE, 2)}</div>
                          <div>最大殘差 |residual|</div>
                          <div>{fmtExp(fitResult.residual_diagnostics.Global_MaxAbs, 2)}</div>
                          <div>最大殘差區段</div>
                          <div>{fitResult.residual_diagnostics.Max_Residual_Range || '—'}</div>
                          <div>480–570 區段 RMSE</div>
                          <div>{fmtExp(fitResult.residual_diagnostics.Segment_480_570_RMSE, 2)}</div>
                        </div>
                        {(fitResult.residual_diagnostics.Suggestions ?? []).length > 0 && (
                          <div className="mt-3 space-y-1 text-xs text-[var(--text-soft)]">
                            {(fitResult.residual_diagnostics.Suggestions ?? []).map(item => (
                              <div key={item}>{item}</div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="theme-block-soft rounded-[22px] p-4">
                        <div className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Group Confidence Summary</div>
                        {(fitResult.group_summaries ?? []).length > 0 ? (
                          <>
                            <DeferredRender minHeight={240}>
                              <Plot
                                data={groupConfidenceBarTraces(fitResult.group_summaries ?? [])}
                                layout={{ ...chartLayout(), margin: { l: 110, r: 20, t: 20, b: 40 } }}
                                config={withPlotFullscreen({ scrollZoom: false })}
                                style={{ width: '100%', minHeight: '240px' }}
                                useResizeHandler
                              />
                            </DeferredRender>
                            <div className="mt-3 max-h-72 overflow-auto">
                              <table className="min-w-full text-left text-xs">
                                <thead>
                                  <tr className="border-b border-white/10 uppercase tracking-[0.18em] text-slate-500">
                                    <th className="px-3 py-3 font-medium">material</th>
                                    <th className="px-3 py-3 font-medium">anchor</th>
                                    <th className="px-3 py-3 font-medium">shift</th>
                                    <th className="px-3 py-3 font-medium">stretch</th>
                                    <th className="px-3 py-3 font-medium">matched</th>
                                    <th className="px-3 py-3 font-medium">mean |Δ|</th>
                                    <th className="px-3 py-3 font-medium">score</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(fitResult.group_summaries ?? []).map(group => (
                                    <tr key={group.Phase_Group} className="border-b border-white/5 text-[var(--text-main)] last:border-b-0">
                                      <td className="px-3 py-3">{group.Material || group.Phase_Group}</td>
                                      <td className="px-3 py-3">{group.Anchor_Peak || '—'}</td>
                                      <td className="px-3 py-3">{fmtFixed(group.Group_Shift_cm, 2)}</td>
                                      <td className="px-3 py-3">{fmtFixed(group.Stretch, 4)}</td>
                                      <td className="px-3 py-3">{group.Matched_Count}/{group.Candidate_Count}</td>
                                      <td className="px-3 py-3">{fmtFixed(group.Mean_Abs_Delta_cm, 2)}</td>
                                      <td className="px-3 py-3">{fmtFixed(group.Group_Consistency_Score, 0)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        ) : (
                          <div className="text-sm text-[var(--text-soft)]">目前沒有群組摘要。</div>
                        )}
                      </div>
                    </div>

                    {(fitResult.group_fit_stages ?? []).length > 0 && (
                      <div className="mt-5 space-y-4">
                        <div className="text-sm font-semibold text-[var(--text-muted)]">Sequential Group Fitting</div>
                        {(fitResult.group_fit_stages ?? []).map(stage => (
                          <div key={stage.group_name} className="theme-block-soft rounded-[22px] p-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-[var(--text-main)]">{stage.group_name}</div>
                                <div className="mt-1 text-xs text-[var(--text-soft)]">
                                  anchor {stage.anchor_peak_label || '—'} · ref {fmtFixed(stage.anchor_ref_cm, 2)} · fit {fmtFixed(stage.anchor_fitted_cm, 2)} · shift {fmtFixed(stage.group_shift_cm, 2)} · stretch {fmtFixed(stage.stretch, 4)}
                                </div>
                              </div>
                              <div className="text-xs text-[var(--text-soft)]">stage R² {fmtFixed(stage.r_squared, 4)}</div>
                            </div>
                            <DeferredRender minHeight={360}>
                              <Plot
                                data={groupStageChartTraces(stage)}
                                layout={fitChartLayout()}
                                config={withPlotFullscreen({ scrollZoom: false })}
                                style={{ width: '100%', minHeight: '360px' }}
                                useResizeHandler
                              />
                            </DeferredRender>
                            {(stage.warnings ?? []).length > 0 && (
                              <div className="mt-3 space-y-1 text-xs text-[var(--accent-secondary)]">
                                {(stage.warnings ?? []).map(warning => (
                                  <div key={warning}>{warning}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {(fitResult.group_probe_rows ?? []).length > 0 && (
                      <div className="mt-5 theme-block-soft rounded-[22px] p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-[var(--text-muted)]">Material Group Diagnostics</div>
                          <div className="flex flex-wrap gap-2">
                            {probeGroups.map(group => (
                              <button
                                key={group}
                                type="button"
                                onClick={() => setActiveProbeGroup(group)}
                                className={`theme-pill pressable rounded-xl px-3 py-2 text-xs font-semibold ${activeProbeGroup === group ? 'text-[var(--accent)]' : 'text-[var(--text-soft)]'}`}
                              >
                                {group === 'Ambiguous' ? 'Ambiguous' : group.replace(' group', '')}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="mb-3 flex flex-wrap gap-2 text-xs text-[var(--text-soft)]">
                          {['accepted', 'candidate', 'ambiguous', 'overlapped', 'uncertain', 'rejected', 'not_observed'].map(status => (
                            <span key={status} className="rounded-lg border border-white/10 px-2 py-1">
                              {status}: {activeProbeCounts[status] ?? 0}
                            </span>
                          ))}
                        </div>
                        {activeProbeStage ? (
                          <DeferredRender minHeight={380}>
                            <Plot
                              data={groupStageChartTraces(activeProbeStage)}
                              layout={groupDiagnosticLayout(activeProbeStage)}
                              config={withPlotFullscreen({ scrollZoom: false })}
                              style={{ width: '100%', minHeight: '380px' }}
                              useResizeHandler
                            />
                          </DeferredRender>
                        ) : (
                          <div className="rounded-xl border border-white/10 px-3 py-3 text-sm text-[var(--text-soft)]">
                            此群組沒有 stage curve，但 probing table 仍保留了理論峰檢查結果。
                          </div>
                        )}
                        <div className="mt-4 max-h-96 overflow-auto">
                          <table className="min-w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-white/10 uppercase tracking-[0.16em] text-slate-500">
                                <th className="px-3 py-3 font-medium">peak</th>
                                <th className="px-3 py-3 font-medium">ref</th>
                                <th className="px-3 py-3 font-medium">window</th>
                                <th className="px-3 py-3 font-medium">local max</th>
                                <th className="px-3 py-3 font-medium">fit</th>
                                <th className="px-3 py-3 font-medium">Δ</th>
                                <th className="px-3 py-3 font-medium">FWHM</th>
                                <th className="px-3 py-3 font-medium">SNR</th>
                                <th className="px-3 py-3 font-medium">AIC Δ</th>
                                <th className="px-3 py-3 font-medium">status</th>
                                <th className="px-3 py-3 font-medium">reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeProbeRows.map(row => (
                                <tr key={`${row.material_group}-${row.peak_id}-${row.reference_cm1}`} className="border-b border-white/5 text-[var(--text-main)] last:border-b-0">
                                  <td className="px-3 py-3">{row.peak_label || row.mode}</td>
                                  <td className="px-3 py-3">{fmtFixed(row.reference_cm1, 1)}</td>
                                  <td className="px-3 py-3">{row.search_window}</td>
                                  <td className="px-3 py-3">{fmtFixed(row.local_max_position, 1)}</td>
                                  <td className="px-3 py-3">{fmtFixed(row.fitted_cm1, 2)}</td>
                                  <td className="px-3 py-3">{fmtFixed(row.delta_cm1, 2)}</td>
                                  <td className="px-3 py-3">{fmtFixed(row.FWHM, 2)}</td>
                                  <td className="px-3 py-3">{fmtFixed(row.SNR, 2)}</td>
                                  <td className="px-3 py-3">{fmtFixed(row.AIC_improvement, 2)}</td>
                                  <td className="px-3 py-3">
                                    <span style={{ color: alignmentStatusColor(row.status) }}>{row.status}</span>
                                  </td>
                                  <td className="max-w-[360px] px-3 py-3 text-[var(--text-soft)]">{row.rejection_reason || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="mt-5 grid gap-4 xl:grid-cols-2">
                      <div className="theme-block-soft rounded-[22px] p-4">
                        <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">Peak Alignment Map</div>
                        {(fitResult.alignment_rows ?? []).length > 0 ? (
                          <DeferredRender minHeight={320}>
                            <Plot
                              data={alignmentMapTraces(fitResult.alignment_rows ?? [])}
                              layout={alignmentMapLayout(fitResult.alignment_rows ?? [])}
                              config={withPlotFullscreen({ scrollZoom: false })}
                              style={{ width: '100%', minHeight: '320px' }}
                              useResizeHandler
                            />
                          </DeferredRender>
                        ) : (
                          <div className="text-sm text-[var(--text-soft)]">目前沒有可輸出的 peak alignment 資料。</div>
                        )}
                      </div>
                      <div className="theme-block-soft rounded-[22px] p-4">
                        <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">Peak Delta Plot</div>
                        {(fitResult.peaks ?? []).length > 0 ? (
                          <DeferredRender minHeight={320}>
                            <Plot
                              data={deltaPlotTraces(fitResult.peaks ?? [])}
                              layout={deltaPlotLayout()}
                              config={withPlotFullscreen({ scrollZoom: false })}
                              style={{ width: '100%', minHeight: '320px' }}
                              useResizeHandler
                            />
                          </DeferredRender>
                        ) : (
                          <div className="text-sm text-[var(--text-soft)]">目前沒有可繪製的 delta 資料。</div>
                        )}
                      </div>
                    </div>

                    {fitResult.report && (
                      <div className="mt-5 theme-block-soft rounded-[22px] p-4">
                        <div className="mb-3 text-sm font-semibold text-[var(--text-muted)]">Report Summary</div>
                        <div className="grid gap-2 text-sm text-[var(--text-main)] sm:grid-cols-2 xl:grid-cols-4">
                          <div>樣品 ID：{fitResult.report.sample_id}</div>
                          <div>Ar:O₂ 通量：{fitResult.report.ar_o2_flux}</div>
                          <div>Baseline：{fitResult.report.baseline_method}</div>
                          <div>Reduced χ²：{fmtExp(fitResult.report.global_reduced_chi2, 2)}</div>
                        </div>
                        {(fitResult.report.credibility_summary ?? []).length > 0 && (
                          <div className="mt-3 space-y-1 text-xs text-[var(--text-soft)]">
                            {(fitResult.report.credibility_summary ?? []).map(item => (
                              <div key={item}>{item}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

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
                                <span className="ml-2 text-[var(--text-soft)]">{item.flags.map(translateQualityFlag).join(' / ')}</span>
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
                            <div className="text-sm font-semibold text-[var(--text-muted)]">Cross-sample Comparison</div>
                            <div className="mt-1 text-xs text-[var(--text-soft)]">比較 1013 / 1020-1 / 1014 等樣品的 peak delta 趨勢。marker 顏色代表 sample，形狀代表 material group。</div>
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
                              匯出趨勢 CSV
                            </button>
                          </div>
                        </div>
                        <DeferredRender minHeight={320}>
                          <Plot
                            data={batchDeltaComparisonTraces(batchResults)}
                            layout={deltaPlotLayout()}
                            config={withPlotFullscreen({ scrollZoom: false })}
                            style={{ width: '100%', minHeight: '320px' }}
                            useResizeHandler
                          />
                        </DeferredRender>
                        <div className="max-h-80 overflow-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                                <th className="px-3 py-3 font-medium">資料集</th>
                                <th className="px-3 py-3 font-medium">峰名稱</th>
                                <th className="px-3 py-3 font-medium">中心</th>
                                <th className="px-3 py-3 font-medium">FWHM</th>
                                <th className="px-3 py-3 font-medium">面積</th>
                                <th className="px-3 py-3 font-medium">正規化面積</th>
                                <th className="px-3 py-3 font-medium">信心度</th>
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
                                  <td className="px-3 py-3">{translateConfidenceLevel(row.confidence)}</td>
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
      </main>
      {editingCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-sm">
          <div className="theme-block max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-[24px] p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-[var(--text-muted)]">{editingCandidate.display_name || editingCandidate.label}</div>
                <div className="mt-1 text-xs text-[var(--text-soft)]">{editingCandidate.peak_id} · {editingCandidate.phase || editingCandidate.material || '未指定相別'}</div>
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
                <span className="mb-1 block text-xs text-[var(--text-soft)]">相別 Phase</span>
                <input
                  type="text"
                  value={editingCandidate.phase || editingCandidate.material}
                  onChange={e => updateFitCandidate(editingCandidate.peak_id, { phase: e.target.value, material: e.target.value })}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">相別群組 Phase group</span>
                <input
                  type="text"
                  value={editingCandidate.phase_group}
                  onChange={e => updateFitCandidate(editingCandidate.peak_id, { phase_group: e.target.value })}
                  className="theme-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">物種 Species</span>
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
                <span className="mb-1 block text-xs text-[var(--text-soft)]">初始 FWHM</span>
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
                <span className="mb-1 block text-xs text-[var(--text-soft)]">峰形模型 Profile</span>
                <ThemeSelect
                  value={editingCandidate.profile || fitParams.profile}
                  onChange={value => updateFitCandidate(editingCandidate.peak_id, { profile: value as RamanProfile })}
                  options={PROFILE_OPTIONS}
                  buttonClassName="text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">FWHM 下限</span>
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
                <span className="mb-1 block text-xs text-[var(--text-soft)]">FWHM 上限</span>
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
                ['lock_area', '鎖面積'],
                ['lock_profile', '鎖峰形混合'],
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
                <span className="mb-1 block text-xs text-[var(--text-soft)]">氧化態判定方式</span>
                <ThemeSelect
                  value={editingCandidate.oxidation_state_inference}
                  onChange={value => updateFitCandidate(editingCandidate.peak_id, { oxidation_state_inference: value as FitPeakCandidate['oxidation_state_inference'] })}
                  options={OXIDATION_INFERENCE_OPTIONS}
                  buttonClassName="text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-soft)]">氧化態</span>
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
