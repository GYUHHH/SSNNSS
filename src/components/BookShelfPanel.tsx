import { type FormEvent, useState } from 'react'
import { useRoomStore } from '../store'
import { bookshelfTiers } from '../services/roomGrid'
import { isVisiting } from '../services/social'

const PencilIcon = () => <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 20 4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z" /><path d="m13.8 7.5 3 3" /></svg>

export default function BookShelfPanel() {
  const { bookshelfOpen, books, openBook, addBook, deleteBook, updateBookVisibility, setBookShelf } = useRoomStore()
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  if (!bookshelfOpen) return null
  // the top tier is always empty and selectable — placing a book there is what grows the shelf
  const tiers = bookshelfTiers(books.map((book) => book.shelf ?? 0))
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
      <div className="book-list">{books.map((book) => <div key={book.id} className="book-row-wrap"><button className="book-row" type="button" onClick={() => openBook(book.id)}><i style={{ background: book.coverColor }} /><span>{book.title}</span></button>{!isVisiting() && managing && <div className="book-controls"><button type="button" onClick={() => updateBookVisibility(book.id, book.visibility === 'public' ? 'private' : 'public')}>{book.visibility === 'public' ? '공개' : '비공개'}</button><button type="button" aria-label={`${book.title} 단 설정`} onClick={() => setBookShelf(book.id, ((book.shelf ?? 0) + 1) % tiers)}>{(book.shelf ?? 0) + 1}단</button><button className="book-delete" type="button" onClick={() => setDeleting(book.id)}>삭제</button></div>}{!isVisiting() && deleting === book.id && <div className="delete-confirm"><span>‘{book.title}’ 삭제할까요?</span><button type="button" onClick={() => setDeleting(null)}>취소</button><button type="button" onClick={() => { deleteBook(book.id); setDeleting(null) }}>삭제</button></div>}</div>)}</div>
      {!isVisiting() && <div className="bookshelf-tools"><button type="button" aria-label="새 책 만들기" onClick={() => { setAdding(true); setManaging(false) }}>+</button><button type="button" aria-label={managing ? '책 관리 닫기' : '책 관리'} onClick={() => { setManaging((value) => !value); setAdding(false); setDeleting(null) }}>{managing ? '×' : <PencilIcon />}</button></div>}
    </section>
  </>
}
