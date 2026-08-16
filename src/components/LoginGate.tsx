import { useEffect, useState } from 'react'
import { currentUserEmail, isVisiting, onAuthChange, sendMagicLink } from '../services/social'

// Entering someone else's room greets the guest with a login card (email magic link). Dismissible —
// browsing stays open to everyone; logging in just attaches a verified identity to what they do.
export default function LoginGate() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [session, setSession] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [requested, setRequested] = useState(false)
  useEffect(() => {
    void currentUserEmail().then((value) => { setSession(value); setChecked(true) })
    const stopAuth = onAuthChange(setSession)
    // own-room login entry (profile card button) opens the same card
    const onOpen = () => { setRequested(true); setDismissed(false) }
    window.addEventListener('open-login', onOpen)
    return () => { stopAuth(); window.removeEventListener('open-login', onOpen) }
  }, [])
  if (!checked || session || dismissed) return null
  if (!isVisiting() && !requested) return null
  const submit = () => { if (email.includes('@')) void sendMagicLink(email).then((ok) => setSent(ok)) }
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setDismissed(true)}>
    <section className="login-card" aria-label="로그인">
      <button className="close-ui" type="button" aria-label="닫기" onClick={() => setDismissed(true)}>×</button>
      <strong>로그인</strong>
      {sent
        ? <p className="login-sent">{email}</p>
        : <div className="login-form">
          <input type="email" value={email} placeholder="이메일" onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} />
          <button type="button" onClick={submit}>메일로 로그인 링크 받기</button>
        </div>}
    </section>
  </div>
}
