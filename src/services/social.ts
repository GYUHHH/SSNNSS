import { createClient } from '@supabase/supabase-js'

// Supabase-backed social layer: plain fetch against PostgREST, plus the SDK's realtime channel for live updates.
// - The owner's room state (a bundle of my-room-* localStorage values) is published under their profile
//   handle, guarded by a per-device secret checked inside the save_room SQL function.
// - Visiting ?room=<handle> loads that bundle read-only: the intercepted storage reads serve it instead of
//   the visitor's own room, and every save becomes a no-op so nothing local gets overwritten.
// - Likes are one row per (room, item, visitor); toggling inserts or deletes and returns the fresh count.
const SUPABASE_URL = 'https://pxjavljsalibpnxdrxel.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4amF2bGpzYWxpYnBueGRyeGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjAxNTgsImV4cCI6MjEwMjQzNjE1OH0.quIFdlk11b7F-YIeHO3TsEhS2RzgxDtntqdh2vHyUfE'
const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
// writes carry the logged-in user's token when there is one, so auth.uid() is visible server-side:
// room saves bind ownership to the account, and guestbook/likes rows get an unforgeable user id
const authHeaders = async (): Promise<Record<string, string>> => {
  try {
    const { data } = await supabaseClient().auth.getSession()
    const token = data.session?.access_token
    return token ? { ...headers, Authorization: `Bearer ${token}` } : headers
  } catch { return headers }
}
const escape = encodeURIComponent

const SYNC_KEYS = ['my-room-slots-v1', 'my-room-video-links-v1', 'my-room-artwork-v1', 'my-room-profile-v1', 'my-room-books-v1', 'my-room-guestbook-v1', 'my-room-playlist-order-v1', 'my-room-interactions-v1', 'my-room-time-v1', 'my-room-music-v1', 'my-room-clip-urls-v1']

// Room addresses are simple paths: (domain)/(id). GitHub Pages has no SPA fallback, so 404.html bounces
// unknown paths back here as ?p=<id> and the address bar is restored. Legacy ?room= links keep working.
const BASE = import.meta.env.BASE_URL
const parseHandle = (): string | null => {
  if (typeof location === 'undefined') return null
  const params = new URLSearchParams(location.search)
  const bounced = params.get('p')
  if (bounced !== null) {
    const clean = bounced.replace(/^\/+|\/+$/g, '')
    history.replaceState(null, '', `${BASE}${clean}`)
    return clean || null
  }
  const legacy = params.get('room')
  if (legacy) return legacy
  const segment = location.pathname.startsWith(BASE) ? decodeURIComponent(location.pathname.slice(BASE.length).split('/')[0] ?? '') : ''
  return segment && segment !== 'index.html' ? segment : null
}
export const visitHandle = parseHandle()
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
// the writer's OWN id, even while visiting someone else's room (reads the local profile directly)
export const myHandle = () => ownHandle()
export const roomPath = (handle: string) => `${BASE}${escape(handle)}`

