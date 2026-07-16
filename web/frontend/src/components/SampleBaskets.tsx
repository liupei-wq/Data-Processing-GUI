import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'

// ── Types ─────────────────────────────────────────────────────────────────────

export type BasketFileItem = {
  id: string
  file: File
  basketId: string | null
}

export type SampleBasket = {
  id: string
  name: string
  color: string
  /** Cached processed spectrum from the analysis pipeline (set automatically when this basket is active) */
  cachedX?: number[] | null
  cachedTey?: number[] | null
  cachedTfy?: number[] | null
  /** Whether to show this basket's cached spectrum in the overlay chart (default true) */
  overlayVisible?: boolean
}

const BASKET_COLOR_PALETTE = [
  '#38bdf8', '#a78bfa', '#34d399', '#f97316',
  '#fb7185', '#facc15', '#22d3ee', '#818cf8',
  '#f472b6', '#4ade80', '#fcd34d', '#fb923c',
]

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

// ── Trigger button (vertical column on right edge) ───────────────────────────

export function SampleBasketsButton({
  open,
  onToggle,
  basketCount,
  unassignedCount,
}: {
  open: boolean
  onToggle: () => void
  basketCount: number
  unassignedCount: number
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label="樣品分類"
      className={['baskets-trigger', open ? 'baskets-trigger--open' : ''].join(' ').trim()}
    >
      <span className="baskets-trigger__icon" aria-hidden="true">🧺</span>
      <span className="baskets-trigger__label">樣品分類</span>
      <span className="baskets-trigger__counts">
        {basketCount > 0 && <span className="baskets-trigger__counts-item baskets-trigger__counts-item--basket">{basketCount}</span>}
        {unassignedCount > 0 && <span className="baskets-trigger__counts-item baskets-trigger__counts-item--unassigned">{unassignedCount}</span>}
      </span>
    </button>
  )
}

// ── Internal: draggable file chip ────────────────────────────────────────────

function DraggableFileChip({ item, color }: { item: BasketFileItem; color?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id })
  const style: React.CSSProperties = {
    opacity: isDragging ? 0.35 : 1,
    borderLeftColor: color ?? 'var(--card-border)',
  }
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={style} className="basket-file-chip">
      <span className="basket-file-chip__name" title={item.file.name}>{item.file.name}</span>
      <span className="basket-file-chip__size">{(item.file.size / 1024).toFixed(1)} KB</span>
    </div>
  )
}

// ── Internal: droppable zone ─────────────────────────────────────────────────

