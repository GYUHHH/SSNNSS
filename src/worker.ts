import { CUSTOM_OBJECT_CATEGORIES, isCustomObjectSpec, type CustomObjectCategory } from './customObjectSpec'

type Env = { ASSETS: { fetch: (request: Request) => Promise<Response> }; OPENAI_API_KEY?: string; SUPABASE_SERVICE_KEY?: string; GITHUB_ACTIONS_TOKEN?: string; IMG2THREEJS_RUNNER_SECRET?: string; LS_WEBHOOK_SECRET?: string; LS_BUY_URL?: string; LS_CREDITS_PER_ORDER?: string }
type GenerateBody = { category?: unknown; prompt?: unknown; image?: unknown }
type JobBody = { jobId?: unknown; stage?: unknown; error?: unknown; object?: unknown }

const SUPABASE_URL = 'https://pxjavljsalibpnxdrxel.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4amF2bGpzYWxpYnBueGRyeGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjAxNTgsImV4cCI6MjEwMjQzNjE1OH0.quIFdlk11b7F-YIeHO3TsEhS2RzgxDtntqdh2vHyUfE'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })

const signedInUserId = async (request: Request): Promise<string | null> => {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || authorization === `Bearer ${SUPABASE_ANON_KEY}`) return null
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization } })
  if (!response.ok) return null
  const body = await response.json().catch(() => null) as { id?: unknown } | null
  return typeof body?.id === 'string' ? body.id : null
}
const signedIn = async (request: Request) => !!await signedInUserId(request)

// 로그인 유저의 방 handle: 크레딧은 handle 단위로 적립·차감된다
const signedInHandle = async (request: Request): Promise<string | null> => {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || authorization === `Bearer ${SUPABASE_ANON_KEY}`) return null
  const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization } })
  if (!user.ok) return null
  const { id } = await user.json().catch(() => ({})) as { id?: string }
  if (!id) return null
  const rooms = await fetch(`${SUPABASE_URL}/rest/v1/rooms?owner=eq.${encodeURIComponent(id)}&select=handle&limit=1`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } })
  const rows = await rooms.json().catch(() => null)
  return Array.isArray(rows) ? rows[0]?.handle ?? null : null
}

// 결제 구성이 전부 갖춰졌을 때만 유료 모드 — 하나라도 없으면 기존처럼 무료로 동작한다
const billingEnabled = (env: Env) => !!(env.SUPABASE_SERVICE_KEY && env.LS_WEBHOOK_SECRET && env.LS_BUY_URL)

