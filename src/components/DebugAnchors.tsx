import { useRoomStore } from '../store'
import { interactionAnchorsFor, localAnchorToWorld } from '../services/interactionAnchors'
import { GRID_SIZE } from '../services/roomGrid'

const DEBUGGED_TYPES = new Set(['bed', 'sofa', 'chair'])

export default function DebugAnchors() {
  const { debugAnchors, furniture } = useRoomStore()
  if (!debugAnchors) return null
  return <>{furniture.filter((item) => DEBUGGED_TYPES.has(item.type) && !item.removed).map((item) => {
    const anchors = interactionAnchorsFor(item)
    const approach = localAnchorToWorld(item, anchors.approach)
    const action = localAnchorToWorld(item, anchors.action)
    const [w, d] = [item.footprint.width * GRID_SIZE, item.footprint.depth * GRID_SIZE]
    return <group key={item.id}>
      <mesh position={approach.position}><sphereGeometry args={[.07, 10, 8]} /><meshBasicMaterial color="#3b82f6" /></mesh>
      <mesh position={action.position}><sphereGeometry args={[.07, 10, 8]} /><meshBasicMaterial color="#e04848" /></mesh>
      <mesh position={[item.position[0], .02, item.position[2]]} rotation={[-Math.PI / 2, 0, item.rotation[1]]}><planeGeometry args={[w, d]} /><meshBasicMaterial color="#f2c46d" transparent opacity={.25} depthWrite={false} /></mesh>
    </group>
  })}</>
}
