import { ContactShadows, OrthographicCamera } from '@react-three/drei'
import { Canvas, events } from '@react-three/fiber'
import { Suspense, useRef } from 'react'
import { useRoomStore } from '../store'
import Bookshelf from './Bookshelf'
import Bed from './Bed'
import CameraController from './CameraController'
import Neighbourhood from './Neighbourhood'
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
import ReactionBadges from './ReactionBadges'

// per-time-of-day lighting: night keeps lights low so lit lamps visibly carry the room
const LIGHTING = {
  day: { bg: '#f4efe6', ambient: 2.1, ambientColor: '#fff7ee', dir: 2.4, dirColor: '#fff3e2' },
  evening: { bg: '#e9d3bc', ambient: 1.3, ambientColor: '#ffc894', dir: 1.7, dirColor: '#ff9a5e' },
  night: { bg: '#232939', ambient: 0.5, ambientColor: '#8b97b8', dir: 0.35, dirColor: '#aab4d4' },
} as const

// Pointer coords are computed from the canvas's LIVE on-screen rect — the scene slides 240px left while a
// panel is open, and the default client-coordinate mapping would leave every click/hover offset by that shift.
const shiftAwareEvents: NonNullable<Parameters<typeof Canvas>[0]['events']> = (store) => ({
  ...events(store),
  compute(event, state) {
    const rect = state.gl.domElement.getBoundingClientRect()
    state.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    state.raycaster.setFromCamera(state.pointer, state.camera)
  },
})

function Scene() {
  const { clearSelection, mode, toggleEditMode, timeOfDay } = useRoomStore()
  const light = LIGHTING[timeOfDay]
  // Blending occlusion for wall videos: the canvas is transparent and drawn over the video DOM, punching a
  // depth-tested hole where a frame's screen is — furniture in front of the frame covers its video for real.
  // Scene events re-route to this host (with client coords) because the canvas itself is pointer-transparent
  // so clicks over a video can fall through into the iframe. The room background moves to the host's CSS.
  const eventHost = useRef<HTMLDivElement>(null!)
  return <div ref={eventHost} className="canvas-host" style={{ background: light.bg }}><Canvas shadows="basic" dpr={[1, 2]} gl={{ antialias: true }} eventSource={eventHost} events={shiftAwareEvents} onPointerMissed={(event) => { if (!(event.target as HTMLElement)?.closest?.('.canvas-host')) return; (mode === 'edit' ? toggleEditMode : clearSelection)() }} camera={{ position: [9.5, 8.5, 10] }}>
    <OrthographicCamera makeDefault position={[9.5, 8.5, 10]} zoom={59} near={0.1} far={100} />
    <ambientLight intensity={light.ambient} color={light.ambientColor} />
    <directionalLight castShadow position={[4, 8, 5]} intensity={light.dir} color={light.dirColor} shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <Suspense fallback={null}>
      <Floor /><Walls /><Bookshelf /><Desk /><Chair /><Computer /><Cup /><Sofa /><Bed /><Decor /><InventoryFurniture /><InventoryPreview /><SurfaceDropZones /><Character /><CameraController /><DebugAnchors /><WallVideoLayer /><ReactionBadges /><Neighbourhood />
      <ContactShadows position={[0, 0.018, 0]} opacity={0.38} scale={9} blur={2.4} far={2.2} resolution={1024} />
    </Suspense>
  </Canvas></div>
}

export default function Room() { return <Scene /> }