const serviceHeaders = (env: Env) => ({ apikey: env.SUPABASE_SERVICE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' })

const runnerAuthorized = (request: Request, env: Env) => !!env.IMG2THREEJS_RUNNER_SECRET && request.headers.get('Authorization') === `Bearer ${env.IMG2THREEJS_RUNNER_SECRET}`
const jobConfigured = (env: Env) => !!(env.SUPABASE_SERVICE_KEY && env.GITHUB_ACTIONS_TOKEN && env.IMG2THREEJS_RUNNER_SECRET)
const jobIdFrom = (body: JobBody | null) => typeof body?.jobId === 'string' && /^[0-9a-f-]{36}$/i.test(body.jobId) ? body.jobId : null
const JOB_STALE_MS = 20 * 60 * 1000

const decodeImage = (value: string) => {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value)
  if (!match) return null
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return { mime: match[1], bytes }
}

const jobRows = async (env: Env, query: string) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/custom_object_jobs?${query}`, { headers: serviceHeaders(env), cache: 'no-store' })
  return response.ok ? await response.json().catch(() => []) as Array<Record<string, unknown>> : []
}

const patchJob = async (env: Env, jobId: string, body: Record<string, unknown>) => fetch(`${SUPABASE_URL}/rest/v1/custom_object_jobs?id=eq.${jobId}`, {
  method: 'PATCH', headers: { ...serviceHeaders(env), Prefer: 'return=minimal' }, body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
})

const expireStaleJob = async (env: Env, row: Record<string, unknown>) => {
  if (!['queued', 'running'].includes(String(row.status))) return row
  const updatedAt = Date.parse(String(row.updated_at ?? ''))
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt <= JOB_STALE_MS) return row
  await patchJob(env, String(row.id), { status: 'failed', stage: 'failed', error: 'PIPELINE_TIMEOUT' })
  return { ...row, status: 'failed', stage: 'failed', error: 'PIPELINE_TIMEOUT' }
}

const spendGenerationCredit = async (request: Request, env: Env) => {
  if (!billingEnabled(env)) return true
  const handle = await signedInHandle(request)
  if (!handle) return false
  const spent = await fetch(`${SUPABASE_URL}/rest/v1/rpc/spend_credit`, { method: 'POST', headers: serviceHeaders(env), body: JSON.stringify({ p_handle: handle }) })
  return spent.ok && await spent.json().catch(() => null) === true
}

async function createJob(request: Request, env: Env) {
  if (!jobConfigured(env)) return json({ error: 'IMG2THREEJS_NOT_CONFIGURED' }, 503)
  const ownerId = await signedInUserId(request)
  if (!ownerId) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as GenerateBody | null
  const category = body?.category as CustomObjectCategory
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const image = typeof body?.image === 'string' ? decodeImage(body.image) : null
  if (!CUSTOM_OBJECT_CATEGORIES.includes(category) || !image || prompt.length > 1200 || image.bytes.byteLength > 7_000_000) return json({ error: 'INVALID_REQUEST' }, 400)
  const active = (await jobRows(env, `owner_id=eq.${ownerId}&status=in.(queued,running)&select=id,status,stage,updated_at&order=created_at.desc&limit=1`))[0]
  if (active) {
    const current = await expireStaleJob(env, active)
    if (current.status !== 'failed') return json({ jobId: current.id, status: current.status, stage: current.stage }, 202)
  }
  if (!await spendGenerationCredit(request, env)) return json({ error: 'NO_CREDITS' }, 402)

  const jobId = crypto.randomUUID()
  const extension = image.mime === 'image/jpeg' ? 'jpg' : image.mime.split('/')[1]
  const referencePath = `${ownerId}/${jobId}.${extension}`
  const uploaded = await fetch(`${SUPABASE_URL}/storage/v1/object/custom-object-inputs/${referencePath}`, {
    method: 'POST', headers: { ...serviceHeaders(env), 'Content-Type': image.mime, 'x-upsert': 'false' }, body: image.bytes,
  })
  if (!uploaded.ok) return json({ error: 'REFERENCE_UPLOAD_FAILED' }, 502)
  const inserted = await fetch(`${SUPABASE_URL}/rest/v1/custom_object_jobs`, {
    method: 'POST', headers: { ...serviceHeaders(env), Prefer: 'return=minimal' },
    body: JSON.stringify({ id: jobId, owner_id: ownerId, category, prompt, reference_path: referencePath, reference_mime: image.mime }),
  })
  if (!inserted.ok) return json({ error: 'JOB_CREATE_FAILED' }, 502)
  const dispatched = await fetch('https://api.github.com/repos/GYUHHH/SSNNSS/actions/workflows/img2threejs.yml/dispatches', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'dens-img2threejs' },
    body: JSON.stringify({ ref: 'main', inputs: { job_id: jobId } }),
  })
  if (!dispatched.ok) {
    const error = `JOB_DISPATCH_FAILED_${dispatched.status}`
    await patchJob(env, jobId, { status: 'failed', stage: 'failed', error })
    return json({ error }, 502)
  }
  return json({ jobId, status: 'queued', stage: 'queued' }, 202)
}

async function jobStatus(request: Request, env: Env) {
  if (!env.SUPABASE_SERVICE_KEY) return json({ error: 'IMG2THREEJS_NOT_CONFIGURED' }, 503)
  const ownerId = await signedInUserId(request)
  if (!ownerId) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as JobBody | null
  const jobId = jobIdFrom(body)
  if (!jobId) return json({ error: 'INVALID_REQUEST' }, 400)
  const row = (await jobRows(env, `id=eq.${jobId}&owner_id=eq.${ownerId}&select=id,status,stage,result,error,updated_at&limit=1`))[0]
  if (!row) return json({ error: 'JOB_NOT_FOUND' }, 404)
  return json(await expireStaleJob(env, row))
}

async function latestJob(request: Request, env: Env) {
  if (!env.SUPABASE_SERVICE_KEY) return json({ error: 'IMG2THREEJS_NOT_CONFIGURED' }, 503)
  const ownerId = await signedInUserId(request)
  if (!ownerId) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const row = (await jobRows(env, `owner_id=eq.${ownerId}&status=in.(queued,running,completed,failed)&select=id,status,stage,result,error,updated_at&order=created_at.desc&limit=1`))[0]
  return json(row ? await expireStaleJob(env, row) : { status: 'none' })
}

async function consumeJob(request: Request, env: Env) {
  if (!env.SUPABASE_SERVICE_KEY) return json({ error: 'IMG2THREEJS_NOT_CONFIGURED' }, 503)
  const ownerId = await signedInUserId(request)
  if (!ownerId) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as JobBody | null
  const jobId = jobIdFrom(body)
  if (!jobId) return json({ error: 'INVALID_REQUEST' }, 400)
  const row = (await jobRows(env, `id=eq.${jobId}&owner_id=eq.${ownerId}&select=id,status&limit=1`))[0]
  if (!row || !['completed', 'failed'].includes(String(row.status))) return json({ error: 'JOB_NOT_READY' }, 409)
  const response = await patchJob(env, jobId, { status: 'consumed' })
  return response.ok ? json({ ok: true }) : json({ error: 'JOB_UPDATE_FAILED' }, 502)
}

async function claimJob(request: Request, env: Env) {
  if (!runnerAuthorized(request, env) || !env.SUPABASE_SERVICE_KEY) return json({ error: 'UNAUTHORIZED' }, 401)
  const body = await request.json().catch(() => null) as JobBody | null
  const jobId = jobIdFrom(body)
  if (!jobId) return json({ error: 'INVALID_REQUEST' }, 400)
  const row = (await jobRows(env, `id=eq.${jobId}&select=category,prompt,reference_path,reference_mime,status&limit=1`))[0]
  if (!row || !['queued', 'running'].includes(String(row.status))) return json({ error: 'JOB_NOT_AVAILABLE' }, 409)
  await patchJob(env, jobId, { status: 'running', stage: 'intake', error: null })
  return json({ category: row.category, prompt: row.prompt, referencePath: row.reference_path, referenceMime: row.reference_mime })
}

async function jobReference(request: Request, env: Env) {
  if (!runnerAuthorized(request, env) || !env.SUPABASE_SERVICE_KEY) return json({ error: 'UNAUTHORIZED' }, 401)
  const body = await request.json().catch(() => null) as JobBody | null
  const jobId = jobIdFrom(body)
  if (!jobId) return json({ error: 'INVALID_REQUEST' }, 400)
  const row = (await jobRows(env, `id=eq.${jobId}&select=reference_path,reference_mime&limit=1`))[0]
  if (!row) return json({ error: 'JOB_NOT_FOUND' }, 404)
  const stored = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/custom-object-inputs/${row.reference_path}`, { headers: serviceHeaders(env) })
  if (!stored.ok) return json({ error: 'REFERENCE_NOT_FOUND' }, 404)
  return new Response(stored.body, { headers: { 'Content-Type': String(row.reference_mime), 'Cache-Control': 'no-store' } })
}

