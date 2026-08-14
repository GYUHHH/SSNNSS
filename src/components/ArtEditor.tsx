import { useEffect, useMemo, useRef, useState } from 'react'
import { SRGBColorSpace, type Texture, TextureLoader } from 'three'
import { useOptionalRoomStore, useRoomStore } from '../store'

const PAPER = '#f6efe2'
const COLORS = ['#3f3a33', '#b96b52', '#d9a441', '#8a9c82', '#607b93', '#a06a8c', '#e8b4a0', '#f3ead9']

// artwork saved for this furniture id, as a three texture for the wall/frame plane (null → default look)
export function useArtTexture(id: string): Texture | null {
  const src = useOptionalRoomStore()?.artworks[id]
  const texture = useMemo(() => { if (!src) return null; const t = new TextureLoader().load(src); t.colorSpace = SRGBColorSpace; return t }, [src])
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
    if (existing) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, width, height); img.src = existing }
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
      <header><strong>그림 그리기</strong><button className="close-ui" type="button" aria-label="닫기" onClick={onClose}>×</button></header>
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
  const pick = (file: File) => {
    const img = new Image()
    img.onload = () => {
      // center-crop the photo to the frame's aspect, downscaled so localStorage stays small
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')!
      const scale = Math.max(width / img.width, height / img.height)
      ctx.drawImage(img, (width - img.width * scale) / 2, (height - img.height * scale) / 2, img.width * scale, img.height * scale)
      setArtwork(id, canvas.toDataURL('image/jpeg', 0.85))
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(file)
  }
  return <>
    <button type="button" onClick={() => inputRef.current?.click()}>사진 넣기</button>
    {artworks[id] && <button type="button" onClick={() => setArtwork(id, null)}>사진 제거</button>}
    <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) pick(file); event.target.value = '' }} />
  </>
}

export function BannerTextInput({ id, artwork, saveArtwork }: { id: string; artwork?: string; saveArtwork?: (id: string, text: string | null) => void }) {
  const store = useOptionalRoomStore()
  const [text, setText] = useState(artwork ?? store?.artworks[id] ?? 'WELCOME ♥')
  return <div className="banner-input">
    <input type="text" maxLength={40} value={text} onChange={(event) => setText(event.target.value)} placeholder="배너 문구" />
    <button type="button" onClick={() => (saveArtwork ?? store?.setArtwork)?.(id, text.trim() || null)}>적용</button>
  </div>
}

export function VideoPickButton({ id }: { id: string }) {
  const { videoFrames, setVideoClip } = useRoomStore()
  const inputRef = useRef<HTMLInputElement>(null)
  return <>
    <button type="button" onClick={() => inputRef.current?.click()}>영상 넣기</button>
    {videoFrames[id] && <button type="button" onClick={() => setVideoClip(id, null)}>영상 제거</button>}
    <input ref={inputRef} type="file" accept="video/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) setVideoClip(id, file); event.target.value = '' }} />
  </>
}

export function VideoLinkInput({ id }: { id: string }) {
  const { videoLinks, setVideoLink } = useRoomStore()
  const [text, setText] = useState('')
  const [failed, setFailed] = useState(false)
  const current = videoLinks[id]
  const apply = () => { if (!setVideoLink(id, text)) { setFailed(true); return } setFailed(false); setText('') }
  return <div className="video-link">
    {current && <iframe title="유튜브 재생" src={`https://www.youtube.com/embed/${current}`} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />}
    <div className="banner-input">
      <input type="text" value={text} onChange={(event) => { setText(event.target.value); setFailed(false) }} placeholder="유튜브 링크 붙여넣기" onKeyDown={(event) => { if (event.key === 'Enter') apply() }} />
      <button type="button" onClick={apply}>넣기</button>
    </div>
    {failed && <small className="video-link-error">유튜브 주소를 인식하지 못했어요.</small>}
    {current && <button type="button" onClick={() => setVideoLink(id, null)}>링크 지우기</button>}
  </div>
}
