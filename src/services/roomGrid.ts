import { Euler, Quaternion, Vector3 } from 'three'

export const GRID_COUNT = 10
export const GRID_SIZE = .7
// a SurfaceId is either one of the 3 fixed room surfaces, or `${ownerFurnitureId}:${suffix}` for a surface
// hosted by a piece of furniture (e.g. "desk:top") — see surfacesForOwner
export type SurfaceId = string
export type WallId = 'leftWall' | 'rightWall'
export type SurfaceKind = 'floor' | 'wall' | 'tabletop' | 'shelf' | 'seat'
export type SurfaceOrientation = 'horizontal' | 'vertical'
export type Footprint = { width: number; depth: number }
export type GridPosition = { gridX: number; gridY: number }
export type PlacementSurface = {
  id: SurfaceId; ownerId?: string; type: SurfaceKind; orientation: SurfaceOrientation; width: number; height: number; gridRows: number; gridColumns: number
  position: [number, number, number]; rotation: [number, number, number]; normal: [number, number, number]
  allowedItemTypes?: string[]
}
export type PlacementItem = { surfaceId: SurfaceId; gridX: number; gridY: number; footprint: Footprint; rotation: [number, number, number] }

export const floorSurface: PlacementSurface = { id: 'floor', type: 'floor', orientation: 'horizontal', width: GRID_COUNT * GRID_SIZE, height: GRID_COUNT * GRID_SIZE, gridRows: GRID_COUNT, gridColumns: GRID_COUNT, position: [0, 0, 0], rotation: [Math.PI / 2, 0, 0], normal: [0, 1, 0] }
export const wallSurfaces: Record<WallId, PlacementSurface> = {
  leftWall: { id: 'leftWall', type: 'wall', orientation: 'vertical', width: GRID_COUNT * GRID_SIZE, height: GRID_COUNT * GRID_SIZE, gridRows: GRID_COUNT, gridColumns: GRID_COUNT, position: [-3.5, 3.5, 0], rotation: [0, Math.PI / 2, 0], normal: [1, 0, 0] },
  rightWall: { id: 'rightWall', type: 'wall', orientation: 'vertical', width: GRID_COUNT * GRID_SIZE, height: GRID_COUNT * GRID_SIZE, gridRows: GRID_COUNT, gridColumns: GRID_COUNT, position: [0, 3.5, -3.5], rotation: [0, 0, 0], normal: [0, 0, 1] },
}
export const placementSurfaces: Record<'floor' | WallId, PlacementSurface> = { floor: floorSurface, ...wallSurfaces }
export const getPlacementSurface = (id: 'floor' | WallId) => placementSurfaces[id]

export const rotatedFootprint = (footprint: Footprint, rotationY: number): Footprint => Math.abs(Math.round(rotationY / (Math.PI / 2))) % 2 ? { width: footprint.depth, depth: footprint.width } : footprint

// ponytail: one small config table drives every surface a piece of furniture hosts — add a row here, not a new file,
// to give another furniture type a tabletop/shelf. Offsets are in the owner's own unrotated local frame.
// No width/height here on purpose: a hand-tuned physical size would make the sub-cell size drift per furniture
// (1.3/4 for a desk vs 1.6/6 for a bed) — the surface's physical size is always derived from the owner's OWN
// room-grid footprint instead, so subCellSize reduces to exactly GRID_SIZE/2 for every owned surface, no exceptions
type OwnedSurfaceConfig = { suffix: string; kind: SurfaceKind; heightOffset: number; allowedItemTypes?: string[] }
const OWNED_SURFACES: Record<string, OwnedSurfaceConfig[]> = {
  desk: [{ suffix: 'top', kind: 'tabletop', heightOffset: 1.08 }],
  cabinet: [{ suffix: 'top', kind: 'tabletop', heightOffset: 1.11 }],
  bed: [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.8 }],
  sofa: [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.5 }],
  chair: [{ suffix: 'seat', kind: 'seat', heightOffset: 0.54 }],
  'side-table': [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.54 }],
  'music-player': [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.54 }],
  bookshelf: [{ suffix: 'top', kind: 'tabletop', heightOffset: 2.94 }],
  fireplace: [{ suffix: 'top', kind: 'tabletop', heightOffset: 1.03 }],
  'coffee-table': [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.35 }],
  'glass-shelf': [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.66 }],
  wardrobe: [{ suffix: 'top', kind: 'tabletop', heightOffset: 1.9 }],
  'mini-fridge': [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.86 }],
  'rocking-chair': [{ suffix: 'seat', kind: 'seat', heightOffset: 0.49 }],
}
export type SurfaceHost = { id: string; type: string; position: [number, number, number]; rotation: [number, number, number]; footprint: Footprint; wallId?: WallId }

