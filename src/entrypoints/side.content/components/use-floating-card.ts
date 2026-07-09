import type { CardLayout } from "@/utils/job-match/storage"
import { useEffect, useRef, useState } from "react"

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export interface UseFloatingCardOptions {
  getLayout: () => Promise<CardLayout>
  setLayout: (layout: CardLayout) => Promise<void>
  minWidth: number
  minHeight: number
}

/**
 * 悬浮卡片的拖动（标题栏）/缩放（右下角）/位置记忆逻辑，从匹配度卡片里抽出来，
 * 好让聊天面板复用同一套行为——两个卡片各自传自己的 getLayout/setLayout（不同 storage key），
 * 互不影响，可以同时显示、同时拖动。
 */
export function useFloatingCard({ getLayout, setLayout, minWidth, minHeight }: UseFloatingCardOptions) {
  const cardRef = useRef<HTMLDivElement>(null)
  // null = 未拖动过（用调用方自己的默认样式）；否则用绝对像素坐标
  const [pos, setPos] = useState<{ x: number, y: number } | null>(null)
  const [size, setSize] = useState<{ w: number, h: number } | null>(null)
  const dragRef = useRef<{ startX: number, startY: number, originX: number, originY: number } | null>(null)
  const resizeRef = useRef<{ startX: number, startY: number, originW: number, originH: number } | null>(null)
  const layoutRef = useRef<CardLayout>({})

  // 加载记忆的位置/大小
  useEffect(() => {
    void getLayout().then((layout) => {
      layoutRef.current = layout
      if (layout.x != null && layout.y != null)
        setPos({ x: layout.x, y: layout.y })
      if (layout.w != null && layout.h != null)
        setSize({ w: layout.w, h: layout.h })
    })
  }, [getLayout])

  const saveLayout = () => void setLayout(layoutRef.current)

  // ---- 拖动（标题栏）----
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button"))
      return
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect)
      return
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag)
      return
    const rect = cardRef.current?.getBoundingClientRect()
    const w = rect?.width ?? 320
    const h = rect?.height ?? 80
    const next = {
      x: clamp(drag.originX + (e.clientX - drag.startX), 0, window.innerWidth - w),
      y: clamp(drag.originY + (e.clientY - drag.startY), 0, window.innerHeight - h),
    }
    setPos(next)
    layoutRef.current = { ...layoutRef.current, ...next }
  }
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current)
      return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    saveLayout()
  }

  // ---- 缩放（右下角）----
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect)
      return
    resizeRef.current = { startX: e.clientX, startY: e.clientY, originW: rect.width, originH: rect.height }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
    e.stopPropagation()
  }
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rs = resizeRef.current
    if (!rs)
      return
    const next = {
      w: clamp(rs.originW + (e.clientX - rs.startX), minWidth, window.innerWidth - 16),
      h: clamp(rs.originH + (e.clientY - rs.startY), minHeight, window.innerHeight - 16),
    }
    setSize(next)
    layoutRef.current = { ...layoutRef.current, ...next }
  }
  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current)
      return
    resizeRef.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    saveLayout()
  }

  return {
    cardRef,
    pos,
    size,
    onDragStart,
    onDragMove,
    onDragEnd,
    onResizeStart,
    onResizeMove,
    onResizeEnd,
  }
}
