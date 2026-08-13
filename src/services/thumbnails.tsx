import { createRoot, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Box3, type Group, type PerspectiveCamera, Vector3 } from 'three'
import { ItemVisual } from '../components/InventoryFurniture'
import type { FurnitureItem } from '../store'

// one hidden 96px canvas renders each item type once; the captured PNG is cached for the session,
// so the inventory panel costs a single WebGL context no matter how many buttons it shows
const cache = new Map<string, string>()
let root: ReturnType<typeof createRoot> | null = null
let chain: Promise<unknown> = Promise.resolve()

function Shot({ item, done }: { item: FurnitureItem; done: (url: string) => void }) {
  const group = useRef<Group>(null)
  const state = useThree()
  // the detached root has no running frameloop, so render + capture synchronously once the scene graph is committed
  useLayoutEffect(() => {
    if (!group.current) return
    const camera = state.camera as PerspectiveCamera
    const bounds = new Box3().setFromObject(group.current)
    const center = bounds.getCenter(new Vector3())
    const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.1)
    const distance = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.1
    camera.position.copy(center.clone().add(new Vector3(0.9, 0.8, 1.4).normalize().multiplyScalar(distance)))
    camera.lookAt(center)
    state.gl.render(state.scene, camera)
    done(state.gl.domElement.toDataURL('image/png'))
  }, [item])
  return <>
    <ambientLight intensity={1.1} />
    <directionalLight position={[2, 4, 3]} intensity={1.4} />
    <group ref={group}><ItemVisual item={item} /></group>
  </>
}

export function thumbnailFor(item: FurnitureItem): Promise<string> {
  const key = `${item.type}:${item.styleId ?? ''}`
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const job = chain.then(() => new Promise<string>((resolve) => {
    if (!root) {
      const canvas = document.createElement('canvas')
      canvas.width = 96
      canvas.height = 96
      root = createRoot(canvas)
      root.configure({ frameloop: 'never', gl: { alpha: true, antialias: true, preserveDrawingBuffer: true }, size: { width: 96, height: 96, top: 0, left: 0 }, dpr: 1, camera: { fov: 30, near: 0.01, far: 100 } })
    }
    root.render(<Shot item={item} done={(url) => { cache.set(key, url); resolve(url) }} />)
  }))
  chain = job.catch(() => undefined)
  return job
}
