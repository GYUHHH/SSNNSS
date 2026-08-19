import { loadOrders, onOrderChange, syncOrder } from './playlistOrder'

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
// frame ids are timestamp-based and unique across rooms and owners, so the id alone is the key —
// prefixing the handle orphaned every previously saved position whenever the handle differed
export const videoResumeKey = (_handle: string | null, frameId: string) => frameId
// last known player state per frame (1 playing, 2 paused, 3 buffering) — read when the tab hides so a
// visibility return restores exactly what was happening, instead of blindly commanding playback
export const framePlayerStates: Record<string, number> = {}
let saveTimer: ReturnType<typeof setTimeout> | undefined
const flushResume = () => {
  clearTimeout(saveTimer)
  saveTimer = undefined
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ time: videoResume, video: playlistVideoResume }))
}
const persist = () => {
  if (saveTimer) return
  saveTimer = setTimeout(flushResume, 1000)
}
window.addEventListener('pagehide', flushResume)
// Videos the player has actually refused. YouTube reports this over the same postMessage channel as an onError:
// 101 and 150 are "the owner disabled playback outside YouTube", 100 is deleted or private, 2 is a malformed id
// and 5 is a player failure. All of them mean the same thing here — this one cannot be shown on a wall.
// Kept in memory only: an owner who fixes a video should not have to clear a stale warning, and a reload re-tests.
const blockedVideos = new Set<string>()
export const isBlockedVideo = (videoId: string) => blockedVideos.has(videoId)
const blockedListeners = new Set<() => void>()
export const onBlockedVideos = (listener: () => void) => { blockedListeners.add(listener); return () => { blockedListeners.delete(listener) } }
// Which videos have failed since the last one that actually played, per frame. Skipping stops the moment a video
// fails twice in the same run: that means the playlist has been walked all the way round and nothing in it plays,
// so the player is left sitting on YouTube's own "cannot be played" screen, which the visitor sees too.
const skipRun: Record<string, Set<string>> = {}

// the live iframe per frame, so playlist controls can reach the player that is actually on the wall
const activeIframes: Record<string, HTMLIFrameElement> = {}
const soundRequestCancels: Record<string, () => void> = {}
export const cancelSoundRequest = (frameId: string) => soundRequestCancels[frameId]?.()

export function trackIframe(iframe: HTMLIFrameElement, frameId: string, resumeKey: string): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      const currentTime = data?.info?.currentTime
      if (typeof currentTime === 'number') { videoResume[resumeKey] = currentTime; data?.info?.playerState === 2 ? flushResume() : persist() }
      if (typeof data?.info?.playerState === 'number') {
        framePlayerStates[frameId] = data.info.playerState
        // something played, so the run of failures is over and a later dud may skip afresh
        if (data.info.playerState === 1) delete skipRun[frameId]
      }
      if (data?.event === 'onError' || typeof data?.info?.errorCode === 'number') {
        const failed = playlistVideoResume[resumeKey]
        if (failed) {
          if (!blockedVideos.has(failed)) { blockedVideos.add(failed); blockedListeners.forEach((listener) => listener()) }
          const run = (skipRun[frameId] ??= new Set())
          if (run.has(failed)) return // already skipped past this one — the whole list is unplayable, so stop
          run.add(failed)
        }
        command(frameId, 'nextVideo')
        return
      }
      const currentVideo = data?.info?.videoData?.video_id
      if (typeof currentVideo === 'string' && currentVideo && currentVideo !== 'videoseries') {
        // a new video can bring its own captions back on, so drop them again whenever the track changes
        if (playlistVideoResume[resumeKey] !== currentVideo) captionsCleared.delete(frameId)
        playlistVideoResume[resumeKey] = currentVideo
        persist()
      }
      // onApiChange is the moment YouTube reports a module with an exposed API has just been LOADED — which
      // is exactly when the captions module appears and can turn itself on from the account's settings. Every
      // occurrence is answered, because the module can be loaded again later in the same session.
      // The postMessage protocol does not use the JS API's name here: what actually arrives when a module
      // with an exposed API is loaded is 'apiInfoDelivery' (verified live). Both names are matched anyway.
      if (data?.event === 'apiInfoDelivery' || data?.event === 'onApiChange') { unloadCaptions(frameId); return }
      // starting playback is the other point a fresh caption track can appear
      if (data?.info?.playerState === 1 && !captionsCleared.has(frameId)) { captionsCleared.add(frameId); unloadCaptions(frameId) }
    } catch { /* not a youtube message */ }
  }
  const hello = () => { captionsCleared.delete(frameId); iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: frameId }), '*') }
  window.addEventListener('message', onMessage)
  iframe.addEventListener('load', hello)
  hello()
  activeIframes[frameId] = iframe
  return () => {
    flushResume()
    window.removeEventListener('message', onMessage)
    iframe.removeEventListener('load', hello)
    if (activeIframes[frameId] === iframe) delete activeIframes[frameId]
  }
}

