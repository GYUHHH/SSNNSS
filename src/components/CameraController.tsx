import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { OrthographicCamera, TOUCH } from 'three'
import { useRoomStore } from '../store'

const INITIAL_AZIMUTH = Math.atan2(9.5, 10)
const AZIMUTH_LIMIT = Math.PI / 4

export default function CameraController() {
  const { camera, size } = useThree()
  const { mode } = useRoomStore()
  const compactScreen = size.width < 720 || (size.height < 520 && window.matchMedia('(pointer: coarse)').matches)

  useEffect(() => {
    const camera2d = camera as OrthographicCamera
    const baseZoom = compactScreen ? Math.max(34, Math.min(48, size.width / 10)) : 59
    camera2d.zoom = baseZoom
    camera2d.updateProjectionMatrix()
  }, [camera, compactScreen, size.width])

  return <OrbitControls
    enableRotate={mode === 'normal'}
    target={[0, 3.5, 0]}
    enablePan={false}
    enableZoom
    minZoom={32}
    maxZoom={68}
    zoomSpeed={0.8}
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
