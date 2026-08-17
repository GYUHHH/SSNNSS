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

// The straight-on view a room is entered at, derived from the default rig: the camera sits at (10, 8.5, 10) looking
// at (0, 3.5, 0), so the offset is (10, 5, 10) with radius 15 — azimuth atan2(10, 10) and polar acos(5 / 15).
const DEFAULT_AZIMUTH = Math.PI / 4
const DEFAULT_POLAR = Math.acos(1 / 3)

type FocusRoom = { position: [number, number, number]; token: number }
type ControlsRef = { target: Vector3; update: () => void; getAzimuthalAngle: () => number; setAzimuthalAngle: (value: number) => void; getPolarAngle: () => number; setPolarAngle: (value: number) => void }

export default function CameraController({ focusRoom }: { focusRoom?: FocusRoom }) {
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

  useEffect(() => {
    if (!focusRoom) return
    targetGoal.current.set(focusRoom.position[0], focusRoom.position[1] + 3.5, focusRoom.position[2])
    zoomTarget.current = baseZoom
    // whatever the explorer was left rotated or panned to, entering a room lands dead-centre on the 45° view
    angleGoal.current = { azimuth: DEFAULT_AZIMUTH, polar: DEFAULT_POLAR }
  }, [baseZoom, focusRoom?.token])

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
    const fullyOut = zoomTarget.current <= minZoom + .01
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
    // Fully zoomed out the user is browsing, so panning owns the target: follow wherever they drag instead of
    // damping back to the focused room, and keep the goal in step so zooming back in stays where they left off.
    if (fullyOut) { targetGoal.current.copy(target); orbit.update(); return }
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
    enableZoom={false}
    mouseButtons={{ LEFT: atMinZoom ? MOUSE.PAN : MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
    touches={{ ONE: atMinZoom ? TOUCH.PAN : TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
    enableDamping
    dampingFactor={0.08}
    rotateSpeed={0.55}
    minAzimuthAngle={0}
    maxAzimuthAngle={Math.PI / 2}
    minPolarAngle={0}
    maxPolarAngle={Math.PI / 2}
  />
}
