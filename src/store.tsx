import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { loadArtworks, loadBooks, loadGuestbook, loadRoomLayout, loadRoomStyle, saveArtworks, saveBooks, saveGuestbook, saveRoomLayout, saveRoomStyle, type FurniturePlacement, type RoomStyle } from './services/roomLayoutStorage'
import { canPlaceItem, cellsFor, clampGrid, floorSurface, GRID_COUNT, gridToWorld, isOwnedSurfaceId, nearestWallId, normalizedCells, ownerIdOf, resolveSurface, withResolution, type Footprint, type GridPosition, type PlacementItem, type PlacementResolution, type PlacementSurface, type SurfaceId, type SurfaceKind, type WallId, worldToGrid } from './services/roomGrid'
import { characterPosition } from './services/characterTracker'
import { playTrack, setMusicVolume as applyMusicVolume, stopMusic } from './services/music'

export type SelectedObject = string | null
export type FurnitureId = string
export type CharacterState = 'idle' | 'walking' | 'aligning' | 'sitting' | 'laying' | 'sleeping' | 'reading' | 'working' | 'interacting' | 'sittingFloor' | 'wave'
export type Visibility = 'public' | 'private'
export type RoomMode = 'normal' | 'edit'
export type FurnitureCategory = 'floorFurniture' | 'surfaceItem' | 'wallItem' | 'decoration'
export type FurnitureItem = FurniturePlacement & PlacementItem & { id: FurnitureId; name: string; position: [number, number, number]; gridZ: number; wallId?: WallId; footprint: Footprint; category: FurnitureCategory; movable: boolean; interactable: boolean; size: [number, number]; allowedSurfaces: SurfaceKind[] }
export type InventoryCategory = '전체' | '가구' | '조명' | '식물' | '벽장식' | '소품'
export type Entry = { id: string; bookId: string; title: string; content: string; images: string[]; date: string; visibility: Visibility; createdAt: string; updatedAt: string }
export type Book = { id: string; title: string; coverColor: string; description: string; visibility: Visibility; createdAt: string; updatedAt: string; entries: Entry[] }

const now = '2026-08-12T12:00:00.000Z'
// anything that can sit on a tabletop/shelf/seat is DECOR and lives in subcell units (0.35) everywhere — including
// on the floor, where each base cell splits 2x2 for it — so its physical size never changes between surfaces.
// Pure floor/wall furniture stays on the base 10x10 grid. Decor footprints are declared in subcells accordingly.
export const resolutionFor = (item: Pick<FurnitureItem, 'allowedSurfaces'>): PlacementResolution => item.allowedSurfaces.some((kind) => kind === 'tabletop' || kind === 'shelf' || kind === 'seat') ? 'subgrid2' : 'base'
const wallIdFor = (wallId?: string): WallId => wallId === 'rightWall' || wallId === 'back' ? 'rightWall' : 'leftWall'
const placementGrid = (item: Pick<FurnitureItem, 'gridX' | 'gridY'>): GridPosition => ({ gridX: item.gridX, gridY: item.gridY })
// grid math only applies to items that actually sit in a surface's cell grid — fixed set-dressing (movable: false,
// footprint 0) skips it entirely, same as before this generalized to more than floor/wall
const isGridPlaced = (item: Pick<FurnitureItem, 'movable' | 'footprint'>) => item.movable && item.footprint.width > 0
const isFloorCovering = (item: Pick<FurnitureItem, 'type' | 'surfaceId'>) => item.surfaceId === 'floor' && ['rug', 'carpet', 'mat', 'floor-mat'].includes(item.type)
// the character's pathfinding runs on the BASE 10x10 grid, but subgrid2 floor items store subcell coords — collapse
// them (subcell/2) so a floor-standing plant still blocks the base cell(s) it covers
export const baseFloorCells = (item: Pick<FurnitureItem, 'gridX' | 'gridY' | 'footprint' | 'rotation' | 'allowedSurfaces'>) => {
  const cells = cellsFor({ gridX: item.gridX, gridY: item.gridY }, item.footprint, item.rotation[1])
  return resolutionFor(item) === 'subgrid2' ? cells.map((cell) => ({ x: Math.floor(cell.x / 2), y: Math.floor(cell.y / 2) })) : cells
}
const placeOnSurface = (context: FurnitureItem[], item: FurnitureItem, surfaceId: SurfaceId, grid: GridPosition, rotation = item.rotation): FurnitureItem => {
  const surface = resolveSurface(context, surfaceId) ?? resolveSurface(context, 'floor')!
  const resolution = resolutionFor(item)
  const point = gridToWorld(withResolution(surface, resolution), grid, item.footprint, rotation[1])
  // always take the surface's own height — keeping the item's previous y here left tabletop items floating at
  // tabletop height after being moved down to the floor
  return { ...item, surfaceId, wallId: surface.type === 'wall' ? surface.id as WallId : undefined, gridX: grid.gridX, gridY: grid.gridY, gridZ: surface.type === 'floor' ? grid.gridY : 0, rotation, position: point }
}
const floorItem = (id: FurnitureId, name: string, type: string, gridX: number, gridZ: number, footprint: Footprint, allowedSurfaces: SurfaceKind[] = ['floor'], movable = true, y = 0): FurnitureItem => placeOnSurface([], { id, name, type, surfaceId: 'floor', gridX, gridY: gridZ, gridZ, footprint, position: [0, y, 0], rotation: [0, 0, 0], scale: 1, category: 'floorFurniture', movable, interactable: true, size: [footprint.width, footprint.depth], allowedSurfaces, updatedAt: now }, 'floor', { gridX, gridY: gridZ })
const staticItem = (id: FurnitureId, name: string, type: string, position: [number, number, number], category: FurnitureCategory, allowedSurfaces: SurfaceKind[] = []): FurnitureItem => ({ id, name, type, surfaceId: 'floor', position, gridX: 0, gridZ: 0, gridY: 0, footprint: { width: 0, depth: 0 }, rotation: [0, 0, 0], scale: 1, category, movable: false, interactable: true, size: [0, 0], allowedSurfaces, updatedAt: now })
const wallItem = (id: FurnitureId, name: string, type: string, wallId: WallId, gridX: number, gridY: number, footprint: Footprint): FurnitureItem => placeOnSurface([], { id, name, type, surfaceId: wallId, wallId, gridX, gridY, gridZ: 0, footprint, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, category: 'wallItem', movable: true, interactable: true, size: [footprint.width, footprint.depth], allowedSurfaces: ['wall'], updatedAt: now }, wallId, { gridX, gridY })
// an item that lives on a PlacementSurface hosted by another piece of furniture (a desk top, a cabinet top, ...) —
// `context` must already contain the owner so its surface can be resolved
const surfaceItem = (id: FurnitureId, name: string, type: string, ownerSurfaceId: SurfaceId, gridX: number, gridY: number, footprint: Footprint, allowedSurfaces: SurfaceKind[], context: FurnitureItem[]): FurnitureItem => placeOnSurface(context, { id, name, type, surfaceId: ownerSurfaceId, gridX, gridY, gridZ: 0, footprint, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, category: 'surfaceItem', movable: true, interactable: true, size: [footprint.width, footprint.depth], allowedSurfaces, updatedAt: now }, ownerSurfaceId, { gridX, gridY })

