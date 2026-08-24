import { CUSTOM_OBJECT_CATEGORIES, customObjectSchema, isCustomObjectSpec, type CustomObjectCategory } from './customObjectSpec'

type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_MODEL?: string
  SUPABASE_SERVICE_KEY?: string
  LS_WEBHOOK_SECRET?: string
  LS_BUY_URL?: string
  LS_CREDITS_PER_ORDER?: string
}
type GenerateBody = { category?: unknown; prompt?: unknown; image?: unknown }
type ReviewBody = GenerateBody & { spec?: unknown; screenshot?: unknown }

const SUPABASE_URL = 'https://pxjavljsalibpnxdrxel.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJweGphdmxqc2FsaWJwbnhkcnhlbCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzg2ODYwMTU4LCJleHAiOjIxMDI0MzYxNTh9.quIFdlk11b7F-YIeHO3TsEhS2RzgxDtntqdh2vHyUfE'
const INSTRUCTIONS = `Create one cute low-poly miniature room object as a small set of Three.js-friendly primitives. Match the requested category exactly. Use only the allowed primitives and hex colors. Coordinates are local: Y is up; floor objects must rest on Y=0; wall decorations face +Z and stay shallow. Center the object on X/Z for floor objects or X/Y for wall objects. Use the fewest parts that clearly preserve the requested silhouette. Footprint is an integer 10x10 room-grid size. Do not include text, code, explanations, lights, cameras, shadows, or unsupported geometry.

Reconstruction discipline: identify the object and its 2-4 defining features, then build only those. Start with the silhouette, then identifying parts, then a few accents. Choose primitives by real topology. Use roughness .6-.9 for fabric, wood and paper, .1-.3 for glass, metal and gloss, and metalness at most .5. Offset touching faces by at least .01. Nothing may sink below Y=0 or float without support.`
const REVIEW_INSTRUCTIONS = `Compare the render against the reference and request. Check identity, silhouette, proportions, defining features, colors, grounding, z-fighting and stray parts. Pass a clearly recognizable cute low-poly object. Otherwise return one complete corrected spec.`
const reviewSchema = {
  type: 'object', additionalProperties: false, required: ['verdict'],
  properties: { verdict: { type: 'string', enum: ['pass', 'revise'] }, revision: customObjectSchema },
} as const

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
const authorization = (request: Request) => request.headers.get('Authorization')

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

