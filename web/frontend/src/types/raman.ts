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
  bg_method: 'none' | 'constant' | 'linear' | 'shirley' | 'polynomial' | 'asls' | 'airpls' | 'rubber_band' | 'manual_anchor'
  bg_x_start: number | null
  bg_x_end: number | null
  bg_poly_deg: number
  bg_baseline_lambda: number
  bg_baseline_p: number
  bg_baseline_iter: number
  bg_anchor_x: number[]
  bg_anchor_y: number[]
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
  phase: string
  phase_group: string
  position_cm: number
  theoretical_center: number
  label: string
  mode: string
  species: string
  tolerance_cm: number
  fwhm_min: number
  fwhm_max: number
  profile: RamanProfile
  allowed_profiles: RamanProfile[]
  peak_type: string
  anchor_peak: boolean
  can_be_quantified: boolean
  related_technique: string
  reference: string
  oxidation_state: string
  oxidation_state_inference: AssignmentInference
  strength: number
  note: string
}

export type RamanProfile = 'gaussian' | 'lorentzian' | 'voigt' | 'pseudo_voigt' | 'split_pseudo_voigt' | 'super_gaussian'
export type AssignmentInference = 'Direct' | 'Inferred' | 'Not applicable'
export type ConfidenceLevel = 'High' | 'Medium' | 'Low'
export type RobustLoss = 'linear' | 'soft_l1' | 'huber' | 'cauchy' | 'arctan'

export interface FitPeakCandidate {
  peak_id: string
  enabled: boolean
  material: string
  phase: string
  phase_group: string
  label: string
  display_name: string
  position_cm: number
  fwhm_cm: number
  tolerance_cm: number
  fwhm_min: number
  fwhm_max: number
  profile: RamanProfile | ''
  allowed_profiles: RamanProfile[]
  peak_type: string
  anchor_peak: boolean
  can_be_quantified: boolean
  species: string
  theoretical_center: number | null
  related_technique: string
  reference: string
  oxidation_state: string
  oxidation_state_inference: AssignmentInference
  role: string
  mode_label: string
  note: string
  ref_position_cm: number | null
  lock_center: boolean
  lock_fwhm: boolean
  lock_area: boolean
  lock_profile: boolean
}

export interface SegmentWeight {
  lo: number
  hi: number
  weight: number
}

export interface FitParams {
  profile: RamanProfile
  maxfev: number
  fit_lo: number | null
  fit_hi: number | null
  robust_loss: RobustLoss
  segment_weights: SegmentWeight[]
  residual_target_enabled: boolean
  residual_target: number
  residual_target_rounds: number
}

export interface FitPeakRow {
  Peak_ID: string
  Peak_Name: string
  Phase: string
  Phase_Group: string
  Material: string
  Peak_Role: string
  Mode_Label: string
  Species: string
  Oxidation_State: string
  Oxidation_State_Inference: AssignmentInference
  Assignment_Basis: string
  Profile: RamanProfile
  Peak_Type: string
  Anchor_Peak: boolean
  Can_Be_Quantified: boolean
  Ref_cm: number | null
  Tolerance_cm: number
  Center_Min_cm: number | null
  Center_Max_cm: number | null
  Center_cm: number
  Delta_cm: number | null
  Boundary_Peak: boolean
  FWHM_cm: number
  FWHM_Min_cm: number | null
  FWHM_Max_cm: number | null
  Broad_Background_Like: boolean
  Area: number
  Area_pct: number
  SNR: number | null
  Fit_Status: string
  Physical_Confidence: ConfidenceLevel
  Confidence: ConfidenceLevel
  Quality_Flags: string[]
  Group_Shift_cm: number | null
  Spacing_Error_cm: number | null
  Group_Consistency_Score: number | null
  Group_Status: string
  Source_Note: string
  Reference: string
  Is_Doublet: boolean
}

export interface ResidualDiagnostics {
  Global_RMSE: number
  Global_MaxAbs: number
  Max_Residual_Center_cm: number | null
  Max_Residual_Range: string
  Segment_480_570_RMSE: number | null
  Segment_480_570_MaxAbs: number | null
  Local_Ranges: Array<{
    Range: string
    Lo_cm: number
    Hi_cm: number
    RMSE: number | null
    MaxAbs: number | null
    Warning: string
  }>
  Suggestions: string[]
}

export interface GroupSummary {
  Phase_Group: string
  Peak_Count: number
  Group_Shift_cm: number
  Mean_Spacing_Error_cm: number
  Max_Spacing_Error_cm: number
  Group_Consistency_Score: number
  Status: string
}

export interface FitResult {
  success: boolean
  message: string
  dataset_name: string
  profile: RamanProfile
  y_fit: number[]
  residuals: number[]
  y_individual: number[][]
  peaks: FitPeakRow[]
  r_squared: number
  adjusted_r_squared: number
  rmse: number
  aic: number
  bic: number
  residual_diagnostics: ResidualDiagnostics
  group_summaries: GroupSummary[]
}
