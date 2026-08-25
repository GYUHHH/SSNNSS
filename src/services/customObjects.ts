import { customObjectType, isCustomObjectSpec, type CustomObjectCategory, type CustomObjectSpec } from '../customObjectSpec'
import { authHeaders, readStored, writeStored } from './social'
import type { Material, Mesh, Object3D, Texture } from 'three'

export const CUSTOM_OBJECTS_KEY = 'my-room-custom-objects-v1'

export const loadCustomObjects = (): CustomObjectSpec[] => {
  try {
    const values = JSON.parse(readStored(CUSTOM_OBJECTS_KEY) ?? '[]') as unknown
    return Array.isArray(values) ? values.filter(isCustomObjectSpec) : []
  } catch { return [] }
}

export const saveCustomObjects = (values: CustomObjectSpec[]) => writeStored(CUSTOM_OBJECTS_KEY, JSON.stringify(values))

export const customObjectTemplate = (spec: CustomObjectSpec) => {
  const wall = spec.category === 'wallDecoration'
  const allowedSurfaces: Array<'wall' | 'floor'> = wall ? ['wall'] : ['floor']
  return {
    type: customObjectType(spec.id), name: spec.name, category: wall ? 'wallItem' as const : 'floorFurniture' as const,
    movable: true, interactable: true, footprint: spec.footprint, size: [spec.footprint.width, spec.footprint.depth] as [number, number],
    scale: 1, allowedSurfaces, customSpec: spec,
  }
}

export type CustomSize = { width: number; depth: number; height?: number }

export async function fetchCredits(): Promise<{ enabled: boolean; balance: number; freeLeft: boolean; buyUrl: string | null }> {
  const response = await fetch('/api/custom-objects/credits', { method: 'POST', headers: await authHeaders() })
  const body = await response.json().catch(() => null) as { enabled?: boolean; balance?: number; freeLeft?: boolean; buyUrl?: string | null } | null
  if (!response.ok || !body) return { enabled: false, balance: 0, freeLeft: false, buyUrl: null }
  return { enabled: !!body.enabled, balance: body.balance ?? 0, freeLeft: !!body.freeLeft, buyUrl: body.buyUrl ?? null }
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

function validateModelStats(size: [number, number, number], triangles: number, bytes = 0) {
  if (!size.every(Number.isFinite) || Math.max(...size) <= 1e-4) throw new Error('INVALID_MODEL_BOUNDS')
  if (!triangles || triangles > MAX_TRIANGLES) throw new Error('MODEL_TOO_COMPLEX')
  if (bytes > MAX_GLB_BYTES) throw new Error('MODEL_TOO_LARGE')
}
if (import.meta.env.DEV) {
  validateModelStats([1, 1, 1], 12, 1024)
  console.assert((() => { try { validateModelStats([1, 1, 1], MAX_TRIANGLES + 1); return false } catch { return true } })(), 'generated model limits must reject oversized geometry')
}

const materialsOf = (mesh: Mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material]
const standardMaterial = (material: Material) => material as Material & {
  map?: Texture | null; normalMap?: Texture | null; roughnessMap?: Texture | null; metalnessMap?: Texture | null
  metalness?: number; roughness?: number; needsUpdate?: boolean
}

const imageSize = (image: unknown) => {
  const value = image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number } | null
  return { width: value?.naturalWidth ?? value?.videoWidth ?? value?.width ?? 0, height: value?.naturalHeight ?? value?.videoHeight ?? value?.height ?? 0 }
}

async function shrinkTexture(texture: Texture, maxEdge: number, bitmaps: Set<ImageBitmap>) {
  const { width, height } = imageSize(texture.image)
  if (!width || !height) return
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) return
  context.drawImage(texture.image as CanvasImageSource, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', .82))
  if (!blob) return
  const bitmap = await createImageBitmap(blob)
  if (texture.image instanceof ImageBitmap) bitmaps.add(texture.image)
  bitmaps.add(bitmap)
  texture.image = bitmap
  texture.userData.mimeType = 'image/webp'
  texture.needsUpdate = true
}

function validateObject(object: Object3D, three: typeof import('three')) {
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
  validateModelStats([size.x, size.y, size.z], triangles)
  return bounds
}

export async function generatedModelBlob(model: GeneratedModel, finish?: 'gloss'): Promise<Blob> {
  const [{ OBJLoader }, { GLTFLoader }, { GLTFExporter }, { mergeVertices }, three] = await Promise.all([
    import('three/addons/loaders/OBJLoader.js'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/exporters/GLTFExporter.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
    import('three'),
  ])
  const bitmaps = new Set<ImageBitmap>()
  let object: Object3D
  if (model.format === 'glb') {
    const response = await fetch(model.url)
    if (!response.ok) throw new Error('MODEL_DOWNLOAD_FAILED')
    object = (await new GLTFLoader().parseAsync(await response.arrayBuffer(), '')).scene
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
      }
      if (material.map) textureLimits.set(material.map, Math.min(textureLimits.get(material.map) ?? 2048, 2048))
      if (finish === 'gloss') for (const map of [material.normalMap, material.metalnessMap, material.roughnessMap]) {
        if (map) textureLimits.set(map, Math.min(textureLimits.get(map) ?? 1024, 1024))
      }
      material.needsUpdate = true
    }
  })
  for (const [texture, maxEdge] of textureLimits) await shrinkTexture(texture, maxEdge, bitmaps)

  const bounds = validateObject(object, three)
  const center = bounds.getCenter(new three.Vector3())
  object.position.add(new three.Vector3(-center.x, -bounds.min.y, -center.z))
  object.updateMatrixWorld(true)
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(object, (output) => output instanceof ArrayBuffer ? resolve(output) : reject(new Error('GLB_EXPORT_FAILED')), reject, { binary: true, onlyVisible: true, maxTextureSize: 2048 })
  })
  bitmaps.forEach((bitmap) => bitmap.close())
  validateModelStats([1, 1, 1], 1, buffer.byteLength)
  const reopened = (await new GLTFLoader().parseAsync(buffer, '')).scene
  validateObject(reopened, three)
  return new Blob([buffer], { type: 'model/gltf-binary' })
}
