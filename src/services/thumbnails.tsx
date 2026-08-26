import { createRoot, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef, useState } from 'react'
import { Box3, type Group, type PerspectiveCamera, Vector3 } from 'three'
import { ItemVisual } from '../components/InventoryFurniture'
import { onGlbReady } from '../components/GlbFurniture'
import type { FurnitureItem } from '../store'
import type { FloorStyle } from './styles'

// one hidden 96px canvas renders each item type once; the captured PNG is cached for the session,
// so the inventory panel costs a single WebGL context no matter how many buttons it shows
const cache = new Map<string, string>()
let root: ReturnType<typeof createRoot> | null = null
let chain: Promise<unknown> = Promise.resolve()
const ensureRoot = () => {
  if (root) return
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  root = createRoot(canvas)
  root.configure({ frameloop: 'never', gl: { alpha: true, antialias: true, preserveDrawingBuffer: true }, size: { width: 96, height: 96, top: 0, left: 0 }, dpr: 1, camera: { fov: 30, near: 0.01, far: 100 } })
}

function Shot({ item, direction = [0.9, 0.8, 1.4], done }: { item: FurnitureItem; direction?: [number, number, number]; done: (url: string) => void }) {
  const group = useRef<Group>(null)
  const state = useThree()
  const glbUrl = item.customSpec?.glbUrl
  const [modelReady, setModelReady] = useState(!glbUrl)
  // 커스텀 GLB는 Suspense 뒤에서 비동기로 붙는다. 빈 group을 먼저 찍지 않고 이 URL의 로드 신호를 기다린다.
  useLayoutEffect(() => {
    if (!glbUrl) { setModelReady(true); return }
    setModelReady(false)
    return onGlbReady((url) => { if (url === glbUrl) setModelReady(true) })
  }, [glbUrl])
  // the detached root has no running frameloop, so render + capture synchronously once the scene graph is committed
  useLayoutEffect(() => {
    if (!group.current || !modelReady) return
    const camera = state.camera as PerspectiveCamera
    const bounds = new Box3().setFromObject(group.current)
    const center = bounds.getCenter(new Vector3())
    const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.1)
    const distance = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.1
    camera.position.copy(center.clone().add(new Vector3(...direction).normalize().multiplyScalar(distance)))
    camera.lookAt(center)
    state.gl.render(state.scene, camera)
    done(state.gl.domElement.toDataURL('image/png'))
  }, [item, direction, modelReady])
  return <>
    <ambientLight intensity={1.1} />
    <directionalLight position={[2, 4, 3]} intensity={1.4} />
    <group ref={group}><ItemVisual item={item} /></group>
  </>
}

export function thumbnailFor(item: FurnitureItem): Promise<string> {
  const key = `${item.type}:${item.styleId ?? ''}:${item.customSpec?.glbUrl ?? ''}`
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const job = chain.then(() => Promise.race([new Promise<string>((resolve) => {
    ensureRoot()
    // 품목이 바뀔 때 Shot의 GLB 준비 상태도 새로 시작해야 한다. key가 없으면 이전 품목의
    // ready=true가 남아 새 커스텀 GLB가 붙기 전에 빈 캔버스를 썸네일로 저장한다.
    root!.render(<Shot key={key} item={item} done={(url) => { cache.set(key, url); resolve(url) }} />)
  }), new Promise<string>((resolve) => setTimeout(() => resolve(''), item.customSpec?.glbUrl ? 20000 : 4000))]))
  chain = job.catch(() => undefined)
  return job
}

// 바닥 재질 스와치: 같은 히든 캔버스로 실제 재질(색+거칠기)을 비스듬한 슬래브로 렌더한다 —
// 평면 색 원으로는 원목/타일의 광택 차이가 안 보인다
function FloorShot({ style, done }: { style: FloorStyle; done: (url: string) => void }) {
  const group = useRef<Group>(null)
  const state = useThree()
  useLayoutEffect(() => {
    if (!group.current) return
    const camera = state.camera as PerspectiveCamera
    const bounds = new Box3().setFromObject(group.current)
    const center = bounds.getCenter(new Vector3())
    const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.1)
    const distance = (radius / Math.tan((camera.fov * Math.PI) / 360)) * .96
    camera.position.copy(center.clone().add(new Vector3(0.55, 0.9, 1.2).normalize().multiplyScalar(distance)))
    camera.lookAt(center)
    state.gl.render(state.scene, camera)
    done(state.gl.domElement.toDataURL('image/png'))
  }, [style])
  return <>
    <ambientLight intensity={.95} />
    {/* 카메라(0.55,0.9,1.2)의 수평면 거울 방향 — 상판에 정반사 하이라이트가 잡혀 거칠기 차이가 보인다 */}
    <directionalLight position={[-1.1, 1.8, -2.4]} intensity={3} />
    <group ref={group} rotation={[0, .7, 0]}><mesh><boxGeometry args={[1.5, .2, 1.5]} /><meshStandardMaterial color={style.color} roughness={style.roughness} /></mesh></group>
  </>
}

export function thumbnailForFloorStyle(style: FloorStyle): Promise<string> {
  const key = `floor:${style.id}:${style.color}`
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const job = chain.then(() => Promise.race([new Promise<string>((resolve) => {
    ensureRoot()
    root!.render(<FloorShot style={style} done={(url) => { cache.set(key, url); resolve(url) }} />)
  }), new Promise<string>((resolve) => setTimeout(() => resolve(''), 4000))]))
  chain = job.catch(() => undefined)
  return job
}
