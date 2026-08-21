import { useEffect, useRef, useState } from 'react'
import { MAX_ROOMS, useRoomStore } from '../store'
import { isVisiting } from '../services/social'
import SoundHub from './SoundHub'

const icon = (children: React.ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
const HouseIcon = () => icon(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>)
const SunIcon = () => icon(<><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></>)
const SunsetIcon = () => icon(<><path d="M17 18a5 5 0 0 0-10 0" /><line x1="12" y1="9" x2="12" y2="2" /><line x1="4.22" y1="10.22" x2="5.64" y2="11.64" /><line x1="1" y1="18" x2="3" y2="18" /><line x1="21" y1="18" x2="23" y2="18" /><line x1="18.36" y1="11.64" x2="19.78" y2="10.22" /><line x1="23" y1="22" x2="1" y2="22" /><polyline points="16 5 12 9 8 5" /></>)
const MoonIcon = () => icon(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />)
const PersonIcon = () => icon(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>)
const GlobeIcon = () => icon(<><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>)
const GearIcon = () => icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>)

// The one control strip: five round buttons, bottom centre. Everything the owner used to reach through the
// scattered corner chrome (room chips, time buttons, inventory) lives here now; visitors just get the volume.
export default function Dock({ onOpenInventory, onDeleteRoom }: { onOpenInventory: () => void; onDeleteRoom: (id: string) => void }) {
  const { rooms, activeRoomId, openRoom, createRoom, mode, timeOfDay, setTimeOfDay } = useRoomStore()
  const [roomsOpen, setRoomsOpen] = useState(false)
  // visual toggle only for now — the follow/discover explorer split ships later
  const [explore, setExplore] = useState<'follow' | 'discover'>('follow')
  const roomsItem = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!roomsOpen) return
    const onOutside = (event: PointerEvent) => { if (!roomsItem.current?.contains(event.target as Node)) setRoomsOpen(false) }
    window.addEventListener('pointerdown', onOutside)
    return () => window.removeEventListener('pointerdown', onOutside)
  }, [roomsOpen])
  const owner = !isVisiting() && mode === 'normal'
  const cycleTime = () => setTimeOfDay(timeOfDay === 'day' ? 'evening' : timeOfDay === 'evening' ? 'night' : 'day')
  return <div className="dock">
    {owner && <div className="dock-item dock-fade" ref={roomsItem}>
      {roomsOpen && <ul className="dock-pop" aria-label="내 방 목록">
        {rooms.map((room) => <li key={room.id}>
          <button type="button" className={room.id === activeRoomId ? 'active' : ''} onClick={() => { if (room.id !== activeRoomId) openRoom(room.id); setRoomsOpen(false) }}>{room.name}</button>
          {rooms.length > 1 && <button type="button" className="dock-pop-delete" aria-label={`${room.name} 삭제`} onClick={() => { setRoomsOpen(false); onDeleteRoom(room.id) }}>×</button>}
        </li>)}
        {rooms.length < MAX_ROOMS && <li><button type="button" onClick={() => { createRoom(); setRoomsOpen(false) }}>+ 새 방 만들기</button></li>}
      </ul>}
      <button type="button" className="dock-button" aria-label="내 방 목록" onClick={() => setRoomsOpen((value) => !value)}><HouseIcon /></button>
    </div>}
    {owner && <button type="button" className="dock-button" aria-label="시간대 변경" onClick={cycleTime}>{timeOfDay === 'day' ? <SunIcon /> : timeOfDay === 'evening' ? <SunsetIcon /> : <MoonIcon />}</button>}
    {owner && <button type="button" className="dock-button" aria-label={explore === 'follow' ? '팔로우' : '탐색'} onClick={() => setExplore((value) => value === 'follow' ? 'discover' : 'follow')}>{explore === 'follow' ? <PersonIcon /> : <GlobeIcon />}</button>}
    <SoundHub />
    {owner && <button type="button" className="dock-button dock-fade" aria-label="보관함" onClick={onOpenInventory}><GearIcon /></button>}
  </div>
}
