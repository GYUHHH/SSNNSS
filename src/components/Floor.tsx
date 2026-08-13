import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { resolutionFor, useRoomStore } from '../store'
import PlacementGrid from './PlacementGrid'
import { floorSurface, withResolution } from '../services/roomGrid'
import { floorStyleOf } from '../services/styles'

const GROUT_DIVISIONS = 5
function TileGrout() {
  const geometry = useMemo(() => {
    const lines: number[] = []; const step = floorSurface.width / GROUT_DIVISIONS
    for (let index = 0; index <= GROUT_DIVISIONS; index += 1) {
      const x = -floorSurface.width / 2 + index * step
      lines.push(x, -floorSurface.height / 2, 0, x, floorSurface.height / 2, 0, -floorSurface.width / 2, x, 0, floorSurface.width / 2, x, 0)
    }
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(lines, 3))
  }, [])
  return <lineSegments geometry={geometry} position={[0, 0.041, 0]} rotation={floorSurface.rotation}><lineBasicMaterial color="#c9bda4" transparent opacity={.55} /></lineSegments>
}

export default function Floor() {
  const { mode, furniture, selectedFurnitureId, movingFurnitureId, preview, previewDragging, floorStyle, moveFurniture, placeFurnitureAt, movePreview, moveCharacterTo } = useRoomStore()
  const selected = furniture.find((item) => item.id === selectedFurnitureId)
  const style = floorStyleOf(floorStyle)
  const moveTo = (point: { x: number; y: number; z: number }) => {
    if (previewDragging && preview?.allowedSurfaces.includes('floor')) return movePreview([point.x, 0, point.z])
    if (movingFurnitureId && selected?.id === movingFurnitureId && selected.allowedSurfaces.includes('floor')) moveFurniture(selected.id, [point.x, selected.position[1], point.z])
  }
  return <>
    <mesh receiveShadow position={[0, -0.18, 0]}><boxGeometry args={[floorSurface.width, 0.35, floorSurface.height]} /><meshStandardMaterial color="#b87945" roughness={0.82} /></mesh>
    <mesh receiveShadow position={[0, 0.01, 0]}
      onPointerDown={(event) => { if (mode === 'edit') event.stopPropagation() }}
      onPointerMove={(event) => { if (movingFurnitureId === selected?.id || (previewDragging && preview?.allowedSurfaces.includes('floor'))) { event.stopPropagation(); moveTo(event.point) } }}
      onClick={(event) => { event.stopPropagation(); if (mode === 'normal') moveCharacterTo([event.point.x, 0, event.point.z]); else if (selected?.movable && selected.allowedSurfaces.includes('floor') && !movingFurnitureId) placeFurnitureAt(selected.id, [event.point.x, 0, event.point.z], 'floor') }}
    ><boxGeometry args={[floorSurface.width, 0.05, floorSurface.height]} /><meshStandardMaterial color={style.color} roughness={style.roughness} /></mesh>
    {style.pattern === 'grout' && <TileGrout />}
    {mode === 'edit' && <PlacementGrid surface={floorSurface} />}
    {mode === 'edit' && (() => { const relevant = preview?.allowedSurfaces.includes('floor') ? preview : selected?.allowedSurfaces.includes('floor') ? selected : null; return relevant && resolutionFor(relevant) === 'subgrid2' ? <PlacementGrid surface={withResolution(floorSurface, 'subgrid2')} /> : null })()}
  </>
}