async function spendCredit(request: Request, env: Env) {
  if (!billingEnabled(env)) return true
  const handle = await signedInHandle(request)
  if (!handle) return false
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/spend_credit`, { method: 'POST', headers: serviceHeaders(env), body: JSON.stringify({ p_handle: handle }) })
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

const outputText = (body: unknown) => {
  const response = body as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }
  if (typeof response.output_text === 'string') return response.output_text
  return response.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text
}

async function generate(request: Request, env: Env) {
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) return json({ error: 'API_KEY_NOT_SET' }, 503)
  if (!await signedIn(request)) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as GenerateBody | null
  const category = body?.category as CustomObjectCategory
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const image = typeof body?.image === 'string' ? body.image : undefined
  if (!CUSTOM_OBJECT_CATEGORIES.includes(category) || (!prompt && !image) || prompt.length > 1200) return json({ error: 'INVALID_REQUEST' }, 400)
  if (image && (!image.startsWith('data:image/') || image.length > 7_000_000)) return json({ error: 'INVALID_IMAGE' }, 400)
  if (!await spendCredit(request, env)) return json({ error: 'NO_CREDITS' }, 402)

  const userText = `Category: ${category}\nRequest: ${prompt || 'Reconstruct the object shown in the reference image.'}`
  let parsed: Record<string, unknown>
  if (env.ANTHROPIC_API_KEY) {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: userText }]
    if (image) {
      const [head, data] = image.split(',', 2)
      content.push({ type: 'image', source: { type: 'base64', media_type: head.slice(5).split(';')[0], data } })
    }
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || 'claude-sonnet-5', max_tokens: 4000, system: INSTRUCTIONS,
        messages: [{ role: 'user', content }],
        tools: [{ name: 'custom_object', description: 'Emit the finished room object spec.', input_schema: customObjectSchema }],
        tool_choice: { type: 'tool', name: 'custom_object' },
      }),
    })
    const result = await upstream.json().catch(() => null) as { content?: Array<{ type?: string; input?: unknown }> } | null
    if (!upstream.ok) return json({ error: 'GENERATION_FAILED' }, 502)
    const input = result?.content?.find((item) => item.type === 'tool_use')?.input
    if (!input || typeof input !== 'object') return json({ error: 'EMPTY_GENERATION' }, 502)
    parsed = input as Record<string, unknown>
  } else {
    const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: userText }]
    if (image) content.push({ type: 'input_image', image_url: image, detail: 'high' })
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-5-mini', instructions: INSTRUCTIONS, input: [{ role: 'user', content }], text: { format: { type: 'json_schema', name: 'custom_object', strict: true, schema: customObjectSchema } } }),
    })
    const result = await upstream.json().catch(() => null)
    if (!upstream.ok) return json({ error: 'GENERATION_FAILED' }, 502)
    const text = outputText(result)
    if (!text) return json({ error: 'EMPTY_GENERATION' }, 502)
    try { parsed = JSON.parse(text) as Record<string, unknown> } catch { return json({ error: 'INVALID_GENERATION' }, 502) }
  }
  const object = { ...parsed, id: crypto.randomUUID(), category }
  return isCustomObjectSpec(object) ? json({ object }) : json({ error: 'INVALID_GENERATION' }, 502)
}

async function concept(request: Request, env: Env) {
  if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY_NOT_SET' }, 503)
  if (!await signedIn(request)) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as GenerateBody | null
  const category = body?.category as CustomObjectCategory
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  if (!CUSTOM_OBJECT_CATEGORIES.includes(category) || !prompt || prompt.length > 1200) return json({ error: 'INVALID_REQUEST' }, 400)
  const upstream = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', size: '1024x1024', quality: 'low', n: 1, prompt: `Cute low-poly 3D render of a single ${category} object for a miniature isometric room: ${prompt}. Plain light background, no text, no people.` }),
  })
  const result = await upstream.json().catch(() => null) as { data?: Array<{ b64_json?: string }> } | null
  const image = result?.data?.[0]?.b64_json
  return upstream.ok && image ? json({ image: `data:image/png;base64,${image}` }) : json({ error: 'CONCEPT_FAILED' }, 502)
}

async function review(request: Request, env: Env) {
  if (!await signedIn(request)) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as ReviewBody | null
  const category = body?.category as CustomObjectCategory
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const reference = typeof body?.image === 'string' ? body.image : undefined
  const screenshot = typeof body?.screenshot === 'string' ? body.screenshot : undefined
  if (!CUSTOM_OBJECT_CATEGORIES.includes(category) || !screenshot || !isCustomObjectSpec(body?.spec)) return json({ error: 'INVALID_REQUEST' }, 400)
  if (!env.ANTHROPIC_API_KEY) return json({ verdict: 'pass' })
  const toImage = (dataUrl: string) => { const [head, data] = dataUrl.split(',', 2); return { type: 'image', source: { type: 'base64', media_type: head.slice(5).split(';')[0], data } } }
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: `Request: ${prompt || '(reference only)'}\nCategory: ${category}\nCurrent spec:\n${JSON.stringify(body.spec)}\nFirst image is the reference; last image is the render.` }]
  if (reference) content.push(toImage(reference))
  content.push(toImage(screenshot))
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-5', max_tokens: 4000, system: `${INSTRUCTIONS}\n\n${REVIEW_INSTRUCTIONS}`,
      messages: [{ role: 'user', content }],
      tools: [{ name: 'custom_object_review', description: 'Emit one verification verdict.', input_schema: reviewSchema }],
      tool_choice: { type: 'tool', name: 'custom_object_review' },
    }),
  })
  const result = await upstream.json().catch(() => null) as { content?: Array<{ type?: string; input?: unknown }> } | null
  if (!upstream.ok) return json({ error: 'REVIEW_FAILED' }, 502)
  const input = result?.content?.find((item) => item.type === 'tool_use')?.input as { verdict?: string; revision?: Record<string, unknown> } | undefined
  if (input?.verdict === 'revise' && input.revision) {
    const revised = { ...input.revision, id: body.spec.id, category }
    if (isCustomObjectSpec(revised)) return json({ verdict: 'revise', object: revised })
  }
  return json({ verdict: 'pass' })
}

export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname
    if (path === '/api/ls-webhook') return request.method === 'POST' ? lsWebhook(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path.startsWith('/api/custom-objects')) {
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
      if (path === '/api/custom-objects') return generate(request, env)
      if (path === '/api/custom-objects/credits') return credits(request, env)
      if (path === '/api/custom-objects/concept') return concept(request, env)
      if (path === '/api/custom-objects/review') return review(request, env)
      return json({ error: 'NOT_FOUND' }, 404)
    }
    return env.ASSETS.fetch(request)
  },
}
