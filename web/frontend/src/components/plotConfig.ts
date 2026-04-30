const fullscreenIcon = {
  width: 512,
  height: 512,
  path: 'M80 208V80h128v32H112v96H80zm224-128V48h128v128h-32V80h-96zm96 224v-96h32v128H304v-32h96zM80 432V304h32v96h96v32H80z',
}

function resizeAfterFullscreenChange() {
  window.setTimeout(() => {
    window.dispatchEvent(new Event('resize'))
  }, 120)
}

function togglePlotFullscreen(gd: HTMLElement) {
  const target = gd

  if (document.fullscreenElement) {
    void document.exitFullscreen().finally(resizeAfterFullscreenChange)
    return
  }

  if (target.requestFullscreen) {
    void target.requestFullscreen().then(resizeAfterFullscreenChange).catch(() => {})
  }
}

export function withPlotFullscreen(config: Partial<Plotly.Config> = {}): Partial<Plotly.Config> {
  const baseButtons = config.modeBarButtonsToAdd ?? []

  return {
    displaylogo: false,
    responsive: true,
    displayModeBar: 'hover',
    ...config,
    modeBarButtonsToAdd: [
      ...baseButtons,
      {
        name: '全螢幕',
        title: '全螢幕檢視',
        icon: fullscreenIcon,
        click: (gd: HTMLElement) => togglePlotFullscreen(gd),
      },
    ],
  }
}
