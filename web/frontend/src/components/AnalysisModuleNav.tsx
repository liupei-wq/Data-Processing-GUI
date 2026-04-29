import { useState } from 'react'

export type AnalysisModuleId = 'raman' | 'xrd' | 'xps' | 'xas' | 'xes'

export const ANALYSIS_MODULES: {
  id: AnalysisModuleId
  label: string
  detail: string
}[] = [
  { id: 'raman', label: 'Raman', detail: 'Raman Spectroscopy' },
  { id: 'xrd', label: 'XRD', detail: 'X-ray Diffraction' },
  { id: 'xps', label: 'XPS', detail: 'X-ray Photoelectron Spectroscopy' },
  { id: 'xas', label: 'XAS', detail: 'X-ray Absorption' },
  { id: 'xes', label: 'XES', detail: 'X-ray Emission Spectroscopy' },
]

interface Props {
  activeModule: AnalysisModuleId
  onSelectModule?: (module: AnalysisModuleId) => void
  mode?: 'cards' | 'dropdown'
}

export default function AnalysisModuleNav({ activeModule, onSelectModule, mode = 'cards' }: Props) {
  if (mode === 'dropdown') {
    const [open, setOpen] = useState(false)
    const activeInfo = ANALYSIS_MODULES.find(module => module.id === activeModule) ?? ANALYSIS_MODULES[0]
    return (
      <div
        className="sticky top-0 z-20 border-b border-[var(--card-divider)] bg-[var(--panel-bg)]/95 px-4 pb-3 pt-4 backdrop-blur"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="relative">
          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[var(--text-soft)]">分析模組</span>
          <button
            type="button"
            onFocus={() => setOpen(true)}
            className="flex w-full items-center justify-between rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-left shadow-[var(--card-shadow-soft)]"
          >
            <span>
              <span className="block text-sm font-medium text-[var(--input-text)]">{activeInfo.label}</span>
              <span className="mt-0.5 block text-[11px] text-[var(--text-soft)]">{activeInfo.detail}</span>
            </span>
            <span className="text-xs text-[var(--text-soft)]">{open ? '▴' : '▾'}</span>
          </button>
          {open && (
            <div className="absolute left-0 right-0 top-[calc(100%+0.45rem)] rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-2 shadow-[var(--card-shadow)]">
              {ANALYSIS_MODULES.map(module => {
                const isActive = module.id === activeModule
                return (
                  <button
                    key={module.id}
                    type="button"
                    disabled={isActive}
                    onClick={() => {
                      if (!isActive) onSelectModule?.(module.id)
                      setOpen(false)
                    }}
                    className={[
                      'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors pressable',
                      isActive
                        ? 'bg-[var(--accent-soft)] text-[var(--text-main)]'
                        : 'text-[var(--text-main)] hover:bg-[var(--card-ghost)]',
                    ].join(' ')}
                  >
                    <span>
                      <span className="block text-sm font-medium">{module.label}</span>
                      <span className="mt-0.5 block text-[11px] text-[var(--text-soft)]">{module.detail}</span>
                    </span>
                    {isActive && <span className="text-xs text-[var(--accent-strong)]">目前</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-5">
      <p className="text-sm font-semibold text-[var(--text-main)]">分析模組</p>
      <div className="mt-3 space-y-2">
        {ANALYSIS_MODULES.map(module => {
          const isActive = module.id === activeModule
          return (
            <button
              key={module.id}
              type="button"
              disabled={isActive}
              onClick={() => { if (!isActive) onSelectModule?.(module.id) }}
              className={[
                'flex w-full items-center justify-between px-4 py-3 text-left transition-colors shadow-[var(--card-shadow-soft)]',
                isActive
                  ? 'theme-pill rounded-[24px] text-[var(--text-main)]'
                  : 'theme-block rounded-[18px] text-[var(--text-main)] hover:border-[color:color-mix(in_srgb,var(--accent-strong)_35%,var(--card-border))]',
              ].join(' ')}
            >
              <div className="flex items-center gap-3">
                <span
                  className={[
                    'h-4 w-4 rounded-full border',
                    isActive
                      ? 'border-[var(--accent-secondary)] bg-[var(--accent-secondary)]'
                      : 'border-[var(--accent-strong)] bg-[color:color-mix(in_srgb,var(--accent-strong)_18%,transparent)]',
                  ].join(' ')}
                />
                <div>
                  <div className="text-sm font-semibold">{module.label}</div>
                  <div className="text-[11px] text-[var(--text-soft)]">{module.detail}</div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
