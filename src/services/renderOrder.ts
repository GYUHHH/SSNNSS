// Stable room layers: wall media at the back, ordinary wall decor above it, floor furniture in front.
// Keep the classification here so new render paths cannot quietly invent a different order.
export const WALL_VIDEO_ORDER = 9
export const WALL_MEDIA_ORDER = 10
export const WALL_DECOR_ORDER = 20
export const ROOM_OBJECT_ORDER = 30

export const isWallMedia = (type: string) => type === 'photo' || type === 'poster' || type === 'animated-poster'
  || type.startsWith('photo-frame') || type.startsWith('video-frame') || type.startsWith('wall-art')
export const wallItemOrder = (type: string) => isWallMedia(type) ? WALL_MEDIA_ORDER : WALL_DECOR_ORDER

if (import.meta.env.DEV) console.assert(wallItemOrder('poster') < wallItemOrder('clock') && wallItemOrder('clock') < ROOM_OBJECT_ORDER, 'room layer order must be media < wall decor < floor furniture')
// drei Html is a DOM layer, so WebGL renderOrder cannot place it by itself. Wall media must stay at the range
// where blending remains visible; room popups sit above it, and fixed app panels sit above both in CSS.
export const WALL_HTML_Z_INDEX_RANGE: [number, number] = [4, 0]
export const ROOM_HTML_Z_INDEX_RANGE: [number, number] = [9, 7]
