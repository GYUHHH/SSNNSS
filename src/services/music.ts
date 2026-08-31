// The room's music player: one shared <audio> element playing either the built-in track or files the user
// added. Uploaded files live in IndexedDB (same blob store as video clips, key-prefixed), and the playlist
// (ids, titles, order) lives in the room's server bundle. Playback advances down the playlist and wraps.
import { publicBase } from './publicBase'
import { deleteVideo, getVideo, putVideo } from './mediaStore'
import { currentRoomHandle, deleteMedia, isVisiting, readStored, uploadMedia, writeStored } from './social'

export type MusicTrack = { id: string; title: string; artist: string; url?: string; duration?: number }
export type SpotifyItem = { id: string; type: 'track' | 'album' | 'playlist' | 'artist' | 'episode' | 'show' }
export type MusicSource = 'mp3' | 'spotify'

const REGISTRY_KEY = 'my-room-music-v1'
const SPOTIFY_KEY = 'my-room-spotify-v1'
const SOURCE_KEY = 'my-room-music-source-v1'
const RESUME_KEY = 'my-room-music-resume-v1'
const BUILTIN: Record<string, string> = { lany: `${publicBase}music/a-star-we-never-named.mp3` }
const SEED: MusicTrack[] = [{ id: 'lany', title: 'A Star We Never Named', artist: '', duration: 159 }]

export const loadTracks = (): MusicTrack[] => {
  try { const saved = JSON.parse(readStored(REGISTRY_KEY) ?? 'null'); if (Array.isArray(saved)) return saved } catch { /* storage may be unavailable */ }
  return SEED
}
export const saveTracks = (tracks: MusicTrack[]) => {
  if (!isVisiting()) writeStored(REGISTRY_KEY, JSON.stringify(tracks))
  notify()
}

export const loadMusicSource = (): MusicSource => readStored(SOURCE_KEY) === 'spotify' ? 'spotify' : 'mp3'
export const saveMusicSource = (source: MusicSource) => { if (isVisiting()) return; writeStored(SOURCE_KEY, source); notify() }
export const loadSpotifyItems = (): SpotifyItem[] => {
  try { const saved = JSON.parse(readStored(SPOTIFY_KEY) ?? '[]'); if (Array.isArray(saved)) return saved.filter((item): item is SpotifyItem => !!item?.id && ['track', 'album', 'playlist', 'artist', 'episode', 'show'].includes(item.type)) } catch { /* malformed room data */ }
  return []
}
export const parseSpotifyUrl = (value: string): SpotifyItem | null => {
  const uri = value.trim().match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]+)$/)
  if (uri) return { type: uri[1] as SpotifyItem['type'], id: uri[2] }
  try {
    const url = new URL(value.trim())
    if (url.hostname !== 'open.spotify.com') return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0]?.startsWith('intl-')) parts.shift()
    const type = parts[0] as SpotifyItem['type']; const id = parts[1]
    return id && ['track', 'album', 'playlist', 'artist', 'episode', 'show'].includes(type) ? { type, id } : null
  } catch { return null }
}
export const spotifyEmbedUrl = ({ type, id }: SpotifyItem) => `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`
export const addSpotifyItem = (value: string): SpotifyItem | null => {
  if (isVisiting()) return null
  const item = parseSpotifyUrl(value); if (!item) return null
  const items = loadSpotifyItems()
  if (!items.some((entry) => entry.type === item.type && entry.id === item.id)) writeStored(SPOTIFY_KEY, JSON.stringify([...items, item]))
  notify(); return item
}
export const removeSpotifyItem = (id: string) => {
  if (isVisiting()) return
  writeStored(SPOTIFY_KEY, JSON.stringify(loadSpotifyItems().filter((item) => item.id !== id)))
  notify()
}

