import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MAX_ROOMS, useRoomStore } from '../store'
import { enterRoom, isVisiting, myHandle, searchRooms } from '../services/social'
import { chooseExplorerMode, explorerMode, isFollowingRoom, modeRoom, onExplorerMode, onFollowsChange, rememberModeRoom, setFollowing } from '../services/follows'
import { snapshotActiveFrames } from '../services/ytResume'
import SoundHub from './SoundHub'
import { requestExplorerZoom } from './CameraController'
import { lang, setLang, t, tp } from '../services/i18n'

const icon = (children: React.ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
const HouseIcon = () => icon(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>)
const SunIcon = () => icon(<><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></>)
const SunsetIcon = () => icon(<><path d="M17 15.5a5 5 0 0 0-10 0" /><line x1="12" y1="4.5" x2="12" y2="7.5" /><line x1="4.9" y1="8.4" x2="6.3" y2="9.8" /><line x1="19.1" y1="8.4" x2="17.7" y2="9.8" /><line x1="2" y1="15.5" x2="5" y2="15.5" /><line x1="19" y1="15.5" x2="22" y2="15.5" /><line x1="3" y1="19.5" x2="21" y2="19.5" /></>)
const MoonIcon = () => icon(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />)
const PersonIcon = () => icon(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>)
const PersonPlusIcon = () => icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></>)
const PersonCheckIcon = () => icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><polyline points="17 11 19 13 23 9" /></>)
const GlobeIcon = () => icon(<><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>)
const BoxIcon = () => icon(<><rect x="3" y="5" width="18" height="14" rx="1" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="10.5" y1="8.5" x2="13.5" y2="8.5" /><line x1="10.5" y1="15.5" x2="13.5" y2="15.5" /></>)
const BackIcon = () => icon(<><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>)
const ForwardIcon = () => icon(<><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>)
const SearchIcon = () => icon(<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.3" y2="16.3" /></>)
const DotsIcon = () => icon(<><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>)
const InfoIcon = () => icon(<><circle cx="12" cy="12" r="10" /><line x1="12" y1="11" x2="12" y2="16.5" /><circle cx="12" cy="7.6" r="1" fill="currentColor" stroke="none" /></>)
const ShopIcon = () => icon(<><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></>)

// Full-page handle search: the room disappears behind a solid sheet, one input, live prefix matches from the
// public directory; picking one walks straight into that room.
function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<string[]>([])
  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults([]); return }
    let dead = false
    const timer = setTimeout(() => { void searchRooms(q).then((rows) => { if (!dead) setResults(rows) }) }, 300)
    return () => { dead = true; clearTimeout(timer) }
  }, [query])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const enter = (handle: string) => { onClose(); void enterRoom(handle) }
  return createPortal(<div className="search-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <input autoFocus value={query} placeholder={t('아이디 검색')} onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter' && results.length) enter(results[0]) }} />
    {results.length > 0 && <ul className="search-results">{results.map((handle) => <li key={handle}><button type="button" onClick={() => enter(handle)}>{handle}</button></li>)}</ul>}
  </div>, document.body)
}

