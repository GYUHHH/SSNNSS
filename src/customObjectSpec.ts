export const CUSTOM_OBJECT_CATEGORIES = ['furniture', 'wallDecoration', 'floor', 'sculpture'] as const
export const CUSTOM_PRIMITIVES = ['box', 'roundedBox', 'cylinder', 'sphere', 'capsule', 'torus', 'cone'] as const

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
}
export type CustomObjectSpec = {
  id: string
  name: string
  category: CustomObjectCategory
  footprint: { width: number; depth: number }
  parts: CustomObjectPart[]
}

const tuple3 = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number' && Number.isFinite(part))
const positiveTuple3 = (value: unknown): value is [number, number, number] => tuple3(value) && value.every((part) => part > 0 && part <= 12)
const unit = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const cell = (value: unknown) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10

export const isCustomObjectSpec = (value: unknown): value is CustomObjectSpec => {
  if (!value || typeof value !== 'object') return false
  const spec = value as Partial<CustomObjectSpec>
  if (typeof spec.id !== 'string' || !spec.id || typeof spec.name !== 'string' || !spec.name.trim() || spec.name.length > 40) return false
  if (!CUSTOM_OBJECT_CATEGORIES.includes(spec.category as CustomObjectCategory) || !spec.footprint || !cell(spec.footprint.width) || !cell(spec.footprint.depth)) return false
  if (!Array.isArray(spec.parts) || spec.parts.length < 1 || spec.parts.length > 32) return false
  return new Set(spec.parts.map((part) => part?.id)).size === spec.parts.length && spec.parts.every((part) => !!part && typeof part.id === 'string' && CUSTOM_PRIMITIVES.includes(part.primitive) && tuple3(part.position) && tuple3(part.rotation) && positiveTuple3(part.size) && /^#[0-9a-f]{6}$/i.test(part.color) && unit(part.roughness) && unit(part.metalness))
}

export const customObjectType = (id: string) => `custom:${id}`

export const customObjectSchema = {
  type: 'object', additionalProperties: false,
  required: ['name', 'category', 'footprint', 'parts'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 40 },
    category: { type: 'string', enum: [...CUSTOM_OBJECT_CATEGORIES] },
    footprint: {
      type: 'object', additionalProperties: false, required: ['width', 'depth'],
      properties: { width: { type: 'integer', minimum: 1, maximum: 10 }, depth: { type: 'integer', minimum: 1, maximum: 10 } },
    },
    parts: {
      type: 'array', minItems: 1, maxItems: 32,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'primitive', 'position', 'rotation', 'size', 'color', 'roughness', 'metalness'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 40 },
          primitive: { type: 'string', enum: [...CUSTOM_PRIMITIVES] },
          position: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          rotation: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          size: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', exclusiveMinimum: 0, maximum: 12 } },
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          roughness: { type: 'number', minimum: 0, maximum: 1 },
          metalness: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  console.assert(isCustomObjectSpec({ id: 'check', name: 'check', category: 'furniture', footprint: { width: 1, depth: 1 }, parts: [{ id: 'body', primitive: 'box', position: [0, .5, 0], rotation: [0, 0, 0], size: [1, 1, 1], color: '#ffffff', roughness: .8, metalness: 0 }] }), 'custom object schema must accept a valid primitive object')
}
