import { ContactShadows, OrthographicCamera } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { useRoomStore } from '../store'
import Bookshelf from './Bookshelf'
import Bed from './Bed'
import CameraController from './CameraController'
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

// per-time-of-day lighting: night keeps lights low so lit lamps visibly carry the room
const LIGHTING = {
  day: { bg: '#f4efe6', ambient: 2.1, ambientColor: '#ffe6bd', dir: 2.4, dirColor: '#ffe0a9' },
  evening: { bg: '#e9d3bc', ambient: 1.3, ambientColor: '#ffc894', dir: 1.7, dirColor: '#ff9a5e' },
  night: { bg: '#232939', ambient: 0.5, ambientColor: '#8b97b8', dir: 0.35, dirColor: '#aab4d4' },
} as const

function Scene() {
  const { clearSelection, mode, toggleEditMode, timeOfDay } = useRoomStore()
  const light = LIGHTING[timeOfDay]
  return <Canvas shadows="basic" dpr={[1, 2]} gl={{ antialias: true }} onPointerMissed={(event) => { if ((event.target as HTMLElement)?.tagName !== 'CANVAS') return; (mode === 'edit' ? toggleEditMode : clearSelection)() }} camera={{ position: [9.5, 8.5, 10] }}>
    <color attach="background" args={[light.bg]} />
    <OrthographicCamera makeDefault position={[9.5, 8.5, 10]} zoom={59} near={0.1} far={100} />
    <ambientLight intensity={light.ambient} color={light.ambientColor} />
    <directionalLight castShadow position={[4, 8, 5]} intensity={light.dir} color={light.dirColor} shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <Suspense fallback={null}>
      <Floor /><Walls /><Bookshelf /><Desk /><Chair /><Computer /><Cup /><Sofa /><Bed /><Decor /><InventoryFurniture /><InventoryPreview /><SurfaceDropZones /><Character /><CameraController /><DebugAnchors /><WallVideoLayer />
      <ContactShadows position={[0, 0.018, 0]} opacity={0.38} scale={9} blur={2.4} far={2.2} resolution={1024} />
    </Suspense>
  </Canvas>
}

export default function Room() { return <Scene /> }
