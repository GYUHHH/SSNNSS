import { SUPABASE_URL, anonHeaders, authHeaders, myHandle } from './social'

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
let mode: ExplorerMode = 'home'
const modeListeners = new Set<(next: ExplorerMode) => void>()
export const explorerMode = () => mode
export const setExplorerMode = (next: ExplorerMode) => { if (mode !== next) { mode = next; modeListeners.forEach((listener) => listener(next)) } }
export const onExplorerMode = (listener: (next: ExplorerMode) => void) => { modeListeners.add(listener); return () => { modeListeners.delete(listener) } }
