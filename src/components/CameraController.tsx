import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { MathUtils, OrthographicCamera, TOUCH } from 'three'
import { useRoomStore } from '../store'

const INITIAL_AZIMUTH = Math.atan2(9.5, 10)
const AZIMUTH_LIMIT = Math.PI / 4
const DESKTOP_MIN_ZOOM = 42
const MOBILE_MIN_ZOOM = 30
const MAX_ZOOM = 136

export default function CameraController() {
  const { camera, gl, size } = useThree()
  const { mode } = useRoomStore()
  const zoomTarget = useRef(59)
  const touchPoints = useRef(new Map<number, [number, number]>())
  const touchStarts = useRef(new Map<number, { x: number; y: number; time: number }>())
  const pinchDistance = useRef(0)
  const lastTap = useRef({ time: 0, x: 0, y: 0 })
  const dragZoom = useRef<{ pointerId: number; startY: number; startZoom: number } | null>(null)
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
    const element = gl.domElement
    const distance = () => { const [a, b] = [...touchPoints.current.values()]; return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0 }
    const onWheel = (event: WheelEvent) => { event.preventDefault(); zoomTarget.current = MathUtils.clamp(zoomTarget.current * Math.exp(-event.deltaY * .0015), minZoom, MAX_ZOOM) }
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      const now = performance.now()
      const secondTap = compactScreen && touchPoints.current.size === 0 && now - lastTap.current.time < 320 && Math.hypot(event.clientX - lastTap.current.x, event.clientY - lastTap.current.y) < 36
      touchPoints.current.set(event.pointerId, [event.clientX, event.clientY])
      touchStarts.current.set(event.pointerId, { x: event.clientX, y: event.clientY, time: now })
      if (secondTap) {
        dragZoom.current = { pointerId: event.pointerId, startY: event.clientY, startZoom: zoomTarget.current }
        lastTap.current.time = 0
        setDragZooming(true)
        event.preventDefault(); event.stopImmediatePropagation(); element.setPointerCapture(event.pointerId)
      } else if (touchPoints.current.size === 2) pinchDistance.current = distance()
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!touchPoints.current.has(event.pointerId)) return
      touchPoints.current.set(event.pointerId, [event.clientX, event.clientY])
      if (dragZoom.current?.pointerId === event.pointerId) {
        event.preventDefault(); event.stopImmediatePropagation()
        zoomTarget.current = MathUtils.clamp(dragZoom.current.startZoom * Math.exp((dragZoom.current.startY - event.clientY) * .012), minZoom, MAX_ZOOM)
        return
      }
      if (touchPoints.current.size !== 2) return
      const next = distance()
      if (pinchDistance.current) zoomTarget.current = MathUtils.clamp(zoomTarget.current * next / pinchDistance.current, minZoom, MAX_ZOOM)
      pinchDistance.current = next
    }
    const onPointerEnd = (event: PointerEvent, cancelled = false) => {
      const point = touchPoints.current.get(event.pointerId)
      const start = touchStarts.current.get(event.pointerId)
      if (dragZoom.current?.pointerId === event.pointerId) {
        event.preventDefault(); event.stopImmediatePropagation()
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
        dragZoom.current = null
        setDragZooming(false)
      } else if (!cancelled && touchPoints.current.size === 1 && point && start && performance.now() - start.time < 350 && Math.hypot(point[0] - start.x, point[1] - start.y) < 12) {
        lastTap.current = { time: performance.now(), x: point[0], y: point[1] }
      } else if (touchPoints.current.size === 1) lastTap.current.time = 0
      touchPoints.current.delete(event.pointerId)
      touchStarts.current.delete(event.pointerId)
      pinchDistance.current = touchPoints.current.size === 2 ? distance() : 0
    }
    const onPointerCancel = (event: PointerEvent) => onPointerEnd(event, true)
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('pointerdown', onPointerDown, true)
    element.addEventListener('pointermove', onPointerMove, true)
    element.addEventListener('pointerup', onPointerEnd, true)
    element.addEventListener('pointercancel', onPointerCancel, true)
    return () => { element.removeEventListener('wheel', onWheel); element.removeEventListener('pointerdown', onPointerDown, true); element.removeEventListener('pointermove', onPointerMove, true); element.removeEventListener('pointerup', onPointerEnd, true); element.removeEventListener('pointercancel', onPointerCancel, true) }
  }, [compactScreen, gl, minZoom])

  useFrame((_, delta) => {
    const camera2d = camera as OrthographicCamera
    const next = MathUtils.damp(camera2d.zoom, zoomTarget.current, 7, delta)
    if (Math.abs(next - camera2d.zoom) < .001) return
    camera2d.zoom = next
    camera2d.updateProjectionMatrix()
  })

  return <OrbitControls
    enableRotate={mode === 'normal' && !dragZooming}
    target={[0, 3.5, 0]}
    enablePan={false}
    enableZoom={false}
    touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
    enableDamping
    dampingFactor={0.08}
    rotateSpeed={0.55}
    minAzimuthAngle={INITIAL_AZIMUTH - AZIMUTH_LIMIT}
    maxAzimuthAngle={INITIAL_AZIMUTH + AZIMUTH_LIMIT}
    minPolarAngle={Math.PI / 5}
    maxPolarAngle={Math.PI / 2 - 0.12}
  />
}
