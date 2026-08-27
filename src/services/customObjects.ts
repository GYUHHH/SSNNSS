import { clampModelScale, customObjectType, isCustomObjectSpec, type CustomObjectCategory, type CustomObjectSpec, type CustomTopSurface } from '../customObjectSpec'
import { authHeaders, isVisiting, onRoomNavigation, readStored, writeStored } from './social'
import type { Material, Mesh, Object3D, Texture } from 'three'

export const CUSTOM_OBJECTS_KEY = 'my-room-custom-objects-v1'

export const loadCustomObjects = (): CustomObjectSpec[] => {
  try {
    const values = JSON.parse(readStored(CUSTOM_OBJECTS_KEY) ?? '[]') as unknown
    return Array.isArray(values) ? values.filter(isCustomObjectSpec).map((value) => ({ ...value, modelScale: clampModelScale(value.modelScale) })) : []
  } catch { return [] }
}

// 남의 방을 보는 동안 writeStored는 조용히 버려진다 — 그 사이에 생성이 끝나면 만든 물건이 통째로 사라졌다.
// 내 방으로 돌아올 때까지 들고 있다가 그때 쓴다.
let pendingSave: string | null = null
export const saveCustomObjects = (values: CustomObjectSpec[]) => {
  const payload = JSON.stringify(values)
  if (isVisiting()) { pendingSave = payload; return }
  writeStored(CUSTOM_OBJECTS_KEY, payload)
}
onRoomNavigation(() => {
  if (!pendingSave || isVisiting()) return
  writeStored(CUSTOM_OBJECTS_KEY, pendingSave)
  pendingSave = null
})

export const customObjectTemplate = (spec: CustomObjectSpec) => {
  const wall = spec.category === 'wallDecoration'
  const prop = spec.category === 'sculpture'
  const allowedSurfaces: Array<'wall' | 'floor' | 'tabletop' | 'shelf' | 'seat'> = wall ? ['wall'] : prop ? ['floor', 'tabletop', 'shelf', 'seat'] : ['floor']
  return {
    type: customObjectType(spec.id), name: spec.name, category: wall ? 'wallItem' as const : 'floorFurniture' as const,
    movable: true, interactable: true, footprint: spec.footprint, size: [spec.footprint.width, spec.footprint.depth] as [number, number],
    scale: 1, allowedSurfaces, customSpec: spec,
  }
}

export type CustomSize = { width: number; depth: number; height?: number }

// 생성은 몇 분씩 걸린다. 결제 페이지로 나갔다 오거나 새로고침하면 화면 상태가 통째로 날아가므로, 진행 중인
// 작업을 브라우저에 적어 두고 돌아왔을 때 이어받는다. 방 번들이 아니라 이 기기의 저장소를 쓴다 — 진행 상태는
// 방 데이터가 아니고, 다른 기기에서 이어받을 수도 없다.
const JOB_KEY = 'my-room-custom-job-v1'
const JOB_TTL = 30 * 60 * 1000
export type PendingJob = { requestId: string; category: CustomObjectCategory; prompt: string; finish?: 'gloss'; size?: CustomSize; at: number }

export const rememberJob = (job: Omit<PendingJob, 'at'>) => {
  try { localStorage.setItem(JOB_KEY, JSON.stringify({ ...job, at: Date.now() })) } catch { /* 저장 못 해도 이번 세션은 계속 돈다 */ }
}
export const forgetJob = () => { try { localStorage.removeItem(JOB_KEY) } catch { /* 없으면 그만 */ } }
export const pendingJob = (): PendingJob | null => {
  try {
    const job = JSON.parse(localStorage.getItem(JOB_KEY) ?? 'null') as PendingJob | null
    if (!job || typeof job.requestId !== 'string' || typeof job.at !== 'number' || Date.now() - job.at > JOB_TTL) return null
    return job
  } catch { return null }
}

export type CreditStatus = { enabled: boolean; balance: number; freeLeft: boolean; buyUrl: string | null; checkout: boolean }

