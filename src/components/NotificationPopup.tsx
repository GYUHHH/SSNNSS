import { useEffect } from 'react'
import { isVisiting, myVisitorId } from '../services/social'
import { timeAgo } from '../services/timeAgo'
import { useRoomStore } from '../store'
import CommentAvatar, { CommentName } from './CommentAvatar'

export default function NotificationPopup() {
  const { selectedObject, clearSelection, furniture, books, remoteVisits, othersLikes, guestbook, pendingReactions, markReactionsSeen } = useRoomStore()
  const open = !isVisiting() && furniture.find((item) => item.id === selectedObject)?.type === 'notification-box'
  const unreadIds = Object.keys(pendingReactions)
  useEffect(() => { if (open) unreadIds.forEach(markReactionsSeen) }, [open, unreadIds.join(':')])
  if (!open) return null

  const labels = new Map(furniture.map((item) => [item.id, item.name]))
  books.forEach((book) => book.entries.forEach((entry) => labels.set(entry.id, entry.title || `${book.title} · ${entry.date}`)))
  const likes = Object.entries(othersLikes).filter(([, count]) => count > 0)
  const mine = myVisitorId()
  const comments = Object.entries(guestbook).flatMap(([targetId, entries]) => entries
    .filter((comment) => comment.visitor && comment.visitor !== mine)
    .map((comment) => ({ ...comment, target: labels.get(targetId) ?? '가구' })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && clearSelection()}>
    <section className="notification-card comment-ui" aria-label="전체 알림">
      <strong>알림</strong>
      {remoteVisits && <section><h2>방문</h2><p className="notification-visits"><b>오늘 {remoteVisits.today}</b><span>전체 {remoteVisits.total}</span></p></section>}
      {likes.length > 0 && <section><h2>좋아요</h2><ul>{likes.map(([id, count]) => <li key={id}><span>{labels.get(id) ?? '가구'}</span><b>{count}</b></li>)}</ul></section>}
      {comments.length > 0 && <section><h2>댓글</h2><div className="notification-comments">{comments.map((comment) => <article key={comment.id} className="comment-item">
        <CommentAvatar name={comment.name} photo={comment.photo} />
        <header><CommentName name={comment.name} /><time>{timeAgo(comment.createdAt)}</time><small>{comment.target}</small></header>
        <p>{comment.text}</p>
      </article>)}</div></section>}
    </section>
  </div>
}
