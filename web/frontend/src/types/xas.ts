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
  bg_channel: 'both' | 'TEY' | 'TFY'
  bg_method: 'linear' | 'polynomial' | 'asls' | 'airpls'
  bg_x_start: number | null
  bg_x_end: number | null
  bg_poly_deg: number
  bg_baseline_lambda: number
  bg_baseline_p: number
  bg_baseline_iter: number
  norm_method: 'none' | 'min_max' | 'max' | 'area' | 'post_edge'
  norm_x_start: number | null
  norm_x_end: number | null
  norm_pre_start: number | null
  norm_pre_end: number | null
  white_line_start: number | null
  white_line_end: number | null
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
}

export interface ProcessResult {
  datasets: ProcessedDataset[]
  average: ProcessedDataset | null
}