const bedItem = floorItem('bed', '침대', 'bed', 1, 6, { width: 2, depth: 3 })
const deskItem = floorItem('desk', '책상', 'desk', 1, 1, { width: 2, depth: 1 })
const chairItem = floorItem('chair', '의자', 'chair', 1, 2, { width: 1, depth: 1 })
chairItem.rotation = [0, Math.PI, 0]
// desk's own tabletop is a small 4x2 grid (see roomGrid's OWNED_SURFACES) — footprints below are sized to roughly
// match each item's real mesh dimensions so FittedMesh's auto-scale doesn't shrink/blow them up
const computerItem = surfaceItem('computer', '컴퓨터', 'computer', 'desk:top', 0, 0, { width: 2, depth: 1 }, ['floor', 'tabletop'], [deskItem])
const sofaItem = floorItem('sofa', '소파', 'sofa', 6, 6, { width: 3, depth: 1 })
const bookshelfItem = floorItem('bookshelf', '책장', 'bookshelf', 7, 0, { width: 2, depth: 1 })
// decor footprints AND their floor grid coords are in SUBCELL units (2 subcells = 1 base cell) — see resolutionFor
const plantItem = floorItem('plant', '화분', 'plant', 0, 8, { width: 1, depth: 1 })
const lampItem = floorItem('lamp', '스탠드 조명', 'lamp', 0, 6, { width: 1, depth: 1 })
const cabinetItem = floorItem('cabinet', '수납장', 'cabinet', 7, 8, { width: 2, depth: 1 })
const rugItem = floorItem('rug', '러그', 'rug', 3, 3, { width: 3, depth: 2 })
const binItem = staticItem('bin', '휴지통', 'bin', [-2.75, 0, -0.85], 'decoration', ['floor'])
const cupItem = surfaceItem('cup', '머그컵', 'cup', 'desk:top', 3, 0, { width: 1, depth: 1 }, ['floor', 'tabletop', 'shelf'], [deskItem])
const clockItem = wallItem('clock', '벽 시계', 'clock', 'leftWall', 1, 6, { width: 2, depth: 2 })
const posterItem = wallItem('poster', '포스터', 'poster', 'leftWall', 4, 3, { width: 2, depth: 3 })
const photoItem = wallItem('photo', '사진', 'photo', 'leftWall', 7, 1, { width: 1, depth: 1 })
export const initialFurniture: FurnitureItem[] = [bedItem, deskItem, chairItem, computerItem, sofaItem, bookshelfItem, plantItem, lampItem, cabinetItem, rugItem, binItem, cupItem, clockItem, posterItem, photoItem]

export const inventoryItems: Array<Omit<FurnitureItem, 'id' | 'position' | 'surfaceId' | 'gridX' | 'gridY' | 'gridZ' | 'wallId' | 'rotation' | 'updatedAt'>> = [
  { type: 'side-table', name: '사이드 테이블', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'music-player', name: '뮤직 플레이어', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'floor-lamp', name: '플로어 램프', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'potted-plant', name: '작은 화분', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop', 'shelf'] },
  { type: 'string-lights', name: '스트링 라이트', category: 'wallItem', movable: true, interactable: true, footprint: { width: 3, depth: 1 }, size: [3, 1], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'calendar', name: '달력', category: 'wallItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'christmas-tree', name: '크리스마스 트리', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 2 }, size: [2, 2], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'record-player', name: '레코드 플레이어', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'whiteboard', name: '이젤 보드', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'rocking-chair', name: '흔들의자', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'beanbag', name: '빈백', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'mini-fridge', name: '미니 냉장고', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'hanger', name: '행거', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'led-lamp', name: 'LED 램프', category: 'surfaceItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop'] },
  { type: 'star-projector', name: '별 프로젝터', category: 'surfaceItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop'] },
  { type: 'guestbook', name: '방명록', category: 'wallItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'cd-player', name: 'CD 플레이어', category: 'wallItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'banner', name: '움직이는 배너', category: 'wallItem', movable: true, interactable: true, footprint: { width: 3, depth: 1 }, size: [3, 1], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'window', name: '창문', category: 'wallItem', movable: true, interactable: true, footprint: { width: 3, depth: 2 }, size: [3, 2], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'curtain', name: '커튼', category: 'wallItem', movable: true, interactable: true, footprint: { width: 2, depth: 4 }, size: [2, 4], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'fireplace', name: '벽난로', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'coffee-table', name: '좌식 테이블', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'tv', name: 'TV', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'wardrobe', name: '옷장', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'mirror', name: '전신 거울', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'fish-tank', name: '어항', category: 'surfaceItem', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop'] },
  { type: 'candle', name: '캔들', category: 'surfaceItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop'] },
  { type: 'animated-poster', name: '무빙 포스터', category: 'wallItem', movable: true, interactable: true, footprint: { width: 2, depth: 3 }, size: [2, 3], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'wall-art', name: '벽 포스터', category: 'wallItem', movable: true, interactable: true, footprint: { width: 2, depth: 3 }, size: [2, 3], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'wall-art-3', name: '벽 포스터 3×4', category: 'wallItem', movable: true, interactable: true, footprint: { width: 3, depth: 4 }, size: [3, 4], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'wall-art-4', name: '벽 포스터 4×5', category: 'wallItem', movable: true, interactable: true, footprint: { width: 4, depth: 5 }, size: [4, 5], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'wall-art-5', name: '벽 포스터 5×6', category: 'wallItem', movable: true, interactable: true, footprint: { width: 5, depth: 6 }, size: [5, 6], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'wall-shelf', name: '벽 선반', category: 'wallItem', movable: true, interactable: true, footprint: { width: 3, depth: 1 }, size: [3, 1], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'vase', name: '화병', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 2 }, size: [2, 2], scale: 1, allowedSurfaces: ['floor', 'tabletop', 'shelf'] },
  { type: 'cushion', name: '쿠션', category: 'surfaceItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop'] },
  { type: 'plush', name: '인형', category: 'surfaceItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop'] },
  { type: 'mug', name: '머그컵', category: 'surfaceItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop', 'shelf'] },
  { type: 'book-prop', name: '책', category: 'surfaceItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop', 'shelf'] },
  { type: 'speaker', name: '스피커', category: 'surfaceItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop', 'shelf'] },
  { type: 'photo-frame', name: '사진 액자 1×1', category: 'wallItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'photo-frame-2', name: '사진 액자 2×2', category: 'wallItem', movable: true, interactable: true, footprint: { width: 2, depth: 2 }, size: [2, 2], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'photo-frame-3', name: '사진 액자 3×3', category: 'wallItem', movable: true, interactable: true, footprint: { width: 3, depth: 3 }, size: [3, 3], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'photo-frame-4', name: '사진 액자 4×4', category: 'wallItem', movable: true, interactable: true, footprint: { width: 4, depth: 4 }, size: [4, 4], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'photo-frame-5', name: '사진 액자 5×5', category: 'wallItem', movable: true, interactable: true, footprint: { width: 5, depth: 5 }, size: [5, 5], scale: 1, allowedSurfaces: ['wall'] },
]

