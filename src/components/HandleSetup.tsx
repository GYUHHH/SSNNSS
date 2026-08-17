import { useEffect, useState } from 'react'
import { useRoomStore } from '../store'
import { adoptRoomData, claimHandleLocally, currentUserEmail, handleTaken, isPlainRoot, isVisiting, myHandle, onAuthChange, ownedRoom, publishRoom, roomPath, sendOtpCode, verifyOtpCode } from '../services/social'

// First-time onboarding: email → emailed 6-digit code → pick a unique id. Claiming publishes the personal
// room, binds it to the account, and moves to its address (domain)/(id).
export default function HandleSetup() {
  const { setProfileHandle } = useRoomStore()
  // never read the store's profile here: while visiting it holds the host's, whose handle would look like mine
  const mine = myHandle()
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
  const [requested, setRequested] = useState(false)
  // which button was pressed on the first screen — the flow after it is identical either way
  const [intent, setIntent] = useState<'login' | 'signup' | null>(null)
  const [already, setAlready] = useState(false)
  const close = () => {
    setDismissed(true); setRequested(false); setIntent(null); setAlready(false)
    setEmail(''); setCode(''); setCodeSent(false); setCodeBad(false); setSendFailed(false); setValue(''); setTaken(false)
  }
  useEffect(() => {
    const onNeed = () => { setRequested(true); setDismissed(false) }
    window.addEventListener('need-id', onNeed)
    return () => window.removeEventListener('need-id', onNeed)
  }, [])
  useEffect(() => {
    void currentUserEmail().then((current) => { setSession(current); setChecked(true) })
    return onAuthChange(setSession)
  }, [])
  // Signing in must land back in the room this account already owns — otherwise the id step would ask for a
  // new one and reject the old id as taken. Adopt the server copy and go to its address. This has to run while
  // standing in someone else's room too: that is where people sign up, and without it the lookup never
  // finishes, so the card would vanish after the code instead of asking for an id.
  // The `mine` guard is load-bearing: without it a device that already holds the handle would
  // location.replace onto the address it is already on, reloading forever.
  useEffect(() => {
    if (isPlainRoot()) { setRoomChecked(true); return }
    if (!session || mine) return
    let live = true
    void ownedRoom().then((room) => {
      if (!live) return
      if (!room) { setRoomChecked(true); return }
      adoptRoomData(room.data)
      location.replace(roomPath(room.handle))
    })
    return () => { live = false }
  }, [session, mine])
  // while the owned-room lookup is in flight the id step must stay hidden, or it flashes before the redirect
  // inside someone else's room the card stays out of the way until an action actually needs an id
  if (mine || dismissed || !checked || (session && !roomChecked)) return null
  if (isVisiting() && !requested) return null
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
    if (ok && intent === 'signup' && await ownedRoom()) setAlready(true)
    setBusy(false)
  }
  const claim = async () => {
    if (!valid || busy) return
    setBusy(true)
    if (await handleTaken(clean)) { setTaken(true); setBusy(false); return }
    if (isVisiting()) claimHandleLocally(clean)
    else setProfileHandle(clean)
    await publishRoom()
    location.replace(roomPath(clean))
  }
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && close()}>
    <section className="login-card" aria-label="가입">
      <button className="close-ui" type="button" aria-label="닫기" onClick={close}>×</button>
      {!session && !intent && <>
        <strong>시작하기</strong>
        <div className="login-form">
          <button type="button" onClick={() => setIntent('login')}>로그인</button>
          <button type="button" className="ghost" onClick={() => setIntent('signup')}>가입하기</button>
        </div>
      </>}
      {!session && intent && already && <strong>이미 가입한 사용자입니다</strong>}
      {!session && intent && !already && <>
        <strong>{intent === 'login' ? '로그인' : '가입하기'}</strong>
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
