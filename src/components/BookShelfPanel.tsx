import { type FormEvent, useState } from 'react'
import { useRoomStore, type Visibility } from '../store'

export default function BookShelfPanel() {
  const { bookshelfOpen, books, openBook, addBook, deleteBook, clearSelection } = useRoomStore()
  const [title, setTitle] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('private')
  const [deleting, setDeleting] = useState<string | null>(null)
  if (!bookshelfOpen) return null
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    addBook(title.trim(), visibility)
    setTitle('')
  }
  return <>
    <section className="bookshelf-panel" aria-label="책장">
      <button className="close-ui" type="button" aria-label="닫기" onClick={clearSelection}>×</button>
      <h2>책장</h2>
      <div className="book-list">{books.map((book) => <div key={book.id} className="book-row-wrap"><button className="book-row" type="button" onClick={() => openBook(book.id)}><i style={{ background: book.coverColor }} /><span>{book.title}</span><small>{book.visibility === 'public' ? '공개' : '비공개'}</small></button><button className="book-delete" type="button" onClick={() => setDeleting(book.id)}>삭제</button>{deleting === book.id && <div className="delete-confirm"><span>‘{book.title}’ 삭제할까요?</span><button type="button" onClick={() => setDeleting(null)}>취소</button><button type="button" onClick={() => { deleteBook(book.id); setDeleting(null) }}>삭제</button></div>}</div>)}</div>
      <form className="new-book" onSubmit={submit}>
        <input aria-label="새 책 제목" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="새 책 제목" />
        <select aria-label="새 책 공개 설정" value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}><option value="private">비공개</option><option value="public">공개</option></select>
        <button type="submit">책 만들기</button>
      </form>
    </section>
  </>
}