const CREDITS_CACHE_KEY = 'my-room-credits-v1'
const CREDITS_CACHE_TTL = 60 * 60 * 1000

// 응답을 기다리는 동안 지난번 잔액을 먼저 보여준다(1시간 만료). 도착하면 바로 덮어쓴다.
export const cachedCredits = (): CreditStatus | null => {
  try {
    const cached = JSON.parse(readStored(CREDITS_CACHE_KEY) ?? 'null') as { at?: number; value?: CreditStatus } | null
    return cached?.value && typeof cached.at === 'number' && Date.now() - cached.at < CREDITS_CACHE_TTL ? cached.value : null
  } catch { return null }
}

export async function fetchCredits(): Promise<CreditStatus> {
  const response = await fetch('/api/custom-objects/credits', { method: 'POST', headers: await authHeaders() })
  const body = await response.json().catch(() => null) as Partial<CreditStatus> | null
  if (!response.ok || !body) return { enabled: false, balance: 0, freeLeft: false, buyUrl: null, checkout: false }
  const value: CreditStatus = { enabled: !!body.enabled, balance: body.balance ?? 0, freeLeft: !!body.freeLeft, buyUrl: body.buyUrl ?? null, checkout: !!body.checkout }
  writeStored(CREDITS_CACHE_KEY, JSON.stringify({ at: Date.now(), value }))
  return value
}

export async function createCreditCheckout(): Promise<string> {
  const response = await fetch('/api/custom-objects/checkout', { method: 'POST', headers: await authHeaders() })
  const body = await response.json().catch(() => null) as { url?: string; error?: string } | null
  if (!response.ok || !body?.url) throw new Error(body?.error || `HTTP ${response.status}`)
  return body.url
}

export async function submitGlbObject(input: { category: CustomObjectCategory; prompt: string; image?: string; finish?: 'gloss' }): Promise<string> {
  const response = await fetch('/api/glb-objects', {
    method: 'POST',
    headers: { ...await authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => null) as { requestId?: string; error?: string } | null
  if (!response.ok || typeof body?.requestId !== 'string') throw new Error(body?.error || `HTTP ${response.status}`)
  return body.requestId
}

export type GeneratedModel = { format: 'glb'; url: string } | { format: 'obj'; objUrl: string; mtlUrl?: string; textureUrl?: string; textureName?: string }

export async function pollGlbObject(requestId: string): Promise<{ done: boolean; model?: GeneratedModel }> {
  const response = await fetch(`/api/glb-objects/poll?id=${encodeURIComponent(requestId)}`, { headers: await authHeaders() })
  const body = await response.json().catch(() => null) as { done?: boolean; model?: GeneratedModel; error?: string } | null
  if (!response.ok || typeof body?.done !== 'boolean') throw new Error(body?.error || `HTTP ${response.status}`)
  return { done: body.done, model: body.model }
}

const MAX_GLB_BYTES = 8 * 1024 * 1024
const MAX_TRIANGLES = 250_000
const MAX_SOURCE_TRIANGLES = 2_000_000

const compressionTarget = (finish?: 'gloss') => finish === 'gloss'
  ? { bytes: 6 * 1024 * 1024, triangles: 100_000 }
  : { bytes: 3 * 1024 * 1024, triangles: 60_000 }

function validateModelStats(size: [number, number, number], triangles: number, bytes = 0, maxTriangles = MAX_TRIANGLES) {
  if (!size.every(Number.isFinite) || Math.max(...size) <= 1e-4) throw new Error('INVALID_MODEL_BOUNDS')
  if (!triangles || triangles > maxTriangles) throw new Error('MODEL_TOO_COMPLEX')
  if (bytes > MAX_GLB_BYTES) throw new Error('MODEL_TOO_LARGE')
}
if (import.meta.env.DEV) {
  validateModelStats([1, 1, 1], 12, 1024)
  console.assert((() => { try { validateModelStats([1, 1, 1], MAX_TRIANGLES + 1); return false } catch { return true } })(), 'generated model limits must reject oversized geometry')
  console.assert(compressionTarget().bytes === 3 * 1024 * 1024 && compressionTarget('gloss').triangles === 100_000, 'generated model compression targets must remain quality-specific')
}

const materialsOf = (mesh: Mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material]
const standardMaterial = (material: Material) => material as Material & {
  map?: Texture | null; normalMap?: Texture | null; roughnessMap?: Texture | null; metalnessMap?: Texture | null; aoMap?: Texture | null; emissiveMap?: Texture | null
  metalness?: number; roughness?: number; needsUpdate?: boolean
}

const imageSize = (image: unknown) => {
  const value = image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number } | null
  return { width: value?.naturalWidth ?? value?.videoWidth ?? value?.width ?? 0, height: value?.naturalHeight ?? value?.videoHeight ?? value?.height ?? 0 }
}

async function shrinkTexture(texture: Texture, maxEdge: number, bitmaps: Set<ImageBitmap>, quality = .82) {
  const { width, height } = imageSize(texture.image)
  if (!width || !height) return
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) return
  context.drawImage(texture.image as CanvasImageSource, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
  if (!blob) return
  const bitmap = await createImageBitmap(blob)
  if (texture.image instanceof ImageBitmap) bitmaps.add(texture.image)
  bitmaps.add(bitmap)
  texture.image = bitmap
  texture.userData.mimeType = 'image/webp'
  texture.needsUpdate = true
}

function validateObject(object: Object3D, three: typeof import('three'), maxTriangles = MAX_TRIANGLES) {
  const { Box3, Vector3 } = three
  const bounds = new Box3().setFromObject(object)
  const size = bounds.getSize(new Vector3())
  let triangles = 0
  object.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    const position = mesh.geometry.getAttribute('position')
    triangles += (mesh.geometry.index?.count ?? position?.count ?? 0) / 3
  })
  validateModelStats([size.x, size.y, size.z], triangles, 0, maxTriangles)
  return { bounds, triangles }
}

