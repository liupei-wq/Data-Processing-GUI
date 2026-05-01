import { createPortal } from 'react-dom'
import type { PlotPopupItem } from '../../hooks/usePlotPopups'
import PlotPopup from './PlotPopup'

type PlotPopupHostProps = {
  popupPlots: PlotPopupItem[]
  onClose: (id: string) => void
}

export default function PlotPopupHost({ popupPlots, onClose }: PlotPopupHostProps) {
  if (popupPlots.length === 0) return null

  const host = (
    <div className="plot-popup-host">
      {popupPlots.map((popup, index) => (
        <PlotPopup
          key={popup.id}
          id={popup.id}
          title={popup.title}
          defaultPosition={{ x: 48 + index * 28, y: 72 + index * 28 }}
          onClose={onClose}
        >
          {popup.content}
        </PlotPopup>
      ))}
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(host, document.body) : host
}
