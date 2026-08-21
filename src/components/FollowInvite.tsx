import { useEffect, useState } from 'react'
import { currentRoomHandle, isSignedIn, myHandle, onAuthChange } from '../services/social'
import { acceptFollowInvite, clearInviteFromUrl, inviteToken } from '../services/follows'

// The ?invite= confirmation bar. An invite link opens the inviter's room with the token in the address;
// this offers the mutual follow once, and disappears for good on accept, decline or an invalid token.
export default function FollowInvite() {
  const token = inviteToken()
  const [host] = useState(() => currentRoomHandle())
  const [signedIn, setSignedIn] = useState(() => isSignedIn() && !!myHandle())
  const [state, setState] = useState<'ask' | 'done' | 'gone'>('ask')
  const [doneWith, setDoneWith] = useState('')
  // a signup finishing mid-visit flips the button from "가입하고" to the real accept
  useEffect(() => onAuthChange(() => setSignedIn(isSignedIn() && !!myHandle())), [])
  if (!token || state === 'gone' || !host || myHandle() === host) return null
  const accept = () => void acceptFollowInvite(token).then((owner) => {
    clearInviteFromUrl()
    if (!owner) { setState('gone'); return }
    setDoneWith(owner)
    setState('done')
  })
  if (state === 'done') return <div className="invite-bar"><span>{doneWith}님과 서로 팔로우했어요</span><button type="button" onClick={() => setState('gone')}>확인</button></div>
  return <div className="invite-bar">
    <span>{host}님과 서로 팔로우할까요?</span>
    {signedIn
      ? <button type="button" className="primary" onClick={accept}>서로 팔로우</button>
      : <button type="button" className="primary" onClick={() => window.dispatchEvent(new CustomEvent('need-id', { detail: 'signup' }))}>가입하고 서로 팔로우</button>}
    <button type="button" onClick={() => { setState('gone'); clearInviteFromUrl() }}>닫기</button>
  </div>
}
