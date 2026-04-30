import { type ReactNode } from 'react'
import type {
  LogViewParams,
  PeakDetectionParams,
  ProcessParams,
  ReferenceMatchParams,
  ScherrerParams,
  XMode,
  XAxisCorrectionParams,
  WavelengthPreset,
} from '../types/xrd'
import { GlassSection, TogglePill } from './WorkspaceUi'

export type { XMode, WavelengthPreset }

export const DEFAULT_PARAMS: ProcessParams = {
  interpolate: false,
  n_points: 1000,
  average: false,
  bg_enabled: false,
  bg_method: 'none',
  bg_x_start: null,
  bg_x_end: null,
  bg_poly_deg: 3,
  bg_baseline_lambda: 1e5,
  bg_baseline_p: 0.01,
  bg_baseline_iter: 20,
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
  infoContent,
}: {
  step: number
  title: string
  hint?: string
  children: ReactNode
  defaultOpen?: boolean
  infoContent?: ReactNode
}) {
  return (
    <GlassSection step={step} title={title} hint={hint} defaultOpen={defaultOpen} infoContent={infoContent}>
      {children}
    </GlassSection>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-[12px] font-medium text-[var(--text-main)]">{children}</label>
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
      className="theme-input w-full rounded-xl px-3 py-2 text-sm"
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
        className="theme-input w-full rounded-xl px-3 py-2 text-sm"
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
    <label className="theme-block-soft flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm text-[var(--text-main)] transition-colors hover:border-[color:color-mix(in_srgb,var(--accent-strong)_45%,var(--card-border))]">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--accent-strong)]"
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
  xAxisCorrection: XAxisCorrectionParams
  onXAxisCorrectionChange: (p: XAxisCorrectionParams) => void
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
  xAxisCorrection,
  onXAxisCorrectionChange,
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
  const setXAxisCorrection = <K extends keyof XAxisCorrectionParams>(
    key: K,
    value: XAxisCorrectionParams[K],
  ) => onXAxisCorrectionChange({ ...xAxisCorrection, [key]: value })
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
      <Section step={2} title="內插" hint="先統一點數" defaultOpen={false} infoContent={
        <div className="space-y-3">
          <p className="font-semibold text-[var(--text-main)]">內插說明</p>
          <p>先把各筆 XRD 資料重取樣到固定點數，方便之後做多檔比較或平均。</p>
          <p>這一步只改變取樣網格，不會改動尋峰、Scherrer 或參考峰匹配的計算邏輯。</p>
        </div>
      }>
        <TogglePill
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
      </Section>

      <Section step={3} title="多檔平均" hint="共用同一網格平均" defaultOpen={false} infoContent={
        <div className="space-y-3">
          <p className="font-semibold text-[var(--text-main)]">多檔平均說明</p>
          <p>這一步只改變前處理的呈現方式，不更動後續 XRD 計算邏輯。</p>
          <p>啟用平均後會在相同點數網格上做平均；如果前面沒開內插，後端仍會先對齊再平均。</p>
        </div>
      }>
        <TogglePill
          checked={params.average}
          onChange={value => set('average', value)}
          label={`對所有載入檔案做平均${fileCount < 2 ? '（至少 2 個）' : ''}`}
        />
      </Section>

      <Section step={4} title="高斯模板扣除" hint="已知峰先扣除" defaultOpen={false} infoContent={
        <div className="space-y-3">
          <p className="font-semibold text-[var(--text-main)]">高斯模板扣除說明</p>
          <p>以固定 FWHM 與固定高度的高斯模板扣除已知峰，適合先移除明確雜峰或基板峰。</p>
          <p>這一步只調整輸入光譜，不改變後續尋峰與 Scherrer 的核心算法。</p>
        </div>
      }>
        <TogglePill
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
            <div className="theme-block-soft rounded-xl px-3 py-2 text-sm text-[var(--text-main)]">
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
                <div key={`${center.name}-${idx}`} className="theme-block-soft rounded-2xl p-3">
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
                      className="text-xs text-[var(--accent-secondary)] transition-colors hover:opacity-80"
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
                        className="theme-input w-full rounded-xl px-3 py-2 text-sm"
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
                className="w-full rounded-xl border border-dashed border-[var(--pill-border)] bg-[var(--pill-bg)] px-3 py-2 text-sm font-medium text-[var(--accent)] transition-colors hover:opacity-90"
              >
                新增高斯中心
              </button>
            </div>
          </>
        )}
      </Section>

      <Section step={5} title="平滑" hint="降噪但避免洗平峰型" defaultOpen={false} infoContent={
        <div className="space-y-3">
          <p className="font-semibold text-[var(--text-main)]">平滑說明</p>
          <p>平滑只用於降低雜訊，避免鋸齒干擾視覺判讀，但視窗過大可能把弱峰洗平。</p>
        </div>
      }>
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

      <Section step={6} title="歸一化" hint="統一強度尺度" defaultOpen={false} infoContent={
        <div className="space-y-3">
          <p className="font-semibold text-[var(--text-main)]">歸一化說明</p>
          <p>歸一化用於比較不同樣品的峰形與相對強度，不改變原始峰位位置。</p>
          <p>若需要保留絕對強度資訊，請維持不歸一化。</p>
        </div>
      }>
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

      <Section step={7} title="弱峰檢視" hint="只改顯示，不改計算" defaultOpen={false} infoContent={
        <div className="space-y-3">
          <p className="font-semibold text-[var(--text-main)]">弱峰檢視說明</p>
          <p>這裡只改圖表縮放方式，方便觀察弱峰，不會改動任何後端運算。</p>
        </div>
      }>
        <TogglePill
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

      <Section step={8} title="波長與 X 軸" hint="控制 2θ / d-spacing 顯示" defaultOpen={false} infoContent={
        <div className="space-y-3">
          <p className="font-semibold text-[var(--text-main)]">波長與 X 軸說明</p>
          <p>這一步控制顯示與換算基準，方便在 2θ 與 d-spacing 間切換比對。</p>
        </div>
      }>
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
                    ? 'theme-pill text-[var(--accent)]'
                    : 'theme-input text-[var(--text-main)]',
                ].join(' ')}
              >
                {mode === 'twotheta' ? '2θ' : 'd-spacing'}
              </button>
            ))}
          </div>
        </div>
        <div className="theme-block-soft space-y-3 rounded-xl p-3">
          <TogglePill
            checked={xAxisCorrection.enabled}
            onChange={value => setXAxisCorrection('enabled', value)}
            label="Enable X-axis correction"
          />
          {xAxisCorrection.enabled && (
            <>
              <div>
                <Label>Correction mode</Label>
                <Select
                  value={xAxisCorrection.mode}
                  onChange={value => setXAxisCorrection('mode', value as XAxisCorrectionParams['mode'])}
                  options={[
                    { value: 'manual', label: 'Manual offset' },
                    { value: 'calibration', label: 'Expected vs measured peaks' },
                  ]}
                />
              </div>
              {xAxisCorrection.mode === 'manual' ? (
                <NumberInput
                  label="Offset added to 2theta (deg)"
                  value={xAxisCorrection.manual_offset}
                  min={-5}
                  max={5}
                  step={0.001}
                  onChange={value => setXAxisCorrection('manual_offset', value)}
                />
              ) : (
                <>
                  <div>
                    <Label>Fit type</Label>
                    <Select
                      value={xAxisCorrection.correction_type}
                      onChange={value => setXAxisCorrection('correction_type', value as XAxisCorrectionParams['correction_type'])}
                      options={[
                        { value: 'constant', label: 'Constant offset' },
                        { value: 'linear', label: 'Linear correction' },
                      ]}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Calibration peaks: expected / measured</Label>
                    {xAxisCorrection.calibration_points.map((point, idx) => (
                      <div key={`xcal-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <input
                          type="number"
                          value={point.expected}
                          step={0.001}
                          onChange={event => setXAxisCorrection('calibration_points', xAxisCorrection.calibration_points.map((item, itemIdx) => itemIdx === idx ? { ...item, expected: Number(event.target.value) } : item))}
                          className="theme-input min-w-0 rounded-xl px-3 py-2 text-sm"
                          title="Expected 2theta"
                        />
                        <input
                          type="number"
                          value={point.measured}
                          step={0.001}
                          onChange={event => setXAxisCorrection('calibration_points', xAxisCorrection.calibration_points.map((item, itemIdx) => itemIdx === idx ? { ...item, measured: Number(event.target.value) } : item))}
                          className="theme-input min-w-0 rounded-xl px-3 py-2 text-sm"
                          title="Measured 2theta"
                        />
                        <button
                          type="button"
                          onClick={() => setXAxisCorrection('calibration_points', xAxisCorrection.calibration_points.filter((_, itemIdx) => itemIdx !== idx))}
                          className="rounded-xl border border-[var(--card-border)] px-3 text-xs text-[var(--text-main)]"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setXAxisCorrection('calibration_points', [...xAxisCorrection.calibration_points, { expected: 0, measured: 0 }])}
                      className="w-full rounded-xl border border-dashed border-[var(--pill-border)] bg-[var(--pill-bg)] px-3 py-2 text-sm font-medium text-[var(--accent)]"
                    >
                      Add calibration peak
                    </button>
                  </div>
                </>
              )}
              <Checkbox checked={xAxisCorrection.show_raw_curve} onChange={value => setXAxisCorrection('show_raw_curve', value)} label="Show raw curve" />
              <Checkbox checked={xAxisCorrection.show_corrected_curve} onChange={value => setXAxisCorrection('show_corrected_curve', value)} label="Show corrected curve" />
              <Checkbox checked={xAxisCorrection.show_reference_markers} onChange={value => setXAxisCorrection('show_reference_markers', value)} label="Show reference peak markers" />
            </>
          )}
        </div>
      </Section>

      <Section step={9} title="參考峰比對" hint="快速相辨識" defaultOpen={false} infoContent={
        <div className="space-y-3">
          <p className="font-semibold text-[var(--text-main)]">參考峰比對說明</p>
          <p>依照強度門檻與容差顯示可比對的參考峰，方便快速做相辨識。</p>
        </div>
      }>
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
          <div className="theme-block-soft max-h-48 space-y-1 overflow-y-auto rounded-xl p-2">
            {refMaterials.map(material => (
              <label key={material} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--text-main)] transition-colors hover:bg-[var(--card-ghost)]">
                <input
                  type="checkbox"
                  checked={selectedRefs.includes(material)}
                  onChange={() => toggleRef(material)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent-strong)]"
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
            className="text-xs text-[var(--accent-secondary)] transition-colors hover:opacity-80"
          >
            清除全部
          </button>
        )}
      </Section>

      <Section step={10} title="自動尋峰" hint="峰表與後續 Scherrer 的基礎" defaultOpen={false} infoContent={
        <div className="space-y-3">
          <p className="font-semibold text-[var(--text-main)]">自動尋峰說明</p>
          <p>這一步決定後續峰表內容，也是 Scherrer 快速估算的基礎。</p>
        </div>
      }>
        <TogglePill
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
            <Checkbox
              checked={peakParams.include_weak_peaks}
              onChange={value => setPeak('include_weak_peaks', value)}
              label="Include weak peaks in final result"
            />
            <Checkbox
              checked={peakParams.show_unmatched_peaks}
              onChange={value => setPeak('show_unmatched_peaks', value)}
              label="Show unmatched peaks"
            />
            <NumberInput
              label="Weak peak threshold (% relative intensity)"
              value={peakParams.weak_peak_threshold}
              min={0}
              max={100}
              step={1}
              onChange={value => setPeak('weak_peak_threshold', value)}
            />
            <NumberInput
              label="Minimum S/N ratio"
              value={peakParams.min_snr}
              min={0}
              max={100}
              step={0.1}
              onChange={value => setPeak('min_snr', value)}
            />
            <NumberInput
              label="Minimum prominence"
              value={peakParams.min_prominence}
              min={0}
              max={1000000000}
              step={0.001}
              onChange={value => setPeak('min_prominence', value)}
            />
            <Checkbox
              checked={peakParams.export_weak_peaks}
              onChange={value => setPeak('export_weak_peaks', value)}
              label="Export weak peaks"
            />
          </>
        )}
      </Section>

      <Section step={11} title="Scherrer" hint="晶粒尺寸估算" defaultOpen={false} infoContent={
        <div className="space-y-3">
          <p className="font-semibold text-[var(--text-main)]">Scherrer 說明</p>
          <p>使用尋峰得到的 FWHM 估算晶粒尺寸，適合快速比較，不代表完整結構分析。</p>
        </div>
      }>
        <TogglePill
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
            <p className="text-xs leading-5 text-[var(--text-soft)]">
              這一步直接使用尋峰得到的 FWHM。結果對峰寬與儀器展寬設定很敏感，只適合快速比較。
            </p>
          </>
        )}
      </Section>
    </div>
  )
}
