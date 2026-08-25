import { useEffect, useMemo } from 'react'
import { type ThreeEvent } from '@react-three/fiber'
import { SRGBColorSpace, Shape, TextureLoader } from 'three'
import Furniture from './Furniture'
import PlacementGrid, { gridAreaFor } from './PlacementGrid'
import { useRoomStore } from '../store'
import { type PlacementSurface, type WallId, wallSurfaces } from '../services/roomGrid'
import { palette } from '../services/palette'
import { colorOf, DEFAULT_WALL_COLOR, floorStyleOf } from '../services/styles'

// 코너 마이터 삼각형: 평면도 기준 안쪽 모서리(+x,+z)에서 바깥 모서리(-x,-z)로 그은 대각선이 경계.
// (extrude는 XY 평면 기준이라 y_geo = -z_world 로 뒤집어 적는다)

const LEFT_MITER = (() => { const shape = new Shape(); shape.moveTo(.11, -.11); shape.lineTo(-.11, -.11); shape.lineTo(-.11, .11); shape.closePath(); return shape })()
const RIGHT_MITER = (() => { const shape = new Shape(); shape.moveTo(.11, -.11); shape.lineTo(.11, .11); shape.lineTo(-.11, .11); shape.closePath(); return shape })()
type WallEvents = { onPointerDown: (event: ThreeEvent<PointerEvent>) => void; onPointerMove: (event: ThreeEvent<PointerEvent>) => void; onClick: (event: ThreeEvent<MouseEvent>) => void }

function WallImage({ source, wall, events }: { source: string; wall: PlacementSurface; events: WallEvents }) {
  const texture = useMemo(() => { const value = new TextureLoader().load(source); value.colorSpace = SRGBColorSpace; return value }, [source])
  useEffect(() => () => texture.dispose(), [texture])
  return <mesh position={[wall.position[0] + wall.normal[0] * .001, wall.position[1] + wall.normal[1] * .001, wall.position[2] + wall.normal[2] * .001]} rotation={wall.rotation} {...events}>
    <planeGeometry args={[wall.width, wall.height]} /><meshStandardMaterial map={texture} roughness={.9} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
  </mesh>
}

