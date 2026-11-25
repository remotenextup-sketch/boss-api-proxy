// 届け先の口（order-consignees）のテスト。BOSS・KV へは接続しない（架空のデータと偽の fetch だけ）
// npx tsx scripts/test-order-consignees.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { fetchOrderConsignees, normalizeOrderConsignees, type FetchLike } from '../lib/bossConsignees'
import { POST } from '../app/api/boss/order-consignees/route'

let ok = 0
const t = async (name: string, fn: () => unknown) => { await fn(); ok++; console.log('OK', name) }

// BOSS 仕様書（GetOrder v1/orders/list）の形の架空データ
const consignee = { id: 1, name: '架空 届子', country: 'JP', postalCode: '530-0001', prefecture: '大阪府', city: '大阪市北区', townAndStreet: '梅田1-1 架空タワー 2001', phoneNumber: '06-0000-0000', email: 'todoke@example.invalid' }
const buyer = { id: 2, name: '架空 注文太郎', country: 'JP', postalCode: '100-0001', prefecture: '東京都', city: '千代田区', townAndStreet: '丸の内1-1', phoneNumber: '03-0000-0000', email: 'buyer@example.invalid' }
const detail = {
  orderID: 9, mallOrderNumber: '372877-20260425-0147424025', buyer,
  shipments: [
    { shipmentID: 1, shipmentStatus: 5, consignee, shipmentItems: [{ itemName: '架空のバッグ', unitPrice: 1980 }, { itemName: '架空のバッグ', unitPrice: 1980 }] },
    { shipmentID: 2, shipmentStatus: 1, consignee: { ...consignee, name: '架空 別子', phoneNumber: null }, shipmentItems: [{ itemName: '架空の部品', unitPrice: 0 }] },
    { shipmentID: 3, shipmentStatus: '2', consignee: {}, shipmentItems: [] },
  ],
}

await t('届け先は 6 項目だけ（email・id・country・注文者は返さない）', () => {
  const r = normalizeOrderConsignees(detail)!
  assert.deepEqual(r.shipments[0].consignee, { name: '架空 届子', postalCode: '530-0001', prefecture: '大阪府', city: '大阪市北区', townAndStreet: '梅田1-1 架空タワー 2001', phoneNumber: '06-0000-0000' })
  const s = JSON.stringify(r)
  for (const x of ['example.invalid', '架空 注文太郎', '丸の内', '03-0000-0000', '"id"', 'country']) assert.ok(!s.includes(x), x)
})
await t('出荷ごとに返す（並び・状態・商品名の重複を除く・0 円の出荷）', () => {
  const r = normalizeOrderConsignees(detail)!
  assert.deepEqual(r.shipments.map((s) => [s.index, s.shipmentStatus, s.items, s.allZeroPrice]), [[1, 5, ['架空のバッグ'], false], [2, 1, ['架空の部品'], true], [3, 2, [], false]])
})
await t('無い項目は null・届け先が空なら consignee は null（注文者で補わない）', () => {
  const r = normalizeOrderConsignees(detail)!
  assert.equal(r.shipments[1].consignee?.phoneNumber, null)
  assert.equal(r.shipments[2].consignee, null)
  assert.equal(normalizeOrderConsignees({ mallOrderNumber: 'x', buyer, shipments: [{ shipmentItems: [] }] })!.shipments[0].consignee, null)
})
await t('前後の空白は除き、数値の電話番号は文字列にする・形が違うものは null', () => {
  const r = normalizeOrderConsignees({ shipments: [{ consignee: { name: '  架空  ', phoneNumber: 312345678, city: 5, prefecture: '   ' } }] })!
  assert.deepEqual(r.shipments[0].consignee, { name: '架空', postalCode: null, prefecture: null, city: '5', townAndStreet: null, phoneNumber: '312345678' })
  assert.equal(normalizeOrderConsignees(null), null)
  assert.deepEqual(normalizeOrderConsignees({ shipments: 'x' })!.shipments, [])
})

