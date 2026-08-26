import { useEffect, useState } from 'react'
import { useRoomStore } from '../store'
import { HeartIcon, CommentIcon } from './ReactionIcons'
import { requireHandle, toggleLike } from '../services/social'
import { t } from '../services/i18n'

// A visitor's ordinary object click opens this small persistent choice. Heart/comment are real buttons so the
// second tap works equally on mouse and touch; clicking anywhere else dismisses it.
export type PickerRequest = { id: string; x: number; y: number }
const OPEN_EVENT = 'reaction-picker'
export const openReactionPicker = (request: PickerRequest) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: request }))
// While the picker is up, the slide toward an icon must not double as a camera drag — the camera listens to
// this and holds still for exactly as long as the picker is on screen.
export const PICKER_HOLD_EVENT = 'reaction-picker-hold'

const LIFT = 66      // how far above the press point the icons sit
const SPREAD = 28    // how far left/right of it — the two sit almost shoulder to shoulder

// the heart that floats up from the release point; the returned function corrects the count once the server
// answers, while the heart is still on screen
const likeBurst = (x: number, y: number, label: string) => {
  const el = document.createElement('div')
  el.className = 'like-burst'
  el.textContent = label
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  document.body.append(el)
  setTimeout(() => el.remove(), 950)
  return (corrected: string) => { if (el.isConnected) el.textContent = corrected }
}

export default function ReactionPicker() {
  const { setCommentTarget } = useRoomStore()
  const [at, setAt] = useState<PickerRequest | null>(null)
  useEffect(() => {
    const onOpen = (event: Event) => setAt((event as CustomEvent<PickerRequest>).detail)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])
  useEffect(() => { window.dispatchEvent(new CustomEvent(PICKER_HOLD_EVENT, { detail: !!at })) }, [!!at])
  if (!at) return null
  const spots = { like: { x: at.x - SPREAD, y: at.y - LIFT }, comment: { x: at.x + SPREAD, y: at.y - LIFT } }
  const choose = (choice: 'like' | 'comment', x: number, y: number) => {
    const id = at.id
    setAt(null)
    if (!requireHandle()) return
    if (choice === 'comment') { setCommentTarget(id); return }
    const burst = likeBurst(x, y, '♥')
    void toggleLike(id).then((result) => { if (result) burst(`${result.liked ? '♥' : '♡'} ${result.count}`) })
  }
  return <>
    <div className="reaction-picker-dismiss" onPointerDown={() => setAt(null)} />
    <button type="button" className="reaction-pick" style={{ left: spots.like.x, top: spots.like.y }} aria-label={t('좋아요')} onClick={(event) => { event.stopPropagation(); choose('like', event.clientX, event.clientY) }}><HeartIcon filled={false} /></button>
    <button type="button" className="reaction-pick" style={{ left: spots.comment.x, top: spots.comment.y }} aria-label={t('댓글')} onClick={(event) => { event.stopPropagation(); choose('comment', event.clientX, event.clientY) }}><CommentIcon /></button>
  </>
}
