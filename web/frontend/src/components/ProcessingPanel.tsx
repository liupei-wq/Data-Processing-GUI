/**
 * Left-sidebar processing controls for the XRD page.
 *
 * Each section is collapsible. Controls call onChange whenever a value changes
 * so the parent page can trigger reprocessing immediately.
 */

import { useState, type ReactNode } from 'react'
import type {
  LogViewParams,
  PeakDetectionParams,
  ProcessParams,
  ReferenceMatchParams,
  XMode,
  WavelengthPreset,
} from '../types/xrd'

// ── re-exported so callers don't need to import from types ───────────────────
export type { XMode, WavelengthPreset }

export const DEFAULT_PARAMS: ProcessParams = {
  interpolate: false,
  n_points: 1000,
  average: false,
  gaussian_enabled: false,
  gaussian_fwhm: 0.2,
  gaussian_height: 100,
  gaussian_search_half_width: 0.5,
  gaussian_centers: [
    { enabled: true, name: 'Peak 1', center: 30 },
  ],
  smooth_method: 'none',
  smooth_window: 11,
  smooth_poly: 3,
  norm_method: 'none',
  norm_x_start: null,
  norm_x_end: null,
}

export const WAVELENGTH_MAP: Record<WavelengthPreset, number> = {
  'Cu Kα (1.5406 Å)': 1.5406,
  'Co Kα (1.7890 Å)': 1.7890,
  'Mo Kα (0.7093 Å)': 0.7093,
  'Cr Kα (2.2909 Å)': 2.2909,
  'Fe Kα (1.9373 Å)': 1.9373,
  Custom: 1.5406,
}

// ── small UI helpers ─────────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true }: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{title}</span>
        <span className="text-slate-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="p-3 space-y-2.5 bg-white">{children}</div>}
    </div>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-medium text-slate-600 mb-0.5">{children}</label>
}

function Select({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function NumberInput({ value, onChange, min, max, step = 1, label }: {
  value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; label?: string
}) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  )
}

function Checkbox({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="accent-blue-600"
      />
      <span className="text-xs text-slate-700">{label}</span>
    </label>
  )
}

// ── main component ───────────────────────────────────────────────────────────

interface Props {
  params: ProcessParams
  onChange: (p: ProcessParams) => void
  fileCount: number
  xMode: XMode
  onXModeChange: (m: XMode) => void
  wavelengthPreset: WavelengthPreset
  onWavelengthPresetChange: (p: WavelengthPreset) => void
  customWavelength: number
  onCustomWavelengthChange: (v: number) => void
  refMaterials: string[]
  selectedRefs: string[]
  onSelectedRefsChange: (refs: string[]) => void
  logViewParams: LogViewParams
  onLogViewParamsChange: (p: LogViewParams) => void
  refMatchParams: ReferenceMatchParams
  onRefMatchParamsChange: (p: ReferenceMatchParams) => void
  peakParams: PeakDetectionParams
  onPeakParamsChange: (p: PeakDetectionParams) => void
}

