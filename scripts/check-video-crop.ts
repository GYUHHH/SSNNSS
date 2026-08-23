import { strict as assert } from 'node:assert'
import { detectVideoContent } from '../src/services/videoCrop.ts'

const width = 320, height = 180, data = new Uint8ClampedArray(width * height * 4)
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const at = (y * width + x) * 4
  const bar = x < 70 || x >= 250
  data.set(bar ? [57, 64, 10, 255] : [100 + x % 80, 30 + y % 90, 90, 255], at)
}
const crop = detectVideoContent(data, width, height)
assert(Math.abs(crop.left - 70 / width) < .001)
assert(Math.abs(crop.right - 250 / width) < .001)
console.log('video crop check passed')
