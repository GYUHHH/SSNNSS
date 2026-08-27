import { useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { Box3, type Group, Matrix4, type Mesh, type Object3D, Vector3 } from 'three'
import { type SelectedObject, useRoomStore } from '../store'
import { isOwnedSurfaceId, ownerIdOf } from '../services/roomGrid'
import { isVisiting } from '../services/social'
import { openReactionPicker } from './ReactionPicker'

// hover is shared per GROUP (a surface owner + everything sitting on it), so pointing at a desk lifts the desk,
// computer and mug together instead of one piece popping out alone. Mutable module state on purpose: useFrame
// reads it every frame, so no re-render is needed and pointer over/out ordering races are settled by `by`.
const hoverShared = { group: null as string | null, by: null as string | null }
const DIRECT_PANEL_TYPES = new Set(['diary-book', 'music-player', 'record-player', 'cd-player'])

// lets UI outside the canvas (the sound list) hover a piece exactly like the pointer would
export const setExternalHover = (id: string | null) => { hoverShared.group = id; hoverShared.by = id ? `external:${id}` : null }

// How much slack a piece gets around its own outline, in room units — a grid cell is 0.7, so this is a fifth of one,
// roughly nine screen pixels at the zoom a room is entered at. The bigger win is not the margin though: the pad is a
// solid box, so it also fills the holes INSIDE an outline — between chair legs, under a desk, around a lamp stem —
// which is where most missed clicks actually land.
const PAD = .08
const padBox = new Box3()
const padInverse = new Matrix4()
const padSize = new Vector3()
const padCentre = new Vector3()

// 크기 조절 손잡이가 광선에 함께 걸렸으면 이동보다 우선한다 — 손잡이가 액자보다 뒤에 있어도(액자가 먼저
// 광선에 걸려도) 근처를 눌렀다는 뜻이므로 이동을 시작하지 않고 손잡이에 넘긴다
const nearResizeHandle = (event: { intersections: { object: Object3D }[] }) =>
  event.intersections.some((hit) => hit.object.userData.resizeHandle === true)

const isSolid = (object: Object3D) => {
  for (let node: Object3D | null = object; node; node = node.parent) if (node.userData.interactive) return true
  return false
}
// A pad is generous, not greedy: it only counts when the ray found nothing solid on its way through. Without this a
// desk's pad — a box that reaches the floor — would swallow the click meant for the chair tucked under it, and
// forgiving selection would end up worse than the exact one it replaced.
const padOverruled = (event: { object: Object3D; intersections: { object: Object3D }[] }) =>
  event.object.userData.hitPad === true && event.intersections.some((hit) => !hit.object.userData.hitPad && isSolid(hit.object))

type Props = {
  id: Exclude<SelectedObject, null>
  // A piece whose OWN children are the click targets opts out of the forgiving hit box: the pad wraps the whole
  // piece, and for the bookshelf that meant one box sitting in front of every book spine, so the individual book
  // that used to pop out and open could no longer be picked out from the shelf around it.
  pad?: boolean
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
  editing?: boolean
  editOverlay?: ReactNode
  children: ReactNode
}

export default function Interactive({ id, position, rotation = [0, 0, 0], scale: baseScale = 1, pad: padded = true, editing = false, editOverlay, children }: Props) {
  const group = useRef<Group>(null)
  const content = useRef<Group>(null)
  const pad = useRef<Mesh>(null)
  const refitIn = useRef(0)
  const refitsLeft = useRef(4)
  const [hovered, setHovered] = useState(false)
  const press = useRef<{ x: number; y: number; pointerId: number; target: { hasPointerCapture: (pointerId: number) => boolean; releasePointerCapture: (pointerId: number) => void } } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const { readOnly, selectObject, enterEditFurniture, furniture, openObject, selectFurniture, beginMove } = useRoomStore()
  const item = furniture.find((value) => value.id === id)
  const directPanel = DIRECT_PANEL_TYPES.has(item?.type ?? '')
  const hoverGroup = item && isOwnedSurfaceId(item.surfaceId) ? ownerIdOf(item.surfaceId) : id
  useCursor(hovered && !editing)
  const cancelPress = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; press.current = null }
  // Measure a few times while suspended content settles, then stop. Recomputing every object's Box3 forever made
  // them all hitch together every .4 seconds during character movement.
  const fitPad = () => {
    if (!content.current || !pad.current || !group.current) return
    padBox.setFromObject(content.current)
    if (padBox.isEmpty()) { pad.current.scale.setScalar(0); return }
    // world bounds measured back into the group's own space. Exact here because furniture only ever turns in
    // quarter turns, and rotating an axis-aligned box by one of those gives an axis-aligned box.
    group.current.updateWorldMatrix(true, false)
    padBox.applyMatrix4(padInverse.copy(group.current.matrixWorld).invert())
    padBox.getSize(padSize)
    padBox.getCenter(padCentre)
    pad.current.scale.set(padSize.x + PAD * 2, padSize.y + PAD * 2, padSize.z + PAD * 2)
    pad.current.position.copy(padCentre)
  }
  useLayoutEffect(() => {
    // A mode change keeps this tree mounted, but must still clear a stale hover lift before editing begins.
    hoverShared.group = null; hoverShared.by = null
    setHovered(false)
    return () => { cancelPress(); if (hoverShared.by === id) { hoverShared.group = null; hoverShared.by = null } }
  }, [editing])

  useFrame((_, delta) => {
    if (!group.current) return
    // Read-only explorer furniture cannot hover or edit, and its room owns one shared hitbox.
    if (readOnly) return
    if (editing) {
      group.current.position.set(...position)
      group.current.rotation.set(...rotation)
      group.current.scale.setScalar(baseScale)
      return
    }
    refitIn.current -= delta
    if (refitsLeft.current > 0 && refitIn.current <= 0) { refitIn.current = .4; refitsLeft.current -= 1; fitPad() }
    const groupHovered = hoverShared.group === hoverGroup
    const lift = groupHovered ? 0.07 : 0
    group.current.position.y += (position[1] + lift - group.current.position.y) * Math.min(1, delta * 12)
    const scale = baseScale * (groupHovered ? 1.03 : 1)
    group.current.scale.setScalar(group.current.scale.x + (scale - group.current.scale.x) * Math.min(1, delta * 12))
  })

  return <group ref={group} position={position} rotation={rotation} scale={baseScale} userData={{ interactive: id }}
    onPointerOver={editing ? undefined : (event) => { if (readOnly || padOverruled(event)) return; event.stopPropagation(); hoverShared.group = hoverGroup; hoverShared.by = id; setHovered(true) }}
    onPointerOut={editing ? undefined : () => { if (hoverShared.by === id) { hoverShared.group = null; hoverShared.by = null } setHovered(false) }}
    onPointerDown={(event) => {
      if (readOnly || padOverruled(event) || nearResizeHandle(event)) return
      event.stopPropagation()
      if (editing) { selectFurniture(id); beginMove(id); return }
      if (isVisiting()) return
      longPressed.current = false
      const target = event.target as unknown as { setPointerCapture: (pointerId: number) => void; hasPointerCapture: (pointerId: number) => boolean; releasePointerCapture: (pointerId: number) => void }
      target.setPointerCapture(event.pointerId); press.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, target }
      timer.current = setTimeout(() => { const held = press.current; if (!held) return; if (held.target.hasPointerCapture(held.pointerId)) held.target.releasePointerCapture(held.pointerId); longPressed.current = true; timer.current = null; enterEditFurniture(id) }, 500)
    }}
    onPointerMove={editing ? undefined : (event) => { if (!press.current) return; if (Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 9 && timer.current) cancelPress() }}
    onPointerUp={editing ? undefined : (event) => { const target = event.target as unknown as { hasPointerCapture: (pointerId: number) => boolean; releasePointerCapture: (pointerId: number) => void }; cancelPress(); if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId) }}
    onPointerCancel={editing ? undefined : cancelPress}
    onClick={(event) => { if (readOnly || padOverruled(event)) return; event.stopPropagation(); if (editing) return; if (isVisiting() && !directPanel) { openReactionPicker({ id, x: event.clientX, y: event.clientY }); return }; if (longPressed.current) { longPressed.current = false; return }; if (!directPanel && openObject(id)) return; selectObject(id) }}>
    <group ref={content}>{children}</group>
    {/* the forgiving hit area. Never drawn, but three's raycaster tests layers rather than `visible`, so it is
        still a target — which is the whole point. Sized from the contents by fitPad above. */}
    {padded && <mesh ref={pad} visible={false} scale={0} userData={{ hitPad: true }}>
      <boxGeometry />
      <meshBasicMaterial />
    </mesh>}
    {editing && editOverlay}
  </group>
}
