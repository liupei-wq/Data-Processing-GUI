import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { ANALYSIS_MODULES, type AnalysisModuleId } from './AnalysisModuleNav'

type HeaderTabItem = {
  key: string
  label: string
  active: boolean
  onClick: () => void
}

type SummaryStatItem = {
  label: string
  value: string
}

type ModuleChipItem = {
  label: string
}

export type ThemeSelectOption = {
  value: string
  label: ReactNode
  disabled?: boolean
}

export const MODULE_CONTENT: Record<
  AnalysisModuleId,
  {
    title: string
    subtitle: string
    description: string
    uploadTitle: string
    formats: string[]
  }
> = {
  raman: {
    title: 'Raman',
    subtitle: 'Raman Spectroscopy',
    description: '進行去尖峰、多檔平均、背景扣除、平滑、歸一化、參考峰與峰值偵測分析。',
    uploadTitle: '上傳 Raman 檔案',
    formats: ['.TXT', '.CSV', '.ASC', '.DAT'],
  },
  xrd: {
    title: 'XRD',
    subtitle: 'X-ray Diffraction',
    description: '進行繞射峰偵測、背景扣除、平滑、峰位校正、參考卡比對與結晶結構分析。',
    uploadTitle: '上傳 XRD 檔案',
    formats: ['.XY', '.TXT', '.CSV', '.DAT'],
  },
  xps: {
    title: 'XPS',
    subtitle: 'X-ray Photoelectron Spectroscopy',
    description: '進行 Shirley / Tougaard 背景扣除、Voigt 擬合、束縛能校正與化學態分析。',
    uploadTitle: '上傳 XPS 光譜檔',
    formats: ['.XY', '.TXT', '.CSV', '.VMS', '.PRO', '.DAT'],
  },
  xes: {
    title: 'XES',
    subtitle: 'X-ray Emission Spectroscopy',
    description: '進行發射光譜處理、峰形分析、訊號平滑、歸一化與能量位置比對。',
    uploadTitle: '上傳 XES 光譜檔',
    formats: ['.TXT', '.CSV', '.DAT', '.XY'],
  },
  xas: {
    title: 'XAS',
    subtitle: 'X-ray Absorption Spectroscopy',
    description: '進行吸收邊分析、背景扣除、歸一化、白線強度與能量位移比對。',
    uploadTitle: '上傳 XAS 光譜檔',
    formats: ['.TXT', '.CSV', '.DAT', '.XY'],
  },
}

export const LINE_COLOR_OPTIONS = [
  { value: 'blue', label: 'Blue' },
  { value: 'teal', label: 'Teal' },
  { value: 'orange', label: 'Orange' },
  { value: 'rose', label: 'Rose' },
  { value: 'violet', label: 'Violet' },
]

export const LINE_COLOR_PALETTES: Record<string, { primary: string; secondary: string; tertiary: string; accent: string; series: string[] }> = {
  blue: {
    primary: '#38bdf8',
    secondary: '#94a3b8',
    tertiary: '#f59e0b',
    accent: '#14b8a6',
    series: ['#38bdf8', '#94a3b8', '#60a5fa', '#818cf8', '#22d3ee', '#f59e0b', '#fb7185', '#f472b6'],
  },
  teal: {
    primary: '#14b8a6',
    secondary: '#9ca3af',
    tertiary: '#f97316',
    accent: '#2dd4bf',
    series: ['#14b8a6', '#2dd4bf', '#5eead4', '#60a5fa', '#f59e0b', '#a78bfa', '#fb7185', '#84cc16'],
  },
  orange: {
    primary: '#f97316',
    secondary: '#94a3b8',
    tertiary: '#facc15',
    accent: '#fb923c',
    series: ['#f97316', '#fb923c', '#facc15', '#38bdf8', '#818cf8', '#fb7185', '#2dd4bf', '#a3e635'],
  },
  rose: {
    primary: '#fb7185',
    secondary: '#94a3b8',
    tertiary: '#f59e0b',
    accent: '#f472b6',
    series: ['#fb7185', '#f472b6', '#f9a8d4', '#38bdf8', '#f59e0b', '#2dd4bf', '#a78bfa', '#84cc16'],
  },
  violet: {
    primary: '#a78bfa',
    secondary: '#94a3b8',
    tertiary: '#f59e0b',
    accent: '#c084fc',
    series: ['#a78bfa', '#c084fc', '#818cf8', '#38bdf8', '#2dd4bf', '#f59e0b', '#fb7185', '#a3e635'],
  },
}

