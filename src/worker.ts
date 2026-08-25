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
  FAL_KEY?: string
}
type GenerateBody = { category?: unknown; prompt?: unknown; image?: unknown; imageBack?: unknown; spec?: unknown; feedback?: unknown; size?: unknown }
type ReviewBody = GenerateBody & { screenshot?: unknown; screenshots?: unknown }

const SUPABASE_URL = 'https://pxjavljsalibpnxdrxel.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4amF2bGpzYWxpYnBueGRyeGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjAxNTgsImV4cCI6MjEwMjQzNjE1OH0.quIFdlk11b7F-YIeHO3TsEhS2RzgxDtntqdh2vHyUfE'
const INSTRUCTIONS = `Create one cute low-poly miniature room object as a set of Three.js-friendly primitives. Match the requested category exactly. Use only the allowed primitives and hex colors. Coordinates are local: Y is up; floor objects must rest on Y=0; wall decorations face +Z and stay shallow. Center the object on X/Z for floor objects or X/Y for wall objects. Footprint is an integer 10x10 room-grid size. Do not include text, code, explanations, lights, cameras, shadows, or unsupported geometry.

Reconstruction discipline (distilled img2threejs): First list the object's 2-4 identity-defining features mentally and make sure each one exists as geometry. Choose every part's primitive from its real topology: slabs/panels/frames = box, shafts/legs/rims/rolls = cylinder, organic blobs/cushions = sphere (scale into ellipsoids), rings/handles = torus, tapers/spouts = cone, soft pill shapes = capsule, straight slopes/slanted braces = wedge (right-triangular prism: flat bottom, vertical back at -X, straight slope down toward +X), smooth concave slopes like slides and skate ramps = ramp (same orientation as wedge but the slope is a soft inward curve; size = [run X, height Y, width Z]), cups/pots/planters/lampshades/tapered legs = frustum (tapered cylinder, wide base down), domes/lids/round caps = hemisphere (flat side down; size[1] is the full dome height), arches/rounded roofs/round-top panels/tunnels = halfCylinder (flat bottom, curved top, length along X), curved tube corners and frames = elbow (a quarter-bend tube lying in the local XY plane). For wedge/ramp/halfCylinder rotate around Y to aim them. When no fixed block can match a silhouette, DRAW it: extrudeProfile takes 'profile' - 3 to 16 [x,y] outline points inside the unit square (-0.5..0.5), listed counter-clockwise, extruded along Z (use for curvy side panels, brackets, cloud/animal outlines); latheProfile takes 'profile' as the half cross-section from bottom to top with x = radius (0..0.5) and y = height (-0.5..0.5), revolved around Y (use for vases, bottles, bowls, shades, curvy legs). Both scale by size like every other part. Proportion parts against each other like the real object - measure relative sizes off the reference before writing numbers. Connected sloped parts must share exact endpoints so nothing floats or gaps. Repeat identical parts with consistent spacing (legs, rungs, slats). Materials: flat pastel-friendly hex colors; roughness .6-.9 for fabric/wood/paper/plastic, .1-.3 for glass/metal/gloss; metalness at most .5 (there is no environment map - higher goes black). Never leave two faces coplanar - offset touching or stacked parts by at least .01 so surfaces cannot flicker. Nothing may sink below Y=0 or float without support.`

const BLOCKOUT_INSTRUCTIONS = `This is PASS 1 of 2: the blockout. Build ONLY the macro silhouette and the identity-defining components as simple volumes - 4 to 12 parts, each with a unique id. No small accents, no rivets, no trim. Get proportions, stance and grounding right; details come in the next pass.`

const DETAIL_INSTRUCTIONS = `This is PASS 2 of 2: the detail pass. You are given the blockout spec. Keep its overall silhouette, proportions and part placement, then refine it: split crude volumes into properly shaped parts where topology demands, add the small identity accents visible in the reference (knobs, trim, feet, seams, hardware), and tune colors/roughness per material. Output the FULL final spec (not a diff). HARD BUDGET: at most 28 parts total - before emitting, count your parts and if over budget merge or drop the least important accents rather than exceeding it. Every part id must be unique. Never break grounding or introduce coplanar faces.`
const REVIEW_INSTRUCTIONS = `You are a judge, not a repairer. 1) List the reference's identity-defining features in featureChecks and judge each against the renders. 2) List every local defect in defects: a detached or leaning-away part, a part that should dock into another but does not, a missing feature (bars, rails, handles), wrong relative proportion. 3) Verdict pass only when every feature reads correctly and defects is empty and no deterministic violation is listed in the message; otherwise fail. Cute low-poly simplification is fine; broken structure is not.`
const reviewSchema = {
  type: 'object', additionalProperties: false, required: ['verdict', 'featureChecks', 'defects'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    featureChecks: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'One line per identity-defining feature of the reference: "<feature>: ok" or "<feature>: <what is wrong>"' },
    defects: { type: 'array', maxItems: 12, items: { type: 'string' }, description: 'Every local defect seen in the renders (floating, detached, missing, misplaced, wrong proportion). Empty only if flawless.' },
  },
} as const

