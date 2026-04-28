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
