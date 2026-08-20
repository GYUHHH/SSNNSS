import { useEffect, useMemo, useRef, useState } from 'react'
import { SRGBColorSpace, type Texture, TextureLoader } from 'three'
import { useOptionalRoomStore, useRoomStore } from '../store'
import { getVideo } from '../services/mediaStore'
import { hideVideo, loadOrders, onOrderChange, saveOrder } from '../services/playlistOrder'
import { isBlockedVideo, onBlockedVideos, playlistControls, playlistVideoResume } from '../services/ytResume'
import { PhotoCropEditor } from './PhotoCropEditor'

const PAPER = '#f6efe2'
const COLORS = ['#3f3a33', '#b96b52', '#d9a441', '#8a9c82', '#607b93', '#a06a8c', '#e8b4a0', '#f3ead9']

// artwork saved for this furniture id, as a three texture for the wall/frame plane (null → default look)
export function useArtTexture(id: string): Texture | null {
  const src = useOptionalRoomStore()?.artworks[id]
  const [, setLoadedAt] = useState(0)
  const texture = useMemo(() => { if (!src) return null; const t = new TextureLoader().load(src, () => setLoadedAt((value) => value + 1)); t.colorSpace = SRGBColorSpace; return t }, [src])
  useEffect(() => () => { texture?.dispose() }, [texture])
  return texture
}

export function DrawingEditor({ id, width, height, onClose }: { id: string; width: number; height: number; onClose: () => void }) {
  const { artworks, setArtwork } = useRoomStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState(COLORS[0])
  const [brush, setBrush] = useState(6)
  const [eraser, setEraser] = useState(false)
  const last = useRef<[number, number] | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, width, height)
    const existing = artworks[id]
    // the saved picture now lives in the bucket, so it has to be fetched as a cross-origin image or the canvas
    // is tainted and the toDataURL below throws when the drawing is saved
    if (existing) { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => ctx.drawImage(img, 0, 0, width, height); img.src = existing }
  }, [])
  const point = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [(event.clientX - rect.left) * (width / rect.width), (event.clientY - rect.top) * (height / rect.height)]
  }
  const stroke = (from: [number, number], to: [number, number]) => {
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.strokeStyle = eraser ? PAPER : color
    ctx.lineWidth = eraser ? brush * 3 : brush
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(to[0], to[1]); ctx.stroke()
  }
  return <section className="draw-dialog inline">
      <header><strong>그림 그리기</strong></header>
      <canvas ref={canvasRef} width={width} height={height}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const p = point(event); last.current = p; stroke(p, p) }}
        onPointerMove={(event) => { if (!last.current) return; const p = point(event); stroke(last.current, p); last.current = p }}
        onPointerUp={() => { last.current = null }}
        onPointerCancel={() => { last.current = null }} />
      <div className="draw-tools">
        {COLORS.map((entry) => <button key={entry} type="button" className={!eraser && color === entry ? 'swatch active' : 'swatch'} style={{ background: entry }} aria-label={entry} onClick={() => { setColor(entry); setEraser(false) }} />)}
        <button type="button" className={eraser ? 'active' : ''} onClick={() => setEraser((on) => !on)}>지우개</button>
        <button type="button" className={brush === 3 ? 'active' : ''} onClick={() => setBrush(3)}>가는 붓</button>
        <button type="button" className={brush === 6 ? 'active' : ''} onClick={() => setBrush(6)}>굵은 붓</button>
        <button type="button" onClick={() => { const ctx = canvasRef.current!.getContext('2d')!; ctx.fillStyle = PAPER; ctx.fillRect(0, 0, width, height) }}>전체 지우기</button>
      </div>
      <footer>
        <button type="button" onClick={() => { setArtwork(id, null); onClose() }}>기본으로</button>
        <button type="button" onClick={onClose}>취소</button>
        <button type="button" className="primary" onClick={() => { setArtwork(id, canvasRef.current!.toDataURL('image/png')); onClose() }}>저장</button>
      </footer>
  </section>
}

export function PhotoPickButton({ id, width, height }: { id: string; width: number; height: number }) {
  const { artworks, setArtwork } = useRoomStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const closeEditor = () => setEditing((source) => { if (source) URL.revokeObjectURL(source); return null })
  const pick = (file: File) => setEditing(URL.createObjectURL(file))
  return <>
    <button type="button" onClick={() => inputRef.current?.click()}>사진 넣기</button>
    {artworks[id] && <button type="button" onClick={() => setArtwork(id, null)}>사진 제거</button>}
    <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) pick(file); event.target.value = '' }} />
    {editing && <PhotoCropEditor source={editing} aspect={width / height} output={[width, height]} onClose={closeEditor} onApply={(image) => { setArtwork(id, image); closeEditor() }} />}
  </>
}

