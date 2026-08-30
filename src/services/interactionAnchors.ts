import { Vector3 } from 'three'
import { baseFloorCells, isFloorCovering, isPosedItem, type CharacterState, type FurnitureItem } from '../store'
import { clampModelScale } from '../customObjectSpec'
import { cellsFor, floorSurface, floorWalkRoute, GRID_COUNT, GRID_SIZE, gridToWorld, isOwnedSurfaceId, ownerIdOf, surfacesForOwner, worldToGrid, type GridPosition } from './roomGrid'

export type InteractionType = 'sit' | 'lie' | 'work' | 'read' | 'interact'
export type LocalInteractionAnchor = { position: [number, number, number]; rotation: number }
export type InteractionAnchors = {
  type: InteractionType
  approach: LocalInteractionAnchor
  action: LocalInteractionAnchor
}
export type ResolvedInteraction = InteractionAnchors & {
  target: FurnitureItem
  approachWorld: LocalInteractionAnchor
  actionWorld: LocalInteractionAnchor
}

const topHeight = (item: FurnitureItem) => {
  const surface = surfacesForOwner(item)[0]
  return surface ? surface.position[1] - item.position[1] : 0
}
const defaultApproach = (item: FurnitureItem): LocalInteractionAnchor => ({ position: [0, 0, item.footprint.depth * GRID_SIZE / 2 + .45], rotation: 0 })

// 실측: cloud-sofa 좌석 .225 × 3.62, dome-sofa .201 × 2.8, pink-mini-sofa .3 × .83, hanging-bubble-chair .314 × 1.85
const GLB_SEATS: Record<string, { lift: number; forward: number }> = {
  'cloud-sofa': { lift: .81, forward: .2 },
  'dome-sofa': { lift: .56, forward: .05 },
  'pink-mini-sofa': { lift: .25, forward: .12 },
  'hanging-bubble-chair': { lift: .58, forward: 0 },
}

