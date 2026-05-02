import type {
  DetectedPeak,
  FitPeakCandidate,
  FitParams,
  FitResult,
  ParsedFile,
  PeakDetectionParams,
  ProcessParams,
  ProcessResult,
  RefPeak,
} from '../types/raman'
import { readApiError } from './http'

const BASE = '/api/raman'

export async function parseFiles(files: File[]): Promise<ParsedFile[]> {
  const form = new FormData()
  for (const file of files) form.append('files', file)

  const res = await fetch(`${BASE}/parse`, { method: 'POST', body: form })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Raman 檔案解析失敗'))
  }
  const data = await res.json()
  return data.files as ParsedFile[]
}

export async function processData(
  datasets: ParsedFile[],
  params: ProcessParams,
): Promise<ProcessResult> {
  const res = await fetch(`${BASE}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets, params }),
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Raman 資料處理失敗'))
  }
  return res.json() as Promise<ProcessResult>
}

export async function detectPeaks(
  x: number[],
  y: number[],
  options: PeakDetectionParams,
): Promise<DetectedPeak[]> {
  const res = await fetch(`${BASE}/peaks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x,
      y,
      prominence: options.prominence,
      height_ratio: options.height_ratio,
      min_distance: options.min_distance,
      max_peaks: options.max_peaks,
    }),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'Raman 尋峰失敗'))
  const data = await res.json()
  return data.peaks as DetectedPeak[]
}

export async function fetchReferences(): Promise<string[]> {
  const res = await fetch(`${BASE}/references`)
  if (!res.ok) throw new Error(await readApiError(res, 'Raman 參考資料載入失敗'))
  const data = await res.json()
  return data.materials as string[]
}

export async function fetchReferencePeaks(materials: string[]): Promise<RefPeak[]> {
  const res = await fetch(`${BASE}/reference-peaks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materials }),
  })
  if (!res.ok) throw new Error(await readApiError(res, 'Raman 參考峰載入失敗'))
  const data = await res.json()
  return data.peaks as RefPeak[]
}

export async function fetchPeakLibrary(): Promise<RefPeak[]> {
  const res = await fetch(`${BASE}/peak-library`)
  if (!res.ok) throw new Error(await readApiError(res, 'Raman peak library 載入失敗'))
  const data = await res.json()
  return (data.peaks ?? []).map((row: Record<string, unknown>) => ({
    material: row.material,
    phase: row.phase,
    phase_group: row.phase_group,
    position_cm: row.pos,
    theoretical_center: row.theoretical_center,
    label: row.label,
    mode: row.mode,
    species: row.species,
    tolerance_cm: row.tolerance_cm,
    fwhm_min: row.fwhm_min,
    fwhm_max: row.fwhm_max,
    profile: row.profile,
    allowed_profiles: row.allowed_profiles ?? [],
    peak_type: row.peak_type,
    anchor_peak: Boolean(row.anchor_peak),
    can_be_quantified: row.can_be_quantified !== false,
    related_technique: row.related_technique,
    reference: row.reference,
    reference_source: row.reference_source,
    symmetry: row.symmetry,
    oxidation_state: row.oxidation_state,
    oxidation_state_inference: row.oxidation_state_inference,
    enabled_by_default: row.enabled_by_default !== false,
    candidate_only: Boolean(row.candidate_only),
    artifact: Boolean(row.artifact),
    substrate: Boolean(row.substrate),
    disabled_until_user_selects: Boolean(row.disabled_until_user_selects),
    strength: row.strength,
    note: row.note,
  })) as RefPeak[]
}

export async function fitSpectrum(
  datasetName: string,
  x: number[],
  y: number[],
  peaks: FitPeakCandidate[],
  params: FitParams,
): Promise<FitResult> {
  const res = await fetch(`${BASE}/fit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataset_name: datasetName,
      x,
      y,
      input_is_preprocessed: true,
      peaks,
      profile: params.profile,
      maxfev: params.maxfev,
      fit_lo: params.fit_lo,
      fit_hi: params.fit_hi,
      robust_loss: params.robust_loss,
      segment_weights: params.segment_weights,
      residual_target_enabled: params.residual_target_enabled,
      residual_target: params.residual_target,
      residual_target_rounds: params.residual_target_rounds,
      baseline_method: params.baseline_method ?? 'arpls',
      baseline_lambda: params.baseline_lambda ?? 1e5,
      baseline_p: params.baseline_p ?? 0.01,
      baseline_iter: params.baseline_iter ?? 20,
      bootstrap_rounds: params.bootstrap_rounds ?? 8,
    }),
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Raman peak fitting 失敗'))
  }
  return res.json() as Promise<FitResult>
}
