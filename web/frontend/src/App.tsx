import { useEffect, useState } from 'react'
import XRD from './pages/XRD'

type ThemeId = 'apricot' | 'pearl' | 'ink' | 'ocean'

const THEMES: { id: ThemeId; label: string; tone: string; shape: 'round' | 'soft' | 'square' }[] = [
  { id: 'apricot', label: '杏桃', tone: '奶油 / 珊瑚', shape: 'round' },
  { id: 'pearl', label: '柔白', tone: '米白 / 淺藍', shape: 'soft' },
  { id: 'ink', label: '黑曜', tone: '黑 / 白', shape: 'square' },
  { id: 'ocean', label: '海霧', tone: '海藍 / 青綠', shape: 'soft' },
]

export default function App() {
  const [theme, setTheme] = useState<ThemeId>(() => {
    const saved = localStorage.getItem('nigiro-theme') as ThemeId | 'midnight' | null
    if (saved === 'midnight') return 'apricot'
    return saved ?? 'apricot'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('nigiro-theme', theme)
  }, [theme])

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="hero-orb hero-orb-left" />
        <div className="hero-orb hero-orb-right" />
        <div className="hero-grid" />
      </div>

      <div className="theme-launcher fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6">
        <div className="theme-dock theme-launcher__panel">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                Theme
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--text-main)]">介面主題</div>
            </div>
            <div className="rounded-full border border-[var(--pill-border)] bg-[var(--pill-bg)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
              4 styles
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {THEMES.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTheme(item.id)}
                className={[
                  'theme-swatch',
                  item.shape === 'round'
                    ? 'rounded-[24px]'
                    : item.shape === 'square'
                      ? 'rounded-[14px]'
                      : 'rounded-[20px]',
                  theme === item.id ? 'theme-swatch-active' : '',
                ].join(' ')}
              >
                <span className="theme-swatch__chips">
                  <span className="theme-swatch__chip theme-swatch__chip--a" />
                  <span
                    className={[
                      'theme-swatch__chip theme-swatch__chip--b',
                      item.shape === 'round' ? 'rounded-full' : 'rounded-[8px]',
                    ].join(' ')}
                  />
                  <span
                    className={[
                      'theme-swatch__chip theme-swatch__chip--c',
                      item.shape === 'square' ? 'rounded-[6px]' : 'rounded-full',
                    ].join(' ')}
                  />
                </span>
                <span className="block text-left">
                  <span className="block text-sm font-semibold text-[var(--text-main)]">{item.label}</span>
                  <span className="mt-1 block text-[11px] text-[var(--text-soft)]">{item.tone}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="theme-launcher__gear" aria-label="打開主題設定">
          <span className="theme-launcher__gear-icon">⚙</span>
        </button>
      </div>

      <main className="relative z-10 min-h-screen">
        <XRD />
      </main>
    </div>
  )
}
