// lib/bossShipments.ts のテスト（BOSS へは接続しない）。npx tsx scripts/test-boss-shipments.ts
import assert from 'node:assert/strict'
import { normalizeOrderShipments, fetchOrderShipments, type FetchLike } from '../lib/bossShipments'

let ok = 0
const t = async (name: string, fn: () => unknown) => { await fn(); ok++; console.log('OK', name) }

// find-order が読んでいる項目と同じ名前で作った、交換後の注文（元の出荷 + 0 円の交換出荷）
const consignee = { name: '山田 太郎', postalCode: '123-4567', prefecture: '東京都', city: '新宿区', townAndStreet: '1-2-3', phone: '090-0000-0000' }
const exchangeOrder = {
  orderId: 101, mallOrderNumber: '372877-20260425-0147424025', orderStatus: '交換対応中',
  buyer: { name: '山田 太郎', email: 'a@example.com' }, price: { totalPrice: 5780 }, mallOrderDateTime: '2026-04-25T10:00:00',
  exchangeFlag: true,
  shipments: [
    { shipmentId: 9001, shipmentStatus: '出荷済', resultDeliveryCompany: 'ヤマト', resultDeliveryNumber: '1111', resultDeliveryDate: '2026-04-27', consignee, shipmentItems: [{ itemName: 'マット', skuCode: '0930', unitPrice: 5780, quantity: 1 }], warehouse: 'RSL' },
    { shipmentId: 9002, shipmentStatus: '在庫引当済', consignee, shipmentItems: [{ itemName: 'マット', skuCode: '0930', unitPrice: 0, quantity: 1 }], warehouse: 'RSL', exchange: true },
  ],
}

await t('出荷ごとに状態・伝票番号・明細を分けて返す（2 件目の交換出荷も読める）', () => {
  const o = normalizeOrderShipments(exchangeOrder, 101)!
  assert.equal(o.shipmentCount, 2)
  assert.equal(o.orderStatus, '交換対応中')
  assert.deepEqual(o.shipments.map((s) => [s.index, s.shipmentId, s.shipmentStatus, s.deliveryNumber, s.allZeroPrice]), [[1, '9001', '出荷済', '1111', false], [2, '9002', '在庫引当済', null, true]])
  assert.deepEqual(o.shipments[1].items, [{ itemName: 'マット', skuCode: '0930', unitPrice: 0, quantity: 1 }])
  assert.deepEqual(o.shipments[0].consignee, { postalCode: '123-4567' })
})
await t('出荷 ID の項目名を記録する（名前が違っても候補から探す）', () => {
  const o = normalizeOrderShipments({ shipments: [{ shipmentNo: 'S-1', shipmentItems: [] }, { id: 7, shipmentItems: [] }, { shipmentItems: [] }] }, 1)!
  assert.deepEqual(o.shipments.map((s) => [s.shipmentId, s.shipmentIdKey]), [['S-1', 'shipmentNo'], ['7', 'id'], [null, null]])
})
await t('BOSS の実際の項目名 shipmentID（ID が大文字）を出荷 ID として読む', () => {
  const o = normalizeOrderShipments({ orderID: 5, shipments: [{ shipmentID: 777, shipmentItems: [] }] }, 5)!
  assert.deepEqual([o.shipments[0].shipmentId, o.shipments[0].shipmentIdKey, o.otherOrderKeys], ['777', 'shipmentID', []])
})
await t('知らない項目は名前だけ返し、値は返さない（交換の印を探すため）', () => {
  const o = normalizeOrderShipments(exchangeOrder, 101)!
  assert.deepEqual(o.otherOrderKeys, ['exchangeFlag'])
  assert.deepEqual(o.shipments[1].otherKeys, ['exchange', 'warehouse'])
  const s = JSON.stringify(o)
  assert.ok(!s.includes('RSL') && !s.includes('a@example.com') && !s.includes('090-0000-0000'), '購入者のメール・電話・知らない項目の値は出さない')
})
await t('明細が無い出荷は 0 円扱いにしない・壊れた応答は null', () => {
  const o = normalizeOrderShipments({ shipments: [{ shipmentItems: [] }] }, 1)!
  assert.equal(o.shipments[0].allZeroPrice, false)
  assert.equal(normalizeOrderShipments(null, 1), null)
  assert.equal(normalizeOrderShipments({}, 1)!.shipmentCount, 0)
})
await t('数量・単価が文字列でも数として読む', () => {
  const o = normalizeOrderShipments({ shipments: [{ shipmentItems: [{ skuCode: 'A', unitPrice: '0', quantity: '2' }] }] }, 1)!
  assert.deepEqual(o.shipments[0].items[0], { itemName: '', skuCode: 'A', unitPrice: 0, quantity: 2 })
  assert.equal(o.shipments[0].allZeroPrice, true)
})

