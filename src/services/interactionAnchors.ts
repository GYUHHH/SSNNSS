import { Vector3 } from 'three'
import { baseFloorCells, POSED_TYPES, type CharacterState, type FurnitureItem } from '../store'
import { cellsFor, floorSurface, GRID_COUNT, GRID_SIZE, gridToWorld, isOwnedSurfaceId, ownerIdOf, surfacesForOwner, worldToGrid, type GridPosition } from './roomGrid'

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
  if (item.type === 'chair') return {
    type: typeOverride ?? 'sit',
    approach: { position: [0, 0, .7], rotation: 0 },
    action: { position: [0, topHeight(item), 0], rotation: 0 },
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
  const occupied = new Set(furniture.filter((item) => item.category === 'floorFurniture' && item.type !== 'rug' && !item.removed && item.surfaceId === 'floor').flatMap((item) => baseFloorCells(item).map((cell) => `${cell.x}:${cell.y}`)))
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
  if (!requested || requested.removed || !POSED_TYPES.has(requested.type)) return null
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

export const stateForInteraction = (type: InteractionType): Exclude<CharacterState, 'walking' | 'aligning'> =>
  type === 'lie' ? 'laying' : type === 'sit' ? 'sitting' : type === 'work' ? 'working' : type === 'read' ? 'reading' : 'interacting'
