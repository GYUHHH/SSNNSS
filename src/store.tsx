import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createSlot, deleteSlot, loadArtworks, loadProfile, saveProfile, type Profile, loadBooks, loadSlots, placedInOtherSlots, saveArtworks, saveBooks, saveSlotItems, saveSlotStyle, setActiveSlot, slotItems, slotStyle, type FurniturePlacement, type RoomStyle } from './services/roomLayoutStorage'
import { bookshelfCapY, bookshelfTiers, canPlaceItem, cellsFor, clampGrid, floorSurface, GRID_COUNT, gridToWorld, isOwnedSurfaceId, nearestWallId, normalizedCells, ownerIdOf, resolveSurface, setBookshelfTopOffset, withResolution, type Footprint, type GridPosition, type PlacementItem, type PlacementResolution, type PlacementSurface, type SurfaceId, type SurfaceKind, type WallId, worldToGrid } from './services/roomGrid'
import { characterPosition } from './services/characterTracker'
import { publicBase } from './services/publicBase'
import { loadOrders } from './services/playlistOrder'
import { deleteVideo, listVideoIds, loadClipUrls, loadVideoLinks, putVideo, saveClipUrl, saveVideoLinks, setClipMuted, syncPendingClips, encodeTarget, youTubeTarget } from './services/mediaStore'
import { onTrackChange, playTrack, setMusicVolume as applyMusicVolume, stopMusic, syncPendingTracks } from './services/music'
import { purgeReactions, getSeenReactions, markReactionSeen, onRoomNavigation, onRoomRefresh, uploadDataUrl, addRemoteComment, broadcastCharacter, currentRoomHandle, fetchAllLikes, fetchGuestbook, fetchVisitCounts, isVisiting, myHandle, myProfilePhoto, myVisitorId, readingBundle, readStored, recordVisit, refreshVisit, removeRemoteComment, removeStored, subscribeRealtime, uploadMedia, writeStored, type RemoteGuestComment } from './services/social'
import { cancelSoundRequest, muteFrame, requestSound } from './services/ytResume'

const remoteToComment = (row: RemoteGuestComment): GuestComment => ({ id: row.id, name: row.name, text: row.text, createdAt: row.created_at, visitor: row.visitor, verified: !!row.user_id, photo: row.photo })