export function interactionAnchorsFor(item: FurnitureItem, typeOverride?: InteractionType): InteractionAnchors {
  // lying rotates the body -90° about X at the anchor, so: +.15 in y rests the body's BACK on the mattress
  // (torso half-depth), and z=.9 shifts the whole body south so the head (body length ~1.77 toward -z after
  // rotation) stays on the pillows instead of clipping into the headboard at the bed's north edge
  if (item.type === 'bed' || item.type === 'hotel-bed') return {
    type: 'lie',
    approach: { position: [.95, 0, .45], rotation: -Math.PI / 2 },
    action: { position: [0, topHeight(item) + .13, .78], rotation: 0 },
  }
  // center of the seat — an off-center slot presses the body into the armrest, and a bit of +z keeps the
  // torso clear of the backrest
  if (item.type === 'sofa') return {
    type: 'sit',
    approach: { position: [0, 0, .75], rotation: 0 },
    action: { position: [0, topHeight(item) - .02, .12], rotation: 0 },
  }
  if (item.type === 'rocking-chair' || item.type === 'beanbag') return {
    type: 'sit',
    approach: { position: [0, 0, .75], rotation: 0 },
    action: { position: [0, topHeight(item), .04], rotation: 0 },
  }
  // 새 가구들은 owned surface가 없어 topHeight가 0이다 — 좌석 높이를 모델 좌표에서 직접 잰 값으로 박는다
  // 균일 맞춤 스케일(u = 칸폭/모델폭)이 높이에도 걸린다 — 좌석 y는 "제작 좌표 × u"로 잰 값
  if (item.type === 'lavender-sofa') return {
    type: 'sit',
    approach: { position: [0, 0, .75], rotation: 0 },
    action: { position: [0, .4, .08], rotation: 0 },
  }
  if (item.type === 'inflatable-sofa') return {
    type: 'sit',
    approach: { position: [0, 0, .75], rotation: 0 },
    action: { position: [0, .3, .06], rotation: 0 },
  }
  if (item.type === 'pod-daybed') return {
    type: 'lie',
    approach: { position: [0, 0, 1.3], rotation: 0 },
    action: { position: [0, .94, .37], rotation: 0 },
  }
  if (item.type === 'boucle-stool' || item.type === 'papasan-chair' || item.type === 'bubble-chair') return {
    type: 'sit',
    approach: { position: [0, 0, .75], rotation: 0 },
    action: { position: [0, item.type === 'boucle-stool' ? .38 : item.type === 'papasan-chair' ? .82 : .62, item.type === 'boucle-stool' ? 0 : .08], rotation: 0 },
  }
  // 생성 가구: 사용자가 고른 동작 + 실측 면에서 자리를 계산한다. 검출된 면 중 가장 낮은 것이 앉는 자리다
  // (등받이 위나 팔걸이는 더 높게 잡히고, 바닥에 붙은 밑판은 검출 단계에서 이미 빠졌다).
  const custom = item.customSpec
  const customTops = custom?.topSurfaces ?? (custom?.topSurface ? [custom.topSurface] : [])
  if (custom?.modelSize && customTops.length) {
    const scale = clampModelScale(custom.modelScale)
    const fitX = item.footprint.width * GRID_SIZE / custom.modelSize[0]
    const fitZ = item.footprint.depth * GRID_SIZE / custom.modelSize[2]
    const seat = customTops[customTops.length - 1]
    const lift = seat.height * Math.min(fitX, fitZ) * scale[1]
    const forward = seat.center[1] * fitZ * scale[2]
    const reach = item.footprint.depth * GRID_SIZE / 2 + .45
    // 고른 동작이 없으면 생김새로 판단한다 — 무릎~엉덩이 높이에 엉덩이가 얹힐 넓이의 면이 있으면 의자로 본다.
    // 책상·선반은 이 높이 창을 벗어나고, 받침대는 넓이에서 걸린다
    const width = seat.size[0] * fitX * scale[0]
    const depth = seat.size[1] * fitZ * scale[2]
    const looksLikeSeat = lift >= .25 && lift <= .65 && width >= .45 && depth >= .35
    const pose = custom.pose ?? (looksLikeSeat ? 'sit' : undefined)
    if (!pose) return { type: typeOverride ?? 'interact', approach: defaultApproach(item), action: defaultApproach(item) }
    return pose === 'lie'
      ? { type: 'lie', approach: { position: [item.footprint.width * GRID_SIZE / 2 + .5, 0, 0], rotation: -Math.PI / 2 }, action: { position: [0, lift + .13, forward], rotation: 0 } }
      : { type: 'sit', approach: { position: [0, 0, reach], rotation: 0 }, action: { position: [0, lift, forward], rotation: 0 } }
  }
  // GLB 좌석. lift = 실측 좌석면(모델 단위) × 격자 맞춤 배율 min(칸가로/모델X, 칸깊이/모델Z) — GLB 가구는 그
  // 배율로 높이가 정해지므로 상판 표와 같은 숫자에서 나온다. forward는 좌석 중앙에서 살짝 앞.
  // 방향은 손댈 것이 없다: rotation 0이 가구 앞면(+z)을 보는 것이고, localAnchorToWorld가 가구가 돌아간 각도를
  // 위치와 시선 양쪽에 그대로 얹는다 — 소파를 어느 벽으로 돌려놔도 등받이를 등지고 앉는다.
  const glbSeat = GLB_SEATS[item.type]
  if (glbSeat) return {
    type: 'sit',
    approach: { position: [0, 0, item.footprint.depth * GRID_SIZE / 2 + .45], rotation: 0 },
    action: { position: [0, glbSeat.lift, glbSeat.forward], rotation: 0 },
  }
  if (item.type === 'chair' || item.type === 'sage-office-chair') return {
    type: typeOverride ?? 'sit',
    approach: { position: [0, 0, .7], rotation: 0 },
    // 이 의자는 1칸에 균일 맞춤되어 원본 좌석 윗면(.97)이 약 .47 높이가 된다.
    action: { position: [0, item.type === 'sage-office-chair' ? .47 : topHeight(item), .04], rotation: 0 },
  }
  const approach = defaultApproach(item)
  return { type: typeOverride ?? (item.type === 'bookshelf' ? 'read' : 'interact'), approach, action: approach }
}

export function localAnchorToWorld(item: FurnitureItem, anchor: LocalInteractionAnchor): LocalInteractionAnchor {
  const point = new Vector3(...anchor.position).applyAxisAngle(new Vector3(0, 1, 0), item.rotation[1]).add(new Vector3(...item.position))
  return { position: point.toArray() as [number, number, number], rotation: item.rotation[1] + anchor.rotation }
}

const facePosition = (from: [number, number, number], to: [number, number, number]) => Math.atan2(to[0] - from[0], to[2] - from[2])

