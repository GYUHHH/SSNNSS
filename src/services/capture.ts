import { loadVideoLinks, videoDisplayMeta } from './mediaStore'
import { playlistVideoResume } from './ytResume'
import { myInviteLink } from './follows'
import { myHandle } from './social'
import { t } from './i18n'

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
  // The live iframe sits behind the WebGL canvas. Match that stack in the exported image: transparent video
  // holes receive the thumbnail, while opaque furniture already drawn by WebGL stays in front.
  context.globalCompositeOperation = 'destination-over'
  // ponytail: the thumbnail fills the screen's axis-aligned box, not its exact 3D parallelogram — close
  // enough at room scale; project the four corners instead if the skew ever bothers anyone.
  for (const element of document.querySelectorAll<HTMLElement>('.wall-video[data-frame-id]')) {
    const id = element.dataset.frameId ?? ''
    const link = links[id]
    if (!link) continue
    // 화면에 실제 떠 있는 곡이 캡처의 기준이다. 플레이리스트 저장값은 전환 직후 잠깐 이전 곡일 수 있다.
    const videoId = element.dataset.videoId || (link.startsWith('pl:') ? (playlistVideoResume[id] ?? link.slice(3).split('@')[1]) : link)
    if (!videoId) continue
    const rect = element.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) continue
    // 외부 ytimg는 모바일 캔버스에서 CORS로 빠질 수 있다. 비율 판정과 같은 동일 출처 프록시를 쓴다.
    const img = await loadImage(`/api/youtube-thumbnail?id=${encodeURIComponent(videoId)}&variant=mq-v2`)
    if (!img) continue
    const crop = (await videoDisplayMeta(videoId))?.thumbnailCrop ?? { left: 0, top: 0, right: 1, bottom: 1 }
    const targetWidth = element.offsetWidth
    const targetHeight = element.offsetHeight
    const sx = img.width * crop.left, sy = img.height * crop.top
    const sourceWidth = img.width * (crop.right - crop.left), sourceHeight = img.height * (crop.bottom - crop.top)
    const cover = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
    const sw = targetWidth / cover, sh = targetHeight / cover
    const values = element.style.transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number)
    context.save()
    if (values?.length === 6 && values.every(Number.isFinite)) {
      const [a, b, c, d, e, f] = values
      context.setTransform(a * scaleX, b * scaleY, c * scaleX, d * scaleY, e * scaleX, f * scaleY)
      context.drawImage(img, sx + (sourceWidth - sw) / 2, sy + (sourceHeight - sh) / 2, sw, sh, 0, 0, targetWidth, targetHeight)
    } else {
      context.drawImage(img, sx + (sourceWidth - sw) / 2, sy + (sourceHeight - sh) / 2, sw, sh, (rect.left - canvasRect.left) * scaleX, (rect.top - canvasRect.top) * scaleY, rect.width * scaleX, rect.height * scaleY)
    }
    context.restore()
  }
  context.globalCompositeOperation = 'source-over'
  return copy
}

const captureFile = async () => {
  const canvas = await captureRoom()
  if (!canvas) return null
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .9))
  return blob ? new File([blob], 'my-room.jpg', { type: 'image/jpeg' }) : null
}

export async function saveRoomCapture(): Promise<'saved' | null> {
  const file = await captureFile()
  if (!file) return null
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(file)
  anchor.download = file.name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(anchor.href), 5000)
  return 'saved'
}

// mobile gets the native share sheet (image + invite link); desktop saves the image and copies the link
export async function shareRoom(): Promise<'shared' | 'saved' | null> {
  const file = await captureFile()
  if (!file) return null
  const link = (await myInviteLink()) ?? `${location.origin}/${myHandle() ?? ''}`
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: t('내 방에 놀러와'), url: link })
      return 'shared'
    } catch { return null } // user closed the sheet
  }
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(file)
  anchor.download = file.name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(anchor.href), 5000)
  await navigator.clipboard.writeText(link).catch(() => { /* clipboard unavailable */ })
  return 'saved'
}
