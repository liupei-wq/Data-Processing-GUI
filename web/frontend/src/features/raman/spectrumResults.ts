import type { FitResult, NormalizationDiagnostics, ProcessedDataset, SpectrumComponent, SpectrumResult, XAxisDiagnosticsRow } from '../../types/raman'

export type SpectrumDataStage = SpectrumResult['data_stage']

export interface SpectrumValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface RamanLongFormatRow {
  sample_id: string
  x: number
  y: number
  stage: SpectrumDataStage | string
  component_type: string
  axis_unit: string
}

export interface RamanTrace {
  x: number[]
  y: number[]
  type: 'scatter'
  mode: 'lines'
  name: string
  line?: { color?: string; width?: number; dash?: string }
  opacity?: number
}

export interface CommonGridSeries {
  sample_id: string
  label: string
  x_common: number[]
  y: number[]
}

export interface SpectrumNormalizationOptions {
  method: string
  xStart?: number | null
  xEnd?: number | null
}

interface NormalizationTransform {
  diagnostics: NormalizationDiagnostics
  offset: number
}

function cloneSeries(values: number[] | undefined | null): number[] {
  return Array.isArray(values) ? [...values] : []
}

function finiteMinMax(values: number[]): { min: number; max: number } | null {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return null
  return {
    min: Math.min(...finite),
    max: Math.max(...finite),
  }
}

function trapz(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0
  const pairs = x.map((value, index) => ({ x: value, y: y[index] })).filter(pair => Number.isFinite(pair.x) && Number.isFinite(pair.y)).sort((a, b) => a.x - b.x)
  let area = 0
  for (let i = 1; i < pairs.length; i += 1) {
    area += ((pairs[i].y + pairs[i - 1].y) / 2) * (pairs[i].x - pairs[i - 1].x)
  }
  return area
}

function assertValidFactor(factor: number, method: string): void {
  if (!Number.isFinite(factor)) throw new Error(`Normalization failed for ${method}: factor is not finite`)
  if (factor <= 0) throw new Error(`Normalization failed for ${method}: factor must be positive`)
  if (Math.abs(factor) < 1e-12) throw new Error(`Normalization failed for ${method}: factor is too small`)
}

function rangeMask(x: number[], y: number[], xStart?: number | null, xEnd?: number | null): boolean[] {
  const hasRange = xStart != null && xEnd != null && Number.isFinite(xStart) && Number.isFinite(xEnd)
  const lo = hasRange ? Math.min(Number(xStart), Number(xEnd)) : Number.NEGATIVE_INFINITY
  const hi = hasRange ? Math.max(Number(xStart), Number(xEnd)) : Number.POSITIVE_INFINITY
  return x.map((value, index) => Number.isFinite(value) && Number.isFinite(y[index]) && value >= lo && value <= hi)
}

function selectedValues(x: number[], y: number[], mask: boolean[]): { x: number[]; y: number[] } {
  const xs: number[] = []
  const ys: number[] = []
  mask.forEach((selected, index) => {
    if (selected) {
      xs.push(x[index])
      ys.push(y[index])
    }
  })
  return { x: xs, y: ys }
}

function peakCountsForAreaPct(row: FitResult['peaks'][number]): boolean {
  const text = `${row.Peak_Type} ${row.Material} ${row.Phase}`.toLowerCase()
  if (['residual_assist', 'residual assist', 'background', 'baseline', 'residual'].some(token => text.includes(token))) return false
  if (row.Can_Be_Quantified === false) return false
  if (['disabled', 'invalid', 'rejected', 'not_observed', 'not observed'].includes(String(row.Status).toLowerCase())) return false
  if (String(row.Fit_Status).toLowerCase().includes('invalid') || String(row.Fit_Status).toLowerCase().includes('disabled')) return false
  return ['accepted', 'matched', 'shifted', 'pass'].includes(String(row.Status).toLowerCase())
}

export function recomputeAreaPercentages(peaks: FitResult['peaks']): FitResult['peaks'] {
  const totalArea = peaks.reduce((sum, row) => sum + (peakCountsForAreaPct(row) ? Math.abs(row.Area) : 0), 0)
  return peaks.map(row => ({
    ...row,
    Area_pct: totalArea > 0 && peakCountsForAreaPct(row) ? (Math.abs(row.Area) / totalArea) * 100 : 0,
  }))
}

