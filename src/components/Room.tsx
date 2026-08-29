import { OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { Canvas, events, useFrame, useThree } from '@react-three/fiber'
import { type ReactNode, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type AmbientLight, Color, type DirectionalLight, type Group, type Material, MathUtils, type Mesh, Vector3 } from 'three'
import { baseFloorCells, isFloorCovering, NeighbourRoomProvider, useRoomStore } from '../store'
import { currentRoomHandle, enterLobby, enterRoom, fetchRoomBundle, fetchRoomDirectory, isSignedIn, isVisiting, myHandle, subscribeRoomBundles, updateVisitorPresence } from '../services/social'
import { snapshotActiveFrames } from '../services/ytResume'
import { type ExplorerMode, explorerMode, fetchFollowing, onExplorerMode, onFollowsChange, rememberModeRoom, sortByActivity } from '../services/follows'
import { captureRenderScale, flushCapture } from '../services/capture'
import { explorerAnimationsAreMoving, keepExplorerAnimationsSmooth, setRoomFrameRendered } from '../services/renderSync'
import Bookshelf from './Bookshelf'
import Bed from './Bed'
import CameraController, { armZoomGestureClickGuard, consumeZoomGestureClick, DEFAULT_CAMERA_POSITION, entryZoom, exploreMinZoom } from './CameraController'
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
import { characterFacing, characterPosition } from '../services/characterTracker'
import { cancelVisitorAction, presenceSessionId, useVisitors, visitorFacing, visitorInteractionTarget, visitorMoveTarget, visitorPosition, visitorState } from '../services/presence'
import { setFirstPerson, useFirstPerson } from '../services/viewMode'
import { floorWalkRoute } from '../services/roomGrid'
import { resolveInteraction, stateForInteraction } from '../services/interactionAnchors'

// per-time-of-day lighting: night keeps lights low so lit lamps visibly carry the room
const LIGHTING = {
  day: { bg: '#f4f4f2', ambient: 1.5, ambientColor: '#ffffff', dir: 3.4, dirColor: '#fffefa' },
  evening: { bg: '#e9d3bc', ambient: 0.95, ambientColor: '#ffc894', dir: 2.4, dirColor: '#ff9a5e' },
  night: { bg: '#232939', ambient: 0.5, ambientColor: '#8b97b8', dir: 0.7, dirColor: '#aab4d4' },
} as const
const SHADOW_LIGHT_BRIGHTNESS = .8
type TimeOfDay = keyof typeof LIGHTING
const TIME_LAYER: Record<TimeOfDay, number> = { day: 1, evening: 2, night: 3 }
// Draw the hovered room once more after the cluster so neighbouring walls and props can never cover it.
// Separate layers preserve that room's own day/evening/night lighting in the foreground pass.
const HOVER_LAYER: Record<TimeOfDay, number> = { day: 4, evening: 5, night: 6 }
const EXPLORER_LAYER_MASK = (1 << 7) - 1
let hoverLayerMask = 0
// RoomContainer callbacks run before RenderGovernor (priority 0 vs 1), so visible neighbour rooms can cheaply
// publish the time layers needed by this frame. Rendering an unused layer still walks the whole scene graph.
let activeTimeLayerMask = 0
// The idle governor must not deliberately throw away every other draw while the explorer camera or room opacity
// is still moving. This is only a short hold renewed by real motion; once everything settles, idle saving resumes.

// compileAsync is expensive when several newly-mounted rooms start it together. Keep the existing two warm-up
// passes, but let only one room compile at a time so explorer entry does not inherit a burst of concurrent work.
let roomCompileQueue = Promise.resolve()
const queueRoomCompile = (compile: () => Promise<unknown>) => {
  roomCompileQueue = roomCompileQueue.catch(() => {}).then(compile).then(() => {})
}

// Pointer coords are computed from the canvas's LIVE on-screen rect — the scene slides 240px left while a
// panel is open, and the default client-coordinate mapping would leave every click/hover offset by that shift.
const shiftAwareEvents: NonNullable<Parameters<typeof Canvas>[0]['events']> = (store) => ({
  ...events(store),
  compute(event, state) {
    const rect = state.gl.domElement.getBoundingClientRect()
    state.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    state.raycaster.layers.mask = EXPLORER_LAYER_MASK
    state.raycaster.setFromCamera(state.pointer, state.camera)
  },
})

// The hour changes by GLIDING, not switching. Set as plain reactive props, a new time of day slammed the light
// values over in a single frame — so the lights live here behind refs, the JSX only ever carries the values from
// mount, and every change eases toward its target instead. The matching background glide is CSS on .canvas-host.
function CrossfadingLights({ preset }: { preset: typeof LIGHTING[keyof typeof LIGHTING] }) {
  const { gl } = useThree()
  const { currentHandle } = useRoomStore()
  const ambient = useRef<AmbientLight>(null)
  const dir = useRef<DirectionalLight>(null)
  const initial = useRef(preset).current
  const goal = useRef({ ambient: initial.ambient, dir: initial.dir * SHADOW_LIGHT_BRIGHTNESS, ambientColor: new Color(initial.ambientColor), dirColor: new Color(initial.dirColor) })
  const wasZoomedIn = useRef<boolean | null>(null)
  const shadowRefreshAt = useRef(performance.now() + 300)
  useEffect(() => { goal.current = { ambient: preset.ambient, dir: preset.dir * SHADOW_LIGHT_BRIGHTNESS, ambientColor: new Color(preset.ambientColor), dirColor: new Color(preset.dirColor) } }, [preset])
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    shadowRefreshAt.current = performance.now() + 300
    return () => { gl.shadowMap.autoUpdate = true }
  }, [gl])
  useEffect(() => { shadowRefreshAt.current = performance.now() + 300 }, [currentHandle])
  useFrame(({ camera, size }, delta) => {
    const step = Math.min(delta, 1 / 30)
    const blend = 1 - Math.exp(-6 * step)
    if (ambient.current) { ambient.current.intensity = MathUtils.damp(ambient.current.intensity, goal.current.ambient, 6, step); ambient.current.color.lerp(goal.current.ambientColor, blend) }
    if (dir.current) { dir.current.intensity = MathUtils.damp(dir.current.intensity, goal.current.dir, 6, step); dir.current.color.lerp(goal.current.dirColor, blend) }
    // 탐색기의 이웃 방들은 그림자 없는 시간대 광원으로 그려진다 — 줌아웃하면 내 방 그림자도 꺼서 모든 방을 통일.
    // 스위치로 끄면 문턱에서 뚝 사라져서, shadow.intensity를 감쇠시켜 방이 모이고 흩어지는 동안 페이드시킨다.
    // castShadow는 완전히 사라진 뒤에만 꺼서 그림자 패스 비용도 같이 없앤다.
    if (dir.current) {
      const zoomedIn = camera.zoom > entryZoom(size.width, size.height)
      dir.current.shadow.intensity = MathUtils.damp(dir.current.shadow.intensity, zoomedIn ? .4 : 0, 6, step)
      dir.current.castShadow = dir.current.shadow.intensity > .01
      if (zoomedIn && wasZoomedIn.current === false) shadowRefreshAt.current = performance.now() + 120
      wasZoomedIn.current = zoomedIn
      if (zoomedIn && performance.now() >= shadowRefreshAt.current) {
        gl.shadowMap.needsUpdate = true
        shadowRefreshAt.current = Infinity
      }
    }
  })
  return <>
    <ambientLight ref={ambient} intensity={initial.ambient} color={initial.ambientColor} />
    <directionalLight ref={dir} castShadow position={[5, 12, 0]} intensity={initial.dir * SHADOW_LIGHT_BRIGHTNESS} color={initial.dirColor} shadow-mapSize-width={512} shadow-mapSize-height={512} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
  </>
}