export default function Walls() {

  const { readOnly, mode, furniture, selectedFurnitureId, movingFurnitureId, preview, previewDragging, wallStyle, floorStyle, moveFurniture, placeFurnitureAt, movePreview, openStyleTarget } = useRoomStore()
  const selected = furniture.find((item) => item.id === selectedFurnitureId)
  const activeItem = preview?.allowedSurfaces.includes('wall') ? preview : selected?.allowedSurfaces.includes('wall') ? selected : null
  const activeWall = activeItem?.wallId ?? null
  const floor = floorStyleOf(floorStyle)
  const leftWallColor = colorOf(wallStyle.leftWall, DEFAULT_WALL_COLOR.leftWall)
  const rightWallColor = colorOf(wallStyle.rightWall, DEFAULT_WALL_COLOR.rightWall)
  const moveTo = (wallId: WallId, point: { x: number; y: number; z: number }) => {
    if (previewDragging && preview?.allowedSurfaces.includes('wall')) return movePreview([point.x, point.y, point.z], wallId)
    if (movingFurnitureId && selected?.id === movingFurnitureId && selected.allowedSurfaces.includes('wall')) moveFurniture(selected.id, [point.x, point.y, point.z], wallId)
  }
  const eventsFor = (wallId: WallId): WallEvents => ({
    onPointerDown: (event) => { if (!readOnly && mode === 'edit') event.stopPropagation() },
    onPointerMove: (event) => { if (!readOnly && (movingFurnitureId === selected?.id || (previewDragging && preview?.allowedSurfaces.includes('wall')))) { event.stopPropagation(); moveTo(wallId, event.point) } },
    onClick: (event) => { if (readOnly) return; event.stopPropagation(); if (mode !== 'normal' && selected?.movable && selected.allowedSurfaces.includes('wall') && !movingFurnitureId) placeFurnitureAt(selected.id, [event.point.x, event.point.y, event.point.z], wallId) },
  })
  return <>
    {(Object.values(wallSurfaces) as typeof wallSurfaces[WallId][]).map((wall) => <mesh key={wall.id} receiveShadow position={[wall.position[0] - wall.normal[0] * .11, wall.position[1] - wall.normal[1] * .11, wall.position[2] - wall.normal[2] * .11]} rotation={wall.rotation} {...eventsFor(wall.id as WallId)}><boxGeometry args={[wall.width, wall.height, .22]} /><meshStandardMaterial color={colorOf(wallStyle[wall.id as WallId], DEFAULT_WALL_COLOR[wall.id as WallId])} /></mesh>)}
    {(Object.values(wallSurfaces) as typeof wallSurfaces[WallId][]).map((wall) => { const key = wall.id === 'leftWall' ? 'leftWallImage' : 'rightWallImage'; const source = wallStyle[key]; return source ? <WallImage key={`${wall.id}:image`} source={source} wall={wall} events={eventsFor(wall.id as WallId)} /> : null })}
    {/* Trim bars: square channels under each wall plus the open corner column between the walls. Tagged so the
        explorer's fade can hold them back — thin dark boxes read double-dense while semi-transparent and floated
        over the ghosted room as three hard bars; flagged materials join the fade only at its very end. */}
    {/* 아래 두 채널은 바닥의 연장 — 바닥 색·재질을 그대로 따라간다 (통 바닥으로 바뀌면 여기까지 같이 바뀐다).
        세로 코너 기둥은 왼쪽 벽의 연장이라 왼쪽 벽 색을 따른다. */}
    <mesh receiveShadow position={[-3.61, -0.11, -0.11]}><boxGeometry args={[.22, .22, 7.22]} /><meshStandardMaterial color={floor.color} roughness={floor.roughness} userData={{ lateFade: true }} /></mesh>
    <mesh receiveShadow position={[0, -0.11, -3.61]}><boxGeometry args={[7, .22, .22]} /><meshStandardMaterial color={floor.color} roughness={floor.roughness} userData={{ lateFade: true }} /></mesh>
    {/* 코너 기둥은 마이터 조인트: 대각선으로 쪼갠 삼각기둥 둘이 각자 자기 벽 색을 갖는다 —
        위에서 보면 액자 모서리처럼 45° 삼각형 반반으로 만난다 */}
    <mesh receiveShadow position={[-3.61, 0, -3.61]} rotation={[-Math.PI / 2, 0, 0]}><extrudeGeometry args={[LEFT_MITER, { depth: 7, bevelEnabled: false }]} /><meshStandardMaterial color={leftWallColor} userData={{ lateFade: true }} /></mesh>
    <mesh receiveShadow position={[-3.61, 0, -3.61]} rotation={[-Math.PI / 2, 0, 0]}><extrudeGeometry args={[RIGHT_MITER, { depth: 7, bevelEnabled: false }]} /><meshStandardMaterial color={rightWallColor} userData={{ lateFade: true }} /></mesh>
    {mode === 'edit' && activeWall && activeItem && <PlacementGrid surface={wallSurfaces[activeWall]} area={gridAreaFor(activeItem)} />}
    <Furniture id="clock"><mesh position={[0, 0, .05]}><torusGeometry args={[.6, .1, 8, 20]} /><meshStandardMaterial color={palette.woodDark} roughness={0.7} /></mesh><mesh position={[0, 0, .06]}><circleGeometry args={[.52, 20]} /><meshStandardMaterial color={palette.linen} roughness={0.85} /></mesh><mesh position={[0, 0, .08]}><boxGeometry args={[.04, .42, .02]} /><meshStandardMaterial color={palette.charcoal} roughness={0.7} /></mesh></Furniture>
  </>
}
