import XRD from './pages/XRD'

const NAV = [
  { id: 'xrd', label: 'XRD' },
  { id: 'raman', label: 'Raman', disabled: true },
  { id: 'xps', label: 'XPS', disabled: true },
  { id: 'xes', label: 'XES', disabled: true },
]

export default function App() {
  return (
    <div className="min-h-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="hero-orb hero-orb-left" />
        <div className="hero-orb hero-orb-right" />
        <div className="hero-grid" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 pb-6 pt-4 sm:px-6 lg:px-8">
        <header className="glass-panel mb-4 flex flex-col gap-4 rounded-[28px] px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="brand-mark shrink-0">
              <span className="brand-mark__ring" />
              <span className="brand-mark__core" />
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/14 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-sky-100">
                  Web Prototype
                </span>
                <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                  Render Live
                </span>
              </div>
              <h1 className="font-display text-2xl tracking-[0.06em] text-white sm:text-3xl">
                Nigiro Pro
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300 sm:text-[15px]">
                Scientific data processing for spectroscopy workflows. The current web release
                focuses on XRD so the online prototype can stay stable while we iterate.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex flex-wrap gap-2">
              {NAV.map(tab => (
                <button
                  key={tab.id}
                  disabled={tab.disabled}
                  className={[
                    'rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition-all',
                    tab.id === 'xrd' && !tab.disabled
                      ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-100 shadow-[0_0_0_1px_rgba(125,211,252,0.12)]'
                      : 'border-white/10 bg-white/5 text-slate-400 disabled:cursor-not-allowed disabled:opacity-50',
                  ].join(' ')}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 text-left text-xs text-slate-300 sm:min-w-[280px]">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Mode</p>
                <p className="font-semibold text-slate-100">Interactive XRD</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Stack</p>
                <p className="font-semibold text-slate-100">FastAPI + React</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-hidden">
          <XRD />
        </main>
      </div>
    </div>
  )
}
