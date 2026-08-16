import { type ChangeEvent, type FormEvent, useRef, useState } from 'react'
import { type Book, type Entry, type EntryDraft, type Visibility, useRoomStore } from '../store'
import { currentRoomHandle, isVisiting, myVisitorId, requireHandle, roomPath, toggleLike, uploadMedia } from '../services/social'

const today = () => new Date().toISOString().slice(0, 10)

const HeartIcon = ({ filled }: { filled: boolean }) => <svg viewBox="0 0 24 24" width="27" height="27" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20.4 3.9 12.6a4.9 4.9 0 0 1 0-7 4.9 4.9 0 0 1 7 0l1.1 1.1 1.1-1.1a4.9 4.9 0 0 1 7 0 4.9 4.9 0 0 1 0 7Z" /></svg>
const CommentIcon = () => <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.4-.6L3 21l1.8-5a8.2 8.2 0 0 1-.8-3.5 8.4 8.4 0 0 1 8.5-8.4 8.4 8.4 0 0 1 8.5 8.4Z" /></svg>
const EditIcon = () => <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16.4 3.6a2.3 2.3 0 0 1 3.2 3.2L7.5 18.9l-4.2 1 1-4.2Z" /><path d="M14.6 5.4l4 4" /></svg>
const ShareIcon = () => <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.5 3.5 2.5 10.2l7.6 2.9 2.9 7.6Z" /><path d="M10.1 13.1 21.5 3.5" /></svg>
const assetUrl = (source: string) => source.startsWith('/') ? `${location.hostname.endsWith('.github.io') ? `${import.meta.env.BASE_URL}public/` : import.meta.env.BASE_URL}${source.slice(1)}` : source

export default function DiaryDialog() {
  const { books, openBookId, closeBook, addEntry, updateBookVisibility } = useRoomStore()
  const book = books.find((item) => item.id === openBookId)
  const [writing, setWriting] = useState(false)
  if (!book) return null
  return <>
    <section className="diary" aria-label={book.title}>
      <button className="close-ui" type="button" aria-label="닫기" onClick={closeBook}>×</button>
      <header className="diary-head"><div className="diary-title">{writing && <button className="diary-back" type="button" aria-label="뒤로" onClick={() => setWriting(false)}>←</button>}<div><span>기록장</span><h2>{book.title}</h2></div></div>{!isVisiting() && <div className="diary-head-actions">{!writing && <button type="button" onClick={() => setWriting(true)}>새 기록 작성</button>}<label>책 공개 설정 <select value={book.visibility} onChange={(event) => updateBookVisibility(book.id, event.target.value as Visibility)}><option value="private">비공개</option><option value="public">공개</option></select></label></div>}</header>
      {writing ? <EntryForm book={book} onSave={(draft) => { addEntry(book.id, draft); setWriting(false) }} /> : <EntryList bookId={book.id} entries={book.entries} />}
    </section>
  </>
}

function EntryList({ bookId, entries }: { bookId: string; entries: Entry[] }) {
  return <>
    <div className="entry-list">
      {entries.length === 0 && <p className="entry-empty">아직 기록이 없어요.</p>}
      {[...entries].reverse().map((entry) => <EntryItem key={entry.id} bookId={bookId} entry={entry} />)}
    </div>
  </>
}

// One record: photo full-bleed, then the like / comment / share row, then its comments.
function EntryItem({ bookId, entry }: { bookId: string; entry: Entry }) {
  const { likeTotals, myLikes, guestbook } = useRoomStore()
  const [editing, setEditing] = useState(false)
  // the server is authoritative, but its answer arrives after the click — hold it locally so the heart reacts at once
  const [pressed, setPressed] = useState<{ count: number; liked: boolean } | null>(null)
  const [shared, setShared] = useState(false)
  const [pop, setPop] = useState(false)
  const commentInput = useRef<HTMLTextAreaElement>(null)
  const likes = pressed ?? { count: likeTotals[entry.id] ?? 0, liked: myLikes.includes(entry.id) }
  // optimistic: paint the new state now, ask the server after, and put it back if the server disagrees
  const like = () => {
    if (!requireHandle()) return
    const before = likes
    setPressed({ count: Math.max(0, before.count + (before.liked ? -1 : 1)), liked: !before.liked })
    setPop(true)
    void toggleLike(entry.id).then((result) => setPressed(result ?? before))
  }
  const share = () => {
    const handle = currentRoomHandle()
    if (!handle) return
    void navigator.clipboard?.writeText(`${location.origin}${roomPath(handle)}`)
    setShared(true)
    setTimeout(() => setShared(false), 1400)
  }
  return <article className="entry-item">
    {entry.images[0] && <img src={assetUrl(entry.images[0])} alt="기록 사진" />}
    <div className="entry-actions">
      <button type="button" className={`${likes.liked ? 'liked' : ''}${pop ? ' pop' : ''}`} aria-label="좋아요" onAnimationEnd={() => setPop(false)} onClick={like}><HeartIcon filled={likes.liked} />{likes.count > 0 && <span>{likes.count}</span>}</button>
      <button type="button" aria-label="댓글" onClick={() => commentInput.current?.focus()}><CommentIcon />{(guestbook[entry.id] ?? []).length > 0 && <span>{(guestbook[entry.id] ?? []).length}</span>}</button>
      <button type="button" className={shared ? 'shared' : ''} aria-label="공유" onClick={share}><ShareIcon /></button>
      {!isVisiting() && <button type="button" className="entry-edit" aria-label="수정" onClick={() => setEditing(true)}><EditIcon /></button>}
    </div>
    {entry.content && <p>{entry.content}</p>}
    {!isVisiting() && <small>{entry.visibility === 'public' ? '공개 기록' : '비공개 기록'}</small>}
    <EntryComments entry={entry} inputRef={commentInput} />
    {editing && <EntryEditor bookId={bookId} entry={entry} onClose={() => setEditing(false)} />}
  </article>
}

