import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import Plot, { PlotlyApi } from '../components/PlotlyChart'
import type { AnalysisModuleId } from '../components/AnalysisModuleNav'
import { ModuleTopBar } from '../components/WorkspaceUi'
import { withPlotFullscreen } from '../components/plotConfig'

type PlotModule = 'xps' | 'raman' | 'xrd' | 'xas' | 'xes'
type XpsPlotMode = 'fit' | 'vbm' | 'vb-dos'
type XpsPositionTarget = 'x-axis-title' | 'y-axis-title' | 'panel-title' | 'sample-label'
type RamanPlotMode = 'single' | 'overlay'
type RamanConfidenceFilter = 'all' | 'high' | 'medium-up' | 'low-only'
type RamanReferenceLabelMode = 'full' | 'material-shift' | 'shift' | 'index'
type RamanReferenceLineDash = 'solid' | 'dash' | 'dot' | 'dashdot'
type XasBandFileKind = 'xes' | 'xas'
type XasSpecialSample = '40-10' | '45-5' | '50-0'

interface FitSpectrumFile {
  id: string
  name: string
  sampleLabel: string
  xOffsetEv: number
  x: number[]
  observed: number[]
  totalFit: number[]
  components: Record<string, number[]>
}

interface XpsOffsetSettings {
  interpolate: boolean
  nPoints: number
}

interface VbmSpectrumFile {
  id: string
  name: string
  sampleLabel: string
  xColumn: string
  yColumn: string
  x: number[]
  y: number[]
  baselineStart: number
  baselineEnd: number
  tangentStart: number
  tangentEnd: number
}

interface XasBandEdgeFile {
  id: string
  name: string
  sampleLabel: string
  kind: XasBandFileKind
  xColumn: string
  yColumn: string
  x: number[]
  y: number[]
  baselineStart: number
  baselineEnd: number
  tangentStart: number
  tangentEnd: number
  displayStart: number
  displayEnd: number
  color: string
}

interface XasBandPair {
  id: string
  sampleLabel: string
  xesFileId: string
  xasFileId: string
  color: string
}

interface XrdSourceTrace {
  id: string
  sourceFile: string
  sourceColumn: number
  label: string
  shortLabel: string
  xColumn: string
  yColumn: string
  color: string
  offset: number
  linewidth: number
  visible: boolean
  x: number[]
  y: number[]
}

interface XrdReferencePeak {
  id: string
  x: number
  text: string
  lineColor: string
  textYFrac: number
  textXOffset?: number
  enabled: boolean
}

interface XrdFigureStyle {
  xShift: number
  normalizeEachCurve: boolean
  showTitle: boolean
  figureTitle: string
  xMin: number
  xMax: number
  yMin: number | null
  yMax: number | null
  axisLabelSize: number
  tickLabelSize: number
  curveLabelSize: number
  peakLabelSize: number
  titleSize: number
  referenceLabelYShift: number
  referenceLabelYMaxFraction: number
  showReferencePeaks: boolean
  showLegend: boolean
  xAxisTitle: string
  yAxisTitle: string
  exportWidth: number
  exportHeight: number
  exportScale: number
  exportDpi: number
}

interface VbDosPeakAnnotation {
  id: string
  be: number
  relEnergy: number
  intensity: number
  assignment: string
  label: string
  visible: boolean
  labelXShift: number
  labelYShift: number
}

interface VbDosSpectrumFile {
  id: string
  name: string
  sampleLabel: string
  color: string
  sampleLabelXFraction: number
  sampleLabelYOffset: number
  xColumn: string
  yColumn: string
  x: number[]
  y: number[]
  vbm: number
  peaks: VbDosPeakAnnotation[]
}

interface RamanComponentCurve {
  label: string
  group: string
  material: string
  assignment: string
  labelType: string
  modeLabel: string
  status: string
  profile: string
  center: number | null
  area: number | null
  areaPercent: number | null
  confidence: string
  confidenceScore: number | null
  visible: boolean
  yCorrected: number[]
  yRaw: number[]
}

interface RamanFitPlotFile {
  id: string
  name: string
  sampleLabel: string
  sourceType: 'fit-json' | 'spectrum'
  hasFit: boolean
  overlayColor: string
  overlayYOffset: number
  sampleLabelXPaper: number
  sampleLabelYOffset: number
  x: number[]
  raw: number[]
  baseline: number[]
  corrected: number[]
  totalFitCorrected: number[]
  totalFitRaw: number[]
  residual: number[]
  components: RamanComponentCurve[]
}

interface RamanReferencePeak {
  id: string
  databaseId: string
  databaseName: string
  sourceId: string
  citation: string
  material: string
  phase: string
  shift: number
  defaultShift: number
  label: string
  displayLabel: string
  defaultDisplayLabel: string
  resonanceState: string
  mode: string
  structure: string
  polyhedron: string
  confidence: string
  enabled: boolean
}

interface RamanReferenceDatabase {
  id: string
  name: string
  version: string
  notes: string
  peaks: RamanReferencePeak[]
}

interface RamanReferencePeakStyle {
  labelXShift: number
  labelYFraction: number | null
}

interface ComponentStyle {
  label: string
  color: string
  labelX: number
  labelY: number
  markerCenter: number | null
  show: boolean
}

interface PlotFigureStyle {
  titleLabel: string
  rawColor: string
  fitColor: string
  fixedLineColor: string
  rawMode: 'markers' | 'lines' | 'lines+markers'
  rawMarkerSize: number
  rawMarkerLineWidth: number
  rawMarkerFillColor: string
  fontFamily: string
  fontSize: number
  xAxisFontSize: number
  yAxisFontSize: number
  xAxisTitleStandoff: number
  yAxisTitleStandoff: number
  panelTitleXPaper: number
  panelTitleYFraction: number
  sampleLabelXPaper: number
  sampleLabelYFraction: number
  axisLineWidth: number
  labelFontSize: number
  panelTitleFontSize: number
  sampleFontSize: number
  rawLineWidth: number
  fitLineWidth: number
  componentLineWidth: number
  fillOpacity: number
  yMax: number
  xLeft: number | null
  xRight: number | null
  exportWidth: number
  exportHeight: number
  exportScale: number
  showPercent: boolean
  showVerticalLines: boolean
  ratioNumerator: string
  ratioDenominator: string
}

interface RamanFigureStyle {
  fontFamily: string
  fontSize: number
  axisTitleFontSize: number
  labelFontSize: number
  rawColor: string
  correctedColor: string
  fitColor: string
  componentColor: string
  baselineColor: string
  residualColor: string
  rawLineWidth: number
  correctedLineWidth: number
  fitLineWidth: number
  componentLineWidth: number
  baselineLineWidth: number
  residualLineWidth: number
  componentOpacity: number
  xLeft: number | null
  xRight: number | null
  yBottom: number | null
  yTop: number | null
  normalize: boolean
  showRaw: boolean
  showCorrected: boolean
  showBaseline: boolean
  showComponents: boolean
  fillComponents: boolean
  showLabels: boolean
  confidenceFilter: RamanConfidenceFilter
  overlayOffset: number
  showOverlayFit: boolean
  showOverlayZoom: boolean
  overlayZoomLeft: number
  overlayZoomRight: number
  showSiMask: boolean
  siMaskCenter: number
  siMaskHalfWidth: number
  showReferencePeaks: boolean
  referenceLabelMode: RamanReferenceLabelMode
  referenceLineDash: RamanReferenceLineDash
  referenceLineWidth: number
  referenceLineOpacity: number
  referenceLabelYFraction: number
  referenceLabelWindowXShift: number
  referenceMatchTolerance: number
  showOverlayLegend: boolean
  exportWidth: number
  exportHeight: number
  exportScale: number
}

interface VbmFigureStyle {
  titleLabel: string
  fontFamily: string
  fontSize: number
  xAxisFontSize: number
  yAxisFontSize: number
  xAxisTitleStandoff: number
  yAxisTitleStandoff: number
  axisLineWidth: number
  panelTitleFontSize: number
  sampleFontSize: number
  annotationFontSize: number
  spectrumColor: string
  spectrumEdgeColor: string
  tangentColor: string
  baselineColor: string
  vbmColor: string
  spectrumLineWidth: number
  fitLineWidth: number
  markerSize: number
  markerLineWidth: number
  regionOpacity: number
  labelOffsetX: number
  labelOffsetY: number
  yMax: number
  xLeft: number
  xRight: number
  exportWidth: number
  exportHeight: number
  exportScale: number
}

interface VbmFitResult {
  file: VbmSpectrumFile
  x: number[]
  yNorm: number[]
  vbmY: number
  tangentLine: VbmLineFit
  baselineLine: VbmLineFit
  vbm: number
}

interface XasBandEdgeResult {
  file: XasBandEdgeFile
  edgeLabel: 'VBM' | 'CBM'
  x: number[]
  yNorm: number[]
  edgeY: number
  edge: number
  tangentLine: VbmLineFit
  baselineLine: VbmLineFit
}

interface XasBandPairResult {
  pair: XasBandPair
  xes: XasBandEdgeResult
  xas: XasBandEdgeResult
  bandGap: number
}

interface XasSpecialFitResult {
  sample: XasSpecialSample
  file: XasBandEdgeFile
  x: number[]
  y: number[]
  baseline: number
  fitSlope: number
  fitIntercept: number
  fitR2: number
  cbm: number
  vbm: number
  bandGap: number
}

interface VbmLinePoint {
  x: number
  y: number
}

interface VbmLineFit {
  slope: number
  intercept: number
  pointCount: number
  startWindowPointCount: number
  endWindowPointCount: number
  candidatePairCount: number
  anchorStartPoint: VbmLinePoint
  anchorEndPoint: VbmLinePoint
  startPoint: VbmLinePoint
  endPoint: VbmLinePoint
}

interface XasBandFigureStyle {
  fontFamily: string
  fontSize: number
  axisTitleFontSize: number
  panelTitleFontSize: number
  sampleFontSize: number
  annotationFontSize: number
  vbmLabelFontSize: number
  cbmLabelFontSize: number
  egLabelFontSize: number
  xAxisTitleStandoff: number
  yAxisTitleStandoff: number
  axisLineWidth: number
  xLeft: number
  xRight: number
  yMin: number
  yMax: number
  manualYRange: boolean
  xesTitle: string
  xasTitle: string
  xAxisTitle: string
  yAxisTitle: string
  normalizeIntensity: boolean
  xesTitleXPaper: number
  xesTitleYPaper: number
  xasTitleXPaper: number
  xasTitleYPaper: number
  sampleLabelXPaper: number
  sampleLabelYFraction: number
  vbmLabelXShift: number
  vbmLabelYFraction: number
  cbmLabelXShift: number
  cbmLabelYFraction: number
  egLabelYFraction: number
  egLineYFraction: number
  xesLineWidth: number
  xasLineWidth: number
  fitLineWidth: number
  vbmColor: string
  cbmColor: string
  gapColor: string
  baselineColor: string
  tangentColor: string
  regionOpacity: number
  gapOpacity: number
  showFitGuides: boolean
  showLegend: boolean
  exportWidth: number
  exportHeight: number
  exportScale: number
}

interface VbDosAssignmentRegion {
  id: string
  start: number
  end: number
  label: string
  shortLabel: string
  color: string
  labelXShift: number
  labelYPaper: number
  italicWords: string
}

interface VbDosFigureStyle {
  titleLabel: string
  fontFamily: string
  fontSize: number
  axisTitleFontSize: number
  annotationFontSize: number
  regionFontSize: number
  sampleFontSize: number
  xAxisTitleStandoff: number
  yAxisTitleStandoff: number
  axisLineWidth: number
  xLeft: number
  xRight: number
  yMaxPadding: number
  verticalOffset: number
  lineWidth: number
  markerSize: number
  regionOpacity: number
  showRegionLabels: boolean
  showPeakMarkers: boolean
  showLegend: boolean
  exportWidth: number
  exportHeight: number
  exportScale: number
  exportDpi: number
}

type PlotlyExportApi = {
  newPlot: (root: HTMLDivElement, data: Plotly.Data[], layout: Partial<Plotly.Layout>, config?: Partial<Plotly.Config>) => Promise<unknown>
  toImage: (root: HTMLDivElement, opts: { format: string; width: number; height: number; scale?: number }) => Promise<string>
  purge: (root: HTMLDivElement) => void
}

const MODULES: { id: PlotModule; label: string; detail: string; enabled: boolean }[] = [
  { id: 'xps', label: 'XPS', detail: 'fit spectra / VBM / VB-DOS', enabled: true },
  { id: 'raman', label: 'Raman', detail: 'fit deconvolution', enabled: true },
  { id: 'xrd', label: 'XRD', detail: 'stacked log plot / reference peaks', enabled: true },
  { id: 'xas', label: 'XAS', detail: 'XES/XAS overlay + band gap', enabled: true },
  { id: 'xes', label: 'XES', detail: '預留：發射光譜比較', enabled: false },
]

const DEFAULT_COMPONENT_COLORS = ['#9b59b6', '#18a81f', '#1f78b4', '#f97316', '#a855f7', '#14b8a6', '#e11d48', '#64748b']
const XPS_SAMPLE_COLORS: Record<string, string> = {
  '50-0': '#136DE4',
  '45-5': '#E42213',
  '40-10': '#252526',
}

const XRD_TRACE_PRESETS = [
  { label: '40/10 (1013)', shortLabel: '40/10', color: '#252526', offset: 0.00, linewidth: 0.5 },
  { label: '45/5 (1020-1)', shortLabel: '45/5', color: '#E42213', offset: 0.71, linewidth: 0.5 },
  { label: '50/0 (1014)', shortLabel: '50/0', color: '#136DE4', offset: 1.46, linewidth: 0.5 },
]

const DEFAULT_XRD_REFERENCE_PEAKS: XrdReferencePeak[] = [
  { id: 'si-400', x: 69.1923, text: '(400)', lineColor: '#252526', textYFrac: 0.97, textXOffset: -1.0, enabled: true },
  { id: 'nio-111', x: 37.2326, text: '(111)', lineColor: '#916dda', textYFrac: 0.88, enabled: true },
  { id: 'bgo-201', x: 18.9, text: '(-201)', lineColor: '#38905f', textYFrac: 0.97, enabled: true },
  { id: 'bgo-400', x: 30.1682, text: '(400)', lineColor: '#38905f', textYFrac: 0.97, enabled: true },
  { id: 'bgo-002', x: 31.7043, text: '(002)', lineColor: '#38905f', textYFrac: 0.88, enabled: true },
  { id: 'bgo-111', x: 33.49, text: '(-111)', lineColor: '#38905f', textYFrac: 0.97, enabled: true },
  { id: 'bgo-402', x: 38.439, text: '(-402)', lineColor: '#38905f', textYFrac: 0.97, enabled: true },
  { id: 'bgo-603', x: 59.19, text: '(-603)', lineColor: '#38905f', textYFrac: 0.97, enabled: true },
  { id: 'nio-220', x: 62.8699, text: '(220)', lineColor: '#916dda', textYFrac: 0.88, enabled: true },
]

const DEFAULT_XRD_STYLE: XrdFigureStyle = {
  xShift: -0.02,
  normalizeEachCurve: true,
  showTitle: true,
  figureTitle: ' ',
  xMin: 15,
  xMax: 80,
  yMin: null,
  yMax: null,
  axisLabelSize: 12,
  tickLabelSize: 10,
  curveLabelSize: 9,
  peakLabelSize: 10,
  titleSize: 11,
  referenceLabelYShift: -0.10,
  referenceLabelYMaxFraction: 0.88,
  showReferencePeaks: true,
  showLegend: true,
  xAxisTitle: '2θ (deg)',
  yAxisTitle: 'Intensity (log cps)',
  exportWidth: 1488,
  exportHeight: 1008,
  exportScale: 3,
  exportDpi: 600,
}
const ROMAN_COMPONENT_LABELS = ['O<sub>Ⅰ</sub>', 'O<sub>Ⅱ</sub>', 'O<sub>Ⅲ</sub>', 'O<sub>Ⅳ</sub>', 'O<sub>Ⅴ</sub>']
const ROMAN_COMPONENT_COLORS = ['#9b59b6', '#18a81f', '#1f78b4', '#f97316', '#a855f7']
const ROMAN_COMPONENT_POSITIONS = [
  { labelX: 0.72, labelY: 0.78 },
  { labelX: 0.42, labelY: 0.70 },
  { labelX: 0.28, labelY: 0.42 },
  { labelX: 0.82, labelY: 0.58 },
  { labelX: 0.18, labelY: 0.55 },
]

const RAMAN_REFERENCE_DATABASES = [
  { id: 'default_raman_peaks.json', label: 'default_raman_peaks.json', url: '/peak_database/default_raman_peaks.json' },
]

const RAMAN_MATERIAL_COLORS: Record<string, string> = {
  ga2o3: '#1f77b4',
  'ga₂o₃': '#1f77b4',
  nio: '#d95f02',
  si: '#7b3294',
  other: '#4d4d4d',
}

const RAMAN_STRUCTURE_COLORS: Record<string, string> = {
  tetrahedral: '#7fd3ff',
  octahedral: '#96d38c',
  mixed: '#c9c9c9',
  substrate: '#d8b4ff',
  unknown: '#ededed',
}

const RAMAN_STRUCTURE_LABELS: Record<string, string> = {
  tetrahedral: 'tetrahedral / GaO4',
  octahedral: 'octahedral / GaO6 or NiO6',
  mixed: 'mixed / low-frequency',
  substrate: 'Si substrate',
  unknown: 'unknown',
}

const DEFAULT_STYLE: PlotFigureStyle = {
  titleLabel: 'O 1s',
  rawColor: '#111827',
  fitColor: '#d7191c',
  fixedLineColor: '#555555',
  rawMode: 'markers',
  rawMarkerSize: 4.5,
  rawMarkerLineWidth: 1.0,
  rawMarkerFillColor: '#ffffff',
  fontFamily: 'Times New Roman, Times, serif',
  fontSize: 18,
  xAxisFontSize: 22,
  yAxisFontSize: 22,
  xAxisTitleStandoff: 18,
  yAxisTitleStandoff: 18,
  panelTitleXPaper: 0.03,
  panelTitleYFraction: 0.84,
  sampleLabelXPaper: 0.97,
  sampleLabelYFraction: 0.74,
  axisLineWidth: 1.6,
  labelFontSize: 18,
  panelTitleFontSize: 26,
  sampleFontSize: 24,
  rawLineWidth: 1.0,
  fitLineWidth: 1.6,
  componentLineWidth: 1.35,
  fillOpacity: 0.26,
  yMax: 1.26,
  xLeft: null,
  xRight: null,
  exportWidth: 980,
  exportHeight: 1120,
  exportScale: 3,
  showPercent: true,
  showVerticalLines: true,
  ratioNumerator: '',
  ratioDenominator: '',
}

const XPS_OFFSET_POINTS_MIN = 50
const XPS_OFFSET_POINTS_MAX = 5000

const DEFAULT_XPS_OFFSET_SETTINGS: XpsOffsetSettings = {
  interpolate: false,
  nPoints: 1200,
}

const DEFAULT_VBM_STYLE: VbmFigureStyle = {
  titleLabel: 'VB',
  fontFamily: 'Times New Roman, Times, serif',
  fontSize: 16,
  xAxisFontSize: 22,
  yAxisFontSize: 22,
  xAxisTitleStandoff: 18,
  yAxisTitleStandoff: 18,
  axisLineWidth: 1.4,
  panelTitleFontSize: 24,
  sampleFontSize: 22,
  annotationFontSize: 16,
  spectrumColor: '#1f77b4',
  spectrumEdgeColor: '#0b4a8b',
  tangentColor: '#f28e2b',
  baselineColor: '#7e3fb2',
  vbmColor: '#00a65a',
  spectrumLineWidth: 1.4,
  fitLineWidth: 1.2,
  markerSize: 5,
  markerLineWidth: 0.8,
  regionOpacity: 0.14,
  labelOffsetX: -70,
  labelOffsetY: -48,
  yMax: 1.18,
  xLeft: 7,
  xRight: 0,
  exportWidth: 980,
  exportHeight: 920,
  exportScale: 3,
}

const DEFAULT_RAMAN_STYLE: RamanFigureStyle = {
  fontFamily: 'Times New Roman, Times, serif',
  fontSize: 16,
  axisTitleFontSize: 22,
  labelFontSize: 14,
  rawColor: '#111827',
  correctedColor: '#111827',
  fitColor: '#d7191c',
  componentColor: '#6b7280',
  baselineColor: '#2563eb',
  residualColor: '#4b5563',
  rawLineWidth: 0.9,
  correctedLineWidth: 1.1,
  fitLineWidth: 1.8,
  componentLineWidth: 1.0,
  baselineLineWidth: 1.1,
  residualLineWidth: 0.9,
  componentOpacity: 0.46,
  xLeft: null,
  xRight: null,
  yBottom: null,
  yTop: null,
  normalize: true,
  showRaw: true,
  showCorrected: true,
  showBaseline: true,
  showComponents: true,
  fillComponents: false,
  showLabels: true,
  confidenceFilter: 'all',
  overlayOffset: 0.82,
  showOverlayFit: true,
  showOverlayZoom: true,
  overlayZoomLeft: 100,
  overlayZoomRight: 850,
  showSiMask: true,
  siMaskCenter: 520,
  siMaskHalfWidth: 18,
  showReferencePeaks: true,
  referenceLabelMode: 'material-shift',
  referenceLineDash: 'dash',
  referenceLineWidth: 1,
  referenceLineOpacity: 0.75,
  referenceLabelYFraction: 0.92,
  referenceLabelWindowXShift: 0,
  referenceMatchTolerance: 8,
  showOverlayLegend: false,
  exportWidth: 1600,
  exportHeight: 900,
  exportScale: 4,
}

const XAS_BAND_COLORS = ['#1f77b4', '#2ca25f', '#c0392b', '#9467bd', '#f97316', '#0f766e', '#be123c', '#4b5563']
const XAS_SPECIAL_BASELINE_RANGE: [number, number] = [529.50, 530.30]
const XAS_SPECIAL_FIT_RANGE: [number, number] = [531.25, 531.55]
const XAS_SPECIAL_SAMPLES: Array<{ sample: XasSpecialSample; vbm: number; color: string }> = [
  { sample: '40-10', vbm: 527.154, color: '#252526' },
  { sample: '45-5', vbm: 527.149, color: '#E42213' },
  { sample: '50-0', vbm: 527.209, color: '#136DE4' },
]

const DEFAULT_XAS_BAND_STYLE: XasBandFigureStyle = {
  fontFamily: 'Times New Roman, Times, serif',
  fontSize: 16,
  axisTitleFontSize: 22,
  panelTitleFontSize: 28,
  sampleFontSize: 22,
  annotationFontSize: 16,
  vbmLabelFontSize: 16,
  cbmLabelFontSize: 16,
  egLabelFontSize: 16,
  xAxisTitleStandoff: 16,
  yAxisTitleStandoff: 18,
  axisLineWidth: 1.5,
  xLeft: 519,
  xRight: 545,
  yMin: -0.04,
  yMax: 1.18,
  manualYRange: false,
  xesTitle: 'XES',
  xasTitle: 'XAS',
  xAxisTitle: 'Photon energy / Emission energy (eV)',
  yAxisTitle: 'Intensity (a.u.)',
  normalizeIntensity: false,
  xesTitleXPaper: 0.07,
  xesTitleYPaper: 0.97,
  xasTitleXPaper: 0.88,
  xasTitleYPaper: 0.97,
  sampleLabelXPaper: 0.97,
  sampleLabelYFraction: 0.78,
  vbmLabelXShift: 0,
  vbmLabelYFraction: 0.96,
  cbmLabelXShift: 0,
  cbmLabelYFraction: 0.96,
  egLabelYFraction: 0.52,
  egLineYFraction: 0.44,
  xesLineWidth: 2.2,
  xasLineWidth: 2.2,
  fitLineWidth: 1.2,
  vbmColor: '#1f77b4',
  cbmColor: '#e53935',
  gapColor: '#f4d35e',
  baselineColor: '#6b7280',
  tangentColor: '#ef4444',
  regionOpacity: 0.08,
  gapOpacity: 0.2,
  showFitGuides: true,
  showLegend: true,
  exportWidth: 1500,
  exportHeight: 780,
  exportScale: 3,
}

const VB_DOS_ASSIGNMENT_NOTE = 'The assignments are qualitative and based on reported Ga2O3 pDOS/DFT references. The VB spectra should not be fitted as independent chemical-state peaks.'

const VB_DOS_ASSIGNMENT_REGIONS: VbDosAssignmentRegion[] = [
  {
    id: 'vbm-edge',
    start: 0.0,
    end: 0.6,
    label: 'VBM onset / O 2p-derived valence band edge / possible defect tail',
    shortLabel: 'VBM onset / O 2p edge',
    color: '#8dd3c7',
    labelXShift: 0,
    labelYPaper: 1.08,
    italicWords: 'VBM,O 2p',
  },
  {
    id: 'upper-o2p',
    start: 1.4,
    end: 2.3,
    label: 'upper O 2p valence band',
    shortLabel: 'upper O 2p',
    color: '#80b1d3',
    labelXShift: 0,
    labelYPaper: 1.005,
    italicWords: 'O 2p',
  },
  {
    id: 'hybridized',
    start: 3.0,
    end: 4.6,
    label: 'O 2p – Ga 4p / O 2s hybridized states',
    shortLabel: 'O 2p – Ga 4p / O 2s',
    color: '#fdb462',
    labelXShift: 0,
    labelYPaper: 1.08,
    italicWords: 'O 2p,Ga 4p,O 2s',
  },
  {
    id: 'bonding',
    start: 6.0,
    end: 7.5,
    label: 'lower O 2p / Ga–O bonding states',
    shortLabel: 'lower O 2p / Ga–O',
    color: '#b3de69',
    labelXShift: 0,
    labelYPaper: 1.005,
    italicWords: 'O 2p,Ga–O',
  },
  {
    id: 'ga3d',
    start: 10.0,
    end: 11.5,
    label: 'possible Ga 3d-derived semi-core contribution',
    shortLabel: 'possible Ga 3d semi-core',
    color: '#fccde5',
    labelXShift: 0,
    labelYPaper: 1.08,
    italicWords: 'Ga 3d',
  },
]