export type SelectedObject = string | null
export type FurnitureId = string
export type CharacterState = 'idle' | 'walking' | 'aligning' | 'sitting' | 'laying' | 'sleeping' | 'reading' | 'working' | 'interacting' | 'sittingFloor' | 'wave'
export type CharacterPose = { state: CharacterState; facing: number; y: number }
export type CharacterTransform = { position: [number, number, number]; facing: number; y: number }
export type CharacterSnapshot = CharacterPose & CharacterTransform
// the character's chosen colours — only the parts the owner actually changed are stored, the rest fall back to
// the model's defaults, so future default tweaks reach every character that never touched that part
export type CharacterLook = { skinColor?: string; hairColor?: string; topColor?: string; bottomColor?: string; shoeColor?: string }
const LOOK_KEY = 'my-room-character-look-v1'
const loadCharacterLook = (): CharacterLook | null => {
  try {
    const saved = JSON.parse(readStored(LOOK_KEY) ?? '') as CharacterLook
    if (!saved || typeof saved !== 'object') return null
    const look: CharacterLook = {}
    for (const part of ['skinColor', 'hairColor', 'topColor', 'bottomColor', 'shoeColor'] as const) if (typeof saved[part] === 'string') look[part] = saved[part]
    return Object.keys(look).length ? look : null
  } catch { return null }
}
export type Visibility = 'public' | 'private'
export type RoomMode = 'normal' | 'edit'
export type FurnitureCategory = 'floorFurniture' | 'surfaceItem' | 'wallItem' | 'decoration'
export type FurnitureItem = FurniturePlacement & PlacementItem & { id: FurnitureId; name: string; position: [number, number, number]; gridZ: number; wallId?: WallId; footprint: Footprint; category: FurnitureCategory; movable: boolean; interactable: boolean; size: [number, number]; allowedSurfaces: SurfaceKind[] }
export type InventoryCategory = '전체' | '가구' | '조명' | '식물' | '벽장식' | '소품'
export type EntryComment = { id: string; name: string; text: string; createdAt: string }
export type Entry = { id: string; bookId: string; title: string; content: string; images: string[]; date: string; visibility: Visibility; createdAt: string; updatedAt: string; comments: EntryComment[] }
export type Book = { id: string; title: string; coverColor: string; description: string; visibility: Visibility; createdAt: string; updatedAt: string; entries: Entry[]; shelf?: number }
export type EntryDraft = Omit<Entry, 'id' | 'bookId' | 'createdAt' | 'updatedAt' | 'comments'>

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
const deskItem = floorItem('desk', '책상', 'desk', 4, 4, { width: 2, depth: 1 })
const chairItem = floorItem('chair', '의자', 'chair', 4, 5, { width: 1, depth: 1 })
chairItem.rotation = [0, Math.PI, 0]
// desk's own tabletop is a small 4x2 grid (see roomGrid's OWNED_SURFACES) — footprints below are sized to roughly
// match each item's real mesh dimensions so FittedMesh's auto-scale doesn't shrink/blow them up
const computerItem = surfaceItem('computer', '컴퓨터', 'computer', 'desk:top', 0, 0, { width: 2, depth: 1 }, ['floor', 'tabletop'], [deskItem])
const sofaItem = floorItem('sofa', '소파', 'sofa', 6, 6, { width: 3, depth: 1 })
// the default bookshelf stands against the left wall (under the wall decor), turned to face into the room
const bookshelfItem = placeOnSurface([], { ...floorItem('bookshelf', '책장', 'bookshelf', 0, 4, { width: 2, depth: 1 }), rotation: [0, Math.PI / 2, 0] }, 'floor', { gridX: 0, gridY: 4 }, [0, Math.PI / 2, 0])
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
// default wall decor — ids start with `inventory-` because InventoryFurniture only renders that prefix
const profileBoardItem = wallItem('inventory-profile-default', '내 프로필', 'profile-board', 'leftWall', 2, 4, { width: 2, depth: 3 })
const guestbookWallItem = wallItem('inventory-guestbook-default', '방명록', 'guestbook', 'leftWall', 5, 5, { width: 1, depth: 1 })
const cdPlayerItem = wallItem('inventory-cd-default', 'CD 플레이어', 'cd-player', 'leftWall', 7, 5, { width: 1, depth: 1 })
// the default room places only desk+chair (center), profile/guestbook/cd on the wall, and the bookshelf
// beneath them — every other piece starts in storage, ready to be placed from the 가구함
export const initialFurniture: FurnitureItem[] = [
  deskItem, chairItem, bookshelfItem, profileBoardItem, guestbookWallItem, cdPlayerItem,
  ...[bedItem, computerItem, sofaItem, plantItem, lampItem, cabinetItem, rugItem, binItem, cupItem, clockItem, posterItem, photoItem].map((item) => ({ ...item, removed: true })),
]

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
  { type: 'easel-photo', name: '이젤 보드 (사진)', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'rocking-chair', name: '흔들의자', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'beanbag', name: '빈백', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'mini-fridge', name: '미니 냉장고', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'hanger', name: '행거', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'led-lamp', name: 'LED 램프', category: 'surfaceItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop'] },
  { type: 'star-projector', name: '별 프로젝터', category: 'surfaceItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['floor', 'tabletop'] },
  { type: 'guestbook', name: '방명록', category: 'wallItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'profile-board', name: '내 프로필', category: 'wallItem', movable: true, interactable: true, footprint: { width: 2, depth: 3 }, size: [2, 3], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'video-frame-3', name: '영상 액자 4×3', category: 'wallItem', movable: true, interactable: true, footprint: { width: 4, depth: 3 }, size: [4, 3], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'video-frame-5', name: '영상 액자 6×5', category: 'wallItem', movable: true, interactable: true, footprint: { width: 6, depth: 5 }, size: [6, 5], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'video-frame-4', name: '영상 액자 5×4', category: 'wallItem', movable: true, interactable: true, footprint: { width: 5, depth: 4 }, size: [5, 4], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'glass-shelf', name: '투명 선반', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'cd-player', name: 'CD 플레이어', category: 'wallItem', movable: true, interactable: true, footprint: { width: 1, depth: 1 }, size: [1, 1], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'banner', name: '움직이는 배너', category: 'wallItem', movable: true, interactable: true, footprint: { width: 3, depth: 1 }, size: [3, 1], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'window', name: '창문', category: 'wallItem', movable: true, interactable: true, footprint: { width: 3, depth: 2 }, size: [3, 2], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'curtain', name: '커튼', category: 'wallItem', movable: true, interactable: true, footprint: { width: 2, depth: 4 }, size: [2, 4], scale: 1, allowedSurfaces: ['wall'] },
  { type: 'fireplace', name: '벽난로', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'coffee-table', name: '좌식 테이블', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'tv', name: 'TV', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
  { type: 'wardrobe', name: '옷장', category: 'floorFurniture', movable: true, interactable: true, footprint: { width: 2, depth: 1 }, size: [2, 1], scale: 1, allowedSurfaces: ['floor'] },
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
  { id: 'daily-2026', title: '2026년 일기', coverColor: '#718475', description: '하루의 기록', visibility: 'private', createdAt: now, updatedAt: now, entries: [{ id: 'entry-1', bookId: 'daily-2026', title: '비가 오기 전의 오후', content: '창문을 열어두고 책을 읽었다.', images: [], date: '2026-08-12', visibility: 'private', createdAt: now, updatedAt: now, comments: [] }] },
]

const hydrateBooks = () => (loadBooks<Book[]>() ?? initialBooks).map((book) => ({ ...book, entries: book.entries.map((entry) => ({ ...entry, comments: entry.comments ?? [] })) }))

// Per-frame audio choice: true = the visitor explicitly wants sound, false = explicitly muted, absent = never chosen.
// Audio is visitor-local, but frame ids repeat across rooms, so preferences are scoped to room handle + room slot.
// Autoplay, shared by the first mount and by every later room change. Entering a room through the explorer does
// not remount the provider, so a room switch has to run exactly the same computation again — otherwise the frames
// of the room just left stay in playingFrames, nothing starts, and SoundHub (which only shows while something is
// playing) disappears with it.
const framesToPlay = (items: FurnitureItem[], links: Record<string, string>) =>
  items.filter((item) => !item.removed && item.type.startsWith('video-frame') && links[item.id]).map((item) => item.id)
const framesToMute = (playing: string[]) => playing

const AUDIO_PREFS_KEY = 'my-room-video-audio-v1'
const audioScope = (slotId = 'room-1') => `${currentRoomHandle() ?? 'lobby'}:${slotId}`
type AudioPrefStore = Record<string, Record<string, boolean>>
const readAudioPrefStore = (): AudioPrefStore | Record<string, boolean> | null => {
  try {
    const saved = JSON.parse(localStorage.getItem(AUDIO_PREFS_KEY) ?? 'null')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved
  } catch { /* fall through to migration */ }
  return null
}
export const loadAudioPrefs = (slotId = 'room-1'): Record<string, boolean> => {
  const saved = readAudioPrefStore()
  if (saved) {
    const values = Object.values(saved)
    if (values.every((value) => typeof value === 'boolean')) return saved as Record<string, boolean> // one-time legacy format
    const scoped = (saved as AudioPrefStore)[audioScope(slotId)]
    if (scoped && typeof scoped === 'object') return scoped
  }
  try {
    const old = JSON.parse(localStorage.getItem('my-room-video-unmuted-v1') ?? '[]')
    if (Array.isArray(old)) return Object.fromEntries(old.map((id: string) => [id, true]))
  } catch { /* storage may be unavailable */ }
  return {}
}
const saveAudioPref = (slotId: string, id: string, enabled: boolean) => {
  try {
    const saved = readAudioPrefStore()
    const legacy = saved && Object.values(saved).every((value) => typeof value === 'boolean') ? saved as Record<string, boolean> : null
    const store: AudioPrefStore = legacy ? { [audioScope(slotId)]: legacy } : (saved as AudioPrefStore | null) ?? {}
    store[audioScope(slotId)] = { ...(store[audioScope(slotId)] ?? {}), [id]: enabled }
    localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(store))
  } catch { /* storage may be unavailable */ }
}

// lamp/appliance on-off states and the other small interactions survive a reload as-is
// Rides along with the other interactions rather than in its own key: it is saved at exactly the same moments and
// the loader here is already tolerant of a record that predates it. Walking and aligning are read as idle — they
// are the half-second on the way somewhere, never a pose anyone should be found frozen in. The wave is NOT one
// of them: it loops until the owner clicks again, so it is a pose the room can be found in — and the whole point
// of waving at the room is that a visitor gets to see it.
const TRANSIENT: CharacterState[] = ['walking', 'aligning']
const loadPose = (saved: unknown): CharacterPose | null => {
  const pose = (saved as { pose?: { state?: string; facing?: number; y?: number } } | null)?.pose
  if (!pose || typeof pose.state !== 'string') return null
  return { state: pose.state as CharacterState, facing: Number(pose.facing) || 0, y: Number(pose.y) || 0 }
}
const loadInteractions = (): { toggles: string[]; computerOn: boolean; cupHeld: boolean; pose: CharacterPose | null } => {
  try {
    const saved = JSON.parse(readStored('my-room-interactions-v1') ?? '')
    return { toggles: Array.isArray(saved?.toggles) ? saved.toggles : ['lamp'], computerOn: !!saved?.computerOn, cupHeld: !!saved?.cupHeld, pose: loadPose(saved) }
  } catch { return { toggles: ['lamp'], computerOn: false, cupHeld: false, pose: null } }
}
const loadCharacterSnapshot = (): CharacterSnapshot => {
  const pose = loadInteractions().pose
  let position: [number, number, number] = [2.8, 0, 2.8]
  try {
    const saved = JSON.parse(readStored('my-room-character-v1') ?? '')
    if (Array.isArray(saved) && saved.length === 3 && saved.every(Number.isFinite)) position = [saved[0], 0, saved[2]]
  } catch { /* use the fresh-room position */ }
  return { position, state: pose?.state ?? 'idle', facing: pose?.facing ?? Math.PI / 4, y: pose?.y ?? 0 }
}

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
const hydrateFurniture = (saved: FurniturePlacement[] | null) => {
  // a fresh user's slot exists but is empty — both cases mean "no layout yet", so hand out the default room
  if (!saved || saved.length === 0) return initialFurniture
  // restored items are pushed here as they're produced, so a later item (e.g. "computer") can resolve a surface
  // hosted by an earlier one (e.g. "desk:top") — initialFurniture is already ordered owner-before-occupant
  const resolved: FurnitureItem[] = []
  const restore = (base: FurnitureItem, value?: FurniturePlacement): FurnitureItem => {
    // an item the save has never seen (a default added after the save was made) goes to storage, not the room
    if (!value) return { ...base, removed: true }
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
  selectedObject: SelectedObject; characterState: CharacterState; computerOn: boolean; toggledOn: Set<string>; cupHeld: boolean; artworks: Record<string, string>; setArtwork: (id: string, dataURL: string | null) => void; rooms: Array<{ id: string; name: string }>; activeRoomId: string; openRoom: (id: string) => void; createRoom: () => void; removeRoom: (id: string) => void; availableCount: (type: string) => number; profile: Profile; profileOpen: boolean; openProfile: () => void; closeProfile: () => void; setProfilePhoto: (photo: string | null) => void; setProfileHandle: (handle: string) => void; videoFrames: Record<string, number>; videoClips: Record<string, string>; setVideoClip: (id: string, file: File | null) => void; videoLinks: Record<string, string>; setVideoLink: (id: string, url: string | null) => boolean; playingFrames: string[]; stopFrame: (id: string) => void; mutedFrames: string[]; setFrameMuted: (id: string, muted: boolean, persist?: boolean) => void; highlightFrame: string | null; setHighlightFrame: (id: string | null) => void; openVideoPanel: (id: string) => void; guestbook: Record<string, GuestComment[]>; addGuestComment: (id: string, text: string) => void; removeGuestComment: (id: string, commentId: string) => void; remoteVisits: { total: number; today: number } | null; othersLikes: Record<string, number>; likeTotals: Record<string, number>; myLikes: string[]; pendingReactions: Record<string, number>; markReactionsSeen: (id: FurnitureId) => void; openObject: (id: FurnitureId) => boolean; reactionIdsFor: (id: FurnitureId) => string[]; reactionTarget: string | null; setReactionTarget: (id: string | null) => void; commentTarget: string | null; setCommentTarget: (id: string | null) => void; timeOfDay: TimeOfDay; setTimeOfDay: (time: TimeOfDay) => void; books: Book[]; openBookId: string | null; bookshelfOpen: boolean
  // true only for a neighbour room drawn in the explorer: nothing here may be written, and anything that would
  // otherwise fall back to THIS browser's own media or storage must stay empty instead
  readOnly: boolean
  // where this room's character stands, read from the same snapshot as its direction and pose
  characterHome: [number, number, number]
  // How that character is standing — seated, laid down and which way it faces.
  characterPose: CharacterPose | null
  // Only the owner room may move or persist this character. Active visits and explorer neighbours are snapshots.
  characterWritable: boolean
  // this room's character colours, and the owner-only way to change them (null patch resets to defaults)
  characterLook: CharacterLook | null; setCharacterLook: (patch: CharacterLook | null) => void
  // which room this store's data belongs to, committed IN THE SAME RENDER as that data — the explorer re-bases
  // its cluster off this, so the swap of contents and the swap of position can never paint apart
  currentHandle: string | null
  mode: RoomMode; furniture: FurnitureItem[]; selectedFurnitureId: FurnitureId | null; selectedPlacementValid: boolean; movingFurnitureId: FurnitureId | null; preview: FurnitureItem | null; previewValid: boolean; previewDragging: boolean
  wallStyle: RoomStyle; floorStyle: string | undefined; styleTarget: StyleTarget | null; debugAnchors: boolean; moveNotice: boolean; floorTarget: [number, number, number] | null; musicTrack: string | null; setMusicTrack: (id: string | null) => void; musicVolume: number; setMusicVolume: (value: number) => void
  selectObject: (object: Exclude<SelectedObject, null>) => void; clearSelection: () => void; finishCharacterAction: (state: Exclude<CharacterState, 'walking'>, transform?: CharacterTransform) => void; moveCharacterTo: (position: [number, number, number]) => void; settleFloorMove: (reached: boolean, transform?: CharacterTransform) => void; openBook: (id: string) => void; closeBook: () => void; addBook: (title: string, visibility: Visibility) => void; deleteBook: (id: string) => void; updateBook: (id: string, patch: Partial<Pick<Book, 'title' | 'visibility' | 'shelf'>>) => void; addEntry: (bookId: string, entry: EntryDraft) => void; deleteEntry: (bookId: string, entryId: string) => void; updateEntry: (bookId: string, entryId: string, patch: Partial<Pick<Entry, 'content' | 'images' | 'visibility'>>) => void; toggleDebugAnchors: () => void
  toggleEditMode: () => void; enterEditFurniture: (id: FurnitureId) => void; selectFurniture: (id: FurnitureId) => void; beginMove: (id: FurnitureId) => void; moveFurniture: (id: FurnitureId, position: [number, number, number], surfaceId?: SurfaceId) => void; placeFurnitureAt: (id: FurnitureId, position: [number, number, number], surfaceId?: SurfaceId) => void; endMove: () => void; rotateFurniture: () => void; removeFurniture: (id?: FurnitureId) => void; undoLayout: () => void; resetLayout: () => void; startPreview: (type: string, styleId?: string) => void; beginPreviewDrag: () => void; movePreview: (position: [number, number, number], surfaceId?: SurfaceId) => void; endPreviewDrag: () => void; placePreview: () => void; cancelPreview: () => void
  openStyleTarget: (target: StyleTarget) => void; setWallStyle: (wallId: WallId, presetId: string) => void; setFloorStyle: (presetId: string) => void; setFurnitureStyle: (id: FurnitureId, presetId: string) => void
}
export type TimeOfDay = 'day' | 'evening' | 'night'
// clicking these walks the character over and poses it (see interactionAnchorsFor); every other item — wall
// decor, lights, toggles, plain props — must leave the character exactly as it is. Whitelist on purpose: new
// furniture is inert until it earns a pose here.
export const POSED_TYPES = new Set(['bed', 'sofa', 'chair', 'desk', 'bookshelf', 'rocking-chair', 'beanbag', 'cup', 'plant', 'cabinet', 'side-table', 'coffee-table', 'wardrobe', 'hanger', 'rug', 'bin', 'glass-shelf'])
export type GuestComment = { id: string; name: string; text: string; createdAt: string; visitor?: string; verified?: boolean; photo?: string }
const toPlacement = ({ id, type, rotation, scale, surfaceId, gridX, gridY, gridZ, wallId, footprint, allowedSurfaces, styleId, removed, updatedAt }: FurnitureItem): FurniturePlacement => ({ id, type, rotation, scale, surfaceId, gridX, gridY, gridZ, wallId, footprint, resolution: resolutionFor({ allowedSurfaces }), styleId, removed, updatedAt })
// every catalogue piece exists exactly once for now; a future account would supply real per-user counts
const OWNED_PER_TYPE = 1
// video frames and lights come in pairs; everything else stays single
const OWNED_OVERRIDES: Record<string, number> = { 'video-frame-3': 2, 'video-frame-4': 2, 'video-frame-5': 2, lamp: 2, 'floor-lamp': 2, 'string-lights': 2, 'led-lamp': 2 }
const ownedCountOf = (type: string) => OWNED_OVERRIDES[type] ?? OWNED_PER_TYPE
export const MAX_ROOMS = 2

const RoomContext = createContext<RoomStore | null>(null)

export function RoomProvider({ children }: { children: ReactNode }) {
  // Position, direction and pose change rooms together. This is the only persisted character state.
  const [characterSnapshot, setCharacterSnapshot] = useState(loadCharacterSnapshot)
  const characterState = characterSnapshot.state
  const setCharacterState = (next: CharacterState | ((state: CharacterState) => CharacterState)) => setCharacterSnapshot((snapshot) => ({ ...snapshot, state: typeof next === 'function' ? next(snapshot.state) : next }))
  const finishCharacterAction = (state: Exclude<CharacterState, 'walking'>, transform?: CharacterTransform) => setCharacterSnapshot((snapshot) => ({ ...snapshot, ...transform, state }))
  const [characterLook, setCharacterLookState] = useState(() => (typeof window === 'undefined' ? null : loadCharacterLook()))
  const setCharacterLook = (patch: CharacterLook | null) => {
    if (isVisiting()) return
    const next = patch === null ? null : { ...characterLook, ...patch }
    setCharacterLookState(next)
    if (next) writeStored(LOOK_KEY, JSON.stringify(next)); else removeStored(LOOK_KEY)
  }
  const [selectedObject, setSelectedObject] = useState<SelectedObject>(null); const [computerOn, setComputerOn] = useState(() => loadInteractions().computerOn); const [toggledOn, setToggledOn] = useState<Set<string>>(() => new Set(loadInteractions().toggles)); const [artworks, setArtworks] = useState<Record<string, string>>(() => (typeof window === 'undefined' ? {} : loadArtworks() ?? {})); const [guestbook, setGuestbook] = useState<Record<string, GuestComment[]>>({}); const [timeOfDay, setTimeOfDayState] = useState<TimeOfDay>(() => { try { const saved = readStored('my-room-time-v1'); return saved === 'evening' || saved === 'night' ? saved : 'day' } catch { return 'day' } }); const [cupHeld, setCupHeld] = useState(() => loadInteractions().cupHeld); const [books, setBooks] = useState<Book[]>(() => (typeof window === 'undefined' ? initialBooks : hydrateBooks())); const [openBookId, setOpenBookId] = useState<string | null>(null); const [bookshelfOpen, setBookshelfOpen] = useState(false)
  const rooms0 = useRef(typeof window === 'undefined' ? { active: 'room-1', slots: [{ id: 'room-1', name: '나의 방' }] } : loadSlots()).current
  const [rooms, setRooms] = useState<Array<{ id: string; name: string }>>(() => rooms0.slots.map(({ id, name }) => ({ id, name })))
  const [activeRoomId, setActiveRoomId] = useState(rooms0.active)
  const activeRoomIdRef = useRef(rooms0.active)
  useEffect(() => { activeRoomIdRef.current = activeRoomId }, [activeRoomId])
  const [placedElsewhere, setPlacedElsewhere] = useState<Record<string, number>>(() => (typeof window === 'undefined' ? {} : placedInOtherSlots(rooms0.active)))
  const [mode, setMode] = useState<RoomMode>('normal'); const [furniture, setFurniture] = useState<FurnitureItem[]>(() => hydrateFurniture(typeof window === 'undefined' ? null : slotItems(rooms0.active))); const [selectedFurnitureId, setSelectedFurnitureId] = useState<FurnitureId | null>(null); const [history, setHistory] = useState<FurnitureItem[][]>([]); const [dragOrigin, setDragOrigin] = useState<FurnitureItem[] | null>(null); const [movingFurnitureId, setMovingFurnitureId] = useState<FurnitureId | null>(null); const [preview, setPreview] = useState<FurnitureItem | null>(null); const [previewValid, setPreviewValid] = useState(false); const [previewDragging, setPreviewDragging] = useState(false)
  const [wallStyle, setWallStyleState] = useState<RoomStyle>(() => (typeof window === 'undefined' ? {} : slotStyle(rooms0.active) ?? {})); const [floorStyle, setFloorStyleState] = useState<string | undefined>(() => (typeof window === 'undefined' ? undefined : slotStyle(rooms0.active)?.floor)); const [styleTarget, setStyleTarget] = useState<StyleTarget | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profile, setProfile] = useState<Profile>(() => {
    const today = new Date().toISOString().slice(0, 10)
    const saved = (typeof window === 'undefined' ? null : loadProfile()) ?? { total: 0, today: 0, lastVisit: today, friends: 0 }
    if (typeof window === 'undefined') return saved
    // one visit per browser session, and today's tally restarts when the date rolls over
    const counted = sessionStorage.getItem('my-room-visit') === today
    const next = counted ? saved : { ...saved, total: saved.total + 1, today: saved.lastVisit === today ? saved.today + 1 : 1, lastVisit: today }
    if (!counted) { sessionStorage.setItem('my-room-visit', today); saveProfile(next) }
    return next
  })
  const [videoFrames, setVideoFrames] = useState<Record<string, number>>({})
  const [videoLinks, setVideoLinks] = useState<Record<string, string>>(() => (typeof window === 'undefined' ? {} : loadVideoLinks()))
  // Every linked frame starts muted. A saved choice is only retried from the page's next real gesture.
  const [playingFrames, setPlayingFrames] = useState<string[]>(() => framesToPlay(furniture, videoLinks))
  const [mutedFrames, setMutedFrames] = useState<string[]>(() => framesToMute(playingFrames))
  const applyFrameMuted = (id: string, muted: boolean) => setMutedFrames((prev) => muted ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((value) => value !== id))
  // persist=false changes only the live player state (master mute, browser retry, etc.).
  const setFrameMuted = (id: string, muted: boolean, persist = true) => {
    applyFrameMuted(id, muted)
    if (!videoLinks[id]) setClipMuted(id, muted)
    else if (muted) { cancelSoundRequest(id); muteFrame(id) }
    else requestSound(id, () => applyFrameMuted(id, true), () => applyFrameMuted(id, false))
    if (persist) saveAudioPref(activeRoomId, id, !muted)
  }
  // which wall video the sound list is pointing at, for its hover glow
  const [highlightFrame, setHighlightFrame] = useState<string | null>(null)
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
  // the playlist auto-advances inside the music service; mirror the new track id (disc spin, notes)
  useEffect(() => onTrackChange((id) => setMusicTrackState(id)), [])
  useEffect(() => {
    if (!moveNotice) return
    const dismiss = () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); noticeTimer.current = 0; setMoveNotice(false) }
    window.addEventListener('pointerdown', dismiss, true)
    return () => window.removeEventListener('pointerdown', dismiss, true)
  }, [moveNotice])
  // diary content persists like the layout does — saved after every change (add book/entry, visibility toggle)
  useEffect(() => { saveBooks(books) }, [books])
  useEffect(() => {
    if (isVisiting()) return
    const pose = { state: TRANSIENT.includes(characterState) ? 'idle' : characterState, facing: characterSnapshot.facing, y: characterSnapshot.y }
    writeStored('my-room-character-v1', JSON.stringify(characterSnapshot.position))
    writeStored('my-room-interactions-v1', JSON.stringify({ toggles: [...toggledOn], computerOn, cupHeld, pose }))
    // the settle event: anyone standing in this room sees the character land where it ended up, in the pose it
    // ended up in, without waiting for the database round trip. Mid-walk states are skipped — the arrival is the
    // event, not the journey.
    if (!TRANSIENT.includes(characterState)) broadcastCharacter({ position: characterSnapshot.position, pose })
  }, [toggledOn, computerOn, cupHeld, characterSnapshot, characterState])
  // items resolved onto a furniture-hosted surface (a mug on the desk) don't carry their own live world position —
  // it's recomputed here from the owner's CURRENT position/rotation every time `furniture` changes, so moving or
  // rotating the desk carries everything on it along for free, with no per-item cascade-update code anywhere else
  // keep the bookshelf's top surface in step with its tier count before positions are resolved below
  const shelfTierCount = bookshelfTiers(books.map((book) => book.shelf ?? 0))
  setBookshelfTopOffset(bookshelfCapY(shelfTierCount) + 0.06)
  const resolvedFurniture = useMemo(() => furniture.map((item) => {
    if (!isOwnedSurfaceId(item.surfaceId)) return item
    const surface = resolveSurface(furniture, item.surfaceId); if (!surface) return item
    const itemResolution = resolutionFor(item)
    const position = gridToWorld(withResolution(surface, itemResolution), { gridX: item.gridX, gridY: item.gridY }, item.footprint, item.rotation[1])
    const owner = furniture.find((value) => value.id === surface.ownerId)
    return { ...item, position, rotation: [0, item.rotation[1] + (owner?.rotation[1] ?? 0), 0] as [number, number, number] }
  }), [furniture, shelfTierCount])
  const persist = (next: FurnitureItem[]) => saveSlotItems(activeRoomId, next.map(toPlacement))
  const commit = (next: FurnitureItem[], previous = furniture) => { if (!same(next, previous)) setHistory((items) => [...items.slice(-19), previous]); setFurniture(next); persist(next) }
  const clearSelection = () => { setSelectedObject(null); setStyleTarget(null); setFloorTarget(null); setCupHeld(false); setBookshelfOpen(false); setOpenBookId(null); setSelectedFurnitureId(null) }
  // One panel at a time. Every opener used to clear only the pieces it happened to know about, so a panel left
  // showing — the bookshelf, the profile card, a comment box — stayed on screen beside whatever was opened next.
  // Anything that opens something calls this first, and gaining a new panel can never leave an old one behind.
  const closePanels = () => { setOpenBookId(null); setBookshelfOpen(false); setProfileOpen(false); setCommentTarget(null); setReactionTarget(null); setStyleTarget(null) }
  const selectObject = (object: Exclude<SelectedObject, null>) => { const target = furniture.find((value) => value.id === object); const type = target?.type ?? object; if (mode === 'edit') { if (object !== 'character' && object !== 'book') setSelectedFurnitureId(object); return } if (type.startsWith('video-frame') && videoLinks[object]) { if (!playingFrames.includes(object)) { setFrameMuted(object, false); setPlayingFrames((prev) => [...prev, object]) } return }
    if (isVisiting() && type.startsWith('video-frame')) return
    if (type === 'profile-board') { closePanels(); setSelectedObject(object); setProfileOpen(true); return }
    if (type === 'character') { if (!isVisiting()) setCharacterState((state) => ({ idle: 'sittingFloor', sittingFloor: 'wave', wave: 'idle' } as Partial<Record<CharacterState, CharacterState>>)[state] ?? 'idle'); return } if (type === 'bed' && selectedObject === object) return clearSelection(); closePanels(); setFloorTarget(null); setSelectedObject(object); if (type === 'bookshelf') setBookshelfOpen(true); const sidePanelOnly = type === 'bookshelf' || type === 'guestbook' || type === 'photo' || type === 'poster' || type === 'easel-photo' || type === 'whiteboard' || type.startsWith('photo-frame') || type.startsWith('wall-art'); if (sidePanelOnly) return; if (type === 'computer') setComputerOn((on) => !on); if (['lamp', 'floor-lamp', 'fireplace', 'candle', 'tv', 'string-lights', 'christmas-tree', 'star-projector', 'mini-fridge', 'led-lamp', 'wardrobe', 'cabinet', 'bin'].includes(type)) setToggledOn((prev) => { const next = new Set(prev); if (next.has(object)) next.delete(object); else next.add(object); return next }); if (type === 'cup') setCupHeld(true); if (POSED_TYPES.has(type) && !isVisiting()) setCharacterState('walking') }
  const showMoveNotice = () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); setMoveNotice(true); noticeTimer.current = window.setTimeout(() => { noticeTimer.current = 0; setMoveNotice(false) }, 1600) }
  // clicking an empty floor cell in NORMAL mode: walk (with the normal walking motion) to that cell's center,
  // ending any free action / interaction. Occupied or out-of-bounds cells show a brief notice instead.
  // A room's character answers only to its owner: visitors never walk it, sit it down or pose it.
  const moveCharacterTo = (position: [number, number, number]) => {
    if (isVisiting()) return
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
  const settleFloorMove = (reached: boolean, transform?: CharacterTransform) => { setFloorTarget(null); finishCharacterAction('idle', transform); if (!reached) showMoveNotice() }
  const selectFurniture = (id: FurnitureId) => setSelectedFurnitureId(id)
  const enterEditFurniture = (id: FurnitureId) => { if (isVisiting()) return; const target = furniture.find((item) => item.id === id); setSelectedObject(null); setCupHeld(false); setBookshelfOpen(false); setOpenBookId(null); setPreview(null); setPreviewDragging(false); setSelectedFurnitureId(id); setDragOrigin(target?.movable ? furniture : null); setMovingFurnitureId(target?.movable ? id : null); setMode('edit') }
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
  const removeFurniture = (targetId = selectedFurnitureId ?? undefined) => { if (!targetId) return; const group = (value: FurnitureItem) => value.id === targetId || (isOwnedSurfaceId(value.surfaceId) && ownerIdOf(value.surfaceId) === targetId); const gone = furniture.filter((value) => group(value) && !value.removed).map((value) => value.id); const next = furniture.map((value) => group(value) && !value.removed ? { ...value, removed: true, updatedAt: new Date().toISOString() } : value); void purgeReactions(gone); dropReactions(gone); pendingMove.current = null; setDragOrigin(null); setMovingFurnitureId(null); commit(next); setSelectedFurnitureId(null) }
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
  const storedTemplateFor = (type: string) => furniture.find((item) => item.removed && item.movable && item.type === type)
  const startPreview = (type: string, styleId?: string) => {
    if (availableCount(type) <= 0) return
    const found = inventoryItems.find((entry) => entry.type === type) ?? storedTemplateFor(type); if (!found) return
    // a catalog variant (e.g. the white line) is the same furniture pre-tinted with a styleId
    const template = styleId ? { ...found, styleId } : found
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
    const restoreTarget = storedTemplateFor(preview.type)
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
  const toggleEditMode = () => { if (isVisiting()) return; endMove(); pendingMove.current = null; setMode((value) => value === 'normal' ? 'edit' : 'normal'); setPreview(null); setPreviewDragging(false); setDragOrigin(null); setMovingFurnitureId(null); setSelectedObject(null); setBookshelfOpen(false); setOpenBookId(null); setSelectedFurnitureId(null) }
  const openBook = (id: string) => { setSelectedObject('book'); setBookshelfOpen(false); setOpenBookId(id) }
  const addBook = (title: string, visibility: Visibility) => { const id = `book-${Date.now()}`; const createdAt = new Date().toISOString(); setBooks((items) => [...items, { id, title, coverColor: ['#718475', '#b96b52', '#607b93', '#b18a4c'][items.length % 4], description: '새 기록장', visibility, createdAt, updatedAt: createdAt, entries: [] }]) }
  const deleteBook = (id: string) => { const gone = (books.find((book) => book.id === id)?.entries ?? []).map((entry) => entry.id); void purgeReactions(gone); dropReactions(gone); setBooks((items) => items.filter((book) => book.id !== id)); if (openBookId === id) { setOpenBookId(null); setBookshelfOpen(true) } }
  const updateBook = (id: string, patch: Partial<Pick<Book, 'title' | 'visibility' | 'shelf'>>) => setBooks((items) => items.map((book) => book.id === id ? { ...book, ...patch, updatedAt: new Date().toISOString() } : book))
  const addEntry: RoomStore['addEntry'] = (bookId, entry) => { const createdAt = new Date().toISOString(); setBooks((items) => items.map((book) => book.id === bookId ? { ...book, updatedAt: createdAt, entries: [...book.entries, { ...entry, id: `entry-${Date.now()}`, bookId, createdAt, updatedAt: createdAt, comments: [] }] } : book)) }
  const updateEntry = (bookId: string, entryId: string, patch: Partial<Pick<Entry, 'content' | 'images' | 'visibility'>>) => setBooks((items) => items.map((book) => book.id === bookId ? { ...book, updatedAt: new Date().toISOString(), entries: book.entries.map((entry) => entry.id === entryId ? { ...entry, ...patch, updatedAt: new Date().toISOString() } : entry) } : book))
  // reactions live under the deleted thing's id, so they are dropped from view at the same moment
  const dropReactions = (ids: string[]) => {
    setGuestbook((prev) => { const next = { ...prev }; for (const id of ids) delete next[id]; return next })
    setOthersLikes((prev) => { const next = { ...prev }; for (const id of ids) delete next[id]; return next })
    setLikeTotals((prev) => { const next = { ...prev }; for (const id of ids) delete next[id]; return next })
  }
  const deleteEntry = (bookId: string, entryId: string) => { void purgeReactions([entryId]); dropReactions([entryId]); return setBooks((items) => items.map((book) => book.id === bookId ? { ...book, updatedAt: new Date().toISOString(), entries: book.entries.filter((entry) => entry.id !== entryId) } : book)) }
  const openStyleTarget = (target: StyleTarget) => setStyleTarget(target)
  const setWallStyle = (wallId: WallId, presetId: string) => setWallStyleState((current) => { const next = { ...current, [wallId]: presetId }; saveSlotStyle(activeRoomId, { ...next, floor: floorStyle }); return next })
  const setFloorStyle = (presetId: string) => { setFloorStyleState(presetId); saveSlotStyle(activeRoomId, { ...wallStyle, floor: presetId }) }
  const setFurnitureStyle = (id: FurnitureId, presetId: string) => { const next = furniture.map((value) => value.id === id ? { ...value, styleId: presetId, updatedAt: new Date().toISOString() } : value); commit(next) }
  const toggleDebugAnchors = () => setDebugAnchors((value) => !value)
  // one-time pull of the converted Instagram export (public/instagram/import.json) into the bookshelf
  useEffect(() => {
    try { if (localStorage.getItem('my-room-insta-imported-v1')) return } catch { return }
    fetch(`${publicBase}instagram/import.json`).then((response) => response.ok ? response.json() : null).then((book: Book | null) => {
      if (!book) return
      setBooks((prev) => prev.some((value) => value.id === book.id) ? prev : [...prev, book])
      localStorage.setItem('my-room-insta-imported-v1', '1')
    }).catch(() => { /* no import file present */ })
  }, [])
  useEffect(() => { saveArtworks(artworks) }, [artworks])
  // the number is a version stamp: bumping it remounts the screen so a replaced clip actually reloads
  useEffect(() => { listVideoIds().then((ids) => { if (ids?.length) setVideoFrames(Object.fromEntries(ids.map((id) => [id, 1]))) }) }, [])
  // The picture shows straight away from the data URL, then quietly becomes a bucket address once the upload
  // lands — the room only ever carries the address, which is what keeps the published bundle small.
  const storePhoto = (photo: string | undefined) => setProfile((current) => { const next = { ...current, photo }; saveProfile(next); return next })
  const setProfilePhoto = (photo: string | null) => {
    if (isVisiting()) return
    storePhoto(photo ?? undefined)
    if (photo?.startsWith('data:')) void uploadDataUrl('profile', photo).then((url) => { if (url) storePhoto(url) })
  }
  const setProfileHandle = (handle: string) => setProfile((current) => { const next = { ...current, handle: handle.trim() || undefined }; saveProfile(next); return next })
  const setVideoLink = (id: string, url: string | null) => {
    if (isVisiting()) return false
    const target = url ? youTubeTarget(url) : null
    if (url && !target) return false
    setVideoLinks((prev) => { const next = { ...prev }; if (target) next[id] = encodeTarget(target); else delete next[id]; saveVideoLinks(next); return next })
    return true
  }
  const setVideoClip = (id: string, file: File | null) => {
    if (isVisiting()) return
    if (!file) { deleteVideo(id); saveClipUrl(id, null); setVideoFrames(({ [id]: _removed, ...rest }) => rest); return }
    putVideo(id, file).then(() => setVideoFrames((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 })))
    void uploadMedia(`clips/${crypto.randomUUID()}`, file).then((url) => { if (url) saveClipUrl(id, url) })
  }
  // with a handle the guestbook is server-backed (visitors can write); without one it stays local as before.
  // comments are signed with the writer's own profile id — no free-text name
  const addGuestComment = (id: string, text: string) => {
    const cleanName = myHandle() ?? '익명'
    setGuestbook((prev) => ({ ...prev, [id]: [{ id: `gc-${Date.now()}`, name: cleanName, text, createdAt: new Date().toISOString(), photo: myProfilePhoto() }, ...(prev[id] ?? [])] }))
    if (currentRoomHandle()) void addRemoteComment(id, cleanName, text).then((row) => { if (row) setGuestbook((prev) => ({ ...prev, [id]: [remoteToComment(row), ...(prev[id] ?? []).filter((comment) => !comment.id.startsWith('gc-'))] })) })
  }
  const removeGuestComment = (id: string, commentId: string) => {
    setGuestbook((prev) => ({ ...prev, [id]: (prev[id] ?? []).filter((comment) => comment.id !== commentId) }))
    if (currentRoomHandle() && !commentId.startsWith('gc-')) void removeRemoteComment(commentId)
  }
  // server-backed guestbook + real visit counts arrive once per load
  const [remoteVisits, setRemoteVisits] = useState<{ total: number; today: number } | null>(null)
  const [roomSession, setRoomSession] = useState(0)
  const [currentHandle, setCurrentHandle] = useState<string | null>(() => (typeof window === 'undefined' ? null : currentRoomHandle()))
  // A room change carries none of the last room's screen state into the next one: open panels, the selection, the
  // pose, any half-finished edit — and the undo history, which is the dangerous one, since undoing after a switch
  // would write the previous room's layout into this one. Realtime updates arrive through onRoomRefresh instead and
  // leave all of this alone, so a comment landing in your own room never closes what you have open.
  useEffect(() => onRoomNavigation(() => {
    setRoomSession((value) => value + 1)
    setCurrentHandle(currentRoomHandle())
    clearSelection()
    setMode('normal')
    // autoplay-on-entry: runs once per room entered, with readStored already scoped to the new room
    const playing = framesToPlay(hydrateFurniture(slotItems(loadSlots().active)), loadVideoLinks())
    setPlayingFrames(playing)
    setMutedFrames(framesToMute(playing))
    // readStored is already scoped to the room being entered, so its whole character swaps in one update
    setCharacterSnapshot(loadCharacterSnapshot())
    setHistory([])
    setDragOrigin(null)
    setMovingFurnitureId(null)
    setPreview(null)
    setPreviewDragging(false)
    setProfileOpen(false)
    setReactionTarget(null)
    setCommentTarget(null)
    setHighlightFrame(null)
    setVideoFrames({})
    setMusicTrackState(null)
    stopMusic()
  }), [])
  // likes from OTHER people, for the red reaction badges
  const [othersLikes, setOthersLikes] = useState<Record<string, number>>({})
  // full like counts (mine included) and which ones are mine — the diary's heart button shows both
  const [likeTotals, setLikeTotals] = useState<Record<string, number>>({})
  const [myLikes, setMyLikes] = useState<string[]>([])
  const [reactionTarget, setReactionTarget] = useState<string | null>(null)
  // which piece of furniture has its comment box open (opened by holding it)
  const [commentTarget, setCommentTarget] = useState<string | null>(null)
  // bumped when a badge is cleared so the pending list recomputes
  const [, setSeenTick] = useState(0)
  // A live room-data change used to remount the whole app, which read to the visitor as a spontaneous page
  // refresh. Instead the fresh bundle is read straight back into state: the scene keeps its camera, any open
  // panel stays open, and only the parts that actually changed re-render.
  const rehydrate = () => {
    const slots = loadSlots()
    const active = slots.slots.some((slot) => slot.id === activeRoomIdRef.current) ? activeRoomIdRef.current : slots.active
    setRooms(slots.slots.map(({ id, name }) => ({ id, name })))
    setActiveRoomId(active)
    const items = hydrateFurniture(slotItems(active))
    setFurniture(items)
    const style = slotStyle(active) ?? {}
    setWallStyleState(style)
    setFloorStyleState(style.floor)
    setBooks(hydrateBooks())
    setArtworks(loadArtworks() ?? {})
    const links = loadVideoLinks()
    setVideoLinks(links)
    // A live update must never START anything here. This runs every time the owner's room data changes — and the
    // owner's data now changes on every click and sit-down — so recomputing the autoplay list from scratch was
    // pressing play on the visitor's frames each time the owner touched their own room. What plays is the
    // VISITOR's business; the update only prunes frames whose link no longer exists. Autoplay-on-entry lives in
    // the navigation reset below, which runs exactly once per room actually entered.
    setPlayingFrames((prev) => prev.filter((id) => links[id]))
    // replaced, never merged: a room whose profile has no photo would otherwise keep showing the last one's
    setProfile({ total: 0, today: 0, lastVisit: '', friends: 0, ...(loadProfile() ?? {}) })
    const time = readStored('my-room-time-v1')
    setTimeOfDayState(time === 'evening' || time === 'night' ? time : 'day')
    setCharacterLookState(loadCharacterLook())
    const interactions = loadInteractions()
    setToggledOn(new Set(interactions.toggles))
    setComputerOn(interactions.computerOn)
    setCupHeld(interactions.cupHeld)
    // The pose travels with the room data, so a change that arrives as a database update — the path that runs
    // when the broadcast was missed — still sits the character down. Only while visiting: the owner's own room
    // refresh must not yank their character out of whatever they are doing right now.
    if (isVisiting()) setCharacterSnapshot(loadCharacterSnapshot())
  }
  // One-time rescue: photos saved as data URLs sit inside the room bundle and can swallow the entire 5MB
  // localStorage budget — after which every save silently fails. Move them to the bucket and keep the URL.
  useEffect(() => {
    if (isVisiting()) return
    let live = true
    void (async () => {
      const current = loadBooks<Book[]>() ?? []
      let changed = false
      for (const book of current) {
        for (const entry of book.entries ?? []) {
          const images = entry.images ?? []
          for (let i = 0; i < images.length; i++) {
            if (!images[i].startsWith('data:')) continue
            const url = await uploadDataUrl('records', images[i])
            if (url) { images[i] = url; changed = true }
          }
        }
      }
      if (changed && live) { saveBooks(current); setBooks(current.map((book) => ({ ...book }))) }
      // Same rescue for media whose upload never landed: it still plays locally for the owner, so the failure is
      // invisible until a visitor hears nothing. Re-uploading here means a dropped connection costs one reload.
      // Artwork and the profile photo were kept inline as data URLs, which is most of what a published room
      // weighs — and past 64KB the save made while closing the tab cannot survive the page. Same rescue.
      const art = loadArtworks() ?? {}
      let movedArt = false
      for (const [key, value] of Object.entries(art)) {
        if (!value.startsWith('data:')) continue
        const url = await uploadDataUrl('art', value)
        if (url) { art[key] = url; movedArt = true }
      }
      if (movedArt && live) { saveArtworks(art); setArtworks({ ...art }) }
      const storedProfile = loadProfile()
      if (storedProfile?.photo?.startsWith('data:')) {
        const url = await uploadDataUrl('profile', storedProfile.photo)
        if (url && live) storePhoto(url)
      }
      if (live) await Promise.allSettled([syncPendingTracks(), syncPendingClips()])
    })()
    return () => { live = false }
  }, [])
  useEffect(() => {
    const loadRemoteGuestbook = () => void fetchGuestbook().then((rows) => {
      if (!rows) return
      const grouped: Record<string, GuestComment[]> = {}
      rows.forEach((row) => { (grouped[row.item_id] ??= []).push(remoteToComment(row)) })
      setGuestbook(grouped)
    })
    const loadRemoteVisits = () => void fetchVisitCounts().then((counts) => { if (counts) setRemoteVisits(counts) })
    const loadRemoteLikes = () => void fetchAllLikes().then((rows) => {
      if (!rows) return
      const mine = myVisitorId()
      const counts: Record<string, number> = {}
      const totals: Record<string, number> = {}
      rows.forEach((row) => { if (row.visitor !== mine) counts[row.item_id] = (counts[row.item_id] ?? 0) + 1; totals[row.item_id] = (totals[row.item_id] ?? 0) + 1 })
      setOthersLikes(counts)
      setLikeTotals(totals)
      setMyLikes(rows.filter((row) => row.visitor === mine).map((row) => row.item_id))
    })
    // Clear first, then fetch. Every loader above bails on an empty response, so a room with no visits, likes or
    // comments of its own would otherwise go on showing the numbers of the room left behind.
    setRemoteVisits(null)
    setOthersLikes({})
    setLikeTotals({})
    setMyLikes([])
    void recordVisit()
    loadRemoteGuestbook()
    loadRemoteVisits()
    loadRemoteLikes()
    // live events keep everything current without a refresh: new comments and visits re-pull their views,
    // and a room-data change while visiting re-fetches the snapshot and re-reads it into state in place
    const stopRealtime = subscribeRealtime(loadRemoteGuestbook, loadRemoteVisits, () => { void refreshVisit() }, loadRemoteLikes, (settle) => {
      // only meaningful while STANDING IN someone else's room: the settle describes that room's character. The
      // owner's own echo must not re-run their state machine mid-action.
      if (!isVisiting()) return
      const pose = loadPose({ pose: settle.pose })
      setCharacterSnapshot({ position: settle.position, state: pose?.state ?? 'idle', facing: pose?.facing ?? Math.PI / 4, y: pose?.y ?? 0 })
    })
    const stopRefresh = onRoomRefresh(rehydrate)
    return () => { stopRealtime(); stopRefresh() }
  }, [roomSession])
  // Visibility is a book-level gate: a private book takes its whole contents with it, and inside a public
  // book only the public records show. Filtered once here, where every reader gets its books, so no consumer
  // can forget — the 3D shelf's spines are clickable too.
  const visibleBooks = isVisiting()
    ? books.filter((book) => book.visibility === 'public').map((book) => ({ ...book, entries: book.entries.filter((entry) => entry.visibility === 'public') }))
    : books
  // Reactions belong to whatever object holds them. A record lives inside the bookshelf, so likes and comments
  // left on records are counted onto the bookshelf — otherwise they would raise no dot at all, since badges
  // only ever look at furniture. One place computes this so the badge, the object click and the popup agree.
  const reactionIdsFor = (id: FurnitureId): string[] => {
    const item = furniture.find((value) => value.id === id)
    if (item?.type !== 'bookshelf') return [id]
    return [id, ...books.flatMap((book) => book.entries.map((entry) => entry.id))]
  }
  const countReactions = (ids: string[]) => {
    const me = myVisitorId()
    return ids.reduce((total, key) => total + (othersLikes[key] ?? 0) + (guestbook[key] ?? []).filter((comment) => comment.visitor && comment.visitor !== me).length, 0)
  }
  const pendingReactions: Record<string, number> = {}
  if (!isVisiting()) for (const item of furniture) {
    if (item.removed) continue
    const count = countReactions(reactionIdsFor(item.id))
    if (count > (getSeenReactions()[item.id] ?? 0)) pendingReactions[item.id] = count
  }
  // One door for every object: comments first, then a fresh reaction, then whatever the object normally does.
  // Anything that can be clicked routes through here, so a new piece of furniture inherits the behaviour
  // without repeating it — returns true when it handled the click.
  const openObject = (id: FurnitureId): boolean => {
    const me = myVisitorId()
    if ((guestbook[id] ?? []).some((comment) => comment.visitor && comment.visitor !== me)) { markReactionsSeen(id); closePanels(); setCommentTarget(id); return true }
    if (pendingReactions[id]) { markReactionsSeen(id); closePanels(); setReactionTarget(id); return true }
    return false
  }
  const markReactionsSeen = (id: FurnitureId) => { markReactionSeen(id, countReactions(reactionIdsFor(id))); setSeenTick((value) => value + 1) }
  // you own one of each, wherever it stands — a piece placed in another room is not available in this one
  const availableCount = (type: string) => Math.max(0, ownedCountOf(type) - furniture.filter((item) => item.type === type && !item.removed).length - (placedElsewhere[type] ?? 0))
  const openRoom = (id: string) => {
    setActiveSlot(id)
    setActiveRoomId(id)
    const items = hydrateFurniture(slotItems(id))
    setFurniture(items)
    const playing = framesToPlay(items, videoLinks)
    setPlayingFrames(playing)
    setMutedFrames(framesToMute(playing))
    setHistory([])
    const style = slotStyle(id) ?? {}
    setWallStyleState(style)
    setFloorStyleState(style.floor)
    setPlacedElsewhere(placedInOtherSlots(id))
    setPreview(null); setMovingFurnitureId(null); setDragOrigin(null); pendingMove.current = null
    setMode('normal'); setSelectedObject(null); setSelectedFurnitureId(null); setStyleTarget(null)
    setBookshelfOpen(false); setOpenBookId(null); setFloorTarget(null); setCharacterState('idle')
  }
  // a new room starts bare: your furniture is still standing wherever you left it
  const createRoom = () => {
    if (rooms.length >= MAX_ROOMS) return
    const empty = initialFurniture.map((item) => toPlacement({ ...item, removed: true }))
    const slot = createSlot(`방 ${rooms.length + 1}`, empty)
    setRooms((list) => [...list, { id: slot.id, name: slot.name }])
    openRoom(slot.id)
  }
  const removeRoom = (id: string) => {
    if (rooms.length <= 1) return
    const gone = (slotItems(id) ?? []).filter((item) => !item.removed).map((item) => item.id)
    void purgeReactions(gone)
    dropReactions(gone)
    deleteSlot(id)
    const rest = rooms.filter((room) => room.id !== id)
    setRooms(rest)
    if (id === activeRoomId) openRoom(rest[0].id)
    else setPlacedElsewhere(placedInOtherSlots(activeRoomId))
  }
  const setTimeOfDay = (time: TimeOfDay) => { setTimeOfDayState(time); if (!isVisiting()) writeStored('my-room-time-v1', time) }
  const setArtwork = (id: string, dataURL: string | null) => {
    if (isVisiting()) return
    setArtworks((prev) => { const next = { ...prev }; if (dataURL) next[id] = dataURL; else delete next[id]; return next })
    // same swap as the profile photo. `artworks` also holds plain text (a banner's caption), so only a data URL
    // is ever uploaded, and the entry is only replaced if it is still the one that was sent.
    if (dataURL?.startsWith('data:')) void uploadDataUrl('art', dataURL).then((url) => {
      if (url) setArtworks((prev) => prev[id] === dataURL ? { ...prev, [id]: url } : prev)
    })
  }
  return <RoomContext value={{ selectedObject, characterState, computerOn, toggledOn, cupHeld, artworks, setArtwork, profile, profileOpen, openProfile: () => setProfileOpen(true), closeProfile: () => setProfileOpen(false), setProfilePhoto, setProfileHandle, videoFrames, videoClips: loadClipUrls(), setVideoClip, videoLinks, setVideoLink, playingFrames, stopFrame: (id: string) => setPlayingFrames((prev) => prev.filter((value) => value !== id)), mutedFrames, setFrameMuted, highlightFrame, setHighlightFrame, openVideoPanel: (id: string) => { if (isVisiting()) return; setFrameMuted(id, false); closePanels(); setSelectedObject(id) }, rooms, activeRoomId, openRoom, createRoom, removeRoom, availableCount, guestbook, addGuestComment, removeGuestComment, remoteVisits, othersLikes, likeTotals, myLikes, pendingReactions, markReactionsSeen, openObject, reactionIdsFor, reactionTarget, setReactionTarget, commentTarget, setCommentTarget, timeOfDay, setTimeOfDay, books: visibleBooks, openBookId, bookshelfOpen, readOnly: false, characterHome: characterSnapshot.position, characterPose: characterSnapshot, characterWritable: !isVisiting(), characterLook, setCharacterLook, currentHandle, mode, furniture: resolvedFurniture, selectedFurnitureId, selectedPlacementValid, movingFurnitureId, preview, previewValid, previewDragging, wallStyle, floorStyle, styleTarget, debugAnchors, moveNotice, floorTarget, musicTrack, setMusicTrack, setMusicVolume, musicVolume, selectObject, clearSelection, finishCharacterAction, moveCharacterTo, settleFloorMove, openBook, closeBook: () => { setOpenBookId(null); setSelectedObject('bookshelf'); setBookshelfOpen(true) }, addBook, deleteBook, updateBook, addEntry, deleteEntry, updateEntry, toggleEditMode, enterEditFurniture, selectFurniture, beginMove, moveFurniture, placeFurnitureAt, endMove, rotateFurniture, removeFurniture, undoLayout, resetLayout, startPreview, beginPreviewDrag, movePreview, endPreviewDrag, placePreview, cancelPreview, openStyleTarget, setWallStyle, setFloorStyle, setFurnitureStyle, toggleDebugAnchors }}>{children}</RoomContext>
}
// A neighbour room in the zoom-out explorer, drawn from that room's own published bundle with the SAME furniture
// components as the live room — so it is the real room, not a stand-in. Read-only by construction: there is no
// state and no effect here, and every mutator below is a no-op, so no publish, realtime subscription, visit count
// or storage write can run for a room the user is only looking at. A vacant slot passes null and gets the default
// room, because an empty bundle makes every read miss and each loader falls back to its default.
// ponytail: the bookshelf's top-surface offset stays at its default for neighbours — setBookshelfTopOffset is a
// module singleton owned by the live room, and fighting over it would move the real room's shelf. Only matters if
// something is placed on a neighbour's bookshelf cap; make the offset per-room if that ever shows.
// A playlist saved as plain `pl:<id>` names no starting video, so VideoScreen has nothing to fetch a thumbnail
// for and the frame stays dark. The room's own saved play order knows which video goes first, so that id stands in
// as the poster. It has to be resolved HERE, inside the bundle scope: VideoScreen looks the link up later from an
// effect, by which time reads have fallen back to this browser's own storage.
const neighbourVideoLinks = () => {
  const orders = loadOrders()
  return Object.fromEntries(Object.entries(loadVideoLinks()).map(([frameId, link]) => {
    if (!link.startsWith('pl:') || link.includes('@')) return [frameId, link]
    const first = orders[link.slice(3)]?.[0]
    return [frameId, first ? `${link}@${first}` : link]
  }))
}

