export type AnalysisModuleId = 'raman' | 'xrd' | 'xps' | 'xas' | 'xes' | 'sem'

export const ANALYSIS_MODULES: {
  id: AnalysisModuleId
  label: string
  detail: string
  ready: boolean
}[] = [
  { id: 'raman', label: 'Raman', detail: 'Raman Spectroscopy', ready: true },
  { id: 'xrd', label: 'XRD', detail: 'X-ray Diffraction', ready: true },
  { id: 'xps', label: 'XPS', detail: 'X-ray Photoelectron Spectroscopy', ready: true },
  { id: 'xas', label: 'XAS', detail: 'X-ray Absorption', ready: true },
  { id: 'xes', label: 'XES', detail: 'Coming soon', ready: false },
  { id: 'sem', label: 'SEM', detail: 'Coming soon', ready: false },
]

interface Props {
  activeModule: AnalysisModuleId
  onSelectModule?: (module: AnalysisModuleId) => void
}

export default function AnalysisModuleNav({ activeModule, onSelectModule }: Props) {
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
              disabled={!module.ready || isActive}
              onClick={() => {
                if (module.ready && module.id !== activeModule) onSelectModule?.(module.id)
              }}
              className={[
                'flex w-full items-center justify-between px-4 py-3 text-left transition-colors shadow-[var(--card-shadow-soft)]',
                isActive
                  ? 'theme-pill rounded-[24px] text-[var(--text-main)]'
                  : module.ready
                    ? 'theme-block rounded-[18px] text-[var(--text-main)] hover:border-[color:color-mix(in_srgb,var(--accent-strong)_35%,var(--card-border))]'
                    : 'theme-block-soft rounded-[16px] text-[var(--text-soft)] opacity-85',
              ].join(' ')}
            >
              <div className="flex items-center gap-3">
                <span
                  className={[
                    'h-4 w-4 rounded-full border',
                    isActive
                      ? 'border-[var(--accent-secondary)] bg-[var(--accent-secondary)]'
                      : module.ready
                        ? 'border-[var(--accent-strong)] bg-[color:color-mix(in_srgb,var(--accent-strong)_18%,transparent)]'
                        : 'border-[var(--card-border)] bg-transparent',
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
