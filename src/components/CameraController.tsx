import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { OrthographicCamera } from 'three'
import { useRoomStore } from '../store'

const INITIAL_AZIMUTH = Math.atan2(9.5, 10)
const AZIMUTH_LIMIT = Math.PI / 4

export default function CameraController() {
  const { camera, size } = useThree()
  const { mode } = useRoomStore()
  const zoomOffset = useRef(0)
  const compactScreen = size.width < 720 || (size.height < 520 && window.matchMedia('(pointer: coarse)').matches)

  useEffect(() => {
    const camera2d = camera as OrthographicCamera
    const baseZoom = compactScreen ? Math.max(34, Math.min(48, size.width / 10)) : 59
    camera2d.zoom = Math.max(32, Math.min(68, baseZoom + zoomOffset.current))
    camera2d.updateProjectionMatrix()
  }, [camera, compactScreen, size.width])

  useEffect(() => {
    const zoom = (event: Event) => {
      const camera2d = camera as OrthographicCamera
      zoomOffset.current += (event as CustomEvent<number>).detail
      camera2d.zoom = Math.max(32, Math.min(68, camera2d.zoom + (event as CustomEvent<number>).detail))
      camera2d.updateProjectionMatrix()
    }
    window.addEventListener('room-zoom', zoom)
    return () => window.removeEventListener('room-zoom', zoom)
  }, [camera])

  return <OrbitControls
    enabled={mode === 'normal'}
    target={[0, 3.5, 0]}
    enablePan={false}
    enableZoom={false}
    enableDamping
    dampingFactor={0.08}
    rotateSpeed={0.55}
    minAzimuthAngle={INITIAL_AZIMUTH - AZIMUTH_LIMIT}
    maxAzimuthAngle={INITIAL_AZIMUTH + AZIMUTH_LIMIT}
    minPolarAngle={Math.PI / 5}
    maxPolarAngle={Math.PI / 2 - 0.12}
  />
}
