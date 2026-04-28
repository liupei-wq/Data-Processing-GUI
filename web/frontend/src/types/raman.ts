export interface ParsedFile {
  name: string
  x: number[]
  y: number[]
}

export interface ProcessParams {
  despike_enabled: boolean
  despike_method: 'none' | 'median'
  despike_threshold: number
  despike_window: number
  despike_passes: number
  interpolate: boolean
  n_points: number
  average: boolean
  bg_enabled: boolean
  bg_method: 'none' | 'linear' | 'shirley' | 'polynomial' | 'asls' | 'airpls'
  bg_x_start: number | null
  bg_x_end: number | null
  bg_poly_deg: number
  bg_baseline_lambda: number
  bg_baseline_p: number
  bg_baseline_iter: number
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
  y_despiked: number[] | null
  y_background: number[] | null
  y_processed: number[]
}

export interface ProcessResult {
  datasets: ProcessedDataset[]
  average: ProcessedDataset | null
}

export interface DetectedPeak {
  shift_cm: number
  intensity: number
  rel_intensity: number
}

export interface PeakDetectionParams {
  enabled: boolean
  prominence: number
  height_ratio: number
  min_distance: number
  max_peaks: number
}

export interface RefPeak {
  material: string
  position_cm: number
  label: string
  strength: number
  note: string
}

export interface FitPeakCandidate {
  peak_id: string
  enabled: boolean
  material: string
  label: string
  display_name: string
  position_cm: number
  fwhm_cm: number
  role: string
  mode_label: string
  note: string
  ref_position_cm: number | null
}

export interface FitParams {
  profile: 'gaussian' | 'lorentzian' | 'voigt'
  maxfev: number
}

export interface FitPeakRow {
  Peak_ID: string
  Peak_Name: string
  Material: string
  Peak_Role: string
  Mode_Label: string
  Ref_cm: number | null
  Center_cm: number
  Delta_cm: number | null
  FWHM_cm: number
  Area: number
  Area_pct: number
  Source_Note: string
  Is_Doublet: boolean
}

export interface FitResult {
  success: boolean
  message: string
  dataset_name: string
  profile: 'gaussian' | 'lorentzian' | 'voigt'
  y_fit: number[]
  residuals: number[]
  y_individual: number[][]
  peaks: FitPeakRow[]
  r_squared: number
}
