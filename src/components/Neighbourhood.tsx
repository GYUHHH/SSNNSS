import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { MathUtils, type Group, type Mesh, type MeshStandardMaterial, type OrthographicCamera } from 'three'
import { PRETENDARD_WOFF } from '../services/fonts'
import { loadNeighbours, forgetNeighbours, type Neighbour } from '../services/neighbours'
import { enterRoom } from '../services/social'

// Zoom out far enough and the neighbours fade in around you, each one a room-sized cube whose edges meet your
// own. Zoom back in and they fade away, leaving the single room you are standing in. Nothing inside any room
// moves: every neighbour is its own container placed on a grid of whole room widths.
const ROOM = 7          // a room spans the full 10x10 floor grid, 0.7 per cell
const SHOW_AT = 34      // fully hidden at this zoom
const FULL_AT = 20      // fully shown at this zoom

const progressFor = (zoom: number) => MathUtils.clamp((SHOW_AT - zoom) / (SHOW_AT - FULL_AT), 0, 1)

function RoomCube({ neighbour, onEnter }: { neighbour: Neighbour; onEnter: (handle: string) => void }) {
  const [hovered, setHovered] = useState(false)
  const tint = `hsl(${(neighbour.handle.split('').reduce((sum, letter) => sum + letter.charCodeAt(0), 0) * 37) % 360} 22% 74%)`
  return <group position={[neighbour.cell[0] * ROOM, 0, neighbour.cell[1] * ROOM]}
    onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }}
    onPointerOut={() => setHovered(false)}
    onClick={(event) => { event.stopPropagation(); onEnter(neighbour.handle) }}>
    {/* the same shell as a real room: a floor slab and the two walls, so the grid reads as one big space */}
    <mesh position={[0, -0.11, 0]}><boxGeometry args={[ROOM, 0.22, ROOM]} /><meshStandardMaterial color={tint} transparent opacity={0} /></mesh>
    <mesh position={[-3.61, 3.5, 0]}><boxGeometry args={[0.22, 7, 7]} /><meshStandardMaterial color="#e6e2da" transparent opacity={0} /></mesh>
    <mesh position={[0, 3.5, -3.61]}><boxGeometry args={[7, 7, 0.22]} /><meshStandardMaterial color="#efece5" transparent opacity={0} /></mesh>
    <Text position={[0, 1.1, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.62} color={hovered ? '#2f6fd0' : '#6b6b66'} font={PRETENDARD_WOFF} anchorX="center" anchorY="middle" fillOpacity={0}>{neighbour.handle}</Text>
  </group>
}

export default function Neighbourhood() {
  const [neighbours, setNeighbours] = useState<Neighbour[]>([])
  const holder = useRef<Group>(null)
  const shown = useRef(0)
  useEffect(() => { void loadNeighbours().then(setNeighbours) }, [])
  useFrame(({ camera }) => {
    const group = holder.current
    if (!group) return
    const wanted = progressFor((camera as OrthographicCamera).zoom)
    shown.current = MathUtils.damp(shown.current, wanted, 6, 1 / 60)
    const value = shown.current
    group.visible = value > 0.01
    if (!group.visible) return
    // rooms rise into place rather than popping: they scale up and fade together
    group.scale.setScalar(0.88 + value * 0.12)
    group.traverse((node) => {
      const mesh = node as Mesh & { material?: MeshStandardMaterial & { fillOpacity?: number } }
      if (mesh.material && 'opacity' in mesh.material) mesh.material.opacity = value * 0.85
      const text = node as unknown as { fillOpacity?: number }
      if (typeof text.fillOpacity === 'number') text.fillOpacity = value
    })
  })
  const onEnter = (handle: string) => { forgetNeighbours(); void enterRoom(handle).then(() => void loadNeighbours().then(setNeighbours)) }
  if (neighbours.length === 0) return null
  return <group ref={holder} visible={false}>{neighbours.map((neighbour) => <RoomCube key={neighbour.handle} neighbour={neighbour} onEnter={onEnter} />)}</group>
}