// the surfaces a piece of furniture currently hosts, positioned/rotated from its LIVE position — move or rotate the
// owner and every surface (and everything placed on it) moves with it, because this is recomputed from scratch each
// call. Size and grid come from the owner's UNROTATED local footprint; the surface's own rotation (-yaw, mirroring
// the mesh's Ry(+yaw)) is the ONLY place the owner's rotation enters — using the rotated footprint here too would
// rotate the grid twice, leaving it 90° off the furniture. Items keep their local gridX/gridY, so they (and the
// grid) turn together with the owner. subCellSize stays exactly GRID_SIZE/2: (footprint*GRID_SIZE)/(footprint*2)
export const surfacesForOwner = (item: SurfaceHost): PlacementSurface[] => {
  if (item.type === 'wall-shelf' && item.wallId) {
    const wall = wallSurfaces[item.wallId]
    const rotation = new Euler().setFromQuaternion(new Quaternion().setFromEuler(new Euler(...wall.rotation)).multiply(new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0))))
    return [{
      id: `${item.id}:top`, ownerId: item.id, type: 'shelf', orientation: 'horizontal',
      width: item.footprint.width * GRID_SIZE, height: GRID_SIZE, gridColumns: item.footprint.width * 2, gridRows: 2,
      position: [item.position[0] + wall.normal[0] * .36, item.position[1] - .23, item.position[2] + wall.normal[2] * .36],
      rotation: [rotation.x, rotation.y, rotation.z], normal: [0, 1, 0],
    }]
  }
  const configs = OWNED_SURFACES[item.type]
  if (!configs) return []
  const footprint = item.footprint
  return configs.map((config) => ({
    id: `${item.id}:${config.suffix}`, ownerId: item.id, type: config.kind, orientation: 'horizontal',
    width: footprint.width * GRID_SIZE, height: footprint.depth * GRID_SIZE, gridColumns: footprint.width * 2, gridRows: footprint.depth * 2,
    position: [item.position[0], item.position[1] + config.heightOffset, item.position[2]],
    rotation: [Math.PI / 2, 0, -item.rotation[1]], normal: [0, 1, 0],
    allowedItemTypes: config.allowedItemTypes,
  }))
}
export const isOwnedSurfaceId = (id: SurfaceId) => id.includes(':')
export const ownerIdOf = (surfaceId: SurfaceId) => surfaceId.split(':')[0]

// the one entry point every call site should use once a surfaceId might be furniture-hosted: static room surfaces
// resolve instantly, owned ones are recomputed from the current owner in `furniture`
export const resolveSurface = (furniture: SurfaceHost[], id: SurfaceId): PlacementSurface | undefined => {
  if (id === 'floor' || id === 'leftWall' || id === 'rightWall') return placementSurfaces[id]
  const owner = furniture.find((item) => item.id === ownerIdOf(id))
  return owner && surfacesForOwner(owner).find((surface) => surface.id === id)
}

