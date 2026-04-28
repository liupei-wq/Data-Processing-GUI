import { useEffect, useState } from 'react'
import { ANALYSIS_MODULES, type AnalysisModuleId } from './components/AnalysisModuleNav'
import Raman from './pages/Raman'
import XAS from './pages/XAS'
import XES from './pages/XES'
import XPS from './pages/XPS'
import XRD from './pages/XRD'
import SingleProcessTool, { type SingleToolKind } from './pages/SingleProcessTool'

type ThemeId = 'apricot' | 'pearl' | 'ocean' | 'ink' | 'ember' | 'forest'
type FontId = 'ui' | 'kai' | 'serif'
type FontScale = 'sm' | 'md' | 'lg'
type WorkspaceId = 'workflow-raman' | 'workflow-xrd' | 'workflow-xas' | 'workflow-xps' | 'workflow-xes' | `tool-${SingleToolKind}`

const THEMES: { id: ThemeId; label: string; tone: string; shape: 'round' | 'soft' | 'square' }[] = [
  { id: 'apricot', label: '杏桃', tone: '暖奶油', shape: 'round' },
  { id: 'pearl', label: '柔白', tone: '灰白藍', shape: 'soft' },
  { id: 'ocean', label: '海霧', tone: '海藍綠', shape: 'soft' },
  { id: 'ink', label: '黑曜', tone: '黑白藍', shape: 'square' },
  { id: 'ember', label: '暮焰', tone: '酒紅橙', shape: 'square' },
  { id: 'forest', label: '森夜', tone: '墨綠金', shape: 'round' },
]

const FONT_FAMILIES: { id: FontId; label: string; note: string }[] = [
  { id: 'ui', label: '介面體', note: 'IBM Plex' },
  { id: 'kai', label: '標楷體', note: 'DFKai / KaiTi' },
  { id: 'serif', label: '襯線體', note: 'Noto Serif' },
]

const FONT_SCALES: { id: FontScale; label: string }[] = [
  { id: 'sm', label: '小' },
  { id: 'md', label: '中' },
  { id: 'lg', label: '大' },
]

