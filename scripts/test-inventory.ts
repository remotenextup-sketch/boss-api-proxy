// 在庫の口（GET /api/boss/inventory）のテスト。KV・BOSS・認証サーバーは偽物（外へは接続しない）
//   npx tsx --import ./scripts/boss-token-test/kv-loader.mjs scripts/test-inventory.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
// @ts-expect-error テスト専用の偽の KV（JS）
import { fake } from './boss-token-test/fake-kv.mjs'

const CS_KEY = 'cs-SECRET-key'
const INV_KEY = 'inv-SECRET-key'
process.env.BOSS_API_BASE_URL = 'https://boss.test'
process.env.BOSS_PROXY_API_KEY = CS_KEY
process.env.BOSS_INVENTORY_API_KEY = INV_KEY
process.env.BOSS_CLIENT_ID = 'client-id'
process.env.BOSS_CLIENT_SECRET = 'client-SECRET-value'

// ---- 出たものを全部ためて、最後に秘密が混ざっていないかを見る ----
const logs: string[] = []
for (const level of ['log', 'info', 'warn', 'error'] as const) {
  console[level] = (...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
}
const say = (s: string) => process.stdout.write(s + '\n')
const secrets = new Set<string>([CS_KEY, INV_KEY, 'client-SECRET-value', 'BOSS-SECRET-DETAIL'])

// ---- 偽のトークン ----
let seq = 0
const nowSec = () => Math.floor(Date.now() / 1000)
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
function stored(ageSec: number) {
  const iat = nowSec() - ageSec
  const access = `${b64({ alg: 'none' })}.${b64({ iat, exp: iat + 300, n: ++seq })}.sig`
  const rt = `rt-${++seq}-SECRET`
  secrets.add(access); secrets.add(rt)
  return { access_token: access, refresh_token: rt, expires_at: iat + 300 }
}

// ---- 偽の BOSS（在庫・注文）と認証サーバー ----
type Call = { method: string; url: URL; auth: string }
const calls: Call[] = []
const bossInv = {
  status: 200,
  body: null as unknown,
  raw: null as string | null,
  delayMs: 0,
  hang: false,
  headers: {} as Record<string, string>,
}
const kc = { calls: 0 }
const sleep = (ms: number, signal?: AbortSignal | null) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason) })
})
const sampleBody = (page = 1, totalPages = 3) => ({
  pageNumber: page, pageSize: 2, totalNumberOfPages: totalPages, totalNumberOfRecords: 5,
  nextPageUrl: 'https://evil.example/next',
  results: [
    { id: 'inv-1', itemName: '商品A', skuCode: 'SKU-A', janCode: '4900000000001', saleableCount: 10, allocatedInventory: 2, actualWarehouseInventory: 12,
      backOrderQuantity: 0, safeInventoryLevel: 1, restockThreshold: 3, isInactive: false,
      warehouseInventories: [{ warehouseId: 1, warehouseName: '倉庫1', warehouseStatus: 1, allocatedInventory: 2, unallocatedInventory: 10, actualWarehouseInventory: 12 }] },
    { id: 'inv-2', itemName: '商品B', skuCode: 'SKU-B', janCode: '', saleableCount: 0, allocatedInventory: 0, actualWarehouseInventory: 0,
      backOrderQuantity: 0, safeInventoryLevel: 0, restockThreshold: 0, isInactive: true, warehouseInventories: [] },
  ],
})
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input))
  const method = (init?.method ?? 'GET').toUpperCase()
  const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '')
  if (url.pathname.endsWith('/realms/boss/protocol/openid-connect/token')) {
    kc.calls++
    const iat = nowSec()
    const access = `${b64({ alg: 'none' })}.${b64({ iat, exp: iat + 300, n: ++seq })}.sig`
    secrets.add(access)
    return new Response(JSON.stringify({ access_token: access, refresh_token: `rt-new-${++seq}-SECRET`, expires_in: 300 }), { status: 200 })
  }
  calls.push({ method, url, auth })
  if (url.host !== 'boss.test') throw new Error(`想定外の接続: ${url.host}`)
  if (url.pathname === '/BOSS-API/v1/inventory/list') {
    const signal = init?.signal ?? null
    if (bossInv.hang) await new Promise((_, rej) => signal?.addEventListener('abort', () => rej(signal.reason)))
    await sleep(bossInv.delayMs, signal)
    if (bossInv.raw !== null) return new Response(bossInv.raw, { status: bossInv.status, headers: bossInv.headers })
    return new Response(JSON.stringify(bossInv.body ?? sampleBody()), { status: bossInv.status, headers: { 'content-type': 'application/json', ...bossInv.headers } })
  }
  if (url.pathname === '/BOSS-API/v1/orders/search') return new Response('[]', { status: 200 })
  return new Response('not found', { status: 404 })
}) as typeof fetch

