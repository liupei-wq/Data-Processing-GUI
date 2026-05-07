import PlotlyReact, { type PlotParams } from 'react-plotly.js'
import PlotlyCore from 'plotly.js/dist/plotly'

export type PlotClickEvent = Readonly<Plotly.PlotMouseEvent>
export type PlotlyChartProps = PlotParams & {
  onClick?: (event: PlotClickEvent) => void
}

type PlotComponentType = typeof PlotlyReact

const Plot = (
  (PlotlyReact as unknown as { default?: PlotComponentType }).default ?? PlotlyReact
) as PlotComponentType

export const PlotlyApi = (
  (PlotlyCore as unknown as { default?: typeof PlotlyCore }).default ?? PlotlyCore
) as typeof PlotlyCore

export default function PlotlyChart({ onClick, ...props }: PlotlyChartProps) {
  return <Plot {...props} onClick={onClick as PlotParams['onClick']} />
}