// 스펙은 숫자라 결함 상당수를 수학으로 잡을 수 있다: 바닥 뚫림, 공중부양, 본체에서 분리된 부품 덩어리.
// 회전 부품은 감싸는 반지름으로 보수적으로 계산한다 — 오탐(멀쩡한데 지적)보다 놓침이 낫다.
function validateSpecGeometry(spec: { category: string; parts: Array<{ id: string; primitive: string; position: [number, number, number]; rotation: [number, number, number]; size: [number, number, number] }> }): string[] {
  const issues: string[] = []
  const wall = spec.category === 'wallDecoration'
  const boxes = spec.parts.map((part) => {
    const rotated = part.rotation.some((angle) => Math.abs(angle) > 1e-3)
    const half = rotated
      ? (() => { const r = Math.hypot(part.size[0], part.size[1], part.size[2]) / 2; return [r, r, r] as const })()
      : [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2] as const
    const tightHalfY = rotated ? Math.min(...part.size) / 2 : part.size[1] / 2
    return { id: part.id, min: part.position.map((value, axis) => value - half[axis]) as number[], max: part.position.map((value, axis) => value + half[axis]) as number[], bottomTight: part.position[1] - tightHalfY }
  })
  if (!wall) for (const box of boxes) if (box.bottomTight < -0.03) issues.push(`part "${box.id}" sinks below the floor (bottom y=${box.bottomTight.toFixed(2)})`)
  const touches = (a: typeof boxes[number], b: typeof boxes[number]) => [0, 1, 2].every((axis) => a.min[axis] <= b.max[axis] + 0.03 && b.min[axis] <= a.max[axis] + 0.03)
  // 연결 그래프: 바닥에 닿은 부품(또는 벽장식의 모든 부품)을 뿌리로 삼아 닿음으로 전파한다
  const grounded = boxes.map((box) => wall || box.min[1] <= 0.05)
  let changed = true
  while (changed) {
    changed = false
    for (let a = 0; a < boxes.length; a += 1) {
      if (grounded[a]) continue
      for (let b = 0; b < boxes.length; b += 1) {
        if (a !== b && grounded[b] && touches(boxes[a], boxes[b])) { grounded[a] = true; changed = true; break }
      }
    }
  }
  boxes.forEach((box, index) => { if (!grounded[index]) issues.push(`part "${box.id}" floats: it touches nothing that reaches the ground`) })
  return issues
}

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

