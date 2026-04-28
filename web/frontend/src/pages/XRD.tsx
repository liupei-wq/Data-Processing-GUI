/**
 * XRD page – main state management + layout.
 *
 * Layout:
 *   [Left sidebar: ProcessingPanel]  [Right main: chart + export]
 *
 * Data flow:
 *   1. User uploads files → parseFiles() → store in `rawFiles` state
 *   2. Any param change → processData() → update `result` state → chart re-renders
 *   3. On reference material select → fetchReferencePeaks() → overlay on chart
 */

import { useState, useEffect, useCallback } from 'react'
import type {
  DetectedPeak,
  LogViewParams,
  ParsedFile,
  PeakDetectionParams,
  ProcessResult,
  RefPeak,
  ReferenceMatchParams,
  ReferenceMatchRow,
  ScherrerParams,
  XMode,
  WavelengthPreset,
} from '../types/xrd'
import { detectPeaks, parseFiles, processData, fetchReferences, fetchReferencePeaks } from '../api/xrd'
import FileUpload from '../components/FileUpload'
import GaussianSubtractionChart from '../components/GaussianSubtractionChart'
import SpectrumChart from '../components/SpectrumChart'
import ProcessingPanel, {
  DEFAULT_PARAMS,
  WAVELENGTH_MAP,
} from '../components/ProcessingPanel'
import type { ProcessParams } from '../types/xrd'

type CsvCell = string | number | null | undefined

function csvEscape(value: CsvCell): string {
  if (value == null) return ''
  const raw = String(value)
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [
    headers.map(csvEscape).join(','),
    ...rows.map(row => row.map(csvEscape).join(',')),
  ].join('\n')
}

function downloadFile(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function twoThetaToD(twoThetaDeg: number, wavelengthAngstrom: number): number | null {
  if (!(twoThetaDeg > 0 && wavelengthAngstrom > 0)) return null
  const theta = (twoThetaDeg * Math.PI) / 360
  const sinTheta = Math.sin(theta)
  if (!(sinTheta > 0)) return null
  return wavelengthAngstrom / (2 * sinTheta)
}

function safeLogValue(value: number, shift: number, method: LogViewParams['method'], floorValue: number) {
  const shifted = Math.max(value + shift, floorValue)
  return method === 'ln' ? Math.log(shifted) : Math.log10(shifted)
}

function processedSpectrumCsv(result: ProcessResult): string {
  const ds = result.average ?? result.datasets[0]
  if (!ds) return ''
  const headers = ['2theta_deg', ...result.datasets.map(d => `${d.name}_processed`)]
  const rows = ds.x.map((x, i) => [
    x.toFixed(4),
    ...result.datasets.map(d => d.y_processed[i]?.toFixed(4) ?? ''),
  ])
  return toCsv(headers, rows)
}

function detailedDatasetCsv(
  dataset: ProcessResult['datasets'][number],
  wavelength: number,
  logViewParams: LogViewParams,
): string {
  const headers = ['2theta_deg', 'd_spacing_A', 'raw', 'gaussian_model', 'gaussian_subtracted', 'processed']
  const processedMin = dataset.y_processed.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY)
  const logShift = logViewParams.enabled && processedMin <= 0
    ? Math.abs(processedMin) + logViewParams.floor_value
    : logViewParams.floor_value
  if (logViewParams.enabled) headers.push(`${logViewParams.method}_processed`)
  const rows = dataset.x.map((x, idx) => {
    const processed = dataset.y_processed[idx]
    const dSpacing = twoThetaToD(x, wavelength)
    const row: CsvCell[] = [
      x.toFixed(4),
      dSpacing == null ? '' : dSpacing.toFixed(4),
      dataset.y_raw[idx]?.toFixed(6) ?? '',
      dataset.y_gaussian_model?.[idx]?.toFixed(6) ?? '',
      dataset.y_gaussian_subtracted?.[idx]?.toFixed(6) ?? '',
      processed?.toFixed(6) ?? '',
    ]
    if (logViewParams.enabled) {
      row.push(Number.isFinite(processed) ? safeLogValue(processed, logShift, logViewParams.method, logViewParams.floor_value).toFixed(6) : '')
    }
    return row
  })
  return toCsv(headers, rows)
}

function scherrerCrystalliteSizeNm(
  twoThetaDeg: number,
  fwhmDeg: number,
  wavelengthAngstrom: number,
  k: number,
  instrumentBroadeningDeg: number,
  broadeningCorrection: ScherrerParams['broadening_correction'],
) {
  if (!(twoThetaDeg > 0 && fwhmDeg > 0 && wavelengthAngstrom > 0)) return null

  let beta = fwhmDeg
  const bInst = instrumentBroadeningDeg
  if (broadeningCorrection === 'gaussian' && beta > bInst && bInst > 0) {
    beta = Math.sqrt(Math.max(0, beta ** 2 - bInst ** 2))
  } else if (broadeningCorrection === 'lorentzian' && beta > bInst && bInst > 0) {
    beta = beta - bInst
  }

  if (!(beta > 0)) return null

  const betaRad = (beta * Math.PI) / 180
  const thetaRad = (twoThetaDeg * Math.PI) / 360
  const cosTheta = Math.cos(thetaRad)
  if (!(betaRad > 0 && cosTheta > 0)) return null

  return (k * wavelengthAngstrom) / (betaRad * cosTheta) / 10
}

