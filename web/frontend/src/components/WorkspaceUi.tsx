import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ANALYSIS_MODULES, type AnalysisModuleId } from './AnalysisModuleNav'

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
      <div className="glass-panel overflow-hidden rounded-[24px]">
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
    <div className="sticky top-0 z-20 bg-[color:color-mix(in_srgb,var(--panel-bg)_88%,transparent)] px-4 pb-8 pt-5 backdrop-blur-xl">
      <div className="glass-panel relative rounded-[30px] px-5 pb-9 pt-5">
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
