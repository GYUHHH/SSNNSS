import { autosize } from '../services/autosize'
import { timeAgo } from '../services/timeAgo'
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { type Book, type Entry, type EntryDraft, type Visibility, useRoomStore } from '../store'
import { HeartIcon, CommentIcon } from './ReactionIcons'
import { currentRoomHandle, isVisiting, myVisitorId, requireHandle, roomPath, toggleLike, uploadDataUrl } from '../services/social'
import { PhotoCropEditor } from './PhotoCropEditor'

const today = () => new Date().toISOString().slice(0, 10)

const EditIcon = () => <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16.4 3.6a2.3 2.3 0 0 1 3.2 3.2L7.5 18.9l-4.2 1 1-4.2Z" /><path d="M14.6 5.4l4 4" /></svg>
const ShareIcon = () => <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.5 3.5 2.5 10.2l7.6 2.9 2.9 7.6Z" /><path d="M10.1 13.1 21.5 3.5" /></svg>
const assetUrl = (source: string) => source.startsWith('/') ? `${import.meta.env.BASE_URL}${source.slice(1)}` : source

function RecordPhotoPicker({ className, label, onAdd, onReplace }: { className?: string; label: string; onAdd: (image: string) => void; onReplace: (before: string, after: string) => void }) {
  const [queue, setQueue] = useState<string[]>([])
  const queueRef = useRef(queue); queueRef.current = queue
  useEffect(() => () => queueRef.current.forEach(URL.revokeObjectURL), [])
  const next = () => setQueue((current) => { URL.revokeObjectURL(current[0]); return current.slice(1) })
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    setQueue((current) => [...current, ...[...(event.target.files ?? [])].map((file) => URL.createObjectURL(file))])
    event.target.value = ''
  }
  const apply = (edited: string) => {
    onAdd(edited); next()
    void uploadDataUrl('records', edited).then((url) => { if (url) onReplace(edited, url) })
  }
  return <>
    <label className={className}>{label}<input type="file" accept="image/*" multiple onChange={pick} /></label>
    {queue[0] && <PhotoCropEditor source={queue[0]} onClose={next} onApply={apply} />}
  </>
}

