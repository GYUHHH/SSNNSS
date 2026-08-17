import { ContactShadows, OrthographicCamera } from '@react-three/drei'
import { Canvas, events, useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type Group, type Material, MathUtils, type Mesh } from 'three'
import { NeighbourRoomProvider, useRoomStore } from '../store'
import { currentRoomHandle, enterRoom, fetchRoomBundle, fetchRoomDirectory } from '../services/social'
import Bookshelf from './Bookshelf'
import Bed from './Bed'
import CameraController, { exploreMinZoom } from './CameraController'
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
  return <div ref={eventHost} className="canvas-host" style={{ background: light.bg }}><Canvas shadows="basic" dpr={[1, 2]} gl={{ antialias: true }} eventSource={eventHost} events={shiftAwareEvents} onPointerMissed={(event) => { if (!(event.target as HTMLElement)?.closest?.('.canvas-host')) return; (mode === 'edit' ? toggleEditMode : clearSelection)() }} camera={{ position: [10, 8.5, 10] }}>
    <OrthographicCamera makeDefault position={[10, 8.5, 10]} zoom={59} near={0.1} far={100} />
    <ambientLight intensity={light.ambient} color={light.ambientColor} />
    <directionalLight castShadow position={[4, 8, 5]} intensity={light.dir} color={light.dirColor} shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <Suspense fallback={null}>
      <RoomWorld />
    </Suspense>
  </Canvas></div>
}

const ROOM_SIZE = 7
const LOBBY = '__lobby__'
// A vacant slot fills out the ring until real rooms exist to take its place; it is drawn but cannot be entered.
const VACANT = '__vacant-'
// one room plus a full ring of six neighbours
const CLUSTER_SIZE = 7

// A room lives at plan-grid cell (a, b) — world (a·CELL, storey·CELL, b·CELL) — and its storey is exactly −(a + b).
// Measured under the 45° isometric camera (x === z): one room projects to a 200×200px box, a step of 7 along the
// screen-horizontal axis is 100px, and a storey of 7 in Y is 133.3px up. So a cell lands at screen
// (100·(a − b), 166.6·(a + b)) and every ring cell is edge- or corner-adjacent in plan — seen from directly above
// the rooms read as one contiguous block, and each half-step neighbour is exactly one storey up or down.
// The MINUS on the storey is what puts the stack in the right order. Depth toward this camera grows with a + b, so
// tying the storey to +(a + b) lifted the upper rooms TOWARD the viewer and they covered the rooms below them.
// Negating it sends whatever stacks upward back behind, and brings whatever stacks downward to the front.
// A room's slabs sit OUTSIDE its 7×7 grid: the floor is a 0.22-thick box under y = 0 (Floor.tsx) and each wall is
// 0.22 thick outside x = -3.5 / z = -3.5 (Walls.tsx puts it at -3.61, so its outer face is -3.72). A complete room
// therefore measures 7.22 on every axis, and spacing cells by the grid alone made those slabs overlap outright.
// Adding the slab thickness is what makes neighbours meet exactly instead of sharing space and z-fighting.
const SLAB = 0.22
const CELL = ROOM_SIZE + SLAB
const cellPosition = (a: number, b: number): [number, number, number] => [a * CELL, -(a + b) * CELL, b * CELL]
// the six screen directions that leave a room fully visible: two level steps sideways, two a storey up, two down.
// Straight up/down the screen (a + b = ±2) is deliberately left out — that cell hides directly behind this one.
const RING = [[1, -1], [-1, 1], [1, 0], [0, 1], [0, -1], [-1, 0]] as const
type RoomSlot = { handle: string; a: number; b: number; position: [number, number, number] }
const neighbourCells = (a: number, b: number) => RING.map(([da, db]) => [a + da, b + db] as [number, number])
// ring steps are (±2, 0) and (±1, ±1) in 100px screen units, so measure the gap in those coordinates:
// m along the screen's horizontal, n along its vertical
const ringDistance = (from: Pick<RoomSlot, 'a' | 'b'>, to: Pick<RoomSlot, 'a' | 'b'>) => {
  const m = Math.abs((from.a - from.b) - (to.a - to.b))
  const n = Math.abs((from.a + from.b) - (to.a + to.b))
  return n + Math.max(0, (m - n) / 2)
}

