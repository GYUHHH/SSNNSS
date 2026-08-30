import { CUSTOM_OBJECT_CATEGORIES, type CustomObjectCategory } from './customObjectSpec'
import { creemProductFor, creemPurchase, type CreemEvent } from './creem'

type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  SUPABASE_SERVICE_KEY?: string
  LS_WEBHOOK_SECRET?: string
  LS_BUY_URL?: string
  LS_CREDITS_PER_ORDER?: string
  CREEM_API_KEY?: string
  CREEM_WEBHOOK_SECRET?: string
  CREEM_PRODUCT_ID?: string
  CREEM_FIRST_PRODUCT_ID?: string
  CREEM_CREDITS_PER_ORDER?: string
  CREEM_TEST_MODE?: string
  OPENAI_API_KEY?: string
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

const lemonEnabled = (env: Env) => !!(env.SUPABASE_SERVICE_KEY && env.LS_WEBHOOK_SECRET && env.LS_BUY_URL)
const creemEnabled = (env: Env) => !!(env.SUPABASE_SERVICE_KEY && env.CREEM_API_KEY && env.CREEM_WEBHOOK_SECRET && env.CREEM_PRODUCT_ID)
// 테스트 모드는 호스트만 갈아끼우면 된다 — 키·상품·웹훅 시크릿이 전부 테스트용으로 따로 발급된다
const creemApi = (env: Env) => env.CREEM_TEST_MODE === 'true' ? 'https://test-api.creem.io' : 'https://api.creem.io'
const billingEnabled = (env: Env) => creemEnabled(env) || lemonEnabled(env)
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
  const buyUrl = lemonEnabled(env) && !creemEnabled(env) ? `${env.LS_BUY_URL}${env.LS_BUY_URL!.includes('?') ? '&' : '?'}checkout[custom][handle]=${encodeURIComponent(handle)}` : null
  return json({ enabled: true, balance: row?.balance ?? 0, freeLeft: !(row?.free_used ?? false), buyUrl, checkout: creemEnabled(env) })
}

async function creemCheckout(request: Request, env: Env) {
  if (!creemEnabled(env)) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)
  const handle = await signedInHandle(request)
  if (!handle) return json({ error: 'LOGIN_REQUIRED' }, 401)
  // 결제 이력 테이블은 Fungies 때 쓰던 것을 그대로 쓴다 — 이벤트 id에 결제사 접두어가 붙어 섞이지 않는다
  const history = await fetch(`${SUPABASE_URL}/rest/v1/fungies_payment_events?handle=eq.${encodeURIComponent(handle)}&select=event_id&limit=1`, { headers: serviceHeaders(env) })
  const payments = history.ok ? await history.json().catch(() => null) : null
  const productId = creemProductFor(!(Array.isArray(payments) && payments.length === 0), env.CREEM_PRODUCT_ID!, env.CREEM_FIRST_PRODUCT_ID)
  const response = await fetch(`${creemApi(env)}/v1/checkouts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.CREEM_API_KEY! },
    // success_url이 없으면 Creem 기본 완료 페이지에 머문다 — 결제 후 방으로 돌려보낸다
    body: JSON.stringify({ product_id: productId, request_id: handle, metadata: { handle }, success_url: new URL(request.url).origin }),
  })
  const body = await response.json().catch(() => null) as { checkout_url?: string } | null
  if (!response.ok || !body?.checkout_url) { console.log('creem-checkout-failed', response.status); return json({ error: 'CHECKOUT_FAILED' }, 502) }
  return json({ url: body.checkout_url })
}

async function creemWebhook(request: Request, env: Env) {
  if (!creemEnabled(env)) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)
  const raw = await request.text()
  const signature = request.headers.get('creem-signature') ?? ''
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.CREEM_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const given = signature.toLowerCase()
  if (given.length !== expected.length || [...given].reduce((diff, char, index) => diff | (char.charCodeAt(0) ^ expected.charCodeAt(index)), 0) !== 0) return json({ error: 'BAD_SIGNATURE' }, 401)
  const body = await Promise.resolve().then(() => JSON.parse(raw) as CreemEvent).catch(() => null)
  if (!body) return json({ error: 'INVALID_PAYLOAD' }, 400)
  const purchase = creemPurchase(body, [env.CREEM_PRODUCT_ID!, env.CREEM_FIRST_PRODUCT_ID].filter((id): id is string => !!id))
  if (!purchase) return json({ ok: true })
  const amount = purchase.quantity * Math.max(1, Number(env.CREEM_CREDITS_PER_ORDER) || 5)
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fulfill_fungies_payment`, {
    method: 'POST', headers: serviceHeaders(env),
    body: JSON.stringify({ p_event_id: purchase.eventId, p_handle: purchase.handle, p_amount: amount }),
  })
  return response.ok ? json({ ok: true, credited: await response.json().catch(() => false) }) : json({ error: 'CREDIT_FAILED' }, 502)
}

async function lsWebhook(request: Request, env: Env) {
  if (!lemonEnabled(env)) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)
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

