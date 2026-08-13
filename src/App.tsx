import { useEffect, useState } from 'react'
import ArtworkOverlay, { artworkKindOf } from './components/ArtworkOverlay'
import BookShelfPanel from './components/BookShelfPanel'
import DiaryDialog from './components/DiaryDialog'
import InventoryPanel from './components/InventoryPanel'
import Room from './components/Room'
import StylePanel from './components/StylePanel'
import { objectInfo, RoomProvider, useRoomStore } from './store'
import { customizableTypes } from './services/styles'
import { trackList } from './services/music'
import { BannerTextInput } from './components/ArtEditor'
import { thumbnailFor } from './services/thumbnails'

function Interface() {
  const { selectedObject, clearSelection, mode, toggleEditMode, bookshelfOpen, openBookId, selectedFurnitureId, movingFurnitureId, furniture, rotateFurniture, removeFurniture, endMove, undoLayout, resetLayout, openStyleTarget, toggleDebugAnchors, musicTrack, setMusicTrack, musicVolume, setMusicVolume, timeOfDay, setTimeOfDay } = useRoomStore()
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number; overStorage: boolean } | null>(null)
  const [dragThumbnail, setDragThumbnail] = useState<string | null>(null)
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
  const item = selectedObject && selectedObject !== 'book' ? objectInfo[selectedObject] ?? (selectedItem ? { title: selectedItem.name, subtitle: selectedItem.type === 'music-player' ? '음악 재생' : '새로 배치한 가구' } : null) : null
  const time = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date())
  const zoom = (amount: number) => window.dispatchEvent(new CustomEvent('room-zoom', { detail: amount }))

  const artOpen = (!!selectedItem && !!artworkKindOf(selectedItem.type)) || bookshelfOpen || !!openBookId
  return <main className={artOpen ? 'app art-open' : 'app'}>
    <div className="scene" onContextMenu={(event) => event.preventDefault()}><Room /></div>
    <aside className="room-ui">
      {mode === 'edit' ? <span className="edit-mode-label">꾸미기</span> : <><button className="all-room-button" type="button" onClick={clearSelection}>방 전체 보기</button><button className="all-room-button" type="button" onClick={() => { setInventoryOpen(true); toggleEditMode() }}>가구함</button></>}
      {item && <section className="object-card"><strong>{item.title}</strong><span>{selectedObject === 'clock' ? time : item.subtitle}</span>
        {(selectedItem?.type === 'music-player' || selectedItem?.type === 'record-player') && <div className="track-list">{trackList.map((track) => <button key={track.id} type="button" className={musicTrack === track.id ? 'active' : ''} onClick={() => setMusicTrack(track.id)}>{musicTrack === track.id ? `♪ ${track.label}` : track.label}</button>)}<button type="button" disabled={!musicTrack} onClick={() => setMusicTrack(null)}>정지</button><label className="volume-control">볼륨<input type="range" min={0} max={1} step={0.05} value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} /></label></div>}
        {selectedItem?.type === 'banner' && <BannerTextInput id={selectedItem.id} />}
        {selectedItem && customizableTypes.has(selectedItem.type) && <button type="button" onClick={() => openStyleTarget({ kind: 'furniture', id: selectedItem.id })}>색상 변경</button>}</section>}
      <StylePanel />
    </aside>
    <nav className="zoom-controls" aria-label="화면 확대축소"><button type="button" onClick={() => zoom(-4)} aria-label="축소">−</button><button type="button" onClick={() => zoom(4)} aria-label="확대">+</button></nav>
    <nav className="time-controls" aria-label="시간대">{([['day', '낮'], ['evening', '저녁'], ['night', '밤']] as const).map(([key, label]) => <button key={key} type="button" className={timeOfDay === key ? 'active' : ''} onClick={() => setTimeOfDay(key)}>{label}</button>)}</nav>
    {mode === 'edit' && movingFurnitureId && <div className={`storage-drop-zone${dragPointer?.overStorage ? ' active' : ''}`} data-storage-dropzone>보관함</div>}
    {movingFurnitureId && dragPointer?.overStorage && dragThumbnail && <img className="drag-thumbnail" src={dragThumbnail} alt="" style={{ left: dragPointer.x, top: dragPointer.y }} />}
    {mode === 'edit' && <><nav className="edit-toolbar" aria-label="꾸미기 도구"><span>{selectedFurnitureId ? (() => { const selected = furniture.find((item) => item.id === selectedFurnitureId); return selected ? `${selected.name} · ${selected.footprint.width ? `${selected.footprint.width}×${selected.footprint.depth}` : '벽'}` : '가구 선택' })() : '가구 선택'}</span><button type="button" onClick={() => setInventoryOpen((open) => !open)}>가구함</button><button type="button" disabled={!selectedFurnitureId} onClick={rotateFurniture}>회전</button><button type="button" onClick={undoLayout}>되돌리기</button><button type="button" onClick={() => setConfirmingReset(true)}>초기화</button><button type="button" onClick={() => { setInventoryOpen(false); toggleEditMode() }}>완료</button></nav>{inventoryOpen && <InventoryPanel />}</>}
    {confirmingReset && <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setConfirmingReset(false)}><section className="reset-confirm"><p>모든 가구를 처음 위치로 되돌릴까요?</p><div><button type="button" onClick={() => setConfirmingReset(false)}>취소</button><button type="button" onClick={() => { resetLayout(); setConfirmingReset(false) }}>초기화</button></div></section></div>}
    <BookShelfPanel /><DiaryDialog /><ArtworkOverlay />
  </main>
}

export default function App() { return <RoomProvider><Interface /></RoomProvider> }
