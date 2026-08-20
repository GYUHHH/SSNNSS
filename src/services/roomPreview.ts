// Room saves can happen in bursts while furniture is being moved. Capture only after the room has settled,
// then let the canvas owner supply the actual render and upload destination.
export const ROOM_PREVIEW_KEY = 'room_preview'

let changedAt = 0
let revision = 0
let capturing = false

export const markRoomPreviewDirty = () => { changedAt = performance.now(); revision += 1 }

export async function saveRoomPreview(capture: () => Promise<Blob | null>, save: (blob: Blob) => Promise<boolean>) {
  if (capturing || !changedAt || performance.now() - changedAt < 900) return
  capturing = true
  const current = revision
  try {
    const blob = await capture()
    if (!blob || current !== revision || !await save(blob)) return
    if (current === revision) changedAt = 0
  } finally { capturing = false }
}
