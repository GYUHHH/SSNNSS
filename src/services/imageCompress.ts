// Photos are shrunk before they are ever uploaded. A phone camera file runs to several megabytes and nothing here
// is ever shown larger than a wall panel, so the full resolution only ever costs storage and load time.
//
// WebP because every browser that can run this app encodes it, it beats JPEG at the same quality, and it keeps an
// alpha channel — a cut-out PNG survives the trip instead of gaining a black background.
//
// No dependencies on purpose: this is imported by social.ts, which mediaStore.ts already imports, so anything it
// reached back into would close a cycle.
const MAX_EDGE = 1600
const QUALITY = 0.82

export async function compressImage(file: Blob): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const shrunk = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY))
    // Something already optimised — an icon, a small screenshot — can come back BIGGER after a re-encode, so the
    // original wins whenever it is smaller. That also makes this safe to put in front of every upload.
    return shrunk && shrunk.size < file.size ? shrunk : file
  } catch {
    // a format the browser cannot decode (HEIC on some desktops, an SVG) uploads untouched rather than failing
    return file
  }
}
