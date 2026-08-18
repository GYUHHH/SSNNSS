import { OrthographicCamera } from '@react-three/drei'
import { Canvas, events, useFrame, useThree } from '@react-three/fiber'
import { type ReactNode, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type AmbientLight, Color, type DirectionalLight, type Group, type Material, MathUtils, type Mesh, Vector3 } from 'three'
import { NeighbourRoomProvider, useRoomStore } from '../store'
import { currentRoomHandle, enterLobby, enterRoom, fetchRoomBundle, fetchRoomDirectory, isSignedIn, myHandle, subscribeRoomBundles } from '../services/social'
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
  day: { bg: '#f4efe6', ambient: 1.5, ambientColor: '#fff7ee', dir: 3.4, dirColor: '#fff3e2' },
  evening: { bg: '#e9d3bc', ambient: 0.95, ambientColor: '#ffc894', dir: 2.4, dirColor: '#ff9a5e' },
  night: { bg: '#232939', ambient: 0.36, ambientColor: '#8b97b8', dir: 0.5, dirColor: '#aab4d4' },
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

// The hour changes by GLIDING, not switching. Set as plain reactive props, a new time of day slammed the light
// values over in a single frame — so the lights live here behind refs, the JSX only ever carries the values from
// mount, and every change eases toward its target instead. The matching background glide is CSS on .canvas-host.
function CrossfadingLights({ preset }: { preset: typeof LIGHTING[keyof typeof LIGHTING] }) {
  const ambient = useRef<AmbientLight>(null)
  const dir = useRef<DirectionalLight>(null)
  const initial = useRef(preset).current
  const goal = useRef({ ambient: initial.ambient, dir: initial.dir, ambientColor: new Color(initial.ambientColor), dirColor: new Color(initial.dirColor) })
  useEffect(() => { goal.current = { ambient: preset.ambient, dir: preset.dir, ambientColor: new Color(preset.ambientColor), dirColor: new Color(preset.dirColor) } }, [preset])
  useFrame((_, delta) => {
    const step = Math.min(delta, 1 / 30)
    const blend = 1 - Math.exp(-6 * step)
    if (ambient.current) { ambient.current.intensity = MathUtils.damp(ambient.current.intensity, goal.current.ambient, 6, step); ambient.current.color.lerp(goal.current.ambientColor, blend) }
    if (dir.current) { dir.current.intensity = MathUtils.damp(dir.current.intensity, goal.current.dir, 6, step); dir.current.color.lerp(goal.current.dirColor, blend) }
  })
  return <>
    <ambientLight ref={ambient} intensity={initial.ambient} color={initial.ambientColor} />
    <directionalLight ref={dir} castShadow position={[6, 4.5, 2.5]} intensity={initial.dir} color={initial.dirColor} shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
  </>
}

// Idle power saver, second attempt — this one cannot touch animation speed. The loop still runs at the display's
// full rate: every useFrame callback, every clock and delta is exactly as before (the previous attempt drove the
// clock by hand and anything reading elapsed time ran wild). Only the final DRAW is skipped on alternate frames
// once the user has been hands-off for a second, which halves the GPU's work while idle; any input paints at
// full rate again on the very next frame. A positive-priority useFrame takes over rendering in R3F, so the skip
// is just "don't call render this frame".
function RenderGovernor() {
  const activeUntil = useRef(0)
  const skip = useRef(false)
  useEffect(() => {
    activeUntil.current = performance.now() + 3000 // full rate through boot, while everything is still settling
    const wake = () => { activeUntil.current = performance.now() + 1000 }
    const inputs = ['pointerdown', 'pointermove', 'wheel', 'touchstart', 'touchmove', 'keydown'] as const
    inputs.forEach((name) => window.addEventListener(name, wake, { passive: true }))
    return () => inputs.forEach((name) => window.removeEventListener(name, wake))
  }, [])
  useFrame(({ gl, scene, camera }) => {
    if (performance.now() >= activeUntil.current) {
      skip.current = !skip.current
      if (skip.current) return
    } else skip.current = false
    gl.render(scene, camera)
  }, 1)
  return null
}

