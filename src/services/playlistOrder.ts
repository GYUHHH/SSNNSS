import { isVisiting, readStored, writeStored } from './social'

// Our-site-only play order for YouTube playlists. The playlist on YouTube stays untouched and remains the
// source of truth for WHICH videos exist; the stored order here is the source of truth for the SEQUENCE the
// wall player uses. Orders are keyed by playlist id and synced against the live id list on every playback:
// videos the user already ordered keep their place, new ones append at the end, removed ones drop out.
const STORAGE_KEY = 'my-room-playlist-order-v1'

export const loadOrders = (): Record<string, string[]> => {
  try { const saved = JSON.parse(readStored(STORAGE_KEY) ?? 'null'); if (saved && typeof saved === 'object') return saved } catch { /* storage may be unavailable */ }
  return {}
}

export const saveOrder = (playlistId: string, order: string[]) => {
  if (!isVisiting()) { const orders = loadOrders(); orders[playlistId] = order; writeStored(STORAGE_KEY, JSON.stringify(orders)) }
  listeners.forEach((listener) => listener(playlistId))
}

// panel UI re-renders its list when playback syncs new videos in
const listeners = new Set<(playlistId: string) => void>()
export const onOrderChange = (listener: (playlistId: string) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

// merge the live id list into the stored order: kept videos hold their user-given place,
// new videos append at the end, deleted videos disappear
export const syncOrder = (playlistId: string, liveIds: string[]): string[] => {
  const stored = loadOrders()[playlistId] ?? []
  const kept = stored.filter((id) => liveIds.includes(id))
  const merged = [...kept, ...liveIds.filter((id) => !kept.includes(id))]
  if (merged.length !== stored.length || merged.some((id, index) => stored[index] !== id)) saveOrder(playlistId, merged)
  return merged
}