function TimeLayerLights({ time }: { time: TimeOfDay }) {
  const ambient = useRef<AmbientLight>(null)
  const dir = useRef<DirectionalLight>(null)
  const preset = LIGHTING[time]
  const layer = TIME_LAYER[time]
  useLayoutEffect(() => {
    ambient.current?.layers.set(layer); ambient.current?.layers.enable(HOVER_LAYER[time])
    dir.current?.layers.set(layer)
  }, [layer, time])
  return <><ambientLight ref={ambient} intensity={preset.ambient} color={preset.ambientColor} /><directionalLight ref={dir} position={[4, 6.5, 2]} intensity={preset.dir} color={preset.dirColor} /></>
}

// Hovered rooms are rendered once more after the cluster so they stay in front. That foreground pass needs its
// own shadow-casting light; reusing the unshadowed time-layer light made the second copy cover the original room
// and visually erase every shadow. Only the one active hover layer is rendered, so this adds no steady room cost.
function HoverLayerLight({ time }: { time: TimeOfDay }) {
  const dir = useRef<DirectionalLight>(null)
  const preset = LIGHTING[time]
  useLayoutEffect(() => { dir.current?.layers.set(HOVER_LAYER[time]) }, [time])
  return <directionalLight ref={dir} position={[4, 6.5, 2]} intensity={preset.dir} color={preset.dirColor} />
}

// 전체보기에서 쓰는 픽셀 비율 상한 — 작은 화면에서 글자가 뭉개지지 않게 터치 기기만 조금 높인다.
const EXPLORE_DPR = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 1.25 : 1

