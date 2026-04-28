export interface ParsedFile {
  name: string
  x: number[]
  y: number[]
  n_points: number
}

export interface ParseResponse {
  files: ParsedFile[]
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
  energy_shift: number
  bg_enabled: boolean
  bg_method: 'linear' | 'shirley' | 'tougaard' | 'polynomial' | 'asls' | 'airpls'
  bg_x_start: number | null
  bg_x_end: number | null
  bg_poly_deg: number
  bg_baseline_lambda: number
  bg_baseline_p: number
  bg_baseline_iter: number
  bg_tougaard_B: number
  bg_tougaard_C: number
  smooth_method: 'none' | 'moving_average' | 'savitzky_golay'
  smooth_window: number
  smooth_poly: number
  norm_method: 'none' | 'min_max' | 'max' | 'area'
  norm_x_start: number | null
  norm_x_end: number | null
}

export interface ProcessedDataset {
  name: string
  x: number[]
  y_raw: number[]
  y_background: number[] | null
  y_processed: number[]
}

export interface ProcessResult {
  datasets: ProcessedDataset[]
  average: ProcessedDataset | null
}

export interface DetectedPeak {
  binding_energy: number
  intensity: number
  rel_intensity: number
  fwhm_ev: number | null
}

export interface InitPeak {
  center: number
  fwhm: number
  amplitude: number
}

export interface FitPeakRow {
  Peak_Name: string
  Center_eV: number
  FWHM_eV: number
  Area: number
  Height: number
  Area_pct: number | null
}

export interface FitResult {
  y_fit: number[]
  y_individual: number[][]
  residuals: number[]
  peaks: FitPeakRow[]
}

export interface VbmResult {
  vbm_ev: number | null
  slope: number
  intercept: number
  baseline_level: number
  x_fit: number[]
  y_fit: number[]
  success: boolean
  message: string
}

export interface RsfRequestItem {
  element: string
  label: string
}

export interface RsfResultRow {
  element: string
  label: string
  rsf: number | null
  source: string
}
