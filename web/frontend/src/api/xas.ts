import type { DeconvRequest, DeconvResult, ParseResponse, ProcessParams, ProcessResult, DatasetInput } from '../types/xas'
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

export async function deconvXanes(req: DeconvRequest): Promise<DeconvResult> {
  const res = await fetch(`${BASE}/deconv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'XANES 去卷積失敗'))
  }
  return res.json()
}
