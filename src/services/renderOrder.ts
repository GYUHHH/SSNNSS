export const WALL_BACKDROP_ORDER = 10
export const ROOM_OBJECT_ORDER = 20
// drei Html is a DOM layer, so WebGL renderOrder cannot place it by itself. Wall media must stay at the range
// where blending remains visible; room popups sit above it, and fixed app panels sit above both in CSS.
export const WALL_HTML_Z_INDEX_RANGE: [number, number] = [4, 0]
export const ROOM_HTML_Z_INDEX_RANGE: [number, number] = [9, 7]
