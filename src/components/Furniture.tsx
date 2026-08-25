import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, useCursor } from '@react-three/drei'
import { Box3, BufferGeometry, Float32BufferAttribute, type Group, type Mesh, type Object3D, type OrthographicCamera, Plane, Vector3 } from 'three'
import Interactive from './Interactive'
import { GLB_TYPES, onGlbReady } from './GlbFurniture'
import { clampModelScale } from '../customObjectSpec'
import { type FurnitureId, type FurnitureItem, isResizableWallItem, resolutionFor, useRoomStore } from '../store'
import { fitMeshToFootprint, resolveSurface, SURFACED_TYPES, wallSurfaces, withResolution, type PlacementSurface, type ResizeCorner } from '../services/roomGrid'
import { isWallMedia, isWallPhoto, ROOM_HTML_Z_INDEX_RANGE, ROOM_OBJECT_ORDER, wallItemOrder } from '../services/renderOrder'
import { t } from '../services/i18n'

// Every room in the explorer names its furniture identically — each one has a `desk` — so a scene-wide lookup for
// `fit:<id>` can land on a NEIGHBOUR's copy and drag whatever follows it outside the room. Search only inside the
// room the caller itself sits in: climb to the group the scene holds directly, which is that room, and look there.
export const findFit = (from: Object3D, scene: Object3D, id: string) => {
  let room = from
  while (room.parent && room.parent !== scene) room = room.parent
  return room.getObjectByName(`fit:${id}`)
}

export default function Furniture({ id, children }: { id: FurnitureId; children: ReactNode }) {
  const { furniture, mode, selectedFurnitureId, selectedPlacementValid, movingFurnitureId } = useRoomStore()
  const item = furniture.find((value) => value.id === id)
  if (!item || item.removed) return null
  const fitted = <FittedMesh item={item}>{children}</FittedMesh>
  const order = item.category === 'wallItem' ? wallItemOrder(item.type) : ROOM_OBJECT_ORDER
  const content = <group renderOrder={order}>{item.category === 'wallItem' ? <group rotation={wallSurfaces[item.wallId ?? 'leftWall'].rotation}><group rotation={[0, 0, item.rotation[1]]}>{fitted}</group></group> : fitted}</group>
  const selected = selectedFurnitureId === id
  const surface = resolveSurface(furniture, item.surfaceId)
  const [width, height] = surface ? fitMeshToFootprint(withResolution(surface, resolutionFor(item)), item.footprint) : [0, 0]
  const editOverlay = selected && movingFurnitureId !== id && surface ? <>
    {isResizableWallItem(item) && <ResizeBounds item={item} surface={withResolution(surface, resolutionFor(item))} valid={selectedPlacementValid} />}
    {item.category !== 'wallItem' && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}><ringGeometry args={[Math.max(width, height) * .22, Math.max(width, height) * .3, 28]} /><meshBasicMaterial color="#fff2a5" transparent opacity={0.9} /></mesh>}
    {item.elevatable && <HeightControls item={item} />}
  </> : null
  return <Interactive id={id} position={item.position} rotation={item.category === 'wallItem' ? [0, 0, 0] : item.rotation} scale={item.scale} pad={id !== 'bookshelf' && item.type !== 'speech-bubble'} editing={mode === 'edit'} editOverlay={editOverlay}>{content}</Interactive>
}

function HeightControls({ item }: { item: FurnitureItem }) {
  const { adjustFurnitureHeight } = useRoomStore()
  const height = item.heightOffset ?? 0
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()
  return <Html position={[0, .12 - height, 0]} center zIndexRange={ROOM_HTML_Z_INDEX_RANGE}>
    <div className="height-controls" onPointerDown={stop} onClick={stop}>
      <button type="button" aria-label={t('낮추기')} disabled={height <= 0} onClick={(event) => { event.stopPropagation(); adjustFurnitureHeight(item.id, -1) }}>▼</button>
      <button type="button" aria-label={t('높이기')} disabled={height >= 5.6} onClick={(event) => { event.stopPropagation(); adjustFurnitureHeight(item.id, 1) }}>▲</button>
    </div>
  </Html>
}