async function generate(request: Request, env: Env, detail = false) {
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) return json({ error: 'API_KEY_NOT_SET' }, 503)
  if (!await signedIn(request)) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as GenerateBody | null
  const category = body?.category as CustomObjectCategory
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const image = typeof body?.image === 'string' ? body.image : undefined
  const imageBack = typeof body?.imageBack === 'string' ? body.imageBack : undefined
  if (!CUSTOM_OBJECT_CATEGORIES.includes(category) || (!prompt && !image) || prompt.length > 1200) return json({ error: 'INVALID_REQUEST' }, 400)
  for (const ref of [image, imageBack]) if (ref && (!ref.startsWith('data:image/') || ref.length > 7_000_000)) return json({ error: 'INVALID_IMAGE' }, 400)
  // 디테일 패스는 같은 생성 회차의 후반부라 크레딧을 다시 쓰지 않는다
  const blockout = body?.spec !== undefined && isCustomObjectSpec(body.spec) ? body.spec : null
  if (detail && !blockout) return json({ error: 'INVALID_REQUEST' }, 400)
  if (!detail && !await spendCredit(request, env)) return json({ error: 'NO_CREDITS' }, 402)

  const system = `${INSTRUCTIONS}\n\n${detail ? DETAIL_INSTRUCTIONS : BLOCKOUT_INSTRUCTIONS}`
  const feedback = typeof body?.feedback === 'string' ? body.feedback.slice(0, 2000) : ''
  const cell = (value: unknown) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 12 ? Number(value) : null
  const rawSize = body?.size as { width?: unknown; depth?: unknown; height?: unknown } | undefined
  const size = rawSize && cell(rawSize.width) && cell(rawSize.depth)
    ? { width: cell(rawSize.width)!, depth: cell(rawSize.depth)!, height: rawSize.height === undefined ? null : cell(rawSize.height) }
    : null
  const sizeText = size ? `\nTarget bounding box: ${size.width} x ${size.depth}${size.height ? ` x ${size.height} (width x depth x height)` : ' (width x depth)'} in grid units (1 unit = 1 cell). The object must FILL this box - overall width about ${size.width} units, depth about ${size.depth} units${size.height ? `, height about ${size.height} units` : ''}. Set footprint to exactly ${size.width} x ${size.depth}.` : ''
  const userText = `Category: ${category}\nRequest: ${prompt || 'Reconstruct the object shown in the reference image.'}${sizeText}${blockout ? `\nBlockout spec:\n${JSON.stringify(blockout)}` : ''}${feedback ? `\nA previous detail attempt FAILED review for these exact reasons - build a fresh detail pass that cannot repeat any of them:\n${feedback}` : ''}`
  let parsed: Record<string, unknown>
  if (env.ANTHROPIC_API_KEY) {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: `${userText}${imageBack ? '\nTwo reference views are attached: first the front, then the back of the same object.' : ''}` }]
    for (const ref of [image, imageBack]) if (ref) {
      const [head, data] = ref.split(',', 2)
      content.push({ type: 'image', source: { type: 'base64', media_type: head.slice(5).split(';')[0], data } })
    }
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || 'claude-sonnet-5', max_tokens: 5000, system,
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
      body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-5-mini', instructions: system, input: [{ role: 'user', content }], text: { format: { type: 'json_schema', name: 'custom_object', strict: true, schema: customObjectSchema } } }),
    })
    const result = await upstream.json().catch(() => null)
    if (!upstream.ok) return json({ error: 'GENERATION_FAILED' }, 502)
    const text = outputText(result)
    if (!text) return json({ error: 'EMPTY_GENERATION' }, 502)
    try { parsed = JSON.parse(text) as Record<string, unknown> } catch { return json({ error: 'INVALID_GENERATION' }, 502) }
  }
  const object = { ...parsed, id: blockout ? blockout.id : crypto.randomUUID(), category, ...(size ? { footprint: { width: Math.min(10, size.width), depth: Math.min(10, size.depth) } } : {}) }
  return isCustomObjectSpec(object) ? json({ object }) : json({ error: 'INVALID_GENERATION' }, 502)
}

async function concept(request: Request, env: Env) {
  if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY_NOT_SET' }, 503)
  if (!await signedIn(request)) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as GenerateBody | null
  const category = body?.category as CustomObjectCategory
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  if (!CUSTOM_OBJECT_CATEGORIES.includes(category) || !prompt || prompt.length > 1200) return json({ error: 'INVALID_REQUEST' }, 400)
  // 정면·후면 두 각도를 만들어 참조로 쓴다 — 한 장이면 안 보이는 면을 추측으로 지어낸다
  const view = async (angle: string) => {
    const upstream = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', size: '1024x1024', quality: 'medium', n: 1, prompt: `Cute low-poly 3D render of a single ${category} object for a miniature isometric room, ${angle}: ${prompt}. Plain light background, no text, no people. Same object design in every view.` }),
    })
    const result = await upstream.json().catch(() => null) as { data?: Array<{ b64_json?: string }> } | null
    const image = result?.data?.[0]?.b64_json
    return upstream.ok && image ? `data:image/png;base64,${image}` : null
  }
  const front = await view('three-quarter front view')
  if (!front) return json({ error: 'CONCEPT_FAILED' }, 502)
  const back = await view('three-quarter rear view showing the back side')
  return json({ image: front, back })
}

