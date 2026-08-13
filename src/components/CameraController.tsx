import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { OrthographicCamera, Vector3 } from 'three'
import { useRoomStore } from '../store'

const roomView = { position: [9.5, 8.5, 10], target: [0, 3.5, 0] }

export default function CameraController() {
  const { camera, pointer } = useThree()
  const { mode } = useRoomStore()
  const lookAt = useRef(new Vector3(0, 3.5, 0))
  const destination = useRef(new Vector3())

  useEffect(() => {
    const zoom = (event: Event) => {
      const camera2d = camera as OrthographicCamera
      camera2d.zoom = Math.max(40, Math.min(68, camera2d.zoom + (event as CustomEvent<number>).detail))
      camera2d.updateProjectionMatrix()
    }
    window.addEventListener('room-zoom', zoom)
    return () => window.removeEventListener('room-zoom', zoom)
  }, [camera])

  useFrame((_, delta) => {
    destination.current.set(roomView.position[0], roomView.position[1], roomView.position[2])
    if (mode === 'normal') destination.current.add(new Vector3(pointer.x * 0.22, pointer.y * 0.12, 0))
    camera.position.lerp(destination.current, 1 - Math.exp(-3.8 * delta))
    lookAt.current.lerp(new Vector3(roomView.target[0], roomView.target[1], roomView.target[2]), 1 - Math.exp(-4.5 * delta))
    camera.lookAt(lookAt.current)
  })
  return null
}
