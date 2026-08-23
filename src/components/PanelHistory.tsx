import { useEffect, useMemo, useRef } from 'react'
import { artworkKindOf } from './ArtworkOverlay'
import { useRoomStore } from '../store'

type PanelState = { selectedObject?: string; openBookId?: string; commentTarget?: string; reactionTarget?: string }

// Store the actual panel state in browser history so forward can reopen the exact panel that back closed.
export default function PanelHistory() {
  const { selectedObject, bookshelfOpen, openBookId, commentTarget, reactionTarget, furniture, clearSelection, selectObject, openBook, openVideoPanel, setCommentTarget, setReactionTarget } = useRoomStore()
  const item = furniture.find((entry) => entry.id === selectedObject)
  const isPanelObject = !!selectedObject && (selectedObject === 'book' || !!artworkKindOf(item?.type ?? ''))
  const state = useMemo<PanelState>(() => ({
    ...(isPanelObject ? { selectedObject: selectedObject! } : bookshelfOpen ? { selectedObject: 'bookshelf' } : {}),
    ...(openBookId ? { openBookId } : {}),
    ...(commentTarget ? { commentTarget } : {}),
    ...(reactionTarget ? { reactionTarget } : {}),
  }), [isPanelObject, selectedObject, bookshelfOpen, openBookId, commentTarget, reactionTarget])
  const key = JSON.stringify(state)
  const depth = Object.keys(state).length
  const previous = useRef<{ key: string; depth: number } | null>(null)
  const restore = useRef((next: PanelState) => {})
  // 우리가 실제로 push한 항목 수. 깊이 차이로 되감으면(예전 방식) 책처럼 한 번에 2단계 깊이로
  // 열리는 패널에서 push(1) < back(2)이 되어 방 밖(이전 방)으로 튕긴다 — 실측 개수만 되감는다.
  const pushed = useRef(0)
  const unwinding = useRef(false)

  restore.current = (next) => {
    setCommentTarget(null)
    setReactionTarget(null)
    if (next.openBookId) openBook(next.openBookId)
    else if (next.selectedObject) {
      const target = furniture.find((entry) => entry.id === next.selectedObject)
      target?.type.startsWith('video-frame') ? openVideoPanel(next.selectedObject) : selectObject(next.selectedObject as Parameters<typeof selectObject>[0])
    } else clearSelection()
    if (next.commentTarget) setCommentTarget(next.commentTarget)
    if (next.reactionTarget) setReactionTarget(next.reactionTarget)
  }

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const next = (event.state?.ssnnssPanel ?? {}) as PanelState
      if (unwinding.current) unwinding.current = false
      else pushed.current = Math.max(0, pushed.current - 1)
      previous.current = { key: JSON.stringify(next), depth: Object.keys(next).length }
      restore.current(next)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const before = previous.current
    if (!before) { previous.current = { key, depth }; return }
    if (key === before.key) return
    previous.current = { key, depth }
    if (depth >= before.depth) { history.pushState({ ssnnssPanel: state }, '', location.href); pushed.current += 1 }
    else {
      const steps = depth === 0 ? pushed.current : Math.min(1, pushed.current)
      pushed.current -= steps
      if (steps > 0) { unwinding.current = true; history.go(-steps) }
    }
  }, [key, depth, state])
  return null
}
