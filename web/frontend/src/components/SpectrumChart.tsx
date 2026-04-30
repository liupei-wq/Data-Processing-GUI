import { useMemo } from 'react'
import Plot from 'react-plotly.js'
import type { DetectedPeak, ProcessResult, RefPeak, XMode } from '../types/xrd'

type DisplayMode = 'linear' | 'log10' | 'ln'

interface Props {
  result: ProcessResult
  refPeaks: RefPeak[]
  detectedPeaks: DetectedPeak[]
  xMode: XMode
  wavelength: number
  displayMode?: DisplayMode
  logFloorValue?: number
  showReferencePeaks?: boolean
  showDetectedPeaks?: boolean
  minHeight?: number
}

const COLORS = [
  '#38bdf8', '#fb7185', '#34d399', '#f59e0b',
  '#a78bfa', '#22d3ee', '#f472b6', '#a3e635',
]

function toD(twoTheta: number, wl: number): number {
  const theta = (twoTheta * Math.PI) / 360
  return wl / (2 * Math.sin(theta))
}

function safeLogTransform(values: number[], mode: Exclude<DisplayMode, 'linear'>, floorValue = 1e-6) {
  const minVal = values.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY)
  const shift = minVal <= 0 ? Math.abs(minVal) + floorValue : floorValue
  const shifted = values.map(value => Math.max(value + shift, floorValue))
  return shifted.map(value => (mode === 'ln' ? Math.log(value) : Math.log10(value)))
}

export default function SpectrumChart({
  result,
  refPeaks,
  detectedPeaks,
  xMode,
  wavelength,
  displayMode = 'linear',
  logFloorValue = 1e-6,
  showReferencePeaks = true,
  showDetectedPeaks = true,
  minHeight = 460,
}: Props) {
  const { chartGrid, chartText, chartBg, chartLegendBg, chartHoverBg, chartHoverBorder } = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        chartGrid: 'rgba(148, 163, 184, 0.14)',
        chartText: '#d9e4f0',
        chartBg: 'rgba(15, 23, 42, 0.52)',
        chartLegendBg: 'rgba(15, 23, 42, 0.72)',
        chartHoverBg: 'rgba(15, 23, 42, 0.95)',
        chartHoverBorder: 'rgba(148, 163, 184, 0.22)',
      }
    }
    const cv = getComputedStyle(document.documentElement)
    const g = (name: string, fallback: string) => cv.getPropertyValue(name).trim() || fallback
    return {
      chartGrid: g('--chart-grid', 'rgba(148, 163, 184, 0.14)'),
      chartText: g('--chart-text', '#d9e4f0'),
      chartBg: g('--chart-bg', 'rgba(15, 23, 42, 0.52)'),
      chartLegendBg: g('--chart-legend-bg', 'rgba(15, 23, 42, 0.72)'),
      chartHoverBg: g('--chart-hover-bg', 'rgba(15, 23, 42, 0.95)'),
      chartHoverBorder: g('--chart-hover-border', 'rgba(148, 163, 184, 0.22)'),
    }
  }, [])
  const datasets = result.average ? [result.average, ...result.datasets] : result.datasets
  const showRaw = displayMode === 'linear' && !result.average && result.datasets.length > 1
  const convertX = (x: number[]) => (xMode === 'dspacing' ? x.map(v => toD(v, wavelength)) : x)
  const transformY = (values: number[]) => {
    if (displayMode === 'linear') return values
    return safeLogTransform(values, displayMode, logFloorValue)
  }
  const traces: Plotly.Data[] = []

  datasets.forEach((ds, i) => {
    const color = COLORS[i % COLORS.length]
    const xDisplay = convertX(ds.x)

    if (showRaw) {
      traces.push({
        x: xDisplay,
        y: ds.y_raw,
        type: 'scatter',
        mode: 'lines',
        name: `${ds.name} (raw)`,
        line: { color, width: 1, dash: 'dot' },
        opacity: 0.4,
        showlegend: true,
      })
    }

    traces.push({
      x: xDisplay,
      y: transformY(ds.y_processed),
      type: 'scatter',
      mode: 'lines',
      name: ds.name,
      line: { color, width: 2 },
    })
  })

  const matColors: Record<string, string> = {}
  const refColorPalette = ['#f97316', '#8b5cf6', '#06b6d4', '#84cc16', '#f43f5e']
  const uniqueMats = [...new Set(refPeaks.map(p => p.material))]
  uniqueMats.forEach((m, i) => { matColors[m] = refColorPalette[i % refColorPalette.length] })

  const allY = datasets.flatMap(ds => transformY(ds.y_processed))
  const yMax = allY.length > 0 ? allY.reduce((m, v) => (v > m ? v : m), -Infinity) : 1

  if (showReferencePeaks && displayMode === 'linear') {
    uniqueMats.forEach(mat => {
      const matPeaks = refPeaks.filter(p => p.material === mat)
      const xPts: number[] = []
      const yPts: number[] = []
      matPeaks.forEach(p => {
        const xVal = xMode === 'dspacing' ? p.d_spacing : p.two_theta
        xPts.push(xVal, xVal, xVal)
        yPts.push(0, (p.rel_i / 100) * yMax * 0.8, null as unknown as number)
      })
      traces.push({
        x: xPts,
        y: yPts,
        type: 'scatter',
        mode: 'lines',
        name: mat.split(' | ')[0],
        line: { color: matColors[mat], width: 1.5, dash: 'dot' },
        opacity: 0.8,
      })
    })
  }

  if (showDetectedPeaks && displayMode === 'linear' && detectedPeaks.length > 0) {
    traces.push({
      x: detectedPeaks.map(p => (xMode === 'dspacing' ? p.d_spacing : p.two_theta)),
      y: detectedPeaks.map(p => p.intensity),
      type: 'scatter',
      mode: 'markers',
      name: 'Detected peaks',
      marker: {
        color: '#f8fafc',
        size: 8,
        symbol: 'diamond-open',
        line: { color: '#38bdf8', width: 1.5 },
      },
      hovertemplate:
        xMode === 'dspacing'
          ? 'd = %{x:.4f} Å<br>Intensity = %{y:.2f}<extra>Detected peak</extra>'
          : '2θ = %{x:.4f}<br>Intensity = %{y:.2f}<extra>Detected peak</extra>',
    })
  }

  const xLabel = xMode === 'dspacing' ? 'd-spacing (Å)' : '2θ (degrees)'
  const layout: Partial<Plotly.Layout> = {
    xaxis: {
      title: { text: xLabel, font: { size: 13 } },
      showgrid: true,
      gridcolor: chartGrid,
      zeroline: false,
      color: chartText,
      autorange: xMode === 'dspacing' ? 'reversed' : true,
    },
    yaxis: {
      title: { text: displayMode === 'linear' ? 'Intensity (a.u.)' : `${displayMode} Intensity`, font: { size: 13 } },
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
      font: { color: chartText },
    },
    margin: { l: 60, r: 20, t: 30, b: 60 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: chartBg,
    font: { color: chartText },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: chartHoverBg,
      bordercolor: chartHoverBorder,
      font: { color: chartText },
    },
    autosize: true,
  }

  return (
    <div className="theme-block-soft rounded-[28px] p-3 sm:p-4">
      <Plot
        data={traces}
        layout={layout}
        config={{ scrollZoom: true, displaylogo: false, responsive: true }}
        style={{ width: '100%', minHeight: `${minHeight}px` }}
        useResizeHandler
      />
    </div>
  )
}
