import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ANALYSIS_MODULES, type AnalysisModuleId } from './components/AnalysisModuleNav'
import CursorParticles from './components/CursorParticles'
import Raman from './pages/Raman'
import XAS from './pages/XAS'
import XES from './pages/XES'
import XPS from './pages/XPS'
import XRD from './pages/XRD'
import SingleProcessTool, { type SingleToolKind } from './pages/SingleProcessTool'

type ThemeId =
  | 'apricot'
  | 'pearl'
  | 'ocean'
  | 'ink'
  | 'ember'
  | 'forest'
  | 'amber'
  | 'rose'
  | 'copper'
  | 'graphite'
  | 'obsidian'
  | 'christmas'
type FontId = 'ui' | 'kai' | 'serif'
type FontScale = 'sm' | 'md' | 'lg'
type WorkspaceId = 'workflow-raman' | 'workflow-xrd' | 'workflow-xas' | 'workflow-xps' | 'workflow-xes' | `tool-${SingleToolKind}`

const THEMES: { id: ThemeId; label: string; tone: string; shape: 'round' | 'soft' | 'square'; palette: [string, string, string] }[] = [
  // Reference set: retained core / moon / spectrum palettes plus eight supplemental modes.
  { id: 'apricot', label: '核心', tone: '冰藍黑', shape: 'soft', palette: ['#8FB4C9', '#EAF3FB', '#CFE3F1'] },
  { id: 'pearl', label: '月白', tone: '銀白藍', shape: 'round', palette: ['#EAF3FB', '#CFE3F1', '#8FB4C9'] },
  { id: 'ember', label: '光譜', tone: '冷藍金', shape: 'square', palette: ['#F5CF85', '#EAF3FB', '#8FB4C9'] },
  { id: 'ocean', label: '掃描', tone: '孔雀青', shape: 'soft', palette: ['#43A693', '#ABE9DE', '#76D5C3'] },
  { id: 'forest', label: '晶格', tone: '葉晶綠', shape: 'round', palette: ['#5DBC52', '#ADE7AA', '#77BF74'] },
  { id: 'copper', label: '銅焰', tone: '珊瑚紅', shape: 'square', palette: ['#DE3E3E', '#F0CCC5', '#DB7B6F'] },
  { id: 'rose', label: '玫瑰', tone: '粉紫霧', shape: 'soft', palette: ['#C789B2', '#F6E0F1', '#D7ACCD'] },
  { id: 'amber', label: '琥珀', tone: '象牙金', shape: 'round', palette: ['#E4D785', '#FFFAD5', '#F1F2C0'] },
  { id: 'ink', label: '深場', tone: '灰藍霧', shape: 'square', palette: ['#6B828B', '#C8E8E9', '#91B4BF'] },
  { id: 'graphite', label: '石墨', tone: '中性灰', shape: 'soft', palette: ['#3C403F', '#999999', '#6F6F6F'] },
  { id: 'obsidian', label: '黑曜', tone: '紫晶黑', shape: 'square', palette: ['#4B39D7', '#746BB8', '#6F588E'] },
  { id: 'christmas', label: '聖誕', tone: '松綠金紅', shape: 'round', palette: ['#147A1F', '#FFFFD6', '#C62828'] },
]

