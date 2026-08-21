import { createClient } from '@supabase/supabase-js'
import { compressImage } from './imageCompress'

// Supabase-backed social layer: plain fetch against PostgREST, plus the SDK's realtime channel for live updates.
// - The owner's room state lives in the server bundle. An in-memory copy keeps synchronous loaders simple;
//   every change is sent immediately and verified against the saved row.
// - Visiting ?room=<handle> loads that bundle read-only: the intercepted storage reads serve it instead of
//   the visitor's own room, and every save becomes a no-op so nothing local gets overwritten.
// - Likes are one row per (room, item, visitor); toggling inserts or deletes and returns the fresh count.
export const SUPABASE_URL = 'https://pxjavljsalibpnxdrxel.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4amF2bGpzYWxpYnBueGRyeGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjAxNTgsImV4cCI6MjEwMjQzNjE1OH0.quIFdlk11b7F-YIeHO3TsEhS2RzgxDtntqdh2vHyUfE'
export const anonHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
const headers = anonHeaders
// writes carry the logged-in user's token when there is one, so auth.uid() is visible server-side:
// room saves bind ownership to the account, and guestbook/likes rows get an unforgeable user id
export const authHeaders = async (): Promise<Record<string, string>> => {
  try {
    const { data } = await supabaseClient().auth.getSession()
    const token = data.session?.access_token
    return token ? { ...headers, Authorization: `Bearer ${token}` } : headers
  } catch { return headers }
}
const escape = encodeURIComponent

