export default function CommentAvatar({ name, photo }: { name: string; photo?: string }) {
  return <span className="comment-avatar" aria-hidden="true"><span>{name.slice(0, 1).toUpperCase()}</span>{photo && <img src={photo} alt="" onError={(event) => event.currentTarget.remove()} />}</span>
}
