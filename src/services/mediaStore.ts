// Video clips are far too big for localStorage (a few MB blows the whole quota and would take the room layout
// down with it), so they live in IndexedDB as blobs keyed by the frame's furniture id.
const dbName = 'my-room-media'
const storeName = 'videos'

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

// youtube links are tiny, so they stay in localStorage next to the rest of the room
const linkKey = 'my-room-video-links-v1'
export function loadVideoLinks(): Record<string, string> {
  try { const raw = localStorage.getItem(linkKey); return raw ? JSON.parse(raw) as Record<string, string> : {} } catch { return {} }
}
export function saveVideoLinks(links: Record<string, string>) {
  try { localStorage.setItem(linkKey, JSON.stringify(links)) } catch { /* unavailable */ }
}

// accepts watch, youtu.be, shorts and embed forms, or a bare id
export function youTubeId(input: string): string | null {
  const text = input.trim()
  if (/^[\w-]{11}$/.test(text)) return text
  const match = text.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/)
  return match ? match[1] : null
}

// a link is either one video or a whole playlist; stored compactly as "<videoId>" / "pl:<playlistId>"
export type YouTubeTarget = { type: 'video'; videoId: string } | { type: 'playlist'; playlistId: string }
export function youTubeTarget(input: string): YouTubeTarget | null {
  const list = input.trim().match(/[?&]list=([\w-]{10,})/)
  if (list) return { type: 'playlist', playlistId: list[1] }
  const videoId = youTubeId(input)
  return videoId ? { type: 'video', videoId } : null
}
export const encodeTarget = (target: YouTubeTarget) => target.type === 'playlist' ? `pl:${target.playlistId}` : target.videoId
export const decodeTarget = (stored: string): YouTubeTarget => stored.startsWith('pl:') ? { type: 'playlist', playlistId: stored.slice(3) } : { type: 'video', videoId: stored }
