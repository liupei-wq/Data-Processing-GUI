import XRD from './pages/XRD'

export default function App() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="hero-orb hero-orb-left" />
        <div className="hero-orb hero-orb-right" />
        <div className="hero-grid" />
      </div>

      <main className="relative z-10 min-h-screen">
        <XRD />
      </main>
    </div>
  )
}
