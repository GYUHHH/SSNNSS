// Comment stamps read as distance from now, not as a calendar date — "3시간 전" tells the reader what a date
// makes them work out. Rounded down at every step, so it never claims more time has passed than actually has.
const UNITS: Array<[seconds: number, label: string]> = [
  [31536000, '년'],
  [2592000, '달'],
  [86400, '일'],
  [3600, '시간'],
  [60, '분'],
]

export const timeAgo = (iso: string): string => {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const seconds = Math.max(0, (Date.now() - at) / 1000)
  for (const [size, label] of UNITS) {
    const count = Math.floor(seconds / size)
    if (count >= 1) return `${count}${label} 전`
  }
  return '방금'
}
