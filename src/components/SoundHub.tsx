import { useEffect, useRef, useState } from 'react'
import { loadAudioPrefs, useRoomStore } from '../store'
import { setExternalHover } from './Interactive'
import { loadClipUrls } from '../services/mediaStore'

function SpeakerIcon({ muted, size }: { muted: boolean; size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
    {muted
      ? <><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
      : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5.5a10 10 0 0 1 0 13" /></>}
  </svg>
}

// One screen-fixed sound button (bottom center of the viewport, not tied to the room) that opens a list of
// every playing wall video, each with its own mute toggle. Hovering a row spotlights its frame in the room.
export default function SoundHub() {
  const { playingFrames, mutedFrames, setFrameMuted, furniture, mode, videoFrames, videoLinks, activeRoomId } = useRoomStore()
  const [open, setOpen] = useState(false)
  const hub = useRef<HTMLDivElement>(null)
  const clipIds = new Set([...Object.keys(videoFrames), ...Object.keys(loadClipUrls())])
  const audioPrefs = loadAudioPrefs(activeRoomId)
  const frames = [...new Set([...playingFrames, ...clipIds])].map((id) => furniture.find((item) => item.id === id && !item.removed && item.type.startsWith('video-frame'))).flatMap((item) => item ? [item] : [])
  const muted = (id: string) => !videoLinks[id] ? mutedFrames.includes(id) || audioPrefs[id] !== true : mutedFrames.includes(id)
  // clicking anywhere outside the hub closes the list
  useEffect(() => {
    if (!open) return
    const onOutside = (event: PointerEvent) => { if (!hub.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', onOutside)
    return () => window.removeEventListener('pointerdown', onOutside)
  }, [open])
  // M only restores the frames it muted itself. It must never turn every video on just because none was loud.
  const restore = useRef<string[]>([])
  const latest = useRef({ frameIds: frames.map((item) => item.id), mutedFrames, setFrameMuted, videoLinks, audioPrefs })
  latest.current = { frameIds: frames.map((item) => item.id), mutedFrames, setFrameMuted, videoLinks, audioPrefs }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyM' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const { frameIds, mutedFrames: mutedList, setFrameMuted: setMuted, videoLinks: links, audioPrefs: prefs } = latest.current
      const loud = frameIds.filter((id) => links[id] ? !mutedList.includes(id) : !mutedList.includes(id) && prefs[id] === true)
      if (loud.length) {
        restore.current = loud
        loud.forEach((id) => setMuted(id, true, false))
      } else {
        const back = restore.current.filter((id) => frameIds.includes(id))
        back.forEach((id) => setMuted(id, false, false))
        restore.current = []
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!frames.length || mode === 'edit') return null
  const anySound = frames.some((item) => !muted(item.id))
  const toggle = (id: string, muted: boolean) => setFrameMuted(id, !muted)
  return <div ref={hub} className="sound-hub">
    {open && <ul className="sound-hub-list" aria-label="영상 소리">
      {frames.map((item, index) => {
        const isMuted = muted(item.id)
        return <li key={item.id}>
          <button type="button" className={isMuted ? 'muted' : ''} onClick={() => toggle(item.id, isMuted)}
            onMouseEnter={() => setExternalHover(item.id)} onMouseLeave={() => setExternalHover(null)}>
            <SpeakerIcon muted={isMuted} size={20} />
            <span>{item.name}{frames.filter((other) => other.type === item.type).length > 1 ? ` ${frames.filter((other, at) => other.type === item.type && at <= index).length}` : ''}</span>
          </button>
        </li>
      })}
    </ul>}
    <button type="button" className="sound-hub-main" aria-label="소리 설정" onClick={() => { setOpen((value) => !value); setExternalHover(null) }}>
      <SpeakerIcon muted={!anySound} size={22} />
    </button>
  </div>
}
