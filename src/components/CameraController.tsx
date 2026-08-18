import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { MathUtils, MOUSE, OrthographicCamera, TOUCH, Vector3 } from 'three'
import { useRoomStore } from '../store'

const DESKTOP_DETAIL_MIN_ZOOM = 42
const MOBILE_DETAIL_MIN_ZOOM = 30
// How far out the explorer goes. A room is 200px wide at zoom 20.2, and the cluster spans three rooms across, so
// desktop stops with the whole ring on screen at a readable size rather than shrinking it to a thumbnail. A phone
// has far less width for the same three rooms, so it is allowed to pull back further before it stops.
const DESKTOP_EXPLORE_MIN_ZOOM = 40
const MOBILE_EXPLORE_MIN_ZOOM = 13
const MAX_ZOOM = 220

export const isCompactScreen = (width: number, height: number) => width < 720 || (height < 520 && window.matchMedia('(pointer: coarse)').matches)
// the floor the explorer bottoms out at — the neighbour fade bands are anchored to it so raising one moves the other
export const exploreMinZoom = (width: number, height: number) => isCompactScreen(width, height) ? MOBILE_EXPLORE_MIN_ZOOM : DESKTOP_EXPLORE_MIN_ZOOM
// Where zooming in stops being a look and counts as choosing the room in the middle. The flag that locks the
// explorer flips on the very first wheel tick, far too twitchy to drop someone into a room, so the line sits a
// little above the floor — desktop 46, mobile 15. The neighbour fade is spent by exactly here, so the ring is
// already gone at the moment of entry.
export const entryZoom = (width: number, height: number) => exploreMinZoom(width, height) * 1.15

// The straight-on view a room is entered at, derived from the default rig: the camera sits at (10, 8.5, 10) looking
// at (0, 3.5, 0), so the offset is (10, 5, 10) with radius 15 — azimuth atan2(10, 10) and polar acos(5 / 15).
const DEFAULT_AZIMUTH = Math.PI / 4
const DEFAULT_POLAR = Math.acos(1 / 3)

type FocusRoom = { position: [number, number, number]; token: number; shift?: [number, number, number] }
type ControlsRef = { target: Vector3; update: () => void; getAzimuthalAngle: () => number; setAzimuthalAngle: (value: number) => void; getPolarAngle: () => number; setPolarAngle: (value: number) => void }

