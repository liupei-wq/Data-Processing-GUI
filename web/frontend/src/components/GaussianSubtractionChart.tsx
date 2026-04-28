import Plot from 'react-plotly.js'
import type { ProcessedDataset, XMode } from '../types/xrd'

interface Props {
  dataset: ProcessedDataset
  xMode: XMode
  wavelength: number
}

function toD(twoTheta: number, wl: number): number {
  const theta = (twoTheta * Math.PI) / 360
  return wl / (2 * Math.sin(theta))
}

export default function GaussianSubtractionChart({ dataset, xMode, wavelength }: Props) {
  if (!dataset.y_gaussian_model || !dataset.y_gaussian_subtracted) return null

  const xDisplay = xMode === 'dspacing'
    ? dataset.x.map(value => toD(value, wavelength))
    : dataset.x

  const traces: Plotly.Data[] = [
    {
      x: xDisplay,
      y: dataset.y_raw,
      type: 'scatter',
      mode: 'lines',
      name: `${dataset.name} (raw)`,
      line: { color: '#7dd3fc', width: 1.4 },
      opacity: 0.65,
    },
    {
      x: xDisplay,
      y: dataset.y_gaussian_model,
      type: 'scatter',
      mode: 'lines',
      name: 'Gaussian template',
      line: { color: '#fb7185', width: 1.7, dash: 'dot' },
    },
    {
      x: xDisplay,
      y: dataset.y_gaussian_subtracted,
      type: 'scatter',
      mode: 'lines',
      name: 'After subtraction',
      line: { color: '#34d399', width: 2.2 },
    },
  ]

  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-950/28 p-3 sm:p-4">
      <Plot
        data={traces}
        layout={{
          xaxis: {
            title: { text: xMode === 'dspacing' ? 'd-spacing (Å)' : '2θ (degrees)', font: { size: 13 } },
            showgrid: true,
            gridcolor: 'rgba(148, 163, 184, 0.14)',
            zeroline: false,
            color: '#d9e4f0',
            autorange: xMode === 'dspacing' ? 'reversed' : true,
          },
          yaxis: {
            title: { text: 'Intensity (a.u.)', font: { size: 13 } },
            showgrid: true,
            gridcolor: 'rgba(148, 163, 184, 0.14)',
            zeroline: false,
            color: '#d9e4f0',
          },
          legend: {
            x: 1,
            xanchor: 'right',
            y: 1,
            bgcolor: 'rgba(15, 23, 42, 0.72)',
            bordercolor: 'rgba(148, 163, 184, 0.18)',
            borderwidth: 1,
            font: { color: '#d9e4f0' },
          },
          margin: { l: 60, r: 20, t: 30, b: 60 },
          paper_bgcolor: 'rgba(0,0,0,0)',
          plot_bgcolor: 'rgba(15, 23, 42, 0.52)',
          font: { color: '#d9e4f0' },
          hovermode: 'x unified',
          hoverlabel: {
            bgcolor: 'rgba(15, 23, 42, 0.95)',
            bordercolor: 'rgba(148, 163, 184, 0.22)',
            font: { color: '#f8fafc' },
          },
          autosize: true,
        }}
        config={{ scrollZoom: true, displaylogo: false, responsive: true }}
        style={{ width: '100%', minHeight: '360px' }}
        useResizeHandler
      />
    </div>
  )
}
