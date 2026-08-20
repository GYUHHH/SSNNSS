import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { Box3, type Group, type Mesh, type Object3D, Vector3 } from 'three'
import Interactive from './Interactive'
import { type FurnitureId, type FurnitureItem, resolutionFor, useRoomStore } from '../store'
import { fitMeshToFootprint, resolveSurface, wallSurfaces, withResolution } from '../services/roomGrid'

// Every room in the explorer names its furniture identically — each one has a `desk` — so a scene-wide lookup for
// `fit:<id>` can land on a NEIGHBOUR's copy and drag whatever follows it outside the room. Search only inside the
// room the caller itself sits in: climb to the group the scene holds directly, which is that room, and look there.
export const findFit = (from: Object3D, scene: Object3D, id: string) => {
  let room = from
  while (room.parent && room.parent !== scene) room = room.parent
  return room.getObjectByName(`fit:${id}`)
}

export default function Furniture({ id, children }: { id: FurnitureId; children: ReactNode }) {
  const { furniture, mode } = useRoomStore()
  const item = furniture.find((value) => value.id === id)
  if (!item || item.removed) return null
  const fitted = <FittedMesh item={item}>{children}</FittedMesh>
  const content = item.category === 'wallItem' ? <group rotation={wallSurfaces[item.wallId ?? 'leftWall'].rotation}><group rotation={[0, 0, item.rotation[1]]}>{fitted}</group></group> : fitted
  if (mode === 'normal') return <Interactive id={id} position={item.position} rotation={item.category === 'wallItem' ? [0, 0, 0] : item.rotation} scale={item.scale} pad={id !== 'bookshelf' && item.type !== 'speech-bubble'}>{content}</Interactive>
  return <EditableFurniture id={id}>{content}</EditableFurniture>
}

export function FittedMesh({ item, children }: { item: FurnitureItem; children: ReactNode }) {
  const { furniture } = useRoomStore()
  const group = useRef<Group>(null)
  useLayoutEffect(() => {
    if (!group.current || !item.footprint.width) return
    const surface = resolveSurface(furniture, item.surfaceId); if (!surface) return
    group.current.scale.set(1, 1, 1); group.current.updateWorldMatrix(true, true)
    const bounds = new Box3(); const inverse = group.current.matrixWorld.clone().invert()
    group.current.traverse((child) => { const mesh = child as Mesh; if (!mesh.isMesh || mesh.userData.excludeFromFit) return; mesh.geometry.computeBoundingBox(); if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse)) })
    // size against the item's OWN grid resolution: a subgrid2 item's cell is 0.35 on every surface (incl. floor),
    // so its rendered size never changes when moved between floor and tabletop
    const size = bounds.getSize(new Vector3()); const [width, height] = fitMeshToFootprint(withResolution(surface, resolutionFor(item)), item.footprint)
    // Portable props keep one scale on every axis. Scaling only X/Z made cups, plants, books, etc. look
    // squashed after placement even though their footprint was correct.
    const uniformScale = Math.min(width / size.x, height / size.z)
    const fitted: [number, number, number] = (surface.type !== 'wall'
      ? resolutionFor(item) === 'subgrid2'
        ? [uniformScale, uniformScale, uniformScale]
        : [width / size.x, 1, height / size.z]
      : item.type === 'wall-shelf'
        ? [width / size.x, 1, 1]
        : [width / size.x, height / size.y, 1])
    group.current.scale.set(...fitted)
    group.current.position.z = item.category === 'wallItem' ? .012 - bounds.min.z : 0
  }, [item.surfaceId, item.footprint.width, item.footprint.depth, item.rotation[1]])
  return <group ref={group} name={`fit:${item.id}`}>{children}</group>
}

function EditableFurniture({ id, children }: { id: FurnitureId; children: ReactNode }) {
  const { readOnly, furniture, selectedFurnitureId, movingFurnitureId, selectFurniture, beginMove } = useRoomStore()
  const item = furniture.find((value) => value.id === id)!
  const selected = selectedFurnitureId === id
  const surface = resolveSurface(furniture, item.surfaceId)
  const [width, height] = surface ? fitMeshToFootprint(withResolution(surface, resolutionFor(item)), item.footprint) : [0, 0]
  return <group position={item.position} rotation={item.category === 'wallItem' ? [0, 0, 0] : item.rotation} scale={item.scale}
    onPointerDown={(event) => { if (readOnly) return; event.stopPropagation(); selectFurniture(id); beginMove(id) }}
    onClick={(event) => { if (!readOnly) event.stopPropagation() }}>
    {children}
    {selected && movingFurnitureId !== id && item.category !== 'wallItem' && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}><ringGeometry args={[Math.max(width, height) * .22, Math.max(width, height) * .3, 28]} /><meshBasicMaterial color="#fff2a5" transparent opacity={0.9} /></mesh>}
  </group>
}
