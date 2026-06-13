export interface GaussPeak {
  center: number
  fwhm: number
  amplitude: number
}

export interface XasColumnMapping {
  energy: number
  tey: number
  tfy: number
  io: number | null
}

export interface ParsedXasFile {
  name: string
  x: number[]
  tey: number[]
  tfy: number[]
  mapping: Record<string, unknown>
  n_cols: number
  column_names: string[]
  raw_columns: number[][]
  default_mapping: XasColumnMapping | null
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
  norm_method: 'none' | 'post_edge' | 'athena_norm'
  e0_override: number | null        // manual E₀ for athena_norm; null = auto-detect
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
  e0_tey: number | null
  e0_tfy: number | null
  tey_flattened: number[] | null
  tfy_flattened: number[] | null
  tey_gaussian: number[] | null
  tfy_gaussian: number[] | null
  tey_after_gauss: number[] | null
  tfy_after_gauss: number[] | null
  tey_d2y: number[] | null
  tfy_d2y: number[] | null
  tey_pre_edge_line?: number[] | null
  tfy_pre_edge_line?: number[] | null
  tey_post_edge_poly?: number[] | null
  tfy_post_edge_poly?: number[] | null
  tey_pre_subtracted?: number[] | null
  tfy_pre_subtracted?: number[] | null
}

export interface ProcessResult {
  datasets: ProcessedDataset[]
  average: ProcessedDataset | null
}

export interface ExafsRequest {
  energy: number[]
  mu: number[]
  e0: number
  k_min: number
  k_max: number
  k_weight: number
  rbkg: number
  window: 'hanning' | 'none'
  r_max: number
  edge_step?: number | null
  backend_method?: 'scipy_preview' | 'larch_autobk'
}

export interface ExafsResult {
  energy: number[]
  mu: number[]
  mu0: number[]
  k: number[]
  chi: number[]
  chi_weighted: number[]
  r: number[]
  ft_mag: number[]
  ft_re: number[]
  ft_im: number[]
  edge_step: number
  smooth_points: number
  method: string
  warnings: string[]
  log: string[]
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
