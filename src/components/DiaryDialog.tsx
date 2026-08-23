import { autosize } from '../services/autosize'
import { timeAgo } from '../services/timeAgo'
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { type Book, type Entry, type EntryDraft, type Visibility, useRoomStore } from '../store'
import { HeartIcon, CommentIcon } from './ReactionIcons'
import { currentRoomHandle, isVisiting, myVisitorId, requireHandle, roomPath, toggleLike, uploadDataUrl } from '../services/social'
import { PhotoCropEditor } from './PhotoCropEditor'
import CommentAvatar, { CommentName } from './CommentAvatar'
import { t, tp } from '../services/i18n'

const today = () => new Date().toISOString().slice(0, 10)

const MoreIcon = () => <svg viewBox="0 0 24 24" width="27" height="27" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
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
      <header className="diary-head"><div className="diary-title"><button className="diary-back" type="button" aria-label={writing ? t('기록 목록으로') : t('닫기')} onClick={() => writing ? setWriting(false) : closeBook()}>←</button></div>{!isVisiting() && !writing && <div className="diary-head-actions"><button type="button" onClick={() => setWriting(true)}>{t('새 기록 작성')}</button></div>}</header>
      {writing ? <EntryForm book={book} onSave={(draft) => { addEntry(book.id, draft); setWriting(false) }} /> : <EntryList bookId={book.id} entries={book.entries} />}
    </section>
  </>
}

function EntryList({ bookId, entries }: { bookId: string; entries: Entry[] }) {
  return <>
    <div className="entry-list">
      {entries.length === 0 && <p className="entry-empty">{t('아직 기록이 없어요.')}</p>}
      {[...entries].reverse().map((entry) => <EntryItem key={entry.id} bookId={bookId} entry={entry} />)}
    </div>
  </>
}

// One record: photo full-bleed, then the like / comment / share row, then its comments.
function EntryItem({ bookId, entry }: { bookId: string; entry: Entry }) {
  const { likeTotals, myLikes, guestbook, deleteEntry } = useRoomStore()
  const [editing, setEditing] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // the server is authoritative, but its answer arrives after the click — hold it locally so the heart reacts at once
  const [pressed, setPressed] = useState<{ count: number; liked: boolean } | null>(null)
  const [shared, setShared] = useState(false)
  const [pop, setPop] = useState(false)
  const commentInput = useRef<HTMLTextAreaElement>(null)
  const menu = useRef<HTMLDivElement>(null)
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
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) { setMenuOpen(false); setConfirmingDelete(false) } }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])
  useEffect(() => { if (commentsOpen) requestAnimationFrame(() => commentInput.current?.focus()) }, [commentsOpen])
  return <article className="entry-item">
    <EntryGallery images={entry.images} />
    <div className="entry-actions">
      <button type="button" className={`${likes.liked ? 'liked' : ''}${pop ? ' pop' : ''}`} aria-label={t('좋아요')} onAnimationEnd={() => setPop(false)} onClick={like}><HeartIcon filled={likes.liked} />{likes.count > 0 && <span>{likes.count}</span>}</button>
      <button type="button" aria-label={t('댓글')} aria-expanded={commentsOpen} onClick={() => setCommentsOpen((open) => !open)}><CommentIcon />{(guestbook[entry.id] ?? []).length > 0 && <span>{(guestbook[entry.id] ?? []).length}</span>}</button>
      <button type="button" className={shared ? 'shared' : ''} aria-label={t('공유')} onClick={share}><ShareIcon /></button>
      {!isVisiting() && <div ref={menu} className="entry-more"><button type="button" className="entry-edit" aria-label={t('기록 메뉴')} aria-expanded={menuOpen} onClick={() => { setMenuOpen((open) => !open); setConfirmingDelete(false) }}><MoreIcon /></button>{menuOpen && <div className="entry-more-menu">{confirmingDelete ? <><span>{t('삭제할까요?')}</span><div><button type="button" onClick={() => setConfirmingDelete(false)}>{t('취소')}</button><button type="button" className="danger" onClick={() => deleteEntry(bookId, entry.id)}>{t('삭제')}</button></div></> : <><button type="button" onClick={() => { setMenuOpen(false); setEditing(true) }}>{t('수정')}</button><button type="button" className="danger" onClick={() => setConfirmingDelete(true)}>{t('삭제')}</button></>}</div>}</div>}
    </div>
    {entry.content && <p>{entry.content}</p>}
    {!isVisiting() && <small>{entry.visibility === 'public' ? t('공개 기록') : t('비공개 기록')}</small>}
    {commentsOpen && <EntryComments entry={entry} inputRef={commentInput} />}
    {editing && <EntryEditor bookId={bookId} entry={entry} onClose={() => setEditing(false)} />}
  </article>
}

