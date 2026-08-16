import { useRef } from 'react'
import { useRoomStore } from '../store'
import { currentUserEmail, isVisiting, onAuthChange, shareUrl, signOut } from '../services/social'
import { useEffect, useState } from 'react'

export default function ProfileCard() {
  const { profileOpen, closeProfile, profile, setProfilePhoto, setProfileHandle, remoteVisits } = useRoomStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  useEffect(() => {
    void currentUserEmail().then(setSessionEmail)
    return onAuthChange(setSessionEmail)
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
      <input className="profile-handle" aria-label="아이디" value={profile.handle ?? ''} placeholder="ID" disabled={isVisiting() || (!!sessionEmail && !!profile.handle)} onChange={(event) => setProfileHandle(event.target.value)} />
      <div className="profile-main">
        <button className="profile-photo" type="button" onClick={() => inputRef.current?.click()} aria-label="프로필 사진 바꾸기">
          {profile.photo ? <img src={profile.photo} alt="프로필 사진" /> : <span>사진</span>}
        </button>
        <div className="profile-info">
          <p className="profile-visits">Total <b>{remoteVisits?.total ?? profile.total}</b> <i>|</i> Today <b>{remoteVisits?.today ?? profile.today}</b></p>
          <p className="profile-friends">친구 <b>{profile.friends}</b></p>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) pick(file); event.target.value = '' }} />
      <div className="profile-foot">
        {sessionEmail
          ? <button type="button" onClick={() => { void signOut() }}>{sessionEmail} · 로그아웃</button>
          : <button type="button" onClick={() => window.dispatchEvent(new Event('open-login'))}>로그인</button>}
        {!isVisiting() && shareUrl() && <button type="button" onClick={() => { void navigator.clipboard?.writeText(shareUrl()!) }}>{shareUrl()}</button>}
      </div>
    </section>
  </div>
}
