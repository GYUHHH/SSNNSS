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

export type CustomObjectJobState = {
  id?: string
  status: 'none' | 'queued' | 'running' | 'completed' | 'failed'
  stage?: 'queued' | 'intake' | 'sculpting' | 'final-review' | 'completed' | 'failed'
  result?: unknown
  error?: string
}

export async function createCustomObjectJob(input: { category: CustomObjectCategory; prompt: string; image: string }): Promise<string> {
  const response = await fetch('/api/custom-objects/jobs', {
    method: 'POST',
    headers: { ...await authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => null) as { jobId?: string; error?: string } | null
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  if (typeof body?.jobId !== 'string') throw new Error('INVALID_CUSTOM_OBJECT_JOB')
  return body.jobId
}

export async function generateConceptImage(input: { category: CustomObjectCategory; prompt: string }): Promise<string> {
  const response = await fetch('/api/custom-objects/concept', {
    method: 'POST',
    headers: { ...await authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => null) as { image?: string; error?: string } | null
  if (!response.ok || typeof body?.image !== 'string') throw new Error(body?.error || `HTTP ${response.status}`)
  return body.image
}

const readJob = async (path: string, body: Record<string, unknown> = {}): Promise<CustomObjectJobState> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { ...await authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const value = await response.json().catch(() => null) as CustomObjectJobState & { error?: string } | null
  if (!response.ok || !value) throw new Error(value?.error || `HTTP ${response.status}`)
  return value
}

export const latestCustomObjectJob = () => readJob('/api/custom-objects/jobs/latest')
export const customObjectJobStatus = (jobId: string) => readJob('/api/custom-objects/jobs/status', { jobId })
export const consumeCustomObjectJob = async (jobId: string) => { await readJob('/api/custom-objects/jobs/consume', { jobId }) }

export async function waitForCustomObjectJob(jobId: string, onStage: (stage: CustomObjectJobState['stage']) => void): Promise<CustomObjectSpec> {
  const started = Date.now()
  while (Date.now() - started < 60 * 60 * 1000) {
    const state = await customObjectJobStatus(jobId)
    onStage(state.stage)
    if (state.status === 'completed') {
      if (!isCustomObjectSpec(state.result)) throw new Error('INVALID_CUSTOM_OBJECT')
      return state.result
    }
    if (state.status === 'failed') throw new Error(state.error || 'PIPELINE_FAILED')
    await new Promise((resolve) => setTimeout(resolve, 4000))
  }
  throw new Error('PIPELINE_TIMEOUT')
}

export async function fetchCredits(): Promise<{ enabled: boolean; balance: number; freeLeft: boolean; buyUrl: string | null }> {
  const response = await fetch('/api/custom-objects/credits', { method: 'POST', headers: await authHeaders() })
  const body = await response.json().catch(() => null) as { enabled?: boolean; balance?: number; freeLeft?: boolean; buyUrl?: string | null } | null
  if (!response.ok || !body) return { enabled: false, balance: 0, freeLeft: false, buyUrl: null }
  return { enabled: !!body.enabled, balance: body.balance ?? 0, freeLeft: !!body.freeLeft, buyUrl: body.buyUrl ?? null }
}
