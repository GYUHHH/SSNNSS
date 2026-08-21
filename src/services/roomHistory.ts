import { currentRoomHandle, enterLobby, enterRoom, myHandle, pathHandle } from './social'

// Back and forward between rooms. Entering a room pushes a history entry (see enterRoom), so the browser buttons
// and the phone's system back already work; this module carries the address change back into the app and adds the
// two gestures people expect — a trackpad's two-finger swipe, and a pull from the very edge of a phone screen.

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

// One navigation per gesture: the wheel keeps firing (and momentum keeps arriving) long after the step is taken.
let quietUntil = 0
const step = (forward: boolean) => {
  quietUntil = performance.now() + 700
  travel = 0
  forward ? history.forward() : history.back()
}

// Two-finger horizontal swipe. Owned here rather than left to the browser's own overscroll navigation, which
// never sees these wheels — the canvas cancels every one of them to drive the zoom.
const SWIPE = 120
let travel = 0
let lastWheel = 0
const onWheel = (event: WheelEvent) => {
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
  const now = performance.now()
  if (now < quietUntil) return
  if (now - lastWheel > 260) travel = 0
  lastWheel = now
  travel += event.deltaX
  // fingers moving right (content dragged back) is back, the way every browser reads the same gesture
  if (Math.abs(travel) >= SWIPE) step(travel > 0)
}

// A pull that starts at the very edge of the screen. Anywhere else belongs to the camera, and anything starting
// on a panel belongs to that panel.
const EDGE = 26
const PULL = 70
let pull: { forward: boolean; x: number; y: number } | null = null
const onTouchStart = (event: TouchEvent) => {
  pull = null
  if (event.touches.length !== 1 || performance.now() < quietUntil) return
  if ((event.target as HTMLElement | null)?.closest?.('.art-panel, .inventory-panel, .overlay, .dock, .diary, .style-panel')) return
  const touch = event.touches[0]
  if (touch.clientX <= EDGE) pull = { forward: false, x: touch.clientX, y: touch.clientY }
  else if (touch.clientX >= window.innerWidth - EDGE) pull = { forward: true, x: touch.clientX, y: touch.clientY }
}
const onTouchMove = (event: TouchEvent) => {
  if (!pull || event.touches.length !== 1) return
  const touch = event.touches[0]
  const dx = touch.clientX - pull.x
  const dy = touch.clientY - pull.y
  if (Math.abs(dy) > Math.abs(dx)) { pull = null; return }
  if (pull.forward ? dx <= -PULL : dx >= PULL) { const { forward } = pull; pull = null; step(forward) }
}
const dropPull = () => { pull = null }

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', followAddress)
  window.addEventListener('wheel', onWheel, { passive: true })
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: true })
  window.addEventListener('touchend', dropPull, { passive: true })
  window.addEventListener('touchcancel', dropPull, { passive: true })
}
