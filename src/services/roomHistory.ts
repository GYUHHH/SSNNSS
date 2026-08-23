import { currentRoomHandle, enterLobby, enterRoom, myHandle, pathHandle } from './social'

// Back and forward between rooms. Entering a room pushes a history entry (see enterRoom), so the browser buttons
// and the phone's system back already work; this module carries the address change back into the app.

const followAddress = () => {
  const handle = pathHandle()
  if (handle === currentRoomHandle()) return
  if (handle) void enterRoom(handle, true)
  else {
    // an entry from before the address carried a room: the owner's own room is what that spot was showing
    const me = myHandle()
    if (me) void enterRoom(me, true)
    else enterLobby()
  }
}

if (typeof window !== 'undefined') window.addEventListener('popstate', followAddress)
