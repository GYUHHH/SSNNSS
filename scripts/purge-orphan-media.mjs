// 버킷에서 어느 방도 참조하지 않는 파일을 지운다. 미디어 교체·삭제가 옛 파일을 남기던 시절의 잔해용 —
// 그 경로는 BUILD 705에서 막혔으니 이 스크립트는 한 번 치우는 용도지 상시 작업이 아니다.
//
//   node scripts/purge-orphan-media.mjs                 # 목록만 (기본: 아무것도 안 지움)
//   SUPABASE_SERVICE_KEY=... node scripts/purge-orphan-media.mjs --yes
//
// 서비스 키는 Supabase 대시보드 > Settings > API > service_role. 목록 확인은 키 없이도 된다.
// 매번 현재 상태를 다시 계산하므로, 그 사이 다시 쓰이게 된 파일은 대상에서 저절로 빠진다.

const URL_BASE = 'https://pxjavljsalibpnxdrxel.supabase.co'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4amF2bGpzYWxpYnBueGRyeGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjAxNTgsImV4cCI6MjEwMjQzNjE1OH0.quIFdlk11b7F-YIeHO3TsEhS2RzgxDtntqdh2vHyUfE'
const service = process.env.SUPABASE_SERVICE_KEY
const commit = process.argv.includes('--yes')
const auth = (key) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' })

const list = async (prefix) => {
  const response = await fetch(`${URL_BASE}/storage/v1/object/list/media`, {
    method: 'POST', headers: auth(ANON), body: JSON.stringify({ prefix, limit: 1000 }),
  })
  if (!response.ok) throw new Error(`list ${prefix || '/'} failed: ${response.status}`)
  return response.json()
}

const rooms = await fetch(`${URL_BASE}/rest/v1/rooms?select=handle,data`, { headers: auth(ANON) })
if (!rooms.ok) throw new Error(`rooms failed: ${rooms.status}`)
// 방 번들 전체를 문자열 하나로 두고 경로가 그 안에 있는지만 본다 — 어떤 키에 박혀 있든 걸린다
const referenced = JSON.stringify(await rooms.json())

const folders = (await list('')).filter((entry) => !entry.metadata).map((entry) => entry.name).sort()
const doomed = []
let kept = 0
for (const folder of folders) {
  // .emptyFolderPlaceholder 는 빈 폴더를 표시하는 0바이트 표식이라 참조될 리 없다 — 대상에서 뺀다
  const files = (await list(`${folder}/`)).filter((entry) => entry.metadata && entry.name !== '.emptyFolderPlaceholder')
  for (const file of files) {
    const path = `${folder}/${file.name}`
    if (referenced.includes(`/media/${path}`)) { kept += 1; continue }
    doomed.push({ path, size: file.metadata.size ?? 0 })
  }
}
doomed.sort((left, right) => right.size - left.size)

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`
const total = doomed.reduce((sum, file) => sum + file.size, 0)
for (const file of doomed) console.log(`  ${file.path.padEnd(56)} ${mb(file.size)}`)
console.log(`\n사용 중 ${kept}개 · 삭제 대상 ${doomed.length}개 (${mb(total)})`)

if (!doomed.length) process.exit(0)
if (!commit) { console.log('\n목록만 출력했다. 실제로 지우려면 SUPABASE_SERVICE_KEY=... --yes'); process.exit(0) }
if (!service) { console.error('\nSUPABASE_SERVICE_KEY 가 없다. anon 키로는 삭제가 403이다.'); process.exit(1) }

// 스토리지 일괄 삭제는 경로 배열을 한 번에 받는다. 한 요청이 너무 커지지 않게 100개씩 끊는다.
let removed = 0
for (let at = 0; at < doomed.length; at += 100) {
  const batch = doomed.slice(at, at + 100).map((file) => file.path)
  const response = await fetch(`${URL_BASE}/storage/v1/object/media`, {
    method: 'DELETE', headers: auth(service), body: JSON.stringify({ prefixes: batch }),
  })
  if (!response.ok) { console.error(`삭제 실패 ${response.status}: ${await response.text()}`); process.exit(1) }
  removed += (await response.json()).length
}
console.log(`\n${removed}개 삭제됨 (${mb(total)})`)
