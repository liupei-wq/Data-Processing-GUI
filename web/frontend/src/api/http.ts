export async function readApiError(res: Response, fallback: string): Promise<string> {
  let detail = ''

  try {
    const data = await res.clone().json()
    const rawDetail = data?.detail ?? data?.message
    detail = Array.isArray(rawDetail)
      ? rawDetail.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('; ')
      : String(rawDetail ?? '')
  } catch {
    try {
      detail = await res.text()
    } catch {
      detail = ''
    }
  }

  const statusText = [res.status, res.statusText].filter(Boolean).join(' ')
  const message = detail.trim() || statusText || 'Request failed'

  if (res.status === 500 && /internal server error/i.test(message)) {
    return `${fallback}: 後端服務回傳 500。請確認 FastAPI 已在 localhost:8000 啟動，或查看後端終端機錯誤紀錄。`
  }

  return `${fallback}: ${message}`
}
