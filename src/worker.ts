import { CUSTOM_OBJECT_CATEGORIES, type CustomObjectCategory } from './customObjectSpec'

type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  SUPABASE_SERVICE_KEY?: string
  LS_WEBHOOK_SECRET?: string
  LS_BUY_URL?: string
  LS_CREDITS_PER_ORDER?: string
  FAL_KEY?: string
}
const SUPABASE_URL = 'https://pxjavljsalibpnxdrxel.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4amF2bGpzYWxpYnBueGRyeGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjAxNTgsImV4cCI6MjEwMjQzNjE1OH0.quIFdlk11b7F-YIeHO3TsEhS2RzgxDtntqdh2vHyUfE'
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
const authorization = (request: Request) => request.headers.get('Authorization')

// YouTube permits the thumbnail to be displayed cross-origin but not reliably read back through a mobile canvas.
// Serve the exact public image from our own origin so one crop calculation works on every browser.
async function youtubeThumbnail(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id || !/^[\w-]{11}$/.test(id)) return json({ error: 'INVALID_VIDEO' }, 400)
  const upstream = await fetch(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`)
  if (!upstream.ok) return json({ error: 'THUMBNAIL_UNAVAILABLE' }, 502)
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

const signedIn = async (request: Request) => {
  const token = authorization(request)
  if (!token?.startsWith('Bearer ') || token === `Bearer ${SUPABASE_ANON_KEY}`) return false
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: token } })
  return response.ok
}

const signedInHandle = async (request: Request): Promise<string | null> => {
  const token = authorization(request)
  if (!token?.startsWith('Bearer ') || token === `Bearer ${SUPABASE_ANON_KEY}`) return null
  const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: token } })
  if (!user.ok) return null
  const { id } = await user.json().catch(() => ({})) as { id?: string }
  if (!id) return null
  const rooms = await fetch(`${SUPABASE_URL}/rest/v1/rooms?owner=eq.${encodeURIComponent(id)}&select=handle&limit=1`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } })
  const rows = await rooms.json().catch(() => null)
  return Array.isArray(rows) ? rows[0]?.handle ?? null : null
}

const billingEnabled = (env: Env) => !!(env.SUPABASE_SERVICE_KEY && env.LS_WEBHOOK_SECRET && env.LS_BUY_URL)
const serviceHeaders = (env: Env) => ({ apikey: env.SUPABASE_SERVICE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' })

async function spendCredit(request: Request, env: Env, amount = 1) {
  if (!billingEnabled(env)) return true
  const handle = await signedInHandle(request)
  if (!handle) return false
  // 광택 등급은 2코인 — 원자적 차감(spend_credits)으로 절반만 빠지는 일이 없게 한다
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/spend_credits`, { method: 'POST', headers: serviceHeaders(env), body: JSON.stringify({ p_handle: handle, p_amount: amount }) })
  return response.ok && await response.json().catch(() => null) === true
}