export default function CameraController({ focusRoom, aim }: { focusRoom?: FocusRoom; aim?: [number, number, number] | null }) {
  const { camera, gl, size } = useThree()
  const { mode } = useRoomStore()
  const zoomTarget = useRef(59)
  const targetGoal = useRef(new Vector3(0, 3.5, 0))
  // set while gliding back to the straight-on view after a room is entered, then cleared so the user owns the angle
  const angleGoal = useRef<{ azimuth: number; polar: number } | null>(null)
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null)
  const pinchDistance = useRef(0)
  const lastTap = useRef({ time: 0, x: 0, y: 0 })
  const dragZoom = useRef<{ identifier: number; startY: number; startZoom: number; lastX: number; lastY: number } | null>(null)
  const controls = useRef<ControlsRef | null>(null)
  const [dragZooming, setDragZooming] = useState(false)
  // fully zoomed out is the room explorer, not a room: swinging the camera there just skews the tiled
  // neighbours, so rotation is locked until the user zooms back in
  const [atMinZoom, setAtMinZoom] = useState(false)
  // the frame loop can run before React has committed, and pushing a setState every frame from useFrame both warns
  // and churns — so the flag is only published when it actually flips
  const wasAtMinZoom = useRef(false)
  const compactScreen = isCompactScreen(size.width, size.height)
  const detailMinZoom = compactScreen ? MOBILE_DETAIL_MIN_ZOOM : DESKTOP_DETAIL_MIN_ZOOM
  const minZoom = mode === 'edit' ? detailMinZoom : compactScreen ? MOBILE_EXPLORE_MIN_ZOOM : DESKTOP_EXPLORE_MIN_ZOOM
  const baseZoom = compactScreen ? MOBILE_DETAIL_MIN_ZOOM : 59

  useEffect(() => {
    const camera2d = camera as OrthographicCamera
    camera2d.zoom = zoomTarget.current = baseZoom
    camera2d.updateProjectionMatrix()
  }, [camera, compactScreen, baseZoom])

  // While the explorer is being browsed the camera aims at whichever room is under the middle of the screen rather
  // than at the room the user came from. Without it, the instant a zoom-in starts the damping drags the view back
  // toward the old room: on a gentle wheel the picked room slides out of the middle before the entry line is even
  // crossed, and on a fast one the user watches the room they chose leave the screen while zooming into it.
  useEffect(() => {
    if (!aim) return
    targetGoal.current.set(aim[0], aim[1] + 3.5, aim[2])
  }, [aim])

  useEffect(() => {
    if (!focusRoom) return
    // The cluster re-bases onto the room being entered, so that room teleports from its own cell to the origin —
    // a whole CELL, about 290px at the desktop zoom floor. Sliding the camera by exactly the same amount leaves it
    // where it already was on screen, and the damping below then carries it to the middle from there. Without this
    // the room jumps out from under the user at the very moment the zoom-in is taking them into it.
    const shift = focusRoom.shift
    if (shift && controls.current) {
      const delta = new Vector3(shift[0], shift[1], shift[2])
      controls.current.target.sub(delta)
      camera.position.sub(delta)
    }
    targetGoal.current.set(focusRoom.position[0], focusRoom.position[1] + 3.5, focusRoom.position[2])
    // Entry is the user's own zoom-in now, so the standard framing is a floor rather than an override — forcing
    // the zoom back to it would fight the wheel that is still turning. Wind past it and the extra is kept.
    zoomTarget.current = Math.max(zoomTarget.current, baseZoom)
    // whatever the explorer was left rotated or panned to, entering a room lands dead-centre on the 45° view
    angleGoal.current = { azimuth: DEFAULT_AZIMUTH, polar: DEFAULT_POLAR }
  }, [baseZoom, camera, focusRoom?.token])

  useEffect(() => { zoomTarget.current = Math.max(zoomTarget.current, minZoom) }, [minZoom])

  useEffect(() => {
    // the canvas is pointer-transparent (clicks reach wall-video iframes behind it) — real pointer targets
    // become the .canvas-host wrapper, so wheel/touch must listen there
    const element = (gl.domElement.closest('.canvas-host') ?? gl.domElement) as HTMLElement
    const distance = (touches: TouchList) => touches.length < 2 ? 0 : Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
    const onWheel = (event: WheelEvent) => { event.preventDefault(); zoomTarget.current = MathUtils.clamp(zoomTarget.current * Math.exp(-event.deltaY * .0015), minZoom, MAX_ZOOM) }
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinchDistance.current = distance(event.touches)
        lastTap.current.time = 0
        dragZoom.current = null
        setDragZooming(true)
        event.preventDefault()
        return
      }
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      const now = performance.now()
      const secondTap = mode === 'normal' && compactScreen && now - lastTap.current.time < 320 && Math.hypot(touch.clientX - lastTap.current.x, touch.clientY - lastTap.current.y) < 36
      touchStart.current = { x: touch.clientX, y: touch.clientY, time: now }
      if (secondTap) {
        dragZoom.current = { identifier: touch.identifier, startY: touch.clientY, startZoom: zoomTarget.current, lastX: touch.clientX, lastY: touch.clientY }
        lastTap.current.time = 0
        setDragZooming(true)
        event.preventDefault(); event.stopPropagation()
      }
    }
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        const next = distance(event.touches)
        if (pinchDistance.current) zoomTarget.current = MathUtils.clamp(zoomTarget.current * next / pinchDistance.current, minZoom, MAX_ZOOM)
        pinchDistance.current = next
        event.preventDefault()
        return
      }
      if (!dragZoom.current || event.touches.length !== 1 || event.touches[0].identifier !== dragZoom.current.identifier) return
      event.preventDefault(); event.stopPropagation()
      zoomTarget.current = MathUtils.clamp(dragZoom.current.startZoom * Math.exp((event.touches[0].clientY - dragZoom.current.startY) * .009), minZoom, MAX_ZOOM)
      // sideways movement swings the view while vertical movement stays pure zoom
      const dx = event.touches[0].clientX - dragZoom.current.lastX
      dragZoom.current.lastX = event.touches[0].clientX
      if (controls.current && zoomTarget.current > minZoom + .01) controls.current.setAzimuthalAngle(MathUtils.clamp(controls.current.getAzimuthalAngle() - dx * .027, 0, Math.PI / 2))
    }
    const onTouchEnd = (event: TouchEvent, cancelled = false) => {
      const touch = event.changedTouches[0]
      if (dragZoom.current && [...event.changedTouches].some((entry) => entry.identifier === dragZoom.current?.identifier)) {
        event.preventDefault(); event.stopPropagation()
        dragZoom.current = null
        setDragZooming(false)
      } else if (mode === 'normal' && !cancelled && event.touches.length === 0 && touch && touchStart.current && performance.now() - touchStart.current.time < 350 && Math.hypot(touch.clientX - touchStart.current.x, touch.clientY - touchStart.current.y) < 12) {
        lastTap.current = { time: performance.now(), x: touch.clientX, y: touch.clientY }
      } else if (event.touches.length === 0) lastTap.current.time = 0
      if (event.touches.length < 2) { pinchDistance.current = 0; setDragZooming(false) }
      if (event.touches.length === 0) touchStart.current = null
    }
    const onTouchCancel = (event: TouchEvent) => onTouchEnd(event, true)
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('touchstart', onTouchStart, { passive: false, capture: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    element.addEventListener('touchend', onTouchEnd, { passive: false, capture: true })
    element.addEventListener('touchcancel', onTouchCancel, { passive: false, capture: true })
    return () => { element.removeEventListener('wheel', onWheel); element.removeEventListener('touchstart', onTouchStart, true); element.removeEventListener('touchmove', onTouchMove, true); element.removeEventListener('touchend', onTouchEnd, true); element.removeEventListener('touchcancel', onTouchCancel, true) }
  }, [compactScreen, gl, minZoom, mode])

  useFrame((_, delta) => {
    const camera2d = camera as OrthographicCamera
    // Only in normal mode. Edit mode has its OWN, much higher floor, and on a phone the default zoom sits exactly
    // on it — so this read as "fully zoomed out", switched panning on, and a one-finger drag shoved the room away
    // while the user was arranging furniture.
    const fullyOut = mode === 'normal' && zoomTarget.current <= minZoom + .01
    if (fullyOut !== wasAtMinZoom.current) { wasAtMinZoom.current = fullyOut; setAtMinZoom(fullyOut) }
    const next = MathUtils.damp(camera2d.zoom, zoomTarget.current, 7, delta)
    if (Math.abs(next - camera2d.zoom) >= .001) { camera2d.zoom = next; camera2d.updateProjectionMatrix() }
    const orbit = controls.current
    if (!orbit) return
    // glide the swing back to the straight-on view when a room has just been entered, then hand the angle back
    const angle = angleGoal.current
    if (angle) {
      const azimuth = MathUtils.damp(orbit.getAzimuthalAngle(), angle.azimuth, 6, delta)
      const polar = MathUtils.damp(orbit.getPolarAngle(), angle.polar, 6, delta)
      orbit.setAzimuthalAngle(azimuth)
      orbit.setPolarAngle(polar)
      if (Math.abs(azimuth - angle.azimuth) < .0005 && Math.abs(polar - angle.polar) < .0005) angleGoal.current = null
    }
    const target = orbit.target
    // Fully zoomed out the user is browsing, so panning owns the target and the damping below is skipped — the
    // view stays wherever it was dragged. The GOAL is deliberately left on the room being viewed, so the moment
    // the user zooms back in the damping picks up again and carries them to its middle rather than leaving them
    // parked wherever the panning happened to end.
    if (fullyOut) { orbit.update(); return }
    const nextTarget = new Vector3(
      MathUtils.damp(target.x, targetGoal.current.x, 6, delta),
      MathUtils.damp(target.y, targetGoal.current.y, 6, delta),
      MathUtils.damp(target.z, targetGoal.current.z, 6, delta),
    )
    camera.position.add(nextTarget.clone().sub(target))
    target.copy(nextTarget)
    orbit.update()
  })

  return <OrbitControls
    ref={controls as never}
    enableRotate={mode === 'normal' && !dragZooming && !atMinZoom}
    target={[0, 3.5, 0]}
    // fully zoomed out the view is the explorer, so a drag roams the cluster instead of swinging it
    enablePan={atMinZoom}
    screenSpacePanning
    // the explorer is a map being dragged across several rooms, so the pointer covers more ground per pixel there
    // than the fine positioning a pan inside a single room is for
    panSpeed={atMinZoom ? 2 : 1}
    enableZoom={false}
    mouseButtons={{ LEFT: atMinZoom ? MOUSE.PAN : MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
    touches={{ ONE: atMinZoom ? TOUCH.PAN : TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
    enableDamping
    // Panning the explorer coasts noticeably further than a rotate does — it is a map being dragged, not a model
    // being turned, and the same stiffness that keeps rotation precise makes the drag feel like it hits a wall.
    dampingFactor={atMinZoom ? 0.055 : 0.08}
    rotateSpeed={0.55}
    minAzimuthAngle={0}
    maxAzimuthAngle={Math.PI / 2}
    minPolarAngle={0}
    maxPolarAngle={Math.PI / 2}
  />
}
