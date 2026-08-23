import { useRoomStore } from '../store'
import { myVisitorId } from '../services/social'
import { timeAgo } from '../services/timeAgo'
import CommentAvatar, { CommentName } from './CommentAvatar'
import { t } from '../services/i18n'

// The badge's popup: everything other people left on this object — like count and their comments.
export default function ReactionPopup() {
  const { reactionTarget, setReactionTarget, furniture, othersLikes, guestbook, reactionIdsFor } = useRoomStore()
  if (!reactionTarget) return null
  const item = furniture.find((entry) => entry.id === reactionTarget)
  const mine = myVisitorId()
  // a bookshelf carries its records' reactions too — same set of ids the dot counted
  const ids = reactionIdsFor(reactionTarget)
  const likeCount = ids.reduce((total, id) => total + (othersLikes[id] ?? 0), 0)
  const comments = ids.flatMap((id) => (guestbook[id] ?? []).filter((comment) => comment.visitor && comment.visitor !== mine))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setReactionTarget(null)}>
    <section className="reaction-card comment-ui" aria-label={t('반응')}>
      <strong>{item?.name ?? ''}</strong>
      {likeCount > 0 && <p className="reaction-likes">♥ {likeCount}</p>}
      {comments.length > 0 && <div className="reaction-comments">
        {comments.map((comment) => <article key={comment.id} className="comment-item">
          <CommentAvatar name={comment.name} photo={comment.photo} />
          <header><CommentName name={comment.name} /><time>{timeAgo(comment.createdAt)}</time></header>
          <p>{comment.text}</p>
        </article>)}
      </div>}
    </section>
  </div>
}