const CELL = { width: 1, depth: 1 }
// the configured approach anchor assumes an empty room — if furniture now covers that spot, or a moved/rotated
// target pushed it outside the floor grid, snap it to the nearest free in-bounds cell around the target so the
// character never walks (or gets slid during 'aligning') into geometry or out of the room
const freeApproach = (world: LocalInteractionAnchor, target: FurnitureItem, furniture: FurnitureItem[], origin?: [number, number, number]): LocalInteractionAnchor => {
  const occupied = new Set(furniture.filter((item) => item.category === 'floorFurniture' && !isFloorCovering(item) && !item.removed && item.surfaceId === 'floor').flatMap((item) => baseFloorCells(item).map((cell) => `${cell.x}:${cell.y}`)))
  const inBounds = (cell: GridPosition) => cell.gridX >= 0 && cell.gridX < GRID_COUNT && cell.gridY >= 0 && cell.gridY < GRID_COUNT
  const desired = worldToGrid(floorSurface, world.position, CELL)
  const nearest = origin ? worldToGrid(floorSurface, origin, CELL) : desired
  const goal = cellsFor(target, target.footprint, target.rotation[1])
    .flatMap((cell) => [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ gridX: cell.x + dx, gridY: cell.y + dy }))))
    .filter((cell, index, all) => inBounds(cell) && !occupied.has(`${cell.gridX}:${cell.gridY}`) && all.findIndex((other) => other.gridX === cell.gridX && other.gridY === cell.gridY) === index)
    .sort((a, b) => {
      const desiredDifference = Math.hypot(a.gridX - desired.gridX, a.gridY - desired.gridY)
        - Math.hypot(b.gridX - desired.gridX, b.gridY - desired.gridY)
      return desiredDifference || Math.hypot(a.gridX - nearest.gridX, a.gridY - nearest.gridY)
        - Math.hypot(b.gridX - nearest.gridX, b.gridY - nearest.gridY)
    })[0]
  if (!goal) return world
  const [x, , z] = gridToWorld(floorSurface, goal, CELL)
  return { position: [x, 0, z], rotation: world.rotation }
}

export function resolveInteraction(selectedObject: string | null, furniture: FurnitureItem[], origin?: [number, number, number]): ResolvedInteraction | null {
  const requested = furniture.find((item) => item.id === (selectedObject === 'book' ? 'bookshelf' : selectedObject))
  if (!requested || requested.removed || !isPosedItem(requested)) return null
  let selected = requested
  if (isOwnedSurfaceId(selected.surfaceId)) selected = furniture.find((item) => item.id === ownerIdOf(selected.surfaceId)) ?? selected
  const target = selected
  const anchors = interactionAnchorsFor(target, requested.type === 'book' ? 'read' : undefined)
  const approachWorld = freeApproach(localAnchorToWorld(target, anchors.approach), target, furniture, origin)
  // interact/read stand on the floor at the approach spot itself, so a snapped approach must carry the action
  // with it; sit/lie/work aim ONTO the furniture, which is intentional overlap and stays put
  const actionWorld = anchors.action === anchors.approach ? { ...approachWorld } : localAnchorToWorld(target, anchors.action)
  approachWorld.rotation = facePosition(approachWorld.position, requested.position)
  if (['interact', 'read', 'work'].includes(anchors.type)) actionWorld.rotation = facePosition(actionWorld.position, requested.position)
  return { ...anchors, target, approachWorld, actionWorld }
}

const cellKey = ({ gridX, gridY }: GridPosition) => `${gridX}:${gridY}`

// Owner and visitor interactions must choose an approach cell the same way. The configured anchor is preferred,
// then nearby free cells are tried in distance order so a moved chair/bed still works when its ideal spot is blocked.
export function routeToInteraction(origin: [number, number, number], interaction: ResolvedInteraction, furniture: FurnitureItem[]) {
  const occupied = new Set(furniture.filter((item) => item.category === 'floorFurniture' && !isFloorCovering(item) && !item.removed && item.surfaceId === 'floor').flatMap((item) => baseFloorCells(item).map((cell) => `${cell.x}:${cell.y}`)))
  const desired = worldToGrid(floorSurface, interaction.approachWorld.position, CELL)
  const targetCells = interaction.target.category === 'floorFurniture' ? cellsFor(interaction.target, interaction.target.footprint, interaction.target.rotation[1]) : []
  const candidates = [desired, ...targetCells.flatMap((cell) => [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ gridX: cell.x + dx, gridY: cell.y + dy }))))]
    .filter((cell, index, all) => cell.gridX >= 0 && cell.gridX < GRID_COUNT && cell.gridY >= 0 && cell.gridY < GRID_COUNT && !occupied.has(cellKey(cell)) && all.findIndex((other) => cellKey(other) === cellKey(cell)) === index)
    .sort((a, b) => Math.hypot(a.gridX - desired.gridX, a.gridY - desired.gridY) - Math.hypot(b.gridX - desired.gridX, b.gridY - desired.gridY))
  for (const candidate of candidates) {
    const destination = cellKey(candidate) === cellKey(desired) ? interaction.approachWorld.position : gridToWorld(floorSurface, candidate, CELL)
    const route = floorWalkRoute(occupied, origin, destination)
    if (route) return route
  }
  return null
}

export const stateForInteraction = (type: InteractionType): Exclude<CharacterState, 'walking' | 'aligning'> =>
  type === 'lie' ? 'laying' : type === 'sit' ? 'sitting' : type === 'work' ? 'working' : type === 'read' ? 'reading' : 'interacting'