// Idle power saver, second attempt — this one cannot touch animation speed. The loop still runs at the display's
// full rate: every useFrame callback, every clock and delta is exactly as before (the previous attempt drove the
// clock by hand and anything reading elapsed time ran wild). Only the final DRAW is skipped on alternate frames
// once the user has been hands-off for a second, which halves the GPU's work while idle; any input paints at
// full rate again on the very next frame. A positive-priority useFrame takes over rendering in R3F, so the skip
// is just "don't call render this frame".
function RenderGovernor() {
  const { characterState } = useRoomStore()
  // 전체보기는 방을 작게 그리면서 시간대 레이어까지 여러 번 그린다 — 그 구간만 픽셀 비율을 낮춰 필레이트를 아낀다.
  // 진입선 바로 위아래에서 휠을 흔들면 드로잉 버퍼가 매 프레임 재할당되므로 복귀선은 8% 위에 둔다.
  const baseDpr = useThree((state) => state.viewport.dpr)
  const lowDpr = useRef(false)
  const activeUntil = useRef(0)
  const skip = useRef(false)
  const lastCamera = useRef({ x: NaN, y: NaN, z: NaN, qx: NaN, qy: NaN, qz: NaN, qw: NaN, zoom: NaN })
  useEffect(() => {
    activeUntil.current = performance.now() + 3000 // full rate through boot, while everything is still settling
    const wake = () => { activeUntil.current = performance.now() + 1000 }
    const inputs = ['pointerdown', 'pointermove', 'wheel', 'touchstart', 'touchmove', 'keydown'] as const
    inputs.forEach((name) => window.addEventListener(name, wake, { passive: true }))
    return () => inputs.forEach((name) => window.removeEventListener(name, wake))
  }, [])
  useFrame(({ gl, scene, camera, size }) => {
    setRoomFrameRendered(false)
    const timeLayers = activeTimeLayerMask
    activeTimeLayerMask = 0
    const now = performance.now()
    const previous = lastCamera.current
    const cameraMoving = !Number.isFinite(previous.zoom)
      || Math.abs(camera.zoom - previous.zoom) > .001
      || Math.abs(camera.position.x - previous.x) + Math.abs(camera.position.y - previous.y) + Math.abs(camera.position.z - previous.z) > .001
      || 1 - Math.abs(camera.quaternion.x * previous.qx + camera.quaternion.y * previous.qy + camera.quaternion.z * previous.qz + camera.quaternion.w * previous.qw) > .000001
    if (cameraMoving) keepExplorerAnimationsSmooth()
    lastCamera.current = { x: camera.position.x, y: camera.position.y, z: camera.position.z, qx: camera.quaternion.x, qy: camera.quaternion.y, qz: camera.quaternion.z, qw: camera.quaternion.w, zoom: camera.zoom }
    const characterMoving = characterState === 'walking' || characterState === 'aligning'
    if (!characterMoving && now >= activeUntil.current && !explorerAnimationsAreMoving()) {
      skip.current = !skip.current
      if (skip.current) return
    } else skip.current = false
    const captureScale = captureRenderScale()
    const entryLine = entryZoom(size.width, size.height)
    // 대기 중인 방 캡처가 있는 프레임은 원래 해상도로 — 썸네일이 절반 해상도로 찍히면 안 된다
    lowDpr.current = captureScale <= 1 && camera.zoom <= (lowDpr.current ? entryLine * 1.08 : entryLine)
    const wantedDpr = lowDpr.current ? Math.min(baseDpr, EXPLORE_DPR) : baseDpr
    if (gl.getPixelRatio() !== wantedDpr) gl.setPixelRatio(wantedDpr)
    const originalDpr = gl.getPixelRatio()
    const captureDpr = Math.min(originalDpr * captureScale, 4096 / Math.max(size.width, size.height), gl.capabilities.maxTextureSize / Math.max(size.width, size.height))
    if (captureDpr > originalDpr) gl.setPixelRatio(captureDpr)
    const originalAutoClear = gl.autoClear
    camera.layers.set(0)
    gl.autoClear = true
    gl.render(scene, camera)
    if (camera.zoom <= entryZoom(size.width, size.height)) {
      gl.autoClear = false
      Object.values(TIME_LAYER).forEach((layer) => {
        if (!(timeLayers & (1 << layer))) return
        camera.layers.set(layer)
        gl.render(scene, camera)
      })
      if (hoverLayerMask) {
        gl.clearDepth()
        camera.layers.mask = hoverLayerMask
        gl.render(scene, camera)
      }
    }
    gl.autoClear = originalAutoClear
    camera.layers.mask = EXPLORER_LAYER_MASK
    // a pending room capture copies the pixels NOW, while this frame's drawing buffer is still intact
    flushCapture(gl.domElement)
    if (captureDpr > originalDpr) gl.setPixelRatio(originalDpr)
    setRoomFrameRendered(true)
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
  const firstPerson = useFirstPerson()
  useEffect(() => { if (mode === 'edit') setFirstPerson(false) }, [mode])
  return <div ref={eventHost} className="canvas-host" style={{ background: light.bg, touchAction: firstPerson ? 'none' : undefined }}><Canvas shadows="soft" dpr={[1, 2]} gl={{ antialias: true }} eventSource={eventHost} events={shiftAwareEvents} onPointerMissed={(event) => { if (!(event.target as HTMLElement)?.closest?.('.canvas-host')) return; (mode === 'edit' ? toggleEditMode : clearSelection)() }} camera={{ position: DEFAULT_CAMERA_POSITION }}>
    <OrthographicCamera makeDefault={!firstPerson} position={DEFAULT_CAMERA_POSITION} zoom={59} near={0.1} far={100} />
    {firstPerson && <FirstPersonCamera />}
    <RenderGovernor />
    <CrossfadingLights preset={light} />
    <TimeLayerLights time="day" /><TimeLayerLights time="evening" /><TimeLayerLights time="night" />
    <HoverLayerLight time="day" /><HoverLayerLight time="evening" /><HoverLayerLight time="night" />
    <Suspense fallback={null}>
      <RoomWorld />
    </Suspense>
  </Canvas></div>
}

function FirstPersonCamera() {
  const camera = useRef<import('three').PerspectiveCamera>(null)
  const visiting = isVisiting()
  const { characterState } = useRoomStore()
  const { gl } = useThree()
  const yaw = useRef(visiting ? visitorFacing.current : characterFacing.current)
  const pitch = useRef(0)
  const yawVelocity = useRef(0)
  const pitchVelocity = useRef(0)
  const fovTarget = useRef(65)
  const drag = useRef<{ id: number; x: number; y: number; time: number; moved: boolean } | null>(null)
  const pinchDistance = useRef(0)
  const touchCount = useRef(0)
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null)
  const lastTap = useRef({ x: 0, y: 0, time: 0 })
  const dragZoom = useRef<{ id: number; startY: number; startFov: number } | null>(null)
  const suppressClick = useRef(false)
  useEffect(() => {
    const element = (gl.domElement.closest('.canvas-host') ?? gl.domElement) as HTMLElement
    const clampFov = (value: number) => MathUtils.clamp(value, 35, 110)
    const touchDistance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || touchCount.current > 1 || dragZoom.current || (event.target as HTMLElement).closest?.('button,input,textarea,select,a,iframe,[contenteditable="true"]')) return
      yawVelocity.current = 0; pitchVelocity.current = 0
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, moved: false }
    }
    const onMove = (event: PointerEvent) => {
      const active = drag.current
      if (!active || active.id !== event.pointerId) return
      const dx = event.clientX - active.x; const dy = event.clientY - active.y
      const elapsed = MathUtils.clamp((event.timeStamp - active.time) / 1000, .008, .05)
      active.x = event.clientX; active.y = event.clientY; active.time = event.timeStamp
      if (!active.moved && Math.hypot(dx, dy) < 3) return
      if (!active.moved) { active.moved = true; element.setPointerCapture?.(event.pointerId) }
      // Screen drag maps directly to view direction: drag left to turn right, and vice versa.
      const yawDelta = -dx * .0085; const pitchDelta = -dy * .0068
      yaw.current += yawDelta
      pitch.current = MathUtils.clamp(pitch.current + pitchDelta, -Math.PI * .44, Math.PI * .44)
      yawVelocity.current = MathUtils.clamp(yawDelta / elapsed, -3.5, 3.5)
      pitchVelocity.current = MathUtils.clamp(pitchDelta / elapsed, -2.5, 2.5)
      if (visiting) visitorFacing.current = yaw.current
    }
    const onUp = (event: PointerEvent) => {
      if (drag.current?.id !== event.pointerId) return
      suppressClick.current = drag.current.moved
      if (suppressClick.current) window.setTimeout(() => { suppressClick.current = false }, 0)
      drag.current = null; element.releasePointerCapture?.(event.pointerId)
      if (visiting) updateVisitorPresence(visitorPosition, visitorFacing.current, true)
    }
    const onClick = (event: MouseEvent) => {
      if (consumeZoomGestureClick(event)) return
      if (!suppressClick.current) return
      suppressClick.current = false; event.preventDefault(); event.stopImmediatePropagation()
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      fovTarget.current = clampFov(fovTarget.current * Math.exp(event.deltaY * .0015))
    }
    const onTouchStart = (event: TouchEvent) => {
      touchCount.current = event.touches.length
      if (event.touches.length === 2) {
        armZoomGestureClickGuard()
        pinchDistance.current = touchDistance(event.touches)
        drag.current = null; dragZoom.current = null; lastTap.current.time = 0
        event.preventDefault()
        return
      }
      if (event.touches.length !== 1) return
      const touch = event.touches[0]; const now = performance.now()
      touchStart.current = { x: touch.clientX, y: touch.clientY, time: now }
      if (now - lastTap.current.time < 320 && Math.hypot(touch.clientX - lastTap.current.x, touch.clientY - lastTap.current.y) < 36) {
        armZoomGestureClickGuard()
        dragZoom.current = { id: touch.identifier, startY: touch.clientY, startFov: fovTarget.current }
        drag.current = null; lastTap.current.time = 0
        event.preventDefault(); event.stopPropagation()
      }
    }
    const onTouchMove = (event: TouchEvent) => {
      touchCount.current = event.touches.length
      if (event.touches.length === 2) {
        const next = touchDistance(event.touches)
        if (pinchDistance.current) fovTarget.current = clampFov(fovTarget.current * pinchDistance.current / next)
        pinchDistance.current = next; drag.current = null
        event.preventDefault()
        return
      }
      const zoom = dragZoom.current; const touch = event.touches[0]
      if (!zoom || event.touches.length !== 1 || touch.identifier !== zoom.id) return
      fovTarget.current = clampFov(zoom.startFov * Math.exp(-(touch.clientY - zoom.startY) * .009))
      drag.current = null
      event.preventDefault(); event.stopPropagation()
    }
    const onTouchEnd = (event: TouchEvent, cancelled = false) => {
      touchCount.current = event.touches.length
      const touch = event.changedTouches[0]
      if (dragZoom.current && [...event.changedTouches].some((entry) => entry.identifier === dragZoom.current?.id)) {
        armZoomGestureClickGuard()
        dragZoom.current = null
        event.preventDefault(); event.stopPropagation()
      } else if (!cancelled && event.touches.length === 0 && touch && touchStart.current && performance.now() - touchStart.current.time < 350 && Math.hypot(touch.clientX - touchStart.current.x, touch.clientY - touchStart.current.y) < 12) {
        lastTap.current = { x: touch.clientX, y: touch.clientY, time: performance.now() }
      }
      if (event.touches.length < 2) pinchDistance.current = 0
      if (event.touches.length === 0) touchStart.current = null
    }
    const onTouchCancel = (event: TouchEvent) => onTouchEnd(event, true)
    element.addEventListener('pointerdown', onDown); element.addEventListener('pointermove', onMove); element.addEventListener('pointerup', onUp); element.addEventListener('pointercancel', onUp)
    element.addEventListener('click', onClick, true)
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('touchstart', onTouchStart, { passive: false }); element.addEventListener('touchmove', onTouchMove, { passive: false }); element.addEventListener('touchend', onTouchEnd, { passive: false }); element.addEventListener('touchcancel', onTouchCancel, { passive: false })
    return () => { element.removeEventListener('pointerdown', onDown); element.removeEventListener('pointermove', onMove); element.removeEventListener('pointerup', onUp); element.removeEventListener('pointercancel', onUp); element.removeEventListener('click', onClick, true); element.removeEventListener('wheel', onWheel); element.removeEventListener('touchstart', onTouchStart); element.removeEventListener('touchmove', onTouchMove); element.removeEventListener('touchend', onTouchEnd); element.removeEventListener('touchcancel', onTouchCancel) }
  }, [gl, visiting])
  useFrame((_, delta) => {
    const active = camera.current
    if (!active) return
    const position = visiting ? visitorPosition : characterPosition
    const facing = visiting ? visitorFacing.current : characterFacing.current
    const state = visiting ? visitorState.current : characterState
    const moving = state === 'walking' || state === 'aligning'
    if (moving) { yawVelocity.current = 0; pitchVelocity.current = 0; if (!drag.current) yaw.current += Math.atan2(Math.sin(facing - yaw.current), Math.cos(facing - yaw.current)) * Math.min(1, delta * 8) }
    else if (!drag.current) {
      yaw.current += yawVelocity.current * delta
      pitch.current = MathUtils.clamp(pitch.current + pitchVelocity.current * delta, -Math.PI * .44, Math.PI * .44)
      yawVelocity.current = MathUtils.damp(yawVelocity.current, 0, 9, delta)
      pitchVelocity.current = MathUtils.damp(pitchVelocity.current, 0, 9, delta)
      if (visiting) visitorFacing.current = yaw.current
    }
    active.position.set(position[0], position[1] + 1.35, position[2])
    // FPS rotation order keeps pitch local to the camera, so looking up/down never flips horizontal drag.
    active.rotation.order = 'YXZ'
    active.rotation.set(pitch.current, yaw.current + Math.PI, 0)
    const nextFov = MathUtils.damp(active.fov, fovTarget.current, 7, delta)
    if (Math.abs(nextFov - active.fov) >= .001) { active.fov = nextFov; active.updateProjectionMatrix() }
  })
  return <PerspectiveCamera ref={camera} makeDefault fov={65} near={.05} far={100} />
}

