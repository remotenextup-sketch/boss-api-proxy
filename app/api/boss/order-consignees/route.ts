// 自己発送の依頼フォーム用: BOSS の注文の、出荷ごとの届け先（氏名・郵便番号・住所 3 項目・電話番号）を返す（読み取り専用）
//   POST /api/boss/order-consignees  { mallOrderNumber }   x-api-key: BOSS_CONSIGNEE_API_KEY（この口だけの鍵）
//   → { ok, order: { mallOrderNumber, shipments: [{ index, shipmentStatus, items, allZeroPrice, consignee }] } }
// 既存の find-order・order-shipments は変えない。BOSS への書き込み・保存はしない。届け先の値はログに出さない
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getValidBossAccessToken } from '@/lib/bossToken'
import { requireConsigneeApiKey } from '@/lib/consigneeAuth'
import { fetchOrderConsignees, type FetchLike } from '@/lib/bossConsignees'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  const denied = requireConsigneeApiKey(req)
  if (denied) return denied

  let mallOrderNumber: unknown
  try {
    ;({ mallOrderNumber } = await req.json())
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 400 })
  }
  if (typeof mallOrderNumber !== 'string' || !/^[0-9A-Za-z-]{1,64}$/.test(mallOrderNumber)) {
    return NextResponse.json({ ok: false, reason: 'mallOrderNumber_required' }, { status: 400 })
  }

  try {
    const accessToken = await getValidBossAccessToken()
    const base = process.env.BOSS_API_BASE_URL!
    const r = await fetchOrderConsignees({ fetch: ((url, init) => fetch(url, { ...init, cache: 'no-store' })) as FetchLike, base, accessToken }, mallOrderNumber)
    if (!r.ok) {
      // 理由と HTTP の番号だけ（注文番号・届け先の値は出さない）
      console.warn('[order-consignees]', JSON.stringify({ reason: r.reason, status: r.status ?? null }))
      const status = r.reason === 'search_failed' || r.reason === 'detail_failed' ? 502 : 200
      return NextResponse.json(r, { status, headers: NO_STORE })
    }
    return NextResponse.json(r, { headers: NO_STORE })
  } catch (e) {
    console.error('[order-consignees] failed', (e as Error).name)
    return NextResponse.json({ ok: false, reason: 'internal_error' }, { status: 500, headers: NO_STORE })
  }
}