async function optimizeGlb(buffer: ArrayBuffer, sourceTriangles: number, targetTriangles: number) {
  const [{ WebIO }, { ALL_EXTENSIONS }, { dedup, meshopt, prune, simplify, weld }, { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier }] = await Promise.all([
    import('@gltf-transform/core'),
    import('@gltf-transform/extensions'),
    import('@gltf-transform/functions'),
    import('meshoptimizer'),
  ])
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  })
  const document = await io.readBinary(new Uint8Array(buffer))
  const transforms = [dedup(), prune(), weld()]
  if (sourceTriangles > targetTriangles) transforms.push(simplify({
    simplifier: MeshoptSimplifier,
    ratio: targetTriangles / sourceTriangles,
    error: sourceTriangles > MAX_TRIANGLES ? .01 : .002,
    lockBorder: true,
  }))
  transforms.push(meshopt({
    encoder: MeshoptEncoder,
    level: 'high',
    quantizePosition: 16,
    quantizeNormal: 10,
    quantizeTexcoord: 12,
  }))
  await document.transform(...transforms)
  return (await io.writeBinary(document)).buffer
}

// 생성 모델은 다리 길이가 제각각이라 제일 긴 발 하나만 닿고 나머지가 뜬다 — GlbFurniture가 최저 정점을
// 바닥에 맞추기 때문이다(미끄럼틀은 접지점 3개 중 1개만 닿아 나머지가 칸의 1/4만큼 매달렸다). 바닥 근처
// 기둥들의 높이를 모아 그 아래를 평평하게 눌러 전부 닿게 한다. 자르는 게 아니라 누르는 것이라 면이
// 떨어져 나가거나 위상이 깨지지 않는다.
const GROUND_BAND = .08
// 눌러야 할 높이(월드 Y). 손댈 이유가 없으면 null.
// cellMins: XZ 격자 칸마다의 최저 Y. floor/height: 모델 바운즈의 바닥과 높이.
export const baseCutLevel = (cellMins: number[], floor: number, height: number): number | null => {
  if (!(height > 0)) return null
  const feet = cellMins.filter((y) => y - floor <= height * GROUND_BAND).sort((left, right) => left - right)
  // 바닥 근처 칸이 다수면 원래 밑면이 넓거나 둥근 것(빈백·러그) — 누르면 납작해지므로 건드리지 않는다
  if (!feet.length || feet.length >= cellMins.length * .4) return null
  // 최대값은 발의 비스듬한 옆면까지 물어 과하게 눌린다. 75퍼센타일이 실측에서 실제 발 높이에 가장 가까웠다
  const cut = Math.min(feet[Math.floor((feet.length - 1) * .75)], floor + height * GROUND_BAND)
  return cut - floor < height * .005 ? null : cut
}

