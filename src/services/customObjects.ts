import { customObjectType, isCustomObjectSpec, type CustomObjectCategory, type CustomObjectSpec } from '../customObjectSpec'
import { authHeaders, readStored, writeStored } from './social'

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

export async function submitGlbObject(image: string): Promise<string> {
  const response = await fetch('/api/glb-objects', {
    method: 'POST',
    headers: { ...await authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ image }),
  })
  const body = await response.json().catch(() => null) as { requestId?: string; error?: string } | null
  if (!response.ok || typeof body?.requestId !== 'string') throw new Error(body?.error || `HTTP ${response.status}`)
  return body.requestId
}

export async function pollGlbObject(requestId: string): Promise<{ done: boolean; url?: string }> {
  const response = await fetch(`/api/glb-objects/poll?id=${encodeURIComponent(requestId)}`, { headers: await authHeaders() })
  const body = await response.json().catch(() => null) as { done?: boolean; url?: string; error?: string } | null
  if (!response.ok || typeof body?.done !== 'boolean') throw new Error(body?.error || `HTTP ${response.status}`)
  return { done: body.done, url: typeof body.url === 'string' ? body.url : undefined }
}
