import { useRoomStore } from '../store'

// One player that never moves in the DOM. Reparenting an iframe reloads it — and closing the panel would kill the
// video — so the same element stays mounted and only its CSS position changes: docked beside the open panel,
// otherwise a small corner player that keeps running.
export default function YouTubePlayer() {
  const { playingFrame, setPlayingFrame, videoLinks, selectedObject, furniture } = useRoomStore()
  if (!playingFrame) return null
  const videoId = videoLinks[playingFrame]
  if (!videoId) return null
  const selected = furniture.find((item) => item.id === selectedObject)
  const docked = selectedObject === playingFrame && !!selected?.type.startsWith('video-frame')
  return <section className={docked ? 'yt-player docked' : 'yt-player mini'} aria-label="유튜브 재생">
    <iframe title="유튜브 재생" src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
    {!docked && <button type="button" aria-label="재생 멈추기" onClick={() => setPlayingFrame(null)}>×</button>}
  </section>
}