export function FittedMesh({ item, children }: { item: FurnitureItem; children: ReactNode }) {
  const { furniture } = useRoomStore()
  const group = useRef<Group>(null)
  // GLB 가구는 비동기 로드라 첫 마운트 때 빈 치수를 잴 수 있다 — 로드 완료 알림마다 재측정
  const [glbTick, setGlbTick] = useState(0)
  useEffect(() => onGlbReady(() => setGlbTick((tick) => tick + 1)), [])
  useLayoutEffect(() => {
    if (!group.current || !item.footprint.width) return
    const surface = resolveSurface(furniture, item.surfaceId); if (!surface) return
    group.current.scale.set(1, 1, 1); group.current.updateWorldMatrix(true, true)
    const bounds = new Box3(); const inverse = group.current.matrixWorld.clone().invert()
    group.current.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      if (item.category === 'wallItem' && isWallMedia(item.type)) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.depthWrite = false
      if (mesh.userData.excludeFromFit) return
      mesh.geometry.computeBoundingBox(); if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse))
    })
    // size against the item's OWN grid resolution: a subgrid2 item's cell is 0.35 on every surface (incl. floor),
    // so its rendered size never changes when moved between floor and tabletop
    const size = bounds.getSize(new Vector3()); const [width, height] = fitMeshToFootprint(withResolution(surface, resolutionFor(item)), item.footprint)
    // Portable props keep one scale on every axis. Scaling only X/Z made cups, plants, books, etc. look
    // squashed after placement even though their footprint was correct.
    const uniformScale = Math.min(width / size.x, height / size.z)
    // 바닥 가구도 소품처럼 균일 스케일로 비율을 지킨다 — X/Z만 늘리면 모델과 칸 비율이 다를 때 찌그러진다.
    // 예외: 상판/좌석을 제공하는 가구(SURFACED_TYPES)는 heightOffset 상수가 높이에 묶여 있어 기존 X/Z 맞춤 유지.
    // GLB 가구는 격자 칸을 꽉 채운다: 가로·깊이를 각각 맞추고 높이는 둘 중 작은 배율을 따라간다
    const glbFill = GLB_TYPES.has(item.type) || !!item.customSpec?.glbUrl
    const fitted: [number, number, number] = (surface.type !== 'wall'
      ? SURFACED_TYPES.has(item.type)
        ? [width / size.x, 1, height / size.z]
        : glbFill
          ? [width / size.x, uniformScale, height / size.z]
          : [uniformScale, uniformScale, uniformScale]
      : item.type === 'wall-shelf'
        ? [width / size.x, 1, 1]
        : [width / size.x, height / size.y, 1])
    const customScale = clampModelScale(item.customSpec?.modelScale)
    const finalScale: [number, number, number] = [fitted[0] * customScale[0], fitted[1] * customScale[1], fitted[2] * customScale[2]]
    group.current.scale.set(...finalScale)
    // Media lives on the wall's back plane. Other wall furniture is deliberately lifted forward so it can be
    // installed over a photo, poster, or video without z-fighting or being hidden by that background layer.
    group.current.position.z = item.category === 'wallItem' ? (isWallPhoto(item.type) ? .002 : isWallMedia(item.type) ? .006 : .05) - bounds.min.z * finalScale[2] : 0
  }, [item.surfaceId, item.footprint.width, item.footprint.depth, item.rotation[1], item.type, item.customSpec?.modelScale?.[0], item.customSpec?.modelScale?.[1], item.customSpec?.modelScale?.[2], glbTick])
  return <group ref={group} name={`fit:${item.id}`}>{children}</group>
}