function VisitorMover() {
  const { furniture, settleFloorMove } = useRoomStore()
  const route = useRef<Vector3[]>([]); const routeIndex = useRef(0); const routeKey = useRef(''); const sentAt = useRef(0)
  useFrame((_, delta) => {
    const interactionId = visitorInteractionTarget.current
    const interaction = interactionId ? resolveInteraction(interactionId, furniture, visitorPosition) : null
    if (interactionId && !interaction) { cancelVisitorAction(); settleFloorMove(false); updateVisitorPresence(visitorPosition, visitorFacing.current, true); return }
    const target = interaction ? interaction.approachWorld.position : visitorMoveTarget.current
    if (visitorState.current === 'aligning' && interaction) {
      const next = new Vector3(...interaction.actionWorld.position)
      const current = new Vector3(...visitorPosition).lerp(next, Math.min(1, delta * 5))
      visitorPosition.splice(0, 3, current.x, current.y, current.z)
      visitorFacing.current += Math.atan2(Math.sin(interaction.actionWorld.rotation - visitorFacing.current), Math.cos(interaction.actionWorld.rotation - visitorFacing.current)) * Math.min(1, delta * 7)
      const angle = Math.abs(Math.atan2(Math.sin(interaction.actionWorld.rotation - visitorFacing.current), Math.cos(interaction.actionWorld.rotation - visitorFacing.current)))
      if (current.distanceTo(next) < .025 && angle < .025) {
        visitorState.current = stateForInteraction(interaction.type); visitorInteractionTarget.current = null; routeKey.current = ''; updateVisitorPresence(visitorPosition, visitorFacing.current, true)
      } else updateVisitorPresence(visitorPosition, visitorFacing.current)
      return
    }
    if (!target) return
    const key = `${interactionId ?? 'floor'}:${target[0]}:${target[2]}`
    if (routeKey.current !== key) {
      routeKey.current = key
      const occupied = new Set(furniture.filter((item) => item.category === 'floorFurniture' && !isFloorCovering(item) && !item.removed && item.surfaceId === 'floor').flatMap((item) => baseFloorCells(item).map((cell) => `${cell.x}:${cell.y}`)))
      const path = floorWalkRoute(occupied, visitorPosition, target)
      if (!path) { cancelVisitorAction(); routeKey.current = ''; settleFloorMove(false); updateVisitorPresence(visitorPosition, visitorFacing.current, true); return }
      route.current = path.map((point) => new Vector3(...point)); routeIndex.current = 0
    }
    const next = route.current[routeIndex.current]
    if (!next) return
    const current = new Vector3(...visitorPosition); const dx = next.x - current.x; const dz = next.z - current.z
    if (Math.hypot(dx, dz) > .03) visitorFacing.current += Math.atan2(Math.sin(Math.atan2(dx, dz) - visitorFacing.current), Math.cos(Math.atan2(dx, dz) - visitorFacing.current)) * Math.min(1, delta * 7)
    current.lerp(next, Math.min(1, delta * 6)); visitorPosition.splice(0, 3, current.x, 0, current.z)
    const now = performance.now()
    if (now - sentAt.current > 80) { sentAt.current = now; updateVisitorPresence(visitorPosition, visitorFacing.current) }
    if (current.distanceTo(next) < .12) {
      if (routeIndex.current < route.current.length - 1) routeIndex.current += 1
      else if (interaction) { visitorPosition.splice(0, 3, next.x, 0, next.z); visitorState.current = 'aligning'; routeKey.current = ''; updateVisitorPresence(visitorPosition, visitorFacing.current) }
      else { visitorPosition.splice(0, 3, next.x, 0, next.z); visitorMoveTarget.current = null; visitorState.current = 'idle'; routeKey.current = ''; updateVisitorPresence(visitorPosition, visitorFacing.current, true) }
    }
  })
  return null
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
  let radius = 0
  while (1 + 3 * radius * (radius + 1) < handles.length) radius += 1
  const cells: Array<[number, number]> = [[0, 0]]
  const seen = new Set(['0:0'])
  for (let index = 0; index < cells.length; index += 1) {
    for (const [a, b] of neighbourCells(cells[index][0], cells[index][1])) {
      const key = `${a}:${b}`
      if (seen.has(key) || ringDistance({ a, b }, { a: 0, b: 0 }) > radius) continue
      seen.add(key); cells.push([a, b])
    }
  }
  const order = new Map(cells.map(([a, b], index) => [`${a}:${b}`, index]))
  cells.sort(([a1, b1], [a2, b2]) => {
    const distance1 = ringDistance({ a: a1, b: b1 }, { a: 0, b: 0 })
    const distance2 = ringDistance({ a: a2, b: b2 }, { a: 0, b: 0 })
    if (distance1 !== distance2) return distance1 - distance2
    const inner1 = neighbourCells(a1, b1).filter(([a, b]) => ringDistance({ a, b }, { a: 0, b: 0 }) === distance1 - 1).length
    const inner2 = neighbourCells(a2, b2).filter(([a, b]) => ringDistance({ a, b }, { a: 0, b: 0 }) === distance2 - 1).length
    return inner2 - inner1 || order.get(`${a1}:${b1}`)! - order.get(`${a2}:${b2}`)!
  })
  return handles.map((handle, index) => { const [a, b] = cells[index]; return { handle, a, b, position: cellPosition(a, b) } })
}
// pads the cluster with vacant slots so the ring is always complete; real handles always take the nearest cells
const withVacancies = (handles: string[]) => handles.length >= CLUSTER_SIZE ? handles
  : [...handles, ...Array.from({ length: CLUSTER_SIZE - handles.length }, (_, index) => `${VACANT}${index}`)]
// Discover is a page of rooms, not a ranking — the order is drawn once and then left alone.
const shuffled = (list: string[]) => {
  const out = [...list]
  for (let index = out.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[out[index], out[swap]] = [out[swap], out[index]]
  }
  return out
}
const isEnterable = (handle: string) => handle !== LOBBY && !handle.startsWith(VACANT)

