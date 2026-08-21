import { useEffect, useRef, useState } from 'react'
import { MAX_ROOMS, useRoomStore } from '../store'
import { isVisiting, myHandle } from '../services/social'
import { explorerMode, isFollowingRoom, myInviteLink, onFollowsChange, setExplorerMode, setFollowing } from '../services/follows'
import { shareRoom } from '../services/capture'
import SoundHub from './SoundHub'
import { requestExplorerZoom } from './CameraController'

const icon = (children: React.ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
const HouseIcon = () => icon(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>)
const SunIcon = () => icon(<><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></>)
const SunsetIcon = () => icon(<><path d="M17 15.5a5 5 0 0 0-10 0" /><line x1="12" y1="4.5" x2="12" y2="7.5" /><line x1="4.9" y1="8.4" x2="6.3" y2="9.8" /><line x1="19.1" y1="8.4" x2="17.7" y2="9.8" /><line x1="2" y1="15.5" x2="5" y2="15.5" /><line x1="19" y1="15.5" x2="22" y2="15.5" /><line x1="3" y1="19.5" x2="21" y2="19.5" /></>)
const MoonIcon = () => icon(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />)
const PersonIcon = () => icon(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>)
const PersonPlusIcon = () => icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></>)
const PersonCheckIcon = () => icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><polyline points="17 11 19 13 23 9" /></>)
const GlobeIcon = () => icon(<><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>)
const BoxIcon = () => icon(<><path d="M5 9h14v11H5z" /><line x1="5" y1="9" x2="3" y2="4.5" /><line x1="19" y1="9" x2="21" y2="4.5" /></>)

// The one control strip: five round buttons, bottom centre. Everything the owner used to reach through the
// scattered corner chrome (room chips, time buttons, inventory) lives here now; visitors just get the volume.
export default function Dock({ onOpenInventory, onDeleteRoom }: { onOpenInventory: () => void; onDeleteRoom: (id: string) => void }) {
  const { rooms, activeRoomId, openRoom, createRoom, mode, timeOfDay, setTimeOfDay } = useRoomStore()
  const [roomsOpen, setRoomsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'busy' | 'saved'>('idle')
  const share = () => {
    if (shareState === 'busy') return
    setShareState('busy')
    void shareRoom().then((result) => {
      if (result === 'saved') { setShareState('saved'); setTimeout(() => { setShareState('idle'); setRoomsOpen(false) }, 1200) }
      else { setShareState('idle'); setRoomsOpen(false) }
    })
  }
  const copyInvite = () => void myInviteLink().then((link) => {
    if (!link) return
    void navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  })
  // home = only rooms I follow around mine, discover = the public directory; the explorer listens to this
  const [explore, setExplore] = useState(explorerMode())
  const { currentHandle } = useRoomStore()
  // follow state for the room being visited (null until known)
  const visiting = isVisiting()
  const [followed, setFollowed] = useState<boolean | null>(null)
  useEffect(() => {
    if (!visiting || !currentHandle || !myHandle()) { setFollowed(null); return }
    let live = true
    const refresh = () => void isFollowingRoom(currentHandle).then((value) => { if (live) setFollowed(value) })
    refresh()
    const stop = onFollowsChange(refresh)
    return () => { live = false; stop() }
  }, [visiting, currentHandle])
  const roomsItem = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!roomsOpen) return
    const onOutside = (event: PointerEvent) => { if (!roomsItem.current?.contains(event.target as Node)) setRoomsOpen(false) }
    window.addEventListener('pointerdown', onOutside)
    return () => window.removeEventListener('pointerdown', onOutside)
  }, [roomsOpen])
  const owner = !visiting && mode === 'normal'
  const cycleTime = () => setTimeOfDay(timeOfDay === 'day' ? 'evening' : timeOfDay === 'evening' ? 'night' : 'day')
  // the dock owns its pointer events completely — nothing may leak through to the room behind it
  const block = (event: { stopPropagation: () => void }) => event.stopPropagation()
  return <div className="dock" onPointerDown={block} onPointerMove={block} onPointerUp={block} onPointerOver={block} onClick={block} onWheel={block} onTouchStart={block} onTouchMove={block}>
    {owner && <div className="dock-item dock-fade" ref={roomsItem}>
      {roomsOpen && <ul className="dock-pop" aria-label="내 방 목록">
        {rooms.map((room) => <li key={room.id}>
          <button type="button" className={room.id === activeRoomId ? 'active' : ''} onClick={() => { if (room.id !== activeRoomId) openRoom(room.id); setRoomsOpen(false) }}>{room.name}</button>
          {rooms.length > 1 && <button type="button" className="dock-pop-delete" aria-label={`${room.name} 삭제`} onClick={() => { setRoomsOpen(false); onDeleteRoom(room.id) }}>×</button>}
        </li>)}
        {rooms.length < MAX_ROOMS && <li><button type="button" onClick={() => { createRoom(); setRoomsOpen(false) }}>+ 새 방 만들기</button></li>}
        <li><button type="button" onClick={copyInvite}>{copied ? '복사됨' : '초대 링크 복사'}</button></li>
        <li><button type="button" onClick={share}>{shareState === 'busy' ? '캡처 중' : shareState === 'saved' ? '저장됨 · 링크 복사됨' : '방 공유'}</button></li>
      </ul>}
      <button type="button" className="dock-button" aria-label="내 방 목록" onClick={() => setRoomsOpen((value) => !value)}><HouseIcon /></button>
    </div>}
    {owner && <button type="button" className="dock-button" aria-label="시간대 변경" onClick={cycleTime}>{timeOfDay === 'day' ? <SunIcon /> : timeOfDay === 'evening' ? <SunsetIcon /> : <MoonIcon />}</button>}
    {visiting && mode === 'normal' && !!myHandle() && !!currentHandle && <button type="button" className={followed ? 'dock-button following' : 'dock-button'} aria-label={followed ? '팔로우 해제' : '팔로우'} onClick={() => { if (followed === null) return; setFollowed(!followed); void setFollowing(currentHandle, !followed).then((ok) => { if (!ok) setFollowed(followed) }) }}>{followed ? <PersonCheckIcon /> : <PersonPlusIcon />}</button>}
    {mode === 'normal' && !!myHandle() && <button type="button" className="dock-button" aria-label={explore === 'home' ? '팔로우' : '탐색'} onClick={() => { const next = explore === 'home' ? 'discover' : 'home'; setExplore(next); setExplorerMode(next); requestExplorerZoom() }}>{explore === 'home' ? <PersonIcon /> : <GlobeIcon />}</button>}
    <SoundHub />
    {owner && <button type="button" className="dock-button dock-fade" aria-label="보관함" onClick={onOpenInventory}><BoxIcon /></button>}
  </div>
}