export const currentUser = { id: 'me', name: '나' }

const initialBooks: Book[] = [
  { id: 'daily-2026', title: '2026년 일기', coverColor: '#718475', description: '하루의 기록', visibility: 'private', createdAt: now, updatedAt: now, entries: [{ id: 'entry-1', bookId: 'daily-2026', title: '비가 오기 전의 오후', content: '창문을 열어두고 책을 읽었다.', images: [], date: '2026-08-12', visibility: 'private', createdAt: now, updatedAt: now }] }, { id: 'travel', title: '여행 기록', coverColor: '#b96b52', description: '기억하고 싶은 장면', visibility: 'public', createdAt: now, updatedAt: now, entries: [] }, { id: 'ideas', title: '아이디어', coverColor: '#607b93', description: '생각의 조각', visibility: 'private', createdAt: now, updatedAt: now, entries: [] },
]

// existing gridX/gridY/footprint predate the sub-grid units for items that are NOW subgrid2 (they were captured at
// base-grid scale) — silently trusting them would land the item at half its saved offset/size, so a legacy save
// (its `resolution` flag isn't 'subgrid2') is doubled once, only on non-owned surfaces (owned-surface coords were
// always in subcells); `persist` writes the flag on the next save, so this migration never re-applies
const isLegacySave = (resolution: PlacementResolution, surface: PlacementSurface, value: FurniturePlacement) => resolution === 'subgrid2' && value.resolution !== 'subgrid2' && !surface.ownerId
// and the opposite: an item saved while it was subgrid2 whose template became floor-only (base) — halve once
const isDownscaledSave = (resolution: PlacementResolution, surface: PlacementSurface, value: FurniturePlacement) => resolution === 'base' && value.resolution === 'subgrid2' && !surface.ownerId
const migratedGrid = (resolution: PlacementResolution, surface: PlacementSurface, value: FurniturePlacement, footprint: Footprint, rotationY: number, fallbackPosition: [number, number, number], savedY?: number): GridPosition => {
  if (isLegacySave(resolution, surface, value) && value.gridX !== undefined && savedY !== undefined) return { gridX: value.gridX * 2, gridY: savedY * 2 }
  if (isDownscaledSave(resolution, surface, value) && value.gridX !== undefined && savedY !== undefined) return { gridX: Math.floor(value.gridX / 2), gridY: Math.floor(savedY / 2) }
  if (value.gridX !== undefined && savedY !== undefined) return { gridX: value.gridX, gridY: savedY }
  return worldToGrid(withResolution(surface, resolution), value.position ?? fallbackPosition, footprint, rotationY)
}
const hydrateFurniture = () => {
  const saved = typeof window === 'undefined' ? null : loadRoomLayout()
  if (!saved) return initialFurniture
  // restored items are pushed here as they're produced, so a later item (e.g. "computer") can resolve a surface
  // hosted by an earlier one (e.g. "desk:top") — initialFurniture is already ordered owner-before-occupant
  const resolved: FurnitureItem[] = []
  const restore = (base: FurnitureItem, value?: FurniturePlacement): FurnitureItem => {
    if (!value) return base
    const rotation = value.rotation ?? base.rotation
    if (!isGridPlaced(base)) return { ...base, ...value, id: base.id, rotation, footprint: base.footprint }
    const surfaceId = value.surfaceId ?? base.surfaceId
    const surface = resolveSurface(resolved, surfaceId) ?? resolveSurface(resolved, 'floor')!
    const resolution = resolutionFor(base)
    // a legacy save's footprint is in old base units — the current template footprint is the migrated truth
    const footprint = base.id === 'sofa' || isLegacySave(resolution, surface, value) || isDownscaledSave(resolution, surface, value) || !value.footprint?.width || !value.footprint?.depth ? base.footprint : value.footprint
    const savedY = surface.type === 'floor' ? (value.surfaceId === 'floor' ? value.gridY : value.gridZ ?? value.gridY) : value.gridY
    const grid = migratedGrid(resolution, surface, value, footprint, rotation[1], base.position, savedY)
    return placeOnSurface(resolved, { ...base, ...value, id: base.id, footprint, rotation, surfaceId, position: [base.position[0], value.position?.[1] ?? base.position[1], base.position[2]], size: [footprint.width, footprint.depth] as [number, number] }, surfaceId, grid, rotation)
  }
  for (const base of initialFurniture) resolved.push(restore(base, saved.find((value) => value.id === base.id)))
  const extras = saved.filter((value) => !initialFurniture.some((base) => base.id === value.id)).flatMap((value) => {
    const template = inventoryItems.find((entry) => entry.type === value.type)
    if (!template) return []
    const surfaceId = value.surfaceId ?? (template.category === 'wallItem' ? wallIdFor(value.wallId) : 'floor')
    const surface = resolveSurface(resolved, surfaceId) ?? resolveSurface(resolved, 'floor')!
    const resolution = resolutionFor(template)
    const footprint = isLegacySave(resolution, surface, value) || isDownscaledSave(resolution, surface, value) || !value.footprint?.width || !value.footprint?.depth ? template.footprint : value.footprint
    const savedY = surface.type === 'floor' ? (value.surfaceId === 'floor' ? value.gridY : value.gridZ ?? value.gridY) : value.gridY
    const grid = migratedGrid(resolution, surface, value, footprint, value.rotation[1], [0, 0, 0], savedY)
    const item = { ...template, ...value, id: value.id, surfaceId, wallId: surface.type === 'wall' ? surface.id as WallId : undefined, footprint, gridX: grid.gridX, gridY: grid.gridY, gridZ: surface.type === 'floor' ? grid.gridY : 0, position: [0, value.position?.[1] ?? 0, 0] as [number, number, number], size: [footprint.width, footprint.depth] as [number, number] } as FurnitureItem
    return [placeOnSurface(resolved, item, surfaceId, grid, value.rotation)]
  })
  return [...resolved, ...extras]
}
const same = (a: FurnitureItem[], b: FurnitureItem[]) => JSON.stringify(a, (key, value) => key === 'updatedAt' ? undefined : value) === JSON.stringify(b, (key, value) => key === 'updatedAt' ? undefined : value)

