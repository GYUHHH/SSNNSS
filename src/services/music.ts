// The room's music player: one shared <audio> element playing either the built-in track or files the user
// added. Uploaded files live in IndexedDB (same blob store as video clips, key-prefixed), and the playlist
// (ids, titles, order) lives in localStorage. Playback advances down the playlist and wraps.
import { publicBase } from './publicBase'
import { getVideo, putVideo } from './mediaStore'

export type MusicTrack = { id: string; title: string; artist: string }

const REGISTRY_KEY = 'my-room-music-v1'
const BUILTIN: Record<string, string> = { lany: `${publicBase}music/a-star-we-never-named.mp3` }
const SEED: MusicTrack[] = [{ id: 'lany', title: 'A Star We Never Named', artist: 'LANY' }]

export const loadTracks = (): MusicTrack[] => {
  try { const saved = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? 'null'); if (Array.isArray(saved) && saved.length) return saved } catch { /* storage may be unavailable */ }
  return SEED
}
export const saveTracks = (tracks: MusicTrack[]) => {
  try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(tracks)) } catch { /* storage may be unavailable */ }
  notify()
}

// "Artist - Title.mp3" file names split into both fields; anything else is all title
export async function addTrackFile(file: File): Promise<string> {
  const id = `m${Date.now()}${Math.floor(Math.random() * 1000)}`
  await putVideo(`music-${id}`, file)
  const base = file.name.replace(/\.[^.]+$/, '')
  const split = base.split(' - ')
  const track: MusicTrack = split.length > 1 ? { id, title: split.slice(1).join(' - ').trim(), artist: split[0].trim() } : { id, title: base, artist: '' }
  saveTracks([...loadTracks(), track])
  return id
}

let audio: HTMLAudioElement | null = null
let currentId: string | null = null
let volume = 0.7
let muted = false
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
  if (!blob) return null
  return urlCache[id] = URL.createObjectURL(blob)
}

export async function playTrack(id: string) {
  const url = await resolveUrl(id)
  if (!url) return
  const element = ensureAudio()
  if (currentId !== id || element.src !== url) { currentId = id; element.src = url }
  element.volume = muted ? 0 : volume
  void element.play()
  notify()
}

export function stopMusic() {
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
