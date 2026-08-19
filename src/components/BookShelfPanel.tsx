import { type FormEvent, useEffect, useState } from 'react'
import { type Book, useRoomStore } from '../store'
import { bookshelfTiers } from '../services/roomGrid'
import { isVisiting } from '../services/social'

const PencilIcon = () => <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 20 4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z" /><path d="m13.8 7.5 3 3" /></svg>
type BookDraft = Pick<Book, 'title' | 'visibility'> & { shelf: number }

export default function BookShelfPanel() {
  const { bookshelfOpen, books, openBook, addBook, deleteBook, updateBook } = useRoomStore()
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, BookDraft>>({})
  const [deleting, setDeleting] = useState<string | null>(null)
  // Closing the panel only stops it being drawn — the component stays mounted, so manage mode, its drafts and any
  // half-finished delete survived until the next open, and every book row came back as a title field instead of
  // the button that opens it. Reopening is a fresh start.
  useEffect(() => { if (!bookshelfOpen) { setManaging(false); setDrafts({}); setDeleting(null); setAdding(false) } }, [bookshelfOpen])
  if (!bookshelfOpen) return null
  const draftOf = (book: Book): BookDraft => drafts[book.id] ?? { title: book.title, visibility: book.visibility, shelf: book.shelf ?? 0 }
  const tiers = bookshelfTiers(books.map((book) => draftOf(book).shelf))
  const changed = books.filter((book) => { const draft = draftOf(book); return draft.title.trim() !== book.title || draft.visibility !== book.visibility || draft.shelf !== (book.shelf ?? 0) })
  const valid = changed.every((book) => !!draftOf(book).title.trim())
  const edit = (id: string, patch: Partial<BookDraft>) => setDrafts((current) => ({ ...current, [id]: { ...draftOf(books.find((book) => book.id === id)!), ...current[id], ...patch } }))
  const beginManaging = () => { setDrafts(Object.fromEntries(books.map((book) => [book.id, draftOf(book)]))); setManaging(true); setAdding(false); setDeleting(null) }
  const cancelManaging = () => { setManaging(false); setDrafts({}); setDeleting(null) }
  const saveChanges = () => {
    if (!changed.length || !valid) return
    changed.forEach((book) => { const draft = draftOf(book); updateBook(book.id, { ...draft, title: draft.title.trim() }) })
    cancelManaging()
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    addBook(title.trim(), 'private')
    setTitle('')
    setAdding(false)
  }
  return <>
    <section className="bookshelf-panel" aria-label="책장">
      {!isVisiting() && adding && <form className="new-book" onSubmit={submit}>
        <input aria-label="새 책 제목" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="새 책 제목" />
        <button type="submit">책 만들기</button>
      </form>}
      <div className="book-list">{books.map((book) => {
        const draft = draftOf(book)
        return <div key={book.id} className="book-row-wrap">
          {managing
            ? <div className="book-row"><i style={{ background: book.coverColor }} /><input className="book-title-input" aria-label={`${book.title} 제목`} maxLength={50} value={draft.title} onChange={(event) => edit(book.id, { title: event.target.value })} /></div>
            : <button className="book-row" type="button" onClick={() => openBook(book.id)}><i style={{ background: book.coverColor }} /><span>{book.title}</span></button>}
          {!isVisiting() && managing && <div className="book-controls"><button type="button" onClick={() => edit(book.id, { visibility: draft.visibility === 'public' ? 'private' : 'public' })}>{draft.visibility === 'public' ? '공개' : '비공개'}</button><button type="button" aria-label={`${book.title} 단 설정`} onClick={() => edit(book.id, { shelf: (draft.shelf + 1) % tiers })}>{draft.shelf + 1}단</button><button className="book-delete" type="button" onClick={() => setDeleting(book.id)}>삭제</button></div>}
          {!isVisiting() && deleting === book.id && <div className="delete-confirm"><span>‘{book.title}’ 삭제할까요?</span><button type="button" onClick={() => setDeleting(null)}>취소</button><button type="button" onClick={() => { deleteBook(book.id); setDeleting(null) }}>삭제</button></div>}
        </div>
      })}</div>
      {!isVisiting() && <div className="bookshelf-tools"><button className="book-create" type="button" aria-label="새 책 만들기" onClick={() => { setAdding(true); cancelManaging() }}>+</button><button className="book-manage" type="button" aria-label={managing ? '책 관리 닫기' : '책 관리'} onClick={() => managing ? cancelManaging() : beginManaging()}>{managing ? '×' : <PencilIcon />}</button>{managing && changed.length > 0 && <button className="book-save" type="button" disabled={!valid} onClick={saveChanges}>완료</button>}</div>}
    </section>
  </>
}
