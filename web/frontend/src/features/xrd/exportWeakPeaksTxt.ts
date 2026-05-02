import type { DetectedPeak, FinalPeakRow, RefPeak } from '../../types/xrd'

export interface BuildWeakPeaksTxtOptions {
  datasetName?: string | null
  wavelength?: number | null
  generatedAt?: Date
  detectedPeaks: DetectedPeak[]
  finalPeakRows?: FinalPeakRow[]
  referencePeaks?: RefPeak[]
}

function formatNumber(value: number | null | undefined, digits: number) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : ''
}

function findFinalRow(peak: DetectedPeak, finalPeakRows: FinalPeakRow[]) {
  return finalPeakRows.find(row => Math.abs(row.two_theta - peak.two_theta) <= 0.0001)
}

function findReferencePeak(row: FinalPeakRow | undefined, referencePeaks: RefPeak[]) {
  if (!row || row.reference_2theta == null) return null
  return referencePeaks.find(ref =>
    Math.abs(ref.two_theta - row.reference_2theta!) <= 0.0001
    && (!row.hkl || ref.hkl === row.hkl)
  ) ?? null
}

export function buildWeakPeaksTxt({
  datasetName,
  wavelength,
  generatedAt = new Date(),
  detectedPeaks,
  finalPeakRows = [],
  referencePeaks = [],
}: BuildWeakPeaksTxtOptions) {
  const lines = [
    'XRD Weak Peak Analysis Export',
    `Generated At: ${generatedAt.toISOString()}`,
    `Dataset: ${datasetName || 'xrd'}`,
    `Wavelength: ${wavelength == null ? '' : `${formatNumber(wavelength, 4)} Å`}`,
    '',
    '# Columns:',
    '# index\ttwo_theta_deg\td_spacing_A\tintensity\trel_intensity_pct\tfwhm_deg\tsnr\tconfidence\tmatched_material\tphase\thkl\treference_two_theta_deg\treference_d_spacing_A\treference_rel_i_pct\ttolerance_deg\tnote',
  ]

  detectedPeaks.forEach((peak, index) => {
    const row = findFinalRow(peak, finalPeakRows)
    const refPeak = findReferencePeak(row, referencePeaks)
    lines.push([
      index + 1,
      formatNumber(peak.two_theta, 4),
      formatNumber(peak.d_spacing, 4),
      formatNumber(peak.intensity, 2),
      formatNumber(peak.rel_intensity, 1),
      formatNumber(peak.fwhm_deg, 4),
      formatNumber(peak.snr, 2),
      row?.confidence ?? peak.confidence,
      refPeak?.material ?? '',
      row?.phase ?? refPeak?.phase ?? '',
      row?.hkl ?? refPeak?.hkl ?? '',
      formatNumber(refPeak?.two_theta ?? row?.reference_2theta, 4),
      formatNumber(refPeak?.d_spacing, 4),
      formatNumber(refPeak?.rel_i, 1),
      formatNumber(refPeak?.tolerance, 4),
      row?.note ?? peak.note ?? '',
    ].join('\t'))
  })

  return `${lines.join('\n')}\n`
}

export function downloadTextFile(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
