let roomFrameRendered = false
let explorerMotionUntil = 0

export const setRoomFrameRendered = (rendered: boolean) => { roomFrameRendered = rendered }
export const didRenderRoomFrame = () => roomFrameRendered
export const keepExplorerAnimationsSmooth = (milliseconds = 120) => { explorerMotionUntil = Math.max(explorerMotionUntil, performance.now() + milliseconds) }
export const explorerAnimationsAreMoving = () => performance.now() < explorerMotionUntil
