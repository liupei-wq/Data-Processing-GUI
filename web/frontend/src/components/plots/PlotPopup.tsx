import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

type PlotPopupProps = {
  id: string
  title: string
  children: ReactNode
  defaultPosition?: { x: number; y: number }
  onClose: (id: string) => void
}

type DragState = {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

function clampPosition(position: { x: number; y: number }, popup: HTMLDivElement | null) {
  if (typeof window === 'undefined') return position

  const popupWidth = popup?.offsetWidth ?? 720
  const popupHeight = popup?.offsetHeight ?? 480
  const maxX = Math.max(12, window.innerWidth - popupWidth - 12)
  const maxY = Math.max(12, window.innerHeight - popupHeight - 12)

  return {
    x: Math.min(Math.max(12, position.x), maxX),
    y: Math.min(Math.max(12, position.y), maxY),
  }
}

export default function PlotPopup({
  id,
  title,
  children,
  defaultPosition = { x: 48, y: 72 },
  onClose,
}: PlotPopupProps) {
  const popupRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const [position, setPosition] = useState(() => defaultPosition)

  useEffect(() => {
    const handleResize = () => {
      setPosition(current => clampPosition(current, popupRef.current))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    const origin = clampPosition(position, popupRef.current)
    setPosition(origin)
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [position])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const nextPosition = {
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    }
    setPosition(clampPosition(nextPosition, popupRef.current))
  }, [])

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return
    dragStateRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  return (
    <section
      ref={popupRef}
      className="plot-popup"
      style={{ left: position.x, top: position.y }}
      aria-label={title}
    >
      <div
        className="plot-popup__header plot-popup__drag-handle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="plot-popup__title">{title}</div>
        <button
          type="button"
          className="plot-popup__close"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation()
            onClose(id)
          }}
          aria-label="關閉"
        >
          關閉
        </button>
      </div>
      <div className="plot-popup__body">{children}</div>
    </section>
  )
}