export const DEFAULT_SERIES_PALETTE_KEYS = ['blue', 'teal', 'orange', 'rose', 'violet']

export function applyHidden(traces: Plotly.Data[], hidden: string[]): Plotly.Data[] {
  if (hidden.length === 0) return traces
  return traces.map(trace => ({
    ...trace,
    visible: hidden.includes((trace as { name?: string }).name ?? '') ? ('legendonly' as const) : (true as const),
  }))
}

export function makeLegendClick(setHidden: Dispatch<SetStateAction<string[]>>) {
  return (data: { curveNumber: number; data: Array<{ name?: string }> }) => {
    const name = data.data[data.curveNumber]?.name
    if (name != null) {
      setHidden(prev => (prev.includes(name) ? prev.filter(item => item !== name) : [...prev, name]))
    }
    return false
  }
}

export function ChartToolbar({
  title,
  colorValue,
  onColorChange,
}: {
  title: string
  colorValue: string
  onColorChange: (value: string) => void
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-semibold text-[var(--text-main)]">{title}</p>
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-soft)]">線色</span>
        <ThemeSelect
          value={colorValue}
          onChange={onColorChange}
          options={LINE_COLOR_OPTIONS}
          className="min-w-[6.25rem]"
          buttonClassName="min-h-8 rounded-lg px-2 py-1 text-xs"
        />
      </div>
    </div>
  )
}

