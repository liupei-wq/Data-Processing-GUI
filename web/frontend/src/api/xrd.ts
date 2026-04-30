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
} from '../types/xrd'

const BASE = '/api/xrd'

/** Upload raw files and get back parsed x/y arrays. */
export async function parseFiles(files: File[]): Promise<ParsedFile[]> {
  const form = new FormData()
  for (const f of files) form.append('files', f)

  const res = await fetch(`${BASE}/parse`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Parse failed')
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
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Processing failed')
  }
  return res.json() as Promise<ProcessResult>
}

/** Auto-detect peaks in a processed spectrum. */
export async function detectPeaks(
  x: number[],
  y: number[],
  options: {
    prominence?: number
    min_distance?: number
    max_peaks?: number
    wavelength?: number
    include_weak_peaks?: boolean
    weak_peak_threshold?: number
    min_snr?: number
    min_prominence?: number
  },
): Promise<DetectedPeak[]> {
  const res = await fetch(`${BASE}/peaks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, ...options }),
  })
  if (!res.ok) throw new Error('Peak detection failed')
  const data = await res.json()
  return data.peaks as DetectedPeak[]
}

/** Fetch the list of available reference material names. */
export async function fetchReferences(): Promise<string[]> {
  const res = await fetch(`${BASE}/references`)
  if (!res.ok) throw new Error('Could not load references')
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
  if (!res.ok) throw new Error('Could not load reference peaks')
  const data = await res.json()
  return data.peaks as RefPeak[]
}
