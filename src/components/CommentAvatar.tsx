import { currentRoomHandle, enterRoom } from '../services/social'

const isHandle = (name: string) => /^[a-z0-9_]{3,20}$/.test(name)
const visit = (name: string) => { if (isHandle(name) && currentRoomHandle() !== name) void enterRoom(name) }

export default function CommentAvatar({ name, photo }: { name: string; photo?: string }) {
  const face = <><span>{name.slice(0, 1).toUpperCase()}</span>{photo && <img src={photo} alt="" onError={(event) => event.currentTarget.remove()} />}</>
  return isHandle(name) ? <button type="button" className="comment-avatar comment-profile-link" aria-label={`${name}의 방`} onClick={() => visit(name)}>{face}</button> : <span className="comment-avatar" aria-hidden="true">{face}</span>
}

export function CommentName({ name }: { name: string }) {
  return isHandle(name) ? <button type="button" className="comment-profile-link" onClick={() => visit(name)}><strong>{name}</strong></button> : <strong>{name}</strong>
}
