// Supabase-backed social layer, plain fetch against PostgREST (no SDK dependency).
// - The owner's room state (a bundle of my-room-* localStorage values) is published under their profile
//   handle, guarded by a per-device secret checked inside the save_room SQL function.
// - Visiting ?room=<handle> loads that bundle read-only: the intercepted storage reads serve it instead of
//   the visitor's own room, and every save becomes a no-op so nothing local gets overwritten.
// - Likes are one row per (room, item, visitor); toggling inserts or deletes and returns the fresh count.
const SUPABASE_URL = 'https://pxjavljsalibpnxdrxel.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4amF2bGpzYWxpYnBueGRyeGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjAxNTgsImV4cCI6MjEwMjQzNjE1OH0.quIFdlk11b7F-YIeHO3TsEhS2RzgxDtntqdh2vHyUfE'
const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
const escape = encodeURIComponent

const SYNC_KEYS = ['my-room-slots-v1', 'my-room-video-links-v1', 'my-room-artwork-v1', 'my-room-profile-v1', 'my-room-books-v1', 'my-room-guestbook-v1', 'my-room-playlist-order-v1', 'my-room-interactions-v1', 'my-room-time-v1', 'my-room-music-v1', 'my-room-clip-urls-v1']

export const visitHandle = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('room') : null
let visitData: Record<string, string> | null = null
export const isVisiting = () => visitHandle !== null && visitHandle !== ownHandle()

// storage reads for room content route through here: a visit serves the fetched bundle exclusively
export const readStored = (key: string): string | null => {
  if (isVisiting()) return visitData?.[key] ?? null
  try { return localStorage.getItem(key) } catch { return null }
}

export async function initVisit() {
  if (!isVisiting()) return
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=eq.${escape(visitHandle!)}&select=data`, { headers })
    const rows = await response.json()
    visitData = rows?.[0]?.data ?? {}
  } catch { visitData = {} }
}

const persistentId = (key: string) => {
  try {
    let value = localStorage.getItem(key)
    if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value) }
    return value
  } catch { return 'anonymous' }
}
const visitorId = () => persistentId('my-room-visitor-v1')
const roomSecret = () => persistentId('my-room-secret-v1')

const ownHandle = (): string | null => {
  try { return JSON.parse(localStorage.getItem('my-room-profile-v1') ?? 'null')?.handle ?? null } catch { return null }
}
export const currentRoomHandle = () => (isVisiting() ? visitHandle : ownHandle())
export const shareUrl = () => {
  const handle = ownHandle()
  return handle ? `${location.origin}${location.pathname}?room=${escape(handle)}` : null
}

export async function publishRoom() {
  if (isVisiting()) return
  const handle = ownHandle()
  if (!handle) return
  const data: Record<string, string> = {}
  for (const key of SYNC_KEYS) { try { const value = localStorage.getItem(key); if (value) data[key] = value } catch { /* skip */ } }
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_room`, { method: 'POST', headers, body: JSON.stringify({ p_handle: handle, p_secret: roomSecret(), p_data: data }) })
  } catch { /* offline — the next change tries again */ }
}

let publishTimer: ReturnType<typeof setTimeout> | undefined
export const schedulePublish = () => {
  if (isVisiting()) return
  clearTimeout(publishTimer)
  publishTimer = setTimeout(() => { void publishRoom() }, 2500)
}

export const myVisitorId = () => visitorId()

// uploaded media (music files, video clips) go to the public storage bucket so visitors can stream them
export async function uploadMedia(path: string, file: Blob): Promise<string | null> {
  try {
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/media/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!response.ok) return null
    return `${SUPABASE_URL}/storage/v1/object/public/media/${path}`
  } catch { return null }
}

// Guestbook lives on the server as soon as the room has a handle: visitors can write, and deletion is allowed
// to the room owner (device secret) or the comment's own author (visitor id), enforced inside the SQL function.
export type RemoteGuestComment = { id: string; item_id: string; name: string; text: string; visitor: string; created_at: string }

export async function fetchGuestbook(): Promise<RemoteGuestComment[] | null> {
  const room = currentRoomHandle()
  if (!room) return null
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/guestbook?room=eq.${escape(room)}&select=id,item_id,name,text,visitor,created_at&order=created_at.desc`, { headers })
    const rows = await response.json()
    return Array.isArray(rows) ? rows : null
  } catch { return null }
}

export async function addRemoteComment(itemId: string, name: string, text: string): Promise<RemoteGuestComment | null> {
  const room = currentRoomHandle()
  if (!room) return null
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/guestbook`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ room, item_id: itemId, name, text, visitor: visitorId() }),
    })
    const rows = await response.json()
    return Array.isArray(rows) ? rows[0] ?? null : null
  } catch { return null }
}

export async function removeRemoteComment(commentId: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_guest_comment`, { method: 'POST', headers, body: JSON.stringify({ p_id: commentId, p_secret: roomSecret(), p_visitor: visitorId() }) })
  } catch { /* offline */ }
}

// One visit row per visitor per day; the profile numbers read the real counts
export async function recordVisit() {
  if (!isVisiting()) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/visits`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ room: visitHandle, visitor: visitorId() }) })
  } catch { /* offline */ }
}

const countRows = async (query: string): Promise<number | null> => {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, { method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' } })
    const range = response.headers.get('content-range')
    const total = range?.split('/')[1]
    return total && total !== '*' ? Number(total) : null
  } catch { return null }
}

export async function fetchVisitCounts(): Promise<{ total: number; today: number } | null> {
  const room = currentRoomHandle()
  if (!room) return null
  const today = new Date().toISOString().slice(0, 10)
  const [total, todayCount] = await Promise.all([
    countRows(`visits?room=eq.${escape(room)}&select=visitor`),
    countRows(`visits?room=eq.${escape(room)}&day=eq.${today}&select=visitor`),
  ])
  return total === null ? null : { total, today: todayCount ?? 0 }
}

export async function toggleLike(itemId: string): Promise<{ count: number; liked: boolean } | null> {
  const room = currentRoomHandle()
  if (!room) return null
  const visitor = visitorId()
  try {
    const insert = await fetch(`${SUPABASE_URL}/rest/v1/likes`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ room, item_id: itemId, visitor }),
    })
    const rows = await insert.json().catch(() => [])
    const liked = Array.isArray(rows) && rows.length > 0
    if (!liked) await fetch(`${SUPABASE_URL}/rest/v1/likes?room=eq.${escape(room)}&item_id=eq.${escape(itemId)}&visitor=eq.${escape(visitor)}`, { method: 'DELETE', headers })
    const count = await fetch(`${SUPABASE_URL}/rest/v1/likes?room=eq.${escape(room)}&item_id=eq.${escape(itemId)}&select=visitor`, { headers })
      .then((response) => response.json())
      .then((list) => Array.isArray(list) ? list.length : 0)
    return { count, liked }
  } catch { return null }
}