function buildReferenceMatches(
  referencePeaks: RefPeak[],
  observedPeaks: DetectedPeak[],
  toleranceDeg: number,
): ReferenceMatchRow[] {
  if (referencePeaks.length === 0) return []

  return [...referencePeaks]
    .sort((a, b) => a.two_theta - b.two_theta)
    .map((refPeak) => {
      if (observedPeaks.length === 0) {
        return {
          material: refPeak.material,
          hkl: refPeak.hkl,
          ref_two_theta: refPeak.two_theta,
          ref_d_spacing: refPeak.d_spacing,
          ref_rel_i: refPeak.rel_i,
          observed_two_theta: null,
          observed_d_spacing: null,
          observed_intensity: null,
          delta_two_theta: null,
          matched: false,
        }
      }

      const closest = observedPeaks.reduce((best, peak) => {
        const delta = Math.abs(peak.two_theta - refPeak.two_theta)
        if (best == null || delta < best.delta) return { peak, delta }
        return best
      }, null as { peak: DetectedPeak; delta: number } | null)

      return {
        material: refPeak.material,
        hkl: refPeak.hkl,
        ref_two_theta: refPeak.two_theta,
        ref_d_spacing: refPeak.d_spacing,
        ref_rel_i: refPeak.rel_i,
        observed_two_theta: closest?.peak.two_theta ?? null,
        observed_d_spacing: closest?.peak.d_spacing ?? null,
        observed_intensity: closest?.peak.intensity ?? null,
        delta_two_theta: closest?.delta ?? null,
        matched: closest != null && closest.delta <= toleranceDeg,
      }
    })
}

const MODULE_CHOICES = [
  { id: 'xrd', label: 'XRD', detail: 'X-ray Diffraction', active: true },
  { id: 'raman', label: 'Raman', detail: 'Coming soon', active: false },
  { id: 'xps', label: 'XPS', detail: 'Coming soon', active: false },
  { id: 'xas', label: 'XAS', detail: 'Coming soon', active: false },
] as const

