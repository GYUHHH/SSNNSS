import { spawn, spawnSync } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

const [modelArg, outArg] = process.argv.slice(2)
if (!modelArg || !outArg) throw new Error('usage: node scripts/render-custom-object.mjs <model.json> <out-dir>')
const model = resolve(modelArg)
const out = resolve(outArg)
await mkdir(out, { recursive: true })
const modelKey = basename(dirname(model))
const publicModel = resolve('public', 'img2threejs-preview', modelKey, 'model.json')
await mkdir(dirname(publicModel), { recursive: true })
await copyFile(model, publicModel)

const port = 4179
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--host', '127.0.0.1', '--port', String(port)], { stdio: 'ignore' })
const stop = () => { if (!server.killed) server.kill('SIGTERM') }
process.on('exit', stop)
await new Promise((resolveWait) => setTimeout(resolveWait, 1800))

const chrome = ['google-chrome', 'chromium', 'chromium-browser'].find((binary) => spawnSync('which', [binary]).status === 0)
if (!chrome) { stop(); throw new Error('CHROME_NOT_FOUND') }
const urlPath = `/img2threejs-preview/${modelKey}/model.json`
for (const view of ['front', 'quarterLeft', 'quarterRight']) {
  const target = resolve(out, `${view}.png`)
  const result = spawnSync(chrome, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--use-gl=angle', '--use-angle=swiftshader',
    '--window-size=512,512', `--screenshot=${target}`, '--virtual-time-budget=2500',
    `http://127.0.0.1:${port}/scripts/custom-object-render.html?model=${encodeURIComponent(urlPath)}&view=${view}`,
  ], { stdio: 'inherit' })
  if (result.status !== 0) { stop(); throw new Error(`RENDER_FAILED_${view}`) }
}
stop()
