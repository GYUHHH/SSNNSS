import { isVisiting, readStored, schedulePublish } from './social'
// the character's live world position, written imperatively from Character's useFrame — the store reads it during
// placement validation so furniture can't be dropped on top of the character. A plain mutable array (not state)
// on purpose: it changes every frame and must never trigger re-renders.
const STORAGE_KEY = 'my-room-character-v1'
// a fresh room starts the character on the open front corner, facing out toward the viewer
export const characterPosition: [number, number, number] = [2.8, 0, 2.8]

// remembered across reloads, written at most once a second while the character moves
let saveTimer: ReturnType<typeof setTimeout> | undefined
export const persistCharacterPosition = () => {
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = undefined; if (isVisiting()) return; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(characterPosition)); schedulePublish() } catch { /* storage may be unavailable */ } }, 1000)
}

// The rest of what a pose is made of, kept beside the position for the same reason: written every frame from
// Character's useFrame, so it must not be state. `facing` is the actor's own Y rotation and `y` its height — a
// seated character sits AT the seat's top, so without the height it would sink to the floor when another browser
// draws it. Both are read when the pose is saved, never per frame.
export const characterAttitude = { facing: Math.PI / 4, y: 0 }

// Seeded from the last save AFTER the boot sync, never at module load. At the bare root address isVisiting() is
// still true when this module first runs — the sync has not yet claimed the address for the owner — so a read
// here comes back empty: the character booted on the default corner with the default bearing, and the save that
// runs on mount then published those defaults over the real pose. main.tsx calls this once the sync has settled,
// which is also before anything renders.
export const seedCharacterFromStorage = () => {
  try {
    const value = JSON.parse(readStored(STORAGE_KEY) ?? '')
    if (Array.isArray(value) && value.length === 3) { characterPosition[0] = value[0]; characterPosition[1] = value[1]; characterPosition[2] = value[2] }
  } catch { /* nothing stored */ }
  try {
    const pose = JSON.parse(readStored('my-room-interactions-v1') ?? '')?.pose
    if (pose && typeof pose.state === 'string') { characterAttitude.facing = Number(pose.facing) || Math.PI / 4; characterAttitude.y = Number(pose.y) || 0 }
  } catch { /* nothing stored */ }
}

// set by the store when the user clicks an empty floor cell; Character's useFrame applies it as an INSTANT
// position snap (no walking) on the next frame and clears it
export const characterTeleport: { position: [number, number, number] | null } = { position: null }

// a live room update carries a new spot for the character — take it and let the next frame snap there
export const adoptCharacterPosition = () => {
  try {
    const value = JSON.parse(readStored(STORAGE_KEY) ?? '')
    if (!Array.isArray(value) || value.length !== 3) return
    if (Math.hypot(value[0] - characterPosition[0], value[2] - characterPosition[2]) < .01) return
    characterTeleport.position = value as [number, number, number]
  } catch { /* nothing stored */ }
}
