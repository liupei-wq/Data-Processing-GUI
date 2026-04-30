import { useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react'
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
        <select
          value={colorValue}
          onChange={event => onColorChange(event.target.value)}
          className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1 text-xs text-[var(--input-text)] focus:outline-none"
        >
          {LINE_COLOR_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
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
        <div className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
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

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {stats.map(item => (
          <div key={item.label} className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">{item.label}</p>
            <p className="mt-1 text-lg font-semibold text-[var(--text-main)]">{item.value}</p>
          </div>
        ))}
      </div>
    </>
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
      <div className="sidebar-stage-card overflow-hidden rounded-[24px]">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setOpen(current => !current)}
            className="flex flex-1 items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--card-ghost)]"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--accent-tertiary)_16%,transparent)] text-sm font-semibold text-[var(--accent-tertiary)]">
                {step}
              </span>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-[var(--text-muted)]">{title}</div>
                {hint && <div className="mt-0.5 text-[11px] text-[var(--text-soft)]">{hint}</div>}
              </div>
            </div>
            <span className="shrink-0 text-sm text-[var(--text-soft)]">{open ? '−' : '+'}</span>
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
        {open && <div className="space-y-3 p-4 pt-2">{children}</div>}
      </div>
      {infoModal}
    </>
  )
}

function ModuleDropdownTag({ activeModule, onSelect }: { activeModule: AnalysisModuleId; onSelect?: (m: AnalysisModuleId) => void }) {
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | null>(null)

  const activeLabel = ANALYSIS_MODULES.find(module => module.id === activeModule)?.label ?? activeModule.toUpperCase()

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const updatePanelPosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPanelStyle({
      position: 'fixed',
      top: rect.bottom + 10,
      left: rect.left + rect.width / 2,
      transform: 'translateX(-50%)',
      width: Math.min(240, Math.max(rect.width + 28, 188)),
      zIndex: 9999,
    })
  }, [])

  const openMenu = useCallback(() => {
    clearCloseTimer()
    updatePanelPosition()
    setOpen(true)
  }, [updatePanelPosition])

  const closeMenuSoon = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false)
      closeTimerRef.current = null
    }, 120)
  }, [])

  useEffect(() => () => clearCloseTimer(), [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onReposition = () => updatePanelPosition()

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    window.addEventListener('keydown', onKeyDown)
    updatePanelPosition()

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, updatePanelPosition])

  const panel = open ? (
    <div
      ref={panelRef}
      style={panelStyle}
      onMouseEnter={clearCloseTimer}
      onMouseLeave={closeMenuSoon}
      className="glass-panel overflow-hidden rounded-[22px] p-1.5"
    >
      <div className="px-3 pb-1.5 pt-2 text-center text-[10px] uppercase tracking-[0.2em] text-[var(--text-soft)]">
        切換分析模組
      </div>
      {ANALYSIS_MODULES.map(module => {
        const isActive = module.id === activeModule
        return (
          <button
            key={module.id}
            type="button"
            disabled={isActive}
            onClick={() => {
              setOpen(false)
              if (!isActive) onSelect?.(module.id)
            }}
            className={[
              'flex w-full items-center justify-between rounded-2xl px-3 py-2 text-sm transition-all duration-150 pressable',
              isActive
                ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-secondary)]'
                : 'text-[var(--text-main)] hover:bg-[var(--card-ghost)] hover:text-[var(--accent-secondary)]',
            ].join(' ')}
          >
            <span>{module.label}</span>
            <span className="text-[11px] text-[var(--text-soft)]">{module.detail}</span>
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <>
      <div className="relative flex justify-center">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            if (open) setOpen(false)
            else openMenu()
          }}
          onMouseEnter={openMenu}
          onMouseLeave={closeMenuSoon}
          className="glass-panel flex min-h-[52px] min-w-[168px] items-center justify-center gap-2 rounded-[18px] px-5 py-2.5 text-sm font-semibold text-[var(--text-main)] transition-all duration-150 hover:-translate-y-0.5"
        >
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">分析模組</span>
          <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent-secondary)_18%,transparent)] px-3 py-1 text-sm text-[var(--accent-secondary)]">
            {activeLabel}
          </span>
          <span className={`text-[10px] text-[var(--text-soft)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▼</span>
        </button>
      </div>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </>
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
    <div className="sidebar-sticky-shell sticky top-0 z-20 px-4 pb-8 pt-5">
      <div className="sidebar-header-card relative rounded-[30px] px-5 pb-9 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[24px] bg-[color:color-mix(in_srgb,var(--accent-strong)_14%,var(--card-bg))] [box-shadow:0_8px_24px_-8px_color-mix(in_srgb,var(--accent-strong)_45%,transparent)]">
              <svg width="34" height="28" viewBox="0 0 18 16" fill="none">
                <path d="M1 13 L4.5 13 L6.5 8 L9 1 L11.5 8 L13.5 13 L17 13" stroke="var(--accent-strong)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[1.9rem] font-bold leading-none tracking-[-0.04em] text-[var(--text-main)]">Nigiro Pro</div>
              <div className="mt-2 text-sm leading-tight text-[var(--text-soft)]">{subtitle}</div>
            </div>
          </div>
          <button type="button" onClick={onCollapse} className="mt-1 shrink-0 text-sm text-[var(--text-soft)] hover:text-[var(--text-main)]">‹</button>
        </div>
        <div className="pointer-events-none absolute inset-x-0 -bottom-6 flex justify-center px-4">
          <div className="pointer-events-auto">
            <ModuleDropdownTag activeModule={activeModule} onSelect={onSelectModule} />
          </div>
        </div>
      </div>
    </div>
  )
}