// what a zoom-in may land in: real rooms always, and the lobby too for whoever has no room of their own —
// signed out, the default room is home, and home has to be somewhere you can go back to
const canEnter = (handle: string) => isEnterable(handle) || (handle === LOBBY && !isSignedIn())
const sameHandles = (left: string[], right: string[]) => left.length === right.length && left.every((handle, index) => handle === right[index])

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
  const firstGap = roomSlots(['0', '1', '2', '3', '4', '5', '6', '7'])[7]
  if (neighbourCells(firstGap.a, firstGap.b).filter(([a, b]) => check.some((slot) => slot.a === a && slot.b === b)).length !== 2) throw new Error('New rooms must fill gaps between existing rooms before extending outward')
}

// The room you are standing in goes inert while the explorer is open, so browsing cannot walk its character or open
// its panels. Switching raycasting off for the whole subtree covers every handler inside it in one place. It suits
// the live room precisely because nothing there needs to be clickable — a NEIGHBOUR must stay hittable, or the
// click that selects it has nothing to land on, so read-only rooms hold their handlers back instead (see Floor,
// Interactive, Furniture and Character: each one bails before stopPropagation when the store is readOnly).
const NO_RAYCAST = () => {}
const ALWAYS_INERT = () => true
type Faded = Material & { wasTransparent?: boolean; color?: Color }
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
  const visitors = useVisitors()
  const firstPerson = useFirstPerson()
  return <>
    <Floor /><Walls /><Bookshelf /><Desk /><Chair /><Computer /><Cup /><Sofa /><Bed /><Decor /><InventoryFurniture /><InventoryPreview /><SurfaceDropZones /><Character hidden={firstPerson && !isVisiting()} />
    {visitors.map((visitor) => <Character key={visitor.sessionId} snapshot={visitor} hidden={firstPerson && visitor.sessionId === presenceSessionId} />)}
    {isVisiting() && <VisitorMover />}
    <DebugAnchors /><WallVideoLayer /><ReactionBadges />
  </>
}

// A neighbour is the real room: the same components the live room is built from, driven by that room's own
// published bundle. Left out on purpose — WallVideoLayer (an iframe per frame, six rooms deep), ReactionBadges
// (DOM badges that cannot fade with the room), the edit-mode-only layers, and ContactShadows (a shadow pass each).
function NeighbourRoom() {
  return <><Floor /><Walls /><Bookshelf /><Desk /><Chair /><Computer /><Cup /><Sofa /><Bed /><Decor /><InventoryFurniture /><Character /></>
}

// The live room is intentionally inert in the explorer so its furniture cannot react. This invisible floor sits
// under its contents and provides one clean action there: clicking the centre room enters it again. Deliberately
// no wall hitboxes — the stacked isometric walls overlap neighbouring rooms on screen and would steal their click.
function ExplorerRoomHitbox({ off, open, blocked, closePanel }: { off: (zoom: number, width: number, height: number) => boolean; open: () => void; blocked: boolean; closePanel: () => void }) {
  const group = useRef<Group>(null)
  const active = useRef(false)
  const press = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const openedAt = useRef(0)
  useFrame(({ camera, size }) => {
    active.current = off(camera.zoom, size.width, size.height)
    if (group.current) group.current.visible = active.current
  })
  return <group ref={group} visible={false}>
    <mesh position={[0, .03, 0]}
      onPointerDown={(event) => { if (blocked) { openedAt.current = performance.now(); event.stopPropagation(); closePanel(); return } if (active.current) press.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId } }}
      onPointerMove={(event) => { if (press.current?.pointerId === event.pointerId && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 18) press.current = null }}
      onPointerUp={(event) => { const down = press.current; press.current = null; if (!active.current || !down || down.pointerId !== event.pointerId) return; openedAt.current = performance.now(); event.stopPropagation(); open() }}
      onClick={(event) => { if (!active.current || performance.now() - openedAt.current < 500 || event.delta > 18) return; event.stopPropagation(); open() }}
      onPointerCancel={() => { press.current = null }}>
      <boxGeometry args={[ROOM_SIZE, .04, ROOM_SIZE]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  </group>
}

