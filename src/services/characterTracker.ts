// Runtime-only owner position for placement collision checks. Persistence and room ownership live in RoomProvider;
// a visiting character never writes here.
export const characterPosition: [number, number, number] = [2.8, 0, 2.8]
export const characterFacing = { current: Math.PI / 4 }
// First-person view owns the desired heading while it is mounted. Character applies it only to free-standing
// poses, so looking around turns the avatar other visitors see without twisting a seated/lying interaction.
export const characterViewFacing = { current: null as number | null }