function Scene() {
  const { clearSelection, mode, toggleEditMode, timeOfDay } = useRoomStore()
  const light = LIGHTING[timeOfDay]
  // Blending occlusion for wall videos: the canvas is transparent and drawn over the video DOM, punching a
  // depth-tested hole where a frame's screen is — furniture in front of the frame covers its video for real.
  // Scene events re-route to this host (with client coords) because the canvas itself is pointer-transparent
  // so clicks over a video can fall through into the iframe. The room background moves to the host's CSS.
  const eventHost = useRef<HTMLDivElement>(null!)
  return <div ref={eventHost} className="canvas-host" style={{ background: light.bg }}><Canvas dpr={[1, 2]} gl={{ antialias: true }} eventSource={eventHost} events={shiftAwareEvents} onPointerMissed={(event) => { if (!(event.target as HTMLElement)?.closest?.('.canvas-host')) return; (mode === 'edit' ? toggleEditMode : clearSelection)() }} camera={{ position: [10, 8.5, 10] }}>
    <OrthographicCamera makeDefault position={[10, 8.5, 10]} zoom={59} near={0.1} far={100} />
    <RenderGovernor />
    <CrossfadingLights preset={light} />
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

// Fully zoomed out a drag pans the explorer, and the browser still fires a click when the press ends — which
// would drop the user into whichever room happened to be under the pointer. So a room only counts as picked if
// the press that produced the click stayed put. One tracker for the whole cluster: the press belongs to the
// gesture, not to a room.
let pressAt: { x: number; y: number } | null = null
const pressWandered = (event: { clientX: number; clientY: number }) => !!pressAt && Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) > 6
// what a zoom-in may land in: real rooms always, and the lobby too for whoever has no room of their own —
// signed out, the default room is home, and home has to be somewhere you can go back to
const canEnter = (handle: string) => isEnterable(handle) || (handle === LOBBY && !isSignedIn())

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
type Faded = Material & { wasTransparent?: boolean; baseColor?: Color; lastTinted?: Color; color?: Color; map?: unknown }
// A neighbour wears its own hour, not the viewer's. The scene has one light rig — whichever preset the room being
// viewed runs — so another room's saved time of day cannot arrive as actual light. Instead each material's colour
// is multiplied by the ratio of the two presets' light: the numerator is the neighbour's own preset, the
// denominator cancels the viewer's rig back out. Both come from the same LIGHTING table the real rooms are lit
// with, nothing hand-picked — and because it is a ratio, a day room stays bright inside a night viewer's scene,
// where the denominator is small and the compensation brightens rather than darkens.
type TimeOfDay = keyof typeof LIGHTING
const TIMES = Object.keys(LIGHTING) as TimeOfDay[]
// a preset's light on a mostly-diffuse material: full ambient plus about half the directional (average incidence)
const lightEnergy = (time: TimeOfDay) => {
  const preset = LIGHTING[time]
  return new Color(preset.ambientColor).multiplyScalar(preset.ambient)
    .add(new Color(preset.dirColor).multiplyScalar(preset.dir * .5))
}
// Raised to a soft power rather than used raw: the full ratio between day and night is a factor of eight, which
// crushed night rooms nearly black and blew day rooms out. 0.6 keeps the direction and hue of the correction while
// pulling both extremes toward one — the cast is still unmistakably morning or midnight, just not punishing.
const SOFTEN = .6
const NEIGHBOUR_TINT = Object.fromEntries(TIMES.map((room) => [room, Object.fromEntries(TIMES.map((viewer) => {
  const target = lightEnergy(room)
  const current = lightEnergy(viewer)
  return [viewer, new Color(Math.pow(target.r / current.r, SOFTEN), Math.pow(target.g / current.g, SOFTEN), Math.pow(target.b / current.b, SOFTEN))]
}))])) as Record<TimeOfDay, Record<TimeOfDay, Color>>
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
  const { currentHandle } = useRoomStore()
  return <>
    <Floor /><Walls /><Bookshelf /><Desk /><Chair /><Computer /><Cup /><Sofa /><Bed /><Decor /><InventoryFurniture /><InventoryPreview /><SurfaceDropZones /><Character key={currentHandle ?? 'lobby'} /><DebugAnchors /><WallVideoLayer /><ReactionBadges />
  </>
}

// A neighbour is the real room: the same components the live room is built from, driven by that room's own
// published bundle. Left out on purpose — WallVideoLayer (an iframe per frame, six rooms deep), ReactionBadges
// (DOM badges that cannot fade with the room), the edit-mode-only layers, and ContactShadows (a shadow pass each).
function NeighbourRoom() {
  return <><Floor /><Walls /><Bookshelf /><Desk /><Chair /><Computer /><Cup /><Sofa /><Bed /><Decor /><InventoryFurniture /><Character /></>
}

