import { useEffect, useRef, useState } from 'react'
import ArtworkOverlay, { artworkKindOf } from './components/ArtworkOverlay'
import BookShelfPanel from './components/BookShelfPanel'
import DiaryDialog from './components/DiaryDialog'
import InventoryPanel from './components/InventoryPanel'
import MusicPanel from './components/MusicPanel'
import ProfileCard from './components/ProfileCard'
import NotificationPopup from './components/NotificationPopup'
import Dock from './components/Dock'
import FollowInvite from './components/FollowInvite'
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
const BUILD = 473

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
  // On a phone the inventory is not its own box: it rides the one bottom sheet every panel uses, sitting just
  // above the edit toolbar so 완료 stays reachable. Desktop keeps the docked panel.
  const inventorySheet = mobile && mode === 'edit' && inventoryOpen
  const panelOpen = artOpen || musicOpen || inventorySheet
  const [sheetExpanded, setSheetExpanded] = useState(false)
  const sheet = useRef<HTMLElement>(null)
  const drag = useRef<{ y: number; at: number; travel: number; height: number; expanded: boolean; captured: boolean; pointerId: number } | null>(null)
  // one style write per painted frame — a finger emits pointermove faster than the screen refreshes, and
  // writing transform on every one of them is what made the sheet feel like it lagged behind the touch
  const frame = useRef(0)
  const offset = useRef(0)
  const paint = () => {
    frame.current = 0
    if (sheet.current && drag.current) sheet.current.style.transform = `translateY(${offset.current}px)`
  }
  const glideTo = (value: number) => { offset.current = value; if (!frame.current) frame.current = requestAnimationFrame(paint) }
  const suppressSheetClick = useRef(false)
  const isSheet = () => window.matchMedia('(max-width: 719px)').matches
  useEffect(() => { if (!panelOpen) setSheetExpanded(false) }, [panelOpen])
  const sheetDown = (event: React.PointerEvent) => {
    if (!panelOpen || !isSheet() || (event.target as HTMLElement).closest('input, textarea, select')) return
    const panel = sheet.current
    // let an inner scroll keep the gesture unless it is already at the very top
    if (!panel || panel.scrollTop > 0) return
    drag.current = { y: event.clientY, at: performance.now(), travel: 0, height: panel.getBoundingClientRect().height, expanded: sheetExpanded, captured: false, pointerId: event.pointerId }
  }
  const sheetMove = (event: React.PointerEvent) => {
    const held = drag.current
    const panel = sheet.current
    if (!held || !panel) return
    const travel = event.clientY - held.y
    held.travel = travel
    // a tap is not a drag: nothing moves until the finger has clearly travelled, and from that moment the
    // pointer is captured so the sheet keeps following even when the finger leaves it
    if (!held.captured) {
      if (Math.abs(travel) < 5) return
      held.captured = true
      suppressSheetClick.current = true
      panel.style.transition = 'none'
      try { panel.setPointerCapture(held.pointerId) } catch { /* pointer already gone — the drag still tracks */ }
    }
    // Down is 1:1 with the finger. Up, when the sheet is not expanded yet, is a damped rubber band instead of
    // the old per-frame height change: growing the box reflowed the whole list every move, which is what made
    // the upward gesture stutter. The release below is what actually commits to the expanded size.
    glideTo(travel > 0 ? travel : held.expanded ? 0 : -Math.min(56, Math.sqrt(-travel) * 6))
    event.preventDefault()
  }
  const sheetUp = (event: React.PointerEvent) => {
    const held = drag.current
    drag.current = null
    const panel = sheet.current
    if (!held || !panel) return
    if (held.captured) { try { panel.releasePointerCapture(held.pointerId) } catch { /* nothing to release */ } }
    cancelAnimationFrame(frame.current)
    frame.current = 0
    const height = panel.offsetHeight || 1
    const speed = held.travel / Math.max(1, performance.now() - held.at)
    if (held.expanded) {
      if (held.travel > Math.min(100, height * .12) || speed > .6) setSheetExpanded(false)
    } else if (held.travel < -Math.min(80, (window.visualViewport?.height ?? window.innerHeight) * .08) || speed < -.5) {
      setSheetExpanded(true)
    } else if (held.travel > height * .3 || speed > .6) {
      // closing hands the rest of the way to the CSS slide-out, which picks up from wherever the finger left it
      if (inventorySheet) setInventoryOpen(false); else clearSelection()
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
    {mode === 'edit' && movingFurnitureId && <div className={`storage-drop-zone${dragPointer?.overStorage ? ' active' : ''}`} data-storage-dropzone>보관함</div>}
    {movingFurnitureId && dragPointer?.overStorage && dragThumbnail && <img className="drag-thumbnail" src={dragThumbnail} alt="" style={{ left: dragPointer.x, top: dragPointer.y }} />}
    {mode === 'edit' && <><nav className="edit-toolbar" aria-label="꾸미기 도구"><span className={selectedPlacementValid ? '' : 'invalid-placement'}>{selectedFurnitureId ? (() => { const selected = furniture.find((item) => item.id === selectedFurnitureId); return selected ? `${selected.name} · ${selected.footprint.width ? `${selected.footprint.width}×${selected.footprint.depth}` : '벽'}${selectedPlacementValid ? '' : ' · 놓을 수 없는 위치'}` : '' })() : ''}</span><button type="button" onClick={() => setInventoryOpen((open) => !open)}>보관함</button><button type="button" disabled={!selectedFurnitureId && !preview} onClick={rotateFurniture}>회전</button><button type="button" disabled={!selectedFurnitureId || !customizableTypes.has(furniture.find((item) => item.id === selectedFurnitureId)?.type ?? '')} onClick={() => selectedFurnitureId && openStyleTarget({ kind: 'furniture', id: selectedFurnitureId })}>색상</button><button type="button" onClick={undoLayout}>되돌리기</button><button type="button" onClick={() => setConfirmingReset(true)}>초기화</button><button type="button" onClick={() => { if (preview && previewValid) placePreview(); setInventoryOpen(false); toggleEditMode() }}>완료</button></nav>{inventoryOpen && !mobile && <InventoryPanel />}</>}
    {confirmingRoom && <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setConfirmingRoom(null)}><section className="reset-confirm"><p>이 방을 삭제할까요? 안에 놓인 가구는 보관함으로 돌아옵니다.</p><div><button type="button" onClick={() => setConfirmingRoom(null)}>취소</button><button type="button" onClick={() => { removeRoom(confirmingRoom); setConfirmingRoom(null) }}>삭제</button></div></section></div>}
    {confirmingReset && <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setConfirmingReset(false)}><section className="reset-confirm"><p>모든 가구를 처음 위치로 되돌릴까요?</p><div><button type="button" onClick={() => setConfirmingReset(false)}>취소</button><button type="button" onClick={() => { resetLayout(); setConfirmingReset(false) }}>초기화</button></div></section></div>}
    <FollowInvite />
    <Dock onOpenInventory={() => { setInventoryOpen(true); toggleEditMode() }} onDeleteRoom={setConfirmingRoom} />
    <HandleSetup />
    <PanelHistory />
    <ReactionPopup />
    <NotificationPopup />
    <ReactionPicker />
    <ItemComments />
    <ProfileCard />
    <aside ref={sheet} className={`${panelOpen ? 'art-panel open' : 'art-panel'}${sheetExpanded ? ' expanded' : ''}${inventorySheet ? ' over-toolbar' : ''}`} aria-hidden={!panelOpen}
      onClickCapture={(event) => { if (suppressSheetClick.current) { event.preventDefault(); event.stopPropagation() } }}
      onPointerDown={sheetDown} onPointerMove={sheetMove} onPointerUp={sheetUp} onPointerCancel={sheetUp}>
      <span className="sheet-handle" aria-hidden="true" />
      {musicOpen && <div className="mobile-music-sheet"><MusicPanel musicTrack={musicTrack} setMusicTrack={setMusicTrack} musicVolume={musicVolume} setMusicVolume={setMusicVolume} /></div>}
      {inventorySheet && <InventoryPanel />}
      <BookShelfPanel /><DiaryDialog /><ArtworkOverlay />
    </aside>
  </main>
}

export default function App() { return <RoomProvider><Interface /></RoomProvider> }