// The one control strip, bottom centre. Own room: back · search · explorer · sound · more (room settings, time,
// inventory and shop unfold upward from the dots). Visiting: back · follow · explorer · sound · forward.
export default function Dock({ onOpenInventory, onDeleteRoom }: { onOpenInventory: () => void; onDeleteRoom: (id: string) => void }) {
  const { rooms, activeRoomId, openRoom, createRoom, mode, timeOfDay, setTimeOfDay, customJob } = useRoomStore()
  const [roomsOpen, setRoomsOpen] = useState(false)
  // closed -> open -> closing(잠깐 역애니메이션) -> closed
  const [moreState, setMoreState] = useState<'closed' | 'open' | 'closing'>('closed')
  const [infoOpen, setInfoOpen] = useState(false)
  const closeMore = () => { setRoomsOpen(false); setInfoOpen(false); setMoreState((state) => state === 'open' ? 'closing' : state) }
  useEffect(() => {
    if (moreState !== 'closing') return
    const timer = setTimeout(() => setMoreState('closed'), 260)
    return () => clearTimeout(timer)
  }, [moreState])
  const [searchOpen, setSearchOpen] = useState(false)
  const [shopOpen, setShopOpen] = useState(false)
  // home = only rooms I follow around mine, discover = the public directory; the explorer listens to this
  const [explore, setExplore] = useState(explorerMode())
  useEffect(() => onExplorerMode(setExplore), [])
  const { currentHandle } = useRoomStore()
  // Discover keeps its browsing pin. The person view always returns to my room instead of walking another
  // person's follow graph.
  const switching = useRef(false)
  const toggleExplorer = () => {
    if (switching.current) return
    const next = explore === 'home' ? 'discover' : 'home'
    const here = currentHandle
    if (here) rememberModeRoom(explore, here)
    setExplore(next)
    chooseExplorerMode(next)
    const target = next === 'home' ? myHandle() : modeRoom(next)
    if (!target || target === here) {
      if (here) rememberModeRoom(next, here)
      requestExplorerZoom(true)
      return
    }
    switching.current = true
    requestExplorerZoom(true)
    void snapshotActiveFrames()
      .then(() => enterRoom(target))
      .then(() => requestExplorerZoom(true))
      .finally(() => { switching.current = false })
  }
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
  const moreItem = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (moreState !== 'open') return
    const onOutside = (event: PointerEvent) => { if (!moreItem.current?.contains(event.target as Node)) closeMore() }
    window.addEventListener('pointerdown', onOutside)
    return () => window.removeEventListener('pointerdown', onOutside)
  }, [moreState])
  const normal = mode === 'normal'
  const owner = !visiting && normal
  const cycleTime = () => setTimeOfDay(timeOfDay === 'day' ? 'evening' : timeOfDay === 'evening' ? 'night' : 'day')
  // the dock owns its pointer events completely — nothing may leak through to the room behind it
  const block = (event: { stopPropagation: () => void }) => event.stopPropagation()
  return <div className="dock" onPointerDown={block} onPointerMove={block} onPointerUp={block} onPointerOver={block} onClick={block} onWheel={block} onTouchStart={block} onTouchMove={block}>
    {normal && <button type="button" className="dock-button" aria-label={t('이전')} onClick={() => history.back()}><BackIcon /></button>}
    {owner && <button type="button" className="dock-button" aria-label={t('검색')} onClick={() => setSearchOpen(true)}><SearchIcon /></button>}
    {visiting && normal && !!myHandle() && !!currentHandle && <button type="button" style={{ visibility: followed === null ? 'hidden' : 'visible' }} className={followed ? 'dock-button following' : 'dock-button'} aria-label={followed ? t('팔로우 해제') : t('팔로우')} onClick={() => { if (followed === null) return; setFollowed(!followed); void setFollowing(currentHandle, !followed).then((ok) => { if (!ok) setFollowed(followed) }) }}>{followed ? <PersonCheckIcon /> : <PersonPlusIcon />}</button>}
    {normal && !!myHandle() && <button type="button" className={explore === 'home' ? 'dock-button' : 'dock-button following'} aria-label={explore === 'home' ? t('팔로우') : t('탐색')} onClick={toggleExplorer}>{explore === 'home' ? <PersonIcon /> : <GlobeIcon />}</button>}
    <span className="dock-slot"><SoundHub /></span>
    {owner && <div className="dock-item dock-fade" ref={moreItem}>
      {moreState !== 'closed' && <div className={moreState === 'closing' ? 'dock-stack closing' : 'dock-stack'}>
        <div className="dock-item">
          {infoOpen && <ul className="dock-pop dock-pop-side" aria-label={t('안내')}>
            <li><a href="/pricing">{t('요금제')}</a></li>
            <li><a href="/terms">{t('이용약관')}</a></li>
            <li><a href="/privacy">{t('개인정보')}</a></li>
            <li><a href="/refund">{t('환불정책')}</a></li>
            <li><a href="mailto:support@dens.world">support@dens.world</a></li>
          </ul>}
          <button type="button" className="dock-button" aria-label={t('안내')} onClick={() => setInfoOpen((value) => !value)}><InfoIcon /></button>
        </div>
        <button type="button" className="dock-button" aria-label={t('상점')} onClick={() => { closeMore(); setShopOpen(true) }}><ShopIcon /></button>
        <div className="dock-item">
          {roomsOpen && <ul className="dock-pop dock-pop-side" aria-label={t('내 방 목록')}>
            {rooms.map((room) => <li key={room.id}>
              <button type="button" className={room.id === activeRoomId ? 'active' : ''} onClick={() => { if (room.id !== activeRoomId) openRoom(room.id); setRoomsOpen(false) }}>{room.name}</button>
              {rooms.length > 1 && <button type="button" className="dock-pop-delete" aria-label={tp('{name} 삭제', { name: room.name })} onClick={() => { setRoomsOpen(false); onDeleteRoom(room.id) }}>×</button>}
            </li>)}
            {rooms.length < MAX_ROOMS && <li><button type="button" onClick={() => { createRoom(); setRoomsOpen(false) }}>{t('+ 새 방 만들기')}</button></li>}
            <li><button type="button" onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}>{lang === 'ko' ? 'English' : '한국어'}</button></li>
          </ul>}
          <button type="button" className="dock-button" aria-label={t('방설정')} onClick={() => setRoomsOpen((value) => !value)}><HouseIcon /></button>
        </div>
        <button type="button" className="dock-button" aria-label={t('시간대 변경')} onClick={cycleTime}>{timeOfDay === 'day' ? <SunIcon /> : timeOfDay === 'evening' ? <SunsetIcon /> : <MoonIcon />}</button>
        <button type="button" className="dock-button" aria-label={t('보관함')} onClick={() => { closeMore(); onOpenInventory() }}><BoxIcon />{customJob?.unseen && <i className="alert-dot" />}</button>
      </div>}
      <button type="button" className="dock-button" aria-label={t('더보기')} onClick={() => { if (moreState === 'open') closeMore(); else if (moreState === 'closed') setMoreState('open') }}><DotsIcon />{customJob?.unseen && <i className="alert-dot" />}</button>
    </div>}
    {visiting && normal && <button type="button" className="dock-button" aria-label={t('다음')} onClick={() => history.forward()}><ForwardIcon /></button>}
    {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    {shopOpen && createPortal(<div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setShopOpen(false)}><section className="shop-panel"><h2>{t('상점')}</h2></section></div>, document.body)}
  </div>
}
