// 楽天 RMS ItemAPI 2.0 items.search から、価格調査に要る項目だけを取り出す（読み取り専用）
//
// 公式仕様（RMS WEB SERVICE : items.search、2026-10-30 確認）
//   GET https://api.rms.rakuten.co.jp/es/2.0/items/search  Authorization: ESA Base64(serviceSecret:licenseKey)
//   hits: 1〜100（既定 10）。全件は cursorMark=* から nextCursorMark を渡し、渡した値と同じ値が返ったら終わり
//   results[].item: manageNumber（商品管理番号）・itemNumber（商品番号）・title（商品名）・hideItem（倉庫）・itemType
//   item.variants.{variantId}: merchantDefinedSkuId・standardPrice（販売価格。資料の例は文字列と数値の両方）・
//                              articleNumber.value（カタログID=JAN 等）・articleNumber.exemptionReason・hidden・selectorValues
//   削除済みで検索に残っている商品は manageNumber だけが返る。登録・削除の反映は最大 24 時間
//   秒間最大リクエスト数: items.search は 5（ItemAPI 2.0 の制約事項）
// このファイルは外部に依存しない（テストから直接読み込む）

export type SkuPrice = {
  variantId: string
  merchantDefinedSkuId: string | null
  /** articleNumber.value（JAN などのカタログID）。無ければ null */
  jan: string | null
  /** カタログIDなしの理由（1 セット商品・2 サービス商品・3 店舗オリジナル・4 項目選択肢在庫・5 該当なし・6 頒布会） */
  janExemptionReason: number | null
  standardPrice: number | null
  hidden: boolean | null
  selectorValues: Record<string, string>
}

export type ItemPrice = {
  manageNumber: string
  itemNumber: string | null
  title: string | null
  itemType: string | null
  hideItem: boolean | null
  /** 削除済みで、検索情報にまだ残っている（manageNumber だけ返る） */
  deleted: boolean
  skus: SkuPrice[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/** items.search の応答 1 ページ分を、価格調査の形にする（説明文・画像などは捨てる） */
export function pickItemPrices(page: unknown): ItemPrice[] {
  const results = (page as { results?: unknown })?.results
  if (!Array.isArray(results)) return []
  const out: ItemPrice[] = []
  for (const r of results) {
    // items.search は results[].item、items.bulk.get は results[] がそのまま商品
    const item = ((r as { item?: unknown })?.item ?? r) as Record<string, unknown> | null
    const manageNumber = str(item?.manageNumber)
    if (!item || !manageNumber) continue
    const variants = item.variants && typeof item.variants === 'object' ? (item.variants as Record<string, Record<string, unknown>>) : null
    const deleted = !variants && item.title === undefined
    const skus: SkuPrice[] = []
    for (const [variantId, v] of Object.entries(variants ?? {})) {
      const article = (v?.articleNumber ?? null) as { value?: unknown; exemptionReason?: unknown } | null
      const selectors = v?.selectorValues && typeof v.selectorValues === 'object' ? (v.selectorValues as Record<string, unknown>) : {}
      skus.push({
        variantId,
        merchantDefinedSkuId: str(v?.merchantDefinedSkuId),
        jan: str(article?.value),
        janExemptionReason: num(article?.exemptionReason),
        standardPrice: num(v?.standardPrice),
        hidden: bool(v?.hidden),
        selectorValues: Object.fromEntries(Object.entries(selectors).filter(([, x]) => typeof x === 'string')) as Record<string, string>,
      })
    }
    out.push({ manageNumber, itemNumber: str(item.itemNumber), title: str(item.title), itemType: str(item.itemType), hideItem: bool(item.hideItem), deleted, skus })
  }
  return out
}

export class RmsError extends Error {
  constructor(readonly status: number, readonly codes: string[], message: string) {
    super(message)
  }
}

export type FetchAllDeps = {
  fetch: (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
  authorization: string
  sleep?: (ms: number) => Promise<void>
  /** 1 回あたりの件数（1〜100） */
  hits?: number
  /** ページの上限（暴走防止） */
  maxPages?: number
  /** 呼び出しの間隔。items.search は秒間 5 回まで → 既定 300ms */
  intervalMs?: number
  endpoint?: string
}

export const RMS_ITEMS_SEARCH = 'https://api.rms.rakuten.co.jp/es/2.0/items/search'

/** cursorMark で全件を取る。nextCursorMark が渡した値と同じになったら終わり */
export async function fetchAllItemPrices(deps: FetchAllDeps): Promise<{ items: ItemPrice[]; numFound: number | null; apiCalls: number; truncated: boolean }> {
  const hits = Math.min(Math.max(deps.hits ?? 100, 1), 100)
  const maxPages = Math.max(deps.maxPages ?? 50, 1)
  const interval = deps.intervalMs ?? 300
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const items: ItemPrice[] = []
  let cursor = '*'
  let numFound: number | null = null
  let apiCalls = 0
  for (let page = 0; page < maxPages; page++) {
    if (apiCalls > 0) await sleep(interval)
    const url = `${deps.endpoint ?? RMS_ITEMS_SEARCH}?${new URLSearchParams({ hits: String(hits), cursorMark: cursor })}`
    const res = await deps.fetch(url, { headers: { Authorization: deps.authorization, Accept: 'application/json' } })
    apiCalls++
    const body = (await res.json().catch(() => null)) as { numFound?: unknown; nextCursorMark?: unknown; errors?: Array<{ code?: unknown; message?: unknown }> } | null
    if (!res.ok) {
      const errs = Array.isArray(body?.errors) ? body!.errors! : []
      throw new RmsError(res.status, errs.map((e) => String(e.code ?? '')).filter(Boolean), errs.map((e) => String(e.message ?? '')).filter(Boolean).join(' / ') || `RMS ${res.status}`)
    }
    numFound = num(body?.numFound)
    items.push(...pickItemPrices(body))
    const next = str(body?.nextCursorMark)
    if (!next || next === cursor) return { items, numFound, apiCalls, truncated: false }
    cursor = next
  }
  return { items, numFound, apiCalls, truncated: true }
}
