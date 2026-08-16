import { useRoomStore } from '../store'
import { myVisitorId } from '../services/social'

// The badge's popup: everything other people left on this object — like count and their comments.
export default function ReactionPopup() {
  const { reactionTarget, setReactionTarget, furniture, othersLikes, guestbook } = useRoomStore()
  if (!reactionTarget) return null
  const item = furniture.find((entry) => entry.id === reactionTarget)
  const mine = myVisitorId()
  const likeCount = othersLikes[reactionTarget] ?? 0
  const comments = (guestbook[reactionTarget] ?? []).filter((comment) => comment.visitor && comment.visitor !== mine)
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setReactionTarget(null)}>
    <section className="reaction-card" aria-label="반응">
      <button className="close-ui" type="button" aria-label="닫기" onClick={() => setReactionTarget(null)}>×</button>
      <strong>{item?.name ?? ''}</strong>
      {likeCount > 0 && <p className="reaction-likes">♥ {likeCount}</p>}
      {comments.length > 0 && <div className="reaction-comments">
        {comments.map((comment) => <article key={comment.id}>
          <header><b>{comment.name}{comment.verified && ' ✓'}</b><time>{comment.createdAt.slice(0, 10)}</time></header>
          <p>{comment.text}</p>
        </article>)}
      </div>}
    </section>
  </div>
}