const TOOL_WORKSPACES: { id: WorkspaceId; label: string; detail: string }[] = [
  { id: 'tool-background', label: '背景扣除', detail: '單一處理' },
  { id: 'tool-normalize', label: '歸一化', detail: '單一處理' },
  { id: 'tool-gaussian', label: '高斯模板扣除', detail: '單一處理' },
]

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceId>('workflow-raman')
  const [theme, setTheme] = useState<ThemeId>(() => {
    const saved = localStorage.getItem('nigiro-theme') as ThemeId | 'midnight' | null
    if (saved === 'midnight') return 'apricot'
    if (saved && THEMES.some(item => item.id === saved)) return saved
    return 'apricot'
  })
  const [fontFamily, setFontFamily] = useState<FontId>(() => {
    const saved = localStorage.getItem('nigiro-font-family') as FontId | null
    if (saved && FONT_FAMILIES.some(item => item.id === saved)) return saved
    return 'ui'
  })
  const [fontScale, setFontScale] = useState<FontScale>(() => {
    const saved = localStorage.getItem('nigiro-font-scale') as FontScale | null
    if (saved && FONT_SCALES.some(item => item.id === saved)) return saved
    return 'md'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('nigiro-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.font = fontFamily
    localStorage.setItem('nigiro-font-family', fontFamily)
  }, [fontFamily])

  useEffect(() => {
    document.documentElement.dataset.scale = fontScale
    localStorage.setItem('nigiro-font-scale', fontScale)
  }, [fontScale])

  const handleModuleSelect = (module: AnalysisModuleId) => {
    if (module === 'raman') setWorkspace('workflow-raman')
    if (module === 'xrd') setWorkspace('workflow-xrd')
    if (module === 'xas') setWorkspace('workflow-xas')
    if (module === 'xps') setWorkspace('workflow-xps')
    if (module === 'xes') setWorkspace('workflow-xes')
  }

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
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-soft)]">
                Theme
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--text-main)]">介面主題</div>
            </div>
            <div className="rounded-full border border-[var(--pill-border)] bg-[var(--pill-bg)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
              6 styles
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {THEMES.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTheme(item.id)}
                className={[
                  'theme-swatch theme-swatch--compact pressable',
                  item.shape === 'round'
                    ? 'rounded-[20px]'
                    : item.shape === 'square'
                      ? 'rounded-[12px]'
                      : 'rounded-[16px]',
                  theme === item.id ? 'theme-swatch-active' : '',
                ].join(' ')}
              >
                <span className="theme-swatch__chips theme-swatch__chips--compact">
                  <span className="theme-swatch__chip theme-swatch__chip--a" />
                  <span
                    className={[
                      'theme-swatch__chip theme-swatch__chip--b',
                      item.shape === 'round' ? 'rounded-full' : 'rounded-[7px]',
                    ].join(' ')}
                  />
                  <span
                    className={[
                      'theme-swatch__chip theme-swatch__chip--c',
                      item.shape === 'square' ? 'rounded-[5px]' : 'rounded-full',
                    ].join(' ')}
                  />
                </span>
                <span className="block text-left">
                  <span className="block text-sm font-semibold text-[var(--text-main)]">{item.label}</span>
                  <span className="mt-0.5 block text-[10px] text-[var(--text-soft)]">{item.tone}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">
              Font
            </div>
            <div className="grid grid-cols-3 gap-2">
              {FONT_FAMILIES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFontFamily(item.id)}
                  className={[
                    'theme-option-chip pressable',
                    fontFamily === item.id ? 'theme-option-chip--active' : '',
                  ].join(' ')}
                >
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="mt-0.5 block text-[10px] text-[var(--text-soft)]">{item.note}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">
              Size
            </div>
            <div className="grid grid-cols-3 gap-2">
              {FONT_SCALES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFontScale(item.id)}
                  className={[
                    'theme-size-chip pressable',
                    fontScale === item.id ? 'theme-size-chip--active' : '',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button type="button" className="theme-launcher__gear pressable" aria-label="打開主題設定">
          <span className="theme-launcher__gear-icon">⚙</span>
        </button>
      </div>

      <div className="workspace-launcher fixed right-0 top-1/2 z-30 -translate-y-1/2 pr-3 sm:pr-4">
        <div className="workspace-launcher__panel">
          {workspace.startsWith('tool-') ? (
            <div className="workspace-launcher__section">
              <div className="workspace-launcher__title">分析模組</div>
              {ANALYSIS_MODULES.map(item => {
                const wsId = `workflow-${item.id}` as WorkspaceId
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setWorkspace(wsId)}
                    className="workspace-launcher__item pressable"
                  >
                    <span className="workspace-launcher__item-label">{item.label}</span>
                    <span className="workspace-launcher__item-detail">{item.detail}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="workspace-launcher__section">
              <div className="workspace-launcher__title">單一處理</div>
              {TOOL_WORKSPACES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setWorkspace(item.id)}
                  className="workspace-launcher__item pressable"
                >
                  <span className="workspace-launcher__item-label">{item.label}</span>
                  <span className="workspace-launcher__item-detail">{item.detail}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="workspace-launcher__tab">選單</div>
      </div>

      <main className="relative z-10 min-h-screen">
        {workspace === 'workflow-raman' && <Raman onModuleSelect={handleModuleSelect} />}
        {workspace === 'workflow-xrd' && <XRD onModuleSelect={handleModuleSelect} />}
        {workspace === 'workflow-xas' && <XAS onModuleSelect={handleModuleSelect} />}
        {workspace === 'workflow-xps' && <XPS onModuleSelect={handleModuleSelect} />}
        {workspace === 'workflow-xes' && <XES onModuleSelect={handleModuleSelect} />}
        {workspace === 'tool-background' && <SingleProcessTool tool="background" />}
        {workspace === 'tool-normalize' && <SingleProcessTool tool="normalize" />}
        {workspace === 'tool-gaussian' && <SingleProcessTool tool="gaussian" />}
      </main>
    </div>
  )
}
