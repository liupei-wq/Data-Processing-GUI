import {
  buildGroupedLongFormatTraces,
  buildProcessedOverlayTraces,
  createCommonGrid,
  createSpectrumResult,
  interpolateToCommonGrid,
  normalizeSpectrumResult,
  recomputeAreaPercentages,
  spectrumResultsToLongFormat,
  validateSpectrumResults,
} from '../../src/features/raman/spectrumResults.js'
import type { FitResult, ProcessedDataset } from '../../src/types/raman.js'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function assertArrayClose(actual: number[], expected: number[], message: string): void {
  assert(actual.length === expected.length, `${message}: length ${actual.length} !== ${expected.length}`)
  actual.forEach((value, index) => {
    assert(Math.abs(value - expected[index]) < 1e-9, `${message}: index ${index} ${value} !== ${expected[index]}`)
  })
}

const datasetA: ProcessedDataset = {
  name: 'sample-a',
  x: [100, 110, 120],
  y_raw: [1, 2, 3],
  y_background: null,
  y_processed: [10, 20, 30],
}

const datasetB: ProcessedDataset = {
  name: 'sample-b',
  x: [101, 111, 121, 131],
  y_raw: [2, 3, 4, 5],
  y_background: null,
  y_processed: [12, 22, 32, 42],
}

const samples = [
  createSpectrumResult(datasetA, null, { sample_id: 'sample-a' }),
  createSpectrumResult(datasetB, null, { sample_id: 'sample-b' }),
]

const validation = validateSpectrumResults(samples)
assert(validation.valid, `expected valid samples, got ${validation.errors.join('; ')}`)
assert(samples[0].x !== datasetA.x, 'SpectrumResult must own a cloned x array for sample-a')
assert(samples[1].x !== datasetB.x, 'SpectrumResult must own a cloned x array for sample-b')

const overlayTraces = buildProcessedOverlayTraces(samples, ['#111', '#222'])
assert(overlayTraces.length === 2, 'overlay plot should produce one trace per sample')
assertArrayClose(overlayTraces[0].x, [100, 110, 120], 'sample-a overlay x grid')
assertArrayClose(overlayTraces[1].x, [101, 111, 121, 131], 'sample-b overlay x grid')
assertArrayClose(overlayTraces[0].y, [10, 20, 30], 'sample-a overlay y')
assertArrayClose(overlayTraces[1].y, [12, 22, 32, 42], 'sample-b overlay y')

const longRows = spectrumResultsToLongFormat(samples, 'processed')
const globallySortedRows = [...longRows].sort((a, b) => a.x - b.x)
const groupedTraces = buildGroupedLongFormatTraces(globallySortedRows, ['#111', '#222'])
assert(groupedTraces.length === 2, 'long-format plotting must group by sample_id')
assertArrayClose(groupedTraces[0].x, [100, 110, 120], 'grouped sample-a x grid')
assertArrayClose(groupedTraces[1].x, [101, 111, 121, 131], 'grouped sample-b x grid')

const xCommon = createCommonGrid(samples, 3)
assertArrayClose(xCommon, [101, 110.5, 120], 'common-grid overlap')
const commonGridSeries = interpolateToCommonGrid(samples, xCommon)
assert(commonGridSeries.length === 2, 'common-grid comparison should interpolate each sample independently')
assert(commonGridSeries.every(series => series.x_common !== samples[0].x && series.x_common !== samples[1].x), 'common-grid x arrays must not reuse sample x references')
assertArrayClose(commonGridSeries[0].y, [11, 20.5, 30], 'sample-a interpolated y')
assertArrayClose(commonGridSeries[1].y, [12, 21.5, 31], 'sample-b interpolated y')

const datasetC: ProcessedDataset = {
  name: 'sample-c',
  x: [99, 109, 119],
  y_raw: [3, 6, 9],
  y_background: null,
  y_processed: [7, 14, 21],
}
const normalizationSamples = [
  createSpectrumResult(datasetA, null, { sample_id: 'sample-a' }),
  createSpectrumResult(datasetB, null, { sample_id: 'sample-b' }),
  createSpectrumResult(datasetC, null, { sample_id: 'sample-c' }),
]
normalizationSamples[0].y_fit = [5, 10, 15]
normalizationSamples[0].components = [{ component_id: 'p1', component_type: 'peak', label: 'P1', y: [2, 4, 6] }]
const normalized = normalizationSamples.map(sample => normalizeSpectrumResult(sample, { method: 'max' }))
assertArrayClose(normalized.map(sample => sample.normalization_diagnostics?.factor ?? 0), [30, 42, 21], 'samples should keep independent normalization factors')
normalized.forEach((sample, index) => {
  assertArrayClose(sample.x, normalizationSamples[index].x, `${sample.sample_id} x must remain unchanged`)
  assert(Math.abs(Math.max(...sample.y_processed) - 1) < 1e-9, `${sample.sample_id} normalized max should be 1`)
})
assertArrayClose(normalized[0].y_residual, [5 / 30, 10 / 30, 15 / 30], 'residual should equal y_norm - fit_norm')
assertArrayClose(normalized[0].components[0].y, [2 / 30, 4 / 30, 6 / 30], 'component should use sample factor without component-wise normalization')

