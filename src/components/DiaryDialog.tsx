import { type ChangeEvent, type FormEvent, useRef, useState } from 'react'
import { type Book, type Entry, type EntryDraft, type Visibility, useRoomStore } from '../store'

const today = () => new Date().toISOString().slice(0, 10)
const assetUrl = (source: string) => source.startsWith('/') ? `${location.hostname.endsWith('.github.io') ? `${import.meta.env.BASE_URL}public/` : import.meta.env.BASE_URL}${source.slice(1)}` : source

export default function DiaryDialog() {
  const { books, openBookId, closeBook, addEntry, updateBookVisibility } = useRoomStore()
  const book = books.find((item) => item.id === openBookId)
  const [writing, setWriting] = useState(false)
  if (!book) return null
  return <>
    <section className="diary" aria-label={book.title}>
      <button className="close-ui" type="button" aria-label="닫기" onClick={closeBook}>×</button>
      <header className="diary-head"><div><span>기록장</span><h2>{book.title}</h2></div><div className="diary-head-actions">{!writing && <button type="button" onClick={() => setWriting(true)}>새 기록 작성</button>}<label>책 공개 설정 <select value={book.visibility} onChange={(event) => updateBookVisibility(book.id, event.target.value as Visibility)}><option value="private">비공개</option><option value="public">공개</option></select></label></div></header>
      {writing ? <EntryForm book={book} onSave={(draft) => { addEntry(book.id, draft); setWriting(false) }} /> : <EntryList bookId={book.id} entries={book.entries} />}
    </section>
  </>
}

function EntryList({ bookId, entries }: { bookId: string; entries: Entry[] }) {
  const { deleteEntry } = useRoomStore()
  const [deleting, setDeleting] = useState<string | null>(null)
  return <>
    <div className="entry-list">
      {entries.length === 0 && <p className="entry-empty">아직 기록이 없어요.</p>}
      {[...entries].reverse().map((entry) => <article key={entry.id} className="entry-item">
        <div className="entry-item-head"><time>{entry.date}</time><button type="button" onClick={() => setDeleting(entry.id)}>삭제</button></div>
        {deleting === entry.id && <div className="delete-confirm entry-delete-confirm"><span>‘{entry.title}’ 삭제할까요?</span><button type="button" onClick={() => setDeleting(null)}>취소</button><button type="button" onClick={() => { deleteEntry(bookId, entry.id); setDeleting(null) }}>삭제</button></div>}
        <h3>{entry.title}</h3>
        {entry.images[0] && <img src={assetUrl(entry.images[0])} alt="기록 사진" />}
        {entry.content && <p>{entry.content}</p>}
        <small>{entry.visibility === 'public' ? '공개 기록' : '비공개 기록'}</small>
        <EntryComments bookId={bookId} entry={entry} />
      </article>)}
    </div>
  </>
}

function EntryComments({ bookId, entry }: { bookId: string; entry: Entry }) {
  const { addEntryComment, removeEntryComment } = useRoomStore()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); if (!text.trim()) return; addEntryComment(bookId, entry.id, name, text.trim()); setText('') }
  return <section className="entry-comments" aria-label={`${entry.title} 댓글`}>
    <form className="entry-comment-form" onSubmit={submit}><input maxLength={12} value={name} onChange={(event) => setName(event.target.value)} placeholder="이름 (비우면 익명)" /><textarea maxLength={200} value={text} onChange={(event) => setText(event.target.value)} placeholder="댓글" /><button type="submit">댓글 쓰기</button></form>
    <div className="entry-comment-list">{(entry.comments ?? []).map((comment) => <article key={comment.id} className="entry-comment"><header><strong>{comment.name}</strong><time>{comment.createdAt.slice(0, 10)}</time><button type="button" aria-label="댓글 삭제" onClick={() => removeEntryComment(bookId, entry.id, comment.id)}>×</button></header><p>{comment.text}</p></article>)}</div>
  </section>
}

function EntryForm({ book, onSave }: { book: Book; onSave: (entry: EntryDraft) => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [date, setDate] = useState(today)
  const [visibility, setVisibility] = useState<Visibility>(book.visibility)
  const [images, setImages] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const addImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    Promise.all(files.map((file) => new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file) }))).then((sources) => setImages((current) => [...current, ...sources]))
    event.target.value = ''
  }
  const submit = (event: FormEvent) => { event.preventDefault(); if (!title.trim()) return; onSave({ title: title.trim(), content, date, images, visibility }) }
  return <form className="entry-form" onSubmit={submit}>
    <label>날짜<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
    <label>제목<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>사진<input type="file" accept="image/*" multiple onChange={addImages} /></label>
    {images.length > 0 && <div className="draft-images">{images.map((image, index) => <button key={image} type="button" onClick={() => setEditing(image)}><img src={image} alt={`추가한 사진 ${index + 1}`} /></button>)}</div>}
    <label>내용<textarea value={content} onChange={(event) => setContent(event.target.value)} /></label>
    <fieldset><legend>공개 설정</legend><label><input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> 공개</label><label><input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> 비공개</label></fieldset>
    <button className="save-entry" type="submit">저장</button>
    {editing && <PhotoEditor source={editing} onClose={() => setEditing(null)} onApply={(edited) => { setImages((current) => current.map((image) => image === editing ? edited : image)); setEditing(null) }} />}
  </form>
}

function PhotoEditor({ source, onClose, onApply }: { source: string; onClose: () => void; onApply: (image: string) => void }) {
  const crop = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const start = useRef<{ x: number; y: number } | null>(null)
  const apply = () => {
    if (!crop.current || !image.current) return
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600
    const factor = canvas.width / crop.current.clientWidth
    const base = Math.max(crop.current.clientWidth / image.current.naturalWidth, crop.current.clientHeight / image.current.naturalHeight)
    const width = image.current.naturalWidth * base * scale * factor; const height = image.current.naturalHeight * base * scale * factor
    canvas.getContext('2d')?.drawImage(image.current, canvas.width / 2 + position.x * factor - width / 2, canvas.height / 2 + position.y * factor - height / 2, width, height)
    onApply(canvas.toDataURL('image/jpeg', 0.92))
  }
  return <div className="photo-editor-overlay"><section className="photo-editor"><button className="close-ui" type="button" aria-label="닫기" onClick={onClose}>×</button><div ref={crop} className="crop-area" onPointerDown={(event) => { start.current = { x: event.clientX - position.x, y: event.clientY - position.y }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => start.current && setPosition({ x: event.clientX - start.current.x, y: event.clientY - start.current.y })} onPointerUp={() => { start.current = null }}><img ref={image} src={source} alt="사진 조정" style={{ transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${scale})` }} /></div><label>확대<input type="range" min="1" max="2.5" step="0.01" value={scale} onChange={(event) => setScale(Number(event.target.value))} /></label><button type="button" onClick={apply}>적용</button></section></div>
}