export default function DiaryDialog() {
  const { books, openBookId, closeBook, addEntry } = useRoomStore()
  const book = books.find((item) => item.id === openBookId)
  const [writing, setWriting] = useState(false)
  if (!book) return null
  return <>
    <section className="diary" aria-label={book.title}>
      <header className="diary-head"><div className="diary-title"><button className="diary-back" type="button" aria-label={writing ? '기록 목록으로' : '책장으로'} onClick={() => writing ? setWriting(false) : closeBook()}>←</button><h2>{book.title}</h2></div>{!isVisiting() && !writing && <div className="diary-head-actions"><button type="button" onClick={() => setWriting(true)}>새 기록 작성</button></div>}</header>
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
    <EntryGallery images={entry.images} />
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
  const [editing, setEditing] = useState<number | null>(null)
  const [visibility, setVisibility] = useState<Visibility>(entry.visibility)
  const [confirming, setConfirming] = useState(false)
  const save = (event: FormEvent) => { event.preventDefault(); updateEntry(bookId, entry.id, { content, images, visibility }); onClose() }
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
    <form className="entry-editor" onSubmit={save}>
      <button className="close-ui" type="button" aria-label="닫기" onClick={onClose}>×</button>
      <strong>기록 수정</strong>
      <DraftImages images={images} onEdit={setEditing} onRemove={(index) => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
      <RecordPhotoPicker className="entry-editor-file" label="사진 추가" onAdd={(image) => setImages((current) => [...current, image])} onReplace={(before, after) => setImages((current) => current.map((image) => image === before ? after : image))} />
      <textarea ref={autosize} rows={1} value={content} onChange={(event) => { setContent(event.target.value); autosize(event.currentTarget) }} placeholder="내용" />
      <fieldset><legend>공개 설정</legend><label><input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> 공개</label><label><input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> 비공개</label></fieldset>
      <div className="entry-editor-foot">
        <button type="button" className="entry-editor-delete" onClick={() => setConfirming(true)}>삭제</button>
        <button type="submit">저장</button>
      </div>
      {confirming && <div className="delete-confirm"><span>이 기록을 삭제할까요?</span><button type="button" onClick={() => setConfirming(false)}>취소</button><button type="button" onClick={() => { deleteEntry(bookId, entry.id); onClose() }}>삭제</button></div>}
    </form>
    {editing !== null && images[editing] && <PhotoCropEditor source={assetUrl(images[editing])} onClose={() => setEditing(null)} onApply={(edited) => { const index = editing; setImages((current) => current.map((image, itemIndex) => itemIndex === index ? edited : image)); setEditing(null); void uploadDataUrl('records', edited).then((url) => { if (url) setImages((current) => current.map((image, itemIndex) => itemIndex === index && image === edited ? url : image)) }) }} />}
  </div>
}

function EntryComments({ entry, inputRef }: { entry: Entry; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const { guestbook, addGuestComment, removeGuestComment } = useRoomStore()
  const [text, setText] = useState('')
  const comments = guestbook[entry.id] ?? []
  const mine = myVisitorId()
  const submit = (event: FormEvent) => { event.preventDefault(); if (!text.trim() || !requireHandle()) return; addGuestComment(entry.id, text.trim()); setText(''); if (inputRef.current) inputRef.current.style.height = 'auto' }
  return <section className="entry-comments" aria-label="댓글">
    <form className="entry-comment-form" onSubmit={submit}>
      <textarea ref={inputRef} rows={1} maxLength={200} value={text} onChange={(event) => { setText(event.target.value); autosize(event.currentTarget) }} placeholder="댓글" />
      <button type="submit">전송</button>
    </form>
    <div className="entry-comment-list">{comments.map((comment) => <article key={comment.id} className="entry-comment"><header><strong>{comment.name}</strong><time>{timeAgo(comment.createdAt)}</time>{(!isVisiting() || comment.visitor === mine) && <button type="button" aria-label="댓글 삭제" onClick={() => removeGuestComment(entry.id, comment.id)}>×</button>}</header><p>{comment.text}</p></article>)}</div>
  </section>
}

function EntryForm({ book, onSave }: { book: Book; onSave: (entry: EntryDraft) => void }) {
  const [content, setContent] = useState('')
  const [visibility, setVisibility] = useState<Visibility>(book.visibility)
  const [images, setImages] = useState<string[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  // a record is its photo and its words now — no title, and the date is simply the day it was written
  const submit = (event: FormEvent) => { event.preventDefault(); if (!content.trim() && images.length === 0) return; onSave({ title: '', content, date: today(), images, visibility }) }
  return <form className="entry-form" onSubmit={submit}>
    <RecordPhotoPicker label="사진" onAdd={(image) => setImages((current) => [...current, image])} onReplace={(before, after) => setImages((current) => current.map((image) => image === before ? after : image))} />
    <DraftImages images={images} onEdit={setEditing} onRemove={(index) => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
    <label>내용<textarea ref={autosize} rows={1} value={content} onChange={(event) => { setContent(event.target.value); autosize(event.currentTarget) }} /></label>
    <fieldset><legend>공개 설정</legend><label><input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> 공개</label><label><input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> 비공개</label></fieldset>
    <button className="save-entry" type="submit">저장</button>
    {editing !== null && images[editing] && <PhotoCropEditor source={assetUrl(images[editing])} onClose={() => setEditing(null)} onApply={(edited) => { const index = editing; setImages((current) => current.map((image, itemIndex) => itemIndex === index ? edited : image)); setEditing(null); void uploadDataUrl('records', edited).then((url) => { if (url) setImages((current) => current.map((image, itemIndex) => itemIndex === index && image === edited ? url : image)) }) }} />}
  </form>
}

function DraftImages({ images, onEdit, onRemove }: { images: string[]; onEdit: (index: number) => void; onRemove: (index: number) => void }) {
  if (!images.length) return null
  return <div className="draft-images">{images.map((image, index) => <div className="draft-image" key={`${image}-${index}`}><button type="button" onClick={() => onEdit(index)}><img src={assetUrl(image)} alt={`추가한 사진 ${index + 1}`} /></button><button className="draft-image-remove" type="button" aria-label={`사진 ${index + 1} 제거`} onClick={() => onRemove(index)}>×</button></div>)}</div>
}

function EntryGallery({ images }: { images: string[] }) {
  const [index, setIndex] = useState(0)
  const start = useRef<number | null>(null)
  useEffect(() => setIndex((current) => Math.min(current, Math.max(0, images.length - 1))), [images.length])
  if (!images.length) return null
  const move = (step: number) => setIndex((current) => Math.max(0, Math.min(images.length - 1, current + step)))
  return <div className="entry-gallery" onPointerDown={(event) => { start.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerUp={(event) => { if (start.current !== null) { const distance = event.clientX - start.current; if (Math.abs(distance) > 36) move(distance < 0 ? 1 : -1) } start.current = null }} onPointerCancel={() => { start.current = null }}>
    <img src={assetUrl(images[index])} alt={`기록 사진 ${index + 1}`} />
    {images.length > 1 && <><button className="entry-gallery-prev" type="button" aria-label="이전 사진" disabled={index === 0} onClick={() => move(-1)}>‹</button><button className="entry-gallery-next" type="button" aria-label="다음 사진" disabled={index === images.length - 1} onClick={() => move(1)}>›</button><span>{index + 1} / {images.length}</span></>}
  </div>
}
