import { currentRoomHandle } from './social'

// The neighbourhood is just the list of published rooms. Only their handles are pulled — a room's full bundle
// is megabytes, and the browsing view needs a cube and a name, not somebody's furniture.
const SUPABASE_URL = 'https://pxjavljsalibpnxdrxel.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4amF2bGpzYWxpYnBueGRyeGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjAxNTgsImV4cCI6MjEwMjQzNjE1OH0.quIFdlk11b7F-YIeHO3TsEhS2RzgxDtntqdh2vHyUfE'

export type Neighbour = { handle: string; cell: [number, number] }

// A honeycomb ring, not a square grid. Seen from the isometric camera the floor is a diamond, so the four
// axis neighbours land on its four edges (the two lower ones included) and the two diagonals sit straight
// above and below — together they close a six-room ring around the centre, every edge meeting an edge.
// The two remaining diagonals are deliberately left out: they would stick out sideways and break the ring.
const RING: Array<[number, number]> = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1],
  [2, 1], [1, 2], [2, 2], [-2, -1], [-1, -2], [-2, -2],
  [2, 0], [0, 2], [-2, 0], [0, -2],
]

let cache: Neighbour[] | null = null
export async function loadNeighbours(): Promise<Neighbour[]> {
  if (cache) return cache
  try {
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/rooms?select=handle&order=handle`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }).then((response) => response.json())
    const here = currentRoomHandle()
    const others: string[] = Array.isArray(rows) ? rows.map((row: { handle: string }) => row.handle).filter((handle) => handle !== here) : []
    cache = others.slice(0, RING.length).map((handle, index) => ({ handle, cell: RING[index] }))
  } catch { cache = [] }
  return cache
}
// the room you are standing in always sits at the centre, so the list is rebuilt after moving
export const forgetNeighbours = () => { cache = null }
