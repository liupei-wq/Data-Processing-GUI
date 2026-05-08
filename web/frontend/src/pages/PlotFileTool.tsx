import { useMemo, useState } from 'react'
import Plot, { PlotlyApi } from '../components/PlotlyChart'
import type { AnalysisModuleId } from '../components/AnalysisModuleNav'
import { ModuleTopBar } from '../components/WorkspaceUi'
import { withPlotFullscreen } from '../components/plotConfig'

type PlotModule = 'xps' | 'raman' | 'xrd' | 'xas' | 'xes'

interface FitSpectrumFile {
  id: string
  name: string
  sampleLabel: string
  x: number[]
  observed: number[]
  totalFit: number[]
  components: Record<string, number[]>
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

type PlotlyExportApi = {
  newPlot: (root: HTMLDivElement, data: Plotly.Data[], layout: Partial<Plotly.Layout>, config?: Partial<Plotly.Config>) => Promise<unknown>
  toImage: (root: HTMLDivElement, opts: { format: string; width: number; height: number; scale?: number }) => Promise<string>
  purge: (root: HTMLDivElement) => void
}

const MODULES: { id: PlotModule; label: string; detail: string; enabled: boolean }[] = [
  { id: 'xps', label: 'XPS', detail: 'fit spectra / VBM', enabled: true },
  { id: 'raman', label: 'Raman', detail: '預留：峰型與多譜比較', enabled: false },
  { id: 'xrd', label: 'XRD', detail: '預留：繞射峰與 stacked patterns', enabled: false },
  { id: 'xas', label: 'XAS', detail: '預留：TEY / TFY 與 edge 圖', enabled: false },
  { id: 'xes', label: 'XES', detail: '預留：發射光譜比較', enabled: false },
]

const DEFAULT_COMPONENT_COLORS = ['#9b59b6', '#18a81f', '#1f78b4', '#f97316', '#a855f7', '#14b8a6', '#e11d48', '#64748b']
const ROMAN_COMPONENT_LABELS = ['O<sub>Ⅰ</sub>', 'O<sub>Ⅱ</sub>', 'O<sub>Ⅲ</sub>', 'O<sub>Ⅳ</sub>', 'O<sub>Ⅴ</sub>']
const ROMAN_COMPONENT_COLORS = ['#9b59b6', '#18a81f', '#1f78b4', '#f97316', '#a855f7']
const ROMAN_COMPONENT_POSITIONS = [
  { labelX: 0.72, labelY: 0.78 },
  { labelX: 0.42, labelY: 0.70 },
  { labelX: 0.28, labelY: 0.42 },
  { labelX: 0.82, labelY: 0.58 },
  { labelX: 0.18, labelY: 0.55 },
]

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
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
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
    x,
    observed,
    totalFit,
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
      x: 0.03,
      y: yDomainEnd - panelHeight * 0.16,
      xref: 'paper',
      yref: 'paper',
      text: `<b>${style.titleLabel || 'XPS'}</b>`,
      showarrow: false,
      xanchor: 'left',
      yanchor: 'middle',
      font: { color: '#111827', size: style.panelTitleFontSize, family: style.fontFamily },
    })
    annotations.push({
      x: 0.97,
      y: yDomainEnd - panelHeight * 0.26,
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
      x: panelXDomain[0] + 0.022,
      y: yDomainEnd - panelHeight * 0.16,
      xref: 'paper',
      yref: 'paper',
      text: `<b>${style.titleLabel || 'XPS'}</b>`,
      showarrow: false,
      xanchor: 'left',
      yanchor: 'middle',
      font: { color: '#111827', size: style.panelTitleFontSize, family: style.fontFamily },
    })
    annotations.push({
      x: panelXDomain[1] - 0.012,
      y: yDomainEnd - panelHeight * 0.12,
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

export default function PlotFileTool({
  onModuleSelect,
}: {
  onModuleSelect?: (module: AnalysisModuleId) => void
}) {
  const [activeModule, setActiveModule] = useState<PlotModule>('xps')
  const [xpsPlotMode, setXpsPlotMode] = useState<'fit' | 'vbm'>('fit')
  const [files, setFiles] = useState<FitSpectrumFile[]>([])
  const [style, setStyle] = useState<PlotFigureStyle>(DEFAULT_STYLE)
  const [componentStyles, setComponentStyles] = useState<Record<string, ComponentStyle>>({})
  const [vbmFiles, setVbmFiles] = useState<VbmSpectrumFile[]>([])
  const [vbmStyle, setVbmStyle] = useState<VbmFigureStyle>(DEFAULT_VBM_STYLE)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const keys = useMemo(() => componentKeys(files), [files])
  const panelFigure = useMemo(() => files.length > 0 ? buildXpsPanelFigure(files, style, componentStyles) : null, [files, style, componentStyles])
  const summaryFigure = useMemo(() => files.length > 0 ? buildXpsSummaryFigure(files, style, componentStyles) : null, [files, style, componentStyles])
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

  const exportPlot = async (kind: 'panels' | 'summary' | 'vbm-stacked' | 'vbm-summary' | `vbm-single:${string}`, format: 'png' | 'svg') => {
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
            : singleVbmResult
              ? buildVbmSingleFigure(singleVbmResult, vbmStyle)
              : null
    if (!figure) return
    setExporting(true)
    setError(null)
    const container = document.createElement('div')
    const width = kind.startsWith('vbm')
      ? vbmStyle.exportWidth
      : kind === 'panels'
        ? style.exportWidth
        : Math.max(style.exportWidth, 1200)
    const height = kind.startsWith('vbm')
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
      const dataUrl = await plotly.toImage(container, { format, width, height, scale: format === 'png' ? (kind.startsWith('vbm') ? vbmStyle.exportScale : style.exportScale) : 1 })
      const exportName = kind.startsWith('vbm-single:')
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

  return (
    <div className="flex min-h-screen flex-col overflow-y-auto bg-[var(--bg-canvas)] p-4 sm:p-5">
      <ModuleTopBar
        title="繪製圖檔"
        subtitle="Publication Figure Builder"
        description="集中管理 Raman、XRD、XPS、XAS、XES 的投稿圖輸出；目前啟用 XPS 峰擬合圖與獨立 VBM 線性外推圖。"
        chips={[
          { label: `目前 ${activeModule.toUpperCase()}` },
          { label: xpsPlotMode === 'vbm' ? 'VBM 線性外推' : '峰擬合圖' },
          { label: `檔案 ${xpsPlotMode === 'vbm' ? vbmFiles.length : files.length}` },
          { label: xpsPlotMode === 'vbm' ? `VBM ${vbmResults.results.length}` : `Components ${keys.length}` },
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

      {activeModule !== 'xps' ? (
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
          <div className="mb-4 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_380px]">
            <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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
                          onChange={event => setFiles(current => current.map(item => item.id === file.id ? { ...item, sampleLabel: event.target.value } : item))}
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

            </aside>

            <section className="space-y-4">
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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
                  <Plot data={panelFigure.data} layout={panelFigure.layout as Plotly.Layout} config={withPlotFullscreen()} style={{ width: '100%', height: Math.max(420, 320 * files.length) }} />
                ) : (
                  <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-ghost)] text-sm text-[var(--text-soft)]">上傳 XPS fit spectra 後預覽圖會顯示在這裡。</div>
                )}
              </div>

              {files.length > 0 && (
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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
                    <NumInput label="X 左端(eV)" value={style.xLeft ?? (files.length ? Math.max(...files.flatMap(file => file.x)) : 536)} onChange={value => setStyle(prev => ({ ...prev, xLeft: value }))} step={0.1} />
                    <NumInput label="X 右端(eV)" value={style.xRight ?? (files.length ? Math.min(...files.flatMap(file => file.x)) : 526)} onChange={value => setStyle(prev => ({ ...prev, xRight: value }))} step={0.1} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="X 軸字體" value={style.xAxisFontSize} onChange={value => setStyle(prev => ({ ...prev, xAxisFontSize: value }))} min={8} max={42} step={1} />
                    <NumInput label="Y 軸字體" value={style.yAxisFontSize} onChange={value => setStyle(prev => ({ ...prev, yAxisFontSize: value }))} min={8} max={42} step={1} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="X 標題距離" value={style.xAxisTitleStandoff} onChange={value => setStyle(prev => ({ ...prev, xAxisTitleStandoff: clamp(value, 0, 120) }))} min={0} max={120} step={1} />
                    <NumInput label="Y 標題距離" value={style.yAxisTitleStandoff} onChange={value => setStyle(prev => ({ ...prev, yAxisTitleStandoff: clamp(value, 0, 120) }))} min={0} max={120} step={1} />
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
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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
                              <NumInput label="標線(eV)" value={current.markerCenter ?? (files[0]?.x[Math.floor((files[0]?.x.length ?? 1) / 2)] ?? 0)} onChange={value => update({ markerCenter: value })} step={0.01} />
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

              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出尺寸</p>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <NumInput label="Panel 寬(px)" value={style.exportWidth} onChange={value => setStyle(prev => ({ ...prev, exportWidth: Math.max(420, value) }))} min={420} max={3000} step={20} />
                  <NumInput label="Panel 高(px)" value={style.exportHeight} onChange={value => setStyle(prev => ({ ...prev, exportHeight: Math.max(320, value) }))} min={320} max={4000} step={20} />
                  <NumInput label="PNG 倍率" value={style.exportScale} onChange={value => setStyle(prev => ({ ...prev, exportScale: clamp(value, 1, 6) }))} min={1} max={6} step={0.5} />
                </div>
              </div>
            </aside>
          </div>
          ) : (
          <div className="mb-4 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
            <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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
                  <div key={result.file.id} className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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
                <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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

              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出尺寸</p>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <NumInput label="圖寬(px)" value={vbmStyle.exportWidth} onChange={value => setVbmStyle(prev => ({ ...prev, exportWidth: Math.max(420, value) }))} min={420} max={3000} step={20} />
                  <NumInput label="圖高(px)" value={vbmStyle.exportHeight} onChange={value => setVbmStyle(prev => ({ ...prev, exportHeight: Math.max(320, value) }))} min={320} max={4000} step={20} />
                  <NumInput label="PNG 倍率" value={vbmStyle.exportScale} onChange={value => setVbmStyle(prev => ({ ...prev, exportScale: clamp(value, 1, 6) }))} min={1} max={6} step={0.5} />
                </div>
              </div>
            </aside>
          </div>
          )}
        </>
      )}
    </div>
  )
}