// ---- 実行の枠 ----
const { GET: inventory } = await import('../app/api/boss/inventory/route')
const limiter = await import('../lib/inventoryLimiter')
const defaults = { ...limiter.inventoryLimits }
const results: Array<{ name: string; ok: boolean }> = []
async function t(name: string, fn: () => Promise<void>) {
  fake.reset(); calls.length = 0; kc.calls = 0
  Object.assign(bossInv, { status: 200, body: null, raw: null, delayMs: 0, hang: false, headers: {} })
  Object.assign(limiter.inventoryLimits, defaults)
  fake.store.set('boss:token', { v: stored(10), exp: 0 })
  try {
    await Promise.race([fn(), sleep(20_000).then(() => { throw new Error('20 秒以内に終わらない') })])
    results.push({ name, ok: true }); say(`OK   ${name}`)
  } catch (e) {
    results.push({ name, ok: false }); say(`NG   ${name}\n       → ${(e as Error).message.split('\n')[0]}`)
  }
}
const invReq = (qs = '', key: string | null = INV_KEY) =>
  new NextRequest(`http://localhost/api/boss/inventory${qs}`, { method: 'GET', headers: key ? { 'x-api-key': key } : {} })
const call = async (qs = '', key: string | null = INV_KEY) => {
  const r = await inventory(invReq(qs, key))
  return { status: r.status, body: await r.json(), retryAfter: r.headers.get('retry-after'), cache: r.headers.get('cache-control') }
}
const invCalls = () => calls.filter((c) => c.url.pathname === '/BOSS-API/v1/inventory/list')

