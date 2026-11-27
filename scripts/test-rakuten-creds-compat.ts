// 楽天の 6 本の口が、画面からの差し替えを使っていないとき（RAKUTEN_CREDS_ENC_KEY が無い・KV に設定が無い・KV が読めない）に、
// 変更前（本番 271c64e）の口と「全く同じ」動きになることを確かめる。
// 変更前の route を git から取り出して並べて呼び、楽天 RMS へ送る内容（URL・方法・Authorization・本文）と、応答（状態・本文）を比べる。
// 楽天 RMS・本番の KV へは接続しない（偽の fetch と偽の KV だけ）
//   npx tsx --import ./scripts/boss-token-test/kv-loader.mjs scripts/test-rakuten-creds-compat.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
// @ts-expect-error テスト専用の偽の KV（JS）
import { fake } from './boss-token-test/fake-kv.mjs'

const BASE = '271c64e'
const ROOT = path.resolve(import.meta.dirname, '..')
const LEGACY = path.join(ROOT, 'scripts', '.legacy-compat')
const ROUTES = {
  list: 'app/api/boss/inquiry/list/route.ts',
  reply: 'app/api/boss/inquiry/reply/route.ts',
  attachment: 'app/api/boss/inquiry/attachment/route.ts',
  upload: 'app/api/boss/inquiry/attachment/upload/route.ts',
  prices: 'app/api/boss/items/prices/route.ts',
  expiry: 'app/api/boss/license/expiry/route.ts',
} as const

// テスト用の架空の値（本物と取り違えない形）
const FAKE_SECRET = 'TEST-ONLY-fake-service-secret'
const FAKE_LICENSE = 'TEST-ONLY-fake-license-key'
const PROXY_KEY = 'TEST-ONLY-fake-proxy-key'
process.env.BOSS_PROXY_API_KEY = PROXY_KEY
process.env.RAKUTEN_SHOP_ID = 'TEST-ONLY-shop'
delete process.env.RAKUTEN_EP_LICENSE_EXPIRY

for (const level of ['log', 'info', 'warn', 'error'] as const) console[level] = () => {}
const say = (s: string) => process.stdout.write(s + '\n')
let ok = 0
let changed = 0

// ---- 偽の楽天 RMS（呼ばれた内容を記録する） ----
type Sent = { url: string; method: string; auth: string | null; body: string | null }
let sent: Sent[] = []
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const h = new Headers(init?.headers)
  const body = init?.body == null ? null : typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer).toString('latin1')
  sent.push({ url, method: init?.method ?? 'GET', auth: h.get('authorization'), body })
  if (!url.startsWith('https://api.rms.rakuten.co.jp/')) throw new Error('外への接続は禁止')
  if (url.includes('/license-key/expiry-date')) return Response.json({ expiryDate: '2099-12-31' })
  if (url.includes('/items/search')) return Response.json({ numFound: 0, results: [] })
  if (url.includes('/inquirymng-api/inquiries/complete')) return Response.json({ results: [] })
  if (url.includes('/inquirymng-api/inquiry/reply')) return Response.json({ result: 'ok' })
  if (url.includes('/inquirymng-api/inquiries')) return Response.json({ list: [] })
  if (url.includes('/inquirymng-api/attachment') && (init?.method ?? 'GET') === 'GET') return new Response(Buffer.from([0xff, 0xd8, 0xff]), { headers: { 'Content-Type': 'image/jpeg' } })
  if (url.includes('/inquirymng-api/attachment')) return Response.json({ path: 'x/y.jpg' })
  return new Response('nf', { status: 404 })
}) as typeof fetch

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
async function request(name: keyof typeof ROUTES) {
  const { NextRequest } = await import('next/server')
  const h = { 'x-api-key': PROXY_KEY }
  switch (name) {
    case 'list': return new NextRequest('https://proxy.test/api/boss/inquiry/list?fromDate=2026-11-01&toDate=2026-11-02', { headers: h })
    case 'reply': return new NextRequest('https://proxy.test/api/boss/inquiry/reply', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ inquiryNumber: 'TEST-ONLY-1', message: 'テスト', complete: true }) })
    case 'attachment': return new NextRequest('https://proxy.test/api/boss/inquiry/attachment?path=a/b.jpg&label=b.jpg', { headers: h })
    case 'upload': { const fd = new FormData(); fd.append('file', new File([JPEG], 'a.jpg', { type: 'image/jpeg' })); return new NextRequest('https://proxy.test/api/boss/inquiry/attachment/upload', { method: 'POST', headers: h, body: fd }) }
    case 'prices': return new NextRequest('https://proxy.test/api/boss/items/prices?hits=1&maxPages=1', { headers: h })
    case 'expiry': return new NextRequest('https://proxy.test/api/boss/license/expiry', { headers: h })
  }
}

