import type {
  DetectedPeak,
  FitResult,
  InitPeak,
  ParseResponse,
  ProcessParams,
  ProcessResult,
  DatasetInput,
  VbmResult,
  RsfRequestItem,
  RsfResultRow,
} from '../types/xps'

const BASE = '/api/xps'

export async function parseFiles(files: File[]): Promise<ParseResponse> {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  const res = await fetch(`${BASE}/parse`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Parse failed: ${res.statusText}`)
  return res.json()
}

export async function processData(
  datasets: DatasetInput[],
  params: ProcessParams,
): Promise<ProcessResult> {
  const res = await fetch(`${BASE}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets, params }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail ?? res.statusText)
  }
  return res.json()
}

export async function detectPeaks(
  x: number[],
  y: number[],
  prominence: number,
  minDistance: number,
  maxPeaks: number,
): Promise<DetectedPeak[]> {
  const res = await fetch(`${BASE}/peaks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, prominence, min_distance: minDistance, max_peaks: maxPeaks }),
  })
  if (!res.ok) throw new Error(`Peak detection failed: ${res.statusText}`)
  const data = await res.json()
  return data.peaks
}

export async function fitPeaks(
  x: number[],
  y: number[],
  peaks: InitPeak[],
  profile: string,
): Promise<FitResult> {
  const res = await fetch(`${BASE}/fit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, peaks, profile }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail ?? res.statusText)
  }
  return res.json()
}

export async function computeVbm(
  x: number[],
  y: number[],
  edgeLo: number,
  edgeHi: number,
  baselineLo: number,
  baselineHi: number,
): Promise<VbmResult> {
  const res = await fetch(`${BASE}/vbm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, edge_lo: edgeLo, edge_hi: edgeHi, baseline_lo: baselineLo, baseline_hi: baselineHi }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail ?? res.statusText)
  }
  return res.json()
}

export async function lookupRsf(items: RsfRequestItem[]): Promise<RsfResultRow[]> {
  const res = await fetch(`${BASE}/rsf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  })
  if (!res.ok) throw new Error(`RSF lookup failed: ${res.statusText}`)
  return res.json()
}
