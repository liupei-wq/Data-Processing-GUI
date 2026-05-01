import PlotlyReact from 'react-plotly.js'

type PlotComponentType = typeof PlotlyReact

const Plot = (
  (PlotlyReact as unknown as { default?: PlotComponentType }).default ?? PlotlyReact
) as PlotComponentType

export default Plot