// Creem 심사 필수 항목: 프롬프트는 생성 모델에 닿기 전에 Creem 판정을 받아야 한다.
// 응답이 없거나 느리면 생성을 막는다(fail closed) — 판정을 못 받은 프롬프트를 통과시키면 연동한 의미가 없다.
// 사진 업로드에는 텍스트가 없어 이 검사가 걸리지 않는다.
async function creemAllows(prompt: string, env: Env) {
  if (!env.CREEM_API_KEY) return true
  try {
    const response = await fetch(`${creemApi(env)}/v1/moderation/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.CREEM_API_KEY },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) { console.log('moderation-failed', response.status); return false }
    const body = await response.json().catch(() => null) as { decision?: string } | null
    return body?.decision === 'allow'
  } catch { console.log('moderation-error'); return false }
}

// 사진은 Creem의 텍스트 전용 검사로 볼 수 없어서 OpenAI의 무료 이미지 모더레이션을 거친다.
// 키 누락·타임아웃·응답 오류는 모두 차단한다. 검사가 끝나기 전에는 크레딧도 차감하지 않는다.
async function imageAllows(image: string, env: Env) {
  if (!env.OPENAI_API_KEY) { console.log('image-moderation-key-missing'); return false }
  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url: image } }] }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) { console.log('image-moderation-failed', response.status); return false }
    const body = await response.json().catch(() => null) as { results?: Array<{ flagged?: boolean }> } | null
    return body?.results?.[0]?.flagged === false
  } catch { console.log('image-moderation-error'); return false }
}

// ponytail: 단어 목록 한 벌, 우회는 막지 못한다 — 신고가 들어오기 시작하면 분류 모델로 올린다
const BLOCKED_PROMPT = /\b(nude|naked|nsfw|porn|porno|sex|sexual|sexy|erotic|hentai|genital|nipple|penis|vagina|lingerie|fetish|bdsm|gore|corpse|behead|dismember|nazi|swastika)\b|누드|야한|음란|성인용|섹스|시체|참수/i

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
  // 성인·폭력 프롬프트는 크레딧 차감 전에 끊는다 — 생성 모델 자체 필터에만 기대지 않는다
  if (BLOCKED_PROMPT.test(prompt)) return json({ error: 'BLOCKED_PROMPT' }, 400)
  if (prompt && !await creemAllows(prompt, env)) return json({ error: 'BLOCKED_PROMPT' }, 400)
  if (image && !await imageAllows(image, env)) return json({ error: 'BLOCKED_PROMPT' }, 400)
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

// 갈아끼우거나 지운 미디어를 버킷에서도 걷어낸다 — 새로 올리기만 하던 동안 버킷 절반이 고아 파일이었다.
// 권한은 경로 하나로 끝난다: 업로드가 `prefix/<handle>/<name>`으로 새기므로 남의 파일은 경로가 안 맞는다.
// 방 데이터를 뒤지지 않으니 저장 순서와도 무관하다 — schedulePublish는 즉시 저장이라 참조 검사로는 늦는다.
const MEDIA_PREFIXES = new Set(['records', 'clips', 'music', 'art', 'profile', 'floorImage', 'leftWallImage', 'rightWallImage', 'glbobj'])
async function mediaDelete(request: Request, env: Env) {
  if (!env.SUPABASE_SERVICE_KEY) return json({ error: 'SERVICE_KEY_NOT_SET' }, 503)
  const handle = await signedInHandle(request)
  if (!handle) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const query = new URL(request.url).searchParams
  // 소유자 조각이 없던 시절의 GLB는 id만 온다 — 그때는 방 데이터가 아직 그 파일을 참조하는지로 확인한다
  const legacyId = query.get('id')
  const path = query.get('path') ?? (legacyId ? `glbobj/${legacyId}` : '')
  const parts = path.split('/')
  if (!MEDIA_PREFIXES.has(parts[0]) || !parts.every((part) => /^[\w.-]{1,80}$/.test(part))) return json({ error: 'INVALID_REQUEST' }, 400)
  if (parts.length === 3 ? parts[1] !== handle : parts.length !== 2) return json({ error: 'NOT_OWNED' }, 403)
  if (parts.length === 2 && !await roomReferences(handle, path)) return json({ error: 'NOT_OWNED' }, 403)
  const removed = await fetch(`${SUPABASE_URL}/storage/v1/object/media/${path}`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } })
  if (!removed.ok) { console.log('media-delete-failed', removed.status); return json({ error: 'DELETE_FAILED' }, 502) }
  return json({ done: true })
}

const roomReferences = async (handle: string, path: string) => {
  const room = await fetch(`${SUPABASE_URL}/rest/v1/rooms?handle=eq.${encodeURIComponent(handle)}&select=data&limit=1`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } })
  const rows = await room.json().catch(() => null)
  return Array.isArray(rows) && JSON.stringify(rows[0]?.data ?? null).includes(`/media/${path}`)
}

export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname
    if (path === '/api/ls-webhook') return request.method === 'POST' ? lsWebhook(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/creem-webhook') return request.method === 'POST' ? creemWebhook(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/youtube-thumbnail') return request.method === 'GET' ? youtubeThumbnail(request) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/glb-objects') return request.method === 'POST' ? glbSubmit(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/media/file' || path === '/api/glb-objects/file') return request.method === 'DELETE' ? mediaDelete(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/glb-objects/poll') return request.method === 'GET' ? glbPoll(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/custom-objects/credits') return request.method === 'POST' ? credits(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/custom-objects/checkout') return request.method === 'POST' ? creemCheckout(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    return env.ASSETS.fetch(request)
  },
}