const siAreaNormalized = normalizeSpectrumResult(normalizationSamples[0], { method: 'si_520_fitted_area' }, [
  { Peak_ID: 'si', Peak_Name: 'Si 520', Phase: 'Si', Phase_Group: 'Si group', Material: 'Si', Peak_Role: '', Mode_Label: '', Symmetry: '', Species: '', Oxidation_State: 'N/A', Oxidation_State_Inference: 'Not applicable', Assignment_Basis: '', Profile: 'voigt', Peak_Type: 'physical', Anchor_Peak: true, Can_Be_Quantified: true, Ref_cm: 520, Tolerance_cm: 8, Center_Min_cm: null, Center_Max_cm: null, Center_cm: 520.7, Delta_cm: 0, Boundary_Peak: false, FWHM_cm: 8, Height: 10, FWHM_Min_cm: null, FWHM_Max_cm: null, Broad_Background_Like: false, Area: 60, Area_pct: 0, SNR: null, Bootstrap_Center_STD: null, Bootstrap_FWHM_STD: null, Fit_Status: 'Fit OK', Physical_Confidence: 'High', Confidence: 'High', Quality_Flags: [], Group_Shift_cm: null, Spacing_Error_cm: null, Group_Consistency_Score: null, Group_Status: '', Anchor_Related_Delta_cm: null, Confidence_Score: 90, Source_Note: '', Reference: '', Reference_Source: '', Is_Doublet: false, Status: 'accepted', Note: '' },
] as FitResult['peaks'])
assert(siAreaNormalized.normalization_diagnostics?.factor === 60, 'Si 520 fitted area should use the fitted Si peak area as the factor')

const areaRows = recomputeAreaPercentages([
  { Peak_ID: 'p1', Peak_Name: 'Physical', Phase: 'Si', Phase_Group: 'Si group', Material: 'Si', Peak_Role: '', Mode_Label: '', Symmetry: '', Species: '', Oxidation_State: 'N/A', Oxidation_State_Inference: 'Not applicable', Assignment_Basis: '', Profile: 'voigt', Peak_Type: 'physical', Anchor_Peak: false, Can_Be_Quantified: true, Ref_cm: 520, Tolerance_cm: 8, Center_Min_cm: null, Center_Max_cm: null, Center_cm: 520, Delta_cm: 0, Boundary_Peak: false, FWHM_cm: 8, Height: 10, FWHM_Min_cm: null, FWHM_Max_cm: null, Broad_Background_Like: false, Area: 100, Area_pct: 0, SNR: null, Bootstrap_Center_STD: null, Bootstrap_FWHM_STD: null, Fit_Status: 'Fit OK', Physical_Confidence: 'High', Confidence: 'High', Quality_Flags: [], Group_Shift_cm: null, Spacing_Error_cm: null, Group_Consistency_Score: null, Group_Status: '', Anchor_Related_Delta_cm: null, Confidence_Score: 90, Source_Note: '', Reference: '', Reference_Source: '', Is_Doublet: false, Status: 'accepted', Note: '' },
  { Peak_ID: 'r1', Peak_Name: 'Residual assist', Phase: 'Residual assist', Phase_Group: 'Residual assist', Material: 'Residual assist', Peak_Role: '', Mode_Label: '', Symmetry: '', Species: '', Oxidation_State: 'N/A', Oxidation_State_Inference: 'Not applicable', Assignment_Basis: '', Profile: 'super_gaussian', Peak_Type: 'residual_assist', Anchor_Peak: false, Can_Be_Quantified: true, Ref_cm: null, Tolerance_cm: 8, Center_Min_cm: null, Center_Max_cm: null, Center_cm: 610, Delta_cm: null, Boundary_Peak: false, FWHM_cm: 20, Height: 5, FWHM_Min_cm: null, FWHM_Max_cm: null, Broad_Background_Like: false, Area: 900, Area_pct: 0, SNR: null, Bootstrap_Center_STD: null, Bootstrap_FWHM_STD: null, Fit_Status: 'Fit OK', Physical_Confidence: 'Low', Confidence: 'Low', Quality_Flags: ['residual assist / possible overfit'], Group_Shift_cm: null, Spacing_Error_cm: null, Group_Consistency_Score: null, Group_Status: '', Anchor_Related_Delta_cm: null, Confidence_Score: 10, Source_Note: '', Reference: '', Reference_Source: '', Is_Doublet: false, Status: 'accepted', Note: '' },
] as FitResult['peaks'])
assert(Math.abs(areaRows[0].Area_pct - 100) < 1e-9, 'physical peak should receive 100% when residual assist is excluded')
assert(areaRows[1].Area_pct === 0, 'residual assist must not contribute to Area%')

console.log('Raman spectrum result tests passed')
