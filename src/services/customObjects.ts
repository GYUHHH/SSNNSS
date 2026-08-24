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

export async function generateCustomObject(input: { category: CustomObjectCategory; prompt: string; image?: string }): Promise<CustomObjectSpec> {
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
