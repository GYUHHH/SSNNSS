import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MathUtils, MOUSE, OrthographicCamera, TOUCH, Vector3 } from 'three'
import { useRoomStore } from '../store'
import { keepExplorerAnimationsSmooth } from '../services/renderSync'
import { PICKER_HOLD_EVENT } from './ReactionPicker'

const DESKTOP_DETAIL_MIN_ZOOM = 42
const MOBILE_DETAIL_MIN_ZOOM = 30
// Fit the complete seven-room ring to whichever side of the viewport is tighter.
// 천장은 entryZoom(데스크톱 52) 아래로 유지 — 넘어가면 전체보기 바닥이 방 진입선 위로 올라가 버린다
const EXPLORE_MAX_ZOOM = 48
// 1보다 크면 덜 축소된다 = 한 화면에 보이는 방이 줄어든다. 이 숫자만 만지면 됨.
const EXPLORE_ZOOM_SCALE = 1.4
// 모바일은 화면이 좁아 같은 축소율이면 방이 더 작게 읽힌다 — 바닥을 이만큼 더 올린다
const MOBILE_ZOOM_LIFT = 10
const MAX_ZOOM = 220

export const isCompactScreen = (width: number, height: number) => width < 720 || (height < 520 && window.matchMedia('(pointer: coarse)').matches)
// the floor the explorer bottoms out at — the neighbour fade bands are anchored to it so raising one moves the other
export const exploreMinZoom = (width: number, height: number) => {
  const fit = Math.min(EXPLORE_MAX_ZOOM, (width / 33) * EXPLORE_ZOOM_SCALE, (height / 29) * EXPLORE_ZOOM_SCALE)
  // mobile reads too small fully zoomed out, so the floor sits MOBILE_ZOOM_LIFT higher there — capped safely under the entry
  // line (and never below the plain fit) so crossing into a room keeps firing exactly as before
  return isCompactScreen(width, height) ? Math.min(fit + MOBILE_ZOOM_LIFT, Math.max(fit, entryZoom(width, height) - 2)) : fit
}
// Where zooming in stops being a look and counts as choosing the room in the middle. The flag that locks the
// explorer flips on the very first wheel tick, far too twitchy to drop someone into a room, so the line sits a
// little above the floor — desktop 52, mobile 26. The neighbour fade is spent by exactly here, so the ring is
// already gone at the moment of entry.
export const entryZoom = (width: number, height: number) => isCompactScreen(width, height) ? 26 : 52

// the dock's discover toggle asks the camera to pull all the way out to the explorer
const EXPLORER_ZOOM_EVENT = 'explorer-zoom-out'
export const requestExplorerZoom = (centreHome = false) => window.dispatchEvent(new CustomEvent(EXPLORER_ZOOM_EVENT, { detail: centreHome }))

// Default room view: 45° around the room and 30° above the floor, at the existing radius of 15.
export const DEFAULT_CAMERA_POSITION: [number, number, number] = [15 * Math.cos(Math.PI / 6) / Math.SQRT2, 3.5 + 15 * Math.sin(Math.PI / 6), 15 * Math.cos(Math.PI / 6) / Math.SQRT2]
const DEFAULT_AZIMUTH = Math.PI / 4
const DEFAULT_POLAR = Math.PI / 3

type FocusRoom = { position: [number, number, number]; token: number; shift?: [number, number, number] }
type ControlsRef = { target: Vector3; update: () => void; getAzimuthalAngle: () => number; setAzimuthalAngle: (value: number) => void; getPolarAngle: () => number; setPolarAngle: (value: number) => void }

