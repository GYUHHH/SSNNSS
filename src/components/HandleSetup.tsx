import { useEffect, useState } from 'react'
import { useRoomStore } from '../store'
import { adoptRoomData, currentUserEmail, handleTaken, isVisiting, onAuthChange, ownedRoom, publishRoom, roomPath, sendOtpCode, verifyOtpCode } from '../services/social'

// First-time onboarding: email → emailed 6-digit code → pick a unique id. Claiming publishes the personal
// room, binds it to the account, and moves to its address (domain)/(id).
export default function HandleSetup() {
  const { setProfileHandle, profile } = useRoomStore()
  const [session, setSession] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [email, setEmail] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sendFailed, setSendFailed] = useState(false)
  const [code, setCode] = useState('')
  const [codeBad, setCodeBad] = useState(false)
  const [value, setValue] = useState('')
  const [taken, setTaken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [roomChecked, setRoomChecked] = useState(false)
  useEffect(() => {
    void currentUserEmail().then((current) => { setSession(current); setChecked(true) })
    return onAuthChange(setSession)
  }, [])
  // Signing in on a fresh device must land back in the room this account already owns — otherwise the id
  // step would ask for a new one and reject the old id as taken. Adopt the server copy and go to its address.
  // profile.handle guard is load-bearing: without it a device that already holds the handle would
  // location.replace onto the address it is already on, reloading forever
  useEffect(() => {
    if (!session || profile.handle || isVisiting()) return
    let live = true
    void ownedRoom().then((room) => {
      if (!live) return
      if (!room) { setRoomChecked(true); return }
      adoptRoomData(room.data)
      location.replace(roomPath(room.handle))
    })
    return () => { live = false }
  }, [session, profile.handle])
  // while the owned-room lookup is in flight the id step must stay hidden, or it flashes before the redirect
  if (isVisiting() || profile.handle || dismissed || !checked || (session && !roomChecked)) return null
  const clean = value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  const valid = /^[a-z0-9_]{3,20}$/.test(clean)
  const sendCode = async () => {
    if (!email.includes('@') || busy) return
    setBusy(true)
    const ok = await sendOtpCode(email)
    setCodeSent(ok)
    setSendFailed(!ok)
    setBusy(false)
  }
  const confirmCode = async () => {
    if (code.trim().length < 6 || busy) return
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
          {!codeSent && <button type="button" disabled={!email.includes('@') || busy} onClick={() => void sendCode()}>{sendFailed ? '잠시 후 다시 시도' : '인증번호 받기'}</button>}
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
