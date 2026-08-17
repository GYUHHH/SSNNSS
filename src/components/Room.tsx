import { ContactShadows, OrthographicCamera } from '@react-three/drei'
import { Canvas, events, useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type Group, type Material, MathUtils, type Mesh } from 'three'
import { useRoomStore } from '../store'
import { currentRoomHandle, enterRoom, fetchRoomDirectory } from '../services/social'
import Bookshelf from './Bookshelf'
import Bed from './Bed'
import CameraController from './CameraController'
import Character from './Character'
import Chair from './Chair'
import Computer from './Computer'
import Cup from './Cup'
import DebugAnchors from './DebugAnchors'
import Decor from './Decor'
import Desk from './Desk'
import Floor from './Floor'
import { InventoryFurniture, InventoryPreview } from './InventoryFurniture'
import Sofa from './Sofa'
import { SurfaceDropZones } from './SurfaceDropZone'
import Walls from './Walls'
import WallVideoLayer from './WallVideoLayer'
import ReactionBadges from './ReactionBadges'

// per-time-of-day lighting: night keeps lights low so lit lamps visibly carry the room
const LIGHTING = {
  day: { bg: '#f4efe6', ambient: 2.1, ambientColor: '#fff7ee', dir: 2.4, dirColor: '#fff3e2' },
  evening: { bg: '#e9d3bc', ambient: 1.3, ambientColor: '#ffc894', dir: 1.7, dirColor: '#ff9a5e' },
  night: { bg: '#232939', ambient: 0.5, ambientColor: '#8b97b8', dir: 0.35, dirColor: '#aab4d4' },
} as const

// Pointer coords are computed from the canvas's LIVE on-screen rect — the scene slides 240px left while a
// panel is open, and the default client-coordinate mapping would leave every click/hover offset by that shift.
const shiftAwareEvents: NonNullable<Parameters<typeof Canvas>[0]['events']> = (store) => ({
  ...events(store),
  compute(event, state) {
    const rect = state.gl.domElement.getBoundingClientRect()
    state.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    state.raycaster.setFromCamera(state.pointer, state.camera)
  },
})

function Scene() {
  const { clearSelection, mode, toggleEditMode, timeOfDay } = useRoomStore()
  const light = LIGHTING[timeOfDay]
  // Blending occlusion for wall videos: the canvas is transparent and drawn over the video DOM, punching a
  // depth-tested hole where a frame's screen is — furniture in front of the frame covers its video for real.
  // Scene events re-route to this host (with client coords) because the canvas itself is pointer-transparent
  // so clicks over a video can fall through into the iframe. The room background moves to the host's CSS.
  const eventHost = useRef<HTMLDivElement>(null!)
  return <div ref={eventHost} className="canvas-host" style={{ background: light.bg }}><Canvas shadows="basic" dpr={[1, 2]} gl={{ antialias: true }} eventSource={eventHost} events={shiftAwareEvents} onPointerMissed={(event) => { if (!(event.target as HTMLElement)?.closest?.('.canvas-host')) return; (mode === 'edit' ? toggleEditMode : clearSelection)() }} camera={{ position: [9.5, 8.5, 10] }}>
    <OrthographicCamera makeDefault position={[9.5, 8.5, 10]} zoom={59} near={0.1} far={100} />
    <ambientLight intensity={light.ambient} color={light.ambientColor} />
    <directionalLight castShadow position={[4, 8, 5]} intensity={light.dir} color={light.dirColor} shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <Suspense fallback={null}>
      <RoomWorld />
    </Suspense>
  </Canvas></div>
}

const ROOM_SIZE = 7
const ROOM_ROW_DISTANCE = ROOM_SIZE * 1.65
const LOBBY = '__lobby__'
type RoomSlot = { handle: string; column: number; row: number; position: [number, number, number] }
const neighbourCells = (column: number, row: number): Array<[number, number]> => {
  const right = Math.abs(row % 2)
  return [[column - 1, row], [column + 1, row], [column - 1 + right, row - 1], [column + right, row - 1], [column - 1 + right, row + 1], [column + right, row + 1]]
}
const axial = (slot: Pick<RoomSlot, 'column' | 'row'>) => ({ q: slot.column - (slot.row - Math.abs(slot.row % 2)) / 2, r: slot.row })
const hexDistance = (a: RoomSlot, b: RoomSlot) => { const aa = axial(a); const bb = axial(b); const q = aa.q - bb.q; const r = aa.r - bb.r; return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) }

// Screen rows run along world [+X, -Z] under the fixed isometric camera; screen depth runs along [+X, +Z].
// ROOM_ROW_DISTANCE includes the projected wall height, so complete room silhouettes meet instead of occluding.
const roomSlots = (handles: string[]): RoomSlot[] => {
  const cells: Array<[number, number]> = [[0, 0]]
  const seen = new Set(['0:0'])
  for (let index = 0; index < cells.length && cells.length < handles.length; index += 1) {
    const [column, row] = cells[index]
    for (const cell of neighbourCells(column, row)) {
      const key = `${cell[0]}:${cell[1]}`
      if (seen.has(key)) continue
      seen.add(key); cells.push(cell)
      if (cells.length === handles.length) break
    }
  }
  return handles.map((handle, index) => {
    const [column, row] = cells[index]
    const staggeredColumn = column + Math.abs(row % 2) / 2
    const rowOffset = row * ROOM_ROW_DISTANCE
    return { handle, column, row, position: [staggeredColumn * ROOM_SIZE + rowOffset, 0, -staggeredColumn * ROOM_SIZE + rowOffset] }
  })
}
if (import.meta.env.DEV) {
  const check = roomSlots(['0', '1', '2', '3', '4', '5', '6'])
  if (new Set(check.map((slot) => slot.position.join(':'))).size !== 7 || check.slice(1).some((slot) => hexDistance(slot, check[0]) !== 1)) throw new Error('Room cluster slots must form six unique neighbours')
}

