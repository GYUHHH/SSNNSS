import { useFrame } from '@react-three/fiber'
import { type ReactNode, useRef } from 'react'
import type { Group } from 'three'

// doors, lids and drawers all move the same way: ease toward the open pose and back again.
// `pivot` is the hinge point in the item's own coordinates — children keep theirs.
export function Swing({ open, angle, axis = 'y', pivot, children }: { open: boolean; angle: number; axis?: 'x' | 'y'; pivot: [number, number, number]; children: ReactNode }) {
  const hinge = useRef<Group>(null)
  useFrame((_, delta) => {
    if (!hinge.current) return
    const current = hinge.current.rotation[axis]
    hinge.current.rotation[axis] = current + ((open ? angle : 0) - current) * Math.min(1, delta * 7)
  })
  return <group ref={hinge} position={pivot}><group position={[-pivot[0], -pivot[1], -pivot[2]]}>{children}</group></group>
}

export function Slide({ open, offset, children }: { open: boolean; offset: [number, number, number]; children: ReactNode }) {
  const group = useRef<Group>(null)
  useFrame((_, delta) => {
    if (!group.current) return
    const step = Math.min(1, delta * 7)
    group.current.position.x += ((open ? offset[0] : 0) - group.current.position.x) * step
    group.current.position.y += ((open ? offset[1] : 0) - group.current.position.y) * step
    group.current.position.z += ((open ? offset[2] : 0) - group.current.position.z) * step
  })
  return <group ref={group}>{children}</group>
}
