import Plot from 'react-plotly.js'
import type { ProcessResult, RefPeak, XMode } from '../types/xrd'

interface Props {
  result: ProcessResult
  refPeaks: RefPeak[]
  xMode: XMode
  wavelength: number
}

// Color palette for multiple datasets
const COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706',
  '#7c3aed', '#0891b2', '#db2777', '#65a30d',
]

/** Convert 2θ → d-spacing (Å) using Bragg's law */
function toD(twoTheta: number, wl: number): number {
  const theta = (twoTheta * Math.PI) / 360
  return wl / (2 * Math.sin(theta))
}

/** Build Plotly data + layout for the XRD chart */
export default function SpectrumChart({ result, refPeaks, xMode, wavelength }: Props) {
  const datasets = result.average ? [result.average, ...result.datasets] : result.datasets
  const showRaw = !result.average && result.datasets.length > 1

  // Helper: convert x array based on display mode
  const convertX = (x: number[]) =>
    xMode === 'dspacing' ? x.map(v => toD(v, wavelength)) : x

  // ── traces ────────────────────────────────────────────────────────────────
  const traces: Plotly.Data[] = []

  datasets.forEach((ds, i) => {
    const color = COLORS[i % COLORS.length]
    const xDisplay = convertX(ds.x)

    // Raw trace (thin, semi-transparent) – only shown for multi-file non-average mode
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

    // Processed trace (main line)
    traces.push({
      x: xDisplay,
      y: ds.y_processed,
      type: 'scatter',
      mode: 'lines',
      name: ds.name,
      line: { color, width: 2 },
    })
  })

  // ── reference peak sticks ─────────────────────────────────────────────────
  const matColors: Record<string, string> = {}
  const refColorPalette = ['#f97316', '#8b5cf6', '#06b6d4', '#84cc16', '#f43f5e']
  const uniqueMats = [...new Set(refPeaks.map(p => p.material))]
  uniqueMats.forEach((m, i) => { matColors[m] = refColorPalette[i % refColorPalette.length] })

  // Find max y for scaling reference sticks
  const allY = datasets.flatMap(ds => ds.y_processed)
  const yMax = allY.length > 0 ? Math.max(...allY) : 1

  // One trace per material (for grouped legend)
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
      name: mat.split(' | ')[0],   // short name for legend
      line: { color: matColors[mat], width: 1.5, dash: 'dot' },
      opacity: 0.8,
    })
  })

  // ── layout ────────────────────────────────────────────────────────────────
  const xLabel = xMode === 'dspacing' ? 'd-spacing (Å)' : '2θ (degrees)'
  const layout: Partial<Plotly.Layout> = {
    xaxis: {
      title: { text: xLabel, font: { size: 13 } },
      showgrid: true,
      gridcolor: '#e2e8f0',
      zeroline: false,
      autorange: xMode === 'dspacing' ? 'reversed' : true,
    },
    yaxis: {
      title: { text: 'Intensity (a.u.)', font: { size: 13 } },
      showgrid: true,
      gridcolor: '#e2e8f0',
      zeroline: false,
    },
    legend: { x: 1, xanchor: 'right', y: 1, bgcolor: 'rgba(255,255,255,0.8)', bordercolor: '#e2e8f0', borderwidth: 1 },
    margin: { l: 60, r: 20, t: 30, b: 60 },
    paper_bgcolor: 'white',
    plot_bgcolor: '#fafafa',
    hovermode: 'x unified',
    autosize: true,
  }

  return (
    <Plot
      data={traces}
      layout={layout}
      config={{ scrollZoom: true, displaylogo: false, responsive: true }}
      style={{ width: '100%', minHeight: '460px' }}
      useResizeHandler
    />
  )
}
