import { Euler, Quaternion, Vector3 } from 'three'
import { clampModelScale, type CustomObjectSpec, type CustomTopSurface } from '../customObjectSpec'

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
export type ResizeCorner = 'northWest' | 'northEast' | 'southWest' | 'southEast'
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
  bed: [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.68 }],
  'hotel-bed': [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.84 }],
  sofa: [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.5 }],
  chair: [{ suffix: 'seat', kind: 'seat', heightOffset: 0.54 }],
  'side-table': [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.54 }],
  'music-player': [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.54 }],
  // 책장: 2단 고정 — 각 단 판자 윗면(0.18/0.80 + 판 반두께 .06)과 꼭대기(capY 1.64 + .06)
  bookshelf: [{ suffix: 'top', kind: 'tabletop', heightOffset: 1.7 }, { suffix: 'shelf1', kind: 'shelf', heightOffset: .24 }, { suffix: 'shelf2', kind: 'shelf', heightOffset: .86 }],
  fireplace: [{ suffix: 'top', kind: 'tabletop', heightOffset: 1.03 }],
  'coffee-table': [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.35 }],
  'glass-shelf': [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.66 }],
  wardrobe: [{ suffix: 'top', kind: 'tabletop', heightOffset: 1.9 }],
  'mini-fridge': [{ suffix: 'top', kind: 'tabletop', heightOffset: 0.86 }],
  'rocking-chair': [{ suffix: 'seat', kind: 'seat', heightOffset: 0.49 }],
}
// GLB 카탈로그 가구의 상판. 값은 모델 로컬 단위(바닥 y=0 기준)로 실측한 것이고, AI 생성 오브젝트가 쓰는
// customSpec.topSurface와 완전히 같은 의미다 — 그래서 아래 surfacesForOwner의 커스텀 분기를 그대로 탄다.
// 위 OWNED_SURFACES(프리미티브 가구)와는 서로 참조가 없다: 나중에 프리미티브 가구를 통째로 지워도 이 표는 산다.
// 절대 이 타입들을 OWNED_SURFACES에 넣지 말 것 — SURFACED_TYPES에 들어가는 순간 FittedMesh의 높이 맞춤이
// 바뀌어 가구 자체의 크기가 변한다.
type ModelSurface = CustomTopSurface & { suffix: string; kind: SurfaceKind }
// 벽에 걸리는 GLB는 여기 넣으면 안 된다: FittedMesh의 벽 분기는 Y를 칸 높이에 맞춰 늘리고 Z는 1로 두는데,
// 아래 계산은 바닥 가구용(균일 맞춤)이라 상판이 실제 판보다 훨씬 낮게 잡힌다 — 올린 물건이 판에 파묻혔다.
// bracket-shelf(실측 modelSize [1.149,.236,.699], top .236)는 그래서 뺐다. 벽 선반은 wall-shelf 분기가 따로 있다.
const GLB_TOPS: Record<string, { modelSize: [number, number, number]; surfaces: ModelSurface[] }> = {
  'aqua-table': { modelSize: [1.099, .383, .623], surfaces: [{ suffix: 'top', kind: 'tabletop', height: .344, center: [0, 0], size: [1.077, .6] }] },
  'deco-shelf': { modelSize: [.794, .958, .335], surfaces: [{ suffix: 'top', kind: 'tabletop', height: .958, center: [.001, .002], size: [.682, .325] }] },
  // 윗면 + 뚫린 칸 두 줄(닫힌 서랍 줄은 제외). 칸 천장이 낮아 높은 물건은 위로 나온다
  'color-drawers': { modelSize: [.891, 1.002, .34], surfaces: [
    { suffix: 'top', kind: 'tabletop', height: 1.001, center: [0, -.014], size: [.83, .276] },
    { suffix: 'cubby1', kind: 'shelf', height: .73, center: [.005, .022], size: [.764, .211] },
    { suffix: 'cubby2', kind: 'shelf', height: .267, center: [-.003, .019], size: [.778, .216] },
  ] },
  // 검출기는 가장 높은 면인 뒷판 위 모서리(1.198)를 골랐다 — 실제 상판은 .778이다. 뒷판 구조물이 z −.261~−.061을
  // 차지하므로 그 앞쪽 빈 자리(깊이 .3)만 상판으로 준다
  'frutiger-desk': { modelSize: [1.574, 1.204, .524], surfaces: [{ suffix: 'top', kind: 'tabletop', height: .778, center: [-.001, .095], size: [1.51, .3] }] },
  'pink-vanity': { modelSize: [.652, .989, .303], surfaces: [{ suffix: 'top', kind: 'tabletop', height: .495, center: [0, -.001], size: [.65, .301] }] },
  'cloud-sofa': { modelSize: [1.002, .414, .387], surfaces: [{ suffix: 'top', kind: 'tabletop', height: .225, center: [0, .025], size: [.828, .278] }] },
  'dome-sofa': { modelSize: [1, .74, .996], surfaces: [{ suffix: 'top', kind: 'tabletop', height: .201, center: [.003, -.022], size: [.91, .709] }] },
  'pink-mini-sofa': { modelSize: [.845, .788, .8], surfaces: [{ suffix: 'top', kind: 'tabletop', height: .3, center: [0, .114], size: [.745, .552] }] },
  'hanging-bubble-chair': { modelSize: [.755, .982, .614], surfaces: [{ suffix: 'top', kind: 'tabletop', height: .314, center: [.04, -.054], size: [.38, .4] }] },
}