// ---- 1. 鍵の分離 ----
await t('在庫の鍵が未設定なら、誰も通さない（503）', async () => {
  delete process.env.BOSS_INVENTORY_API_KEY
  try { assert.deepEqual((await call()).body, { ok: false, reason: 'not_configured' }) } finally { process.env.BOSS_INVENTORY_API_KEY = INV_KEY }
  assert.equal(calls.length, 0)
})
await t('在庫の鍵が CS の鍵と同じ値なら、通さない（503・取り違え防止）', async () => {
  process.env.BOSS_INVENTORY_API_KEY = CS_KEY
  try { const r = await call('', CS_KEY); assert.equal(r.status, 503); assert.equal(r.body.reason, 'not_configured') } finally { process.env.BOSS_INVENTORY_API_KEY = INV_KEY }
  assert.equal(calls.length, 0)
})
await t('鍵なし・違う鍵・CS の鍵では在庫の口は 401（BOSS は呼ばない）', async () => {
  for (const k of [null, 'wrong', CS_KEY, 'inv-SECRET-kez']) assert.equal((await call('', k)).status, 401)
  assert.equal(calls.length, 0)
  assert.equal(kc.calls, 0)
})
const KEYED_ROUTES: Array<[string, 'GET' | 'POST']> = [
  ['find-order', 'POST'], ['order-shipments', 'POST'], ['inquiry/list', 'GET'], ['inquiry/attachment', 'GET'],
  ['inquiry/attachment/upload', 'POST'], ['inquiry/reply', 'POST'], ['items/prices', 'GET'], ['license/expiry', 'GET'], ['oauth/auto', 'GET'],
]
await t('在庫の鍵では、既存の 9 本（CS 用の鍵で守る口）はすべて 401', async () => {
  for (const [path, method] of KEYED_ROUTES) {
    const mod = await import(`../app/api/boss/${path}/route`)
    const r: Response = await mod[method](new NextRequest(`http://localhost/api/boss/${path}`, {
      method, headers: { 'x-api-key': INV_KEY, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined,
    }))
    assert.equal(r.status, 401, `${path} が ${r.status}`)
  }
  assert.equal(calls.length, 0)
})
await t('CS の鍵では、既存の口は今までどおり通る（find-order が BOSS の注文検索まで進む）', async () => {
  const { POST } = await import('../app/api/boss/find-order/route')
  const r = await POST(new NextRequest('http://localhost/api/boss/find-order', {
    method: 'POST', headers: { 'x-api-key': CS_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ mallOrderNumber: '372877-20260425-0147424025' }),
  }))
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { ok: false, reason: 'not_found' })
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.pathname}`), ['POST /BOSS-API/v1/orders/search'])
})

// ---- 2. 入力の検証（BOSS は呼ばない） ----
await t('入力が不正なら 400 invalid_params（BOSS もトークンも使わない）', async () => {
  const bad: Array<[string, string]> = [
    ['?page=0', 'page'], ['?page=10001', 'page'], ['?page=1.5', 'page'], ['?pageSize=501', 'pageSize'], ['?pageSize=-1', 'pageSize'],
    ['?from=2026-11-01T00:00:00%2B09:00', 'from_to'], ['?from=2026-11-01&to=2026-11-02', 'from'],
    ['?from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z', 'from_to'], ['?from=2026-09-01T00:00:00Z&to=2026-11-01T00:00:00Z', 'from_to'],
    ['?zeroInventory=yes', 'zeroInventory'], ['?isInactive=1', 'isInactive'], ['?warehouseIds=1,a', 'warehouseIds'],
    ['?warehouseIds=' + Array.from({ length: 21 }, (_, i) => i + 1).join(','), 'warehouseIds'],
    ['?page=1&page=2', 'page'], ['?url=https://evil.example', 'unknown_param'], ['?method=POST', 'unknown_param'],
  ]
  for (const [qs, field] of bad) {
    const r = await call(qs)
    assert.equal(r.status, 400, qs)
    assert.deepEqual(r.body, { ok: false, reason: 'invalid_params', field }, qs)
  }
  assert.equal(calls.length, 0)
  assert.equal(kc.calls, 0)
})

// ---- 3. BOSS の呼び出しと応答の整形 ----
await t('BOSS へは GET /BOSS-API/v1/inventory/list だけを 1 回。条件はそのままの名前で渡し、保存中のトークンを使う（更新しない）', async () => {
  const token = fake.token().access_token
  const r = await call('?page=2&pageSize=200&from=2026-11-01T00:00:00%2B09:00&to=2026-11-05T00:00:00%2B09:00&zeroInventory=true&isInactive=false&restockThreshold=false&warehouseIds=3,5')
  assert.equal(r.status, 200)
  assert.equal(calls.length, 1)
  const c = calls[0]
  assert.equal(c.method, 'GET')
  assert.equal(`${c.url.origin}${c.url.pathname}`, 'https://boss.test/BOSS-API/v1/inventory/list')
  assert.equal(c.auth, `Bearer ${token}`)
  assert.deepEqual([...c.url.searchParams.entries()], [
    ['page', '2'], ['PageSize', '200'], ['fromDateTime', '2026-11-01T00:00:00+09:00'], ['toDateTime', '2026-11-05T00:00:00+09:00'],
    ['zeroInventory', 'true'], ['isInactive', 'false'], ['restockThreshold', 'false'], ['warehouseIds', '3'], ['warehouseIds', '5'],
  ])
  assert.equal(kc.calls, 0)
  assert.equal(r.cache, 'no-store')
})
await t('条件を付けなければ page=1・PageSize=500 だけを渡す（既定の扱いは BOSS に任せる）', async () => {
  await call()
  assert.deepEqual([...invCalls()[0].url.searchParams.entries()], [['page', '1'], ['PageSize', '500']])
})
await t('応答は整えた形だけを返す（BOSS の本文・nextPageUrl は返さない、たどらない）', async () => {
  const r = await call('?page=1&pageSize=2')
  assert.equal(r.status, 200)
  const { fetchedAt, ...rest } = r.body
  assert.ok(!Number.isNaN(Date.parse(fetchedAt)))
  assert.deepEqual(rest, {
    ok: true, page: 1, pageSize: 2, totalPages: 3, totalRecords: 5, hasNext: true,
    items: [
      { bossId: 'inv-1', skuCode: 'SKU-A', janCode: '4900000000001', itemName: '商品A', saleable: 10, allocated: 2, actual: 12, backOrder: 0, safetyStock: 1, restockThreshold: 3, isInactive: false,
        warehouses: [{ warehouseId: 1, warehouseName: '倉庫1', warehouseStatus: 1, allocated: 2, unallocated: 10, actual: 12 }] },
      { bossId: 'inv-2', skuCode: 'SKU-B', janCode: '', itemName: '商品B', saleable: 0, allocated: 0, actual: 0, backOrder: 0, safetyStock: 0, restockThreshold: 0, isInactive: true, warehouses: [] },
    ],
  })
  assert.ok(!JSON.stringify(r.body).includes('evil.example'))
  assert.equal(calls.length, 1)
})
await t('最後のページは hasNext=false。ページ数が無ければ nextPageUrl の有無で判断', async () => {
  bossInv.body = sampleBody(3, 3)
  assert.equal((await call('?page=3')).body.hasNext, false)
  await new Promise((r) => setTimeout(r, 1100))
  bossInv.body = { ...sampleBody(1, 3), totalNumberOfPages: undefined, nextPageUrl: null }
  const r = await call()
  assert.equal(r.body.hasNext, false)
  assert.equal(r.body.totalPages, null)
})

// ---- 4. BOSS のエラー（本文は返さない） ----
await t('BOSS が 400 → 400 boss_rejected_params（status だけ）', async () => {
  bossInv.status = 400; bossInv.raw = '{"title":"bad BOSS-SECRET-DETAIL"}'
  const r = await call()
  assert.deepEqual(r.body, { ok: false, reason: 'boss_rejected_params', status: 400 })
})
await t('BOSS が 401・403・404・500 → 502 boss_error（status だけ・本文は返さない）', async () => {
  for (const s of [401, 403, 404, 500]) {
    fake.store.delete('boss:inv:gap')
    bossInv.status = s; bossInv.raw = '<html>BOSS-SECRET-DETAIL</html>'
    const r = await call()
    assert.equal(r.status, 502)
    assert.deepEqual(r.body, { ok: false, reason: 'boss_error', status: s })
  }
})
await t('BOSS の応答が JSON でない・results が無い → 502 boss_invalid_response', async () => {
  bossInv.raw = 'not json'
  assert.equal((await call()).body.reason, 'boss_invalid_response')
  fake.store.delete('boss:inv:gap')
  bossInv.raw = null; bossInv.body = { pageNumber: 1 }
  assert.equal((await call()).body.reason, 'boss_invalid_response')
})
await t('BOSS が応答しない → 制限時間で打ち切り 504 boss_timeout、ロックを外す', async () => {
  limiter.inventoryLimits.fetchTimeoutMs = 300
  bossInv.hang = true
  const r = await call()
  assert.deepEqual(r.body, { ok: false, reason: 'boss_timeout' })
  assert.equal(r.status, 504)
  assert.equal(fake.store.get('boss:inv:lock'), undefined)
})
await t('トークンが使えない（更新用トークン無し）→ 503 boss_auth_unavailable（code だけ）。在庫は呼ばない', async () => {
  fake.store.delete('boss:token')
  const r = await call()
  assert.deepEqual(r.body, { ok: false, reason: 'boss_auth_unavailable', code: 'reauth_required' })
  assert.equal(invCalls().length, 0)
})

// ---- 5. 429 と休止 ----
await t('BOSS が 429（Retry-After 120）→ 429 rate_limited・120 秒休止。休止中はトークンも BOSS も使わない', async () => {
  bossInv.status = 429; bossInv.raw = ''; bossInv.headers = { 'retry-after': '120' }
  const r = await call()
  assert.equal(r.status, 429)
  assert.deepEqual(r.body, { ok: false, reason: 'rate_limited', retryAfterSec: 120 })
  assert.equal(r.retryAfter, '120')
  fake.store.set('boss:token', { v: stored(400), exp: 0 }) // 失効したトークン（休止中なら更新もしない）
  bossInv.status = 200; bossInv.raw = null; bossInv.headers = {}
  const again = await call()
  assert.equal(again.status, 429)
  assert.equal(again.body.reason, 'cooling_down')
  assert.ok(again.body.retryAfterSec > 100 && again.body.retryAfterSec <= 120)
  assert.equal(invCalls().length, 1)
  assert.equal(kc.calls, 0)
})
await t('429 が続くと休止を倍に（60 → 120 → 240 秒、上限 900 秒）。成功で最初に戻す', async () => {
  const secs: number[] = []
  for (let i = 0; i < 5; i++) secs.push(await limiter.startCooldown(null))
  assert.deepEqual(secs, [60, 120, 240, 480, 900])
  fake.store.delete('boss:inv:cooldown')
  await call()
  assert.equal(fake.store.get('boss:inv:cooldown_level'), undefined)
  assert.equal(await limiter.startCooldown(null), 60)
})

// ---- 6. 間隔・同時実行・1 日の上限（暫定の運用制限） ----
await t('1 秒以内の 2 回目は 429 too_soon（BOSS は呼ばない）。1 秒あければ通る', async () => {
  assert.equal((await call()).status, 200)
  const r = await call()
  assert.equal(r.status, 429)
  assert.deepEqual(r.body, { ok: false, reason: 'too_soon', retryAfterSec: 1 })
  assert.equal(invCalls().length, 1)
  await new Promise((res) => setTimeout(res, 1100))
  assert.equal((await call()).status, 200)
  assert.equal(invCalls().length, 2)
})
await t('BOSS を呼んでいる最中のもう 1 つは 429 busy（同時 1 つ）', async () => {
  bossInv.delayMs = 500
  const first = call()
  await new Promise((res) => setTimeout(res, 100))
  const second = await call()
  assert.equal(second.status, 429)
  assert.equal(second.body.reason, 'busy')
  assert.equal((await first).status, 200)
  assert.equal(invCalls().length, 1)
})
await t('成功・失敗のどちらでもロックを外す（自分のロックだけ）', async () => {
  await call()
  assert.equal(fake.store.get('boss:inv:lock'), undefined)
  fake.store.delete('boss:inv:gap')
  bossInv.status = 500; bossInv.raw = 'x'
  await call()
  assert.equal(fake.store.get('boss:inv:lock'), undefined)
})
await t('ロックの期限が切れて別の呼び出しが取り直したら、古い呼び出しはそのロックを消さない', async () => {
  limiter.inventoryLimits.lockTtlMs = 300; limiter.inventoryLimits.minIntervalMs = 50
  bossInv.delayMs = 600
  const first = call()
  await new Promise((res) => setTimeout(res, 400)) // first のロックは切れた
  bossInv.delayMs = 600
  const second = call() // 取り直す
  await new Promise((res) => setTimeout(res, 350)) // first が終わって外そうとする
  const lockWhileSecond = fake.store.get('boss:inv:lock')?.v
  await Promise.all([first, second])
  assert.ok(lockWhileSecond, '古い呼び出しが新しいロックを消した')
})
await t('ロックを外すスクリプト（eval）が失敗しても、応答は成功のまま。GET → DEL はせず、期限で消える', async () => {
  limiter.inventoryLimits.lockTtlMs = 400
  fake.evalFails = true
  const r = await call()
  assert.equal(r.status, 200)
  assert.ok(fake.store.get('boss:inv:lock'), 'ロックが消えている（GET → DEL で外した？）')
  await new Promise((res) => setTimeout(res, 500))
  assert.equal(fake.store.get('boss:inv:lock') && Date.now() < fake.store.get('boss:inv:lock').exp ? 'あり' : 'なし', 'なし')
  assert.ok(logs.some((l) => /lock release failed/.test(l)))
})
await t('1 日の上限（暫定 3,000 回）に達したら 429 daily_limit（BOSS は呼ばない）。回数のキーには期限を付ける', async () => {
  await call()
  const key = [...fake.store.keys()].find((k: string) => k.startsWith('boss:inv:daily:'))
  assert.ok(key)
  assert.ok(fake.store.get(key).exp > Date.now() + 86_400_000)
  fake.store.get(key).v = limiter.inventoryLimits.dailyLimit
  fake.store.delete('boss:inv:gap')
  const r = await call()
  assert.equal(r.status, 429)
  assert.equal(r.body.reason, 'daily_limit')
  assert.ok(r.body.retryAfterSec > 0 && r.body.retryAfterSec <= 86_400)
  assert.equal(invCalls().length, 1)
  assert.equal(fake.store.get('boss:inv:lock'), undefined)
})
await t('KV が使えないときは 503 limiter_unavailable（BOSS は呼ばない）', async () => {
  fake.down = true
  const r = await call()
  fake.down = false
  assert.equal(r.status, 503)
  assert.equal(r.body.reason, 'limiter_unavailable')
  assert.equal(invCalls().length, 0)
})

// ---- 7. トークンの共有（在庫と注文） ----
await t('トークンが失効していても、在庫と注文を同時に呼んで更新は 1 回', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 })
  const { POST } = await import('../app/api/boss/find-order/route')
  const order = () => POST(new NextRequest('http://localhost/api/boss/find-order', {
    method: 'POST', headers: { 'x-api-key': CS_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ mallOrderNumber: '372877-20260425-0147424025' }),
  }))
  const rs = await Promise.all([call(), order(), order()])
  assert.equal(rs[0].status, 200)
  assert.equal(kc.calls, 1, `更新が ${kc.calls} 回`)
})

// ---- 8. 呼び先とログ ----
await t('このテスト全体で、BOSS へは在庫一覧の GET と注文検索の POST 以外を呼んでいない', async () => {
  // 各テストの calls は消えるので、ここでもう一度いろいろ呼んで確かめる
  await call('?page=1&pageSize=1')
  for (const c of calls) assert.ok(c.method === 'GET' && c.url.pathname === '/BOSS-API/v1/inventory/list', `${c.method} ${c.url.pathname}`)
  const raw = (await import('node:fs')).readFileSync(new URL('../lib/bossInventory.ts', import.meta.url), 'utf8')
  const src = raw.split('\n').map((l: string) => l.replace(/\s*\/\/.*$/, '')).join('\n') // コメントは除いて調べる
  assert.ok(!/Reflection|method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(src), '在庫を変える API・書き込みのメソッドが書かれている')
})
await t('ログ全体に、鍵・トークン・BOSS の本文が出ていない', async () => {
  const all = logs.join('\n')
  const leaked = [...secrets].filter((s) => all.includes(s))
  assert.equal(leaked.length, 0, `${leaked.length} 種類の秘密がログに出た`)
})

const ng = results.filter((r) => !r.ok)
say(`\n${results.length - ng.length} 件 OK / ${ng.length} 件 NG`)
process.exit(ng.length ? 1 : 0)