function DroppableZone({
  id,
  className,
  children,
  isEmpty,
  emptyHint,
}: {
  id: string
  className?: string
  children: React.ReactNode
  isEmpty: boolean
  emptyHint: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={[
        className ?? '',
        isOver ? 'basket-dropzone--over' : '',
        isEmpty ? 'basket-dropzone--empty' : '',
      ].join(' ').trim()}
    >
      {isEmpty ? <p className="basket-dropzone__empty">{emptyHint}</p> : children}
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function SampleBasketsPanel({
  open,
  onClose,
  items,
  baskets,
  onChangeItems,
  onChangeBaskets,
  onApplyBasket,
  onFilesAdded,
  applyDisabled,
  moduleLabel,
  acceptFileExts,
  activeBasketId,
  onOpenOverlay,
}: {
  open: boolean
  onClose: () => void
  items: BasketFileItem[]
  baskets: SampleBasket[]
  onChangeItems: (next: BasketFileItem[]) => void
  onChangeBaskets: (next: SampleBasket[]) => void
  onApplyBasket: (basket: SampleBasket, basketFiles: File[]) => void | Promise<void>
  /** Optional module hook for loading newly uploaded files immediately. */
  onFilesAdded?: (files: File[]) => void | Promise<void>
  applyDisabled?: boolean
  moduleLabel: string
  acceptFileExts: string[]
  /** Currently active basket (the one feeding the analysis pipeline). Used to highlight. */
  activeBasketId?: string | null
  /** When provided, shows a "open overlay" button that opens the overlay comparison modal */
  onOpenOverlay?: () => void
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null)

  // Resizable panel width (left edge drag handle, persisted to localStorage)
  const PANEL_MIN_W = 240
  const PANEL_MAX_W = 640
  const PANEL_DEFAULT_W = 280
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return PANEL_DEFAULT_W
    const saved = Number(window.localStorage.getItem('nigiro-baskets-width'))
    if (Number.isFinite(saved) && saved >= PANEL_MIN_W && saved <= PANEL_MAX_W) return saved
    return PANEL_DEFAULT_W
  })
  const [resizing, setResizing] = useState(false)
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startW: panelWidth }
    setResizing(true)
  }
  useEffect(() => {
    if (!resizing) return
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      // Panel sits on right edge — dragging the handle LEFT (decreasing clientX) increases width
      const delta = resizeRef.current.startX - ev.clientX
      const next = Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, resizeRef.current.startW + delta))
      setPanelWidth(next)
    }
    const onUp = () => {
      setResizing(false)
      resizeRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [resizing])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('nigiro-baskets-width', String(panelWidth))
  }, [panelWidth])

  // Use separate Mouse + Touch sensors for better trackpad/touch reliability.
  // - MouseSensor (trackpad / mouse): low distance threshold so trackpad's small drag movements work
  // - TouchSensor: short delay + tolerance to avoid accidental drags while scrolling
  // - KeyboardSensor: accessibility
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 2 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  )
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleFileAdd = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    const newItems: BasketFileItem[] = files.map(f => ({
      id: makeId('f'),
      file: f,
      basketId: null,
    }))
    onChangeItems([...items, ...newItems])
    if (onFilesAdded) void onFilesAdded(files)
  }

  const handleAddBasket = () => {
    const used = baskets.length
    const color = BASKET_COLOR_PALETTE[used % BASKET_COLOR_PALETTE.length]
    const next: SampleBasket = { id: makeId('b'), name: `樣品 ${used + 1}`, color }
    onChangeBaskets([...baskets, next])
  }

  const handleRenameBasket = (basketId: string, name: string) => {
    onChangeBaskets(baskets.map(b => b.id === basketId ? { ...b, name } : b))
  }

  const handleDeleteBasket = (basketId: string) => {
    // Move files in this basket back to unassigned
    onChangeItems(items.map(i => i.basketId === basketId ? { ...i, basketId: null } : i))
    onChangeBaskets(baskets.filter(b => b.id !== basketId))
  }

  const handleRemoveFile = (fileId: string) => {
    onChangeItems(items.filter(i => i.id !== fileId))
  }

  const handleMoveFile = (fileId: string, targetBasketId: string | null) => {
    onChangeItems(items.map(i => i.id === fileId ? { ...i, basketId: targetBasketId } : i))
  }

  // Move-to menu state (only one open at a time)
  const [moveMenuFileId, setMoveMenuFileId] = useState<string | null>(null)
  useEffect(() => {
    if (!moveMenuFileId) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.basket-move-menu') && !target.closest('.basket-file-move')) {
        setMoveMenuFileId(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [moveMenuFileId])

  const handleClearBasket = (basketId: string) => {
    onChangeItems(items.map(i => i.basketId === basketId ? { ...i, basketId: null } : i))
  }

  const handleClearAll = () => {
    onChangeItems([])
    onChangeBaskets([])
  }

  const handleDragStart = (e: DragStartEvent) => setDraggingId(String(e.active.id))

  const handleDragEnd = (e: DragEndEvent) => {
    setDraggingId(null)
    const overId = e.over?.id
    if (!overId) return
    const activeId = String(e.active.id)
    let targetBasketId: string | null
    if (overId === 'unassigned') {
      targetBasketId = null
    } else if (typeof overId === 'string' && overId.startsWith('basket:')) {
      targetBasketId = overId.slice('basket:'.length)
    } else {
      return
    }
    onChangeItems(items.map(i => i.id === activeId ? { ...i, basketId: targetBasketId } : i))
  }

  const unassigned = items.filter(i => i.basketId === null)
  const draggingItem = draggingId ? items.find(i => i.id === draggingId) : null
  const draggingItemBasket = draggingItem?.basketId ? baskets.find(b => b.id === draggingItem.basketId) : null

  if (!open) return null

  const accept = acceptFileExts.join(',')

  return (
    <aside
      className={['baskets-panel', resizing ? 'baskets-panel--resizing' : ''].join(' ').trim()}
      style={{ width: panelWidth }}
    >
      <div
        className="baskets-panel__resize-handle"
        onMouseDown={startResize}
        title="拖曳調整寬度"
        aria-label="調整面板寬度"
      />
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          {/* Header */}
          <div className="baskets-panel__header">
            <div>
              <p className="baskets-panel__title">樣品分類處理</p>
              <p className="baskets-panel__subtitle">{moduleLabel}　|　把同樣品的多筆資料拖入同一個籃子 → 套用後自動進入分析流程</p>
            </div>
            <button type="button" onClick={onClose} className="baskets-panel__close">關閉</button>
          </div>

          {/* Overlay action bar */}
          {onOpenOverlay && (() => {
            const cachedCount = baskets.filter(b => b.cachedX && b.cachedX.length > 0).length
            return (
              <div className="baskets-overlay-bar">
                <button
                  type="button"
                  onClick={onOpenOverlay}
                  disabled={cachedCount === 0}
                  title={cachedCount === 0 ? '尚無任何已處理光譜，請先套用一個籃子' : `${cachedCount} 個籃子有已處理光譜`}
                  className="baskets-overlay-button"
                >
                  🗇 開啟疊圖比對 {cachedCount > 0 && <span className="baskets-overlay-count">{cachedCount}</span>}
                </button>
                <p className="baskets-overlay-hint">活躍籃子會即時同步主分析結果</p>
              </div>
            )
          })()}

          <div className="baskets-panel__body">
            {/* Upload zone */}
            <div className="baskets-upload">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={accept}
                className="hidden"
                onChange={e => { handleFileAdd(e.target.files); if (fileInputRef.current) fileInputRef.current.value = '' }}
              />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="baskets-upload__button">
                <span className="text-xl" aria-hidden>＋</span>
                <span>上傳檔案（可一次選多個）</span>
              </button>
              <button type="button" onClick={handleClearAll} className="baskets-upload__clear" disabled={items.length === 0 && baskets.length === 0}>
                清空全部
              </button>
            </div>

            {/* Unassigned files dropzone */}
            <div className="baskets-section">
              <div className="baskets-section__header">
                <span className="baskets-section__title">未分類檔案</span>
                <span className="baskets-section__count">{unassigned.length} 個</span>
              </div>
              <DroppableZone
                id="unassigned"
                className="basket-dropzone basket-dropzone--unassigned"
                isEmpty={unassigned.length === 0}
                emptyHint="檔案會先列在這裡。拖到下方籃子分組。"
              >
                <div className="basket-dropzone__list">
                  {unassigned.map(item => (
                    <div key={item.id} className="basket-file-row">
                      <DraggableFileChip item={item} />
                      <button
                        type="button"
                        onClick={() => setMoveMenuFileId(moveMenuFileId === item.id ? null : item.id)}
                        className="basket-file-move"
                        title="移動到指定籃子"
                        disabled={baskets.length === 0}
                      >→</button>
                      <button type="button" onClick={() => handleRemoveFile(item.id)} className="basket-file-remove" title="移除">×</button>
                      {moveMenuFileId === item.id && (
                        <div className="basket-move-menu" onMouseDown={e => e.stopPropagation()}>
                          <p className="basket-move-menu__title">移動到</p>
                          {baskets.length === 0 ? (
                            <p className="basket-move-menu__empty">尚無籃子可移入</p>
                          ) : (
                            baskets.map(b => (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => { handleMoveFile(item.id, b.id); setMoveMenuFileId(null) }}
                                className="basket-move-menu__item"
                              >
                                <span className="basket-move-menu__swatch" style={{ background: b.color }} />
                                <span className="basket-move-menu__label">{b.name}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </DroppableZone>
            </div>

            {/* Baskets */}
            <div className="baskets-section">
              <div className="baskets-section__header">
                <span className="baskets-section__title">分類籃子</span>
                <button type="button" onClick={handleAddBasket} className="baskets-add-button">＋ 新增籃子</button>
              </div>
              {baskets.length === 0 ? (
                <p className="baskets-empty-hint">尚未建立籃子。每個籃子代表一個樣品（如「樣品 A 化合物甲」）。</p>
              ) : (
                <div className="baskets-grid">
                  {baskets.map(basket => {
                    const basketItems = items.filter(i => i.basketId === basket.id)
                    const hasCache = !!(basket.cachedX && basket.cachedX.length > 0)
                    const isActive = activeBasketId === basket.id
                    return (
                      <div
                        key={basket.id}
                        className={['basket-card', isActive ? 'basket-card--active' : ''].join(' ').trim()}
                        style={{ borderTopColor: basket.color }}
                      >
                        <div className="basket-card__head">
                          <span className="basket-card__color-dot" style={{ background: basket.color }} aria-hidden />
                          <input
                            value={basket.name}
                            onChange={e => handleRenameBasket(basket.id, e.target.value)}
                            className="basket-card__name-input"
                            placeholder="樣品名稱"
                          />
                          {hasCache && (
                            <span className="basket-card__cache" title="已快取處理後光譜，可用於疊圖比對">✓</span>
                          )}
                          {isActive && (
                            <span className="basket-card__active-dot" title="目前活躍籃子（與主分析結果同步）" />
                          )}
                          <span className="basket-card__count">{basketItems.length}</span>
                          <button type="button" onClick={() => handleDeleteBasket(basket.id)} className="basket-card__remove" title="刪除籃子">×</button>
                        </div>
                        <DroppableZone
                          id={`basket:${basket.id}`}
                          className="basket-dropzone basket-dropzone--basket"
                          isEmpty={basketItems.length === 0}
                          emptyHint="拖入檔案"
                        >
                          <div className="basket-dropzone__list">
                            {basketItems.map(item => (
                              <div key={item.id} className="basket-file-row">
                                <DraggableFileChip item={item} color={basket.color} />
                                <button
                                  type="button"
                                  onClick={() => setMoveMenuFileId(moveMenuFileId === item.id ? null : item.id)}
                                  className="basket-file-move"
                                  title="移動到指定籃子"
                                >→</button>
                                <button type="button" onClick={() => handleRemoveFile(item.id)} className="basket-file-remove" title="移除">×</button>
                                {moveMenuFileId === item.id && (
                                  <div className="basket-move-menu" onMouseDown={e => e.stopPropagation()}>
                                    <p className="basket-move-menu__title">移動到</p>
                                    {baskets.filter(b => b.id !== item.basketId).length === 0 ? (
                                      <p className="basket-move-menu__empty">無其他籃子可移入</p>
                                    ) : (
                                      baskets.filter(b => b.id !== item.basketId).map(b => (
                                        <button
                                          key={b.id}
                                          type="button"
                                          onClick={() => { handleMoveFile(item.id, b.id); setMoveMenuFileId(null) }}
                                          className="basket-move-menu__item"
                                        >
                                          <span className="basket-move-menu__swatch" style={{ background: b.color }} />
                                          <span className="basket-move-menu__label">{b.name}</span>
                                        </button>
                                      ))
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => { handleMoveFile(item.id, null); setMoveMenuFileId(null) }}
                                      className="basket-move-menu__item basket-move-menu__item--unassigned"
                                    >
                                      <span className="basket-move-menu__swatch basket-move-menu__swatch--ghost" />
                                      <span className="basket-move-menu__label">← 移回未分類</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </DroppableZone>
                        <div className="basket-card__actions">
                          <button type="button" onClick={() => handleClearBasket(basket.id)} className="basket-card__action basket-card__action--secondary" disabled={basketItems.length === 0}>
                            清空
                          </button>
                          <button
                            type="button"
                            onClick={() => { void onApplyBasket(basket, basketItems.map(i => i.file)) }}
                            disabled={applyDisabled || basketItems.length === 0}
                            className="basket-card__action basket-card__action--primary"
                          >
                            套用 / 開始分析 {basketItems.length > 1 ? `（平均 ${basketItems.length} 筆）` : ''}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Drag overlay */}
          <DragOverlay>
            {draggingItem && (
              <div className="basket-file-chip basket-file-chip--overlay" style={{ borderLeftColor: draggingItemBasket?.color ?? 'var(--accent-strong)' }}>
                <span className="basket-file-chip__name">{draggingItem.file.name}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
    </aside>
  )
}

// ── Overlay comparison modal (draggable floating window) ─────────────────────

export type OverlayChannel = 'TEY' | 'TFY'

export function SampleBasketsOverlayModal({
  open,
  onClose,
  baskets,
  onChangeBaskets,
  defaultChannel = 'TEY',
  renderChart,
}: {
  open: boolean
  onClose: () => void
  baskets: SampleBasket[]
  onChangeBaskets: (next: SampleBasket[]) => void
  defaultChannel?: OverlayChannel
  /** Render prop: receives visible baskets + channel and returns the chart element */
  renderChart: (visibleBaskets: SampleBasket[], channel: OverlayChannel) => React.ReactNode
}) {
  const [channel, setChannel] = useState<OverlayChannel>(defaultChannel)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 720, h: 540 })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)

  useEffect(() => {
    if (!open) return
    if (pos !== null) return
    const cx = Math.max(20, (window.innerWidth - size.w) / 2)
    const cy = Math.max(20, (window.innerHeight - size.h) / 2)
    setPos({ x: cx, y: cy })
  }, [open, pos, size.w, size.h])

  useEffect(() => {
    if (!open) return
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const { startX, startY, origX, origY } = dragRef.current
        setPos({
          x: Math.max(0, Math.min(window.innerWidth - 100, origX + e.clientX - startX)),
          y: Math.max(0, Math.min(window.innerHeight - 60, origY + e.clientY - startY)),
        })
      }
      if (resizeRef.current) {
        const { startX, startY, origW, origH } = resizeRef.current
        setSize({
          w: Math.max(420, Math.min(window.innerWidth - 40, origW + e.clientX - startX)),
          h: Math.max(320, Math.min(window.innerHeight - 40, origH + e.clientY - startY)),
        })
      }
    }
    const onUp = () => { dragRef.current = null; resizeRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  if (typeof document === 'undefined') return null
  if (!pos) return null

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
  }
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h }
  }

  const toggleVisible = (id: string) => {
    onChangeBaskets(baskets.map(b => b.id === id ? { ...b, overlayVisible: !(b.overlayVisible ?? true) } : b))
  }
  const setAllVisible = (visible: boolean) => {
    onChangeBaskets(baskets.map(b => ({ ...b, overlayVisible: visible })))
  }

  const basketsWithCache = baskets.filter(b => b.cachedX && b.cachedX.length > 0)
  const visibleBaskets = basketsWithCache.filter(b => (b.overlayVisible ?? true))

  return (
    <div
      className="baskets-overlay-modal"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      <div
        className="baskets-overlay-modal__header"
        onMouseDown={handleHeaderMouseDown}
      >
        <div className="baskets-overlay-modal__title-area">
          <span className="baskets-overlay-modal__title">🗇 疊圖比對</span>
          <span className="baskets-overlay-modal__hint">{basketsWithCache.length} 個籃子有資料 · 拖曳標題列移動視窗</span>
        </div>
        <div className="baskets-overlay-modal__channel">
          {(['TEY', 'TFY'] as const).map(ch => (
            <button
              key={ch}
              type="button"
              onClick={() => setChannel(ch)}
              className={['baskets-overlay-modal__channel-btn', channel === ch ? 'baskets-overlay-modal__channel-btn--active' : ''].join(' ').trim()}
            >
              {ch}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="baskets-overlay-modal__close">×</button>
      </div>

      <div className="baskets-overlay-modal__body">
        <div className="baskets-overlay-modal__chart">
          {renderChart(visibleBaskets, channel)}
        </div>
        <div className="baskets-overlay-modal__legend">
          <div className="baskets-overlay-modal__legend-head">
            <span>顯示</span>
            <div>
              <button type="button" onClick={() => setAllVisible(true)} className="baskets-overlay-modal__legend-bulk">全選</button>
              <button type="button" onClick={() => setAllVisible(false)} className="baskets-overlay-modal__legend-bulk">全不選</button>
            </div>
          </div>
          {basketsWithCache.length === 0 ? (
            <p className="baskets-overlay-modal__legend-empty">尚無有快取的籃子。請先在主流程處理一個籃子。</p>
          ) : (
            basketsWithCache.map(b => {
              const visible = b.overlayVisible ?? true
              return (
                <label key={b.id} className="baskets-overlay-modal__legend-row">
                  <input type="checkbox" checked={visible} onChange={() => toggleVisible(b.id)} />
                  <span className="baskets-overlay-modal__legend-swatch" style={{ background: b.color }} />
                  <span className="baskets-overlay-modal__legend-name" title={b.name}>{b.name}</span>
                  <span className="baskets-overlay-modal__legend-pts">{b.cachedX?.length ?? 0} pts</span>
                </label>
              )
            })
          )}
        </div>
      </div>

      <div className="baskets-overlay-modal__resize-handle" onMouseDown={handleResizeMouseDown} aria-hidden />
    </div>
  )
}
