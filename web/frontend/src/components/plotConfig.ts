export function withPlotFullscreen(config: Partial<Plotly.Config> = {}): Partial<Plotly.Config> {
  return {
    displaylogo: false,
    responsive: true,
    displayModeBar: 'hover',
    ...config,
  }
}
