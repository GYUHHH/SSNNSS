export type FurniturePlacement = { id: string; type: string; position?: [number, number, number]; rotation: [number, number, number]; scale: number; surfaceId?: string; gridX?: number; gridZ?: number; gridY?: number; wallId?: 'leftWall' | 'rightWall'; footprint?: { width: number; depth: number }; resolution?: 'base' | 'subgrid2'; styleId?: string; removed?: boolean; updatedAt: string }
export type RoomStyle = { leftWall?: string; rightWall?: string; floor?: string }

const key = 'my-room-layout-v1'

const readBlob = (): { version: number; items: FurniturePlacement[]; style?: RoomStyle } | null => {
  try {
    const saved = localStorage.getItem(key); if (!saved) return null
    const parsed = JSON.parse(saved) as FurniturePlacement[] | { version: number; items: FurniturePlacement[]; style?: RoomStyle }
    return Array.isArray(parsed) ? { version: 0, items: parsed } : parsed
  } catch { return null }
}

export function loadRoomLayout(): FurniturePlacement[] | null { return readBlob()?.items ?? null }
export function loadRoomStyle(): RoomStyle | null { return readBlob()?.style ?? null }

export function saveRoomLayout(layout: FurniturePlacement[]) {
  try { localStorage.setItem(key, JSON.stringify({ version: 4, items: layout, style: readBlob()?.style })) } catch { /* localStorage may be unavailable */ }
}
export function saveRoomStyle(style: RoomStyle) {
  try { localStorage.setItem(key, JSON.stringify({ version: 4, items: readBlob()?.items ?? [], style })) } catch { /* localStorage may be unavailable */ }
}

// user-made artwork (poster drawings, frame photos) keyed by furniture id, stored as data URLs
const artworkKey = 'my-room-artwork-v1'
export function loadArtworks(): Record<string, string> | null {
  try { const raw = localStorage.getItem(artworkKey); return raw ? JSON.parse(raw) as Record<string, string> : null } catch { return null }
}
export function saveArtworks(artworks: Record<string, string>) {
  try { localStorage.setItem(artworkKey, JSON.stringify(artworks)) } catch { /* quota exceeded or unavailable */ }
}

// diary books/entries live under their own key so the layout blob stays small and the two never clobber each other
const booksKey = 'my-room-books-v1'
export function loadBooks<T>(): T | null {
  try { const raw = localStorage.getItem(booksKey); return raw ? JSON.parse(raw) as T : null } catch { return null }
}
export function saveBooks(books: unknown) {
  try { localStorage.setItem(booksKey, JSON.stringify(books)) } catch { /* quota exceeded or unavailable */ }
}

// guestbook comments per wall-board furniture id
const guestbookKey = 'my-room-guestbook-v1'
export function loadGuestbook<T>(): T | null {
  try { const raw = localStorage.getItem(guestbookKey); return raw ? JSON.parse(raw) as T : null } catch { return null }
}
export function saveGuestbook(guestbook: unknown) {
  try { localStorage.setItem(guestbookKey, JSON.stringify(guestbook)) } catch { /* quota exceeded or unavailable */ }
}
