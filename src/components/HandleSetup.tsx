import { useState } from 'react'
import { useRoomStore } from '../store'
import { handleTaken, isVisiting, publishRoom } from '../services/social'

// First entry asks for an id right away: once claimed (uniqueness checked) the personal room publishes
// under it and gets its share address. Dismissible — it returns on the next visit until an id is set.
export default function HandleSetup() {
  const { setProfileHandle, profile } = useRoomStore()
  const [value, setValue] = useState('')
  const [taken, setTaken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  if (isVisiting() || profile.handle || dismissed) return null
  const clean = value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  const valid = /^[a-z0-9_]{3,20}$/.test(clean)
  const claim = async () => {
    if (!valid || busy) return
    setBusy(true)
    if (await handleTaken(clean)) { setTaken(true); setBusy(false); return }
    setProfileHandle(clean)
    await publishRoom()
    setBusy(false)
  }
  return <div className="overlay" onMouseDown={(event) => event.currentTarget === event.target && setDismissed(true)}>
    <section className="login-card" aria-label="아이디 설정">
      <button className="close-ui" type="button" aria-label="닫기" onClick={() => setDismissed(true)}>×</button>
      <strong>아이디 설정</strong>
      <div className="login-form">
        <input type="text" value={clean} className={taken ? 'taken' : ''} placeholder="영문 소문자, 숫자, _" onChange={(event) => { setValue(event.target.value); setTaken(false) }} onKeyDown={(event) => { if (event.key === 'Enter') void claim() }} />
        <button type="button" disabled={!valid || busy} onClick={() => void claim()}>{taken ? '이미 사용 중' : '이 아이디로 시작'}</button>
      </div>
    </section>
  </div>
}
