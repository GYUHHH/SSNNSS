import { useRef } from 'react'
import { explorerAnimationsAreMoving } from '../services/renderSync'
import { useOptionalRoomStore } from '../store'

// Live rooms and explorer transitions stay full-rate. Once a read-only neighbour settles, all of its visual
// motion shares the same 12fps ceiling; elapsed time is returned so relative animations keep their real speed.
export const usePreviewFrame = (fps = 12) => {
  const readOnly = !!useOptionalRoomStore()?.readOnly
  const last = useRef(-Infinity)
  return (time: number, delta: number) => {
    if (!readOnly || explorerAnimationsAreMoving()) { last.current = time; return delta }
    const elapsed = time - last.current
    if (Number.isFinite(last.current) && elapsed < 1 / fps) return 0
    last.current = time
    return Number.isFinite(elapsed) ? Math.min(elapsed, .1) : delta
  }
}