const levelBase = (object: Object3D, bounds: import('three').Box3, three: typeof import('three')) => {
  const size = bounds.getSize(new three.Vector3())
  if (!(size.y > 0)) return
  object.updateMatrixWorld(true)
  const grid = 32
  const cells = new Float64Array(grid * grid).fill(Infinity)
  const point = new three.Vector3()
  const axis = (value: number, min: number, span: number) => Math.min(grid - 1, Math.max(0, Math.floor((value - min) / Math.max(span, 1e-9) * grid)))
  const meshes: Mesh[] = []
  object.traverse((node) => { const mesh = node as Mesh; if (mesh.isMesh && mesh.geometry.getAttribute('position')) meshes.push(mesh) })
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position')
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld)
      const at = axis(point.z, bounds.min.z, size.z) * grid + axis(point.x, bounds.min.x, size.x)
      if (point.y < cells[at]) cells[at] = point.y
    }
  }
  const cut = baseCutLevel([...cells].filter(Number.isFinite), bounds.min.y, size.y)
  if (cut === null) return
  const inverse = new three.Matrix4()
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position')
    inverse.copy(mesh.matrixWorld).invert()
    let moved = false
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld)
      if (point.y >= cut) continue
      point.y = cut
      point.applyMatrix4(inverse)
      position.setXYZ(index, point.x, point.y, point.z)
      moved = true
    }
    if (moved) { position.needsUpdate = true; mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingBox() }
  }
}

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  // 미끄럼틀 실측: 지면 칸 대부분은 높고, 발은 소수 — 사다리 발 높이까지 눌러 셋 다 닿게 한다
  const slide = [0, .06, .06, ...Array.from({ length: 20 }, () => .5)]
  console.assert(baseCutLevel(slide, 0, 1) === .06, 'uneven feet must be levelled to the foot height')
  // 둥근 밑면 실측: 지면 칸 대부분이 바닥 근처 — 누르면 납작해지므로 손대지 않는다
  console.assert(baseCutLevel([0, .01, .02, .03, .04, .05], 0, 1) === null, 'a wide or rounded base must be left alone')
  // 이미 평평한 밑면은 누를 것이 없다
  console.assert(baseCutLevel([0, 0, 0, ...Array.from({ length: 20 }, () => .5)], 0, 1) === null, 'a flat base must not be touched')
}

// 모델에서 "물건을 올릴 수 있는 평평한 면"을 전부 찾는다. 위를 보는 삼각형을 높이 밴드로 모은 뒤:
// ① 베벨 단차처럼 붙어 있는 밴드는 하나로 합치고 ② 오브젝트 밑판은 버리고 ③ 위쪽에 머리 공간이 없는 면은
// 버린다. ③이 닫힌 서랍 안쪽·소파 등받이 위 같은 가짜 후보를 걸러내고, 뚫린 칸의 바닥은 살려 둔다.
const MERGE_GAP = .03      // 모델 높이 대비: 이보다 가까운 밴드는 같은 면의 단차
const FLOOR_MARGIN = .05   // 모델 높이 대비: 이보다 낮으면 오브젝트 밑판
const MIN_HEADROOM = .12   // 모델 높이 대비: 위쪽으로 이만큼은 비어 있어야 물건을 놓는다
const MIN_SPAN = .15       // 모델 가로 대비: 두 변 모두 이보다 좁으면 물건을 못 놓는 턱이다
const MAX_SURFACES = 4

