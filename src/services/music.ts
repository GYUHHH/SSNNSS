// tiny jukebox for the music player — real audio files (public/music/*) plus synthesized loops as extras.
// ponytail: setInterval scheduling is fine for one-note-at-a-time synth patterns
type Pattern = { notes: number[]; tempo: number; type: OscillatorType; volume: number }
const patterns: Record<string, Pattern> = {
  calm: { notes: [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 659.25, 440], tempo: 520, type: 'sine', volume: 0.1 },
  lofi: { notes: [261.63, 311.13, 392, 349.23, 261.63, 233.08, 311.13, 196], tempo: 640, type: 'triangle', volume: 0.12 },
  bright: { notes: [392, 440, 523.25, 587.33, 659.25, 587.33, 523.25, 440], tempo: 360, type: 'triangle', volume: 0.1 },
}
const files: Record<string, string> = {
  lany: '/music/a-star-we-never-named.wav',
}
export const trackList = [
  { id: 'lany', label: 'A Star We Never Named' },
  { id: 'calm', label: '잔잔한 오후' },
  { id: 'lofi', label: '로파이 비트' },
  { id: 'bright', label: '산뜻한 아침' },
]
let context: AudioContext | null = null
let timer = 0
let audio: HTMLAudioElement | null = null
let volume = 0.7

export function setMusicVolume(next: number) {
  volume = Math.min(1, Math.max(0, next))
  if (audio) audio.volume = volume
}
export function playTrack(id: string) {
  stopMusic()
  const file = files[id]
  if (file) {
    audio = new Audio(file)
    audio.loop = true
    audio.volume = volume
    void audio.play()
    return
  }
  const pattern = patterns[id]
  if (!pattern) return
  context ??= new AudioContext()
  void context.resume()
  let index = 0
  const step = () => {
    if (!context) return
    const now = context.currentTime
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = pattern.type
    oscillator.frequency.value = pattern.notes[index++ % pattern.notes.length]
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(pattern.volume * volume * 1.4, now + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (pattern.tempo / 1000) * 0.9)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + pattern.tempo / 1000)
  }
  step()
  timer = window.setInterval(step, pattern.tempo)
}

export function stopMusic() {
  if (timer) window.clearInterval(timer)
  timer = 0
  if (audio) { audio.pause(); audio = null }
}
