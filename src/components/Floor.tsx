import { useEffect, useMemo } from 'react'
import { type ThreeEvent } from '@react-three/fiber'
import { SRGBColorSpace, TextureLoader } from 'three'
import { resolutionFor, useRoomStore } from '../store'
import PlacementGrid, { gridAreaFor } from './PlacementGrid'
import { floorSurface, withResolution } from '../services/roomGrid'
import { floorStyleOf } from '../services/styles'

type FloorEvents = { onPointerDown: (event: ThreeEvent<PointerEvent>) => void; onPointerMove: (event: ThreeEvent<PointerEvent>) => void; onClick: (event: ThreeEvent<MouseEvent>) => void }

function FloorImage({ source, roughness, events }: { source: string; roughness: number; events: FloorEvents }) {
  const texture = useMemo(() => { const value = new TextureLoader().load(source); value.colorSpace = SRGBColorSpace; return value }, [source])
  useEffect(() => () => texture.dispose(), [texture])
  return <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, .001, 0]} {...events}><planeGeometry args={[floorSurface.width, floorSurface.height]} /><meshStandardMaterial map={texture} roughness={roughness} /></mesh>
}

export default function Floor() {
  const { readOnly, mode, furniture, selectedFurnitureId, movingFurnitureId, preview, previewDragging, floorStyle, floorImage, moveFurniture, placeFurnitureAt, movePreview, moveCharacterTo } = useRoomStore()
  const selected = furniture.find((item) => item.id === selectedFurnitureId)
  const style = floorStyleOf(floorStyle)
  const moveTo = (point: { x: number; y: number; z: number }) => {
    if (previewDragging && preview?.allowedSurfaces.includes('floor')) return movePreview([point.x, 0, point.z])
    if (movingFurnitureId && selected?.id === movingFurnitureId && selected.allowedSurfaces.includes('floor')) moveFurniture(selected.id, [point.x, selected.position[1], point.z])
  }
  const events: FloorEvents = {
    onPointerDown: (event) => { if (!readOnly && mode === 'edit') event.stopPropagation() },
    onPointerMove: (event) => { if (readOnly) return; if (movingFurnitureId === selected?.id || (previewDragging && preview?.allowedSurfaces.includes('floor'))) { event.stopPropagation(); moveTo(event.point) } },
    onClick: (event) => { if (readOnly || event.delta > 10) return; event.stopPropagation(); if (mode === 'normal') moveCharacterTo([event.point.x, 0, event.point.z]); else if (selected?.movable && selected.allowedSurfaces.includes('floor') && !movingFurnitureId) placeFurnitureAt(selected.id, [event.point.x, 0, event.point.z], 'floor') },
  }
  return <>
    <mesh receiveShadow position={[0, -0.11, 0]} {...events}><boxGeometry args={[floorSurface.width, 0.22, floorSurface.height]} /><meshStandardMaterial color={style.color} roughness={style.roughness} /></mesh>
    {floorImage && <FloorImage source={floorImage} roughness={style.roughness} events={events} />}
    {mode === 'edit' && (() => {
      const relevant = preview?.allowedSurfaces.includes('floor') ? preview : selected?.allowedSurfaces.includes('floor') ? selected : null
      if (!relevant) return null
      return <PlacementGrid surface={withResolution(floorSurface, resolutionFor(relevant))} area={gridAreaFor(relevant)} />
    })()}
  </>
}