// small decor snaps to a finer sub-grid than big floor furniture — same physical surface, its cells just split 2x2.
// withResolution doubles rows/columns (halving cell size) and resolvedFootprint doubles the footprint to match, so
// footprint * cellSize — an item's physical size — is invariant. which items get 'subgrid2' is decided by the
// caller (store.tsx, from FurnitureCategory) — NOT from allowedSurfaces: a floor-standing plant that's also
// shelf-placeable must stay on the floor's base grid while it's on the floor, so the surface kind alone can't drive it
// decor footprints are declared in SUBCELL units (0.35) and NEVER rescale by surface: owned surfaces are already
// subdivided by surfacesForOwner, and for the floor/walls withResolution splits each base cell 2x2 so a 1x1-subcell
// mug physically measures 0.35 everywhere it can go — shape stays constant across floor/tabletop/wall
export type PlacementResolution = 'base' | 'subgrid2'
export const withResolution = (surface: PlacementSurface, resolution: PlacementResolution): PlacementSurface => resolution === 'subgrid2' && !surface.ownerId ? { ...surface, gridColumns: surface.gridColumns * 2, gridRows: surface.gridRows * 2 } : surface
// normalizes a cell into subgrid2 units — a base cell covers the 2x2 block of subcells at the same physical spot —
// so cells from items of different resolutions can be compared in one coordinate space for collision checks
export const normalizedCells = (cells: { x: number; y: number }[], resolution: PlacementResolution) => resolution === 'base' ? cells.flatMap((cell) => [0, 1].flatMap((dx) => [0, 1].map((dy) => ({ x: cell.x * 2 + dx, y: cell.y * 2 + dy })))) : cells

export const getCellSize = (surface: PlacementSurface) => ({ width: surface.width / surface.gridColumns, height: surface.height / surface.gridRows })
export const getWallCellSize = (wall: PlacementSurface) => getCellSize(wall)

export const getSurfaceAxes = (surface: PlacementSurface) => {
  const rotation = new Euler(...surface.rotation)
  return { horizontal: new Vector3(1, 0, 0).applyEuler(rotation), vertical: new Vector3(0, 1, 0).applyEuler(rotation), normal: new Vector3(...surface.normal) }
}

export const gridToWorld = (surface: PlacementSurface, grid: GridPosition, footprint: Footprint, rotationY = 0): [number, number, number] => {
  const size = rotatedFootprint(footprint, rotationY); const cell = getCellSize(surface)
  const axes = getSurfaceAxes(surface); const x = -surface.width / 2 + (grid.gridX + size.width / 2) * cell.width; const y = -surface.height / 2 + (grid.gridY + size.depth / 2) * cell.height
  return new Vector3(...surface.position).addScaledVector(axes.horizontal, x).addScaledVector(axes.vertical, y).toArray() as [number, number, number]
}
export const worldToGrid = (surface: PlacementSurface, point: [number, number, number], footprint: Footprint, rotationY = 0): GridPosition => {
  const size = rotatedFootprint(footprint, rotationY); const cell = getCellSize(surface); const delta = new Vector3(...point).sub(new Vector3(...surface.position)); const axes = getSurfaceAxes(surface)
  return { gridX: Math.round((delta.dot(axes.horizontal) + surface.width / 2) / cell.width - size.width / 2), gridY: Math.round((delta.dot(axes.vertical) + surface.height / 2) / cell.height - size.depth / 2) }
}
export const clampGrid = (surface: PlacementSurface, grid: GridPosition, footprint: Footprint, rotationY = 0): GridPosition => {
  const size = rotatedFootprint(footprint, rotationY)
  return { gridX: Math.max(0, Math.min(grid.gridX, surface.gridColumns - size.width)), gridY: Math.max(0, Math.min(grid.gridY, surface.gridRows - size.depth)) }
}
export const cellsFor = (grid: GridPosition, footprint: Footprint, rotationY = 0) => {
  const size = rotatedFootprint(footprint, rotationY)
  return Array.from({ length: size.width * size.depth }, (_, index) => ({ x: grid.gridX + index % size.width, y: grid.gridY + Math.floor(index / size.width) }))
}
export const fitsSurface = (surface: PlacementSurface, grid: GridPosition, footprint: Footprint, rotationY = 0) => cellsFor(grid, footprint, rotationY).every((cell) => cell.x >= 0 && cell.x < surface.gridColumns && cell.y >= 0 && cell.y < surface.gridRows)
// `occupied` must already be normalized to subgrid2 cell units (see normalizedCells) — the only space where a
// base-resolution item (a desk) and a subgrid2 one (a cup) sharing the same surface can be compared for overlap
export const canPlaceItem = (surface: PlacementSurface, item: Pick<PlacementItem, 'gridX' | 'gridY' | 'footprint' | 'rotation'>, occupied: Set<string>, resolution: PlacementResolution = 'base') => fitsSurface(surface, item, item.footprint, item.rotation[1]) && !normalizedCells(cellsFor(item, item.footprint, item.rotation[1]), resolution).some((cell) => occupied.has(`${cell.x}:${cell.y}`))
export const fitMeshToFootprint = (surface: PlacementSurface, footprint: Footprint) => { const cell = getCellSize(surface); return [footprint.width * cell.width, footprint.depth * cell.height] as const }
export const getWallItemTargetSize = (wall: PlacementSurface, footprint: Footprint) => { const cell = getWallCellSize(wall); return [footprint.width * cell.width, footprint.depth * cell.height] as const }
export const fitWallItemToFootprint = getWallItemTargetSize
export const nearestWallId = (point: [number, number, number]): WallId => Math.abs(point[0] - wallSurfaces.leftWall.position[0]) < Math.abs(point[2] - wallSurfaces.rightWall.position[2]) ? 'leftWall' : 'rightWall'

