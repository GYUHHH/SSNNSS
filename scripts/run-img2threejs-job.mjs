import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const origin = process.env.APP_ORIGIN
const jobId = process.env.JOB_ID
const runnerSecret = process.env.IMG2THREEJS_RUNNER_SECRET
const skillRoot = process.env.IMG2THREEJS_ROOT
if (!origin || !jobId || !runnerSecret || !skillRoot || !process.env.ANTHROPIC_API_KEY) throw new Error('PIPELINE_SECRET_NOT_SET')
const headers = { Authorization: `Bearer ${runnerSecret}`, 'Content-Type': 'application/json' }
const post = async (path, body) => {
  const response = await fetch(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const value = await response.json().catch(() => null)
  if (!response.ok) throw new Error(value?.error || `HTTP_${response.status}`)
  return value
}

const work = resolve('.img2threejs-runs', jobId)
await mkdir(work, { recursive: true })
let finished = false
try {
  const job = await post('/api/custom-objects/jobs/claim', { jobId })
  const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' })[job.referenceMime] || extname(job.referencePath) || '.png'
  const reference = resolve(work, `reference${extension}`)
  const imageResponse = await fetch(`${origin}/api/custom-objects/jobs/reference`, { method: 'POST', headers, body: JSON.stringify({ jobId }) })
  if (!imageResponse.ok) throw new Error('REFERENCE_DOWNLOAD_FAILED')
  await writeFile(reference, Buffer.from(await imageResponse.arrayBuffer()))

  await post('/api/custom-objects/jobs/progress', { jobId, stage: 'intake' })
  const stateDir = resolve(work, '.img2threejs')
  await mkdir(stateDir, { recursive: true })
  const state = resolve(stateDir, 'state.json')
  const spec = resolve(work, 'object-sculpt-spec.json')
  execFileSync('python3', [resolve(skillRoot, 'forge/state.py'), 'init', '--state', state, '--reference', reference, '--profile', 'generic'], { stdio: 'inherit' })
  execFileSync('python3', [resolve(skillRoot, 'forge/next.py'), '--state', state], { stdio: 'inherit' })

  const result = resolve(work, 'result.json')
  const prompt = `/img2threejs

Use the installed skill and its executable Python forge at ${skillRoot}. This is a production image-to-Three.js reconstruction job, not a prompt imitation.

Reference image: ${reference}
User request: ${job.prompt || 'Reconstruct the referenced object.'}
Required app category: ${job.category}
Pipeline state: ${state}
Sculpt spec: ${spec}
Final safe declarative export: ${result}

Mandatory procedure:
1. Read the reference image. Run forge/next.py against the state before every stage and correction. Run probe_image.py, write image-analysis.md, create the pre-spec assessment with its qualityContract, create and validate object-sculpt-spec.json, and record each state gate with evidence.
2. Build blockout → structure → form → material → lighting → interaction → optimization in order. Run the real img2threejs scripts for spec validation, pass orchestration, factory generation, integrity gates, review history, and correction-loop accounting. Do not skip a mandatory gate silently.
3. Export the browser-safe object to result.json. It must be one JSON object with name, category, footprint {width,depth}, and 3-96 parts. Each part must contain id, primitive (box|roundedBox|cylinder|sphere|capsule|torus|cone), position [x,y,z], rotation [x,y,z], size [x,y,z], color #RRGGBB, roughness 0..1, metalness 0..1. Category must be exactly ${job.category}. Floor objects rest on Y=0; wall decorations face +Z. No code strings or external assets.
4. Run: node ${resolve('scripts/validate-custom-object-result.mjs')} ${result} ${job.category}
5. Run: node ${resolve('scripts/render-custom-object.mjs')} ${result} ${resolve(work, 'renders')}
6. Read the front, quarterLeft, and quarterRight render PNGs and compare them to the reference under the qualityContract. Correct one failure group at a time, rerender, and use the img2threejs correction loop. Maximum three corrections; stop rather than claiming success if an identity-defining feature still fails.
7. Only finish when the final validator passes, all required render evidence exists, and the final reviewHistory action is continue. Keep assessment, spec, factory, renders, and review history in ${work} for auditability.

Do the work in the files and tools. Do not merely describe the pipeline.`

  await post('/api/custom-objects/jobs/progress', { jobId, stage: 'sculpting' })
  try {
    execFileSync('claude', [
      '--print', '--bare', '--model', 'opus', '--effort', 'high', '--max-budget-usd', '10',
      '--dangerously-skip-permissions', '--add-dir', skillRoot,
    ], { cwd: resolve('.'), input: prompt, stdio: ['pipe', 'pipe', 'pipe'], timeout: 50 * 60 * 1000, env: { ...process.env, HOME: process.env.HOME } })
  } catch (error) {
    const detail = [error?.stderr, error?.stdout].map((value) => value?.toString().trim()).find(Boolean)
    if (detail) console.error(detail)
    throw new Error((detail || error?.message || 'CLAUDE_PIPELINE_FAILED').slice(-500))
  }

  await post('/api/custom-objects/jobs/progress', { jobId, stage: 'final-review' })
  try {
    execFileSync('python3', [resolve(skillRoot, 'forge/stage2_spec/validate_sculpt_spec.py'), spec], { encoding: 'utf8' })
  } catch (error) {
    const detail = [error?.stderr, error?.stdout].map((value) => value?.toString().trim()).find(Boolean)
    if (detail) console.error(detail)
    throw new Error((detail || error?.message || 'SCULPT_SPEC_INVALID').slice(-500))
  }
  execFileSync('python3', [resolve(skillRoot, 'forge/next.py'), '--state', state, spec], { stdio: 'inherit' })
  const stateStatus = JSON.parse(execFileSync('python3', [resolve(skillRoot, 'forge/state.py'), 'status', '--state', state, '--json'], { encoding: 'utf8' }))
  if (stateStatus.status !== 'complete') throw new Error(`IMG2THREEJS_INCOMPLETE:${stateStatus.currentStep || 'unknown'}`)
  const validated = execFileSync('node', [resolve('scripts/validate-custom-object-result.mjs'), result, job.category], { encoding: 'utf8' })
  const output = JSON.parse(validated)
  output.id = crypto.randomUUID()
  await post('/api/custom-objects/jobs/complete', { jobId, object: output })
  finished = true
} catch (error) {
  const message = error instanceof Error ? error.message.slice(0, 500) : 'PIPELINE_FAILED'
  await post('/api/custom-objects/jobs/fail', { jobId, error: message }).catch(() => undefined)
  throw error
} finally {
  if (!finished) process.exitCode = 1
}
