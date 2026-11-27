// 楽天の認証情報の差し替え（lib/rakutenCreds.ts と credentials の口）と BOSS の認証の確認の口のテスト。
// 楽天 RMS・BOSS・本番の KV へは接続しない（偽の fetch と偽の KV だけ）
//   npx tsx --import ./scripts/boss-token-test/kv-loader.mjs scripts/test-rakuten-creds.ts
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
// @ts-expect-error テスト専用の偽の KV（JS）
import { fake } from './boss-token-test/fake-kv.mjs'

// ---- 秘密の値（どこにも出てはいけない） ----
const ENV_SECRET = 'SS-env-SECRET-0001'
const ENV_LICENSE = 'SL-env-LICENSE-0001'
const NEW_LICENSE = 'SL-new-LICENSE-0002'
const NEW_SECRET = 'SS-new-SECRET-0002'
const BAD_LICENSE = 'SL-bad-LICENSE-0003'
const CRED_KEY = 'cred-API-KEY-abcdef'
const PROXY_KEY = 'proxy-API-KEY-123456'
const ENC_KEY = randomBytes(32).toString('base64')
const SECRETS = [ENV_SECRET, ENV_LICENSE, NEW_LICENSE, NEW_SECRET, BAD_LICENSE, CRED_KEY, PROXY_KEY, ENC_KEY]
const RMS_DETAIL = 'RMS-DETAIL-must-not-leak'

process.env.RAKUTEN_SERVICE_SECRET = ENV_SECRET
process.env.RAKUTEN_LICENSE_KEY = ENV_LICENSE
process.env.BOSS_PROXY_API_KEY = PROXY_KEY
process.env.BOSS_CREDENTIALS_API_KEY = CRED_KEY
delete process.env.RAKUTEN_CREDS_ENC_KEY
delete process.env.RAKUTEN_EP_LICENSE_EXPIRY
process.env.RAKUTEN_SHOP_ID = 'shop-1'

// ---- 出たものを全部ためる ----
const logs: string[] = []
for (const level of ['log', 'info', 'warn', 'error'] as const) {
  console[level] = (...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
}
const say = (s: string) => process.stdout.write(s + '\n')
let ok = 0
const t = async (name: string, fn: () => unknown) => { await fn(); ok++; say(`OK ${name}`) }

// ---- 偽の RMS（グローバルの fetch を差し替え。外へは出さない） ----
type Call = { url: string; auth: string | null }
const calls: Call[] = []
const VALID = new Set([`${ENV_SECRET}:${ENV_LICENSE}`, `${ENV_SECRET}:${NEW_LICENSE}`, `${NEW_SECRET}:${NEW_LICENSE}`])
const decodeEsa = (h: string | null) => (h?.startsWith('ESA ') ? Buffer.from(h.slice(4), 'base64').toString('utf8') : '')
let rmsDown = false
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const auth = new Headers(init?.headers).get('authorization')
  calls.push({ url, auth })
  if (!url.startsWith('https://api.rms.rakuten.co.jp/')) throw new Error(`外への接続は禁止: ${url.slice(0, 40)}`)
  if (rmsDown) throw new Error(`connect ECONNREFUSED ${RMS_DETAIL}`)
  const pair = decodeEsa(auth)
  if (!VALID.has(pair)) return new Response(JSON.stringify({ errors: [{ message: RMS_DETAIL }] }), { status: 401 })
  if (url.includes('/license-key/expiry-date')) {
    const lk = new URL(url).searchParams.get('licenseKey')
    if (lk !== pair.split(':')[1]) return new Response(RMS_DETAIL, { status: 400 })
    return Response.json({ expiryDate: lk === ENV_LICENSE ? '2026-12-10' : '2027-02-25' })
  }
  if (url.includes('/inquirymng-api/inquiries')) return Response.json({ list: [], used: pair.split(':')[1] === NEW_LICENSE ? 'new' : 'env' })
  return new Response('not found', { status: 404 })
}) as typeof fetch