export default function CameraController({ focusRoom, aim }: { focusRoom?: FocusRoom; aim?: [number, number, number] | null }) {
  const { camera, gl, size } = useThree()
  const { mode } = useRoomStore()
  // 비로그인 첫 진입(로비)은 탐색기(지구본)를 펼친 채로 시작해 방들부터 보인다 — 특정 방 링크로 온
  // 방문(isVisiting)은 그 방을 보여주러 온 것이니 평소처럼 방 안에서 시작한다. 1은 minZoom 아래 아무 값:
  // 첫 프레임 damp가 곧장 탐색기 바닥으로 정착한다.
  const zoomTarget = useRef(59)
  // last frame's goal, so the band snap below can tell which way the user was winding
  const lastZoomTarget = useRef(59)
  // while now is before this, the entry line holds against further zooming out — the detent's grip
  const entryHold = useRef(0)
  const entryZoomAt = useRef(0)
  const targetGoal = useRef(new Vector3(0, 3.5, 0))
  // set while gliding back to the straight-on view after a room is entered, then cleared so the user owns the angle
  const angleGoal = useRef<{ azimuth: number; polar: number; life: number } | null>(null)
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null)
  const pinchDistance = useRef(0)
  const lastTap = useRef({ time: 0, x: 0, y: 0 })
  const dragZoom = useRef<{ identifier: number; startY: number; startZoom: number; lastX: number; lastY: number } | null>(null)
  const controls = useRef<ControlsRef | null>(null)
  const centringExplorer = useRef(false)
  // Switching explorer spaces loads another room, but it is not an entry — while this window is open the room-entry
  // framing below stays out of the way so the view lands zoomed out in the new space.
  const holdZoomedOut = useRef(0)
  const [dragZooming, setDragZooming] = useState(false)
  // the long-press reaction picker owns the pointer while it is up — the slide toward an icon must not swing
  // or zoom the camera, so every camera input is held off until the picker closes
  const [pickerHold, setPickerHold] = useState(false)
  const pickerHoldRef = useRef(false)
  useEffect(() => {
    const onHold = (event: Event) => { const held = !!(event as CustomEvent<boolean>).detail; pickerHoldRef.current = held; setPickerHold(held) }
    window.addEventListener(PICKER_HOLD_EVENT, onHold)
    return () => window.removeEventListener(PICKER_HOLD_EVENT, onHold)
  }, [])
  // fully zoomed out is the room explorer, not a room: swinging the camera there just skews the tiled
  // neighbours, so rotation is locked until the user zooms back in
  const [atMinZoom, setAtMinZoom] = useState(false)
  // the frame loop can run before React has committed, and pushing a setState every frame from useFrame both warns
  // and churns — so the flag is only published when it actually flips
  const wasAtMinZoom = useRef(false)
  const compactScreen = isCompactScreen(size.width, size.height)
  const detailMinZoom = compactScreen ? MOBILE_DETAIL_MIN_ZOOM : DESKTOP_DETAIL_MIN_ZOOM
  const minZoom = mode === 'edit' ? detailMinZoom : exploreMinZoom(size.width, size.height)
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
  // 호버 즉시 카메라를 끌면 탐색기에서 멈춰 구경하는 중에도 시점이 방을 따라다닌다(버그).
  // 조준값은 ref로만 들고 있다가, 아래 프레임 루프에서 "실제로 줌인 중일 때"만 타깃에 적용한다.
  const aimRef = useRef<typeof aim>(null)
  useEffect(() => { aimRef.current = aim }, [aim])

  // LAYOUT effect on purpose: the re-base and this camera slide must land in the same painted frame. As a plain
  // effect it ran after the browser had already painted the re-based cluster once — a single flashed frame of the
  // previous room's view on every entry.
  useLayoutEffect(() => {
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
    if (performance.now() < holdZoomedOut.current) {
      zoomTarget.current = minZoom
      entryZoomAt.current = 0
      targetGoal.current.set(0, 3.5, 0)
      centringExplorer.current = true
      return
    }
    targetGoal.current.set(focusRoom.position[0], focusRoom.position[1] + 3.5, focusRoom.position[2])
    // Entry is the user's own zoom-in now, so the standard framing is a floor rather than an override — forcing
    // the zoom back to it would fight the wheel that is still turning. Wind past it and the extra is kept.
    const enteringFromExplorer = !shift && focusRoom.position.some((value) => Math.abs(value) > .01)
    entryZoomAt.current = enteringFromExplorer ? performance.now() + 320 : 0
    if (!enteringFromExplorer) zoomTarget.current = Math.max(zoomTarget.current, baseZoom)
    // whatever the explorer was left rotated or panned to, entering a room lands dead-centre on the 45° view
    angleGoal.current = { azimuth: DEFAULT_AZIMUTH, polar: DEFAULT_POLAR, life: 2 }
  // This is a ROOM-ENTRY effect, not a mode-change effect. Edit mode has a different minimum zoom; keeping
  // minZoom/baseZoom in this dependency list replayed the entry angle animation whenever editing opened or
  // closed, making the unchanged room sweep in from the side. A fresh focus token is the only valid trigger.
  }, [camera, focusRoom?.token])

  useEffect(() => { zoomTarget.current = Math.max(zoomTarget.current, minZoom) }, [minZoom])
  useEffect(() => {
    const onZoomOut = (event: Event) => {
      zoomTarget.current = minZoom
      holdZoomedOut.current = performance.now() + 900
      if (!(event as CustomEvent<boolean>).detail) return
      targetGoal.current.set(0, 3.5, 0)
      centringExplorer.current = true
    }
    window.addEventListener(EXPLORER_ZOOM_EVENT, onZoomOut)
    return () => window.removeEventListener(EXPLORER_ZOOM_EVENT, onZoomOut)
  }, [minZoom])

  useEffect(() => {
    // the canvas is pointer-transparent (clicks reach wall-video iframes behind it) — real pointer targets
    // become the .canvas-host wrapper, so wheel/touch must listen there
    const element = (gl.domElement.closest('.canvas-host') ?? gl.domElement) as HTMLElement
    const distance = (touches: TouchList) => touches.length < 2 ? 0 : Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
    const onWheel = (event: WheelEvent) => { event.preventDefault(); if (pickerHoldRef.current) return; zoomTarget.current = MathUtils.clamp(zoomTarget.current * Math.exp(-event.deltaY * .0015), minZoom, MAX_ZOOM) }
    const onTouchStart = (event: TouchEvent) => {
      if (pickerHoldRef.current) return
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
      if (pickerHoldRef.current) return
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
    if (entryZoomAt.current && performance.now() >= entryZoomAt.current) {
      entryZoomAt.current = 0
      zoomTarget.current = Math.max(zoomTarget.current, baseZoom)
    }
    // The stretch between the explorer floor and the entry line is a hallway, not a place: nothing useful lives at
    // zoom 43. So the GOAL is never allowed to settle there — any input that lands it inside the band is carried
    // to whichever end it was heading for, and the camera glides through in one motion: wind out of a room and it
    // runs all the way down to the explorer, wind in from the explorer and it runs all the way into the room. The
    // camera's actual zoom still passes through the band smoothly, so entry and the fades fire exactly as before.
    if (mode === 'normal' && zoomTarget.current !== lastZoomTarget.current) {
      const entry = entryZoom(size.width, size.height)
      if (zoomTarget.current > minZoom + .01 && zoomTarget.current < entry - .01) {
        if (zoomTarget.current > lastZoomTarget.current) zoomTarget.current = Math.max(baseZoom, entry)
        // Zooming out has a detent AT the entry line: the first pull out of a room rests there, and only pulling
        // again carries on down to the explorer where the ring gathers. The hold is timed rather than a flag
        // because trackpads and pinches stream deltas continuously — without the grace period one smooth gesture
        // would touch the stop for a single frame and blow straight through it.
        else if (lastZoomTarget.current > entry + .01) { zoomTarget.current = entry; entryHold.current = performance.now() + 1000 }
        else zoomTarget.current = performance.now() < entryHold.current ? entry : minZoom
      }
    }
    lastZoomTarget.current = zoomTarget.current
    // 고른 방을 중앙으로 당기는 조준은 줌 목표가 진입선을 향할 때만 — 탐색기 바닥에서 쉬거나(호버만),
    // 줌아웃 중이거나, 지도를 드래그하는 동안엔 시점이 호버를 따라가면 안 된다.
    if (aimRef.current && mode === 'normal' && zoomTarget.current >= entryZoom(size.width, size.height) - .01) {
      targetGoal.current.set(aimRef.current[0], aimRef.current[1] + 3.5, aimRef.current[2])
    }
    // Only in normal mode. Edit mode has its OWN, much higher floor, and on a phone the default zoom sits exactly
    // on it — so this read as "fully zoomed out", switched panning on, and a one-finger drag shoved the room away
    // while the user was arranging furniture.
    const fullyOut = mode === 'normal' && zoomTarget.current <= minZoom + .01
    // the DOM chrome lives on another React root, so the explorer state travels as a body class for CSS to fade on
    if (fullyOut !== wasAtMinZoom.current) { wasAtMinZoom.current = fullyOut; setAtMinZoom(fullyOut); document.body.classList.toggle('exploring', fullyOut) }
    // the glide through the explorer band is the room-to-explorer transition itself, so it gets a gentler pace
    // than ordinary zooming — inside the band only, everything else keeps the usual snap
    const inBand = mode === 'normal' && camera2d.zoom < entryZoom(size.width, size.height) && camera2d.zoom > minZoom + .01
    const next = MathUtils.damp(camera2d.zoom, zoomTarget.current, inBand ? 4.5 : 7, delta)
    if (Math.abs(next - camera2d.zoom) >= .001) { camera2d.zoom = next; camera2d.updateProjectionMatrix() }
    const orbit = controls.current
    if (!orbit) return
    // glide the swing back to the straight-on view when a room has just been entered, then hand the angle back
    const angle = angleGoal.current
    if (angle) {
      // The goal is handed over whole and OrbitControls eases into it on its own. Damping toward it here as well
      // was a trap: with enableDamping, setAzimuthalAngle applies only dampingFactor — 8% — of what it is given,
      // so damping first and then losing 92% of that moved the angle 0.74% a frame. Converging to the old
      // half-thousandth threshold at that rate took about fifteen seconds, and for all fifteen the angle was being
      // rewritten every frame, which is a camera that will not turn. `life` is the backstop: whatever a future
      // version of these setters does, the hold expires.
      angle.life -= delta
      orbit.setAzimuthalAngle(angle.azimuth)
      orbit.setPolarAngle(angle.polar)
      if (angle.life <= 0 || (Math.abs(orbit.getAzimuthalAngle() - angle.azimuth) < .002 && Math.abs(orbit.getPolarAngle() - angle.polar) < .002)) angleGoal.current = null
    }
    const target = orbit.target
    // Fully zoomed out the user is browsing, so panning owns the target and the damping below is skipped — the
    // view stays wherever it was dragged. The GOAL is deliberately left on the room being viewed, so the moment
    // the user zooms back in the damping picks up again and carries them to its middle rather than leaving them
    // parked wherever the panning happened to end.
    if (fullyOut && !centringExplorer.current) { orbit.update(); return }
    const targetDamping = entryZoomAt.current ? 14 : 6
    const nextTarget = new Vector3(
      MathUtils.damp(target.x, targetGoal.current.x, targetDamping, delta),
      MathUtils.damp(target.y, targetGoal.current.y, targetDamping, delta),
      MathUtils.damp(target.z, targetGoal.current.z, targetDamping, delta),
    )
    camera.position.add(nextTarget.clone().sub(target))
    target.copy(nextTarget)
    if (centringExplorer.current && target.distanceTo(targetGoal.current) < .005) centringExplorer.current = false
    orbit.update()
  })

  return <OrbitControls
    ref={controls as never}
    enabled={!pickerHold}
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
    onChange={() => keepExplorerAnimationsSmooth(350)}
    // Panning the explorer coasts noticeably further than a rotate does — it is a map being dragged, not a model
    // being turned, and the same stiffness that keeps rotation precise makes the drag feel like it hits a wall.
    dampingFactor={atMinZoom ? 0.06 : 0.08}
    rotateSpeed={compactScreen ? 0.85 : 0.55}
    minAzimuthAngle={0}
    maxAzimuthAngle={Math.PI / 2}
    minPolarAngle={0}
    maxPolarAngle={Math.PI / 2}
  />
}
