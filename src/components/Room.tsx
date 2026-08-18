import { ContactShadows, OrthographicCamera } from '@react-three/drei'
import { Canvas, events, useFrame } from '@react-three/fiber'
import { type ReactNode, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type Group, type Material, MathUtils, type Mesh, Vector3 } from 'three'
import { NeighbourRoomProvider, useRoomStore } from '../store'
import { currentRoomHandle, enterRoom, fetchRoomBundle, fetchRoomDirectory, myHandle } from '../services/social'
import Bookshelf from './Bookshelf'
import Bed from './Bed'
import CameraController, { entryZoom, exploreMinZoom } from './CameraController'
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
// How much of the neighbourhood is actually built. Every slot used to mount a whole room — dozens of meshes each —
// whether or not it could reach the screen, so the cost tracked the size of the entire directory rather than the
// view: fifty rooms would have meant thousands of objects held in memory and walked every frame to build the
// render list, for three rooms' worth of picture. Two rings is eighteen neighbours, and the zoom floor fits about
// three rooms across, so what gets dropped was never close to the frame.
const VISIBLE_RINGS = 2

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

// The room you are standing in goes inert while the explorer is open, so browsing cannot walk its character or open
// its panels. Switching raycasting off for the whole subtree covers every handler inside it in one place. It suits
// the live room precisely because nothing there needs to be clickable — a NEIGHBOUR must stay hittable, or the
// click that selects it has nothing to land on, so read-only rooms hold their handlers back instead (see Floor,
// Interactive, Furniture and Character: each one bails before stopPropagation when the store is readOnly).
const NO_RAYCAST = () => {}
type Faded = Material & { wasTransparent?: boolean }
function Inert({ off, children }: { off: (zoom: number, width: number, height: number) => boolean; children: ReactNode }) {
  const group = useRef<Group>(null)
  const applied = useRef<boolean | null>(null)
  const refreshIn = useRef(0)
  useFrame(({ camera, size }, delta) => {
    const disabled = off(camera.zoom, size.width, size.height)
    refreshIn.current -= delta
    // meshes keep arriving after the first pass — a room's bundle lands, a suspended font resolves — and they
    // would come in hittable, so while disabled the subtree is swept again a couple of times a second
    if (disabled === applied.current && refreshIn.current > 0) return
    refreshIn.current = .4
    applied.current = disabled
    group.current?.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      if (disabled) mesh.raycast = NO_RAYCAST
      else delete (mesh as Partial<Mesh>).raycast
    })
  })
  return <group ref={group}>{children}</group>
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

