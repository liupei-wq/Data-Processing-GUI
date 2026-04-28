import { useState, type ReactNode } from 'react'
import type {
  LogViewParams,
  PeakDetectionParams,
  ProcessParams,
  ReferenceMatchParams,
  ScherrerParams,
  XMode,
  WavelengthPreset,
} from '../types/xrd'

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

function Section({
  step,
  title,
  hint,
  children,
  defaultOpen = true,
}: {
  step: number
  title: string
  hint?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="overflow-hidden rounded-[22px] border border-[#2d3d54] bg-[#151b24] shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/18 text-sm font-semibold text-emerald-200">
            {step}
          </span>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-100">{title}</div>
            {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
          </div>
        </div>
        <span className="shrink-0 text-sm text-slate-500">{open ? '−' : '+'}</span>
      </button>

      {open && <div className="border-t border-[#253246] p-4 pt-3 space-y-3">{children}</div>}
    </div>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-[12px] font-medium text-slate-300">{children}</label>
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-xl border border-[#314258] bg-[#202938] px-3 py-2 text-sm text-slate-100 focus:border-sky-400/50 focus:outline-none"
    >
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
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
        className="w-full rounded-xl border border-[#314258] bg-[#202938] px-3 py-2 text-sm text-slate-100 focus:border-sky-400/50 focus:outline-none"
      />
    </div>
  )
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#283548] bg-[#1a212d] px-3 py-2 text-sm text-slate-200 transition-colors hover:border-[#385171]">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 accent-sky-400"
      />
      <span>{label}</span>
    </label>
  )
}

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
  scherrerParams: ScherrerParams
  onScherrerParamsChange: (p: ScherrerParams) => void
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
  scherrerParams,
  onScherrerParamsChange,
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
  const setScherrer = <K extends keyof ScherrerParams>(key: K, value: ScherrerParams[K]) =>
    onScherrerParamsChange({ ...scherrerParams, [key]: value })

  const toggleRef = (mat: string) => {
    onSelectedRefsChange(
      selectedRefs.includes(mat)
        ? selectedRefs.filter(item => item !== mat)
        : [...selectedRefs, mat],
    )
  }

  return (
    <div className="space-y-3">
      <Section step={2} title="多檔平均" hint="內插與統一點數" defaultOpen={false}>
        <Checkbox
          checked={params.interpolate}
          onChange={value => set('interpolate', value)}
          label="統一點數後再處理"
        />
        {params.interpolate && (
          <NumberInput
            label="插值點數"
            value={params.n_points}
            min={100}
            max={5000}
            step={100}
            onChange={value => set('n_points', value)}
          />
        )}
        <Checkbox
          checked={params.average}
          onChange={value => set('average', value)}
          label={`對所有載入檔案做平均${fileCount < 2 ? '（至少 2 個）' : ''}`}
        />
      </Section>

      <Section step={3} title="高斯模板扣除" hint="已知峰先扣除" defaultOpen={false}>
        <Checkbox
          checked={params.gaussian_enabled}
          onChange={value => set('gaussian_enabled', value)}
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
              onChange={value => set('gaussian_fwhm', value)}
            />
            <NumberInput
              label="固定高度"
              value={params.gaussian_height}
              min={0.000001}
              max={1000000000}
              step={1}
              onChange={value => set('gaussian_height', value)}
            />
            <div className="rounded-xl border border-[#283548] bg-[#1a212d] px-3 py-2 text-sm text-slate-300">
              換算面積 = {(params.gaussian_height * params.gaussian_fwhm * 1.0645).toFixed(4)}
            </div>
            <NumberInput
              label="中心搜尋半寬 (deg)"
              value={params.gaussian_search_half_width}
              min={0.001}
              max={10}
              step={0.01}
              onChange={value => set('gaussian_search_half_width', value)}
            />

            <div className="space-y-2">
              <Label>高斯中心列表</Label>
              {params.gaussian_centers.map((center, idx) => (
                <div key={`${center.name}-${idx}`} className="rounded-2xl border border-[#283548] bg-[#1a212d] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Checkbox
                      checked={center.enabled}
                      onChange={value =>
                        set(
                          'gaussian_centers',
                          params.gaussian_centers.map((item, itemIdx) =>
                            itemIdx === idx ? { ...item, enabled: value } : item,
                          ),
                        )
                      }
                      label={`中心 ${idx + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        set(
                          'gaussian_centers',
                          params.gaussian_centers.filter((_, itemIdx) => itemIdx !== idx),
                        )
                      }
                      className="text-xs text-rose-300 transition-colors hover:text-rose-200"
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
                        onChange={e =>
                          set(
                            'gaussian_centers',
                            params.gaussian_centers.map((item, itemIdx) =>
                              itemIdx === idx ? { ...item, name: e.target.value } : item,
                            ),
                          )
                        }
                        className="w-full rounded-xl border border-[#314258] bg-[#202938] px-3 py-2 text-sm text-slate-100 focus:border-sky-400/50 focus:outline-none"
                      />
                    </div>
                    <NumberInput
                      label="中心 2θ (deg)"
                      value={center.center}
                      min={0}
                      max={180}
                      step={0.01}
                      onChange={value =>
                        set(
                          'gaussian_centers',
                          params.gaussian_centers.map((item, itemIdx) =>
                            itemIdx === idx ? { ...item, center: value } : item,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const lastCenter =
                    params.gaussian_centers.length > 0
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
                className="w-full rounded-xl border border-dashed border-[#395271] px-3 py-2 text-sm text-sky-200 transition-colors hover:border-sky-400/50 hover:bg-sky-400/8"
              >
                新增高斯中心
              </button>
            </div>
          </>
        )}
      </Section>

      <Section step={4} title="平滑" hint="降噪但避免洗平峰型">
        <div>
          <Label>方法</Label>
          <Select
            value={params.smooth_method}
            onChange={value => set('smooth_method', value as ProcessParams['smooth_method'])}
            options={[
              { value: 'none', label: '不平滑' },
              { value: 'moving_average', label: 'Moving Average' },
              { value: 'savitzky_golay', label: 'Savitzky-Golay' },
            ]}
          />
        </div>
        {params.smooth_method !== 'none' && (
          <NumberInput
            label="視窗點數（奇數）"
            value={params.smooth_window}
            min={3}
            max={51}
            step={2}
            onChange={value => set('smooth_window', value % 2 === 0 ? value + 1 : value)}
          />
        )}
        {params.smooth_method === 'savitzky_golay' && (
          <NumberInput
            label="多項式次數"
            value={params.smooth_poly}
            min={1}
            max={5}
            onChange={value => set('smooth_poly', value)}
          />
        )}
      </Section>

      <Section step={5} title="歸一化" hint="統一強度尺度">
        <div>
          <Label>方法</Label>
          <Select
            value={params.norm_method}
            onChange={value => set('norm_method', value as ProcessParams['norm_method'])}
            options={[
              { value: 'none', label: '不歸一化' },
              { value: 'min_max', label: 'Min-Max -> [0, 1]' },
              { value: 'max', label: '除以最大值' },
              { value: 'area', label: '除以面積' },
            ]}
          />
        </div>
      </Section>

      <Section step={6} title="弱峰檢視" hint="只改顯示，不改計算" defaultOpen={false}>
        <Checkbox
          checked={logViewParams.enabled}
          onChange={value => setLogView('enabled', value)}
          label="建立對數顯示曲線"
        />
        {logViewParams.enabled && (
          <>
            <div>
              <Label>方法</Label>
              <Select
                value={logViewParams.method}
                onChange={value => setLogView('method', value as LogViewParams['method'])}
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
              onChange={value => setLogView('floor_value', value)}
            />
          </>
        )}
      </Section>

      <Section step={7} title="波長與 X 軸" hint="控制 2θ / d-spacing 顯示">
        <div>
          <Label>光源</Label>
          <Select
            value={wavelengthPreset}
            onChange={value => onWavelengthPresetChange(value as WavelengthPreset)}
            options={Object.keys(WAVELENGTH_MAP).map(key => ({ value: key, label: key }))}
          />
        </div>
        {wavelengthPreset === 'Custom' && (
          <NumberInput
            label="自訂波長 (Å)"
            value={customWavelength}
            min={0.05}
            max={3}
            step={0.0001}
            onChange={onCustomWavelengthChange}
          />
        )}
        <div>
          <Label>X 軸顯示</Label>
          <div className="grid grid-cols-2 gap-2">
            {(['twotheta', 'dspacing'] as XMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => onXModeChange(mode)}
                className={[
                  'rounded-xl border px-3 py-2 text-sm transition-colors',
                  xMode === mode
                    ? 'border-sky-400/50 bg-sky-400/15 text-sky-100'
                    : 'border-[#314258] bg-[#202938] text-slate-300 hover:border-sky-400/40',
                ].join(' ')}
              >
                {mode === 'twotheta' ? '2θ' : 'd-spacing'}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section step={8} title="參考峰比對" hint="快速相辨識" defaultOpen={false}>
        <NumberInput
          label="最小參考相對強度 (%)"
          value={refMatchParams.min_rel_intensity}
          min={1}
          max={100}
          step={1}
          onChange={value => setRefMatch('min_rel_intensity', value)}
        />
        <NumberInput
          label="匹配容差 (deg)"
          value={refMatchParams.tolerance_deg}
          min={0.01}
          max={2}
          step={0.01}
          onChange={value => setRefMatch('tolerance_deg', value)}
        />
        <Checkbox
          checked={refMatchParams.only_show_matched}
          onChange={value => setRefMatch('only_show_matched', value)}
          label="比對表只顯示匹配項"
        />
        {refMaterials.length === 0 ? (
          <div className="text-sm text-slate-500">載入中…</div>
        ) : (
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[#283548] bg-[#1a212d] p-2">
            {refMaterials.map(material => (
              <label key={material} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/[0.03]">
                <input
                  type="checkbox"
                  checked={selectedRefs.includes(material)}
                  onChange={() => toggleRef(material)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-sky-400"
                />
                <span className="leading-5">{material}</span>
              </label>
            ))}
          </div>
        )}
        {selectedRefs.length > 0 && (
          <button
            type="button"
            onClick={() => onSelectedRefsChange([])}
            className="text-xs text-rose-300 transition-colors hover:text-rose-200"
          >
            清除全部
          </button>
        )}
      </Section>

      <Section step={9} title="自動尋峰" hint="峰表與後續 Scherrer 的基礎" defaultOpen={false}>
        <Checkbox
          checked={peakParams.enabled}
          onChange={value => setPeak('enabled', value)}
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
              onChange={value => setPeak('prominence', value)}
            />
            <NumberInput
              label="最小峰距 (deg)"
              value={peakParams.min_distance}
              min={0.05}
              max={10}
              step={0.05}
              onChange={value => setPeak('min_distance', value)}
            />
            <NumberInput
              label="最多峰數"
              value={peakParams.max_peaks}
              min={1}
              max={100}
              step={1}
              onChange={value => setPeak('max_peaks', value)}
            />
          </>
        )}
      </Section>

      <Section step={10} title="Scherrer" hint="晶粒尺寸估算" defaultOpen={false}>
        <Checkbox
          checked={scherrerParams.enabled}
          onChange={value => setScherrer('enabled', value)}
          label="啟用 Scherrer 計算"
        />
        {scherrerParams.enabled && (
          <>
            <NumberInput
              label="K"
              value={scherrerParams.k}
              min={0.1}
              max={2}
              step={0.01}
              onChange={value => setScherrer('k', value)}
            />
            <NumberInput
              label="儀器展寬 (deg)"
              value={scherrerParams.instrument_broadening_deg}
              min={0}
              max={5}
              step={0.001}
              onChange={value => setScherrer('instrument_broadening_deg', value)}
            />
            <div>
              <Label>展寬修正</Label>
              <Select
                value={scherrerParams.broadening_correction}
                onChange={value =>
                  setScherrer(
                    'broadening_correction',
                    value as ScherrerParams['broadening_correction'],
                  )
                }
                options={[
                  { value: 'none', label: '不修正' },
                  { value: 'gaussian', label: 'Gaussian' },
                  { value: 'lorentzian', label: 'Lorentzian' },
                ]}
              />
            </div>
            <p className="text-xs leading-5 text-slate-500">
              這一步直接使用尋峰得到的 FWHM。結果對峰寬與儀器展寬設定很敏感，只適合快速比較。
            </p>
          </>
        )}
      </Section>
    </div>
  )
}
