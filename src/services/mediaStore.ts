import { useEffect, useState } from 'react'
import { isReadingBundle, isVisiting, readStored, uploadMedia, writeStored } from './social'
import { onPlaylistNowPlaying, playlistNowPlaying, playlistVideoResume } from './ytResume'

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
// See ytResume: keyed by frame id alone; room-scoped keys from earlier releases remain readable.
export const clipResumeAt = (key: string) => clipResume[key] ?? Object.entries(clipResume).find(([saved]) => saved.endsWith(`:${key}`))?.[1] ?? 0
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

// The true aspect of a YouTube video, found without any API key: shorts are detected by their portrait "oar"
// thumbnail (it 404s for normal videos), and everything else is measured by reading the letterbox bars inside
// the 480x360 hqdefault thumbnail (pure-black rows/columns around the content). The measured ratio is only
// trusted when it lands near a common aspect — anything odd resolves to null so the caller skips cropping.
const aspectCache: Record<string, Promise<number | null>> = {}
export function videoAspect(id: string): Promise<number | null> {
  // 1차: oEmbed의 width/height — 실제 영상 비율을 그대로 준다(4:3은 200x150, 16:9는 200x113로 실측 확인).
  // 예전 주석의 "oEmbed는 전부 16:9" 전제는 틀렸었다. 썸네일 픽셀 측정은 레터박스가 순흑이 아니면
  // 흔들려서(실측 1.486 같은 오값) 폴백으로만 남긴다.
  return aspectCache[id] ??= fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`)
    .then((response) => response.ok ? response.json() : null)
    .then((meta) => (meta && meta.width > 0 && meta.height > 0 ? meta.width / meta.height : thumbnailAspect(id)))
    .catch(() => thumbnailAspect(id))
}
function thumbnailAspect(id: string): Promise<number | null> {
  return new Promise((resolve) => {
    const oar = new Image()
    // 과거엔 일반 영상이면 404였지만 지금은 120x90 플레이스홀더가 로드된다 — 세로 비율일 때만 쇼츠로 인정
    oar.onload = () => { if (oar.naturalHeight > oar.naturalWidth) resolve(9 / 16); else measure() }
    oar.onerror = () => measure()
    const measure = () => {
      const thumb = new Image()
      thumb.crossOrigin = 'anonymous'
      thumb.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = thumb.naturalWidth; canvas.height = thumb.naturalHeight
          const context = canvas.getContext('2d')
          if (!context) return resolve(null)
          context.drawImage(thumb, 0, 0)
          const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
          const dark = (x: number, y: number) => { const at = (y * width + x) * 4; return data[at] < 24 && data[at + 1] < 24 && data[at + 2] < 24 }
          const rowDark = (y: number) => { for (let x = 0; x < width; x += 6) if (!dark(x, y)) return false; return true }
          const colDark = (x: number) => { for (let y = 0; y < height; y += 6) if (!dark(x, y)) return false; return true }
          let top = 0; while (top < height / 3 && rowDark(top)) top++
          let bottom = 0; while (bottom < height / 3 && rowDark(height - 1 - bottom)) bottom++
          let left = 0; while (left < width / 3 && colDark(left)) left++
          let right = 0; while (right < width / 3 && colDark(width - 1 - right)) right++
          const contentWidth = width - left - right, contentHeight = height - top - bottom
          if (contentWidth <= 0 || contentHeight <= 0) return resolve(null)
          const measured = contentWidth / contentHeight
          const known = [16 / 9, 4 / 3, 1, 9 / 16].find((value) => Math.abs(measured - value) / value < .08)
          resolve(known ?? null)
        } catch { resolve(null) }
      }
      thumb.onerror = () => resolve(null)
      thumb.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    }
    oar.src = `https://i.ytimg.com/vi/${id}/oardefault.jpg`
  })
}

// videoAspect의 결과를 동기적으로 재사용하는 훅 — 3D 화면(InventoryFurniture)과 DOM 영상(WallVideoLayer)이
// 같은 값을 보고 같은 크기로 맞아떨어진다. 아직 모르는 비율은 null(=액자 비율 그대로).
const knownAspects: Record<string, number | null> = {}
export function useVideoAspectRatio(id: string | undefined): number | null {
  const [aspect, setAspect] = useState<number | null>(id ? knownAspects[id] ?? null : null)
  useEffect(() => {
    if (!id) { setAspect(null); return }
    if (id in knownAspects) { setAspect(knownAspects[id]); return }
    let live = true
    void videoAspect(id).then((value) => { knownAspects[id] = value; if (live) setAspect(value) })
    return () => { live = false }
  }, [id])
  return id ? aspect : null
}
export const fitToVideo = (width: number, height: number, aspect: number | null): [number, number] => {
  if (!aspect) return [width, height]
  const fitted = Math.min(width, height * aspect)
  return [fitted, fitted / aspect]
}

// 액자에 걸린 링크에서 "비율을 재야 할 실제 영상 id"를 리액티브하게 — 플레이리스트는 지금 재생 중인 곡을
// 따라가고(트랙 전환 시 재렌더), 일반 링크는 그 자체다.
export function useFrameVideoId(frameId: string, link: string | undefined): string | undefined {
  const [, bump] = useState(0)
  useEffect(() => (link?.startsWith('pl:') ? onPlaylistNowPlaying(() => bump((n) => n + 1)) : undefined), [frameId, link])
  if (!link) return undefined
  if (!link.startsWith('pl:')) return link
  return playlistNowPlaying[frameId] ?? playlistVideoResume[frameId] ?? link.split('@')[1]
}
