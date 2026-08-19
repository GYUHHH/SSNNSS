import { isReadingBundle, isVisiting, readStored, uploadMedia, writeStored } from './social'

// Video clips are far too big for localStorage (a few MB blows the whole quota and would take the room layout
// down with it), so they live in IndexedDB as blobs keyed by the frame's furniture id.
const dbName = 'my-room-media'
const storeName = 'videos'
const clipPlayers = new Map<string, HTMLVideoElement>()
const clipResumeKey = 'my-room-clip-resume-v1'
const clipResume: Record<string, number> = (() => {
  try { return JSON.parse(localStorage.getItem(clipResumeKey) ?? '{}') } catch { return {} }
})()
let clipResumeTimer: ReturnType<typeof setTimeout> | undefined
const flushClipResume = () => {
  clearTimeout(clipResumeTimer)
  clipResumeTimer = undefined
  try { localStorage.setItem(clipResumeKey, JSON.stringify(clipResume)) } catch { /* storage unavailable */ }
}
export const clipSessionKey = (handle: string | null, id: string) => `${handle ?? 'lobby'}:${id}`
export const clipResumeAt = (key: string) => clipResume[key] ?? 0
export const rememberClipAt = (key: string, time: number, immediate = false) => {
  clipResume[key] = time
  if (immediate) return flushClipResume()
  if (!clipResumeTimer) clipResumeTimer = setTimeout(flushClipResume, 1000)
}
window.addEventListener('pagehide', flushClipResume)

export const registerClipPlayer = (id: string, player: HTMLVideoElement) => {
  clipPlayers.set(id, player)
  return () => { if (clipPlayers.get(id) === player) clipPlayers.delete(id) }
}
export const setClipMuted = (id: string, muted: boolean) => {
  const player = clipPlayers.get(id)
  if (!player) return
  player.muted = muted
  if (!muted) { player.volume = .7; void player.play().catch(() => { player.muted = true }) }
}
export const clipIsPlaying = (id: string) => {
  const player = clipPlayers.get(id)
  return !!player && !player.paused && !player.ended
}
export const playClip = (id: string) => { void clipPlayers.get(id)?.play().catch(() => {}) }

const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(dbName, 1)
  request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName) }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
  try {
    const db = await open()
    return await new Promise<T | null>((resolve, reject) => {
      const request = action(db.transaction(storeName, mode).objectStore(storeName))
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error)
    })
  } catch { return null }
}

export const putVideo = (id: string, blob: Blob) => run('readwrite', (store) => store.put(blob, id))
export const getVideo = (id: string) => run<Blob>('readonly', (store) => store.get(id) as IDBRequest<Blob>)
export const deleteVideo = (id: string) => run('readwrite', (store) => store.delete(id))
export const listVideoIds = async () => (await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys())) as string[] | null

// Same silent-failure trap as the music registry: a clip whose upload never landed still plays for the owner from
// IndexedDB and for nobody else. Any local clip with no url in the map is uploaded again on the way back in.
export async function syncPendingClips(): Promise<number> {
  if (isVisiting() || isReadingBundle()) return 0
  const ids = await listVideoIds()
  if (!ids) return 0
  const urls = loadClipUrls()
  let fixed = 0
  for (const id of ids) {
    if (id.startsWith('music-') || urls[id]) continue
    const blob = await run<Blob | undefined>('readonly', (store) => store.get(id))
    if (!blob) continue
    const url = await uploadMedia(`clips/${id}`, blob)
    if (!url) continue
    saveClipUrl(id, url)
    fixed += 1
  }
  return fixed
}

// YouTube links are tiny room data; only their server-backed map is needed here.
const linkKey = 'my-room-video-links-v1'
export function loadVideoLinks(): Record<string, string> {
  try { const raw = readStored(linkKey); return raw ? JSON.parse(raw) as Record<string, string> : {} } catch { return {} }
}
export function saveVideoLinks(links: Record<string, string>) {
  if (isVisiting() || isReadingBundle()) return
  writeStored(linkKey, JSON.stringify(links))
}

// uploaded clips also live in the storage bucket; this map (frame id -> public url) syncs with the room so
// visitors stream what the owner uploaded, while the owner keeps playing the faster local IndexedDB copy
const clipUrlKey = 'my-room-clip-urls-v1'
export function loadClipUrls(): Record<string, string> {
  try { const raw = readStored(clipUrlKey); return raw ? JSON.parse(raw) as Record<string, string> : {} } catch { return {} }
}
export function saveClipUrl(id: string, url: string | null) {
  if (isVisiting() || isReadingBundle()) return
  const urls = loadClipUrls()
  if (url) urls[id] = url; else delete urls[id]
  writeStored(clipUrlKey, JSON.stringify(urls))
}

// accepts watch, youtu.be, shorts and embed forms, or a bare id
export function youTubeId(input: string): string | null {
  const text = input.trim()
  if (/^[\w-]{11}$/.test(text)) return text
  const match = text.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/)
  return match ? match[1] : null
}

// one video, or a playlist optionally entered at a video and/or position; stored compactly as
// "<videoId>" / "pl:<playlistId>" / "pl:<playlistId>@<startVideoId>" / "pl:<playlistId>@<startVideoId>@<index0>"
export type YouTubeTarget = { type: 'video'; videoId: string } | { type: 'playlist'; playlistId: string; videoId?: string; index?: number }
export function youTubeTarget(input: string): YouTubeTarget | null {
  const list = input.trim().match(/[?&]list=([\w-]{10,})/)
  const videoId = youTubeId(input)
  if (list) {
    const urlIndex = input.match(/[?&]index=(\d+)/)
    return { type: 'playlist', playlistId: list[1], videoId: videoId ?? undefined, index: urlIndex ? Math.max(0, Number(urlIndex[1]) - 1) : undefined }
  }
  return videoId ? { type: 'video', videoId } : null
}
export const encodeTarget = (target: YouTubeTarget) => {
  if (target.type === 'video') return target.videoId
  const tail = [target.videoId ?? '', target.index === undefined ? '' : String(target.index)]
  while (tail.length && !tail[tail.length - 1]) tail.pop()
  return ['pl:' + target.playlistId, ...tail].join('@')
}
export const decodeTarget = (stored: string): YouTubeTarget => {
  if (!stored.startsWith('pl:')) return { type: 'video', videoId: stored }
  const [playlistId, videoId, index] = stored.slice(3).split('@')
  return { type: 'playlist', playlistId, videoId: videoId || undefined, index: index ? Number(index) : undefined }
}