function isMonotonic(values: number[]): boolean {
  if (values.length <= 2) return true
  let increasing = true
  let decreasing = true
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < values[i - 1]) increasing = false
    if (values[i] > values[i - 1]) decreasing = false
  }
  return increasing || decreasing
}

function duplicateCount(values: number[]): number {
  const seen = new Set<number>()
  let duplicates = 0
  values.forEach(value => {
    if (seen.has(value)) duplicates += 1
    else seen.add(value)
  })
  return duplicates
}

export function createSpectrumResult(
  dataset: ProcessedDataset,
  fitResult?: FitResult | null,
  options: Partial<Pick<SpectrumResult, 'sample_id' | 'label' | 'axis_unit' | 'data_stage'>> = {},
): SpectrumResult {
  const sampleId = options.sample_id || fitResult?.report?.sample_id || fitResult?.dataset_name || dataset.name
  const x = cloneSeries(fitResult?.x_calibrated?.length === dataset.x.length ? fitResult.x_calibrated : dataset.x)
  const yProcessed = cloneSeries(dataset.y_processed)
  const yFit = cloneSeries(fitResult?.y_fit)
  const yResidual = cloneSeries(fitResult?.residuals)
  const components: SpectrumComponent[] = (fitResult?.y_individual ?? []).map((component, index) => ({
    component_id: fitResult?.peaks?.[index]?.Peak_ID || `component_${index + 1}`,
    component_type: fitResult?.peaks?.[index]?.Peak_Type || 'peak',
    label: fitResult?.peaks?.[index]?.Peak_Name || `Component ${index + 1}`,
    y: cloneSeries(component),
  }))

  return {
    sample_id: sampleId,
    label: options.label || dataset.name,
    x,
    y_raw: cloneSeries(dataset.y_raw),
    y_processed: yProcessed,
    y_fit: yFit.length === x.length ? yFit : [],
    y_residual: yResidual.length === x.length ? yResidual : [],
    components,
    axis_unit: options.axis_unit || 'cm-1',
    data_stage: options.data_stage || (fitResult ? 'fit' : 'processed'),
    normalization_diagnostics: dataset.normalization_diagnostics ?? null,
  }
}

export function validateSpectrumResults(
  samples: SpectrumResult[],
  options: { minX?: number; maxX?: number } = {},
): SpectrumValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const sampleIds = new Set<string>()
  const xReferences = new Map<number[], string>()

  samples.forEach((sample, index) => {
    const prefix = sample.sample_id || `sample[${index}]`
    if (!sample.sample_id) errors.push(`${prefix}: missing sample_id`)
    if (sample.sample_id && sampleIds.has(sample.sample_id)) errors.push(`${prefix}: duplicate sample_id`)
    if (sample.sample_id) sampleIds.add(sample.sample_id)

    const ySeries = [
      ['y_raw', sample.y_raw],
      ['y_processed', sample.y_processed],
      ['y_fit', sample.y_fit],
      ['y_residual', sample.y_residual],
    ] as const

    if (!Array.isArray(sample.x) || sample.x.length === 0) errors.push(`${prefix}: x array is empty`)
    ySeries.forEach(([name, values]) => {
      if (values.length > 0 && values.length !== sample.x.length) {
        errors.push(`${prefix}: x length ${sample.x.length} does not match ${name} length ${values.length}`)
      }
    })
    sample.components.forEach(component => {
      if (component.y.length !== sample.x.length) {
        errors.push(`${prefix}: component ${component.component_id} length ${component.y.length} does not match x length ${sample.x.length}`)
      }
    })

    if (!sample.x.every(Number.isFinite)) errors.push(`${prefix}: x contains non-finite values`)
    const range = finiteMinMax(sample.x)
    if (!range) errors.push(`${prefix}: x has no finite values`)
    else {
      if (options.minX != null && range.min < options.minX) warnings.push(`${prefix}: x_min ${range.min} is below expected ${options.minX}`)
      if (options.maxX != null && range.max > options.maxX) warnings.push(`${prefix}: x_max ${range.max} is above expected ${options.maxX}`)
      if (range.min === range.max) errors.push(`${prefix}: x range has zero width`)
    }

    const sharedWith = xReferences.get(sample.x)
    if (sharedWith) errors.push(`${prefix}: shares the same x array reference with ${sharedWith}`)
    else xReferences.set(sample.x, prefix)
  })

  return { valid: errors.length === 0, errors, warnings }
}

