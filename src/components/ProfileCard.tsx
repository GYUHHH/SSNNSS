import { useEffect, useRef, useState } from 'react'
import { useRoomStore } from '../store'
import { currentUserEmail, isVisiting, myHandle, onAuthChange, signOut } from '../services/social'
import { PhotoCropEditor } from './PhotoCropEditor'

// door-with-an-arrow: the usual sign-out glyph
const SignOutIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4" /><path d="M6 12h9" /></svg>

export default function ProfileCard() {
  const { profileOpen, closeProfile, profile, setProfilePhoto, remoteVisits } = useRoomStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [editingPhoto, setEditingPhoto] = useState<string | null>(null)
  useEffect(() => {
    void currentUserEmail().then((email) => setSignedIn(!!email))
    return onAuthChange((email) => setSignedIn(!!email))
  }, [])
  if (!profileOpen) return null
  const pick = (file: File) => setEditingPhoto(URL.createObjectURL(file))
  const closeEditor = () => setEditingPhoto((source) => { if (source) URL.revokeObjectURL(source); return null })
  return <div className="profile-overlay" onMouseDown={(event) => event.currentTarget === event.target && closeProfile()}>
    <section className="profile-card" aria-label="프로필">
      {/* a device can hold its id without an open session (the token expires) — it still needs a way out */}
      {(signedIn || myHandle()) && !isVisiting() && <button className="profile-signout" type="button" aria-label="로그아웃" onClick={() => { void signOut().then(() => location.replace(import.meta.env.BASE_URL)) }}><SignOutIcon /></button>}
      <div className="profile-main">
        {isVisiting()
          ? <div className="profile-photo">{profile.photo ? <img src={profile.photo} alt="프로필 사진" /> : <span>사진</span>}</div>
          : <button className="profile-photo" type="button" onClick={() => inputRef.current?.click()} aria-label="프로필 사진 바꾸기">
            {profile.photo ? <img src={profile.photo} alt="프로필 사진" /> : <span>사진</span>}
          </button>}
        <div className="profile-info">
          <p className="profile-handle">{profile.handle ?? 'ID'}</p>
          <p className="profile-visits">Total <b>{remoteVisits?.total ?? profile.total}</b> <i>|</i> Today <b>{remoteVisits?.today ?? profile.today}</b></p>
          <p className="profile-friends">친구 <b>{profile.friends}</b></p>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) pick(file); event.target.value = '' }} />
    </section>
    {editingPhoto && <PhotoCropEditor source={editingPhoto} aspect={1} output={[512, 512]} onClose={closeEditor} onApply={(photo) => { setProfilePhoto(photo); closeEditor() }} />}
  </div>
}
