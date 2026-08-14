// The wall player and the panel player are different iframes, so moving between them starts a fresh embed.
// YouTube's iframe API broadcasts currentTime while playing (after a "listening" handshake); we remember the
// last position per frame and hand it to the next embed as its start point, so the switch resumes instead of
// rewinding to zero. Runtime-only on purpose — a reload starting the clip over is expected.
export const videoResume: Record<string, number> = {}

export function trackIframe(iframe: HTMLIFrameElement, frameId: string): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      const currentTime = data?.info?.currentTime
      if (typeof currentTime === 'number') videoResume[frameId] = currentTime
    } catch { /* not a youtube message */ }
  }
  const hello = () => iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: frameId }), '*')
  window.addEventListener('message', onMessage)
  iframe.addEventListener('load', hello)
  hello()
  return () => { window.removeEventListener('message', onMessage); iframe.removeEventListener('load', hello) }
}

export const embedSrc = (videoId: string, frameId: string, extra: string) =>
  `https://www.youtube.com/embed/${videoId}?enablejsapi=1&start=${Math.max(0, Math.floor(videoResume[frameId] ?? 0))}&${extra}`
