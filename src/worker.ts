import { CUSTOM_OBJECT_CATEGORIES, customObjectSchema, isCustomObjectSpec, type CustomObjectCategory } from './customObjectSpec'

type Env = { ASSETS: { fetch: (request: Request) => Promise<Response> }; OPENAI_API_KEY?: string; OPENAI_MODEL?: string; ANTHROPIC_API_KEY?: string; ANTHROPIC_MODEL?: string }
type GenerateBody = { category?: unknown; prompt?: unknown; image?: unknown }
type ReviewBody = GenerateBody & { spec?: unknown; screenshot?: unknown }

// 검수 판정 도구 스키마: 합격이면 verdict만, 불합격이면 수정 스펙 전체를 함께 낸다
const reviewSchema = {
  type: 'object', additionalProperties: false, required: ['verdict'],
  properties: { verdict: { type: 'string', enum: ['pass', 'revise'] }, revision: customObjectSchema },
} as const

const REVIEW_INSTRUCTIONS = `You are the render-verification pass of an img2threejs loop. Compare the RENDER screenshot of a primitive-built room object against the REFERENCE image and the user's request. Judge only what matters for identity: silhouette and proportions, presence and placement of the 2-4 identity-defining features, part-to-part scale, colors/materials, grounding (nothing sinking below the floor or floating), and obvious z-fighting or stray parts. The style is intentionally cute low-poly - do not fail for simplification. Verdict 'pass' when the object clearly reads as the requested thing with no glaring defect. Verdict 'revise' otherwise, and then output the FULL corrected spec as 'revision' (all parts, not a diff), keeping what already works and fixing only what you called out.`

const SUPABASE_URL = 'https://pxjavljsalibpnxdrxel.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4amF2bGpzYWxpYnBueGRyeGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjAxNTgsImV4cCI6MjEwMjQzNjE1OH0.quIFdlk11b7F-YIeHO3TsEhS2RzgxDtntqdh2vHyUfE'
const INSTRUCTIONS = `Create one cute low-poly miniature room object as a small set of Three.js-friendly primitives. Match the requested category exactly. Use only the allowed primitives and hex colors. Coordinates are local: Y is up; floor objects must rest on Y=0; wall decorations face +Z and stay shallow. Center the object on X/Z for floor objects or X/Y for wall objects. Use the fewest parts that clearly preserve the requested silhouette. Footprint is an integer 10x10 room-grid size. Do not include text, code, explanations, lights, cameras, shadows, or unsupported geometry.

Reconstruction discipline (img2threejs): First identify the object and list its 2-4 identity-defining features (the parts without which it stops reading as itself), then build ONLY those: macro silhouette first, then the identifying components, then at most a few accent details. Pick each part's primitive from its real topology (box for slabs/panels, cylinder for shafts/rims, sphere/ellipsoid for organic blobs, cone for tapers, torus for rings) instead of defaulting to boxes. Materials: pastel-friendly flat colors; roughness .6-.9 for fabric/wood/paper, .1-.3 for glass/metal/gloss; metalness at most .5. Never leave two faces coplanar - offset stacked or touching parts by at least 0.01 so surfaces cannot flicker. Nothing may sink below Y=0 or float without support. Scale parts to each other like the real object's proportions.`

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })

