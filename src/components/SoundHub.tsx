import { useEffect, useRef, useState } from 'react'
import { useRoomStore } from '../store'
import { muteFrame, unmuteFrame } from '../services/ytResume'
import { setExternalHover } from './Interactive'

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
  const { playingFrames, mutedFrames, setFrameMuted, furniture, mode } = useRoomStore()
  const [open, setOpen] = useState(false)
  const hub = useRef<HTMLDivElement>(null)
  // clicking anywhere outside the hub closes the list
  useEffect(() => {
    if (!open) return
    const onOutside = (event: PointerEvent) => { if (!hub.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', onOutside)
    return () => window.removeEventListener('pointerdown', onOutside)
  }, [open])
  const frames = playingFrames.map((id) => furniture.find((item) => item.id === id && !item.removed)).flatMap((item) => item ? [item] : [])
  if (!frames.length || mode === 'edit') return null
  const anySound = frames.some((item) => !mutedFrames.includes(item.id))
  const toggle = (id: string, muted: boolean) => {
    if (muted) unmuteFrame(id); else muteFrame(id)
    setFrameMuted(id, !muted)
  }
  return <div ref={hub} className="sound-hub">
    {open && <ul className="sound-hub-list" aria-label="영상 소리">
      {frames.map((item, index) => {
        const muted = mutedFrames.includes(item.id)
        return <li key={item.id}>
          <button type="button" className={muted ? 'muted' : ''} onClick={() => toggle(item.id, muted)}
            onMouseEnter={() => setExternalHover(item.id)} onMouseLeave={() => setExternalHover(null)}>
            <SpeakerIcon muted={muted} size={20} />
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