const NEIGHBOUR_TIME: TimeOfDay[] = ['day', 'evening', 'night']
export function NeighbourRoomProvider({ bundle, children }: { bundle: Record<string, string> | null; children: ReactNode }) {
  const value = useMemo<RoomStore>(() => readingBundle(bundle ?? {}, () => {
    const slots = loadSlots()
    const style = slotStyle(slots.active) ?? {}
    const items = hydrateFurniture(slotItems(slots.active))
    // owned-surface items carry no world position of their own; resolve them exactly as the live room does
    const furniture = items.map((item) => {
      if (!isOwnedSurfaceId(item.surfaceId)) return item
      const surface = resolveSurface(items, item.surfaceId); if (!surface) return item
      const position = gridToWorld(withResolution(surface, resolutionFor(item)), { gridX: item.gridX, gridY: item.gridY }, item.footprint, item.rotation[1])
      const owner = items.find((value) => value.id === surface.ownerId)
      return { ...item, position, rotation: [0, item.rotation[1] + (owner?.rotation[1] ?? 0), 0] as [number, number, number] }
    })
    const interactions = loadInteractions()
    const character = loadCharacterSnapshot()
    const saved = readStored('my-room-time-v1')
    const noop = () => {}
    return {
      selectedObject: null, characterState: interactions.pose?.state ?? 'idle', computerOn: interactions.computerOn, toggledOn: new Set(interactions.toggles), cupHeld: interactions.cupHeld,
      artworks: loadArtworks() ?? {}, setArtwork: noop,
      rooms: slots.slots.map((slot) => ({ id: slot.id, name: slot.name })), activeRoomId: slots.active, openRoom: noop, createRoom: noop, removeRoom: noop, availableCount: () => 0,
      profile: loadProfile() ?? { total: 0, today: 0, lastVisit: '', friends: 0 }, profileOpen: false, openProfile: noop, closeProfile: noop, setProfilePhoto: noop, setProfileHandle: noop,
      // The links are read so a neighbour's frames show that room's YouTube poster — VideoScreen already draws one
      // whenever a link is present, and it costs an image rather than an embed. WallVideoLayer stays out of the
      // neighbour tree: that is what would put a live iframe on every frame of every room, and being DOM rather
      // than 3D it would not fade with the room either. The real thing plays once the room is entered.
      videoFrames: {}, videoClips: loadClipUrls(), setVideoClip: noop, videoLinks: neighbourVideoLinks(), setVideoLink: () => false, playingFrames: [], stopFrame: noop, mutedFrames: [], setFrameMuted: noop, highlightFrame: null, setHighlightFrame: noop, openVideoPanel: noop,
      guestbook: {}, addGuestComment: noop, removeGuestComment: noop, remoteVisits: null, othersLikes: {}, likeTotals: {}, myLikes: [], pendingReactions: {}, markReactionsSeen: noop,
      openObject: () => false, reactionIdsFor: () => [], reactionTarget: null, setReactionTarget: noop, commentTarget: null, setCommentTarget: noop,
      timeOfDay: NEIGHBOUR_TIME.find((time) => time === saved) ?? 'day', setTimeOfDay: noop,
      books: hydrateBooks(), openBookId: null, bookshelfOpen: false,
      readOnly: true, characterHome: character.position, characterPose: character, characterWritable: false, characterLook: loadCharacterLook(), setCharacterLook: noop, currentHandle: null,
      mode: 'normal', furniture, selectedFurnitureId: null, selectedPlacementValid: true, movingFurnitureId: null, preview: null, previewValid: false, previewDragging: false,
      wallStyle: style, floorStyle: style.floor, styleTarget: null, debugAnchors: false, moveNotice: false, floorTarget: null,
      musicTrack: null, setMusicTrack: noop, musicVolume: 0, setMusicVolume: noop,
      selectObject: noop, clearSelection: noop, finishCharacterAction: noop, moveCharacterTo: noop, settleFloorMove: noop,
      openBook: noop, closeBook: noop, addBook: noop, deleteBook: noop, updateBook: noop, addEntry: noop, deleteEntry: noop, updateEntry: noop,
      toggleEditMode: noop, enterEditFurniture: noop, selectFurniture: noop, beginMove: noop, moveFurniture: noop, placeFurnitureAt: noop, endMove: noop, rotateFurniture: noop, removeFurniture: noop, undoLayout: noop, resetLayout: noop,
      startPreview: noop, beginPreviewDrag: noop, movePreview: noop, endPreviewDrag: noop, placePreview: noop, cancelPreview: noop,
      openStyleTarget: noop, setWallStyle: noop, setFloorStyle: noop, setFurnitureStyle: noop, toggleDebugAnchors: noop,
    }
  }), [bundle])
  return <RoomContext value={value}>{children}</RoomContext>
}

export function useRoomStore() { const store = useContext(RoomContext); if (!store) throw new Error('RoomProvider is required'); return store }
// for trees rendered outside the provider (e.g. the offscreen thumbnail canvas)
export const useOptionalRoomStore = () => useContext(RoomContext)
