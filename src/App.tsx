import { useEffect, useRef, useState } from 'react'
import ArtworkOverlay, { artworkKindOf } from './components/ArtworkOverlay'
import BookShelfPanel from './components/BookShelfPanel'
import DiaryDialog from './components/DiaryDialog'
import InventoryPanel from './components/InventoryPanel'
import MusicPanel from './components/MusicPanel'
import ProfileCard from './components/ProfileCard'
import NotificationPopup from './components/NotificationPopup'
import SoundHub from './components/SoundHub'
import HandleSetup from './components/HandleSetup'
import ReactionPopup from './components/ReactionPopup'
import PanelHistory from './components/PanelHistory'
import ReactionPicker from './components/ReactionPicker'
import ItemComments from './components/ItemComments'
import Room from './components/Room'
import StylePanel from './components/StylePanel'
import { MAX_ROOMS, RoomProvider, useRoomStore } from './store'
import { customizableTypes } from './services/styles'
import { isSignedIn, isVisiting, myHandle } from './services/social'
import { thumbnailFor } from './services/thumbnails'

// bumped by one on every deploy so the live site's version is visible at a glance (top-right corner)
const BUILD = 390

function Interface() {
  const { rooms, activeRoomId, openRoom, createRoom, removeRoom, selectedObject, clearSelection, mode, toggleEditMode, bookshelfOpen, openBookId, selectedFurnitureId, selectedPlacementValid, movingFurnitureId, preview, previewValid, placePreview, furniture, rotateFurniture, removeFurniture, endMove, undoLayout, resetLayout, toggleDebugAnchors, timeOfDay, setTimeOfDay, openStyleTarget, musicTrack, setMusicTrack, musicVolume, setMusicVolume } = useRoomStore()
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [confirmingRoom, setConfirmingRoom] = useState<string | null>(null)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number; overStorage: boolean } | null>(null)
  const [dragThumbnail, setDragThumbnail] = useState<string | null>(null)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 719px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 719px)')
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (mode === 'normal' || ((movingFurnitureId || preview) && window.matchMedia('(max-width: 719px), (max-height: 520px) and (pointer: coarse)').matches)) setInventoryOpen(false)
  }, [mode, movingFurnitureId, preview])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') mode === 'edit' ? toggleEditMode() : clearSelection(); if (event.key.toLowerCase() === 'r' && mode === 'edit') rotateFurniture(); if (event.key.toLowerCase() === 'd' && event.shiftKey) toggleDebugAnchors() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, mode, rotateFurniture, toggleEditMode, toggleDebugAnchors])
  useEffect(() => {
    if (!movingFurnitureId) return
    const track = (event: PointerEvent) => setDragPointer({ x: event.clientX, y: event.clientY, overStorage: !!document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-storage-dropzone]') })
    const finish = (event: PointerEvent) => { document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-storage-dropzone]') ? removeFurniture(movingFurnitureId) : endMove(); setDragPointer(null) }
    const cancel = () => { endMove(); setDragPointer(null) }
    window.addEventListener('pointermove', track)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    return () => { window.removeEventListener('pointermove', track); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel) }
  }, [movingFurnitureId, removeFurniture, endMove])
  const movingItem = furniture.find((entry) => entry.id === movingFurnitureId)
  useEffect(() => { let live = true; if (!movingItem) { setDragThumbnail(null); return }; thumbnailFor(movingItem).then((src) => { if (live) setDragThumbnail(src) }); return () => { live = false } }, [movingItem?.type, movingItem?.styleId])
  const selectedItem = furniture.find((entry) => entry.id === selectedObject)
  const cardControls = selectedObject === 'clock'
  const time = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date())
  const artOpen = (!!selectedItem && !!artworkKindOf(selectedItem.type)) || bookshelfOpen || !!openBookId
  const musicOpen = mobile && !!selectedItem && ['music-player', 'record-player', 'cd-player'].includes(selectedItem.type)
  const panelOpen = artOpen || musicOpen
  const [sheetExpanded, setSheetExpanded] = useState(false)
  const sheet = useRef<HTMLElement>(null)
  const drag = useRef<{ y: number; at: number; travel: number; height: number; expanded: boolean } | null>(null)
  const suppressSheetClick = useRef(false)
  const isSheet = () => window.matchMedia('(max-width: 719px)').matches
  useEffect(() => { if (!panelOpen) setSheetExpanded(false) }, [panelOpen])
  const sheetDown = (event: React.PointerEvent) => {
    if (!panelOpen || !isSheet() || (event.target as HTMLElement).closest('input, textarea, select')) return
    const panel = sheet.current
    // let an inner scroll keep the gesture unless it is already at the very top
    if (!panel || panel.scrollTop > 0) return
    drag.current = { y: event.clientY, at: performance.now(), travel: 0, height: panel.getBoundingClientRect().height, expanded: sheetExpanded }
  }
  const sheetMove = (event: React.PointerEvent) => {
    const held = drag.current
    if (!held || !sheet.current) return
    const travel = event.clientY - held.y
    held.travel = travel
    if (Math.abs(travel) > 5) suppressSheetClick.current = true
    sheet.current.style.transition = 'none'
    if (!held.expanded && travel < 0) {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      sheet.current.style.height = `${Math.min(viewportHeight, held.height - travel)}px`
      sheet.current.style.maxHeight = `${viewportHeight}px`
      sheet.current.style.transform = ''
    } else {
      sheet.current.style.height = ''
      sheet.current.style.maxHeight = ''
      sheet.current.style.transform = `translateY(${Math.max(0, travel)}px)`
    }
    if (Math.abs(travel) > 5) event.preventDefault()
  }
  const sheetUp = (event: React.PointerEvent) => {
    const held = drag.current
    drag.current = null
    if (!held || !sheet.current) return
    const panel = sheet.current
    const height = panel.offsetHeight || 1
    const speed = held.travel / Math.max(1, performance.now() - held.at)
    if (held.expanded) {
      if (held.travel > Math.min(100, height * .12) || speed > .6) setSheetExpanded(false)
    } else if (held.travel < -Math.min(80, (window.visualViewport?.height ?? window.innerHeight) * .08) || speed < -.5) {
      setSheetExpanded(true)
    } else if (held.travel > height * .3 || speed > .6) {
      clearSelection()
    }
    panel.style.transition = ''
    panel.style.transform = ''
    panel.style.height = ''
    panel.style.maxHeight = ''
    setTimeout(() => { suppressSheetClick.current = false }, 0)
    event.stopPropagation()
  }
  return <main className={`app${panelOpen ? ' art-open' : ''}`}>
    <div className="scene" onContextMenu={(event) => event.preventDefault()}><Room /></div>
    <span className="build-tag" aria-hidden="true">{BUILD}</span>
    {myHandle() && <span className="me-tag">{myHandle()}</span>}
    <aside className="room-ui">
      {cardControls && <section className="object-card"><span>{time}</span></section>}
      <StylePanel />
    </aside>
    {/* the way in for anyone without an account — stays up on every address, including someone else's room */}
    {mode === 'normal' && !isSignedIn() && <nav className="entry-buttons" aria-label="시작하기">
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('need-id', { detail: 'login' }))}>로그인</button>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('need-id', { detail: 'signup' }))}>가입하기</button>
    </nav>}
    {mode === 'normal' && <>{!isVisiting() && <div className="room-controls"><button className="inventory-button" type="button" onClick={() => { setInventoryOpen(true); toggleEditMode() }}>보관함</button></div>}{!isVisiting() && <nav className="room-slots" aria-label="내 방 목록">{rooms.map((room) => <span key={room.id} className={room.id === activeRoomId ? 'room-chip active' : 'room-chip'}><button type="button" onClick={() => room.id !== activeRoomId && openRoom(room.id)}>{room.name}</button>{rooms.length > 1 && <button type="button" className="remove-room" aria-label={`${room.name} 삭제`} onClick={() => setConfirmingRoom(room.id)}>×</button>}</span>)}{rooms.length < MAX_ROOMS && <button type="button" className="add-room" onClick={createRoom} aria-label="새 방 만들기">+</button>}</nav>}{!isVisiting() && <nav className="time-controls" aria-label="시간대">{([['day', '낮'], ['evening', '저녁'], ['night', '밤']] as const).map(([key, label]) => <button key={key} type="button" className={timeOfDay === key ? 'active' : ''} onClick={() => setTimeOfDay(key)}>{label}</button>)}</nav>}</>}
    {mode === 'edit' && movingFurnitureId && <div className={`storage-drop-zone${dragPointer?.overStorage ? ' active' : ''}`} data-storage-dropzone>보관함</div>}
    {movingFurnitureId && dragPointer?.overStorage && dragThumbnail && <img className="drag-thumbnail" src={dragThumbnail} alt="" style={{ left: dragPointer.x, top: dragPointer.y }} />}
    {mode === 'edit' && <><nav className="edit-toolbar" aria-label="꾸미기 도구"><span className={selectedPlacementValid ? '' : 'invalid-placement'}>{selectedFurnitureId ? (() => { const selected = furniture.find((item) => item.id === selectedFurnitureId); return selected ? `${selected.name} · ${selected.footprint.width ? `${selected.footprint.width}×${selected.footprint.depth}` : '벽'}${selectedPlacementValid ? '' : ' · 놓을 수 없는 위치'}` : '가구 선택' })() : '가구 선택'}</span><button type="button" onClick={() => setInventoryOpen((open) => !open)}>보관함</button><button type="button" disabled={!selectedFurnitureId} onClick={rotateFurniture}>회전</button><button type="button" disabled={!selectedFurnitureId || !customizableTypes.has(furniture.find((item) => item.id === selectedFurnitureId)?.type ?? '')} onClick={() => selectedFurnitureId && openStyleTarget({ kind: 'furniture', id: selectedFurnitureId })}>색상</button><button type="button" onClick={undoLayout}>되돌리기</button><button type="button" onClick={() => setConfirmingReset(true)}>초기화</button><button type="button" onClick={() => { if (preview && previewValid) placePreview(); setInventoryOpen(false); toggleEditMode() }}>완료</button></nav>{inventoryOpen && <InventoryPanel />}</>}
    {confirmingRoom && <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setConfirmingRoom(null)}><section className="reset-confirm"><p>이 방을 삭제할까요? 안에 놓인 가구는 보관함으로 돌아옵니다.</p><div><button type="button" onClick={() => setConfirmingRoom(null)}>취소</button><button type="button" onClick={() => { removeRoom(confirmingRoom); setConfirmingRoom(null) }}>삭제</button></div></section></div>}
    {confirmingReset && <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setConfirmingReset(false)}><section className="reset-confirm"><p>모든 가구를 처음 위치로 되돌릴까요?</p><div><button type="button" onClick={() => setConfirmingReset(false)}>취소</button><button type="button" onClick={() => { resetLayout(); setConfirmingReset(false) }}>초기화</button></div></section></div>}
    <SoundHub />
    <HandleSetup />
    <PanelHistory />
    <ReactionPopup />
    <NotificationPopup />
    <ReactionPicker />
    <ItemComments />
    <ProfileCard />
    <aside ref={sheet} className={`${panelOpen ? 'art-panel open' : 'art-panel'}${sheetExpanded ? ' expanded' : ''}`} aria-hidden={!panelOpen}
      onClickCapture={(event) => { if (suppressSheetClick.current) { event.preventDefault(); event.stopPropagation() } }}
      onPointerDown={sheetDown} onPointerMove={sheetMove} onPointerUp={sheetUp} onPointerCancel={sheetUp}>
      <span className="sheet-handle" aria-hidden="true" />
      {musicOpen && <div className="mobile-music-sheet"><MusicPanel musicTrack={musicTrack} setMusicTrack={setMusicTrack} musicVolume={musicVolume} setMusicVolume={setMusicVolume} /></div>}
      <BookShelfPanel /><DiaryDialog /><ArtworkOverlay />
    </aside>
  </main>
}

export default function App() { return <RoomProvider><Interface /></RoomProvider> }
