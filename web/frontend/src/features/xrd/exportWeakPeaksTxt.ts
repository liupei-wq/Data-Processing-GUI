export type WeakPeakExportRow = Record<string, unknown>

export interface BuildWeakPeaksTxtOptions {
  rows: WeakPeakExportRow[]
  datasetName?: string | null
  wavelength?: number | null
  generatedAt?: Date
}

function pick(row: WeakPeakExportRow, keys: string[]) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') return row[key]
  }
  return undefined
}

function toNumber(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function toText(value: unknown) {
  return value == null ? '' : String(value)
}

function formatNumber(value: unknown, digits: number) {
  const numberValue = toNumber(value)
  return numberValue == null ? '' : numberValue.toFixed(digits)
}

function confidenceText(value: unknown) {
  const text = toText(value)
  if (text === 'high') return '高'
  if (text === 'medium') return '中'
  if (text === 'low') return '低'
  if (text === 'unmatched') return '未匹配'
  return text
}

function normalizeRow(row: WeakPeakExportRow) {
  return {
    twoTheta: pick(row, ['two_theta', 'twoTheta', 'x', 'position', 'peak_position']),
    dSpacing: pick(row, ['d_spacing', 'dSpacing', 'd']),
    intensity: pick(row, ['intensity', 'height', 'y', 'peak_intensity']),
    relIntensity: pick(row, ['rel_intensity', 'relative_intensity', 'relI', 'rel_i']),
    fwhm: pick(row, ['fwhm_deg', 'fwhm', 'FWHM']),
    snr: pick(row, ['snr', 'SNR']),
    confidence: pick(row, ['confidence', 'Confidence']),
    material: pick(row, ['material', 'matched_material', 'reference_material', 'phase_name']),
    phase: pick(row, ['phase', 'matched_phase']),
    hkl: pick(row, ['hkl', 'HKL', 'plane', 'miller_index']),
    source: pick(row, ['source', 'reference_source']),
    note: pick(row, ['note', '備註']),
  }
}

export function buildWeakPeaksTxt({
  rows,
  datasetName,
  wavelength,
  generatedAt = new Date(),
}: BuildWeakPeaksTxtOptions) {
  const header = [
    'XRD 弱峰分析資料匯出',
    `產生時間：${generatedAt.toISOString()}`,
    `資料集：${datasetName || 'xrd'}`,
    `波長：${wavelength == null ? '' : `${formatNumber(wavelength, 4)} Å`}`,
    '',
  ]

  if (rows.length === 0) {
    return `${[
      ...header,
      '沒有可匯出的弱峰資料。',
    ].join('\n')}\n`
  }

  const lines = [
    ...header,
    '欄位說明：',
    '序號\t2θ(度)\td-spacing(Å)\t強度\t相對強度(%)\tFWHM(度)\tSNR\t信心等級\t匹配物質\t相\t晶面HKL\t來源\t備註',
    '',
  ]

  rows.forEach((row, index) => {
    const normalized = normalizeRow(row)
    lines.push([
      index + 1,
      formatNumber(normalized.twoTheta, 4),
      formatNumber(normalized.dSpacing, 4),
      formatNumber(normalized.intensity, 2),
      formatNumber(normalized.relIntensity, 1),
      formatNumber(normalized.fwhm, 4),
      formatNumber(normalized.snr, 2),
      confidenceText(normalized.confidence),
      toText(normalized.material),
      toText(normalized.phase),
      toText(normalized.hkl),
      toText(normalized.source),
      toText(normalized.note),
    ].join('\t'))
  })

  return `${lines.join('\n')}\n`
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