const command = (frameId: string, func: string, args: unknown[] = []) =>
  activeIframes[frameId]?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*')

// Subtitles off for good. cc_load_policy=0 only sets the embed's default and loses to a viewer whose YouTube
// account turns captions on everywhere, and a caption module unloaded before YouTube loads it comes back. The
// kill is therefore repeated at onApiChange — the event that fires when a module is loaded.
// Both names are sent because the module is 'captions' on some players and 'cc' on others.
const captionsCleared = new Set<string>()
const unloadCaptions = (frameId: string) => {
  // unloadModule is undocumented but is what actually removes the renderer; the documented setOption calls
  // only reach a module that is still loaded, so both are sent and the unload goes last.
  command(frameId, 'setOption', ['captions', 'track', {}])
  command(frameId, 'setOption', ['cc', 'track', {}])
  command(frameId, 'unloadModule', ['captions'])
  command(frameId, 'unloadModule', ['cc'])
}

// a mute=1 embed can come up with its volume at 0, so unmuting alone stays silent — always restore volume too
export const muteFrame = (frameId: string) => command(frameId, 'mute')
export const playFrame = (frameId: string) => command(frameId, 'playVideo')


// Every embed starts muted. This helper only lifts that mute for an explicit user action (or a saved choice that
// is being retried from a real page gesture). It never installs its own global click listener: choosing which
// frames make sound belongs to the UI, not to the player retry loop.
export function requestSound(frameId: string, onBlocked: () => void, onSound?: () => void): () => void {
  let settled = false
  let volumeRetried = false
  let lastAskedAt = -Infinity
  let lastMuted: boolean | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const ask = () => {
    if (!activeIframes[frameId]) return
    lastAskedAt = performance.now()
    command(frameId, 'unMute')
    command(frameId, 'setVolume', [70])
    command(frameId, 'playVideo')
  }
  const cleanup = () => {
    window.removeEventListener('message', onMessage); clearTimeout(timer)
    if (soundRequestCancels[frameId] === cleanup) delete soundRequestCancels[frameId]
  }
  const onMessage = (event: MessageEvent) => {
    if (event.source !== activeIframes[frameId]?.contentWindow || settled) return
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
        // Paused just after an unmute request means the browser refused sound. Keep the video alive silently;
        // a later real gesture may retry only this frame if the user had previously chosen it.
        if (performance.now() - lastAskedAt < 1500) { command(frameId, 'mute'); command(frameId, 'playVideo'); settled = true; onBlocked(); cleanup() }
        else { settled = true; cleanup() }
        return
      }
      if (info?.muted === true && performance.now() - lastAskedAt > 120) ask()
    } catch { /* not a youtube message */ }
  }
  soundRequestCancels[frameId]?.()
  soundRequestCancels[frameId] = cleanup
  window.addEventListener('message', onMessage)
  ask()
  // A panel/player swap briefly leaves no live iframe. Keep listening for the replacement instead of treating
  // the old iframe as the permanent target, but do not leave a stale sound request alive indefinitely.
  timer = setTimeout(() => { if (!settled) { cleanup(); if (lastMuted !== false) onBlocked() } }, 4000)
  // cancellable: the caller stops the monitor when the frame unmounts or the user mutes it — otherwise a
  // stale monitor would keep un-muting the player against the user's wishes
  return () => { settled = true; cleanup() }
}

