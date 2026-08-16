import { useState } from 'react'
import { useRoomStore } from '../store'
import { isVisiting, myVisitorId, requireHandle } from '../services/social'

// The comment box a long press opens on a piece of furniture. Same storage and the same look as the guestbook
// — it is the guestbook, just keyed to this object.
export default function ItemComments() {
  const { commentTarget, setCommentTarget, furniture, guestbook, addGuestComment, removeGuestComment } = useRoomStore()
  const [text, setText] = useState('')
  if (!commentTarget) return null
  const item = furniture.find((entry) => entry.id === commentTarget)
  const comments = guestbook[commentTarget] ?? []
  const mine = myVisitorId()
  const submit = () => { if (!text.trim() || !requireHandle()) return; addGuestComment(commentTarget, text.trim()); setText('') }
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setCommentTarget(null)}>
    <section className="reaction-card" aria-label="댓글">
      <button className="close-ui" type="button" aria-label="닫기" onClick={() => setCommentTarget(null)}>×</button>
      <strong>{item?.name ?? ''}</strong>
      <div className="guest-form">
        <textarea maxLength={200} value={text} onChange={(event) => setText(event.target.value)} placeholder="한마디 남겨주세요" onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} />
        <button type="button" onClick={submit}>남기기</button>
      </div>
      <div className="guest-list">
        {comments.map((comment) => <article key={comment.id} className="guest-note">
          <header><strong>{comment.name}{comment.verified && ' ✓'}</strong><time>{comment.createdAt.slice(0, 10)}</time>{(!isVisiting() || comment.visitor === mine) && <button type="button" aria-label="삭제" onClick={() => removeGuestComment(commentTarget, comment.id)}>×</button>}</header>
          <p>{comment.text}</p>
        </article>)}
      </div>
    </section>
  </div>
}