function RoomContainer({ slot, distance, centred, shown, fresh, open, swapping, blocked, closePanel }: { slot: RoomSlot; distance: number; centred: boolean; shown: boolean; fresh?: Record<string, string>; open: () => void; swapping: boolean; blocked: boolean; closePanel: () => void }) {
  const { mode } = useRoomStore()
  const { gl, camera, scene } = useThree()
  const group = useRef<Group>(null)
  const opacity = useRef(0)
  const materials = useRef<Faded[]>([])
  const materialsSettled = useRef(false)
  const glow = useRef(0)
  const press = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const openedAt = useRef(0)
  // The lobby — the default room a signed-out visitor starts in — has no server bundle to wait for: an empty
  // bundle IS its look. Without this the cell went permanently blank the moment such a visitor entered a real
  // room, because the room they had just come from could never be drawn as a neighbour.
  const [bundle, setBundle] = useState<Record<string, string> | null>(slot.handle === LOBBY ? {} : null)
  const savedTime = bundle?.['my-room-time-v1']
  const roomTime: TimeOfDay = savedTime === 'evening' || savedTime === 'night' ? savedTime : 'day'
  const layer = TIME_LAYER[roomTime]
  useLayoutEffect(() => {
    if (!centred) return
    const mask = 1 << HOVER_LAYER[roomTime]
    hoverLayerMask = mask
    return () => { if (hoverLayerMask === mask) hoverLayerMask = 0 }
  }, [centred, roomTime])
  const nextFetch = useRef(0)
  const nextCollect = useRef(0)
  const nextFadeCollect = useRef(0)
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
  // Mounted means the room is inside the one-room preload margin. Fetch here, while it is still off screen,
  // rather than waiting for opacity to rise on its first visible frame. The shared promise cache makes a later
  // refresh reuse this request, and leaving the margin is enough to unmount the whole room again.
  useEffect(() => {
    nextFetch.current = performance.now() + 15_000 + Math.random() * 5_000
    if (!isEnterable(slot.handle)) return
    void fetchRoomBundle(slot.handle).then((found) => {
      if (!found || !mounted.current) return
      const raw = JSON.stringify(found)
      if (raw === lastRaw.current) return
      lastRaw.current = raw
      setBundle(found)
    })
  }, [slot.handle])
  // Shaders are compiled the first time a mesh is actually DRAWN, and until the zoom-out reveals it a neighbour
  // is never drawn — so the reveal itself paid for several rooms' worth of program compilation at once, and the
  // gather from the entry line to the floor stuttered through it. Compiling in the background as soon as the
  // room's content mounts moves that cost to a moment when nothing on screen depends on this room; twice, since
  // suspended pieces (fonts, textures) mount after the first pass, and re-compiling what is already compiled
  // costs nothing.
  useEffect(() => {
    if (!bundle || !group.current) return
    const warm = () => queueRoomCompile(() => group.current ? gl.compileAsync(group.current, camera, scene) : Promise.resolve())
    const first = setTimeout(warm, 300)
    const second = setTimeout(warm, 2000)
    return () => { clearTimeout(first); clearTimeout(second) }
  }, [bundle, camera, gl, scene])
  const collect = () => {
    materials.current = []
    materialsSettled.current = false
    let paintOrder = 0
    const fading = opacity.current < .995
    group.current?.traverse((object) => {
      object.layers.set(layer)
      if (centred) object.layers.enable(HOVER_LAYER[roomTime])
      // While the room is transparent, the depth SORT decides paint order per object — and a wall's sort point
      // (its centre) can land nearer the camera than a photo hanging on that wall, so the wall paints after it
      // and swallows every wall-mounted object a little more as the fade deepens: they visibly faded OUT, then
      // popped back the frame transparency was restored. Scene-graph order is the truth (walls mount before the
      // things hung on them), so during the fade paint order is pinned to traversal order; at full view it goes
      // back to plain depth-tested rendering.
      // Preserve the shared room layer contract while fading. The previous traversal-only order erased the
      // media < wall decor < floor furniture hierarchy and let late-mounted photos/videos jump in front.
      let baseOrder = object.userData.roomBaseRenderOrder as number | undefined
      if (baseOrder === undefined) {
        baseOrder = object.renderOrder
        let parent = object.parent
        while (parent && parent !== group.current) {
          baseOrder = Math.max(baseOrder, (parent.userData.roomBaseRenderOrder as number | undefined) ?? parent.renderOrder)
          parent = parent.parent
        }
        object.userData.roomBaseRenderOrder = baseOrder
      }
      object.renderOrder = fading ? baseOrder * 10000 + ++paintOrder : baseOrder
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
  useLayoutEffect(collect, [bundle, centred, layer, roomTime])
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
    // swapping = the ring is being exchanged in plain sight (the explorer is open), so the whole neighbourhood
    // dims out first and the incoming one fades up in its place instead of the cells cutting to new rooms
    const wanted = !shown || swapping || mode !== 'normal' ? 0 : centred ? 1 : MathUtils.clamp(1 - (camera.zoom - floor) / span, 0, 1)
    // The frame a room is first drawn tends to hitch — texture uploads land right then — and the long delta of
    // that one frame used to advance the damp nearly to 1, so the room POPPED instead of fading. Capping the step
    // means a hitch only moves the fade one small notch, and the glide plays out over the frames that follow.
    // Leaving is slower than arriving on purpose: the zoom transit is quick, and at the arrival pace the ring
    // vanished with a blink — the lower rate lets it linger and melt out instead. But ONLY while the camera is
    // still inside the explorer band: past the entry line the user is already in a room, and on mobile — whose
    // band is a few zoom units wide and crossed in a blink by the double-tap zoom — the slow melt left the ring
    // hanging over an entered room before winking out. Once entry has fired, the ring clears at full pace.
    const leavingRate = camera.zoom > entryZoom(size.width, size.height) ? 12 : 5
    opacity.current = MathUtils.damp(opacity.current, wanted, wanted < opacity.current ? leavingRate : 12, Math.min(delta, 1 / 30))
    if (Math.abs(opacity.current - wanted) > .001) keepExplorerAnimationsSmooth()
    // Materials keep arriving after the layout effect ran — a suspended font resolves, and a photo or thumbnail
    // texture finishing its load SWAPS IN a whole new material. A newcomer the loop below doesn't know about is
    // drawn at its natural full opacity, which against a half-faded room reads as the photo popping in — and on
    // the way out, popping off. During the fade the collection is refreshed at 30Hz: at most one display frame can
    // see a late material, while high-refresh displays no longer traverse every room 120 times a second.
    const now = performance.now()
    if (opacity.current > .01 && opacity.current < .995 && now >= nextFadeCollect.current) {
      nextFadeCollect.current = now + 1000 / 30
      collect()
    }
    // At full view the sweep drops to a slow cadence, purely so materials swapped in later (a photo texture
    // finishing its download replaces the material object) are still discovered and get their entrance below.
    else if (opacity.current >= .995 && performance.now() > nextCollect.current) { nextCollect.current = performance.now() + 500; collect() }
    group.current.visible = opacity.current > .01
    if (group.current.visible) activeTimeLayerMask |= 1 << layer
    // A nudge in size is the whole highlight. The cluster is stacked by storey, so lifting or outlining the picked
    // room would fight that illusion, while 6% reads as hover without moving anything out of its own cell.
    glow.current = MathUtils.damp(glow.current, centred ? 1 : 0, 9, delta)
    group.current.scale.setScalar((.88 + opacity.current * .12) * (1 + glow.current * .06))
    // Once the room is all the way in, hand every material its own transparency back and pin opacity to exactly 1.
    // Holding them transparent forever put decals into the sorted transparent pass alongside the panel they sit
    // on — a few thousandths apart — and when the decal won that toss the panel behind it failed the depth test
    // and the wall showed through it. The profile board's stats read as wall-coloured because of it.
    const full = opacity.current > .995
    if (!full || !materialsSettled.current) {
      let allSettled = full
      materials.current.forEach((material) => {
        // Entrance: a material starts counting only once it can actually show pixels (its map has image data, or
        // it has no map), then eases in over 300ms. Without this, a photo texture that finishes downloading during
        // or just after the reveal POPS in at full strength while everything else faded — the "일부 요소가 뚝
        // 하고 나타난다" report. Applies at full view too, which is when slow downloads usually land.
        const map = (material as { map?: { image?: unknown } }).map
        // Discovered at FULL view with its image already showing → it has been on screen since before this sweep
        // found it, so it enters as already-settled: restarting its entrance made a visible element fade OUT and
        // back in (the reported dip). The ramp only applies to pixels that were never visible yet.
        if (material.userData.readyAt === undefined && (!map || map.image)) material.userData.readyAt = full ? now - 300 : now
        const entrance = material.userData.readyAt === undefined ? 0 : Math.min(1, (now - material.userData.readyAt) / 300)
        const settled = full && entrance >= 1
        material.transparent = settled ? material.wasTransparent ?? false : true
        // trim bars ride the cube of the fade: still smooth, but they only surface once the room is nearly whole,
        // instead of floating over the ghosted room as three hard dark bars for the entire glide
        material.opacity = settled ? 1 : (material.userData.lateFade ? opacity.current ** 7 : opacity.current) * entrance
        if (!settled) allSettled = false
      })
      materialsSettled.current = allSettled
    }
    // Fetched when the zoom-out first reveals it, and refreshed every so often for as long as it stays on
    // screen — a one-shot fetch froze the neighbour at its first snapshot, so an owner moving their character
    // never showed up out here until a full reload. Unchanged payloads are dropped before setState, so the
    // steady case re-renders nothing.
    if (opacity.current > .02 && isEnterable(slot.handle) && now > nextFetch.current) {
      if (explorerAnimationsAreMoving()) nextFetch.current = now + 1_000 + Math.random() * 2_000
      else {
        nextFetch.current = now + 15_000 + Math.random() * 5_000
        void fetchRoomBundle(slot.handle).then((found) => {
          if (!found || !mounted.current) return
          const raw = JSON.stringify(found)
          if (raw === lastRaw.current) return
          lastRaw.current = raw
          setBundle(found)
        })
      }
    }
  })
  return <group ref={group} position={slot.position} visible={false}
    onPointerDown={(event) => { if (blocked) { openedAt.current = performance.now(); event.stopPropagation(); closePanel(); return } if (opacity.current >= .65) press.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId } }}
    onPointerMove={(event) => { if (press.current?.pointerId === event.pointerId && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 18) press.current = null }}
    onPointerUp={(event) => { const down = press.current; press.current = null; if (!down || down.pointerId !== event.pointerId || opacity.current < .65) return; openedAt.current = performance.now(); event.stopPropagation(); open() }}
    onClick={(event) => { if (performance.now() - openedAt.current < 500 || opacity.current < .65 || event.delta > 18) return; event.stopPropagation(); open() }}
    onPointerCancel={() => { press.current = null }}>
    {/* its own boundary: a neighbour's font or texture must never suspend the live room out of view */}
    <Suspense fallback={null}>
      {/* Nothing is drawn until the room's own layout is in hand: rendering the provider with a null bundle
          shows the DEFAULT room, and a stranger's cell flashing the starter layout before flipping to the real
          one read as broken. With bundles prefetched at directory load the gap is rarely even visible. */}
      {bundle === null ? null : <>
      {/* Interior meshes never join explorer hit testing. The single floor-sized target below owns room selection. */}
      <Inert off={ALWAYS_INERT}><NeighbourRoomProvider bundle={bundle} handle={slot.handle}><NeighbourRoom /></NeighbourRoomProvider></Inert>
      {/* Explorer rooms need one target, not hundreds of furniture meshes. The event bubbles to RoomContainer. */}
      <mesh position={[0, .03, 0]}>
        <boxGeometry args={[ROOM_SIZE, .04, ROOM_SIZE]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      </>}
    </Suspense>
  </group>
}

function RoomWorld() {
  const firstPerson = useFirstPerson()
  const { mode, timeOfDay, bookshelfOpen, openBookId, clearSelection } = useRoomStore()
  const bookPanelOpen = bookshelfOpen || !!openBookId
  // The cluster is centred on the signed-in user's OWN room — it is their neighbourhood, so their room is the hub
  // the others ring around, whichever room they happen to be looking at. Signed out there is no own room, so the
  // room in the address (or the lobby) takes the middle instead.
  // Signed out, the hub is ALWAYS the lobby — even when the address opens straight into someone's room. Taking
  // the visited room as hub there meant a refresh mid-visit dropped the default room out of the cluster entirely,
  // and with it the only way back to where the visitor started.
  const hubHandle = useRef(myHandle() ?? (isSignedIn() ? currentRoomHandle() : null) ?? LOBBY).current
  const [handles, setHandles] = useState(() => withVacancies([hubHandle]))
  // Only these read-only room previews exist in the Three scene. `shown` is the tighter visible set; `mounted`
  // includes a one-room margin so data and shaders are ready before a room crosses the edge of the screen.
  const [shownRooms, setShownRooms] = useState<string[]>([])
  const [mountedRooms, setMountedRooms] = useState<string[]>([])
  // bundles pushed by the realtime stream, keyed by handle — each RoomContainer picks up its own
  const [freshBundles, setFreshBundles] = useState<Record<string, Record<string, string>>>({})
  useEffect(() => subscribeRoomBundles(mountedRooms.filter(isEnterable), (handle, data) => setFreshBundles((prev) => ({ ...prev, [handle]: data }))), [mountedRooms])
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
  const fine = useRef(typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches)
  // whether the cursor is currently the pointer, so the style is only written when it flips
  const cursorOn = useRef(false)
  // starts true so the very first frame — which opens at the entry zoom already — is not read as a zoom-in
  const wasZoomedIn = useRef(true)
  // set the moment ANY entry starts, re-armed only once the camera is back out at the explorer. The camera's own
  // entry zoom crosses the entry line like a user's would, and without this latch that crossing fired a SECOND
  // entry into whatever was picked at the time — on touch, the middle-of-screen room, so a tapped outer room
  // flashed up and then bounced to the centre one.
  const entryLatched = useRef(false)
  const requestedEntry = useRef(false)
  // Home always uses MY follow list. Entering a neighbour may temporarily put it in the middle, but it never
  // replaces the source graph. Discover remains one shuffled page of public rooms held for the session.
  const [ringMode, setRingMode] = useState<ExplorerMode>(explorerMode())
  const [followsTick, setFollowsTick] = useState(0)
  const [swapping, setSwapping] = useState(false)
  const discoverPage = useRef<string[] | null>(null)
  // The pin moves with the room, under whichever explorer is open at the time. A room reached without a click
  // — the dock's home button, or an explorer toggle restoring its pin — also has to cancel whatever the mouse
  // had picked out here and latch entry, or the camera's own entry zoom reads as a second choice and carries
  // the visitor into the room that happened to be centred.
  useEffect(() => {
    picked.current = null
    requestedEntry.current = false
    entryLatched.current = true
    if (isEnterable(activeHandle) && explorerMode() === 'discover') rememberModeRoom('discover', activeHandle)
  }, [activeHandle])
  useEffect(() => onExplorerMode(setRingMode), [])
  useEffect(() => onFollowsChange(() => setFollowsTick((value) => value + 1)), [])
  useEffect(() => {
    let live = true
    // Home is one stable neighbourhood: my room followed by only the rooms I follow. Visiting one of them must
    // never rebuild the array around that room or inject an unrelated visited room into my ring.
    const centre = hubHandle
    const source = ringMode === 'home'
      ? fetchFollowing(hubHandle).then(sortByActivity)
      : discoverPage.current ? Promise.resolve(discoverPage.current) : fetchRoomDirectory().then((all) => (discoverPage.current = shuffled(all)))
    void source.then((found) => {
      if (!live) return
      const rest = found.filter((handle) => handle !== centre && handle !== hubHandle)
      // Discover keeps the room being browsed. Home never adds it: that ring is exactly mine + my follows.
      const viewed = ringMode === 'discover' ? currentRoomHandle() : null
      if (viewed && viewed !== centre && !rest.includes(viewed)) rest.unshift(viewed)
      const next = withVacancies([centre, ...rest])
      // Inside a room the ring is off screen, so the exchange is free — which is the usual case, since a new
      // ring is what entering a room asks for. Out in the explorer the swap would be seen, so it crossfades.
      if (wasZoomedIn.current) { setHandles(next); return }
      setSwapping(true)
      window.setTimeout(() => { if (live) { setHandles(next); setSwapping(false) } }, 240)
    })
    return () => { live = false }
  }, [hubHandle, ringMode, followsTick, activeHandle])
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
  const visibilityProbe = useRef(new Vector3()).current
  const nextVisibilitySweep = useRef(0)
  const shownUntil = useRef(new Map<string, number>())
  const mountedUntil = useRef(new Map<string, number>())
  useFrame(({ camera, size }) => {
    const now = performance.now()
    if (now < nextVisibilitySweep.current) return
    nextVisibilitySweep.current = now + 100
    const nextShown: string[] = []
    const nextMounted: string[] = []
    for (const slot of slots) {
      if (slot.handle === active.handle || (!isEnterable(slot.handle) && slot.handle !== LOBBY)) continue
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      // Project the room's actual cube instead of guessing from zoom. The same calculation works while the camera
      // pans, rotates or changes aspect ratio, and it is cheap at this 10 Hz visibility cadence.
      for (const x of [-ROOM_SIZE / 2, ROOM_SIZE / 2]) for (const y of [0, ROOM_SIZE]) for (const z of [-ROOM_SIZE / 2, ROOM_SIZE / 2]) {
        visibilityProbe.set(slot.position[0] + x, slot.position[1] + y, slot.position[2] + z).project(camera)
        const screenX = (visibilityProbe.x + 1) * size.width / 2
        const screenY = (1 - visibilityProbe.y) * size.height / 2
        minX = Math.min(minX, screenX); maxX = Math.max(maxX, screenX)
        minY = Math.min(minY, screenY); maxY = Math.max(maxY, screenY)
      }
      const roomSpan = Math.max(maxX - minX, maxY - minY)
      const visible = maxX >= -24 && minX <= size.width + 24 && maxY >= -24 && minY <= size.height + 24
      const preload = maxX >= -roomSpan && minX <= size.width + roomSpan && maxY >= -roomSpan && minY <= size.height + roomSpan
      if (visible) shownUntil.current.set(slot.handle, now + 400)
      if (preload || visible) mountedUntil.current.set(slot.handle, now + 900)
      if (visible || (shownUntil.current.get(slot.handle) ?? 0) > now) nextShown.push(slot.handle)
      if (preload || (mountedUntil.current.get(slot.handle) ?? 0) > now) nextMounted.push(slot.handle)
      if ((mountedUntil.current.get(slot.handle) ?? 0) <= now) { mountedUntil.current.delete(slot.handle); shownUntil.current.delete(slot.handle) }
    }
    setShownRooms((current) => sameHandles(current, nextShown) ? current : nextShown)
    setMountedRooms((current) => sameHandles(current, nextMounted) ? current : nextMounted)
  })
  const shownRoomSet = useMemo(() => new Set(shownRooms), [shownRooms])
  const mountedRoomSet = useMemo(() => new Set(mountedRooms), [mountedRooms])
  const activeGroup = useRef<Group>(null)
  const activeGlow = useRef(0)
  const activeHoverLayer = useRef<number | null>(null)
  const activeHoverSweep = useRef(0)
  const activeHovered = active.handle === centredHandle
  useFrame((_, delta) => {
    activeGlow.current = MathUtils.damp(activeGlow.current, activeHovered ? 1 : 0, 9, delta)
    activeGroup.current?.scale.setScalar(1 + activeGlow.current * .06)
    const layer = HOVER_LAYER[timeOfDay]
    if (activeHovered) {
      const needsSweep = activeHoverLayer.current !== layer || performance.now() >= activeHoverSweep.current
      if (activeHoverLayer.current !== layer) {
        const previous = activeHoverLayer.current
        if (previous !== null) activeGroup.current?.traverse((object) => object.layers.disable(previous))
        activeHoverLayer.current = layer
      }
      // Children such as photos and text may finish loading after hover started, so include late arrivals too.
      if (needsSweep) { activeGroup.current?.traverse((object) => object.layers.enable(layer)); activeHoverSweep.current = performance.now() + 500 }
      hoverLayerMask = 1 << layer
    } else if (activeHoverLayer.current !== null) {
      const previous = activeHoverLayer.current
      activeGroup.current?.traverse((object) => object.layers.disable(previous))
      if (hoverLayerMask === 1 << previous) hoverLayerMask = 0
      activeHoverLayer.current = null
    }
  })
  // the room underneath the explorer is scenery until it is entered: fully zoomed out, a click selects a room
  const exploring = (zoom: number, width: number, height: number) => !firstPerson && mode === 'normal' && zoom <= exploreMinZoom(width, height) + .5
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
    // Re-entering the room already on screen is purely a camera transition. Re-fetching and rehydrating the same
    // room would reset panels/media for no data change and makes the centre-room click feel like a reload.
    if (slot.handle === activeHandle) { requestedEntry.current = false; return }
    // the lobby is not on the server — going back to it is a local reset that walks the same listener path
    if (slot.handle === LOBBY) { await snapshotActiveFrames(); enterLobby(); requestedEntry.current = false; return }
    opening.current = true
    await snapshotActiveFrames()
    await enterRoom(slot.handle)
    opening.current = false
    requestedEntry.current = false
  }
  const beginEntry = (slot: RoomSlot) => {
    if (opening.current || requestedEntry.current || !canEnter(slot.handle)) return
    requestedEntry.current = true
    picked.current = slot
    centred.current = slot.handle
    setCentredHandle(slot.handle)
    setFocusRoom({ position: slot.position, token: performance.now() })
  }
  useFrame(({ camera, pointer, size }) => {
    if (firstPerson) {
      if (cursorOn.current) { cursorOn.current = false; document.body.style.cursor = '' }
      if (centred.current !== null) { centred.current = null; setCentredHandle(null) }
      wasZoomedIn.current = true
      return
    }
    const floor = exploreMinZoom(size.width, size.height)
    const zoomedIn = mode !== 'normal' || camera.zoom > entryZoom(size.width, size.height)
    // The pick is decided at the zoom floor and then held. Recomputing it on the way in reads a screen that is
    // already moving — the aim below is pulling the chosen room to the middle — so under a mouse that has not
    // budged the room under the cursor changes and the choice flips out from under the user mid-zoom.
    // The pick keeps updating through the first half of the transit band — the user can still steer onto a
    // different room while the fade has already begun — and only freezes for the short stretch before the entry
    // line, which is what keeps the choice from flapping while the camera is actively pulling it to the middle.
    if (mode === 'normal' && !requestedEntry.current && camera.zoom <= (floor + entryZoom(size.width, size.height)) / 2) {
      // Measured in pixels off a projected centre rather than in world space: the cluster is stacked across storeys
      // and panning slides the target in the screen plane, so world distance disagrees with what is on screen. The
      // The room already being viewed competes as well: it is clickable in the explorer, so it must receive the
      // same hover, cursor and zoom target as every neighbouring room.
      const halfW = size.width / 2
      const halfH = size.height / 2
      const nearest = (atX: number, atY: number) => {
        let best = Infinity
        let winner: RoomSlot | null = null
        for (const slot of slots) {
          if (slot !== active && (!shownRoomSet.has(slot.handle) || !canEnter(slot.handle))) continue
          probe.set(slot.position[0], slot.position[1] + 3.5, slot.position[2]).project(camera)
          const offset = Math.hypot((probe.x - atX) * halfW, (probe.y - atY) * halfH)
          if (offset < best) { best = offset; winner = slot }
        }
        return { slot: winner, offset: best }
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
    // A touch screen may keep the centre room as its zoom-in target, but that passive target is not a hover.
    // Only a real pointer hover or an explicit tap/entry gets the enlarged foreground treatment.
    const showHover = fine.current || requestedEntry.current || opening.current
    const handle = (!zoomedIn || opening.current) && showHover ? picked.current?.handle ?? null : null
    if (handle !== centred.current) { centred.current = handle; setCentredHandle(handle) }
    // the edge, not the state: entering is what crossing the line does, so it fires once per zoom-in — and only
    // when no entry is already underway (the latch covers the camera's own entry zoom crossing this same line)
    if (!bookPanelOpen && zoomedIn && !wasZoomedIn.current && picked.current && !entryLatched.current) void open(picked.current)
    wasZoomedIn.current = zoomedIn
    if (!zoomedIn) entryLatched.current = false
    // spent once the room is in, so coming back down through the band does not re-light a stale choice
    if (zoomedIn && !opening.current) picked.current = null
  })
  // the picked room, or the one already being viewed when nothing is picked — what the camera should be aiming at
  const aim = useMemo(() => (slots.find((slot) => slot.handle === centredHandle) ?? active)?.position ?? null, [slots, active, centredHandle])
  return <>
    {!firstPerson && slots.filter((slot) => mountedRoomSet.has(slot.handle)).map((slot) => <RoomContainer key={slot.handle} slot={slot} distance={ringDistance(slot, active)} centred={slot.handle === centredHandle} shown={shownRoomSet.has(slot.handle)} fresh={freshBundles[slot.handle]} open={() => beginEntry(slot)} swapping={swapping} blocked={bookPanelOpen} closePanel={clearSelection} />)}
    <group ref={activeGroup} position={active.position}>
      <Inert off={exploring}><RoomRoot /></Inert>
      <ExplorerRoomHitbox off={exploring} open={() => beginEntry(active)} blocked={bookPanelOpen} closePanel={clearSelection} />
    </group>
    {!firstPerson && <CameraController focusRoom={focusRoom} aim={aim} />}
  </>
}


export default function Room() { return <Scene /> }