export function useApplyAndClose(onApply: () => void) {
  const store = useOptionalRoomStore()
  return () => { onApply(); store?.clearSelection() }
}

export function BannerTextInput({ id, artwork, saveArtwork }: { id: string; artwork?: string; saveArtwork?: (id: string, text: string | null) => void }) {
  const store = useOptionalRoomStore()
  const [text, setText] = useState(artwork ?? store?.artworks[id] ?? 'WELCOME ♥')
  const apply = useApplyAndClose(() => (saveArtwork ?? store?.setArtwork)?.(id, text.trim() || null))
  return <div className="banner-input">
    <input type="text" maxLength={40} value={text} onChange={(event) => setText(event.target.value)} placeholder="배너 문구" onKeyDown={(event) => { if (!event.nativeEvent.isComposing && event.key === 'Enter') apply() }} />
    <button type="button" onClick={apply}>적용</button>
  </div>
}

export function SpeechBubbleInput({ id, artwork, saveArtwork }: { id: string; artwork?: string; saveArtwork?: (id: string, text: string | null) => void }) {
  const store = useOptionalRoomStore()
  const [text, setText] = useState(artwork ?? store?.artworks[id] ?? '')
  const apply = useApplyAndClose(() => (saveArtwork ?? store?.setArtwork)?.(id, text.trim() || null))
  return <div className="room-bubble-input">
    <textarea rows={3} maxLength={80} value={text} onChange={(event) => setText(event.target.value)} />
    <button type="button" onClick={apply}>적용</button>
  </div>
}

export function VideoPickButton({ id, onPicked }: { id: string; onPicked?: () => void }) {
  const { setVideoClip } = useRoomStore()
  const inputRef = useRef<HTMLInputElement>(null)
  return <>
    <button type="button" onClick={() => inputRef.current?.click()}>영상 넣기</button>
    <input ref={inputRef} type="file" accept="video/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) { setVideoClip(id, file); onPicked?.() }; event.target.value = '' }} />
  </>
}

export function VideoLinkInput({ id, onApplied }: { id: string; onApplied?: () => void }) {
  const { setVideoLink } = useRoomStore()
  const [text, setText] = useState('')
  const [failed, setFailed] = useState(false)
  const apply = () => { if (!setVideoLink(id, text)) { setFailed(true); return } setFailed(false); setText(''); onApplied?.() }
  return <div className="video-link">
    <div className="banner-input">
      <input type="text" value={text} onChange={(event) => { setText(event.target.value); setFailed(false) }} placeholder="유튜브 링크 붙여넣기" onKeyDown={(event) => { if (event.key === 'Enter') apply() }} />
      <button type="button" onClick={apply}>넣기</button>
    </div>
    {failed && <small className="video-link-error">유튜브 주소를 인식하지 못했어요.</small>}
  </div>
}

// the clip plays in the panel too, so it keeps running while you are looking at its settings
export function ClipPreview({ id }: { id: string }) {
  // videoFrames only knows clips set THIS session — after a reload the clip lives in IndexedDB (or as the
  // uploaded url in videoClips), so existence is checked there, the same way the wall screen loads it
  const { videoFrames, videoClips } = useRoomStore()
  const version = videoFrames[id]
  const clip = videoClips[id]
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    let created: string | null = null
    setUrl(null)
    getVideo(id).then((blob) => {
      if (!live) return
      if (blob) { created = URL.createObjectURL(blob); setUrl(created); return }
      if (clip) setUrl(clip)
    })
    return () => { live = false; if (created) URL.revokeObjectURL(created) }
  }, [id, version, clip])
  if (!url) return null
  return <video className="clip-preview" src={url} autoPlay muted loop playsInline controls />
}

