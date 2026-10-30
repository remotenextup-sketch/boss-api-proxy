// lib/rmsItemPrices.ts のテスト（RMS へは接続しない）。npx tsx scripts/test-rms-item-prices.ts
import assert from 'node:assert/strict'
import { pickItemPrices, fetchAllItemPrices, RmsError } from '../lib/rmsItemPrices'

let ok = 0
const t = async (name: string, fn: () => unknown) => { await fn(); ok++; console.log('OK', name) }

// items.search の公式サンプルの形（standardPrice は文字列）
const searchPage = (cursorIn: string, next: string, items: unknown[]) => ({ numFound: 3, offset: 0, nextCursorMark: next, results: items.map((item) => ({ item })), _cursor: cursorIn })
const itemA = {
  manageNumber: 'mng-a', itemNumber: '2100011223431', title: 'テスト商品A', itemType: 'NORMAL', hideItem: false,
  productDescription: { pc: '長い説明文' }, images: [{ location: '/x.jpg' }],
  variants: {
    'sku-1': { merchantDefinedSkuId: '112233', selectorValues: { 'size-key': 'Lサイズ', bad: 1 }, standardPrice: '1980', hidden: false, articleNumber: { value: '4571234567890' }, referencePrice: { value: 3000 } },
    'sku-2': { selectorValues: { 'size-key': 'Mサイズ' }, standardPrice: 1680, hidden: true, articleNumber: { exemptionReason: '3' } },
  },
}
const deletedItem = { manageNumber: 'mng-del' }

await t('SKU 単位で JAN・価格・商品管理番号を取り出す（文字列・数値の価格どちらも）', () => {
  const [a] = pickItemPrices(searchPage('*', 'c1', [itemA]))
  assert.equal(a.manageNumber, 'mng-a'); assert.equal(a.itemNumber, '2100011223431'); assert.equal(a.title, 'テスト商品A'); assert.equal(a.deleted, false)
  assert.deepEqual(a.skus[0], { variantId: 'sku-1', merchantDefinedSkuId: '112233', jan: '4571234567890', janExemptionReason: null, standardPrice: 1980, hidden: false, selectorValues: { 'size-key': 'Lサイズ' } })
  assert.deepEqual(a.skus[1], { variantId: 'sku-2', merchantDefinedSkuId: null, jan: null, janExemptionReason: 3, standardPrice: 1680, hidden: true, selectorValues: { 'size-key': 'Mサイズ' } })
})
await t('説明文・画像・表示価格は応答に含めない', () => {
  const s = JSON.stringify(pickItemPrices(searchPage('*', 'c1', [itemA])))
  assert.ok(!s.includes('長い説明文') && !s.includes('/x.jpg') && !s.includes('3000'))
})
await t('削除済み（manageNumber だけ）は deleted・SKU なし', () => {
  const [d] = pickItemPrices(searchPage('*', 'c1', [deletedItem]))
  assert.equal(d.deleted, true); assert.deepEqual(d.skus, [])
})
await t('items.bulk.get の形（results[] が商品そのもの）も読める', () => {
  const [a] = pickItemPrices({ results: [itemA] })
  assert.equal(a.skus.length, 2)
})
await t('壊れた応答は空', () => {
  assert.deepEqual(pickItemPrices(null), []); assert.deepEqual(pickItemPrices({ results: [{ item: { title: 'x' } }] }), [])
})

function fakeFetch(pages: Record<string, unknown>, calls: string[], status = 200) {
  return async (url: string, init: { headers: Record<string, string> }) => {
    calls.push(url); assert.equal(init.headers.Authorization, 'ESA dummy')
    const cursor = new URL(url).searchParams.get('cursorMark')!
    return { ok: status === 200, status, json: async () => pages[cursor] }
  }
}
await t('cursorMark で全ページを取り、同じ値が返ったら止まる・間隔を空ける', async () => {
  const calls: string[] = []; const sleeps: number[] = []
  const pages = { '*': searchPage('*', 'c1', [itemA]), c1: searchPage('c1', 'c2', [deletedItem]), c2: searchPage('c2', 'c2', []) }
  const r = await fetchAllItemPrices({ fetch: fakeFetch(pages, calls), authorization: 'ESA dummy', sleep: async (ms) => { sleeps.push(ms) } })
  assert.equal(r.apiCalls, 3); assert.equal(r.items.length, 2); assert.equal(r.truncated, false); assert.equal(r.numFound, 3)
  assert.deepEqual(sleeps, [300, 300])
  assert.ok(calls.every((u) => u.startsWith('https://api.rms.rakuten.co.jp/es/2.0/items/search?hits=100&cursorMark=')))
  assert.ok(calls.every((u) => !u.includes('sortKey') && !u.includes('offset')))
})
await t('maxPages で止まったら truncated', async () => {
  const pages = { '*': searchPage('*', 'c1', [itemA]), c1: searchPage('c1', 'c2', []) }
  const r = await fetchAllItemPrices({ fetch: fakeFetch(pages, []), authorization: 'ESA dummy', sleep: async () => {}, maxPages: 1 })
  assert.equal(r.truncated, true); assert.equal(r.apiCalls, 1)
})
await t('RMS のエラーはコードとメッセージだけ（認証の値は含めない）', async () => {
  const pages = { '*': { errors: [{ code: 'GE0014', message: 'Unauthorized' }] } }
  await assert.rejects(fetchAllItemPrices({ fetch: fakeFetch(pages, [], 401), authorization: 'ESA dummy', sleep: async () => {} }), (e: unknown) => {
    assert.ok(e instanceof RmsError); assert.equal(e.status, 401); assert.deepEqual(e.codes, ['GE0014'])
    assert.ok(!JSON.stringify({ m: e.message, c: e.codes }).includes('dummy')); return true
  })
})
console.log(`${ok} OK`)