export async function publishRoom() {
  const handle = ownHandle()
  if (!handle) return
  const data: Record<string, string> = {}
  for (const key of SYNC_KEYS) { try { const value = localStorage.getItem(key); if (value) data[key] = value } catch { /* skip */ } }
  if (Object.keys(seenReactions).length) data[SEEN_KEY] = JSON.stringify(seenReactions)
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_room`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ p_handle: handle, p_secret: roomSecret(), p_data: data }) })
  } catch { /* offline — the next change tries again */ }
}

let publishTimer: ReturnType<typeof setTimeout> | undefined
export const schedulePublish = () => {
  if (isVisiting()) return
  clearTimeout(publishTimer)
  publishTimer = setTimeout(() => { void publishRoom() }, 2500)
}

// Anything that leaves a mark — a comment, a like — needs an id behind it. Callers ask here first; without
// an id this opens the signup card instead and the action is dropped.
export const requireHandle = (): boolean => {
  if (ownHandle()) return true
  window.dispatchEvent(new Event('need-id'))
  return false
}
// claiming an id writes the visitor's OWN profile, so it must go through even while inside someone else's
// room — the usual visiting guard is there to protect the host's data, not to block signing up
export const claimHandleLocally = (handle: string) => {
  try {
    const profile = JSON.parse(localStorage.getItem('my-room-profile-v1') ?? '{}')
    localStorage.setItem('my-room-profile-v1', JSON.stringify({ ...profile, handle }))
  } catch { /* storage unavailable */ }
}

export const myVisitorId = () => visitorId()

// which reactions the owner has already opened, keyed by item id — lives ONLY in the server bundle
// (the owner asked for nothing in localStorage), loaded at boot and pushed up with every publish
const SEEN_KEY = 'my-room-reactions-seen-v1'
let seenReactions: Record<string, number> = {}
export const getSeenReactions = () => seenReactions
// publish immediately — a debounce here loses the mark when the owner refreshes right after looking
export const markReactionSeen = (id: string, count: number) => { seenReactions[id] = count; void publishRoom() }

// uploaded media (music files, video clips) go to the public storage bucket so visitors can stream them
export async function uploadMedia(path: string, file: Blob): Promise<string | null> {
  // a visitor's upload would land in the room owner's bucket — nothing they do may write there
  if (isVisiting()) return null
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

// A photo pasted straight into storage as a data URL eats the whole 5MB localStorage budget in one go, and
// once that budget is gone EVERY save silently fails. Photos go to the bucket; only the short URL is kept.
export async function uploadDataUrl(prefix: string, dataUrl: string): Promise<string | null> {
  if (!dataUrl.startsWith('data:')) return dataUrl
  try {
    const blob = await (await fetch(dataUrl)).blob()
    return await uploadMedia(`${prefix}/${crypto.randomUUID()}`, blob)
  } catch { return null }
}

// Guestbook lives on the server as soon as the room has a handle: visitors can write, and deletion is allowed
// to the room owner (device secret) or the comment's own author (visitor id), enforced inside the SQL function.
export type RemoteGuestComment = { id: string; item_id: string; name: string; text: string; visitor: string; user_id?: string | null; created_at: string }

export async function fetchGuestbook(): Promise<RemoteGuestComment[] | null> {
  const room = currentRoomHandle()
  if (!room) return null
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/guestbook?room=eq.${escape(room)}&select=id,item_id,name,text,visitor,user_id,created_at&order=created_at.desc`, { headers })
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
      headers: { ...await authHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify({ room, item_id: itemId, name, text, visitor: visitorId() }),
    })
    const rows = await response.json()
    return Array.isArray(rows) ? rows[0] ?? null : null
  } catch { return null }
}

export async function removeRemoteComment(commentId: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_guest_comment`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ p_id: commentId, p_secret: roomSecret(), p_visitor: visitorId() }) })
  } catch { /* offline */ }
}

// every like in the room, for the reaction badges (self-likes are filtered by the caller)
export async function fetchAllLikes(): Promise<Array<{ item_id: string; visitor: string }> | null> {
  const room = currentRoomHandle()
  if (!room) return null
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/likes?room=eq.${escape(room)}&select=item_id,visitor`, { headers })
    const rows = await response.json()
    return Array.isArray(rows) ? rows : null
  } catch { return null }
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

// Realtime: server-side events push straight into the open page — no refresh needed. Guestbook writes and
// visits refresh their views in place; a room-data update while visiting reloads the visited snapshot and
// remounts the app so the whole room reflects the owner's latest state.
let sharedClient: ReturnType<typeof createClient> | null = null
// one SDK client for auth (magic-link sessions, persisted automatically) and realtime channels
export const supabaseClient = () => (sharedClient ??= createClient(SUPABASE_URL, SUPABASE_KEY))

export async function sendMagicLink(email: string): Promise<boolean> {
  const redirect = `${location.origin}${location.pathname}${location.search}`
  const { error } = await supabaseClient().auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } })
  return !error
}
export async function currentUserEmail(): Promise<string | null> {
  const { data } = await supabaseClient().auth.getSession()
  return data.session?.user.email ?? null
}
export const onAuthChange = (listener: (email: string | null) => void) => {
  const { data } = supabaseClient().auth.onAuthStateChange((_event, session) => listener(session?.user.email ?? null))
  return () => data.subscription.unsubscribe()
}
export async function signOut() { await supabaseClient().auth.signOut() }