// Room addresses are simple paths: (domain)/(id). GitHub Pages has no SPA fallback, so 404.html bounces
// unknown paths back here as ?p=<id> and the address bar is restored. Legacy ?room= links keep working.
const BASE = import.meta.env.BASE_URL
export const DEFAULT_PROFILE_PHOTO = `${BASE}default-profile.svg`
export const isDefaultProfilePhoto = (photo?: string | null) => !photo || /(^|\/)default-profile\.svg(?:[?#].*)?$/.test(photo)
export const normalizeProfilePhoto = (photo?: string | null) => isDefaultProfilePhoto(photo) ? DEFAULT_PROFILE_PHOTO : photo!
export const defaultProfileData = (handle?: string) => ({
  photo: DEFAULT_PROFILE_PHOTO,
  photoOwner: handle,
  handle,
  total: 0,
  today: 0,
  lastVisit: new Date().toISOString().slice(0, 10),
})
// the room the address bar points at right now — read again after every back/forward
export const pathHandle = (): string | null => {
  if (typeof location === 'undefined') return null
  const segment = location.pathname.startsWith(BASE) ? decodeURIComponent(location.pathname.slice(BASE.length).split('/')[0] ?? '') : ''
  return segment && segment !== 'index.html' ? segment : null
}
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
  return pathHandle()
}
// The base address is always the anonymous default room. A personal room is only read from an explicit handle.
let visitHandle = parseHandle()
let plainRoot = visitHandle === null
export const visitedHandle = () => visitHandle
export const isPlainRoot = () => plainRoot
let visitData: Record<string, string> | null = null
let ownerHandle: string | null = null
let ownerData: Record<string, string> = {}
let ownerPersisted = false
const dirtyKeys = new Set<string>()
const deletedKeys = new Set<string>()
const LEGACY_ROOM_KEYS = ['my-room-layout-v1', 'my-room-slots-v1', 'my-room-video-links-v1', 'my-room-artwork-v1', 'my-room-profile-v1', 'my-room-books-v1', 'my-room-guestbook-v1', 'my-room-playlist-order-v1', 'my-room-interactions-v1', 'my-room-time-v1', 'my-room-music-v1', 'my-room-clip-urls-v1', 'my-room-character-v1', 'my-room-character-look-v1', 'my-room-reactions-seen-v1']
const clearLegacyRoomContent = () => {
  try { for (const key of LEGACY_ROOM_KEYS) localStorage.removeItem(key) } catch { /* storage may be unavailable */ }
}
const roomNavigationListeners = new Set<() => void>()
export const onRoomNavigation = (listener: () => void) => { roomNavigationListeners.add(listener); return () => { roomNavigationListeners.delete(listener) } }
export const isVisiting = () => plainRoot || (visitHandle !== null && visitHandle !== ownHandle())
const resetToPlainRoot = () => { visitHandle = null; plainRoot = true; visitData = null; history.replaceState(null, '', BASE) }
// A signed-out visitor walking back into the default room they started in. The plain root reads as empty —
// readStored returns nothing there — so every store falls back to its defaults, which IS the lobby's look; the
// same listeners fire as for entering any real room, so the whole app swaps in one pass exactly like enterRoom.
export function enterLobby() {
  resetToPlainRoot()
  roomRefreshListeners.forEach((listener) => listener())
  roomNavigationListeners.forEach((listener) => listener())
}
const clearRoomCache = () => {
  ownerHandle = null
  ownerData = {}
  ownerPersisted = false
  dirtyKeys.clear()
  deletedKeys.clear()
  const playbackMemory = new Set(['my-room-video-audio-v1', 'my-room-video-resume-v1', 'my-room-clip-resume-v1'])
  try { for (let index = localStorage.length - 1; index >= 0; index--) { const key = localStorage.key(index); if (key?.startsWith('my-room-') && !playbackMemory.has(key)) localStorage.removeItem(key) } } catch { /* storage may be unavailable */ }
}

// Drawing a neighbour's room needs that room's own storage, not this one's. Every content read in the app funnels
// through readStored, so scoping the source here covers all of them with no reader threaded through call sites.
// The scope is strictly synchronous and cleared in `finally`, so no two rooms can ever interleave.
let readOverride: Record<string, string> | null = null
// every writer checks this: a read for somebody else's room must never fall through to this browser's storage
export const isReadingBundle = () => readOverride !== null
export const readingBundle = <T>(bundle: Record<string, string>, run: () => T): T => {
  const previous = readOverride
  readOverride = bundle
  try { return run() } finally { readOverride = previous }
}
// storage reads for room content route through here: a visit serves the fetched bundle exclusively
export const readStored = (key: string): string | null => {
  if (readOverride) return readOverride[key] ?? null
  if (isVisiting()) return visitData?.[key] ?? null
  return ownerData[key] ?? null
}
export const writeStored = (key: string, value: string) => {
  if (isVisiting() || isReadingBundle() || ownerData[key] === value) return
  ownerData[key] = value
  dirtyKeys.add(key)
  deletedKeys.delete(key)
  schedulePublish()
}
export const removeStored = (key: string) => {
  if (isVisiting() || isReadingBundle() || !(key in ownerData)) return
  delete ownerData[key]
  dirtyKeys.add(key)
  deletedKeys.add(key)
  schedulePublish()
}

export async function initVisit() {
  if (!visitHandle || !isVisiting()) return
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=eq.${escape(visitHandle!)}&select=data`, { headers })
    const rows = await response.json()
    const data = Array.isArray(rows) ? rows[0]?.data : null
    if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) { resetToPlainRoot(); return }
    visitData = data
  } catch { resetToPlainRoot() }
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

const ownHandle = () => ownerHandle
export const currentRoomHandle = () => (isVisiting() ? visitHandle : ownHandle())
// the writer's OWN id, even while visiting someone else's room (reads the local profile directly)
export const myHandle = () => plainRoot ? null : ownHandle()
const profilePhoto = (bundle: Record<string, string>, handle?: string | null) => {
  try {
    const profile = JSON.parse(bundle['my-room-profile-v1'] ?? '{}')
    if (profile?.photoOwner && handle && profile.photoOwner !== handle) return DEFAULT_PROFILE_PHOTO
    return normalizeProfilePhoto(typeof profile?.photo === 'string' ? profile.photo : null)
  } catch { return DEFAULT_PROFILE_PHOTO }
}
export const myProfilePhoto = () => profilePhoto(ownerData, ownerHandle)
// Whether this browser has an account at all. myHandle() reports null at the plain root on purpose, and
// isPlainRoot() only says which address is open — neither answers "is this person signed in", which is what the
// entry buttons need: they must stay up while a signed-out visitor is looking at somebody else's room too.
export const isSignedIn = () => ownHandle() !== null
export const roomPath = (handle: string) => `${BASE}${escape(handle)}`

const KEEPALIVE_LIMIT = 60_000
const sameBundle = (left: Record<string, string>, right: Record<string, string>) => {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key])
}
if (import.meta.env.DEV && (!sameBundle({ a: '1' }, { a: '1' }) || sameBundle({ a: '1' }, { a: '2' }))) throw new Error('Room bundle comparison failed')

let publishQueued = false
let publishTask: Promise<boolean> | null = null
let retryTimer: ReturnType<typeof setTimeout> | undefined
const saveRoomSnapshot = async (leaving: boolean): Promise<boolean> => {
  const handle = ownHandle()
  if (!handle) return false
  const savingKeys = new Set(dirtyKeys)
  const savingValues = new Map([...savingKeys].map((key) => [key, ownerData[key]]))
  const savingDeleted = new Set([...savingKeys].filter((key) => deletedKeys.has(key)))
  if (!savingKeys.size && !leaving) return true
  let data = { ...ownerData }
  try {
    // Another signed-in device may have changed a different key since this copy was loaded. Merge only this
    // request's dirty keys into the newest server bundle so publishing a book cannot roll back a phone edit.
    if (!leaving) {
      const latest = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=eq.${escape(handle)}&select=data&limit=1`, { headers, cache: 'no-store' })
      const rows = await latest.json()
      if (!latest.ok) return false
      if (ownerPersisted && (!Array.isArray(rows) || !rows[0])) return false
      const remote = Array.isArray(rows) && rows[0]?.data && typeof rows[0].data === 'object' ? rows[0].data as Record<string, string> : {}
      data = { ...remote }
      for (const key of savingKeys) {
        if (savingDeleted.has(key)) delete data[key]
        else if (savingValues.get(key) !== undefined) data[key] = savingValues.get(key)!
      }
    }
    const body = JSON.stringify({ p_handle: handle, p_secret: roomSecret(), p_data: data })
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_room`, { method: 'POST', headers: await authHeaders(), body, keepalive: leaving && body.length < KEEPALIVE_LIMIT })
    if (!response.ok) return false
    if (!leaving) {
      const verify = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=eq.${escape(handle)}&select=data&limit=1`, { headers, cache: 'no-store' })
      const rows = await verify.json()
      if (!verify.ok || !sameBundle(data, Array.isArray(rows) ? rows[0]?.data ?? {} : {})) return false
    }
    const currentData = ownerData
    ownerData = data
    ownerPersisted = true
    for (const key of [...dirtyKeys]) {
      const unchanged = savingKeys.has(key)
        && savingDeleted.has(key) === deletedKeys.has(key)
        && savingValues.get(key) === currentData[key]
      if (unchanged) {
        dirtyKeys.delete(key)
        deletedKeys.delete(key)
      } else if (deletedKeys.has(key)) delete ownerData[key]
      else if (currentData[key] !== undefined) ownerData[key] = currentData[key]
    }
    pingRoomUpdate(handle)
    return true
  } catch { return false /* offline — the next change tries again */ }
}

