export type PlaybackSource = 'youtube' | 'file'
export type PlaybackState = { time: number; videoId?: string }

const STORAGE_KEY = 'my-room-playback-v2'
const sessions: Record<string, PlaybackState> = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  } catch { return {} }
})()
let saveTimer: ReturnType<typeof setTimeout> | undefined

export const playbackKey = (handle: string | null, roomId: string, frameId: string, source: PlaybackSource) =>
  [handle ?? 'lobby', roomId, frameId, source].map(encodeURIComponent).join('|')

export const playbackState = (key: string): PlaybackState => sessions[key] ?? { time: 0 }

export const flushPlayback = () => {
  clearTimeout(saveTimer)
  saveTimer = undefined
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)) } catch { /* storage unavailable */ }
}

export const savePlayback = (key: string, patch: Partial<PlaybackState>, immediate = false) => {
  sessions[key] = { ...playbackState(key), ...patch }
  if (immediate) return flushPlayback()
  if (!saveTimer) saveTimer = setTimeout(flushPlayback, 1000)
}

export const seedPlayback = (key: string, state: PlaybackState) => {
  if (sessions[key]) return
  sessions[key] = state
}

export const clearPlayback = (key: string) => {
  delete sessions[key]
  flushPlayback()
}

window.addEventListener('pagehide', flushPlayback)
