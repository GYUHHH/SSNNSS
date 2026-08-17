import { useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { type SelectedObject, useRoomStore } from '../store'
import { isOwnedSurfaceId, ownerIdOf } from '../services/roomGrid'
import { isVisiting } from '../services/social'
import { openReactionPicker } from './ReactionPicker'

// hover is shared per GROUP (a surface owner + everything sitting on it), so pointing at a desk lifts the desk,
// computer and mug together instead of one piece popping out alone. Mutable module state on purpose: useFrame
// reads it every frame, so no re-render is needed and pointer over/out ordering races are settled by `by`.
const hoverShared = { group: null as string | null, by: null as string | null }

// lets UI outside the canvas (the sound list) hover a piece exactly like the pointer would
export const setExternalHover = (id: string | null) => { hoverShared.group = id; hoverShared.by = id ? `external:${id}` : null }

type Props = {
  id: Exclude<SelectedObject, null>
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
  children: ReactNode
}

export default function Interactive({ id, position, rotation = [0, 0, 0], scale: baseScale = 1, children }: Props) {
  const group = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)
  const press = useRef<{ x: number; y: number; pointerId: number; target: { hasPointerCapture: (pointerId: number) => boolean; releasePointerCapture: (pointerId: number) => void } } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const { selectObject, enterEditFurniture, furniture, openObject } = useRoomStore()
  const item = furniture.find((value) => value.id === id)
  const hoverGroup = item && isOwnedSurfaceId(item.surfaceId) ? ownerIdOf(item.surfaceId) : id
  useCursor(hovered)
  const cancelPress = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; press.current = null }
  useLayoutEffect(() => {
    // Normal-mode objects mount again after editing. Clear the pointer state R3F kept for the old object
    // before the first frame, otherwise it stays enlarged until the pointer leaves and re-enters.
    hoverShared.group = null; hoverShared.by = null
    return () => { cancelPress(); if (hoverShared.by === id) { hoverShared.group = null; hoverShared.by = null } }
  }, [])

  useFrame((_, delta) => {
    if (!group.current) return
    const groupHovered = hoverShared.group === hoverGroup
    const lift = groupHovered ? 0.07 : 0
    group.current.position.y += (position[1] + lift - group.current.position.y) * Math.min(1, delta * 12)
    const scale = baseScale * (groupHovered ? 1.03 : 1)
    group.current.scale.setScalar(group.current.scale.x + (scale - group.current.scale.x) * Math.min(1, delta * 12))
  })

  return <group ref={group} position={position} rotation={rotation} scale={baseScale} onPointerOver={(event) => { event.stopPropagation(); hoverShared.group = hoverGroup; hoverShared.by = id; setHovered(true) }} onPointerOut={() => { if (hoverShared.by === id) { hoverShared.group = null; hoverShared.by = null } setHovered(false) }} onPointerDown={(event) => { event.stopPropagation(); longPressed.current = false; const target = event.target as unknown as { setPointerCapture: (pointerId: number) => void; hasPointerCapture: (pointerId: number) => boolean; releasePointerCapture: (pointerId: number) => void }; target.setPointerCapture(event.pointerId); press.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, target }; timer.current = setTimeout(() => { const held = press.current; if (!held) return; if (held.target.hasPointerCapture(held.pointerId)) held.target.releasePointerCapture(held.pointerId); longPressed.current = true; timer.current = null; if (isVisiting()) openReactionPicker({ id, x: held.x, y: held.y }); else enterEditFurniture(id) }, 500) }} onPointerMove={(event) => { if (!press.current) return; if (Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 9 && timer.current) cancelPress() }} onPointerUp={(event) => { const target = event.target as unknown as { hasPointerCapture: (pointerId: number) => boolean; releasePointerCapture: (pointerId: number) => void }; cancelPress(); if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId) }} onPointerCancel={cancelPress} onClick={(event) => { event.stopPropagation(); if (longPressed.current) { longPressed.current = false; return }; if (openObject(id)) return; selectObject(id) }}>{children}</group>
}