export default function ProcessingPanel({
  params,
  onChange,
  fileCount,
  xMode,
  onXModeChange,
  wavelengthPreset,
  onWavelengthPresetChange,
  customWavelength,
  onCustomWavelengthChange,
  refMaterials,
  selectedRefs,
  onSelectedRefsChange,
  logViewParams,
  onLogViewParamsChange,
  refMatchParams,
  onRefMatchParamsChange,
  peakParams,
  onPeakParamsChange,
}: Props) {
  const set = <K extends keyof ProcessParams>(key: K, value: ProcessParams[K]) =>
    onChange({ ...params, [key]: value })
  const setLogView = <K extends keyof LogViewParams>(key: K, value: LogViewParams[K]) =>
    onLogViewParamsChange({ ...logViewParams, [key]: value })
  const setRefMatch = <K extends keyof ReferenceMatchParams>(
    key: K,
    value: ReferenceMatchParams[K],
  ) => onRefMatchParamsChange({ ...refMatchParams, [key]: value })
  const setPeak = <K extends keyof PeakDetectionParams>(key: K, value: PeakDetectionParams[K]) =>
    onPeakParamsChange({ ...peakParams, [key]: value })

  const toggleRef = (mat: string) => {
    onSelectedRefsChange(
      selectedRefs.includes(mat)
        ? selectedRefs.filter(m => m !== mat)
        : [...selectedRefs, mat],
    )
  }

  return (
    <div className="space-y-2">

      {/* ── 2. Interpolation / Average ───────────────────────────────────── */}
      <Section title="2. 內插化 / 平均化" defaultOpen={false}>
        <Checkbox
          checked={params.interpolate}
          onChange={v => set('interpolate', v)}
          label="統一點數"
        />
        {params.interpolate && (
          <NumberInput label="點數" value={params.n_points} min={100} max={5000} step={100}
            onChange={v => set('n_points', v)} />
        )}
        <Checkbox
          checked={params.average}
          onChange={v => set('average', v)}
          label={`平均所有檔案${fileCount < 2 ? ' (需 2 個以上)' : ''}`}
        />
      </Section>

      {/* ── 3. Gaussian subtraction ─────────────────────────────────────── */}
      <Section title="3. 高斯模板扣除" defaultOpen={false}>
        <Checkbox
          checked={params.gaussian_enabled}
          onChange={v => set('gaussian_enabled', v)}
          label="啟用高斯模板扣除"
        />
        {params.gaussian_enabled && (
          <>
            <NumberInput
              label="固定 FWHM (deg)"
              value={params.gaussian_fwhm}
              min={0.001}
              max={5}
              step={0.001}
              onChange={v => set('gaussian_fwhm', v)}
            />
            <NumberInput
              label="固定高度"
              value={params.gaussian_height}
              min={0.000001}
              max={1000000000}
              step={1}
              onChange={v => set('gaussian_height', v)}
            />
            <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-500">
              換算面積 = {(params.gaussian_height * params.gaussian_fwhm * 1.0645).toFixed(4)}
            </div>
            <NumberInput
              label="中心搜尋半寬 (deg)"
              value={params.gaussian_search_half_width}
              min={0.001}
              max={10}
              step={0.01}
              onChange={v => set('gaussian_search_half_width', v)}
            />

            <div className="space-y-2">
              <Label>高斯中心列表</Label>
              {params.gaussian_centers.map((center, idx) => (
                <div key={`${center.name}-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Checkbox
                      checked={center.enabled}
                      onChange={v => set('gaussian_centers', params.gaussian_centers.map((item, itemIdx) => (
                        itemIdx === idx ? { ...item, enabled: v } : item
                      )))}
                      label={`中心 ${idx + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => set('gaussian_centers', params.gaussian_centers.filter((_, itemIdx) => itemIdx !== idx))}
                      className="text-xs text-rose-500 hover:underline"
                    >
                      刪除
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <Label>峰名稱</Label>
                      <input
                        type="text"
                        value={center.name}
                        onChange={e => set('gaussian_centers', params.gaussian_centers.map((item, itemIdx) => (
                          itemIdx === idx ? { ...item, name: e.target.value } : item
                        )))}
                        className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <NumberInput
                      label="中心 2θ (deg)"
                      value={center.center}
                      min={0}
                      max={180}
                      step={0.01}
                      onChange={v => set('gaussian_centers', params.gaussian_centers.map((item, itemIdx) => (
                        itemIdx === idx ? { ...item, center: v } : item
                      )))}
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const lastCenter = params.gaussian_centers.length > 0
                    ? params.gaussian_centers[params.gaussian_centers.length - 1].center
                    : 30
                  set('gaussian_centers', [
                    ...params.gaussian_centers,
                    {
                      enabled: true,
                      name: `Peak ${params.gaussian_centers.length + 1}`,
                      center: lastCenter,
                    },
                  ])
                }}
                className="w-full rounded border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 transition-colors hover:border-blue-400 hover:text-blue-600"
              >
                新增高斯中心
              </button>
            </div>
            <p className="text-xs text-slate-400">
              這一步會先用固定面積與固定 FWHM 的高斯模板，只允許中心位置在局部範圍內移動，適合把已知峰附近的影響先扣掉。
            </p>
          </>
        )}
      </Section>

      {/* ── 4. Smooth ────────────────────────────────────────────────────── */}
      <Section title="4. 平滑">
        <div>
          <Label>方法</Label>
          <Select
            value={params.smooth_method}
            onChange={v => set('smooth_method', v as ProcessParams['smooth_method'])}
            options={[
              { value: 'none', label: '不平滑' },
              { value: 'moving_average', label: 'Moving Average' },
              { value: 'savitzky_golay', label: 'Savitzky-Golay' },
            ]}
          />
        </div>
        {params.smooth_method !== 'none' && (
          <NumberInput label="視窗點數 (奇數)" value={params.smooth_window} min={3} max={51} step={2}
            onChange={v => set('smooth_window', v % 2 === 0 ? v + 1 : v)} />
        )}
        {params.smooth_method === 'savitzky_golay' && (
          <NumberInput label="多項式次數" value={params.smooth_poly} min={1} max={5}
            onChange={v => set('smooth_poly', v)} />
        )}
        {params.smooth_method === 'none' && (
          <p className="text-xs text-slate-400">SNR 高時通常可跳過</p>
        )}
      </Section>

      {/* ── 5. Normalize ─────────────────────────────────────────────────── */}
      <Section title="5. 歸一化">
        <div>
          <Label>方法</Label>
          <Select
            value={params.norm_method}
            onChange={v => set('norm_method', v as ProcessParams['norm_method'])}
            options={[
              { value: 'none', label: '不歸一化' },
              { value: 'min_max', label: 'Min-Max → [0, 1]' },
              { value: 'max', label: '除以最大值' },
              { value: 'area', label: '除以面積' },
            ]}
          />
        </div>
      </Section>

      {/* ── 6. Log weak-peak view ───────────────────────────────────────── */}
      <Section title="6. 取對數（弱峰檢視）" defaultOpen={false}>
        <Checkbox
          checked={logViewParams.enabled}
          onChange={v => setLogView('enabled', v)}
          label="建立 log 顯示曲線"
        />
        {logViewParams.enabled && (
          <>
            <div>
              <Label>方法</Label>
              <Select
                value={logViewParams.method}
                onChange={v => setLogView('method', v as LogViewParams['method'])}
                options={[
                  { value: 'log10', label: 'log10' },
                  { value: 'ln', label: '自然對數 ln' },
                ]}
              />
            </div>
            <NumberInput
              label="地板值 floor"
              value={logViewParams.floor_value}
              min={0.000000001}
              max={1}
              step={0.000001}
              onChange={v => setLogView('floor_value', v)}
            />
            <p className="text-xs text-slate-400">
              這一步只用來看弱峰與寬尾巴，不改主圖、尋峰、Scherrer 或參考峰匹配的計算基礎。
            </p>
          </>
        )}
      </Section>

      {/* ── 7. Wavelength ────────────────────────────────────────────────── */}
      <Section title="7. 波長 / X 軸">
        <div>
          <Label>光源</Label>
          <Select
            value={wavelengthPreset}
            onChange={v => onWavelengthPresetChange(v as WavelengthPreset)}
            options={Object.keys(WAVELENGTH_MAP).map(k => ({ value: k, label: k }))}
          />
        </div>
        {wavelengthPreset === 'Custom' && (
          <NumberInput label="自訂波長 (Å)" value={customWavelength} min={0.05} max={3} step={0.0001}
            onChange={onCustomWavelengthChange} />
        )}
        <div>
          <Label>X 軸顯示</Label>
          <div className="flex gap-2">
            {(['twotheta', 'dspacing'] as XMode[]).map(m => (
              <button
                key={m}
                onClick={() => onXModeChange(m)}
                className={[
                  'flex-1 text-xs py-1 rounded border transition-colors',
                  xMode === m
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-300 text-slate-600 hover:border-blue-400',
                ].join(' ')}
              >
                {m === 'twotheta' ? '2θ' : 'd-spacing'}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 8. Reference Peaks ───────────────────────────────────────────── */}
      <Section title="8. 參考峰比對" defaultOpen={false}>
        <NumberInput
          label="最小參考相對強度 (%)"
          value={refMatchParams.min_rel_intensity}
          min={1}
          max={100}
          step={1}
          onChange={v => setRefMatch('min_rel_intensity', v)}
        />
        <NumberInput
          label="匹配容差 (deg)"
          value={refMatchParams.tolerance_deg}
          min={0.01}
          max={2}
          step={0.01}
          onChange={v => setRefMatch('tolerance_deg', v)}
        />
        <Checkbox
          checked={refMatchParams.only_show_matched}
          onChange={v => setRefMatch('only_show_matched', v)}
          label="比對表只顯示匹配項"
        />
        {refMaterials.length === 0 ? (
          <p className="text-xs text-slate-400">載入中…</p>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {refMaterials.map(mat => (
              <label key={mat} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selectedRefs.includes(mat)}
                  onChange={() => toggleRef(mat)}
                  className="accent-blue-600 shrink-0"
                />
                <span className="text-xs text-slate-700 group-hover:text-blue-600 transition-colors leading-tight">
                  {mat}
                </span>
              </label>
            ))}
          </div>
        )}
        {selectedRefs.length > 0 && (
          <button
            onClick={() => onSelectedRefsChange([])}
            className="text-xs text-red-500 hover:underline"
          >
            清除全部
          </button>
        )}
        <p className="text-xs text-slate-400">
          會拿目前自動尋峰結果去找最近的參考峰，適合做快速相辨識，不等同完整 PDF/JCPDS 卡。
        </p>
      </Section>

      <Section title="9. 自動尋峰" defaultOpen={false}>
        <Checkbox
          checked={peakParams.enabled}
          onChange={v => setPeak('enabled', v)}
          label="啟用尋峰結果"
        />
        {peakParams.enabled && (
          <>
            <NumberInput
              label="顯著性 prominence"
              value={peakParams.prominence}
              min={0.001}
              max={1}
              step={0.01}
              onChange={v => setPeak('prominence', v)}
            />
            <NumberInput
              label="最小峰距 (deg)"
              value={peakParams.min_distance}
              min={0.05}
              max={10}
              step={0.05}
              onChange={v => setPeak('min_distance', v)}
            />
            <NumberInput
              label="最多峰數"
              value={peakParams.max_peaks}
              min={1}
              max={100}
              step={1}
              onChange={v => setPeak('max_peaks', v)}
            />
            <p className="text-xs text-slate-400">
              尋峰會使用目前顯示的處理後曲線，適合先快速確認主要峰位。
            </p>
          </>
        )}
      </Section>
    </div>
  )
}