const lib = await import('../lib/rakutenCreds')
const { GET: statusGET } = await import('../app/api/boss/credentials/rakuten/status/route')
const { POST: testPOST } = await import('../app/api/boss/credentials/rakuten/test/route')
const { POST: activatePOST } = await import('../app/api/boss/credentials/rakuten/activate/route')
const { POST: rollbackPOST } = await import('../app/api/boss/credentials/rakuten/rollback/route')
const { GET: expiryGET } = await import('../app/api/boss/license/expiry/route')
const { GET: listGET } = await import('../app/api/boss/inquiry/list/route')
const { GET: bossStatusGET } = await import('../app/api/boss/auth/status/route')

const bodies: string[] = []
async function call(fn: (req: any) => Promise<Response>, path: string, opts: { method?: string; key?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.key !== null) headers['x-api-key'] = opts.key ?? CRED_KEY
  const { NextRequest } = await import('next/server')
  const req = new NextRequest(`https://proxy.test${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  const res = await fn(req)
  const text = await res.text()
  bodies.push(text)
  return { status: res.status, json: JSON.parse(text), text, cache: res.headers.get('cache-control') }
}
const used = () => decodeEsa(calls.at(-1)?.auth ?? null)

await t('暗号化の鍵が無いときは今までどおり環境変数（KV を見ない）・差し替えは not_configured', async () => {
  fake.reset()
  assert.deepEqual(await lib.getRakutenCreds(), { creds: { serviceSecret: ENV_SECRET, licenseKey: ENV_LICENSE }, source: 'env' })
  const s = await call(statusGET, '/api/boss/credentials/rakuten/status')
  assert.deepEqual(s.json, { ok: true, configured: false, source: 'env', activeSavedAt: null, previous: null })
  const a = await call(activatePOST, '/api/boss/credentials/rakuten/activate', { method: 'POST', body: { licenseKey: NEW_LICENSE } })
  assert.deepEqual([a.status, a.json.reason], [503, 'not_configured'])
  assert.equal(fake.store.size, 0, 'KV に何も書かない')
  await listGET(new (await import('next/server')).NextRequest('https://proxy.test/api/boss/inquiry/list?fromDate=2026-11-01&toDate=2026-11-02', { headers: { 'x-api-key': PROXY_KEY } }))
  assert.equal(used(), `${ENV_SECRET}:${ENV_LICENSE}`, '既存の口は環境変数の値で呼ぶ')
})

process.env.RAKUTEN_CREDS_ENC_KEY = ENC_KEY

await t('鍵：BOSS_CREDENTIALS_API_KEY だけ。無い・違う・CS 用の鍵は 401、未設定・ほかの鍵と同じは 503', async () => {
  for (const fn of [statusGET, testPOST, activatePOST, rollbackPOST, bossStatusGET]) {
    assert.equal((await call(fn, '/x', { method: 'POST', key: null, body: {} })).status, 401)
    assert.equal((await call(fn, '/x', { method: 'POST', key: 'wrong', body: {} })).status, 401)
    assert.equal((await call(fn, '/x', { method: 'POST', key: PROXY_KEY, body: {} })).status, 401)
  }
  process.env.BOSS_CREDENTIALS_API_KEY = PROXY_KEY
  assert.equal((await call(statusGET, '/x', { key: PROXY_KEY })).status, 503)
  delete process.env.BOSS_CREDENTIALS_API_KEY
  assert.equal((await call(statusGET, '/x', { key: '' })).status, 503)
  process.env.BOSS_CREDENTIALS_API_KEY = CRED_KEY
})

await t('入力の確認：空・空白入り・短すぎ・長すぎ・型違いは 400 invalid_input（RMS を呼ばない）', async () => {
  const before = calls.length
  for (const body of [{}, { licenseKey: '' }, { licenseKey: 'short' }, { licenseKey: 'has space 12345' }, { licenseKey: 'x'.repeat(257) }, { licenseKey: 123 }, { licenseKey: NEW_LICENSE, serviceSecret: 5 }, { licenseKey: NEW_LICENSE, serviceSecret: 'ｗｉｄｅ全角の値です' }]) {
    const r = await call(testPOST, '/t', { method: 'POST', body })
    assert.deepEqual([r.status, r.json.reason], [400, 'invalid_input'], JSON.stringify(body).slice(0, 30))
  }
  assert.equal(calls.length, before)
})

await t('試験：期限の取得だけを 1 回呼び、保存しない。serviceSecret を送らなければ今の値を使う', async () => {
  fake.reset()
  const before = calls.length
  const r = await call(testPOST, '/t', { method: 'POST', body: { licenseKey: NEW_LICENSE } })
  assert.deepEqual(r.json, { ok: true, expiryDate: '2027-02-25', daysLeft: lib.daysLeftOf('2027-02-25') })
  assert.equal(calls.length - before, 1)
  assert.ok(calls.at(-1)!.url.includes('/license-management/license-key/expiry-date'), '読み取りだけの API')
  assert.equal(used(), `${ENV_SECRET}:${NEW_LICENSE}`)
  assert.equal(r.cache, 'no-store')
  assert.equal(fake.store.size, 0, '試験では KV に書かない')
})

await t('試験：失敗は決まった理由と HTTP の番号だけ（RMS の応答本文・値は返さない）', async () => {
  const r = await call(testPOST, '/t', { method: 'POST', body: { licenseKey: BAD_LICENSE } })
  assert.deepEqual(r.json, { ok: false, reason: 'rms_unauthorized', status: 401 })
  rmsDown = true
  const d = await call(testPOST, '/t', { method: 'POST', body: { licenseKey: NEW_LICENSE } })
  rmsDown = false
  assert.deepEqual(d.json, { ok: false, reason: 'rms_unreachable' })
})

await t('切替：試験に通らなければ何も書かない（今の設定は環境変数のまま）', async () => {
  fake.reset()
  const a = await call(activatePOST, '/a', { method: 'POST', body: { licenseKey: BAD_LICENSE } })
  assert.deepEqual(a.json, { ok: false, reason: 'rms_unauthorized', status: 401 })
  assert.equal(fake.store.get(lib.RAKUTEN_CREDS_ACTIVE_KEY), undefined)
  assert.equal(fake.store.get(lib.RAKUTEN_CREDS_PREVIOUS_KEY), undefined)
  assert.equal((await lib.getRakutenCreds()).source, 'env')
})

await t('切替：同じ値は same_as_current（書かない）', async () => {
  const a = await call(activatePOST, '/a', { method: 'POST', body: { licenseKey: ENV_LICENSE } })
  assert.deepEqual(a.json, { ok: false, reason: 'same_as_current' })
})

await t('切替：ライセンスキーだけ替える。前の設定（環境変数の値）を残し、既存の口と期限の口が新しい値を使う', async () => {
  fake.reset()
  const a = await call(activatePOST, '/a', { method: 'POST', body: { licenseKey: NEW_LICENSE } })
  assert.deepEqual(a.json, { ok: true, expiryDate: '2027-02-25', daysLeft: lib.daysLeftOf('2027-02-25'), licenseKeyChanged: true, serviceSecretChanged: false })
  assert.deepEqual((await lib.getRakutenCreds()).creds, { serviceSecret: ENV_SECRET, licenseKey: NEW_LICENSE })
  const s = await call(statusGET, '/s')
  assert.equal(s.json.source, 'kv')
  assert.equal(s.json.previous.origin, 'env')
  assert.ok(s.json.activeSavedAt && s.json.previous.savedAt)
  // KV には暗号文だけ（平文の値は入っていない）
  const raw = JSON.stringify([...fake.store.values()])
  for (const v of SECRETS) assert.ok(!raw.includes(v), `KV に平文: ${v.slice(0, 6)}`)
  // 既存の口
  await listGET(new (await import('next/server')).NextRequest('https://proxy.test/api/boss/inquiry/list?fromDate=2026-11-01&toDate=2026-11-02', { headers: { 'x-api-key': PROXY_KEY } }))
  assert.equal(used(), `${ENV_SECRET}:${NEW_LICENSE}`)
  const e = await call(expiryGET, '/e', { key: PROXY_KEY })
  assert.equal(e.json.expiryDate, '2027-02-25', 'バナー・GAS が見る期限も新しいキーのもの')
})

await t('戻し：前の設定を試験してから入れ替える（もう一度戻すと元に戻る）', async () => {
  const r = await call(rollbackPOST, '/r', { method: 'POST' })
  assert.deepEqual([r.json.ok, r.json.licenseKeyChanged, r.json.serviceSecretChanged], [true, true, false])
  assert.deepEqual((await lib.getRakutenCreds()).creds, { serviceSecret: ENV_SECRET, licenseKey: ENV_LICENSE })
  const r2 = await call(rollbackPOST, '/r', { method: 'POST' })
  assert.equal(r2.json.ok, true)
  assert.deepEqual((await lib.getRakutenCreds()).creds, { serviceSecret: ENV_SECRET, licenseKey: NEW_LICENSE })
})

await t('戻し：前の設定が試験に通らなければ入れ替えない・前の設定が無ければ no_previous', async () => {
  VALID.delete(`${ENV_SECRET}:${ENV_LICENSE}`) // 前の設定（古いキー）が失効した想定
  const r = await call(rollbackPOST, '/r', { method: 'POST' })
  assert.deepEqual(r.json, { ok: false, reason: 'rms_unauthorized', status: 401 })
  assert.deepEqual((await lib.getRakutenCreds()).creds.licenseKey, NEW_LICENSE)
  VALID.add(`${ENV_SECRET}:${ENV_LICENSE}`)
  fake.reset()
  assert.deepEqual((await call(rollbackPOST, '/r', { method: 'POST' })).json, { ok: false, reason: 'no_previous' })
})

await t('serviceSecret も替える（明示して送ったときだけ）', async () => {
  fake.reset()
  const a = await call(activatePOST, '/a', { method: 'POST', body: { licenseKey: NEW_LICENSE, serviceSecret: NEW_SECRET } })
  assert.equal(a.json.ok, true)
  assert.deepEqual([a.json.licenseKeyChanged, a.json.serviceSecretChanged], [true, true])
  assert.deepEqual((await lib.getRakutenCreds()).creds, { serviceSecret: NEW_SECRET, licenseKey: NEW_LICENSE })
  // 戻すと両方が環境変数の値に戻る（戻しの結果も変わった項目を返す）
  const r = await call(rollbackPOST, '/r', { method: 'POST' })
  assert.deepEqual([r.json.ok, r.json.licenseKeyChanged, r.json.serviceSecretChanged], [true, true, true])
  assert.deepEqual((await lib.getRakutenCreds()).creds, { serviceSecret: ENV_SECRET, licenseKey: ENV_LICENSE })
  // serviceSecret だけを替える（ライセンスキーは今のまま）→ licenseKeyChanged は false
  const b = await call(activatePOST, '/a', { method: 'POST', body: { licenseKey: ENV_LICENSE, serviceSecret: NEW_SECRET } })
  assert.equal(b.json.reason ?? null, 'rms_unauthorized', 'この組み合わせは偽の RMS で無効（何も書かない）')
  VALID.add(`${NEW_SECRET}:${ENV_LICENSE}`)
  const c = await call(activatePOST, '/a', { method: 'POST', body: { licenseKey: ENV_LICENSE, serviceSecret: NEW_SECRET } })
  assert.deepEqual([c.json.ok, c.json.licenseKeyChanged, c.json.serviceSecretChanged], [true, false, true])
  VALID.delete(`${NEW_SECRET}:${ENV_LICENSE}`)
})

await t('同時の切替は 1 つだけ（ほかは busy 409）', async () => {
  fake.reset()
  await fake.store.set(lib.RAKUTEN_CREDS_LOCK_KEY, { v: 'other', exp: Date.now() + 30_000 })
  const a = await call(activatePOST, '/a', { method: 'POST', body: { licenseKey: NEW_LICENSE } })
  assert.deepEqual([a.status, a.json.reason], [409, 'busy'])
  fake.store.delete(lib.RAKUTEN_CREDS_LOCK_KEY)
})

await t('保存の途中の失敗：「前の設定」を書けなければ今の設定は変わらない（save_failed）', async () => {
  fake.reset()
  fake.down = false
  const origSet = (await import('./boss-token-test/fake-kv.mjs' as string)).kv.set
  const kvmod = (await import('./boss-token-test/fake-kv.mjs' as string)).kv
  kvmod.set = async (k: string, v: unknown, o: unknown) => { if (k === lib.RAKUTEN_CREDS_PREVIOUS_KEY) throw new Error(`kv down ${ENC_KEY}`); return origSet(k, v, o) }
  const a = await call(activatePOST, '/a', { method: 'POST', body: { licenseKey: NEW_LICENSE } })
  kvmod.set = origSet
  assert.deepEqual(a.json, { ok: false, reason: 'save_failed' })
  assert.equal((await lib.getRakutenCreds()).source, 'env')
})

await t('KV が読めない・暗号文が壊れている・鍵が違うときは環境変数で続ける（既存の口を止めない）', async () => {
  fake.reset()
  await call(activatePOST, '/a', { method: 'POST', body: { licenseKey: NEW_LICENSE } })
  fake.down = true
  assert.deepEqual((await lib.getRakutenCreds()).source, 'env')
  fake.down = false
  process.env.RAKUTEN_CREDS_ENC_KEY = randomBytes(32).toString('base64')
  assert.deepEqual((await lib.getRakutenCreds()).source, 'env')
  process.env.RAKUTEN_CREDS_ENC_KEY = ENC_KEY
  assert.deepEqual((await lib.getRakutenCreds()).source, 'kv')
})

// ---- BOSS の認証の確認（トークンの取得だけ。業務 API は呼ばない） ----
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const ACCESS = `${b64({ alg: 'none' })}.${b64({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })}.sig-ACCESS-SECRET`
const REFRESH = `${b64({ alg: 'none' })}.${b64({ exp: 1_900_000_000 })}.sig-REFRESH-SECRET`
SECRETS.push(ACCESS, REFRESH, 'sig-ACCESS-SECRET', 'sig-REFRESH-SECRET')

await t('BOSS：保存済みのトークンが有効なら外へ出ずに期限だけ返す（値は返さない）', async () => {
  fake.reset()
  await fake.store.set('boss:token', { v: { access_token: ACCESS, refresh_token: REFRESH, expires_at: Math.floor(Date.now() / 1000) + 300 }, exp: 0 })
  const before = calls.length
  const r = await call(bossStatusGET, '/b')
  assert.equal(r.json.ok, true)
  assert.equal(r.json.refreshExpiresAt, 1_900_000_000)
  assert.ok(typeof r.json.accessExpiresAt === 'number')
  assert.equal(calls.length, before, 'BOSS へも RMS へも接続しない')
})

await t('BOSS：更新用トークンが無ければ reauth_required（決まった語だけ）', async () => {
  fake.reset()
  const r = await call(bossStatusGET, '/b')
  assert.deepEqual(r.json, { ok: false, reason: 'reauth_required' })
})

await t('応答・ログに秘密の値・RMS の応答本文が出ていない', () => {
  const all = [...bodies, ...logs].join('\n')
  for (const v of [...SECRETS, RMS_DETAIL]) assert.ok(!all.includes(v), `含まれている: ${v.slice(0, 8)}`)
})

say(`\n${ok} OK`)
