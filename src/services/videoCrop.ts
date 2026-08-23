export type VideoCrop = { left: number; top: number; right: number; bottom: number }
export const fullCrop: VideoCrop = { left: 0, top: 0, right: 1, bottom: 1 }

export const fittedRect = (outerAspect: number, innerAspect: number): VideoCrop => {
  if (innerAspect > outerAspect) {
    const height = outerAspect / innerAspect
    return { left: 0, right: 1, top: (1 - height) / 2, bottom: (1 + height) / 2 }
  }
  const width = innerAspect / outerAspect
  return { left: (1 - width) / 2, right: (1 + width) / 2, top: 0, bottom: 1 }
}

// mqdefault preserves the exact 16:9 player picture, including pillar/letterbox bands. A band may be coloured
// (Lemonade uses dark olive), so detect a symmetric flat edge rather than black alone.
export function detectVideoContent(data: Uint8ClampedArray, width: number, height: number): VideoCrop {
  const pixel = (x: number, y: number) => { const at = (y * width + x) * 4; return [data[at], data[at + 1], data[at + 2]] as const }
  const similar = (a: readonly number[], b: readonly number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 58
  const scan = (side: 'top' | 'right' | 'bottom' | 'left') => {
    const vertical = side === 'top' || side === 'bottom'
    const limit = Math.floor((vertical ? height : width) * .3)
    const reference = vertical
      ? pixel(Math.floor(width / 2), side === 'top' ? 0 : height - 1)
      : pixel(side === 'left' ? 0 : width - 1, Math.floor(height / 2))
    let amount = 0
    for (; amount < limit; amount++) {
      let alike = 0, samples = 0
      const length = vertical ? width : height
      for (let along = 0; along < length; along += 4) {
        const value = vertical
          ? pixel(along, side === 'top' ? amount : height - 1 - amount)
          : pixel(side === 'left' ? amount : width - 1 - amount, along)
        if (similar(value, reference)) alike++
        samples++
      }
      if (alike / samples < .82) break
    }
    return amount
  }
  let top = scan('top'), right = scan('right'), bottom = scan('bottom'), left = scan('left')
  if (Math.abs(top - bottom) > height * .035 || Math.min(top, bottom) < 2) top = bottom = 0
  if (Math.abs(left - right) > width * .035 || Math.min(left, right) < 2) left = right = 0
  return { left: left / width, top: top / height, right: 1 - right / width, bottom: 1 - bottom / height }
}
