import { useEffect, useRef } from 'react'
import { useRoomStore } from '../store'

// Panels are navigation, so the browser's back button should walk back through them instead of leaving the
// site. Each layer that opens pushes one history entry; back closes the topmost layer; closing a layer from
// the UI walks history back by the same amount, so the two never drift apart. Only when every panel is shut
// does back finally leave the page.
export default function PanelHistory() {
  const { selectedObject, bookshelfOpen, openBookId, commentTarget, reactionTarget, clearSelection, closeBook, setCommentTarget, setReactionTarget } = useRoomStore()
  const layers = [selectedObject || bookshelfOpen, openBookId, commentTarget || reactionTarget].filter(Boolean).length
  const previous = useRef(0)
  const popping = useRef(false)
  const closeTop = useRef(() => { /* replaced every render with the current state */ })
  closeTop.current = () => {
    if (commentTarget) return setCommentTarget(null)
    if (reactionTarget) return setReactionTarget(null)
    if (openBookId) return closeBook()
    if (selectedObject || bookshelfOpen) return clearSelection()
  }
  useEffect(() => {
    const onPop = () => { if (previous.current > 0) { popping.current = true; closeTop.current() } }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    const before = previous.current
    previous.current = layers
    if (layers > before) for (let step = before; step < layers; step++) history.pushState({ panel: step + 1 }, '', location.href)
    else if (layers < before) {
      // a back button already moved the history cursor; anything else (a close button, an outside click) has to
      if (popping.current) popping.current = false
      else history.go(-(before - layers))
    }
  }, [layers])
  return null
}