// The pencil's popup: swap the photo, rewrite the words, flip who can see it — or delete the record outright.
function EntryEditor({ bookId, entry, onClose }: { bookId: string; entry: Entry; onClose: () => void }) {
  const { updateEntry, deleteEntry } = useRoomStore()
  const [content, setContent] = useState(entry.content)
  const [images, setImages] = useState<string[]>(entry.images)
  const [visibility, setVisibility] = useState<Visibility>(entry.visibility)
  const [confirming, setConfirming] = useState(false)
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void uploadMedia(`records/${crypto.randomUUID()}`, file).then((url) => { if (url) setImages([url]) })
    event.target.value = ''
  }
  const save = (event: FormEvent) => { event.preventDefault(); updateEntry(bookId, entry.id, { content, images, visibility }); onClose() }
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
    <form className="entry-editor" onSubmit={save}>
      <button className="close-ui" type="button" aria-label="닫기" onClick={onClose}>×</button>
      <strong>기록 수정</strong>
      {images[0] && <img src={assetUrl(images[0])} alt="기록 사진" />}
      <label className="entry-editor-file">사진 바꾸기<input type="file" accept="image/*" onChange={pick} /></label>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="내용" />
      <fieldset><legend>공개 설정</legend><label><input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> 공개</label><label><input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> 비공개</label></fieldset>
      <div className="entry-editor-foot">
        <button type="button" className="entry-editor-delete" onClick={() => setConfirming(true)}>삭제</button>
        <button type="submit">저장</button>
      </div>
      {confirming && <div className="delete-confirm"><span>이 기록을 삭제할까요?</span><button type="button" onClick={() => setConfirming(false)}>취소</button><button type="button" onClick={() => { deleteEntry(bookId, entry.id); onClose() }}>삭제</button></div>}
    </form>
  </div>
}

function EntryComments({ entry, inputRef }: { entry: Entry; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const { guestbook, addGuestComment, removeGuestComment } = useRoomStore()
  const [text, setText] = useState('')
  const comments = guestbook[entry.id] ?? []
  const mine = myVisitorId()
  // grow with the text; CSS caps the height at three lines and takes over with a scrollbar
  const fit = (element: HTMLTextAreaElement | null) => { if (!element) return; element.style.height = 'auto'; element.style.height = `${element.scrollHeight}px` }
  const submit = (event: FormEvent) => { event.preventDefault(); if (!text.trim() || !requireHandle()) return; addGuestComment(entry.id, text.trim()); setText(''); if (inputRef.current) inputRef.current.style.height = 'auto' }
  return <section className="entry-comments" aria-label="댓글">
    <form className="entry-comment-form" onSubmit={submit}>
      <textarea ref={inputRef} rows={1} maxLength={200} value={text} onChange={(event) => { setText(event.target.value); fit(event.currentTarget) }} placeholder="댓글" />
      <button type="submit">전송</button>
    </form>
    <div className="entry-comment-list">{comments.map((comment) => <article key={comment.id} className="entry-comment"><header><strong>{comment.name}{comment.verified && ' ✓'}</strong><time>{comment.createdAt.slice(0, 10)}</time>{(!isVisiting() || comment.visitor === mine) && <button type="button" aria-label="댓글 삭제" onClick={() => removeGuestComment(entry.id, comment.id)}>×</button>}</header><p>{comment.text}</p></article>)}</div>
  </section>
}

function EntryForm({ book, onSave }: { book: Book; onSave: (entry: EntryDraft) => void }) {
  const [content, setContent] = useState('')
  const [visibility, setVisibility] = useState<Visibility>(book.visibility)
  const [images, setImages] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const addImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    // upload first, keep the URL — a data URL here would be megabytes inside the room's saved data
    Promise.all(files.map((file) => uploadMedia(`records/${crypto.randomUUID()}`, file).then((url) => url ?? '')))
      .then((sources) => setImages((current) => [...current, ...sources.filter(Boolean)]))
    event.target.value = ''
  }
  // a record is its photo and its words now — no title, and the date is simply the day it was written
  const submit = (event: FormEvent) => { event.preventDefault(); if (!content.trim() && images.length === 0) return; onSave({ title: '', content, date: today(), images, visibility }) }
  return <form className="entry-form" onSubmit={submit}>
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
