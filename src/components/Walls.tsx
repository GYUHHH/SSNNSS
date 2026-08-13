import Furniture from './Furniture'
import PlacementGrid from './PlacementGrid'
import { useRoomStore } from '../store'
import { type WallId, wallSurfaces } from '../services/roomGrid'
import { palette } from '../services/palette'
import { colorOf } from '../services/styles'
import { useArtTexture } from './ArtEditor'

const DEFAULT_WALL_COLOR: Record<WallId, string> = { leftWall: '#f1dfc4', rightWall: '#f8e9d1' }

export default function Walls() {
  const { mode, furniture, selectedFurnitureId, movingFurnitureId, preview, previewDragging, wallStyle, moveFurniture, placeFurnitureAt, movePreview, openStyleTarget } = useRoomStore()
  const selected = furniture.find((item) => item.id === selectedFurnitureId)
  const activeWall = selected?.wallId ?? preview?.wallId ?? null
  const posterArt = useArtTexture('poster')
  const photoArt = useArtTexture('photo')
  const moveTo = (wallId: WallId, point: { x: number; y: number; z: number }) => {
    if (previewDragging && preview?.allowedSurfaces.includes('wall')) return movePreview([point.x, point.y, point.z], wallId)
    if (movingFurnitureId && selected?.id === movingFurnitureId && selected.allowedSurfaces.includes('wall')) moveFurniture(selected.id, [point.x, point.y, point.z], wallId)
  }
  return <>
    {(Object.values(wallSurfaces) as typeof wallSurfaces[WallId][]).map((wall) => <mesh key={wall.id} receiveShadow position={[wall.position[0] - wall.normal[0] * .11, wall.position[1] - wall.normal[1] * .11, wall.position[2] - wall.normal[2] * .11]} rotation={wall.rotation}
      onPointerDown={(event) => { if (mode === 'edit') event.stopPropagation() }}
      onPointerMove={(event) => { if (movingFurnitureId === selected?.id || (previewDragging && preview?.allowedSurfaces.includes('wall'))) { event.stopPropagation(); moveTo(wall.id as WallId, event.point) } }}
      onClick={(event) => { event.stopPropagation(); if (mode === 'normal') openStyleTarget({ kind: 'wall', wallId: wall.id as WallId }); else if (selected?.movable && selected.allowedSurfaces.includes('wall') && !movingFurnitureId) placeFurnitureAt(selected.id, [event.point.x, event.point.y, event.point.z], wall.id) }}
    ><boxGeometry args={[wall.width, wall.height, .22]} /><meshStandardMaterial color={colorOf(wallStyle[wall.id as WallId], DEFAULT_WALL_COLOR[wall.id as WallId])} /></mesh>)}
    {mode === 'edit' && activeWall && <PlacementGrid surface={wallSurfaces[activeWall]} />}
    <Furniture id="clock"><mesh position={[0, 0, .05]}><torusGeometry args={[.6, .1, 8, 20]} /><meshStandardMaterial color={palette.woodDark} roughness={0.7} /></mesh><mesh position={[0, 0, .06]}><circleGeometry args={[.52, 20]} /><meshStandardMaterial color={palette.linen} roughness={0.85} /></mesh><mesh position={[0, 0, .08]}><boxGeometry args={[.04, .42, .02]} /><meshStandardMaterial color={palette.charcoal} roughness={0.7} /></mesh></Furniture>
    <Furniture id="poster"><mesh position={[0, 0, .04]}><boxGeometry args={[1.4, 2.1, .03]} /><meshStandardMaterial color={palette.woodMid} roughness={0.7} /></mesh><mesh position={[0, 0, .065]}><planeGeometry args={[1.2, 1.85]} /><meshStandardMaterial key={posterArt ? 'art' : 'plain'} color={posterArt ? '#ffffff' : palette.sage} map={posterArt ?? undefined} roughness={0.85} /></mesh></Furniture>
    <Furniture id="photo"><mesh position={[0, 0, .04]}><boxGeometry args={[.7, .7, .03]} /><meshStandardMaterial color={palette.woodDark} roughness={0.7} /></mesh><mesh position={[0, 0, .065]}><planeGeometry args={[.58, .42]} /><meshStandardMaterial key={photoArt ? 'art' : 'plain'} color={photoArt ? '#ffffff' : palette.rust} map={photoArt ?? undefined} roughness={0.85} /></mesh></Furniture>
  </>
}
