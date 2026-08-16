import { useEffect, useState } from 'react'
import { useRoomStore } from '../store'
import { currentUserEmail, handleTaken, isVisiting, onAuthChange, publishRoom, roomPath, sendMagicLink } from '../services/social'

// First-time onboarding: email → magic link (clicking it returns here logged in) → pick a unique id.
// Claiming publishes the personal room, binds it to the account, and moves to its address (domain)/(id).
export default function HandleSetup() {
  const { setProfileHandle, profile } = useRoomStore()
  const [session, setSession] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [email, setEmail] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [value, setValue] = useState('')
  const [taken, setTaken] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void currentUserEmail().then((current) => { setSession(current); setChecked(true) })
    return onAuthChange(setSession)
  }, [])
  if (isVisiting() || profile.handle || dismissed || !checked) return null
  const clean = value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  const valid = /^[a-z0-9_]{3,20}$/.test(clean)
  const sendLink = async () => {
    if (!email.includes('@') || busy) return
    setBusy(true)
    setLinkSent(await sendMagicLink(email))
    setBusy(false)
  }
  const claim = async () => {
    if (!valid || busy) return
    setBusy(true)
    if (await handleTaken(clean)) { setTaken(true); setBusy(false); return }
    setProfileHandle(clean)
    await publishRoom()
    location.replace(roomPath(clean))
  }
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setDismissed(true)}>
    <section className="login-card" aria-label="가입">
      <button className="close-ui" type="button" aria-label="닫기" onClick={() => setDismissed(true)}>×</button>
      {!session && <>
        <strong>가입</strong>
        {linkSent
          ? <p className="login-sent">{email}</p>
          : <div className="login-form">
            <input type="email" value={email} placeholder="이메일" onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sendLink() }} />
            <button type="button" disabled={!email.includes('@') || busy} onClick={() => void sendLink()}>메일로 로그인 링크 받기</button>
          </div>}
      </>}
      {session && <>
        <strong>아이디 설정</strong>
        <div className="login-form">
          <input type="text" value={clean} className={taken ? 'taken' : ''} placeholder="영문 소문자, 숫자, _" onChange={(event) => { setValue(event.target.value); setTaken(false) }} onKeyDown={(event) => { if (event.key === 'Enter') void claim() }} />
          <button type="button" disabled={!valid || busy} onClick={() => void claim()}>{taken ? '이미 사용 중' : '이 아이디로 시작'}</button>
        </div>
      </>}
    </section>
  </div>
}