// "Artist - Title.mp3" file names split into both fields; anything else is all title
const fileDuration = (file: Blob) => new Promise<number | undefined>((resolve) => {
  const url = URL.createObjectURL(file); const probe = new Audio(); probe.preload = 'metadata'
  const done = (value?: number) => { URL.revokeObjectURL(url); probe.removeAttribute('src'); resolve(value) }
  probe.onloadedmetadata = () => done(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : undefined)
  probe.onerror = () => done(); probe.src = url
})
export async function addTrackFile(file: File): Promise<string> {
  if (isVisiting()) return ''
  const id = `m${Date.now()}${Math.floor(Math.random() * 1000)}`
  await putVideo(`music-${id}`, file)
  const base = file.name.replace(/\.[^.]+$/, '')
  const split = base.split(' - ')
  const duration = await fileDuration(file)
  const track: MusicTrack = split.length > 1 ? { id, title: split.slice(1).join(' - ').trim(), artist: split[0].trim(), duration } : { id, title: base, artist: '', duration }
  saveTracks([...loadTracks(), track])
  // the storage copy lets visitors stream the song; the local copy stays the owner's fast path
  void uploadMedia(`music/${id}`, file).then((url) => {
    if (url) saveTracks(loadTracks().map((entry) => entry.id === id ? { ...entry, url } : entry))
  })
  return id
}

export function removeTrack(id: string): string | null {
  if (isVisiting()) return null
  const tracks = loadTracks()
  const index = tracks.findIndex((track) => track.id === id)
  if (index < 0) return currentId
  const removed = tracks[index]
  const remaining = tracks.filter((track) => track.id !== id)
  saveTracks(remaining)
  void deleteVideo(`music-${id}`)
  deleteMedia(removed.url)
  if (urlCache[id]?.startsWith('blob:')) URL.revokeObjectURL(urlCache[id])
  delete urlCache[id]
  return remaining[Math.min(index, remaining.length - 1)]?.id ?? null
}

// A track whose upload never landed plays for the owner — the local blob is right there — and for nobody else.
// The failure is silent by design (uploadMedia returns null and the caller shrugs), so it is caught on the way back
// in instead: any track still missing its url that still has its local copy is uploaded again and the registry
// patched. Built-ins have no url because they ship with the site, so they are skipped.
export async function syncPendingTracks(): Promise<number> {
  if (isVisiting()) return 0
  let fixed = 0
  for (const track of loadTracks()) {
    if (track.url || BUILTIN[track.id]) continue
    const blob = await getVideo(`music-${track.id}`)
    if (!blob) continue
    const url = await uploadMedia(`music/${track.id}`, blob)
    if (!url) continue
    saveTracks(loadTracks().map((entry) => entry.id === track.id ? { ...entry, url } : entry))
    fixed += 1
  }
  return fixed
}

let audio: HTMLAudioElement | null = null
let currentId: string | null = null
let currentScope: string | null = null
let pendingSeek = 0
let lastRememberedAt = 0
let volume = 0.7
let muted = false
let pendingPlay: string | null = null
let retryAttached = false
let playbackEpoch = 0
const urlCache: Record<string, string> = {}
const listeners = new Set<() => void>()
const trackChangeListeners = new Set<(id: string | null) => void>()
const notify = () => listeners.forEach((listener) => listener())
export const onMusicUpdate = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const onTrackChange = (listener: (id: string | null) => void) => { trackChangeListeners.add(listener); return () => { trackChangeListeners.delete(listener) } }

type MusicResume = Record<string, { id: string; time: number }>
const scope = () => currentRoomHandle() ?? 'lobby'
const loadResume = (): MusicResume => {
  try { const saved = JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}'); return saved && typeof saved === 'object' ? saved : {} } catch { return {} }
}
const rememberCurrent = (force = false) => {
  if (!audio || !currentId || !currentScope || !Number.isFinite(audio.currentTime)) return
  const now = performance.now()
  if (!force && now - lastRememberedAt < 1000) return
  lastRememberedAt = now
  try { localStorage.setItem(RESUME_KEY, JSON.stringify({ ...loadResume(), [currentScope]: { id: currentId, time: audio.currentTime } })) } catch { /* storage may be unavailable */ }
}
export const preferredMusicTrack = (tracks = loadTracks(), source = loadMusicSource()): string | null => {
  if (source === 'spotify') return null
  const saved = loadResume()[scope()]
  return tracks.some((track) => track.id === saved?.id) ? saved.id : tracks[0]?.id ?? null
}

