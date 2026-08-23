import { loadVideoLinks, videoDisplayMeta } from './mediaStore'
import { playlistVideoResume } from './ytResume'
import { myInviteLink } from './follows'
import { myHandle } from './social'

// Room snapshot for sharing. The GL canvas cannot be read at an arbitrary moment (the drawing buffer is
// cleared after compositing), so the render loop calls flushCapture right after it draws and the pixels are
// copied synchronously in that same frame. YouTube screens are DOM iframes and never reach the canvas, so
// their spots are filled with the video's thumbnail afterwards.
let pending: ((copy: HTMLCanvasElement) => void) | null = null
export const flushCapture = (canvas: HTMLCanvasElement) => {
  if (!pending) return
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  const context = copy.getContext('2d')
  const resolve = pending
  pending = null
  if (!context) return
  context.drawImage(canvas, 0, 0)
  resolve(copy)
}
const nextRenderedFrame = () => new Promise<HTMLCanvasElement>((resolve) => { pending = resolve })

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => resolve(img)
  img.onerror = () => resolve(null)
  img.src = src
})

export async function captureRoom(): Promise<HTMLCanvasElement | null> {
  const glCanvas = document.querySelector('.canvas-host canvas') as HTMLCanvasElement | null
  if (!glCanvas) return null
  const copy = await nextRenderedFrame()
  const canvasRect = glCanvas.getBoundingClientRect()
  if (!canvasRect.width || !canvasRect.height) return copy
  const scaleX = copy.width / canvasRect.width
  const scaleY = copy.height / canvasRect.height
  const links = loadVideoLinks()
  const context = copy.getContext('2d')
  if (!context) return copy
  // ponytail: the thumbnail fills the screen's axis-aligned box, not its exact 3D parallelogram — close
  // enough at room scale; project the four corners instead if the skew ever bothers anyone.
  for (const element of document.querySelectorAll<HTMLElement>('.wall-video[data-frame-id]')) {
    const id = element.dataset.frameId ?? ''
    const link = links[id]
    if (!link) continue
    const videoId = link.startsWith('pl:') ? (playlistVideoResume[id] ?? link.slice(3).split('@')[1]) : link
    if (!videoId) continue
    const rect = element.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) continue
    const img = await loadImage(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`)
    if (!img) continue
    const crop = (await videoDisplayMeta(videoId))?.thumbnailCrop ?? { left: 0, top: 0, right: 1, bottom: 1 }
    const dx = (rect.left - canvasRect.left) * scaleX
    const dy = (rect.top - canvasRect.top) * scaleY
    const dw = rect.width * scaleX
    const dh = rect.height * scaleY
    const sx = img.width * crop.left, sy = img.height * crop.top
    const sourceWidth = img.width * (crop.right - crop.left), sourceHeight = img.height * (crop.bottom - crop.top)
    const cover = Math.max(dw / sourceWidth, dh / sourceHeight)
    const sw = dw / cover, sh = dh / cover
    context.drawImage(img, sx + (sourceWidth - sw) / 2, sy + (sourceHeight - sh) / 2, sw, sh, dx, dy, dw, dh)
  }
  return copy
}

// mobile gets the native share sheet (image + invite link); desktop saves the image and copies the link
export async function shareRoom(): Promise<'shared' | 'saved' | null> {
  const canvas = await captureRoom()
  if (!canvas) return null
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .9))
  if (!blob) return null
  const link = (await myInviteLink()) ?? `${location.origin}/${myHandle() ?? ''}`
  const file = new File([blob], 'my-room.jpg', { type: 'image/jpeg' })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: '내 방에 놀러와', url: link })
      return 'shared'
    } catch { return null } // user closed the sheet
  }
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = 'my-room.jpg'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(anchor.href), 5000)
  await navigator.clipboard.writeText(link).catch(() => { /* clipboard unavailable */ })
  return 'saved'
}
