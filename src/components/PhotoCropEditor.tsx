import { useRef, useState } from 'react'

export function PhotoCropEditor({ source, aspect: fixedAspect, output, onApply, onClose }: { source: string; aspect?: number; output?: [number, number]; onApply: (image: string) => void; onClose: () => void }) {
  const crop = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const start = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const [aspect, setAspect] = useState(fixedAspect ?? 4 / 3)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const clamp = (next: { x: number; y: number }, zoom = scale) => {
    const area = crop.current; const photo = image.current
    if (!area || !photo?.naturalWidth) return next
    const base = Math.max(area.clientWidth / photo.naturalWidth, area.clientHeight / photo.naturalHeight)
    return { x: Math.max(-(photo.naturalWidth * base * zoom - area.clientWidth) / 2, Math.min((photo.naturalWidth * base * zoom - area.clientWidth) / 2, next.x)), y: Math.max(-(photo.naturalHeight * base * zoom - area.clientHeight) / 2, Math.min((photo.naturalHeight * base * zoom - area.clientHeight) / 2, next.y)) }
  }
  const apply = () => {
    const area = crop.current; const photo = image.current
    if (!area || !photo?.naturalWidth) return
    const canvas = document.createElement('canvas'); [canvas.width, canvas.height] = output ?? [800, Math.round(800 / aspect)]
    const factor = canvas.width / area.clientWidth
    const base = Math.max(area.clientWidth / photo.naturalWidth, area.clientHeight / photo.naturalHeight)
    const width = photo.naturalWidth * base * scale * factor; const height = photo.naturalHeight * base * scale * factor
    canvas.getContext('2d')?.drawImage(photo, canvas.width / 2 + position.x * factor - width / 2, canvas.height / 2 + position.y * factor - height / 2, width, height)
    onApply(canvas.toDataURL('image/jpeg', .92))
  }
  return <div className="photo-editor-overlay" onPointerDown={(event) => event.currentTarget === event.target && onClose()}>
    <section className="photo-editor">
      <div ref={crop} className="crop-area" style={{ aspectRatio: String(aspect) }} onPointerDown={(event) => { start.current = { x: event.clientX, y: event.clientY, offsetX: position.x, offsetY: position.y }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { if (start.current) setPosition(clamp({ x: start.current.offsetX + (event.clientX - start.current.x) * 1.25, y: start.current.offsetY + (event.clientY - start.current.y) * 1.25 })) }} onPointerUp={() => { start.current = null }} onPointerCancel={() => { start.current = null }}>
        <img ref={image} crossOrigin="anonymous" src={source} alt="사진 조정" onLoad={() => { const photo = image.current; if (!photo) return; setScale(1); setPosition({ x: 0, y: 0 }); setAspect(fixedAspect ?? photo.naturalWidth / photo.naturalHeight); requestAnimationFrame(() => { const area = crop.current; if (!area) return; const base = Math.max(area.clientWidth / photo.naturalWidth, area.clientHeight / photo.naturalHeight); setSize({ width: photo.naturalWidth * base, height: photo.naturalHeight * base }) }) }} style={{ width: size?.width, height: size?.height, opacity: size ? 1 : 0, transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${scale})` }} />
      </div>
      <label>확대<input type="range" min="1" max="2.5" step="0.01" value={scale} onChange={(event) => { const zoom = Number(event.target.value); setScale(zoom); setPosition((current) => clamp(current, zoom)) }} /></label>
      <button type="button" onClick={apply}>적용</button>
    </section>
  </div>
}
