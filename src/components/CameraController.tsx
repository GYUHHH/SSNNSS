import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { MathUtils, OrthographicCamera, TOUCH } from 'three'
import { useRoomStore } from '../store'

const DESKTOP_MIN_ZOOM = 42
const MOBILE_MIN_ZOOM = 30
const MAX_ZOOM = 220

export default function CameraController() {
  const { camera, gl, size } = useThree()
  const { mode } = useRoomStore()
  const zoomTarget = useRef(59)
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null)
  const pinchDistance = useRef(0)
  const lastTap = useRef({ time: 0, x: 0, y: 0 })
  const dragZoom = useRef<{ identifier: number; startY: number; startZoom: number; lastX: number; lastY: number } | null>(null)
  const controls = useRef<{ getAzimuthalAngle: () => number; setAzimuthalAngle: (value: number) => void; getPolarAngle: () => number; setPolarAngle: (value: number) => void } | null>(null)
  const [dragZooming, setDragZooming] = useState(false)
  const compactScreen = size.width < 720 || (size.height < 520 && window.matchMedia('(pointer: coarse)').matches)
  const minZoom = compactScreen ? MOBILE_MIN_ZOOM : DESKTOP_MIN_ZOOM

  useEffect(() => {
    const camera2d = camera as OrthographicCamera
    const baseZoom = compactScreen ? MOBILE_MIN_ZOOM : 59
    camera2d.zoom = zoomTarget.current = baseZoom
    camera2d.updateProjectionMatrix()
  }, [camera, compactScreen, size.width])

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
      if (controls.current) controls.current.setAzimuthalAngle(MathUtils.clamp(controls.current.getAzimuthalAngle() - dx * .027, 0, Math.PI / 2))
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
    const next = MathUtils.damp(camera2d.zoom, zoomTarget.current, 7, delta)
    if (Math.abs(next - camera2d.zoom) < .001) return
    camera2d.zoom = next
    camera2d.updateProjectionMatrix()
  })

  return <OrbitControls
    ref={controls as never}
    enableRotate={mode === 'normal' && !dragZooming}
    target={[0, 3.5, 0]}
    enablePan={false}
    enableZoom={false}
    touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
    enableDamping
    dampingFactor={0.08}
    rotateSpeed={0.55}
    minAzimuthAngle={0}
    maxAzimuthAngle={Math.PI / 2}
    minPolarAngle={0}
    maxPolarAngle={Math.PI / 2}
  />
}
