// the character's live world position, written imperatively from Character's useFrame — the store reads it during
// placement validation so furniture can't be dropped on top of the character. A plain mutable array (not state)
// on purpose: it changes every frame and must never trigger re-renders.
export const characterPosition: [number, number, number] = [0.1, 0, -0.2]

// set by the store when the user clicks an empty floor cell; Character's useFrame applies it as an INSTANT
// position snap (no walking) on the next frame and clears it
export const characterTeleport: { position: [number, number, number] | null } = { position: null }
