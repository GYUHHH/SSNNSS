export const CUSTOM_OBJECT_CATEGORIES = ['furniture', 'wallDecoration', 'floor', 'sculpture'] as const
export const CUSTOM_PRIMITIVES = ['box', 'roundedBox', 'cylinder', 'sphere', 'capsule', 'torus', 'cone', 'wedge', 'frustum', 'hemisphere', 'halfCylinder', 'ramp', 'elbow', 'extrudeProfile', 'latheProfile'] as const

export type CustomObjectCategory = typeof CUSTOM_OBJECT_CATEGORIES[number]
export type CustomPrimitive = typeof CUSTOM_PRIMITIVES[number]
export type CustomObjectPart = {
  id: string
  primitive: CustomPrimitive
  position: [number, number, number]
  rotation: [number, number, number]
  size: [number, number, number]
  color: string
  roughness: number
  metalness: number
  // extrudeProfile/latheProfile 전용: 유닛 사각(-0.5..0.5) 안의 2D 단면 점들
  profile?: Array<[number, number]>
}
export type CustomTopSurface = {
  height: number
  center: [number, number]
  size: [number, number]
}
export type CustomObjectSpec = {
  id: string
  name: string
  category: CustomObjectCategory
  footprint: { width: number; depth: number }
  parts: CustomObjectPart[]
  // GLB 커스텀: parts 대신 저장소의 모델 파일을 그대로 그린다
  glbUrl?: string
  // 광택(PBR) 등급: 런타임에서 무광 강제 대신 재질 존중 + 환경맵
  finish?: 'gloss'
  // 생성 모델의 원본 외곽과, 격자 맞춤 뒤 사용자가 조절하는 모델 자체 X/Y/Z 크기
  modelSize?: [number, number, number]
  modelScale?: [number, number, number]
  // 생성 시 감지한, 물건을 올릴 수 있는 평평한 면들(높은 것부터). 가구와 벽 선반형 생성물 모두 사용한다.
  topSurfaces?: CustomTopSurface[]
  // 면을 하나만 저장하던 시절의 오브젝트 — 읽기만 한다
  topSurface?: CustomTopSurface
}

const tuple3 = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number' && Number.isFinite(part))
const positiveTuple3 = (value: unknown): value is [number, number, number] => tuple3(value) && value.every((part) => part > 0 && part <= 12)
const modelTuple3 = (value: unknown): value is [number, number, number] => tuple3(value) && value.every((part) => part > 0 && part <= 10000)
const unit = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const cell = (value: unknown) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10
const positivePair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part) && part > 0)
const finitePair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))

export const isCustomObjectSpec = (value: unknown): value is CustomObjectSpec => {
  if (!value || typeof value !== 'object') return false
  const spec = value as Partial<CustomObjectSpec>
  if (typeof spec.id !== 'string' || !spec.id || typeof spec.name !== 'string' || !spec.name.trim() || spec.name.length > 40) return false
  if (!CUSTOM_OBJECT_CATEGORIES.includes(spec.category as CustomObjectCategory) || !spec.footprint || !cell(spec.footprint.width) || !cell(spec.footprint.depth)) return false
  if (spec.glbUrl !== undefined && (typeof spec.glbUrl !== 'string' || !/^https:\/\/\S+$/.test(spec.glbUrl) || spec.glbUrl.length > 500)) return false
  if (spec.finish !== undefined && spec.finish !== 'gloss') return false
  if (spec.modelSize !== undefined && !modelTuple3(spec.modelSize)) return false
  if (spec.modelScale !== undefined && (!positiveTuple3(spec.modelScale) || spec.modelScale.some((part) => part < .25 || part > 2))) return false
  const topOk = (top: unknown) => { const value = top as Partial<CustomTopSurface>; return !!value && Number.isFinite(value.height) && finitePair(value.center) && positivePair(value.size) }
  if (spec.topSurface !== undefined && !topOk(spec.topSurface)) return false
  if (spec.topSurfaces !== undefined && (!Array.isArray(spec.topSurfaces) || spec.topSurfaces.length > 4 || !spec.topSurfaces.every(topOk))) return false
  if (!Array.isArray(spec.parts) || spec.parts.length > 32 || (spec.parts.length < 1 && typeof spec.glbUrl !== 'string')) return false
  const profileOk = (part: Partial<CustomObjectPart>) => {
    if (part.primitive !== 'extrudeProfile' && part.primitive !== 'latheProfile') return true
    const points = part.profile
    if (!Array.isArray(points) || points.length < 3 || points.length > 16) return false
    if (!points.every((point) => Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= -0.5 && value <= 0.5))) return false
    return part.primitive !== 'latheProfile' || points.every((point) => point[0] >= 0)
  }
  return new Set(spec.parts.map((part) => part?.id)).size === spec.parts.length && spec.parts.every((part) => !!part && typeof part.id === 'string' && CUSTOM_PRIMITIVES.includes(part.primitive) && tuple3(part.position) && tuple3(part.rotation) && positiveTuple3(part.size) && /^#[0-9a-f]{6}$/i.test(part.color) && unit(part.roughness) && unit(part.metalness) && profileOk(part))
}

export const customObjectType = (id: string) => `custom:${id}`
export const clampModelScale = (scale: CustomObjectSpec['modelScale']): [number, number, number] => (scale ?? [1, 1, 1]).map((value) => Math.max(.25, Math.min(1, value))) as [number, number, number]

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  console.assert(isCustomObjectSpec({ id: 'check', name: 'check', category: 'furniture', footprint: { width: 1, depth: 1 }, parts: [{ id: 'body', primitive: 'box', position: [0, .5, 0], rotation: [0, 0, 0], size: [1, 1, 1], color: '#ffffff', roughness: .8, metalness: 0 }] }), 'custom object schema must accept a valid primitive object')
}
