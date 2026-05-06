import type {
  ParseResponse,
  ProcessParams,
  ProcessResult,
  DatasetInput,
  XasInitPeak,
  XasFitResult,
  XasSampleListItem,
  XasSampleEdgeResponse,
} from '../types/xas'
import { readApiError } from './http'

const BASE = '/api/xas'

export async function parseFiles(files: File[], flipTfy: boolean): Promise<ParseResponse> {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  const res = await fetch(`${BASE}/parse?flip_tfy=${flipTfy}`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await readApiError(res, 'XAS 檔案解析失敗'))
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
    throw new Error(await readApiError(res, 'XAS 資料處理失敗'))
  }
  return res.json()
}

export async function fitXasPeaks(
  x: number[],
  y: number[],
  peaks: XasInitPeak[],
  profile: string,
  peakLabels?: string[],
): Promise<XasFitResult> {
  const body: Record<string, unknown> = { x, y, peaks, profile }
  if (peakLabels) body.peak_labels = peakLabels
  const res = await fetch(`${BASE}/fit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'XAS peak fitting 失敗'))
  return res.json()
}

export async function listXasSamples(): Promise<XasSampleListItem[]> {
  const res = await fetch(`${BASE}/samples`)
  if (!res.ok) throw new Error(await readApiError(res, 'XAS 樣品列表載入失敗'))
  return res.json()
}

export async function fetchXasSamplePeaks(
  sampleName: string,
  edgeName: string,
): Promise<XasSampleEdgeResponse> {
  const res = await fetch(
    `${BASE}/sample-peaks/${encodeURIComponent(sampleName)}/${encodeURIComponent(edgeName)}`,
  )
  if (!res.ok) throw new Error(await readApiError(res, 'XAS 樣品峰資料載入失敗'))
  return res.json()
}
