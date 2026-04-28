import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import Plot from 'react-plotly.js'
import type { AnalysisModuleId } from '../components/AnalysisModuleNav'
import AnalysisModuleNav from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import { parseFiles, processData } from '../api/xas'
import type {
  DatasetInput,
  ParsedXasFile,
  ProcessParams,
  ProcessResult,
  ProcessedDataset,
} from '../types/xas'

const SIDEBAR_MIN_WIDTH = 300
const SIDEBAR_MAX_WIDTH = 520
const SIDEBAR_DEFAULT_WIDTH = 340
const SIDEBAR_COLLAPSED_PEEK = 28

const DEFAULT_PARAMS: ProcessParams = {
  interpolate: false,
  n_points: 2000,
  average: false,
  energy_shift: 0,
  bg_enabled: false,
  bg_channel: 'both',
  bg_method: 'linear',
  bg_x_start: null,
  bg_x_end: null,
  bg_poly_deg: 3,
  bg_baseline_lambda: 1e5,
  bg_baseline_p: 0.01,
  bg_baseline_iter: 20,
  norm_method: 'none',
  norm_x_start: null,
  norm_x_end: null,
  norm_pre_start: null,
  norm_pre_end: null,
  white_line_start: null,
  white_line_end: null,
}

function chartLayout(xLabel: string, yLabel: string): Partial<Plotly.Layout> {
  const css = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const grid = css?.getPropertyValue('--chart-grid').trim() || 'rgba(148,163,184,0.14)'
  const text = css?.getPropertyValue('--chart-text').trim() || '#d9e4f0'
  const bg = css?.getPropertyValue('--chart-bg').trim() || 'rgba(15,23,42,0.52)'
  const legendBg = css?.getPropertyValue('--chart-legend-bg').trim() || 'rgba(15,23,42,0.72)'
  const hoverBg = css?.getPropertyValue('--chart-hover-bg').trim() || 'rgba(15,23,42,0.95)'
  const hoverBorder = css?.getPropertyValue('--chart-hover-border').trim() || 'rgba(148,163,184,0.22)'
  return {
    xaxis: { title: { text: xLabel }, showgrid: true, gridcolor: grid, zeroline: false, color: text },
    yaxis: { title: { text: yLabel }, showgrid: true, gridcolor: grid, zeroline: false, color: text },
    legend: { x: 1, xanchor: 'right', y: 1, bgcolor: legendBg, bordercolor: hoverBorder, borderwidth: 1, font: { color: text } },
    margin: { l: 60, r: 20, t: 28, b: 58 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: bg,
    font: { color: text },
    hovermode: 'x unified',
    hoverlabel: { bgcolor: hoverBg, bordercolor: hoverBorder, font: { color: text } },
    autosize: true,
  }
}

function buildTraces(dataset: ProcessedDataset, channel: 'TEY' | 'TFY', showRaw: boolean): Plotly.Data[] {
  const raw = channel === 'TEY' ? dataset.tey_raw : dataset.tfy_raw
  const processed = channel === 'TEY' ? dataset.tey_processed : dataset.tfy_processed
  const traces: Plotly.Data[] = []
  if (showRaw) {
    traces.push({ x: dataset.x, y: raw, type: 'scatter', mode: 'lines', name: '原始', line: { color: '#94a3b8', width: 1.4 } })
  }
  traces.push({ x: dataset.x, y: processed, type: 'scatter', mode: 'lines', name: '處理後', line: { color: channel === 'TEY' ? '#38bdf8' : '#a78bfa', width: 2.0 } })
  const wl = channel === 'TEY' ? dataset.white_line_tey : dataset.white_line_tfy
  if (wl != null) {
    traces.push({
      x: [wl, wl],
      y: [Math.min(...processed), Math.max(...processed)],
      type: 'scatter',
      mode: 'lines',
      name: `White Line ${wl.toFixed(2)} eV`,
      line: { color: '#f97316', width: 1.4, dash: 'dash' },
    })
  }
  return traces
}

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers.map(csvEscape).join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n')
}
function downloadFile(content: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

function SectionHeader({ n, label }: { n: number; label: string }) {
  return (
    <div className="border-b border-[var(--card-divider)] bg-[color:color-mix(in_srgb,var(--card-bg)_60%,transparent)] px-4 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-soft)]">
        {n}. {label}
      </span>
    </div>
  )
}

function NumInput({ label, value, onChange, min, max, step = 1, disabled = false }: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <input
        type="number" value={value} min={min} max={max} step={step} disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none disabled:opacity-40"
      />
    </label>
  )
}

