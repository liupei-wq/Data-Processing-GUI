export interface ParsedSpectrum {
  name: string
  x: number[]
  y: number[]
  n_points: number
}

export interface ParseResponse {
  samples: ParsedSpectrum[]
  bg1: ParsedSpectrum | null
  bg2: ParsedSpectrum | null
  errors: string[]
}

export interface DatasetInput {
  name: string
  x: number[]
  y: number[]
}

export interface ProcessParams {
  interpolate: boolean
  n_points: number
  average: boolean
  bg_method: 'none' | 'bg1' | 'bg2' | 'average' | 'interpolated'
  bg_order: 'upload' | 'filename'
  smooth_method: 'none' | 'moving_average' | 'savitzky_golay'
  smooth_window: number
  smooth_poly: number
  norm_method: 'none' | 'min_max' | 'max' | 'area' | 'reference_region'
  norm_x_start: number | null
  norm_x_end: number | null
  i0_values: Record<string, number>
  axis_calibration: 'none' | 'linear'
  energy_offset: number
  energy_slope: number
}

export interface ProcessedDataset {
  name: string
  x_pixel: number[]
  x_ev: number[] | null
  y_raw: number[]
  y_bg: number[] | null
  y_corrected: number[]
  y_processed: number[]
}

export interface ProcessResult {
  datasets: ProcessedDataset[]
  average: ProcessedDataset | null
}

export interface DetectedPeak {
  x: number
  intensity: number
  rel_intensity: number
  fwhm: number | null
}

export interface ReferencePeak {
  material: string
  label: string
  energy_eV: number
  tolerance_eV: number
  relative_intensity: number
  meaning: string
}

export interface BandAlignParams {
  enabled: boolean
  mat_a: string
  mat_b: string
  vbm_a: number
  cbm_a: number
  vbm_b: number
  cbm_b: number
  sigma_vbm_a: number
  sigma_cbm_a: number
  sigma_vbm_b: number
  sigma_cbm_b: number
}

export interface BandAlignResult {
  eg_a: number
  eg_b: number
  delta_ev: number
  delta_ec: number
  sigma_eg_a: number
  sigma_eg_b: number
  sigma_delta_ev: number
  sigma_delta_ec: number
}
