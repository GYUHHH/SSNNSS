import { customObjectType, isCustomObjectSpec, type CustomObjectCategory, type CustomObjectSpec } from '../customObjectSpec'
import { authHeaders, readStored, writeStored } from './social'
import type { Mesh } from 'three'

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
export async function generateCustomObject(input: { category: CustomObjectCategory; prompt: string; image?: string; imageBack?: string; size?: CustomSize }): Promise<CustomObjectSpec> {
  const response = await fetch('/api/custom-objects', {
    method: 'POST',
    headers: { ...await authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => null) as { object?: unknown; error?: string } | null
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  if (!isCustomObjectSpec(body?.object)) throw new Error('INVALID_CUSTOM_OBJECT')
  return body.object
}

export async function detailCustomObject(input: { category: CustomObjectCategory; prompt: string; image?: string; imageBack?: string; spec: CustomObjectSpec; feedback?: string; size?: CustomSize }): Promise<CustomObjectSpec> {
  const response = await fetch('/api/custom-objects/detail', {
    method: 'POST',
    headers: { ...await authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => null) as { object?: unknown; error?: string } | null
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  if (!isCustomObjectSpec(body?.object)) throw new Error('INVALID_CUSTOM_OBJECT')
  return body.object
}

export async function generateConceptImage(input: { category: CustomObjectCategory; prompt: string }): Promise<{ front: string; back?: string }> {
  const response = await fetch('/api/custom-objects/concept', {
    method: 'POST',
    headers: { ...await authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => null) as { image?: string; back?: string; error?: string } | null
  if (!response.ok || typeof body?.image !== 'string') throw new Error(body?.error || `HTTP ${response.status}`)
  return { front: body.image, back: typeof body.back === 'string' ? body.back : undefined }
}

export async function reviewCustomObject(input: { category: CustomObjectCategory; prompt: string; image?: string; imageBack?: string; spec: CustomObjectSpec; screenshots: string[] }): Promise<{ verdict: 'pass' | 'fail'; defects: string[]; violations: string[] }> {
  const response = await fetch('/api/custom-objects/review', {
    method: 'POST',
    headers: { ...await authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => null) as { verdict?: string; defects?: unknown; violations?: unknown; error?: string } | null
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  const list = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  return { verdict: body?.verdict === 'pass' ? 'pass' : 'fail', defects: list(body?.defects), violations: list(body?.violations) }
}

export async function fetchCredits(): Promise<{ enabled: boolean; balance: number; freeLeft: boolean; buyUrl: string | null }> {
  const response = await fetch('/api/custom-objects/credits', { method: 'POST', headers: await authHeaders() })
  const body = await response.json().catch(() => null) as { enabled?: boolean; balance?: number; freeLeft?: boolean; buyUrl?: string | null } | null
  if (!response.ok || !body) return { enabled: false, balance: 0, freeLeft: false, buyUrl: null }
  return { enabled: !!body.enabled, balance: body.balance ?? 0, freeLeft: !!body.freeLeft, buyUrl: body.buyUrl ?? null }
}

export async function submitGlbObject(image: string, finish?: 'gloss'): Promise<string> {
  const response = await fetch('/api/glb-objects', {
    method: 'POST',
    headers: { ...await authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, finish }),
  })
  const body = await response.json().catch(() => null) as { requestId?: string; error?: string } | null
  if (!response.ok || typeof body?.requestId !== 'string') throw new Error(body?.error || `HTTP ${response.status}`)
  return body.requestId
}

export type GeneratedModel = { format: 'glb'; url: string } | { format: 'obj'; objUrl: string; mtlUrl?: string; textureUrl?: string }

export async function pollGlbObject(requestId: string): Promise<{ done: boolean; model?: GeneratedModel }> {
  const response = await fetch(`/api/glb-objects/poll?id=${encodeURIComponent(requestId)}`, { headers: await authHeaders() })
  const body = await response.json().catch(() => null) as { done?: boolean; model?: GeneratedModel; error?: string } | null
  if (!response.ok || typeof body?.done !== 'boolean') throw new Error(body?.error || `HTTP ${response.status}`)
  return { done: body.done, model: body.model }
}

export async function generatedModelBlob(model: GeneratedModel): Promise<Blob> {
  if (model.format === 'glb') {
    const response = await fetch(model.url)
    if (!response.ok) throw new Error('MODEL_DOWNLOAD_FAILED')
    return response.blob()
  }
  const [objResponse, textureResponse] = await Promise.all([
    fetch(model.objUrl),
    model.textureUrl ? fetch(model.textureUrl) : null,
  ])
  if (!objResponse.ok || (textureResponse && !textureResponse.ok)) throw new Error('MODEL_DOWNLOAD_FAILED')
  const [{ OBJLoader }, { GLTFExporter }, three] = await Promise.all([
    import('three/addons/loaders/OBJLoader.js'),
    import('three/addons/exporters/GLTFExporter.js'),
    import('three'),
  ])
  const object = new OBJLoader().parse(await objResponse.text())
  let bitmap: ImageBitmap | undefined
  let texture: InstanceType<typeof three.Texture> | undefined
  if (textureResponse) {
    bitmap = await createImageBitmap(await textureResponse.blob())
    texture = new three.Texture(bitmap)
    texture.colorSpace = three.SRGBColorSpace
    texture.needsUpdate = true
    object.traverse((node) => {
      const mesh = node as Mesh
      if (mesh.isMesh) mesh.material = new three.MeshStandardMaterial({ map: texture, roughness: .8, metalness: 0 })
    })
  }
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(object, (output) => output instanceof ArrayBuffer ? resolve(output) : reject(new Error('GLB_EXPORT_FAILED')), reject, { binary: true, onlyVisible: true })
  })
  texture?.dispose(); bitmap?.close()
  return new Blob([buffer], { type: 'model/gltf-binary' })
}