// 위에 물건이 올라가는 가구: 상판/좌석 높이(heightOffset)가 이 모델들의 계약값이라, 맞춤 스케일이
// 높이를 건드리면 안 된다 — FittedMesh가 이 셋만 기존 X/Z 맞춤을 유지한다
export const SURFACED_TYPES = new Set([...Object.keys(OWNED_SURFACES), 'wall-shelf'])
export type SurfaceHost = { id: string; type: string; position: [number, number, number]; rotation: [number, number, number]; footprint: Footprint; wallId?: WallId; customSpec?: CustomObjectSpec }

// the surfaces a piece of furniture currently hosts, positioned/rotated from its LIVE position — move or rotate the
// owner and every surface (and everything placed on it) moves with it, because this is recomputed from scratch each
// call. Size and grid come from the owner's UNROTATED local footprint; the surface's own rotation (-yaw, mirroring
// the mesh's Ry(+yaw)) is the ONLY place the owner's rotation enters — using the rotated footprint here too would
// rotate the grid twice, leaving it 90° off the furniture. Items keep their local gridX/gridY, so they (and the
// grid) turn together with the owner. subCellSize stays exactly GRID_SIZE/2: (footprint*GRID_SIZE)/(footprint*2)
// The bookshelf grows with its tiers: 2 by default, one more whenever a book sits on the current top tier.
// Its cap (and anything placed on top) follows the tier count.

// 벽에 걸려 물건을 올릴 수 있는 선반. out = 벽면에서 나온 거리(판 깊이의 중앙), lift = 아이템 앵커에서 판
// 윗면까지의 높이. 벽 아이템은 바닥 가구와 스케일 규칙이 아예 달라서 GLB_TOPS를 쓸 수 없고 여기로 온다.
// GLB 벽 아이템은 GlbFurniture가 X·Y 중앙을 앵커에 맞추고, FittedMesh 벽 분기가 Y를 칸 높이(0.7)에 꽉 채우도록
// 늘린다 — 그래서 판 윗면은 항상 앵커 +0.35이고, 깊이는 스케일 1이라 모델 깊이의 절반만큼 벽에서 나온다.
const WALL_SHELVES: Record<string, { out: number; lift: number }> = {
  'wall-shelf': { out: .36, lift: -.23 },
  // 실측 modelSize [1.149, .236, .699] — 윗면이 곧 모델 최상단이라 lift는 칸 높이의 절반
  'bracket-shelf': { out: .35, lift: .35 },
}

