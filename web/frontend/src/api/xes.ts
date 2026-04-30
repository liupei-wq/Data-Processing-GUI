import type {
  DatasetInput,
  DetectedPeak,
  ParseResponse,
  ProcessParams,
  ProcessResult,
  ReferencePeak,
} from '../types/xes'
import { readApiError } from './http'

const BASE = '/api/xes'

export async function parseFiles(
  sampleFiles: File[],
  bg1File?: File | null,
  bg2File?: File | null,
): Promise<ParseResponse> {
  const form = new FormData()
  for (const f of sampleFiles) form.append('files', f)
  if (bg1File) form.append('bg1_file', bg1File)
  if (bg2File) form.append('bg2_file', bg2File)
  const res = await fetch(`${BASE}/parse`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await readApiError(res, 'XES 檔案解析失敗'))
  return res.json()
}

export async function processData(
  samples: DatasetInput[],
  bg1: DatasetInput | null,
  bg2: DatasetInput | null,
  params: ProcessParams,
): Promise<ProcessResult> {
  const res = await fetch(`${BASE}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ samples, bg1, bg2, params }),
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'XES 資料處理失敗'))
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
  if (!res.ok) throw new Error(await readApiError(res, 'XES 尋峰失敗'))
  const data = await res.json()
  return data.peaks
}

export async function listReferences(): Promise<string[]> {
  const res = await fetch(`${BASE}/references`)
  if (!res.ok) throw new Error(await readApiError(res, 'XES 參考資料載入失敗'))
  const data = await res.json()
  return data.materials
}

export async function getReferencePeaks(materials: string[]): Promise<ReferencePeak[]> {
  const res = await fetch(`${BASE}/reference-peaks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materials }),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'XES 參考峰載入失敗'))
  const data = await res.json()
  return data.peaks
}
