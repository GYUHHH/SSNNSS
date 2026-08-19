import { timeAgo } from '../services/timeAgo'
import { autosize } from '../services/autosize'
import { useState } from 'react'
import { useRoomStore } from '../store'
import { isVisiting, myVisitorId, requireHandle } from '../services/social'
import CommentAvatar, { CommentName } from './CommentAvatar'

// The comment box a long press opens on a piece of furniture. Same storage and the same look as the guestbook
// — it is the guestbook, just keyed to this object.
export default function ItemComments() {
  const { commentTarget, setCommentTarget, furniture, guestbook, addGuestComment, removeGuestComment, openVideoPanel } = useRoomStore()
  const [text, setText] = useState('')
  if (!commentTarget) return null
  const item = furniture.find((entry) => entry.id === commentTarget)
  const comments = guestbook[commentTarget] ?? []
  const mine = myVisitorId()
  const submit = () => { if (!text.trim() || !requireHandle()) return; addGuestComment(commentTarget, text.trim()); setText('') }
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setCommentTarget(null)}>
    <section className="reaction-card item-comments comment-ui" aria-label="댓글">
      <div className="comment-head">
        <strong>{item?.name ?? ''}</strong>
        {/* 댓글 달린 영상액자는 클릭이 이 팝업으로 먼저 가므로, 수정 패널은 여기서 연다 (주인만) */}
        {!isVisiting() && item?.type.startsWith('video-frame') && <button type="button" className="edit-frame" aria-label="영상 수정" onClick={() => { setCommentTarget(null); openVideoPanel(commentTarget) }}>✎</button>}
      </div>
      <div className="guest-form">
        <textarea ref={autosize} rows={1} maxLength={200} value={text} onChange={(event) => { setText(event.target.value); autosize(event.currentTarget) }} placeholder="한마디 남겨주세요" onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} />
        <button type="button" onClick={submit}>게시</button>
      </div>
      <div className="guest-list">
        {comments.map((comment) => <article key={comment.id} className="guest-note comment-item">
          <CommentAvatar name={comment.name} photo={comment.photo} />
          <header><CommentName name={comment.name} /><time>{timeAgo(comment.createdAt)}</time>{(!isVisiting() || comment.visitor === mine) && <button type="button" aria-label="삭제" onClick={() => removeGuestComment(commentTarget, comment.id)}>×</button>}</header>
          <p>{comment.text}</p>
        </article>)}
      </div>
    </section>
  </div>
}
