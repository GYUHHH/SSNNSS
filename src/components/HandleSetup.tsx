import { useEffect, useState } from 'react'
import { useRoomStore } from '../store'
import { currentUserEmail, handleTaken, isVisiting, onAuthChange, publishRoom, roomPath, sendOtpCode, verifyOtpCode } from '../services/social'

// First-time onboarding: email → emailed code → pick a unique id. Claiming publishes the personal room,
// binds it to the verified account, and moves the browser to its own address (domain)/(id).
export default function HandleSetup() {
  const { setProfileHandle, profile } = useRoomStore()
  const [session, setSession] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeBad, setCodeBad] = useState(false)
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
  const sendCode = async () => {
    if (!email.includes('@') || busy) return
    setBusy(true)
    setCodeSent(await sendOtpCode(email))
    setBusy(false)
  }
  const confirmCode = async () => {
    if (code.length < 6 || busy) return
    setBusy(true)
    const ok = await verifyOtpCode(email, code.trim())
    setCodeBad(!ok)
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
        <div className="login-form">
          <input type="email" value={email} placeholder="이메일" disabled={codeSent} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sendCode() }} />
          {!codeSent && <button type="button" disabled={!email.includes('@') || busy} onClick={() => void sendCode()}>인증번호 받기</button>}
          {codeSent && <>
            <input type="text" inputMode="numeric" value={code} className={codeBad ? 'taken' : ''} placeholder="인증번호" onChange={(event) => { setCode(event.target.value); setCodeBad(false) }} onKeyDown={(event) => { if (event.key === 'Enter') void confirmCode() }} />
            <button type="button" disabled={code.trim().length < 6 || busy} onClick={() => void confirmCode()}>{codeBad ? '번호가 달라요' : '확인'}</button>
          </>}
        </div>
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
