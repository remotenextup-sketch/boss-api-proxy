// 自己発送の依頼フォーム用: BOSS の注文の、出荷ごとの届け先（consignee）を返す（読み取り専用・保存しない・値をログに出さない）
//
// BOSS API 仕様書（GetOrder・POST /v1/orders/list）より:
//   shipments[].consignee = { id, name, country, postalCode, prefecture, city, townAndStreet, phoneNumber, email }
//   buyer（注文者）も同じ形だが、ここでは使わない（注文者の情報で届け先を補わない）
// 返すのは届け先の name・postalCode・prefecture・city・townAndStreet・phoneNumber だけ。email・id・country・buyer は返さない。
// 住所は BOSS で分かれた項目のまま返す（つないだり分け直したりしない）。
// 出荷が複数ある（交換・再送）ときは出荷ごとに返し、どれを使うかは呼び出し側（担当者）が選ぶ。

export type BossConsignee = {
  name: string | null
  postalCode: string | null
  prefecture: string | null
  city: string | null
  townAndStreet: string | null
  phoneNumber: string | null
}

export type BossShipmentConsignee = {
  /** BOSS の応答の並び順（1 から） */
  index: number
  /** BOSS の shipmentStatus（数値の区分。そのまま返す） */
  shipmentStatus: number | null
  /** 出荷を見分ける手がかり（商品名・最大 3 件） */
  items: string[]
  /** 明細がすべて 0 円（交換・再送の出荷の特徴。断定はしない） */
  allZeroPrice: boolean
  /** 届け先が無い・項目がすべて空なら null */
  consignee: BossConsignee | null
}

export type BossOrderConsignees = {
  mallOrderNumber: string | null
  shipments: BossShipmentConsignee[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/**
 * 文字列は前後の空白を除く。空・空白だけ・文字列でないもの（数値の電話番号などは文字列にする）は null。
 * 届け先は切り詰めない（短くした住所が正しい住所に見えないように。長さの確認は呼び出し側の入力の決まりで行う）。
 * 1000 文字を超えるものは壊れた値とみなして null
 */
const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
  return s && s.length <= 1000 ? s : null
}
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : null)

export function normalizeConsignee(raw: unknown): BossConsignee | null {
  if (!isObj(raw)) return null
  const c: BossConsignee = {
    name: text(raw.name),
    postalCode: text(raw.postalCode),
    prefecture: text(raw.prefecture),
    city: text(raw.city),
    townAndStreet: text(raw.townAndStreet),
    phoneNumber: text(raw.phoneNumber),
  }
  return Object.values(c).some((v) => v !== null) ? c : null
}

export function normalizeOrderConsignees(detail: unknown): BossOrderConsignees | null {
  if (!isObj(detail)) return null
  const shipments = (Array.isArray(detail.shipments) ? detail.shipments : []).map((raw, i): BossShipmentConsignee => {
    const s = isObj(raw) ? raw : {}
    const items = (Array.isArray(s.shipmentItems) ? s.shipmentItems : []).filter(isObj)
    // 商品名は出荷を見分ける手がかり（個人情報ではない）なので短くしてよい
    const names = [...new Set(items.map((it) => text(it.itemName)?.slice(0, 60) ?? null).filter((n): n is string => !!n))].slice(0, 3)
    return {
      index: i + 1,
      shipmentStatus: int(s.shipmentStatus),
      items: names,
      allZeroPrice: items.length > 0 && items.every((it) => it.unitPrice === 0),
      consignee: normalizeConsignee(s.consignee),
    }
  })
  return { mallOrderNumber: text(detail.mallOrderNumber), shipments }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export type ConsigneesResult =
  | { ok: true; order: BossOrderConsignees }
  | { ok: false; reason: 'not_found' | 'ambiguous' | 'search_failed' | 'detail_failed' | 'detail_empty' | 'order_mismatch'; status?: number }

/** orders/search → orders/list（どちらも読み取り。order-shipments と同じ呼び方） */
export async function fetchOrderConsignees(deps: { fetch: FetchLike; base: string; accessToken: string }, mallOrderNumber: string): Promise<ConsigneesResult> {
  const headers = { Authorization: `Bearer ${deps.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' }
  const searchRes = await deps.fetch(`${deps.base}/BOSS-API/v1/orders/search`, { method: 'POST', headers, body: JSON.stringify({ mallOrderNumber }) })
  if (!searchRes.ok) return { ok: false, reason: 'search_failed', status: searchRes.status }
  const ids = (await searchRes.json()) as Array<number | string> | null
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, reason: 'not_found' }
  if (ids.length > 1) return { ok: false, reason: 'ambiguous' }
  const detailRes = await deps.fetch(`${deps.base}/BOSS-API/v1/orders/list`, { method: 'POST', headers, body: JSON.stringify({ orders: [ids[0]] }) })
  if (!detailRes.ok) return { ok: false, reason: 'detail_failed', status: detailRes.status }
  const data = await detailRes.json()
  const raw = Array.isArray(data) ? data[0] : data
  const order = normalizeOrderConsignees(raw)
  if (!order) return { ok: false, reason: 'detail_empty' }
  // 求めた注文と完全に同じ注文番号のときだけ届け先を返す（番号が無い・空・違う・切り詰めると同じ、はどれも返さない）
  const upstream = isObj(raw) && typeof raw.mallOrderNumber === 'string' ? raw.mallOrderNumber.trim() : null
  if (upstream === null || upstream !== mallOrderNumber) return { ok: false, reason: 'order_mismatch' }
  return { ok: true, order: { ...order, mallOrderNumber: upstream } }
}