function SelectInput({ label, value, onChange, options, disabled = false }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">{label}</span>
      <select
        value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--input-text)] focus:outline-none disabled:opacity-40"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-main)]">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-[var(--accent-strong)]" />
      {label}
    </label>
  )
}

export default function XAS({ onModuleSelect }: { onModuleSelect?: (m: AnalysisModuleId) => void }) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('nigiro-xas-sidebar-width'))
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH ? saved : SIDEBAR_DEFAULT_WIDTH
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('nigiro-xas-sidebar-collapsed') === 'true')
  const [sidebarResizing, setSidebarResizing] = useState(false)

  const [rawFiles, setRawFiles] = useState<ParsedXasFile[]>([])
  const [flipTfy, setFlipTfy] = useState(true)
  const [params, setParams] = useState<ProcessParams>(DEFAULT_PARAMS)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(true)

  const activeDataset = result?.average ?? result?.datasets[0] ?? null

  // reprocess whenever rawFiles or params change
  useEffect(() => {
    if (rawFiles.length === 0) { setResult(null); return }
    let cancelled = false
    setIsLoading(true); setError(null)
    const datasets: DatasetInput[] = rawFiles.map(f => ({ name: f.name, x: f.x, tey: f.tey, tfy: f.tfy }))
    processData(datasets, params)
      .then(r => { if (!cancelled) setResult(r) })
      .catch(e => { if (!cancelled) setError(String(e.message)) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [rawFiles, params])

  // sidebar resize
  useEffect(() => {
    localStorage.setItem('nigiro-xas-sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])
  useEffect(() => {
    localStorage.setItem('nigiro-xas-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); setSidebarResizing(true)
    const startX = e.clientX; const startW = sidebarWidth
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startW + ev.clientX - startX))
      setSidebarWidth(w)
    }
    const onUp = () => { setSidebarResizing(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  const handleFiles = useCallback(async (files: File[]) => {
    setIsLoading(true); setError(null)
    try {
      const res = await parseFiles(files, flipTfy)
      if (res.errors.length) setError(res.errors.join('; '))
      setRawFiles(res.files)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setIsLoading(false) }
  }, [flipTfy])

  const set = <K extends keyof ProcessParams>(key: K) => (val: ProcessParams[K]) =>
    setParams(p => ({ ...p, [key]: val }))

  const energyMin = rawFiles.length > 0 ? Math.min(...rawFiles.map(f => f.x[0])) : 440
  const energyMax = rawFiles.length > 0 ? Math.max(...rawFiles.map(f => f.x[f.x.length - 1])) : 490

  const sidebarStyle: CSSProperties = sidebarCollapsed
    ? { width: SIDEBAR_COLLAPSED_PEEK, minWidth: SIDEBAR_COLLAPSED_PEEK, overflow: 'hidden' }
    : { width: sidebarWidth, minWidth: SIDEBAR_MIN_WIDTH, maxWidth: SIDEBAR_MAX_WIDTH }

  return (
    <div className={`flex h-screen flex-row overflow-hidden${sidebarResizing ? ' select-none' : ''}`}>
      {/* ── sidebar ── */}
      <aside
        style={sidebarStyle}
        className="relative flex shrink-0 flex-col overflow-hidden border-r border-[var(--card-divider)] bg-[var(--panel-bg)] transition-[width] duration-200"
      >
        {sidebarCollapsed ? (
          <button
            type="button" onClick={() => setSidebarCollapsed(false)}
            className="flex h-full w-full flex-col items-center justify-center gap-1 text-[var(--text-soft)] hover:text-[var(--text-main)]"
            title="展開側欄"
          >
            <span className="text-lg">›</span>
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-[var(--card-divider)] px-5 py-4">
              <span className="font-display text-base font-semibold tracking-wide text-[var(--text-main)]">XAS / XANES</span>
              <button type="button" onClick={() => setSidebarCollapsed(true)} className="text-xs text-[var(--text-soft)] hover:text-[var(--text-main)]">‹</button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <AnalysisModuleNav activeModule="xas" onSelectModule={onModuleSelect} />

              {/* 1. 載入 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={1} label="載入資料" />
                <div className="space-y-3 p-4">
                  <FileUpload onFiles={handleFiles} isLoading={isLoading} accept={['.dat', '.txt', '.csv', '.xmu', '.nor']} />
                  <CheckRow label="TFY 使用 1 − TFY 翻轉" checked={flipTfy} onChange={v => { setFlipTfy(v); setRawFiles([]) }} />
                  {rawFiles.length > 0 && (
                    <div className="space-y-1">
                      {rawFiles.map(f => (
                        <div key={f.name} className="flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs text-[var(--text-main)]">
                          <span className="text-[var(--accent-tertiary)]">✓</span>
                          <span className="truncate">{f.name}</span>
                          <span className="ml-auto shrink-0 text-[var(--text-soft)]">{f.x.length} pts</span>
                        </div>
                      ))}
                      <button onClick={() => { setRawFiles([]); setResult(null) }} className="text-xs text-rose-400 hover:text-rose-300">
                        清除全部
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. 內插與平均 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={2} label="內插 / 平均" />
                <div className="space-y-3 p-4">
                  <CheckRow label="啟用內插" checked={params.interpolate} onChange={set('interpolate')} />
                  {params.interpolate && (
                    <NumInput label="點數" value={params.n_points} onChange={set('n_points')} min={200} max={10000} step={100} />
                  )}
                  {rawFiles.length > 1 && <CheckRow label="多檔平均" checked={params.average} onChange={set('average')} />}
                </div>
              </div>

              {/* 3. 能量校正 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={3} label="能量校正" />
                <div className="p-4">
                  <NumInput label="能量位移 (eV)" value={params.energy_shift} onChange={set('energy_shift')} step={0.01} />
                  <p className="mt-2 text-[10px] text-[var(--text-soft)]">正值向高能方向移，負值向低能移。</p>
                </div>
              </div>

              {/* 4. 背景扣除 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={4} label="背景扣除" />
                <div className="space-y-3 p-4">
                  <CheckRow label="啟用背景扣除" checked={params.bg_enabled} onChange={set('bg_enabled')} />
                  {params.bg_enabled && (
                    <>
                      <SelectInput label="套用通道" value={params.bg_channel} onChange={v => set('bg_channel')(v as ProcessParams['bg_channel'])}
                        options={[{ value: 'both', label: 'TEY + TFY' }, { value: 'TEY', label: '僅 TEY' }, { value: 'TFY', label: '僅 TFY' }]}
                      />
                      <SelectInput label="方法" value={params.bg_method} onChange={v => set('bg_method')(v as ProcessParams['bg_method'])}
                        options={[{ value: 'linear', label: 'Linear' }, { value: 'polynomial', label: 'Polynomial' }, { value: 'asls', label: 'AsLS' }, { value: 'airpls', label: 'airPLS' }]}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <NumInput label="起始 (eV)" value={params.bg_x_start ?? energyMin} onChange={v => set('bg_x_start')(v)} step={0.1} />
                        <NumInput label="結束 (eV)" value={params.bg_x_end ?? energyMax} onChange={v => set('bg_x_end')(v)} step={0.1} />
                      </div>
                      {params.bg_method === 'polynomial' && (
                        <NumInput label="多項式次數" value={params.bg_poly_deg} onChange={set('bg_poly_deg')} min={1} max={10} />
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 5. 歸一化 */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={5} label="歸一化" />
                <div className="space-y-3 p-4">
                  <SelectInput label="方法" value={params.norm_method} onChange={v => set('norm_method')(v as ProcessParams['norm_method'])}
                    options={[
                      { value: 'none', label: '不歸一化' },
                      { value: 'min_max', label: 'Min–Max' },
                      { value: 'max', label: 'Max' },
                      { value: 'area', label: 'Area' },
                      { value: 'post_edge', label: 'Post-edge Step' },
                    ]}
                  />
                  {params.norm_method === 'post_edge' && (
                    <>
                      <p className="text-[10px] text-[var(--text-soft)]">Pre-edge 區間（用於估算 edge step）</p>
                      <div className="grid grid-cols-2 gap-2">
                        <NumInput label="Pre 起始 (eV)" value={params.norm_pre_start ?? energyMin} onChange={v => set('norm_pre_start')(v)} step={0.1} />
                        <NumInput label="Pre 結束 (eV)" value={params.norm_pre_end ?? (energyMin + (energyMax - energyMin) * 0.3)} onChange={v => set('norm_pre_end')(v)} step={0.1} />
                      </div>
                      <p className="text-[10px] text-[var(--text-soft)]">Post-edge 參考區間</p>
                      <div className="grid grid-cols-2 gap-2">
                        <NumInput label="Post 起始 (eV)" value={params.norm_x_start ?? (energyMin + (energyMax - energyMin) * 0.7)} onChange={v => set('norm_x_start')(v)} step={0.1} />
                        <NumInput label="Post 結束 (eV)" value={params.norm_x_end ?? energyMax} onChange={v => set('norm_x_end')(v)} step={0.1} />
                      </div>
                    </>
                  )}
                  {(params.norm_method === 'area' || params.norm_method === 'min_max') && (
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="起始 (eV)" value={params.norm_x_start ?? energyMin} onChange={v => set('norm_x_start')(v)} step={0.1} />
                      <NumInput label="結束 (eV)" value={params.norm_x_end ?? energyMax} onChange={v => set('norm_x_end')(v)} step={0.1} />
                    </div>
                  )}
                </div>
              </div>

              {/* 6. White Line */}
              <div className="border-b border-[var(--card-divider)]">
                <SectionHeader n={6} label="White Line 搜尋" />
                <div className="space-y-3 p-4">
                  <p className="text-[10px] text-[var(--text-soft)]">設定搜尋區間，自動找到最高點能量。</p>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="起始 (eV)" value={params.white_line_start ?? energyMin} onChange={v => set('white_line_start')(v)} step={0.1} />
                    <NumInput label="結束 (eV)" value={params.white_line_end ?? energyMax} onChange={v => set('white_line_end')(v)} step={0.1} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setParams(p => ({ ...p, white_line_start: energyMin, white_line_end: energyMax }))}
                    className="text-[10px] text-[var(--accent-strong)] hover:underline"
                  >
                    重設為全範圍
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* resize handle */}
        {!sidebarCollapsed && (
          <div
            onMouseDown={startResize}
            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-[var(--accent-soft)]"
          />
        )}
      </aside>

      {/* ── main content ── */}
      <main className="flex flex-1 flex-col overflow-y-auto bg-[var(--bg-canvas)] p-4 sm:p-5">
        {/* error */}
        {error && (
          <div className="mb-4 rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            ⚠ {error}
          </div>
        )}

        {/* loading */}
        {isLoading && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--text-soft)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-strong)]" />
            處理中…
          </div>
        )}

        {/* empty state */}
        {!result && !isLoading && (
          <div className="flex flex-1 flex-col items-center justify-center rounded-[28px] border border-dashed border-[var(--card-border)] bg-[var(--card-bg)] px-6 py-20 text-center">
            <div className="mb-4 text-5xl opacity-30">⚡</div>
            <p className="font-display text-xl tracking-wide text-[var(--text-main)]">XAS / XANES 分析</p>
            <p className="mt-3 max-w-md text-sm leading-6 text-[var(--text-soft)]">
              從左側面板上傳 DAT / XMU / NOR 檔案，自動解析 Energy、TEY、TFY 欄位，進行背景扣除與歸一化。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs text-[var(--text-soft)]">
              {['.DAT', '.XMU', '.NOR', '.TXT', '.CSV'].map(ext => (
                <span key={ext} className="rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5">{ext}</span>
              ))}
            </div>
          </div>
        )}

        {result && activeDataset && (
          <>
            {/* summary cards */}
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 shadow-[var(--card-shadow-soft)]">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">資料集</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-main)]">{result.datasets.length} 個</p>
                {params.average && result.average && <p className="mt-1 text-xs text-[var(--text-soft)]">已平均</p>}
              </div>
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 shadow-[var(--card-shadow-soft)]">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">能量範圍</p>
                <p className="mt-1 text-base font-semibold text-[var(--text-main)]">
                  {activeDataset.x[0].toFixed(1)} – {activeDataset.x[activeDataset.x.length - 1].toFixed(1)} eV
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 shadow-[var(--card-shadow-soft)]">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">White Line</p>
                <p className="mt-1 text-base font-semibold text-[var(--text-main)]">
                  {activeDataset.white_line_tey != null
                    ? `TEY ${activeDataset.white_line_tey.toFixed(2)} eV`
                    : '未設定搜尋範圍'}
                </p>
                {activeDataset.white_line_tfy != null && (
                  <p className="text-xs text-[var(--text-soft)]">TFY {activeDataset.white_line_tfy.toFixed(2)} eV</p>
                )}
              </div>
            </div>

            {/* display control */}
            <div className="mb-3 flex items-center gap-3">
              <CheckRow label="顯示原始資料" checked={showRaw} onChange={setShowRaw} />
            </div>

            {/* TEY chart */}
            <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow-soft)]">
              <p className="mb-2 text-sm font-semibold text-[var(--text-main)]">TEY（Total Electron Yield）</p>
              <Plot
                data={buildTraces(activeDataset, 'TEY', showRaw) as Plotly.Data[]}
                layout={chartLayout('Energy (eV)', 'TEY Intensity') as Plotly.Layout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%', height: 340 }}
              />
            </div>

            {/* TFY chart */}
            <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow-soft)]">
              <p className="mb-2 text-sm font-semibold text-[var(--text-main)]">TFY（Total Fluorescence Yield）</p>
              <Plot
                data={buildTraces(activeDataset, 'TFY', showRaw) as Plotly.Data[]}
                layout={chartLayout('Energy (eV)', 'TFY Intensity') as Plotly.Layout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%', height: 340 }}
              />
            </div>

            {/* edge step table */}
            {activeDataset.edge_step_tey != null && (
              <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow-soft)]">
                <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">Post-edge 歸一化摘要</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--card-divider)] text-[var(--text-soft)]">
                      <th className="pb-2 text-left font-medium">通道</th>
                      <th className="pb-2 text-right font-medium">Edge Step</th>
                      <th className="pb-2 text-right font-medium">White Line (eV)</th>
                    </tr>
                  </thead>
                  <tbody className="text-[var(--text-main)]">
                    <tr className="border-b border-[var(--card-divider)]">
                      <td className="py-2">TEY</td>
                      <td className="py-2 text-right">{activeDataset.edge_step_tey?.toFixed(4) ?? '—'}</td>
                      <td className="py-2 text-right">{activeDataset.white_line_tey?.toFixed(2) ?? '—'}</td>
                    </tr>
                    <tr>
                      <td className="py-2">TFY</td>
                      <td className="py-2 text-right">{activeDataset.edge_step_tfy?.toFixed(4) ?? '—'}</td>
                      <td className="py-2 text-right">{activeDataset.white_line_tfy?.toFixed(2) ?? '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* export */}
            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-[var(--card-shadow-soft)]">
              <p className="mb-3 text-sm font-semibold text-[var(--text-main)]">匯出</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const ds = activeDataset
                    const headers = ['energy_eV', 'TEY_raw', 'TFY_raw', 'TEY_processed', 'TFY_processed']
                    const rows = ds.x.map((x, i) => [x, ds.tey_raw[i], ds.tfy_raw[i], ds.tey_processed[i], ds.tfy_processed[i]])
                    downloadFile(toCsv(headers, rows), 'xas_processed.csv', 'text/csv')
                  }}
                  className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)] transition-colors"
                >
                  處理後光譜 CSV
                </button>
                {activeDataset.white_line_tey != null && (
                  <button
                    type="button"
                    onClick={() => {
                      const ds = activeDataset
                      const headers = ['channel', 'white_line_eV', 'edge_step']
                      const rows: (string | number | null)[][] = [
                        ['TEY', ds.white_line_tey, ds.edge_step_tey],
                        ['TFY', ds.white_line_tfy, ds.edge_step_tfy],
                      ]
                      downloadFile(toCsv(headers, rows), 'xas_summary.csv', 'text/csv')
                    }}
                    className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)] transition-colors"
                  >
                    摘要 CSV
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
