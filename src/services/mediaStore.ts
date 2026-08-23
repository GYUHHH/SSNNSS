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

export type VideoCrop = { left: number; top: number; right: number; bottom: number }
export type VideoDisplayMeta = { aspect: number; thumbnailCrop: VideoCrop; playerCrop: VideoCrop }
const fullCrop: VideoCrop = { left: 0, top: 0, right: 1, bottom: 1 }
const displayCache: Record<string, Promise<VideoDisplayMeta | null>> = {}
const knownDisplays: Record<string, VideoDisplayMeta | null> = {}

const fittedRect = (outerAspect: number, innerAspect: number): VideoCrop => {
  if (innerAspect > outerAspect) {
    const height = outerAspect / innerAspect
    return { left: 0, right: 1, top: (1 - height) / 2, bottom: (1 + height) / 2 }
  }
  const width = innerAspect / outerAspect
  return { left: (1 - width) / 2, right: (1 + width) / 2, top: 0, bottom: 1 }
}

// YouTube's hq thumbnail is always 4:3. Detect only symmetric neutral edge bands, so a genuinely dark scene is
// not mistaken for letterbox. The returned rectangle is also reused as the preview texture's UV crop.
export function detectVideoContent(data: Uint8ClampedArray, width: number, height: number): VideoCrop {
  const pixel = (x: number, y: number) => { const at = (y * width + x) * 4; return [data[at], data[at + 1], data[at + 2]] as const }
  const neutral = ([r, g, b]: readonly number[]) => Math.max(r, g, b) - Math.min(r, g, b) < 18 && (Math.max(r, g, b) < 42 || Math.min(r, g, b) > 215)
  const similar = (a: readonly number[], b: readonly number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 58
  const scan = (side: 'top' | 'right' | 'bottom' | 'left') => {
    const vertical = side === 'top' || side === 'bottom'
    const limit = Math.floor((vertical ? height : width) * .3)
    const reference = vertical
      ? pixel(Math.floor(width / 2), side === 'top' ? 0 : height - 1)
      : pixel(side === 'left' ? 0 : width - 1, Math.floor(height / 2))
    if (!neutral(reference)) return 0
    let amount = 0
    for (; amount < limit; amount++) {
      let alike = 0, samples = 0
      const length = vertical ? width : height
      for (let along = 0; along < length; along += 4) {
        const value = vertical
          ? pixel(along, side === 'top' ? amount : height - 1 - amount)
          : pixel(side === 'left' ? amount : width - 1 - amount, along)
        if (similar(value, reference)) alike++
        samples++
      }
      if (alike / samples < .56) break
    }
    return amount
  }
  let top = scan('top'), right = scan('right'), bottom = scan('bottom'), left = scan('left')
  // Letterbox is symmetric. Reject a one-sided solid edge instead of shaving legitimate picture content.
  if (Math.abs(top - bottom) > height * .035 || Math.min(top, bottom) < 2) top = bottom = 0
  if (Math.abs(left - right) > width * .035 || Math.min(left, right) < 2) left = right = 0
  return { left: left / width, top: top / height, right: 1 - right / width, bottom: 1 - bottom / height }
}

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => resolve(image)
  image.onerror = () => resolve(null)
  image.src = src
})

export function videoDisplayMeta(id: string): Promise<VideoDisplayMeta | null> {
  return displayCache[id] ??= Promise.all([
    fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`).then((response) => response.ok ? response.json() : null).catch(() => null),
    loadImage(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`),
    loadImage(`https://i.ytimg.com/vi/${id}/oardefault.jpg`),
  ]).then(([oembed, thumbnail, portrait]) => {
    const embedAspect = portrait && portrait.naturalHeight > portrait.naturalWidth
      ? 9 / 16
      : oembed?.width > 0 && oembed?.height > 0 ? oembed.width / oembed.height : null
    if (!thumbnail) return embedAspect ? { aspect: embedAspect, thumbnailCrop: fullCrop, playerCrop: fullCrop } : null
    const expected = fittedRect(thumbnail.naturalWidth / thumbnail.naturalHeight, embedAspect ?? thumbnail.naturalWidth / thumbnail.naturalHeight)
    let detected = expected
    try {
      const canvas = document.createElement('canvas')
      canvas.width = thumbnail.naturalWidth; canvas.height = thumbnail.naturalHeight
      const context = canvas.getContext('2d')
      if (context) {
        context.drawImage(thumbnail, 0, 0)
        detected = detectVideoContent(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
        // If the detector found no bars, oEmbed still tells us which part of YouTube's 4:3 thumbnail contains
        // the encoded picture. This is the common 16:9 case and removes its baked thumbnail bars.
        if (detected.left === 0 && detected.top === 0 && detected.right === 1 && detected.bottom === 1) detected = expected
      }
    } catch { detected = expected }
    const width = Math.max(.01, detected.right - detected.left)
    const height = Math.max(.01, detected.bottom - detected.top)
    const expectedWidth = Math.max(.01, expected.right - expected.left)
    const expectedHeight = Math.max(.01, expected.bottom - expected.top)
    const playerCrop = {
      left: Math.max(0, (detected.left - expected.left) / expectedWidth),
      top: Math.max(0, (detected.top - expected.top) / expectedHeight),
      right: Math.min(1, (detected.right - expected.left) / expectedWidth),
      bottom: Math.min(1, (detected.bottom - expected.top) / expectedHeight),
    }
    return { aspect: (thumbnail.naturalWidth * width) / (thumbnail.naturalHeight * height), thumbnailCrop: detected, playerCrop }
  })
}

export const videoAspect = (id: string) => videoDisplayMeta(id).then((meta) => meta?.aspect ?? null)
export function useVideoDisplayMeta(id: string | undefined): VideoDisplayMeta | null {
  const [result, setResult] = useState<{ id: string; meta: VideoDisplayMeta | null } | null>(
    id && id in knownDisplays ? { id, meta: knownDisplays[id] } : null,
  )
  useEffect(() => {
    if (!id) return
    if (id in knownDisplays) { setResult({ id, meta: knownDisplays[id] }); return }
    let live = true
    void videoDisplayMeta(id).then((value) => { knownDisplays[id] = value; if (live) setResult({ id, meta: value }) })
    return () => { live = false }
  }, [id])
  return id && result?.id === id ? result.meta : null
}

const clipAspects: Record<string, number> = {}
const clipAspectListeners = new Set<() => void>()
export const reportClipAspect = (id: string, aspect: number) => {
  if (!Number.isFinite(aspect) || aspect <= 0 || Math.abs((clipAspects[id] ?? 0) - aspect) < .001) return
  clipAspects[id] = aspect
  clipAspectListeners.forEach((listener) => listener())
}
export function useClipAspectRatio(id: string, enabled: boolean): number | null {
  const [, refresh] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const listener = () => refresh((value) => value + 1)
    clipAspectListeners.add(listener)
    return () => { clipAspectListeners.delete(listener) }
  }, [enabled])
  return enabled ? clipAspects[id] ?? null : null
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