const roomSlots = (handles: string[]): RoomSlot[] => {
  const cells: Array<[number, number]> = [[0, 0]]
  const seen = new Set(['0:0'])
  for (let index = 0; index < cells.length && cells.length < handles.length; index += 1) {
    for (const [a, b] of neighbourCells(cells[index][0], cells[index][1])) {
      const key = `${a}:${b}`
      if (seen.has(key)) continue
      seen.add(key); cells.push([a, b])
      if (cells.length === handles.length) break
    }
  }
  return handles.map((handle, index) => { const [a, b] = cells[index]; return { handle, a, b, position: cellPosition(a, b) } })
}
// pads the cluster with vacant slots so the ring is always complete; real handles always take the nearest cells
const withVacancies = (handles: string[]) => handles.length >= CLUSTER_SIZE ? handles
  : [...handles, ...Array.from({ length: CLUSTER_SIZE - handles.length }, (_, index) => `${VACANT}${index}`)]
const isEnterable = (handle: string) => handle !== LOBBY && !handle.startsWith(VACANT)

// Fully zoomed out a drag pans the explorer, and the browser still fires a click when the press ends — which would
// drop the user into whichever room happened to be under the pointer. So a room only counts as picked if the press
// that produced the click stayed put. One tracker for the whole cluster on purpose: the press belongs to the
// gesture, not to a room, and a per-room ref would miss a drag that started somewhere else and ended on this one.
let pressAt: { x: number; y: number } | null = null
const pressWandered = (event: { clientX: number; clientY: number }) => !!pressAt && Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) > 6

if (import.meta.env.DEV) {
  const check = roomSlots(['0', '1', '2', '3', '4', '5', '6'])
  if (new Set(check.map((slot) => slot.position.join(':'))).size !== 7 || check.slice(1).some((slot) => ringDistance(slot, check[0]) !== 1)) throw new Error('Room cluster slots must form six unique neighbours')
  // no two may land on the same screen point: screen x is 100(a−b) and screen y is 166.6(a+b)
  const screen = check.map((slot) => `${slot.a - slot.b}:${slot.a + slot.b}`)
  if (new Set(screen).size !== 7) throw new Error('Room cluster slots must not overlap on screen')
  // Stacking order, read straight off cellPosition so any future edit to it has to keep this true: a room drawn
  // higher on screen must be FURTHER from the camera, otherwise it covers the room below instead of stacking behind
  // it. Both are the measured projection of this camera — screen y counts downward, nearness counts toward the lens.
  const screenY = ([x, y, z]: [number, number, number]) => (33.3 * (x + z) - 133.3 * y) / CELL
  const nearness = ([x, y, z]: [number, number, number]) => (2 * x + y + 2 * z) / CELL
  if (check.some((slot) => Math.sign(Math.round(screenY(slot.position))) !== Math.sign(Math.round(nearness(slot.position))))) throw new Error('Rooms stacked upward must sit behind, and rooms stacked downward in front')
}

function RoomRoot() {
  return <>
    <Floor /><Walls /><Bookshelf /><Desk /><Chair /><Computer /><Cup /><Sofa /><Bed /><Decor /><InventoryFurniture /><InventoryPreview /><SurfaceDropZones /><Character /><DebugAnchors /><WallVideoLayer /><ReactionBadges />
    <ContactShadows position={[0, 0.018, 0]} opacity={0.38} scale={9} blur={2.4} far={2.2} resolution={1024} />
  </>
}

// A neighbour is the real room: the same components the live room is built from, driven by that room's own
// published bundle. Left out on purpose — WallVideoLayer (an iframe per frame, six rooms deep), ReactionBadges
// (DOM badges that cannot fade with the room), the edit-mode-only layers, and ContactShadows (a shadow pass each).
function NeighbourRoom() {
  return <><Floor /><Walls /><Bookshelf /><Desk /><Chair /><Computer /><Cup /><Sofa /><Bed /><Decor /><InventoryFurniture /><Character /></>
}