async function progressJob(request: Request, env: Env) {
  if (!runnerAuthorized(request, env) || !env.SUPABASE_SERVICE_KEY) return json({ error: 'UNAUTHORIZED' }, 401)
  const body = await request.json().catch(() => null) as JobBody | null
  const jobId = jobIdFrom(body)
  const stage = typeof body?.stage === 'string' && ['intake', 'sculpting', 'final-review'].includes(body.stage) ? body.stage : null
  if (!jobId || !stage) return json({ error: 'INVALID_REQUEST' }, 400)
  const response = await patchJob(env, jobId, { status: 'running', stage })
  return response.ok ? json({ ok: true }) : json({ error: 'JOB_UPDATE_FAILED' }, 502)
}

async function completeJob(request: Request, env: Env) {
  if (!runnerAuthorized(request, env) || !env.SUPABASE_SERVICE_KEY) return json({ error: 'UNAUTHORIZED' }, 401)
  const body = await request.json().catch(() => null) as JobBody | null
  const jobId = jobIdFrom(body)
  if (!jobId || !isCustomObjectSpec(body?.object)) return json({ error: 'INVALID_REQUEST' }, 400)
  const response = await patchJob(env, jobId, { status: 'completed', stage: 'completed', result: body.object, error: null })
  return response.ok ? json({ ok: true }) : json({ error: 'JOB_UPDATE_FAILED' }, 502)
}

async function failJob(request: Request, env: Env) {
  if (!runnerAuthorized(request, env) || !env.SUPABASE_SERVICE_KEY) return json({ error: 'UNAUTHORIZED' }, 401)
  const body = await request.json().catch(() => null) as JobBody | null
  const jobId = jobIdFrom(body)
  const error = typeof body?.error === 'string' ? body.error.slice(0, 500) : 'PIPELINE_FAILED'
  if (!jobId) return json({ error: 'INVALID_REQUEST' }, 400)
  if (error === 'GITHUB_WORKFLOW_FAILED') {
    const current = (await jobRows(env, `id=eq.${jobId}&select=status,error&limit=1`))[0]
    if (current?.status === 'failed' && current.error) return json({ ok: true })
  }
  const response = await patchJob(env, jobId, { status: 'failed', stage: 'failed', error })
  return response.ok ? json({ ok: true }) : json({ error: 'JOB_UPDATE_FAILED' }, 502)
}

