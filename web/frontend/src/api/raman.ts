import type {
  DetectedPeak,
  FitPeakCandidate,
  FitParams,
  FitResult,
  ParsedFile,
  PeakDetectionParams,
  ProcessParams,
  ProcessResult,
  RefPeak,
} from '../types/raman'

const BASE = '/api/raman'

export async function parseFiles(files: File[]): Promise<ParsedFile[]> {
  const form = new FormData()
  for (const file of files) form.append('files', file)

  const res = await fetch(`${BASE}/parse`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Parse failed')
  }
  const data = await res.json()
  return data.files as ParsedFile[]
}

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

export async function detectPeaks(
  x: number[],
  y: number[],
  options: PeakDetectionParams,
): Promise<DetectedPeak[]> {
  const res = await fetch(`${BASE}/peaks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x,
      y,
      prominence: options.prominence,
      height_ratio: options.height_ratio,
      min_distance: options.min_distance,
      max_peaks: options.max_peaks,
    }),
  })
  if (!res.ok) throw new Error('Peak detection failed')
  const data = await res.json()
  return data.peaks as DetectedPeak[]
}

export async function fetchReferences(): Promise<string[]> {
  const res = await fetch(`${BASE}/references`)
  if (!res.ok) throw new Error('Could not load references')
  const data = await res.json()
  return data.materials as string[]
}

export async function fetchReferencePeaks(materials: string[]): Promise<RefPeak[]> {
  const res = await fetch(`${BASE}/reference-peaks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materials }),
  })
  if (!res.ok) throw new Error('Could not load reference peaks')
  const data = await res.json()
  return data.peaks as RefPeak[]
}

export async function fitSpectrum(
  datasetName: string,
  x: number[],
  y: number[],
  peaks: FitPeakCandidate[],
  params: FitParams,
): Promise<FitResult> {
  const res = await fetch(`${BASE}/fit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataset_name: datasetName,
      x,
      y,
      peaks,
      profile: params.profile,
      maxfev: params.maxfev,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Peak fitting failed')
  }
  return res.json() as Promise<FitResult>
}