function RoomContainer({ slot, distance, open }: { slot: RoomSlot; distance: number; open: () => void }) {
  const { mode } = useRoomStore()
  const group = useRef<Group>(null)
  const opacity = useRef(0)
  const materials = useRef<Material[]>([])
  const recollectIn = useRef(0)
  const [bundle, setBundle] = useState<Record<string, string> | null>(null)
  const requested = useRef(false)
  const mounted = useRef(true)
  // set on the way in as well as cleared on the way out: StrictMode mounts, unmounts and remounts, and a
  // clear-only flag stays false through the remount, which silently blocked every bundle from ever landing
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const collect = () => {
    materials.current = []
    group.current?.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      list.forEach((material) => { material.transparent = true; materials.current.push(material) })
    })
  }
  useLayoutEffect(collect, [bundle])
  useFrame(({ camera, size }, delta) => {
    if (!group.current) return
    // Bands are anchored to the zoom floor rather than fixed, so the whole cluster is up by the time zooming out
    // has bottomed out. Fixed numbers had the ring fade in at zoom 36 and below, which went invisible the moment
    // the desktop floor was raised past it. The fade spans 5 zoom units, so +12 above the floor is fully in by then.
    const floor = exploreMinZoom(size.width, size.height)
    const threshold = floor + (distance <= 1 ? 12 : distance === 2 ? 8 : 5)
    const wanted = mode === 'normal' ? MathUtils.clamp((threshold - camera.zoom) / 5, 0, 1) : 0
    opacity.current = MathUtils.damp(opacity.current, wanted, 7, delta)
    // meshes can still arrive after the layout effect ran (a suspended font resolves and mounts its text), so while
    // the room is mid-fade re-collect a few times a second — an opaque late mesh in a faded room is very visible
    recollectIn.current -= delta
    if (opacity.current > .01 && opacity.current < .99 && recollectIn.current <= 0) { recollectIn.current = .4; collect() }
    group.current.visible = opacity.current > .01
    group.current.scale.setScalar(.88 + opacity.current * .12)
    materials.current.forEach((material) => { material.opacity = opacity.current })
    // its real layout is fetched the first time the zoom-out actually reveals it, not on page load
    if (!requested.current && opacity.current > .02 && isEnterable(slot.handle)) {
      requested.current = true
      void fetchRoomBundle(slot.handle).then((found) => { if (found && mounted.current) setBundle(found) })
    }
  })
  return <group ref={group} position={slot.position} visible={false}
    onPointerOver={(event) => { if (opacity.current < .65) return; event.stopPropagation(); document.body.style.cursor = 'pointer' }}
    onPointerOut={() => { document.body.style.cursor = '' }}
    onClick={(event) => { if (opacity.current < .65 || pressWandered(event)) return; event.stopPropagation(); document.body.style.cursor = ''; open() }}>
    {/* its own boundary: a neighbour's font or texture must never suspend the live room out of view */}
    <Suspense fallback={null}>
      <NeighbourRoomProvider bundle={bundle}><NeighbourRoom /></NeighbourRoomProvider>
    </Suspense>
  </group>
}

function RoomWorld() {
  const initialHandle = useRef(currentRoomHandle() ?? LOBBY).current
  const [handles, setHandles] = useState(() => withVacancies([initialHandle]))
  const [activeHandle, setActiveHandle] = useState(initialHandle)
  const [focusRoom, setFocusRoom] = useState<{ position: [number, number, number]; token: number }>({ position: [0, 0, 0], token: 0 })
  const opening = useRef(false)
  useEffect(() => {
    let live = true
    void fetchRoomDirectory().then((found) => { if (live) setHandles(withVacancies([initialHandle, ...found.filter((handle) => handle !== initialHandle)])) })
    return () => { live = false }
  }, [initialHandle])
  // capture so the press is recorded before OrbitControls or a room handler sees the gesture
  useEffect(() => {
    const down = (event: PointerEvent) => { pressAt = { x: event.clientX, y: event.clientY } }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [])
  // Re-based so the room being viewed always sits at the world origin. Everything inside a room — the placement
  // grid, the character's pathfinding, every worldToGrid call — is written in room-local coordinates against
  // surfaces at the origin, so entering an offset neighbour put every click outside the 10x10 grid and the room
  // stopped responding. Translating the whole cluster instead keeps the neighbours' relative layout identical.
  const slots = useMemo(() => {
    const raw = roomSlots(handles)
    const origin = raw.find((slot) => slot.handle === activeHandle) ?? raw[0]
    if (!origin || (origin.a === 0 && origin.b === 0)) return raw
    return raw.map((slot) => {
      const a = slot.a - origin.a
      const b = slot.b - origin.b
      return { ...slot, a, b, position: cellPosition(a, b) }
    })
  }, [handles, activeHandle])
  const active = slots.find((slot) => slot.handle === activeHandle) ?? slots[0]
  const open = async (slot: RoomSlot) => {
    if (opening.current || !isEnterable(slot.handle)) return
    opening.current = true
    const entered = await enterRoom(slot.handle)
    opening.current = false
    if (!entered) return
    setActiveHandle(slot.handle)
    // the cluster re-bases onto the room just entered, so the view always settles on the origin
    setFocusRoom({ position: [0, 0, 0], token: performance.now() })
  }
  return <>
    {slots.filter((slot) => slot.handle !== active.handle).map((slot) => <RoomContainer key={slot.handle} slot={slot} distance={ringDistance(slot, active)} open={() => void open(slot)} />)}
    <group position={active.position}><RoomRoot /></group>
    <CameraController focusRoom={focusRoom} />
  </>
}

export default function Room() { return <Scene /> }