function RoomContainer({ slot, distance, centred }: { slot: RoomSlot; distance: number; centred: boolean }) {
  const { mode } = useRoomStore()
  const group = useRef<Group>(null)
  const opacity = useRef(0)
  const materials = useRef<Faded[]>([])
  const recollectIn = useRef(0)
  const glow = useRef(0)
  const [bundle, setBundle] = useState<Record<string, string> | null>(null)
  const requested = useRef(false)
  const mounted = useRef(true)
  // set on the way in as well as cleared on the way out: StrictMode mounts, unmounts and remounts, and a
  // clear-only flag stays false through the remount, which silently blocked every bundle from ever landing
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const fadedOut = () => opacity.current < .65
  const collect = () => {
    materials.current = []
    group.current?.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      list.forEach((material) => {
        const faded = material as Faded
        // remember what it was, because the fade is only allowed to borrow the flag, not keep it
        if (faded.wasTransparent === undefined) faded.wasTransparent = faded.transparent
        materials.current.push(faded)
      })
    })
  }
  useLayoutEffect(collect, [bundle])
  useFrame(({ camera, size }, delta) => {
    if (!group.current) return
    // The ring belongs to the explorer, so it starts leaving the moment the zoom lifts off the floor at all rather
    // than holding on until the user is already well inside a room. The band is spent by the line where a zoom-in
    // counts as choosing a room, so the neighbours are gone before entry fires; outer rings clear sooner still,
    // which is what keeps the depth reading. Anchored to the floor rather than fixed, because a fixed number goes
    // invisible the moment the floor is raised past it.
    const floor = exploreMinZoom(size.width, size.height)
    const span = (entryZoom(size.width, size.height) - floor) * (distance <= 1 ? 1 : distance === 2 ? .7 : .5)
    const wanted = mode === 'normal' ? MathUtils.clamp(1 - (camera.zoom - floor) / span, 0, 1) : 0
    opacity.current = MathUtils.damp(opacity.current, wanted, 7, delta)
    // meshes can still arrive after the layout effect ran (a suspended font resolves and mounts its text), so while
    // the room is mid-fade re-collect a few times a second — an opaque late mesh in a faded room is very visible
    recollectIn.current -= delta
    if (opacity.current > .01 && opacity.current < .99 && recollectIn.current <= 0) { recollectIn.current = .4; collect() }
    group.current.visible = opacity.current > .01
    // A nudge in size is the whole highlight. The cluster is stacked by storey, so lifting or outlining the picked
    // room would fight that illusion, while 6% reads as hover without moving anything out of its own cell.
    glow.current = MathUtils.damp(glow.current, centred ? 1 : 0, 9, delta)
    group.current.scale.setScalar((.88 + opacity.current * .12) * (1 + glow.current * .06))
    // Once the room is all the way in, hand every material its own transparency back and pin opacity to exactly 1.
    // Holding them transparent forever put decals into the sorted transparent pass alongside the panel they sit
    // on — a few thousandths apart — and when the decal won that toss the panel behind it failed the depth test
    // and the wall showed through it. The profile board's stats read as wall-coloured because of it.
    const full = opacity.current > .995
    materials.current.forEach((material) => {
      material.transparent = full ? material.wasTransparent ?? false : true
      material.opacity = full ? 1 : opacity.current
    })
    // its real layout is fetched the first time the zoom-out actually reveals it, not on page load
    if (!requested.current && opacity.current > .02 && isEnterable(slot.handle)) {
      requested.current = true
      void fetchRoomBundle(slot.handle).then((found) => { if (found && mounted.current) setBundle(found) })
    }
  })
  return <group ref={group} position={slot.position} visible={false}>
    {/* its own boundary: a neighbour's font or texture must never suspend the live room out of view */}
    <Suspense fallback={null}>
      {/* three's raycaster tests layers only, never `visible`, so a faded-out neighbour still swallows the ray.
          That is what stopped a click on empty space from counting as a miss — and in edit mode, where every
          neighbour is faded to nothing, it stopped the click that finishes editing. Inert while faded, hittable
          once it has faded in, which is exactly when the click below is allowed to select the room anyway. */}
      <Inert off={fadedOut}><NeighbourRoomProvider bundle={bundle}><NeighbourRoom /></NeighbourRoomProvider></Inert>
    </Suspense>
  </group>
}

