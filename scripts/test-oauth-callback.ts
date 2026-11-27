// BOSS の再認証の戻り先（oauth/callback）のテスト。BOSS の認証サーバー・本番の KV へは接続しない（偽の fetch と偽の KV だけ）
//   npx tsx --import ./scripts/boss-token-test/kv-loader.mjs scripts/test-oauth-callback.ts
import assert from 'node:assert/strict'
// @ts-expect-error テスト専用の偽の KV（JS）
import { fake } from './boss-token-test/fake-kv.mjs'
import { OAUTH_STATE_PREFIX } from '../lib/oauthState'

// テスト用の架空の値（本物と取り違えない形）
const ACCESS = 'TEST-ONLY-fake-access-token'
const REFRESH = 'TEST-ONLY-fake-refresh-token'
const CLIENT_SECRET = 'TEST-ONLY-fake-client-secret'
const BOSS_DETAIL = 'TEST-ONLY-boss-error-detail'
process.env.BOSS_CLIENT_ID = 'TEST-ONLY-client'
process.env.BOSS_CLIENT_SECRET = CLIENT_SECRET
process.env.BOSS_REDIRECT_URI = 'https://proxy.test/api/boss/oauth/callback'

const logs: string[] = []
for (const level of ['log', 'info', 'warn', 'error'] as const) console[level] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
const say = (s: string) => process.stdout.write(s + '\n')
let ok = 0
const t = async (name: string, fn: () => unknown) => { await fn(); ok++; say(`OK ${name}`) }

let tokenStatus = 200
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (!url.startsWith('https://auth.boss-oms.jp/')) throw new Error('外への接続は禁止')
  if (tokenStatus !== 200) return new Response(BOSS_DETAIL, { status: tokenStatus })
  return Response.json({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 300 })
}) as typeof fetch

const { GET } = await import('../app/api/boss/oauth/callback/route')
const { NextRequest } = await import('next/server')
const STATE = 'a'.repeat(64)
const call = async (q: string, accept = 'text/html,application/xhtml+xml') => {
  const res = await GET(new NextRequest(`https://proxy.test/api/boss/oauth/callback?${q}`, { headers: { accept } }))
  return { status: res.status, type: res.headers.get('content-type') ?? '', referrer: res.headers.get('referrer-policy'), text: await res.text() }
}
const texts: string[] = []
const issue = async () => { fake.reset(); await fake.store.set(`${OAUTH_STATE_PREFIX}${STATE}`, { v: '1', exp: Date.now() + 600_000 }) }

await t('ブラウザ・成功: 完了の画面（200・HTML）。トークンは KV にだけ保存し、画面には出さない', async () => {
  await issue()
  const r = await call(`code=c1&state=${STATE}`)
  texts.push(r.text)
  assert.deepEqual([r.status, r.type.startsWith('text/html'), r.referrer], [200, true, 'no-referrer'])
  assert.ok(r.text.includes('BOSS の認証が完了しました') && r.text.includes('接続テスト'))
  assert.equal(fake.token()?.refresh_token, REFRESH)
})

await t('ブラウザ・state が無い・違う・使い済み: やり直しの画面（400）', async () => {
  await issue()
  for (const q of [`code=c1`, `code=c1&state=zz`, `code=c1&state=${'b'.repeat(64)}`, `state=${STATE}`]) {
    const r = await call(q)
    texts.push(r.text)
    assert.deepEqual([r.status, r.text.includes('認証を確認できませんでした')], [400, true], q)
  }
  await call(`code=c1&state=${STATE}`)
  const again = await call(`code=c1&state=${STATE}`)
  assert.deepEqual([again.status, again.text.includes('認証を確認できませんでした')], [400, true], '同じ state は 2 回使えない')
})

await t('ブラウザ・BOSS の画面で拒否（error 付き・code なし）: 「許可されませんでした」の画面（JSON は今までどおり no code）', async () => {
  await issue()
  const r = await call(`error=access_denied&state=${STATE}`)
  texts.push(r.text)
  assert.deepEqual([r.status, r.text.includes('BOSS で許可されませんでした')], [400, true])
  const j = await call(`error=access_denied&state=${STATE}`, 'application/json')
  assert.deepEqual([j.status, JSON.parse(j.text)], [400, { ok: false, message: 'no code' }])
})

await t('ブラウザ・BOSS との交換に失敗・例外: 決まった文だけ（BOSS の応答・例外の中身は出さない）', async () => {
  await issue()
  tokenStatus = 400
  const r = await call(`code=c1&state=${STATE}`)
  tokenStatus = 200
  texts.push(r.text)
  assert.deepEqual([r.status, r.text.includes('認証を完了できませんでした')], [502, true])
  await issue()
  const orig = fake.beforeSet
  fake.beforeSet = async (k: string) => { if (k === 'boss:token') throw new Error(`kv down ${BOSS_DETAIL}`) }
  const e = await call(`code=c1&state=${STATE}`)
  fake.beforeSet = orig
  texts.push(e.text)
  assert.deepEqual([e.status, e.text.includes('認証を完了できませんでした')], [500, true])
})

await t('JSON だけを受ける呼び出し（curl など）には、今までどおりの JSON と状態の番号', async () => {
  await issue()
  const ok1 = await call(`code=c1&state=${STATE}`, 'application/json')
  assert.deepEqual([ok1.status, JSON.parse(ok1.text)], [200, { ok: true, saved: true }])
  const bad = await call(`code=c1&state=zz`, 'application/json')
  assert.deepEqual([bad.status, JSON.parse(bad.text)], [400, { ok: false, message: 'invalid state' }])
  const none = await call(`state=${STATE}`, 'application/json')
  assert.deepEqual([none.status, JSON.parse(none.text)], [400, { ok: false, message: 'no code' }])
  await issue()
  tokenStatus = 401
  const ex = await call(`code=c1&state=${STATE}`, 'application/json')
  tokenStatus = 200
  assert.deepEqual([ex.status, JSON.parse(ex.text)], [502, { ok: false, message: 'token exchange failed', status: 401 }])
  // Accept が無い（curl の既定は */*）ときは画面を返す（JSON を求めていない）
  const plain = await call(`code=c1&state=zz`, '*/*')
  assert.ok(plain.type.startsWith('text/html'))
})

await t('画面・ログにトークン・秘密・BOSS の応答が出ていない', () => {
  const all = [...texts, ...logs].join('\n')
  for (const v of [ACCESS, REFRESH, CLIENT_SECRET, BOSS_DETAIL]) assert.ok(!all.includes(v), v)
})

say(`\n${ok} OK`)
