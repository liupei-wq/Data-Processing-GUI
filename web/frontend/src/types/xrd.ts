// All TypeScript interfaces for the XRD module

/** One file after parsing – raw x/y arrays returned from /api/xrd/parse */
export interface ParsedFile {
  name: string
  x: number[]
  y: number[]
}

/** Processing parameters sent to /api/xrd/process */
export interface ProcessParams {
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
  gaussian_enabled: boolean
  gaussian_fwhm: number
  gaussian_height: number
  gaussian_search_half_width: number
  gaussian_centers: GaussianCenter[]
  smooth_method: 'none' | 'moving_average' | 'savitzky_golay'
  smooth_window: number
  smooth_poly: number
  norm_method: 'none' | 'min_max' | 'max' | 'area'
  norm_x_start: number | null
  norm_x_end: number | null
}

export interface GaussianCenter {
  enabled: boolean
  name: string
  center: number
}

export interface GaussianFitRow {
  Peak_Name: string
  Seed_Center: number
  Fitted_Center: number
  Shift: number
  Fixed_FWHM: number
  Fixed_Area: number
  Template_Height: number
}

/** One dataset in the process response */
export interface ProcessedDataset {
  name: string
  x: number[]
  y_raw: number[]
  y_background: number[] | null
  y_gaussian_model: number[] | null
  y_gaussian_subtracted: number[] | null
  y_processed: number[]
  gaussian_fits: GaussianFitRow[]
}

/** Full response from /api/xrd/process */
export interface ProcessResult {
  datasets: ProcessedDataset[]
  average: ProcessedDataset | null
}

/** One auto-detected peak */
export interface DetectedPeak {
  two_theta: number
  d_spacing: number
  intensity: number
  rel_intensity: number
  fwhm_deg: number
  snr: number
  prominence: number
  confidence: 'high' | 'medium' | 'low'
  note: string
}

export interface PeakExcludeRange {
  start: number
  end: number
}

/** Peak detection controls used by the frontend */
export interface PeakDetectionParams {
  enabled: boolean
  sensitivity: 'high' | 'medium' | 'low'
  min_distance: number
  width_min: number
  width_max: number
  exclude_ranges: PeakExcludeRange[]
  max_peaks: number
  show_unmatched_peaks: boolean
  min_snr: number
  export_weak_peaks: boolean
}

export interface ReferenceMatchParams {
  min_rel_intensity: number
  tolerance_deg: number
  only_show_matched: boolean
}

export interface XAxisCalibrationPoint {
  expected: number
  measured: number
}

export interface XAxisCorrectionParams {
  enabled: boolean
  mode: 'manual' | 'calibration'
  manual_offset: number
  correction_type: 'constant' | 'linear'
  calibration_points: XAxisCalibrationPoint[]
  show_raw_curve: boolean
  show_corrected_curve: boolean
  show_reference_markers: boolean
}

export interface LogViewParams {
  enabled: boolean
  method: 'log10' | 'ln'
  floor_value: number
}

export interface ScherrerParams {
  enabled: boolean
  k: number
  instrument_broadening_deg: number
  broadening_correction: 'none' | 'gaussian' | 'lorentzian'
}

export interface XrdFitParams {
  enabled: boolean
  profile: 'pseudo_voigt' | 'voigt' | 'gaussian' | 'lorentzian'
  seed_source: 'all_detected' | 'matched_only' | 'high_confidence'
  range_mode: 'auto' | 'manual'
  auto_padding: number
  fit_lo: number | null
  fit_hi: number | null
  maxfev: number
}

/** One reference peak from the database */
export interface RefPeak {
  material: string
  phase: string
  hkl: string
  two_theta: number
  d_spacing: number
  rel_i: number
  source: string
  tolerance: number
}

export interface ReferenceMatchRow {
  material: string
  hkl: string
  ref_two_theta: number
  ref_d_spacing: number
  ref_rel_i: number
  observed_two_theta: number | null
  observed_d_spacing: number | null
  observed_intensity: number | null
  delta_two_theta: number | null
  matched: boolean
  confidence: 'high' | 'medium' | 'low' | 'unmatched'
  candidates: string
  note: string
}

export interface FinalPeakRow {
  two_theta: number
  intensity: number
  fwhm_deg: number
  snr: number
  prominence: number
  phase: string
  hkl: string
  reference_2theta: number | null
  delta_2theta: number | null
  near_reference: boolean
  candidate_count: number
  confidence: 'high' | 'medium' | 'low' | 'unmatched'
  note: string
}

export interface XrdFitSeed {
  peak_id: string
  label: string
  center: number
  fwhm: number
  amplitude: number
  phase: string
  hkl: string
  confidence: 'high' | 'medium' | 'low' | 'unmatched'
  near_reference: boolean
  center_tolerance: number
  fwhm_min: number
  fwhm_max: number
  note: string
}

export interface XrdFitPeakRow {
  Peak_ID: string
  Peak_Name: string
  Phase: string
  HKL: string
  Profile: string
  Seed_Center_deg: number
  Center_deg: number
  Delta_deg: number
  FWHM_deg: number
  Height: number
  Area: number
  Area_pct: number
  Eta: number | null
  Confidence: 'high' | 'medium' | 'low' | 'unmatched'
  Near_Reference: boolean
  Fit_Status: string
  Note: string
}

export interface XrdFitResult {
  success: boolean
  message: string
  dataset_name: string
  profile: string
  fit_lo: number | null
  fit_hi: number | null
  y_fit: number[]
  residuals: number[]
  y_individual: number[][]
  peaks: XrdFitPeakRow[]
  r_squared: number
  adjusted_r_squared: number
  rmse: number
  aic: number
  bic: number
}

/** X-axis display mode */
export type XMode = 'twotheta' | 'dspacing'

/** Wavelength preset label */
export type WavelengthPreset =
  | 'Cu Kα (1.5406 Å)'
  | 'Co Kα (1.7890 Å)'
  | 'Mo Kα (0.7093 Å)'
  | 'Cr Kα (2.2909 Å)'
  | 'Fe Kα (1.9373 Å)'
  | 'Custom'
