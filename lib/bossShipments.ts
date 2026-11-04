// BOSS の注文を出荷ごとに取り出す（読み取り専用）。交換・再送で増えた出荷（2 件目以降）も読めるようにする
//
// 既存の find-order は全出荷の商品を 1 つの items[] にまとめ、状態・伝票番号は最初の出荷だけを返す。
// こちらは find-order を変えずに、同じ BOSS API（orders/search → orders/list）から出荷ごとの情報を返す。
//
// 出荷 ID の項目名は BOSS の仕様書が無く未確認のため、候補の名前を順に探し、どの名前で見つかったかも返す。
// 知らない項目は「名前だけ」返す（値は返さない）。実際の応答の形を確かめてから、取り出す項目を確定する。
// 個人情報は返さない（購入者・配送先の氏名・住所・電話・メール）。配送先は照合に使う郵便番号だけ。
// BOSS への書き込みはしない。

export type BossShipmentItem = {
  itemName: string
  skuCode: string
  unitPrice: number | null
  quantity: number | null
}

export type BossShipment = {
  /** BOSS の応答の並び順（1 から） */
  index: number
  shipmentId: string | null
  /** shipmentId を見つけた項目名（未確認のため記録する） */
  shipmentIdKey: string | null
  shipmentStatus: string | null
  deliveryCompany: string | null
  deliveryNumber: string | null
  deliveryDate: string | null
  /** 配送先は照合に使う郵便番号だけ（氏名・住所・電話は返さない） */
  consignee: { postalCode: string | null }
  items: BossShipmentItem[]
  /** 明細がすべて 0 円（BOSS の「商品交換」で作られる出荷の特徴） */
  allZeroPrice: boolean
  /** 取り出していない項目の名前（値は返さない） */
  otherKeys: string[]
}

export type BossOrderShipments = {
  orderId: number | string
  mallOrderNumber: string | null
  orderStatus: string | null
  shipmentCount: number
  shipments: BossShipment[]
  /** 注文の項目のうち取り出していないものの名前（交換の印などを探すため。値は返さない） */
  otherOrderKeys: string[]
}

export const SHIPMENT_ID_KEYS = ['shipmentId', 'shipmentNo', 'shipmentNumber', 'shipmentCode', 'id'] as const

const KNOWN_SHIPMENT_KEYS = new Set<string>([
  ...SHIPMENT_ID_KEYS, 'shipmentStatus', 'resultDeliveryCompany', 'resultDeliveryNumber', 'resultDeliveryDate', 'consignee', 'shipmentItems',
])
const KNOWN_ORDER_KEYS = new Set<string>([
  'orderId', 'id', 'mallOrderNumber', 'orderStatus', 'shipments',
  // find-order が使っている項目（お客様の情報はここでは返さない）
  'buyer', 'price', 'mallOrderDateTime',
])

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function normalizeShipment(raw: unknown, index: number): BossShipment {
  const s = isObj(raw) ? raw : {}
  const idKey = SHIPMENT_ID_KEYS.find((k) => str(s[k]) != null) ?? null
  const c = isObj(s.consignee) ? s.consignee : {}
  const items = (Array.isArray(s.shipmentItems) ? s.shipmentItems : []).map((it) => {
    const i = isObj(it) ? it : {}
    return { itemName: str(i.itemName) ?? '', skuCode: str(i.skuCode) ?? '', unitPrice: num(i.unitPrice), quantity: num(i.quantity) }
  })
  return {
    index,
    shipmentId: idKey ? str(s[idKey]) : null,
    shipmentIdKey: idKey,
    shipmentStatus: str(s.shipmentStatus),
    deliveryCompany: str(s.resultDeliveryCompany),
    deliveryNumber: str(s.resultDeliveryNumber),
    deliveryDate: str(s.resultDeliveryDate),
    consignee: { postalCode: str(c.postalCode) },
    items,
    allZeroPrice: items.length > 0 && items.every((i) => i.unitPrice === 0),
    otherKeys: Object.keys(s).filter((k) => !KNOWN_SHIPMENT_KEYS.has(k)).sort(),
  }
}

export function normalizeOrderShipments(detail: unknown, orderId: number | string): BossOrderShipments | null {
  if (!isObj(detail)) return null
  const shipments = (Array.isArray(detail.shipments) ? detail.shipments : []).map((s, i) => normalizeShipment(s, i + 1))
  return {
    orderId,
    mallOrderNumber: str(detail.mallOrderNumber),
    orderStatus: str(detail.orderStatus),
    shipmentCount: shipments.length,
    shipments,
    otherOrderKeys: Object.keys(detail).filter((k) => !KNOWN_ORDER_KEYS.has(k)).sort(),
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>

export type ShipmentsResult =
  | { ok: true; order: BossOrderShipments }
  | { ok: false; reason: 'not_found' | 'ambiguous' | 'search_failed' | 'detail_failed' | 'detail_empty'; status?: number; orderIds?: Array<number | string> }

/** orders/search → orders/list（どちらも読み取り）。find-order と同じ呼び方 */
export async function fetchOrderShipments(deps: { fetch: FetchLike; base: string; accessToken: string }, mallOrderNumber: string): Promise<ShipmentsResult> {
  const headers = { Authorization: `Bearer ${deps.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' }
  const searchRes = await deps.fetch(`${deps.base}/BOSS-API/v1/orders/search`, { method: 'POST', headers, body: JSON.stringify({ mallOrderNumber }) })
  if (!searchRes.ok) return { ok: false, reason: 'search_failed', status: searchRes.status }
  const ids = (await searchRes.json()) as Array<number | string> | null
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, reason: 'not_found' }
  if (ids.length > 1) return { ok: false, reason: 'ambiguous', orderIds: ids }
  const detailRes = await deps.fetch(`${deps.base}/BOSS-API/v1/orders/list`, { method: 'POST', headers, body: JSON.stringify({ orders: [ids[0]] }) })
  if (!detailRes.ok) return { ok: false, reason: 'detail_failed', status: detailRes.status }
  const data = await detailRes.json()
  const order = normalizeOrderShipments(Array.isArray(data) ? data[0] : data, ids[0])
  if (!order) return { ok: false, reason: 'detail_empty' }
  return { ok: true, order }
}
