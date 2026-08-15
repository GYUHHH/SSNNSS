// The wall player and the panel player are different iframes, so moving between them starts a fresh embed.
// YouTube's iframe API broadcasts currentTime while playing (after a "listening" handshake); we remember the
// last position per frame and hand it to the next embed as its start point, so the switch resumes instead of
// rewinding to zero. Persisted to localStorage so a page reload also picks up where playback left off.
const STORAGE_KEY = 'my-room-video-resume-v1'
const persisted = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') } catch { return null } })()
export const videoResume: Record<string, number> = persisted?.time ?? {}
// which video of a playlist was on screen — YouTube ignores index= on /embed/videoseries,
// so resuming must go through /embed/{videoId}?list= with the actual video id
export const playlistVideoResume: Record<string, string> = persisted?.video ?? {}
let saveTimer: ReturnType<typeof setTimeout> | undefined
const persist = () => {
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = undefined; localStorage.setItem(STORAGE_KEY, JSON.stringify({ time: videoResume, video: playlistVideoResume })) }, 1000)
}
// the live iframe per frame, so playlist controls can reach the player that is actually on the wall
const activeIframes: Record<string, HTMLIFrameElement> = {}

export function trackIframe(iframe: HTMLIFrameElement, frameId: string): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      const currentTime = data?.info?.currentTime
      if (typeof currentTime === 'number') { videoResume[frameId] = currentTime; persist() }
      const currentVideo = data?.info?.videoData?.video_id
      if (typeof currentVideo === 'string' && currentVideo && currentVideo !== 'videoseries') { playlistVideoResume[frameId] = currentVideo; persist() }
    } catch { /* not a youtube message */ }
  }
  const hello = () => iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: frameId }), '*')
  window.addEventListener('message', onMessage)
  iframe.addEventListener('load', hello)
  hello()
  activeIframes[frameId] = iframe
  return () => {
    window.removeEventListener('message', onMessage)
    iframe.removeEventListener('load', hello)
    if (activeIframes[frameId] === iframe) delete activeIframes[frameId]
  }
}

const command = (frameId: string, func: string, args: unknown[] = []) =>
  activeIframes[frameId]?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*')

// a mute=1 embed can come up with its volume at 0, so unmuting alone stays silent — always restore volume too
export const unmuteFrame = (frameId: string) => { command(frameId, 'unMute'); command(frameId, 'setVolume', [70]) }
export const muteFrame = (frameId: string) => command(frameId, 'mute')

// Autoplay always wins: every wall embed starts muted (never blocked), then this lifts the mute for frames the
// user unmuted before. Commands sent before the player is ready are lost, so nothing is finalized up front:
// the ask is repeated on every player message until the player reports back (its first message IS "ready").
// Success needs muted=false AND an audible volume — a mute=1 embed can come up unmuted but at volume 0, which
// gets ONE delayed setVolume retry (a lost volume command is not the same as autoplay blocking). If the browser
// refuses sound without a gesture it pauses the video — we catch that, re-mute so playback continues, flip the
// UI to muted, and retry on the visitor's next click, which grants the missing gesture.
export function requestSound(frameId: string, onBlocked: () => void, onSound?: () => void) {
  const iframe = activeIframes[frameId]
  if (!iframe) return
  let settled = false
  let awaitingGesture = false
  let volumeRetried = false
  let lastAskedAt = 0
  let lastMuted: boolean | undefined
  const ask = () => { lastAskedAt = performance.now(); command(frameId, 'unMute'); command(frameId, 'setVolume', [70]) }
  const cleanup = () => { window.removeEventListener('message', onMessage); window.removeEventListener('pointerdown', onGesture); clearTimeout(timer) }
  const onGesture = () => { if (!settled) { awaitingGesture = false; ask(); command(frameId, 'playVideo') } }
  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || settled) return
    try {
      const info = (typeof event.data === 'string' ? JSON.parse(event.data) : event.data)?.info
      if (typeof info?.muted === 'boolean') lastMuted = info.muted
      if (info?.muted === false && info?.playerState === 1) {
        if (typeof info?.volume === 'number' && info.volume === 0) {
          // unmuted yet silent: the early volume command was lost pre-ready — reapply once, briefly delayed
          if (!volumeRetried) { volumeRetried = true; setTimeout(() => { if (!settled) command(frameId, 'setVolume', [70]) }, 200) }
          return
        }
        settled = true; onSound?.(); cleanup(); return
      }
      if (info?.playerState === 2) {
        // paused right after our unmute ask = the browser vetoed sound; any other pause is the user's — back off
        if (performance.now() - lastAskedAt < 1500 && !awaitingGesture) { awaitingGesture = true; command(frameId, 'mute'); command(frameId, 'playVideo'); onBlocked() }
        else if (performance.now() - lastAskedAt >= 1500) { settled = true; cleanup() }
        return
      }
      if (info?.muted === true && !awaitingGesture) ask()
    } catch { /* not a youtube message */ }
  }
  window.addEventListener('message', onMessage)
  window.addEventListener('pointerdown', onGesture)
  ask()
  // on timeout: if the unmute itself took hold, sound state is whatever it is — only report blocked when it never did
  const timer = setTimeout(() => { if (!settled) { cleanup(); if (!awaitingGesture && lastMuted !== false) onBlocked() } }, 60000)
}

// playlist state control over the iframe API, addressed by frame id
export const playlistControls = (frameId: string) => ({
  loadPlaylist: (playlistId: string) => command(frameId, 'loadPlaylist', [{ listType: 'playlist', list: playlistId }]),
  nextVideo: () => command(frameId, 'nextVideo'),
  previousVideo: () => command(frameId, 'previousVideo'),
  playVideoAt: (index: number) => command(frameId, 'playVideoAt', [index]),
})

// Everything autoplays with sound and loops: a lone video repeats itself (YouTube ignores loop=1 unless the
// same id is also passed as playlist=), and a playlist plays in order then wraps to the top.
const videoEmbedSrc = (videoId: string, start: number, extra: string) =>
  `https://www.youtube.com/embed/${videoId}?enablejsapi=1&loop=1&playlist=${videoId}&start=${start}&${extra}`

const playlistEmbedSrc = (playlistId: string, startVideo: string | undefined, urlIndex: number | undefined, frameId: string, start: number, extra: string) => {
  const current = playlistVideoResume[frameId] ?? startVideo
  if (current) return `https://www.youtube.com/embed/${current}?list=${playlistId}&enablejsapi=1&loop=1&start=${start}&${extra}`
  const at = urlIndex === undefined ? '' : `&index=${urlIndex}`
  return `https://www.youtube.com/embed/videoseries?list=${playlistId}${at}&enablejsapi=1&loop=1&start=${start}&${extra}`
}

export const embedSrc = (stored: string, frameId: string, extra: string) => {
  const start = Math.max(0, Math.floor(videoResume[frameId] ?? 0))
  const params = typeof location === 'undefined' ? extra : `${extra}&origin=${encodeURIComponent(location.origin)}`
  if (!stored.startsWith('pl:')) return videoEmbedSrc(stored, start, params)
  const [playlistId, startVideo, index] = stored.slice(3).split('@')
  return playlistEmbedSrc(playlistId, startVideo || undefined, index ? Number(index) : undefined, frameId, start, params)
}