const DEFAULT_VB_DOS_STYLE: VbDosFigureStyle = {
  titleLabel: 'XPS VB / Ga2O3 pDOS-DFT assignment',
  fontFamily: 'Times New Roman, Times, serif',
  fontSize: 16,
  axisTitleFontSize: 22,
  annotationFontSize: 13,
  regionFontSize: 12,
  sampleFontSize: 16,
  xAxisTitleStandoff: 18,
  yAxisTitleStandoff: 18,
  axisLineWidth: 1.4,
  xLeft: 12,
  xRight: 0,
  yMaxPadding: 0.55,
  verticalOffset: 1.12,
  lineWidth: 1.45,
  markerSize: 6,
  regionOpacity: 0.24,
  showRegionLabels: true,
  showPeakMarkers: true,
  showLegend: false,
  exportWidth: 4200,
  exportHeight: 3000,
  exportScale: 1,
  exportDpi: 600,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function safeFileStem(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'plot'
}

function downloadDataUrl(dataUrl: string, name: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = name
  anchor.click()
}

function downloadTextFile(text: string, name: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  downloadBlob(blob, name)
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function asciiBytes(value: string) {
  return new TextEncoder().encode(value)
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  parts.forEach(part => {
    out.set(part, offset)
    offset += part.length
  })
  return out
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function buildSingleImagePdf(imageDataUrl: string, widthPx: number, heightPx: number, dpi: number) {
  const imageBytes = dataUrlToBytes(imageDataUrl)
  const pageWidth = Math.max(1, (widthPx / Math.max(dpi, 1)) * 72)
  const pageHeight = Math.max(1, (heightPx / Math.max(dpi, 1)) * 72)
  const content = `q\n${pageWidth.toFixed(3)} 0 0 ${pageHeight.toFixed(3)} 0 0 cm\n/Im0 Do\nQ\n`
  const objects: Uint8Array[] = [
    asciiBytes('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    asciiBytes('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    asciiBytes(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(3)} ${pageHeight.toFixed(3)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`),
    concatBytes([
      asciiBytes(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${Math.round(widthPx)} /Height ${Math.round(heightPx)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`),
      imageBytes,
      asciiBytes('\nendstream\nendobj\n'),
    ]),
    asciiBytes(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`),
  ]
  const chunks: Uint8Array[] = [asciiBytes('%PDF-1.4\n')]
  const offsets = [0]
  objects.forEach(object => {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    chunks.push(object)
  })
  const xrefOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    '%%EOF',
  ].join('\n')
  chunks.push(asciiBytes(xref))
  return new Blob([concatBytes(chunks)], { type: 'application/pdf' })
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '')
  const full = normalized.length === 3 ? normalized.split('').map(ch => ch + ch).join('') : normalized
  const value = Number.parseInt(full, 16)
  if (!Number.isFinite(value)) return `rgba(100,116,139,${alpha})`
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r},${g},${b},${alpha})`
}

function formatPlotLabel(label: string) {
  return label
    .replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>')
    .replace(/_([A-Za-z0-9]+)/g, '<sub>$1</sub>')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatItalicWords(label: string, italicWords: string) {
  const words = italicWords
    .split(/[,;\n]/)
    .map(word => word.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (words.length === 0) return formatPlotLabel(label)
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi')
  return formatPlotLabel(label).replace(pattern, '<i>$1</i>')
}

function percentile(values: number[], pct: number) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (finite.length === 0) return 0
  const idx = clamp((finite.length - 1) * pct, 0, finite.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return finite[lo]
  return finite[lo] + (finite[hi] - finite[lo]) * (idx - lo)
}

function positiveTrapzArea(x: number[], y: number[]) {
  let area = 0
  const n = Math.min(x.length, y.length)
  for (let i = 1; i < n; i += 1) {
    const y0 = Math.max(y[i - 1] ?? 0, 0)
    const y1 = Math.max(y[i] ?? 0, 0)
    area += ((y0 + y1) / 2) * ((x[i] ?? 0) - (x[i - 1] ?? 0))
  }
  return Math.abs(area)
}

function interpolateY(x: number[], y: number[], targetX: number) {
  const points = x
    .map((xValue, index) => ({ x: xValue, y: y[index] }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
  if (points.length === 0) return 0
  if (targetX <= points[0].x) return points[0].y
  if (targetX >= points[points.length - 1].x) return points[points.length - 1].y
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const next = points[i]
    if (targetX >= prev.x && targetX <= next.x) {
      const span = next.x - prev.x
      if (Math.abs(span) < 1e-12) return next.y
      const frac = (targetX - prev.x) / span
      return prev.y + (next.y - prev.y) * frac
    }
  }
  return points[points.length - 1].y
}

function buildLinearGrid(start: number, end: number, count: number) {
  const pointCount = Math.max(1, Math.round(count))
  if (pointCount === 1) return [start]
  return Array.from({ length: pointCount }, (_, index) => start + ((end - start) * index) / (pointCount - 1))
}

function splitDelimitedLine(line: string, delimiter: string) {
  if (delimiter === 'whitespace') return line.trim().split(/\s+/)
  const out: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      quoted = !quoted
    } else if (ch === delimiter && !quoted) {
      out.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  out.push(current.trim())
  return out
}

function csvEscape(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function rowsToCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  return [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(',')),
  ].join('\n')
}

function ramanMaterialKey(material: string) {
  return material.trim().toLowerCase().replace(/\s+/g, '')
}

function ramanMaterialColor(material: string) {
  return RAMAN_MATERIAL_COLORS[ramanMaterialKey(material)] ?? RAMAN_MATERIAL_COLORS.other
}

function ramanStructureColor(structure: string) {
  return RAMAN_STRUCTURE_COLORS[structure.trim().toLowerCase()] ?? RAMAN_STRUCTURE_COLORS.unknown
}

function displayRamanMaterial(material: string) {
  const key = ramanMaterialKey(material)
  if (key === 'ga2o3' || key === 'ga₂o₃') return 'Ga₂O₃'
  return material || 'Other'
}

function inferXpsSampleLabel(fileName: string) {
  const stem = safeFileStem(fileName)
  const lower = stem.toLowerCase()
  if (lower.includes('50-0') || lower.includes('50_0')) return '50-0'
  if (lower.includes('45-5') || lower.includes('45_5')) return '45-5'
  if (lower.includes('40-10') || lower.includes('40_10')) return '40-10'
  return stem
}

function xpsSampleColor(sampleLabel: string, index: number) {
  const normalized = sampleLabel.trim().replace(/_/g, '-')
  return XPS_SAMPLE_COLORS[normalized] ?? DEFAULT_COMPONENT_COLORS[index % DEFAULT_COMPONENT_COLORS.length] ?? '#111827'
}

function inferRamanSampleLabel(fileName: string) {
  const stem = safeFileStem(fileName)
  const lower = stem.toLowerCase()
  if (lower.includes('40-10') || lower.includes('40_10') || lower.includes('1013')) return '40-10'
  if (lower.includes('45-5') || lower.includes('45_5') || lower.includes('1020')) return '45-5'
  if (lower.includes('50-0') || lower.includes('50_0') || lower.includes('1014')) return '50-0'
  if (lower.includes('si')) return 'Si substrate'
  return stem
}

function parseRamanReferenceDatabase(payload: Record<string, unknown>, fallbackId: string): RamanReferenceDatabase {
  const databaseName = String(payload.database_name ?? fallbackId)
  const sources = Array.isArray(payload.sources) ? payload.sources as Array<Record<string, unknown>> : []
  const peaks: RamanReferencePeak[] = []

  sources.forEach((source, sourceIndex) => {
    const sourceId = String(source.source_id ?? `${fallbackId}_${sourceIndex + 1}`)
    const sourceMaterial = String(source.material ?? 'Other')
    const sourcePhase = String(source.phase ?? '')
    const citation = String(source.citation ?? '')
    const sourcePeaks = Array.isArray(source.peaks) ? source.peaks as Array<Record<string, unknown>> : []
    sourcePeaks.forEach((peak, peakIndex) => {
      const rawShift = peak['shift_cm-1'] ?? peak.shift ?? peak.shift_cm1
      const shift = Number(rawShift)
      if (!Number.isFinite(shift)) return
      const material = String(peak.material ?? sourceMaterial)
      const label = String(peak.label ?? `${material} ${shift}`)
      const displayLabel = String(
        peak.display_label
        ?? peak.displayLabel
        ?? peak.reference_label
        ?? peak.resonance_state
        ?? peak.resonanceState
        ?? peak.mode_state
        ?? peak.mode
        ?? label,
      )
      peaks.push({
        id: `${fallbackId}:${sourceId}:${material}:${shift}:${peakIndex}`,
        databaseId: fallbackId,
        databaseName,
        sourceId,
        citation,
        material,
        phase: String(peak.phase ?? sourcePhase),
        shift,
        defaultShift: shift,
        label,
        displayLabel,
        defaultDisplayLabel: displayLabel,
        resonanceState: String(peak.resonance_state ?? peak.resonanceState ?? peak.mode_state ?? ''),
        mode: String(peak.mode ?? ''),
        structure: String(peak.structure ?? 'unknown'),
        polyhedron: String(peak.polyhedron ?? ''),
        confidence: String(peak.confidence ?? ''),
        enabled: Boolean(peak.enabled ?? true),
      })
    })
  })

  return {
    id: fallbackId,
    name: databaseName,
    version: String(payload.version ?? ''),
    notes: String(payload.notes ?? ''),
    peaks,
  }
}

function parseRamanSpectrumText(text: string, fileName: string): RamanFitPlotFile {
  const x: number[] = []
  const raw: number[] = []
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  lines.forEach((line, index) => {
    const cleaned = index === 0 ? line.replace(/^\uFEFF/, '') : line
    if (cleaned.startsWith('#') || cleaned.startsWith('//')) return
    const delimiter = cleaned.includes('\t') ? '\t' : (cleaned.includes(',') ? ',' : 'whitespace')
    const cells = splitDelimitedLine(cleaned, delimiter)
    const numericCells = cells
      .map(cell => Number(cell))
      .filter(Number.isFinite)
    if (numericCells.length < 2) return
    x.push(numericCells[0])
    raw.push(numericCells[1])
  })

  if (x.length < 3) throw new Error(`${fileName}: Raman 原始檔至少需要兩欄數值資料`)
  const points = x
    .map((xValue, index) => ({ x: xValue, y: raw[index] }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
  const seen = new Set<number>()
  const cleanX: number[] = []
  const cleanY: number[] = []
  points.forEach(point => {
    if (seen.has(point.x)) return
    seen.add(point.x)
    cleanX.push(point.x)
    cleanY.push(point.y)
  })
  if (cleanX.length < 3) throw new Error(`${fileName}: Raman 原始檔有效資料點不足`)

  return {
    id: `${fileName}-${Math.random().toString(36).slice(2, 8)}`,
    name: fileName,
    sampleLabel: inferRamanSampleLabel(fileName),
    sourceType: 'spectrum',
    hasFit: false,
    overlayColor: '',
    overlayYOffset: 0,
    sampleLabelXPaper: 1.01,
    sampleLabelYOffset: 0.82,
    x: cleanX,
    raw: cleanY,
    baseline: Array(cleanX.length).fill(0),
    corrected: cleanY,
    totalFitCorrected: Array(cleanX.length).fill(0),
    totalFitRaw: Array(cleanX.length).fill(0),
    residual: Array(cleanX.length).fill(0),
    components: [],
  }
}

function chooseVbmColumns(headers: string[], rows: string[][], fileName: string) {
  const valuesByColumn = headers.map((_, columnIndex) => rows
    .map(row => Number(row[columnIndex]))
    .filter(Number.isFinite))
  const numericIndexes = valuesByColumn
    .map((values, index) => ({ index, count: values.length }))
    .filter(item => item.count >= 2)
    .sort((a, b) => b.count - a.count)
    .map(item => item.index)
  if (numericIndexes.length < 2) throw new Error(`${fileName}: 資料檔內至少需要兩欄數值資料`)

  const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const normalizedHeaders = headers.map(normal)
  const xIndex = numericIndexes.find(index => ['bindingenergyev', 'bindingenergy', 'energyev', 'energy', 'be'].some(key => normalizedHeaders[index].includes(key))) ?? numericIndexes[0]
  const yPriority = ['intensityprocessed', 'processedintensity', 'normalizedintensity', 'intensitynormalized', 'intensity', 'counts', 'signal']
  const yIndex = numericIndexes.find(index => index !== xIndex && yPriority.some(key => normalizedHeaders[index].includes(key)))
    ?? numericIndexes.find(index => index !== xIndex)
  if (yIndex === undefined) throw new Error(`${fileName}: 找不到可用的 intensity 欄位`)
  return { xIndex, yIndex }
}

function chooseFirstTwoNumericColumns(headers: string[], rows: string[][], fileName: string) {
  const numericIndexes = headers
    .map((_, columnIndex) => ({
      index: columnIndex,
      count: rows.map(row => Number(row[columnIndex])).filter(Number.isFinite).length,
    }))
    .filter(item => item.count >= 2)
    .sort((a, b) => a.index - b.index)
    .map(item => item.index)
  if (numericIndexes.length < 2) throw new Error(`${fileName}: 資料檔內至少需要兩欄數值資料`)
  return { xIndex: numericIndexes[0], yIndex: numericIndexes[1] }
}

function parseVbmSpectrumText(text: string, fileName: string): VbmSpectrumFile {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length < 3) throw new Error(`${fileName}: 資料列不足`)
  const headerLine = lines[0].replace(/^\uFEFF/, '')
  const delimiter = headerLine.includes('\t') ? '\t' : (headerLine.includes(',') ? ',' : 'whitespace')
  const firstCells = splitDelimitedLine(headerLine, delimiter)
  const firstRowIsNumeric = firstCells.length >= 2 && firstCells.filter(cell => Number.isFinite(Number(cell))).length >= 2
  const headers = firstRowIsNumeric ? firstCells.map((_, index) => `Column ${index + 1}`) : firstCells
  const dataLines = firstRowIsNumeric ? lines : lines.slice(1)
  const rows = dataLines.map(line => splitDelimitedLine(line, delimiter))
  const { xIndex, yIndex } = chooseVbmColumns(headers, rows, fileName)
  const x: number[] = []
  const y: number[] = []
  rows.forEach(row => {
    const xv = Number(row[xIndex])
    const yv = Number(row[yIndex])
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) return
    x.push(xv)
    y.push(yv)
  })
  if (x.length < 3) throw new Error(`${fileName}: 有效資料點不足`)
  const stem = safeFileStem(fileName.replace(/\s*VBM\s*/i, ' '))
  return {
    id: `${fileName}-${Math.random().toString(36).slice(2, 8)}`,
    name: fileName,
    sampleLabel: stem,
    xColumn: headers[xIndex] ?? `Column ${xIndex + 1}`,
    yColumn: headers[yIndex] ?? `Column ${yIndex + 1}`,
    x,
    y,
    baselineStart: 0.6,
    baselineEnd: 1.6,
    tangentStart: 4.2,
    tangentEnd: 5.2,
  }
}

function vbDosAssignmentForEnergy(relEnergy: number, regions = VB_DOS_ASSIGNMENT_REGIONS) {
  const region = regions.find(item => relEnergy >= item.start && relEnergy <= item.end)
  return region?.label ?? 'outside predefined Ga2O3 pDOS/DFT assignment windows'
}

function smoothArray(values: number[], windowSize: number) {
  const half = Math.floor(windowSize / 2)
  return values.map((_, index) => {
    let sum = 0
    let count = 0
    for (let offset = -half; offset <= half; offset += 1) {
      const value = values[index + offset]
      if (!Number.isFinite(value)) continue
      sum += value
      count += 1
    }
    return count > 0 ? sum / count : 0
  })
}

function normalizeVbDosIntensity(y: number[]) {
  const finite = y.filter(Number.isFinite)
  if (finite.length === 0) return y.map(() => 0)
  const minValue = Math.min(...finite)
  const shifted = y.map(value => Number.isFinite(value) ? value - minValue : 0)
  const maxValue = Math.max(...shifted.filter(Number.isFinite), 0)
  if (!Number.isFinite(maxValue) || maxValue <= 1e-15) return shifted.map(() => 0)
  return shifted.map(value => value / maxValue)
}

function detectVbDosPeaks(xRel: number[], yNorm: number[], beValues: number[], regions = VB_DOS_ASSIGNMENT_REGIONS) {
  const n = Math.min(xRel.length, yNorm.length, beValues.length)
  if (n < 3) return []
  const windowSize = Math.max(3, Math.min(11, Math.floor(n / 70) * 2 + 3))
  const smooth = smoothArray(yNorm.slice(0, n), windowSize % 2 === 0 ? windowSize + 1 : windowSize)
  const xRange = Math.max(...xRel.slice(0, n)) - Math.min(...xRel.slice(0, n))
  const prominenceWindow = Math.max(4, Math.floor(n / 22))
  const minDistance = Math.max(0.28, xRange / 22)
  const candidates: Array<{ index: number; prominence: number; intensity: number }> = []
  for (let i = 1; i < n - 1; i += 1) {
    if (smooth[i] < smooth[i - 1] || smooth[i] < smooth[i + 1]) continue
    if (smooth[i] < 0.08) continue
    const leftStart = Math.max(0, i - prominenceWindow)
    const rightEnd = Math.min(n, i + prominenceWindow + 1)
    const leftMin = Math.min(...smooth.slice(leftStart, i + 1))
    const rightMin = Math.min(...smooth.slice(i, rightEnd))
    const prominence = smooth[i] - Math.max(leftMin, rightMin)
    if (prominence < 0.015 && smooth[i] < 0.18) continue
    candidates.push({ index: i, prominence, intensity: smooth[i] })
  }
  if (candidates.length === 0) {
    const maxIndex = yNorm.indexOf(Math.max(...yNorm.slice(0, n)))
    if (maxIndex >= 0) candidates.push({ index: maxIndex, prominence: yNorm[maxIndex], intensity: yNorm[maxIndex] })
  }
  const selected: typeof candidates = []
  candidates
    .sort((a, b) => (b.prominence + b.intensity * 0.15) - (a.prominence + a.intensity * 0.15))
    .forEach(candidate => {
      const tooClose = selected.some(item => Math.abs(xRel[item.index] - xRel[candidate.index]) < minDistance)
      if (!tooClose && selected.length < 6) selected.push(candidate)
    })
  return selected
    .sort((a, b) => xRel[a.index] - xRel[b.index])
    .map((candidate, peakIndex): VbDosPeakAnnotation => {
      const relEnergy = xRel[candidate.index]
      const assignment = vbDosAssignmentForEnergy(relEnergy, regions)
      const shortRegion = regions.find(region => relEnergy >= region.start && relEnergy <= region.end)?.shortLabel ?? 'unassigned'
      return {
        id: `peak-${peakIndex}-${relEnergy.toFixed(4)}`,
        be: beValues[candidate.index],
        relEnergy,
        intensity: yNorm[candidate.index],
        assignment,
        label: `${relEnergy.toFixed(2)} eV<br>${shortRegion}`,
        visible: peakIndex < 3,
        labelXShift: [-42, 34, -28, 42, -34, 26][peakIndex % 6],
        labelYShift: [-46, -54, -38, -62, -44, -52][peakIndex % 6],
      }
    })
}

function parseVbDosSpectrumText(text: string, fileName: string, index: number): VbDosSpectrumFile {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^(#|%|!|\/\/)/.test(line))
  if (lines.length < 3) throw new Error(`${fileName}: 資料列不足`)
  const headerLine = lines[0].replace(/^\uFEFF/, '')
  const delimiter = headerLine.includes('\t') ? '\t' : (headerLine.includes(',') ? ',' : 'whitespace')
  const firstCells = splitDelimitedLine(headerLine, delimiter)
  const firstRowIsNumeric = firstCells.length >= 2 && firstCells.filter(cell => Number.isFinite(Number(cell))).length >= 2
  const headers = firstRowIsNumeric ? firstCells.map((_, columnIndex) => `Column ${columnIndex + 1}`) : firstCells
  const dataLines = firstRowIsNumeric ? lines : lines.slice(1)
  const rows = dataLines.map(line => splitDelimitedLine(line, delimiter))
  const { xIndex, yIndex } = chooseFirstTwoNumericColumns(headers, rows, fileName)
  const points = rows
    .map(row => ({ x: Number(row[xIndex]), y: Number(row[yIndex]) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
  const cleanX: number[] = []
  const cleanY: number[] = []
  const seen = new Set<number>()
  points.forEach(point => {
    if (seen.has(point.x)) return
    seen.add(point.x)
    cleanX.push(point.x)
    cleanY.push(point.y)
  })
  if (cleanX.length < 3) throw new Error(`${fileName}: 有效資料點不足`)
  const sampleLabel = inferXpsSampleLabel(fileName)
  const vbm = 0
  const yNorm = normalizeVbDosIntensity(cleanY)
  const xRel = cleanX.map(value => value - vbm)
  return {
    id: `vb-dos-${fileName}-${Math.random().toString(36).slice(2, 8)}`,
    name: fileName,
    sampleLabel,
    color: xpsSampleColor(sampleLabel, index),
    sampleLabelXFraction: 0.99,
    sampleLabelYOffset: 0.82,
    xColumn: headers[xIndex] ?? `Column ${xIndex + 1}`,
    yColumn: headers[yIndex] ?? `Column ${yIndex + 1}`,
    x: cleanX,
    y: cleanY,
    vbm,
    peaks: detectVbDosPeaks(xRel, yNorm, cleanX),
  }
}

function inferXasBandSampleLabel(fileName: string) {
  return safeFileStem(fileName)
    .replace(/(^|[_-])(xes|xas|tfy|tey|xanes|normalized|flattened)([_-]|$)/ig, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || safeFileStem(fileName)
}

function defaultXasBandRanges(x: number[], kind: XasBandFileKind) {
  const xMin = Math.min(...x)
  const xMax = Math.max(...x)
  const span = Math.max(xMax - xMin, 1)
  if (kind === 'xes') {
    return {
      baselineStart: xMin + span * 0.72,
      baselineEnd: xMin + span * 0.92,
      tangentStart: xMin + span * 0.58,
      tangentEnd: xMin + span * 0.72,
    }
  }
  return {
    baselineStart: xMin + span * 0.05,
    baselineEnd: xMin + span * 0.22,
    tangentStart: xMin + span * 0.22,
    tangentEnd: xMin + span * 0.42,
  }
}

function parseXasBandSpectrumText(text: string, fileName: string, kind: XasBandFileKind, color: string): XasBandEdgeFile {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^(#|%|!|\/\/)/.test(line))
  if (lines.length < 3) throw new Error(`${fileName}: 資料列不足`)
  const headerLine = lines[0].replace(/^\uFEFF/, '')
  const delimiter = headerLine.includes('\t') ? '\t' : (headerLine.includes(',') ? ',' : 'whitespace')
  const firstCells = splitDelimitedLine(headerLine, delimiter)
  const firstRowIsNumeric = firstCells.length >= 2 && firstCells.filter(cell => Number.isFinite(Number(cell))).length >= 2
  const headers = firstRowIsNumeric ? firstCells.map((_, index) => `Column ${index + 1}`) : firstCells
  const dataLines = firstRowIsNumeric ? lines : lines.slice(1)
  const rows = dataLines.map(line => splitDelimitedLine(line, delimiter))
  const { xIndex, yIndex } = chooseVbmColumns(headers, rows, fileName)
  const points = rows
    .map(row => ({ x: Number(row[xIndex]), y: Number(row[yIndex]) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
  const cleanX: number[] = []
  const cleanY: number[] = []
  const seen = new Set<number>()
  points.forEach(point => {
    if (seen.has(point.x)) return
    seen.add(point.x)
    cleanX.push(point.x)
    cleanY.push(point.y)
  })
  if (cleanX.length < 3) throw new Error(`${fileName}: 有效資料點不足`)
  const ranges = defaultXasBandRanges(cleanX, kind)
  const xMin = Math.min(...cleanX)
  const xMax = Math.max(...cleanX)
  return {
    id: `${kind}-${fileName}-${Math.random().toString(36).slice(2, 8)}`,
    name: fileName,
    sampleLabel: inferXasBandSampleLabel(fileName),
    kind,
    xColumn: headers[xIndex] ?? `Column ${xIndex + 1}`,
    yColumn: headers[yIndex] ?? `Column ${yIndex + 1}`,
    x: cleanX,
    y: cleanY,
    color,
    displayStart: xMin,
    displayEnd: xMax,
    ...ranges,
  }
}

function inferXrdColumnLabel(header: string, index: number) {
  const preset = XRD_TRACE_PRESETS[index - 1]
  if (preset) return preset.label
  return header && !/^Column\s+\d+$/i.test(header) ? header : `Trace ${index}`
}

function xrdMatchedPresetForLabel(label: string) {
  const normalized = label.toLowerCase().replace(/[_\s]+/g, '-')
  if (normalized.includes('40-10') || normalized.includes('40/10') || normalized.includes('1013')) return XRD_TRACE_PRESETS[0]
  if (normalized.includes('45-5') || normalized.includes('45/5') || normalized.includes('1020')) return XRD_TRACE_PRESETS[1]
  if (normalized.includes('50-0') || normalized.includes('50/0') || normalized.includes('1014')) return XRD_TRACE_PRESETS[2]
  return null
}

function xrdPresetForLabel(label: string, fallbackIndex: number) {
  const matched = xrdMatchedPresetForLabel(label)
  if (matched) return matched
  return XRD_TRACE_PRESETS[fallbackIndex]
}

function inferXrdTraceLabel(fileName: string, header: string, traceIndex: number, traceCount: number) {
  const stem = safeFileStem(fileName)
  const filePreset = xrdMatchedPresetForLabel(stem)
  const headerPreset = xrdMatchedPresetForLabel(header)
  if (traceCount === 1 && filePreset) return filePreset.label
  if (headerPreset) return headerPreset.label
  if (header && !/^Column\s+\d+$/i.test(header)) return header
  return traceCount === 1 ? stem : inferXrdColumnLabel(header, traceIndex + 1)
}

function parseXrdTraceText(text: string, fileName: string, startIndex: number): XrdSourceTrace[] {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^(#|%|!|\/\/)/.test(line))
  if (lines.length < 3) throw new Error(`${fileName}: XRD data needs at least three data rows`)
  const firstLine = lines[0].replace(/^\uFEFF/, '')
  const delimiter = firstLine.includes('\t') ? '\t' : (firstLine.includes(',') ? ',' : 'whitespace')
  const firstCells = splitDelimitedLine(firstLine, delimiter)
  const firstRowIsNumeric = firstCells.length >= 2 && firstCells.filter(cell => Number.isFinite(Number(cell))).length >= 2
  const headers = firstRowIsNumeric ? firstCells.map((_, index) => `Column ${index + 1}`) : firstCells
  const dataLines = firstRowIsNumeric ? lines : lines.slice(1)
  const rows = dataLines.map(line => splitDelimitedLine(line, delimiter))
  const numericIndexes = headers
    .map((_, columnIndex) => ({
      index: columnIndex,
      count: rows.map(row => Number(row[columnIndex])).filter(Number.isFinite).length,
    }))
    .filter(item => item.count >= 3)
    .sort((a, b) => a.index - b.index)
    .map(item => item.index)
  if (numericIndexes.length < 2) throw new Error(`${fileName}: XRD data needs one 2theta column and at least one intensity column`)

  const xIndex = numericIndexes[0]
  const yIndexes = numericIndexes.slice(1)
  const traceColumns = yIndexes.map(() => ({ x: [] as number[], y: [] as number[] }))
  rows.forEach(row => {
    const xValue = Number(row[xIndex])
    if (!Number.isFinite(xValue)) return
    yIndexes.forEach((columnIndex, index) => {
      const yValue = Number(row[columnIndex])
      if (!Number.isFinite(yValue)) return
      traceColumns[index].x.push(xValue)
      traceColumns[index].y.push(yValue)
    })
  })
  const validColumns = traceColumns
    .map((column, index) => ({ ...column, index }))
    .filter(column => column.x.length >= 3)
  if (validColumns.length === 0) throw new Error(`${fileName}: XRD data has too few valid points`)

  return validColumns.map((column, localIndex): XrdSourceTrace => {
    const sourceColumn = yIndexes[column.index]
    const header = headers[sourceColumn] ?? ''
    const label = inferXrdTraceLabel(fileName, header, startIndex + localIndex, validColumns.length)
    const preset = xrdPresetForLabel(`${fileName} ${header} ${label}`, startIndex + localIndex)
    return {
      id: `xrd-${fileName}-${sourceColumn}-${Math.random().toString(36).slice(2, 8)}`,
      sourceFile: fileName,
      sourceColumn,
      label,
      shortLabel: preset?.shortLabel ?? safeFileStem(fileName),
      xColumn: headers[xIndex] ?? '2theta',
      yColumn: header || `Column ${sourceColumn + 1}`,
      color: preset?.color ?? DEFAULT_COMPONENT_COLORS[(startIndex + localIndex) % DEFAULT_COMPONENT_COLORS.length] ?? '#111827',
      offset: preset?.offset ?? (startIndex + localIndex) * 0.75,
      linewidth: preset?.linewidth ?? 0.5,
      visible: true,
      x: column.x,
      y: column.y,
    }
  })
}

function processXrdCurve(yRaw: number[], normalize: boolean) {
  const finite = yRaw.filter(Number.isFinite)
  if (finite.length === 0) return null
  const baseline = percentile(finite, 0.01)
  const yLog = yRaw.map(value => {
    if (!Number.isFinite(value)) return Number.NaN
    const corrected = Math.max(value - baseline + 1, 1)
    return Math.log10(corrected)
  })
  if (!normalize) return yLog
  const valid = yLog.filter(Number.isFinite)
  if (valid.length === 0) return null
  const lo = percentile(valid, 0.01)
  const hi = percentile(valid, 0.997)
  const denom = Number.isFinite(hi - lo) && hi > lo ? hi - lo : 1
  return yLog.map(value => Number.isFinite(value) ? (value - lo) / denom : Number.NaN)
}

function buildXrdStackedFigure(
  traces: XrdSourceTrace[],
  style: XrdFigureStyle,
  referencePeaks: XrdReferencePeak[],
): { data: Plotly.Data[]; layout: Partial<Plotly.Layout>; processedRows: Array<Record<string, unknown>> } | null {
  const data: Plotly.Data[] = []
  const annotations: object[] = []
  const shapes: Partial<Plotly.Shape>[] = []
  const processedRows: Array<Record<string, unknown>> = []
  const plottedOffsets: number[] = []
  const plottedValues: number[] = []

  traces.filter(trace => trace.visible).forEach(trace => {
    const yProcessed = processXrdCurve(trace.y, style.normalizeEachCurve)
    if (!yProcessed) return
    const xShifted = trace.x.map(value => value + style.xShift)
    const yPlot = yProcessed.map(value => Number.isFinite(value) ? value + trace.offset : Number.NaN)
    plottedOffsets.push(trace.offset)
    plottedValues.push(...yPlot.filter(Number.isFinite))
    xShifted.forEach((xValue, index) => {
      if (!processedRows[index]) processedRows[index] = { row: index + 1 }
      processedRows[index][`${trace.label}_2theta`] = Number.isFinite(xValue) ? xValue : ''
      processedRows[index][trace.label] = Number.isFinite(yPlot[index]) ? yPlot[index] : ''
    })
    data.push({
      x: xShifted,
      y: yPlot,
      type: 'scatter',
      mode: 'lines',
      name: trace.label,
      line: { color: trace.color, width: trace.linewidth },
      hovertemplate: `${trace.label}<br>2theta %{x:.3f}<br>Intensity %{y:.4f}<extra></extra>`,
    })
  })

  if (data.length === 0) return null
  const yMinAuto = plottedOffsets.length > 0 ? Math.min(...plottedOffsets) - 0.25 : Math.min(...plottedValues, 0)
  const yMaxAuto = yMinAuto + 3.125
  const yMin = Number.isFinite(style.yMin ?? NaN) ? Number(style.yMin) : yMinAuto
  const yMax = Number.isFinite(style.yMax ?? NaN) ? Number(style.yMax) : yMaxAuto

  if (style.showReferencePeaks) {
    referencePeaks.filter(peak => peak.enabled).forEach(peak => {
      const xPeak = peak.x + style.xShift
      if (xPeak < style.xMin || xPeak > style.xMax) return
      shapes.push({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: xPeak,
        x1: xPeak,
        y0: 0,
        y1: 1,
        line: { color: peak.lineColor, width: 0.7, dash: 'dash' },
        opacity: 0.85,
        layer: 'below',
      })
      const yFraction = Math.min(peak.textYFrac + style.referenceLabelYShift, style.referenceLabelYMaxFraction)
      annotations.push({
        x: xPeak + (peak.textXOffset ?? 0),
        y: yMin + (yMax - yMin) * clamp(yFraction, 0, 1),
        xref: 'x',
        yref: 'y',
        text: peak.text,
        textangle: -90,
        showarrow: false,
        xanchor: 'center',
        yanchor: 'bottom',
        font: { family: 'Times New Roman, Times, serif', size: style.peakLabelSize, color: peak.lineColor },
        bgcolor: 'rgba(255,255,255,0.88)',
        borderpad: 1,
      })
    })
  }

  if (style.showTitle) {
    annotations.push({
      x: 0.03,
      y: 0.95,
      xref: 'paper',
      yref: 'paper',
      text: `<b>${style.figureTitle || ' '}</b>`,
      showarrow: false,
      xanchor: 'left',
      yanchor: 'top',
      font: { family: 'Times New Roman, Times, serif', size: style.titleSize, color: '#111827' },
    })
  }

  return {
    data,
    processedRows,
    layout: {
      autosize: true,
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      font: { family: 'Times New Roman, Times, serif', size: style.tickLabelSize, color: '#111827' },
      margin: { l: 120, r: 110, t: 70, b: 92 },
      showlegend: style.showLegend,
      legend: { x: 0.99, y: 0.98, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.78)', font: { size: style.curveLabelSize, family: 'Times New Roman, Times, serif', color: '#111827' } },
      xaxis: {
        range: [style.xMin, style.xMax],
        title: { text: style.xAxisTitle, font: { family: 'Times New Roman, Times, serif', size: style.axisLabelSize, color: '#111827' }, standoff: 16 },
        showgrid: false,
        zeroline: false,
        showline: true,
        mirror: true,
        linewidth: 0.8,
        linecolor: '#111827',
        ticks: 'inside',
        dtick: 10,
        minor: { dtick: 2, ticks: 'inside' },
        tickfont: { family: 'Times New Roman, Times, serif', size: style.tickLabelSize, color: '#111827' },
      },
      yaxis: {
        range: [yMin, yMax],
        title: { text: style.yAxisTitle, font: { family: 'Times New Roman, Times, serif', size: style.axisLabelSize, color: '#111827' }, standoff: 18 },
        showgrid: false,
        zeroline: false,
        showline: true,
        mirror: true,
        linewidth: 0.8,
        linecolor: '#111827',
        ticks: 'inside',
        showticklabels: false,
      },
      annotations: annotations as unknown as Plotly.Layout['annotations'],
      shapes: shapes as Plotly.Shape[],
    },
  }
}

function buildXrdProcessedCsv(rows: Array<Record<string, unknown>>) {
  const headers = Array.from(new Set(rows.flatMap(row => Object.keys(row)))).filter(header => header !== 'row')
  return rowsToCsv(headers, rows)
}

function parseFitSpectrumText(text: string, fileName: string): FitSpectrumFile {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length < 3) throw new Error(`${fileName}: 資料列不足`)
  const headerLine = lines[0]
  const delimiter = headerLine.includes('\t') ? '\t' : (headerLine.includes(',') ? ',' : 'whitespace')
  const headers = splitDelimitedLine(headerLine, delimiter)
  const rows = lines.slice(1).map(line => splitDelimitedLine(line, delimiter))
  const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const normalizedHeaders = headers.map(normal)
  const findIndex = (candidates: string[]) => normalizedHeaders.findIndex(header => candidates.some(candidate => header.includes(candidate)))
  const xIndex = findIndex(['bindingenergyev', 'bindingenergy', 'energyev', 'energy'])
  const observedIndex = findIndex(['observed', 'raw', 'input'])
  const fitIndex = findIndex(['totalfit', 'fit', 'model'])
  if (xIndex < 0 || observedIndex < 0 || fitIndex < 0) {
    throw new Error(`${fileName}: 找不到 Binding_Energy_eV / Observed / Total_Fit 欄位`)
  }

  const excluded = new Set([xIndex, observedIndex, fitIndex])
  const componentIndexes = headers
    .map((header, index) => ({ header, index, key: normalizedHeaders[index] }))
    .filter(item => !excluded.has(item.index))
    .filter(item => !['residual', 'residuals', 'background', 'baseline'].some(skip => item.key.includes(skip)))

  const x: number[] = []
  const observed: number[] = []
  const totalFit: number[] = []
  const components: Record<string, number[]> = Object.fromEntries(componentIndexes.map(item => [item.header, []]))

  rows.forEach(row => {
    const xv = Number(row[xIndex])
    const yObs = Number(row[observedIndex])
    const yFit = Number(row[fitIndex])
    if (!Number.isFinite(xv) || !Number.isFinite(yObs) || !Number.isFinite(yFit)) return
    x.push(xv)
    observed.push(yObs)
    totalFit.push(yFit)
    componentIndexes.forEach(item => {
      const value = Number(row[item.index])
      components[item.header].push(Number.isFinite(value) ? value : 0)
    })
  })

  if (x.length < 3 || componentIndexes.length === 0) {
    throw new Error(`${fileName}: 有效資料或 component 欄位不足`)
  }

  return {
    id: `${fileName}-${Math.random().toString(36).slice(2, 8)}`,
    name: fileName,
    sampleLabel: safeFileStem(fileName),
    xOffsetEv: 0,
    x,
    observed,
    totalFit,
    components,
  }
}

function numericArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(item => Number(item)).filter(Number.isFinite) : []
}

function sameLength(values: number[], length: number) {
  if (values.length === length) return values
  if (values.length > length) return values.slice(0, length)
  return [...values, ...Array(Math.max(0, length - values.length)).fill(0)]
}

function ramanComponentColor(index: number, fallback: string) {
  return DEFAULT_COMPONENT_COLORS[index % DEFAULT_COMPONENT_COLORS.length] || fallback
}

function withRamanOverlayDefaults(file: RamanFitPlotFile, index: number): RamanFitPlotFile {
  return {
    ...file,
    overlayColor: file.overlayColor || ramanComponentColor(index, DEFAULT_RAMAN_STYLE.correctedColor),
    overlayYOffset: Number.isFinite(file.overlayYOffset) ? file.overlayYOffset : 0,
    sampleLabelXPaper: Number.isFinite(file.sampleLabelXPaper) ? file.sampleLabelXPaper : 1.01,
    sampleLabelYOffset: Number.isFinite(file.sampleLabelYOffset) ? file.sampleLabelYOffset : 0.82,
  }
}

function ramanComponentDisplayLabel(label: string, center: number) {
  const withoutCenter = String(label || 'unassigned Raman component')
    .replace(/,\s*[-+]?\d+(?:\.\d+)?\s*cm(?:⁻¹|-1)?\s*$/i, '')
    .trim()
  return `${withoutCenter || 'unassigned Raman component'}<br>${center.toFixed(1)} cm⁻¹`
}

function buildRamanComponentPeakMarkers(
  components: RamanComponentCurve[],
  enabled: boolean,
  fontFamily: string,
  fontSize: number,
  fallbackColor: string,
) {
  if (!enabled || components.length === 0) return { annotations: [] as object[], shapes: [] as object[] }
  const sorted = components
    .map((component, index) => ({ component, index }))
    .filter(({ component }) => component.center != null && Number.isFinite(component.center))
    .sort((a, b) => Number(a.component.center) - Number(b.component.center))
  const recentCenters: number[] = []
  const annotations: object[] = []
  const shapes: object[] = []
  sorted.forEach(({ component, index }) => {
    const center = Number(component.center)
    const color = ramanComponentColor(index, fallbackColor)
    const closeCount = recentCenters.filter(value => Math.abs(value - center) <= 28).length
    recentCenters.push(center)
    const lane = closeCount % 4
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: center,
      x1: center,
      y0: 0,
      y1: 1,
      line: { color, width: 1, dash: 'dot' },
      opacity: 0.34,
      layer: 'below',
    })
    annotations.push({
      x: center,
      y: 1.02 + lane * 0.07,
      xref: 'x',
      yref: 'paper',
      text: ramanComponentDisplayLabel(component.label, center),
      showarrow: false,
      xanchor: 'center',
      yanchor: 'bottom',
      align: 'center',
      font: { family: fontFamily, size: fontSize, color },
      bgcolor: 'rgba(255,255,255,0.86)',
      bordercolor: color,
      borderwidth: 1,
      borderpad: 3,
    })
  })
  return { annotations, shapes }
}

function parseRamanFitJson(text: string, fileName: string): RamanFitPlotFile {
  const payload = JSON.parse(text) as Record<string, unknown>
  const x = numericArray(payload.x_calibrated)
  if (x.length < 3) throw new Error(`${fileName}: 找不到 Raman fit JSON 的 x_calibrated`)

  const baseline = sameLength(numericArray(payload.y_baseline), x.length)
  const corrected = sameLength(numericArray(payload.y_corrected), x.length)
  const raw = corrected.map((value, index) => value + (baseline[index] ?? 0))
  const fitCorrected = numericArray(payload.total_fit_corrected ?? payload.y_fit_corrected)
  const fitWithBaseline = numericArray(payload.total_fit_raw ?? payload.y_fit)
  const totalFitCorrected = fitCorrected.length > 0
    ? sameLength(fitCorrected, x.length)
    : sameLength(fitWithBaseline, x.length).map((value, index) => value - (baseline[index] ?? 0))
  const totalFitRaw = fitWithBaseline.length > 0
    ? sameLength(fitWithBaseline, x.length)
    : totalFitCorrected.map((value, index) => value + (baseline[index] ?? 0))
  const residual = sameLength(numericArray(payload.residuals), x.length)
  const peakRows = Array.isArray(payload.peaks) ? payload.peaks as Array<Record<string, unknown>> : []
  const individual = Array.isArray(payload.y_individual) ? payload.y_individual as unknown[] : []
  const componentPayload = Array.isArray(payload.components) ? payload.components as Array<Record<string, unknown>> : []
  const components = (componentPayload.length > 0 ? componentPayload : individual.map((item, index) => ({
    y_component_corrected: item,
    y_component_raw: sameLength(numericArray(item), x.length).map((value, curveIndex) => value + (baseline[curveIndex] ?? 0)),
    component_label: peakRows[index]?.Peak_Name ?? peakRows[index]?.Mode_Label ?? peakRows[index]?.Material ?? `Peak ${index + 1}`,
    component_group: peakRows[index]?.Phase_Group ?? '',
    component_material: peakRows[index]?.Material ?? '',
    assignment: peakRows[index]?.Assignment_Label ?? '',
    label_type: peakRows[index]?.Assignment_Type ?? '',
    mode_label: peakRows[index]?.Mode_Label ?? '',
    status: peakRows[index]?.Status ?? '',
    profile: peakRows[index]?.Profile ?? '',
    confidence: peakRows[index]?.Physical_Confidence ?? peakRows[index]?.Confidence ?? '',
    confidence_score: peakRows[index]?.Confidence_Score,
    center: peakRows[index]?.Center_cm ?? peakRows[index]?.fitted_center_cm ?? peakRows[index]?.center,
    area: peakRows[index]?.Area,
    area_percent: peakRows[index]?.Area_pct,
  }))).map((item, index): RamanComponentCurve | null => {
    const row = item as Record<string, unknown>
    const yCorrected = sameLength(numericArray(row.y_component_corrected), x.length)
    const yRaw = sameLength(numericArray(row.y_component_raw), x.length)
    if (yRaw.every(value => Math.abs(value) < 1e-12) && yCorrected.every(value => Math.abs(value) < 1e-12)) return null
    const center = Number(row.center)
    const area = Number(row.area)
    const areaPercent = Number(row.area_percent)
    const confidenceScore = Number(row.confidence_score ?? row.Confidence_Score ?? peakRows[index]?.Confidence_Score)
    return {
      label: String(row.component_label ?? `Peak ${index + 1}`),
      group: String(row.component_group ?? ''),
      material: String(row.component_material ?? ''),
      assignment: String(row.assignment ?? ''),
      labelType: String(row.label_type ?? ''),
      modeLabel: String(row.mode_label ?? ''),
      status: String(row.status ?? ''),
      profile: String(row.profile ?? ''),
      center: Number.isFinite(center) ? center : null,
      area: Number.isFinite(area) ? area : null,
      areaPercent: Number.isFinite(areaPercent) ? areaPercent : null,
      confidence: String(row.confidence ?? row.Physical_Confidence ?? row.Confidence ?? peakRows[index]?.Physical_Confidence ?? peakRows[index]?.Confidence ?? ''),
      confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : null,
      visible: true,
      yCorrected,
      yRaw,
    }
  }).filter((item): item is RamanComponentCurve => Boolean(item))

  if (components.length === 0 && totalFitRaw.every(value => Math.abs(value) < 1e-12)) {
    throw new Error(`${fileName}: JSON 內沒有可用的 component 或 fit curve`)
  }

  const report = payload.report as Record<string, unknown> | undefined
  return {
    id: `${fileName}-${Math.random().toString(36).slice(2, 8)}`,
    name: fileName,
    sampleLabel: String(payload.dataset_name ?? report?.sample_id ?? safeFileStem(fileName)),
    sourceType: 'fit-json',
    hasFit: true,
    overlayColor: '',
    overlayYOffset: 0,
    sampleLabelXPaper: 1.01,
    sampleLabelYOffset: 0.82,
    x,
    raw,
    baseline,
    corrected,
    totalFitCorrected,
    totalFitRaw,
    residual,
    components,
  }
}

function createDefaultComponentStyle(component: string, index: number): ComponentStyle {
  return {
    label: component,
    color: DEFAULT_COMPONENT_COLORS[index % DEFAULT_COMPONENT_COLORS.length],
    labelX: clamp(0.36 + index * 0.2, 0.18, 0.84),
    labelY: clamp(0.9 - index * 0.13, 0.34, 0.92),
    markerCenter: null,
    show: true,
  }
}

function componentKeys(files: FitSpectrumFile[]) {
  return Array.from(new Set(files.flatMap(file => Object.keys(file.components))))
}

function componentAreas(file: FitSpectrumFile, keys: string[]) {
  const areas = Object.fromEntries(keys.map(key => [key, positiveTrapzArea(file.x, file.components[key] ?? [])]))
  const total = Object.values(areas).reduce((sum, value) => sum + value, 0)
  return Object.fromEntries(keys.map(key => [key, total > 0 ? areas[key] / total * 100 : 0]))
}

function shiftedXpsFile(file: FitSpectrumFile): FitSpectrumFile {
  const offset = Number.isFinite(file.xOffsetEv) ? file.xOffsetEv : 0
  if (Math.abs(offset) < 1e-12) return file
  return {
    ...file,
    x: file.x.map(value => value + offset),
  }
}

function xpsOffsetGridInfo(files: FitSpectrumFile[], nPoints: number) {
  if (files.length === 0) return null
  const shifted = files.map(shiftedXpsFile)
  const ranges = shifted
    .map(file => {
      const finite = file.x.filter(Number.isFinite)
      if (finite.length < 2) return null
      return { min: Math.min(...finite), max: Math.max(...finite) }
    })
    .filter((range): range is { min: number; max: number } => range !== null)
  if (ranges.length !== shifted.length) return null
  const overlapMin = Math.max(...ranges.map(range => range.min))
  const overlapMax = Math.min(...ranges.map(range => range.max))
  if (!Number.isFinite(overlapMin) || !Number.isFinite(overlapMax) || overlapMax <= overlapMin) return null
  const first = shifted[0]
  const descending = (first.x[0] ?? 0) > (first.x[first.x.length - 1] ?? 0)
  const pointCount = Math.round(clamp(nPoints, XPS_OFFSET_POINTS_MIN, XPS_OFFSET_POINTS_MAX))
  return {
    start: descending ? overlapMax : overlapMin,
    end: descending ? overlapMin : overlapMax,
    min: overlapMin,
    max: overlapMax,
    pointCount,
  }
}

function buildXpsOffsetFiles(files: FitSpectrumFile[], settings: XpsOffsetSettings): FitSpectrumFile[] {
  const shifted = files.map(shiftedXpsFile)
  if (!settings.interpolate || shifted.length === 0) return shifted
  const gridInfo = xpsOffsetGridInfo(files, settings.nPoints)
  if (!gridInfo) return shifted
  const targetX = buildLinearGrid(gridInfo.start, gridInfo.end, gridInfo.pointCount)
  return shifted.map(file => {
    const components = Object.fromEntries(Object.entries(file.components).map(([key, values]) => [
      key,
      targetX.map(xValue => interpolateY(file.x, values, xValue)),
    ]))
    return {
      ...file,
      x: targetX,
      observed: targetX.map(xValue => interpolateY(file.x, file.observed, xValue)),
      totalFit: targetX.map(xValue => interpolateY(file.x, file.totalFit, xValue)),
      components,
    }
  })
}

function buildXpsOffsetCsv(files: FitSpectrumFile[], keys: string[]) {
  const headers = ['sample', 'source_file', 'x_offset_ev', 'binding_energy_ev', 'observed', 'total_fit', ...keys]
  const rows = files.flatMap(file => file.x.map((xValue, index) => {
    const row: Record<string, unknown> = {
      sample: file.sampleLabel,
      source_file: file.name,
      x_offset_ev: file.xOffsetEv,
      binding_energy_ev: xValue,
      observed: file.observed[index] ?? '',
      total_fit: file.totalFit[index] ?? '',
    }
    keys.forEach(key => {
      row[key] = file.components[key]?.[index] ?? ''
    })
    return row
  }))
  return rowsToCsv(headers, rows)
}

function scaledSeries(values: number[], factor: number) {
  return values.map(value => value / factor)
}

function ramanConfidenceLevel(component: RamanComponentCurve): 'High' | 'Medium' | 'Low' | 'Unknown' {
  const label = String(component.confidence || '').toLowerCase()
  if (label.includes('high')) return 'High'
  if (label.includes('medium')) return 'Medium'
  if (label.includes('low')) return 'Low'
  if (component.confidenceScore != null && Number.isFinite(component.confidenceScore)) {
    if (component.confidenceScore >= 75) return 'High'
    if (component.confidenceScore >= 45) return 'Medium'
    return 'Low'
  }
  return 'Unknown'
}

function ramanConfidenceRank(component: RamanComponentCurve) {
  const level = ramanConfidenceLevel(component)
  if (level === 'High') return 3
  if (level === 'Medium' || level === 'Unknown') return 2
  return 1
}

function ramanConfidenceMatches(component: RamanComponentCurve, filter: RamanConfidenceFilter) {
  const rank = ramanConfidenceRank(component)
  if (filter === 'all') return true
  if (filter === 'high') return rank >= 3
  if (filter === 'medium-up') return rank >= 2
  return rank <= 1
}

function visibleRamanComponents(file: RamanFitPlotFile, style: RamanFigureStyle) {
  return file.components.filter(component => component.visible !== false && ramanConfidenceMatches(component, style.confidenceFilter))
}

function ramanScaleFactor(file: RamanFitPlotFile, style: RamanFigureStyle) {
  if (!style.normalize) return 1
  const candidates = [...file.corrected, ...file.totalFitCorrected]
    .map(value => Math.abs(value))
    .filter(Number.isFinite)
  return Math.max(...candidates, 1)
}

function formatRamanShift(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '')
}

function manualRamanYRange(style: RamanFigureStyle, fallback: [number, number] | null = null): [number, number] | undefined {
  const y0 = Number.isFinite(style.yBottom ?? NaN) ? Number(style.yBottom) : fallback?.[0]
  const y1 = Number.isFinite(style.yTop ?? NaN) ? Number(style.yTop) : fallback?.[1]
  if (!Number.isFinite(y0) || !Number.isFinite(y1) || y0 === y1) return undefined
  return [Number(y0), Number(y1)]
}

function formatRamanReferencePeakLabel(peak: RamanReferencePeak, mode: RamanReferenceLabelMode, index: number) {
  const shiftLabel = formatRamanShift(peak.shift)
  const resonance = peak.displayLabel || peak.resonanceState || peak.mode.split(',')[0] || peak.label
  if (mode === 'shift') return `${resonance}<br>${shiftLabel}`
  if (mode === 'index') return `P${index}<br>${resonance}`
  if (mode === 'full') {
    return `${displayRamanMaterial(peak.material)} ${resonance}<br>${shiftLabel} cm⁻¹`
  }
  return `${displayRamanMaterial(peak.material)} ${resonance}<br>${shiftLabel}`
}

function findRamanLocalMaximum(
  file: RamanFitPlotFile,
  style: RamanFigureStyle,
  shift: number,
  tolerance: number,
): { x: number; y: number } | null {
  const lo = shift - Math.abs(tolerance)
  const hi = shift + Math.abs(tolerance)
  const factor = ramanScaleFactor(file, style)
  let best: { x: number; y: number } | null = null
  file.x.forEach((xValue, index) => {
    if (xValue < lo || xValue > hi) return
    const yValue = (file.corrected[index] ?? file.raw[index] ?? 0) / factor
    if (!Number.isFinite(yValue)) return
    if (!best || yValue > best.y) best = { x: xValue, y: yValue }
  })
  return best
}

function buildRamanReferencePeakRows(peaks: RamanReferencePeak[]) {
  return peaks.map((peak, index) => ({
    peak_id: `P${index + 1}`,
    'shift_cm-1': peak.shift,
    'default_shift_cm-1': peak.defaultShift,
    material: peak.material,
    phase: peak.phase,
    label: peak.label,
    display_label: peak.displayLabel,
    default_display_label: peak.defaultDisplayLabel,
    resonance_state: peak.resonanceState,
    mode: peak.mode,
    structure: peak.structure,
    polyhedron: peak.polyhedron,
    confidence: peak.confidence,
    source_id: peak.sourceId,
    citation: peak.citation,
  }))
}

function buildRamanReferenceMatchRows(files: RamanFitPlotFile[], peaks: RamanReferencePeak[], style: RamanFigureStyle) {
  return peaks.flatMap((peak, peakIndex) => files.map(file => {
    const observed = findRamanLocalMaximum(file, style, peak.shift, style.referenceMatchTolerance)
    return {
      peak_id: `P${peakIndex + 1}`,
      sample: file.sampleLabel,
      'ref_shift_cm-1': peak.shift,
      'observed_local_max_cm-1': observed ? observed.x : '',
      'delta_cm-1': observed ? observed.x - peak.shift : '',
      local_intensity_after_norm: observed ? observed.y : '',
      material: peak.material,
      display_label: peak.displayLabel,
      resonance_state: peak.resonanceState,
      polyhedron: peak.polyhedron,
      mode: peak.mode,
      source_id: peak.sourceId,
    }
  }))
}

function buildRamanPublicationFigure(file: RamanFitPlotFile, style: RamanFigureStyle): { data: Plotly.Data[]; layout: Partial<Plotly.Layout> } {
  const factor = ramanScaleFactor(file, style)
  const components = visibleRamanComponents(file, style)
  const xMin = Math.min(...file.x)
  const xMax = Math.max(...file.x)
  const x0 = style.xLeft ?? xMin
  const x1 = style.xRight ?? xMax
  const yRange = manualRamanYRange(style)
  const data: Plotly.Data[] = []

  if (style.showRaw) {
    data.push({
      x: file.x,
      y: scaledSeries(file.raw, factor),
      type: 'scatter',
      mode: 'lines',
      name: 'Original spectrum',
      line: { color: style.rawColor, width: style.rawLineWidth },
      opacity: 0.52,
    })
  }
  if (style.showBaseline && file.baseline.some(value => Math.abs(value) > 1e-12)) {
    data.push({
      x: file.x,
      y: scaledSeries(file.baseline, factor),
      type: 'scatter',
      mode: 'lines',
      name: 'Baseline',
      line: { color: style.baselineColor, width: style.baselineLineWidth, dash: 'dash' },
    })
  }
  if (style.showCorrected) {
    data.push({
      x: file.x,
      y: scaledSeries(file.corrected, factor),
      type: 'scatter',
      mode: 'lines',
      name: 'Baseline-corrected',
      line: { color: style.correctedColor, width: style.correctedLineWidth },
    })
  }
  if (style.showComponents) {
    components.forEach((component, index) => {
      const componentColor = ramanComponentColor(index, style.componentColor)
      if (style.fillComponents && file.baseline.some(value => Math.abs(value) > 1e-12)) {
        data.push({
          x: [...file.x, ...file.x.slice().reverse()],
          y: [...scaledSeries(component.yCorrected, factor), ...Array(file.x.length).fill(0)],
          type: 'scatter',
          mode: 'lines',
          line: { color: componentColor, width: 0 },
          fill: 'toself',
          fillcolor: hexToRgba(componentColor, clamp(style.componentOpacity * 0.42, 0, 1)),
          hoverinfo: 'skip',
          showlegend: false,
        })
      }
      data.push({
        x: file.x,
        y: scaledSeries(component.yCorrected, factor),
        type: 'scatter',
        mode: 'lines',
        name: component.label,
        legendgroup: component.label,
        showlegend: true,
        line: { color: componentColor, width: style.componentLineWidth, dash: 'dash' },
        opacity: style.componentOpacity,
        hovertemplate: [
          component.label,
          component.assignment || component.material || undefined,
          component.labelType ? `assignment ${component.labelType}` : undefined,
          component.center == null ? undefined : `center ${component.center.toFixed(2)} cm⁻¹`,
          component.area == null ? undefined : `area ${component.area.toFixed(4)}`,
          component.areaPercent == null ? undefined : `area % ${component.areaPercent.toFixed(2)}`,
          component.status || undefined,
        ].filter(Boolean).join('<br>') + '<extra></extra>',
      })
    })
  }
  if (file.hasFit) {
    data.push({
      x: file.x,
      y: scaledSeries(file.totalFitRaw, factor),
      type: 'scatter',
      mode: 'lines',
      name: 'Total fit',
      line: { color: style.fitColor, width: style.fitLineWidth },
    })
  }

  const labelMarkers = buildRamanComponentPeakMarkers(
    components,
    style.showLabels,
    style.fontFamily,
    style.labelFontSize,
    style.componentColor,
  )

  const axisBase = {
    showgrid: false,
    zeroline: false,
    showline: true,
    mirror: true,
    linewidth: 1.3,
    linecolor: '#111827',
    ticks: 'outside' as const,
    tickfont: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
  }

  return {
    data,
    layout: {
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
      margin: { l: 90, r: 34, t: 148, b: 82 },
      showlegend: true,
      legend: { x: 0.99, y: 1.02, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.72)', font: { size: Math.max(10, style.fontSize - 2) } },
      xaxis: {
        ...axisBase,
        domain: [0, 1],
        range: [x0, x1],
        title: { text: 'Raman Shift (cm⁻¹)', standoff: 18, font: { family: style.fontFamily, size: style.axisTitleFontSize, color: '#111827' } },
      },
      yaxis: {
        ...axisBase,
        domain: [0, 1],
        ...(yRange ? { range: yRange } : {}),
        title: { text: style.normalize ? 'Normalized intensity' : 'Intensity (arb. units)', standoff: 18, font: { family: style.fontFamily, size: style.axisTitleFontSize, color: '#111827' } },
      },
      annotations: [
        {
          x: 0,
          y: 1.24,
          xref: 'paper',
          yref: 'paper',
          text: file.sampleLabel,
          showarrow: false,
          xanchor: 'left',
          font: { family: style.fontFamily, size: style.axisTitleFontSize, color: '#111827' },
        },
        ...labelMarkers.annotations,
      ],
      shapes: labelMarkers.shapes,
    },
  }
}

function buildRamanOverlayFigure(
  files: RamanFitPlotFile[],
  style: RamanFigureStyle,
  referencePeaks: RamanReferencePeak[] = [],
  referencePeakStyles: Record<string, RamanReferencePeakStyle> = {},
): { data: Plotly.Data[]; layout: Partial<Plotly.Layout> } | null {
  const usableFiles = files.filter(file => file.x.length > 2)
  if (usableFiles.length === 0) return null
  const allX = usableFiles.flatMap(file => file.x)
  const xMin = Math.min(...allX)
  const xMax = Math.max(...allX)
  const x0 = style.xLeft ?? xMin
  const x1 = style.xRight ?? xMax
  const rangeLeft = Math.min(x0, x1)
  const rangeRight = Math.max(x0, x1)
  const zoomLeft = Math.min(style.overlayZoomLeft, style.overlayZoomRight)
  const zoomRight = Math.max(style.overlayZoomLeft, style.overlayZoomRight)
  const showZoom = style.showOverlayZoom && zoomRight - zoomLeft > 1
  const mainDomain: [number, number] = showZoom ? [0.34, 1] : [0, 1]
  const zoomDomain: [number, number] = [0, 0.24]
  const spans = usableFiles.map(file => {
    const factor = ramanScaleFactor(file, style)
    const values = scaledSeries(file.corrected, factor).filter(Number.isFinite)
    return values.length > 0 ? Math.max(...values) - Math.min(...values) : 1
  })
  const unitSpan = Math.max(style.normalize ? 1 : Math.max(...spans), 1e-9)
  const offsetStep = Math.max(0, style.overlayOffset) * unitSpan
  const data: Plotly.Data[] = []
  const plottedValues: number[] = []
  const zoomValues: number[] = []
  const annotations: object[] = []
  const shapes: object[] = []
  const pushZoomValues = (xValues: number[], yValues: number[]) => {
    if (!showZoom) return
    xValues.forEach((xValue, valueIndex) => {
      const yValue = yValues[valueIndex]
      if (xValue >= zoomLeft && xValue <= zoomRight && Number.isFinite(yValue)) zoomValues.push(yValue)
    })
  }

  usableFiles.forEach((file, index) => {
    const factor = ramanScaleFactor(file, style)
    const offset = index * offsetStep + file.overlayYOffset * unitSpan
    const color = file.overlayColor || ramanComponentColor(index, style.correctedColor)
    const corrected = scaledSeries(file.corrected, factor).map(value => value + offset)
    const totalFit = scaledSeries(file.totalFitRaw, factor).map(value => value + offset)
    plottedValues.push(...corrected.filter(Number.isFinite))
    pushZoomValues(file.x, corrected)
    data.push({
      x: file.x,
      y: corrected,
      type: 'scatter',
      mode: 'lines',
      name: file.sampleLabel,
      line: { color, width: style.correctedLineWidth },
    })
    if (showZoom) {
      data.push({
        x: file.x,
        y: corrected,
        xaxis: 'x2',
        yaxis: 'y2',
        type: 'scatter',
        mode: 'lines',
        name: `${file.sampleLabel} zoom`,
        legendgroup: file.id,
        showlegend: false,
        line: { color, width: style.correctedLineWidth },
      })
    }
    if (style.showOverlayFit && file.hasFit) {
      plottedValues.push(...totalFit.filter(Number.isFinite))
      pushZoomValues(file.x, totalFit)
      data.push({
        x: file.x,
        y: totalFit,
        type: 'scatter',
        mode: 'lines',
        name: `${file.sampleLabel} fit`,
        legendgroup: file.id,
        showlegend: false,
        line: { color: style.fitColor, width: style.fitLineWidth, dash: 'dash' },
        opacity: 0.72,
      })
      if (showZoom) {
        data.push({
          x: file.x,
          y: totalFit,
          xaxis: 'x2',
          yaxis: 'y2',
          type: 'scatter',
          mode: 'lines',
          name: `${file.sampleLabel} fit zoom`,
          legendgroup: file.id,
          showlegend: false,
          line: { color: style.fitColor, width: style.fitLineWidth, dash: 'dash' },
          opacity: 0.72,
        })
      }
    }
    annotations.push({
      x: file.sampleLabelXPaper,
      y: offset + unitSpan * file.sampleLabelYOffset,
      xref: 'paper',
      yref: 'y',
      text: file.sampleLabel,
      showarrow: false,
      xanchor: 'left',
      font: { family: style.fontFamily, size: Math.max(12, style.fontSize), color },
    })
  })

  const yMin = plottedValues.length > 0 ? Math.min(...plottedValues) : 0
  const yMax = plottedValues.length > 0 ? Math.max(...plottedValues) : unitSpan
  const pad = Math.max((yMax - yMin) * 0.08, unitSpan * 0.08)
  const mainYRange: [number, number] = [yMin - pad, yMax + pad]
  const displayYRange = manualRamanYRange(style, mainYRange) ?? mainYRange
  const zoomYMin = zoomValues.length > 0 ? Math.min(...zoomValues) : yMin
  const zoomYMax = zoomValues.length > 0 ? Math.max(...zoomValues) : yMax
  const zoomPad = Math.max((zoomYMax - zoomYMin) * 0.1, unitSpan * 0.06)
  const axisBase = {
    showgrid: false,
    zeroline: false,
    showline: true,
    mirror: true,
    linewidth: 1.3,
    linecolor: '#111827',
    ticks: 'outside' as const,
    tickfont: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
  }

  if (style.showSiMask) {
    const siX0 = style.siMaskCenter - Math.abs(style.siMaskHalfWidth)
    const siX1 = style.siMaskCenter + Math.abs(style.siMaskHalfWidth)
    const siShape = (xref: 'x' | 'x2', y0: number, y1: number) => ({
      type: 'rect',
      xref,
      yref: 'paper',
      x0: siX0,
      x1: siX1,
      y0,
      y1,
      fillcolor: '#bdbdbd',
      opacity: 0.18,
      line: { width: 0 },
      layer: 'below',
    })
    shapes.push(siShape('x', mainDomain[0], mainDomain[1]))
    if (showZoom && siX1 >= zoomLeft && siX0 <= zoomRight) shapes.push(siShape('x2', zoomDomain[0], zoomDomain[1]))
    annotations.push({
      x: style.siMaskCenter,
      y: mainDomain[1] - 0.02,
      xref: 'x',
      yref: 'paper',
      text: 'Si interference',
      showarrow: false,
      yanchor: 'top',
      font: { family: style.fontFamily, size: Math.max(10, style.fontSize - 4), color: '#555555' },
    })
  }

  if (style.showReferencePeaks && referencePeaks.length > 0) {
    const visibleReferencePeaks = referencePeaks
      .filter(peak => peak.shift >= rangeLeft && peak.shift <= rangeRight)
      .sort((a, b) => a.shift - b.shift)
    const mainHeight = mainDomain[1] - mainDomain[0]
    visibleReferencePeaks.forEach((peak, index) => {
      const lineColor = ramanMaterialColor(peak.material)
      const peakStyle = referencePeakStyles[peak.id]
      const lineBase = {
        type: 'line',
        yref: 'paper',
        x0: peak.shift,
        x1: peak.shift,
        line: {
          color: lineColor,
          width: style.referenceLineWidth,
          dash: style.referenceLineDash,
        },
        opacity: style.referenceLineOpacity,
        layer: 'below',
      }
      shapes.push({ ...lineBase, xref: 'x', y0: mainDomain[0], y1: mainDomain[1] })
      if (showZoom && peak.shift >= zoomLeft && peak.shift <= zoomRight) {
        shapes.push({ ...lineBase, xref: 'x2', y0: zoomDomain[0], y1: zoomDomain[1] })
      }
      const lane = index % 5
      const labelFraction = peakStyle?.labelYFraction ?? (clamp(style.referenceLabelYFraction, 0.5, 0.98) - lane * 0.072)
      const labelY = mainDomain[0] + clamp(labelFraction, 0.34, 1.08) * mainHeight
      annotations.push({
        x: peak.shift,
        y: labelY,
        xref: 'x',
        yref: 'paper',
        text: formatRamanReferencePeakLabel(peak, style.referenceLabelMode, index + 1),
        textangle: -90,
        showarrow: false,
        xanchor: 'center',
        yanchor: 'top',
        align: 'center',
        xshift: style.referenceLabelWindowXShift + (peakStyle?.labelXShift ?? [-8, -4, 4, 8][index % 4]),
        font: { family: style.fontFamily, size: style.labelFontSize, color: lineColor },
      })
    })
  }

  return {
    data,
    layout: {
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
      margin: { l: 90, r: 150, t: style.showReferencePeaks ? 124 : 72, b: 82 },
      showlegend: style.showOverlayLegend,
      legend: { x: 0.99, y: 1.02, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.72)', font: { size: Math.max(10, style.fontSize - 2) } },
      xaxis: {
        ...axisBase,
        anchor: 'y',
        range: [x0, x1],
        title: { text: showZoom ? '' : 'Raman Shift (cm⁻¹)', standoff: 18, font: { family: style.fontFamily, size: style.axisTitleFontSize, color: '#111827' } },
      },
      yaxis: {
        ...axisBase,
        domain: mainDomain,
        range: displayYRange,
        showticklabels: offsetStep <= 1e-12,
        title: { text: style.normalize ? 'Normalized intensity + offset' : 'Intensity + offset', standoff: 18, font: { family: style.fontFamily, size: style.axisTitleFontSize, color: '#111827' } },
      },
      ...(showZoom ? {
        xaxis2: {
          ...axisBase,
          anchor: 'y2',
          range: [zoomLeft, zoomRight],
          title: { text: 'Raman Shift (cm⁻¹)', standoff: 18, font: { family: style.fontFamily, size: style.axisTitleFontSize, color: '#111827' } },
        },
        yaxis2: {
          ...axisBase,
          domain: zoomDomain,
          range: [zoomYMin - zoomPad, zoomYMax + zoomPad],
          showticklabels: false,
          title: { text: 'Zoom-in', standoff: 12, font: { family: style.fontFamily, size: Math.max(12, style.axisTitleFontSize - 6), color: '#111827' } },
        },
      } : {}),
      annotations: annotations as unknown as Plotly.Layout['annotations'],
      shapes: shapes as unknown as Plotly.Layout['shapes'],
    },
  }
}

function fitVbmPlotLine(x: number[], y: number[], start: number, end: number, mode: 'tangent' | 'baseline'): VbmLineFit | null {
  if (x.length !== y.length) return null
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const points = x
    .map((xi, index) => ({ x: xi, y: y[index] }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
  if (points.length < 2) return null

  const nearestPoint = (targetX: number) => {
    let bestIndex = 0
    let bestDistance = Infinity
    for (let i = 0; i < points.length; i += 1) {
      const distance = Math.abs(points[i].x - targetX)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }
    return { index: bestIndex, point: points[bestIndex] }
  }

  const anchorStart = nearestPoint(lo)
  const anchorEnd = nearestPoint(hi)
  const spanPoints = Math.max(Math.abs(anchorEnd.index - anchorStart.index) + 1, 5)
  const windowPointCount = Math.max(3, Math.min(points.length, Math.round(spanPoints * 0.2)))
  const buildWindow = (anchorIndex: number) => {
    const startIndex = Math.max(0, Math.min(points.length - windowPointCount, anchorIndex - Math.floor(windowPointCount / 2)))
    return points.slice(startIndex, startIndex + windowPointCount)
  }

  const startWindow = buildWindow(anchorStart.index)
  const endWindow = buildWindow(anchorEnd.index)
  let bestPair: { startPoint: VbmLinePoint; endPoint: VbmLinePoint; slope: number; span: number; meanY: number } | null = null
  let candidatePairCount = 0
  for (const startPoint of startWindow) {
    for (const endPoint of endWindow) {
      const dx = endPoint.x - startPoint.x
      if (dx <= 1e-10) continue
      const slope = (endPoint.y - startPoint.y) / dx
      const span = Math.abs(dx)
      const meanY = (startPoint.y + endPoint.y) / 2
      candidatePairCount += 1
      if (!bestPair) {
        bestPair = { startPoint, endPoint, slope, span, meanY }
        continue
      }

      if (mode === 'tangent') {
        if (slope > bestPair.slope + 1e-10 || (Math.abs(slope - bestPair.slope) <= 1e-10 && span > bestPair.span)) {
          bestPair = { startPoint, endPoint, slope, span, meanY }
        }
      } else {
        const absSlope = Math.abs(slope)
        const bestAbsSlope = Math.abs(bestPair.slope)
        if (
          absSlope < bestAbsSlope - 1e-10
          || (Math.abs(absSlope - bestAbsSlope) <= 1e-10 && meanY < bestPair.meanY - 1e-10)
          || (Math.abs(absSlope - bestAbsSlope) <= 1e-10 && Math.abs(meanY - bestPair.meanY) <= 1e-10 && span > bestPair.span)
        ) {
          bestPair = { startPoint, endPoint, slope, span, meanY }
        }
      }
    }
  }

  if (!bestPair) return null
  const intercept = bestPair.startPoint.y - bestPair.slope * bestPair.startPoint.x
  return {
    slope: bestPair.slope,
    intercept,
    pointCount: startWindow.length + endWindow.length,
    startWindowPointCount: startWindow.length,
    endWindowPointCount: endWindow.length,
    candidatePairCount,
    anchorStartPoint: anchorStart.point,
    anchorEndPoint: anchorEnd.point,
    startPoint: bestPair.startPoint,
    endPoint: bestPair.endPoint,
  }
}

function calculateVbm(file: VbmSpectrumFile): VbmFitResult {
  const validPoints = file.x
    .map((xValue, index) => ({ x: xValue, y: file.y[index] }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
  if (validPoints.length < 3) throw new Error(`${file.sampleLabel}: 有效資料點不足`)
  const maxY = Math.max(...validPoints.map(point => point.y))
  if (!Number.isFinite(maxY) || Math.abs(maxY) < 1e-15) throw new Error(`${file.sampleLabel}: intensity 最大值無法使用`)
  const x = validPoints.map(point => point.x)
  const yNorm = validPoints.map(point => point.y / maxY)
  const tangentLine = fitVbmPlotLine(x, yNorm, file.tangentStart, file.tangentEnd, 'tangent')
  const baselineLine = fitVbmPlotLine(x, yNorm, file.baselineStart, file.baselineEnd, 'baseline')
  if (!tangentLine) throw new Error(`${file.sampleLabel}: tangent 區間內資料點不足`)
  if (!baselineLine) throw new Error(`${file.sampleLabel}: baseline 區間內資料點不足`)
  const slopeDelta = tangentLine.slope - baselineLine.slope
  if (Math.abs(slopeDelta) < 1e-10) throw new Error(`${file.sampleLabel}: 切線與基準線斜率過於接近，無法穩定計算 VBM`)
  const vbm = (baselineLine.intercept - tangentLine.intercept) / slopeDelta
  const vbmY = tangentLine.slope * vbm + tangentLine.intercept
  if (!Number.isFinite(vbm) || !Number.isFinite(vbmY)) throw new Error(`${file.sampleLabel}: VBM 計算結果非有限值`)
  return {
    file,
    x,
    yNorm,
    vbmY,
    tangentLine,
    baselineLine,
    vbm,
  }
}

function prepareBandIntensity(y: number[], normalizeIntensity: boolean) {
  const finite = y.filter(Number.isFinite)
  if (finite.length === 0) return y.map(() => 0)
  if (!normalizeIntensity) return y.map(value => (Number.isFinite(value) ? value : 0))
  const maxValue = Math.max(...finite)
  if (!Number.isFinite(maxValue) || Math.abs(maxValue) < 1e-15) return y.map(() => 0)
  return y.map(value => (Number.isFinite(value) ? value / maxValue : 0))
}

function calculateXasBandEdge(file: XasBandEdgeFile, normalizeIntensity: boolean): XasBandEdgeResult {
  const validPoints = file.x
    .map((xValue, index) => ({ x: xValue, y: file.y[index] }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
  if (validPoints.length < 3) throw new Error(`${file.sampleLabel} ${file.kind.toUpperCase()}: 有效資料點不足`)
  const x = validPoints.map(point => point.x)
  const yNorm = prepareBandIntensity(validPoints.map(point => point.y), normalizeIntensity)
  const tangentLine = fitVbmPlotLine(x, yNorm, file.tangentStart, file.tangentEnd, 'tangent')
  const baselineLine = fitVbmPlotLine(x, yNorm, file.baselineStart, file.baselineEnd, 'baseline')
  if (!tangentLine) throw new Error(`${file.sampleLabel} ${file.kind.toUpperCase()}: tangent 區間內資料點不足`)
  if (!baselineLine) throw new Error(`${file.sampleLabel} ${file.kind.toUpperCase()}: baseline 區間內資料點不足`)
  const slopeDelta = tangentLine.slope - baselineLine.slope
  if (Math.abs(slopeDelta) < 1e-10) throw new Error(`${file.sampleLabel} ${file.kind.toUpperCase()}: 切線與 baseline 斜率過於接近`)
  const edge = (baselineLine.intercept - tangentLine.intercept) / slopeDelta
  const edgeY = tangentLine.slope * edge + tangentLine.intercept
  if (!Number.isFinite(edge) || !Number.isFinite(edgeY)) throw new Error(`${file.sampleLabel} ${file.kind.toUpperCase()}: band edge 計算結果非有限值`)
  return {
    file,
    edgeLabel: file.kind === 'xes' ? 'VBM' : 'CBM',
    x,
    yNorm,
    edge,
    edgeY,
    tangentLine,
    baselineLine,
  }
}

function xasBandLinePoints(result: XasBandEdgeResult, line: VbmLineFit, xMin: number, xMax: number, points = 160) {
  const xLine = Array.from({ length: points }, (_, index) => xMin + (xMax - xMin) * (index / Math.max(points - 1, 1)))
  return { x: xLine, y: xLine.map(value => line.slope * value + line.intercept) }
}

function calculateXasBandPairs(files: XasBandEdgeFile[], pairs: XasBandPair[], normalizeIntensity: boolean) {
  const results: XasBandPairResult[] = []
  const errors: string[] = []
  pairs.forEach(pair => {
    try {
      const xesFile = files.find(file => file.id === pair.xesFileId && file.kind === 'xes')
      const xasFile = files.find(file => file.id === pair.xasFileId && file.kind === 'xas')
      if (!xesFile || !xasFile) throw new Error(`${pair.sampleLabel}: XES 或 XAS 檔案不存在`)
      const xes = calculateXasBandEdge(xesFile, normalizeIntensity)
      const xas = calculateXasBandEdge(xasFile, normalizeIntensity)
      const bandGap = xas.edge - xes.edge
      if (!Number.isFinite(bandGap)) throw new Error(`${pair.sampleLabel}: Eg 計算結果非有限值`)
      results.push({ pair, xes, xas, bandGap })
    } catch (fitError: unknown) {
      errors.push(String((fitError as Error).message ?? fitError))
    }
  })
  return { results, errors }
}

function autoBuildXasBandPairs(files: XasBandEdgeFile[]) {
  const xesFiles = files.filter(file => file.kind === 'xes')
  const xasFiles = files.filter(file => file.kind === 'xas')
  const unusedXas = new Set(xasFiles.map(file => file.id))
  const pairs: XasBandPair[] = []
  xesFiles.forEach((xesFile, index) => {
    const normalizedLabel = xesFile.sampleLabel.trim().toLowerCase()
    const matchedXas = xasFiles.find(file => unusedXas.has(file.id) && file.sampleLabel.trim().toLowerCase() === normalizedLabel)
      ?? xasFiles.find(file => unusedXas.has(file.id))
    if (!matchedXas) return
    unusedXas.delete(matchedXas.id)
    pairs.push({
      id: `xas-band-pair-${xesFile.id}-${matchedXas.id}`,
      sampleLabel: normalizedLabel && normalizedLabel === matchedXas.sampleLabel.trim().toLowerCase()
        ? xesFile.sampleLabel
        : `${xesFile.sampleLabel} / ${matchedXas.sampleLabel}`,
      xesFileId: xesFile.id,
      xasFileId: matchedXas.id,
      color: XAS_BAND_COLORS[index % XAS_BAND_COLORS.length],
    })
  })
  return pairs
}

function xasBandDisplayPoints(result: XasBandEdgeResult) {
  const start = Number.isFinite(result.file.displayStart) ? result.file.displayStart : Math.min(...result.x)
  const end = Number.isFinite(result.file.displayEnd) ? result.file.displayEnd : Math.max(...result.x)
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const points = result.x
    .map((xValue, index) => ({ x: xValue, y: result.yNorm[index] }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .filter(point => point.x >= lo && point.x <= hi)
  if (points.length >= 2) return {
    x: points.map(point => point.x),
    y: points.map(point => point.y),
  }
  return { x: result.x, y: result.yNorm }
}

function medianValue(values: number[]) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (finite.length === 0) return Number.NaN
  const middle = Math.floor(finite.length / 2)
  if (finite.length % 2 === 1) return finite[middle]
  return (finite[middle - 1] + finite[middle]) / 2
}

function linearRegressionFit(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length)
  if (n < 2) return null
  const points = Array.from({ length: n }, (_, index) => ({ x: x[index], y: y[index] }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
  if (points.length < 2) return null
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length
  const ssX = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0)
  if (Math.abs(ssX) < 1e-15) return null
  const ssXY = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0)
  const slope = ssXY / ssX
  const intercept = meanY - slope * meanX
  const ssRes = points.reduce((sum, point) => sum + (point.y - (slope * point.x + intercept)) ** 2, 0)
  const ssTot = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0)
  const r2 = ssTot <= 1e-15 ? 1 : 1 - ssRes / ssTot
  return { slope, intercept, r2, pointCount: points.length }
}

function xasSpecialSampleFromText(value: string): XasSpecialSample | null {
  const normalized = value.toLowerCase().replace(/[_\s]+/g, '-')
  if (/(^|-)40-?10($|-)/.test(normalized) || normalized.includes('40-10')) return '40-10'
  if (/(^|-)45-?5($|-)/.test(normalized) || normalized.includes('45-5')) return '45-5'
  if (/(^|-)50-?0($|-)/.test(normalized) || normalized.includes('50-0')) return '50-0'
  return null
}

function calculateXasSpecialFit(file: XasBandEdgeFile, config: { sample: XasSpecialSample; vbm: number; color: string }): XasSpecialFitResult {
  const points = file.x
    .map((xValue, index) => ({ x: xValue, y: file.y[index] }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
  if (points.length < 3) throw new Error(`${config.sample}: XAS data has too few valid points`)

  const baselinePoints = points.filter(point => point.x >= XAS_SPECIAL_BASELINE_RANGE[0] && point.x <= XAS_SPECIAL_BASELINE_RANGE[1])
  const baseline = medianValue(baselinePoints.map(point => point.y))
  if (!Number.isFinite(baseline)) throw new Error(`${config.sample}: no XAS baseline points in 529.50-530.30 eV`)

  const fitPoints = points.filter(point => point.x >= XAS_SPECIAL_FIT_RANGE[0] && point.x <= XAS_SPECIAL_FIT_RANGE[1])
  const fit = linearRegressionFit(fitPoints.map(point => point.x), fitPoints.map(point => point.y))
  if (!fit) throw new Error(`${config.sample}: no valid XAS fit line in 531.25-531.55 eV`)
  if (Math.abs(fit.slope) < 1e-15) throw new Error(`${config.sample}: XAS fit slope is too small`)

  const cbm = (baseline - fit.intercept) / fit.slope
  const bandGap = cbm - config.vbm
  if (!Number.isFinite(cbm) || !Number.isFinite(bandGap)) throw new Error(`${config.sample}: CBM or Eg is not finite`)

  return {
    sample: config.sample,
    file,
    x: points.map(point => point.x),
    y: points.map(point => point.y),
    baseline,
    fitSlope: fit.slope,
    fitIntercept: fit.intercept,
    fitR2: fit.r2,
    cbm,
    vbm: config.vbm,
    bandGap,
  }
}

function calculateXasSpecialFits(files: XasBandEdgeFile[]) {
  const xasFiles = files.filter(file => file.kind === 'xas')
  const results: XasSpecialFitResult[] = []
  const errors: string[] = []
  XAS_SPECIAL_SAMPLES.forEach(config => {
    const matched = xasFiles.find(file => xasSpecialSampleFromText(`${file.sampleLabel} ${file.name}`) === config.sample)
    if (!matched) {
      errors.push(`${config.sample}: missing XAS file`)
      return
    }
    try {
      results.push(calculateXasSpecialFit(matched, config))
    } catch (fitError: unknown) {
      errors.push(String((fitError as Error).message ?? fitError))
    }
  })
  return { results, errors }
}

function buildXasSpecialSummaryCsv(results: XasSpecialFitResult[]) {
  const trendCheck = xasSpecialTrendCheck(results)
  const rows = results.map(result => ({
    Sample: result.sample,
    XAS_file: result.file.name,
    VBM_eV: result.vbm.toFixed(6),
    CBM_eV: result.cbm.toFixed(6),
    Band_gap_eV: result.bandGap.toFixed(6),
    XAS_baseline: result.baseline.toFixed(8),
    XAS_fit_slope: result.fitSlope.toFixed(10),
    XAS_fit_intercept: result.fitIntercept.toFixed(10),
    XAS_fit_R2: result.fitR2.toFixed(8),
    XAS_baseline_range_eV: `${XAS_SPECIAL_BASELINE_RANGE[0].toFixed(2)}-${XAS_SPECIAL_BASELINE_RANGE[1].toFixed(2)}`,
    XAS_fit_range_eV: `${XAS_SPECIAL_FIT_RANGE[0].toFixed(2)}-${XAS_SPECIAL_FIT_RANGE[1].toFixed(2)}`,
    Trend_check_40_10_gt_45_5_gt_50_0: trendCheck,
  }))
  const headers = ['Sample', 'XAS_file', 'VBM_eV', 'CBM_eV', 'Band_gap_eV', 'XAS_baseline', 'XAS_fit_slope', 'XAS_fit_intercept', 'XAS_fit_R2', 'XAS_baseline_range_eV', 'XAS_fit_range_eV', 'Trend_check_40_10_gt_45_5_gt_50_0']
  return rowsToCsv(headers, rows)
}

function xasSpecialTrendCheck(results: XasSpecialFitResult[]) {
  const bySample = Object.fromEntries(results.map(result => [result.sample, result])) as Partial<Record<XasSpecialSample, XasSpecialFitResult>>
  const r4010 = bySample['40-10']
  const r455 = bySample['45-5']
  const r500 = bySample['50-0']
  if (!r4010 || !r455 || !r500) return 'not enough samples'
  return r4010.bandGap > r455.bandGap && r455.bandGap > r500.bandGap ? 'pass' : 'check'
}

function buildXasSpecialExtrapolationFigure(results: XasSpecialFitResult[], style: XasBandFigureStyle) {
  const data: Plotly.Data[] = []
  const annotations: object[] = []
  const shapes: Partial<Plotly.Shape>[] = []
  const ordered = XAS_SPECIAL_SAMPLES
    .map(config => results.find(result => result.sample === config.sample))
    .filter(Boolean) as XasSpecialFitResult[]
  const n = Math.max(ordered.length, 1)
  const gap = 0.035
  const panelHeight = (1 - gap * Math.max(n - 1, 0)) / n
  const allX = ordered.flatMap(result => [...result.x, result.vbm, result.cbm])
  const globalXMin = Math.min(...allX, 526.8)
  const globalXMax = Math.max(...allX, 532.2)
  const xMin = Math.min(globalXMin, 526.8)
  const xMax = Math.max(globalXMax, 532.2)
  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    showlegend: style.showLegend,
    legend: { x: 0.02, y: 0.98, xanchor: 'left', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.75)', font: { size: Math.max(10, style.fontSize - 2), family: style.fontFamily } },
    hovermode: 'closest',
    margin: { l: 92, r: 42, t: 38, b: 78 },
    font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
    annotations: annotations as unknown as Plotly.Layout['annotations'],
    shapes: shapes as Plotly.Shape[],
  }

  ordered.forEach((result, index) => {
    const suffix = index === 0 ? '' : String(index + 1)
    const xAxisName = `xaxis${suffix}`
    const yAxisName = `yaxis${suffix}`
    const xRef = `x${suffix}`
    const yRef = `y${suffix}`
    const config = XAS_SPECIAL_SAMPLES.find(item => item.sample === result.sample) ?? XAS_SPECIAL_SAMPLES[0]
    const yDomainStart = 1 - (index + 1) * panelHeight - index * gap
    const yDomainEnd = yDomainStart + panelHeight
    const displayPoints = result.x.map((xValue, pointIndex) => ({ x: xValue, y: result.y[pointIndex] }))
      .filter(point => point.x >= xMin && point.x <= xMax)
    const finiteY = displayPoints.map(point => point.y).filter(Number.isFinite)
    const yLow = Math.min(...finiteY, result.baseline)
    const yHigh = Math.max(...finiteY, result.baseline, result.fitSlope * XAS_SPECIAL_FIT_RANGE[1] + result.fitIntercept)
    const ySpan = Math.max(yHigh - yLow, 0.05)
    const yMin = yLow - ySpan * 0.12
    const yMax = yHigh + ySpan * 0.26
    const yAt = (fraction: number) => yMin + (yMax - yMin) * fraction
    const egY = yAt(0.22)
    const fitLineStart = Math.min(result.cbm, XAS_SPECIAL_FIT_RANGE[0]) - 0.02
    const fitLineEnd = XAS_SPECIAL_FIT_RANGE[1] + 0.08
    const fitLineX = buildLinearGrid(fitLineStart, fitLineEnd, 90)

    ;(layout as Record<string, unknown>)[xAxisName] = {
      range: [xMin, xMax],
      anchor: yRef,
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
      title: index === n - 1 ? { text: 'Energy (eV)', font: { size: style.axisTitleFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff } : undefined,
      showticklabels: index === n - 1,
      minor: { ticks: 'inside' },
    } as Plotly.Layout['xaxis']
    ;(layout as Record<string, unknown>)[yAxisName] = {
      domain: [yDomainStart, yDomainEnd],
      anchor: xRef,
      range: [yMin, yMax],
      title: index === Math.floor(n / 2) ? { text: 'Normalized XAS intensity', font: { size: style.axisTitleFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff } : undefined,
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
      minor: { ticks: 'inside' },
    } as Plotly.Layout['yaxis']

    shapes.push(
      { type: 'rect', xref: xRef as Plotly.Shape['xref'], yref: yRef as Plotly.Shape['yref'], x0: XAS_SPECIAL_BASELINE_RANGE[0], x1: XAS_SPECIAL_BASELINE_RANGE[1], y0: yMin, y1: yMax, fillcolor: 'rgba(107,114,128,0.08)', line: { width: 0 }, layer: 'below' },
      { type: 'rect', xref: xRef as Plotly.Shape['xref'], yref: yRef as Plotly.Shape['yref'], x0: XAS_SPECIAL_FIT_RANGE[0], x1: XAS_SPECIAL_FIT_RANGE[1], y0: yMin, y1: yMax, fillcolor: hexToRgba(config.color, 0.08), line: { width: 0 }, layer: 'below' },
      { type: 'line', xref: xRef as Plotly.Shape['xref'], yref: yRef as Plotly.Shape['yref'], x0: result.vbm, x1: result.vbm, y0: yMin, y1: yMax, line: { color: style.vbmColor, width: 1.2, dash: 'dash' } },
      { type: 'line', xref: xRef as Plotly.Shape['xref'], yref: yRef as Plotly.Shape['yref'], x0: result.cbm, x1: result.cbm, y0: yMin, y1: yMax, line: { color: style.cbmColor, width: 1.2, dash: 'dash' } },
      { type: 'line', xref: xRef as Plotly.Shape['xref'], yref: yRef as Plotly.Shape['yref'], x0: result.vbm, x1: result.cbm, y0: egY, y1: egY, line: { color: '#8a6d00', width: 1.3 } },
    )

    data.push(
      {
        x: displayPoints.map(point => point.x),
        y: displayPoints.map(point => point.y),
        xaxis: xRef as never,
        yaxis: yRef as never,
        type: 'scatter',
        mode: 'lines',
        name: `${result.sample} XAS`,
        showlegend: index === 0 && style.showLegend,
        line: { color: config.color, width: style.xasLineWidth },
        hovertemplate: `${result.sample} XAS<br>%{x:.3f} eV<br>%{y:.5f}<extra></extra>`,
      },
      {
        x: [xMin, xMax],
        y: [result.baseline, result.baseline],
        xaxis: xRef as never,
        yaxis: yRef as never,
        type: 'scatter',
        mode: 'lines',
        name: 'Baseline median',
        showlegend: index === 0 && style.showLegend,
        line: { color: style.baselineColor, width: style.fitLineWidth, dash: 'dot' },
        hoverinfo: 'skip',
      },
      {
        x: fitLineX,
        y: fitLineX.map(xValue => result.fitSlope * xValue + result.fitIntercept),
        xaxis: xRef as never,
        yaxis: yRef as never,
        type: 'scatter',
        mode: 'lines',
        name: '531 eV fit',
        showlegend: index === 0 && style.showLegend,
        line: { color: style.tangentColor, width: style.fitLineWidth, dash: 'dash' },
        hovertemplate: 'fit<br>%{x:.3f} eV<br>%{y:.5f}<extra></extra>',
      },
    )

    annotations.push(
      { x: 0.99, y: yDomainStart + panelHeight * 0.82, xref: 'paper', yref: 'paper', text: `<b>${result.sample}</b>`, showarrow: false, xanchor: 'right', font: { size: style.sampleFontSize, family: style.fontFamily, color: config.color } },
      { x: result.vbm, y: yAt(0.92), xref: xRef, yref: yRef, text: `VBM ${result.vbm.toFixed(3)} eV`, showarrow: false, xanchor: 'right', font: { size: style.vbmLabelFontSize, family: style.fontFamily, color: style.vbmColor } },
      { x: result.cbm, y: yAt(0.92), xref: xRef, yref: yRef, text: `CBM ${result.cbm.toFixed(3)} eV`, showarrow: false, xanchor: 'left', font: { size: style.cbmLabelFontSize, family: style.fontFamily, color: style.cbmColor } },
      { x: (result.vbm + result.cbm) / 2, y: egY, xref: xRef, yref: yRef, text: `<i>E</i><sub>g</sub> = <b>${result.bandGap.toFixed(3)} eV</b>`, showarrow: false, yshift: -18, font: { size: style.egLabelFontSize, family: style.fontFamily, color: '#6b5600' } },
      { x: XAS_SPECIAL_FIT_RANGE[1], y: yAt(0.08), xref: xRef, yref: yRef, text: `R<sup>2</sup> ${result.fitR2.toFixed(4)}`, showarrow: false, xanchor: 'right', font: { size: Math.max(10, style.annotationFontSize - 2), family: style.fontFamily, color: '#4b5563' } },
    )
  })

  return { data, layout }
}

function buildXasSpecialTrendFigure(results: XasSpecialFitResult[], style: XasBandFigureStyle) {
  const ordered = XAS_SPECIAL_SAMPLES
    .map(config => results.find(result => result.sample === config.sample))
    .filter(Boolean) as XasSpecialFitResult[]
  const colors = ordered.map(result => XAS_SPECIAL_SAMPLES.find(config => config.sample === result.sample)?.color ?? '#4b5563')
  const yValues = ordered.map(result => result.bandGap)
  const finite = yValues.filter(Number.isFinite)
  const minY = Math.min(...finite, 3.6)
  const maxY = Math.max(...finite, 3.9)
  const pad = Math.max((maxY - minY) * 0.25, 0.04)
  const data: Plotly.Data[] = [{
    x: ordered.map(result => result.sample),
    y: yValues,
    type: 'bar',
    marker: { color: colors },
    text: yValues.map(value => `${value.toFixed(3)} eV`),
    textposition: 'outside',
    hovertemplate: '%{x}<br>Eg %{y:.4f} eV<extra></extra>',
  }]
  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    showlegend: false,
    margin: { l: 82, r: 34, t: 36, b: 72 },
    font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
    xaxis: {
      title: { text: 'Sample', font: { size: style.axisTitleFontSize, family: style.fontFamily }, standoff: 14 },
      showgrid: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
    },
    yaxis: {
      title: { text: 'Band gap (eV)', font: { size: style.axisTitleFontSize, family: style.fontFamily }, standoff: 16 },
      range: [minY - pad, maxY + pad],
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
    },
  }
  return { data, layout }
}

function percentileValue(values: number[], percentile: number) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (finite.length === 0) return 0
  if (finite.length === 1) return finite[0]
  const position = clamp(percentile, 0, 1) * (finite.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return finite[lower]
  return finite[lower] + (finite[upper] - finite[lower]) * (position - lower)
}

function resolveXasBandAutoYRange(primaryValues: number[], style: XasBandFigureStyle): [number, number] {
  const finite = primaryValues.filter(Number.isFinite)
  if (finite.length === 0) return [Math.min(style.yMin, -0.04), Math.max(style.yMax, 0.3)]
  const robustMin = percentileValue(finite, 0.01)
  const robustMax = percentileValue(finite, 0.99)
  const coreSpan = Math.max(robustMax - robustMin, Math.abs(robustMax) * 0.08, Math.abs(robustMin) * 0.08, 0.05)
  const pad = coreSpan * 0.1
  const autoMin = Math.min(robustMin - pad, 0)
  const autoMax = Math.max(robustMax + pad, autoMin + 0.05)
  if (style.normalizeIntensity) {
    return [Math.min(style.yMin, autoMin, -0.04), Math.max(style.yMax, autoMax, 0.3)]
  }
  return [Math.min(style.yMin, autoMin), autoMax]
}

function buildXasBandOverlayFigure(results: XasBandPairResult[], style: XasBandFigureStyle) {
  const allX = results.flatMap(result => [...result.xes.x, ...result.xas.x, result.xes.edge, result.xas.edge])
  const data: Plotly.Data[] = []
  const annotations: Partial<Plotly.Annotations>[] = []
  const shapes: Partial<Plotly.Shape>[] = []
  const xMin = Number.isFinite(style.xLeft) ? style.xLeft : Math.min(...allX)
  const xMax = Number.isFinite(style.xRight) ? style.xRight : Math.max(...allX)
  const n = Math.max(results.length, 1)
  const gap = 0.028
  const panelHeight = (1 - gap * Math.max(n - 1, 0)) / n
  const yAxisTitle = style.normalizeIntensity ? 'Normalized intensity (a.u.)' : style.yAxisTitle
  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    showlegend: style.showLegend,
    legend: {
      x: 0.02,
      y: 0.94,
      xanchor: 'left',
      yanchor: 'top',
      bgcolor: 'rgba(255,255,255,0)',
      font: { size: Math.max(10, style.fontSize - 2), family: style.fontFamily, color: '#4b5563' },
    },
    hovermode: 'closest',
    margin: { l: 92, r: 34, t: 34, b: 76 },
    font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
    annotations: annotations as unknown as Plotly.Layout['annotations'],
    shapes: shapes as Plotly.Shape[],
  }

  results.forEach((result, index) => {
    const suffix = index === 0 ? '' : String(index + 1)
    const xAxisName = `xaxis${suffix}`
    const yAxisName = `yaxis${suffix}`
    const xRef = `x${suffix}`
    const yRef = `y${suffix}`
    const yDomainStart = 1 - (index + 1) * panelHeight - index * gap
    const yDomainEnd = yDomainStart + panelHeight
    const sampleLabelY = yDomainStart + panelHeight * clamp(style.sampleLabelYFraction, 0, 1.2)
    const color = result.pair.color || result.xes.file.color || XAS_BAND_COLORS[index % XAS_BAND_COLORS.length]
    const xesFitStart = Math.min(result.xes.file.tangentStart, result.xes.file.tangentEnd, result.xes.edge) - 0.1
    const xesFitEnd = Math.max(result.xes.file.baselineStart, result.xes.file.baselineEnd, result.xes.edge) + 0.1
    const xasFitStart = Math.min(result.xas.file.baselineStart, result.xas.file.baselineEnd, result.xas.edge) - 0.1
    const xasFitEnd = Math.max(result.xas.file.tangentStart, result.xas.file.tangentEnd, result.xas.edge) + 0.1
    const xesBaseline = xasBandLinePoints(result.xes, result.xes.baselineLine, xesFitStart, xesFitEnd)
    const xesTangent = xasBandLinePoints(result.xes, result.xes.tangentLine, xesFitStart, xesFitEnd)
    const xasBaseline = xasBandLinePoints(result.xas, result.xas.baselineLine, xasFitStart, xasFitEnd)
    const xasTangent = xasBandLinePoints(result.xas, result.xas.tangentLine, xasFitStart, xasFitEnd)
    const xesDisplay = xasBandDisplayPoints(result.xes)
    const xasDisplay = xasBandDisplayPoints(result.xas)
    const primaryPanelValues = [...xesDisplay.y, ...xasDisplay.y].filter(Number.isFinite)
    const [autoYMin, autoYMax] = resolveXasBandAutoYRange(primaryPanelValues, style)
    const hasManualYRange = style.manualYRange && Number.isFinite(style.yMin) && Number.isFinite(style.yMax) && style.yMin < style.yMax
    const panelYMin = hasManualYRange ? style.yMin : autoYMin
    const panelYMax = hasManualYRange ? style.yMax : autoYMax
    const panelYAt = (fraction: number) => panelYMin + (panelYMax - panelYMin) * fraction
    const panelY = panelYAt(clamp(style.egLineYFraction, 0.02, 0.98))

    ;(layout as Record<string, unknown>)[xAxisName] = {
      range: [xMin, xMax],
      anchor: yRef,
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
      title: index === n - 1 ? { text: style.xAxisTitle, font: { size: style.axisTitleFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff } : undefined,
      showticklabels: index === n - 1,
      minor: { ticks: 'inside' },
    } as Plotly.Layout['xaxis']
    ;(layout as Record<string, unknown>)[yAxisName] = {
      domain: [yDomainStart, yDomainEnd],
      anchor: xRef,
      range: [panelYMin, panelYMax],
      title: index === Math.floor(n / 2) ? { text: yAxisTitle, font: { size: style.axisTitleFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff } : undefined,
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      showticklabels: false,
      minor: { ticks: 'inside' },
    } as Plotly.Layout['yaxis']

    shapes.push(
      { type: 'rect', xref: xRef as Plotly.Shape['xref'], yref: yRef as Plotly.Shape['yref'], x0: result.xes.edge, x1: result.xas.edge, y0: panelYMin, y1: panelYMax, fillcolor: hexToRgba(style.gapColor, style.gapOpacity), line: { width: 0 }, layer: 'below' },
      { type: 'line', xref: xRef as Plotly.Shape['xref'], yref: yRef as Plotly.Shape['yref'], x0: result.xes.edge, x1: result.xes.edge, y0: panelYMin, y1: panelYMax, line: { color: style.vbmColor, width: 1.2, dash: 'dash' } },
      { type: 'line', xref: xRef as Plotly.Shape['xref'], yref: yRef as Plotly.Shape['yref'], x0: result.xas.edge, x1: result.xas.edge, y0: panelYMin, y1: panelYMax, line: { color: style.cbmColor, width: 1.2, dash: 'dash' } },
      { type: 'line', xref: xRef as Plotly.Shape['xref'], yref: yRef as Plotly.Shape['yref'], x0: result.xes.edge, x1: result.xas.edge, y0: panelY, y1: panelY, line: { color: '#8a6d00', width: 1.2 } },
    )

    data.push(
      {
        x: xesDisplay.x,
        y: xesDisplay.y,
        xaxis: xRef as never,
        yaxis: yRef as never,
        type: 'scatter',
        mode: 'lines',
        name: 'solid: O K-edge XES',
        showlegend: index === 0 && style.showLegend,
        line: { color, width: style.xesLineWidth, dash: 'solid' },
        hovertemplate: `${result.pair.sampleLabel} XES<br>%{x:.3f} eV<br>%{y:.4f}<extra></extra>`,
      },
      {
        x: xasDisplay.x,
        y: xasDisplay.y,
        xaxis: xRef as never,
        yaxis: yRef as never,
        type: 'scatter',
        mode: 'lines',
        name: 'dashed: O K-edge XAS TFY',
        showlegend: index === 0 && style.showLegend,
        line: { color, width: style.xasLineWidth, dash: 'dash' },
        hovertemplate: `${result.pair.sampleLabel} XAS<br>%{x:.3f} eV<br>%{y:.4f}<extra></extra>`,
      },
    )

    if (style.showFitGuides) {
      data.push(
        { x: xesBaseline.x, y: xesBaseline.y, xaxis: xRef as never, yaxis: yRef as never, type: 'scatter', mode: 'lines', name: 'XES baseline', showlegend: false, line: { color: style.baselineColor, width: style.fitLineWidth, dash: 'dot' }, hoverinfo: 'skip' },
        { x: xesTangent.x, y: xesTangent.y, xaxis: xRef as never, yaxis: yRef as never, type: 'scatter', mode: 'lines', name: 'XES tangent', showlegend: false, line: { color: color, width: style.fitLineWidth, dash: 'dot' }, hoverinfo: 'skip' },
        { x: xasBaseline.x, y: xasBaseline.y, xaxis: xRef as never, yaxis: yRef as never, type: 'scatter', mode: 'lines', name: 'XAS baseline', showlegend: false, line: { color: style.baselineColor, width: style.fitLineWidth, dash: 'dot' }, hoverinfo: 'skip' },
        { x: xasTangent.x, y: xasTangent.y, xaxis: xRef as never, yaxis: yRef as never, type: 'scatter', mode: 'lines', name: 'XAS tangent', showlegend: false, line: { color: style.tangentColor, width: style.fitLineWidth, dash: 'dot' }, hoverinfo: 'skip' },
      )
    }

    annotations.push(
      { x: result.xes.edge + style.vbmLabelXShift, y: panelYAt(clamp(style.vbmLabelYFraction, 0, 1.2)), xref: xRef as Plotly.Annotations['xref'], yref: yRef as Plotly.Annotations['yref'], text: `<b>VBM<br>${result.xes.edge.toFixed(3)} eV</b>`, showarrow: false, xanchor: 'right', font: { size: style.vbmLabelFontSize, family: style.fontFamily, color: style.vbmColor } },
      { x: result.xas.edge + style.cbmLabelXShift, y: panelYAt(clamp(style.cbmLabelYFraction, 0, 1.2)), xref: xRef as Plotly.Annotations['xref'], yref: yRef as Plotly.Annotations['yref'], text: `<b>CBM<br>${result.xas.edge.toFixed(3)} eV</b>`, showarrow: false, xanchor: 'left', font: { size: style.cbmLabelFontSize, family: style.fontFamily, color: style.cbmColor } },
      { x: (result.xes.edge + result.xas.edge) / 2, y: panelYAt(clamp(style.egLabelYFraction, 0, 1.2)), xref: xRef as Plotly.Annotations['xref'], yref: yRef as Plotly.Annotations['yref'], text: `<i>E</i><sub>g</sub> = <b>${result.bandGap.toFixed(3)} eV</b>`, showarrow: false, font: { size: style.egLabelFontSize, family: style.fontFamily, color: '#6b5600' } },
      { x: style.sampleLabelXPaper, y: sampleLabelY, xref: 'paper', yref: 'paper', text: `<b>${result.pair.sampleLabel}</b>`, showarrow: false, xanchor: 'right', font: { size: style.sampleFontSize, family: style.fontFamily, color } },
    )
    if (index === 0) {
      annotations.push(
        { x: style.xesTitleXPaper, y: style.xesTitleYPaper, xref: 'paper', yref: 'paper', text: `<b>${style.xesTitle}</b>`, showarrow: false, xanchor: 'left', font: { size: style.panelTitleFontSize, family: style.fontFamily, color: '#111827' } },
        { x: style.xasTitleXPaper, y: style.xasTitleYPaper, xref: 'paper', yref: 'paper', text: `<b>${style.xasTitle}</b>`, showarrow: false, xanchor: 'left', font: { size: style.panelTitleFontSize, family: style.fontFamily, color: '#111827' } },
      )
    }
  })

  return { data, layout }
}

function vbmLinePoints(result: VbmFitResult, line: VbmLineFit, points = 500) {
  const xMin = Math.min(...result.x)
  const xMax = Math.max(...result.x)
  const xLine = Array.from({ length: points }, (_, index) => xMin + (xMax - xMin) * (index / Math.max(points - 1, 1)))
  return { x: xLine, y: xLine.map(value => line.slope * value + line.intercept) }
}

function buildVbmSingleFigure(result: VbmFitResult, style: VbmFigureStyle) {
  const baselineLine = vbmLinePoints(result, result.baselineLine)
  const tangentLine = vbmLinePoints(result, result.tangentLine)
  const data: Plotly.Data[] = [
    {
      x: result.x,
      y: result.yNorm,
      type: 'scatter',
      mode: 'lines+markers',
      name: result.file.sampleLabel,
      line: { color: style.spectrumColor, width: style.spectrumLineWidth },
      marker: { color: '#ffffff', size: style.markerSize, line: { color: style.spectrumEdgeColor, width: style.markerLineWidth } },
      hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
    },
    {
      x: baselineLine.x,
      y: baselineLine.y,
      type: 'scatter',
      mode: 'lines',
      name: 'Baseline fit',
      line: { color: style.baselineColor, width: style.fitLineWidth, dash: 'dot' },
      hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
    },
    {
      x: tangentLine.x,
      y: tangentLine.y,
      type: 'scatter',
      mode: 'lines',
      name: 'Tangent fit',
      line: { color: style.tangentColor, width: style.fitLineWidth, dash: 'dash' },
      hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
    },
    {
      x: [result.vbm],
      y: [result.vbmY],
      type: 'scatter',
      mode: 'markers',
      name: `VBM = ${result.vbm.toFixed(3)} eV`,
      marker: { color: style.vbmColor, size: 11, symbol: 'diamond' },
      hovertemplate: 'VBM %{x:.3f} eV<extra></extra>',
    },
  ]

  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    showlegend: false,
    margin: { l: 88, r: 34, t: 34, b: 78 },
    font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
    xaxis: {
      range: [style.xLeft, style.xRight],
      title: { text: 'Binding Energy (eV)', font: { size: style.xAxisFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff },
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
      minor: { ticks: 'inside' },
    },
    yaxis: {
      range: [-0.05, Math.max(style.yMax, 0.3)],
      title: { text: 'Normalized intensity (a.u.)', font: { size: style.yAxisFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff },
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
      minor: { ticks: 'inside' },
    },
    shapes: [
      {
        type: 'rect',
        xref: 'x',
        yref: 'y',
        x0: result.file.baselineStart,
        x1: result.file.baselineEnd,
        y0: -0.05,
        y1: Math.max(style.yMax, 0.3),
        fillcolor: hexToRgba(style.baselineColor, style.regionOpacity),
        line: { width: 0 },
        layer: 'below',
      },
      {
        type: 'rect',
        xref: 'x',
        yref: 'y',
        x0: result.file.tangentStart,
        x1: result.file.tangentEnd,
        y0: -0.05,
        y1: Math.max(style.yMax, 0.3),
        fillcolor: hexToRgba(style.tangentColor, style.regionOpacity),
        line: { width: 0 },
        layer: 'below',
      },
    ] as Plotly.Shape[],
    annotations: [
      { x: 0.03, y: 0.88, xref: 'paper', yref: 'paper', text: `<b>${style.titleLabel || 'VB'}</b>`, showarrow: false, xanchor: 'left', font: { size: style.panelTitleFontSize, family: style.fontFamily, color: '#111827' } },
      { x: 0.97, y: 0.88, xref: 'paper', yref: 'paper', text: `<b>${result.file.sampleLabel}</b>`, showarrow: false, xanchor: 'right', font: { size: style.sampleFontSize, family: style.fontFamily, color: '#111827' } },
      { x: result.vbm, y: result.vbmY, xref: 'x', yref: 'y', text: `VBM = ${result.vbm.toFixed(3)} eV`, showarrow: true, ax: style.labelOffsetX, ay: style.labelOffsetY, arrowcolor: style.vbmColor, font: { size: style.annotationFontSize, family: style.fontFamily, color: style.vbmColor } },
    ] as unknown as Plotly.Layout['annotations'],
  }
  return { data, layout }
}

function buildVbmStackedFigure(results: VbmFitResult[], style: VbmFigureStyle) {
  const data: Plotly.Data[] = []
  const annotations: Partial<Plotly.Annotations>[] = []
  const shapes: Partial<Plotly.Shape>[] = []
  const gap = 0.035
  const n = results.length
  const panelHeight = (1 - gap * Math.max(n - 1, 0)) / Math.max(n, 1)
  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    showlegend: false,
    hovermode: 'closest',
    margin: { l: 88, r: 34, t: 28, b: 78 },
    font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
    annotations: annotations as unknown as Plotly.Layout['annotations'],
    shapes: shapes as Plotly.Shape[],
  }

  results.forEach((result, resultIndex) => {
    const axisSuffix = resultIndex === 0 ? '' : String(resultIndex + 1)
    const xAxisName = `xaxis${axisSuffix}`
    const yAxisName = `yaxis${axisSuffix}`
    const xRef = `x${axisSuffix}`
    const yRef = `y${axisSuffix}`
    const yDomainStart = 1 - (resultIndex + 1) * panelHeight - resultIndex * gap
    const yDomainEnd = yDomainStart + panelHeight
    const baselineLine = vbmLinePoints(result, result.baselineLine)
    const tangentLine = vbmLinePoints(result, result.tangentLine)

    ;(layout as Record<string, unknown>)[xAxisName] = {
      range: [style.xLeft, style.xRight],
      anchor: yRef,
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
      title: resultIndex === n - 1 ? { text: 'Binding Energy (eV)', font: { size: style.xAxisFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff } : undefined,
      showticklabels: resultIndex === n - 1,
      minor: { ticks: 'inside' },
    } as Plotly.Layout['xaxis']
    ;(layout as Record<string, unknown>)[yAxisName] = {
      domain: [yDomainStart, yDomainEnd],
      anchor: xRef,
      range: [-0.05, Math.max(style.yMax, 0.3)],
      title: resultIndex === Math.floor(n / 2) ? { text: 'Intensity (a.u.)', font: { size: style.yAxisFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff } : undefined,
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      showticklabels: false,
      minor: { ticks: 'inside' },
    } as Plotly.Layout['yaxis']

    shapes.push(
      { type: 'rect', xref: xRef as Plotly.Shape['xref'], yref: yRef as Plotly.Shape['yref'], x0: result.file.baselineStart, x1: result.file.baselineEnd, y0: -0.05, y1: Math.max(style.yMax, 0.3), fillcolor: hexToRgba(style.baselineColor, style.regionOpacity), line: { width: 0 }, layer: 'below' },
      { type: 'rect', xref: xRef as Plotly.Shape['xref'], yref: yRef as Plotly.Shape['yref'], x0: result.file.tangentStart, x1: result.file.tangentEnd, y0: -0.05, y1: Math.max(style.yMax, 0.3), fillcolor: hexToRgba(style.tangentColor, style.regionOpacity), line: { width: 0 }, layer: 'below' },
    )

    data.push(
      {
        x: result.x,
        y: result.yNorm,
        xaxis: xRef as never,
        yaxis: yRef as never,
        type: 'scatter',
        mode: 'lines+markers',
        name: result.file.sampleLabel,
        line: { color: style.spectrumColor, width: style.spectrumLineWidth },
        marker: { color: '#ffffff', size: style.markerSize, line: { color: style.spectrumEdgeColor, width: style.markerLineWidth } },
        hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
      },
      {
        x: baselineLine.x,
        y: baselineLine.y,
        xaxis: xRef as never,
        yaxis: yRef as never,
        type: 'scatter',
        mode: 'lines',
        name: 'Baseline fit',
        line: { color: style.baselineColor, width: style.fitLineWidth, dash: 'dot' },
        hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
      },
      {
        x: tangentLine.x,
        y: tangentLine.y,
        xaxis: xRef as never,
        yaxis: yRef as never,
        type: 'scatter',
        mode: 'lines',
        name: 'Tangent fit',
        line: { color: style.tangentColor, width: style.fitLineWidth, dash: 'dash' },
        hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
      },
      {
        x: [result.vbm],
        y: [result.vbmY],
        xaxis: xRef as never,
        yaxis: yRef as never,
        type: 'scatter',
        mode: 'markers',
        name: `VBM = ${result.vbm.toFixed(3)} eV`,
        marker: { color: style.vbmColor, size: 10, symbol: 'diamond' },
        hovertemplate: 'VBM %{x:.3f} eV<extra></extra>',
      },
    )

    annotations.push(
      { x: 0.03, y: yDomainEnd - panelHeight * 0.16, xref: 'paper', yref: 'paper', text: `<b>${style.titleLabel || 'VB'}</b>`, showarrow: false, xanchor: 'left', font: { size: style.panelTitleFontSize, family: style.fontFamily, color: '#111827' } },
      { x: 0.97, y: yDomainEnd - panelHeight * 0.16, xref: 'paper', yref: 'paper', text: `<b>${result.file.sampleLabel}</b>`, showarrow: false, xanchor: 'right', font: { size: style.sampleFontSize, family: style.fontFamily, color: '#111827' } },
      { x: result.vbm, y: result.vbmY, xref: xRef as Plotly.Annotations['xref'], yref: yRef as Plotly.Annotations['yref'], text: `VBM = ${result.vbm.toFixed(3)} eV`, showarrow: true, ax: style.labelOffsetX, ay: style.labelOffsetY, arrowcolor: style.vbmColor, font: { size: style.annotationFontSize, family: style.fontFamily, color: style.vbmColor } },
    )
  })

  return { data, layout }
}

function buildVbmSummaryFigure(results: VbmFitResult[], style: VbmFigureStyle) {
  const samples = results.map(result => result.file.sampleLabel)
  const values = results.map(result => result.vbm)
  const finiteValues = values.filter(Number.isFinite)
  const yMin = Math.min(...finiteValues, 0)
  const yMax = Math.max(...finiteValues, 1)
  const pad = Math.max((yMax - yMin) * 0.16, 0.05)
  const data: Plotly.Data[] = [
    {
      x: samples,
      y: values,
      type: 'scatter',
      mode: 'text+lines+markers',
      text: values.map(value => value.toFixed(3)),
      textposition: 'top center',
      textfont: { size: style.annotationFontSize, family: style.fontFamily, color: '#111827' },
      line: { color: style.spectrumColor, width: 2 },
      marker: { color: style.spectrumColor, size: 9 },
      hovertemplate: '%{x}<br>VBM %{y:.4f} eV<extra></extra>',
    },
  ]
  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    showlegend: false,
    margin: { l: 96, r: 28, t: 44, b: 78 },
    font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
    xaxis: {
      type: 'category',
      categoryorder: 'array',
      categoryarray: samples,
      title: { text: 'Sample', font: { size: style.xAxisFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff },
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
    },
    yaxis: {
      range: [yMin - pad, yMax + pad],
      title: { text: 'VBM, E<sub>F</sub> - E<sub>VBM</sub> (eV)', font: { size: style.yAxisFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff },
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
      minor: { ticks: 'inside' },
    },
  }
  return { data, layout }
}

function vbDosDisplayPoints(file: VbDosSpectrumFile) {
  const yNorm = normalizeVbDosIntensity(file.y)
  return file.x
    .map((be, index) => ({ be, x: be - file.vbm, y: yNorm[index] }))
    .filter(point => Number.isFinite(point.be) && Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
}

function recalcVbDosPeaks(file: VbDosSpectrumFile, vbm = file.vbm, regions = VB_DOS_ASSIGNMENT_REGIONS) {
  const yNorm = normalizeVbDosIntensity(file.y)
  const xRel = file.x.map(value => value - vbm)
  return detectVbDosPeaks(xRel, yNorm, file.x, regions)
}

function buildVbDosFigure(files: VbDosSpectrumFile[], style: VbDosFigureStyle, regions: VbDosAssignmentRegion[]) {
  const data: Plotly.Data[] = []
  const annotations: Partial<Plotly.Annotations>[] = []
  const shapes: Partial<Plotly.Shape>[] = []
  const maxOffset = Math.max(0, (files.length - 1) * style.verticalOffset)
  const yMax = maxOffset + 1 + Math.max(0.18, style.yMaxPadding)

  regions.forEach(region => {
    shapes.push({
      type: 'rect',
      xref: 'x',
      yref: 'paper',
      x0: region.start,
      x1: region.end,
      y0: 0,
      y1: 1,
      fillcolor: hexToRgba(region.color, style.regionOpacity),
      line: { width: 0 },
      layer: 'below',
    })
    if (style.showRegionLabels) {
      annotations.push({
        x: (region.start + region.end) / 2 + region.labelXShift,
        y: region.labelYPaper,
        xref: 'x',
        yref: 'paper',
        text: formatItalicWords(region.shortLabel, region.italicWords),
        showarrow: false,
        align: 'center',
        font: { family: style.fontFamily, size: style.regionFontSize, color: '#334155' },
      })
    }
  })

  files.forEach((file, fileIndex) => {
    const points = vbDosDisplayPoints(file)
    const offset = fileIndex * style.verticalOffset
    const x = points.map(point => point.x)
    const y = points.map(point => point.y + offset)
    data.push({
      x,
      y,
      type: 'scatter',
      mode: 'lines',
      name: file.sampleLabel,
      showlegend: style.showLegend,
      line: { color: file.color, width: style.lineWidth },
      hovertemplate: `${file.sampleLabel}<br>ΔE %{x:.3f} eV<br>%{y:.4f}<extra></extra>`,
    })

    annotations.push({
      x: style.xRight + (style.xLeft - style.xRight) * clamp(file.sampleLabelXFraction, 0, 1),
      y: offset + file.sampleLabelYOffset,
      xref: 'x',
      yref: 'y',
      text: `<b>${file.sampleLabel}</b>`,
      showarrow: false,
      xanchor: 'right',
      font: { family: style.fontFamily, size: style.sampleFontSize, color: file.color },
    })

    if (style.showPeakMarkers) {
      const visiblePeaks = file.peaks.filter(peak => peak.visible)
      data.push({
        x: visiblePeaks.map(peak => peak.relEnergy),
        y: visiblePeaks.map(peak => peak.intensity + offset),
        type: 'scatter',
        mode: 'markers',
        name: `${file.sampleLabel} peak / shoulder`,
        showlegend: false,
        marker: { color: '#ffffff', size: style.markerSize, line: { color: file.color, width: 1.2 } },
        hovertemplate: `${file.sampleLabel}<br>BE %{customdata:.3f} eV<br>ΔE %{x:.3f} eV<extra></extra>`,
        customdata: visiblePeaks.map(peak => peak.be),
      })
      visiblePeaks.forEach(peak => {
        annotations.push({
          x: peak.relEnergy,
          y: peak.intensity + offset,
          xref: 'x',
          yref: 'y',
          text: formatPlotLabel(peak.label),
          showarrow: true,
          ax: peak.labelXShift,
          ay: peak.labelYShift,
          arrowcolor: file.color,
          arrowwidth: 0.9,
          align: 'center',
          font: { family: style.fontFamily, size: style.annotationFontSize, color: file.color },
          bgcolor: 'rgba(255,255,255,0.72)',
          bordercolor: 'rgba(255,255,255,0)',
        })
      })
    }
  })

  annotations.push(
    {
      x: 0.02,
      y: 1.16,
      xref: 'paper',
      yref: 'paper',
      text: `<b>${style.titleLabel}</b>`,
      showarrow: false,
      xanchor: 'left',
      font: { family: style.fontFamily, size: style.axisTitleFontSize, color: '#111827' },
    },
    {
      x: 0,
      y: -0.28,
      xref: 'paper',
      yref: 'paper',
      text: VB_DOS_ASSIGNMENT_NOTE,
      showarrow: false,
      xanchor: 'left',
      align: 'left',
      font: { family: 'DejaVu Sans, Arial, sans-serif', size: Math.max(10, style.annotationFontSize - 1), color: '#4b5563' },
    },
  )

  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    showlegend: style.showLegend,
    hovermode: 'closest',
    margin: { l: 92, r: 34, t: 118, b: 150 },
    font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
    shapes: shapes as Plotly.Shape[],
    annotations: annotations as unknown as Plotly.Layout['annotations'],
    legend: {
      x: 0.02,
      y: 0.98,
      xanchor: 'left',
      yanchor: 'top',
      bgcolor: 'rgba(255,255,255,0)',
      font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
    },
    xaxis: {
      range: [style.xLeft, style.xRight],
      title: { text: 'ΔE = Binding Energy - VBM (eV)', font: { size: style.axisTitleFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff },
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
      minor: { ticks: 'inside' },
    },
    yaxis: {
      range: [-0.08, yMax],
      title: { text: 'Normalized intensity + offset (a.u.)', font: { size: style.axisTitleFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff },
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      showticklabels: false,
    },
  }
  return { data, layout }
}

function buildXpsPanelFigure(files: FitSpectrumFile[], style: PlotFigureStyle, styles: Record<string, ComponentStyle>) {
  const keys = componentKeys(files).filter(key => styles[key]?.show ?? true)
  const xAll = files.flatMap(file => file.x)
  const xMin = Math.min(...xAll)
  const xMax = Math.max(...xAll)
  const xLeft = Number.isFinite(style.xLeft ?? NaN) ? Number(style.xLeft) : xMax
  const xRight = Number.isFinite(style.xRight ?? NaN) ? Number(style.xRight) : xMin
  const yMax = Math.max(style.yMax, 0.3)
  const data: Plotly.Data[] = []
  const annotations: Partial<Plotly.Annotations>[] = []
  const shapes: Partial<Plotly.Shape>[] = []
  const gap = 0.035
  const n = files.length
  const panelHeight = (1 - gap * Math.max(n - 1, 0)) / Math.max(n, 1)
  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    showlegend: false,
    hovermode: 'closest',
    margin: { l: 88, r: 24, t: 24, b: 78 },
    font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
    annotations: annotations as unknown as Plotly.Layout['annotations'],
    shapes: shapes as Plotly.Shape[],
  }

  files.forEach((file, fileIndex) => {
    const axisSuffix = fileIndex === 0 ? '' : String(fileIndex + 1)
    const xAxisName = `xaxis${axisSuffix}`
    const yAxisName = `yaxis${axisSuffix}`
    const xRef = `x${axisSuffix}`
    const yRef = `y${axisSuffix}`
    const yDomainStart = 1 - (fileIndex + 1) * panelHeight - fileIndex * gap
    const yDomainEnd = yDomainStart + panelHeight
    const yMin = percentile(file.totalFit, 0.01)
    const scaleRaw = Math.max(...file.totalFit.map(value => value - yMin).filter(Number.isFinite), 1)
    const scale = Math.abs(scaleRaw) > 1e-12 ? scaleRaw : 1
    const percentages = componentAreas(file, keys)

    ;(layout as Record<string, unknown>)[xAxisName] = {
      range: [xLeft, xRight],
      anchor: yRef,
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
      title: fileIndex === n - 1 ? { text: 'Binding Energy (eV)', font: { size: style.xAxisFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff } : undefined,
      showticklabels: fileIndex === n - 1,
      minor: { ticks: 'inside' },
    } as Plotly.Layout['xaxis']
    ;(layout as Record<string, unknown>)[yAxisName] = {
      domain: [yDomainStart, yDomainEnd],
      anchor: xRef,
      range: [-0.05, yMax],
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: '',
      showticklabels: false,
      title: fileIndex === Math.floor(n / 2) ? { text: 'Intensity (a.u.)', font: { size: style.yAxisFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff } : undefined,
    } as Plotly.Layout['yaxis']

    keys.forEach((key, keyIndex) => {
      const componentStyle = styles[key] ?? createDefaultComponentStyle(key, keyIndex)
      const displayLabel = formatPlotLabel(componentStyle.label || key)
      const component = (file.components[key] ?? file.x.map(() => 0)).map(value => value / scale)
      data.push({
        x: file.x,
        y: component,
        xaxis: xRef as never,
        yaxis: yRef as never,
        type: 'scatter',
        mode: 'lines',
        name: displayLabel,
        line: { color: componentStyle.color, width: style.componentLineWidth },
        fill: 'tozeroy',
        fillcolor: hexToRgba(componentStyle.color, clamp(style.fillOpacity, 0, 1)),
        hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
      })

      const defaultCenter = file.x[component.indexOf(Math.max(...component))] ?? file.x[Math.floor(file.x.length / 2)] ?? 0
      const markerCenter = Number.isFinite(componentStyle.markerCenter ?? NaN) ? Number(componentStyle.markerCenter) : defaultCenter
      const markerY = Math.max(interpolateY(file.x, component, markerCenter), 0)
      const labelX = xLeft - clamp(componentStyle.labelX, 0.02, 0.98) * (xLeft - xRight)
      const labelY = clamp(componentStyle.labelY, 0, 1) * yMax
      const label = style.showPercent
        ? `${displayLabel}<br>(${(percentages[key] ?? 0).toFixed(1)}%)`
        : displayLabel

      if (style.showVerticalLines) {
        shapes.push({
          type: 'line',
          xref: xRef as Plotly.Shape['xref'],
          yref: yRef as Plotly.Shape['yref'],
          x0: markerCenter,
          x1: markerCenter,
          y0: 0,
          y1: markerY * 1.08,
          line: { color: style.fixedLineColor, width: 0.9, dash: 'dash' },
        })
      }
      shapes.push({
        type: 'line',
        xref: xRef as Plotly.Shape['xref'],
        yref: yRef as Plotly.Shape['yref'],
        x0: markerCenter,
        x1: labelX,
        y0: markerY * 1.03,
        y1: labelY,
        line: { color: componentStyle.color, width: 1.0 },
      })
      annotations.push({
        x: labelX,
        y: labelY,
        xref: xRef as Plotly.Annotations['xref'],
        yref: yRef as Plotly.Annotations['yref'],
        text: label,
        showarrow: false,
        align: 'center',
        yanchor: 'bottom',
        font: { color: componentStyle.color, size: style.labelFontSize, family: style.fontFamily },
      })
    })

    data.push({
      x: file.x,
      y: file.observed.map(value => (value - yMin) / scale),
      xaxis: xRef as never,
      yaxis: yRef as never,
      type: 'scatter',
      mode: style.rawMode,
      name: `${file.sampleLabel} Observed`,
      line: { color: style.rawColor, width: style.rawLineWidth },
      marker: {
        color: style.rawMarkerFillColor,
        size: style.rawMarkerSize,
        line: { color: style.rawColor, width: style.rawMarkerLineWidth },
      },
      opacity: style.rawMode === 'markers' ? 1 : 0.65,
      hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
    })
    data.push({
      x: file.x,
      y: file.totalFit.map(value => (value - yMin) / scale),
      xaxis: xRef as never,
      yaxis: yRef as never,
      type: 'scatter',
      mode: 'lines',
      name: `${file.sampleLabel} Fit`,
      line: { color: style.fitColor, width: style.fitLineWidth },
      hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
    })

    annotations.push({
      x: style.panelTitleXPaper,
      y: yDomainStart + panelHeight * clamp(style.panelTitleYFraction, 0, 1.2),
      xref: 'paper',
      yref: 'paper',
      text: `<b>${style.titleLabel || 'XPS'}</b>`,
      showarrow: false,
      xanchor: 'left',
      yanchor: 'middle',
      font: { color: '#111827', size: style.panelTitleFontSize, family: style.fontFamily },
    })
    annotations.push({
      x: style.sampleLabelXPaper,
      y: yDomainStart + panelHeight * clamp(style.sampleLabelYFraction, 0, 1.2),
      xref: 'paper',
      yref: 'paper',
      text: `<b>${file.sampleLabel}</b>`,
      showarrow: false,
      xanchor: 'right',
      yanchor: 'middle',
      font: { color: '#111827', size: style.sampleFontSize, family: style.fontFamily },
    })
  })

  return { data, layout }
}

function buildXpsSummaryFigure(files: FitSpectrumFile[], style: PlotFigureStyle, styles: Record<string, ComponentStyle>) {
  const keys = componentKeys(files).filter(key => styles[key]?.show ?? true)
  const samples = files.map(file => file.sampleLabel)
  const areaRows = files.map(file => componentAreas(file, keys))
  const data: Plotly.Data[] = []

  keys.forEach((key, index) => {
    const componentStyle = styles[key] ?? createDefaultComponentStyle(key, index)
    const displayLabel = formatPlotLabel(componentStyle.label || key)
    data.push({
      x: samples,
      y: areaRows.map(row => row[key] ?? 0),
      type: 'bar',
      name: displayLabel,
      marker: { color: componentStyle.color, line: { color: '#111827', width: 1 } },
      xaxis: 'x',
      yaxis: 'y',
      hovertemplate: '%{x}<br>%{y:.2f}%<extra></extra>',
    })
  })

  const numerator = style.ratioNumerator || keys[1] || keys[0] || ''
  const denominator = style.ratioDenominator || keys[0] || ''
  const numeratorLabel = formatPlotLabel(styles[numerator]?.label ?? numerator)
  const denominatorLabel = formatPlotLabel(styles[denominator]?.label ?? denominator)
  const ratioColor = (styles[numerator] ?? createDefaultComponentStyle(numerator, 1)).color
  data.push({
    x: samples,
    y: areaRows.map(row => {
      const den = row[denominator] ?? 0
      return den > 0 ? (row[numerator] ?? 0) / den : 0
    }),
    type: 'scatter',
    mode: 'lines+markers',
    name: `${numeratorLabel}/${denominatorLabel}`,
    line: { color: ratioColor, width: 2.5 },
      marker: { color: ratioColor, size: 10 },
      xaxis: 'x2',
      yaxis: 'y2',
      showlegend: false,
      hovertemplate: '%{x}<br>%{y:.3f}<extra></extra>',
    })

  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
    barmode: 'stack',
    showlegend: true,
    legend: {
      x: 0.465,
      y: 0.96,
      xanchor: 'left',
      yanchor: 'top',
      bgcolor: 'rgba(255,255,255,0)',
      font: { size: style.fontSize, family: style.fontFamily, color: '#111827' },
    },
    margin: { l: 92, r: 42, t: 58, b: 82 },
    xaxis: {
      domain: [0, 0.44],
      anchor: 'y',
      type: 'category',
      categoryorder: 'array',
      categoryarray: samples,
      title: { text: 'Sample', font: { size: style.xAxisFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff },
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
    },
    yaxis: {
      domain: [0, 1],
      anchor: 'x',
      title: { text: 'Area ratio (%)', font: { size: style.yAxisFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff },
      range: [0, 100],
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
    },
    xaxis2: {
      domain: [0.63, 1],
      anchor: 'y2',
      type: 'category',
      categoryorder: 'array',
      categoryarray: samples,
      title: { text: 'Sample', font: { size: style.xAxisFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff },
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
    },
    yaxis2: {
      domain: [0, 1],
      anchor: 'x2',
      title: { text: `${numeratorLabel}/${denominatorLabel} area ratio`, font: { size: style.yAxisFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff },
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
    },
    annotations: [
      { x: -0.08, y: 1.08, xref: 'paper', yref: 'paper', text: '<b>(b)</b>', showarrow: false, font: { size: style.panelTitleFontSize, color: '#111827', family: style.fontFamily } },
      { x: 0.56, y: 1.08, xref: 'paper', yref: 'paper', text: '<b>(c)</b>', showarrow: false, font: { size: style.panelTitleFontSize, color: '#111827', family: style.fontFamily } },
    ] as unknown as Plotly.Layout['annotations'],
  }

  return { data, layout }
}

function buildXpsCombinedFigure(files: FitSpectrumFile[], style: PlotFigureStyle, styles: Record<string, ComponentStyle>) {
  const keys = componentKeys(files).filter(key => styles[key]?.show ?? true)
  const samples = files.map(file => file.sampleLabel)
  const areaRows = files.map(file => componentAreas(file, keys))
  const xAll = files.flatMap(file => file.x)
  const xMin = Math.min(...xAll)
  const xMax = Math.max(...xAll)
  const xLeft = Number.isFinite(style.xLeft ?? NaN) ? Number(style.xLeft) : xMax
  const xRight = Number.isFinite(style.xRight ?? NaN) ? Number(style.xRight) : xMin
  const yMax = Math.max(style.yMax, 0.3)
  const data: Plotly.Data[] = []
  const annotations: Partial<Plotly.Annotations>[] = []
  const shapes: Partial<Plotly.Shape>[] = []
  const panelXDomain: [number, number] = [0, 0.56]
  const rightXDomain: [number, number] = [0.68, 1]
  const panelBottom = 0.04
  const panelTop = 0.98
  const gap = 0.03
  const n = files.length
  const panelHeight = (panelTop - panelBottom - gap * Math.max(n - 1, 0)) / Math.max(n, 1)
  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    barmode: 'stack',
    showlegend: true,
    hovermode: 'closest',
    margin: { l: 78, r: 76, t: 42, b: 78 },
    font: { family: style.fontFamily, size: style.fontSize, color: '#111827' },
    legend: {
      x: 1.02,
      y: 0.94,
      xanchor: 'left',
      yanchor: 'top',
      bgcolor: 'rgba(255,255,255,0)',
      font: { size: style.fontSize, family: style.fontFamily, color: '#111827' },
    },
    annotations: annotations as unknown as Plotly.Layout['annotations'],
    shapes: shapes as Plotly.Shape[],
  }

  files.forEach((file, fileIndex) => {
    const axisSuffix = fileIndex === 0 ? '' : String(fileIndex + 1)
    const xAxisName = `xaxis${axisSuffix}`
    const yAxisName = `yaxis${axisSuffix}`
    const xRef = `x${axisSuffix}`
    const yRef = `y${axisSuffix}`
    const yDomainStart = panelTop - (fileIndex + 1) * panelHeight - fileIndex * gap
    const yDomainEnd = yDomainStart + panelHeight
    const yMin = percentile(file.totalFit, 0.01)
    const scaleRaw = Math.max(...file.totalFit.map(value => value - yMin).filter(Number.isFinite), 1)
    const scale = Math.abs(scaleRaw) > 1e-12 ? scaleRaw : 1
    const percentages = componentAreas(file, keys)

    ;(layout as Record<string, unknown>)[xAxisName] = {
      domain: panelXDomain,
      range: [xLeft, xRight],
      anchor: yRef,
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: 'inside',
      tickfont: { size: style.fontSize, family: style.fontFamily },
      title: fileIndex === n - 1 ? { text: 'Binding Energy (eV)', font: { size: style.xAxisFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff } : undefined,
      showticklabels: fileIndex === n - 1,
      minor: { ticks: 'inside' },
    } as Plotly.Layout['xaxis']
    ;(layout as Record<string, unknown>)[yAxisName] = {
      domain: [yDomainStart, yDomainEnd],
      anchor: xRef,
      range: [-0.05, yMax],
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: true,
      linewidth: style.axisLineWidth,
      linecolor: '#111827',
      ticks: '',
      showticklabels: false,
      title: fileIndex === Math.floor(n / 2) ? { text: 'Intensity (a.u.)', font: { size: style.yAxisFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff } : undefined,
    } as Plotly.Layout['yaxis']

    keys.forEach((key, keyIndex) => {
      const componentStyle = styles[key] ?? createDefaultComponentStyle(key, keyIndex)
      const displayLabel = formatPlotLabel(componentStyle.label || key)
      const component = (file.components[key] ?? file.x.map(() => 0)).map(value => value / scale)
      data.push({
        x: file.x,
        y: component,
        xaxis: xRef as never,
        yaxis: yRef as never,
        type: 'scatter',
        mode: 'lines',
        name: displayLabel,
        showlegend: false,
        line: { color: componentStyle.color, width: style.componentLineWidth },
        fill: 'tozeroy',
        fillcolor: hexToRgba(componentStyle.color, clamp(style.fillOpacity, 0, 1)),
        hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
      })

      const defaultCenter = file.x[component.indexOf(Math.max(...component))] ?? file.x[Math.floor(file.x.length / 2)] ?? 0
      const markerCenter = Number.isFinite(componentStyle.markerCenter ?? NaN) ? Number(componentStyle.markerCenter) : defaultCenter
      const markerY = Math.max(interpolateY(file.x, component, markerCenter), 0)
      const labelX = xLeft - clamp(componentStyle.labelX, 0.02, 0.98) * (xLeft - xRight)
      const labelY = clamp(componentStyle.labelY, 0, 1) * yMax
      const label = style.showPercent
        ? `${displayLabel}<br>(${(percentages[key] ?? 0).toFixed(1)}%)`
        : displayLabel

      if (style.showVerticalLines) {
        shapes.push({
          type: 'line',
          xref: xRef as Plotly.Shape['xref'],
          yref: yRef as Plotly.Shape['yref'],
          x0: markerCenter,
          x1: markerCenter,
          y0: 0,
          y1: markerY * 1.08,
          line: { color: componentStyle.color, width: 0.9, dash: 'dash' },
        })
      }
      shapes.push({
        type: 'line',
        xref: xRef as Plotly.Shape['xref'],
        yref: yRef as Plotly.Shape['yref'],
        x0: markerCenter,
        x1: labelX,
        y0: markerY * 1.03,
        y1: labelY,
        line: { color: componentStyle.color, width: 1.15 },
      })
      annotations.push({
        x: labelX,
        y: labelY,
        xref: xRef as Plotly.Annotations['xref'],
        yref: yRef as Plotly.Annotations['yref'],
        text: label,
        showarrow: false,
        align: 'center',
        yanchor: 'bottom',
        font: { color: componentStyle.color, size: style.labelFontSize, family: style.fontFamily },
      })
    })

    data.push({
      x: file.x,
      y: file.observed.map(value => (value - yMin) / scale),
      xaxis: xRef as never,
      yaxis: yRef as never,
      type: 'scatter',
      mode: style.rawMode,
      name: `${file.sampleLabel} Observed`,
      showlegend: false,
      line: { color: style.rawColor, width: style.rawLineWidth },
      marker: {
        color: style.rawMarkerFillColor,
        size: style.rawMarkerSize,
        line: { color: style.rawColor, width: style.rawMarkerLineWidth },
      },
      opacity: style.rawMode === 'markers' ? 1 : 0.65,
      hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
    })
    data.push({
      x: file.x,
      y: file.totalFit.map(value => (value - yMin) / scale),
      xaxis: xRef as never,
      yaxis: yRef as never,
      type: 'scatter',
      mode: 'lines',
      name: `${file.sampleLabel} Fit`,
      showlegend: false,
      line: { color: style.fitColor, width: style.fitLineWidth },
      hovertemplate: '%{x:.3f} eV<br>%{y:.4f}<extra></extra>',
    })

    annotations.push({
      x: panelXDomain[0] + (panelXDomain[1] - panelXDomain[0]) * clamp(style.panelTitleXPaper, -0.2, 1.2),
      y: yDomainStart + panelHeight * clamp(style.panelTitleYFraction, 0, 1.2),
      xref: 'paper',
      yref: 'paper',
      text: `<b>${style.titleLabel || 'XPS'}</b>`,
      showarrow: false,
      xanchor: 'left',
      yanchor: 'middle',
      font: { color: '#111827', size: style.panelTitleFontSize, family: style.fontFamily },
    })
    annotations.push({
      x: panelXDomain[0] + (panelXDomain[1] - panelXDomain[0]) * clamp(style.sampleLabelXPaper, -0.2, 1.2),
      y: yDomainStart + panelHeight * clamp(style.sampleLabelYFraction, 0, 1.2),
      xref: 'paper',
      yref: 'paper',
      text: `<b>${file.sampleLabel}</b>`,
      showarrow: false,
      xanchor: 'right',
      yanchor: 'middle',
      font: { color: '#111827', size: style.sampleFontSize, family: style.fontFamily },
    })
  })

  const barAxisSuffix = String(n + 1)
  const ratioAxisSuffix = String(n + 2)
  const barXRef = `x${barAxisSuffix}`
  const barYRef = `y${barAxisSuffix}`
  const ratioXRef = `x${ratioAxisSuffix}`
  const ratioYRef = `y${ratioAxisSuffix}`
  const numerator = style.ratioNumerator || keys[1] || keys[0] || ''
  const denominator = style.ratioDenominator || keys[0] || ''
  const numeratorLabel = formatPlotLabel(styles[numerator]?.label ?? numerator)
  const denominatorLabel = formatPlotLabel(styles[denominator]?.label ?? denominator)
  const ratioColor = (styles[numerator] ?? createDefaultComponentStyle(numerator, 1)).color
  const ratioValues = areaRows.map(row => {
    const den = row[denominator] ?? 0
    return den > 0 ? (row[numerator] ?? 0) / den : 0
  })
  const ratioMin = Math.min(...ratioValues.filter(Number.isFinite), 0)
  const ratioMax = Math.max(...ratioValues.filter(Number.isFinite), 1)
  const ratioPad = Math.max((ratioMax - ratioMin) * 0.12, 0.05)

  keys.forEach((key, index) => {
    const componentStyle = styles[key] ?? createDefaultComponentStyle(key, index)
    data.push({
      x: samples,
      y: areaRows.map(row => row[key] ?? 0),
      type: 'bar',
      name: formatPlotLabel(componentStyle.label || key),
      marker: { color: componentStyle.color, line: { color: '#111827', width: 1 } },
      xaxis: barXRef as never,
      yaxis: barYRef as never,
      hovertemplate: '%{x}<br>%{y:.2f}%<extra></extra>',
    })
  })
  data.push({
    x: samples,
    y: ratioValues,
    type: 'scatter',
    mode: 'lines+markers',
    name: `${numeratorLabel}/${denominatorLabel}`,
    showlegend: false,
    line: { color: ratioColor, width: 2.5 },
    marker: { color: ratioColor, size: 9 },
    xaxis: ratioXRef as never,
    yaxis: ratioYRef as never,
    hovertemplate: '%{x}<br>%{y:.3f}<extra></extra>',
  })

  ;(layout as Record<string, unknown>)[`xaxis${barAxisSuffix}`] = {
    domain: rightXDomain,
    anchor: barYRef,
    type: 'category',
    categoryorder: 'array',
    categoryarray: samples,
    title: { text: 'Sample', font: { size: style.xAxisFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff },
    showline: true,
    mirror: true,
    linewidth: style.axisLineWidth,
    linecolor: '#111827',
    ticks: 'inside',
    tickfont: { size: style.fontSize, family: style.fontFamily },
  } as Plotly.Layout['xaxis']
  ;(layout as Record<string, unknown>)[`yaxis${barAxisSuffix}`] = {
    domain: [0.58, 0.98],
    anchor: barXRef,
    title: { text: 'Area ratio (%)', font: { size: style.yAxisFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff },
    range: [0, 100],
    showline: true,
    mirror: true,
    linewidth: style.axisLineWidth,
    linecolor: '#111827',
    ticks: 'inside',
    tickfont: { size: style.fontSize, family: style.fontFamily },
  } as Plotly.Layout['yaxis']
  ;(layout as Record<string, unknown>)[`xaxis${ratioAxisSuffix}`] = {
    domain: rightXDomain,
    anchor: ratioYRef,
    type: 'category',
    categoryorder: 'array',
    categoryarray: samples,
    title: { text: 'Sample', font: { size: style.xAxisFontSize, family: style.fontFamily }, standoff: style.xAxisTitleStandoff },
    showline: true,
    mirror: true,
    linewidth: style.axisLineWidth,
    linecolor: '#111827',
    ticks: 'inside',
    tickfont: { size: style.fontSize, family: style.fontFamily },
  } as Plotly.Layout['xaxis']
  ;(layout as Record<string, unknown>)[`yaxis${ratioAxisSuffix}`] = {
    domain: [0.05, 0.42],
    anchor: ratioXRef,
    title: { text: `${numeratorLabel}/${denominatorLabel} area ratio`, font: { size: style.yAxisFontSize, family: style.fontFamily }, standoff: style.yAxisTitleStandoff },
    range: [Math.max(0, ratioMin - ratioPad), ratioMax + ratioPad],
    showline: true,
    mirror: true,
    linewidth: style.axisLineWidth,
    linecolor: '#111827',
    ticks: 'inside',
    tickfont: { size: style.fontSize, family: style.fontFamily },
  } as Plotly.Layout['yaxis']

  annotations.push(
    { x: panelXDomain[0] - 0.04, y: 1.02, xref: 'paper', yref: 'paper', text: '<b>a</b>', showarrow: false, font: { size: style.panelTitleFontSize + 4, color: '#111827', family: style.fontFamily } },
    { x: rightXDomain[0] - 0.07, y: 1.02, xref: 'paper', yref: 'paper', text: '<b>b</b>', showarrow: false, font: { size: style.panelTitleFontSize + 4, color: '#111827', family: style.fontFamily } },
    { x: rightXDomain[0] - 0.07, y: 0.45, xref: 'paper', yref: 'paper', text: '<b>c</b>', showarrow: false, font: { size: style.panelTitleFontSize + 4, color: '#111827', family: style.fontFamily } },
  )

  return { data, layout }
}

function NumInput({ label, value, onChange, min, max, step = 1 }: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={event => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none"
      />
    </label>
  )
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <input type="color" value={value} onChange={event => onChange(event.target.value)} className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-1 py-1" />
    </label>
  )
}

function PositionTargetBox({ label, value, active, onClick }: { label: string; value: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-xl border px-3 py-2 text-left transition-colors',
        active
          ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-main)]'
          : 'border-[var(--card-border)] bg-[var(--card-ghost)] text-[var(--text-main)] hover:border-[var(--accent-secondary)]',
      ].join(' ')}
    >
      <span className="block text-xs font-semibold">{label}</span>
      <span className="mt-1 block text-[10px] text-[var(--text-soft)]">{value}</span>
    </button>
  )
}

export default function PlotFileTool({
  onModuleSelect,
}: {
  onModuleSelect?: (module: AnalysisModuleId) => void
}) {
  const [activeModule, setActiveModule] = useState<PlotModule>('xps')
  const [xpsPlotMode, setXpsPlotMode] = useState<XpsPlotMode>('fit')
  const [files, setFiles] = useState<FitSpectrumFile[]>([])
  const [xpsOffsetSettings, setXpsOffsetSettings] = useState<XpsOffsetSettings>(DEFAULT_XPS_OFFSET_SETTINGS)
  const [style, setStyle] = useState<PlotFigureStyle>(DEFAULT_STYLE)
  const [xpsPositionTarget, setXpsPositionTarget] = useState<XpsPositionTarget>('x-axis-title')
  const [componentStyles, setComponentStyles] = useState<Record<string, ComponentStyle>>({})
  const [vbmFiles, setVbmFiles] = useState<VbmSpectrumFile[]>([])
  const [vbmStyle, setVbmStyle] = useState<VbmFigureStyle>(DEFAULT_VBM_STYLE)
  const [vbDosFiles, setVbDosFiles] = useState<VbDosSpectrumFile[]>([])
  const [vbDosStyle, setVbDosStyle] = useState<VbDosFigureStyle>(DEFAULT_VB_DOS_STYLE)
  const [vbDosRegions, setVbDosRegions] = useState<VbDosAssignmentRegion[]>(() => VB_DOS_ASSIGNMENT_REGIONS.map(region => ({ ...region })))
  const [xasBandFiles, setXasBandFiles] = useState<XasBandEdgeFile[]>([])
  const [xasBandPairs, setXasBandPairs] = useState<XasBandPair[]>([])
  const [xasBandStyle, setXasBandStyle] = useState<XasBandFigureStyle>(DEFAULT_XAS_BAND_STYLE)
  const [xrdTraces, setXrdTraces] = useState<XrdSourceTrace[]>([])
  const [xrdStyle, setXrdStyle] = useState<XrdFigureStyle>(DEFAULT_XRD_STYLE)
  const [xrdReferencePeaks, setXrdReferencePeaks] = useState<XrdReferencePeak[]>(() => DEFAULT_XRD_REFERENCE_PEAKS.map(peak => ({ ...peak })))
  const [ramanFiles, setRamanFiles] = useState<RamanFitPlotFile[]>([])
  const [ramanStyle, setRamanStyle] = useState<RamanFigureStyle>(DEFAULT_RAMAN_STYLE)
  const [selectedRamanId, setSelectedRamanId] = useState<string>('')
  const [ramanPlotMode, setRamanPlotMode] = useState<RamanPlotMode>('single')
  const [ramanFullscreenOpen, setRamanFullscreenOpen] = useState(false)
  const [ramanReferenceDatabases, setRamanReferenceDatabases] = useState<RamanReferenceDatabase[]>([])
  const [ramanReferenceSelectedDbIds, setRamanReferenceSelectedDbIds] = useState<string[]>([])
  const [ramanReferenceSelectedPeakIds, setRamanReferenceSelectedPeakIds] = useState<string[]>([])
  const [ramanReferenceMaterialFilter, setRamanReferenceMaterialFilter] = useState<string[]>([])
  const [ramanReferencePeakStyles, setRamanReferencePeakStyles] = useState<Record<string, RamanReferencePeakStyle>>({})
  const [ramanReferenceDbError, setRamanReferenceDbError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const xpsJoystickRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadRamanReferenceDatabases() {
      try {
        const loaded = await Promise.all(RAMAN_REFERENCE_DATABASES.map(async db => {
          const response = await fetch(db.url)
          if (!response.ok) throw new Error(`${db.label}: HTTP ${response.status}`)
          const payload = await response.json() as Record<string, unknown>
          return parseRamanReferenceDatabase(payload, db.id)
        }))
        if (cancelled) return
        setRamanReferenceDatabases(loaded)
        setRamanReferenceSelectedDbIds(current => current.length > 0 ? current : loaded.map(db => db.id))
        setRamanReferenceSelectedPeakIds(current => current.length > 0 ? current : loaded.flatMap(db => db.peaks.filter(peak => peak.enabled).map(peak => peak.id)))
        setRamanReferenceMaterialFilter(current => {
          if (current.length > 0) return current
          return Array.from(new Set(loaded.flatMap(db => db.peaks.map(peak => peak.material)))).sort((a, b) => a.localeCompare(b))
        })
        setRamanReferenceDbError(null)
      } catch (loadError: unknown) {
        if (cancelled) return
        setRamanReferenceDbError(String((loadError as Error).message ?? loadError))
      }
    }
    void loadRamanReferenceDatabases()
    return () => {
      cancelled = true
    }
  }, [])

  const xpsFigureFiles = useMemo(() => buildXpsOffsetFiles(files, xpsOffsetSettings), [files, xpsOffsetSettings])
  const xpsOffsetGrid = useMemo(() => xpsOffsetGridInfo(files, xpsOffsetSettings.nPoints), [files, xpsOffsetSettings.nPoints])
  const keys = useMemo(() => componentKeys(xpsFigureFiles), [xpsFigureFiles])
  const panelFigure = useMemo(() => xpsFigureFiles.length > 0 ? buildXpsPanelFigure(xpsFigureFiles, style, componentStyles) : null, [xpsFigureFiles, style, componentStyles])
  const summaryFigure = useMemo(() => xpsFigureFiles.length > 0 ? buildXpsSummaryFigure(xpsFigureFiles, style, componentStyles) : null, [xpsFigureFiles, style, componentStyles])
  const vbmResults = useMemo(() => {
    const results: VbmFitResult[] = []
    const errors: string[] = []
    vbmFiles.forEach(file => {
      try {
        results.push(calculateVbm(file))
      } catch (fitError: unknown) {
        errors.push(String((fitError as Error).message ?? fitError))
      }
    })
    return { results, errors }
  }, [vbmFiles])
  const vbmStackedFigure = useMemo(() => vbmResults.results.length > 0 ? buildVbmStackedFigure(vbmResults.results, vbmStyle) : null, [vbmResults.results, vbmStyle])
  const vbmSummaryFigure = useMemo(() => vbmResults.results.length > 0 ? buildVbmSummaryFigure(vbmResults.results, vbmStyle) : null, [vbmResults.results, vbmStyle])
  const vbDosFigure = useMemo(() => vbDosFiles.length > 0 ? buildVbDosFigure(vbDosFiles, vbDosStyle, vbDosRegions) : null, [vbDosFiles, vbDosStyle, vbDosRegions])
  const xasBandResults = useMemo(() => calculateXasBandPairs(xasBandFiles, xasBandPairs, xasBandStyle.normalizeIntensity), [xasBandFiles, xasBandPairs, xasBandStyle.normalizeIntensity])
  const xasBandFigure = useMemo(() => xasBandResults.results.length > 0 ? buildXasBandOverlayFigure(xasBandResults.results, xasBandStyle) : null, [xasBandResults.results, xasBandStyle])
  const xasSpecialResults = useMemo(() => calculateXasSpecialFits(xasBandFiles), [xasBandFiles])
  const xasSpecialFigure = useMemo(() => xasSpecialResults.results.length > 0 ? buildXasSpecialExtrapolationFigure(xasSpecialResults.results, xasBandStyle) : null, [xasBandStyle, xasSpecialResults.results])
  const xasSpecialTrendFigure = useMemo(() => xasSpecialResults.results.length > 0 ? buildXasSpecialTrendFigure(xasSpecialResults.results, xasBandStyle) : null, [xasBandStyle, xasSpecialResults.results])
  const xasSpecialTrendStatus = useMemo(() => xasSpecialTrendCheck(xasSpecialResults.results), [xasSpecialResults.results])
  const xrdFigure = useMemo(
    () => xrdTraces.length > 0 ? buildXrdStackedFigure(xrdTraces, xrdStyle, xrdReferencePeaks) : null,
    [xrdReferencePeaks, xrdStyle, xrdTraces],
  )
  const activeRamanFile = useMemo(
    () => ramanFiles.find(file => file.id === selectedRamanId) ?? ramanFiles[0] ?? null,
    [ramanFiles, selectedRamanId],
  )
  const ramanReferenceAllPeaks = useMemo(
    () => ramanReferenceDatabases.flatMap(db => db.peaks),
    [ramanReferenceDatabases],
  )
  const ramanReferenceMaterials = useMemo(
    () => Array.from(new Set(ramanReferenceAllPeaks.map(peak => peak.material))).sort((a, b) => a.localeCompare(b)),
    [ramanReferenceAllPeaks],
  )
  const ramanReferenceVisiblePeaks = useMemo(
    () => ramanReferenceAllPeaks
      .filter(peak => ramanReferenceSelectedDbIds.includes(peak.databaseId))
      .filter(peak => ramanReferenceMaterialFilter.includes(peak.material))
      .sort((a, b) => a.shift - b.shift),
    [ramanReferenceAllPeaks, ramanReferenceMaterialFilter, ramanReferenceSelectedDbIds],
  )
  const selectedRamanReferencePeaks = useMemo(
    () => ramanReferenceVisiblePeaks.filter(peak => ramanReferenceSelectedPeakIds.includes(peak.id)),
    [ramanReferenceSelectedPeakIds, ramanReferenceVisiblePeaks],
  )
  const ramanReferenceMatchRows = useMemo(
    () => buildRamanReferenceMatchRows(ramanFiles, selectedRamanReferencePeaks, ramanStyle),
    [ramanFiles, ramanStyle, selectedRamanReferencePeaks],
  )
  const ramanFigure = useMemo(
    () => ramanPlotMode === 'overlay'
      ? buildRamanOverlayFigure(ramanFiles, ramanStyle, selectedRamanReferencePeaks, ramanReferencePeakStyles)
      : activeRamanFile
        ? buildRamanPublicationFigure(activeRamanFile, ramanStyle)
        : null,
    [activeRamanFile, ramanFiles, ramanPlotMode, ramanStyle, selectedRamanReferencePeaks, ramanReferencePeakStyles],
  )
  const ramanDisplayedYRange = useMemo<[number, number]>(() => {
    const range = (ramanFigure?.layout as Partial<Plotly.Layout> | undefined)?.yaxis?.range
    if (Array.isArray(range) && range.length >= 2) {
      const y0 = Number(range[0])
      const y1 = Number(range[1])
      if (Number.isFinite(y0) && Number.isFinite(y1) && y0 !== y1) return [y0, y1]
    }
    return [0, 1]
  }, [ramanFigure])

  const importFiles = async (fileList: FileList | null) => {
    if (!fileList) return
    setError(null)
    const imported: FitSpectrumFile[] = []
    const errors: string[] = []
    for (const file of Array.from(fileList)) {
      try {
        const text = await file.text()
        imported.push(parseFitSpectrumText(text, file.name))
      } catch (importError: unknown) {
        errors.push(String((importError as Error).message ?? importError))
      }
    }
    setFiles(current => [...current, ...imported])
    const mergedKeys = componentKeys([...files, ...imported])
    setComponentStyles(current => {
      const next = { ...current }
      mergedKeys.forEach((key, index) => {
        if (!next[key]) next[key] = createDefaultComponentStyle(key, index)
      })
      const first = mergedKeys[0] ?? ''
      const second = mergedKeys[1] ?? first
      setStyle(prev => ({
        ...prev,
        ratioDenominator: prev.ratioDenominator || first,
        ratioNumerator: prev.ratioNumerator || second,
      }))
      return next
    })
    if (errors.length > 0) setError(errors.join('; '))
  }

  const updateXpsFitFile = (fileId: string, patch: Partial<Pick<FitSpectrumFile, 'sampleLabel' | 'xOffsetEv'>>) => {
    setFiles(current => current.map(file => file.id === fileId ? { ...file, ...patch } : file))
  }

  const importVbmFiles = async (fileList: FileList | null) => {
    if (!fileList) return
    setError(null)
    const imported: VbmSpectrumFile[] = []
    const errors: string[] = []
    for (const file of Array.from(fileList)) {
      try {
        const text = await file.text()
        imported.push(parseVbmSpectrumText(text, file.name))
      } catch (importError: unknown) {
        errors.push(String((importError as Error).message ?? importError))
      }
    }
    setVbmFiles(current => [...current, ...imported])
    if (errors.length > 0) setError(errors.join('; '))
  }

  const importVbDosFiles = async (fileList: FileList | null) => {
    if (!fileList) return
    setError(null)
    const imported: VbDosSpectrumFile[] = []
    const errors: string[] = []
    for (const [index, file] of Array.from(fileList).entries()) {
      try {
        const text = await file.text()
        imported.push(parseVbDosSpectrumText(text, file.name, vbDosFiles.length + index))
      } catch (importError: unknown) {
        errors.push(String((importError as Error).message ?? importError))
      }
    }
    setVbDosFiles(current => [...current, ...imported])
    if (errors.length > 0) setError(errors.join('; '))
  }

  const updateVbDosFile = (fileId: string, patch: Partial<Pick<VbDosSpectrumFile, 'sampleLabel' | 'color' | 'vbm' | 'sampleLabelXFraction' | 'sampleLabelYOffset'>>) => {
    setVbDosFiles(current => current.map(file => {
      if (file.id !== fileId) return file
      const next = { ...file, ...patch }
      if (patch.vbm !== undefined) next.peaks = recalcVbDosPeaks(file, patch.vbm, vbDosRegions)
      if (patch.sampleLabel !== undefined && patch.color === undefined) next.color = xpsSampleColor(patch.sampleLabel, current.findIndex(item => item.id === fileId))
      return next
    }))
  }

  const updateVbDosRegion = (regionId: string, patch: Partial<VbDosAssignmentRegion>) => {
    setVbDosRegions(current => current.map(region => region.id === regionId ? { ...region, ...patch } : region))
  }

  const resetVbDosRegions = () => {
    setVbDosRegions(VB_DOS_ASSIGNMENT_REGIONS.map(region => ({ ...region })))
  }

  const updateVbDosPeak = (fileId: string, peakId: string, patch: Partial<Pick<VbDosPeakAnnotation, 'label' | 'visible' | 'labelXShift' | 'labelYShift'>>) => {
    setVbDosFiles(current => current.map(file => file.id === fileId
      ? { ...file, peaks: file.peaks.map(peak => peak.id === peakId ? { ...peak, ...patch } : peak) }
      : file))
  }

  const importXasBandFiles = async (fileList: FileList | null, kind: XasBandFileKind) => {
    if (!fileList) return
    setError(null)
    const imported: XasBandEdgeFile[] = []
    const errors: string[] = []
    for (const [index, file] of Array.from(fileList).entries()) {
      try {
        const text = await file.text()
        imported.push(parseXasBandSpectrumText(text, file.name, kind, XAS_BAND_COLORS[(xasBandFiles.length + index) % XAS_BAND_COLORS.length]))
      } catch (importError: unknown) {
        errors.push(String((importError as Error).message ?? importError))
      }
    }
    setXasBandFiles(current => {
      const next = [...current, ...imported]
      setXasBandPairs(autoBuildXasBandPairs(next))
      return next
    })
    if (errors.length > 0) setError(errors.join('; '))
  }

  const importRamanFiles = async (fileList: FileList | null) => {
    if (!fileList) return
    setError(null)
    const imported: RamanFitPlotFile[] = []
    const errors: string[] = []
    for (const file of Array.from(fileList)) {
      try {
        const text = await file.text()
        imported.push(file.name.toLowerCase().endsWith('.json')
          ? parseRamanFitJson(text, file.name)
          : parseRamanSpectrumText(text, file.name))
      } catch (importError: unknown) {
        errors.push(String((importError as Error).message ?? importError))
      }
    }
    setRamanFiles(current => {
      const next = [...current, ...imported.map((file, index) => withRamanOverlayDefaults(file, current.length + index))]
      if (!selectedRamanId && next[0]) setSelectedRamanId(next[0].id)
      return next
    })
    if (errors.length > 0) setError(errors.join('; '))
  }

  const updateRamanComponentVisible = (fileId: string, componentIndex: number, visible: boolean) => {
    setRamanFiles(current => current.map(file => file.id === fileId
      ? {
        ...file,
        components: file.components.map((component, index) => index === componentIndex ? { ...component, visible } : component),
      }
      : file))
  }

  const setRamanComponentsVisible = (fileId: string, visible: boolean) => {
    setRamanFiles(current => current.map(file => file.id === fileId
      ? { ...file, components: file.components.map(component => ({ ...component, visible })) }
      : file))
  }

  const updateRamanFileOverlay = (fileId: string, patch: Partial<Pick<RamanFitPlotFile, 'sampleLabel' | 'overlayColor' | 'overlayYOffset' | 'sampleLabelXPaper' | 'sampleLabelYOffset'>>) => {
    setRamanFiles(current => current.map(file => file.id === fileId ? { ...file, ...patch } : file))
  }

  const updateRamanReferencePeakSelected = (peakId: string, selected: boolean) => {
    setRamanReferenceSelectedPeakIds(current => {
      if (selected) return current.includes(peakId) ? current : [...current, peakId]
      return current.filter(id => id !== peakId)
    })
  }

  const setVisibleRamanReferencePeaksSelected = (selected: boolean) => {
    const visibleIds = new Set(ramanReferenceVisiblePeaks.map(peak => peak.id))
    setRamanReferenceSelectedPeakIds(current => {
      if (selected) return Array.from(new Set([...current, ...visibleIds]))
      return current.filter(id => !visibleIds.has(id))
    })
  }

  const resetRamanReferencePeaks = () => {
    setRamanReferenceDatabases(current => current.map(db => ({
      ...db,
      peaks: db.peaks.map(peak => ({
        ...peak,
        shift: peak.defaultShift,
        displayLabel: peak.defaultDisplayLabel,
      })),
    })))
    setRamanReferenceSelectedDbIds(ramanReferenceDatabases.map(db => db.id))
    setRamanReferenceMaterialFilter(ramanReferenceMaterials)
    setRamanReferenceSelectedPeakIds(ramanReferenceAllPeaks.filter(peak => peak.enabled).map(peak => peak.id))
    setRamanReferencePeakStyles({})
  }

  const updateRamanReferencePeakData = (peakId: string, patch: Partial<Pick<RamanReferencePeak, 'shift' | 'displayLabel'>>) => {
    setRamanReferenceDatabases(current => current.map(db => ({
      ...db,
      peaks: db.peaks.map(peak => peak.id === peakId ? { ...peak, ...patch } : peak),
    })))
  }

  const updateRamanReferencePeakStyle = (peakId: string, patch: Partial<RamanReferencePeakStyle>) => {
    setRamanReferencePeakStyles(current => ({
      ...current,
      [peakId]: {
        labelXShift: current[peakId]?.labelXShift ?? 0,
        labelYFraction: current[peakId]?.labelYFraction ?? null,
        ...patch,
      },
    }))
  }

  const exportRamanReferencePeakCsv = () => {
    const headers = ['peak_id', 'shift_cm-1', 'default_shift_cm-1', 'material', 'phase', 'label', 'display_label', 'default_display_label', 'resonance_state', 'mode', 'structure', 'polyhedron', 'confidence', 'source_id', 'citation']
    downloadTextFile(rowsToCsv(headers, buildRamanReferencePeakRows(selectedRamanReferencePeaks)), 'raman_selected_reference_peaks.csv', 'text/csv;charset=utf-8')
  }

  const exportRamanReferenceMatchCsv = () => {
    const headers = ['peak_id', 'sample', 'ref_shift_cm-1', 'observed_local_max_cm-1', 'delta_cm-1', 'local_intensity_after_norm', 'material', 'display_label', 'resonance_state', 'polyhedron', 'mode', 'source_id']
    downloadTextFile(rowsToCsv(headers, ramanReferenceMatchRows), 'raman_peak_match_table.csv', 'text/csv;charset=utf-8')
  }

  const applyRomanPreset = () => {
    setComponentStyles(current => {
      const next = { ...current }
      keys.forEach((key, index) => {
        const currentStyle = next[key] ?? createDefaultComponentStyle(key, index)
        const position = ROMAN_COMPONENT_POSITIONS[index] ?? ROMAN_COMPONENT_POSITIONS[ROMAN_COMPONENT_POSITIONS.length - 1]
        next[key] = {
          ...currentStyle,
          label: ROMAN_COMPONENT_LABELS[index] ?? `O<sub>${index + 1}</sub>`,
          color: ROMAN_COMPONENT_COLORS[index] ?? currentStyle.color,
          labelX: position.labelX,
          labelY: position.labelY,
        }
      })
      return next
    })
    setStyle(prev => ({
      ...prev,
      ratioDenominator: keys[0] ?? prev.ratioDenominator,
      ratioNumerator: keys[1] ?? prev.ratioNumerator,
      rawMode: 'markers',
      rawColor: '#111827',
      rawMarkerFillColor: '#ffffff',
      fitColor: '#d7191c',
    }))
  }

  const exportPlot = async (kind: 'panels' | 'summary' | 'vbm-stacked' | 'vbm-summary' | 'xas-band' | 'xas-special' | 'xas-special-trend' | `vbm-single:${string}`, format: 'png' | 'svg') => {
    const singleVbmId = kind.startsWith('vbm-single:') ? kind.slice('vbm-single:'.length) : ''
    const singleVbmResult = singleVbmId ? vbmResults.results.find(result => result.file.id === singleVbmId) : null
    const figure = kind === 'panels'
      ? panelFigure
      : kind === 'summary'
        ? summaryFigure
        : kind === 'vbm-stacked'
          ? vbmStackedFigure
          : kind === 'vbm-summary'
            ? vbmSummaryFigure
            : kind === 'xas-band'
              ? xasBandFigure
              : kind === 'xas-special'
                ? xasSpecialFigure
                : kind === 'xas-special-trend'
                  ? xasSpecialTrendFigure
              : singleVbmResult
                ? buildVbmSingleFigure(singleVbmResult, vbmStyle)
                : null
    if (!figure) return
    setExporting(true)
    setError(null)
    const container = document.createElement('div')
    const width = kind === 'xas-band' || kind === 'xas-special' || kind === 'xas-special-trend'
      ? xasBandStyle.exportWidth
      : kind.startsWith('vbm')
      ? vbmStyle.exportWidth
      : kind === 'panels'
        ? style.exportWidth
        : Math.max(style.exportWidth, 1200)
    const height = kind === 'xas-band' || kind === 'xas-special' || kind === 'xas-special-trend'
      ? xasBandStyle.exportHeight
      : kind.startsWith('vbm')
      ? (kind === 'vbm-summary' ? Math.max(420, Math.round(vbmStyle.exportHeight * 0.45)) : vbmStyle.exportHeight)
      : kind === 'panels'
        ? style.exportHeight
        : Math.max(420, Math.round(style.exportHeight * 0.42))
    container.style.position = 'fixed'
    container.style.left = '-10000px'
    container.style.top = '0'
    container.style.width = `${width}px`
    container.style.height = `${height}px`
    document.body.appendChild(container)
    try {
      const plotly = PlotlyApi as unknown as PlotlyExportApi
      await plotly.newPlot(container, figure.data, { ...figure.layout, autosize: false, width, height }, { staticPlot: true, displayModeBar: false, responsive: false })
      const dataUrl = await plotly.toImage(container, { format, width, height, scale: format === 'png' ? (kind === 'xas-band' || kind === 'xas-special' || kind === 'xas-special-trend' ? xasBandStyle.exportScale : kind.startsWith('vbm') ? vbmStyle.exportScale : style.exportScale) : 1 })
      const exportName = kind === 'xas-band'
        ? `xas_xes_band_gap_overlay.${format}`
        : kind === 'xas-special'
        ? `xas_xes_531peak_special_fit.${format}`
        : kind === 'xas-special-trend'
        ? `xas_xes_531peak_band_gap_trend.${format}`
        : kind.startsWith('vbm-single:')
        ? `xps_vbm_${safeFileStem(singleVbmResult?.file.sampleLabel ?? 'single')}.${format}`
        : `xps_${kind.replace('-', '_')}_figure.${format}`
      downloadDataUrl(dataUrl, exportName)
      plotly.purge(container)
    } catch (exportError: unknown) {
      setError(String((exportError as Error).message ?? exportError))
    } finally {
      container.remove()
      setExporting(false)
    }
  }

  const exportRamanPlot = async (format: 'png' | 'svg') => {
    if (!ramanFigure || (ramanPlotMode === 'single' && !activeRamanFile)) return
    setExporting(true)
    setError(null)
    const container = document.createElement('div')
    const width = ramanStyle.exportWidth
    const height = ramanStyle.exportHeight
    container.style.position = 'fixed'
    container.style.left = '-10000px'
    container.style.top = '0'
    container.style.width = `${width}px`
    container.style.height = `${height}px`
    document.body.appendChild(container)
    try {
      const plotly = PlotlyApi as unknown as PlotlyExportApi
      await plotly.newPlot(container, ramanFigure.data, { ...ramanFigure.layout, autosize: false, width, height }, { staticPlot: true, displayModeBar: false, responsive: false })
      const dataUrl = await plotly.toImage(container, { format, width, height, scale: format === 'png' ? ramanStyle.exportScale : 1 })
      const stem = ramanPlotMode === 'overlay'
        ? 'multi_sample_overlay'
        : safeFileStem(activeRamanFile?.sampleLabel ?? 'single')
      downloadDataUrl(dataUrl, `raman_${stem}_publication.${format}`)
      plotly.purge(container)
    } catch (exportError: unknown) {
      setError(String((exportError as Error).message ?? exportError))
    } finally {
      container.remove()
      setExporting(false)
    }
  }

  const exportVbDosPlot = async (format: 'png' | 'svg' | 'pdf') => {
    if (!vbDosFigure) return
    setExporting(true)
    setError(null)
    const container = document.createElement('div')
    const width = vbDosStyle.exportWidth
    const height = vbDosStyle.exportHeight
    const scale = Math.max(1, vbDosStyle.exportScale)
    container.style.position = 'fixed'
    container.style.left = '-10000px'
    container.style.top = '0'
    container.style.width = `${width}px`
    container.style.height = `${height}px`
    document.body.appendChild(container)
    try {
      const plotly = PlotlyApi as unknown as PlotlyExportApi
      await plotly.newPlot(container, vbDosFigure.data, { ...vbDosFigure.layout, autosize: false, width, height }, { staticPlot: true, displayModeBar: false, responsive: false })
      if (format === 'pdf') {
        const dataUrl = await plotly.toImage(container, { format: 'jpeg', width, height, scale })
        const pdf = buildSingleImagePdf(dataUrl, width * scale, height * scale, vbDosStyle.exportDpi)
        downloadBlob(pdf, 'xps_vb_dos_assignment.pdf')
      } else {
        const dataUrl = await plotly.toImage(container, { format, width, height, scale: format === 'png' ? scale : 1 })
        downloadDataUrl(dataUrl, `xps_vb_dos_assignment.${format}`)
      }
      plotly.purge(container)
    } catch (exportError: unknown) {
      setError(String((exportError as Error).message ?? exportError))
    } finally {
      container.remove()
      setExporting(false)
    }
  }

  const importXrdFile = async (fileList: FileList | null) => {
    if (!fileList) return
    setError(null)
    const imported: XrdSourceTrace[] = []
    const errors: string[] = []
    for (const file of Array.from(fileList)) {
      try {
        const text = await file.text()
        imported.push(...parseXrdTraceText(text, file.name, xrdTraces.length + imported.length))
      } catch (importError: unknown) {
        errors.push(String((importError as Error).message ?? importError))
      }
    }
    if (imported.length > 0) setXrdTraces(current => [...current, ...imported])
    setActiveModule('xrd')
    if (errors.length > 0) setError(errors.join('; '))
  }

  const updateXrdTrace = (traceId: string, patch: Partial<XrdSourceTrace>) => {
    setXrdTraces(current => current.map(trace => trace.id === traceId ? { ...trace, ...patch } : trace))
  }

  const updateXrdReferencePeak = (peakId: string, patch: Partial<XrdReferencePeak>) => {
    setXrdReferencePeaks(current => current.map(peak => peak.id === peakId ? { ...peak, ...patch } : peak))
  }

  const nudgeXpsPosition = (target: XpsPositionTarget, dx: number, dy: number) => {
    setStyle(prev => {
      const step = Math.max(Math.hypot(dx, dy) / 18, 0.35)
      if (target === 'x-axis-title') {
        return { ...prev, xAxisTitleStandoff: clamp(prev.xAxisTitleStandoff + dy * step * 0.08, 0, 120) }
      }
      if (target === 'y-axis-title') {
        return { ...prev, yAxisTitleStandoff: clamp(prev.yAxisTitleStandoff - dx * step * 0.08, 0, 120) }
      }
      const xDelta = dx * step * 0.0018
      const yDelta = -dy * step * 0.0018
      if (target === 'panel-title') {
        return {
          ...prev,
          panelTitleXPaper: clamp(prev.panelTitleXPaper + xDelta, -0.2, 1.2),
          panelTitleYFraction: clamp(prev.panelTitleYFraction + yDelta, 0, 1.2),
        }
      }
      return {
        ...prev,
        sampleLabelXPaper: clamp(prev.sampleLabelXPaper + xDelta, -0.2, 1.2),
        sampleLabelYFraction: clamp(prev.sampleLabelYFraction + yDelta, 0, 1.2),
      }
    })
  }

  const handleXpsJoystickPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = xpsJoystickRef.current?.getBoundingClientRect()
    if (!rect) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const dx = event.clientX - (rect.left + rect.width / 2)
    const dy = event.clientY - (rect.top + rect.height / 2)
    const radius = Math.max(rect.width, rect.height) / 2
    const distance = Math.hypot(dx, dy)
    if (distance < 4) return
    const limited = Math.min(distance, radius)
    nudgeXpsPosition(xpsPositionTarget, (dx / distance) * limited, (dy / distance) * limited)
  }

  const exportXrdPlot = async (format: 'png' | 'svg' | 'pdf') => {
    if (!xrdFigure) return
    setExporting(true)
    setError(null)
    const container = document.createElement('div')
    const width = xrdStyle.exportWidth
    const height = xrdStyle.exportHeight
    const scale = Math.max(1, xrdStyle.exportScale)
    container.style.position = 'fixed'
    container.style.left = '-10000px'
    container.style.top = '0'
    container.style.width = `${width}px`
    container.style.height = `${height}px`
    document.body.appendChild(container)
    try {
      const plotly = PlotlyApi as unknown as PlotlyExportApi
      await plotly.newPlot(container, xrdFigure.data, { ...xrdFigure.layout, autosize: false, width, height }, { staticPlot: true, displayModeBar: false, responsive: false })
      if (format === 'pdf') {
        const dataUrl = await plotly.toImage(container, { format: 'jpeg', width, height, scale })
        const pdf = buildSingleImagePdf(dataUrl, width * scale, height * scale, xrdStyle.exportDpi)
        downloadBlob(pdf, 'xrd_stacked_plot.pdf')
      } else {
        const dataUrl = await plotly.toImage(container, { format, width, height, scale: format === 'png' ? scale : 1 })
        downloadDataUrl(dataUrl, `xrd_stacked_plot.${format}`)
      }
      plotly.purge(container)
    } catch (exportError: unknown) {
      setError(String((exportError as Error).message ?? exportError))
    } finally {
      container.remove()
      setExporting(false)
    }
  }

  const exportVbDosPeaksCsv = () => {
    const rows = vbDosFiles.flatMap(file => file.peaks.map(peak => ({
      Sample: file.sampleLabel,
      Peak_position_BE_eV: peak.be.toFixed(6),
      Peak_position_relative_to_VBM_eV: peak.relEnergy.toFixed(6),
      Preliminary_assignment: vbDosAssignmentForEnergy(peak.relEnergy, vbDosRegions),
    })))
    const headers = ['Sample', 'Peak_position_BE_eV', 'Peak_position_relative_to_VBM_eV', 'Preliminary_assignment']
    downloadTextFile(rowsToCsv(headers, rows), 'xps_vb_dos_detected_peaks.csv', 'text/csv;charset=utf-8')
  }

  const exportVbmSummaryCsv = () => {
    const rows = vbmResults.results.map(result => ({
      Sample: result.file.sampleLabel,
      File: result.file.name,
      X_column: result.file.xColumn,
      Y_column: result.file.yColumn,
      Baseline_range_eV: `${result.file.baselineStart}-${result.file.baselineEnd}`,
      Tangent_range_eV: `${result.file.tangentStart}-${result.file.tangentEnd}`,
      VBM_EF_minus_EVBM_eV: result.vbm.toFixed(6),
      VBM_y: result.vbmY.toFixed(6),
      Tangent_slope: result.tangentLine.slope.toFixed(6),
      Tangent_intercept: result.tangentLine.intercept.toFixed(6),
      Tangent_start_x: result.tangentLine.startPoint.x.toFixed(6),
      Tangent_end_x: result.tangentLine.endPoint.x.toFixed(6),
      Baseline_slope: result.baselineLine.slope.toFixed(6),
      Baseline_intercept: result.baselineLine.intercept.toFixed(6),
      Baseline_start_x: result.baselineLine.startPoint.x.toFixed(6),
      Baseline_end_x: result.baselineLine.endPoint.x.toFixed(6),
    }))
    const headers = ['Sample', 'File', 'X_column', 'Y_column', 'Baseline_range_eV', 'Tangent_range_eV', 'VBM_EF_minus_EVBM_eV', 'VBM_y', 'Tangent_slope', 'Tangent_intercept', 'Tangent_start_x', 'Tangent_end_x', 'Baseline_slope', 'Baseline_intercept', 'Baseline_start_x', 'Baseline_end_x']
    const csv = [
      headers.join(','),
      ...rows.map(row => headers.map(header => `"${String(row[header as keyof typeof row]).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    downloadTextFile(csv, 'VBM_results_summary.csv', 'text/csv;charset=utf-8')
  }

  const exportVbmSummaryTxt = () => {
    const lines = [
      'XPS VBM linear extrapolation results',
      'No background subtraction; normalized to max = 1',
      '',
      'Algorithm: same as XPS analysis VBM preview; tangent uses max positive slope candidate pair, baseline uses flattest candidate pair.',
      '',
      ...vbmResults.results.map(result => `${result.file.sampleLabel}: baseline=${result.file.baselineStart}-${result.file.baselineEnd} eV, tangent=${result.file.tangentStart}-${result.file.tangentEnd} eV, VBM=${result.vbm.toFixed(3)} eV, tangent_slope=${result.tangentLine.slope.toFixed(6)}, baseline_slope=${result.baselineLine.slope.toFixed(6)}`),
    ]
    downloadTextFile(lines.join('\n'), 'VBM_results_summary.txt')
  }

  const exportXasBandSummaryCsv = () => {
    const rows = xasBandResults.results.map(result => ({
      Sample: result.pair.sampleLabel,
      XES_file: result.xes.file.name,
      XAS_file: result.xas.file.name,
      VBM_eV: result.xes.edge.toFixed(6),
      CBM_eV: result.xas.edge.toFixed(6),
      Eg_eV: result.bandGap.toFixed(6),
      XES_display_range_eV: `${result.xes.file.displayStart}-${result.xes.file.displayEnd}`,
      XES_baseline_range_eV: `${result.xes.file.baselineStart}-${result.xes.file.baselineEnd}`,
      XES_tangent_range_eV: `${result.xes.file.tangentStart}-${result.xes.file.tangentEnd}`,
      XES_baseline_slope: result.xes.baselineLine.slope.toFixed(8),
      XES_tangent_slope: result.xes.tangentLine.slope.toFixed(8),
      XAS_display_range_eV: `${result.xas.file.displayStart}-${result.xas.file.displayEnd}`,
      XAS_baseline_range_eV: `${result.xas.file.baselineStart}-${result.xas.file.baselineEnd}`,
      XAS_tangent_range_eV: `${result.xas.file.tangentStart}-${result.xas.file.tangentEnd}`,
      XAS_baseline_slope: result.xas.baselineLine.slope.toFixed(8),
      XAS_tangent_slope: result.xas.tangentLine.slope.toFixed(8),
    }))
    const headers = ['Sample', 'XES_file', 'XAS_file', 'VBM_eV', 'CBM_eV', 'Eg_eV', 'XES_display_range_eV', 'XES_baseline_range_eV', 'XES_tangent_range_eV', 'XES_baseline_slope', 'XES_tangent_slope', 'XAS_display_range_eV', 'XAS_baseline_range_eV', 'XAS_tangent_range_eV', 'XAS_baseline_slope', 'XAS_tangent_slope']
    downloadTextFile(rowsToCsv(headers, rows), 'xas_xes_band_gap_summary.csv', 'text/csv;charset=utf-8')
  }

  const exportXasBandSummaryTxt = () => {
    const lines = [
      'XAS/XES band gap linear extrapolation results',
      'Algorithm: same as XPS VBM preview; tangent uses max positive slope candidate pair, baseline uses flattest candidate pair.',
      '',
      ...xasBandResults.results.map(result => `${result.pair.sampleLabel}: VBM=${result.xes.edge.toFixed(3)} eV, CBM=${result.xas.edge.toFixed(3)} eV, Eg=${result.bandGap.toFixed(3)} eV, XES display=${result.xes.file.displayStart}-${result.xes.file.displayEnd} eV, XAS display=${result.xas.file.displayStart}-${result.xas.file.displayEnd} eV`),
    ]
    downloadTextFile(lines.join('\n'), 'xas_xes_band_gap_summary.txt')
  }

  const exportXasSpecialSummaryCsv = () => {
    downloadTextFile(buildXasSpecialSummaryCsv(xasSpecialResults.results), 'Bandgap_XAS_XES_531peak_method_summary.csv', 'text/csv;charset=utf-8')
  }

  const xesBandFiles = xasBandFiles.filter(file => file.kind === 'xes')
  const xasAbsorptionBandFiles = xasBandFiles.filter(file => file.kind === 'xas')

  return (
    <div className="flex min-h-screen flex-col overflow-y-auto bg-[var(--bg-canvas)] p-4 sm:p-5">
      <ModuleTopBar
        title="繪製圖檔"
        subtitle="Publication Figure Builder"
        description="集中管理 Raman、XRD、XPS、XAS、XES 的投稿圖輸出；Raman 圖檔輸出已集中到此工作區。"
        chips={[
          { label: `目前 ${activeModule.toUpperCase()}` },
          { label: activeModule === 'raman' ? (ramanPlotMode === 'overlay' ? 'Raman 多樣品疊圖' : 'Raman deconvolution') : activeModule === 'xas' ? 'XES/XAS band gap' : activeModule === 'xrd' ? 'XRD stacked log plot' : (xpsPlotMode === 'vb-dos' ? 'VB-DOS 初步指認' : xpsPlotMode === 'vbm' ? 'VBM 線性外推' : '峰擬合圖') },
          { label: `檔案 ${activeModule === 'raman' ? ramanFiles.length : activeModule === 'xas' ? xasBandFiles.length : activeModule === 'xrd' ? new Set(xrdTraces.map(trace => trace.sourceFile)).size : (xpsPlotMode === 'vb-dos' ? vbDosFiles.length : xpsPlotMode === 'vbm' ? vbmFiles.length : files.length)}` },
          { label: activeModule === 'raman' ? (ramanPlotMode === 'overlay' ? `Ref ${selectedRamanReferencePeaks.length}` : `Peaks ${activeRamanFile ? visibleRamanComponents(activeRamanFile, ramanStyle).length : 0}/${activeRamanFile?.components.length ?? 0}`) : activeModule === 'xas' ? `Eg ${xasBandResults.results.length}` : activeModule === 'xrd' ? `Traces ${xrdTraces.filter(trace => trace.visible).length}` : (xpsPlotMode === 'vb-dos' ? `Peaks ${vbDosFiles.reduce((sum, file) => sum + file.peaks.length, 0)}` : xpsPlotMode === 'vbm' ? `VBM ${vbmResults.results.length}` : `Components ${keys.length}`) },
        ]}
      />

      <div className="mb-4 grid gap-3 md:grid-cols-5">
        {MODULES.map(module => (
          <button
            key={module.id}
            type="button"
            onClick={() => setActiveModule(module.id)}
            className={[
              'rounded-2xl border px-4 py-3 text-left transition-colors pressable',
              activeModule === module.id
                ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-main)]'
                : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-main)] hover:border-[var(--accent-secondary)]',
            ].join(' ')}
          >
            <span className="block text-sm font-semibold">{module.label}</span>
            <span className="mt-1 block text-[11px] leading-4 text-[var(--text-soft)]">{module.detail}</span>
            {!module.enabled && <span className="mt-2 inline-block rounded-full border border-[var(--card-border)] px-2 py-0.5 text-[10px] text-[var(--text-soft)]">預留</span>}
          </button>
        ))}
      </div>

      {activeModule === 'raman' ? (
        <div className="mb-4 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <div className="analysis-section-card p-4">
              <p className="text-sm font-semibold text-[var(--text-main)]">Raman 圖譜檔</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">可匯入 Raman 分析頁 JSON 報告，也可直接匯入兩欄式 TXT / CSV / DAT 做多樣品參考峰疊圖。</p>
              <label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-4 py-5 text-center text-sm text-[var(--text-main)] hover:border-[var(--accent-secondary)]">
                上傳 Raman JSON / TXT / CSV
                <input type="file" multiple accept=".json,.txt,.csv,.dat,.tsv" className="hidden" onChange={event => { void importRamanFiles(event.target.files); event.target.value = '' }} />
              </label>
              {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
              {ramanFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  {ramanFiles.map(file => (
                    <div key={file.id} className={[
                      'rounded-xl border p-2',
                      activeRamanFile?.id === file.id ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)]' : 'border-[var(--card-border)] bg-[var(--card-ghost)]',
                    ].join(' ')}>
                      <button type="button" onClick={() => setSelectedRamanId(file.id)} className="mb-2 w-full text-left text-xs font-semibold text-[var(--text-main)]">
                        {file.sampleLabel}
                      </button>
                      <input
                        value={file.sampleLabel}
                        onChange={event => updateRamanFileOverlay(file.id, { sampleLabel: event.target.value })}
                        className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none"
                      />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">線色</span>
                          <input type="color" value={file.overlayColor || ramanComponentColor(ramanFiles.findIndex(item => item.id === file.id), ramanStyle.correctedColor)} onChange={event => updateRamanFileOverlay(file.id, { overlayColor: event.target.value })} className="h-8 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-1 py-1" />
                        </label>
                        <NumInput label="線位置" value={file.overlayYOffset} onChange={value => updateRamanFileOverlay(file.id, { overlayYOffset: clamp(value, -10, 10) })} min={-10} max={10} step={0.05} />
                        <NumInput label="名稱 X" value={file.sampleLabelXPaper} onChange={value => updateRamanFileOverlay(file.id, { sampleLabelXPaper: clamp(value, -0.2, 1.4) })} min={-0.2} max={1.4} step={0.01} />
                        <NumInput label="名稱 Y" value={file.sampleLabelYOffset} onChange={value => updateRamanFileOverlay(file.id, { sampleLabelYOffset: clamp(value, -1, 2) })} min={-1} max={2} step={0.02} />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--text-soft)]">
                        <span className="truncate">{file.name}</span>
                        <button type="button" onClick={() => setRamanFiles(current => current.filter(item => item.id !== file.id))} className="text-rose-400">移除</button>
                      </div>
                      <p className="mt-1 text-[10px] text-[var(--text-soft)]">{file.sourceType === 'fit-json' ? 'fit JSON' : 'raw spectrum'} / {file.x.length} pts / {file.components.filter(component => component.visible !== false).length}/{file.components.length} peaks</p>
                    </div>
                  ))}
                  <button type="button" onClick={() => { setRamanFiles([]); setSelectedRamanId('') }} className="text-xs text-rose-400">清除全部</button>
                </div>
              )}
            </div>
          </aside>

          <section className="space-y-4">
            <div className="analysis-section-card p-4">
              <div className="mb-3 flex flex-wrap gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-2">
                {[
                  { id: 'single' as const, label: '單一擬合圖', detail: 'component deconvolution' },
                  { id: 'overlay' as const, label: '多樣品疊圖', detail: 'stacked final spectra' },
                ].map(mode => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setRamanPlotMode(mode.id)}
                    className={[
                      'min-w-[170px] flex-1 rounded-xl border px-3 py-2 text-left transition-colors pressable sm:flex-none',
                      ramanPlotMode === mode.id
                        ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-main)]'
                        : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-main)] hover:border-[var(--accent-secondary)]',
                    ].join(' ')}
                  >
                    <span className="block text-xs font-semibold">{mode.label}</span>
                    <span className="mt-1 block text-[10px] text-[var(--text-soft)]">{mode.detail}</span>
                  </button>
                ))}
              </div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-main)]">{ramanPlotMode === 'overlay' ? 'Raman multi-sample overlay' : 'Raman publication plot'}</p>
                  <p className="mt-1 text-xs text-[var(--text-soft)]">{ramanPlotMode === 'overlay' ? '白底、無 grid；多個樣品以歸一化後垂直 offset 疊圖，可同步顯示 total fit。' : '白底、無 grid；顯示 raw / baseline / corrected / components / total fit，不在下方加入 residual panel。'}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={!ramanFigure} onClick={() => setRamanFullscreenOpen(true)} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">全螢幕</button>
                  <button type="button" disabled={!ramanFigure || exporting} onClick={() => { void exportRamanPlot('png') }} className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">PNG</button>
                  <button type="button" disabled={!ramanFigure || exporting} onClick={() => { void exportRamanPlot('svg') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">SVG</button>
                </div>
              </div>
              {ramanFigure ? (
                <Plot data={ramanFigure.data} layout={ramanFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: ramanPlotMode === 'overlay' ? (ramanStyle.showOverlayZoom ? 760 : 640) : 600 }} />
              ) : (
                <div className="flex min-h-[440px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] text-sm text-[var(--text-soft)]">上傳 Raman JSON 或兩欄式光譜檔後預覽圖會顯示在這裡。</div>
              )}
            </div>
          </section>

          <aside className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
            {activeRamanFile && ramanPlotMode === 'single' && (
              <div className="analysis-section-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text-main)]">Raman 峰顯示</p>
                  <span className="rounded-full border border-[var(--card-border)] px-2 py-0.5 text-[10px] text-[var(--text-soft)]">
                    {visibleRamanComponents(activeRamanFile, ramanStyle).length}/{activeRamanFile.components.length}
                  </span>
                </div>
                <label className="mb-3 block">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">可信度篩選</span>
                  <select
                    value={ramanStyle.confidenceFilter}
                    onChange={event => setRamanStyle(prev => ({ ...prev, confidenceFilter: event.target.value as RamanConfidenceFilter }))}
                    className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none"
                  >
                    <option value="all">全部可信度</option>
                    <option value="high">只顯示 High</option>
                    <option value="medium-up">顯示 High / Medium</option>
                    <option value="low-only">只顯示 Low</option>
                  </select>
                </label>
                <div className="mb-3 flex gap-2">
                  <button type="button" onClick={() => setRamanComponentsVisible(activeRamanFile.id, true)} className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">全選</button>
                  <button type="button" onClick={() => setRamanComponentsVisible(activeRamanFile.id, false)} className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">全不選</button>
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {activeRamanFile.components.map((component, index) => {
                    const level = ramanConfidenceLevel(component)
                    const passesFilter = ramanConfidenceMatches(component, ramanStyle.confidenceFilter)
                    return (
                      <label
                        key={`${component.label}-${component.center ?? index}-${index}`}
                        className={[
                          'flex items-start gap-2 rounded-xl border px-3 py-2 text-xs transition-opacity',
                          component.visible !== false && passesFilter ? 'border-[var(--accent-secondary)] bg-[var(--accent-soft)]' : 'border-[var(--card-border)] bg-[var(--card-ghost)]',
                          passesFilter ? 'opacity-100' : 'opacity-45',
                        ].join(' ')}
                      >
                        <input
                          type="checkbox"
                          checked={component.visible !== false}
                          onChange={event => updateRamanComponentVisible(activeRamanFile.id, index, event.target.checked)}
                          className="mt-0.5 accent-[var(--accent-secondary)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-[var(--text-main)]">{component.label}</span>
                          <span className="mt-1 block text-[10px] text-[var(--text-soft)]">
                            {component.center == null ? 'center -' : `${component.center.toFixed(1)} cm⁻¹`} / {level}{component.confidenceScore == null ? '' : ` ${component.confidenceScore.toFixed(0)}`}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            {ramanPlotMode === 'overlay' && (
              <div className="analysis-section-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text-main)]">Raman 參考峰資料庫</p>
                  <span className="rounded-full border border-[var(--card-border)] px-2 py-0.5 text-[10px] text-[var(--text-soft)]">
                    {selectedRamanReferencePeaks.length}/{ramanReferenceVisiblePeaks.length}
                  </span>
                </div>
                {ramanReferenceDbError && <p className="mb-3 text-xs text-amber-400">{ramanReferenceDbError}</p>}
                <div className="space-y-2">
                  {ramanReferenceDatabases.map(db => (
                    <label key={db.id} className="flex items-start gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs text-[var(--text-main)]">
                      <input
                        type="checkbox"
                        checked={ramanReferenceSelectedDbIds.includes(db.id)}
                        onChange={event => setRamanReferenceSelectedDbIds(current => event.target.checked ? Array.from(new Set([...current, db.id])) : current.filter(id => id !== db.id))}
                        className="mt-0.5 accent-[var(--accent-secondary)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{RAMAN_REFERENCE_DATABASES.find(item => item.id === db.id)?.label ?? db.id}</span>
                        <span className="mt-1 block text-[10px] text-[var(--text-soft)]">{db.peaks.length} peaks / v{db.version || '-'}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {ramanReferenceMaterials.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">材料篩選</p>
                    <div className="grid grid-cols-2 gap-2">
                      {ramanReferenceMaterials.map(material => (
                        <label key={material} className="flex items-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs text-[var(--text-main)]">
                          <input
                            type="checkbox"
                            checked={ramanReferenceMaterialFilter.includes(material)}
                            onChange={event => setRamanReferenceMaterialFilter(current => event.target.checked ? Array.from(new Set([...current, material])) : current.filter(item => item !== material))}
                            className="accent-[var(--accent-secondary)]"
                          />
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ramanMaterialColor(material) }} />
                          <span>{displayRamanMaterial(material)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setVisibleRamanReferencePeaksSelected(true)} className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">全選可見</button>
                  <button type="button" onClick={() => setVisibleRamanReferencePeaksSelected(false)} className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">全不選</button>
                  <button type="button" onClick={resetRamanReferencePeaks} className="rounded-full border border-[var(--accent-secondary)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-secondary)]">預設</button>
                </div>
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {ramanReferenceVisiblePeaks.map((peak, index) => {
                    const currentPeakStyle = ramanReferencePeakStyles[peak.id]
                    const defaultY = clamp(ramanStyle.referenceLabelYFraction - (index % 5) * 0.072, 0.34, 1.08)
                    return (
                      <div
                        key={peak.id}
                        className={[
                          'rounded-xl border px-3 py-2 text-xs',
                          ramanReferenceSelectedPeakIds.includes(peak.id) ? 'border-[var(--accent-secondary)] bg-[var(--accent-soft)]' : 'border-[var(--card-border)] bg-[var(--card-ghost)]',
                        ].join(' ')}
                      >
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={ramanReferenceSelectedPeakIds.includes(peak.id)}
                            onChange={event => updateRamanReferencePeakSelected(peak.id, event.target.checked)}
                            className="mt-0.5 accent-[var(--accent-secondary)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold" style={{ color: ramanMaterialColor(peak.material) }}>
                              P{index + 1} {displayRamanMaterial(peak.material)} {peak.displayLabel || peak.resonanceState || peak.mode} {formatRamanShift(peak.shift)} cm⁻¹
                            </span>
                            <span className="mt-1 block text-[10px] leading-4 text-[var(--text-soft)]">
                              原始：{formatRamanShift(peak.defaultShift)} cm⁻¹ / {peak.defaultDisplayLabel}
                            </span>
                          </span>
                        </label>
                        <label className="mt-2 block">
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">參考峰名稱</span>
                          <input
                            type="text"
                            value={peak.displayLabel}
                            onChange={event => updateRamanReferencePeakData(peak.id, { displayLabel: event.target.value })}
                            className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none"
                          />
                        </label>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <NumInput label="理論值(cm⁻¹)" value={peak.shift} onChange={value => Number.isFinite(value) && updateRamanReferencePeakData(peak.id, { shift: value })} step={0.1} />
                          <button
                            type="button"
                            onClick={() => updateRamanReferencePeakData(peak.id, { shift: peak.defaultShift, displayLabel: peak.defaultDisplayLabel })}
                            className="mt-4 rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]"
                          >
                            還原此峰
                          </button>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <NumInput label="標籤 X" value={currentPeakStyle?.labelXShift ?? [-8, -4, 4, 8][index % 4]} onChange={value => updateRamanReferencePeakStyle(peak.id, { labelXShift: clamp(value, -240, 240) })} min={-240} max={240} step={2} />
                          <NumInput label="標籤 Y" value={currentPeakStyle?.labelYFraction ?? defaultY} onChange={value => updateRamanReferencePeakStyle(peak.id, { labelYFraction: clamp(value, 0.34, 1.08) })} min={0.34} max={1.08} step={0.01} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" disabled={selectedRamanReferencePeaks.length === 0} onClick={exportRamanReferencePeakCsv} className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">峰表 CSV</button>
                  <button type="button" disabled={ramanReferenceMatchRows.length === 0} onClick={exportRamanReferenceMatchCsv} className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">比對 CSV</button>
                </div>
                <p className="mt-3 text-[10px] leading-4 text-[var(--text-soft)]">參考峰標籤只顯示材料、共振態與波數；文字顏色跟材料線色一致。</p>
              </div>
            )}
            <div className="analysis-section-card p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">Raman 圖面設定</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">字體</span>
                  <select value={ramanStyle.fontFamily} onChange={event => setRamanStyle(prev => ({ ...prev, fontFamily: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                    <option value="Times New Roman, Times, serif">Times / Serif</option>
                    <option value="Arial, Helvetica, sans-serif">Arial / Sans</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="X 左端" value={ramanStyle.xLeft ?? (activeRamanFile ? Math.min(...activeRamanFile.x) : 80)} onChange={value => setRamanStyle(prev => ({ ...prev, xLeft: value }))} step={1} />
                  <NumInput label="X 右端" value={ramanStyle.xRight ?? (activeRamanFile ? Math.max(...activeRamanFile.x) : 800)} onChange={value => setRamanStyle(prev => ({ ...prev, xRight: value }))} step={1} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput
                    label="Y 下限"
                    value={ramanStyle.yBottom ?? ramanDisplayedYRange[0]}
                    onChange={value => setRamanStyle(prev => ({ ...prev, yBottom: value, yTop: prev.yTop ?? ramanDisplayedYRange[1] }))}
                    step={0.05}
                  />
                  <NumInput
                    label="Y 上限"
                    value={ramanStyle.yTop ?? ramanDisplayedYRange[1]}
                    onChange={value => setRamanStyle(prev => ({ ...prev, yBottom: prev.yBottom ?? ramanDisplayedYRange[0], yTop: value }))}
                    step={0.05}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setRamanStyle(prev => ({ ...prev, xLeft: null, xRight: null }))} className="rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">X 自動</button>
                  <button type="button" onClick={() => setRamanStyle(prev => ({ ...prev, yBottom: null, yTop: null }))} className="rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">Y 自動</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="刻度字體" value={ramanStyle.fontSize} onChange={value => setRamanStyle(prev => ({ ...prev, fontSize: value }))} min={8} max={34} step={1} />
                  <NumInput label="軸標題字體" value={ramanStyle.axisTitleFontSize} onChange={value => setRamanStyle(prev => ({ ...prev, axisTitleFontSize: value }))} min={10} max={42} step={1} />
                </div>
                <NumInput label="峰位標籤字體" value={ramanStyle.labelFontSize} onChange={value => setRamanStyle(prev => ({ ...prev, labelFontSize: value }))} min={8} max={30} step={1} />
                <div className="grid grid-cols-3 gap-2">
                  <ColorInput label="Raw" value={ramanStyle.rawColor} onChange={value => setRamanStyle(prev => ({ ...prev, rawColor: value }))} />
                  <ColorInput label="Corrected" value={ramanStyle.correctedColor} onChange={value => setRamanStyle(prev => ({ ...prev, correctedColor: value }))} />
                  <ColorInput label="Fit" value={ramanStyle.fitColor} onChange={value => setRamanStyle(prev => ({ ...prev, fitColor: value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <ColorInput label="Component" value={ramanStyle.componentColor} onChange={value => setRamanStyle(prev => ({ ...prev, componentColor: value }))} />
                  <ColorInput label="Baseline" value={ramanStyle.baselineColor} onChange={value => setRamanStyle(prev => ({ ...prev, baselineColor: value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="Raw 線寬" value={ramanStyle.rawLineWidth} onChange={value => setRamanStyle(prev => ({ ...prev, rawLineWidth: clamp(value, 0.1, 8) }))} min={0.1} max={8} step={0.1} />
                  <NumInput label="Fit 線寬" value={ramanStyle.fitLineWidth} onChange={value => setRamanStyle(prev => ({ ...prev, fitLineWidth: clamp(value, 0.1, 8) }))} min={0.1} max={8} step={0.1} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="Component 線寬" value={ramanStyle.componentLineWidth} onChange={value => setRamanStyle(prev => ({ ...prev, componentLineWidth: clamp(value, 0.1, 8) }))} min={0.1} max={8} step={0.1} />
                  <NumInput label="Component 透明度" value={ramanStyle.componentOpacity} onChange={value => setRamanStyle(prev => ({ ...prev, componentOpacity: clamp(value, 0, 1) }))} min={0} max={1} step={0.02} />
                </div>
                <NumInput label="疊圖 offset" value={ramanStyle.overlayOffset} onChange={value => setRamanStyle(prev => ({ ...prev, overlayOffset: clamp(value, 0, 3) }))} min={0} max={3} step={0.05} />
                {ramanPlotMode === 'overlay' && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="Zoom 左端" value={ramanStyle.overlayZoomLeft} onChange={value => setRamanStyle(prev => ({ ...prev, overlayZoomLeft: value }))} step={1} />
                      <NumInput label="Zoom 右端" value={ramanStyle.overlayZoomRight} onChange={value => setRamanStyle(prev => ({ ...prev, overlayZoomRight: value }))} step={1} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="Si 中心" value={ramanStyle.siMaskCenter} onChange={value => setRamanStyle(prev => ({ ...prev, siMaskCenter: value }))} step={1} />
                      <NumInput label="Si 半寬" value={ramanStyle.siMaskHalfWidth} onChange={value => setRamanStyle(prev => ({ ...prev, siMaskHalfWidth: Math.max(0, value) }))} min={0} step={1} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">參考峰標籤</span>
                        <select value={ramanStyle.referenceLabelMode} onChange={event => setRamanStyle(prev => ({ ...prev, referenceLabelMode: event.target.value as RamanReferenceLabelMode }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                          <option value="full">材料 + 共振態 + 波數</option>
                          <option value="material-shift">材料 + 共振態</option>
                          <option value="shift">共振態 + 波數</option>
                          <option value="index">編號 + 共振態</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">參考線型</span>
                        <select value={ramanStyle.referenceLineDash} onChange={event => setRamanStyle(prev => ({ ...prev, referenceLineDash: event.target.value as RamanReferenceLineDash }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                          <option value="dash">--</option>
                          <option value="dashdot">-.</option>
                          <option value="dot">:</option>
                          <option value="solid">-</option>
                        </select>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="參考線寬" value={ramanStyle.referenceLineWidth} onChange={value => setRamanStyle(prev => ({ ...prev, referenceLineWidth: clamp(value, 0.2, 6) }))} min={0.2} max={6} step={0.1} />
                      <NumInput label="參考透明度" value={ramanStyle.referenceLineOpacity} onChange={value => setRamanStyle(prev => ({ ...prev, referenceLineOpacity: clamp(value, 0.05, 1) }))} min={0.05} max={1} step={0.05} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="標籤視窗 X" value={ramanStyle.referenceLabelWindowXShift} onChange={value => setRamanStyle(prev => ({ ...prev, referenceLabelWindowXShift: clamp(value, -240, 240) }))} min={-240} max={240} step={2} />
                      <NumInput label="標籤視窗 Y" value={ramanStyle.referenceLabelYFraction} onChange={value => setRamanStyle(prev => ({ ...prev, referenceLabelYFraction: clamp(value, 0.5, 0.98) }))} min={0.5} max={0.98} step={0.01} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="比對 ±cm⁻¹" value={ramanStyle.referenceMatchTolerance} onChange={value => setRamanStyle(prev => ({ ...prev, referenceMatchTolerance: Math.max(0, value) }))} min={0} step={1} />
                      <button type="button" onClick={() => setRamanReferencePeakStyles({})} className="mt-4 rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">重設標籤位置</button>
                    </div>
                    {[
                      ['showOverlayZoom', '加入 zoom-in 子圖'],
                      ['showSiMask', '標示 Si 強峰干擾區'],
                      ['showReferencePeaks', '顯示參考峰標註'],
                      ['showOverlayLegend', '顯示右上角圖例'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs text-[var(--text-main)]">
                        <span>{label}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(ramanStyle[key as keyof RamanFigureStyle])}
                          onChange={event => setRamanStyle(prev => ({ ...prev, [key]: event.target.checked }))}
                          className="accent-[var(--accent-secondary)]"
                        />
                      </label>
                    ))}
                  </>
                )}
                {[
                  ['normalize', '強度歸一化'],
                  ['showRaw', '顯示 original'],
                  ['showCorrected', '顯示 corrected'],
                  ['showBaseline', '顯示 baseline'],
                  ['showComponents', '顯示 components'],
                  ['fillComponents', '填滿 components'],
                  ['showLabels', '顯示 peak labels'],
                  ['showOverlayFit', '疊圖顯示 total fit'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs text-[var(--text-main)]">
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(ramanStyle[key as keyof RamanFigureStyle])}
                      onChange={event => setRamanStyle(prev => ({ ...prev, [key]: event.target.checked }))}
                      className="accent-[var(--accent-secondary)]"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="analysis-section-card p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出尺寸</p>
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <NumInput label="圖寬(px)" value={ramanStyle.exportWidth} onChange={value => setRamanStyle(prev => ({ ...prev, exportWidth: Math.max(600, value) }))} min={600} max={4000} step={20} />
                <NumInput label="圖高(px)" value={ramanStyle.exportHeight} onChange={value => setRamanStyle(prev => ({ ...prev, exportHeight: Math.max(420, value) }))} min={420} max={4000} step={20} />
                <NumInput label="PNG 倍率" value={ramanStyle.exportScale} onChange={value => setRamanStyle(prev => ({ ...prev, exportScale: clamp(value, 1, 8) }))} min={1} max={8} step={0.5} />
              </div>
              <p className="mt-2 text-[10px] leading-4 text-[var(--text-soft)]">PNG 以高倍率輸出供投稿排版；向量圖請使用 SVG。</p>
            </div>
          </aside>
        </div>
      ) : activeModule === 'xas' ? (
        <div className="mb-4 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <aside className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
            <div className="analysis-section-card p-4">
              <p className="text-sm font-semibold text-[var(--text-main)]">XES / XAS 光譜檔</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">支援兩欄式 TXT / CSV / DAT / TSV；XES 用下降邊外推 VBM，XAS 用上升邊外推 CBM。</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <label className="block cursor-pointer rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-4 py-4 text-center text-sm text-[var(--text-main)] hover:border-[var(--accent-secondary)]">
                  上傳 XES
                  <input type="file" multiple accept=".txt,.csv,.dat,.tsv" className="hidden" onChange={event => { void importXasBandFiles(event.target.files, 'xes'); event.target.value = '' }} />
                </label>
                <label className="block cursor-pointer rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-4 py-4 text-center text-sm text-[var(--text-main)] hover:border-[var(--accent-secondary)]">
                  上傳 XAS
                  <input type="file" multiple accept=".txt,.csv,.dat,.tsv" className="hidden" onChange={event => { void importXasBandFiles(event.target.files, 'xas'); event.target.value = '' }} />
                </label>
              </div>
              {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
              {xasBandResults.errors.length > 0 && (
                <div className="mt-3 space-y-1">
                  {xasBandResults.errors.map(item => <p key={item} className="text-xs text-amber-400">{item}</p>)}
                </div>
              )}
            </div>

            {(['xes', 'xas'] as XasBandFileKind[]).map(kind => {
              const list = kind === 'xes' ? xesBandFiles : xasAbsorptionBandFiles
              return (
                <div key={kind} className="analysis-section-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--text-main)]">{kind.toUpperCase()} 檔案</p>
                    <span className="rounded-full border border-[var(--card-border)] px-2 py-0.5 text-[10px] text-[var(--text-soft)]">{list.length}</span>
                  </div>
                  <div className="space-y-3">
                    {list.map(file => {
                      const edgeResult = xasBandResults.results.flatMap(result => [result.xes, result.xas]).find(result => result.file.id === file.id)
                      const update = (patch: Partial<XasBandEdgeFile>) => setXasBandFiles(current => current.map(item => item.id === file.id ? { ...item, ...patch } : item))
                      const fileXMin = Math.min(...file.x)
                      const fileXMax = Math.max(...file.x)
                      return (
                        <div key={file.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                          <input
                            value={file.sampleLabel}
                            onChange={event => update({ sampleLabel: event.target.value })}
                            className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs font-semibold text-[var(--input-text)] focus:outline-none"
                          />
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <ColorInput label="線色" value={file.color} onChange={value => update({ color: value })} />
                            <button type="button" onClick={() => setXasBandFiles(current => current.filter(item => item.id !== file.id))} className="mt-4 rounded-lg border border-rose-400/50 px-3 py-1.5 text-xs font-semibold text-rose-400">移除</button>
                          </div>
                          <p className="mt-2 text-[10px] leading-4 text-[var(--text-soft)]">{file.name}<br />X: {file.xColumn} / Y: {file.yColumn} / {file.x.length} pts</p>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <NumInput label="顯示 X 起" value={file.displayStart} onChange={value => update({ displayStart: value })} step={0.05} />
                            <NumInput label="顯示 X 迄" value={file.displayEnd} onChange={value => update({ displayEnd: value })} step={0.05} />
                            <NumInput label="Baseline 起" value={file.baselineStart} onChange={value => update({ baselineStart: value })} step={0.05} />
                            <NumInput label="Baseline 迄" value={file.baselineEnd} onChange={value => update({ baselineEnd: value })} step={0.05} />
                            <NumInput label="Tangent 起" value={file.tangentStart} onChange={value => update({ tangentStart: value })} step={0.05} />
                            <NumInput label="Tangent 迄" value={file.tangentEnd} onChange={value => update({ tangentEnd: value })} step={0.05} />
                          </div>
                          <button type="button" onClick={() => update({ displayStart: fileXMin, displayEnd: fileXMax })} className="mt-2 rounded-full border border-[var(--card-border)] px-3 py-1.5 text-[10px] font-semibold text-[var(--text-main)]">
                            顯示完整 X 範圍
                          </button>
                          {edgeResult && <p className="mt-2 text-xs font-semibold text-[var(--accent-secondary)]">{edgeResult.edgeLabel} = {edgeResult.edge.toFixed(3)} eV</p>}
                        </div>
                      )
                    })}
                    {list.length === 0 && <p className="text-xs leading-5 text-[var(--text-soft)]">尚未上傳 {kind.toUpperCase()} 檔案。</p>}
                  </div>
                </div>
              )
            })}
          </aside>

          <section className="space-y-4">
            <div className="analysis-section-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-main)]">XES / XAS band gap 疊圖</p>
                  <p className="mt-1 text-xs text-[var(--text-soft)]">圖形以 XES 實線、XAS 虛線呈現；淡黃色區塊為 VBM 到 CBM 的 Eg。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!xasBandFigure || exporting} onClick={() => { void exportPlot('xas-band', 'png') }} className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">PNG</button>
                  <button type="button" disabled={!xasBandFigure || exporting} onClick={() => { void exportPlot('xas-band', 'svg') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">SVG</button>
                  <button type="button" disabled={xasBandResults.results.length === 0} onClick={exportXasBandSummaryCsv} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">CSV</button>
                  <button type="button" disabled={xasBandResults.results.length === 0} onClick={exportXasBandSummaryTxt} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">TXT</button>
                </div>
              </div>
              {xasBandFigure ? (
                <Plot data={xasBandFigure.data} layout={xasBandFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: Math.max(460, 245 * xasBandResults.results.length) }} />
              ) : (
                <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] text-sm text-[var(--text-soft)]">上傳並配對 XES / XAS 光譜後，Band gap 疊圖會顯示在這裡。</div>
              )}
            </div>

            {xasBandResults.results.length > 0 && (
              <div className="analysis-section-card p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">Band gap 結果</p>
                <div className="grid gap-3 md:grid-cols-3">
                  {xasBandResults.results.map(result => (
                    <div key={result.pair.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                      <p className="text-xs font-semibold text-[var(--text-main)]">{result.pair.sampleLabel}</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--accent-secondary)]">{result.bandGap.toFixed(3)} eV</p>
                      <p className="mt-1 text-[10px] leading-4 text-[var(--text-soft)]">VBM {result.xes.edge.toFixed(3)} eV / CBM {result.xas.edge.toFixed(3)} eV</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="analysis-section-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-main)]">特殊擬合：531 eV leading edge</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">固定使用 XAS 529.50-530.30 eV baseline median、531.25-531.55 eV 線性擬合與前次校正 XES VBM；不重新做全域歸一化。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!xasSpecialFigure || exporting} onClick={() => { void exportPlot('xas-special', 'png') }} className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">外推 PNG</button>
                  <button type="button" disabled={!xasSpecialFigure || exporting} onClick={() => { void exportPlot('xas-special', 'svg') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">外推 SVG</button>
                  <button type="button" disabled={!xasSpecialTrendFigure || exporting} onClick={() => { void exportPlot('xas-special-trend', 'png') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">趨勢 PNG</button>
                  <button type="button" disabled={!xasSpecialTrendFigure || exporting} onClick={() => { void exportPlot('xas-special-trend', 'svg') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">趨勢 SVG</button>
                  <button type="button" disabled={xasSpecialResults.results.length === 0} onClick={exportXasSpecialSummaryCsv} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">summary CSV</button>
                </div>
              </div>
              {xasSpecialResults.errors.length > 0 && (
                <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
                  {xasSpecialResults.errors.map(item => <p key={item} className="text-xs text-amber-300">{item}</p>)}
                </div>
              )}
              {xasSpecialResults.results.length > 0 && (
                <p className={[
                  'mb-3 rounded-xl border px-3 py-2 text-xs font-semibold',
                  xasSpecialTrendStatus === 'pass'
                    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                    : 'border-amber-400/30 bg-amber-400/10 text-amber-300',
                ].join(' ')}
                >
                  趨勢檢查：{xasSpecialTrendStatus === 'pass' ? '符合 40-10 > 45-5 > 50-0' : xasSpecialTrendStatus === 'not enough samples' ? '樣品不足，需三個 XAS 檔案' : '未符合 40-10 > 45-5 > 50-0，請檢查資料或擬合區間'}
                </p>
              )}
              {xasSpecialFigure ? (
                <div className="space-y-4">
                  <Plot data={xasSpecialFigure.data} layout={xasSpecialFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: Math.max(500, 250 * xasSpecialResults.results.length) }} />
                  {xasSpecialTrendFigure && <Plot data={xasSpecialTrendFigure.data} layout={xasSpecialTrendFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: 420 }} />}
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-xs text-[var(--text-main)]">
                      <thead className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-soft)]">
                        <tr>
                          {['Sample', 'VBM', 'CBM', 'Eg', 'Slope', 'Intercept', 'R2'].map(header => <th key={header} className="whitespace-nowrap px-3 py-2">{header}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {xasSpecialResults.results.map(result => (
                          <tr key={result.sample} className="border-t border-[var(--card-border)]">
                            <td className="whitespace-nowrap px-3 py-2 font-semibold">{result.sample}</td>
                            <td className="whitespace-nowrap px-3 py-2">{result.vbm.toFixed(3)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{result.cbm.toFixed(3)}</td>
                            <td className="whitespace-nowrap px-3 py-2 font-semibold text-[var(--accent-secondary)]">{result.bandGap.toFixed(3)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{result.fitSlope.toExponential(4)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{result.fitIntercept.toExponential(4)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{result.fitR2.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-4 text-center text-sm text-[var(--text-soft)]">
                  上傳 XAS_40-10_norm_524-532max.csv、XAS_45-5_norm_524-532max.csv、XAS_50-0_norm_524-532max.csv 到 XAS 檔案後，特殊擬合會顯示在這裡。
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
            <div className="analysis-section-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--text-main)]">樣品配對</p>
                <button type="button" onClick={() => setXasBandPairs(autoBuildXasBandPairs(xasBandFiles))} className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">自動配對</button>
              </div>
              <div className="space-y-3">
                {xasBandPairs.map(pair => {
                  const update = (patch: Partial<XasBandPair>) => setXasBandPairs(current => current.map(item => item.id === pair.id ? { ...item, ...patch } : item))
                  const result = xasBandResults.results.find(item => item.pair.id === pair.id)
                  return (
                    <div key={pair.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                      <input value={pair.sampleLabel} onChange={event => update({ sampleLabel: event.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs font-semibold text-[var(--input-text)] focus:outline-none" />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">XES</span>
                          <select value={pair.xesFileId} onChange={event => update({ xesFileId: event.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                            {xesBandFiles.map(file => <option key={file.id} value={file.id}>{file.sampleLabel}</option>)}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">XAS</span>
                          <select value={pair.xasFileId} onChange={event => update({ xasFileId: event.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                            {xasAbsorptionBandFiles.map(file => <option key={file.id} value={file.id}>{file.sampleLabel}</option>)}
                          </select>
                        </label>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <ColorInput label="樣品色" value={pair.color} onChange={value => update({ color: value })} />
                        <button type="button" onClick={() => setXasBandPairs(current => current.filter(item => item.id !== pair.id))} className="mt-4 rounded-lg border border-rose-400/50 px-3 py-1.5 text-xs font-semibold text-rose-400">移除配對</button>
                      </div>
                      {result && <p className="mt-2 text-xs font-semibold text-[var(--accent-secondary)]">Eg = {result.bandGap.toFixed(3)} eV</p>}
                    </div>
                  )
                })}
                {xasBandPairs.length === 0 && <p className="text-xs leading-5 text-[var(--text-soft)]">上傳 XES 與 XAS 後會自動建立同名配對，也可用自動配對重新整理。</p>}
                <button
                  type="button"
                  disabled={xesBandFiles.length === 0 || xasAbsorptionBandFiles.length === 0}
                  onClick={() => setXasBandPairs(current => [...current, {
                    id: `xas-band-pair-${Date.now()}`,
                    sampleLabel: `Pair ${current.length + 1}`,
                    xesFileId: xesBandFiles[0]?.id ?? '',
                    xasFileId: xasAbsorptionBandFiles[0]?.id ?? '',
                    color: XAS_BAND_COLORS[current.length % XAS_BAND_COLORS.length],
                  }])}
                  className="rounded-full border border-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-[var(--accent-secondary)] disabled:opacity-40"
                >
                  新增配對
                </button>
              </div>
            </div>

            <div className="analysis-section-card p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">XAS 圖面設定</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">字體</span>
                  <select value={xasBandStyle.fontFamily} onChange={event => setXasBandStyle(prev => ({ ...prev, fontFamily: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                    <option value="Times New Roman, Times, serif">Times / Serif</option>
                    <option value="Arial, Helvetica, sans-serif">Arial / Sans</option>
                    <option value="Georgia, serif">Georgia</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">XES 標題</span>
                    <input value={xasBandStyle.xesTitle} onChange={event => setXasBandStyle(prev => ({ ...prev, xesTitle: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">XAS 標題</span>
                    <input value={xasBandStyle.xasTitle} onChange={event => setXasBandStyle(prev => ({ ...prev, xasTitle: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none" />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="X 左端" value={xasBandStyle.xLeft} onChange={value => setXasBandStyle(prev => ({ ...prev, xLeft: value }))} step={0.1} />
                  <NumInput label="X 右端" value={xasBandStyle.xRight} onChange={value => setXasBandStyle(prev => ({ ...prev, xRight: value }))} step={0.1} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="Y 下限" value={xasBandStyle.yMin} onChange={value => setXasBandStyle(prev => ({ ...prev, yMin: value }))} step={0.02} />
                  <NumInput label="Y 上限" value={xasBandStyle.yMax} onChange={value => setXasBandStyle(prev => ({ ...prev, yMax: value }))} step={0.02} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="刻度字體" value={xasBandStyle.fontSize} onChange={value => setXasBandStyle(prev => ({ ...prev, fontSize: clamp(value, 8, 34) }))} min={8} max={34} step={1} />
                  <NumInput label="軸標題字體" value={xasBandStyle.axisTitleFontSize} onChange={value => setXasBandStyle(prev => ({ ...prev, axisTitleFontSize: clamp(value, 10, 42) }))} min={10} max={42} step={1} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="Panel 標題" value={xasBandStyle.panelTitleFontSize} onChange={value => setXasBandStyle(prev => ({ ...prev, panelTitleFontSize: clamp(value, 12, 48) }))} min={12} max={48} step={1} />
                  <NumInput label="樣品標籤字體" value={xasBandStyle.sampleFontSize} onChange={value => setXasBandStyle(prev => ({ ...prev, sampleFontSize: clamp(value, 8, 42) }))} min={8} max={42} step={1} />
                </div>
                <NumInput label="標註字體" value={xasBandStyle.annotationFontSize} onChange={value => setXasBandStyle(prev => ({ ...prev, annotationFontSize: clamp(value, 8, 34) }))} min={8} max={34} step={1} />
                <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">Panel 標題位置</p>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="XES X" value={xasBandStyle.xesTitleXPaper} onChange={value => setXasBandStyle(prev => ({ ...prev, xesTitleXPaper: clamp(value, -0.2, 1.2) }))} min={-0.2} max={1.2} step={0.01} />
                    <NumInput label="XES Y" value={xasBandStyle.xesTitleYPaper} onChange={value => setXasBandStyle(prev => ({ ...prev, xesTitleYPaper: clamp(value, -0.2, 1.2) }))} min={-0.2} max={1.2} step={0.01} />
                    <NumInput label="XAS X" value={xasBandStyle.xasTitleXPaper} onChange={value => setXasBandStyle(prev => ({ ...prev, xasTitleXPaper: clamp(value, -0.2, 1.2) }))} min={-0.2} max={1.2} step={0.01} />
                    <NumInput label="XAS Y" value={xasBandStyle.xasTitleYPaper} onChange={value => setXasBandStyle(prev => ({ ...prev, xasTitleYPaper: clamp(value, -0.2, 1.2) }))} min={-0.2} max={1.2} step={0.01} />
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">樣品標籤位置</p>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="標籤 X" value={xasBandStyle.sampleLabelXPaper} onChange={value => setXasBandStyle(prev => ({ ...prev, sampleLabelXPaper: clamp(value, -0.2, 1.2) }))} min={-0.2} max={1.2} step={0.01} />
                    <NumInput label="標籤 Y" value={xasBandStyle.sampleLabelYFraction} onChange={value => setXasBandStyle(prev => ({ ...prev, sampleLabelYFraction: clamp(value, -0.2, 1.2) }))} min={-0.2} max={1.2} step={0.01} />
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">VBM / CBM / Eg 標註</p>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="VBM 字體" value={xasBandStyle.vbmLabelFontSize} onChange={value => setXasBandStyle(prev => ({ ...prev, vbmLabelFontSize: clamp(value, 8, 42) }))} min={8} max={42} step={1} />
                    <NumInput label="CBM 字體" value={xasBandStyle.cbmLabelFontSize} onChange={value => setXasBandStyle(prev => ({ ...prev, cbmLabelFontSize: clamp(value, 8, 42) }))} min={8} max={42} step={1} />
                    <NumInput label="Eg 字體" value={xasBandStyle.egLabelFontSize} onChange={value => setXasBandStyle(prev => ({ ...prev, egLabelFontSize: clamp(value, 8, 42) }))} min={8} max={42} step={1} />
                    <NumInput label="VBM X 偏移" value={xasBandStyle.vbmLabelXShift} onChange={value => setXasBandStyle(prev => ({ ...prev, vbmLabelXShift: clamp(value, -5, 5) }))} min={-5} max={5} step={0.02} />
                    <NumInput label="VBM Y" value={xasBandStyle.vbmLabelYFraction} onChange={value => setXasBandStyle(prev => ({ ...prev, vbmLabelYFraction: clamp(value, -0.2, 1.2) }))} min={-0.2} max={1.2} step={0.01} />
                    <NumInput label="CBM X 偏移" value={xasBandStyle.cbmLabelXShift} onChange={value => setXasBandStyle(prev => ({ ...prev, cbmLabelXShift: clamp(value, -5, 5) }))} min={-5} max={5} step={0.02} />
                    <NumInput label="CBM Y" value={xasBandStyle.cbmLabelYFraction} onChange={value => setXasBandStyle(prev => ({ ...prev, cbmLabelYFraction: clamp(value, -0.2, 1.2) }))} min={-0.2} max={1.2} step={0.01} />
                    <NumInput label="Eg 文字 Y" value={xasBandStyle.egLabelYFraction} onChange={value => setXasBandStyle(prev => ({ ...prev, egLabelYFraction: clamp(value, -0.2, 1.2) }))} min={-0.2} max={1.2} step={0.01} />
                    <NumInput label="Eg 線 Y" value={xasBandStyle.egLineYFraction} onChange={value => setXasBandStyle(prev => ({ ...prev, egLineYFraction: clamp(value, 0.02, 0.98) }))} min={0.02} max={0.98} step={0.01} />
                  </div>
                </div>
                <NumInput label="框線粗細" value={xasBandStyle.axisLineWidth} onChange={value => setXasBandStyle(prev => ({ ...prev, axisLineWidth: clamp(value, 0.2, 8) }))} min={0.2} max={8} step={0.1} />
                <div className="grid grid-cols-2 gap-2">
                  <ColorInput label="VBM" value={xasBandStyle.vbmColor} onChange={value => setXasBandStyle(prev => ({ ...prev, vbmColor: value }))} />
                  <ColorInput label="CBM" value={xasBandStyle.cbmColor} onChange={value => setXasBandStyle(prev => ({ ...prev, cbmColor: value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <ColorInput label="Eg 區塊" value={xasBandStyle.gapColor} onChange={value => setXasBandStyle(prev => ({ ...prev, gapColor: value }))} />
                  <ColorInput label="Baseline" value={xasBandStyle.baselineColor} onChange={value => setXasBandStyle(prev => ({ ...prev, baselineColor: value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="XES 線寬" value={xasBandStyle.xesLineWidth} onChange={value => setXasBandStyle(prev => ({ ...prev, xesLineWidth: clamp(value, 0.2, 8) }))} min={0.2} max={8} step={0.1} />
                  <NumInput label="XAS 線寬" value={xasBandStyle.xasLineWidth} onChange={value => setXasBandStyle(prev => ({ ...prev, xasLineWidth: clamp(value, 0.2, 8) }))} min={0.2} max={8} step={0.1} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="擬合線寬" value={xasBandStyle.fitLineWidth} onChange={value => setXasBandStyle(prev => ({ ...prev, fitLineWidth: clamp(value, 0.2, 8) }))} min={0.2} max={8} step={0.1} />
                  <NumInput label="Eg 透明度" value={xasBandStyle.gapOpacity} onChange={value => setXasBandStyle(prev => ({ ...prev, gapOpacity: clamp(value, 0, 0.6) }))} min={0} max={0.6} step={0.02} />
                </div>
                {[
                  ['manualYRange', '手動 Y 範圍'],
                  ['normalizeIntensity', '最大值歸一化'],
                  ['showFitGuides', '顯示外推輔助線'],
                  ['showLegend', '顯示圖例'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs text-[var(--text-main)]">
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(xasBandStyle[key as keyof XasBandFigureStyle])}
                      onChange={event => setXasBandStyle(prev => ({ ...prev, [key]: event.target.checked }))}
                      className="accent-[var(--accent-secondary)]"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="analysis-section-card p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出尺寸</p>
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <NumInput label="圖寬(px)" value={xasBandStyle.exportWidth} onChange={value => setXasBandStyle(prev => ({ ...prev, exportWidth: Math.max(700, value) }))} min={700} max={4000} step={20} />
                <NumInput label="圖高(px)" value={xasBandStyle.exportHeight} onChange={value => setXasBandStyle(prev => ({ ...prev, exportHeight: Math.max(420, value) }))} min={420} max={4000} step={20} />
                <NumInput label="PNG 倍率" value={xasBandStyle.exportScale} onChange={value => setXasBandStyle(prev => ({ ...prev, exportScale: clamp(value, 1, 8) }))} min={1} max={8} step={0.5} />
              </div>
            </div>
          </aside>
        </div>
      ) : activeModule === 'xrd' ? (
        <div className="mb-4 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <div className="analysis-section-card p-4">
              <p className="text-sm font-semibold text-[var(--text-main)]">XRD stacked log plot</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">A 欄為 2θ，後續欄位為 40/10、45/5、50/0 強度；會套用 baseline、log10、normalize 與垂直 offset。</p>
              <label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-4 py-5 text-center text-sm text-[var(--text-main)] hover:border-[var(--accent-secondary)]">
                匯入 XRD TXT/CSV
                <input type="file" multiple accept=".txt,.csv,.dat,.tsv,.xy" className="hidden" onChange={event => { void importXrdFile(event.target.files); event.target.value = '' }} />
              </label>
              {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
              {xrdTraces.length > 0 && (
                <div className="mt-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3 text-xs leading-5 text-[var(--text-main)]">
                  <p className="font-semibold">{new Set(xrdTraces.map(trace => trace.sourceFile)).size} files / {xrdTraces.length} traces</p>
                  <p className="text-[var(--text-soft)]">每條 trace 保留自己的 2theta 軸與點數。</p>
                  <button type="button" onClick={() => setXrdTraces([])} className="mt-2 text-rose-400">清除 XRD 檔案</button>
                </div>
              )}
            </div>

            {xrdTraces.length > 0 && (
              <div className="analysis-section-card p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">曲線設定</p>
                <div className="space-y-3">
                  {xrdTraces.map(trace => (
                    <div key={trace.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                      <label className="flex items-center justify-between gap-3 text-xs text-[var(--text-main)]">
                        <span className="font-semibold">{trace.shortLabel}</span>
                        <input type="checkbox" checked={trace.visible} onChange={event => updateXrdTrace(trace.id, { visible: event.target.checked })} className="accent-[var(--accent-secondary)]" />
                      </label>
                      <input value={trace.label} onChange={event => updateXrdTrace(trace.id, { label: event.target.value })} className="mt-2 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none" />
                      <p className="mt-1 text-[10px] leading-4 text-[var(--text-soft)]">{trace.sourceFile}<br />X: {trace.xColumn} / Y: {trace.yColumn} / {trace.x.length} pts</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <ColorInput label="線色" value={trace.color} onChange={value => updateXrdTrace(trace.id, { color: value })} />
                        <NumInput label="Offset" value={trace.offset} onChange={value => updateXrdTrace(trace.id, { offset: value })} step={0.01} />
                        <NumInput label="線寬" value={trace.linewidth} onChange={value => updateXrdTrace(trace.id, { linewidth: clamp(value, 0.05, 6) })} min={0.05} max={6} step={0.05} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>

          <section className="space-y-4">
            <div className="analysis-section-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-main)]">XRD stacked plot</p>
                  <p className="mt-1 text-xs text-[var(--text-soft)]">移植 OriginPro 腳本的 log offset 疊圖與參考峰標註。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!xrdFigure || exporting} onClick={() => { void exportXrdPlot('png') }} className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">PNG</button>
                  <button type="button" disabled={!xrdFigure || exporting} onClick={() => { void exportXrdPlot('svg') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">SVG</button>
                  <button type="button" disabled={!xrdFigure || exporting} onClick={() => { void exportXrdPlot('pdf') }} className="rounded-full border border-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-[var(--accent-secondary)] disabled:opacity-40">PDF</button>
                  <button type="button" disabled={!xrdFigure} onClick={() => xrdFigure && downloadTextFile(buildXrdProcessedCsv(xrdFigure.processedRows), 'xrd_log_offset.csv', 'text/csv;charset=utf-8')} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">CSV</button>
                </div>
              </div>
              {xrdFigure ? (
                <Plot data={xrdFigure.data} layout={xrdFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: 620 }} />
              ) : (
                <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] text-sm text-[var(--text-soft)]">請匯入 XRD 多欄資料以建立 stacked log plot</div>
              )}
            </div>
          </section>

          <aside className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
            <div className="analysis-section-card p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">圖面設定</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="X shift" value={xrdStyle.xShift} onChange={value => setXrdStyle(prev => ({ ...prev, xShift: value }))} step={0.01} />
                  <NumInput label="X min" value={xrdStyle.xMin} onChange={value => setXrdStyle(prev => ({ ...prev, xMin: value }))} step={1} />
                  <NumInput label="X max" value={xrdStyle.xMax} onChange={value => setXrdStyle(prev => ({ ...prev, xMax: value }))} step={1} />
                  <NumInput label="Y min" value={xrdStyle.yMin ?? 0} onChange={value => setXrdStyle(prev => ({ ...prev, yMin: value }))} step={0.05} />
                  <NumInput label="Y max" value={xrdStyle.yMax ?? 3} onChange={value => setXrdStyle(prev => ({ ...prev, yMax: value }))} step={0.05} />
                </div>
                <button type="button" onClick={() => setXrdStyle(prev => ({ ...prev, yMin: null, yMax: null }))} className="rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">Y range 自動</button>
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">圖題</span>
                  <input value={xrdStyle.figureTitle} onChange={event => setXrdStyle(prev => ({ ...prev, figureTitle: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput label="軸標題字" value={xrdStyle.axisLabelSize} onChange={value => setXrdStyle(prev => ({ ...prev, axisLabelSize: clamp(value, 4, 42) }))} min={4} max={42} />
                  <NumInput label="刻度字" value={xrdStyle.tickLabelSize} onChange={value => setXrdStyle(prev => ({ ...prev, tickLabelSize: clamp(value, 3, 32) }))} min={3} max={32} />
                  <NumInput label="圖例字" value={xrdStyle.curveLabelSize} onChange={value => setXrdStyle(prev => ({ ...prev, curveLabelSize: clamp(value, 3, 28) }))} min={3} max={28} />
                  <NumInput label="峰標籤字" value={xrdStyle.peakLabelSize} onChange={value => setXrdStyle(prev => ({ ...prev, peakLabelSize: clamp(value, 3, 28) }))} min={3} max={28} />
                </div>
                {[
                  ['normalizeEachCurve', '每條曲線各自 normalize'],
                  ['showReferencePeaks', '顯示參考峰'],
                  ['showLegend', '顯示圖例'],
                  ['showTitle', '顯示圖題'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs text-[var(--text-main)]">
                    <span>{label}</span>
                    <input type="checkbox" checked={Boolean(xrdStyle[key as keyof XrdFigureStyle])} onChange={event => setXrdStyle(prev => ({ ...prev, [key]: event.target.checked }))} className="accent-[var(--accent-secondary)]" />
                  </label>
                ))}
              </div>
            </div>

            <div className="analysis-section-card p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">參考峰</p>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {xrdReferencePeaks.map(peak => (
                  <div key={peak.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                    <label className="flex items-center justify-between gap-3 text-xs text-[var(--text-main)]">
                      <span><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: peak.lineColor }} />{peak.text} / {peak.x.toFixed(3)}</span>
                      <input type="checkbox" checked={peak.enabled} onChange={event => updateXrdReferencePeak(peak.id, { enabled: event.target.checked })} className="accent-[var(--accent-secondary)]" />
                    </label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <NumInput label="2θ" value={peak.x} onChange={value => updateXrdReferencePeak(peak.id, { x: value })} step={0.001} />
                      <ColorInput label="顏色" value={peak.lineColor} onChange={value => updateXrdReferencePeak(peak.id, { lineColor: value })} />
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setXrdReferencePeaks(DEFAULT_XRD_REFERENCE_PEAKS.map(peak => ({ ...peak })))} className="mt-3 rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">重設參考峰</button>
            </div>
          </aside>
        </div>
      ) : activeModule !== 'xps' ? (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6">
          <p className="text-sm font-semibold text-[var(--text-main)]">{activeModule.toUpperCase()} 繪圖介面已預留</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">之後會沿用同一套檔案匯入、圖型模板、字體/軸範圍/顏色控制與 PNG/SVG 匯出流程。</p>
          {onModuleSelect && (
            <button type="button" onClick={() => onModuleSelect(activeModule)} className="mt-4 rounded-full border border-[var(--accent-secondary)] px-4 py-2 text-sm font-semibold text-[var(--accent-secondary)]">
              回到 {activeModule.toUpperCase()} 分析模組
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-2">
            {[
              { id: 'fit' as const, label: 'XPS 峰擬合圖', detail: 'Component panels / ratio' },
              { id: 'vbm' as const, label: 'VBM 線性外推', detail: 'VB linear extrapolation' },
              { id: 'vb-dos' as const, label: 'VB-DOS 初步指認', detail: 'VB / Ga2O3 pDOS-DFT' },
            ].map(mode => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setXpsPlotMode(mode.id)}
                className={[
                  'min-w-[180px] flex-1 rounded-xl border px-4 py-3 text-left transition-colors pressable sm:flex-none',
                  xpsPlotMode === mode.id
                    ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-main)]'
                    : 'border-transparent bg-[var(--card-ghost)] text-[var(--text-main)] hover:border-[var(--accent-secondary)]',
                ].join(' ')}
              >
                <span className="block text-sm font-semibold">{mode.label}</span>
                <span className="mt-1 block text-[11px] text-[var(--text-soft)]">{mode.detail}</span>
              </button>
            ))}
          </div>

          {xpsPlotMode === 'fit' ? (
          <>
          <div className="mb-4 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_380px]">
            <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
              <div className="analysis-section-card p-4">
                <p className="text-sm font-semibold text-[var(--text-main)]">XPS 擬合結果檔</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">支援欄位：Binding_Energy_eV、Observed、Total_Fit，以及任意多個 component 欄位。</p>
                <label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-4 py-5 text-center text-sm text-[var(--text-main)] hover:border-[var(--accent-secondary)]">
                  上傳 fit spectra TXT/CSV
                  <input type="file" multiple accept=".txt,.csv,.dat,.tsv" className="hidden" onChange={event => { void importFiles(event.target.files); event.target.value = '' }} />
                </label>
                {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
                {files.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {files.map(file => (
                      <div key={file.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-2">
                        <input
                          value={file.sampleLabel}
                          onChange={event => updateXpsFitFile(file.id, { sampleLabel: event.target.value })}
                          className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs font-semibold text-[var(--input-text)] focus:outline-none"
                        />
                        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--text-soft)]">
                          <span className="truncate">{file.name}</span>
                          <button type="button" onClick={() => setFiles(current => current.filter(item => item.id !== file.id))} className="text-rose-400">移除</button>
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => setFiles([])} className="text-xs text-rose-400">清除全部</button>
                  </div>
                )}
              </div>

              <div className="analysis-section-card p-4">
                <p className="text-sm font-semibold text-[var(--text-main)]">XPS offset / 內插</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">調整各筆已擬合資料的 Binding Energy X 軸，並可內插到共同重疊區間。</p>
                {files.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {files.map(file => (
                      <div key={file.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                        <div className="mb-2 min-w-0">
                          <p className="truncate text-xs font-semibold text-[var(--text-main)]">{file.sampleLabel}</p>
                          <p className="truncate text-[10px] text-[var(--text-soft)]">{file.name}</p>
                        </div>
                        <NumInput label="X 軸位移(eV)" value={file.xOffsetEv} onChange={value => updateXpsFitFile(file.id, { xOffsetEv: value })} step={0.01} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs text-[var(--text-soft)]">尚未載入 XPS fit spectra。</p>
                )}
                <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs text-[var(--text-main)]">
                  <span>套用共同 grid 內插</span>
                  <input
                    type="checkbox"
                    checked={xpsOffsetSettings.interpolate}
                    onChange={event => setXpsOffsetSettings(prev => ({ ...prev, interpolate: event.target.checked }))}
                    className="accent-[var(--accent-secondary)]"
                  />
                </label>
                <div className="mt-3">
                  <NumInput
                    label="內插點數"
                    value={xpsOffsetSettings.nPoints}
                    onChange={value => setXpsOffsetSettings(prev => ({ ...prev, nPoints: Math.round(clamp(value, XPS_OFFSET_POINTS_MIN, XPS_OFFSET_POINTS_MAX)) }))}
                    min={XPS_OFFSET_POINTS_MIN}
                    max={XPS_OFFSET_POINTS_MAX}
                    step={50}
                  />
                </div>
                <p className={`mt-2 text-[10px] leading-4 ${xpsOffsetSettings.interpolate && !xpsOffsetGrid ? 'text-amber-400' : 'text-[var(--text-soft)]'}`}>
                  {xpsOffsetSettings.interpolate
                    ? xpsOffsetGrid
                      ? `共同 grid: ${xpsOffsetGrid.pointCount} 點 / ${xpsOffsetGrid.min.toFixed(3)} - ${xpsOffsetGrid.max.toFixed(3)} eV`
                      : '目前 offset 後沒有共同重疊區間，會只套用位移、不內插。'
                    : '目前只套用各筆 X offset，不改變原本取樣點。'}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" disabled={files.length === 0} onClick={() => setFiles(current => current.map(file => ({ ...file, xOffsetEv: 0 })))} className="rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">重設 offset</button>
                  <button type="button" disabled={xpsFigureFiles.length === 0} onClick={() => downloadTextFile(buildXpsOffsetCsv(xpsFigureFiles, keys), 'xps_fit_offset_interpolated.csv', 'text/csv;charset=utf-8')} className="rounded-lg bg-[var(--accent-secondary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">下載 CSV</button>
                </div>
              </div>

            </aside>

            <section className="space-y-4">
              <div className="analysis-section-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-main)]">XPS component panels</p>
                    <p className="mt-1 text-xs text-[var(--text-soft)]">多檔案會自動垂直排列，共用 X 軸顯示範圍。</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={!panelFigure || exporting} onClick={() => { void exportPlot('panels', 'png') }} className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">PNG</button>
                    <button type="button" disabled={!panelFigure || exporting} onClick={() => { void exportPlot('panels', 'svg') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">SVG</button>
                  </div>
                </div>
                {panelFigure ? (
                  <Plot data={panelFigure.data} layout={panelFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: Math.max(420, 320 * xpsFigureFiles.length) }} />
                ) : (
                  <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] text-sm text-[var(--text-soft)]">上傳 XPS fit spectra 後預覽圖會顯示在這裡。</div>
                )}
              </div>

              {files.length > 0 && (
                <div className="analysis-section-card p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--text-main)]">Area ratio / component ratio</p>
                    <div className="flex gap-2">
                      <button type="button" disabled={exporting} onClick={() => { void exportPlot('summary', 'png') }} className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">PNG</button>
                      <button type="button" disabled={exporting} onClick={() => { void exportPlot('summary', 'svg') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">SVG</button>
                    </div>
                  </div>
                  {summaryFigure && <Plot data={summaryFigure.data} layout={summaryFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: 420 }} />}
                </div>
              )}
            </section>

            <aside className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
              <div className="analysis-section-card p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">圖面設定</p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">Panel 標題</span>
                    <input value={style.titleLabel} onChange={event => setStyle(prev => ({ ...prev, titleLabel: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">字體</span>
                    <select value={style.fontFamily} onChange={event => setStyle(prev => ({ ...prev, fontFamily: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                      <option value="Times New Roman, Times, serif">Times / Serif</option>
                      <option value="Arial, Helvetica, sans-serif">Arial / Sans</option>
                      <option value="Georgia, serif">Georgia</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="X 左端(eV)" value={style.xLeft ?? (xpsFigureFiles.length ? Math.max(...xpsFigureFiles.flatMap(file => file.x)) : 536)} onChange={value => setStyle(prev => ({ ...prev, xLeft: value }))} step={0.1} />
                    <NumInput label="X 右端(eV)" value={style.xRight ?? (xpsFigureFiles.length ? Math.min(...xpsFigureFiles.flatMap(file => file.x)) : 526)} onChange={value => setStyle(prev => ({ ...prev, xRight: value }))} step={0.1} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="X 軸字體" value={style.xAxisFontSize} onChange={value => setStyle(prev => ({ ...prev, xAxisFontSize: value }))} min={8} max={42} step={1} />
                    <NumInput label="Y 軸字體" value={style.yAxisFontSize} onChange={value => setStyle(prev => ({ ...prev, yAxisFontSize: value }))} min={8} max={42} step={1} />
                  </div>
                  <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">位置調整模式</p>
                    <div className="grid grid-cols-2 gap-2">
                      <PositionTargetBox label="X軸標題" value={`距離 ${style.xAxisTitleStandoff.toFixed(1)}`} active={xpsPositionTarget === 'x-axis-title'} onClick={() => setXpsPositionTarget('x-axis-title')} />
                      <PositionTargetBox label="Y軸標題" value={`距離 ${style.yAxisTitleStandoff.toFixed(1)}`} active={xpsPositionTarget === 'y-axis-title'} onClick={() => setXpsPositionTarget('y-axis-title')} />
                      <PositionTargetBox label="Panel標題" value={`X ${style.panelTitleXPaper.toFixed(2)} / Y ${style.panelTitleYFraction.toFixed(2)}`} active={xpsPositionTarget === 'panel-title'} onClick={() => setXpsPositionTarget('panel-title')} />
                      <PositionTargetBox label="樣品標籤" value={`X ${style.sampleLabelXPaper.toFixed(2)} / Y ${style.sampleLabelYFraction.toFixed(2)}`} active={xpsPositionTarget === 'sample-label'} onClick={() => setXpsPositionTarget('sample-label')} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="刻度字體" value={style.fontSize} onChange={value => setStyle(prev => ({ ...prev, fontSize: value }))} min={8} max={34} step={1} />
                    <NumInput label="標籤字體" value={style.labelFontSize} onChange={value => setStyle(prev => ({ ...prev, labelFontSize: value }))} min={8} max={36} step={1} />
                  </div>
                  <NumInput label="框線粗細" value={style.axisLineWidth} onChange={value => setStyle(prev => ({ ...prev, axisLineWidth: clamp(value, 0.2, 8) }))} min={0.2} max={8} step={0.1} />
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="Y 軸上限" value={style.yMax} onChange={value => setStyle(prev => ({ ...prev, yMax: value }))} min={0.2} max={3} step={0.02} />
                    <NumInput label="填色透明度" value={style.fillOpacity} onChange={value => setStyle(prev => ({ ...prev, fillOpacity: clamp(value, 0, 1) }))} min={0} max={1} step={0.02} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ColorInput label="Raw" value={style.rawColor} onChange={value => setStyle(prev => ({ ...prev, rawColor: value }))} />
                    <ColorInput label="Fit" value={style.fitColor} onChange={value => setStyle(prev => ({ ...prev, fitColor: value }))} />
                    <ColorInput label="標線" value={style.fixedLineColor} onChange={value => setStyle(prev => ({ ...prev, fixedLineColor: value }))} />
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">Raw 顯示方式</span>
                    <select value={style.rawMode} onChange={event => setStyle(prev => ({ ...prev, rawMode: event.target.value as PlotFigureStyle['rawMode'] }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                      <option value="markers">圓圈</option>
                      <option value="lines">線</option>
                      <option value="lines+markers">線 + 圓圈</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <NumInput label="Raw 圓圈大小" value={style.rawMarkerSize} onChange={value => setStyle(prev => ({ ...prev, rawMarkerSize: clamp(value, 1, 16) }))} min={1} max={16} step={0.5} />
                    <NumInput label="Raw 圓圈線寬" value={style.rawMarkerLineWidth} onChange={value => setStyle(prev => ({ ...prev, rawMarkerLineWidth: clamp(value, 0, 5) }))} min={0} max={5} step={0.1} />
                    <ColorInput label="圓圈填色" value={style.rawMarkerFillColor} onChange={value => setStyle(prev => ({ ...prev, rawMarkerFillColor: value }))} />
                  </div>
                </div>
              </div>

              {keys.length > 0 && (
                <div className="analysis-section-card p-4">
                  <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">比例圖設定</p>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <label className="block">
                      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">Ratio 分子</span>
                      <select value={style.ratioNumerator} onChange={event => setStyle(prev => ({ ...prev, ratioNumerator: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                        {keys.map(key => <option key={key} value={key}>{componentStyles[key]?.label ?? key}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">Ratio 分母</span>
                      <select value={style.ratioDenominator} onChange={event => setStyle(prev => ({ ...prev, ratioDenominator: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                        {keys.map(key => <option key={key} value={key}>{componentStyles[key]?.label ?? key}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
              )}

              {keys.length > 0 && (
                <div className="analysis-section-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--text-main)]">Component 樣式</p>
                    <button type="button" onClick={applyRomanPreset} className="rounded-full border border-[var(--accent-secondary)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-secondary)]">
                      套用 OⅠ/OⅡ/OⅢ
                    </button>
                  </div>
                  <div className="space-y-3">
                    {keys.map((key, index) => {
                      const current = componentStyles[key] ?? createDefaultComponentStyle(key, index)
                      const update = (patch: Partial<ComponentStyle>) => setComponentStyles(prev => ({ ...prev, [key]: { ...(prev[key] ?? current), ...patch } }))
                      return (
                        <details key={key} open className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                          <summary className="cursor-pointer text-xs font-semibold text-[var(--text-main)]">
                            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: current.color }} />
                            {current.label || key}
                          </summary>
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate text-[10px] text-[var(--text-soft)]">{key}</span>
                              <label className="flex items-center gap-2 text-xs text-[var(--text-main)]">
                                <input type="checkbox" checked={current.show} onChange={event => update({ show: event.target.checked })} className="accent-[var(--accent-secondary)]" />
                                顯示
                              </label>
                            </div>
                            <label className="block">
                              <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">標籤文字</span>
                              <input value={current.label} onChange={event => update({ label: event.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none" />
                              <span className="mt-1 block text-[10px] leading-4 text-[var(--text-soft)]">
                                下標可輸入 O_{'{'}latt{'}'} 或 O_latt，也可直接輸入 O&lt;sub&gt;latt&lt;/sub&gt;。
                              </span>
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <ColorInput label="顏色" value={current.color} onChange={value => update({ color: value })} />
                              <NumInput label="標線(eV)" value={current.markerCenter ?? (xpsFigureFiles[0]?.x[Math.floor((xpsFigureFiles[0]?.x.length ?? 1) / 2)] ?? 0)} onChange={value => update({ markerCenter: value })} step={0.01} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <NumInput label="標籤 X" value={current.labelX} onChange={value => update({ labelX: clamp(value, 0, 1) })} min={0} max={1} step={0.01} />
                              <NumInput label="標籤 Y" value={current.labelY} onChange={value => update({ labelY: clamp(value, 0, 1) })} min={0} max={1} step={0.01} />
                            </div>
                          </div>
                        </details>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="analysis-section-card p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出尺寸</p>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <NumInput label="Panel 寬(px)" value={style.exportWidth} onChange={value => setStyle(prev => ({ ...prev, exportWidth: Math.max(420, value) }))} min={420} max={3000} step={20} />
                  <NumInput label="Panel 高(px)" value={style.exportHeight} onChange={value => setStyle(prev => ({ ...prev, exportHeight: Math.max(320, value) }))} min={320} max={4000} step={20} />
                  <NumInput label="PNG 倍率" value={style.exportScale} onChange={value => setStyle(prev => ({ ...prev, exportScale: clamp(value, 1, 6) }))} min={1} max={6} step={0.5} />
                </div>
              </div>
            </aside>
          </div>
          <div className="fixed bottom-5 right-5 z-[900] rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 shadow-[var(--card-shadow)]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[var(--text-main)]">360度搖桿</span>
              <span className="text-[10px] text-[var(--text-soft)]">
                {xpsPositionTarget === 'x-axis-title' ? 'X軸標題' : xpsPositionTarget === 'y-axis-title' ? 'Y軸標題' : xpsPositionTarget === 'panel-title' ? 'Panel標題' : '樣品標籤'}
              </span>
            </div>
            <div
              ref={xpsJoystickRef}
              onPointerDown={handleXpsJoystickPointer}
              onPointerMove={event => { if (event.buttons === 1) handleXpsJoystickPointer(event) }}
              className="relative h-28 w-28 touch-none rounded-full border border-[var(--accent-secondary)] bg-[var(--card-ghost)]"
              role="slider"
              aria-label="XPS position joystick"
            >
              <div className="absolute left-1/2 top-2 h-3 w-px -translate-x-1/2 rounded-full bg-[var(--text-soft)]" />
              <div className="absolute bottom-2 left-1/2 h-3 w-px -translate-x-1/2 rounded-full bg-[var(--text-soft)]" />
              <div className="absolute left-2 top-1/2 h-px w-3 -translate-y-1/2 rounded-full bg-[var(--text-soft)]" />
              <div className="absolute right-2 top-1/2 h-px w-3 -translate-y-1/2 rounded-full bg-[var(--text-soft)]" />
              <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--card-border)] bg-[var(--accent-soft)]" />
            </div>
          </div>
          </>
          ) : xpsPlotMode === 'vbm' ? (
          <div className="mb-4 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
            <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
              <div className="analysis-section-card p-4">
                <p className="text-sm font-semibold text-[var(--text-main)]">XPS VBM 數據檔</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">支援 CSV/TXT/TSV；至少兩欄數值。會自動尋找 Binding Energy 與 intensity 欄位，只做最大值歸一化，不做背景扣除。</p>
                <label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-4 py-5 text-center text-sm text-[var(--text-main)] hover:border-[var(--accent-secondary)]">
                  上傳 VBM CSV/TXT
                  <input type="file" multiple accept=".csv,.txt,.dat,.tsv" className="hidden" onChange={event => { void importVbmFiles(event.target.files); event.target.value = '' }} />
                </label>
                {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
                {vbmResults.errors.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {vbmResults.errors.map(item => <p key={item} className="text-xs text-amber-400">{item}</p>)}
                  </div>
                )}
                {vbmFiles.length > 0 && (
                  <div className="mt-3 space-y-3">
                    {vbmFiles.map(file => {
                      const update = (patch: Partial<VbmSpectrumFile>) => setVbmFiles(current => current.map(item => item.id === file.id ? { ...item, ...patch } : item))
                      const result = vbmResults.results.find(item => item.file.id === file.id)
                      return (
                        <div key={file.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                          <input
                            value={file.sampleLabel}
                            onChange={event => update({ sampleLabel: event.target.value })}
                            className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs font-semibold text-[var(--input-text)] focus:outline-none"
                          />
                          <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--text-soft)]">
                            <span className="truncate">{file.name}</span>
                            <button type="button" onClick={() => setVbmFiles(current => current.filter(item => item.id !== file.id))} className="text-rose-400">移除</button>
                          </div>
                          <p className="mt-2 text-[10px] leading-4 text-[var(--text-soft)]">X: {file.xColumn} / Y: {file.yColumn}</p>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <NumInput label="Baseline 起" value={file.baselineStart} onChange={value => update({ baselineStart: value })} step={0.05} />
                            <NumInput label="Baseline 迄" value={file.baselineEnd} onChange={value => update({ baselineEnd: value })} step={0.05} />
                            <NumInput label="Tangent 起" value={file.tangentStart} onChange={value => update({ tangentStart: value })} step={0.05} />
                            <NumInput label="Tangent 迄" value={file.tangentEnd} onChange={value => update({ tangentEnd: value })} step={0.05} />
                          </div>
                          {result && <p className="mt-2 text-xs font-semibold text-[var(--accent-secondary)]">VBM = {result.vbm.toFixed(3)} eV</p>}
                        </div>
                      )
                    })}
                    <button type="button" onClick={() => setVbmFiles([])} className="text-xs text-rose-400">清除全部</button>
                  </div>
                )}
              </div>
            </aside>

            <section className="space-y-4">
              <div className="analysis-section-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-main)]">VBM stacked 線性外推圖</p>
                    <p className="mt-1 text-xs text-[var(--text-soft)]">每個樣品各自套用 XPS 分析區同款 VBM 選點法；切線取最大正斜率，基準線取最平斜率。</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={!vbmStackedFigure || exporting} onClick={() => { void exportPlot('vbm-stacked', 'png') }} className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">PNG</button>
                    <button type="button" disabled={!vbmStackedFigure || exporting} onClick={() => { void exportPlot('vbm-stacked', 'svg') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">SVG</button>
                  </div>
                </div>
                {vbmStackedFigure ? (
                  <Plot data={vbmStackedFigure.data} layout={vbmStackedFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: Math.max(420, 280 * vbmResults.results.length) }} />
                ) : (
                  <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] text-sm text-[var(--text-soft)]">上傳 VBM CSV/TXT 後預覽圖會顯示在這裡。</div>
                )}
              </div>

              {vbmResults.results.map(result => {
                const singleFigure = buildVbmSingleFigure(result, vbmStyle)
                return (
                  <div key={result.file.id} className="analysis-section-card p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text-main)]">{result.file.sampleLabel} 單張 VBM 圖</p>
                      <div className="flex gap-2">
                        <button type="button" disabled={exporting} onClick={() => { void exportPlot(`vbm-single:${result.file.id}`, 'png') }} className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">PNG</button>
                        <button type="button" disabled={exporting} onClick={() => { void exportPlot(`vbm-single:${result.file.id}`, 'svg') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">SVG</button>
                      </div>
                    </div>
                    <Plot data={singleFigure.data} layout={singleFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: 420 }} />
                  </div>
                )
              })}

              {vbmSummaryFigure && (
                <div className="analysis-section-card p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--text-main)]">VBM summary</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={exporting} onClick={() => { void exportPlot('vbm-summary', 'png') }} className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">PNG</button>
                      <button type="button" disabled={exporting} onClick={() => { void exportPlot('vbm-summary', 'svg') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">SVG</button>
                      <button type="button" onClick={exportVbmSummaryCsv} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)]">CSV</button>
                      <button type="button" onClick={exportVbmSummaryTxt} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)]">TXT</button>
                    </div>
                  </div>
                  <Plot data={vbmSummaryFigure.data} layout={vbmSummaryFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: 420 }} />
                </div>
              )}
            </section>

            <aside className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
              <div className="analysis-section-card p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">VBM 圖面設定</p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">Panel 標題</span>
                    <input value={vbmStyle.titleLabel} onChange={event => setVbmStyle(prev => ({ ...prev, titleLabel: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">字體</span>
                    <select value={vbmStyle.fontFamily} onChange={event => setVbmStyle(prev => ({ ...prev, fontFamily: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                      <option value="Times New Roman, Times, serif">Times / Serif</option>
                      <option value="Arial, Helvetica, sans-serif">Arial / Sans</option>
                      <option value="Georgia, serif">Georgia</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="X 左端(eV)" value={vbmStyle.xLeft} onChange={value => setVbmStyle(prev => ({ ...prev, xLeft: value }))} step={0.1} />
                    <NumInput label="X 右端(eV)" value={vbmStyle.xRight} onChange={value => setVbmStyle(prev => ({ ...prev, xRight: value }))} step={0.1} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="X 軸字體" value={vbmStyle.xAxisFontSize} onChange={value => setVbmStyle(prev => ({ ...prev, xAxisFontSize: value }))} min={8} max={42} step={1} />
                    <NumInput label="Y 軸字體" value={vbmStyle.yAxisFontSize} onChange={value => setVbmStyle(prev => ({ ...prev, yAxisFontSize: value }))} min={8} max={42} step={1} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="X 標題距離" value={vbmStyle.xAxisTitleStandoff} onChange={value => setVbmStyle(prev => ({ ...prev, xAxisTitleStandoff: clamp(value, 0, 120) }))} min={0} max={120} step={1} />
                    <NumInput label="Y 標題距離" value={vbmStyle.yAxisTitleStandoff} onChange={value => setVbmStyle(prev => ({ ...prev, yAxisTitleStandoff: clamp(value, 0, 120) }))} min={0} max={120} step={1} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="刻度字體" value={vbmStyle.fontSize} onChange={value => setVbmStyle(prev => ({ ...prev, fontSize: value }))} min={8} max={34} step={1} />
                    <NumInput label="標註字體" value={vbmStyle.annotationFontSize} onChange={value => setVbmStyle(prev => ({ ...prev, annotationFontSize: value }))} min={8} max={36} step={1} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="標籤 X 偏移" value={vbmStyle.labelOffsetX} onChange={value => setVbmStyle(prev => ({ ...prev, labelOffsetX: clamp(value, -240, 240) }))} min={-240} max={240} step={2} />
                    <NumInput label="標籤 Y 偏移" value={vbmStyle.labelOffsetY} onChange={value => setVbmStyle(prev => ({ ...prev, labelOffsetY: clamp(value, -240, 240) }))} min={-240} max={240} step={2} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="Y 軸上限" value={vbmStyle.yMax} onChange={value => setVbmStyle(prev => ({ ...prev, yMax: Math.max(0.2, value) }))} min={0.2} max={3} step={0.02} />
                    <NumInput label="區間透明度" value={vbmStyle.regionOpacity} onChange={value => setVbmStyle(prev => ({ ...prev, regionOpacity: clamp(value, 0, 0.6) }))} min={0} max={0.6} step={0.02} />
                  </div>
                  <NumInput label="框線粗細" value={vbmStyle.axisLineWidth} onChange={value => setVbmStyle(prev => ({ ...prev, axisLineWidth: clamp(value, 0.2, 8) }))} min={0.2} max={8} step={0.1} />
                  <div className="grid grid-cols-3 gap-2">
                    <ColorInput label="光譜" value={vbmStyle.spectrumColor} onChange={value => setVbmStyle(prev => ({ ...prev, spectrumColor: value }))} />
                    <ColorInput label="Baseline" value={vbmStyle.baselineColor} onChange={value => setVbmStyle(prev => ({ ...prev, baselineColor: value }))} />
                    <ColorInput label="Tangent" value={vbmStyle.tangentColor} onChange={value => setVbmStyle(prev => ({ ...prev, tangentColor: value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <ColorInput label="VBM" value={vbmStyle.vbmColor} onChange={value => setVbmStyle(prev => ({ ...prev, vbmColor: value }))} />
                    <ColorInput label="圓圈線" value={vbmStyle.spectrumEdgeColor} onChange={value => setVbmStyle(prev => ({ ...prev, spectrumEdgeColor: value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="光譜線寬" value={vbmStyle.spectrumLineWidth} onChange={value => setVbmStyle(prev => ({ ...prev, spectrumLineWidth: clamp(value, 0.2, 8) }))} min={0.2} max={8} step={0.1} />
                    <NumInput label="擬合線寬" value={vbmStyle.fitLineWidth} onChange={value => setVbmStyle(prev => ({ ...prev, fitLineWidth: clamp(value, 0.2, 8) }))} min={0.2} max={8} step={0.1} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="圓圈大小" value={vbmStyle.markerSize} onChange={value => setVbmStyle(prev => ({ ...prev, markerSize: clamp(value, 1, 16) }))} min={1} max={16} step={0.5} />
                    <NumInput label="圓圈線寬" value={vbmStyle.markerLineWidth} onChange={value => setVbmStyle(prev => ({ ...prev, markerLineWidth: clamp(value, 0, 5) }))} min={0} max={5} step={0.1} />
                  </div>
                </div>
              </div>

              <div className="analysis-section-card p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出尺寸</p>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <NumInput label="圖寬(px)" value={vbmStyle.exportWidth} onChange={value => setVbmStyle(prev => ({ ...prev, exportWidth: Math.max(420, value) }))} min={420} max={3000} step={20} />
                  <NumInput label="圖高(px)" value={vbmStyle.exportHeight} onChange={value => setVbmStyle(prev => ({ ...prev, exportHeight: Math.max(320, value) }))} min={320} max={4000} step={20} />
                  <NumInput label="PNG 倍率" value={vbmStyle.exportScale} onChange={value => setVbmStyle(prev => ({ ...prev, exportScale: clamp(value, 1, 6) }))} min={1} max={6} step={0.5} />
                </div>
              </div>
            </aside>
          </div>
          ) : (
          <div className="mb-4 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
            <aside className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
              <div className="analysis-section-card p-4">
                <p className="text-sm font-semibold text-[var(--text-main)]">XPS VB 光譜檔</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">支援 CSV/TXT/TSV；會讀取每個檔案前兩個數值欄位，第一欄作 Binding Energy，第二欄作 intensity。</p>
                <label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] px-4 py-5 text-center text-sm text-[var(--text-main)] hover:border-[var(--accent-secondary)]">
                  上傳 VB CSV/TXT
                  <input type="file" multiple accept=".csv,.txt,.dat,.tsv" className="hidden" onChange={event => { void importVbDosFiles(event.target.files); event.target.value = '' }} />
                </label>
                {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
                {vbDosFiles.length > 0 && (
                  <div className="mt-3 space-y-3">
                    {vbDosFiles.map((file, fileIndex) => (
                      <div key={file.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                        <input
                          value={file.sampleLabel}
                          onChange={event => updateVbDosFile(file.id, { sampleLabel: event.target.value })}
                          className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs font-semibold text-[var(--input-text)] focus:outline-none"
                        />
                        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--text-soft)]">
                          <span className="truncate">{file.name}</span>
                          <button type="button" onClick={() => setVbDosFiles(current => current.filter(item => item.id !== file.id))} className="text-rose-400">移除</button>
                        </div>
                        <p className="mt-2 text-[10px] leading-4 text-[var(--text-soft)]">X: {file.xColumn} / Y: {file.yColumn}</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <NumInput label="VBM (eV)" value={file.vbm} onChange={value => updateVbDosFile(file.id, { vbm: value })} step={0.01} />
                          <ColorInput label="線色" value={file.color || xpsSampleColor(file.sampleLabel, fileIndex)} onChange={value => updateVbDosFile(file.id, { color: value })} />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <NumInput label="名稱 X(0-1)" value={file.sampleLabelXFraction} onChange={value => updateVbDosFile(file.id, { sampleLabelXFraction: clamp(value, 0, 1) })} min={0} max={1} step={0.01} />
                          <NumInput label="名稱 Y offset" value={file.sampleLabelYOffset} onChange={value => updateVbDosFile(file.id, { sampleLabelYOffset: clamp(value, -0.5, 2.5) })} min={-0.5} max={2.5} step={0.02} />
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => setVbDosFiles([])} className="text-xs text-rose-400">清除全部</button>
                  </div>
                )}
              </div>

              {vbDosFiles.length > 0 && (
                <div className="analysis-section-card p-4">
                  <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">Peak / shoulder 標註</p>
                  <div className="space-y-3">
                    {vbDosFiles.map(file => (
                      <details key={file.id} open className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                        <summary className="cursor-pointer text-xs font-semibold text-[var(--text-main)]">{file.sampleLabel} ({file.peaks.length})</summary>
                        <div className="mt-3 space-y-3">
                          {file.peaks.map(peak => (
                            <div key={peak.id} className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-2">
                              <label className="flex items-center justify-between gap-3 text-xs text-[var(--text-main)]">
                                <span>{peak.relEnergy.toFixed(2)} eV / BE {peak.be.toFixed(2)} eV</span>
                                <input type="checkbox" checked={peak.visible} onChange={event => updateVbDosPeak(file.id, peak.id, { visible: event.target.checked })} className="accent-[var(--accent-secondary)]" />
                              </label>
                              <input
                                value={peak.label.replace(/<br>/g, '\n')}
                                onChange={event => updateVbDosPeak(file.id, peak.id, { label: event.target.value.replace(/\n/g, '<br>') })}
                                className="mt-2 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none"
                              />
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <NumInput label="標籤 X" value={peak.labelXShift} onChange={value => updateVbDosPeak(file.id, peak.id, { labelXShift: clamp(value, -180, 180) })} min={-180} max={180} step={2} />
                                <NumInput label="標籤 Y" value={peak.labelYShift} onChange={value => updateVbDosPeak(file.id, peak.id, { labelYShift: clamp(value, -180, 180) })} min={-180} max={180} step={2} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              )}
            </aside>

            <section className="space-y-4">
              <div className="analysis-section-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-main)]">VB-DOS 初步峰來源指認圖</p>
                    <p className="mt-1 text-xs text-[var(--text-soft)]">Intensity 先扣最小值再歸一化；ΔE = Binding Energy - VBM，並加入 Ga2O3 pDOS/DFT 定性指認區域。</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!vbDosFigure || exporting} onClick={() => { void exportVbDosPlot('png') }} className="rounded-full bg-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">PNG</button>
                    <button type="button" disabled={!vbDosFigure || exporting} onClick={() => { void exportVbDosPlot('pdf') }} className="rounded-full border border-[var(--accent-secondary)] px-4 py-2 text-xs font-semibold text-[var(--accent-secondary)] disabled:opacity-40">PDF</button>
                    <button type="button" disabled={!vbDosFigure || exporting} onClick={() => { void exportVbDosPlot('svg') }} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">SVG</button>
                    <button type="button" disabled={vbDosFiles.length === 0} onClick={exportVbDosPeaksCsv} className="rounded-full border border-[var(--card-border)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] disabled:opacity-40">峰表 CSV</button>
                  </div>
                </div>
                {vbDosFigure ? (
                  <Plot data={vbDosFigure.data} layout={vbDosFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: Math.max(520, 210 * vbDosFiles.length + 220) }} />
                ) : (
                  <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] text-sm text-[var(--text-soft)]">上傳 VB CSV/TXT 後預覽圖會顯示在這裡。</div>
                )}
              </div>

              <div className="analysis-section-card p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">pDOS/DFT 初步指認區域</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {vbDosRegions.map(region => (
                    <div key={region.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3 text-xs leading-5 text-[var(--text-main)]">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: region.color }} />
                      <span className="font-semibold">{region.start.toFixed(1)}-{region.end.toFixed(1)} eV below VBM</span>
                      <p className="mt-1 text-[var(--text-soft)]">{region.label}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--text-soft)]">{VB_DOS_ASSIGNMENT_NOTE}</p>
              </div>
            </section>

            <aside className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
              <div className="analysis-section-card p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">VB-DOS 圖面設定</p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">圖標題</span>
                    <input value={vbDosStyle.titleLabel} onChange={event => setVbDosStyle(prev => ({ ...prev, titleLabel: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">字體</span>
                    <select value={vbDosStyle.fontFamily} onChange={event => setVbDosStyle(prev => ({ ...prev, fontFamily: event.target.value }))} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none">
                      <option value="Times New Roman, Times, serif">Times New Roman</option>
                      <option value="DejaVu Sans, Arial, sans-serif">DejaVu Sans</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="X 左端(eV)" value={vbDosStyle.xLeft} onChange={value => setVbDosStyle(prev => ({ ...prev, xLeft: value }))} step={0.1} />
                    <NumInput label="X 右端(eV)" value={vbDosStyle.xRight} onChange={value => setVbDosStyle(prev => ({ ...prev, xRight: value }))} step={0.1} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="垂直 offset" value={vbDosStyle.verticalOffset} onChange={value => setVbDosStyle(prev => ({ ...prev, verticalOffset: Math.max(0, value) }))} min={0} max={3} step={0.02} />
                    <NumInput label="Y 上方留白" value={vbDosStyle.yMaxPadding} onChange={value => setVbDosStyle(prev => ({ ...prev, yMaxPadding: Math.max(0.1, value) }))} min={0.1} max={2} step={0.02} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="刻度字體" value={vbDosStyle.fontSize} onChange={value => setVbDosStyle(prev => ({ ...prev, fontSize: value }))} min={8} max={34} step={1} />
                    <NumInput label="軸標題字體" value={vbDosStyle.axisTitleFontSize} onChange={value => setVbDosStyle(prev => ({ ...prev, axisTitleFontSize: value }))} min={10} max={42} step={1} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="峰標註字體" value={vbDosStyle.annotationFontSize} onChange={value => setVbDosStyle(prev => ({ ...prev, annotationFontSize: value }))} min={8} max={30} step={1} />
                    <NumInput label="區域標籤字體" value={vbDosStyle.regionFontSize} onChange={value => setVbDosStyle(prev => ({ ...prev, regionFontSize: value }))} min={8} max={24} step={1} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="線寬" value={vbDosStyle.lineWidth} onChange={value => setVbDosStyle(prev => ({ ...prev, lineWidth: clamp(value, 0.2, 6) }))} min={0.2} max={6} step={0.05} />
                    <NumInput label="Peak marker" value={vbDosStyle.markerSize} onChange={value => setVbDosStyle(prev => ({ ...prev, markerSize: clamp(value, 1, 16) }))} min={1} max={16} step={0.5} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="框線粗細" value={vbDosStyle.axisLineWidth} onChange={value => setVbDosStyle(prev => ({ ...prev, axisLineWidth: clamp(value, 0.2, 8) }))} min={0.2} max={8} step={0.1} />
                    <NumInput label="區域透明度" value={vbDosStyle.regionOpacity} onChange={value => setVbDosStyle(prev => ({ ...prev, regionOpacity: clamp(value, 0, 0.65) }))} min={0} max={0.65} step={0.02} />
                  </div>
                  {[
                    ['showRegionLabels', '顯示 pDOS 區域標籤'],
                    ['showPeakMarkers', '顯示 peak / shoulder 標註'],
                    ['showLegend', '顯示圖例'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-ghost)] px-3 py-2 text-xs text-[var(--text-main)]">
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(vbDosStyle[key as keyof VbDosFigureStyle])}
                        onChange={event => setVbDosStyle(prev => ({ ...prev, [key]: event.target.checked }))}
                        className="accent-[var(--accent-secondary)]"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="analysis-section-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text-main)]">區域名稱 / 顏色 / 位置</p>
                  <button type="button" onClick={resetVbDosRegions} className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">重設</button>
                </div>
                <div className="space-y-3">
                  {vbDosRegions.map(region => (
                    <details key={region.id} open className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-ghost)] p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-[var(--text-main)]">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: region.color }} />
                        {region.start.toFixed(1)}-{region.end.toFixed(1)} eV
                      </summary>
                      <div className="mt-3 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput label="區域起點" value={region.start} onChange={value => updateVbDosRegion(region.id, { start: value })} step={0.1} />
                          <NumInput label="區域終點" value={region.end} onChange={value => updateVbDosRegion(region.id, { end: value })} step={0.1} />
                        </div>
                        <ColorInput label="區域顏色" value={region.color} onChange={value => updateVbDosRegion(region.id, { color: value })} />
                        <label className="block">
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">圖上區域名稱</span>
                          <input value={region.shortLabel} onChange={event => updateVbDosRegion(region.id, { shortLabel: event.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none" />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">完整區域名稱 / CSV 指認</span>
                          <input value={region.label} onChange={event => updateVbDosRegion(region.id, { label: event.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none" />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">斜體詞語</span>
                          <input value={region.italicWords} onChange={event => updateVbDosRegion(region.id, { italicWords: event.target.value })} placeholder="以逗號分隔，如 O 2p, Ga 4p" className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none" />
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <NumInput label="名稱 X 位移(eV)" value={region.labelXShift} onChange={value => updateVbDosRegion(region.id, { labelXShift: clamp(value, -5, 5) })} min={-5} max={5} step={0.05} />
                          <NumInput label="名稱 Y(paper)" value={region.labelYPaper} onChange={value => updateVbDosRegion(region.id, { labelYPaper: clamp(value, 0.75, 1.3) })} min={0.75} max={1.3} step={0.005} />
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </div>

              <div className="analysis-section-card p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">600 dpi 匯出尺寸</p>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <NumInput label="圖寬(px)" value={vbDosStyle.exportWidth} onChange={value => setVbDosStyle(prev => ({ ...prev, exportWidth: Math.max(900, value) }))} min={900} max={9000} step={100} />
                  <NumInput label="圖高(px)" value={vbDosStyle.exportHeight} onChange={value => setVbDosStyle(prev => ({ ...prev, exportHeight: Math.max(700, value) }))} min={700} max={9000} step={100} />
                  <NumInput label="倍率" value={vbDosStyle.exportScale} onChange={value => setVbDosStyle(prev => ({ ...prev, exportScale: clamp(value, 1, 3) }))} min={1} max={3} step={0.25} />
                  <NumInput label="PDF DPI" value={vbDosStyle.exportDpi} onChange={value => setVbDosStyle(prev => ({ ...prev, exportDpi: Math.max(72, Math.round(value)) }))} min={72} max={1200} step={24} />
                </div>
              </div>
            </aside>
          </div>
          )}
        </>
      )}
      {ramanFullscreenOpen && ramanFigure && (
        <div className="fixed inset-0 z-[1000] flex flex-col bg-[color:color-mix(in_srgb,var(--bg-canvas)_96%,black)] p-3 sm:p-5" role="dialog" aria-modal="true">
          <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 shadow-[var(--card-shadow)]">
            <div>
              <div className="text-sm font-semibold text-[var(--text-main)]">
                {ramanPlotMode === 'overlay' ? 'Raman 多樣品疊圖' : 'Raman publication plot'}
              </div>
              <div className="mt-1 text-xs text-[var(--text-soft)]">
                {ramanPlotMode === 'overlay' ? `${ramanFiles.length} samples` : activeRamanFile?.sampleLabel}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRamanFullscreenOpen(false)}
              className="rounded-full border border-[var(--card-border)] px-4 py-2 text-sm font-semibold text-[var(--text-main)]"
            >
              關閉
            </button>
          </div>
          <div className="min-h-0 flex-1 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-2 shadow-[var(--card-shadow)]">
            <Plot
              data={ramanFigure.data}
              layout={ramanFigure.layout as Plotly.Layout}
              config={withPlotFullscreen({ scrollZoom: true })}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
            />
          </div>
        </div>
      )}
    </div>
  )
}