const ensureAudio = () => {
  if (audio) return audio
  audio = new Audio()
  audio.volume = volume
  const bubble = () => { rememberCurrent(); notify() }
  audio.addEventListener('timeupdate', bubble)
  audio.addEventListener('durationchange', bubble)
  audio.addEventListener('loadedmetadata', () => {
    const duration = audio?.duration
    if (!audio || !currentId || !duration || !Number.isFinite(duration)) return
    if (pendingSeek > 0) audio.currentTime = Math.min(pendingSeek, Math.max(0, duration - .25))
    pendingSeek = 0
    if (isVisiting()) return
    const tracks = loadTracks(); const track = tracks.find((entry) => entry.id === currentId)
    if (track && (!track.duration || Math.abs(track.duration - duration) > 1)) saveTracks(tracks.map((entry) => entry.id === currentId ? { ...entry, duration } : entry))
  })
  audio.addEventListener('play', bubble)
  audio.addEventListener('pause', bubble)
  audio.addEventListener('ended', () => {
    const tracks = loadTracks()
    const at = tracks.findIndex((track) => track.id === currentId)
    const next = tracks[(at + 1) % tracks.length]
    if (next) { void playTrack(next.id); trackChangeListeners.forEach((listener) => listener(next.id)) }
  })
  window.addEventListener('pagehide', () => rememberCurrent(true))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') rememberCurrent(true) })
  return audio
}

const resolveUrl = async (id: string): Promise<string | null> => {
  if (BUILTIN[id]) return BUILTIN[id]
  if (urlCache[id]) return urlCache[id]
  const blob = await getVideo(`music-${id}`)
  if (blob) return urlCache[id] = URL.createObjectURL(blob)
  // no local copy — stream the uploaded file from storage (visitors, other devices)
  return loadTracks().find((track) => track.id === id)?.url ?? null
}

export async function playTrack(id: string) {
  const requestEpoch = ++playbackEpoch
  const url = await resolveUrl(id)
  if (!url || requestEpoch !== playbackEpoch) return
  const element = ensureAudio()
  const nextScope = scope()
  const sameSource = element.src === new URL(url, location.href).href
  if (currentId !== id || currentScope !== nextScope || !sameSource) {
    rememberCurrent(true)
    const saved = loadResume()[nextScope]
    currentId = id
    currentScope = nextScope
    pendingSeek = saved?.id === id && Number.isFinite(saved.time) ? Math.max(0, saved.time) : 0
    if (sameSource && element.readyState >= 1 && Number.isFinite(element.duration)) {
      element.currentTime = Math.min(pendingSeek, Math.max(0, element.duration - .25))
      pendingSeek = 0
    } else element.src = url
  }
  element.volume = muted ? 0 : volume
  try { await element.play(); pendingPlay = null }
  catch {
    pendingPlay = id
    if (!retryAttached) {
      retryAttached = true
      window.addEventListener('pointerdown', () => {
        retryAttached = false
        const retry = pendingPlay
        if (retry) void playTrack(retry)
      }, { once: true, capture: true })
    }
  }
  notify()
}

export function stopMusic() {
  playbackEpoch += 1
  rememberCurrent(true)
  pendingPlay = null
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
  currentId = null
  notify()
}

export function pauseMusic() { rememberCurrent(true); audio?.pause() }
export function resumeMusic() { void audio?.play() }
export function seekMusic(seconds: number) { if (audio && Number.isFinite(seconds)) { audio.currentTime = seconds; rememberCurrent(true); notify() } }
export function setMusicVolume(next: number) {
  volume = Math.min(1, Math.max(0, next))
  if (audio && !muted) audio.volume = volume
  notify()
}
export function toggleMusicMute() {
  muted = !muted
  if (audio) audio.volume = muted ? 0 : volume
  notify()
}

export const musicState = () => ({
  id: currentId,
  paused: !audio || audio.paused,
  time: audio?.currentTime ?? 0,
  duration: Number.isFinite(audio?.duration) ? audio?.duration ?? 0 : 0,
  muted,
  volume,
})
