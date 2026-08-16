import { useEffect, useState } from 'react'
import { useRoomStore } from '../store'
import { adoptRoomData, currentUserEmail, handleTaken, isVisiting, myHandle, onAuthChange, ownedRoom, publishRoom } from '../services/social'

// The id-claiming step after signup: a logged-in account with no id picks one here (uniqueness checked),
// and the personal room publishes under it, bound to the account. If the account already owns a room —
// a fresh device — the server copy is adopted locally instead, so nothing gets overwritten.
export default function HandleSetup() {
  const { setProfileHandle, profile } = useRoomStore()
  const [needed, setNeeded] = useState(false)
  const [value, setValue] = useState('')
  const [taken, setTaken] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    const evaluate = async (email: string | null) => {
      if (!email || isVisiting() || myHandle()) { if (live) setNeeded(false); return }
      const existing = await ownedRoom()
      if (!live) return
      if (existing) { adoptRoomData(existing.data); location.reload(); return }
      setNeeded(true)
    }
    void currentUserEmail().then(evaluate)
    const stop = onAuthChange((email) => { void evaluate(email) })
    return () => { live = false; stop() }
  }, [])
  if (!needed || profile.handle) return null
  const clean = value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  const valid = /^[a-z0-9_]{3,20}$/.test(clean)
  const claim = async () => {
    if (!valid || busy) return
    setBusy(true)
    if (await handleTaken(clean)) { setTaken(true); setBusy(false); return }
    setProfileHandle(clean)
    await publishRoom()
    setBusy(false)
    setNeeded(false)
  }
  return <div className="overlay">
    <section className="login-card" aria-label="아이디 설정">
      <strong>아이디 설정</strong>
      <div className="login-form">
        <input type="text" value={clean} className={taken ? 'taken' : ''} placeholder="영문 소문자, 숫자, _" onChange={(event) => { setValue(event.target.value); setTaken(false) }} onKeyDown={(event) => { if (event.key === 'Enter') void claim() }} />
        <button type="button" disabled={!valid || busy} onClick={() => void claim()}>{taken ? '이미 사용 중' : '이 아이디로 시작'}</button>
      </div>
    </section>
  </div>
}
