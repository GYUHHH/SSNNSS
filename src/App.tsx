import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ArtworkOverlay, { artworkKindOf } from './components/ArtworkOverlay'
import BookShelfPanel from './components/BookShelfPanel'
import DiaryDialog from './components/DiaryDialog'
import InventoryPanel from './components/InventoryPanel'
import ProfileCard from './components/ProfileCard'
import YouTubePlayer from './components/YouTubePlayer'
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
const BUILD = 278

function Interface() {
  const { rooms, activeRoomId, openRoom, createRoom, removeRoom, selectedObject, clearSelection, mode, toggleEditMode, bookshelfOpen, openBookId, selectedFurnitureId, selectedPlacementValid, movingFurnitureId, preview, previewValid, placePreview, furniture, rotateFurniture, removeFurniture, endMove, undoLayout, resetLayout, toggleDebugAnchors, timeOfDay, setTimeOfDay, openStyleTarget } = useRoomStore()
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [confirmingRoom, setConfirmingRoom] = useState<string | null>(null)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [sheetDragging, setSheetDragging] = useState(false)
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number; overStorage: boolean } | null>(null)
  const [dragThumbnail, setDragThumbnail] = useState<string | null>(null)
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
  const sheet = useRef<HTMLElement>(null)
  const drag = useRef<{ y: number; at: number; travel: number } | null>(null)
  // Move the room by the sheet's real height: their two edges stay joined for short and tall panel contents alike.
  const setProgress = (value: number) => {
    const root = document.documentElement.style
    root.setProperty('--sheet', String(value))
    root.setProperty('--sheet-shift', `${-(sheet.current?.offsetHeight ?? 0) * value}px`)
  }
  useLayoutEffect(() => {
    const panel = sheet.current
    if (!panel) return
    const sync = () => setProgress(artOpen ? 1 : 0)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [artOpen])
  const isSheet = () => window.matchMedia('(max-width: 719px)').matches
  const sheetDown = (event: React.PointerEvent) => {
    if (!artOpen || !isSheet()) return
    const panel = sheet.current
    // let an inner scroll keep the gesture unless it is already at the very top
    if (!panel || panel.scrollTop > 0) return
    drag.current = { y: event.clientY, at: performance.now(), travel: 0 }
    setSheetDragging(true)
  }
  const sheetMove = (event: React.PointerEvent) => {
    const held = drag.current
    if (!held || !sheet.current) return
    const travel = Math.max(0, event.clientY - held.y)
    held.travel = travel
    const height = sheet.current.offsetHeight || 1
    sheet.current.style.transition = 'none'
    sheet.current.style.transform = `translateY(${travel}px)`
    setProgress(Math.max(0, 1 - travel / height))
  }
  const sheetUp = (event: React.PointerEvent) => {
    const held = drag.current
    drag.current = null
    setSheetDragging(false)
    if (!held || !sheet.current) return
    sheet.current.style.transition = ''
    sheet.current.style.transform = ''
    const height = sheet.current.offsetHeight || 1
    const speed = held.travel / Math.max(1, performance.now() - held.at)
    if (held.travel > height * .3 || speed > .6) { setProgress(0); clearSelection() }
    else setProgress(1)
    event.stopPropagation()
  }
  return <main className={`app${artOpen ? ' art-open' : ''}${sheetDragging ? ' sheet-dragging' : ''}`}>
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
    <YouTubePlayer />
    <SoundHub />
    <HandleSetup />
    <PanelHistory />
    <ReactionPopup />
    <ReactionPicker />
    <ItemComments />
    <ProfileCard />
    <aside ref={sheet} className={artOpen ? 'art-panel open' : 'art-panel'} aria-hidden={!artOpen}
      onPointerDown={sheetDown} onPointerMove={sheetMove} onPointerUp={sheetUp} onPointerCancel={sheetUp}>
      <span className="sheet-handle" aria-hidden="true" />
      <BookShelfPanel /><DiaryDialog /><ArtworkOverlay />
    </aside>
  </main>
}

export default function App() { return <RoomProvider><Interface /></RoomProvider> }
