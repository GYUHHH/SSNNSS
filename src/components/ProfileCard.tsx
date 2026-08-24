import { useEffect, useRef, useState } from 'react'
import { useRoomStore } from '../store'
import { currentRoomHandle, currentUserEmail, isVisiting, myHandle, onAuthChange, signOut } from '../services/social'
import { fetchFollowers, myInviteLink, onFollowsChange } from '../services/follows'
import { shareRoom } from '../services/capture'
import { PhotoCropEditor } from './PhotoCropEditor'
import { t } from '../services/i18n'

// door-with-an-arrow: the usual sign-out glyph
const SignOutIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4" /><path d="M6 12h9" /></svg>
const CopyIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="1" /><path d="M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4" /></svg>
const ShareIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="2" /><circle cx="6" cy="12" r="2" /><circle cx="18" cy="19" r="2" /><path d="m8 11 8-5M8 13l8 5" /></svg>

export default function ProfileCard() {
  const { profileOpen, closeProfile, profile, setProfilePhoto, remoteVisits } = useRoomStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const actionHintTimerRef = useRef<number | undefined>(undefined)
  const [signedIn, setSignedIn] = useState(false)
  const [editingPhoto, setEditingPhoto] = useState<string | null>(null)
  const [followers, setFollowers] = useState(0)
  const [actionHint, setActionHint] = useState<string | null>(null)
  useEffect(() => {
    void currentUserEmail().then((email) => setSignedIn(!!email))
    return onAuthChange((email) => setSignedIn(!!email))
  }, [])
  useEffect(() => () => window.clearTimeout(actionHintTimerRef.current), [])
  // followers of the room being looked at, refreshed whenever a follow lands
  useEffect(() => {
    const handle = currentRoomHandle()
    if (!profileOpen || !handle) return
    let live = true
    const refresh = () => void fetchFollowers(handle).then((rows) => { if (live) setFollowers(rows.length) })
    refresh()
    const stop = onFollowsChange(refresh)
    return () => { live = false; stop() }
  }, [profileOpen])
  if (!profileOpen) return null
  const pick = (file: File) => setEditingPhoto(URL.createObjectURL(file))
  const closeEditor = () => setEditingPhoto((source) => { if (source) URL.revokeObjectURL(source); return null })
  const showActionHint = (message: string) => {
    setActionHint(message)
    window.clearTimeout(actionHintTimerRef.current)
    actionHintTimerRef.current = window.setTimeout(() => setActionHint(null), 1100)
  }
  const copyInvite = () => void myInviteLink().then((link) => {
    if (link) void navigator.clipboard.writeText(link).then(() => showActionHint(t('복사됨'))).catch(() => {})
  })
  return <div className="profile-overlay" onMouseDown={(event) => event.currentTarget === event.target && closeProfile()}>
    <section className="profile-card" aria-label={t('프로필')}>
      {/* a device can hold its id without an open session (the token expires) — it still needs a way out */}
      {(signedIn || myHandle()) && !isVisiting() && <div className="profile-actions">
        {actionHint && <span className="profile-action-hint" role="status">{actionHint}</span>}
        <button type="button" aria-label={t('초대 링크 복사')} onClick={copyInvite}><CopyIcon /></button>
        <button type="button" aria-label={t('방 공유')} onClick={() => { showActionHint(t('방 공유')); void shareRoom() }}><ShareIcon /></button>
        <button className="profile-signout" type="button" aria-label={t('로그아웃')} onClick={() => { void signOut().then(() => location.replace(import.meta.env.BASE_URL)) }}><SignOutIcon /></button>
      </div>}
      <div className="profile-main">
        {isVisiting()
          ? <div className="profile-photo">{profile.photo ? <img src={profile.photo} alt={t('프로필 사진')} /> : <span>{t('사진')}</span>}</div>
          : <button className="profile-photo" type="button" onClick={() => inputRef.current?.click()} aria-label={t('프로필 사진 바꾸기')}>
            {profile.photo ? <img src={profile.photo} alt={t('프로필 사진')} /> : <span>{t('사진')}</span>}
          </button>}
        <div className="profile-info">
          <p className="profile-handle">{profile.handle ?? 'ID'}</p>
          <p className="profile-visits"><b>{remoteVisits?.total ?? profile.total}</b> Visits <i>|</i> <b>{remoteVisits?.today ?? profile.today}</b></p>
          <p className="profile-friends">Followers <b>{followers}</b></p>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) pick(file); event.target.value = '' }} />
    </section>
    {editingPhoto && <PhotoCropEditor source={editingPhoto} aspect={1} output={[512, 512]} onClose={closeEditor} onApply={(photo) => { setProfilePhoto(photo); closeEditor() }} />}
  </div>
}
