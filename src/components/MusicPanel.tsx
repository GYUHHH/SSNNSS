import { useEffect, useRef, useState } from 'react'
import { isVisiting } from '../services/social'
import { addSpotifyItem, addTrackFile, loadMusicSource, loadSpotifyItems, loadTracks, musicState, onMusicUpdate, pauseMusic, preferredMusicTrack, removeSpotifyItem, removeTrack, resumeMusic, saveMusicSource, saveTracks, seekMusic, spotifyEmbedUrl, toggleMusicMute, type MusicSource, type MusicTrack } from '../services/music'
import { t } from '../services/i18n'

// store values arrive as props: this panel lives inside a drei <Html> portal, which renders in its own React
// root where the room context does not exist
export type MusicPanelProps = { musicTrack: string | null; setMusicTrack: (id: string | null) => void; musicVolume: number; setMusicVolume: (value: number) => void }

const clock = (seconds: number) => Number.isFinite(seconds) && seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00'

// Compact mini player: now-playing header, prev/play/next, seekable progress, mute + volume, and a playlist
// drawer whose rows switch tracks on click and reorder by dragging the handle (pointer events, so touch too).
export default function MusicPanel({ musicTrack, setMusicTrack, musicVolume, setMusicVolume }: MusicPanelProps) {
  const [, setTick] = useState(0)
  const [listOpen, setListOpen] = useState(false)
  const [tracks, setTracks] = useState<MusicTrack[]>(() => loadTracks())
  const [source, setSource] = useState<MusicSource>(() => loadMusicSource())
  const [spotifyItems, setSpotifyItems] = useState(() => loadSpotifyItems())
  const [spotifyActiveId, setSpotifyActiveId] = useState(() => loadSpotifyItems()[0]?.id ?? null)
  const [spotifyLink, setSpotifyLink] = useState('')
  const [spotifyError, setSpotifyError] = useState(false)
  const [drag, setDrag] = useState<{ index: number; delta: number } | null>(null)
  const rowStep = useRef(40)
  const fileInput = useRef<HTMLInputElement>(null)
  // long titles slide back and forth instead of growing the fixed-size panel
  const titleBox = useRef<HTMLElement>(null)
  const [slide, setSlide] = useState(0)

  useEffect(() => onMusicUpdate(() => {
    const nextSpotify = loadSpotifyItems()
    setTick((value) => value + 1); setTracks(loadTracks()); setSource(loadMusicSource()); setSpotifyItems(nextSpotify)
    setSpotifyActiveId((current) => nextSpotify.some((item) => item.id === current) ? current : nextSpotify[0]?.id ?? null)
  }), [])
  const state0 = musicState()
  const shownTitle = (tracks.find((track) => track.id === (musicTrack ?? state0.id)) ?? tracks[0])?.title ?? ''
  useEffect(() => {
    const box = titleBox.current
    if (!box) return
    setSlide(Math.max(0, box.scrollWidth - box.clientWidth))
  }, [shownTitle])
  const state = musicState()
  const shown = tracks.find((track) => track.id === (musicTrack ?? state.id)) ?? tracks[0]
  const shownIndex = shown ? tracks.findIndex((track) => track.id === shown.id) : 0
  const active = state.id === shown?.id
  // Only the live media element is authoritative. Old uploaded metadata could contain wildly wrong lengths.
  const duration = active ? state.duration : 0
  const time = active ? Math.min(state.time, duration || state.time) : 0
  const playing = !!musicTrack && active && !state.paused
  const toggle = () => {
    if (!shown) return
    if (!musicTrack) { setMusicTrack(shown.id); return }
    if (state.paused) resumeMusic(); else pauseMusic()
  }
  const step = (offset: number) => { if (tracks.length) setMusicTrack(tracks[(shownIndex + offset + tracks.length) % tracks.length].id) }
  const remove = (track: MusicTrack) => {
    const next = removeTrack(track.id)
    if (musicTrack === track.id || state.id === track.id) setMusicTrack(next)
  }
  const addFiles = async (files: FileList) => { for (const file of Array.from(files)) await addTrackFile(file) }
  const switchSource = (next: MusicSource) => {
    setSource(next); saveMusicSource(next); setSpotifyError(false)
    if (next === 'spotify') setMusicTrack(null)
    else setMusicTrack(preferredMusicTrack(loadTracks(), 'mp3'))
  }
  const addSpotify = () => {
    const item = addSpotifyItem(spotifyLink)
    setSpotifyError(!item)
    if (item) { setSpotifyLink(''); setSpotifyActiveId(item.id); setSpotifyItems(loadSpotifyItems()) }
  }
  const activeSpotify = spotifyItems.find((item) => item.id === spotifyActiveId) ?? spotifyItems[0]
  const target = drag ? Math.min(tracks.length - 1, Math.max(0, drag.index + Math.round(drag.delta / rowStep.current))) : null
  const startDrag = (index: number) => (event: React.PointerEvent) => {
    event.preventDefault(); event.stopPropagation()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    rowStep.current = ((handle.closest('li')?.offsetHeight) ?? 36) + 4
    const startY = event.clientY
    setDrag({ index, delta: 0 })
    const onMove = (move: PointerEvent) => setDrag({ index, delta: move.clientY - startY })
    const onUp = (up: PointerEvent) => {
      handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp); handle.removeEventListener('pointercancel', onUp)
      const to = Math.min(tracks.length - 1, Math.max(0, index + Math.round((up.clientY - startY) / rowStep.current)))
      if (to !== index) { const next = [...tracks]; next.splice(to, 0, ...next.splice(index, 1)); setTracks(next); saveTracks(next) }
      setDrag(null)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }
  return <div className="mini-player">
    <div className="music-source-tabs" role="group" aria-label={t('음악 소스')}>
      <button type="button" className={source === 'mp3' ? 'active' : ''} aria-pressed={source === 'mp3'} onClick={() => switchSource('mp3')}>{t('내 음악')}</button>
      <button type="button" className={source === 'spotify' ? 'active' : ''} aria-pressed={source === 'spotify'} onClick={() => switchSource('spotify')}>Spotify</button>
    </div>
    {source === 'mp3' ? <>
    <div className="mini-meta">
      <b ref={titleBox} className={slide ? 'sliding' : ''} style={slide ? { '--slide': `-${slide}px` } as React.CSSProperties : undefined}><span>{shown?.title ?? ''}</span></b>
      <small>{shown?.artist ?? ''}</small>
    </div>
    <div className="mini-progress">
      <small>{clock(time)}</small>
      <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(time, duration || 1)} aria-label={t('재생 위치')} onInput={(event) => seekMusic(Number(event.currentTarget.value))} />
      <small>{clock(duration)}</small>
    </div>
    <div className="mini-controls">
      <button type="button" aria-label={t('이전 곡')} onClick={() => step(-1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9.5 12z" /></svg>
      </button>
      <button type="button" className="mini-play" aria-label={t(playing ? '일시정지' : '재생')} onClick={toggle}>
        {playing
          ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4h4v16H7zM13 4h4v16h-4z" /></svg>
          : <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 4l12 8-12 8z" /></svg>}
      </button>
      <button type="button" aria-label={t('다음 곡')} onClick={() => step(1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l10.5-7z" /></svg>
      </button>
    </div>
    <div className="mini-volume">
      <button type="button" aria-label={t(state.muted ? '음소거 해제' : '음소거')} onClick={toggleMusicMute}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
          {state.muted
            ? <><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
            : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5.5a10 10 0 0 1 0 13" /></>}
        </svg>
      </button>
      <input type="range" min={0} max={1} step={0.05} value={musicVolume} aria-label={t('볼륨')} onInput={(event) => setMusicVolume(Number(event.currentTarget.value))} />
    </div>
    <button type="button" className="mini-list-toggle" onClick={() => setListOpen((open) => !open)}>{t('재생목록')} {listOpen ? '▴' : '▾'}</button>
    {listOpen && <>
      <ul className="mini-list">
        {tracks.map((track, index) => {
          const dragging = drag?.index === index
          let shift = 0
          if (drag && target !== null && !dragging) {
            if (index > drag.index && index <= target) shift = -rowStep.current
            else if (index < drag.index && index >= target) shift = rowStep.current
          }
          return <li key={track.id} className={dragging ? 'dragging' : musicTrack === track.id ? 'playing' : ''} style={{ transform: (dragging ? drag.delta : shift) ? `translateY(${dragging ? drag.delta : shift}px)` : undefined }}>
            <button type="button" className="mini-track" onClick={() => setMusicTrack(track.id)}><b>{track.title}</b>{track.artist && <small>{track.artist}</small>}</button>
            <button type="button" className="order-handle" aria-label={t('순서 이동')} onPointerDown={startDrag(index)}>≡</button>
            {!isVisiting() && <button type="button" className="mini-delete" aria-label={t('삭제')} onClick={() => remove(track)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" /></svg></button>}
          </li>
        })}
      </ul>
      {!isVisiting() && <button type="button" className="mini-add" onClick={() => fileInput.current?.click()}>{t('+ 파일')}</button>}
      <input ref={fileInput} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.opus,.weba" multiple hidden onChange={(event) => { if (event.target.files?.length) void addFiles(event.target.files); event.target.value = '' }} />
    </>}
    </> : <div className="spotify-source">
      {activeSpotify && <iframe className="spotify-embed" src={spotifyEmbedUrl(activeSpotify)} title={`Spotify ${activeSpotify.type}`} width="100%" height="152" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />}
      {!!spotifyItems.length && <><b className="spotify-list-title">{t('저장한 항목')}</b><ul className="spotify-list">{spotifyItems.map((item) => <li key={`${item.type}:${item.id}`} className={item.id === activeSpotify?.id ? 'active' : ''}>
        <button type="button" className="spotify-pick" onClick={() => setSpotifyActiveId(item.id)}><b>Spotify {item.type}</b><small>{item.id.slice(0, 8)}</small></button>
        {!isVisiting() && <button type="button" className="spotify-delete" aria-label={t('삭제')} onClick={() => removeSpotifyItem(item.id)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" /></svg></button>}
      </li>)}</ul></>}
      {!isVisiting() && <form className="spotify-add" onSubmit={(event) => { event.preventDefault(); addSpotify() }}>
        <label htmlFor="spotify-link">{t('Spotify 링크')}</label>
        <div><input id="spotify-link" type="url" value={spotifyLink} placeholder="https://open.spotify.com/…" onChange={(event) => { setSpotifyLink(event.target.value); setSpotifyError(false) }} /><button type="submit">{t('추가')}</button></div>
        {spotifyError && <small role="alert">{t('Spotify 링크를 확인해주세요.')}</small>}
      </form>}
    </div>}
  </div>
}
