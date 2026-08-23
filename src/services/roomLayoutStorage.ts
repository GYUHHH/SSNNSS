import { currentRoomHandle, DEFAULT_PROFILE_PHOTO, defaultProfileData, isReadingBundle, isVisiting, normalizeProfilePhoto, readStored, writeStored } from './social'
import { t } from './i18n'

export type FurniturePlacement = { id: string; type: string; position?: [number, number, number]; rotation: [number, number, number]; scale: number; surfaceId?: string; gridX?: number; gridZ?: number; gridY?: number; wallId?: 'leftWall' | 'rightWall'; footprint?: { width: number; depth: number }; resolution?: 'base' | 'subgrid2'; styleId?: string; removed?: boolean; updatedAt: string }
export type RoomStyle = { leftWall?: string; rightWall?: string; floor?: string }

const key = 'my-room-layout-v1'

const readBlob = (): { version: number; items: FurniturePlacement[]; style?: RoomStyle } | null => {
  try {
    const saved = readStored(key); if (!saved) return null
    const parsed = JSON.parse(saved) as FurniturePlacement[] | { version: number; items: FurniturePlacement[]; style?: RoomStyle }
    return Array.isArray(parsed) ? { version: 0, items: parsed } : parsed
  } catch { return null }
}

// rooms are slots: each keeps its own layout and wall/floor styling, while furniture ownership stays global
export type RoomSlot = { id: string; name: string; items: FurniturePlacement[]; style?: RoomStyle }
type SlotsBlob = { version: number; active: string; slots: RoomSlot[] }
const slotsKey = 'my-room-slots-v1'

const readSlots = (): SlotsBlob | null => {
  try { const raw = readStored(slotsKey); return raw ? JSON.parse(raw) as SlotsBlob : null } catch { return null }
}
const writeSlots = (blob: SlotsBlob) => {
  if (isVisiting() || isReadingBundle()) return
  writeStored(slotsKey, JSON.stringify(blob))
}

// first run promotes the single saved room into slot one — the old key is left untouched as a fallback copy
export function loadSlots(): SlotsBlob {
  const saved = readSlots()
  if (saved?.slots?.length) return saved
  const legacy = readBlob()
  const blob: SlotsBlob = { version: 1, active: 'room-1', slots: [{ id: 'room-1', name: t('나의 방'), items: legacy?.items ?? [], style: legacy?.style }] }
  writeSlots(blob)
  return blob
}

const withSlot = (id: string, change: (slot: RoomSlot) => void) => {
  const blob = loadSlots()
  const slot = blob.slots.find((entry) => entry.id === id)
  if (!slot) return
  change(slot)
  writeSlots(blob)
}

export function slotItems(id: string): FurniturePlacement[] | null { return loadSlots().slots.find((slot) => slot.id === id)?.items ?? null }
export function slotStyle(id: string): RoomStyle | null { return loadSlots().slots.find((slot) => slot.id === id)?.style ?? null }
export function saveSlotItems(id: string, items: FurniturePlacement[]) { withSlot(id, (slot) => { slot.items = items }) }
export function saveSlotStyle(id: string, style: RoomStyle) { withSlot(id, (slot) => { slot.style = style }) }
export function renameSlot(id: string, name: string) { withSlot(id, (slot) => { slot.name = name }) }
export function setActiveSlot(id: string) { const blob = loadSlots(); blob.active = id; writeSlots(blob) }

export function createSlot(name: string, items: FurniturePlacement[]): RoomSlot {
  const blob = loadSlots()
  const slot: RoomSlot = { id: `room-${Date.now()}`, name, items }
  blob.slots.push(slot)
  blob.active = slot.id
  writeSlots(blob)
  return slot
}

export function deleteSlot(id: string) {
  const blob = loadSlots()
  if (blob.slots.length <= 1) return
  blob.slots = blob.slots.filter((slot) => slot.id !== id)
  if (blob.active === id) blob.active = blob.slots[0].id
  writeSlots(blob)
}

// a piece of furniture lives in exactly one room, so what is standing in the OTHER rooms is unavailable here
export function placedInOtherSlots(activeId: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const slot of loadSlots().slots) {
    if (slot.id === activeId) continue
    for (const item of slot.items) if (!item.removed) counts[item.type] = (counts[item.type] ?? 0) + 1
  }
  return counts
}

// user-made artwork (poster drawings, frame photos) keyed by furniture id; uploaded images become bucket URLs
const artworkKey = 'my-room-artwork-v1'
export function loadArtworks(): Record<string, string> | null {
  try { const raw = readStored(artworkKey); return raw ? JSON.parse(raw) as Record<string, string> : null } catch { return null }
}
export function saveArtworks(artworks: Record<string, string>) {
  if (isVisiting() || isReadingBundle()) return
  writeStored(artworkKey, JSON.stringify(artworks))
}

// diary books/entries live under their own key so the layout blob stays small and the two never clobber each other
const booksKey = 'my-room-books-v1'
export function loadBooks<T>(): T | null {
  try { const raw = readStored(booksKey); return raw ? JSON.parse(raw) as T : null } catch { return null }
}
export function saveBooks(books: unknown) {
  if (isVisiting() || isReadingBundle()) return
  writeStored(booksKey, JSON.stringify(books))
}

// visitor counts and the profile photo — counted locally until there is a server to ask
export type Profile = { photo: string; photoOwner?: string; handle?: string; total: number; today: number; lastVisit: string }
const profileKey = 'my-room-profile-v1'
export function loadProfile(ownerHandle?: string): Profile {
  try {
    const raw = readStored(profileKey)
    const saved = raw ? JSON.parse(raw) as Partial<Profile> : {}
    const handle = ownerHandle ?? saved.handle
    const ownsPhoto = !saved.photoOwner || !handle || saved.photoOwner === handle
    return {
      ...defaultProfileData(handle),
      ...saved,
      handle,
      photo: ownsPhoto ? normalizeProfilePhoto(saved.photo) : DEFAULT_PROFILE_PHOTO,
      photoOwner: handle ?? saved.photoOwner,
    }
  } catch { return defaultProfileData(ownerHandle) }
}
export function saveProfile(profile: Profile) {
  if (isVisiting() || isReadingBundle()) return
  const handle = currentRoomHandle() ?? profile.handle
  writeStored(profileKey, JSON.stringify({
    ...profile,
    handle,
    photo: profile.photo || DEFAULT_PROFILE_PHOTO,
    photoOwner: handle,
  }))
}
