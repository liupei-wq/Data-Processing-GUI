import type { DeconvRequest, DeconvResult, ParseResponse, ProcessParams, ProcessResult, DatasetInput } from '../types/xas'

const BASE = '/api/xas'

export async function parseFiles(files: File[], flipTfy: boolean): Promise<ParseResponse> {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  const res = await fetch(`${BASE}/parse?flip_tfy=${flipTfy}`, { method: 'POST', body: form })
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

export async function deconvXanes(req: DeconvRequest): Promise<DeconvResult> {
  const res = await fetch(`${BASE}/deconv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail ?? res.statusText)
  }
  return res.json()
}