export type StyleTarget = { kind: 'wall'; wallId: WallId } | { kind: 'floor' } | { kind: 'furniture'; id: FurnitureId }

type RoomStore = {
  selectedObject: SelectedObject; characterState: CharacterState; computerOn: boolean; toggledOn: Set<string>; cupHeld: boolean; artworks: Record<string, string>; setArtwork: (id: string, dataURL: string | null) => void; guestbook: Record<string, GuestComment[]>; addGuestComment: (id: string, name: string, text: string) => void; removeGuestComment: (id: string, commentId: string) => void; timeOfDay: TimeOfDay; setTimeOfDay: (time: TimeOfDay) => void; books: Book[]; openBookId: string | null; bookshelfOpen: boolean
  mode: RoomMode; furniture: FurnitureItem[]; selectedFurnitureId: FurnitureId | null; selectedPlacementValid: boolean; movingFurnitureId: FurnitureId | null; preview: FurnitureItem | null; previewValid: boolean; previewDragging: boolean
  wallStyle: RoomStyle; floorStyle: string | undefined; styleTarget: StyleTarget | null; debugAnchors: boolean; moveNotice: boolean; floorTarget: [number, number, number] | null; musicTrack: string | null; setMusicTrack: (id: string | null) => void; musicVolume: number; setMusicVolume: (value: number) => void
  selectObject: (object: Exclude<SelectedObject, null>) => void; clearSelection: () => void; finishCharacterAction: (state: Exclude<CharacterState, 'walking'>) => void; moveCharacterTo: (position: [number, number, number]) => void; settleFloorMove: (reached: boolean) => void; openBook: (id: string) => void; closeBook: () => void; addBook: (title: string, visibility: Visibility) => void; updateBookVisibility: (id: string, visibility: Visibility) => void; addEntry: (bookId: string, entry: Omit<Entry, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>) => void; toggleDebugAnchors: () => void
  toggleEditMode: () => void; enterEditFurniture: (id: FurnitureId) => void; selectFurniture: (id: FurnitureId) => void; beginMove: (id: FurnitureId) => void; moveFurniture: (id: FurnitureId, position: [number, number, number], surfaceId?: SurfaceId) => void; placeFurnitureAt: (id: FurnitureId, position: [number, number, number], surfaceId?: SurfaceId) => void; endMove: () => void; rotateFurniture: () => void; removeFurniture: (id?: FurnitureId) => void; undoLayout: () => void; resetLayout: () => void; startPreview: (type: string) => void; beginPreviewDrag: () => void; movePreview: (position: [number, number, number], surfaceId?: SurfaceId) => void; endPreviewDrag: () => void; placePreview: () => void; cancelPreview: () => void
  openStyleTarget: (target: StyleTarget) => void; closeStyleTarget: () => void; setWallStyle: (wallId: WallId, presetId: string) => void; setFloorStyle: (presetId: string) => void; setFurnitureStyle: (id: FurnitureId, presetId: string) => void
}
export type TimeOfDay = 'day' | 'evening' | 'night'
// clicking these walks the character over and poses it (see interactionAnchorsFor); every other item — wall
// decor, lights, toggles, plain props — must leave the character exactly as it is. Whitelist on purpose: new
// furniture is inert until it earns a pose here.
export const POSED_TYPES = new Set(['bed', 'sofa', 'chair', 'desk', 'bookshelf', 'rocking-chair', 'beanbag', 'cup', 'plant', 'cabinet', 'side-table', 'coffee-table', 'wardrobe', 'hanger', 'mirror', 'rug', 'bin'])
export type GuestComment = { id: string; name: string; text: string; createdAt: string }
const RoomContext = createContext<RoomStore | null>(null)

