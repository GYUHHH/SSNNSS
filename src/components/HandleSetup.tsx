import { useEffect, useState } from 'react'
import { adoptRoomData, cancelSignup, claimHandleLocally, currentUserEmail, googleEnabled, handleTaken, isPlainRoot, isVisiting, myHandle, onAuthChange, ownedRoom, publishRoom, roomPath, sendOtpCode, setPassword as setPassword_, signInWithGoogle, signInWithPassword, verifyOtpCode } from '../services/social'
import { t } from '../services/i18n'

// First-time onboarding: email → emailed 6-digit code → pick a unique id. Claiming publishes the personal
// room, binds it to the account, and moves to its address (domain)/(id).
export default function HandleSetup() {
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
  // which action is running, not merely that one is — a single boolean would spin every button at once
  const [busy, setBusy] = useState<string | null>(null)
  const [roomChecked, setRoomChecked] = useState(false)
  const [requested, setRequested] = useState(false)
  // which button was pressed on the first screen — the flow after it is identical either way
  const [intent, setIntent] = useState<'login' | 'signup' | null>(null)
  const [already, setAlready] = useState(false)
  const [verified, setVerified] = useState(false)
  const [password, setPassword] = useState('')
  const [loginFailed, setLoginFailed] = useState(false)
  const [publishFailed, setPublishFailed] = useState(false)
  // verifyOtpCode signs the user in, so `session` lands one await before `verified` does — and `session && !verified`
  // is exactly the id step's condition, which is why it flashed on its way to the password step
  const [checkingCode, setCheckingCode] = useState(false)
  const [google, setGoogle] = useState(false)
  useEffect(() => { void googleEnabled().then(setGoogle) }, [])
  // While an action runs its button shows a turning ring instead of its label, so a slow network reads as
  // progress rather than a dead button. aria-label keeps the name the ring replaces.
  const work = (action: string, text: string) => ({
    'aria-label': text,
    children: busy === action ? <span className="btn-spin" aria-hidden="true" /> : text,
  })
  const close = () => {
    setDismissed(true); setRequested(false); setIntent(null); setAlready(false)
    setEmail(''); setCode(''); setCodeSent(false); setCodeBad(false); setSendFailed(false); setValue(''); setTaken(false)
    setVerified(false); setPassword(''); setLoginFailed(false); setPublishFailed(false); setBusy(null); setCheckingCode(false)
    // a session with no id is a signup that was walked away from — leaving it standing means reopening the card
    // lands back on the id step, since that step only ever asks for `session && !verified`
    if (session && !mine) void cancelSignup()
  }
  useEffect(() => {
    const onNeed = (event: Event) => { const wanted = (event as CustomEvent<'login' | 'signup' | undefined>).detail; setRequested(true); setDismissed(false); if (wanted) setIntent(wanted) }
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
    // being signed in outranks the address: the plain root skips the lookup only for anonymous visitors, or a
    // signed-in owner standing at / would be asked to invent an id while their room sits in the database
    if (!session) { if (isPlainRoot()) setRoomChecked(true); return }
    if (mine) return
    // A signed-out card at the plain root already set roomChecked, and signing in does not clear it — so the id
    // step passed its guard the instant the session landed, before this lookup could redirect an account that
    // already owns a room. A new session gets looked up from scratch.
    setRoomChecked(false)
    let live = true
    void ownedRoom().then((room) => {
      if (!live) return
      if (!room) { setRoomChecked(true); return }
      adoptRoomData(room.data, room.handle)
      location.replace(roomPath(room.handle))
    })
    return () => { live = false }
  }, [session, mine])
  // while the owned-room lookup is in flight the id step must stay hidden, or it flashes before the redirect
  // inside someone else's room the card stays out of the way until an action actually needs an id
  if (mine || dismissed || !checked || (session && !roomChecked && !verified && !checkingCode)) return null
  if (isVisiting() && !requested) return null
  const clean = value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  const valid = /^[a-z0-9_]{3,20}$/.test(clean)
  const sendCode = async () => {
    if (!email.includes('@') || busy) return
    setBusy('code-send')
    const ok = await sendOtpCode(email)
    setCodeSent(ok)
    setSendFailed(!ok)
    setBusy(null)
  }
  const confirmCode = async () => {
    if (code.trim().length < 6 || busy) return
    setBusy('code-check'); setCheckingCode(true)
    const ok = await verifyOtpCode(email, code.trim())
    setCodeBad(!ok)
    if (ok) { if (await ownedRoom()) setAlready(true); else setVerified(true) }
    // cleared in the same batch as the step above, so the swap happens in one render with nothing in between
    setCheckingCode(false); setBusy(null)
  }
  const savePassword = async () => {
    if (password.length < 6 || busy) return
    setBusy('password')
    await setPassword_(password)
    setVerified(false)
    setBusy(null)
  }
  const signIn = async () => {
    if (!email.includes('@') || password.length < 6 || busy) return
    setBusy('login')
    const ok = await signInWithPassword(email, password)
    setLoginFailed(!ok)
    setBusy(null)
  }
  const claim = async () => {
    if (!valid || busy) return
    setBusy('claim')
    if (await handleTaken(clean)) { setTaken(true); setBusy(null); return }
    // Establish the new account with a clean default profile. Never merge the room currently being viewed:
    // while signing up there, its profile belongs to the host, not to this new account.
    claimHandleLocally(clean)
    if (!await publishRoom()) { setPublishFailed(true); setBusy(null); return }
    location.replace(roomPath(clean))
  }
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && close()}>
    <section className="login-card" aria-label={t('가입')}>
      {!session && !intent && <>
        <strong>{t('시작하기')}</strong>
        <div className="login-form">
          <button type="button" onClick={() => setIntent('login')}>{t('로그인')}</button>
          <button type="button" className="ghost" onClick={() => setIntent('signup')}>{t('가입하기')}</button>
        </div>
      </>}
      {!session && intent && already && <strong>{t('이미 가입한 사용자입니다')}</strong>}
      {!session && intent === 'login' && !already && <>
        <strong>{t('로그인')}</strong>
        <div className="login-form">
          <input type="email" value={email} placeholder={t('이메일')} onChange={(event) => { setEmail(event.target.value); setLoginFailed(false) }} />
          <input type="password" value={password} className={loginFailed ? 'taken' : ''} placeholder={t('비밀번호')} onChange={(event) => { setPassword(event.target.value); setLoginFailed(false) }} onKeyDown={(event) => { if (event.key === 'Enter') void signIn() }} />
          <button type="button" disabled={!email.includes('@') || password.length < 6 || !!busy} onClick={() => void signIn()} {...work('login', loginFailed ? t('이메일 또는 비밀번호가 달라요') : t('이메일로 로그인'))} />
          {google && <button type="button" className="ghost" disabled={!!busy} onClick={() => { setBusy('google'); void signInWithGoogle() }} {...work('google', t('Google로 로그인'))} />}
        </div>
      </>}
      {(!session || checkingCode) && intent === 'signup' && !already && !verified && <>
        <strong>{t('가입하기')}</strong>
        <div className="login-form">
          <input type="email" value={email} placeholder={t('이메일')} disabled={codeSent} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sendCode() }} />
          {!codeSent && <>
            <button type="button" disabled={!email.includes('@') || !!busy} onClick={() => void sendCode()} {...work('code-send', sendFailed ? t('잠시 후 다시 시도') : t('인증번호 받기'))} />
            {google && <button type="button" className="ghost" disabled={!!busy} onClick={() => { setBusy('google'); void signInWithGoogle() }} {...work('google', t('Google로 가입하기'))} />}
          </>}
          {codeSent && <>
            <input type="text" inputMode="numeric" value={code} className={codeBad ? 'taken' : ''} placeholder={t('인증번호')} onChange={(event) => { setCode(event.target.value); setCodeBad(false) }} onKeyDown={(event) => { if (event.key === 'Enter') void confirmCode() }} />
            <button type="button" disabled={code.trim().length < 6 || !!busy} onClick={() => void confirmCode()} {...work('code-check', codeBad ? t('번호가 달라요') : t('확인'))} />
          </>}
        </div>
      </>}
      {/* Verifying the code signs the user in, so `session` fills the moment the code is accepted. This step must
          not be gated on !session or it disappears exactly when it is due — and with it savePassword, which is
          what clears `verified` and lets the id step below appear. That left an empty card. */}
      {verified && <>
        <strong>{t('비밀번호 설정')}</strong>
        <div className="login-form">
          <input type="password" value={password} placeholder={t('비밀번호 (6자 이상)')} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void savePassword() }} />
          <button type="button" disabled={password.length < 6 || !!busy} onClick={() => void savePassword()} {...work('password', t('비밀번호 저장'))} />
        </div>
      </>}
      {session && !verified && !checkingCode && <>
        <strong>{t('아이디 설정')}</strong>
        <div className="login-form">
          <input type="text" value={clean} className={taken ? 'taken' : ''} placeholder={t('영문 소문자, 숫자, _')} onChange={(event) => { setValue(event.target.value); setTaken(false); setPublishFailed(false) }} onKeyDown={(event) => { if (event.key === 'Enter') void claim() }} />
          <button type="button" disabled={!valid || !!busy} onClick={() => void claim()} {...work('claim', taken ? t('이미 사용 중') : publishFailed ? t('저장 실패, 다시 시도') : t('이 아이디로 시작'))} />
        </div>
      </>}
    </section>
  </div>
}