async function review(request: Request, env: Env) {
  if (!await signedIn(request)) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as ReviewBody | null
  const category = body?.category as CustomObjectCategory
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const reference = typeof body?.image === 'string' ? body.image : undefined
  const referenceBack = typeof body?.imageBack === 'string' ? body.imageBack : undefined
  const single = typeof body?.screenshot === 'string' ? [body.screenshot] : []
  const screenshots = (Array.isArray(body?.screenshots) ? body.screenshots.filter((value): value is string => typeof value === 'string') : single).slice(0, 3)
  if (!CUSTOM_OBJECT_CATEGORIES.includes(category) || !screenshots.length || !isCustomObjectSpec(body?.spec)) return json({ error: 'INVALID_REQUEST' }, 400)
  for (const shot of screenshots) if (!shot.startsWith('data:image/') || shot.length > 7_000_000) return json({ error: 'INVALID_IMAGE' }, 400)
  if (!env.ANTHROPIC_API_KEY) return json({ verdict: 'pass' })
  const toImage = (dataUrl: string) => { const [head, data] = dataUrl.split(',', 2); return { type: 'image', source: { type: 'base64', media_type: head.slice(5).split(';')[0], data } } }
  const violations = validateSpecGeometry(body.spec)
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: `Request: ${prompt || '(reference only)'}\nCategory: ${category}\nCurrent spec:\n${JSON.stringify(body.spec)}\n${violations.length ? `Deterministic geometry check found these violations (facts, all must be fixed):\n- ${violations.join('\n- ')}\n` : ''}${reference ? (referenceBack ? 'First two images are the reference (front, back); the' : 'First image is the reference; the') : 'The'} remaining ${screenshots.length} images are renders of the current spec from different angles (front-iso, side, top). A shape that only reads from one angle fails.` }]
  if (reference) content.push(toImage(reference))
  if (referenceBack) content.push(toImage(referenceBack))
  for (const shot of screenshots) content.push(toImage(shot))
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
  const checks = input as { verdict?: string; featureChecks?: string[]; defects?: string[] } | undefined
  const defects = Array.isArray(checks?.defects) ? checks.defects.filter((value): value is string => typeof value === 'string') : []
  console.log('custom-review', checks?.verdict, 'violations', violations.length, 'defects', defects.length)
  const pass = checks?.verdict === 'pass' && violations.length === 0
  return json({ verdict: pass ? 'pass' : 'fail', defects, violations })
}

// GLB 생성: fal.ai 큐에 이미지 한 장을 넣고, 클라이언트가 완료를 폴링한다. 크레딧은 제출 시 1회.
const FAL_MODEL = 'fal-ai/hunyuan3d/v2'
// fal 큐의 상태·결과 조회는 하위 경로가 아니라 앱 루트 경로로 받는다 (hunyuan3d/v2 → hunyuan3d)
const FAL_QUEUE_APP = 'fal-ai/hunyuan3d'

async function glbSubmit(request: Request, env: Env) {
  if (!env.FAL_KEY) return json({ error: 'FAL_KEY_NOT_SET' }, 503)
  if (!await signedIn(request)) return json({ error: 'LOGIN_REQUIRED' }, 401)
  if (!await spendCredit(request, env)) return json({ error: 'NO_CREDITS' }, 402)
  const body = await request.json().catch(() => null) as { image?: unknown } | null
  const image = typeof body?.image === 'string' ? body.image : ''
  if (!image.startsWith('data:image/') || image.length > 7_000_000) return json({ error: 'INVALID_IMAGE' }, 400)
  const upstream = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
    method: 'POST', headers: { Authorization: `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_image_url: image, textured_mesh: true }),
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
  const payload = await result.json().catch(() => null) as { model_mesh?: { url?: string } } | null
  const url = payload?.model_mesh?.url
  if (!result.ok || typeof url !== 'string') return json({ error: 'GLB_RESULT_FAILED' }, 502)
  return json({ done: true, url })
}

export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname
    if (path === '/api/ls-webhook') return request.method === 'POST' ? lsWebhook(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/youtube-thumbnail') return request.method === 'GET' ? youtubeThumbnail(request) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/glb-objects') return request.method === 'POST' ? glbSubmit(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path === '/api/glb-objects/poll') return request.method === 'GET' ? glbPoll(request, env) : json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (path.startsWith('/api/custom-objects')) {
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
      if (path === '/api/custom-objects') return generate(request, env)
      if (path === '/api/custom-objects/detail') return generate(request, env, true)
      if (path === '/api/custom-objects/credits') return credits(request, env)
      if (path === '/api/custom-objects/concept') return concept(request, env)
      if (path === '/api/custom-objects/review') return review(request, env)
      return json({ error: 'NOT_FOUND' }, 404)
    }
    return env.ASSETS.fetch(request)
  },
}
