import { useRoomStore } from '../store'
import { ResumingIframe } from './WallVideoLayer'

// One player that never moves in the DOM. Reparenting an iframe reloads it — and closing the panel would kill the
// video — so the same element stays mounted and only its CSS position changes: docked beside the open panel,
// otherwise parked off-screen so the sound keeps running with no picture on screen.
// ponytail: off-screen, not display:none — a hidden iframe gets its playback suspended. Swap to the YouTube
// IFrame API only if autoplay-with-sound has to survive a page load with no click behind it.
export default function YouTubePlayer() {
  const { playingFrame, videoLinks, selectedObject, furniture } = useRoomStore()
  if (!playingFrame) return null
  const videoId = videoLinks[playingFrame]
  if (!videoId) return null
  const selected = furniture.find((item) => item.id === selectedObject)
  const docked = selectedObject === playingFrame && !!selected?.type.startsWith('video-frame')
  if (!docked) return null
  return <section className="yt-player docked" aria-label="유튜브 재생">
    <ResumingIframe videoId={videoId} frameId={playingFrame} extra="autoplay=1" />
  </section>
}
