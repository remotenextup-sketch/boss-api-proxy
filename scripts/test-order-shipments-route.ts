// order-shipments の入口（鍵・入力の確認）のテスト。鍵の確認・入力の確認で止まる場合だけを試す（BOSS・KV へは接続しない）
// npx tsx scripts/test-order-shipments-route.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST } from '../app/api/boss/order-shipments/route'

let ok = 0
const t = async (name: string, fn: () => unknown) => { await fn(); ok++; console.log('OK', name) }
const req = (headers: Record<string, string>, body: string) => new NextRequest('http://localhost/api/boss/order-shipments', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
const call = async (headers: Record<string, string>, body: string) => { const r = await POST(req(headers, body)); return { status: r.status, body: await r.json() } }
const ORDER = JSON.stringify({ mallOrderNumber: '372877-20260425-0147424025' })

// BOSS や KV に行きかけたら失敗にする
globalThis.fetch = (async () => { throw new Error('外部へ接続しようとした') }) as typeof fetch

delete process.env.BOSS_PROXY_API_KEY
await t('鍵が設定されていなければ誰も通さない（503）', async () => assert.deepEqual(await call({ 'x-api-key': 'anything' }, ORDER), { status: 503, body: { ok: false, reason: 'not_configured' } }))
process.env.BOSS_PROXY_API_KEY = 'expected-key'
await t('鍵なし → 401', async () => assert.deepEqual(await call({}, ORDER), { status: 401, body: { ok: false, reason: 'unauthorized' } }))
await t('鍵違い → 401', async () => assert.deepEqual(await call({ 'x-api-key': 'wrong' }, ORDER), { status: 401, body: { ok: false, reason: 'unauthorized' } }))
await t('鍵違い（長さが同じ）→ 401', async () => assert.equal((await call({ 'x-api-key': 'expected-kez' }, ORDER)).status, 401))
await t('正しい鍵でも JSON でなければ 400', async () => assert.deepEqual(await call({ 'x-api-key': 'expected-key' }, 'x'), { status: 400, body: { ok: false, reason: 'invalid_json' } }))
await t('正しい鍵でも注文番号が無い・形がおかしければ 400（BOSS へは行かない）', async () => {
  for (const b of [{}, { mallOrderNumber: 1 }, { mallOrderNumber: '' }, { mallOrderNumber: 'a b' }, { mallOrderNumber: "1' or '1'='1" }, { mallOrderNumber: 'x'.repeat(65) }]) {
    assert.deepEqual(await call({ 'x-api-key': 'expected-key' }, JSON.stringify(b)), { status: 400, body: { ok: false, reason: 'mallOrderNumber_required' } })
  }
})
await t('応答に鍵の値を含めない', async () => {
  const r = await call({ 'x-api-key': 'wrong' }, ORDER)
  assert.ok(!JSON.stringify(r).includes('expected-key'))
})
console.log(`\n${ok} 件 OK`)
