import { useRef } from 'react'
import { useRoomStore } from '../store'

export default function ProfileCard() {
  const { profileOpen, closeProfile, profile, setProfilePhoto } = useRoomStore()
  const inputRef = useRef<HTMLInputElement>(null)
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
      <button className="profile-photo" type="button" onClick={() => inputRef.current?.click()} aria-label="프로필 사진 바꾸기">
        {profile.photo ? <img src={profile.photo} alt="프로필 사진" /> : <span>사진</span>}
      </button>
      <div className="profile-info">
        <p className="profile-visits">Total <b>{profile.total}</b> <i>|</i> Today <b>{profile.today}</b></p>
        <p className="profile-friends">친구 <b>{profile.friends}</b></p>
      </div>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) pick(file); event.target.value = '' }} />
    </section>
  </div>
}
