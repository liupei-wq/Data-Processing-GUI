export interface GaussPeak {
  center: number
  fwhm: number
  amplitude: number
}

export interface ParsedXasFile {
  name: string
  x: number[]
  tey: number[]
  tfy: number[]
  mapping: Record<string, unknown>
  n_cols: number
}

export interface ParseResponse {
  files: ParsedXasFile[]
  errors: string[]
}

export interface DatasetInput {
  name: string
  x: number[]
  tey: number[]
  tfy: number[]
}

export interface ProcessParams {
  interpolate: boolean
  n_points: number
  average: boolean
  energy_shift: number
  bg_enabled: boolean
  bg_method: 'linear' | 'polynomial' | 'asls' | 'airpls'
  bg_tey_start: number | null
  bg_tey_end: number | null
  bg_tfy_start: number | null
  bg_tfy_end: number | null
  bg_poly_deg: number
  bg_baseline_lambda: number
  bg_baseline_p: number
  bg_baseline_iter: number
  norm_method: 'none' | 'min_max' | 'max' | 'area' | 'post_edge' | 'mean_region'
  norm_tey_start: number | null
  norm_tey_end: number | null
  norm_tfy_start: number | null
  norm_tfy_end: number | null
  norm_tey_pre_start: number | null
  norm_tey_pre_end: number | null
  norm_tfy_pre_start: number | null
  norm_tfy_pre_end: number | null
  white_line_start: number | null
  white_line_end: number | null
  gauss_enabled: boolean
  gauss_channel: 'both' | 'TEY' | 'TFY'
  gauss_peaks: GaussPeak[]
  gauss_search: number
}

export interface ProcessedDataset {
  name: string
  x: number[]
  tey_raw: number[]
  tfy_raw: number[]
  tey_processed: number[]
  tfy_processed: number[]
  white_line_tey: number | null
  white_line_tfy: number | null
  edge_step_tey: number | null
  edge_step_tfy: number | null
  tey_gaussian: number[] | null
  tfy_gaussian: number[] | null
  tey_after_gauss: number[] | null
  tfy_after_gauss: number[] | null
  tey_d2y: number[] | null
  tfy_d2y: number[] | null
}

export interface ProcessResult {
  datasets: ProcessedDataset[]
  average: ProcessedDataset | null
}

// ── Peak fitting types ──────────────────────────────────────────────────────

export interface XasInitPeak {
  center: number
  fwhm: number
  amplitude: number
  label?: string
  lock_center?: boolean
  lock_fwhm?: boolean
  lock_area?: boolean
  center_min?: number | null
  center_max?: number | null
  fwhm_min?: number | null
  fwhm_max?: number | null
  amplitude_max?: number | null
  theoretical_center?: number | null
}

export interface XasFitPeakRow {
  Peak_Name: string
  Center_eV: number
  FWHM_eV: number
  Area: number
  Height: number
  Area_pct: number | null
}

export interface XasFitResult {
  y_fit: number[]
  y_individual: number[][]
  residuals: number[]
  peaks: XasFitPeakRow[]
  r_squared: number
  rmse: number
  chi_red: number | null
}

// ── XAS sample database types ───────────────────────────────────────────────

export interface XasSampleListItem {
  name: string
  description: string
  edges: string[]
}

export interface XasEdgePeak {
  label: string
  energy_eV: number
  fwhm_eV: number
  meaning: string
}

export interface XasSampleEdgeResponse {
  sample: string
  edge: string
  energy_range: [number, number]
  peaks: XasEdgePeak[]
}
