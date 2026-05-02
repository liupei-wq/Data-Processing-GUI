import PlotlyReact, { type PlotParams } from 'react-plotly.js'

export type PlotClickEvent = Readonly<Plotly.PlotMouseEvent>
export type PlotlyChartProps = PlotParams & {
  onClick?: (event: PlotClickEvent) => void
}

type PlotComponentType = typeof PlotlyReact

const Plot = (
  (PlotlyReact as unknown as { default?: PlotComponentType }).default ?? PlotlyReact
) as PlotComponentType

export default function PlotlyChart({ onClick, ...props }: PlotlyChartProps) {
  return <Plot {...props} onClick={onClick as PlotParams['onClick']} />
}
