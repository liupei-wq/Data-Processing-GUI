/**
 * XRD 桌面版主流程 – React 前端本地計算
 * 
 * 7個獨立步驟：
 * 1. 上傳數據 (Upload)
 * 2. X軸偏移量微調 (X Shift)
 * 3. 背景扣除與強度轉換 (Signal Transform / Log)
 * 4. 疊圖設定 (Plot Settings)
 * 5. 固定參考峰 / 圖例 (Reference Markers)
 * 6. 峰位偏移報告 (Peak Offset Report)
 * 7. 數據匯出 (Export)
 */

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
import Plot from '../components/PlotlyChart'
import { type AnalysisModuleId } from '../components/AnalysisModuleNav'
import FileUpload from '../components/FileUpload'
import {
  ChartToolbar,
  DEFAULT_SERIES_PALETTE_KEYS,
  DeferredRender,
  EmptyWorkspaceState,
  LINE_COLOR_PALETTES,
  MODULE_CONTENT,
  ModuleTopBar,
  StickySidebarHeader,
} from '../components/WorkspaceUi'
import { formatUtc8Iso, timestampForUtc8Filename } from '../utils/time'
import { type XrdDesktopInputFile, type XrdDesktopReferenceDbRow } from '../types/xrdDesktop'

// 固定參考峰的代表色
export const PHASE_COLORS: Record<string, string> = {
  'β-Ga2O3': '#f43f5e',
  'Si': '#10b981',
  'NiO': '#a855f7',
  'Ti3CN': '#eab308',
  'Mo2Ti2C3': '#f97316',
  'TiO2 (Anatase)': '#3b82f6',
  'TiO2 (Rutile)': '#06b6d4',
  'ZnO': '#14b8a6',
}

