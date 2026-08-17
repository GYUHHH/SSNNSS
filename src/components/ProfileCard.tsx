import { useEffect, useRef, useState } from 'react'
import { useRoomStore } from '../store'
import { currentUserEmail, isVisiting, myHandle, onAuthChange, signOut } from '../services/social'

// door-with-an-arrow: the usual sign-out glyph
const SignOutIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4" /><path d="M6 12h9" /></svg>

export default function ProfileCard() {
  const { profileOpen, closeProfile, profile, setProfilePhoto, setProfileHandle, remoteVisits } = useRoomStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    void currentUserEmail().then((email) => setSignedIn(!!email))
    return onAuthChange((email) => setSignedIn(!!email))
  }, [])
  if (!profileOpen) return null
  const pick = (file: File) => {
    const image = new Image()
    image.onload = () => {
      // square crop, downscaled — the photo shares localStorage with the room layout
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const context = canvas.getContext('2d')!
      const scale = Math.max(256 / image.width, 256 / image.height)
      context.drawImage(image, (256 - image.width * scale) / 2, (256 - image.height * scale) / 2, image.width * scale, image.height * scale)
      setProfilePhoto(canvas.toDataURL('image/jpeg', 0.85))
      URL.revokeObjectURL(image.src)
    }
    image.src = URL.createObjectURL(file)
  }
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
          <input className="profile-handle" aria-label="아이디" value={profile.handle ?? ''} placeholder="ID" disabled={isVisiting()} onChange={(event) => setProfileHandle(event.target.value)} />
          <p className="profile-visits">Total <b>{remoteVisits?.total ?? profile.total}</b> <i>|</i> Today <b>{remoteVisits?.today ?? profile.today}</b></p>
          <p className="profile-friends">친구 <b>{profile.friends}</b></p>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) pick(file); event.target.value = '' }} />
    </section>
  </div>
}
