import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils, OrthographicCamera, TOUCH } from 'three'
import { useRoomStore } from '../store'

const INITIAL_AZIMUTH = Math.atan2(9.5, 10)
const AZIMUTH_LIMIT = Math.PI / 4
const MIN_ZOOM = 42
const MAX_ZOOM = 136

export default function CameraController() {
  const { camera, gl, size } = useThree()
  const { mode } = useRoomStore()
  const zoomTarget = useRef(59)
  const touchPoints = useRef(new Map<number, [number, number]>())
  const pinchDistance = useRef(0)
  const compactScreen = size.width < 720 || (size.height < 520 && window.matchMedia('(pointer: coarse)').matches)

  useEffect(() => {
    const camera2d = camera as OrthographicCamera
    const baseZoom = compactScreen ? Math.max(34, Math.min(48, size.width / 10)) : 59
    camera2d.zoom = zoomTarget.current = MathUtils.clamp(baseZoom, MIN_ZOOM, MAX_ZOOM)
    camera2d.updateProjectionMatrix()
  }, [camera, compactScreen, size.width])

  useEffect(() => {
    const element = gl.domElement
    const distance = () => { const [a, b] = [...touchPoints.current.values()]; return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0 }
    const onWheel = (event: WheelEvent) => { event.preventDefault(); zoomTarget.current = MathUtils.clamp(zoomTarget.current * Math.exp(-event.deltaY * .0015), MIN_ZOOM, MAX_ZOOM) }
    const onPointerDown = (event: PointerEvent) => { if (event.pointerType !== 'touch') return; touchPoints.current.set(event.pointerId, [event.clientX, event.clientY]); if (touchPoints.current.size === 2) pinchDistance.current = distance() }
    const onPointerMove = (event: PointerEvent) => { if (!touchPoints.current.has(event.pointerId)) return; touchPoints.current.set(event.pointerId, [event.clientX, event.clientY]); if (touchPoints.current.size !== 2) return; const next = distance(); if (pinchDistance.current) zoomTarget.current = MathUtils.clamp(zoomTarget.current * next / pinchDistance.current, MIN_ZOOM, MAX_ZOOM); pinchDistance.current = next }
    const onPointerEnd = (event: PointerEvent) => { touchPoints.current.delete(event.pointerId); pinchDistance.current = touchPoints.current.size === 2 ? distance() : 0 }
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', onPointerEnd)
    element.addEventListener('pointercancel', onPointerEnd)
    return () => { element.removeEventListener('wheel', onWheel); element.removeEventListener('pointerdown', onPointerDown); element.removeEventListener('pointermove', onPointerMove); element.removeEventListener('pointerup', onPointerEnd); element.removeEventListener('pointercancel', onPointerEnd) }
  }, [gl])

  useFrame((_, delta) => {
    const camera2d = camera as OrthographicCamera
    const next = MathUtils.damp(camera2d.zoom, zoomTarget.current, 7, delta)
    if (Math.abs(next - camera2d.zoom) < .001) return
    camera2d.zoom = next
    camera2d.updateProjectionMatrix()
  })

  return <OrbitControls
    enableRotate={mode === 'normal'}
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
