import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { Box3, Vector3 } from 'three'
import { useRoomStore } from '../store'
import { getSeenReactions, isVisiting, markReactionSeen, myVisitorId } from '../services/social'

// A red dot at the top-right of any object that has NEW reactions from other people (likes or guestbook
// comments) — owner-only; visitors never see them. Clicking opens the reaction popup and marks the current
// reactions as seen, so the dot disappears until something new arrives. The dot anchors to the item's live
// bounding box, so it follows moves, rotations, and hover lifts.
// seen-state lives in the server bundle (social.ts) — never localStorage — so a badge stays cleared across reloads
function Badge({ id, count, onSeen }: { id: string; count: number; onSeen: () => void }) {
  const { setReactionTarget, mode } = useRoomStore()
  const [anchor, setAnchor] = useState<[number, number, number] | null>(null)
  const throttle = useRef(0)
  const box = useRef(new Box3())
  const corner = useRef(new Vector3())
  useFrame(({ scene }, delta) => {
    throttle.current -= delta
    if (throttle.current > 0) return
    throttle.current = .5
    const fit = scene.getObjectByName(`fit:${id}`)
    if (!fit) { setAnchor(null); return }
    box.current.setFromObject(fit)
    if (box.current.isEmpty()) { setAnchor(null); return }
    corner.current.set(box.current.max.x, box.current.max.y, box.current.max.z)
    setAnchor((previous) => {
      const next: [number, number, number] = [corner.current.x, corner.current.y, corner.current.z]
      return previous && Math.abs(previous[0] - next[0]) + Math.abs(previous[1] - next[1]) + Math.abs(previous[2] - next[2]) < .01 ? previous : next
    })
  })
  if (!anchor || mode === 'edit') return null
  return <Html position={anchor} center zIndexRange={[5, 0]}>
    <button type="button" className="reaction-badge" aria-label={`반응 ${count}개`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onSeen(); setReactionTarget(id) }} />
  </Html>
}

export default function ReactionBadges() {
  const { furniture, othersLikes, guestbook } = useRoomStore()
  const [seen, setSeen] = useState<Record<string, number>>(() => ({ ...getSeenReactions() }))
  if (isVisiting()) return null
  const mine = myVisitorId()
  const markSeen = (id: string, count: number) => {
    markReactionSeen(id, count)
    setSeen({ ...getSeenReactions() })
  }
  return <>{furniture.filter((item) => !item.removed).map((item) => {
    const likeCount = othersLikes[item.id] ?? 0
    const commentCount = (guestbook[item.id] ?? []).filter((comment) => comment.visitor && comment.visitor !== mine).length
    const count = likeCount + commentCount
    return count > (seen[item.id] ?? 0) ? <Badge key={item.id} id={item.id} count={count} onSeen={() => markSeen(item.id, count)} /> : null
  })}</>
}
