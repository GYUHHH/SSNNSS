import { SUPABASE_URL, anonHeaders, authHeaders, isSignedIn, myHandle } from './social'

// Follow graph + the explorer's home/discover split. Every call degrades gracefully while the `follows`
// table does not exist yet on the server: reads resolve to empty, writes report failure, nothing throws.
const escape = encodeURIComponent

export async function fetchFollowing(handle: string): Promise<string[]> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/follows?follower=eq.${escape(handle)}&select=followee&order=created_at.asc`, { headers: anonHeaders })
    const rows = await response.json()
    return response.ok && Array.isArray(rows) ? rows.map((row) => row?.followee).filter((h): h is string => typeof h === 'string' && !!h) : []
  } catch { return [] }
}

export async function isFollowingRoom(followee: string): Promise<boolean> {
  const me = myHandle()
  if (!me || me === followee) return false
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/follows?follower=eq.${escape(me)}&followee=eq.${escape(followee)}&select=followee`, { headers: anonHeaders })
    const rows = await response.json()
    return response.ok && Array.isArray(rows) && rows.length > 0
  } catch { return false }
}

// listeners let the explorer re-pull the home ring the moment a follow changes
const changeListeners = new Set<() => void>()
export const onFollowsChange = (listener: () => void) => { changeListeners.add(listener); return () => { changeListeners.delete(listener) } }

export async function setFollowing(followee: string, follow: boolean): Promise<boolean> {
  const me = myHandle()
  if (!me || me === followee) return false
  try {
    const headers = await authHeaders()
    const response = follow
      ? await fetch(`${SUPABASE_URL}/rest/v1/follows`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ follower: me, followee }) })
      : await fetch(`${SUPABASE_URL}/rest/v1/follows?follower=eq.${escape(me)}&followee=eq.${escape(followee)}`, { method: 'DELETE', headers })
    if (response.ok) changeListeners.forEach((listener) => listener())
    return response.ok
  } catch { return false }
}

// Which set of rooms the explorer ring shows: home = only the rooms I follow, discover = the public directory.
// Module-level rather than store state because the writer (Dock, DOM root) and the reader (explorer, canvas
// root) live on different React roots — same channel pattern as the reaction picker.
export type ExplorerMode = 'home' | 'discover'
// 비로그인 방문자에겐 팔로우 링이 없다 — 공개 디렉터리(지구본)가 기본
let mode: ExplorerMode = isSignedIn() ? 'home' : 'discover'
const modeListeners = new Set<(next: ExplorerMode) => void>()
export const explorerMode = () => mode
export const setExplorerMode = (next: ExplorerMode) => { if (mode !== next) { mode = next; modeListeners.forEach((listener) => listener(next)) } }
export const onExplorerMode = (listener: (next: ExplorerMode) => void) => { modeListeners.add(listener); return () => { modeListeners.delete(listener) } }

// Discover remembers where it was browsed. Home never keeps a visited-room pin: opening the person view always
// returns to the signed-in user's room and shows that user's own follows.
let discoverRoom: string | null = null
export const rememberModeRoom = (mode: ExplorerMode, handle: string) => { if (mode === 'discover') discoverRoom = handle }
export const modeRoom = (mode: ExplorerMode) => mode === 'discover' ? discoverRoom : null

// ---- invite links (mutual follow) ----

// captured once at load: entering a room later rewrites the address and would lose the token
const pendingInvite: string | null = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('invite') : null
export const inviteToken = () => pendingInvite
export const clearInviteFromUrl = () => {
  try { const url = new URL(location.href); url.searchParams.delete('invite'); history.replaceState(null, '', url.pathname + (url.search || '')) } catch { /* fine */ }
}

// one standing invite per owner: reuse the existing token, create it on first ask
export async function myInviteLink(): Promise<string | null> {
  const me = myHandle()
  if (!me) return null
  try {
    const headers = await authHeaders()
    let response = await fetch(`${SUPABASE_URL}/rest/v1/follow_invites?owner=eq.${escape(me)}&select=token`, { headers })
    let rows = await response.json()
    let token = response.ok && Array.isArray(rows) ? rows[0]?.token : null
    if (!token) {
      response = await fetch(`${SUPABASE_URL}/rest/v1/follow_invites`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ owner: me }) })
      rows = await response.json()
      token = response.ok && Array.isArray(rows) ? rows[0]?.token : null
    }
    return typeof token === 'string' && token ? `${location.origin}/${escape(me)}?invite=${token}` : null
  } catch { return null }
}

// the server function validates the token and writes BOTH follow rows — returns the inviter's handle
export async function acceptFollowInvite(token: string): Promise<string | null> {
  try {
    const headers = await authHeaders()
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/accept_follow_invite`, { method: 'POST', headers, body: JSON.stringify({ invite_token: token }) })
    const result = await response.json()
    if (response.ok && typeof result === 'string' && result) {
      changeListeners.forEach((listener) => listener())
      return result
    }
    return null
  } catch { return null }
}

// Who follows a room, newest first — the notification box lists them and the profile card counts them.
export async function fetchFollowers(handle: string): Promise<Array<{ follower: string; createdAt: string }>> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/follows?followee=eq.${escape(handle)}&select=follower,created_at&order=created_at.desc`, { headers: anonHeaders })
    const rows = await response.json()
    return response.ok && Array.isArray(rows)
      ? rows.map((row) => ({ follower: String(row?.follower ?? ''), createdAt: String(row?.created_at ?? '') })).filter((row) => !!row.follower)
      : []
  } catch { return [] }
}

// Liveliest first. Rooms carry the moment they were last saved, so this is "who has been decorating lately" —
// alphabetical order buried active rooms behind whoever happened to register with an early letter.
export async function sortByActivity(handles: string[]): Promise<string[]> {
  if (handles.length < 2) return handles
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=in.(${handles.map(escape).join(',')})&select=handle&order=updated_at.desc`, { headers: anonHeaders })
    const rows = await response.json()
    if (!response.ok || !Array.isArray(rows)) return handles
    const ordered = rows.map((row) => String(row?.handle ?? '')).filter((handle) => handles.includes(handle))
    return [...ordered, ...handles.filter((handle) => !ordered.includes(handle))]
  } catch { return handles }
}
