let roomFrameRendered = false

export const setRoomFrameRendered = (rendered: boolean) => { roomFrameRendered = rendered }
export const didRenderRoomFrame = () => roomFrameRendered
