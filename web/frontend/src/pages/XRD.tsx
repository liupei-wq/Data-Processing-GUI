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
import type { ParsedFile, ProcessResult, RefPeak, XMode, WavelengthPreset } from '../types/xrd'
import { parseFiles, processData, fetchReferences, fetchReferencePeaks } from '../api/xrd'
import FileUpload from '../components/FileUpload'
import SpectrumChart from '../components/SpectrumChart'
import ProcessingPanel, {
  DEFAULT_PARAMS,
  WAVELENGTH_MAP,
} from '../components/ProcessingPanel'
import type { ProcessParams } from '../types/xrd'

// ── helpers ──────────────────────────────────────────────────────────────────

function csvContent(result: ProcessResult): string {
  const ds = result.average ?? result.datasets[0]
  if (!ds) return ''
  const headers = ['2theta_deg', ...result.datasets.map(d => `${d.name}_processed`)]
  const rows = ds.x.map((x, i) => [
    x.toFixed(4),
    ...result.datasets.map(d => d.y_processed[i]?.toFixed(4) ?? ''),
  ])
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
}

function downloadCsv(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── component ─────────────────────────────────────────────────────────────────

export default function XRD() {
  const [rawFiles, setRawFiles] = useState<ParsedFile[]>([])
  const [params, setParams] = useState<ProcessParams>(DEFAULT_PARAMS)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [refMaterials, setRefMaterials] = useState<string[]>([])
  const [selectedRefs, setSelectedRefs] = useState<string[]>([])
  const [refPeaks, setRefPeaks] = useState<RefPeak[]>([])
  const [xMode, setXMode] = useState<XMode>('twotheta')
  const [wavelengthPreset, setWavelengthPreset] = useState<WavelengthPreset>('Cu Kα (1.5406 Å)')
  const [customWavelength, setCustomWavelength] = useState(1.5406)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wavelength =
    wavelengthPreset === 'Custom' ? customWavelength : WAVELENGTH_MAP[wavelengthPreset]

  // ── Load reference materials once on mount ────────────────────────────────
  useEffect(() => {
    fetchReferences().then(setRefMaterials).catch(console.error)
  }, [])

  // ── Re-process whenever raw data or params change ─────────────────────────
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

  // ── Reload reference peaks when selection or wavelength changes ───────────
  useEffect(() => {
    if (selectedRefs.length === 0) { setRefPeaks([]); return }
    fetchReferencePeaks(selectedRefs, wavelength)
      .then(setRefPeaks)
      .catch(console.error)
  }, [selectedRefs, wavelength])

  // ── Handle file upload ────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: File[]) => {
    setIsLoading(true)
    setError(null)
    try {
      const parsed = await parseFiles(files)
      setRawFiles(parsed)
      // Reset range params when switching data
      setParams(p => ({ ...p, norm_x_start: null, norm_x_end: null }))
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-slate-200 bg-white">
          <h2 className="text-sm font-bold text-slate-800">XRD 數據處理</h2>
        </div>

        <div className="flex-1 overflow-y-auto sidebar-scroll p-3 space-y-2">

          {/* Step 1: Upload */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50">
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                1. 載入檔案
              </span>
            </div>
            <div className="p-3 bg-white space-y-2">
              <FileUpload onFiles={handleFiles} isLoading={isLoading} />
              {rawFiles.length > 0 && (
                <div className="space-y-1">
                  {rawFiles.map(f => (
                    <div key={f.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <span className="text-green-500">✓</span>
                      <span className="truncate">{f.name}</span>
                      <span className="text-slate-400 shrink-0">({f.x.length} pts)</span>
                    </div>
                  ))}
                  <button
                    onClick={() => { setRawFiles([]); setResult(null); setRefPeaks([]) }}
                    className="text-xs text-red-400 hover:underline"
                  >
                    清除全部
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Steps 2-6 */}
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
          />
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5">

        {/* Error banner */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            ⚠️ {error}
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="mb-2 text-xs text-blue-600 animate-pulse">處理中…</div>
        )}

        {/* Empty state */}
        {!result && !isLoading && (
          <div className="flex flex-col items-center justify-center h-80 text-slate-400">
            <div className="text-5xl mb-4">📊</div>
            <p className="text-base font-medium">從左側上傳 XRD 資料檔案開始</p>
            <p className="text-sm mt-1">支援 .txt / .csv / .xy / .asc</p>
          </div>
        )}

        {/* Chart */}
        {result && (
          <>
            <SpectrumChart
              result={result}
              refPeaks={refPeaks}
              xMode={xMode}
              wavelength={wavelength}
            />

            {/* Export */}
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => {
                  const csv = csvContent(result)
                  downloadCsv(csv, 'xrd_processed.csv')
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
              >
                ⬇ 下載處理後光譜 CSV
              </button>
              <span className="text-xs text-slate-400">
                {result.datasets.length} 個資料集
                {result.average ? ' (含平均)' : ''}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