function RoomWorld() {
  const { mode } = useRoomStore()
  // The cluster is centred on the signed-in user's OWN room — it is their neighbourhood, so their room is the hub
  // the others ring around, whichever room they happen to be looking at. Signed out there is no own room, so the
  // room in the address (or the lobby) takes the middle instead.
  const hubHandle = useRef(myHandle() ?? currentRoomHandle() ?? LOBBY).current
  const [handles, setHandles] = useState(() => withVacancies([hubHandle]))
  // what is being VIEWED, which is not the hub while visiting someone else
  const [activeHandle, setActiveHandle] = useState(() => currentRoomHandle() ?? hubHandle)
  const [focusRoom, setFocusRoom] = useState<{ position: [number, number, number]; token: number; shift?: [number, number, number] }>({ position: [0, 0, 0], token: 0 })
  const opening = useRef(false)
  // which room is under the middle of the screen, and therefore the one a zoom-in would take the user into
  const [centredHandle, setCentredHandle] = useState<string | null>(null)
  const centred = useRef<string | null>(null)
  const probe = useRef(new Vector3()).current
  // the room chosen at the zoom floor, held until it has been entered
  const picked = useRef<RoomSlot | null>(null)
  // a mouse can hover, a finger cannot — read once, since a device does not grow one mid-session
  const fine = useRef(typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches)
  // starts true so the very first frame — which opens at the entry zoom already — is not read as a zoom-in
  const wasZoomedIn = useRef(true)
  useEffect(() => {
    let live = true
    void fetchRoomDirectory().then((found) => {
      if (!live) return
      const rest = found.filter((handle) => handle !== hubHandle)
      // the room actually being viewed needs a cell of its own even if the directory misses it
      const viewed = currentRoomHandle()
      if (viewed && viewed !== hubHandle && !rest.includes(viewed)) rest.unshift(viewed)
      setHandles(withVacancies([hubHandle, ...rest]))
    })
    return () => { live = false }
  }, [hubHandle])
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
  // the room underneath the explorer is scenery until it is entered: fully zoomed out, a click selects a room
  const exploring = (zoom: number, width: number, height: number) => mode === 'normal' && zoom <= exploreMinZoom(width, height) + .5
  const open = async (slot: RoomSlot) => {
    if (opening.current || !isEnterable(slot.handle)) return
    opening.current = true
    const entered = await enterRoom(slot.handle)
    opening.current = false
    if (!entered) return
    setActiveHandle(slot.handle)
    // The cluster re-bases onto the room just entered, so the view always settles on the origin. `shift` hands the
    // camera where that room WAS, so it can slide with the re-base instead of having the room yanked out from
    // under it — see the shift handling in CameraController.
    setFocusRoom({ position: [0, 0, 0], token: performance.now(), shift: slot.position })
  }
  useFrame(({ camera, pointer, size }) => {
    const floor = exploreMinZoom(size.width, size.height)
    const zoomedIn = mode !== 'normal' || camera.zoom > entryZoom(size.width, size.height)
    // The pick is decided at the zoom floor and then held. Recomputing it on the way in reads a screen that is
    // already moving — the aim below is pulling the chosen room to the middle — so under a mouse that has not
    // budged the room under the cursor changes and the choice flips out from under the user mid-zoom.
    if (mode === 'normal' && camera.zoom <= floor + .5) {
      // With a mouse, whatever is under the cursor is the choice: hover a room, zoom, land in it. Touch has no
      // hover to read — the last tap is stale by the time the pinch happens — so there the middle of the screen
      // is the crosshair, which is what panning aims anyway.
      const atX = fine.current ? pointer.x : 0
      const atY = fine.current ? pointer.y : 0
      // Projected rather than measured in world space: the cluster is stacked across storeys and panning slides
      // the target in the screen plane, so world distance disagrees with what is actually under the cursor.
      let pick: RoomSlot | null = null
      let best = Infinity
      for (const slot of slots) {
        if (slot.handle === active.handle || !isEnterable(slot.handle) || ringDistance(slot, active) > VISIBLE_RINGS) continue
        probe.set(slot.position[0], slot.position[1] + 3.5, slot.position[2]).project(camera)
        const offset = Math.hypot(probe.x - atX, probe.y - atY)
        if (offset < best) { best = offset; pick = slot }
      }
      // the room already being viewed competes too, and losing to it means nothing is picked — zooming back into
      // the room you are in should just re-centre it, which the camera already does on its own
      probe.set(active.position[0], active.position[1] + 3.5, active.position[2]).project(camera)
      if (Math.hypot(probe.x - atX, probe.y - atY) < best) pick = null
      picked.current = pick
    }
    // Held through the entry itself, and dropped the instant it is done. Dropping it as soon as the zoom-in starts
    // pointed the camera back at the room being left for the whole of a network round trip, so the user watched it
    // zoom toward the old room and then jump. Keeping it AFTER the entry is just as wrong the other way: the aim
    // stays clamped on a room that is no longer the one being viewed and the camera never comes free again.
    const handle = !zoomedIn || opening.current ? picked.current?.handle ?? null : null
    if (handle !== centred.current) { centred.current = handle; setCentredHandle(handle) }
    // the edge, not the state: entering is what crossing the line does, so it fires once per zoom-in
    if (zoomedIn && !wasZoomedIn.current && picked.current) void open(picked.current)
    wasZoomedIn.current = zoomedIn
    // spent once the room is in, so coming back down through the band does not re-light a stale choice
    if (zoomedIn && !opening.current) picked.current = null
  })
  // the picked room, or the one already being viewed when nothing is picked — what the camera should be aiming at
  const aim = useMemo(() => (slots.find((slot) => slot.handle === centredHandle) ?? active)?.position ?? null, [slots, active, centredHandle])
  return <>
    {slots.filter((slot) => slot.handle !== active.handle && isEnterable(slot.handle) && ringDistance(slot, active) <= VISIBLE_RINGS).map((slot) => <RoomContainer key={slot.handle} slot={slot} distance={ringDistance(slot, active)} centred={slot.handle === centredHandle} />)}
    <group position={active.position}><Inert off={exploring}><RoomRoot /></Inert></group>
    <CameraController focusRoom={focusRoom} aim={aim} />
  </>
}

export default function Room() { return <Scene /> }