export default function XRD() {
  const [rawFiles, setRawFiles] = useState<ParsedFile[]>([])
  const [params, setParams] = useState<ProcessParams>(DEFAULT_PARAMS)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [refMaterials, setRefMaterials] = useState<string[]>([])
  const [selectedRefs, setSelectedRefs] = useState<string[]>([])
  const [refPeaks, setRefPeaks] = useState<RefPeak[]>([])
  const [logViewParams, setLogViewParams] = useState<LogViewParams>({
    enabled: false,
    method: 'log10',
    floor_value: 0.000001,
  })
  const [refMatchParams, setRefMatchParams] = useState<ReferenceMatchParams>({
    min_rel_intensity: 10,
    tolerance_deg: 0.3,
    only_show_matched: true,
  })
  const [xMode, setXMode] = useState<XMode>('twotheta')
  const [wavelengthPreset, setWavelengthPreset] = useState<WavelengthPreset>('Cu Kα (1.5406 Å)')
  const [customWavelength, setCustomWavelength] = useState(1.5406)
  const [peakParams, setPeakParams] = useState<PeakDetectionParams>({
    enabled: false,
    prominence: 0.05,
    min_distance: 0.3,
    max_peaks: 30,
  })
  const [scherrerParams, setScherrerParams] = useState<ScherrerParams>({
    enabled: false,
    k: 0.9,
    instrument_broadening_deg: 0,
    broadening_correction: 'none',
  })
  const [detectedPeaks, setDetectedPeaks] = useState<DetectedPeak[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wavelength =
    wavelengthPreset === 'Custom' ? customWavelength : WAVELENGTH_MAP[wavelengthPreset]
  const activeDataset = result?.average ?? result?.datasets[0] ?? null
  const activeGaussianFits = activeDataset?.gaussian_fits ?? []
  const filteredRefPeaks = refPeaks.filter(peak => peak.rel_i >= refMatchParams.min_rel_intensity)
  const referenceMatches = buildReferenceMatches(
    filteredRefPeaks,
    detectedPeaks,
    refMatchParams.tolerance_deg,
  )
  const visibleReferenceMatches = refMatchParams.only_show_matched
    ? referenceMatches.filter(row => row.matched)
    : referenceMatches
  const matchedReferenceCount = referenceMatches.filter(row => row.matched).length
  const scherrerRows = detectedPeaks.map(peak => ({
    ...peak,
    crystallite_nm: scherrerCrystalliteSizeNm(
      peak.two_theta,
      peak.fwhm_deg,
      wavelength,
      scherrerParams.k,
      scherrerParams.instrument_broadening_deg,
      scherrerParams.broadening_correction,
    ),
  }))
  const processingReport = {
    report_type: 'xrd_processing_report',
    created_at: new Date().toISOString(),
    module: 'xrd',
    input_files: rawFiles.map(file => file.name),
    selected_dataset: activeDataset?.name ?? null,
    dataset_count: result?.datasets.length ?? 0,
    wavelength: {
      preset: wavelengthPreset,
      angstrom: wavelength,
    },
    processing: params,
    log_view: logViewParams,
    reference_matching: {
      selected_refs: selectedRefs,
      ...refMatchParams,
      matched_count: matchedReferenceCount,
      total_reference_lines: referenceMatches.length,
    },
    peak_detection: {
      ...peakParams,
      detected_count: detectedPeaks.length,
    },
    scherrer: {
      ...scherrerParams,
      rows: scherrerRows,
    },
    gaussian_fit_rows: activeGaussianFits,
    reference_peaks: filteredRefPeaks,
    reference_matches: referenceMatches,
  }

  useEffect(() => {
    fetchReferences().then(setRefMaterials).catch(console.error)
  }, [])

  useEffect(() => {
    if (rawFiles.length === 0) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    processData(rawFiles, params)
      .then(r => { if (!cancelled) setResult(r) })
      .catch(e => { if (!cancelled) setError(String(e.message)) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [rawFiles, params])

  useEffect(() => {
    if (selectedRefs.length === 0) {
      setRefPeaks([])
      return
    }
    fetchReferencePeaks(selectedRefs, wavelength)
      .then(setRefPeaks)
      .catch(console.error)
  }, [selectedRefs, wavelength])

  useEffect(() => {
    if (!peakParams.enabled || !activeDataset) {
      setDetectedPeaks([])
      return
    }

    let cancelled = false
    detectPeaks(activeDataset.x, activeDataset.y_processed, {
      prominence: peakParams.prominence,
      min_distance: peakParams.min_distance,
      max_peaks: peakParams.max_peaks,
      wavelength,
    })
      .then(peaks => {
        if (!cancelled) setDetectedPeaks(peaks)
      })
      .catch(e => {
        if (!cancelled) setError(String(e.message))
      })

    return () => { cancelled = true }
  }, [activeDataset, peakParams, wavelength])

  const handleFiles = useCallback(async (files: File[]) => {
    setIsLoading(true)
    setError(null)
    try {
      const parsed = await parseFiles(files)
      setRawFiles(parsed)
      setDetectedPeaks([])
      setParams(p => ({ ...p, norm_x_start: null, norm_x_end: null }))
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return (
    <div className="min-h-screen xl:grid xl:grid-cols-[23rem_minmax(0,1fr)]">
      <aside className="glass-panel flex min-h-screen flex-col overflow-hidden xl:rounded-none xl:border-l-0 xl:border-t-0 xl:border-b-0">
        <div className="border-b border-[var(--card-divider)] px-6 py-8">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] border border-[var(--pill-border)] bg-[radial-gradient(circle_at_30%_30%,color-mix(in_srgb,var(--accent-strong)_38%,white_8%),var(--card-bg-strong))] shadow-[var(--card-shadow)]">
              <span className="font-display text-3xl font-bold tracking-[0.04em] text-[var(--accent-contrast)]">N</span>
            </div>
            <div>
              <div className="font-display text-[2rem] font-semibold leading-none text-[var(--text-muted)]">
                Nigiro Pro
              </div>
              <div className="mt-2 text-[0.95rem] font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                Data Processing
              </div>
            </div>
          </div>
        </div>

        <div className="border-b border-[var(--card-divider)] px-6 py-5">
          <p className="text-sm font-semibold text-[var(--text-main)]">分析模組</p>
          <div className="mt-3 space-y-2">
            {MODULE_CHOICES.map(module => (
              <button
                key={module.id}
                type="button"
                disabled={!module.active}
                className={[
                  'flex w-full items-center justify-between px-4 py-3 text-left transition-colors shadow-[var(--card-shadow-soft)]',
                  module.active
                    ? 'theme-pill rounded-[24px] text-[var(--text-main)]'
                    : 'theme-block-soft rounded-[16px] text-[var(--text-soft)] opacity-85',
                ].join(' ')}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={[
                      'h-4 w-4 rounded-full border',
                      module.active
                        ? 'border-[var(--accent-secondary)] bg-[var(--accent-secondary)]'
                        : 'border-[var(--card-border)] bg-transparent',
                    ].join(' ')}
                  />
                  <div>
                    <div className="text-sm font-semibold">{module.label}</div>
                    <div className="text-[11px] text-[var(--text-soft)]">{module.detail}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="border-b border-[var(--card-divider)] px-6 py-5">
          <div className="grid grid-cols-3 gap-2">
            <div className="theme-block-soft rounded-[18px] px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">檔案</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">{rawFiles.length}</p>
            </div>
            <div className="theme-block-soft rounded-[14px] px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">X 軸</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">
                {xMode === 'twotheta' ? '2θ' : 'd'}
              </p>
            </div>
            <div className="theme-block-soft rounded-[22px] px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">參考相</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text-main)]">{selectedRefs.length}</p>
            </div>
          </div>
        </div>

        <div className="sidebar-scroll flex-1 overflow-y-auto px-4 py-5">
          <div className="theme-block mb-3 overflow-hidden rounded-[24px]">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--accent-tertiary)_16%,transparent)] text-sm font-semibold text-[var(--accent-tertiary)]">
                  1
                </span>
                <div>
                  <div className="text-base font-semibold text-[var(--text-muted)]">載入檔案</div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-soft)]">支援多檔上傳與後續平均</div>
                </div>
              </div>
            </div>
            <div className="border-t border-[var(--card-divider)] p-4 pt-3">
              <div className="mb-3 text-sm font-medium text-[var(--text-main)]">上傳 XRD 檔案（可多選）</div>
              <FileUpload onFiles={handleFiles} isLoading={isLoading} />
              {rawFiles.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {rawFiles.map(file => (
                    <div
                      key={file.name}
                      className="theme-block-soft flex items-center gap-2 rounded-[16px] px-3 py-2 text-xs text-[var(--text-main)]"
                    >
                      <span className="text-[var(--accent-tertiary)]">✓</span>
                      <span className="truncate">{file.name}</span>
                      <span className="shrink-0 text-[var(--text-soft)]">({file.x.length} pts)</span>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setRawFiles([])
                      setResult(null)
                      setRefPeaks([])
                      setDetectedPeaks([])
                    }}
                    className="text-xs font-medium text-[var(--accent-secondary)] transition-colors hover:opacity-80"
                  >
                    清除全部
                  </button>
                </div>
              )}
            </div>
          </div>

          <ProcessingPanel
            params={params}
            onChange={setParams}
            fileCount={rawFiles.length}
            xMode={xMode}
            onXModeChange={setXMode}
            wavelengthPreset={wavelengthPreset}
            onWavelengthPresetChange={p => {
              setWavelengthPreset(p)
              if (p !== 'Custom') setCustomWavelength(WAVELENGTH_MAP[p])
            }}
            customWavelength={customWavelength}
            onCustomWavelengthChange={setCustomWavelength}
            refMaterials={refMaterials}
            selectedRefs={selectedRefs}
            onSelectedRefsChange={setSelectedRefs}
            logViewParams={logViewParams}
            onLogViewParamsChange={setLogViewParams}
            refMatchParams={refMatchParams}
            onRefMatchParamsChange={setRefMatchParams}
            peakParams={peakParams}
            onPeakParamsChange={setPeakParams}
            scherrerParams={scherrerParams}
            onScherrerParamsChange={setScherrerParams}
          />
        </div>
      </aside>

      <div className="min-w-0 overflow-y-auto px-5 py-8 sm:px-8 xl:px-10 xl:py-10">
        <div className="mx-auto w-full max-w-[1500px]">
          <div className="mb-8">
            <div className="flex flex-wrap items-baseline gap-3">
              <h1 className="font-display text-4xl font-semibold tracking-[0.02em] text-[var(--text-muted)]">
                XRD
              </h1>
              <span className="text-lg text-[var(--text-soft)]">X-ray Diffraction</span>
            </div>
            <div className="mt-6 h-px w-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--card-border)_85%,transparent),transparent)]" />
          </div>

          <div className="mb-6 flex flex-wrap gap-3">
            <div className="theme-pill rounded-full px-4 py-2 text-sm text-[var(--text-main)]">
              波長 <span className="ml-2 font-semibold text-[var(--text-muted)]">{wavelength.toFixed(4)} Å</span>
            </div>
            <div className="theme-pill rounded-[18px] px-4 py-2 text-sm text-[var(--text-main)]">
              資料集 <span className="ml-2 font-semibold text-[var(--text-muted)]">{activeDataset ? activeDataset.name : '未載入'}</span>
            </div>
            <div className="theme-pill rounded-[24px] px-4 py-2 text-sm text-[var(--text-main)]">
              參考峰 <span className="ml-2 font-semibold text-[var(--text-muted)]">{selectedRefs.length} 個</span>
            </div>
            {peakParams.enabled && (
              <div className="rounded-[16px] border border-[var(--pill-border)] bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent)] shadow-[var(--card-shadow-soft)]">
                自動尋峰 {detectedPeaks.length} 個
              </div>
            )}
          </div>

          <div className="glass-panel rounded-[30px] p-4 sm:p-5 lg:p-6">
          {error && (
            <div className="mb-4 rounded-[22px] border border-[color:color-mix(in_srgb,var(--accent-secondary)_28%,var(--card-border))] bg-[color:color-mix(in_srgb,var(--accent-secondary)_12%,transparent)] px-4 py-3 text-sm text-[var(--text-main)]">
              ⚠️ {error}
            </div>
          )}

          {isLoading && (
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--pill-border)] bg-[var(--pill-bg)] px-3 py-1 text-xs font-medium text-[var(--accent)] shadow-[var(--card-shadow-soft)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-strong)]" />
              處理中…
            </div>
          )}

          {!result && !isLoading && (
            <div className="min-h-[38rem]">
              <div className="rounded-[24px] border border-[var(--pill-border)] bg-[var(--pill-bg)] px-6 py-5 text-xl font-semibold text-[var(--text-main)] shadow-[var(--card-shadow-soft)]">
                請在左側上傳一個或多個 XRD 檔案。
              </div>

              <div className="theme-block-soft relative mt-12 min-h-[26rem] overflow-hidden rounded-[32px]">
                <div className="workspace-float-card left-[24%] top-[6%] h-36 w-56 rounded-[26px] rotate-[-6deg] opacity-70" />
                <div className="workspace-float-card right-[18%] top-[2%] h-32 w-48 rounded-[24px] rotate-[7deg] opacity-70" />
                <div className="workspace-float-card left-[8%] bottom-[8%] h-32 w-44 rounded-[22px] rotate-[-8deg] opacity-65" />
                <div className="workspace-float-card right-[34%] bottom-[12%] h-36 w-52 rounded-[24px] rotate-[4deg] opacity-65" />

                <svg className="absolute left-[25%] top-[10%] h-28 w-52 opacity-40" viewBox="0 0 220 120" fill="none">
                  <path d="M10 92C34 70 56 66 74 72C86 76 95 69 101 58C107 47 117 41 131 45C164 54 196 42 208 34" stroke="#2f6fbd" strokeWidth="6" strokeLinecap="round" />
                  <circle cx="87" cy="67" r="5" fill="#5d85bb" />
                  <circle cx="149" cy="55" r="5" fill="#5d85bb" />
                </svg>
                <svg className="absolute right-[19%] top-[5%] h-24 w-36 opacity-35" viewBox="0 0 160 120" fill="none">
                  <rect x="18" y="34" width="20" height="44" rx="4" fill="#2f6fbd" />
                  <rect x="58" y="18" width="20" height="60" rx="4" fill="#73829a" />
                  <rect x="98" y="34" width="20" height="44" rx="4" fill="#25497b" />
                  <rect x="138" y="18" width="20" height="60" rx="4" fill="#5d6370" />
                </svg>
                <svg className="absolute left-[10%] bottom-[14%] h-24 w-36 opacity-35" viewBox="0 0 160 90" fill="none">
                  <path d="M18 60L114 44" stroke="#566270" strokeWidth="6" strokeLinecap="round" />
                  <path d="M26 82L122 66" stroke="#566270" strokeWidth="6" strokeLinecap="round" />
                  <path d="M30 34L126 62" stroke="#566270" strokeWidth="6" strokeLinecap="round" />
                  <circle cx="30" cy="34" r="9" fill="#2f6fbd" />
                  <circle cx="102" cy="66" r="9" fill="#2f6fbd" />
                  <circle cx="132" cy="56" r="9" fill="#25497b" />
                </svg>
                <svg className="absolute right-[28%] bottom-[15%] h-28 w-48 opacity-35" viewBox="0 0 200 120" fill="none">
                  <path d="M34 54L96 32L158 70" stroke="#2a3442" strokeWidth="6" strokeLinecap="round" />
                  <path d="M34 54L106 90L158 70" stroke="#2a3442" strokeWidth="6" strokeLinecap="round" />
                  <circle cx="34" cy="54" r="12" fill="#295189" />
                  <circle cx="96" cy="32" r="9" fill="#5d6370" />
                  <circle cx="106" cy="90" r="8" fill="#4a5565" />
                  <circle cx="158" cy="70" r="13" fill="#25497b" />
                </svg>
              </div>
            </div>
          )}

          {result && (
            <>
              <SpectrumChart
                result={result}
                refPeaks={filteredRefPeaks}
                detectedPeaks={detectedPeaks}
                xMode={xMode}
                wavelength={wavelength}
              />

              {logViewParams.enabled && (
                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">對數弱峰檢視</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        此顯示模式只改變圖表的縮放方式，方便觀察弱峰與寬尾巴。不影響尋峰、Scherrer 或參考峰匹配的計算基礎。
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {logViewParams.method} with floor {logViewParams.floor_value}
                    </span>
                  </div>
                  <SpectrumChart
                    result={result}
                    refPeaks={[]}
                    detectedPeaks={[]}
                    xMode={xMode}
                    wavelength={wavelength}
                    displayMode={logViewParams.method}
                    logFloorValue={logViewParams.floor_value}
                    showReferencePeaks={false}
                    showDetectedPeaks={false}
                    minHeight={360}
                  />
                </div>
              )}

              {params.gaussian_enabled && (
                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">高斯模板扣除</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        使用固定面積與固定 FWHM 的高斯模板，只允許中心在局部範圍內移動，適合在後續處理前先扣掉已知峰的影響。
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      search ±{params.gaussian_search_half_width.toFixed(3)} deg
                    </span>
                  </div>

                  {activeDataset?.y_gaussian_model && activeDataset?.y_gaussian_subtracted ? (
                    <>
                      <GaussianSubtractionChart
                        dataset={activeDataset}
                        xMode={xMode}
                        wavelength={wavelength}
                      />
                      {activeGaussianFits.length > 0 ? (
                        <div className="mt-4 overflow-x-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                                <th className="px-3 py-3 font-medium">峰名稱</th>
                                <th className="px-3 py-3 font-medium">初始 2θ</th>
                                <th className="px-3 py-3 font-medium">擬合 2θ</th>
                                <th className="px-3 py-3 font-medium">位移</th>
                                <th className="px-3 py-3 font-medium">FWHM</th>
                                <th className="px-3 py-3 font-medium">面積</th>
                                <th className="px-3 py-3 font-medium">峰高</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeGaussianFits.map((fit, idx) => (
                                <tr key={`${fit.Peak_Name}-${idx}`} className="border-b border-white/5 text-slate-200 last:border-b-0">
                                  <td className="px-3 py-3 font-medium">{fit.Peak_Name}</td>
                                  <td className="px-3 py-3">{fit.Seed_Center.toFixed(4)}</td>
                                  <td className="px-3 py-3">{fit.Fitted_Center.toFixed(4)}</td>
                                  <td className="px-3 py-3">{fit.Shift.toFixed(4)}</td>
                                  <td className="px-3 py-3">{fit.Fixed_FWHM.toFixed(4)}</td>
                                  <td className="px-3 py-3">{fit.Fixed_Area.toFixed(4)}</td>
                                  <td className="px-3 py-3">{fit.Template_Height.toFixed(4)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                          目前沒有可用的高斯中心結果。請檢查中心列表是否有啟用、中心位置是否落在目前資料範圍內。
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      高斯模板扣除已啟用，但目前結果集中還沒有可顯示的模型與扣除後曲線。
                    </div>
                  )}
                </div>
              )}

              {peakParams.enabled && (
                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">自動偵測峰位</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        基於目前處理後光譜，可用於快速確認主要峰位，再做進一步解析。
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {detectedPeaks.length} 個峰
                    </span>
                  </div>

                  {detectedPeaks.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      目前條件下沒有找到可用峰位。可以降低 prominence，或調整平滑與歸一化後再試一次。
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">#</th>
                            <th className="px-3 py-3 font-medium">2θ (deg)</th>
                              <th className="px-3 py-3 font-medium">d-spacing (Å)</th>
                              <th className="px-3 py-3 font-medium">強度</th>
                              <th className="px-3 py-3 font-medium">相對強度 (%)</th>
                              <th className="px-3 py-3 font-medium">FWHM (deg)</th>
                            </tr>
                        </thead>
                        <tbody>
                          {detectedPeaks.map((peak, idx) => (
                            <tr key={`${peak.two_theta}-${idx}`} className="border-b border-white/5 text-slate-200 last:border-b-0">
                              <td className="px-3 py-3 text-slate-500">{idx + 1}</td>
                              <td className="px-3 py-3 font-medium">{peak.two_theta.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.d_spacing.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.intensity.toFixed(2)}</td>
                              <td className="px-3 py-3">{peak.rel_intensity.toFixed(1)}</td>
                              <td className="px-3 py-3">{peak.fwhm_deg.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {scherrerParams.enabled && peakParams.enabled && (
                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Scherrer 晶粒尺寸</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        使用目前偵測峰的 FWHM 與 Scherrer 公式估算晶粒尺寸。結果對展寬假設非常敏感，僅供快速篩選。
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      K = {scherrerParams.k.toFixed(2)}, λ = {wavelength.toFixed(4)} Å
                    </span>
                  </div>

                  {scherrerRows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      先啟用自動尋峰並確認有峰位結果，Scherrer 才能計算。
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">#</th>
                            <th className="px-3 py-3 font-medium">2θ (deg)</th>
                            <th className="px-3 py-3 font-medium">FWHM (deg)</th>
                            <th className="px-3 py-3 font-medium">D (nm)</th>
                            <th className="px-3 py-3 font-medium">D (Å)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scherrerRows.map((peak, idx) => (
                            <tr key={`scherrer-${peak.two_theta}-${idx}`} className="border-b border-white/5 text-slate-200 last:border-b-0">
                              <td className="px-3 py-3 text-slate-500">{idx + 1}</td>
                              <td className="px-3 py-3 font-medium">{peak.two_theta.toFixed(4)}</td>
                              <td className="px-3 py-3">{peak.fwhm_deg.toFixed(4)}</td>
                              <td className="px-3 py-3">
                                {peak.crystallite_nm == null ? 'N/A' : peak.crystallite_nm.toFixed(3)}
                              </td>
                              <td className="px-3 py-3">
                                {peak.crystallite_nm == null ? 'N/A' : (peak.crystallite_nm * 10).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {selectedRefs.length > 0 && (
                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">參考峰匹配</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        以目前自動偵測的峰位，為每條選定參考線找最近的觀測峰。這是快速相辨識篩選表，不是完整相鑑定報告。
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {matchedReferenceCount} / {referenceMatches.length} 匹配
                    </span>
                  </div>

                  {!peakParams.enabled ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      參考峰匹配需要先啟用自動尋峰，因為目前網站版會直接使用尋峰結果來做最近峰比對。
                    </div>
                  ) : filteredRefPeaks.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      目前條件下沒有符合最小相對強度門檻的參考峰。可以降低強度門檻或改選其他參考相位。
                    </div>
                  ) : visibleReferenceMatches.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 px-4 py-6 text-sm text-slate-400">
                      目前容差下沒有匹配到參考峰。可以放寬容差，或重新調整平滑與尋峰條件。
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <th className="px-3 py-3 font-medium">相位</th>
                            <th className="px-3 py-3 font-medium">hkl</th>
                            <th className="px-3 py-3 font-medium">Ref 2θ</th>
                            <th className="px-3 py-3 font-medium">Ref d</th>
                            <th className="px-3 py-3 font-medium">Ref I (%)</th>
                            <th className="px-3 py-3 font-medium">Obs 2θ</th>
                            <th className="px-3 py-3 font-medium">Obs d</th>
                            <th className="px-3 py-3 font-medium">Obs 強度</th>
                            <th className="px-3 py-3 font-medium">Δ2θ</th>
                            <th className="px-3 py-3 font-medium">匹配</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleReferenceMatches.map((row, idx) => (
                            <tr
                              key={`${row.material}-${row.hkl}-${row.ref_two_theta}-${idx}`}
                              className="border-b border-white/5 text-slate-200 last:border-b-0"
                            >
                              <td className="px-3 py-3 font-medium">{row.material}</td>
                              <td className="px-3 py-3">{row.hkl || '-'}</td>
                              <td className="px-3 py-3">{row.ref_two_theta.toFixed(4)}</td>
                              <td className="px-3 py-3">{row.ref_d_spacing.toFixed(4)}</td>
                              <td className="px-3 py-3">{row.ref_rel_i.toFixed(1)}</td>
                              <td className="px-3 py-3">
                                {row.observed_two_theta == null ? 'N/A' : row.observed_two_theta.toFixed(4)}
                              </td>
                              <td className="px-3 py-3">
                                {row.observed_d_spacing == null ? 'N/A' : row.observed_d_spacing.toFixed(4)}
                              </td>
                              <td className="px-3 py-3">
                                {row.observed_intensity == null ? 'N/A' : row.observed_intensity.toFixed(2)}
                              </td>
                              <td className="px-3 py-3">
                                {row.delta_two_theta == null ? 'N/A' : row.delta_two_theta.toFixed(4)}
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={[
                                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                                    row.matched
                                      ? 'border border-emerald-300/20 bg-emerald-400/10 text-emerald-200'
                                      : 'border border-rose-300/20 bg-rose-400/10 text-rose-200',
                                  ].join(' ')}
                                >
                                  {row.matched ? '✓ 匹配' : '✗ 不匹配'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                <div className="mb-4">
                  <p className="text-sm font-semibold text-white">匯出</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    下載處理後光譜、峰位表、匹配表、高斯中心結果，以及目前 XRD 流程的 JSON 紀錄。
                  </p>
                </div>

                <div className="grid gap-4 xl:grid-cols-3">
                  <div className="rounded-[22px] border border-white/10 bg-slate-950/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">研究常用</p>
                    <div className="mt-3 flex flex-col gap-2">
                      <button
                        onClick={() => {
                          downloadFile(processedSpectrumCsv(result), 'xrd_processed.csv', 'text/csv')
                        }}
                        className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition-transform hover:-translate-y-0.5 hover:bg-cyan-200"
                      >
                        下載處理後光譜 CSV
                      </button>
                      {activeDataset && (
                        <button
                          onClick={() => {
                            downloadFile(
                              detailedDatasetCsv(activeDataset, wavelength, logViewParams),
                              `${activeDataset.name.replace(/\.[^.]+$/, '')}_detailed.csv`,
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載目前資料集詳細 CSV
                        </button>
                      )}
                      {scherrerParams.enabled && scherrerRows.length > 0 && (
                        <button
                          onClick={() => {
                            downloadFile(
                              toCsv(
                                ['two_theta_deg', 'd_spacing_A', 'intensity', 'relative_intensity_pct', 'fwhm_deg', 'D_nm', 'D_A'],
                                scherrerRows.map(row => [
                                  row.two_theta.toFixed(4),
                                  row.d_spacing.toFixed(4),
                                  row.intensity.toFixed(2),
                                  row.rel_intensity.toFixed(1),
                                  row.fwhm_deg.toFixed(4),
                                  row.crystallite_nm == null ? '' : row.crystallite_nm.toFixed(6),
                                  row.crystallite_nm == null ? '' : (row.crystallite_nm * 10).toFixed(6),
                                ]),
                              ),
                              'xrd_scherrer.csv',
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載 Scherrer CSV
                        </button>
                      )}
                      {activeGaussianFits.length > 0 && (
                        <button
                          onClick={() => {
                            downloadFile(
                              toCsv(
                                ['peak_name', 'seed_center_2theta_deg', 'fitted_center_2theta_deg', 'shift_deg', 'fixed_fwhm_deg', 'fixed_area', 'template_height'],
                                activeGaussianFits.map(row => [
                                  row.Peak_Name,
                                  row.Seed_Center.toFixed(4),
                                  row.Fitted_Center.toFixed(4),
                                  row.Shift.toFixed(4),
                                  row.Fixed_FWHM.toFixed(4),
                                  row.Fixed_Area.toFixed(4),
                                  row.Template_Height.toFixed(4),
                                ]),
                              ),
                              'xrd_gaussian_centers.csv',
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載高斯中心結果 CSV
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-slate-950/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">分析表格</p>
                    <div className="mt-3 flex flex-col gap-2">
                      {peakParams.enabled && detectedPeaks.length > 0 && (
                        <button
                          onClick={() => {
                            downloadFile(
                              toCsv(
                                ['two_theta_deg', 'd_spacing_A', 'intensity', 'relative_intensity_pct', 'fwhm_deg'],
                                detectedPeaks.map(row => [
                                  row.two_theta.toFixed(4),
                                  row.d_spacing.toFixed(4),
                                  row.intensity.toFixed(2),
                                  row.rel_intensity.toFixed(1),
                                  row.fwhm_deg.toFixed(4),
                                ]),
                              ),
                              'xrd_detected_peaks.csv',
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載自動尋峰 CSV
                        </button>
                      )}
                      {filteredRefPeaks.length > 0 && (
                        <button
                          onClick={() => {
                            downloadFile(
                              toCsv(
                                ['material', 'hkl', 'two_theta_deg', 'd_spacing_A', 'relative_intensity_pct'],
                                filteredRefPeaks.map(row => [
                                  row.material,
                                  row.hkl,
                                  row.two_theta.toFixed(4),
                                  row.d_spacing.toFixed(4),
                                  row.rel_i.toFixed(1),
                                ]),
                              ),
                              'xrd_reference_peaks.csv',
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載參考峰 CSV
                        </button>
                      )}
                      {referenceMatches.length > 0 && (
                        <button
                          onClick={() => {
                            downloadFile(
                              toCsv(
                                ['material', 'hkl', 'ref_two_theta_deg', 'ref_d_spacing_A', 'ref_relative_intensity_pct', 'obs_two_theta_deg', 'obs_d_spacing_A', 'obs_intensity', 'delta_two_theta_deg', 'matched'],
                                referenceMatches.map(row => [
                                  row.material,
                                  row.hkl,
                                  row.ref_two_theta.toFixed(4),
                                  row.ref_d_spacing.toFixed(4),
                                  row.ref_rel_i.toFixed(1),
                                  row.observed_two_theta == null ? '' : row.observed_two_theta.toFixed(4),
                                  row.observed_d_spacing == null ? '' : row.observed_d_spacing.toFixed(4),
                                  row.observed_intensity == null ? '' : row.observed_intensity.toFixed(2),
                                  row.delta_two_theta == null ? '' : row.delta_two_theta.toFixed(4),
                                  row.matched ? 'true' : 'false',
                                ]),
                              ),
                              'xrd_reference_matches.csv',
                              'text/csv',
                            )
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          下載參考匹配 CSV
                        </button>
                      )}
                      {!peakParams.enabled && filteredRefPeaks.length === 0 && (
                        <p className="text-xs leading-5 text-slate-500">
                          啟用自動尋峰或參考峰比對後，這裡才會有對應的分析表格可下載。
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-slate-950/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">追溯 / 設定</p>
                    <div className="mt-3 flex flex-col gap-2">
                      <button
                        onClick={() => {
                          downloadFile(
                            JSON.stringify(processingReport, null, 2),
                            'xrd_processing_report.json',
                            'application/json',
                          )
                        }}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                      >
                        下載處理報告 JSON
                      </button>
                      <p className="text-xs leading-5 text-slate-500">
                        會保存目前波長、處理參數、log 設定、高斯中心、尋峰結果、匹配結果與 Scherrer 結果摘要。
                      </p>
                      <span className="text-xs text-slate-500">
                        {result.datasets.length} 個資料集
                        {result.average ? ' (含平均)' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </div>
  )
}