const creditBalance = async (env: Env, handle: string): Promise<{ balance: number; freeLeft: boolean }> => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/credits?handle=eq.${encodeURIComponent(handle)}&select=balance,free_used&limit=1`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } })
  const rows = await response.json().catch(() => null)
  const row = Array.isArray(rows) ? rows[0] : null
  return { balance: row?.balance ?? 0, freeLeft: !(row?.free_used ?? false) }
}

async function credits(request: Request, env: Env) {
  const handle = await signedInHandle(request)
  if (!handle) return json({ error: 'LOGIN_REQUIRED' }, 401)
  if (!billingEnabled(env)) return json({ enabled: false, balance: 0, buyUrl: null })
  const buyUrl = `${env.LS_BUY_URL}${env.LS_BUY_URL!.includes('?') ? '&' : '?'}checkout[custom][handle]=${encodeURIComponent(handle)}`
  const { balance, freeLeft } = await creditBalance(env, handle)
  return json({ enabled: true, balance, freeLeft, buyUrl })
}

// Lemon Squeezy 웹훅: X-Signature = HMAC-SHA256(raw body, secret) hex. order_created만 적립한다.
async function lsWebhook(request: Request, env: Env) {
  if (!billingEnabled(env)) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)
  const raw = await request.text()
  const signature = request.headers.get('X-Signature') ?? ''
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LS_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (signature.toLowerCase() !== expected) return json({ error: 'BAD_SIGNATURE' }, 401)
  const body = JSON.parse(raw) as { meta?: { event_name?: string; custom_data?: { handle?: string } }; data?: { attributes?: { first_order_item?: { quantity?: number } } } }
  if (body.meta?.event_name !== 'order_created') return json({ ok: true })
  const handle = body.meta?.custom_data?.handle
  if (!handle || typeof handle !== 'string') return json({ error: 'NO_HANDLE' }, 400)
  const quantity = Math.max(1, Number(body.data?.attributes?.first_order_item?.quantity) || 1)
  const amount = quantity * Math.max(1, Number(env.LS_CREDITS_PER_ORDER) || 10)
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_credits`, { method: 'POST', headers: serviceHeaders(env), body: JSON.stringify({ p_handle: handle, p_amount: amount }) })
  if (!response.ok) return json({ error: 'CREDIT_FAILED' }, 502)
  return json({ ok: true })
}

async function concept(request: Request, env: Env) {
  if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY_NOT_SET' }, 503)
  if (!await signedIn(request)) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as GenerateBody | null
  const category = body?.category as CustomObjectCategory
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  if (!CUSTOM_OBJECT_CATEGORIES.includes(category) || !prompt || prompt.length > 1200) return json({ error: 'INVALID_REQUEST' }, 400)
  const upstream = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1', size: '1024x1024', quality: 'low', n: 1,
      prompt: `Cute low-poly 3D render of a single ${category === 'wallDecoration' ? 'wall decoration' : category} object for a miniature isometric room: ${prompt}. Soft pastel flat colors, simple geometric forms, plain light background, no text, no people.`,
    }),
  })
  const result = await upstream.json().catch(() => null) as { data?: Array<{ b64_json?: string }> } | null
  const b64 = result?.data?.[0]?.b64_json
  if (!upstream.ok || !b64) return json({ error: 'CONCEPT_FAILED' }, 502)
  return json({ image: `data:image/png;base64,${b64}` })
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/ls-webhook') {
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
      return lsWebhook(request, env)
    }
    if (url.pathname.startsWith('/api/custom-objects')) {
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
      if (url.pathname === '/api/custom-objects/jobs') return createJob(request, env)
      if (url.pathname === '/api/custom-objects/jobs/status') return jobStatus(request, env)
      if (url.pathname === '/api/custom-objects/jobs/latest') return latestJob(request, env)
      if (url.pathname === '/api/custom-objects/jobs/consume') return consumeJob(request, env)
      if (url.pathname === '/api/custom-objects/jobs/claim') return claimJob(request, env)
      if (url.pathname === '/api/custom-objects/jobs/reference') return jobReference(request, env)
      if (url.pathname === '/api/custom-objects/jobs/progress') return progressJob(request, env)
      if (url.pathname === '/api/custom-objects/jobs/complete') return completeJob(request, env)
      if (url.pathname === '/api/custom-objects/jobs/fail') return failJob(request, env)
      if (url.pathname === '/api/custom-objects/credits') return credits(request, env)
      if (url.pathname === '/api/custom-objects/concept') return concept(request, env)
      return json({ error: 'NOT_FOUND' }, 404)
    }
    return env.ASSETS.fetch(request)
  },
}