function RoomRoot() {
  return <>
    <Floor /><Walls /><Bookshelf /><Desk /><Chair /><Computer /><Cup /><Sofa /><Bed /><Decor /><InventoryFurniture /><InventoryPreview /><SurfaceDropZones /><Character /><DebugAnchors /><WallVideoLayer /><ReactionBadges />
    <ContactShadows position={[0, 0.018, 0]} opacity={0.38} scale={9} blur={2.4} far={2.2} resolution={1024} />
  </>
}

function RoomContainer({ slot, distance, open }: { slot: RoomSlot; distance: number; open: () => void }) {
  const { mode } = useRoomStore()
  const group = useRef<Group>(null)
  const opacity = useRef(0)
  const materials = useRef<Material[]>([])
  useLayoutEffect(() => {
    materials.current = []
    group.current?.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      list.forEach((material) => { material.transparent = true; materials.current.push(material) })
    })
  }, [])
  useFrame(({ camera }, delta) => {
    if (!group.current) return
    const threshold = distance <= 1 ? 36 : distance === 2 ? 23 : 16
    const wanted = mode === 'normal' ? MathUtils.clamp((threshold - camera.zoom) / 5, 0, 1) : 0
    opacity.current = MathUtils.damp(opacity.current, wanted, 7, delta)
    group.current.visible = opacity.current > .01
    group.current.scale.setScalar(.88 + opacity.current * .12)
    materials.current.forEach((material) => { material.opacity = opacity.current })
  })
  return <group ref={group} position={slot.position} visible={false}
    onPointerOver={(event) => { if (opacity.current < .65) return; event.stopPropagation(); document.body.style.cursor = 'pointer' }}
    onPointerOut={() => { document.body.style.cursor = '' }}
    onClick={(event) => { if (opacity.current < .65) return; event.stopPropagation(); document.body.style.cursor = ''; open() }}>
    <mesh position={[0, -.11, 0]}><boxGeometry args={[7, .22, 7]} /><meshStandardMaterial color="#ddb06d" roughness={.9} /></mesh>
    <mesh position={[-3.61, 3.5, 0]}><boxGeometry args={[.22, 7, 7.22]} /><meshStandardMaterial color="#ead9bd" roughness={.9} /></mesh>
    <mesh position={[0, 3.5, -3.61]}><boxGeometry args={[7, 7, .22]} /><meshStandardMaterial color="#f1e2c9" roughness={.9} /></mesh>
    <group position={[1.25, 0, -2.45]}>
      <mesh position={[0, .9, 0]}><boxGeometry args={[2.1, .18, .8]} /><meshStandardMaterial color="#bd8455" /></mesh>
      {[-.85, .85].map((x) => <mesh key={x} position={[x, .45, 0]}><boxGeometry args={[.16, .9, .16]} /><meshStandardMaterial color="#7d5338" /></mesh>)}
    </group>
    <group position={[-2.65, 0, -2.75]}>
      <mesh position={[0, 1.15, 0]}><boxGeometry args={[1.05, 2.3, .48]} /><meshStandardMaterial color="#9c6a45" /></mesh>
      {[-.55, .05, .65].map((y) => <mesh key={y} position={[0, 1.15 + y, .26]}><boxGeometry args={[.95, .1, .06]} /><meshStandardMaterial color="#d9b27a" /></mesh>)}
    </group>
    <group position={[0, 0, .55]}>
      <mesh position={[0, .76, 0]}><capsuleGeometry args={[.16, .45, 4, 8]} /><meshStandardMaterial color="#8aa18b" /></mesh>
      <mesh position={[0, 1.34, 0]}><sphereGeometry args={[.28, 12, 8]} /><meshStandardMaterial color="#8b5b3b" /></mesh>
    </group>
  </group>
}

function RoomWorld() {
  const initialHandle = useRef(currentRoomHandle() ?? LOBBY).current
  const [handles, setHandles] = useState([initialHandle])
  const [activeHandle, setActiveHandle] = useState(initialHandle)
  const [focusRoom, setFocusRoom] = useState<{ position: [number, number, number]; token: number }>({ position: [0, 0, 0], token: 0 })
  const opening = useRef(false)
  useEffect(() => {
    let live = true
    void fetchRoomDirectory().then((found) => { if (live) setHandles([initialHandle, ...found.filter((handle) => handle !== initialHandle)]) })
    return () => { live = false }
  }, [initialHandle])
  const slots = useMemo(() => roomSlots(handles), [handles])
  const active = slots.find((slot) => slot.handle === activeHandle) ?? slots[0]
  const open = async (slot: RoomSlot) => {
    if (opening.current || slot.handle === LOBBY) return
    opening.current = true
    const entered = await enterRoom(slot.handle)
    opening.current = false
    if (!entered) return
    setActiveHandle(slot.handle)
    setFocusRoom({ position: slot.position, token: performance.now() })
  }
  return <>
    {slots.filter((slot) => slot.handle !== active.handle).map((slot) => <RoomContainer key={slot.handle} slot={slot} distance={hexDistance(slot, active)} open={() => void open(slot)} />)}
    <group position={active.position}><RoomRoot /></group>
    <CameraController focusRoom={focusRoom} />
  </>
}

export default function Room() { return <Scene /> }