// All room writers share this serialized queue. Changes made during a request run in the next pass, and failed
// writes remain queued for retry, so an older response cannot overwrite a newer edit.
export function publishRoom(leaving = false): Promise<boolean> {
  publishQueued = true
  if (publishTask) return publishTask
  publishTask = (async () => {
    let ok = true
    while (publishQueued) {
      publishQueued = false
      ok = await saveRoomSnapshot(leaving)
      if (!ok) {
        publishQueued = true
        clearTimeout(retryTimer)
        retryTimer = setTimeout(() => { retryTimer = undefined; void publishRoom() }, 1500)
        break
      }
    }
    return ok
  })().finally(() => {
    publishTask = null
    if (publishQueued && !retryTimer) void publishRoom()
  })
  return publishTask
}
export const schedulePublish = () => {
  if (isVisiting()) return
  void publishRoom()
}
const flushPublish = () => {
  if (publishQueued || publishTask) void saveRoomSnapshot(true)
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPublish)
  window.addEventListener('beforeunload', flushPublish)
  window.addEventListener('online', () => { if (dirtyKeys.size) void publishRoom() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPublish() })
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
  ownerHandle = handle
  ownerPersisted = false
  visitHandle = handle
  plainRoot = false
  // A newly claimed account must not inherit the profile left in memory by a previous session. That copied the
  // old owner's photo and visit numbers into the new room even though its handle itself was replaced correctly.
  writeStored('my-room-profile-v1', JSON.stringify(defaultProfileData(handle)))
}

export const myVisitorId = () => visitorId()

// Which reactions the owner has already opened, keyed by item id. It is part of the same server bundle so the
// unread state follows the account instead of this browser.
const SEEN_KEY = 'my-room-reactions-seen-v1'
let seenReactions: Record<string, number> = {}
export const getSeenReactions = () => seenReactions
const persistSeen = () => writeStored(SEEN_KEY, JSON.stringify(seenReactions))
export const markReactionSeen = (id: string, count: number) => { seenReactions[id] = count; persistSeen() }

