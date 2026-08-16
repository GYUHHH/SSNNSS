import { useEffect, useState } from 'react'
import { useRoomStore } from '../store'
import { HeartIcon, CommentIcon } from './ReactionIcons'
import { likeBurst } from './Interactive'
import { requireHandle, toggleLike } from '../services/social'

// Press and hold a piece of furniture and the two reactions rise out of the press point. The finger (or the
// mouse button) never lifts in between: sliding toward one pulls it in like a magnet and lifting there fires
// it. One Pointer Events flow, so mouse, touch and stylus all behave the same.
export type PickerRequest = { id: string; x: number; y: number }
const OPEN_EVENT = 'reaction-picker'
export const openReactionPicker = (request: PickerRequest) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: request }))

const LIFT = 66      // how far above the press point the icons sit
const SPREAD = 52    // how far left/right of it
const SNAP = 70      // pointer within this distance activates an icon
const PULL = .3      // share of the gap the active icon leans toward the pointer

export default function ReactionPicker() {
  const { setCommentTarget } = useRoomStore()
  const [at, setAt] = useState<PickerRequest | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const onOpen = (event: Event) => { const detail = (event as CustomEvent<PickerRequest>).detail; setAt(detail); setPointer({ x: detail.x, y: detail.y }) }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])
  useEffect(() => {
    if (!at) return
    const spots = { like: { x: at.x - SPREAD, y: at.y - LIFT }, comment: { x: at.x + SPREAD, y: at.y - LIFT } }
    const nearest = (x: number, y: number) => {
      const distance = (spot: { x: number; y: number }) => Math.hypot(x - spot.x, y - spot.y)
      const like = distance(spots.like)
      const comment = distance(spots.comment)
      if (Math.min(like, comment) > SNAP) return null
      return like <= comment ? 'like' : 'comment'
    }
    const onMove = (event: PointerEvent) => setPointer({ x: event.clientX, y: event.clientY })
    const onUp = (event: PointerEvent) => {
      const choice = nearest(event.clientX, event.clientY)
      setAt(null); setPointer(null)
      if (!choice || !requireHandle()) return
      if (choice === 'comment') { setCommentTarget(at.id); return }
      const burst = likeBurst(event.clientX, event.clientY, '♥')
      void toggleLike(at.id).then((result) => { if (result) burst(`${result.liked ? '♥' : '♡'} ${result.count}`) })
    }
    const onCancel = () => { setAt(null); setPointer(null) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel) }
  }, [at, setCommentTarget])
  if (!at) return null
  const spots = { like: { x: at.x - SPREAD, y: at.y - LIFT }, comment: { x: at.x + SPREAD, y: at.y - LIFT } }
  const active = (() => {
    if (!pointer) return null
    const like = Math.hypot(pointer.x - spots.like.x, pointer.y - spots.like.y)
    const comment = Math.hypot(pointer.x - spots.comment.x, pointer.y - spots.comment.y)
    if (Math.min(like, comment) > SNAP) return null
    return like <= comment ? 'like' : 'comment'
  })()
  const style = (key: 'like' | 'comment') => {
    const spot = spots[key]
    const on = active === key
    const pullX = on && pointer ? (pointer.x - spot.x) * PULL : 0
    const pullY = on && pointer ? (pointer.y - spot.y) * PULL : 0
    return { left: spot.x, top: spot.y, transform: `translate(calc(-50% + ${pullX}px), calc(-50% + ${pullY}px)) scale(${on ? 1.26 : 1})` }
  }
  return <>
    <div className={`reaction-pick${active === 'like' ? ' on' : ''}`} style={style('like')} aria-hidden="true"><HeartIcon filled={active === 'like'} /></div>
    <div className={`reaction-pick${active === 'comment' ? ' on' : ''}`} style={style('comment')} aria-hidden="true"><CommentIcon /></div>
  </>
}
