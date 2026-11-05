// BOSS の在庫を 1 ページだけ返す（読み取り専用）
//   GET /api/boss/inventory?page=1&pageSize=500[&from=…&to=…][&zeroInventory=…][&isInactive=…][&restockThreshold=…][&warehouseIds=1,2]
//   x-api-key: BOSS_INVENTORY_API_KEY（CS 用の BOSS_PROXY_API_KEY では通らない。逆に、この鍵では既存の口を通らない）
// 全ページを順に取るのは呼ぶ側（hasNext を見て page を進める）。この口は待たない・再試行しない。
// BOSS へは GET /BOSS-API/v1/inventory/list だけを呼ぶ。在庫を変える API は呼ばない。トークンは既存の lib/bossToken を使う
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getValidBossAccessToken, BossTokenError } from '@/lib/bossToken'
import { requireInventoryApiKey } from '@/lib/inventoryAuth'
import { fetchInventoryPage, parseInventoryQuery, type FetchLike } from '@/lib/bossInventory'
import {
  acquireInventorySlot,
  cooldownRemainingSec,
  inventoryLimits,
  resetCooldownLevel,
  type InventorySlot,
} from '@/lib/inventoryLimiter'

const NO_STORE = { 'Cache-Control': 'no-store' }
const reply = (body: Record<string, unknown>, status = 200, retryAfterSec?: number) =>
  NextResponse.json(body, {
    status,
    headers: retryAfterSec ? { ...NO_STORE, 'Retry-After': String(retryAfterSec) } : NO_STORE,
  })
const log = (result: string, extra: Record<string, unknown> = {}) =>
  console.warn('[inventory]', JSON.stringify({ result, ...extra }))

export async function GET(req: NextRequest) {
  const denied = requireInventoryApiKey(req)
  if (denied) return denied

  const parsed = parseInventoryQuery(new URL(req.url).searchParams)
  if (!parsed.ok) return reply({ ok: false, reason: 'invalid_params', field: parsed.field }, 400)

  const base = process.env.BOSS_API_BASE_URL
  if (!base) return reply({ ok: false, reason: 'not_configured' }, 503)

  let slot: InventorySlot | null = null
  try {
    // 休止中ならトークンも取らずに止める（早めの打ち切り。止める最終判断は acquireInventorySlot のロック）
    const rest = await cooldownRemainingSec()
    if (rest > 0) return reply({ ok: false, reason: 'cooling_down', retryAfterSec: rest }, 429, rest)

    // トークンは在庫のロックを持つ前に取る（更新を待つことがあり、その間ロックを持たないため）
    let accessToken: string
    try {
      accessToken = await getValidBossAccessToken()
    } catch (e) {
      const code = e instanceof BossTokenError ? e.code : 'unknown'
      log('boss_auth_unavailable', { code })
      return reply({ ok: false, reason: 'boss_auth_unavailable', code }, 503)
    }

    const got = await acquireInventorySlot()
    if (!got.ok) return reply({ ok: false, reason: got.reason, retryAfterSec: got.retryAfterSec }, 429, got.retryAfterSec)
    slot = got.slot

    const r = await fetchInventoryPage(
      {
        fetch: ((url, init) => fetch(url, { ...init, cache: 'no-store' })) as FetchLike,
        base,
        accessToken,
        timeoutMs: inventoryLimits.fetchTimeoutMs,
      },
      parsed.query
    )

    if (r.ok) {
      await resetCooldownLevel()
      return reply(r)
    }
    if (r.kind === 'http' && r.status === 429) {
      const sec = await slot.startCooldown(r.retryAfterSec)
      log('rate_limited', { retryAfterSec: sec })
      return reply({ ok: false, reason: 'rate_limited', retryAfterSec: sec }, 429, sec)
    }
    if (r.kind === 'http') {
      log('boss_error', { status: r.status })
      return r.status === 400
        ? reply({ ok: false, reason: 'boss_rejected_params', status: r.status }, 400)
        : reply({ ok: false, reason: 'boss_error', status: r.status }, 502)
    }
    log(r.kind)
    if (r.kind === 'timeout') return reply({ ok: false, reason: 'boss_timeout' }, 504)
    if (r.kind === 'invalid_response') return reply({ ok: false, reason: 'boss_invalid_response' }, 502)
    return reply({ ok: false, reason: 'boss_unreachable' }, 502)
  } catch (e) {
    // KV が使えないなど。BOSS は呼ばずに止める（呼び出し回数の制限を守れないため）
    log('limiter_unavailable', { name: (e as Error)?.name })
    return reply({ ok: false, reason: 'limiter_unavailable' }, 503)
  } finally {
    if (slot) await slot.release()
  }
}
