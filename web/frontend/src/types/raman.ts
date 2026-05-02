export interface ParsedFile {
  name: string
  x: number[]
  y: number[]
}

export interface ProcessParams {
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
  reference_source: string
  symmetry: string
  oxidation_state: string
  oxidation_state_inference: AssignmentInference
  enabled_by_default: boolean
  candidate_only: boolean
  artifact: boolean
  substrate: boolean
  disabled_until_user_selects: boolean
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
  reference_source: string
  symmetry: string
  oxidation_state: string
  oxidation_state_inference: AssignmentInference
  role: string
  mode_label: string
  note: string
  ref_position_cm: number | null
  enabled_by_default: boolean
  candidate_only: boolean
  artifact: boolean
  substrate: boolean
  disabled_until_user_selects: boolean
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
  baseline_method?: 'arpls' | 'airpls' | 'asls'
  baseline_lambda?: number
  baseline_p?: number
  baseline_iter?: number
  bootstrap_rounds?: number
}

export interface FitPeakRow {
  Peak_ID: string
  Peak_Name: string
  Phase: string
  Phase_Group: string
  Material: string
  Peak_Role: string
  Mode_Label: string
  Symmetry: string
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
  Height: number
  FWHM_Min_cm: number | null
  FWHM_Max_cm: number | null
  Broad_Background_Like: boolean
  Area: number
  Area_pct: number
  SNR: number | null
  Bootstrap_Center_STD: number | null
  Bootstrap_FWHM_STD: number | null
  Fit_Status: string
  Physical_Confidence: ConfidenceLevel
  Confidence: ConfidenceLevel
  Quality_Flags: string[]
  Group_Shift_cm: number | null
  Spacing_Error_cm: number | null
  Group_Consistency_Score: number | null
  Group_Status: string
  Anchor_Related_Delta_cm: number | null
  Confidence_Score: number
  Source_Note: string
  Reference: string
  Reference_Source: string
  Is_Doublet: boolean
  Status: string
  Note: string
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
  Material: string
  Anchor_Peak: string
  Anchor_Ref_cm: number | null
  Anchor_Fitted_cm: number | null
  Peak_Count: number
  Candidate_Count: number
  Matched_Count: number
  Group_Shift_cm: number
  Stretch: number
  Mean_Abs_Delta_cm: number
  Max_Abs_Delta_cm: number
  Mean_Spacing_Error_cm: number
  Max_Spacing_Error_cm: number
  Group_Consistency_Score: number
  Status: string
  Remarks: string
}

export interface SegmentFitSummary {
  Range: string
  Lo_cm: number
  Hi_cm: number
  Baseline_Method: string
  R_squared: number
  RMSE: number
  Residual_MaxAbs: number
  Peak_Count: number
  Warning: string
  x: number[]
  y_raw: number[]
  baseline: number[]
  y_corrected: number[]
  y_fit: number[]
  residuals: number[]
}

export interface CalibrationSummary {
  method: string
  offset_cm: number
  si_peak_before_cm: number | null
  si_peak_after_cm: number | null
  applied: boolean
  reference: string
}

export interface AlignmentRow {
  sample_id: string
  material: string
  phase: string
  mode: string
  symmetry: string
  reference_cm1: number
  fitted_cm1: number | null
  delta_cm1: number | null
  tolerance_cm1: number
  status: string
  confidence: string
  note: string
  reference_source: string
}

export interface PeakProbeRow {
  material_group: string
  material: string
  peak_id: string
  peak_label: string
  mode: string
  reference_cm1: number
  search_window: string
  search_window_lo: number
  search_window_hi: number
  local_max_position: number | null
  fitted_cm1: number | null
  delta_cm1: number | null
  FWHM: number | null
  height: number
  area: number
  local_noise: number
  SNR: number
  AIC_improvement: number
  BIC_improvement: number
  uncertainty_center: number | null
  tolerance_cm1: number
  status: string
  rejection_reason: string
  y_fit: number[]
}

export interface RamanReport {
  sample_id: string
  sample_name: string
  ar_o2_flux: string
  baseline_method: string
  calibration_method: string
  si_peak_before_cm: number | null
  si_peak_after_cm: number | null
  global_r_squared: number
  global_rmse: number
  global_reduced_chi2: number
  fitting_segments: string[]
  warnings: string[]
  unmatched_peaks: string[]
  unobserved_reference_peaks: string[]
  credibility_summary: string[]
  report_text: string
  alignment_csv: string
  peak_table_csv: string
  group_probe_table_csv: string
  unmatched_csv: string
  report_markdown: string
  report_html: string
  report_json: string
}

export interface GroupFitStage {
  group_name: string
  material: string
  anchor_peak_label: string
  anchor_ref_cm: number
  anchor_fitted_cm: number | null
  group_shift_cm: number
  stretch: number
  x: number[]
  y_current_spectrum: number[]
  y_remaining_before: number[]
  y_group_fit: number[]
  y_locked_previous: number[]
  y_combined_fit: number[]
  residuals: number[]
  peaks: FitPeakRow[]
  probe_rows: PeakProbeRow[]
  r_squared: number
  warnings: string[]
}

export interface FitResult {
  success: boolean
  message: string
  dataset_name: string
  profile: RamanProfile
  x_calibrated: number[]
  y_fit: number[]
  y_baseline: number[]
  y_corrected: number[]
  y_fit_corrected: number[]
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
  calibration: CalibrationSummary
  segment_summaries: SegmentFitSummary[]
  alignment_rows: AlignmentRow[]
  report: RamanReport | null
  group_fit_stages: GroupFitStage[]
  group_probe_rows: PeakProbeRow[]
}
