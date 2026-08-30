// The room's music player: one shared <audio> element playing either the built-in track or files the user
// added. Uploaded files live in IndexedDB (same blob store as video clips, key-prefixed), and the playlist
// (ids, titles, order) lives in the room's server bundle. Playback advances down the playlist and wraps.
import { publicBase } from './publicBase'
import { deleteVideo, getVideo, putVideo } from './mediaStore'
import { deleteMedia, isVisiting, readStored, uploadMedia, writeStored } from './social'

export type MusicTrack = { id: string; title: string; artist: string; url?: string }

const REGISTRY_KEY = 'my-room-music-v1'
const BUILTIN: Record<string, string> = { lany: `${publicBase}music/a-star-we-never-named.mp3` }
const SEED: MusicTrack[] = [{ id: 'lany', title: 'A Star We Never Named', artist: '' }]

export const loadTracks = (): MusicTrack[] => {
  try { const saved = JSON.parse(readStored(REGISTRY_KEY) ?? 'null'); if (Array.isArray(saved)) return saved } catch { /* storage may be unavailable */ }
  return SEED
}
export const saveTracks = (tracks: MusicTrack[]) => {
  if (!isVisiting()) writeStored(REGISTRY_KEY, JSON.stringify(tracks))
  notify()
}

// "Artist - Title.mp3" file names split into both fields; anything else is all title
export async function addTrackFile(file: File): Promise<string> {
  if (isVisiting()) return ''
  const id = `m${Date.now()}${Math.floor(Math.random() * 1000)}`
  await putVideo(`music-${id}`, file)
  const base = file.name.replace(/\.[^.]+$/, '')
  const split = base.split(' - ')
  const track: MusicTrack = split.length > 1 ? { id, title: split.slice(1).join(' - ').trim(), artist: split[0].trim() } : { id, title: base, artist: '' }
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
let volume = 0.7
let muted = false
let pendingPlay: string | null = null
let retryAttached = false
const urlCache: Record<string, string> = {}
const listeners = new Set<() => void>()
const trackChangeListeners = new Set<(id: string | null) => void>()
const notify = () => listeners.forEach((listener) => listener())
export const onMusicUpdate = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const onTrackChange = (listener: (id: string | null) => void) => { trackChangeListeners.add(listener); return () => { trackChangeListeners.delete(listener) } }

const ensureAudio = () => {
  if (audio) return audio
  audio = new Audio()
  audio.volume = volume
  const bubble = () => notify()
  audio.addEventListener('timeupdate', bubble)
  audio.addEventListener('durationchange', bubble)
  audio.addEventListener('play', bubble)
  audio.addEventListener('pause', bubble)
  audio.addEventListener('ended', () => {
    const tracks = loadTracks()
    const at = tracks.findIndex((track) => track.id === currentId)
    const next = tracks[(at + 1) % tracks.length]
    if (next) { void playTrack(next.id); trackChangeListeners.forEach((listener) => listener(next.id)) }
  })
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
  const url = await resolveUrl(id)
  if (!url) return
  const element = ensureAudio()
  if (currentId !== id || element.src !== url) { currentId = id; element.src = url }
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
  pendingPlay = null
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
  currentId = null
  notify()
}

export function pauseMusic() { audio?.pause() }
export function resumeMusic() { void audio?.play() }
export function seekMusic(seconds: number) { if (audio && Number.isFinite(seconds)) { audio.currentTime = seconds; notify() } }
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
