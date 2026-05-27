/**
 * SortableCardGrid — 可重用的「多卡片網格 + 拖曳排序 + 半寬/全寬切換」元件。
 *
 * 設計目標：把原本散落在 XRD/XPS 的拖曳排序與寬度切換邏輯抽出來，
 * 任何分析模組要做「多卡片並排 + 可拖排序 + 可拉寬/縮回」都直接套這個元件。
 *
 * 使用方式（範例）：
 * ```tsx
 * <SortableCardGrid
 *   items={traces}
 *   selectedId={selectedId}
 *   onSelectId={setSelectedId}
 *   storageKey="my-module-cards"
 * >
 *   {({ item, attributes, listeners, activatorRef, wide, onToggleWide, onSelect, selected, sortingGhost, overlay, index, total }) => (
 *     <div onClick={onSelect} className={selected ? 'ring-1' : ''}>
 *       <h3>{item.name}</h3>
 *       <button onClick={onToggleWide}>{wide ? '⤡ 縮回' : '⤢ 拉寬'}</button>
 *       <button ref={activatorRef} {...attributes} {...listeners}>↕ 拖曳</button>
 *     </div>
 *   )}
 * </SortableCardGrid>
 * ```
 *
 * 內建邏輯：
 * 1. 卡片寬度（半寬 / 全寬）跟著卡片走、不會因為 reorder 自動變
 * 2. 初次出現預設「奇數最後一張全寬」、其餘半寬（可整體覆寫）
 * 3. 拖曳手柄綁在使用者自定義按鈕上（透過 attributes/listeners/activatorRef）
 * 4. 拖曳中顯示 DragOverlay（完整卡片浮動跟手），原位置呈半透明 ghost
 * 5. 取消拖曳會還原排序
 * 6. items 變動（新增/刪除）會自動同步 order 與 wideOverride
 * 7. 可選的 storageKey：自動把 order 與 wide 狀態存到 localStorage（每模組獨立 key）
 */

import { useState, useEffect, useCallback, useMemo, type ReactNode, type HTMLAttributes } from 'react'
import {
  closestCenter, DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove, defaultAnimateLayoutChanges, rectSortingStrategy,
  SortableContext, useSortable,
} from '@dnd-kit/sortable'

export interface SortableCardContext<T> {
  item: T
  index: number
  total: number
  wide: boolean
  selected: boolean
  sortingGhost: boolean
  overlay: boolean
  attributes?: HTMLAttributes<HTMLButtonElement>
  listeners?: Record<string, unknown>
  activatorRef?: (node: HTMLButtonElement | null) => void
  onSelect: () => void
  onToggleWide: () => void
}

export interface SortableCardGridProps<T extends { id: string }> {
  items: T[]
  selectedId?: string | null
  onSelectId?: (id: string | null) => void
  storageKey?: string
  gridClassName?: string
  children: (ctx: SortableCardContext<T>) => ReactNode
}

function isDefaultWide(index: number, total: number): boolean {
  return total % 2 === 1 && index === total - 1
}

function getSpanClass(wide: boolean): string {
  return wide ? 'md:col-span-2 xl:col-span-2' : ''
}

