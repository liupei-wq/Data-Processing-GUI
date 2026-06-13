import type {
  ParseResponse,
  ProcessParams,
  ProcessResult,
  DatasetInput,
  XasInitPeak,
  XasFitResult,
  XasSampleListItem,
  XasSampleEdgeResponse,
  ExafsRequest,
  ExafsResult,
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
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const res = await fetch(`${BASE}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets, params }),
    signal,
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
  nRestarts?: number,
  fitRange?: [number, number] | null,
): Promise<XasFitResult> {
  const body: Record<string, unknown> = { x, y, peaks, profile, n_restarts: nRestarts ?? 1 }
  if (peakLabels) body.peak_labels = peakLabels
  if (fitRange) body.fit_range = fitRange
  const res = await fetch(`${BASE}/fit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'XAS peak fitting 失敗'))
  return res.json()
}

export async function processExafs(payload: ExafsRequest, signal?: AbortSignal): Promise<ExafsResult> {
  const res = await fetch(`${BASE}/exafs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok) throw new Error(await readApiError(res, 'EXAFS 處理失敗'))
  return res.json()
}

export interface FitReportPeak {
  name: string
  center: number
  fwhm: number
  area: number
  height: number
  area_pct?: number | null
}

export async function downloadFitReport(payload: {
  channel: string
  profile: string
  r2: number
  rmse: number
  chi_red?: number | null
  peaks: FitReportPeak[]
}): Promise<void> {
  const res = await fetch(`${BASE}/fit-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'Excel 報告產生失敗'))
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'xas_fit_report.xlsx'
  a.click()
  URL.revokeObjectURL(url)
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
