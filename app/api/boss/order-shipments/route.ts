// BOSS の注文を出荷ごとに返す（読み取り専用・交換や再送で増えた出荷の確認用）
//   POST /api/boss/order-shipments  { mallOrderNumber }   x-api-key: BOSS_PROXY_API_KEY（既存の入口と同じ）
//   → { ok, order: { orderId, mallOrderNumber, orderStatus, shipmentCount, shipments[], otherOrderKeys } }
// 既存の find-order は変えない（今の画面・取り込みはそのまま）。BOSS への書き込みはしない。保存もしない
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getValidBossAccessToken } from '@/lib/bossToken'
import { requireProxyApiKey } from '@/lib/proxyAuth'
import { fetchOrderShipments, type FetchLike } from '@/lib/bossShipments'

export async function POST(req: NextRequest) {
  const denied = requireProxyApiKey(req)
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
    const r = await fetchOrderShipments({ fetch: ((url, init) => fetch(url, { ...init, cache: 'no-store' })) as FetchLike, base, accessToken }, mallOrderNumber)
    if (!r.ok) {
      console.warn('[order-shipments]', JSON.stringify({ reason: r.reason, status: r.status ?? null }))
      const status = r.reason === 'search_failed' || r.reason === 'detail_failed' ? 502 : 200
      return NextResponse.json(r, { status, headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[order-shipments] failed', (e as Error).name)
    return NextResponse.json({ ok: false, reason: 'internal_error' }, { status: 500 })
  }
}