// uploaded media (music files, video clips) go to the public storage bucket so visitors can stream them
export async function uploadMedia(path: string, file: Blob): Promise<string | null> {
  // a visitor's upload would land in the room owner's bucket — nothing they do may write there
  if (isVisiting()) return null
  try {
    // every image goes through here — diary photos, drawings, anything a future caller adds — so shrinking at this
    // one point covers the lot instead of each call site remembering to. Non-images pass straight through.
    const body = await compressImage(file)
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/media/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': body.type || 'application/octet-stream' },
      body,
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
export type RemoteGuestComment = { id: string; item_id: string; name: string; text: string; visitor: string; user_id?: string | null; created_at: string; photo?: string }

export async function fetchGuestbook(): Promise<RemoteGuestComment[] | null> {
  const room = currentRoomHandle()
  if (!room) return null
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/guestbook?room=eq.${escape(room)}&select=id,item_id,name,text,visitor,user_id,created_at&order=created_at.desc`, { headers })
    const rows = await response.json()
    if (!Array.isArray(rows)) return null
    const handles = [...new Set(rows.map((row) => row?.name).filter((name): name is string => /^[a-z0-9_]{3,20}$/.test(name)))]
    if (!handles.length) return rows
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=in.(${handles.join(',')})&select=handle,data`, { headers })
      const rooms = await response.json()
      if (!response.ok || !Array.isArray(rooms)) return rows
      const photos = new Map<string, string>()
      for (const room of rooms) if (typeof room?.handle === 'string' && room?.data && typeof room.data === 'object') photos.set(room.handle, profilePhoto(room.data, room.handle))
      return rows.map((row) => ({ ...row, photo: photos.get(row.name) }))
    } catch { return rows }
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
    return Array.isArray(rows) && rows[0] ? { ...rows[0], photo: myProfilePhoto() } : null
  } catch { return null }
}

export async function removeRemoteComment(commentId: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_guest_comment`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ p_id: commentId, p_secret: roomSecret(), p_visitor: visitorId() }) })
  } catch { /* offline */ }
}

// Deleting something must take its reactions with it, or likes and comments for an object nobody can see
// linger on the server forever. Likes delete directly; comments go through the RPC, which is what checks that
// the room's owner is the one asking.
export async function purgeReactions(itemIds: string[]) {
  const room = currentRoomHandle()
  if (!room || isVisiting() || itemIds.length === 0) return
  const list = itemIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',')
  try {
    const rows: RemoteGuestComment[] = await fetch(`${SUPABASE_URL}/rest/v1/guestbook?room=eq.${escape(room)}&item_id=in.(${escape(list)})&select=id`, { headers }).then((response) => response.json())
    if (Array.isArray(rows)) for (const row of rows) await removeRemoteComment(row.id)
    await fetch(`${SUPABASE_URL}/rest/v1/likes?room=eq.${escape(room)}&item_id=in.(${escape(list)})`, { method: 'DELETE', headers })
  } catch { /* offline — the rows stay until the next delete */ }
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
  if (!visitHandle || !isVisiting()) return
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
// Closing the card before an id was claimed abandons the signup. Drop the half-finished session so the next
// 로그인/가입하기 press starts at the top instead of dropping straight back into the id step — but do NOT use
// signOut here: it clears every my-room-* key, which would throw away a room decorated before signing up.
export async function cancelSignup() {
  try { await supabaseClient().auth.signOut() } catch { /* already gone */ }
}

export async function signOut() {
  await publishRoom()
  await supabaseClient().auth.signOut()
  clearRoomCache()
}

// Password sign-in is the everyday door: emailed codes are rate-limited per project, so they are used once
// at signup to prove the address and never again.
export async function signInWithPassword(email: string, password: string): Promise<boolean> {
  const { error } = await supabaseClient().auth.signInWithPassword({ email, password })
  return !error
}
// runs while the just-verified session is open, which is what lets the account set its own password
export async function setPassword(password: string): Promise<boolean> {
  const { error } = await supabaseClient().auth.updateUser({ password })
  return !error
}

// Google OAuth: full-page redirect out and back, session persisted by the SDK
export async function signInWithGoogle() {
  await supabaseClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${BASE}` } })
}
export async function googleEnabled(): Promise<boolean> {
  try { return !!(await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers }).then((response) => response.json()))?.external?.google } catch { return false }
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
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?owner=eq.${escape(uid)}&select=handle,data&limit=1`, { headers, cache: 'no-store' })
    const rows = await response.json()
    return Array.isArray(rows) ? rows[0] ?? null : null
  } catch { return null }
}

// One neighbour's bundle, read-only — the explorer draws each surrounding room from its own saved layout. Unlike
// enterRoom this changes nothing: no visit state, no history, no listeners, so it is safe to run for many rooms.
// The in-flight promise is what gets cached, so the prefetch fired at directory load and the request made when a
// room actually fades in are one and the same network call. The cache EXPIRES though: held forever, a neighbour
// was frozen at whatever its first fetch saw — its owner could move across the room and the explorer still showed
// the old spot until a full reload. Fifteen seconds keeps bursts of reveals to one request while staying current.
const BUNDLE_TTL = 15_000
const bundleCache = new Map<string, { at: number; request: Promise<Record<string, string> | null> }>()
export function fetchRoomBundle(handle: string, fresh = false): Promise<Record<string, string> | null> {
  const cached = bundleCache.get(handle)
  if (!fresh && cached && performance.now() - cached.at < BUNDLE_TTL) return cached.request
  const request = (async () => {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=eq.${escape(handle)}&select=data&limit=1`, { headers })
      const rows = await response.json()
      const data = Array.isArray(rows) ? rows[0]?.data : null
      if (response.ok && data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, string>
    } catch { /* fall through */ }
    bundleCache.delete(handle)  // a failure must not be remembered as that room's layout forever
    return null
  })()
  bundleCache.set(handle, { at: performance.now(), request })
  return request
}

