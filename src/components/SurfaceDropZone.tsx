import PlacementGrid from './PlacementGrid'
import { resolutionFor, useRoomStore } from '../store'
import { resolveSurface, surfacesForOwner, withResolution, type SurfaceId } from '../services/roomGrid'

// every surface currently hosted by a piece of furniture (desk top, cabinet top, ...) — EDIT MODE only, so NORMAL
// MODE never shows a grid or hit-box for them
export function SurfaceDropZones() {
  const { furniture, mode } = useRoomStore()
  if (mode !== 'edit') return null
  return <>{furniture.filter((item) => !item.removed).flatMap(surfacesForOwner).map((surface) => <SurfaceDropZone key={surface.id} surfaceId={surface.id} />)}</>
}

// the tabletop/shelf equivalent of Floor.tsx and Walls.tsx: a thin invisible hit-box sitting on a furniture-hosted
// PlacementSurface, using the same pointer-drag flow as the floor and walls
export default function SurfaceDropZone({ surfaceId }: { surfaceId: SurfaceId }) {
  const { furniture, selectedFurnitureId, movingFurnitureId, preview, previewDragging, moveFurniture, placeFurnitureAt, movePreview } = useRoomStore()
  const surface = resolveSurface(furniture, surfaceId)
  const selected = furniture.find((item) => item.id === selectedFurnitureId)
  if (!surface) return null
  // an inventory item being dragged in takes priority over an already-placed item that happens to be selected
  const forPreview = previewDragging && !!preview && preview.allowedSurfaces.includes(surface.type)
  const forSelected = !forPreview && !!selected && selected.movable && selected.allowedSurfaces.includes(surface.type)
  const relevant = forPreview || forSelected
  const moveTo = (point: { x: number; y: number; z: number }) => {
    if (forPreview) return movePreview([point.x, point.y, point.z], surfaceId)
    if (!selected || !forSelected) return
    if (movingFurnitureId === selected.id) moveFurniture(selected.id, [point.x, point.y, point.z], surfaceId)
  }
  return <>
    <mesh position={surface.position} rotation={surface.rotation} onPointerDown={(event) => { if (relevant) event.stopPropagation() }} onPointerMove={(event) => { if (!relevant || (forSelected && movingFurnitureId !== selected?.id)) return; event.stopPropagation(); moveTo(event.point) }} onClick={(event) => { if (!forSelected || movingFurnitureId) return; event.stopPropagation(); placeFurnitureAt(selected!.id, [event.point.x, event.point.y, event.point.z], surfaceId) }}>
      <boxGeometry args={[surface.width, surface.height, .03]} />
      <meshBasicMaterial visible={false} />
    </mesh>
    {(forPreview || (forSelected && selected?.surfaceId === surfaceId)) && <PlacementGrid surface={withResolution(surface, resolutionFor(forPreview ? preview! : selected!))} />}
  </>
}
