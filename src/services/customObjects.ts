import { clampModelScale, customObjectType, isCustomObjectSpec, type CustomObjectCategory, type CustomObjectSpec, type CustomTopSurface } from '../customObjectSpec'
import { authHeaders, readStored, writeStored } from './social'
import type { Material, Mesh, Object3D, Texture } from 'three'

export const CUSTOM_OBJECTS_KEY = 'my-room-custom-objects-v1'

export const loadCustomObjects = (): CustomObjectSpec[] => {
  try {
    const values = JSON.parse(readStored(CUSTOM_OBJECTS_KEY) ?? '[]') as unknown
    return Array.isArray(values) ? values.filter(isCustomObjectSpec).map((value) => ({ ...value, modelScale: clampModelScale(value.modelScale) })) : []
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

function modelMetadata(object: Object3D, bounds: import('three').Box3, three: typeof import('three')): { modelSize: [number, number, number]; topSurface?: CustomTopSurface } {
  const size = bounds.getSize(new three.Vector3())
  const tolerance = Math.max(size.y * .02, 1e-4)
  const bands = new Map<number, { area: number; y: number; minX: number; maxX: number; minZ: number; maxZ: number }>()
  const a = new three.Vector3(); const b = new three.Vector3(); const c = new three.Vector3(); const edge = new three.Vector3(); const normal = new three.Vector3()
  object.updateWorldMatrix(true, true)
  object.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    const position = mesh.geometry.getAttribute('position'); if (!position) return
    const index = mesh.geometry.index
    const vertex = (target: import('three').Vector3, at: number) => target.fromBufferAttribute(position, index ? index.getX(at) : at).applyMatrix4(mesh.matrixWorld)
    const count = index?.count ?? position.count
    for (let at = 0; at + 2 < count; at += 3) {
      vertex(a, at); vertex(b, at + 1); vertex(c, at + 2)
      normal.subVectors(b, a).cross(edge.subVectors(c, a))
      const length = normal.length(); if (!length || normal.y / length < .85) continue
      const area = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2
      if (area <= 1e-8) continue
      const y = (a.y + b.y + c.y) / 3
      const key = Math.round(y / tolerance)
      const band = bands.get(key) ?? { area: 0, y: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
      band.area += area; band.y += y * area
      band.minX = Math.min(band.minX, a.x, b.x, c.x); band.maxX = Math.max(band.maxX, a.x, b.x, c.x)
      band.minZ = Math.min(band.minZ, a.z, b.z, c.z); band.maxZ = Math.max(band.maxZ, a.z, b.z, c.z)
      bands.set(key, band)
    }
  })
  const minimumArea = size.x * size.z * .08
  const top = [...bands.values()].filter((band) => band.area >= minimumArea).sort((left, right) => right.y / right.area - left.y / left.area)[0]
  return {
    modelSize: [size.x, size.y, size.z],
    ...(top ? { topSurface: { height: top.y / top.area, center: [(top.minX + top.maxX) / 2, (top.minZ + top.maxZ) / 2], size: [top.maxX - top.minX, top.maxZ - top.minZ] } } : {}),
  }
}

export async function inspectCustomModel(url: string) {
  const [{ GLTFLoader }, { MeshoptDecoder }, three] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('meshoptimizer'), import('three')])
  await MeshoptDecoder.ready
  const response = await fetch(url); if (!response.ok) throw new Error('MODEL_DOWNLOAD_FAILED')
  const object = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(await response.arrayBuffer(), '')).scene
  const { bounds } = validateObject(object, three)
  return modelMetadata(object, bounds, three)
}

export async function generatedModelBlob(model: GeneratedModel, finish?: 'gloss'): Promise<{ blob: Blob; modelSize: [number, number, number]; topSurface?: CustomTopSurface }> {
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
  const bounds = source.bounds
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