// The edit popup only edits. Deletion lives in the record's overflow menu so the two actions cannot collide.
function EntryEditor({ bookId, entry, onClose }: { bookId: string; entry: Entry; onClose: () => void }) {
  const { updateEntry } = useRoomStore()
  const [content, setContent] = useState(entry.content)
  const [images, setImages] = useState<string[]>(entry.images)
  const [editing, setEditing] = useState<number | null>(null)
  const [visibility, setVisibility] = useState<Visibility>(entry.visibility)
  const save = (event: FormEvent) => { event.preventDefault(); updateEntry(bookId, entry.id, { content, images, visibility }); onClose() }
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
    <form className="entry-editor" onSubmit={save}>
      <strong>{t('기록 수정')}</strong>
      <DraftImages images={images} onEdit={setEditing} onRemove={(index) => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
      <RecordPhotoPicker className="entry-editor-file" label={t('사진 추가')} onAdd={(image) => setImages((current) => [...current, image])} onReplace={(before, after) => setImages((current) => current.map((image) => image === before ? after : image))} />
      <textarea ref={autosize} rows={1} value={content} onChange={(event) => { setContent(event.target.value); autosize(event.currentTarget) }} placeholder={t('내용')} />
      <fieldset><legend>{t('공개 설정')}</legend><label><input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> {t('공개')}</label><label><input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> {t('비공개')}</label></fieldset>
      <div className="entry-editor-foot">
        <button type="submit">{t('저장')}</button>
      </div>
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
  return <section className="entry-comments comment-ui" aria-label={t('댓글')}>
    <form className="entry-comment-form" onSubmit={submit}>
      <textarea ref={inputRef} rows={1} maxLength={200} value={text} onChange={(event) => { setText(event.target.value); autosize(event.currentTarget) }} placeholder={t('댓글')} />
      <button type="submit">{t('전송')}</button>
    </form>
    <div className="entry-comment-list">{comments.map((comment) => <article key={comment.id} className="entry-comment comment-item"><CommentAvatar name={comment.name} photo={comment.photo} /><header><CommentName name={comment.name} /><time>{timeAgo(comment.createdAt)}</time>{(!isVisiting() || comment.visitor === mine) && <button type="button" aria-label={t('댓글 삭제')} onClick={() => removeGuestComment(entry.id, comment.id)}>×</button>}</header><p>{comment.text}</p></article>)}</div>
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
    <RecordPhotoPicker label={t('사진')} onAdd={(image) => setImages((current) => [...current, image])} onReplace={(before, after) => setImages((current) => current.map((image) => image === before ? after : image))} />
    <DraftImages images={images} onEdit={setEditing} onRemove={(index) => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
    <label>{t('내용')}<textarea ref={autosize} rows={1} value={content} onChange={(event) => { setContent(event.target.value); autosize(event.currentTarget) }} /></label>
    <fieldset><legend>{t('공개 설정')}</legend><label><input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> {t('공개')}</label><label><input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> {t('비공개')}</label></fieldset>
    <button className="save-entry" type="submit">{t('저장')}</button>
    {editing !== null && images[editing] && <PhotoCropEditor source={assetUrl(images[editing])} onClose={() => setEditing(null)} onApply={(edited) => { const index = editing; setImages((current) => current.map((image, itemIndex) => itemIndex === index ? edited : image)); setEditing(null); void uploadDataUrl('records', edited).then((url) => { if (url) setImages((current) => current.map((image, itemIndex) => itemIndex === index && image === edited ? url : image)) }) }} />}
  </form>
}

function DraftImages({ images, onEdit, onRemove }: { images: string[]; onEdit: (index: number) => void; onRemove: (index: number) => void }) {
  if (!images.length) return null
  return <div className="draft-images">{images.map((image, index) => <div className="draft-image" key={`${image}-${index}`}><button type="button" onClick={() => onEdit(index)}><img src={assetUrl(image)} alt={tp('추가한 사진 {n}', { n: index + 1 })} /></button><button className="draft-image-remove" type="button" aria-label={tp('사진 {n} 제거', { n: index + 1 })} onClick={() => onRemove(index)}>×</button></div>)}</div>
}

function EntryGallery({ images }: { images: string[] }) {
  const [index, setIndex] = useState(0)
  const start = useRef<number | null>(null)
  useEffect(() => setIndex((current) => Math.min(current, Math.max(0, images.length - 1))), [images.length])
  if (!images.length) return null
  const move = (step: number) => setIndex((current) => Math.max(0, Math.min(images.length - 1, current + step)))
  return <div className="entry-gallery" onPointerDown={(event) => { start.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerUp={(event) => { if (start.current !== null) { const distance = event.clientX - start.current; if (Math.abs(distance) > 36) move(distance < 0 ? 1 : -1) } start.current = null }} onPointerCancel={() => { start.current = null }}>
    <img src={assetUrl(images[index])} alt={tp('기록 사진 {n}', { n: index + 1 })} />
    {images.length > 1 && <><button className="entry-gallery-prev" type="button" aria-label={t('이전 사진')} disabled={index === 0} onPointerDown={(event) => event.stopPropagation()} onClick={() => move(-1)}>‹</button><button className="entry-gallery-next" type="button" aria-label={t('다음 사진')} disabled={index === images.length - 1} onPointerDown={(event) => event.stopPropagation()} onClick={() => move(1)}>›</button><span className="entry-gallery-count">{index + 1} / {images.length}</span></>}
  </div>
}
