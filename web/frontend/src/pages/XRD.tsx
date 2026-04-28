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
    <div className="flex h-full flex-col gap-4 xl:flex-row">
      <aside className="glass-panel flex shrink-0 flex-col overflow-hidden rounded-[28px] border border-white/10 xl:w-[23rem]">
        <div className="border-b border-white/10 px-4 py-4 sm:px-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="font-display text-lg tracking-[0.08em] text-white">XRD 工作區</h2>
            <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
              Live
            </span>
          </div>
          <p className="text-xs leading-5 text-slate-400">
            上傳一份或多份 XRD 圖譜，依序平滑、歸一化、比對參考峰，並匯出處理後光譜。
          </p>
        </div>

        <div className="sidebar-scroll flex-1 overflow-y-auto p-3 sm:p-4">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">檔案</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">{rawFiles.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">X 軸</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {xMode === 'twotheta' ? '2θ' : 'd'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">參考相</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">{selectedRefs.length}</p>
            </div>
          </div>

          <div className="mb-3 overflow-hidden rounded-[22px] border border-white/10 bg-white/5">
            <div className="border-b border-white/10 bg-white/5 px-3 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">
                1. 載入檔案
              </span>
            </div>
            <div className="space-y-3 p-3">
              <FileUpload onFiles={handleFiles} isLoading={isLoading} />
              {rawFiles.length > 0 && (
                <div className="space-y-1.5">
                  {rawFiles.map(f => (
                    <div
                      key={f.name}
                      className="flex items-center gap-2 rounded-xl border border-white/8 bg-slate-950/35 px-2.5 py-2 text-xs text-slate-300"
                    >
                      <span className="text-emerald-300">✓</span>
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-slate-500">({f.x.length} pts)</span>
                    </div>
                  ))}
                  <button
                    onClick={() => { setRawFiles([]); setResult(null); setRefPeaks([]) }}
                    className="text-xs font-medium text-rose-300 transition-colors hover:text-rose-200"
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
          />
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="glass-panel rounded-[24px] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">目前模組</p>
            <p className="mt-2 font-display text-lg tracking-[0.08em] text-white">XRD</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">圖譜處理、參考峰疊加、匯出，一站完成。</p>
          </div>
          <div className="glass-panel rounded-[24px] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">波長</p>
            <p className="mt-2 text-lg font-semibold text-white">{wavelength.toFixed(4)} Å</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">預設光源控制 2θ 與 d-spacing 的 X 軸換算。</p>
          </div>
          <div className="glass-panel rounded-[24px] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">資料集</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {activeDataset ? activeDataset.name : '等待中'}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              {result
                ? `已載入 ${result.datasets.length} 個資料集`
                : '從左側載入檔案以開始處理流程。'}
            </p>
          </div>
          <div className="glass-panel rounded-[24px] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">參考峰疊加</p>
            <p className="mt-2 text-lg font-semibold text-white">{selectedRefs.length} 個已啟用</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">疊加參考粉末峰位，快速辨識相位候選。</p>
          </div>
          <div className="glass-panel rounded-[24px] px-4 py-4 sm:col-span-2 xl:col-span-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">高斯模板扣除</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {params.gaussian_enabled ? `${activeGaussianFits.length} 個中心已擬合` : '未啟用'}
                </p>
              </div>
              {params.gaussian_enabled && (
                <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                    FWHM {params.gaussian_fwhm.toFixed(3)} deg
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                    height {params.gaussian_height.toFixed(3)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                    area {(params.gaussian_height * params.gaussian_fwhm * 1.0645).toFixed(3)}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="glass-panel rounded-[24px] px-4 py-4 sm:col-span-2 xl:col-span-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">弱峰檢視</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {logViewParams.enabled ? `${logViewParams.method} 已啟用` : '未啟用'}
                </p>
              </div>
              {logViewParams.enabled && (
                <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                    method {logViewParams.method}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                    floor {logViewParams.floor_value}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="glass-panel rounded-[24px] px-4 py-4 sm:col-span-2 xl:col-span-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">自動尋峰</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {peakParams.enabled ? `已偵測 ${detectedPeaks.length} 個峰` : '未啟用'}
                </p>
              </div>
              {peakParams.enabled && (
                <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                    顯著性 {peakParams.prominence.toFixed(2)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                    最小峰距 {peakParams.min_distance.toFixed(2)} deg
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                    最多 {peakParams.max_peaks} 個
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="glass-panel rounded-[24px] px-4 py-4 sm:col-span-2 xl:col-span-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Scherrer</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {scherrerParams.enabled ? '晶粒尺寸計算已啟用' : '未啟用'}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  以偵測峰的 FWHM 直接估算晶粒尺寸。結果對展寬假設非常敏感，僅供快速篩選，不建議直接用於發表。
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <label className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-slate-500">啟用</span>
                  <input
                    type="checkbox"
                    checked={scherrerParams.enabled}
                    onChange={e => setScherrerParams(p => ({ ...p, enabled: e.target.checked }))}
                    className="accent-cyan-300"
                  />
                </label>
                <label className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-slate-500">K</span>
                  <input
                    type="number"
                    value={scherrerParams.k}
                    min={0.1}
                    max={2}
                    step={0.01}
                    onChange={e => setScherrerParams(p => ({ ...p, k: Number(e.target.value) }))}
                    className="w-full rounded border border-white/10 bg-slate-950/50 px-2 py-1.5 text-slate-100 focus:outline-none"
                  />
                </label>
                <label className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-slate-500">儀器展寬 (deg)</span>
                  <input
                    type="number"
                    value={scherrerParams.instrument_broadening_deg}
                    min={0}
                    max={5}
                    step={0.001}
                    onChange={e => setScherrerParams(p => ({ ...p, instrument_broadening_deg: Number(e.target.value) }))}
                    className="w-full rounded border border-white/10 bg-slate-950/50 px-2 py-1.5 text-slate-100 focus:outline-none"
                  />
                </label>
                <label className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-slate-500">展寬修正</span>
                  <select
                    value={scherrerParams.broadening_correction}
                    onChange={e => setScherrerParams(p => ({
                      ...p,
                      broadening_correction: e.target.value as ScherrerParams['broadening_correction'],
                    }))}
                    className="w-full rounded border border-white/10 bg-slate-950/50 px-2 py-1.5 text-slate-100 focus:outline-none"
                  >
                    <option value="none">不修正</option>
                    <option value="gaussian">Gaussian</option>
                    <option value="lorentzian">Lorentzian</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-panel rounded-[30px] p-4 sm:p-5 lg:p-6">
          {error && (
            <div className="mb-4 rounded-[22px] border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              ⚠️ {error}
            </div>
          )}

          {isLoading && (
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100">
              <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
              處理中…
            </div>
          )}

          {!result && !isLoading && (
            <div className="flex min-h-[28rem] flex-col items-center justify-center rounded-[28px] border border-dashed border-white/12 bg-slate-950/25 px-6 text-center">
              <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[24px] border border-cyan-300/20 bg-cyan-300/10 text-4xl">
                ⟐
              </div>
              <p className="font-display text-2xl tracking-[0.08em] text-white">從這裡開始 XRD 分析</p>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
                從左側面板載入一份或多份光譜，再依序調整平滑、歸一化，並在同一頁面比對候選參考峰。
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">TXT</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">CSV</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">XY</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">ASC</span>
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
  )
}
