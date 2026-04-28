import XRD from './pages/XRD'

// Navigation tabs – add more modules here when ready
const NAV = [
  { id: 'xrd', label: 'XRD' },
  { id: 'raman', label: 'Raman', disabled: true },
  { id: 'xps', label: 'XPS', disabled: true },
  { id: 'xes', label: 'XES', disabled: true },
]

export default function App() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top navigation bar */}
      <header className="flex items-center gap-1 px-4 py-2 bg-slate-800 text-white shrink-0">
        <span className="font-semibold text-sm mr-4 tracking-wide">Spectroscopy Lab</span>
        {NAV.map(tab => (
          <button
            key={tab.id}
            disabled={tab.disabled}
            className={[
              'px-3 py-1 rounded text-sm transition-colors',
              tab.id === 'xrd' && !tab.disabled
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-hidden">
        <XRD />
      </main>
    </div>
  )
}
