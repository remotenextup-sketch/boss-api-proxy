// 楽天の全商品の SKU 単位の販売価格・JAN（価格調査用・読み取り専用）
//   GET /api/boss/items/prices?hits=100&maxPages=50   x-api-key: BOSS_PROXY_API_KEY（既存の入口と同じ）
//   → { ok, fetchedAt, numFound, itemCount, skuCount, apiCalls, truncated, items: ItemPrice[] }
// RMS ItemAPI 2.0 items.search を cursorMark で全件取る（lib/rmsItemPrices.ts）。商品の更新はしない。
// 既存の問い合わせ・BOSS の処理とは独立（このファイルと lib/rmsItemPrices.ts だけ）。ESA 認証の値は応答・ログに出さない
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { requireProxyApiKey } from '@/lib/proxyAuth'
import { fetchAllItemPrices, RmsError } from '@/lib/rmsItemPrices'

function esaAuthorization(): string | null {
  const serviceSecret = process.env.RAKUTEN_SERVICE_SECRET?.trim()
  const licenseKey = process.env.RAKUTEN_LICENSE_KEY?.trim()
  if (!serviceSecret || !licenseKey) return null
  return 'ESA ' + Buffer.from(`${serviceSecret}:${licenseKey}`, 'utf-8').toString('base64')
}

const intParam = (v: string | null, def: number, min: number, max: number) => {
  const n = v && /^\d{1,4}$/.test(v) ? Number(v) : def
  return Math.min(Math.max(n, min), max)
}

export async function GET(req: NextRequest) {
  const denied = requireProxyApiKey(req)
  if (denied) return denied

  const authorization = esaAuthorization()
  if (!authorization) return NextResponse.json({ ok: false, reason: 'rms_not_configured' }, { status: 503 })

  const hits = intParam(req.nextUrl.searchParams.get('hits'), 100, 1, 100)
  const maxPages = intParam(req.nextUrl.searchParams.get('maxPages'), 50, 1, 100)
  const started = Date.now()
  try {
    const r = await fetchAllItemPrices({ fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }), authorization, hits, maxPages })
    const skuCount = r.items.reduce((n, i) => n + i.skus.length, 0)
    console.info('[items/prices]', JSON.stringify({ items: r.items.length, skus: skuCount, apiCalls: r.apiCalls, truncated: r.truncated, ms: Date.now() - started }))
    return NextResponse.json({ ok: true, fetchedAt: new Date().toISOString(), numFound: r.numFound, itemCount: r.items.length, skuCount, apiCalls: r.apiCalls, truncated: r.truncated, items: r.items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if (e instanceof RmsError) {
      console.error('[items/prices] RMS error', JSON.stringify({ status: e.status, codes: e.codes }))
      return NextResponse.json({ ok: false, reason: 'rms_error', status: e.status, codes: e.codes, message: e.message }, { status: 502 })
    }
    console.error('[items/prices] failed', (e as Error).name)
    return NextResponse.json({ ok: false, reason: 'fetch_failed' }, { status: 502 })
  }
}