type Handler = (req: unknown) => Promise<Response>
async function run(handler: Handler, name: keyof typeof ROUTES) {
  sent = []
  const res = await handler(await request(name))
  const ct = res.headers.get('content-type') ?? ''
  const raw = ct.includes('json') ? await res.text() : Buffer.from(await res.arrayBuffer()).toString('base64')
  // 応答の時刻（items/prices の fetchedAt）だけはそろえて比べる
  const body = raw.replace(/"fetchedAt":"[^"]+"/, '"fetchedAt":"-"')
  return { status: res.status, body, sent: sent.map((s) => ({ ...s, body: s.body?.replace(/-{4,}csplatform[0-9a-f]+/g, '--BOUNDARY') ?? null })) }
}

async function main() {
  rmSync(LEGACY, { recursive: true, force: true })
  mkdirSync(LEGACY, { recursive: true })
  try {
    const legacy: Record<string, { GET?: Handler; POST?: Handler }> = {}
    const current: Record<string, { GET?: Handler; POST?: Handler }> = {}
    for (const [name, p] of Object.entries(ROUTES)) {
      const file = path.join(LEGACY, `${name}.ts`)
      writeFileSync(file, execFileSync('git', ['show', `${BASE}:${p}`], { cwd: ROOT }))
      legacy[name] = await import(file)
      current[name] = await import(path.join(ROOT, p))
    }
    const scenarios: [string, () => void][] = [
      ['暗号化の鍵が無い', () => { delete process.env.RAKUTEN_CREDS_ENC_KEY; fake.reset() }],
      ['鍵はあるが KV に設定が無い', () => { process.env.RAKUTEN_CREDS_ENC_KEY = randomBytes(32).toString('base64'); fake.reset() }],
    ]
    const envs: [string, () => void][] = [
      ['環境変数あり', () => { process.env.RAKUTEN_SERVICE_SECRET = FAKE_SECRET; process.env.RAKUTEN_LICENSE_KEY = FAKE_LICENSE }],
      ['ライセンスキーなし', () => { process.env.RAKUTEN_SERVICE_SECRET = FAKE_SECRET; delete process.env.RAKUTEN_LICENSE_KEY }],
      ['serviceSecret なし', () => { delete process.env.RAKUTEN_SERVICE_SECRET; process.env.RAKUTEN_LICENSE_KEY = FAKE_LICENSE }],
      ['前後に空白', () => { process.env.RAKUTEN_SERVICE_SECRET = ` ${FAKE_SECRET} `; process.env.RAKUTEN_LICENSE_KEY = ` ${FAKE_LICENSE}\n` }],
    ]
    const expectedAuth = 'ESA ' + Buffer.from(`${FAKE_SECRET}:${FAKE_LICENSE}`, 'utf-8').toString('base64')
    for (const [sName, setS] of scenarios) {
      for (const [eName, setE] of envs) {
        for (const name of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
          const method = name === 'reply' || name === 'upload' ? 'POST' : 'GET'
          setS(); setE()
          const before = await run(legacy[name][method]!, name)
          setS(); setE()
          const after = await run(current[name][method]!, name)
          fake.down = false
          assert.deepEqual(after, before, `${sName}・${eName}・${name}`)
          if (eName === '環境変数あり' || eName === '前後に空白') {
            assert.ok(after.sent.length > 0, `${name} は RMS を呼ぶ`)
            assert.ok(after.sent.every((s) => s.auth === expectedAuth), `${name} の Authorization は環境変数の値`)
          }
          ok++
        }
      }
      say(`OK ${sName}: 6 本の口 × 環境変数 4 通りで、変更前と同じ（送る内容・応答）`)
    }
    // 鍵はあるが KV が読めないとき: 変更前と違い、環境変数の古いキーで RMS を呼ばずに止める（意図した変更）
    for (const [eName, setE] of envs) {
      for (const name of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
        const method = name === 'reply' || name === 'upload' ? 'POST' : 'GET'
        process.env.RAKUTEN_CREDS_ENC_KEY = randomBytes(32).toString('base64'); fake.reset(); fake.down = true; setE()
        const after = await run(current[name][method]!, name)
        fake.down = false
        assert.equal(after.sent.length, 0, `${eName}・${name}: KV が読めないときは RMS を呼ばない`)
        assert.ok(after.status >= 500, `${eName}・${name}: 失敗を返す（${after.status}）`)
        assert.ok(!after.body.includes(FAKE_SECRET) && !after.body.includes(FAKE_LICENSE))
        changed++
      }
    }
    say(`OK 鍵はあるが KV が読めない: 6 本の口 × 環境変数 4 通りで、RMS を呼ばずに失敗を返す（意図した変更）`)
  } finally {
    rmSync(LEGACY, { recursive: true, force: true })
  }
  say(`\n${ok} 件 OK（変更前と同じ）＋ ${changed} 件 OK（KV が読めないときは止める・意図した変更）`)
}

main().catch((e) => { rmSync(LEGACY, { recursive: true, force: true }); process.stderr.write(`NG ${(e as Error).message.slice(0, 400)}\n`); process.exit(1) })