// 擴充後且補齊的參考峰特徵資料庫 (REFERENCE_DB)
export const REFERENCE_DB: Record<string, Omit<XrdDesktopReferenceDbRow, 'phase'>[]> = {
  'β-Ga2O3': [
    { hkl: '-201', twoTheta: 18.9, intensity: 100, tolerance: 0.3 },
    { hkl: '400', twoTheta: 30.1, intensity: 45, tolerance: 0.3 },
    { hkl: '-111', twoTheta: 31.7, intensity: 35, tolerance: 0.3 },
    { hkl: '111', twoTheta: 35.2, intensity: 60, tolerance: 0.3 },
    { hkl: '-402', twoTheta: 38.4, intensity: 85, tolerance: 0.3 },
    { hkl: '-311', twoTheta: 45.8, intensity: 25, tolerance: 0.3 },
    { hkl: '600', twoTheta: 46.2, intensity: 20, tolerance: 0.3 },
    { hkl: '002', twoTheta: 48.6, intensity: 15, tolerance: 0.3 },
    { hkl: '-603', twoTheta: 59.1, intensity: 40, tolerance: 0.3 },
    { hkl: '311', twoTheta: 60.9, intensity: 30, tolerance: 0.3 },
    { hkl: '403', twoTheta: 64.6, intensity: 22, tolerance: 0.3 },
    { hkl: '-202', twoTheta: 23.5, intensity: 10, tolerance: 0.3 },
    { hkl: '310', twoTheta: 32.8, intensity: 12, tolerance: 0.3 },
    { hkl: '110', twoTheta: 33.2, intensity: 8, tolerance: 0.3 },
    { hkl: '-601', twoTheta: 41.7, intensity: 14, tolerance: 0.3 },
    { hkl: '020', twoTheta: 58.2, intensity: 18, tolerance: 0.3 },
    { hkl: '510', twoTheta: 62.1, intensity: 9, tolerance: 0.3 },
    { hkl: '710', twoTheta: 68.3, intensity: 7, tolerance: 0.3 },
    { hkl: '-801', twoTheta: 71.5, intensity: 11, tolerance: 0.3 },
    { hkl: '021', twoTheta: 74.2, intensity: 13, tolerance: 0.3 },
  ],
  'Si': [
    { hkl: '111', twoTheta: 28.44, intensity: 100, tolerance: 0.3 },
    { hkl: '220', twoTheta: 47.30, intensity: 55, tolerance: 0.3 },
    { hkl: '311', twoTheta: 56.12, intensity: 30, tolerance: 0.3 },
    { hkl: '400', twoTheta: 69.13, intensity: 6, tolerance: 0.3 },
    { hkl: '331', twoTheta: 76.38, intensity: 11, tolerance: 0.3 },
    { hkl: '422', twoTheta: 88.03, intensity: 12, tolerance: 0.3 },
    { hkl: '511', twoTheta: 94.95, intensity: 6, tolerance: 0.3 },
  ],
  'NiO': [
    { hkl: '111', twoTheta: 37.2, intensity: 60, tolerance: 0.3 },
    { hkl: '200', twoTheta: 43.3, intensity: 100, tolerance: 0.3 },
    { hkl: '220', twoTheta: 62.9, intensity: 57, tolerance: 0.3 },
    { hkl: '311', twoTheta: 75.4, intensity: 16, tolerance: 0.3 },
    { hkl: '222', twoTheta: 79.4, intensity: 15, tolerance: 0.3 },
  ],
  'Ti3CN': [
    { hkl: '002', twoTheta: 6.1, intensity: 100, tolerance: 0.3 },
    { hkl: '004', twoTheta: 12.3, intensity: 40, tolerance: 0.3 },
    { hkl: '006', twoTheta: 18.5, intensity: 20, tolerance: 0.3 },
    { hkl: '008', twoTheta: 24.8, intensity: 15, tolerance: 0.3 },
    { hkl: '0010', twoTheta: 31.2, intensity: 10, tolerance: 0.3 },
    { hkl: '110', twoTheta: 61.5, intensity: 35, tolerance: 0.3 },
  ],
  'Mo2Ti2C3': [
    { hkl: '002', twoTheta: 5.8, intensity: 100, tolerance: 0.3 },
    { hkl: '004', twoTheta: 11.7, intensity: 45, tolerance: 0.3 },
    { hkl: '006', twoTheta: 17.6, intensity: 25, tolerance: 0.3 },
    { hkl: '008', twoTheta: 23.6, intensity: 18, tolerance: 0.3 },
    { hkl: '0010', twoTheta: 29.7, intensity: 12, tolerance: 0.3 },
    { hkl: '0012', twoTheta: 35.9, intensity: 8, tolerance: 0.3 },
    { hkl: '110', twoTheta: 61.2, intensity: 30, tolerance: 0.3 },
  ],
  'TiO2 (Anatase)': [
    { hkl: '101', twoTheta: 25.28, intensity: 100, tolerance: 0.3 },
    { hkl: '103', twoTheta: 36.95, intensity: 10, tolerance: 0.3 },
    { hkl: '004', twoTheta: 37.80, intensity: 20, tolerance: 0.3 },
    { hkl: '200', twoTheta: 48.05, intensity: 35, tolerance: 0.3 },
    { hkl: '105', twoTheta: 53.89, intensity: 20, tolerance: 0.3 },
    { hkl: '211', twoTheta: 55.06, intensity: 20, tolerance: 0.3 },
    { hkl: '204', twoTheta: 62.69, intensity: 14, tolerance: 0.3 },
    { hkl: '116', twoTheta: 68.76, intensity: 6, tolerance: 0.3 },
    { hkl: '220', twoTheta: 70.31, intensity: 6, tolerance: 0.3 },
  ],
  'TiO2 (Rutile)': [
    { hkl: '110', twoTheta: 27.44, intensity: 100, tolerance: 0.3 },
    { hkl: '101', twoTheta: 36.08, intensity: 50, tolerance: 0.3 },
    { hkl: '200', twoTheta: 39.22, intensity: 8, tolerance: 0.3 },
    { hkl: '111', twoTheta: 41.25, intensity: 25, tolerance: 0.3 },
    { hkl: '210', twoTheta: 44.08, intensity: 10, tolerance: 0.3 },
    { hkl: '211', twoTheta: 54.34, intensity: 60, tolerance: 0.3 },
    { hkl: '220', twoTheta: 56.64, intensity: 20, tolerance: 0.3 },
    { hkl: '002', twoTheta: 62.74, intensity: 10, tolerance: 0.3 },
    { hkl: '310', twoTheta: 64.04, intensity: 10, tolerance: 0.3 },
    { hkl: '301', twoTheta: 69.01, intensity: 20, tolerance: 0.3 },
  ],
  'ZnO': [
    { hkl: '100', twoTheta: 31.77, intensity: 57, tolerance: 0.3 },
    { hkl: '002', twoTheta: 34.42, intensity: 40, tolerance: 0.3 },
    { hkl: '101', twoTheta: 36.25, intensity: 100, tolerance: 0.3 },
    { hkl: '102', twoTheta: 47.54, intensity: 23, tolerance: 0.3 },
    { hkl: '110', twoTheta: 56.60, intensity: 32, tolerance: 0.3 },
    { hkl: '103', twoTheta: 62.86, intensity: 29, tolerance: 0.3 },
    { hkl: '200', twoTheta: 66.38, intensity: 4, tolerance: 0.3 },
    { hkl: '112', twoTheta: 67.96, intensity: 23, tolerance: 0.3 },
    { hkl: '201', twoTheta: 69.10, intensity: 11, tolerance: 0.3 },
  ],
}

// 側邊欄收折高度與最大寬度定義
const SIDEBAR_MIN_WIDTH = 320
const SIDEBAR_MAX_WIDTH = 560
const SIDEBAR_DEFAULT_WIDTH = 368
const SIDEBAR_COLLAPSED_PEEK = 28

// 取得第 P 百分位數的輔助函數 (基線扣除使用)
function getPercentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[index]
}

// 本地尋峰輔助函數
function findLocalPeaks(x: number[], y: number[], minRelIntensity: number): { x: number; y: number }[] {
  const peaks: { x: number; y: number }[] = []
  const maxY = Math.max(...y)
  if (maxY <= 0) return []
  const threshold = maxY * (minRelIntensity / 100)

  // 簡單的五點尋峰法 (i 大於左右兩邊的兩點)
  for (let i = 2; i < y.length - 2; i++) {
    if (
      y[i] > threshold &&
      y[i] > y[i - 1] &&
      y[i] > y[i - 2] &&
      y[i] > y[i + 1] &&
      y[i] > y[i + 2]
    ) {
      peaks.push({ x: x[i], y: y[i] })
    }
  }
  return peaks.sort((a, b) => b.y - a.y) // 按強度降序排序
}