type Band = { height: number; area: number; minX: number; maxX: number; minZ: number; maxZ: number }

function modelMetadata(object: Object3D, bounds: import('three').Box3, three: typeof import('three')): { modelSize: [number, number, number]; topSurfaces: CustomTopSurface[] } {
  const size = bounds.getSize(new three.Vector3())
  const modelSize: [number, number, number] = [size.x, size.y, size.z]
  const tolerance = Math.max(size.y * .02, 1e-4)
  const bands = new Map<number, { area: number; y: number; minX: number; maxX: number; minZ: number; maxZ: number }>()
  const a = new three.Vector3(); const b = new three.Vector3(); const c = new three.Vector3(); const edge = new three.Vector3(); const normal = new three.Vector3()
  object.updateWorldMatrix(true, true)
  const eachTriangle = (visit: (a: import('three').Vector3, b: import('three').Vector3, c: import('three').Vector3) => void) => {
    object.traverse((node) => {
      const mesh = node as Mesh
      if (!mesh.isMesh) return
      const position = mesh.geometry.getAttribute('position'); if (!position) return
      const index = mesh.geometry.index
      const vertex = (target: import('three').Vector3, at: number) => target.fromBufferAttribute(position, index ? index.getX(at) : at).applyMatrix4(mesh.matrixWorld)
      const count = index?.count ?? position.count
      for (let at = 0; at + 2 < count; at += 3) { vertex(a, at); vertex(b, at + 1); vertex(c, at + 2); visit(a, b, c) }
    })
  }
  eachTriangle((first, second, third) => {
    normal.subVectors(second, first).cross(edge.subVectors(third, first))
    const length = normal.length(); if (!length || normal.y / length < .85) return
    const area = Math.abs((second.x - first.x) * (third.z - first.z) - (second.z - first.z) * (third.x - first.x)) / 2
    if (area <= 1e-8) return
    const y = (first.y + second.y + third.y) / 3
    const key = Math.round(y / tolerance)
    const band = bands.get(key) ?? { area: 0, y: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
    band.area += area; band.y += y * area
    band.minX = Math.min(band.minX, first.x, second.x, third.x); band.maxX = Math.max(band.maxX, first.x, second.x, third.x)
    band.minZ = Math.min(band.minZ, first.z, second.z, third.z); band.maxZ = Math.max(band.maxZ, first.z, second.z, third.z)
    bands.set(key, band)
  })
  const minimumArea = size.x * size.z * .08
  const found = [...bands.values()].filter((band) => band.area >= minimumArea)
    .map((band) => ({ height: band.y / band.area, area: band.area, minX: band.minX, maxX: band.maxX, minZ: band.minZ, maxZ: band.maxZ }))
    .sort((left, right) => right.height - left.height)
  // ① 붙어 있는 밴드 병합 — 베벨 단차 하나가 상판 서너 개로 잡히는 것을 막는다
  const merged: Band[] = []
  for (const band of found) {
    const last = merged[merged.length - 1]
    if (last && last.height - band.height <= size.y * MERGE_GAP) {
      last.minX = Math.min(last.minX, band.minX); last.maxX = Math.max(last.maxX, band.maxX)
      last.minZ = Math.min(last.minZ, band.minZ); last.maxZ = Math.max(last.maxZ, band.maxZ)
      last.area += band.area
      continue
    }
    merged.push({ ...band })
  }
  // ② 오브젝트 밑판(바닥에 붙은 면)과, 물건을 못 놓을 만큼 좁은 턱은 후보가 아니다
  const span = Math.max(size.x, size.z)
  const candidates = merged.filter((band) => band.height > bounds.min.y + size.y * FLOOR_MARGIN)
    .filter((band) => Math.min(band.maxX - band.minX, band.maxZ - band.minZ) >= span * MIN_SPAN)
  if (!candidates.length) return { modelSize, topSurfaces: [] }
  // ③ 머리 공간: 각 후보 중앙 60% 위로 가장 가까운 지오메트리까지의 거리
  const headroom = candidates.map(() => Infinity)
  const probes = candidates.map((band) => {
    const width = (band.maxX - band.minX) * .3; const depth = (band.maxZ - band.minZ) * .3
    const centreX = (band.minX + band.maxX) / 2; const centreZ = (band.minZ + band.maxZ) / 2
    return { minX: centreX - width, maxX: centreX + width, minZ: centreZ - depth, maxZ: centreZ + depth }
  })
  eachTriangle((first, second, third) => {
    const lowest = Math.min(first.y, second.y, third.y)
    const minX = Math.min(first.x, second.x, third.x); const maxX = Math.max(first.x, second.x, third.x)
    const minZ = Math.min(first.z, second.z, third.z); const maxZ = Math.max(first.z, second.z, third.z)
    for (let index = 0; index < candidates.length; index += 1) {
      if (lowest <= candidates[index].height + tolerance * 2) continue
      const probe = probes[index]
      if (maxX < probe.minX || minX > probe.maxX || maxZ < probe.minZ || minZ > probe.maxZ) continue
      headroom[index] = Math.min(headroom[index], lowest - candidates[index].height)
    }
  })
  // 맨 위 면은 늘 남긴다(위가 뚫려 있으니 검사할 것도 없고, 면을 하나만 쓰던 종전 동작이 그대로 보존된다).
  // 그 아래 면은 머리 공간을 통과할 때만 — 뚫린 칸은 살고, 닫힌 서랍 안쪽이나 등받이 위는 걸러진다
  const topSurfaces = candidates
    .filter((_, index) => index === 0 || headroom[index] >= size.y * MIN_HEADROOM)
    .slice(0, MAX_SURFACES)
    .map((band) => ({ height: band.height, center: [(band.minX + band.maxX) / 2, (band.minZ + band.maxZ) / 2] as [number, number], size: [band.maxX - band.minX, band.maxZ - band.minZ] as [number, number] }))
  return { modelSize, topSurfaces }
}

export async function inspectCustomModel(url: string) {
  const [{ GLTFLoader }, { MeshoptDecoder }, three] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('meshoptimizer'), import('three')])
  await MeshoptDecoder.ready
  const response = await fetch(url); if (!response.ok) throw new Error('MODEL_DOWNLOAD_FAILED')
  const object = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(await response.arrayBuffer(), '')).scene
  const { bounds } = validateObject(object, three)
  return modelMetadata(object, bounds, three)
}