// Site-side play order editor for a playlist frame: rows (thumbnail, title, drag handle) reordered by
// pointer-dragging the handle — pointer events cover mouse and touch alike, so mobile drags work without a
// separate long-press path. The grabbed row rides along under the pointer while the others slide out of the
// way with a transition; the new order commits (and saves) on release. Playback picks the change up from the
// NEXT video, and the id list itself arrives from playback sync (watchPlaylistOrder).
const titleCache: Record<string, string> = {}
function OrderRow({ videoId, title, blocked, dragging, shift, onHandleDown, onDelete }: { videoId: string; title: string; blocked: boolean; dragging: boolean; shift: number; onHandleDown: (event: React.PointerEvent) => void; onDelete: () => void }) {
  return <li className={`order-row${dragging ? ' dragging' : ''}${blocked ? ' blocked' : ''}`} style={{ transform: shift ? `translateY(${shift}px)` : undefined }}>
    <img src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" draggable={false} />
    <span>{title || videoId}</span>
    {blocked && <span className="order-warn" aria-label="재생 불가">!</span>}
    <button type="button" className="order-delete" aria-label="목록에서 삭제" onClick={onDelete}>×</button>
    <button type="button" className="order-handle" aria-label="순서 이동" onPointerDown={onHandleDown}>≡</button>
  </li>
}

export function PlaylistOrderEditor({ id }: { id: string }) {
  const { videoLinks } = useRoomStore()
  const link = videoLinks[id]
  const playlistId = link?.startsWith('pl:') ? link.slice(3).split('@')[0] : null
  const [order, setOrder] = useState<string[]>(() => playlistId ? loadOrders()[playlistId] ?? [] : [])
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [drag, setDrag] = useState<{ index: number; delta: number } | null>(null)
  const rowStep = useRef(48)
  // a video is only known to be unplayable once the player has actually refused it, so the list re-reads
  // whenever playback discovers another one
  const [, setBlockedTick] = useState(0)
  useEffect(() => onBlockedVideos(() => setBlockedTick((value) => value + 1)), [])
  useEffect(() => {
    if (!playlistId) return
    setOrder(loadOrders()[playlistId] ?? [])
    return onOrderChange((changed) => { if (changed === playlistId) setOrder(loadOrders()[playlistId] ?? []) })
  }, [playlistId])
  useEffect(() => {
    order.forEach((videoId) => {
      if (titleCache[videoId] !== undefined) return
      titleCache[videoId] = ''
      fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`)
        .then((response) => response.json())
        .then((data) => { if (data?.title) { titleCache[videoId] = data.title; setTitles((known) => ({ ...known, [videoId]: data.title })) } })
        .catch(() => { /* fall back to the id */ })
    })
  }, [order])
  if (!playlistId) return null
  if (!order.length) return null
  // site-side delete: the YouTube playlist keeps the video, our order drops it and playback skips it.
  // Deleting the one currently on screen moves on right away instead of letting it finish.
  const remove = (videoId: string) => {
    hideVideo(playlistId, videoId)
    if (playlistVideoResume[id] === videoId) playlistControls(id).nextVideo()
  }
  const target = drag ? Math.min(order.length - 1, Math.max(0, drag.index + Math.round(drag.delta / rowStep.current))) : null
  const startDrag = (index: number) => (event: React.PointerEvent) => {
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const row = handle.closest('li')
    rowStep.current = (row?.offsetHeight ?? 42) + 6
    const startY = event.clientY
    setDrag({ index, delta: 0 })
    const onMove = (move: PointerEvent) => setDrag({ index, delta: move.clientY - startY })
    const onUp = (up: PointerEvent) => {
      handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp); handle.removeEventListener('pointercancel', onUp)
      const to = Math.min(order.length - 1, Math.max(0, index + Math.round((up.clientY - startY) / rowStep.current)))
      if (to !== index) {
        const next = [...order]
        next.splice(to, 0, ...next.splice(index, 1))
        setOrder(next)
        saveOrder(playlistId, next)
      }
      setDrag(null)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }
  return <ul className="order-list" aria-label="재생 순서">
    {order.map((videoId, index) => {
      const dragging = drag?.index === index
      let shift = 0
      if (drag && target !== null && !dragging) {
        if (index > drag.index && index <= target) shift = -rowStep.current
        else if (index < drag.index && index >= target) shift = rowStep.current
      }
      return <OrderRow key={videoId} videoId={videoId} title={titles[videoId] ?? titleCache[videoId] ?? ''} blocked={isBlockedVideo(videoId)} dragging={dragging} shift={dragging ? drag.delta : shift} onHandleDown={startDrag(index)} onDelete={() => remove(videoId)} />
    })}
    {/* said once rather than repeated on every marked row — the markers show WHICH, this says WHY */}
    {order.some((videoId) => isBlockedVideo(videoId)) && <li className="order-note">이 영상은 외부 재생이 불가합니다.</li>}
  </ul>
}
