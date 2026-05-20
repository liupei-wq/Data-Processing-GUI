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
  bg_method: 'linear' | 'shirley' | 'shirley_linear' | 'tougaard' | 'polynomial' | 'asls' | 'airpls'
  bg_x_start: number | null
  bg_x_end: number | null
  bg_poly_deg: number
  bg_baseline_lambda: number
  bg_baseline_p: number
  bg_baseline_iter: number
  bg_tougaard_B: number
  bg_tougaard_C: number
  valid_range_enabled: boolean
  valid_x_start: number | null
  valid_x_end: number | null
  smooth_method: 'none' | 'moving_average' | 'savitzky_golay'
  smooth_window: number
  smooth_poly: number
  norm_method: 'none' | 'min_max' | 'max' | 'area' | 'mean_region'
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
  label?: string
  lock_center?: boolean
  lock_fwhm?: boolean
  lock_area?: boolean
  center_min?: number
  center_max?: number
  fwhm_min?: number
  fwhm_max?: number
  amplitude_max?: number
  theoretical_center?: number
}

export interface ElementDbPeak {
  label: string
  be: number
  fwhm: number
}

export interface ElementPeaksResponse {
  element: string
  peaks: ElementDbPeak[]
  has_doublet: boolean
  doublet_be_sep: number | null
  doublet_area_ratio: number | null
  major_sub: string | null
  minor_sub: string | null
}

export interface ElementListItem {
  symbol: string
  name: string
  has_peaks: boolean
}

export interface PeriodicTableItem {
  symbol: string
  name: string
  row: number
  col: number
  category: string
  category_name_zh: string
  category_color: string
  has_peaks: boolean
}

export interface CalibrationResult {
  standard_element: string
  peak_label: string
  reference_be: number
  observed_be: number | null
  offset_ev: number
  search_window: number
  success: boolean
  message: string
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
  r_squared: number
  rmse: number
  chi_red: number | null
}

export interface VbmLinePoint {
  x: number
  y: number
}

export interface VbmLineFit {
  slope: number
  intercept: number
  point_count: number
  start_window_point_count: number
  end_window_point_count: number
  candidate_pair_count: number
  anchor_start_point: VbmLinePoint
  anchor_end_point: VbmLinePoint
  start_point: VbmLinePoint
  end_point: VbmLinePoint
}

export interface VbmResult {
  vbm_ev: number | null
  slope: number
  intercept: number
  baseline_level: number
  baseline_slope: number
  baseline_intercept: number
  edge_line: VbmLineFit | null
  baseline_line: VbmLineFit | null
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