export function buildXAxisDiagnostics(samples: SpectrumResult[]): XAxisDiagnosticsRow[] {
  return samples.map(sample => {
    const range = finiteMinMax(sample.x)
    return {
      sample_id: sample.sample_id,
      x_min: range?.min ?? null,
      x_max: range?.max ?? null,
      n_points: sample.x.length,
      is_monotonic: isMonotonic(sample.x),
      duplicate_count: duplicateCount(sample.x),
      axis_unit: sample.axis_unit,
    }
  })
}

export function normalizationTransformForSpectrum(
  sample: SpectrumResult,
  options: SpectrumNormalizationOptions,
  fitPeaks: FitResult['peaks'] = [],
): NormalizationTransform {
  const method = options.method || 'none'
  const before = finiteMinMax(sample.y_processed)
  const fullMask = rangeMask(sample.x, sample.y_processed)
  let mask = fullMask
  let offset = 0
  let factor = 1
  let warning = ''

  if (method === 'range_max' || method === 'range_area') {
    mask = rangeMask(sample.x, sample.y_processed, options.xStart, options.xEnd)
  } else if (method === 'si_520_height') {
    mask = rangeMask(sample.x, sample.y_processed, options.xStart ?? 500, options.xEnd ?? 540)
  } else if ((method === 'max' || method === 'area' || method === 'min_max') && options.xStart != null && options.xEnd != null) {
    mask = rangeMask(sample.x, sample.y_processed, options.xStart, options.xEnd)
  }

  const selected = selectedValues(sample.x, sample.y_processed, mask)
  if (method !== 'none' && selected.y.length === 0) {
    throw new Error(`Normalization failed for ${sample.sample_id}: selected x range has no finite data`)
  }

  if (method === 'min_max') {
    const range = finiteMinMax(selected.y)
    offset = range?.min ?? 0
    factor = (range?.max ?? 0) - offset
  } else if (method === 'max' || method === 'range_max' || method === 'si_520_height') {
    factor = Math.max(...selected.y)
  } else if (method === 'area' || method === 'range_area') {
    factor = trapz(selected.x, selected.y)
  } else if (method === 'si_520_fitted_area') {
    const siPeak = fitPeaks.find(row => row.Status !== 'rejected' && row.Status !== 'not_observed' && row.Center_cm >= 500 && row.Center_cm <= 540)
    factor = siPeak?.Area ?? Number.NaN
    if (!siPeak) warning = 'No accepted fitted Si 520 peak was available'
  } else if (method !== 'none') {
    throw new Error(`Unknown normalization method: ${method}`)
  }

  assertValidFactor(factor, method)
  const xRange = selected.x.length > 0 ? finiteMinMax(selected.x) : null
  const afterValues = sample.y_processed.map(value => (method === 'min_max' ? (value - offset) / factor : value / factor))
  const after = finiteMinMax(afterValues)
  return {
    offset,
    diagnostics: {
      sample_id: sample.sample_id,
      method,
      factor,
      x_range: xRange ? `${xRange.min}-${xRange.max}` : '',
      before_min: before?.min ?? null,
      before_max: before?.max ?? null,
      after_min: after?.min ?? null,
      after_max: after?.max ?? null,
      warning,
    },
  }
}

export function normalizeSpectrumResult(
  sample: SpectrumResult,
  options: SpectrumNormalizationOptions,
  fitPeaks: FitResult['peaks'] = [],
): SpectrumResult {
  const transform = normalizationTransformForSpectrum(sample, options, fitPeaks)
  const method = transform.diagnostics.method
  const factor = transform.diagnostics.factor
  const offset = method === 'min_max' ? transform.offset : 0
  const normalizeWholeCurve = (values: number[]) => values.length === sample.x.length ? values.map(value => (value - offset) / factor) : []
  const normalizeComponent = (values: number[]) => values.length === sample.x.length ? values.map(value => value / factor) : []
  const yProcessed = normalizeWholeCurve(sample.y_processed)
  const yFit = normalizeWholeCurve(sample.y_fit)

  return {
    ...sample,
    y_processed: yProcessed,
    y_fit: yFit,
    y_residual: yProcessed.length === yFit.length && yFit.length > 0
      ? yProcessed.map((value, index) => value - yFit[index])
      : normalizeComponent(sample.y_residual),
    components: sample.components.map(component => ({
      ...component,
      y: normalizeComponent(component.y),
    })),
    normalization_diagnostics: transform.diagnostics,
  }
}