// ── shippingRequestNo（RSL の出荷依頼番号の有力候補）。番号はすべて架空 ──
const RSL_FORMAT = /^A[0-9]{11}$/
await t('shippingRequestNo: 値をそのまま返す（A＋数字11桁の形式の値）', () => {
  const o = normalizeOrderShipments({ shipments: [{ shipmentID: 1, shipmentStatus: '出荷中', shippingRequestNo: 'A00000000001', shipmentItems: [] }] }, 1)!
  assert.equal(o.shipments[0].shippingRequestNo, 'A00000000001')
  assert.ok(RSL_FORMAT.test(o.shipments[0].shippingRequestNo!))
})
await t('shippingRequestNo: 無い・null・空・空白だけは null（架空の値を作らない）', () => {
  const o = normalizeOrderShipments({ shipments: [{ shipmentItems: [] }, { shippingRequestNo: null, shipmentItems: [] }, { shippingRequestNo: '', shipmentItems: [] }, { shippingRequestNo: '   ', shipmentItems: [] }, { shippingRequestNo: {}, shipmentItems: [] }] }, 1)!
  assert.deepEqual(o.shipments.map((x) => x.shippingRequestNo), [null, null, null, null, null])
})
await t('shippingRequestNo: 形式に合わない値も書き換えず返す（前後の空白だけ除く。数は文字列に）。形式の判定は使う側', () => {
  const o = normalizeOrderShipments({ shipments: [
    { shippingRequestNo: ' A00000000002 ', shipmentItems: [] },
    { shippingRequestNo: 'B00000000003', shipmentItems: [] },
    { shippingRequestNo: 'A123', shipmentItems: [] },
    { shippingRequestNo: 12345, shipmentItems: [] },
    { shippingRequestNo: 'a00000000004', shipmentItems: [] },
  ] }, 1)!
  const v = o.shipments.map((x) => x.shippingRequestNo)
  assert.deepEqual(v, ['A00000000002', 'B00000000003', 'A123', '12345', 'a00000000004'])
  assert.deepEqual(v.map((x) => RSL_FORMAT.test(x ?? '')), [true, false, false, false, false])
})
await t('shippingRequestNo: 数は安全な整数だけ文字列にし、NaN・Infinity・範囲外・小数は null（桁が崩れた番号を返さない）', () => {
  const o = normalizeOrderShipments({ shipments: [
    { shipmentID: 31, shippingRequestNo: 0, shipmentItems: [] },
    { shipmentID: 32, shippingRequestNo: Number.MAX_SAFE_INTEGER, shipmentItems: [] },
    { shipmentID: 33, shippingRequestNo: -7, shipmentItems: [] },
    { shipmentID: 34, shippingRequestNo: Number.NaN, shipmentItems: [] },
    { shipmentID: 35, shippingRequestNo: Number.POSITIVE_INFINITY, shipmentItems: [] },
    { shipmentID: 36, shippingRequestNo: Number.NEGATIVE_INFINITY, shipmentItems: [] },
    { shipmentID: 37, shippingRequestNo: Number.MAX_SAFE_INTEGER + 2, shipmentItems: [] },
    { shipmentID: 38, shippingRequestNo: 1e21, shipmentItems: [] },
    { shipmentID: 39, shippingRequestNo: 12.5, shipmentItems: [] },
    { shipmentID: 40, shippingRequestNo: true, shipmentItems: [] },
    { shipmentID: 41, shippingRequestNo: ['A00000000041'], shipmentItems: [] },
  ] }, 1)!
  assert.deepEqual(o.shipments.map((x) => [x.shipmentId, x.shippingRequestNo]), [
    ['31', '0'], ['32', '9007199254740991'], ['33', '-7'],
    ['34', null], ['35', null], ['36', null], ['37', null], ['38', null], ['39', null], ['40', null], ['41', null],
  ])
  // 異常な値でも、ほかの出荷の番号・ID はずれない
  assert.equal(o.shipments.length, 11)
  assert.ok(!JSON.stringify(o).includes('NaN') && !JSON.stringify(o).includes('Infinity'))
})
await t('shippingRequestNo: 複数の出荷で、番号と出荷の状態・ID・0 円の印の対応が崩れない', () => {
  const o = normalizeOrderShipments({ shipments: [
    { shipmentID: 11, shipmentStatus: '出荷済', shippingRequestNo: 'A00000000011', shipmentItems: [{ skuCode: 'X', unitPrice: 1000, quantity: 1 }] },
    { shipmentID: 12, shipmentStatus: '出荷中', shippingRequestNo: 'A00000000012', shipmentItems: [{ skuCode: 'X', unitPrice: 0, quantity: 1 }] },
    { shipmentID: 13, shipmentStatus: '在庫引当中', shippingRequestNo: null, shipmentItems: [{ skuCode: 'P', unitPrice: 0, quantity: 1 }] },
  ] }, 1)!
  assert.deepEqual(o.shipments.map((x) => [x.index, x.shipmentId, x.shipmentStatus, x.shippingRequestNo, x.allZeroPrice]), [
    [1, '11', '出荷済', 'A00000000011', false],
    [2, '12', '出荷中', 'A00000000012', true],
    [3, '13', '在庫引当中', null, true],
  ])
  assert.equal(new Set(o.shipments.map((x) => x.shippingRequestNo).filter(Boolean)).size, 2)
})
await t('shippingRequestNo: 名前だけの一覧（otherKeys）から外れ、ほかの知らない項目は今までどおり名前だけ', () => {
  const o = normalizeOrderShipments({ shipments: [{ shippingRequestNo: 'A00000000021', shippingRequestedDateTime: '2026-11-18T10:00:00', warehouse: 'RSL', shipmentItems: [] }] }, 1)!
  assert.deepEqual(o.shipments[0].otherKeys, ['shippingRequestedDateTime', 'warehouse'])
  const json = JSON.stringify(o)
  assert.ok(!json.includes('2026-11-18T10:00:00') && !json.includes('RSL'), 'ほかの知らない項目の値は今までどおり出さない')
})

