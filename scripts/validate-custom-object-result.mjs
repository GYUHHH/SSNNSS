import { readFile } from 'node:fs/promises'

const path = process.argv[2]
const expectedCategory = process.argv[3]
const categories = new Set(['furniture', 'wallDecoration', 'floor', 'sculpture'])
const primitives = new Set(['box', 'roundedBox', 'cylinder', 'sphere', 'capsule', 'torus', 'cone'])
const tuple = (entry, positive = false) => Array.isArray(entry) && entry.length === 3 && entry.every((n) => Number.isFinite(n) && (!positive || (n > 0 && n <= 12)))
const structurallySound = (value) => {
  const transforms = value.parts.map((part) => JSON.stringify([part.primitive, part.position, part.rotation, part.size]))
  if (new Set(transforms).size !== transforms.length) return false
  if (value.category === 'wallDecoration') return true
  const bottoms = value.parts.map((part) => part.position[1] - part.size[1] / 2)
  return Math.min(...bottoms) >= -.05 && Math.min(...bottoms) <= .12
}
const validObject = (value, category) => value && typeof value === 'object'
  && typeof value.name === 'string' && value.name.trim() && value.name.length <= 40
  && categories.has(value.category) && value.category === category
  && value.footprint && Number.isInteger(value.footprint.width) && value.footprint.width >= 1 && value.footprint.width <= 10
  && Number.isInteger(value.footprint.depth) && value.footprint.depth >= 1 && value.footprint.depth <= 10
  && Array.isArray(value.parts) && value.parts.length >= 3 && value.parts.length <= 96
  && new Set(value.parts.map((part) => part?.id)).size === value.parts.length
  && value.parts.every((part) => part && typeof part.id === 'string' && primitives.has(part.primitive)
    && tuple(part.position) && tuple(part.rotation) && tuple(part.size, true)
    && /^#[0-9a-f]{6}$/i.test(part.color) && Number.isFinite(part.roughness) && part.roughness >= 0 && part.roughness <= 1
    && Number.isFinite(part.metalness) && part.metalness >= 0 && part.metalness <= 1)
  && structurallySound(value)
if (path === '--self-test') {
  const part = (id, x) => ({ id, primitive: 'box', position: [x, .5, 0], rotation: [0, 0, 0], size: [1, 1, 1], color: '#ffffff', roughness: .8, metalness: 0 })
  const fixture = { name: 'test', category: 'furniture', footprint: { width: 1, depth: 1 }, parts: [part('a', -1), part('b', 0), part('c', 1)] }
  if (!validObject(fixture, 'furniture') || validObject({ ...fixture, parts: [] }, 'furniture')) throw new Error('SELF_TEST_FAILED')
  process.stdout.write('ok')
  process.exit(0)
}
if (!path || !expectedCategory) throw new Error('usage: node scripts/validate-custom-object-result.mjs <result.json> <category>')
const value = JSON.parse(await readFile(path, 'utf8'))
if (!validObject(value, expectedCategory)) throw new Error('INVALID_CUSTOM_OBJECT_RESULT')
process.stdout.write(JSON.stringify(value))