const fakeFetch = (search: unknown, list: unknown, opts: { searchStatus?: number; listStatus?: number } = {}) => {
  const calls: string[] = []
  const f: FetchLike = async (url) => {
    calls.push(url.replace(/^.*\/BOSS-API/, ''))
    if (url.endsWith('/orders/search')) return { ok: (opts.searchStatus ?? 200) < 400, status: opts.searchStatus ?? 200, json: async () => search }
    return { ok: (opts.listStatus ?? 200) < 400, status: opts.listStatus ?? 200, json: async () => list }
  }
  return { f, calls }
}
const deps = (f: FetchLike) => ({ fetch: f, base: 'https://boss.example.invalid', accessToken: 'tok' })
await t('BOSS は search → list の読み取りだけ', async () => {
  const { f, calls } = fakeFetch([9], [detail])
  const r = await fetchOrderConsignees(deps(f), '372877-20260425-0147424025')
  assert.equal(r.ok, true)
  assert.deepEqual(calls, ['/v1/orders/search', '/v1/orders/list'])
})
await t('見つからない・複数・失敗・別の注文は届け先を返さない', async () => {
  assert.deepEqual(await fetchOrderConsignees(deps(fakeFetch([], null).f), 'A-1'), { ok: false, reason: 'not_found' })
  assert.deepEqual(await fetchOrderConsignees(deps(fakeFetch([1, 2], null).f), 'A-1'), { ok: false, reason: 'ambiguous' })
  assert.deepEqual(await fetchOrderConsignees(deps(fakeFetch(null, null, { searchStatus: 500 }).f), 'A-1'), { ok: false, reason: 'search_failed', status: 500 })
  assert.deepEqual(await fetchOrderConsignees(deps(fakeFetch([9], null, { listStatus: 429 }).f), 'A-1'), { ok: false, reason: 'detail_failed', status: 429 })
  assert.deepEqual(await fetchOrderConsignees(deps(fakeFetch([9], [detail]).f), 'OTHER-1'), { ok: false, reason: 'order_mismatch' })
})

// 入口: 鍵の分離と入力の確認（BOSS・KV へは行かない）
globalThis.fetch = (async () => { throw new Error('外部へ接続しようとした') }) as typeof fetch
const req = (headers: Record<string, string>, body: string) => new NextRequest('http://localhost/api/boss/order-consignees', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
const call = async (headers: Record<string, string>, body: string) => { const r = await POST(req(headers, body)); return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control') } }
const ORDER = JSON.stringify({ mallOrderNumber: '372877-20260425-0147424025' })
const quiet = async <T>(fn: () => Promise<T>) => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }

delete process.env.BOSS_CONSIGNEE_API_KEY
process.env.BOSS_PROXY_API_KEY = 'cs-key'
process.env.BOSS_INVENTORY_API_KEY = 'inv-key'
await t('届け先の鍵が未設定なら誰も通さない（503）', async () => assert.deepEqual((await quiet(() => call({ 'x-api-key': 'cs-key' }, ORDER))).body, { ok: false, reason: 'not_configured' }))
process.env.BOSS_CONSIGNEE_API_KEY = 'cs-key'
await t('届け先の鍵が CS 用の鍵と同じなら 503（取り違え）', async () => assert.equal((await quiet(() => call({ 'x-api-key': 'cs-key' }, ORDER))).status, 503))
process.env.BOSS_CONSIGNEE_API_KEY = 'inv-key'
await t('届け先の鍵が在庫の鍵と同じなら 503', async () => assert.equal((await quiet(() => call({ 'x-api-key': 'inv-key' }, ORDER))).status, 503))
process.env.BOSS_CONSIGNEE_API_KEY = 'consignee-key'
await t('CS 用の鍵（既存の利用先が持つ鍵）・在庫の鍵・鍵なし・違う鍵では 401', async () => {
  for (const h of [{ 'x-api-key': 'cs-key' }, { 'x-api-key': 'inv-key' }, {}, { 'x-api-key': 'consignee-kez' }]) assert.deepEqual((await call(h, ORDER)).body, { ok: false, reason: 'unauthorized' })
})
await t('正しい鍵でも JSON でない・注文番号の形が違えば 400（BOSS へは行かない）', async () => {
  assert.equal((await call({ 'x-api-key': 'consignee-key' }, 'x')).status, 400)
  for (const b of [{}, { mallOrderNumber: 1 }, { mallOrderNumber: '' }, { mallOrderNumber: 'a b' }, { mallOrderNumber: 'x'.repeat(65) }]) assert.deepEqual((await call({ 'x-api-key': 'consignee-key' }, JSON.stringify(b))).body, { ok: false, reason: 'mallOrderNumber_required' })
})
await t('応答に鍵の値を含めない', async () => assert.ok(!JSON.stringify(await call({ 'x-api-key': 'wrong' }, ORDER)).includes('consignee-key')))

// 失敗のときのログに届け先・注文番号を出さない（ソースの確認）
await t('ログは理由と HTTP の番号だけ', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync('app/api/boss/order-consignees/route.ts', 'utf8')
  const logs = [...src.matchAll(/console\.(?:warn|error|log)\(([^\n]*)\)/g)].map((m) => m[1])
  assert.equal(logs.length, 2)
  // 文字列（ログの見出し）を除いた、ログに渡す値だけを見る
  const values = logs.map((l) => l.replace(/'[^']*'/g, "''"))
  assert.ok(values.every((l) => !/mallOrderNumber|consignee|r\.order|req\b|body/.test(l)), values.join(' | '))
})
console.log(`\n${ok} 件 OK`)
