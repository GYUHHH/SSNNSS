import { timeAgo } from '../services/timeAgo'
import { autosize } from '../services/autosize'
import { useEffect, useState } from 'react'
import { useRoomStore } from '../store'
import { ClipPreview, DrawingEditor, PhotoPickButton, PlaylistOrderEditor, VideoLinkInput, VideoPickButton } from './ArtEditor'
import { isVisiting, myVisitorId, requireHandle } from '../services/social'
import CommentAvatar, { CommentName } from './CommentAvatar'
import { embedSrc } from '../services/ytResume'

// which artwork panel a furniture type opens (null → none)
export const artworkKindOf = (type: string) => type === 'photo' || type === 'easel-photo' || type.startsWith('photo-frame') ? 'frame' : type === 'poster' || type.startsWith('wall-art') ? 'poster' : type.startsWith('video-frame') ? 'video' : type === 'guestbook' ? 'guestbook' : type === 'whiteboard' ? 'poster' : null

// side panel on the right — the room slides left while it is open; tall artwork scrolls instead of cropping
export default function ArtworkOverlay() {
  const { selectedObject, artworks, furniture, videoFrames, videoClips, videoLinks, setVideoClip, setVideoLink, stopFrame } = useRoomStore()
  const [drawing, setDrawing] = useState(false)
  const [videoStep, setVideoStep] = useState<'choose' | 'link' | 'file'>('choose')
  useEffect(() => { setDrawing(false); setVideoStep('choose') }, [selectedObject])
  if (!selectedObject) return null
  const item = furniture.find((value) => value.id === selectedObject)
  const kind = artworkKindOf(item?.type ?? '')
  if (!kind) return null
  if (kind === 'guestbook') return <Guestbook id={selectedObject} />
  if (kind === 'video') {
    const link = videoLinks[selectedObject]
    const hasClip = !!(videoFrames[selectedObject] || videoClips[selectedObject])
    const hasMedia = !!link || hasClip
    const removeMedia = () => { stopFrame(selectedObject); setVideoLink(selectedObject, null); setVideoClip(selectedObject, null) }
    return <>
      {!isVisiting() && videoStep !== 'choose' && <header><button className="diary-back" type="button" aria-label="이전" onClick={() => setVideoStep('choose')}>←</button></header>}
      {videoStep === 'choose' && <>
        {link && <iframe className="video-panel-preview" title="유튜브 영상" src={embedSrc(link, selectedObject, 'playsinline=1&controls=1')} referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture" allowFullScreen />}
        {!link && hasClip && <ClipPreview id={selectedObject} />}
        {link?.startsWith('pl:') && <PlaylistOrderEditor id={selectedObject} />}
        {!isVisiting() && <div className="art-actions">
          {hasMedia
            ? <button type="button" onClick={removeMedia}>Delete</button>
            : <><button type="button" onClick={() => setVideoStep('link')}>Youtube Link</button><button type="button" onClick={() => setVideoStep('file')}>Video File</button></>}
        </div>}
      </>}
      {!isVisiting() && videoStep === 'link' && <>
        <VideoLinkInput id={selectedObject} onApplied={() => setVideoStep('choose')} />
        <small className="video-link-kinds">- Youtube Video<br />- Youtube Playlist</small>
      </>}
      {!isVisiting() && videoStep === 'file' && <div className="art-actions"><VideoPickButton id={selectedObject} onPicked={() => setVideoStep('choose')} /></div>}
    </>
  }
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
      <button type="button" onClick={submit}>게시</button>
    </div>
    <div className="guest-list comment-ui">
      {comments.length === 0 && <p className="entry-empty">댓글 없음</p>}
      {comments.map((comment) => <article key={comment.id} className="guest-note comment-item">
        <CommentAvatar name={comment.name} photo={comment.photo} />
        <header><CommentName name={comment.name} /><time>{timeAgo(comment.createdAt)}</time>{(!isVisiting() || comment.visitor === myVisitorId()) && <button type="button" aria-label="삭제" onClick={() => removeGuestComment(id, comment.id)}>×</button>}</header>
        <p>{comment.text}</p>
      </article>)}
    </div>
  </>
}