const FONT_FAMILIES: { id: FontId; label: string; note: string }[] = [
  { id: 'ui', label: '介面體', note: 'Times / 黑體' },
  { id: 'kai', label: '標楷體', note: 'Times / 楷體' },
  { id: 'serif', label: '襯線體', note: 'Times / 明體' },
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
  const [workspaceLauncherOpen, setWorkspaceLauncherOpen] = useState(false)
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
  const workspaceLauncherRef = useRef<HTMLDivElement | null>(null)
  const workspaceLauncherCloseTimerRef = useRef<number | null>(null)

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

  useEffect(() => {
    return () => {
      if (workspaceLauncherCloseTimerRef.current != null) {
        window.clearTimeout(workspaceLauncherCloseTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!workspaceLauncherRef.current?.contains(event.target as Node)) {
        setWorkspaceLauncherOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWorkspaceLauncherOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const openWorkspaceLauncher = () => {
    if (workspaceLauncherCloseTimerRef.current != null) {
      window.clearTimeout(workspaceLauncherCloseTimerRef.current)
      workspaceLauncherCloseTimerRef.current = null
    }
    setWorkspaceLauncherOpen(true)
  }

  const closeWorkspaceLauncher = () => {
    if (workspaceLauncherCloseTimerRef.current != null) {
      window.clearTimeout(workspaceLauncherCloseTimerRef.current)
    }
    workspaceLauncherCloseTimerRef.current = window.setTimeout(() => {
      setWorkspaceLauncherOpen(false)
      workspaceLauncherCloseTimerRef.current = null
    }, 180)
  }

  const toggleWorkspaceLauncher = () => {
    if (workspaceLauncherCloseTimerRef.current != null) {
      window.clearTimeout(workspaceLauncherCloseTimerRef.current)
      workspaceLauncherCloseTimerRef.current = null
    }
    setWorkspaceLauncherOpen(current => !current)
  }

  const handleModuleSelect = (module: AnalysisModuleId) => {
    if (module === 'raman') setWorkspace('workflow-raman')
    if (module === 'xrd') setWorkspace('workflow-xrd')
    if (module === 'xas') setWorkspace('workflow-xas')
    if (module === 'xps') setWorkspace('workflow-xps')
    if (module === 'xes') setWorkspace('workflow-xes')
  }

  const themeLauncher = (
    <div className="theme-launcher">
      <button
        type="button"
        className="theme-launcher__gear pressable"
        aria-label="打開主題設定"
        aria-expanded="false"
      >
        <span className="theme-launcher__gear-icon" aria-hidden="true" />
      </button>

      <div className="theme-dock theme-launcher__panel" aria-hidden="true">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-soft)]">
              System
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--text-main)]">核心介面</div>
          </div>
          <div className="rounded-full border border-[var(--pill-border)] bg-[var(--pill-bg)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
            {THEMES.length} modes
          </div>
        </div>

        <div className="grid max-h-[28rem] grid-cols-3 gap-2.5 overflow-y-auto pr-1">
          {THEMES.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTheme(item.id)}
              style={{
                '--swatch-a': item.palette[0],
                '--swatch-b': item.palette[1],
                '--swatch-c': item.palette[2],
              } as CSSProperties}
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
    </div>
  )

  return (
    <div className="app-root relative min-h-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
      <div className="nigiro-backdrop pointer-events-none absolute inset-0 overflow-hidden">
        <div className="nigiro-backdrop__grid" />
      </div>
      <CursorParticles />
      {typeof document !== 'undefined' ? createPortal(themeLauncher, document.body) : themeLauncher}

      <div
        ref={workspaceLauncherRef}
        className={[
          'workspace-launcher fixed right-0 top-1/2 z-30 -translate-y-1/2 pr-3 sm:pr-4',
          workspaceLauncherOpen ? 'workspace-launcher--open' : '',
        ].join(' ')}
        onMouseEnter={openWorkspaceLauncher}
        onMouseLeave={() => {
          if (workspaceLauncherOpen) closeWorkspaceLauncher()
        }}
        onFocusCapture={openWorkspaceLauncher}
        onBlurCapture={event => {
          const nextFocused = event.relatedTarget
          if (!event.currentTarget.contains(nextFocused as Node | null)) {
            closeWorkspaceLauncher()
          }
        }}
      >
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
                    onClick={() => {
                      setWorkspace(wsId)
                      setWorkspaceLauncherOpen(false)
                    }}
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
                  onClick={() => {
                    setWorkspace(item.id)
                    setWorkspaceLauncherOpen(false)
                  }}
                  className="workspace-launcher__item pressable"
                >
                  <span className="workspace-launcher__item-label">{item.label}</span>
                  <span className="workspace-launcher__item-detail">{item.detail}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="workspace-launcher__tab"
          aria-expanded={workspaceLauncherOpen}
          aria-label="切換分析工具選單"
          onClick={event => {
            event.stopPropagation()
            toggleWorkspaceLauncher()
          }}
        >
          選單
        </button>
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