export function RoomProvider({ children }: { children: ReactNode }) {
  const [selectedObject, setSelectedObject] = useState<SelectedObject>(null); const [characterState, setCharacterState] = useState<CharacterState>('idle'); const [computerOn, setComputerOn] = useState(false); const [toggledOn, setToggledOn] = useState<Set<string>>(new Set(['lamp'])); const [artworks, setArtworks] = useState<Record<string, string>>(() => (typeof window === 'undefined' ? {} : loadArtworks() ?? {})); const [guestbook, setGuestbook] = useState<Record<string, GuestComment[]>>(() => (typeof window === 'undefined' ? {} : loadGuestbook<Record<string, GuestComment[]>>() ?? {})); const [timeOfDay, setTimeOfDayState] = useState<TimeOfDay>(() => { try { const saved = localStorage.getItem('my-room-time-v1'); return saved === 'evening' || saved === 'night' ? saved : 'day' } catch { return 'day' } }); const [cupHeld, setCupHeld] = useState(false); const [books, setBooks] = useState<Book[]>(() => (typeof window === 'undefined' ? initialBooks : loadBooks<Book[]>() ?? initialBooks)); const [openBookId, setOpenBookId] = useState<string | null>(null); const [bookshelfOpen, setBookshelfOpen] = useState(false)
  const [mode, setMode] = useState<RoomMode>('normal'); const [furniture, setFurniture] = useState<FurnitureItem[]>(hydrateFurniture); const [selectedFurnitureId, setSelectedFurnitureId] = useState<FurnitureId | null>(null); const [history, setHistory] = useState<FurnitureItem[][]>([]); const [dragOrigin, setDragOrigin] = useState<FurnitureItem[] | null>(null); const [movingFurnitureId, setMovingFurnitureId] = useState<FurnitureId | null>(null); const [preview, setPreview] = useState<FurnitureItem | null>(null); const [previewValid, setPreviewValid] = useState(false); const [previewDragging, setPreviewDragging] = useState(false)
  const [wallStyle, setWallStyleState] = useState<RoomStyle>(() => (typeof window === 'undefined' ? {} : loadRoomStyle() ?? {})); const [floorStyle, setFloorStyleState] = useState<string | undefined>(() => (typeof window === 'undefined' ? undefined : loadRoomStyle()?.floor)); const [styleTarget, setStyleTarget] = useState<StyleTarget | null>(null)
  const [debugAnchors, setDebugAnchors] = useState(false)
  // the item's placement as of the LAST moveFurniture call — endMove fires on pointerUp right after
  // moveFurniture, before React has re-rendered, so reading `furniture` there would validate the
  // stale previous position and let an overlapping final position slip through
  const pendingMove = useRef<FurnitureItem | null>(null)
  const [moveNotice, setMoveNotice] = useState(false); const noticeTimer = useRef<number>(0)
  const [floorTarget, setFloorTarget] = useState<[number, number, number] | null>(null)
  const [musicTrack, setMusicTrackState] = useState<string | null>(null)
  const setMusicTrack = (id: string | null) => { setMusicTrackState(id); if (id) playTrack(id); else stopMusic() }
  const [musicVolume, setMusicVolumeState] = useState(0.7)
  const setMusicVolume = (value: number) => { setMusicVolumeState(value); applyMusicVolume(value) }
  // diary content persists like the layout does — saved after every change (add book/entry, visibility toggle)
  useEffect(() => { saveBooks(books) }, [books])
  // items resolved onto a furniture-hosted surface (a mug on the desk) don't carry their own live world position —
  // it's recomputed here from the owner's CURRENT position/rotation every time `furniture` changes, so moving or
  // rotating the desk carries everything on it along for free, with no per-item cascade-update code anywhere else
  const resolvedFurniture = useMemo(() => furniture.map((item) => {
    if (!isOwnedSurfaceId(item.surfaceId)) return item
    const surface = resolveSurface(furniture, item.surfaceId); if (!surface) return item
    const itemResolution = resolutionFor(item)
    const position = gridToWorld(withResolution(surface, itemResolution), { gridX: item.gridX, gridY: item.gridY }, item.footprint, item.rotation[1])
    const owner = furniture.find((value) => value.id === surface.ownerId)
    return { ...item, position, rotation: [0, item.rotation[1] + (owner?.rotation[1] ?? 0), 0] as [number, number, number] }
  }), [furniture])
  const persist = (next: FurnitureItem[]) => saveRoomLayout(next.map(({ id, type, rotation, scale, surfaceId, gridX, gridY, gridZ, wallId, footprint, allowedSurfaces, styleId, removed, updatedAt }) => ({ id, type, rotation, scale, surfaceId, gridX, gridY, gridZ, wallId, footprint, resolution: resolutionFor({ allowedSurfaces }), styleId, removed, updatedAt })))
  const commit = (next: FurnitureItem[], previous = furniture) => { if (!same(next, previous)) setHistory((items) => [...items.slice(-19), previous]); setFurniture(next); persist(next) }
  const clearSelection = () => { setSelectedObject(null); setStyleTarget(null); setFloorTarget(null); setCupHeld(false); setBookshelfOpen(false); setOpenBookId(null); setSelectedFurnitureId(null) }
  const selectObject = (object: Exclude<SelectedObject, null>) => { const target = furniture.find((value) => value.id === object); const type = target?.type ?? object; if (mode === 'edit') { if (object !== 'character' && object !== 'book') setSelectedFurnitureId(object); return } if (type === 'character') { setCharacterState((state) => ({ idle: 'sittingFloor', sittingFloor: 'wave', wave: 'idle' } as Partial<Record<CharacterState, CharacterState>>)[state] ?? 'idle'); return } if (type === 'bed' && selectedObject === object) return clearSelection(); setStyleTarget(null); setFloorTarget(null); setSelectedObject(object); setOpenBookId(null); if (type === 'bookshelf') setBookshelfOpen(true); const sidePanelOnly = type === 'bookshelf' || type === 'guestbook' || type === 'photo' || type === 'poster' || type.startsWith('photo-frame') || type.startsWith('wall-art'); if (sidePanelOnly) return; if (type === 'computer') setComputerOn((on) => !on); if (['lamp', 'floor-lamp', 'fireplace', 'candle', 'tv', 'string-lights', 'christmas-tree', 'star-projector', 'mini-fridge', 'led-lamp', 'wardrobe', 'cabinet', 'bin'].includes(type)) setToggledOn((prev) => { const next = new Set(prev); if (next.has(object)) next.delete(object); else next.add(object); return next }); if (type === 'cup') setCupHeld(true); if (POSED_TYPES.has(type)) setCharacterState('walking') }
  const showMoveNotice = () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); setMoveNotice(true); noticeTimer.current = window.setTimeout(() => setMoveNotice(false), 1600) }
  // clicking an empty floor cell in NORMAL mode: walk (with the normal walking motion) to that cell's center,
  // ending any free action / interaction. Occupied or out-of-bounds cells show a brief notice instead.
  const moveCharacterTo = (position: [number, number, number]) => {
    if (mode !== 'normal') return
    const cell = worldToGrid(floorSurface, position, { width: 1, depth: 1 })
    const occupied = new Set(furniture.filter((item) => item.category === 'floorFurniture' && item.type !== 'rug' && !item.removed && item.surfaceId === 'floor').flatMap((item) => baseFloorCells(item).map((other) => `${other.x}:${other.y}`)))
    const inBounds = cell.gridX >= 0 && cell.gridX < GRID_COUNT && cell.gridY >= 0 && cell.gridY < GRID_COUNT
    if (!inBounds || occupied.has(`${cell.gridX}:${cell.gridY}`)) { showMoveNotice(); return }
    const [x, , z] = gridToWorld(floorSurface, cell, { width: 1, depth: 1 })
    setSelectedObject(null); setOpenBookId(null); setBookshelfOpen(false); setCupHeld(false)
    setFloorTarget([x, 0, z]); setCharacterState('walking')
  }
  // called by Character when the floor walk finishes (or turns out to be unreachable)
  const settleFloorMove = (reached: boolean) => { setFloorTarget(null); setCharacterState('idle'); if (!reached) showMoveNotice() }
  const selectFurniture = (id: FurnitureId) => setSelectedFurnitureId(id)
  const enterEditFurniture = (id: FurnitureId) => { const target = furniture.find((item) => item.id === id); setSelectedObject(null); setCupHeld(false); setBookshelfOpen(false); setOpenBookId(null); setPreview(null); setPreviewDragging(false); setSelectedFurnitureId(id); setDragOrigin(target?.movable ? furniture : null); setMovingFurnitureId(target?.movable ? id : null); setMode('edit') }
  const beginMove = (id: FurnitureId) => { pendingMove.current = null; setSelectedFurnitureId(id); setDragOrigin(furniture); setMovingFurnitureId(id) }
  const movedFurniture = (moving: FurnitureItem, position: [number, number, number], targetSurfaceId?: SurfaceId) => {
    let surfaceId: SurfaceId
    if (targetSurfaceId && isOwnedSurfaceId(targetSurfaceId)) {
      const target = resolveSurface(furniture, targetSurfaceId)
      if (!target || !moving.allowedSurfaces.includes(target.type)) return null
      surfaceId = targetSurfaceId
    } else {
      surfaceId = moving.allowedSurfaces.includes('wall') ? targetSurfaceId ?? nearestWallId(position) : 'floor'
    }
    const surface = resolveSurface(furniture, surfaceId); if (!surface || !moving.allowedSurfaces.includes(surface.type)) return null
    const movingResolution = resolutionFor(moving); const resolvedSurface = withResolution(surface, movingResolution)
    const grid = clampGrid(resolvedSurface, worldToGrid(resolvedSurface, position, moving.footprint, moving.rotation[1]), moving.footprint, moving.rotation[1])
    return placeOnSurface(furniture, moving, surfaceId, grid)
  }
  const moveFurniture = (id: FurnitureId, position: [number, number, number], targetSurfaceId?: SurfaceId) => {
    const moving = furniture.find((value) => value.id === id); if (!moving || !moving.movable) return
    const next = movedFurniture(moving, position, targetSurfaceId); if (!next) return
    pendingMove.current = next
    setFurniture((items) => items.map((value) => value.id === id ? { ...next, updatedAt: new Date().toISOString() } : value))
  }
  const endMove = () => {
    const moving = pendingMove.current ?? furniture.find((item) => item.id === movingFurnitureId)
    pendingMove.current = null
    // a removed item has nothing to settle — never write its stale pre-delete copy back
    if (!dragOrigin || !moving || moving.removed || furniture.find((item) => item.id === moving.id)?.removed) { setDragOrigin(null); setMovingFurnitureId(null); return }
    // rebuild the latest state from the pending move — `furniture` may still hold the pre-click position
    const latest = furniture.map((value) => value.id === moving.id ? moving : value)
    if (!isAvailable(moving, latest)) setFurniture(dragOrigin)
    else { if (!same(latest, dragOrigin)) setHistory((items) => [...items.slice(-19), dragOrigin]); setFurniture(latest); persist(latest) }
    setDragOrigin(null); setMovingFurnitureId(null)
  }
  // Rotation is always applied. If it overlaps or crosses a boundary the toolbar warns the user until they move it.
  const rotateFurniture = () => { const id = selectedFurnitureId; if (!id) return; const previous = furniture; const next = furniture.map((value) => value.id === id ? placeOnSurface(furniture, value, value.surfaceId, placementGrid(value), [0, (value.rotation[1] + Math.PI / 2) % (Math.PI * 2), 0]) : value); commit(next, previous) }
  // deleting also cancels any move-in-progress — otherwise a later endMove would restore the pre-delete copy
  // held in pendingMove/dragOrigin and the item would pop back
  const removeFurniture = (targetId = selectedFurnitureId ?? undefined) => { if (!targetId) return; const group = (value: FurnitureItem) => value.id === targetId || (isOwnedSurfaceId(value.surfaceId) && ownerIdOf(value.surfaceId) === targetId); const next = furniture.map((value) => group(value) && !value.removed ? { ...value, removed: true, updatedAt: new Date().toISOString() } : value); pendingMove.current = null; setDragOrigin(null); setMovingFurnitureId(null); commit(next); setSelectedFurnitureId(null) }
  const undoLayout = () => { let index = history.length - 1; while (index >= 0 && same(history[index], furniture)) index -= 1; const previous = history[index]; if (!previous) return; setHistory((items) => items.slice(0, index)); setFurniture(previous); persist(previous); setSelectedFurnitureId(null) }
  const resetLayout = () => { const next = initialFurniture.map((value) => ({ ...value })); commit(next); setSelectedFurnitureId(null) }
  // `context` defaults to current state; pass a NEXT state to validate a transform before committing it —
  // rotateFurniture needs this so items on a rotated owner's surface resolve against the rotated grid
  const isAvailable = (candidate: FurnitureItem, context: FurnitureItem[] = furniture) => {
    if (!isGridPlaced(candidate)) return true
    const surface = resolveSurface(context, candidate.surfaceId); if (!surface) return false
    if (!candidate.allowedSurfaces.includes(surface.type)) return false
    const resolution = resolutionFor(candidate)
    const resolvedSurface = withResolution(surface, resolution)
    const footprint = candidate.footprint
    // cells are normalized to subgrid2 units so a base-resolution item (a desk) and a subgrid2 one (a cup) sharing
    // the same surfaceId (the floor) still collide-check correctly against each other
    const occupied = new Set((isFloorCovering(candidate) ? [] : context.filter((other) => other.id !== candidate.id && !other.removed && other.surfaceId === candidate.surfaceId && !isFloorCovering(other))).flatMap((other) => {
      const otherResolution = resolutionFor(other)
      return normalizedCells(cellsFor(placementGrid(other), other.footprint, other.rotation[1]), otherResolution)
    }).map((cell) => `${cell.x}:${cell.y}`))
    // the character's current cell counts as occupied too — furniture can't be dropped on top of them
    if (surface.type === 'floor' && !isFloorCovering(candidate)) {
      const cell = worldToGrid(floorSurface, [characterPosition[0], 0, characterPosition[2]], { width: 1, depth: 1 })
      for (const sub of normalizedCells([{ x: cell.gridX, y: cell.gridY }], 'base')) occupied.add(`${sub.x}:${sub.y}`)
    }
    return canPlaceItem(resolvedSurface, { ...candidate, footprint }, occupied, resolution)
  }
  const selectedPlacementValid = !selectedFurnitureId || furniture.filter((value) => value.id === selectedFurnitureId || (isOwnedSurfaceId(value.surfaceId) && ownerIdOf(value.surfaceId) === selectedFurnitureId && !value.removed)).every((value) => isAvailable(value))
  const placeFurnitureAt = (id: FurnitureId, position: [number, number, number], surfaceId?: SurfaceId) => {
    const moving = furniture.find((item) => item.id === id); if (!moving?.movable) return
    const placed = movedFurniture(moving, position, surfaceId); if (!placed) return
    const next = furniture.map((item) => item.id === id ? { ...placed, updatedAt: new Date().toISOString() } : item)
    if (isAvailable(placed, next)) commit(next)
  }
  // a stored (removed) default item — bed, sofa, clock... — acts as its own template so it can be taken back out
  // of the 가구함; decor types keep using their catalog templates
  const storedTemplateFor = (type: string) => furniture.find((item) => item.removed && item.movable && item.type === type && !item.id.startsWith('inventory-'))
  const startPreview = (type: string) => {
    const template = inventoryItems.find((entry) => entry.type === type) ?? storedTemplateFor(type); if (!template) return
    const surfaceIds: SurfaceId[] = template.allowedSurfaces.includes('wall') ? ['leftWall', 'rightWall'] : ['floor']
    let fallback: FurnitureItem | undefined
    let next: FurnitureItem | undefined
    for (const surfaceId of surfaceIds) {
      const surface = resolveSurface(furniture, surfaceId); if (!surface) continue
      const resolvedSurface = withResolution(surface, resolutionFor(template)); const footprint = template.footprint
      const center = { x: (resolvedSurface.gridColumns - footprint.width) / 2, y: (resolvedSurface.gridRows - footprint.depth) / 2 }
      const grids = Array.from({ length: Math.max(0, resolvedSurface.gridColumns - footprint.width + 1) * Math.max(0, resolvedSurface.gridRows - footprint.depth + 1) }, (_, index) => ({ gridX: index % (resolvedSurface.gridColumns - footprint.width + 1), gridY: Math.floor(index / (resolvedSurface.gridColumns - footprint.width + 1)) })).sort((a, b) => Math.abs(a.gridX - center.x) + Math.abs(a.gridY - center.y) - Math.abs(b.gridX - center.x) - Math.abs(b.gridY - center.y))
      for (const grid of grids) {
        const candidate = placeOnSurface(furniture, { ...template, id: `preview-${Date.now()}`, surfaceId, gridX: grid.gridX, gridY: grid.gridY, gridZ: grid.gridY, wallId: surface.type === 'wall' ? surface.id as WallId : undefined, position: [0, 0, 0], rotation: [0, 0, 0], removed: false, updatedAt: new Date().toISOString() }, surfaceId, grid)
        fallback ??= candidate
        if (isAvailable(candidate)) { next = candidate; break }
      }
      if (next) break
    }
    if (!next) next = fallback
    if (!next) return
    setPreview(next); setPreviewValid(isAvailable(next)); setPreviewDragging(false); setSelectedFurnitureId(null)
  }
  const beginPreviewDrag = () => setPreviewDragging(true)
  const endPreviewDrag = () => setPreviewDragging(false)
  const movePreview = (position: [number, number, number], targetSurfaceId?: SurfaceId) => {
    if (!preview) return
    let surfaceId: SurfaceId
    if (targetSurfaceId && isOwnedSurfaceId(targetSurfaceId)) {
      const target = resolveSurface(furniture, targetSurfaceId)
      if (!target || !preview.allowedSurfaces.includes(target.type)) return
      surfaceId = targetSurfaceId
    } else {
      surfaceId = preview.allowedSurfaces.includes('wall') ? targetSurfaceId ?? nearestWallId(position) : 'floor'
    }
    const surface = resolveSurface(furniture, surfaceId); if (!surface) return
    const previewResolution = resolutionFor(preview); const resolvedSurface = withResolution(surface, previewResolution)
    const grid = clampGrid(resolvedSurface, worldToGrid(resolvedSurface, position, preview.footprint, preview.rotation[1]), preview.footprint, preview.rotation[1]); const next = placeOnSurface(furniture, preview, surfaceId, grid)
    setPreview(next); setPreviewValid(isAvailable(next))
  }
  const placePreview = () => {
    if (!preview || !previewValid) return
    // taking a stored DEFAULT item back out restores the original (same id, so its interactions keep working)
    // instead of spawning a duplicate; catalog decor still adds a fresh copy
    const restoreTarget = !inventoryItems.some((entry) => entry.type === preview.type) ? storedTemplateFor(preview.type) : undefined
    if (restoreTarget) {
      const item: FurnitureItem = { ...preview, id: restoreTarget.id, removed: false, updatedAt: new Date().toISOString() }
      commit(furniture.map((value) => value.id === restoreTarget.id ? item : value)); setSelectedFurnitureId(item.id)
    } else {
      const item: FurnitureItem = { ...preview, id: `inventory-${Date.now()}`, updatedAt: new Date().toISOString() }
      commit([...furniture, item]); setSelectedFurnitureId(item.id)
    }
    setPreview(null); setPreviewDragging(false)
  }
  const cancelPreview = () => { setPreview(null); setPreviewDragging(false) }
  // leaving edit mode mid-drag (완료 button, Escape, clicking empty space) must settle the drag the same way a
  // pointerUp would — validate the final spot and snap back to the origin if it overlaps — instead of
  // silently keeping whatever position the item was hovering at
  const toggleEditMode = () => { endMove(); pendingMove.current = null; setMode((value) => value === 'normal' ? 'edit' : 'normal'); setPreview(null); setPreviewDragging(false); setDragOrigin(null); setMovingFurnitureId(null); setSelectedObject(null); setBookshelfOpen(false); setOpenBookId(null); setSelectedFurnitureId(null) }
  const openBook = (id: string) => { setSelectedObject('book'); setBookshelfOpen(false); setOpenBookId(id) }
  const addBook = (title: string, visibility: Visibility) => { const id = `book-${Date.now()}`; const createdAt = new Date().toISOString(); setBooks((items) => [...items, { id, title, coverColor: ['#718475', '#b96b52', '#607b93', '#b18a4c'][items.length % 4], description: '새 기록장', visibility, createdAt, updatedAt: createdAt, entries: [] }]) }
  const updateBookVisibility = (id: string, visibility: Visibility) => setBooks((items) => items.map((book) => book.id === id ? { ...book, visibility, updatedAt: new Date().toISOString() } : book))
  const addEntry: RoomStore['addEntry'] = (bookId, entry) => { const createdAt = new Date().toISOString(); setBooks((items) => items.map((book) => book.id === bookId ? { ...book, updatedAt: createdAt, entries: [...book.entries, { ...entry, id: `entry-${Date.now()}`, bookId, createdAt, updatedAt: createdAt }] } : book)) }
  const openStyleTarget = (target: StyleTarget) => setStyleTarget(target)
  const closeStyleTarget = () => setStyleTarget(null)
  const setWallStyle = (wallId: WallId, presetId: string) => setWallStyleState((current) => { const next = { ...current, [wallId]: presetId }; saveRoomStyle({ ...next, floor: floorStyle }); return next })
  const setFloorStyle = (presetId: string) => { setFloorStyleState(presetId); saveRoomStyle({ ...wallStyle, floor: presetId }) }
  const setFurnitureStyle = (id: FurnitureId, presetId: string) => { const next = furniture.map((value) => value.id === id ? { ...value, styleId: presetId, updatedAt: new Date().toISOString() } : value); commit(next) }
  const toggleDebugAnchors = () => setDebugAnchors((value) => !value)
  // one-time pull of the converted Instagram export (public/instagram/import.json) into the bookshelf
  useEffect(() => {
    try { if (localStorage.getItem('my-room-insta-imported-v1')) return } catch { return }
    const publicBase = location.hostname.endsWith('.github.io') ? `${import.meta.env.BASE_URL}public/` : import.meta.env.BASE_URL
    fetch(`${publicBase}instagram/import.json`).then((response) => response.ok ? response.json() : null).then((book: Book | null) => {
      if (!book) return
      setBooks((prev) => prev.some((value) => value.id === book.id) ? prev : [...prev, book])
      localStorage.setItem('my-room-insta-imported-v1', '1')
    }).catch(() => { /* no import file present */ })
  }, [])
  useEffect(() => { saveArtworks(artworks) }, [artworks])
  useEffect(() => { saveGuestbook(guestbook) }, [guestbook])
  const addGuestComment = (id: string, name: string, text: string) => setGuestbook((prev) => ({ ...prev, [id]: [{ id: `gc-${Date.now()}`, name: name.trim() || '익명', text, createdAt: new Date().toISOString() }, ...(prev[id] ?? [])] }))
  const removeGuestComment = (id: string, commentId: string) => setGuestbook((prev) => ({ ...prev, [id]: (prev[id] ?? []).filter((comment) => comment.id !== commentId) }))
  const setTimeOfDay = (time: TimeOfDay) => { setTimeOfDayState(time); try { localStorage.setItem('my-room-time-v1', time) } catch { /* unavailable */ } }
  const setArtwork = (id: string, dataURL: string | null) => setArtworks((prev) => { const next = { ...prev }; if (dataURL) next[id] = dataURL; else delete next[id]; return next })
  return <RoomContext value={{ selectedObject, characterState, computerOn, toggledOn, cupHeld, artworks, setArtwork, guestbook, addGuestComment, removeGuestComment, timeOfDay, setTimeOfDay, books, openBookId, bookshelfOpen, mode, furniture: resolvedFurniture, selectedFurnitureId, selectedPlacementValid, movingFurnitureId, preview, previewValid, previewDragging, wallStyle, floorStyle, styleTarget, debugAnchors, moveNotice, floorTarget, musicTrack, setMusicTrack, musicVolume, setMusicVolume, selectObject, clearSelection, finishCharacterAction: setCharacterState, moveCharacterTo, settleFloorMove, openBook, closeBook: () => { setOpenBookId(null); setSelectedObject('bookshelf'); setBookshelfOpen(true) }, addBook, updateBookVisibility, addEntry, toggleEditMode, enterEditFurniture, selectFurniture, beginMove, moveFurniture, placeFurnitureAt, endMove, rotateFurniture, removeFurniture, undoLayout, resetLayout, startPreview, beginPreviewDrag, movePreview, endPreviewDrag, placePreview, cancelPreview, openStyleTarget, closeStyleTarget, setWallStyle, setFloorStyle, setFurnitureStyle, toggleDebugAnchors }}>{children}</RoomContext>
}
export function useRoomStore() { const store = useContext(RoomContext); if (!store) throw new Error('RoomProvider is required'); return store }
// for trees rendered outside the provider (e.g. the offscreen thumbnail canvas)
export const useOptionalRoomStore = () => useContext(RoomContext)