const signedIn = async (request: Request) => {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || authorization === `Bearer ${SUPABASE_ANON_KEY}`) return false
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization } })
  return response.ok
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

  const userText = `Category: ${category}\nRequest: ${prompt || 'Reconstruct the object shown in the reference image.'}`
  let parsed: Record<string, unknown>
  if (env.ANTHROPIC_API_KEY) {
    // Claude: 스키마를 도구 입력으로 강제해 구조화 출력을 받는다 (코드 실행 없음, 스펙만)
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: userText }]
    if (image) {
      const [head, data] = image.split(',', 2)
      const mediaType = head.slice('data:'.length).split(';')[0]
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })
    }
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || 'claude-sonnet-5',
        max_tokens: 4000,
        system: INSTRUCTIONS,
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
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || 'gpt-5-mini',
        instructions: INSTRUCTIONS,
        input: [{ role: 'user', content }],
        text: { format: { type: 'json_schema', name: 'custom_object', strict: true, schema: customObjectSchema } },
      }),
    })
    const result = await upstream.json().catch(() => null)
    if (!upstream.ok) return json({ error: 'GENERATION_FAILED' }, 502)
    const text = outputText(result)
    if (!text) return json({ error: 'EMPTY_GENERATION' }, 502)
    try { parsed = JSON.parse(text) as Record<string, unknown> } catch { return json({ error: 'INVALID_GENERATION' }, 502) }
  }
  const object = { ...parsed, id: crypto.randomUUID(), category }
  if (!isCustomObjectSpec(object)) return json({ error: 'INVALID_GENERATION' }, 502)
  return json({ object })
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

async function review(request: Request, env: Env) {
  if (!await signedIn(request)) return json({ error: 'LOGIN_REQUIRED' }, 401)
  const body = await request.json().catch(() => null) as ReviewBody | null
  const category = body?.category as CustomObjectCategory
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const reference = typeof body?.image === 'string' ? body.image : undefined
  const screenshot = typeof body?.screenshot === 'string' ? body.screenshot : undefined
  const spec = body?.spec
  if (!CUSTOM_OBJECT_CATEGORIES.includes(category) || !screenshot || !isCustomObjectSpec(spec)) return json({ error: 'INVALID_REQUEST' }, 400)
  for (const img of [reference, screenshot]) if (img && (!img.startsWith('data:image/') || img.length > 7_000_000)) return json({ error: 'INVALID_IMAGE' }, 400)
  // Claude 키가 없으면 검수 없이 통과 — 루프가 단발 생성으로 자연 강등된다
  if (!env.ANTHROPIC_API_KEY) return json({ verdict: 'pass' })
  const toImage = (dataUrl: string) => { const [head, data] = dataUrl.split(',', 2); return { type: 'image', source: { type: 'base64', media_type: head.slice('data:'.length).split(';')[0], data } } }
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: `Request: ${prompt || '(reference image only)'}\nCategory: ${category}\nCurrent spec JSON:\n${JSON.stringify(spec)}\n\nFirst image = REFERENCE, second image = RENDER of the current spec.` }]
  if (reference) content.push(toImage(reference))
  content.push(toImage(screenshot))
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 5000,
      system: INSTRUCTIONS + '\n\n' + REVIEW_INSTRUCTIONS,
      messages: [{ role: 'user', content }],
      tools: [{ name: 'custom_object_review', description: 'Emit the verification verdict, with a full corrected spec when revising.', input_schema: reviewSchema }],
      tool_choice: { type: 'tool', name: 'custom_object_review' },
    }),
  })
  const result = await upstream.json().catch(() => null) as { content?: Array<{ type?: string; input?: unknown }> } | null
  if (!upstream.ok) return json({ error: 'REVIEW_FAILED' }, 502)
  const input = result?.content?.find((item) => item.type === 'tool_use')?.input as { verdict?: string; revision?: Record<string, unknown> } | undefined
  if (input?.verdict !== 'pass' && input?.verdict !== 'revise') return json({ error: 'EMPTY_REVIEW' }, 502)
  if (input.verdict === 'revise' && input.revision) {
    const revised = { ...input.revision, id: (spec as { id: string }).id, category }
    if (isCustomObjectSpec(revised)) return json({ verdict: 'revise', object: revised })
  }
  return json({ verdict: 'pass' })
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/custom-objects')) {
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
      if (url.pathname === '/api/custom-objects') return generate(request, env)
      if (url.pathname === '/api/custom-objects/concept') return concept(request, env)
      if (url.pathname === '/api/custom-objects/review') return review(request, env)
      return json({ error: 'NOT_FOUND' }, 404)
    }
    return env.ASSETS.fetch(request)
  },
}