function RoomContainer({ slot, distance, centred, fresh, open }: { slot: RoomSlot; distance: number; centred: boolean; fresh?: Record<string, string>; open: () => void }) {
  // the live store on purpose: the viewer's own time of day is the light rig this room must compensate away
  const { mode, timeOfDay } = useRoomStore()
  const { gl, camera, scene } = useThree()
  const group = useRef<Group>(null)
  const opacity = useRef(0)
  const materials = useRef<Faded[]>([])
  const glow = useRef(0)
  // The lobby — the default room a signed-out visitor starts in — has no server bundle to wait for: an empty
  // bundle IS its look. Without this the cell went permanently blank the moment such a visitor entered a real
  // room, because the room they had just come from could never be drawn as a neighbour.
  const [bundle, setBundle] = useState<Record<string, string> | null>(slot.handle === LOBBY ? {} : null)
  // that room's saved hour, read straight off the bundle (stored as the bare word: 'day' | 'evening' | 'night')
  const bundleTime = useRef('day')
  useEffect(() => { bundleTime.current = bundle?.['my-room-time-v1'] ?? 'day' }, [bundle])
  const nextFetch = useRef(0)
  const lastRaw = useRef('')
  const mounted = useRef(true)
  // a pushed update from the live stream lands exactly like a fetched one, dedupe included
  useEffect(() => {
    if (!fresh) return
    const raw = JSON.stringify(fresh)
    if (raw === lastRaw.current) return
    lastRaw.current = raw
    setBundle(fresh)
  }, [fresh])
  // set on the way in as well as cleared on the way out: StrictMode mounts, unmounts and remounts, and a
  // clear-only flag stays false through the remount, which silently blocked every bundle from ever landing
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const fadedOut = () => opacity.current < .65
  // Shaders are compiled the first time a mesh is actually DRAWN, and until the zoom-out reveals it a neighbour
  // is never drawn — so the reveal itself paid for several rooms' worth of program compilation at once, and the
  // gather from the entry line to the floor stuttered through it. Compiling in the background as soon as the
  // room's content mounts moves that cost to a moment when nothing on screen depends on this room; twice, since
  // suspended pieces (fonts, textures) mount after the first pass, and re-compiling what is already compiled
  // costs nothing.
  useEffect(() => {
    if (!bundle || !group.current) return
    const warm = () => { if (group.current) void gl.compileAsync(group.current, camera, scene).catch(() => {}) }
    const first = setTimeout(warm, 300)
    const second = setTimeout(warm, 2000)
    return () => { clearTimeout(first); clearTimeout(second) }
  }, [bundle, camera, gl, scene])
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
    // The room being zoomed INTO is exempt from the ring's fade-out: it is the destination, and fading it away
    // mid-approach blanked the very room the user was entering, which then popped back as the live room — the
    // colour flicker on every entry. It holds full strength until the live room takes its place; everyone else
    // in the ring still clears out on the way in.
    const wanted = mode !== 'normal' ? 0 : centred ? 1 : MathUtils.clamp(1 - (camera.zoom - floor) / span, 0, 1)
    // The frame a room is first drawn tends to hitch — texture uploads land right then — and the long delta of
    // that one frame used to advance the damp nearly to 1, so the room POPPED instead of fading. Capping the step
    // means a hitch only moves the fade one small notch, and the glide plays out over the frames that follow.
    opacity.current = MathUtils.damp(opacity.current, wanted, 12, Math.min(delta, 1 / 30))
    // Materials keep arriving after the layout effect ran — a suspended font resolves, and a photo or thumbnail
    // texture finishing its load SWAPS IN a whole new material. A newcomer the loop below doesn't know about is
    // drawn at its natural full opacity, which against a half-faded room reads as the photo popping in — and on
    // the way out, popping off. So while the room is mid-fade the collection is rebuilt every frame: the traverse
    // is a few hundred objects and the fade lasts under a second, and it guarantees a material's very first drawn
    // frame already carries the room's opacity.
    if (opacity.current > .01 && opacity.current < .995) collect()
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
    const tint = (NEIGHBOUR_TINT[bundleTime.current as TimeOfDay] ?? NEIGHBOUR_TINT.day)[timeOfDay]
    // Anything carrying an image — a profile photo, a video thumbnail, a framed picture — is CONTENT, not part of
    // the room's fabric, and it has to stay readable whatever hour either room is set to. Those materials get the
    // day correction instead: their own room's cast is skipped and the viewer's rig is still cancelled out, so a
    // photo reads at full daylight brightness inside a midnight room.
    const photoTint = NEIGHBOUR_TINT.day[timeOfDay]
    materials.current.forEach((material) => {
      material.transparent = full ? material.wasTransparent ?? false : true
      // trim bars ride the cube of the fade: still smooth, but they only surface once the room is nearly whole,
      // instead of floating over the ghosted room as three hard dark bars for the entire glide
      material.opacity = full ? 1 : material.userData.lateFade ? opacity.current ** 7 : opacity.current
      if (!material.color) return
      // The cast multiplies into the material's colour every frame, so the untouched colour has to live beside it —
      // and it must never be frozen at whatever the first frame held. A neighbour's real wall and floor colours
      // only arrive with the bundle, after mount, and freezing the base at capture time stomped them flat on the
      // next frame. So: any colour that is not the one this loop last wrote was changed from outside — a style
      // landing, a lamp toggling — and becomes the new base. Everything recolourable stays recolourable.
      if (!material.baseColor) material.baseColor = material.color.clone()
      else if (!material.lastTinted || !material.color.equals(material.lastTinted)) material.baseColor.copy(material.color)
      material.color.copy(material.baseColor).multiply(material.map ? photoTint : tint)
      material.lastTinted = (material.lastTinted ?? new Color()).copy(material.color)
    })
    // Fetched when the zoom-out first reveals it, and refreshed every so often for as long as it stays on
    // screen — a one-shot fetch froze the neighbour at its first snapshot, so an owner moving their character
    // never showed up out here until a full reload. Unchanged payloads are dropped before setState, so the
    // steady case re-renders nothing.
    if (opacity.current > .02 && isEnterable(slot.handle) && performance.now() > nextFetch.current) {
      nextFetch.current = performance.now() + 15_000
      void fetchRoomBundle(slot.handle).then((found) => {
        if (!found || !mounted.current) return
        const raw = JSON.stringify(found)
        if (raw === lastRaw.current) return
        lastRaw.current = raw
        setBundle(found)
      })
    }
  })
  return <group ref={group} position={slot.position} visible={false}
    onClick={(event) => { if (opacity.current < .65 || pressWandered(event)) return; event.stopPropagation(); open() }}>
    {/* its own boundary: a neighbour's font or texture must never suspend the live room out of view */}
    <Suspense fallback={null}>
      {/* Nothing is drawn until the room's own layout is in hand: rendering the provider with a null bundle
          shows the DEFAULT room, and a stranger's cell flashing the starter layout before flipping to the real
          one read as broken. With bundles prefetched at directory load the gap is rarely even visible. */}
      {bundle === null ? null : <>
      {/* three's raycaster tests layers only, never `visible`, so a faded-out neighbour still swallows the ray.
          That is what stopped a click on empty space from counting as a miss — and in edit mode, where every
          neighbour is faded to nothing, it stopped the click that finishes editing. Inert while faded, hittable
          once it has faded in, which is exactly when the click below is allowed to select the room anyway. */}
      <Inert off={fadedOut}><NeighbourRoomProvider bundle={bundle}><NeighbourRoom /></NeighbourRoomProvider></Inert>
      </>}
    </Suspense>
  </group>
}

