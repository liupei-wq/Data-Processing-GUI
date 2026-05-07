import { useCallback, useState, type ReactNode } from 'react'

export type PlotPopupItem = {
  id: string
  title: string
  content: ReactNode
}

export type PlotPopupRequest = Omit<PlotPopupItem, 'id'>
export type PlotPopupUpdate = Partial<PlotPopupRequest>

function createPlotPopupId() {
  return `plot-popup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function usePlotPopups() {
  const [popupPlots, setPopupPlots] = useState<PlotPopupItem[]>([])

  const openPlotPopup = useCallback(({ title, content }: PlotPopupRequest) => {
    const id = createPlotPopupId()
    setPopupPlots(current => [...current, { id, title, content }])
    return id
  }, [])

  const closePlotPopup = useCallback((id: string) => {
    setPopupPlots(current => current.filter(item => item.id !== id))
  }, [])

  const updatePlotPopup = useCallback((id: string, update: PlotPopupUpdate) => {
    setPopupPlots(current => current.map(item => (
      item.id === id
        ? {
            ...item,
            ...(update.title !== undefined ? { title: update.title } : {}),
            ...(update.content !== undefined ? { content: update.content } : {}),
          }
        : item
    )))
  }, [])

  const closeAllPlotPopups = useCallback(() => {
    setPopupPlots([])
  }, [])

  return {
    popupPlots,
    openPlotPopup,
    updatePlotPopup,
    closePlotPopup,
    closeAllPlotPopups,
  }
}