// 本地 Section 元件 (XPS 風格，含微動態與玻璃高邊框)
function Section({
  step,
  title,
  hint,
  children,
  defaultOpen = true,
}: {
  step: number
  title: string
  hint?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`border-b border-slate-800/40 bg-slate-900/10 transition-all ${open ? 'pb-4' : 'pb-0'}`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-800/20 transition-colors focus:outline-none"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[10px] font-bold text-[var(--accent)] border border-[var(--accent)]/20">
            {step}
          </span>
          <div>
            <h3 className="text-xs font-bold tracking-wide text-slate-200">{title}</h3>
            {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
          </div>
        </div>
        <span className={`text-slate-500 text-xs transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
          ▶
        </span>
      </button>
      {open && <div className="px-4 pt-2 space-y-3">{children}</div>}
    </div>
  )
}

export default function XRD({
  onModuleSelect,
}: {
  onModuleSelect?: (module: AnalysisModuleId) => void
  onOpenPlotPopup?: (popup: any) => void
}) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('nigiro-xrd-sidebar-width'))
    if (Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH) {
      return saved
    }
    return SIDEBAR_DEFAULT_WIDTH
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem('nigiro-xrd-sidebar-collapsed') === 'true')
  const [sidebarResizing, setSidebarResizing] = useState(false)

  // 原始數據
  const [rawFiles, setRawFiles] = useState<XrdDesktopInputFile[]>([])
  
  // 強度強度轉換模式
  const [transformMode, setTransformMode] = useState<'log10' | 'ln' | 'sqrt' | 'none'>('none')

  // 疊圖與查看模式
  const [viewMode, setViewMode] = useState<'single' | 'overlay'>('single')
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null)
  
  // 參考峰設定
  const [enabledRefCompounds, setEnabledRefCompounds] = useState<Record<string, boolean>>({
    'β-Ga2O3': false,
    'Si': false,
    'NiO': false,
  })
  const [showReferenceMarkers, setShowReferenceMarkers] = useState<boolean>(true)

  // 峰位偏移比對設定
  const [peakIntensityThreshold, setPeakIntensityThreshold] = useState<number>(10)
  const [peakOffsetTolerance, setPeakOffsetTolerance] = useState<number>(0.3)

  // 顏色控制
  const [chartLineColors, setChartLineColors] = useState({
    single: 'blue',
    overlay: 'blue',
  })

  useEffect(() => {
    localStorage.setItem('nigiro-xrd-sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    localStorage.setItem('nigiro-xrd-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  // 拖曳改變側邊欄寬度
  useEffect(() => {
    if (!sidebarResizing) return

    const handleMove = (event: MouseEvent) => {
      const nextWidth = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, event.clientX),
      )
      setSidebarWidth(nextWidth)
      if (sidebarCollapsed) setSidebarCollapsed(false)
    }

    const handleUp = () => {
      setSidebarResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [sidebarCollapsed, sidebarResizing])

  // 強健的 XRD 文字檔解析器
  const handleFilesUpload = useCallback((files: File[]) => {
    const newFilesPromises = files.map(file => {
      return new Promise<XrdDesktopInputFile>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = e => {
          const content = e.target?.result as string
          const lines = content.split('\n')
          const x: number[] = []
          const y: number[] = []

          for (let line of lines) {
            line = line.trim()
            if (!line || line.startsWith('#') || line.startsWith('*')) continue
            const parts = line.split(/[\s,;\t]+/)
            if (parts.length >= 2) {
              const xVal = parseFloat(parts[0])
              const yVal = parseFloat(parts[1])
              if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
                x.push(xVal)
                y.push(yVal)
              }
            }
          }

          if (x.length === 0) {
            reject(new Error(`${file.name} 中沒有找到有效數據點`))
            return
          }

          const fileId = Math.random().toString(36).substr(2, 9)
          const colorKeys = DEFAULT_SERIES_PALETTE_KEYS
          const color = LINE_COLOR_PALETTES[colorKeys[Math.floor(Math.random() * colorKeys.length)]]?.primary || '#38bdf8'

          resolve({
            id: fileId,
            name: file.name,
            x,
            y,
            label: file.name,
            shortLabel: file.name.substring(0, 8),
            color,
            offset: 0,
            linewidth: 2,
            labelX: x[Math.floor(x.length / 2)] || 0,
            labelYAdd: 0,
            xShift: 0,
          })
        }
        reader.onerror = () => reject(new Error('檔案讀取失敗'))
        reader.readAsText(file)
      })
    })

    Promise.all(newFilesPromises)
      .then(parsed => {
        setRawFiles(prev => {
          const updated = [...prev, ...parsed]
          if (!selectedDatasetId && updated.length > 0) {
            setSelectedDatasetId(updated[0].id)
          }
          return updated
        })
      })
      .catch(err => {
        alert(err.message)
      })
  }, [selectedDatasetId])

  // 1. 本地數據前處理管線 (Pipeline)
  const processedTraces = useMemo(() => {
    return rawFiles.map(file => {
      // 1. 基線扣除：計算強度之 1st percentile 得到背景
      const sortedY = [...file.y].sort((a, b) => a - b)
      const pct1Index = Math.floor((sortedY.length - 1) * 0.01)
      const baseline = sortedY[pct1Index] || 0

      const yProcessed = file.y.map(yVal => {
        // y_corr = y - baseline + 1
        let yCorr = yVal - baseline + 1
        if (yCorr <= 0) yCorr = 1 // 壓成 1 防止 log 出錯

        if (transformMode === 'log10') {
          return Math.log10(yCorr)
        } else if (transformMode === 'ln') {
          return Math.log(yCorr)
        } else if (transformMode === 'sqrt') {
          return Math.sqrt(yCorr)
        }
        return yCorr
      })

      // 2. X 軸偏移 (xShift)
      const xProcessed = file.x.map(xVal => xVal + (file.xShift || 0))

      // 3. Y 軸疊加偏移 (yStacked)
      const yStacked = yProcessed.map(yVal => yVal + (file.offset || 0))

      return {
        ...file,
        xProcessed,
        yProcessed,
        yStacked,
        baseline,
      }
    })
  }, [rawFiles, transformMode])

  // 當前選中的 active trace
  const activeTrace = useMemo(() => {
    return processedTraces.find(t => t.id === selectedDatasetId) || processedTraces[0] || null
  }, [processedTraces, selectedDatasetId])

  // 2. 峰位偏移自動偵測與比對報告 (前端計算)
  const peakOffsetReport = useMemo(() => {
    const reports: Record<string, {
      observedPeak2Theta: number
      observedIntensity: number
      refPeak2Theta: number
      hkl: string
      delta: number
      phase: string
    }[]> = {}

    processedTraces.forEach(trace => {
      const peaks = findLocalPeaks(trace.xProcessed, trace.yProcessed, peakIntensityThreshold)
      const topPeaks = peaks.slice(0, 10)
      const traceReport: typeof reports[string] = []

      topPeaks.forEach(peak => {
        let closestRef: any = null
        let minDelta = peakOffsetTolerance
        let closestCompName = ''

        // 與已啟用的參考化合物比對
        Object.keys(enabledRefCompounds).forEach(compName => {
          if (enabledRefCompounds[compName]) {
            const refPeaks = REFERENCE_DB[compName] || []
            refPeaks.forEach(ref => {
              const delta = Math.abs(peak.x - ref.twoTheta)
              if (delta < minDelta) {
                minDelta = delta
                closestRef = ref
                closestCompName = compName
              }
            })
          }
        })

        if (closestRef) {
          traceReport.push({
            observedPeak2Theta: peak.x,
            observedIntensity: peak.y,
            refPeak2Theta: closestRef.twoTheta,
            hkl: closestRef.hkl,
            delta: peak.x - closestRef.twoTheta,
            phase: closestCompName,
          })
        }
      })

      reports[trace.id] = traceReport.sort((a, b) => a.observedPeak2Theta - b.observedPeak2Theta)
    })

    return reports
  }, [processedTraces, enabledRefCompounds, peakIntensityThreshold, peakOffsetTolerance])

  // 3. 一鍵均勻分配 Y 軸偏移量
  const handleAutoStackOffsets = () => {
    if (processedTraces.length === 0) return
    
    // 計算處理後最大強度的平均，作為偏移的推薦間隔
    const maxVals = processedTraces.map(t => Math.max(...t.yProcessed))
    const avgMax = maxVals.reduce((sum, v) => sum + v, 0) / maxVals.length
    const stackGap = avgMax * 0.45 || 1.0

    setRawFiles(prev =>
      prev.map((file, idx) => ({
        ...file,
        offset: idx * stackGap,
      }))
    )
  }

  // 4. Plotly Traces 渲染
  const plotlyTraces = useMemo(() => {
    const traces: Plotly.Data[] = []

    // 1. 繪製光譜線條
    if (viewMode === 'single' && activeTrace) {
      traces.push({
        x: activeTrace.xProcessed,
        y: activeTrace.yProcessed,
        type: 'scatter',
        mode: 'lines',
        name: activeTrace.name,
        line: {
          color: activeTrace.color,
          width: activeTrace.linewidth,
        },
      })
    } else if (viewMode === 'overlay') {
      processedTraces.forEach(trace => {
        traces.push({
          x: trace.xProcessed,
          y: trace.yStacked,
          type: 'scatter',
          mode: 'lines',
          name: trace.name,
          line: {
            color: trace.color,
            width: trace.linewidth,
          },
        })
      })
    }

    // 2. 繪製固定參考峰垂直虛線 (垂直高度按相位分組，legend group 控制)
    if (showReferenceMarkers && processedTraces.length > 0) {
      // 取得全圖中強度的最高點，以決定垂直點線高度
      let globalMax = 100
      if (viewMode === 'single' && activeTrace) {
        globalMax = Math.max(...activeTrace.yProcessed)
      } else {
        globalMax = Math.max(...processedTraces.flatMap(t => t.yStacked))
      }

      Object.keys(enabledRefCompounds).forEach(compName => {
        if (enabledRefCompounds[compName]) {
          const peaks = REFERENCE_DB[compName] || []
          const phaseColor = PHASE_COLORS[compName] || '#ef4444'

          peaks.forEach((peak, peakIdx) => {
            const lineTop = globalMax * (peak.intensity / 100)
            
            traces.push({
              x: [peak.twoTheta, peak.twoTheta],
              y: [0, lineTop],
              type: 'scatter',
              mode: 'lines+text',
              // 僅在垂直點線的頂端顯示 hkl 字樣，底部為空字串
              text: ['', `(${peak.hkl})`],
              textposition: 'top center',
              textfont: {
                color: phaseColor,
                size: 10,
              },
              line: {
                color: phaseColor,
                dash: 'dot',
                width: 1.2,
              },
              legendgroup: compName,
              showlegend: peakIdx === 0, // 圖例僅顯示該相位的首個 trace
              name: compName,
              hoverinfo: 'none',
            } as any)
          })
        }
      })
    }

    return traces
  }, [viewMode, activeTrace, processedTraces, showReferenceMarkers, enabledRefCompounds])

  // Plotly 圖表外觀 Layout 設定
  const plotlyLayout = useMemo(() => {
    const chartGrid = 'rgba(148, 163, 184, 0.12)'
    const chartText = '#cbd5e1'
    const chartBg = 'rgba(15, 23, 42, 0.55)'
    const chartLegendBg = 'rgba(15, 23, 42, 0.8)'
    const chartHoverBorder = 'rgba(148, 163, 184, 0.2)'

    let yTitle = '強度（a.u.）'
    if (transformMode === 'log10') yTitle = '強度對數 Log10（a.u.）'
    else if (transformMode === 'ln') yTitle = '強度對數 Ln（a.u.）'
    else if (transformMode === 'sqrt') yTitle = '強度開根號 Sqrt（a.u.）'

    return {
      xaxis: {
        title: { text: '2θ（degree）', font: { size: 12 } },
        showgrid: true,
        gridcolor: chartGrid,
        zeroline: false,
        color: chartText,
      },
      yaxis: {
        title: { text: yTitle, font: { size: 12 } },
        showgrid: true,
        gridcolor: chartGrid,
        zeroline: false,
        color: chartText,
      },
      legend: {
        x: 1,
        xanchor: 'right',
        y: 1,
        bgcolor: chartLegendBg,
        bordercolor: chartHoverBorder,
        borderwidth: 1,
        font: { color: chartText, size: 11 },
      },
      margin: { l: 60, r: 24, t: 36, b: 52 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: chartBg,
      font: { color: chartText },
      hovermode: 'x unified',
      autosize: true,
      height: 480,
    } as Partial<Plotly.Layout>
  }, [transformMode])

  // 5. 檔案資料導出控制 (CSV/TXT 下載)
  const handleExportDataCsv = () => {
    if (processedTraces.length === 0) return
    
    let csvContent = '2Theta(degree)'
    processedTraces.forEach(t => {
      csvContent += `,${t.name}_Y_Processed`
      if (viewMode === 'overlay') {
        csvContent += `,${t.name}_Y_Stacked`
      }
    })
    csvContent += '\n'

    // 以第一筆 Trace 的長度做基準
    const baseTrace = processedTraces[0]
    for (let i = 0; i < baseTrace.xProcessed.length; i++) {
      let line = baseTrace.xProcessed[i].toFixed(4)
      processedTraces.forEach(t => {
        const yVal = t.yProcessed[i]
        line += `,${yVal != null ? yVal.toFixed(6) : ''}`
        if (viewMode === 'overlay') {
          const yStack = t.yStacked[i]
          line += `,${yStack != null ? yStack.toFixed(6) : ''}`
        }
      })
      csvContent += line + '\n'
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `XRD_Processed_Data_${timestampForUtc8Filename()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // 6. 匯出峰位偏移報告文字檔
  const handleExportOffsetReport = () => {
    if (processedTraces.length === 0) return
    
    let reportTxt = `Nigiro Pro XRD 峰位偏移比對報告\n產生日期的：${formatUtc8Iso(new Date())}\n`
    reportTxt += `比對設定：最小相對強度 ${peakIntensityThreshold}%，容忍度 ${peakOffsetTolerance}°\n`
    reportTxt += `強度轉換方式：${transformMode}\n`
    reportTxt += `=========================================\n\n`

    processedTraces.forEach(trace => {
      reportTxt += `檔案名稱：${trace.name}\n`
      reportTxt += `背景估算值 (baseline)：${trace.baseline.toFixed(2)}\n`
      reportTxt += `X軸偏移值 (X Shift)：${(trace.xShift || 0).toFixed(4)}°\n`
      reportTxt += `-----------------------------------------\n`

      const reps = peakOffsetReport[trace.id] || []
      if (reps.length === 0) {
        reportTxt += `  在此比對設定下未找到可匹配的峰位。\n`
      } else {
        reportTxt += `  偵測峰位(2θ)  |  匹配相/晶面  |  參考峰位(2θ)  |  偏移量(Δ2θ)\n`
        reps.forEach(r => {
          reportTxt += `  ${r.observedPeak2Theta.toFixed(3).padEnd(14)}|  ${(r.phase + ' ' + r.hkl).padEnd(14)}|  ${r.refPeak2Theta.toFixed(3).padEnd(16)}|  ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(3)}°\n`
        })
      }
      reportTxt += `=========================================\n\n`
    })

    const blob = new Blob([reportTxt], { type: 'text/plain;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `XRD_Peak_Offset_Report_${timestampForUtc8Filename()}.txt`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // 側邊欄寬度設定樣式
  const sidebarStyle = sidebarCollapsed
    ? { width: `${SIDEBAR_COLLAPSED_PEEK}px` }
    : { width: `${sidebarWidth}px` }

  return (
    <div className={`flex h-screen flex-row overflow-hidden bg-slate-950 text-slate-100 ${sidebarResizing ? 'select-none' : ''}`}>
      
      {/* ── 左側控制側欄 (aside) ── */}
      <aside
        style={sidebarStyle}
        className={`relative flex shrink-0 flex-col overflow-hidden border-r border-slate-800/40 bg-slate-900/40 backdrop-blur-xl ${
          sidebarResizing ? '' : 'transition-[width] duration-200'
        }`}
      >
        {sidebarCollapsed ? (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="flex h-full w-full flex-col items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <span className="text-lg">›</span>
          </button>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <StickySidebarHeader
                activeModule="xrd"
                subtitle="桌面版流程模擬器"
                onSelectModule={onModuleSelect}
                onCollapse={() => setSidebarCollapsed(true)}
              />

              {/* Step 1: 上傳數據 */}
              <Section step={1} title="上傳 XRD 數據" hint="匯入 .txt / .xy 文字格式">
                <FileUpload
                  accept={['.txt', '.xy', '.csv']}
                  onFiles={handleFilesUpload}
                  moduleLabel="XRD"
                />
                
                {rawFiles.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">已載入光譜列表</p>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {rawFiles.map(f => (
                        <button
                          key={f.id}
                          onClick={() => setSelectedDatasetId(f.id)}
                          className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-all ${
                            selectedDatasetId === f.id
                              ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-white'
                              : 'border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-white/20 shrink-0"
                            style={{ backgroundColor: f.color }}
                          />
                          <span className="truncate flex-1">{f.name}</span>
                          <span className="text-[10px] text-slate-500 shrink-0">{f.x.length} 點</span>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        setRawFiles([])
                        setSelectedDatasetId(null)
                      }}
                      className="text-[10px] font-semibold text-rose-400 hover:text-rose-300 transition-colors"
                    >
                      ✕ 清除所有光譜
                    </button>
                  </div>
                )}
              </Section>

              {/* Step 2: X軸偏移微調 */}
              <Section step={2} title="X軸偏移量微調 (X Shift)" hint="修正繞射角度 2θ 系統偏移">
                {rawFiles.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">請先載入 XRD 光譜數據</p>
                ) : (
                  <div className="space-y-2.5">
                    {rawFiles.map(f => (
                      <div key={f.id} className="flex items-center justify-between gap-3 bg-slate-900/30 border border-slate-800/40 rounded-lg px-2.5 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
                          <span className="text-[11px] font-medium text-slate-300 truncate" title={f.name}>{f.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] text-slate-500">Δ2θ:</span>
                          <input
                            type="number"
                            step="0.01"
                            value={f.xShift || 0}
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0
                              setRawFiles(prev => prev.map(item => item.id === f.id ? { ...item, xShift: val } : item))
                            }}
                            className="w-16 rounded border border-slate-700 bg-slate-800/80 px-1 py-0.5 text-center text-xs text-white focus:outline-none focus:border-[var(--accent)]"
                          />
                          <span className="text-[10px] text-slate-500">°</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Step 3: 背景校正與信號轉換 */}
              <Section step={3} title="強度轉換與基線扣除" hint="強度取對數與基線百分位數估算">
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[10px] text-slate-400 uppercase tracking-wider">強度轉換方式</label>
                    <select
                      value={transformMode}
                      onChange={e => setTransformMode(e.target.value as any)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[var(--accent)]"
                    >
                      <option value="none">無 (Raw Intensity)</option>
                      <option value="log10">Log10 強度對數</option>
                      <option value="ln">Ln 自然對數</option>
                      <option value="sqrt">Sqrt 強度開根號</option>
                    </select>
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-slate-900/20 p-2.5 text-[10px] leading-relaxed text-slate-400">
                    <p className="font-semibold text-slate-300 mb-1">💡 計算管線說明：</p>
                    <ul className="list-disc pl-3.5 space-y-0.5">
                      <li>以訊號的 1st percentile 數值作為背景 baseline。</li>
                      <li>校正公式：y_corr = y - baseline + 1。</li>
                      <li>非負值壓制保護：當 y_corr ≤ 0 時壓成 1 防止 log 出錯。</li>
                    </ul>
                  </div>
                </div>
              </Section>

              {/* Step 4: 疊圖設定 */}
              <Section step={4} title="疊圖外觀設定 (Plot Settings)" hint="設定線寬、調色與垂直偏移">
                {rawFiles.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">請先載入 XRD 光譜數據</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/40">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">顯示模式</span>
                      <div className="flex rounded-lg border border-slate-700 bg-slate-800/30 p-0.5">
                        <button
                          onClick={() => setViewMode('single')}
                          className={`rounded px-2.5 py-1 text-[10px] font-semibold transition-all ${
                            viewMode === 'single' ? 'bg-[var(--accent)] text-white shadow' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          單筆處理
                        </button>
                        <button
                          onClick={() => setViewMode('overlay')}
                          className={`rounded px-2.5 py-1 text-[10px] font-semibold transition-all ${
                            viewMode === 'overlay' ? 'bg-[var(--accent)] text-white shadow' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          多檔疊圖
                        </button>
                      </div>
                    </div>

                    {viewMode === 'overlay' && (
                      <div className="pb-2 border-b border-slate-800/40">
                        <button
                          onClick={handleAutoStackOffsets}
                          className="w-full rounded-lg bg-[var(--accent)]/10 hover:bg-[var(--accent)]/15 border border-[var(--accent)]/20 px-3 py-1.5 text-center text-xs font-bold text-[var(--accent)] transition-all"
                        >
                          ⚡ 一鍵均勻分配垂直疊加高度
                        </button>
                      </div>
                    )}

                    <div className="max-h-48 overflow-y-auto space-y-3 pr-1">
                      {rawFiles.map(f => (
                        <div key={f.id} className="space-y-1.5 border border-slate-800 bg-slate-900/10 p-2.5 rounded-lg">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
                            <span className="text-xs font-semibold text-slate-200 truncate">{f.name}</span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[9px] text-slate-500 uppercase">線寬 (px)</label>
                              <input
                                type="number"
                                min="1"
                                max="8"
                                value={f.linewidth}
                                onChange={e => {
                                  const val = parseInt(e.target.value) || 2
                                  setRawFiles(prev => prev.map(item => item.id === f.id ? { ...item, linewidth: val } : item))
                                }}
                                className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-white"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] text-slate-500 uppercase">Y 疊加偏移</label>
                              <input
                                type="number"
                                step="0.1"
                                value={f.offset}
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0
                                  setRawFiles(prev => prev.map(item => item.id === f.id ? { ...item, offset: val } : item))
                                }}
                                className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-white"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Section>

              {/* Step 5: 固定參考峰 / 圖例 */}
              <Section step={5} title="固定參考峰/圖例 (Markers)" hint="繪製標準相位垂直點虛線">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">在圖表中顯示參考峰</span>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={showReferenceMarkers}
                        onChange={e => setShowReferenceMarkers(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="peer h-5 w-9 rounded-full bg-slate-800 after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-slate-400 after:transition-all after:content-[''] peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-full peer-checked:after:bg-white" />
                    </label>
                  </div>

                  {showReferenceMarkers && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">標準化合物選擇</p>
                      <div className="grid grid-cols-2 gap-2 bg-slate-900/20 border border-slate-800/40 p-2.5 rounded-lg">
                        {Object.keys(REFERENCE_DB).map(compName => (
                          <label key={compName} className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 hover:text-white transition-colors">
                            <input
                              type="checkbox"
                              checked={enabledRefCompounds[compName] || false}
                              onChange={e => {
                                setEnabledRefCompounds({
                                  ...enabledRefCompounds,
                                  [compName]: e.target.checked,
                                })
                              }}
                              className="rounded border-slate-700 bg-slate-800 text-[var(--accent)] focus:ring-[var(--accent)]"
                            />
                            <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/10" style={{ backgroundColor: PHASE_COLORS[compName] }} />
                            <span className="truncate">{compName}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Section>

              {/* Step 6: 峰位偏移報告 */}
              <Section step={6} title="峰位偏移比對 (Peak Shift)" hint="設定匹配門檻與容忍度">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] text-slate-400 uppercase tracking-wider">尋峰強度門檻 (%)</label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={peakIntensityThreshold}
                        onChange={e => setPeakIntensityThreshold(parseInt(e.target.value) || 10)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] text-slate-400 uppercase tracking-wider">偏移比對容忍度 (°)</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0.05"
                        max="1.5"
                        value={peakOffsetTolerance}
                        onChange={e => setPeakOffsetTolerance(parseFloat(e.target.value) || 0.3)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  </div>
                  
                  <div className="rounded-lg border border-slate-800 bg-slate-900/20 p-2.5 text-[10px] leading-relaxed text-slate-400">
                    <p className="text-slate-300 font-semibold mb-1">⚡ 前端尋峰邏輯說明：</p>
                    <ul className="list-disc pl-3.5 space-y-0.5">
                      <li>對處理後光譜執行五點局部極值特徵比對。</li>
                      <li>自動比對已啟用的參考化合物最接近晶面，回報 delta 偏移量。</li>
                    </ul>
                  </div>
                </div>
              </Section>

              {/* Step 7: 數據匯出 */}
              <Section step={7} title="數據匯出 (Export)" hint="產出處理後光譜與偏移報告">
                {rawFiles.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">請先載入 XRD 光譜數據</p>
                ) : (
                  <div className="space-y-2 pt-1">
                    <button
                      onClick={handleExportDataCsv}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)]/90 px-4 py-2 text-center text-xs font-bold text-white shadow-lg transition-all"
                    >
                      📥 匯出處理後光譜數據 (CSV)
                    </button>
                    
                    <button
                      onClick={handleExportOffsetReport}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 hover:bg-slate-800/40 px-4 py-2 text-center text-xs font-bold text-slate-300 transition-all"
                    >
                      📄 匯出峰位偏移分析報告 (TXT)
                    </button>
                  </div>
                )}
              </Section>
            </div>

            {/* 側邊欄拖曳手柄 */}
            <div
              onMouseDown={e => {
                e.preventDefault()
                setSidebarResizing(true)
              }}
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent)] bg-transparent z-50 transition-colors duration-150"
            />
          </>
        )}
      </aside>

      {/* ── 右側主內容欄 ── */}
      <main className="flex flex-1 flex-col overflow-hidden min-h-0">
        
        {/* ModuleTopBar */}
        <ModuleTopBar
          title="XRD"
          subtitle="X-ray Diffraction"
          description="X-ray Diffraction Plotter & Phase Identifier"
          chips={rawFiles.length > 0 ? [{ label: `已載入 ${rawFiles.length} 筆光譜` }] : [{ label: '請載入光譜以進行繪圖與疊圖' }]}
        />

        {/* 核心工作空間 */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
          {rawFiles.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <EmptyWorkspaceState
                module="xrd"
                title="尚未匯入 XRD 繞射圖譜"
                description="請由左側面板第 1 步匯入一或多個 .txt, .xy, .csv 檔案，系統將在前端立即執行基線扣除與疊圖繪製。"
                formats={['.TXT', '.XY', '.CSV']}
              />
            </div>
          ) : (
            <div className="space-y-4">
              
              {/* 圖表卡片 */}
              <div className="analysis-section-card p-4">
                <ChartToolbar
                  title={viewMode === 'overlay' ? '多檔疊圖比較結果' : `單筆處理結果 - ${activeTrace?.name}`}
                  colorValue={viewMode === 'overlay' ? chartLineColors.overlay : chartLineColors.single}
                  onColorChange={color => {
                    setChartLineColors(prev => ({
                      ...prev,
                      [viewMode === 'overlay' ? 'overlay' : 'single']: color,
                    }))
                  }}
                />
                
                <DeferredRender minHeight={400}>
                  <Plot
                    data={plotlyTraces}
                    layout={plotlyLayout}
                    config={{
                      responsive: true,
                      displaylogo: false,
                      modeBarButtonsToRemove: ['select2d', 'lasso2d'],
                    }}
                    className="w-full"
                  />
                </DeferredRender>
              </div>

              {/* 峰位偏移比對結果表格 (與 XPS 視覺對齊的玻璃卡片與資料表格) */}
              {rawFiles.length > 0 && Object.values(enabledRefCompounds).some(Boolean) && (
                <div className="analysis-section-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white">峰位偏移分析報告 (Peak Shift Analysis)</h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        自動尋峰門檻：{peakIntensityThreshold}%，比對容忍值：{peakOffsetTolerance}°。
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
                    {processedTraces.map(trace => {
                      const reps = peakOffsetReport[trace.id] || []
                      return (
                        <div key={trace.id} className="space-y-2 border-b border-slate-800/40 pb-3 last:border-b-0 last:pb-0">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trace.color }} />
                            <span className="text-xs font-semibold text-slate-200 truncate">{trace.name}</span>
                            <span className="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded-full">
                              基線估算：{trace.baseline.toFixed(2)}
                            </span>
                          </div>

                          {reps.length === 0 ? (
                            <div className="text-[11px] text-slate-500 italic bg-slate-900/10 px-3 py-2 rounded-lg border border-dashed border-slate-800/50">
                              在此尋峰與容忍度設定下，未找到可匹配已啟用參考峰的訊號。請提高尋峰靈敏度或勾選對應化合物。
                            </div>
                          ) : (
                            <div className="analysis-table-wrap">
                              <table className="analysis-data-table min-w-full text-left text-xs">
                                <thead>
                                  <tr className="border-b border-slate-800 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                    <th className="px-3 py-2">偵測峰位 (2θ)</th>
                                    <th className="px-3 py-2">偵測強度 (a.u.)</th>
                                    <th className="px-3 py-2">匹配化合物</th>
                                    <th className="px-3 py-2">標準晶面</th>
                                    <th className="px-3 py-2">標準峰位 (2θ)</th>
                                    <th className="px-3 py-2">偏移量 (Δ2θ)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {reps.map((r, rIdx) => (
                                    <tr key={rIdx} className="border-b border-slate-800/30 text-slate-300 hover:bg-slate-900/20 transition-all font-mono">
                                      <td className="px-3 py-2 font-bold text-slate-200">{r.observedPeak2Theta.toFixed(3)}°</td>
                                      <td className="px-3 py-2">{r.observedIntensity.toFixed(3)}</td>
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-1.5">
                                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PHASE_COLORS[r.phase] }} />
                                          <span>{r.phase}</span>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 font-bold text-[var(--accent)]">{r.hkl}</td>
                                      <td className="px-3 py-2">{r.refPeak2Theta.toFixed(3)}°</td>
                                      <td className={`px-3 py-2 font-bold ${r.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {r.delta >= 0 ? '+' : ''}
                                        {r.delta.toFixed(3)}°
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </main>
    </div>
  )
}