// ponytail: 8-directional A* over a 10x10 grid (100 cells) — a heap-based open set isn't worth it at this size
const DIAGONAL = Math.SQRT2
const STEPS = [{ dx: 1, dy: 0, cost: 1 }, { dx: -1, dy: 0, cost: 1 }, { dx: 0, dy: 1, cost: 1 }, { dx: 0, dy: -1, cost: 1 }, { dx: 1, dy: 1, cost: DIAGONAL }, { dx: 1, dy: -1, cost: DIAGONAL }, { dx: -1, dy: 1, cost: DIAGONAL }, { dx: -1, dy: -1, cost: DIAGONAL }]

export const findPath = (occupied: Set<string>, start: GridPosition, goal: GridPosition): GridPosition[] => {
  const key = (p: GridPosition) => `${p.gridX}:${p.gridY}`
  const inBounds = (p: GridPosition) => p.gridX >= 0 && p.gridX < GRID_COUNT && p.gridY >= 0 && p.gridY < GRID_COUNT
  const walkable = (p: GridPosition) => inBounds(p) && !occupied.has(key(p))
  // octile distance: admissible heuristic for a grid that allows diagonal moves
  const heuristic = (a: GridPosition, b: GridPosition) => { const dx = Math.abs(a.gridX - b.gridX); const dy = Math.abs(a.gridY - b.gridY); return Math.max(dx, dy) + (DIAGONAL - 1) * Math.min(dx, dy) }
  if (!inBounds(goal) || (occupied.has(key(goal)) && key(goal) !== key(start))) return []
  const open = [start]; const cameFrom = new Map<string, GridPosition>(); const gScore = new Map<string, number>([[key(start), 0]])
  const fScore = new Map<string, number>([[key(start), heuristic(start, goal)]])
  while (open.length) {
    open.sort((a, b) => (fScore.get(key(a)) ?? Infinity) - (fScore.get(key(b)) ?? Infinity))
    const current = open.shift()!
    if (key(current) === key(goal)) {
      const path = [current]; let node = current
      while (cameFrom.has(key(node))) { node = cameFrom.get(key(node))!; path.unshift(node) }
      return path.slice(1)
    }
    for (const step of STEPS) {
      const neighbor = { gridX: current.gridX + step.dx, gridY: current.gridY + step.dy }
      if (!walkable(neighbor)) continue
      // no cutting across a blocked corner: a diagonal move needs both flanking orthogonal cells open
      if (step.dx !== 0 && step.dy !== 0 && (!walkable({ gridX: current.gridX + step.dx, gridY: current.gridY }) || !walkable({ gridX: current.gridX, gridY: current.gridY + step.dy }))) continue
      const tentativeG = (gScore.get(key(current)) ?? Infinity) + step.cost
      if (tentativeG < (gScore.get(key(neighbor)) ?? Infinity)) {
        cameFrom.set(key(neighbor), current); gScore.set(key(neighbor), tentativeG); fScore.set(key(neighbor), tentativeG + heuristic(neighbor, goal))
        if (!open.some((p) => key(p) === key(neighbor))) open.push(neighbor)
      }
    }
  }
  return []
}
