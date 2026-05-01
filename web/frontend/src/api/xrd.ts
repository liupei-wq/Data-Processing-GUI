/**
 * API client for XRD endpoints.
 *
 * All functions call the FastAPI backend at /api/xrd/*.
 * In dev, Vite proxies these to http://localhost:8000.
 */

import type {
  ParsedFile,
  ProcessParams,
  ProcessResult,
  DetectedPeak,
  RefPeak,
  XrdFitResult,
  XrdFitSeed,
} from '../types/xrd'
import { readApiError } from './http'

const BASE = '/api/xrd'

/** Upload raw files and get back parsed x/y arrays. */
export async function parseFiles(files: File[]): Promise<ParsedFile[]> {
  const form = new FormData()
  for (const f of files) form.append('files', f)

  const res = await fetch(`${BASE}/parse`, { method: 'POST', body: form })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'XRD 檔案解析失敗'))
  }
  const data = await res.json()
  return data.files as ParsedFile[]
}

/** Apply smoothing + normalization to previously parsed arrays. */
export async function processData(
  datasets: ParsedFile[],
  params: ProcessParams,
): Promise<ProcessResult> {
  const res = await fetch(`${BASE}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets, params }),
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'XRD 資料處理失敗'))
  }
  return res.json() as Promise<ProcessResult>
}

/** Auto-detect peaks in a processed spectrum. */
export async function detectPeaks(
  x: number[],
  y: number[],
  options: {
    sensitivity?: 'high' | 'medium' | 'low'
    min_distance?: number
    width_min?: number
    width_max?: number
    exclude_ranges?: Array<{ start: number; end: number }>
    max_peaks?: number
    wavelength?: number
    min_snr?: number
  },
): Promise<DetectedPeak[]> {
  const res = await fetch(`${BASE}/peaks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, ...options }),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'XRD 尋峰失敗'))
  const data = await res.json()
  return data.peaks as DetectedPeak[]
}

/** Fetch the list of available reference material names. */
export async function fetchReferences(): Promise<string[]> {
  const res = await fetch(`${BASE}/references`)
  if (!res.ok) throw new Error(await readApiError(res, 'XRD 參考資料載入失敗'))
  const data = await res.json()
  return data.materials as string[]
}

/** Get reference peaks in 2θ for the selected materials + wavelength. */
export async function fetchReferencePeaks(
  materials: string[],
  wavelength: number,
): Promise<RefPeak[]> {
  const res = await fetch(`${BASE}/reference-peaks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materials, wavelength }),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'XRD 參考峰載入失敗'))
  const data = await res.json()
  return data.peaks as RefPeak[]
}

export async function fitXrdPeaks(
  datasetName: string,
  x: number[],
  y: number[],
  options: {
    peaks: XrdFitSeed[]
    profile?: 'pseudo_voigt' | 'voigt' | 'gaussian' | 'lorentzian'
    fit_lo?: number | null
    fit_hi?: number | null
    maxfev?: number
  },
): Promise<XrdFitResult> {
  const res = await fetch(`${BASE}/fit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_name: datasetName, x, y, ...options }),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'XRD 峰擬合失敗'))
  return res.json() as Promise<XrdFitResult>
}