// The explorer only needs public room ids up front; each neighbour's bundle is fetched lazily by fetchRoomBundle
// once the zoom-out actually reveals it, so a directory of many rooms costs one request until it is looked at.
export async function fetchRoomDirectory(limit = 37): Promise<string[]> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?select=handle&order=updated_at.desc&limit=${limit}`, { headers })
    const rows = await response.json()
    return response.ok && Array.isArray(rows) ? rows.map((row) => row?.handle).filter((handle): handle is string => typeof handle === 'string' && !!handle) : []
  } catch { return [] }
}

// Changes the visited room without reloading the page. RoomProvider's existing rehydrate hook rereads the new
// bundle, so the Canvas and camera stay mounted while furniture, media and interactions switch underneath it.
// Each room entered becomes its own history entry, so back and forward walk the rooms visited — that is what the
// browser buttons, the phone's system back and the swipe gestures all ride on. `keepEntry` is for the way back:
// the address is already the room being restored, so pushing again would bury the entry the user just left.
export async function enterRoom(handle: string, keepEntry = false): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=eq.${escape(handle)}&select=data&limit=1`, { headers })
    const rows = await response.json()
    const data = Array.isArray(rows) ? rows[0]?.data : null
    if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) return false
    visitHandle = handle
    plainRoot = false
    visitData = data
    const path = roomPath(handle)
    if (keepEntry || location.pathname === path) history.replaceState(null, '', path)
    else history.pushState(null, '', path)
    roomRefreshListeners.forEach((listener) => listener())
    roomNavigationListeners.forEach((listener) => listener())
    return true
  } catch { return false }
}