// ── 取得の流れ（fetch はモック。送ったのは読み取りの 2 つだけか） ──
const mockFetch = (search: unknown, detail: unknown, opts: { searchStatus?: number; detailStatus?: number } = {}) => {
  const calls: Array<{ url: string; method: string; body: string }> = []
  const f: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body })
    const isSearch = url.endsWith('/orders/search')
    const status = (isSearch ? opts.searchStatus : opts.detailStatus) ?? 200
    return { ok: status < 400, status, json: async () => (isSearch ? search : detail), text: async () => '' }
  }
  return { f, calls }
}
const deps = (f: FetchLike) => ({ fetch: f, base: 'https://boss.example', accessToken: 'tkn' })

await t('検索 → 詳細の 2 回だけ呼ぶ（どちらも読み取りの API）', async () => {
  const m = mockFetch([101], [exchangeOrder])
  const r = await fetchOrderShipments(deps(m.f), '372877-20260425-0147424025')
  assert.ok(r.ok && r.order.shipmentCount === 2)
  assert.deepEqual(m.calls.map((c) => c.url), ['https://boss.example/BOSS-API/v1/orders/search', 'https://boss.example/BOSS-API/v1/orders/list'])
  assert.deepEqual(JSON.parse(m.calls[1].body), { orders: [101] })
})
await t('見つからない・複数・失敗はそれぞれの理由で返す', async () => {
  assert.deepEqual(await fetchOrderShipments(deps(mockFetch([], null).f), 'x'), { ok: false, reason: 'not_found' })
  assert.deepEqual(await fetchOrderShipments(deps(mockFetch([1, 2], null).f), 'x'), { ok: false, reason: 'ambiguous', orderIds: [1, 2] })
  assert.deepEqual(await fetchOrderShipments(deps(mockFetch(null, null, { searchStatus: 500 }).f), 'x'), { ok: false, reason: 'search_failed', status: 500 })
  assert.deepEqual(await fetchOrderShipments(deps(mockFetch([1], null, { detailStatus: 401 }).f), 'x'), { ok: false, reason: 'detail_failed', status: 401 })
  assert.deepEqual(await fetchOrderShipments(deps(mockFetch([1], []).f), 'x'), { ok: false, reason: 'detail_empty' })
})

console.log(`\n${ok} 件 OK`)