export function ThemeSelect({
  value,
  onChange,
  options,
  className = '',
  buttonClassName = '',
  panelClassName = '',
  disabled = false,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: ThemeSelectOption[]
  className?: string
  buttonClassName?: string
  panelClassName?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const selected = options.find(option => option.value === value)

  useEffect(() => {
    if (!open) return

    const updateRect = () => {
      const nextRect = buttonRef.current?.getBoundingClientRect()
      if (nextRect) setRect(nextRect)
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    updateRect()
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className={['theme-select', className].filter(Boolean).join(' ')}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (disabled) return
          const nextRect = buttonRef.current?.getBoundingClientRect()
          if (nextRect) setRect(nextRect)
          setOpen(current => !current)
        }}
        className={['theme-select__button', buttonClassName].filter(Boolean).join(' ')}
      >
        <span className="theme-select__value">{selected?.label ?? value}</span>
        <span className="theme-select__chevron" aria-hidden="true" />
      </button>
      {open && rect && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          className={['theme-select__panel', panelClassName].filter(Boolean).join(' ')}
          style={{
            left: rect.left,
            top: rect.bottom + 6,
            width: rect.width,
            maxHeight: Math.min(320, window.innerHeight - rect.bottom - 16),
          }}
        >
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onClick={() => {
                if (option.disabled) return
                onChange(option.value)
                setOpen(false)
              }}
              className={[
                'theme-select__option',
                option.value === value ? 'theme-select__option--active' : '',
              ].join(' ')}
            >
              {option.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

export function TogglePill({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={[
        'flex w-full items-center justify-between gap-3 rounded-[14px] px-4 py-2.5 text-sm font-medium transition-all duration-150',
        checked
          ? [
              'bg-[color:color-mix(in_srgb,var(--accent-secondary)_18%,transparent)]',
              'text-[var(--accent-secondary)]',
              '[box-shadow:inset_0_0_0_1.5px_color-mix(in_srgb,var(--accent-secondary)_55%,transparent),0_2px_12px_-2px_color-mix(in_srgb,var(--accent-secondary)_30%,transparent)]',
            ].join(' ')
          : [
              'bg-[color:color-mix(in_srgb,var(--card-bg)_70%,transparent)]',
              'text-[var(--text-soft)]',
              '[box-shadow:inset_0_0_0_1px_var(--card-border)]',
              'hover:text-[var(--text-main)] hover:[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--accent-secondary)_40%,var(--card-border))]',
            ].join(' '),
      ].join(' ')}
    >
      <span>{label}</span>
      <span
        className={[
          'h-3.5 w-3.5 shrink-0 rounded-full transition-all duration-150',
          checked
            ? 'bg-[var(--accent-secondary)] [box-shadow:0_0_8px_color-mix(in_srgb,var(--accent-secondary)_75%,transparent)]'
            : 'border border-[var(--card-border)]',
        ].join(' ')}
      />
    </button>
  )
}

export function ProcessingWorkspaceHeader({
  tabs,
  isOverlayView,
  overlaySelectionCount,
  onOpenOverlaySelector,
  stats,
}: {
  tabs: HeaderTabItem[]
  isOverlayView: boolean
  overlaySelectionCount: number
  onOpenOverlaySelector: () => void
  stats: SummaryStatItem[]
}) {
  return (
    <>
      {tabs.length > 1 && (
        <div className="workspace-stage-card mb-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">單筆資料處理</p>
                {isOverlayView && (
                  <span className="rounded-full border border-[var(--accent-secondary)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_14%,transparent)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--accent-secondary)]">
                    目前顯示疊圖模式
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {tabs.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={item.onClick}
                    className={[
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors pressable',
                      item.active
                        ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-main)]'
                        : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-soft)]',
                    ].join(' ')}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="shrink-0 lg:pl-4">
              <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">多筆疊圖處理</p>
              <button
                type="button"
                onClick={onOpenOverlaySelector}
                className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 text-left transition-colors hover:border-[var(--accent-secondary)] hover:bg-[color:color-mix(in_srgb,var(--accent-secondary)_10%,transparent)] pressable"
              >
                <span className="block text-sm font-semibold text-[var(--text-main)]">選擇疊圖資料</span>
                <span className="mt-1 block text-xs text-[var(--text-soft)]">
                  {isOverlayView ? '目前疊圖模式獨立顯示。 ' : ''}
                  已選 {overlaySelectionCount} 筆
                  {overlaySelectionCount >= 2 ? '，可直接看中間欄疊圖結果' : '，至少選 2 筆才會顯示疊圖'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="info-grid mb-4 !px-0 !pb-0">
        {stats.map(item => (
          <div key={item.label} className="info-card">
            <p className="info-card-label">{item.label}</p>
            <p className="info-card-value">{item.value}</p>
          </div>
        ))}
      </div>
    </>
  )
}

export function ModuleTopBar({
  title,
  subtitle,
  description,
  chips = [],
}: {
  title: string
  subtitle: string
  description: string
  chips?: ModuleChipItem[]
}) {
  return (
    <div className="topbar-panel">
      <div className="topbar-eyebrow">Analysis Module</div>
      <div className="module-title-row">
        <h1 className="module-title">{title}</h1>
        <span className="module-subtitle">{subtitle}</span>
      </div>
      <p className="module-description">{description}</p>
      {chips.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map(chip => (
            <span key={chip.label} className="status-chip">
              {chip.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function InfoCardGrid({ items }: { items: SummaryStatItem[] }) {
  return (
    <div className="info-grid">
      {items.map(item => (
        <div key={item.label} className="info-card">
          <p className="info-card-label">{item.label}</p>
          <p className="info-card-value">{item.value}</p>
        </div>
      ))}
    </div>
  )
}

export function ModuleGlyph({
  module,
  className = '',
}: {
  module: AnalysisModuleId
  className?: string
}) {
  const svgClassName = ['empty-icon', className].filter(Boolean).join(' ')

  if (module === 'raman') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" className={svgClassName}>
        <path d="M8 39c6-8 11-12 16-12 7 0 10 13 16 13 4 0 8-4 16-15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M8 32c5 0 8-9 13-9 7 0 8 20 16 20 6 0 8-11 19-11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.72" />
        <path d="M8 25c6 0 10 22 18 22 7 0 10-26 16-26 4 0 7 7 14 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.46" />
      </svg>
    )
  }

  if (module === 'xrd') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" className={svgClassName}>
        <path d="M8 52h48" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" />
        {[16, 24, 33, 41, 49].map((x, index) => (
          <path key={x} d={`M${x} 52 L${x + 2} ${18 + index * 4} L${x + 4} 52`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        ))}
      </svg>
    )
  }

  if (module === 'xps') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" className={svgClassName}>
        <path d="M8 50h48" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" />
        <path d="M12 20c7 0 7 18 14 18 6 0 8-24 16-24 7 0 8 30 14 30 4 0 5-8 8-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }

  if (module === 'xes') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" className={svgClassName}>
        <path d="M8 50h48" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" />
        <path d="M10 46c6 0 8-18 20-18 10 0 11 18 24 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={svgClassName}>
      <path d="M8 50h48" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" />
      <path d="M10 18c0 0 7 0 10 0 5 0 7 28 18 28 7 0 8-14 12-21 3-6 7-7 12-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function EmptyWorkspaceState({
  module,
  title,
  description,
  formats,
}: {
  module: AnalysisModuleId
  title: string
  description: string
  formats: string[]
}) {
  return (
    <div className="workspace-surface">
      <div className="empty-state">
        <ModuleGlyph module={module} />
        <div className="empty-title">{title}</div>
        <div className="empty-description">{description}</div>
        <div className="format-chips">
          {formats.map(format => (
            <span key={format} className="format-chip">
              {format}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function DatasetSelectionModal({
  open,
  title,
  items,
  selectedKeys,
  onToggle,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  items: Array<{ key: string; label: string }>
  selectedKeys: string[]
  onToggle: (key: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="theme-block max-h-[calc(100vh-4rem)] w-full max-w-4xl overflow-hidden rounded-[28px]"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--card-divider)] px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-[var(--text-main)]">{title}</div>
            <p className="mt-1 text-sm text-[var(--text-soft)]">至少選 2 筆才會切換到多筆疊圖模式。</p>
          </div>
          <span className="ml-auto text-xs text-[var(--text-soft)]">目前已選 {selectedKeys.length} / {items.length} 筆</span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map(item => {
              const checked = selectedKeys.includes(item.key)
              return (
                <label
                  key={item.key}
                  className={[
                    'flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors',
                    checked
                      ? 'border-[var(--accent-secondary)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_12%,transparent)]'
                      : 'border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--accent-secondary)]/60',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(item.key)}
                    className="mt-1 h-4 w-4 accent-[var(--accent-strong)]"
                  />
                  <span className="min-w-0 text-sm font-medium text-[var(--text-main)]">{item.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--card-divider)] px-5 py-4">
          <p className="text-xs text-[var(--text-soft)]">多筆疊圖模式只切換中間欄顯示，不會改動既有的步驟處理邏輯。</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[var(--card-border)] px-4 py-2 text-sm text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)] pressable"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)] transition-opacity hover:opacity-90 pressable"
            >
              套用疊圖
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function GlassSection({
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
  const [open, setOpen] = useState(defaultOpen)
  const [infoOpen, setInfoOpen] = useState(false)

  useEffect(() => {
    if (!infoOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInfoOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [infoOpen])

  const infoModal = infoOpen && infoContent && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-[3px]"
          onClick={() => setInfoOpen(false)}
        >
          <div
            className="glass-panel max-h-[min(84vh,calc(100vh-3rem))] w-full max-w-2xl overflow-hidden rounded-[30px]"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--card-divider)] px-5 py-4">
              <div>
                <p className="text-base font-semibold text-[var(--text-main)]">{title}說明</p>
                {hint && <p className="mt-1 text-sm text-[var(--text-soft)]">{hint}</p>}
              </div>
              <button
                type="button"
                onClick={() => setInfoOpen(false)}
                className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-sm text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)] pressable"
              >
                關閉
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-5 text-[15px] leading-7 text-[var(--text-soft)] sm:px-6 sm:text-base sm:leading-8">
              {infoContent}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <div className="sidebar-stage-card step-card overflow-hidden rounded-[24px]">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setOpen(current => !current)}
            className="step-header flex flex-1 items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--card-ghost)]"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="step-number flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--accent-tertiary)_16%,transparent)] text-sm font-semibold text-[var(--accent-tertiary)]">
                {step}
              </span>
              <div className="min-w-0">
                <div className="step-title truncate text-base font-semibold text-[var(--text-main)]">{title}</div>
                {hint && <div className="step-subtitle mt-0.5 text-[11px] text-[var(--text-soft)]">{hint}</div>}
              </div>
            </div>
            <span className="shrink-0 text-sm text-[var(--text-soft)]">{open ? '▾' : '▸'}</span>
          </button>
          {infoContent && (
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              title="查看方法說明"
              className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--card-border)] text-xs font-bold text-[var(--text-soft)] transition-colors hover:border-[var(--accent-secondary)] hover:text-[var(--accent-secondary)]"
            >
              ?
            </button>
          )}
        </div>
        {open && <div className="step-content space-y-3 p-4 pt-2">{children}</div>}
      </div>
      {infoModal}
    </>
  )
}

function ModuleTabs({ activeModule, onSelect }: { activeModule: AnalysisModuleId; onSelect?: (m: AnalysisModuleId) => void }) {
  return (
    <div className="module-tabs" role="tablist" aria-label="分析模組切換">
      {ANALYSIS_MODULES.map(module => {
        const isActive = module.id === activeModule
        return (
          <button
            key={module.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={isActive}
            onClick={() => {
              if (!isActive) onSelect?.(module.id)
            }}
            className={['module-tab', isActive ? 'module-tab--active' : ''].join(' ').trim()}
          >
            {module.label}
          </button>
        )
      })}
    </div>
  )
}

export function StickySidebarHeader({
  activeModule,
  subtitle,
  onSelectModule,
  onCollapse,
}: {
  activeModule: AnalysisModuleId
  subtitle: string
  onSelectModule?: (module: AnalysisModuleId) => void
  onCollapse: () => void
}) {
  return (
    <div className="sidebar-sticky-shell sticky top-0 z-20 px-4 pb-10 pt-5">
      <div className="sidebar-header-card relative rounded-[30px] px-5 pb-5 pt-4.5">
        <div className="sidebar-header-card__brand-row flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="nigiro-brand-mark nigiro-brand-mark--lg" aria-hidden="true">
              <img className="nigiro-brand-mark__img nigiro-brand-mark__img--dark" src="/nigiro-icon.svg" alt="" />
              <img className="nigiro-brand-mark__img nigiro-brand-mark__img--light" src="/nigiro-icon-light.svg" alt="" />
            </div>
            <div className="min-w-0">
              <div className="text-[1.7rem] font-bold leading-none tracking-[-0.04em] text-[var(--text-main)]">Nigiro Pro</div>
              <div className="mt-1.5 text-[13px] leading-tight text-[var(--text-soft)]">{subtitle}</div>
            </div>
          </div>
          <button type="button" onClick={onCollapse} className="sidebar-collapse-button btn btn-secondary mt-1 h-10 w-10 shrink-0 !px-0 text-sm">←</button>
        </div>
        <div className="mt-4">
          <ModuleTabs activeModule={activeModule} onSelect={onSelectModule} />
        </div>
      </div>
    </div>
  )
}