function RoomWorld() {
  const { mode } = useRoomStore()
  // The cluster is centred on the signed-in user's OWN room — it is their neighbourhood, so their room is the hub
  // the others ring around, whichever room they happen to be looking at. Signed out there is no own room, so the
  // room in the address (or the lobby) takes the middle instead.
  // Signed out, the hub is ALWAYS the lobby — even when the address opens straight into someone's room. Taking
  // the visited room as hub there meant a refresh mid-visit dropped the default room out of the cluster entirely,
  // and with it the only way back to where the visitor started.
  const hubHandle = useRef(myHandle() ?? (isSignedIn() ? currentRoomHandle() : null) ?? LOBBY).current
  const [handles, setHandles] = useState(() => withVacancies([hubHandle]))
  // bundles pushed by the realtime stream, keyed by handle — each RoomContainer picks up its own
  const [freshBundles, setFreshBundles] = useState<Record<string, Record<string, string>>>({})
  useEffect(() => subscribeRoomBundles(handles.filter(isEnterable), (handle, data) => setFreshBundles((prev) => ({ ...prev, [handle]: data }))), [handles])
  // Capture-phase so the press lands before OrbitControls or any room handler sees the gesture. Touchstart is
  // tracked as well, because the mobile double-tap drag-zoom preventDefaults its second tap — that suppresses the
  // derived pointerdown, so pressAt still held the FIRST tap's spot and the drag's release read as an unmoved
  // click, dropping the user into whatever room was under the finger. The window capture runs before the zoom
  // handler's preventDefault, so the second tap is recorded either way and the 6px rule covers both taps.
  useEffect(() => {
    const down = (event: PointerEvent) => { pressAt = { x: event.clientX, y: event.clientY } }
    const touch = (event: TouchEvent) => { const t = event.touches[0]; if (t) pressAt = { x: t.clientX, y: t.clientY } }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('touchstart', touch, true)
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('touchstart', touch, true) }
  }, [])
  // What is being VIEWED — not the hub while visiting someone else. Derived from the STORE's own commit rather
  // than kept as separate state here: the store lives on the DOM root and this world on the canvas root, and two
  // roots may paint their commits apart — with separate state, one frame could show the new room's data still
  // standing in the old room's cell (the flash every entry had). Reading the handle out of the same context value
  // that carries the data makes the re-base and the content swap indivisible.
  const { currentHandle } = useRoomStore()
  const activeHandle = currentHandle ?? hubHandle
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
  // whether the cursor is currently the pointer, so the style is only written when it flips
  const cursorOn = useRef(false)
  // starts true so the very first frame — which opens at the entry zoom already — is not read as a zoom-in
  const wasZoomedIn = useRef(true)
  // set the moment ANY entry starts, re-armed only once the camera is back out at the explorer. The camera's own
  // entry zoom crosses the entry line like a user's would, and without this latch that crossing fired a SECOND
  // entry into whatever was picked at the time — on touch, the middle-of-screen room, so a tapped outer room
  // flashed up and then bounced to the centre one.
  const entryLatched = useRef(false)
  useEffect(() => {
    let live = true
    void fetchRoomDirectory().then((found) => {
      if (!live) return
      const rest = found.filter((handle) => handle !== hubHandle)
      // the room actually being viewed needs a cell of its own even if the directory misses it
      const viewed = currentRoomHandle()
      if (viewed && viewed !== hubHandle && !rest.includes(viewed)) rest.unshift(viewed)
      setHandles(withVacancies([hubHandle, ...rest]))
      // warm every bundle now, while the user is still looking at their own room — by the time they zoom out,
      // the layouts are already here and each neighbour appears as itself rather than as the default room first
      rest.filter(isEnterable).forEach((handle) => void fetchRoomBundle(handle))
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
  // The swap happens HERE, inside enterRoom's own listener pass, not after the await in open(). Doing it after
  // put the new room's data and the re-base in different render batches: for one frame the freshly-hydrated live
  // room was drawn at the OLD room's cell while the entered room's neighbour copy still stood in its own — the
  // The camera compensation for a re-base. Runs as a LAYOUT effect in the same pre-paint window as the re-base
  // commit itself: the setFocusRoom here flushes synchronously, CameraController's own layout effect applies the
  // slide, and only then does the browser paint — one frame, everything moved together. `shift` is the entered
  // room's position in the PREVIOUS layout, read from a snapshot taken before this render's slots replaced it.
  const lastHandle = useRef(activeHandle)
  const previousSlots = useRef(slots)
  useLayoutEffect(() => {
    const wasAt = previousSlots.current
    previousSlots.current = slots
    if (activeHandle === lastHandle.current) return
    const slot = wasAt.find((value) => value.handle === activeHandle)
    lastHandle.current = activeHandle
    setFocusRoom({ position: [0, 0, 0], token: performance.now(), shift: slot?.position })
  }, [activeHandle, slots])
  const open = async (slot: RoomSlot) => {
    if (opening.current || !canEnter(slot.handle)) return
    entryLatched.current = true
    // the clicked room becomes the pick, so the highlight and the fade exemption follow the room actually entered
    picked.current = slot
    // the lobby is not on the server — going back to it is a local reset that walks the same listener path
    if (slot.handle === LOBBY) { enterLobby(); return }
    opening.current = true
    await enterRoom(slot.handle)
    opening.current = false
  }
  useFrame(({ camera, pointer, size }) => {
    const floor = exploreMinZoom(size.width, size.height)
    const zoomedIn = mode !== 'normal' || camera.zoom > entryZoom(size.width, size.height)
    // The pick is decided at the zoom floor and then held. Recomputing it on the way in reads a screen that is
    // already moving — the aim below is pulling the chosen room to the middle — so under a mouse that has not
    // budged the room under the cursor changes and the choice flips out from under the user mid-zoom.
    // The pick keeps updating through the first half of the transit band — the user can still steer onto a
    // different room while the fade has already begun — and only freezes for the short stretch before the entry
    // line, which is what keeps the choice from flapping while the camera is actively pulling it to the middle.
    if (mode === 'normal' && camera.zoom <= (floor + entryZoom(size.width, size.height)) / 2) {
      // Measured in pixels off a projected centre rather than in world space: the cluster is stacked across storeys
      // and panning slides the target in the screen plane, so world distance disagrees with what is on screen. The
      // room already being viewed competes as well, and its winning means nothing is picked — zooming back into the
      // room you are in should just re-centre it, which the camera already does on its own.
      const halfW = size.width / 2
      const halfH = size.height / 2
      const nearest = (atX: number, atY: number) => {
        let best = Infinity
        let winner: RoomSlot | null = null
        for (const slot of slots) {
          if (slot !== active && (!canEnter(slot.handle) || ringDistance(slot, active) > VISIBLE_RINGS)) continue
          probe.set(slot.position[0], slot.position[1] + 3.5, slot.position[2]).project(camera)
          const offset = Math.hypot((probe.x - atX) * halfW, (probe.y - atY) * halfH)
          if (offset < best) { best = offset; winner = slot }
        }
        return { slot: winner === active ? null : winner, offset: best }
      }
      // Both readings are live on a desktop, and the mouse only takes over where it is actually resting on a room —
      // a room projects to a 200px box at zoom 20.2, so half of one is 4.95 pixels per unit of zoom. Off the rooms,
      // or on a touch screen where the last tap is long stale, the middle of the screen is the crosshair.
      const hover = fine.current ? nearest(pointer.x, pointer.y) : null
      const overRoom = hover !== null && hover.offset <= camera.zoom * 4.95
      // With a mouse the cursor is the whole story: on a room means that room, off every room means no pick at
      // all — zooming in just returns to the room being viewed. The middle-of-screen crosshair is for touch,
      // which has no cursor to read.
      picked.current = fine.current ? (overRoom ? hover.slot : null) : nearest(0, 0).slot
      // the mouse resting on an enterable room is an invitation, and the cursor says so
      const wanted = overRoom && hover.slot !== null
      if (wanted !== cursorOn.current) { cursorOn.current = wanted; document.body.style.cursor = wanted ? 'pointer' : '' }
    } else if (cursorOn.current) { cursorOn.current = false; document.body.style.cursor = '' }
    // Held through the entry itself, and dropped the instant it is done. Dropping it as soon as the zoom-in starts
    // pointed the camera back at the room being left for the whole of a network round trip, so the user watched it
    // zoom toward the old room and then jump. Keeping it AFTER the entry is just as wrong the other way: the aim
    // stays clamped on a room that is no longer the one being viewed and the camera never comes free again.
    const handle = !zoomedIn || opening.current ? picked.current?.handle ?? null : null
    if (handle !== centred.current) { centred.current = handle; setCentredHandle(handle) }
    // the edge, not the state: entering is what crossing the line does, so it fires once per zoom-in — and only
    // when no entry is already underway (the latch covers the camera's own entry zoom crossing this same line)
    if (zoomedIn && !wasZoomedIn.current && picked.current && !entryLatched.current) void open(picked.current)
    wasZoomedIn.current = zoomedIn
    if (!zoomedIn) entryLatched.current = false
    // spent once the room is in, so coming back down through the band does not re-light a stale choice
    if (zoomedIn && !opening.current) picked.current = null
  })
  // the picked room, or the one already being viewed when nothing is picked — what the camera should be aiming at
  const aim = useMemo(() => (slots.find((slot) => slot.handle === centredHandle) ?? active)?.position ?? null, [slots, active, centredHandle])
  return <>
    {slots.filter((slot) => slot.handle !== active.handle && (isEnterable(slot.handle) || slot.handle === LOBBY) && ringDistance(slot, active) <= VISIBLE_RINGS).map((slot) => <RoomContainer key={slot.handle} slot={slot} distance={ringDistance(slot, active)} centred={slot.handle === centredHandle} fresh={freshBundles[slot.handle]} open={() => void open(slot)} />)}
    <group position={active.position}><Inert off={exploring}><RoomRoot /></Inert></group>
    <CameraController focusRoom={focusRoom} aim={aim} />
  </>
}

export default function Room() { return <Scene /> }