// Enforce the site's own play order for a playlist frame. The playlist embed still advances by itself in
// YouTube's order — the moment the incoming video matches YouTube's natural next but differs from OUR next,
// it is redirected with playVideoAt. Deliberate jumps (panel clicks to an arbitrary video) don't match the
// natural-next signature and are respected. The live id list from the player also keeps the stored order in
// sync (new videos append, deleted ones drop). Never reloads the iframe or touches the current video.
export function watchPlaylistOrder(frameId: string, playlistId: string): () => void {
  let liveIds: string[] = []
  // start from the saved order and follow every reorder immediately — waiting for the player's next playlist
  // message would leave this watcher enforcing a stale order after the user rearranges the list
  let order: string[] = loadOrders()[playlistId] ?? []
  const stopOrderSync = onOrderChange((changed) => { if (changed === playlistId) order = loadOrders()[playlistId] ?? [] })
  let current: string | undefined
  const onMessage = (event: MessageEvent) => {
    if (event.source !== activeIframes[frameId]?.contentWindow) return
    try {
      const info = (typeof event.data === 'string' ? JSON.parse(event.data) : event.data)?.info
      if (Array.isArray(info?.playlist) && info.playlist.length && info.playlist.join() !== liveIds.join()) {
        liveIds = info.playlist
        order = syncOrder(playlistId, liveIds)
      }
      const video = info?.videoData?.video_id
      if (typeof video !== 'string' || !video || video === 'videoseries' || video === current) return
      const previous = current
      current = video
      if (!previous || !order.length || !liveIds.length) return
      const naturalNext = liveIds[(liveIds.indexOf(previous) + 1) % liveIds.length]
      const ourNext = order[(order.indexOf(previous) + 1) % order.length]
      if (video === naturalNext && video !== ourNext && liveIds.includes(ourNext)) {
        current = ourNext
        command(frameId, 'playVideoAt', [liveIds.indexOf(ourNext)])
      }
    } catch { /* not a youtube message */ }
  }
  window.addEventListener('message', onMessage)
  return () => { window.removeEventListener('message', onMessage); stopOrderSync() }
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

const playlistEmbedSrc = (playlistId: string, startVideo: string | undefined, urlIndex: number | undefined, resumeKey: string, start: number, extra: string) => {
  const current = playlistVideoResume[resumeKey] ?? startVideo
  if (current) return `https://www.youtube.com/embed/${current}?list=${playlistId}&enablejsapi=1&loop=1&start=${start}&${extra}`
  const at = urlIndex === undefined ? '' : `&index=${urlIndex}`
  return `https://www.youtube.com/embed/videoseries?list=${playlistId}${at}&enablejsapi=1&loop=1&start=${start}&${extra}`
}

export const embedSrc = (stored: string, resumeKey: string, extra: string) => {
  const start = Math.max(0, Math.floor(videoResume[resumeKey] ?? 0))
  // captions stay off: cc_load_policy=0 covers the embed default, and unloadCaptions (below) handles the
  // viewer whose YouTube account forces subtitles on, which the URL parameter alone does not override
  const base = `cc_load_policy=0&${extra}`
  const params = typeof location === 'undefined' ? base : `${base}&origin=${encodeURIComponent(location.origin)}`
  if (!stored.startsWith('pl:')) return videoEmbedSrc(stored, start, params)
  const [playlistId, startVideo, index] = stored.slice(3).split('@')
  return playlistEmbedSrc(playlistId, startVideo || undefined, index ? Number(index) : undefined, resumeKey, start, params)
}