export const surfacesForOwner = (item: SurfaceHost): PlacementSurface[] => {
  const wallShelf = item.wallId ? WALL_SHELVES[item.type] : undefined
  if (wallShelf && item.wallId) {
    const wall = wallSurfaces[item.wallId]
    const rotation = new Euler().setFromQuaternion(new Quaternion().setFromEuler(new Euler(...wall.rotation)).multiply(new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0))))
    return [{
      id: `${item.id}:top`, ownerId: item.id, type: 'shelf', orientation: 'horizontal',
      width: item.footprint.width * GRID_SIZE, height: GRID_SIZE, gridColumns: item.footprint.width * 2, gridRows: 2,
      position: [item.position[0] + wall.normal[0] * wallShelf.out, item.position[1] + wallShelf.lift, item.position[2] + wall.normal[2] * wallShelf.out],
      rotation: [rotation.x, rotation.y, rotation.z], normal: [0, 1, 0],
    }]
  }
  const custom = item.customSpec
  // 모델 좌표로 잰 면 하나를 방 좌표의 배치 표면으로 옮긴다 — AI 생성 오브젝트와 카탈로그 GLB가 같은 식을 쓴다
  const modelSurface = (model: [number, number, number], top: CustomTopSurface, suffix: string, kind: SurfaceKind): PlacementSurface | null => {
    const scale = clampModelScale(custom?.modelScale)
    const fitX = item.footprint.width * GRID_SIZE / model[0]
    const fitZ = item.footprint.depth * GRID_SIZE / model[2]
    const fitY = Math.min(fitX, fitZ)
    const width = top.size[0] * fitX * scale[0]
    const depth = top.size[1] * fitZ * scale[2]
    // 실측 윗면은 베벨·모서리 때문에 늘 모델 폭보다 조금 작다 — floor로 자르면 1칸짜리 축이 무조건 0.5칸 손해라
    // 반올림하고, 대신 자기 차지 칸(footprint*2)을 넘지 못하게 막는다
    const columns = Math.min(item.footprint.width * 2, Math.round(width / (GRID_SIZE / 2)))
    const rows = Math.min(item.footprint.depth * 2, Math.round(depth / (GRID_SIZE / 2)))
    if (columns <= 0 || rows <= 0) return null
    const localX = top.center[0] * fitX * scale[0]
    const localZ = top.center[1] * fitZ * scale[2]
    const yaw = item.rotation[1]; const cos = Math.cos(yaw); const sin = Math.sin(yaw)
    return {
      id: `${item.id}:${suffix}`, ownerId: item.id, type: kind, orientation: 'horizontal',
      width: columns * GRID_SIZE / 2, height: rows * GRID_SIZE / 2, gridColumns: columns, gridRows: rows,
      position: [item.position[0] + cos * localX + sin * localZ, item.position[1] + top.height * fitY * scale[1], item.position[2] - sin * localX + cos * localZ],
      rotation: [Math.PI / 2, 0, -yaw], normal: [0, 1, 0],
    }
  }
  // topSurface(단수)는 면을 하나만 저장하던 시절의 오브젝트 — 첫 칸의 suffix가 'top'이라 이미 놓인 물건도 그대로 붙어 있는다
  const customTops = custom?.topSurfaces ?? (custom?.topSurface ? [custom.topSurface] : [])
  if (custom?.category === 'furniture' && custom.modelSize && customTops.length) {
    const model = custom.modelSize
    const surfaces = customTops.map((top, index) => modelSurface(model, top, index ? `tier${index}` : 'top', index ? 'shelf' : 'tabletop')).filter((surface) => !!surface)
    if (surfaces.length) return surfaces
  }
  // 커스텀(AI 생성)이 아니면 카탈로그 GLB 실측표로 폴백한다. 벽에 걸린 것은 스케일 규칙이 달라 제외한다
  const preset = custom || item.wallId ? undefined : GLB_TOPS[item.type]
  if (preset) {
    const surfaces = preset.surfaces.map((entry) => modelSurface(preset.modelSize, entry, entry.suffix, entry.kind)).filter((surface) => !!surface)
    if (surfaces.length) return surfaces
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
if (import.meta.env.DEV) {
  const customTop = surfacesForOwner({ id: 'custom-check', type: 'custom:check', position: [1, 0, 2], rotation: [0, Math.PI / 2, 0], footprint: { width: 2, depth: 2 }, customSpec: { id: 'check', name: 'check', category: 'furniture', footprint: { width: 2, depth: 2 }, parts: [], glbUrl: 'https://example.com/check.glb', modelSize: [2, 2, 2], modelScale: [1, .5, 1], topSurface: { height: 1, center: [0, 0], size: [2, 2] } } })[0]
  console.assert(customTop?.position[1] === .35 && customTop.gridColumns === 4 && customTop.gridRows === 4, 'custom top surface must follow model scale and keep the shared sub-grid')
  // 카탈로그 GLB는 customSpec 없이 GLB_TOPS 폴백으로 같은 계산을 타야 한다
  const glbTop = surfacesForOwner({ id: 'glb-check', type: 'aqua-table', position: [0, 0, 0], rotation: [0, 0, 0], footprint: { width: 2, depth: 1 } })[0]
  console.assert(glbTop && Math.abs(glbTop.position[1] - .344 * (1 * GRID_SIZE / .623)) < 1e-3 && glbTop.gridColumns === 4 && glbTop.gridRows === 2, 'catalog GLB furniture must host a top surface from GLB_TOPS')
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
// Resize handles snap to grid LINES, not cell centres. Keeping this separate from worldToGrid avoids the
// half-cell drift that appears when an even-sized frame is resized from one corner.
export const worldToGridBoundary = (surface: PlacementSurface, point: [number, number, number]): GridPosition => {
  const cell = getCellSize(surface); const delta = new Vector3(...point).sub(new Vector3(...surface.position)); const axes = getSurfaceAxes(surface)
  return { gridX: Math.round((delta.dot(axes.horizontal) + surface.width / 2) / cell.width), gridY: Math.round((delta.dot(axes.vertical) + surface.height / 2) / cell.height) }
}

const CORNER_SIGN: Record<ResizeCorner, readonly [number, number]> = {
  northWest: [-1, 1], northEast: [1, 1], southWest: [-1, -1], southEast: [1, -1],
}

// Returns an item's new cell rectangle while the opposite visual corner stays fixed. The handle name is local
// to the frame, so its sign is rotated into the surface grid before the occupied rectangle is changed.
export const resizeFromCorner = (surface: PlacementSurface, item: PlacementItem, corner: ResizeCorner, boundary: GridPosition) => {
  const occupied = rotatedFootprint(item.footprint, item.rotation[1]); const [localX, localY] = CORNER_SIGN[corner]
  const quarter = ((Math.round(item.rotation[1] / (Math.PI / 2)) % 4) + 4) % 4; const angle = quarter * Math.PI / 2
  const signX = Math.round(localX * Math.cos(angle) - localY * Math.sin(angle)); const signY = Math.round(localX * Math.sin(angle) + localY * Math.cos(angle))
  const minX = item.gridX; const maxX = minX + occupied.width; const minY = item.gridY; const maxY = minY + occupied.depth
  const fixedX = signX > 0 ? minX : maxX; const fixedY = signY > 0 ? minY : maxY
  const movingX = signX > 0 ? Math.max(fixedX + 1, Math.min(boundary.gridX, surface.gridColumns)) : Math.min(fixedX - 1, Math.max(boundary.gridX, 0))
  const movingY = signY > 0 ? Math.max(fixedY + 1, Math.min(boundary.gridY, surface.gridRows)) : Math.min(fixedY - 1, Math.max(boundary.gridY, 0))
  const gridX = Math.min(fixedX, movingX); const gridY = Math.min(fixedY, movingY)
  const width = Math.abs(movingX - fixedX); const depth = Math.abs(movingY - fixedY)
  const footprint = quarter % 2 ? { width: depth, depth: width } : { width, depth }
  return { gridX, gridY, footprint }
}

if (import.meta.env.DEV) {
  const resized = resizeFromCorner(wallSurfaces.leftWall, { surfaceId: 'leftWall', gridX: 2, gridY: 2, footprint: { width: 2, depth: 2 }, rotation: [0, 0, 0] }, 'northEast', { gridX: 6, gridY: 5 })
  console.assert(resized.gridX === 2 && resized.gridY === 2 && resized.footprint.width === 4 && resized.footprint.depth === 3, 'wall resize must keep the opposite grid corner fixed')
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