export async function handleTaken(handle: string): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=eq.${escape(handle)}&select=handle`, { headers })
    const rows = await response.json()
    return Array.isArray(rows) && rows.length > 0
  } catch { return true }
}

export function adoptRoomData(bundle: Record<string, string>, handle?: string) {
  ownerData = { ...bundle }
  ownerPersisted = true
  dirtyKeys.clear()
  deletedKeys.clear()
  if (handle) ownerHandle = handle
  try { seenReactions = JSON.parse(bundle[SEEN_KEY] ?? '{}') ?? {} } catch { seenReactions = {} }
  clearLegacyRoomContent()
}

// Authentication chooses the owner bundle before React mounts. This is what makes a fresh phone read the same
// room immediately: neither a local profile nor a previously visited URL is needed to discover the account room.
export async function initOwnSync() {
  const room = await ownedRoom()
  if (!room) return
  adoptRoomData(room.data, room.handle)
  if (plainRoot) {
    visitHandle = room.handle
    plainRoot = false
    history.replaceState(null, '', roomPath(room.handle))
  }
}

// One event per SETTLED action — sat down, stood up, arrived somewhere — not a stream of the walk itself. The
// walk used to ride a dozen frames a second over the channel, which a visitor saw as a figure sliding around with
// no walk animation; a snap to where the character ended up reads better and costs one message per action instead
// of per frame, which is also the version that survives fifty rooms. Broadcasts hop client-to-client with no
// database write; the immediate room save is still what makes the spot survive a reload.
export type CharacterSettle = { position: [number, number, number]; pose: { state: string; facing: number; y: number } }
let liveChannel: ReturnType<ReturnType<typeof supabaseClient>['channel']> | null = null
export const broadcastCharacter = (settle: CharacterSettle) => {
  void liveChannel?.send({ type: 'broadcast', event: 'character', payload: settle })
}

export function subscribeRealtime(onGuestbook: () => void, onVisits: () => void, onRoomData: () => void, onLikes?: () => void, onCharacter?: (settle: CharacterSettle) => void): () => void {
  const room = currentRoomHandle()
  if (!room) return () => { /* nothing to unsubscribe */ }
  const channel = supabaseClient().channel(`room-${room}`)
    .on('broadcast', { event: 'character' }, ({ payload }) => onCharacter?.(payload as CharacterSettle))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guestbook', filter: `room=eq.${room}` }, onGuestbook)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visits', filter: `room=eq.${room}` }, onVisits)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'likes', filter: `room=eq.${room}` }, () => onLikes?.())
  if (isVisiting()) channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `handle=eq.${room}` }, onRoomData)
  channel.subscribe()
  liveChannel = channel
  return () => { if (liveChannel === channel) liveChannel = null; void channel.unsubscribe() }
}

// ⚠️ 확장 스위치. false(현재): DB 변경 감지(postgres_changes)가 방 데이터 전체(~40KB)를 구독자마다 통째로
// 밀어준다 — 유저가 적을 땐 가장 단순하고 즉각적이다. true(확장): 저장한 쪽이 방 이름 몇 바이트짜리 신호만
// 쏘고, 그 방을 보고 있는 쪽이 REST로 번들을 직접 받아온다 — 페이로드가 수백분의 일로 줄고, 구독자마다
// 필터를 검사하는 postgres_changes 병목도 사라진다. 동시 접속이 수백에 가까워지거나 Supabase 전송량 경고가
// 보이면 이 값 하나만 true로 바꿔 배포하면 된다. 신호는 어느 모드에서든 항상 쏘고 있으므로(아래
// pingRoomUpdate) 구버전 클라이언트와 섞여 있어도 순서 문제 없이 전환된다.
const THIN_ROOM_UPDATES = false

// the always-on signal for the thin path: a successful save announces WHICH room changed, nothing more
let pingChannel: ReturnType<ReturnType<typeof supabaseClient>['channel']> | null = null
const pingRoomUpdate = (handle: string) => {
  void pingChannel?.send({ type: 'broadcast', event: 'room-updated', payload: { handle } })
}

// The explorer's neighbours hear about changes the same way a visited room does — the database pushes the
// updated row, whole bundle included, so a character moved in another browser lands out here about a second
// after that browser's debounced save, with no polling. The 15-second bundle cache stays as the fallback for
// anything the stream misses; each push also refreshes that cache so a later fetch agrees with what was shown.
export function subscribeRoomBundles(handles: string[], onBundle: (handle: string, data: Record<string, string>) => void): () => void {
  if (!handles.length) return () => { /* nothing to unsubscribe */ }
  const wanted = new Set(handles)
  const channel = supabaseClient().channel('explorer-rooms')
  if (THIN_ROOM_UPDATES) {
    // thin path: a few bytes say which room changed, and only viewers actually showing it go fetch the bundle
    channel.on('broadcast', { event: 'room-updated' }, ({ payload }) => {
      const handle = (payload as { handle?: string } | null)?.handle
      if (typeof handle !== 'string' || !wanted.has(handle)) return
      void fetchRoomBundle(handle, true).then((data) => { if (data) onBundle(handle, data) })
    })
  } else {
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `handle=in.(${handles.join(',')})` }, (payload) => {
      const row = payload.new as { handle?: string; data?: Record<string, string> }
      if (!row?.handle || !row.data || typeof row.data !== 'object' || Array.isArray(row.data)) return
      bundleCache.set(row.handle, { at: performance.now(), request: Promise.resolve(row.data) })
      onBundle(row.handle, row.data)
    })
  }
  channel.subscribe()
  pingChannel = channel
  return () => { if (pingChannel === channel) pingChannel = null; void channel.unsubscribe() }
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