export async function generatedModelBlob(model: GeneratedModel, finish?: 'gloss', category?: CustomObjectCategory): Promise<{ blob: Blob; modelSize: [number, number, number]; topSurfaces: CustomTopSurface[] }> {
  const [{ OBJLoader }, { GLTFLoader }, { GLTFExporter }, { mergeVertices }, { MeshoptDecoder }, three] = await Promise.all([
    import('three/addons/loaders/OBJLoader.js'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/exporters/GLTFExporter.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
    import('meshoptimizer'),
    import('three'),
  ])
  await MeshoptDecoder.ready
  const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const bitmaps = new Set<ImageBitmap>()
  let object: Object3D
  if (model.format === 'glb') {
    const response = await fetch(model.url)
    if (!response.ok) throw new Error('MODEL_DOWNLOAD_FAILED')
    object = (await gltfLoader.parseAsync(await response.arrayBuffer(), '')).scene
  } else {
    const [objResponse, textureResponse] = await Promise.all([fetch(model.objUrl), model.textureUrl ? fetch(model.textureUrl) : null])
    if (!objResponse.ok || (textureResponse && !textureResponse.ok)) throw new Error('MODEL_DOWNLOAD_FAILED')
    object = new OBJLoader().parse(await objResponse.text())
    if (textureResponse) {
      const bitmap = await createImageBitmap(await textureResponse.blob())
      bitmaps.add(bitmap)
      const texture = new three.Texture(bitmap)
      const roughnessOnly = finish === 'gloss' && /roughness/i.test(model.textureName ?? '')
      if (!roughnessOnly) texture.colorSpace = three.SRGBColorSpace
      texture.needsUpdate = true
      object.traverse((node) => {
        const mesh = node as Mesh
        if (!mesh.isMesh) return
        mesh.material = new three.MeshStandardMaterial(roughnessOnly
          ? { roughnessMap: texture, roughness: 1, metalness: .25 }
          : { map: texture, roughness: finish === 'gloss' ? .35 : .95, metalness: finish === 'gloss' ? .25 : 0 })
      })
    }
  }

  const textureLimits = new Map<Texture, number>()
  object.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    try { mesh.geometry = mergeVertices(mesh.geometry, 1e-4) } catch { /* generated geometry stays usable without welding */ }
    for (const raw of materialsOf(mesh)) {
      const material = standardMaterial(raw)
      if (finish !== 'gloss') {
        material.metalness = 0
        material.roughness = .95
        material.normalMap = null
        material.metalnessMap = null
        material.roughnessMap = null
        material.aoMap = null
        mesh.geometry.deleteAttribute('tangent')
        mesh.geometry.deleteAttribute('uv1')
      }
      if (material.map) textureLimits.set(material.map, Math.min(textureLimits.get(material.map) ?? 1024, 1024))
      if (material.emissiveMap) textureLimits.set(material.emissiveMap, Math.min(textureLimits.get(material.emissiveMap) ?? 1024, 1024))
      if (finish === 'gloss') for (const map of [material.normalMap]) {
        if (map) textureLimits.set(map, Math.min(textureLimits.get(map) ?? 1024, 1024))
      }
      if (finish === 'gloss') for (const map of [material.metalnessMap, material.roughnessMap, material.aoMap]) {
        if (map) textureLimits.set(map, Math.min(textureLimits.get(map) ?? 512, 512))
      }
      material.needsUpdate = true
    }
  })
  for (const [texture, maxEdge] of textureLimits) await shrinkTexture(texture, maxEdge, bitmaps)

  const source = validateObject(object, three, MAX_SOURCE_TRIANGLES)
  // 벽 장식은 바닥에 서지 않는다 — 밑면을 누르면 둥근 아래쪽만 잘려 보인다
  if (category !== 'wallDecoration') levelBase(object, source.bounds, three)
  const bounds = validateObject(object, three, MAX_SOURCE_TRIANGLES).bounds
  const center = bounds.getCenter(new three.Vector3())
  object.position.add(new three.Vector3(-center.x, -bounds.min.y, -center.z))
  object.updateMatrixWorld(true)
  const normalizedBounds = validateObject(object, three, MAX_SOURCE_TRIANGLES).bounds
  const metadata = modelMetadata(object, normalizedBounds, three)
  const exportGlb = () => new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(object, (output) => output instanceof ArrayBuffer ? resolve(output) : reject(new Error('GLB_EXPORT_FAILED')), reject, { binary: true, onlyVisible: true, maxTextureSize: 2048 })
  })
  const target = compressionTarget(finish)
  let rawBytes = 0
  const compressedExport = async () => {
    const raw = await exportGlb(); rawBytes = raw.byteLength
    try { return await optimizeGlb(raw, source.triangles, target.triangles) }
    catch (error) { console.warn('[custom-model] geometry compression skipped', error); return raw }
  }
  let buffer: ArrayBuffer
  try {
    buffer = await compressedExport()
    if (buffer.byteLength > target.bytes) {
      for (const [texture, maxEdge] of textureLimits) await shrinkTexture(texture, Math.max(256, maxEdge / 2), bitmaps, .72)
      buffer = await compressedExport()
    }
  } finally { bitmaps.forEach((bitmap) => bitmap.close()) }
  console.info('[custom-model] compressed', { finish: finish ?? 'standard', triangles: source.triangles, targetTriangles: target.triangles, rawBytes, finalBytes: buffer.byteLength })
  validateModelStats([1, 1, 1], 1, buffer.byteLength)
  const reopened = (await gltfLoader.parseAsync(buffer, '')).scene
  validateObject(reopened, three)
  return { blob: new Blob([buffer], { type: 'model/gltf-binary' }), ...metadata }
}