export function buildProcessedOverlayTraces(
  samples: SpectrumResult[],
  colors: string[],
  offset = 0,
): RamanTrace[] {
  return samples.map((sample, index) => ({
    x: [...sample.x],
    y: sample.y_processed.map(value => value + offset * index),
    type: 'scatter',
    mode: 'lines',
    name: sample.label || sample.sample_id,
    line: { color: colors[index % colors.length], width: 2.2 },
  }))
}

export function spectrumResultsToLongFormat(samples: SpectrumResult[], stage: SpectrumDataStage | string = 'processed'): RamanLongFormatRow[] {
  return samples.flatMap(sample => sample.x.map((x, index) => ({
    sample_id: sample.sample_id,
    x,
    y: stage === 'raw' ? sample.y_raw[index] : sample.y_processed[index],
    stage,
    component_type: 'spectrum',
    axis_unit: sample.axis_unit,
  })))
}

export function buildGroupedLongFormatTraces(rows: RamanLongFormatRow[], colors: string[]): RamanTrace[] {
  const grouped = new Map<string, RamanLongFormatRow[]>()
  rows.forEach(row => {
    if (!grouped.has(row.sample_id)) grouped.set(row.sample_id, [])
    grouped.get(row.sample_id)?.push(row)
  })

  return Array.from(grouped.entries()).map(([sampleId, sampleRows], index) => {
    const sortedRows = [...sampleRows].sort((a, b) => a.x - b.x)
    return {
      x: sortedRows.map(row => row.x),
      y: sortedRows.map(row => row.y),
      type: 'scatter',
      mode: 'lines',
      name: sampleId,
      line: { color: colors[index % colors.length], width: 2.2 },
    }
  })
}

export function createCommonGrid(samples: SpectrumResult[], nPoints: number): number[] {
  if (samples.length === 0 || nPoints < 2) return []
  const ranges = samples.map(sample => finiteMinMax(sample.x)).filter((range): range is { min: number; max: number } => Boolean(range))
  if (ranges.length !== samples.length) return []
  const lo = Math.max(...ranges.map(range => range.min))
  const hi = Math.min(...ranges.map(range => range.max))
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return []
  const step = (hi - lo) / (nPoints - 1)
  return Array.from({ length: nPoints }, (_, index) => lo + step * index)
}

export function interpolateSeries(x: number[], y: number[], xCommon: number[]): number[] {
  if (x.length !== y.length || x.length === 0 || xCommon.length === 0) return []
  const pairs = x.map((value, index) => ({ x: value, y: y[index] })).filter(pair => Number.isFinite(pair.x) && Number.isFinite(pair.y)).sort((a, b) => a.x - b.x)
  if (pairs.length === 0) return []

  return xCommon.map(target => {
    if (target < pairs[0].x || target > pairs[pairs.length - 1].x) return Number.NaN
    let hi = pairs.findIndex(pair => pair.x >= target)
    if (hi < 0) hi = pairs.length - 1
    if (pairs[hi].x === target || hi === 0) return pairs[hi].y
    const lo = hi - 1
    const span = pairs[hi].x - pairs[lo].x
    if (Math.abs(span) <= Number.EPSILON) return pairs[lo].y
    const ratio = (target - pairs[lo].x) / span
    return pairs[lo].y + ratio * (pairs[hi].y - pairs[lo].y)
  })
}

export function interpolateToCommonGrid(samples: SpectrumResult[], xCommon: number[]): CommonGridSeries[] {
  return samples.map(sample => ({
    sample_id: sample.sample_id,
    label: sample.label,
    x_common: [...xCommon],
    y: interpolateSeries(sample.x, sample.y_processed, xCommon),
  }))
}
