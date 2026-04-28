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
  smooth_method: 'none' | 'moving_average' | 'savitzky_golay'
  smooth_window: number
  smooth_poly: number
  norm_method: 'none' | 'min_max' | 'max' | 'area'
  norm_x_start: number | null
  norm_x_end: number | null
}

/** One dataset in the process response */
export interface ProcessedDataset {
  name: string
  x: number[]
  y_raw: number[]
  y_processed: number[]
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
}

/** One reference peak from the database */
export interface RefPeak {
  material: string
  hkl: string
  two_theta: number
  d_spacing: number
  rel_i: number
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