function SortableItem<T extends { id: string }>({
  item, index, total, wide, selected, onSelect, onToggleWide, children,
}: {
  item: T
  index: number
  total: number
  wide: boolean
  selected: boolean
  onSelect: () => void
  onToggleWide: () => void
  children: (ctx: SortableCardContext<T>) => ReactNode
}) {
  const sortable = useSortable({
    id: item.id,
    transition: { duration: 140, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    animateLayoutChanges: args => defaultAnimateLayoutChanges(args),
  })

  return (
    <div
      ref={sortable.setNodeRef}
      className={[getSpanClass(wide), 'will-change-transform'].filter(Boolean).join(' ')}
      style={{
        transform: sortable.transform
          ? `translate3d(${Math.round(sortable.transform.x)}px, ${Math.round(sortable.transform.y)}px, 0)`
          : undefined,
        transition: sortable.isDragging ? 'none' : sortable.transition,
      }}
    >
      {children({
        item, index, total, wide, selected,
        sortingGhost: sortable.isDragging,
        overlay: false,
        attributes: sortable.attributes as HTMLAttributes<HTMLButtonElement>,
        listeners: sortable.listeners as Record<string, unknown>,
        activatorRef: sortable.setActivatorNodeRef,
        onSelect,
        onToggleWide,
      })}
    </div>
  )
}

export function SortableCardGrid<T extends { id: string }>({
  items,
  selectedId,
  onSelectId,
  storageKey,
  gridClassName,
  children,
}: SortableCardGridProps<T>) {
  const [order, setOrder] = useState<string[]>(() => {
    if (storageKey && typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(`${storageKey}.order`)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) return parsed
        }
      } catch { /* ignore */ }
    }
    return items.map(i => i.id)
  })

  const [wideOverride, setWideOverride] = useState<Record<string, boolean>>(() => {
    if (storageKey && typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(`${storageKey}.wide`)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') return parsed
        }
      } catch { /* ignore */ }
    }
    return {}
  })

  const [activeId, setActiveId] = useState<string | null>(null)
  const [dragStartOrder, setDragStartOrder] = useState<string[] | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 1 } }))

  useEffect(() => {
    const ids = items.map(i => i.id)
    setOrder(prev => {
      const kept = prev.filter(id => ids.includes(id))
      const missing = ids.filter(id => !kept.includes(id))
      const next = [...kept, ...missing]
      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) return prev
      return next
    })
    setWideOverride(prev => {
      const next: Record<string, boolean> = {}
      for (const id of ids) {
        if (Object.prototype.hasOwnProperty.call(prev, id)) next[id] = prev[id]
      }
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        if (!Object.prototype.hasOwnProperty.call(next, id)) {
          next[id] = isDefaultWide(i, ids.length)
        }
      }
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      if (prevKeys.length === nextKeys.length && nextKeys.every(k => prev[k] === next[k])) return prev
      return next
    })
  }, [items])

  useEffect(() => {
    if (!storageKey || typeof localStorage === 'undefined') return
    try { localStorage.setItem(`${storageKey}.order`, JSON.stringify(order)) } catch { /* ignore */ }
  }, [order, storageKey])

  useEffect(() => {
    if (!storageKey || typeof localStorage === 'undefined') return
    try { localStorage.setItem(`${storageKey}.wide`, JSON.stringify(wideOverride)) } catch { /* ignore */ }
  }, [wideOverride, storageKey])

  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const orderedItems = useMemo<T[]>(() => {
    return order.map(id => byId.get(id)).filter((v): v is T => Boolean(v))
  }, [order, byId])

  const collisionDetection = useCallback((args: Parameters<typeof pointerWithin>[0]) => {
    const hits = pointerWithin(args)
    return hits.length > 0 ? hits : closestCenter(args)
  }, [])

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const id = String(e.active.id)
    setActiveId(id)
    setDragStartOrder(order)
    onSelectId?.(id)
  }, [order, onSelectId])

  const handleDragOver = useCallback((e: DragOverEvent) => {
    const aid = String(e.active.id)
    const oid = e.over?.id ? String(e.over.id) : null
    if (!oid || aid === oid) return
    setOrder(prev => {
      const oldIndex = prev.indexOf(aid)
      const newIndex = prev.indexOf(oid)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }, [])

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    if (!e.over && dragStartOrder) setOrder(dragStartOrder)
    setActiveId(null)
    setDragStartOrder(null)
  }, [dragStartOrder])

  const handleDragCancel = useCallback(() => {
    if (dragStartOrder) setOrder(dragStartOrder)
    setActiveId(null)
    setDragStartOrder(null)
  }, [dragStartOrder])

  const toggleWide = useCallback((id: string) => {
    setWideOverride(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const activeItem = activeId ? byId.get(activeId) ?? null : null
  const activeIndex = activeItem ? Math.max(0, orderedItems.findIndex(i => i.id === activeItem.id)) : 0
  const activeWide = activeItem ? !!wideOverride[activeItem.id] : false

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={orderedItems.map(i => i.id)} strategy={rectSortingStrategy}>
        <div className={gridClassName ?? 'grid grid-cols-1 gap-4 md:grid-cols-2'}>
          {orderedItems.map((item, index) => (
            <SortableItem
              key={item.id}
              item={item}
              index={index}
              total={orderedItems.length}
              wide={!!wideOverride[item.id]}
              selected={selectedId === item.id}
              onSelect={() => onSelectId?.(item.id)}
              onToggleWide={() => toggleWide(item.id)}
            >
              {children}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeItem
          ? children({
              item: activeItem,
              index: activeIndex,
              total: orderedItems.length,
              wide: activeWide,
              selected: true,
              sortingGhost: false,
              overlay: true,
              onSelect: () => { /* overlay 不觸發選取 */ },
              onToggleWide: () => toggleWide(activeItem.id),
            })
          : null}
      </DragOverlay>
    </DndContext>
  )
}
