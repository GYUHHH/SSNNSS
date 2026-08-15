// The wall player and the panel player are different iframes, so moving between them starts a fresh embed.
// YouTube's iframe API broadcasts currentTime while playing (after a "listening" handshake); we remember the
// last position per frame and hand it to the next embed as its start point, so the switch resumes instead of
// rewinding to zero. Runtime-only on purpose — a reload starting the clip over is expected.
export const videoResume: Record<string, number> = {}
// which video of a playlist was on screen — YouTube ignores index= on /embed/videoseries,
// so resuming must go through /embed/{videoId}?list= with the actual video id
export const playlistVideoResume: Record<string, string> = {}
// the live iframe per frame, so playlist controls can reach the player that is actually on the wall
const activeIframes: Record<string, HTMLIFrameElement> = {}

export function trackIframe(iframe: HTMLIFrameElement, frameId: string): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      const currentTime = data?.info?.currentTime
      if (typeof currentTime === 'number') videoResume[frameId] = currentTime
      const currentVideo = data?.info?.videoData?.video_id
      if (typeof currentVideo === 'string' && currentVideo && currentVideo !== 'videoseries') playlistVideoResume[frameId] = currentVideo
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

export const unmuteFrame = (frameId: string) => command(frameId, 'unMute')

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
