import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Box3, Vector3, type Group } from 'three'
import { useRoomStore } from '../store'
import { setExternalHover } from './Interactive'
import { isVisiting } from '../services/social'

// A red dot at the top-right of any object carrying NEW reactions from other people — likes and comments,
// including those left on the records inside a bookshelf. Owner-only; visitors never see them. The dot rides
// the object's live bounding box EVERY frame (no throttle, no re-render) so it lifts with the hover instead of
// lagging behind it, and hovering the dot lifts the object exactly as pointing at the object would.
// Seen-state lives in the server bundle — never localStorage — so a cleared dot stays cleared across reloads.
function Badge({ id, count }: { id: string; count: number }) {
  const { setReactionTarget, markReactionsSeen, mode } = useRoomStore()
  const holder = useRef<Group>(null)
  const box = useRef(new Box3())
  const corner = useRef(new Vector3())
  useFrame(({ scene }) => {
    const target = holder.current
    if (!target) return
    const fit = scene.getObjectByName(`fit:${id}`)
    if (!fit) { target.visible = false; return }
    box.current.setFromObject(fit)
    if (box.current.isEmpty()) { target.visible = false; return }
    corner.current.set(box.current.max.x, box.current.max.y, box.current.max.z)
    target.position.copy(corner.current)
    target.visible = true
  })
  const open = () => { markReactionsSeen(id); setReactionTarget(id) }
  if (mode === 'edit') return null
  return <group ref={holder}>
    <Html center zIndexRange={[5, 0]}>
      <button
        type="button"
        className="reaction-badge"
        aria-label={`반응 ${count}개`}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerEnter={() => setExternalHover(id)}
        onPointerLeave={() => setExternalHover(null)}
        onClick={(event) => { event.stopPropagation(); setExternalHover(null); open() }}
      />
    </Html>
  </group>
}

export default function ReactionBadges() {
  const { pendingReactions } = useRoomStore()
  if (isVisiting()) return null
  return <>{Object.entries(pendingReactions).map(([id, count]) => <Badge key={id} id={id} count={count} />)}</>
}
