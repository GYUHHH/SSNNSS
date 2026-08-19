import { timeAgo } from '../services/timeAgo'
import { autosize } from '../services/autosize'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRoomStore } from '../store'
import { ClipPreview, DrawingEditor, PhotoPickButton, PlaylistOrderEditor, VideoLinkInput, VideoPickButton } from './ArtEditor'
import { isVisiting, myVisitorId, requireHandle } from '../services/social'

// which artwork panel a furniture type opens (null → none)
export const artworkKindOf = (type: string) => type === 'photo' || type === 'easel-photo' || type.startsWith('photo-frame') ? 'frame' : type === 'poster' || type.startsWith('wall-art') ? 'poster' : type.startsWith('video-frame') ? 'video' : type === 'guestbook' ? 'guestbook' : type === 'whiteboard' ? 'poster' : null

// side panel on the right — the room slides left while it is open; tall artwork scrolls instead of cropping
export default function ArtworkOverlay() {
  const { selectedObject, artworks, furniture, videoFrames, videoLinks } = useRoomStore()
  const [drawing, setDrawing] = useState(false)
  useEffect(() => setDrawing(false), [selectedObject])
  if (!selectedObject) return null
  const item = furniture.find((value) => value.id === selectedObject)
  const kind = artworkKindOf(item?.type ?? '')
  if (!kind) return null
  if (kind === 'guestbook') return <Guestbook id={selectedObject} />
  if (kind === 'video') return <>
    <header><strong>{item?.name ?? '영상 액자'}</strong></header>
    {videoLinks[selectedObject] && <DockSpace />}
    <ClipPreview id={selectedObject} />
    {!isVisiting() && <><VideoLinkInput id={selectedObject} />
    <PlaylistOrderEditor id={selectedObject} />
    <div className="art-actions"><VideoPickButton id={selectedObject} /></div></>}
  </>
  const frame = kind === 'frame'
  const art = artworks[selectedObject]
  const [width, height] = frame
    ? item?.type === 'photo' ? [464, 336] : [400, 400]
    : item?.type === 'poster' ? [360, 555] : item?.type === 'whiteboard' ? [420, 300] : item?.type === 'easel-photo' ? [360, 460] : [360, Math.round(360 * (item?.footprint.depth ?? 3) / (item?.footprint.width ?? 2))]
  return <>
    <header><strong>{item?.name ?? (frame ? '사진' : '포스터')}</strong></header>
    {drawing
      ? <DrawingEditor id={selectedObject} width={width} height={height} onClose={() => setDrawing(false)} />
      : <>
        {art ? <img className="art-view" src={art} alt={frame ? '사진' : '그림'} /> : <div className={frame ? 'art-view sea' : 'art-view poster-art'} />}
        <div className="art-meta"><p>{frame ? (art ? '나의 사진' : item?.type === 'photo' ? '여름의 바다' : '빈 액자') : art ? '나의 그림' : item?.type === 'poster' ? 'SONDÉ' : '빈 포스터'}</p>{!isVisiting() && <div className="art-actions">{frame ? <PhotoPickButton id={selectedObject} width={width} height={height} /> : <button type="button" onClick={() => setDrawing(true)}>그림 그리기</button>}</div>}</div>
      </>}
  </>
}

function Guestbook({ id }: { id: string }) {
  const { guestbook, addGuestComment, removeGuestComment } = useRoomStore()
  const [text, setText] = useState('')
  const comments = guestbook[id] ?? []
  const submit = () => { if (!text.trim() || !requireHandle()) return; addGuestComment(id, text.trim()); setText('') }
  return <>
    <header><strong>방명록</strong></header>
    <div className="guest-form comment-ui">
      <textarea ref={autosize} rows={1} maxLength={200} value={text} onChange={(event) => { setText(event.target.value); autosize(event.currentTarget) }} placeholder="한마디 남겨주세요" onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} />
      <button type="button" onClick={submit}>남기기</button>
    </div>
    <div className="guest-list comment-ui">
      {comments.length === 0 && <p className="entry-empty">댓글 없음</p>}
      {comments.map((comment) => <article key={comment.id} className="guest-note comment-item">
        <header><strong>{comment.name}</strong><time>{timeAgo(comment.createdAt)}</time>{(!isVisiting() || comment.visitor === myVisitorId()) && <button type="button" aria-label="삭제" onClick={() => removeGuestComment(id, comment.id)}>×</button>}</header>
        <p>{comment.text}</p>
      </article>)}
    </div>
  </>
}

// The player is fixed-position — moving it in the DOM would reload the video — so instead the panel measures the
// gap it leaves and hands the coordinates over, keeping the two exactly aligned on any screen.
function DockSpace() {
  const space = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = space.current
    if (!element) return
    const apply = () => {
      const box = element.getBoundingClientRect()
      const style = document.documentElement.style
      style.setProperty('--yt-dock-top', `${box.top}px`)
      style.setProperty('--yt-dock-left', `${box.left}px`)
      style.setProperty('--yt-dock-width', `${box.width}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(element)
    window.addEventListener('resize', apply)
    const panel = element.closest('.art-panel')
    panel?.addEventListener('scroll', apply)
    panel?.addEventListener('transitionend', apply)
    const until = performance.now() + 700
    let frame = requestAnimationFrame(function follow() {
      apply()
      if (performance.now() < until) frame = requestAnimationFrame(follow)
    })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', apply)
      panel?.removeEventListener('scroll', apply)
      panel?.removeEventListener('transitionend', apply)
    }
  }, [])
  return <div ref={space} className="yt-dock-space" aria-hidden />
}
