// Wall iframe invariant: punch the video through the wall after the wall itself, but before every decoration
// and room object. Never reuse this order for furniture or the iframe can cover it again at some camera angles.
export const WALL_VIDEO_ORDER = 9
export const WALL_BACKDROP_ORDER = 10
export const ROOM_OBJECT_ORDER = 20
// drei Html is a DOM layer, so WebGL renderOrder cannot place it by itself. Wall media must stay at the range
// where blending remains visible; room popups sit above it, and fixed app panels sit above both in CSS.
export const WALL_HTML_Z_INDEX_RANGE: [number, number] = [4, 0]
export const ROOM_HTML_Z_INDEX_RANGE: [number, number] = [9, 7]