const CORNERS: Array<{ corner: ResizeCorner; x: number; y: number; cursor: string }> = [
  { corner: 'northWest', x: -1, y: 1, cursor: 'nwse-resize' }, { corner: 'northEast', x: 1, y: 1, cursor: 'nesw-resize' },
  { corner: 'southWest', x: -1, y: -1, cursor: 'nesw-resize' }, { corner: 'southEast', x: 1, y: -1, cursor: 'nwse-resize' },
]

function ResizeBounds({ item, surface, valid }: { item: FurnitureItem; surface: PlacementSurface; valid: boolean }) {
  const [width, height] = fitMeshToFootprint(surface, item.footprint)
  const geometry = useMemo(() => new BufferGeometry().setAttribute('position', new Float32BufferAttribute([
    -width / 2, -height / 2, 0, width / 2, -height / 2, 0, width / 2, -height / 2, 0, width / 2, height / 2, 0,
    width / 2, height / 2, 0, -width / 2, height / 2, 0, -width / 2, height / 2, 0, -width / 2, -height / 2, 0,
  ], 3)), [width, height])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <group rotation={wallSurfaces[item.wallId ?? 'leftWall'].rotation}>
    <group rotation={[0, 0, item.rotation[1]]} position={[0, 0, .09]} renderOrder={10000}>
      <lineSegments geometry={geometry}><lineBasicMaterial color={valid ? '#222222' : '#d93025'} depthTest={false} transparent opacity={.9} /></lineSegments>
      {CORNERS.map(({ corner, x, y, cursor }) => <ResizeHandle key={corner} id={item.id} corner={corner} cursor={cursor} surface={surface} position={[x * width / 2, y * height / 2, .01]} />)}
    </group>
  </group>
}

function ResizeHandle({ id, corner, cursor, surface, position }: { id: FurnitureId; corner: ResizeCorner; cursor: string; surface: PlacementSurface; position: [number, number, number] }) {
  const { beginResize, resizeFurniture, endResize } = useRoomStore()
  const { camera, size } = useThree(); const group = useRef<Group>(null); const dragging = useRef(false); const [hovered, setHovered] = useState(false)
  useCursor(hovered || dragging.current, cursor)
  const plane = useMemo(() => new Plane().setFromNormalAndCoplanarPoint(new Vector3(...surface.normal), new Vector3(...surface.position)), [surface])
  const point = useMemo(() => new Vector3(), [])
  useFrame(() => {
    if (!group.current) return
    const ortho = camera as OrthographicCamera; const worldPerPixel = (ortho.top - ortho.bottom) / Math.max(1, ortho.zoom * size.height)
    group.current.scale.setScalar(worldPerPixel)
  })
  const finish = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return
    event.stopPropagation(); dragging.current = false; endResize(id)
    const target = event.target as unknown as { releasePointerCapture?: (pointerId: number) => void }
    target.releasePointerCapture?.(event.pointerId)
  }
  return <group ref={group} position={position}>
    <mesh scale={5} renderOrder={10001}><circleGeometry args={[1, 20]} /><meshBasicMaterial color="#ffffff" depthTest={false} toneMapped={false} /></mesh>
    <mesh renderOrder={10002}><ringGeometry args={[4, 5, 20]} /><meshBasicMaterial color="#222222" depthTest={false} toneMapped={false} /></mesh>
    <mesh scale={22} renderOrder={10003}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)}
      onPointerDown={(event) => { event.stopPropagation(); dragging.current = true; beginResize(id); (event.target as unknown as { setPointerCapture: (pointerId: number) => void }).setPointerCapture(event.pointerId) }}
      onPointerMove={(event) => { if (!dragging.current) return; event.stopPropagation(); const hit = event.ray.intersectPlane(plane, point); if (hit) resizeFurniture(id, corner, [hit.x, hit.y, hit.z]) }}
      onPointerUp={finish} onPointerCancel={finish}>
      <circleGeometry args={[1, 20]} /><meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
    </mesh>
  </group>
}