async function credits(request: Request, env: Env) {
  const handle = await signedInHandle(request)
  if (!handle) return json({ error: 'LOGIN_REQUIRED' }, 401)
  if (!billingEnabled(env)) return json({ enabled: false, balance: 0, freeLeft: false, buyUrl: null })
  const response = await fetch(`${SUPABASE_URL}/rest/v1/credits?handle=eq.${encodeURIComponent(handle)}&select=balance,free_used&limit=1`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } })
  const rows = await response.json().catch(() => null)
  const row = Array.isArray(rows) ? rows[0] : null
  const buyUrl = `${env.LS_BUY_URL}${env.LS_BUY_URL!.includes('?') ? '&' : '?'}checkout[custom][handle]=${encodeURIComponent(handle)}`
  return json({ enabled: true, balance: row?.balance ?? 0, freeLeft: !(row?.free_used ?? false), buyUrl })
}

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
  if (!handle) return json({ error: 'NO_HANDLE' }, 400)
  const quantity = Math.max(1, Number(body.data?.attributes?.first_order_item?.quantity) || 1)
  const amount = quantity * Math.max(1, Number(env.LS_CREDITS_PER_ORDER) || 5)
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_credits`, { method: 'POST', headers: serviceHeaders(env), body: JSON.stringify({ p_handle: handle, p_amount: amount }) })
  return response.ok ? json({ ok: true }) : json({ error: 'CREDIT_FAILED' }, 502)
}

// 텍스트와 사진 모두 Rapid를 직접 한 번만 호출한다. PBR 여부만 품질 등급에 따라 달라진다.
const FAL_IMAGE_MODEL = 'fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d'
const FAL_TEXT_MODEL = 'fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d'
// fal 큐의 상태·결과 조회는 하위 경로가 아니라 앱 루트 경로로 받는다.
const FAL_QUEUE_APP = 'fal-ai/hunyuan-3d'
const CATEGORY_PROMPT: Record<CustomObjectCategory, string> = {
  furniture: 'floor-standing furniture with a stable base',
  wallDecoration: 'thin wall-mounted object with a flat back',
  floor: 'thin flat floor covering like a rug',
  sculpture: 'small compact room prop',
}

async function glbSubmit(request: Request, env: Env) {
  if (!env.FAL_KEY) return json({ error: 'FAL_KEY_NOT_SET' }, 503)
  if (!await signedIn(request)) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as { image?: unknown; prompt?: unknown; category?: unknown; finish?: unknown } | null
  const gloss = body?.finish === 'gloss'
  const image = typeof body?.image === 'string' ? body.image : ''
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const category = body?.category as CustomObjectCategory
  if (!CUSTOM_OBJECT_CATEGORIES.includes(category) || (!image && !prompt)) return json({ error: 'INVALID_REQUEST' }, 400)
  if (image && (!image.startsWith('data:image/') || image.length > 7_000_000)) return json({ error: 'INVALID_IMAGE' }, 400)
  if (!image && prompt.length > 200) return json({ error: 'INVALID_REQUEST' }, 400)
  if (!await spendCredit(request, env, gloss ? 2 : 1)) return json({ error: 'NO_CREDITS' }, 402)
  const model = image ? FAL_IMAGE_MODEL : FAL_TEXT_MODEL
  const input = image
    ? { input_image_url: image, enable_pbr: gloss }
    : { prompt: `Standalone ${CATEGORY_PROMPT[category]} for a miniature room: ${prompt}`.slice(0, 200), enable_pbr: gloss }
  const upstream = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST', headers: { Authorization: `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const result = await upstream.json().catch(() => null) as { request_id?: string } | null
  if (!upstream.ok || !result?.request_id) { console.log('glb-submit-failed', upstream.status); return json({ error: 'GLB_SUBMIT_FAILED' }, 502) }
  return json({ requestId: result.request_id })
}

async function glbPoll(request: Request, env: Env) {
  if (!env.FAL_KEY) return json({ error: 'FAL_KEY_NOT_SET' }, 503)
  if (!await signedIn(request)) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!/^[\w-]{8,64}$/.test(id)) return json({ error: 'INVALID_REQUEST' }, 400)
  const auth = { Authorization: `Key ${env.FAL_KEY}` }
  const status = await fetch(`https://queue.fal.run/${FAL_QUEUE_APP}/requests/${id}/status`, { headers: auth })
  const state = await status.json().catch(() => null) as { status?: string } | null
  if (!status.ok || !state?.status) { console.log('glb-poll-failed', status.status, JSON.stringify(state)?.slice(0, 200)); return json({ error: 'GLB_POLL_FAILED' }, 502) }
  if (state.status !== 'COMPLETED') return json({ done: false })
  const result = await fetch(`https://queue.fal.run/${FAL_QUEUE_APP}/requests/${id}`, { headers: auth })
  type FalFile = { url?: string; content_type?: string; file_name?: string }
  const payload = await result.json().catch(() => null) as { model_glb?: FalFile; model_obj?: FalFile; material_mtl?: FalFile; texture?: FalFile; model_urls?: { glb?: FalFile | null; obj?: FalFile | null; mtl?: FalFile | null; texture?: FalFile | null } } | null
  const glb = payload?.model_urls?.glb ?? (payload?.model_glb?.content_type === 'model/gltf-binary' ? payload.model_glb : null)
  if (result.ok && glb?.url) return json({ done: true, model: { format: 'glb', url: glb.url } })
  const obj = payload?.model_urls?.obj ?? payload?.model_obj ?? (payload?.model_glb?.content_type === 'model/obj' ? payload.model_glb : null)
  const mtl = payload?.model_urls?.mtl ?? payload?.material_mtl
  const texture = payload?.model_urls?.texture ?? payload?.texture
  if (result.ok && obj?.url) return json({ done: true, model: { format: 'obj', objUrl: obj.url, mtlUrl: mtl?.url, textureUrl: texture?.url, textureName: texture?.file_name } })
  console.log('model-result-failed', result.status)
  return json({ error: 'MODEL_RESULT_FAILED' }, 502)
}

export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname
    if (path === '/api/ls-webhook') return request.method === 'POST' ? lsWebhook(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/youtube-thumbnail') return request.method === 'GET' ? youtubeThumbnail(request) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/glb-objects') return request.method === 'POST' ? glbSubmit(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/glb-objects/poll') return request.method === 'GET' ? glbPoll(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/custom-objects/credits') return request.method === 'POST' ? credits(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    return env.ASSETS.fetch(request)
  },
}