// Google OAuth: full-page redirect out and back, session persisted by the SDK
export async function signInWithGoogle() {
  await supabaseClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${BASE}` } })
}

// signup by emailed one-time code (the email template must print {{ .Token }})
export async function sendOtpCode(email: string): Promise<boolean> {
  const { error } = await supabaseClient().auth.signInWithOtp({ email })
  return !error
}
// A first-time address is confirmed with a signup token while a returning one gets a plain email token, and
// the two are not interchangeable — so the code is offered as both rather than guessing which kind it is.
export async function verifyOtpCode(email: string, code: string): Promise<boolean> {
  for (const type of ['email', 'signup'] as const) {
    const { error } = await supabaseClient().auth.verifyOtp({ email, token: code, type })
    if (!error) return true
  }
  return false
}

// Signup finishes by claiming a unique id: the personal room is published under it and bound to the account.
// A fresh device on an existing account adopts the server copy instead of publishing its empty local room.
export async function ownedRoom(): Promise<{ handle: string; data: Record<string, string> } | null> {
  try {
    const { data } = await supabaseClient().auth.getSession()
    const uid = data.session?.user.id
    if (!uid) return null
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?owner=eq.${escape(uid)}&select=handle,data&limit=1`, { headers })
    const rows = await response.json()
    return Array.isArray(rows) ? rows[0] ?? null : null
  } catch { return null }
}

export async function handleTaken(handle: string): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=eq.${escape(handle)}&select=handle`, { headers })
    const rows = await response.json()
    return Array.isArray(rows) && rows.length > 0
  } catch { return true }
}

export function adoptRoomData(bundle: Record<string, string>) {
  try {
    for (const [key, value] of Object.entries(bundle)) {
      if (key === SEEN_KEY) { try { seenReactions = JSON.parse(value) ?? {} } catch { /* keep empty */ } continue }
      if (key.startsWith('my-room-')) localStorage.setItem(key, value)
    }
  } catch { /* storage may be unavailable */ }
}

// The server is the source of truth: the owner's boot pulls the published bundle down BEFORE the app
// initializes, so every session starts from what the server holds. Local storage is just the working cache
// that the debounced publish keeps pushing back up.
export async function initOwnSync() {
  if (isVisiting()) return
  const handle = ownHandle()
  if (!handle) return
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=eq.${escape(handle)}&select=data`, { headers })
    const rows = await response.json()
    const bundle = rows?.[0]?.data
    if (bundle && typeof bundle === 'object') adoptRoomData(bundle)
  } catch { /* offline — start from the local cache */ }
  // the root URL is the plain default site — an owner's room lives at its own address, so land there
  if (visitHandle === null) history.replaceState(null, '', roomPath(handle))
}

export function subscribeRealtime(onGuestbook: () => void, onVisits: () => void, onRoomData: () => void, onLikes?: () => void): () => void {
  const room = currentRoomHandle()
  if (!room) return () => { /* nothing to unsubscribe */ }
  const channel = supabaseClient().channel(`room-${room}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guestbook', filter: `room=eq.${room}` }, onGuestbook)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visits', filter: `room=eq.${room}` }, onVisits)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'likes', filter: `room=eq.${room}` }, () => onLikes?.())
  if (isVisiting()) channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `handle=eq.${room}` }, onRoomData)
  channel.subscribe()
  return () => { void channel.unsubscribe() }
}

// visiting: pull the fresh bundle, then let main remount the app so every piece re-initializes from it
const roomRefreshListeners = new Set<() => void>()
export const onRoomRefresh = (listener: () => void) => { roomRefreshListeners.add(listener); return () => { roomRefreshListeners.delete(listener) } }
// A remount is only worth it when the ROOM itself changed. The guestbook rides its own live channel, so a
// visitor writing a comment used to trigger the owner's republish and bounce the whole app a few seconds
// later — that looked exactly like a spontaneous page refresh. Guestbook-only changes are ignored here.
const withoutGuestbook = (bundle: Record<string, string> | null) => {
  const { 'my-room-guestbook-v1': _guestbook, ...rest } = bundle ?? {}
  return JSON.stringify(rest)
}
export async function refreshVisit() {
  const before = withoutGuestbook(visitData)
  await initVisit()
  if (withoutGuestbook(visitData) === before) return
  roomRefreshListeners.forEach((listener) => listener())
}

export async function toggleLike(itemId: string): Promise<{ count: number; liked: boolean } | null> {
  const room = currentRoomHandle()
  if (!room) return null
  const visitor = visitorId()
  try {
    const insert = await fetch(`${SUPABASE_URL}/rest/v1/likes`, {
      method: 'POST',
      headers: { ...await authHeaders(), Prefer: 'resolution=ignore-duplicates,return=representation' },
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
