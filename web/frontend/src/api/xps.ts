import type {
  CalibrationResult,
  DetectedPeak,
  ElementListItem,
  ElementPeaksResponse,
  FitResult,
  InitPeak,
  ParseResponse,
  PeriodicTableItem,
  ProcessParams,
  ProcessResult,
  DatasetInput,
  VbmResult,
  RsfRequestItem,
  RsfResultRow,
} from '../types/xps'
import { readApiError } from './http'

const BASE = '/api/xps'

export async function parseFiles(files: File[]): Promise<ParseResponse> {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  const res = await fetch(`${BASE}/parse`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await readApiError(res, 'XPS 檔案解析失敗'))
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
    throw new Error(await readApiError(res, 'XPS 資料處理失敗'))
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
  if (!res.ok) throw new Error(await readApiError(res, 'XPS 尋峰失敗'))
  const data = await res.json()
  return data.peaks
}

export async function fetchElementPeaks(element: string): Promise<ElementPeaksResponse> {
  const res = await fetch(`${BASE}/element-peaks/${encodeURIComponent(element)}`)
  if (!res.ok) throw new Error(await readApiError(res, 'XPS 元素峰資料載入失敗'))
  return res.json()
}

export async function listElements(): Promise<ElementListItem[]> {
  const res = await fetch(`${BASE}/elements`)
  if (!res.ok) throw new Error(await readApiError(res, 'XPS 元素列表載入失敗'))
  return res.json()
}

export async function fetchPeriodicTable(): Promise<PeriodicTableItem[]> {
  const res = await fetch(`${BASE}/periodic-table`)
  if (!res.ok) throw new Error(await readApiError(res, '週期表資料載入失敗'))
  return res.json()
}

export async function calibrateEnergy(
  x: number[],
  y: number[],
  standardElement: string,
  peakLabel: string,
  referenceBe: number,
  searchWindow: number,
): Promise<CalibrationResult> {
  const res = await fetch(`${BASE}/calibrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x,
      y,
      standard_element: standardElement,
      peak_label: peakLabel,
      reference_be: referenceBe,
      search_window: searchWindow,
    }),
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'XPS 能量校正失敗'))
  }
  return res.json()
}

export async function fitPeaks(
  x: number[],
  y: number[],
  peaks: InitPeak[],
  profile: string,
  peakLabels?: string[],
  options?: {
    maxfev?: number
    fitRange?: [number, number]
    nRestarts?: number
  },
): Promise<FitResult> {
  const body: Record<string, unknown> = {
    x,
    y,
    peaks,
    profile,
    maxfev: options?.maxfev ?? 6000,
    n_restarts: options?.nRestarts ?? 1,
  }
  if (peakLabels) body.peak_labels = peakLabels
  if (options?.fitRange) body.fit_range = options.fitRange
  const res = await fetch(`${BASE}/fit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'XPS peak fitting 失敗'))
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
    throw new Error(await readApiError(res, 'XPS VBM 計算失敗'))
  }
  return res.json()
}

export async function lookupRsf(items: RsfRequestItem[]): Promise<RsfResultRow[]> {
  const res = await fetch(`${BASE}/rsf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'XPS RSF 查詢失敗'))
  return res.json()
}

export interface XpsFitReportPeak {
  name: string
  center: number
  fwhm: number
  area: number
  height: number
  area_pct?: number | null
}

export interface XpsRsfReportRow {
  peak_name: string
  element: string
  orbital: string
  area: number
  rsf?: number | null
  rsf_area?: number | null
  atomic_pct?: number | null
}

export async function downloadXpsFitReport(payload: {
  channel?: string
  profile: string
  r2: number
  rmse: number
  chi_red?: number | null
  peaks: XpsFitReportPeak[]
  rsf_rows?: XpsRsfReportRow[] | null
}): Promise<void> {
  const res = await fetch(`${BASE}/fit-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'XPS Excel 報告產生失敗'))
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'xps_fit_report.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}
