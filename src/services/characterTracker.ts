// the character's live world position, written imperatively from Character's useFrame — the store reads it during
// placement validation so furniture can't be dropped on top of the character. A plain mutable array (not state)
// on purpose: it changes every frame and must never trigger re-renders.
const STORAGE_KEY = 'my-room-character-v1'
const savedPosition = (() => {
  try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? ''); return Array.isArray(value) && value.length === 3 ? value as [number, number, number] : null } catch { return null }
})()
// a fresh room starts the character on the open front corner, facing out toward the viewer
export const characterPosition: [number, number, number] = savedPosition ?? [2.8, 0, 2.8]

// remembered across reloads, written at most once a second while the character moves
let saveTimer: ReturnType<typeof setTimeout> | undefined
export const persistCharacterPosition = () => {
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = undefined; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(characterPosition)) } catch { /* storage may be unavailable */ } }, 1000)
}

// set by the store when the user clicks an empty floor cell; Character's useFrame applies it as an INSTANT
// position snap (no walking) on the next frame and clears it
export const characterTeleport: { position: [number, number, number] | null } = { position: null }
