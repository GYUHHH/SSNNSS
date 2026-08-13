import { useEffect, useState } from 'react'
import { useRoomStore } from '../store'
import { DrawingEditor, PhotoPickButton } from './ArtEditor'

// which artwork panel a furniture type opens (null → none)
export const artworkKindOf = (type: string) => type === 'photo' || type.startsWith('photo-frame') ? 'frame' : type === 'poster' || type.startsWith('wall-art') ? 'poster' : type === 'guestbook' ? 'guestbook' : type === 'whiteboard' ? 'poster' : null

// side panel on the right — the room slides left while it is open; tall artwork scrolls instead of cropping
export default function ArtworkOverlay() {
  const { selectedObject, clearSelection, artworks, furniture } = useRoomStore()
  const [drawing, setDrawing] = useState(false)
  useEffect(() => setDrawing(false), [selectedObject])
  if (!selectedObject) return null
  const item = furniture.find((value) => value.id === selectedObject)
  const kind = artworkKindOf(item?.type ?? '')
  if (!kind) return null
  if (kind === 'guestbook') return <Guestbook id={selectedObject} onClose={clearSelection} />
  const frame = kind === 'frame'
  const art = artworks[selectedObject]
  const [width, height] = frame
    ? item?.type === 'photo' ? [464, 336] : [400, 400]
    : item?.type === 'poster' ? [360, 555] : item?.type === 'whiteboard' ? [420, 300] : [360, Math.round(360 * (item?.footprint.depth ?? 3) / (item?.footprint.width ?? 2))]
  return <aside className="art-panel">
    <header><strong>{item?.name ?? (frame ? '사진' : '포스터')}</strong><button className="close-ui" type="button" aria-label="닫기" onClick={clearSelection}>×</button></header>
    {drawing
      ? <DrawingEditor id={selectedObject} width={width} height={height} onClose={() => setDrawing(false)} />
      : <>
        {art ? <img className="art-view" src={art} alt={frame ? '사진' : '그림'} /> : <div className={frame ? 'art-view sea' : 'art-view poster-art'} />}
        <div className="art-meta"><p>{frame ? (art ? '나의 사진' : item?.type === 'photo' ? '여름의 바다' : '빈 액자') : art ? '나의 그림' : item?.type === 'poster' ? 'SONDÉ' : '빈 포스터'}</p><div className="art-actions">{frame ? <PhotoPickButton id={selectedObject} width={width} height={height} /> : <button type="button" onClick={() => setDrawing(true)}>그림 그리기</button>}</div></div>
      </>}
  </aside>
}

function Guestbook({ id, onClose }: { id: string; onClose: () => void }) {
  const { guestbook, addGuestComment, removeGuestComment } = useRoomStore()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const comments = guestbook[id] ?? []
  const submit = () => { if (!text.trim()) return; addGuestComment(id, name, text.trim()); setText('') }
  return <aside className="art-panel">
    <header><strong>방명록</strong><button className="close-ui" type="button" aria-label="닫기" onClick={onClose}>×</button></header>
    <div className="guest-form">
      <input type="text" maxLength={12} value={name} onChange={(event) => setName(event.target.value)} placeholder="이름 (비우면 익명)" />
      <textarea maxLength={200} value={text} onChange={(event) => setText(event.target.value)} placeholder="한마디 남겨주세요" onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} />
      <button type="button" onClick={submit}>남기기</button>
    </div>
    <div className="guest-list">
      {comments.length === 0 && <p className="entry-empty">댓글 없음</p>}
      {comments.map((comment) => <article key={comment.id} className="guest-note">
        <header><strong>{comment.name}</strong><time>{comment.createdAt.slice(0, 10)}</time><button type="button" aria-label="삭제" onClick={() => removeGuestComment(id, comment.id)}>×</button></header>
        <p>{comment.text}</p>
      </article>)}
    </div>
  </aside>
}
