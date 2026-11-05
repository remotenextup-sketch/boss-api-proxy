// BOSS のアクセストークン取得（lib/bossToken.ts）のテスト。KV と BOSS の認証サーバーは偽物（外へは接続しない）
//   npx tsx --import ./scripts/boss-token-test/kv-loader.mjs scripts/test-boss-token.ts
// 別の版を試すとき（修正前の再現など）: BOSS_TOKEN_MODULE=<ファイルの絶対パス> を付ける（そのときは route のテストは飛ばす）
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// @ts-expect-error テスト専用の偽の KV（JS）
import { fake } from './boss-token-test/fake-kv.mjs'

const MODULE = process.env.BOSS_TOKEN_MODULE ?? path.resolve(import.meta.dirname, '../lib/bossToken.ts')
const IS_TARGET = !process.env.BOSS_TOKEN_MODULE
let instance = 0
// 呼ぶたびに別の読み込み（= Vercel の別インスタンス相当。KV は共有）
const load = async () => (await import(`${pathToFileURL(MODULE).href}?i=${++instance}`)) as {
  getValidBossAccessToken: () => Promise<string>
  bossTokenTiming?: Record<string, number>
}

process.env.BOSS_CLIENT_ID = 'client-id'
process.env.BOSS_CLIENT_SECRET = 'client-SECRET-value'
process.env.BOSS_API_BASE_URL = 'https://boss.test'
process.env.BOSS_PROXY_API_KEY = 'proxy-SECRET-key'

// ---- 出たものを全部ためて、最後に秘密が混ざっていないかを見る ----
const logs: string[] = []
for (const level of ['log', 'info', 'warn', 'error'] as const) {
  console[level] = (...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
}
const say = (s: string) => process.stdout.write(s + '\n')
const secrets = new Set<string>(['client-SECRET-value', 'proxy-SECRET-key', 'SECRET-DETAIL'])

// ---- 偽のトークン ----
let seq = 0
const nowSec = () => Math.floor(Date.now() / 1000)
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
function jwt(iat: number, exp: number) { const t = `${b64({ alg: 'none' })}.${b64({ iat, exp, n: ++seq })}.sig`; secrets.add(t); return t }
function stored(ageSec: number, life = 300) {
  const iat = nowSec() - ageSec
  const rt = `rt-${++seq}-SECRET`
  secrets.add(rt)
  return { access_token: jwt(iat, iat + life), refresh_token: rt, expires_at: iat + life }
}

// ---- 偽の BOSS 認証サーバー（と BOSS API） ----
type Mode = 'ok' | 'invalid_grant' | 'server_error' | 'hang' | 'no_refresh_token'
const kc = { calls: 0, delayMs: 0, mode: 'ok' as Mode, usedRefresh: [] as string[], life: 300 }
const boss = { calls: 0, auth: [] as string[] }
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason) })
})
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (url.startsWith('https://boss.test/')) {
    boss.calls++
    boss.auth.push(String((init?.headers as Record<string, string>)?.Authorization ?? ''))
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }) // 注文なし
  }
  if (!url.endsWith('/realms/boss/protocol/openid-connect/token')) throw new Error(`想定外の接続: ${url}`)
  kc.calls++
  kc.usedRefresh.push(new URLSearchParams(String(init?.body)).get('refresh_token') ?? '')
  const signal = init?.signal ?? undefined
  if (kc.mode === 'hang') { await new Promise((_, rej) => signal?.addEventListener('abort', () => rej(signal.reason))); }
  await sleep(kc.delayMs, signal)
  if (kc.mode === 'invalid_grant') return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token is not active SECRET-DETAIL' }), { status: 400 })
  if (kc.mode === 'server_error') return new Response('<html>upstream SECRET-DETAIL</html>', { status: 502 })
  const iat = nowSec()
  const rt = `rt-new-${++seq}-SECRET`
  secrets.add(rt)
  const body: Record<string, unknown> = { access_token: jwt(iat, iat + kc.life), expires_in: kc.life }
  if (kc.mode !== 'no_refresh_token') body.refresh_token = rt
  return new Response(JSON.stringify(body), { status: 200 })
}) as typeof fetch

// ---- 実行の枠 ----
const results: Array<{ name: string; ok: boolean; detail?: string }> = []
async function t(name: string, fn: () => Promise<void>, opts: { timeoutMs?: number } = {}) {
  fake.reset(); Object.assign(kc, { calls: 0, delayMs: 0, mode: 'ok', usedRefresh: [], life: 300 }); Object.assign(boss, { calls: 0, auth: [] })
  const limit = opts.timeoutMs ?? 20_000
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${limit}ms 以内に終わらない（止まったまま）`)), limit) })])
    results.push({ name, ok: true }); say(`OK   ${name}`)
  } catch (e) {
    const detail = (e as Error).message.split('\n')[0]
    results.push({ name, ok: false, detail }); say(`NG   ${name}\n       → ${detail}`)
  } finally { clearTimeout(timer) }
}
const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: Error) => ({ ok: false as const, e }))
const timing = async (m: Awaited<ReturnType<typeof load>>, o: Record<string, number>) => { if (m.bossTokenTiming) Object.assign(m.bossTokenTiming, o) }

say(`対象: ${path.relative(process.cwd(), MODULE)}\n`)

// ---- 1. 有効なトークンは使い回す ----
await t('発行から10秒のトークン（残り290秒）は更新せずに使う', async () => {
  const s = stored(10); fake.store.set('boss:token', { v: s, exp: 0 })
  const m = await load()
  assert.equal(await m.getValidBossAccessToken(), s.access_token)
  assert.equal(kc.calls, 0, `更新が ${kc.calls} 回走った`)
})
await t('残り70秒（余裕60秒の外）も更新しない', async () => {
  const s = stored(230); fake.store.set('boss:token', { v: s, exp: 0 })
  const m = await load()
  assert.equal(await m.getValidBossAccessToken(), s.access_token)
  assert.equal(kc.calls, 0, `更新が ${kc.calls} 回走った`)
})
await t('4分のあいだに続けて10回呼んでも、更新は最初の1回だけ', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }) // 失効済み
  const m = await load()
  const got = new Set<string>()
  for (let i = 0; i < 10; i++) got.add(await (await load()).getValidBossAccessToken())
  void m
  assert.equal(kc.calls, 1, `更新が ${kc.calls} 回走った`)
  assert.equal(got.size, 1)
})

// ---- 2. 更新が必要なときだけ 1 回 ----
await t('残り50秒なら1回だけ更新し、新しいトークンと更新用トークンを保存してロックを外す', async () => {
  const s = stored(250); fake.store.set('boss:token', { v: s, exp: 0 })
  const m = await load()
  const a = await m.getValidBossAccessToken()
  assert.notEqual(a, s.access_token)
  assert.equal(kc.calls, 1)
  assert.deepEqual(kc.usedRefresh, [s.refresh_token])
  const saved = fake.token()
  assert.equal(saved.access_token, a)
  assert.match(saved.refresh_token, /^rt-new-/)
  assert.equal(fake.lock(), null, 'ロックが残っている')
})
await t('BOSS が新しい更新用トークンを返さなかったら、今の更新用トークンを残す', async () => {
  const s = stored(400); fake.store.set('boss:token', { v: s, exp: 0 }); kc.mode = 'no_refresh_token'
  const m = await load()
  await m.getValidBossAccessToken()
  assert.equal(fake.token().refresh_token, s.refresh_token, '更新用トークンが消えた')
})

// ---- 3. 同時に呼んだとき ----
await t('別インスタンス2つから同時に6回呼ぶ → 更新は1回・全部成功・同じトークン', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); kc.delayMs = 400
  const [a, b] = [await load(), await load()]
  const rs = await Promise.all([a, a, a, b, b, b].map((m) => settle(m.getValidBossAccessToken())))
  const failed = rs.filter((r) => !r.ok)
  assert.equal(failed.length, 0, `${failed.length} 件が失敗: ${failed.map((r) => (r as { e: Error }).e.message.slice(0, 60)).join(' / ')}`)
  assert.equal(new Set(rs.map((r) => (r as { v: string }).v)).size, 1)
  assert.equal(kc.calls, 1, `更新が ${kc.calls} 回走った`)
  assert.equal(fake.lock(), null)
})
await t('同じインスタンスで同時に5回 → 更新は1回', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); kc.delayMs = 200
  const m = await load()
  const rs = await Promise.all(Array.from({ length: 5 }, () => settle(m.getValidBossAccessToken())))
  assert.equal(rs.filter((r) => !r.ok).length, 0)
  assert.equal(kc.calls, 1, `更新が ${kc.calls} 回走った`)
})

// ---- 4. 更新の失敗 ----
await t('更新が invalid_grant → 失敗を返し、ロックを外す。BOSS の本文・トークンを出さない', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); kc.mode = 'invalid_grant'
  const m = await load()
  const r = await settle(m.getValidBossAccessToken())
  assert.equal(r.ok, false)
  const e = (r as { e: Error & { code?: string } }).e
  for (const s of secrets) assert.ok(!e.message.includes(s), 'エラーの文言に秘密が入っている')
  assert.ok(!e.message.includes('Token is not active'), 'エラーの文言に BOSS の本文が入っている')
  if (IS_TARGET) assert.equal(e.code, 'reauth_required')
  assert.equal(fake.lock(), null, 'ロックが残っている')
})
await t('更新が 502（HTML の本文）→ 失敗を返し、ロックを外す。本文を出さない', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); kc.mode = 'server_error'
  const m = await load()
  const r = await settle(m.getValidBossAccessToken())
  assert.equal(r.ok, false)
  assert.ok(!(r as { e: Error }).e.message.includes('upstream'), 'エラーの文言に BOSS の本文が入っている')
  assert.equal(fake.lock(), null)
})
await t('待っている側は、相手の更新が失敗したら長く待たずに失敗する（BOSS へは自分で更新しに行かない）', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); kc.mode = 'invalid_grant'; kc.delayMs = 500
  const [a, b] = [await load(), await load()]
  const pa = settle(a.getValidBossAccessToken())
  await sleep(100)
  const t0 = Date.now()
  const rb = await settle(b.getValidBossAccessToken())
  await pa
  assert.equal(rb.ok, false)
  assert.ok(Date.now() - t0 < 3000, `待っている側が ${Date.now() - t0}ms 待った`)
  assert.equal(kc.calls, 1, `更新が ${kc.calls} 回走った`)
})
await t('更新が応答しない → 制限時間で打ち切り、ロックを外す', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); kc.mode = 'hang'
  const m = await load()
  await timing(m, { refreshTimeoutMs: 300 })
  const r = await settle(m.getValidBossAccessToken())
  assert.equal(r.ok, false)
  if (IS_TARGET) assert.equal((r as { e: Error & { code?: string } }).e.code, 'refresh_timeout')
  assert.equal(fake.lock(), null)
}, { timeoutMs: 15_000 })

// ---- 5. ロックの期限切れ ----
await t('ロックの期限が切れて別のインスタンスが更新しても、あとから終わった側は相手のロックを消さない', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 })
  const [a, b] = [await load(), await load()]
  await timing(a, { lockTtlSec: 1 }); await timing(b, { lockTtlSec: 1 })
  kc.delayMs = 1500
  const pa = settle(a.getValidBossAccessToken()) // ロックを取って 1.5 秒かかる（ロックは 1 秒で切れる）
  await sleep(1200)
  kc.delayMs = 1500
  // b は、a のロックが切れた後に来る → 自分でロックを取って更新する
  fake.store.set('boss:token', { v: stored(400), exp: 0 }) // a がまだ保存していない状態を保つ
  const pb = settle(b.getValidBossAccessToken())
  await sleep(600) // a が終わってロックを外す時刻（b はまだ更新中）
  const lockWhileB = fake.lock()
  await Promise.all([pa, pb])
  assert.ok(lockWhileB, 'a が b のロックを消した')
  assert.equal(fake.lock(), null)
})

// ---- 6. KV への保存 ----
await t('KV への保存が2回失敗 → 3回目で保存でき、呼び出しは成功する', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); fake.failSetToken = 2
  const m = await load()
  const a = await m.getValidBossAccessToken()
  assert.equal(fake.token().access_token, a)
})
await t('KV への保存の成否が分からない（書けたのに失敗が返る）→ 読み直して保存済みと判断する', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); fake.throwAfterApply = 5
  const m = await load()
  const before = logs.length
  const a = await m.getValidBossAccessToken()
  assert.equal(fake.token().access_token, a)
  assert.ok(!logs.slice(before).some((l) => /save failed|保存できなかった/.test(l)), '保存失敗と記録された')
})
await t('KV への保存が全部失敗 → この呼び出しは新しいトークンで成功させ、保存の失敗を記録する', async () => {
  const s = stored(400); fake.store.set('boss:token', { v: s, exp: 0 }); fake.failSetToken = 99
  const m = await load()
  const before = logs.length
  const a = await m.getValidBossAccessToken()
  assert.notEqual(a, s.access_token)
  assert.ok(logs.slice(before).some((l) => /token_save_failed/.test(l)), '保存の失敗が記録されていない')
  assert.equal(fake.lock(), null)
})

await t('保存が全部失敗 → 同じインスタンスの次の呼び出しで、持っていたトークンを KV に保存し直す（更新はしない）', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); fake.failSetToken = 99
  const m = await load()
  const a = await m.getValidBossAccessToken()
  fake.failSetToken = 0 // KV が戻った
  const b = await m.getValidBossAccessToken()
  assert.equal(b, a)
  assert.equal(kc.calls, 1, `更新が ${kc.calls} 回走った`)
  assert.equal(fake.token()?.access_token, a, '保存し直していない')
  assert.match(fake.token().refresh_token, /^rt-new-/)
  assert.equal(fake.lock(), null)
})
await t('保存できないまま期限が来たら、KV の古いものではなく持っていた新しい更新用トークンで更新する', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); fake.failSetToken = 99; kc.life = 5 // 5 秒で切れる（余裕 1 秒）
  const m = await load()
  await m.getValidBossAccessToken()
  await sleep(4500)
  await m.getValidBossAccessToken()
  assert.equal(kc.calls, 2)
  assert.match(kc.usedRefresh[1], /^rt-new-/, 'KV の古い更新用トークンで更新した')
}, { timeoutMs: 20_000 })
await t('保存し直す前に別のインスタンスが新しいトークンを保存していたら、上書きせずに持っていたものを捨てる', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); fake.failSetToken = 99
  const a = await load()
  await a.getValidBossAccessToken() // a だけが新しいトークンを持つ
  fake.failSetToken = 0
  await sleep(1100)
  const iat = nowSec(); const newer = { access_token: jwt(iat, iat + 300), refresh_token: 'rt-other-SECRET', expires_at: iat + 300 }
  secrets.add('rt-other-SECRET')
  fake.store.set('boss:token', { v: newer, exp: 0 }) // b が後から更新して保存した
  assert.equal(await a.getValidBossAccessToken(), newer.access_token)
  assert.equal(fake.token().refresh_token, 'rt-other-SECRET', '新しいトークンを上書きした')
})
// ---- 7. ロックの解除（確認と削除を 1 回で行う eval だけ。失敗しても GET → DEL はしない） ----
await t('ロックの期限切れの後に別のプロセスが取り直したロックを、eval が使えなくても古い処理は消さない', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); fake.evalFails = true
  const [a, b] = [await load(), await load()]
  await timing(a, { lockTtlSec: 1 }); await timing(b, { lockTtlSec: 1 })
  kc.delayMs = 1500
  const pa = settle(a.getValidBossAccessToken())
  await sleep(1200) // a のロックが切れた
  fake.store.set('boss:token', { v: stored(400), exp: 0 })
  const pb = settle(b.getValidBossAccessToken()) // b が取り直して更新中
  await sleep(600) // a が終わって解除しようとする
  const lockWhileB = fake.lock()
  await Promise.all([pa, pb])
  assert.ok(lockWhileB && lockWhileB !== null, 'a が b のロックを消した')
  assert.ok(!fake.lockOps.includes('del'), 'ロックのキーに DEL が走った')
})
await t('eval が失敗しても、ロックのキーには GET も DEL もしない（取る SET と eval だけ）', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); fake.evalFails = true
  const m = await load()
  await m.getValidBossAccessToken()
  assert.deepEqual(fake.lockOps, ['set', 'eval'])
  assert.ok(fake.lock(), 'ロックが消えている（GET → DEL で外した？）')
  assert.ok(logs.some((l) => /lock release failed/.test(l)), '解除の失敗が記録されていない')
})
await t('eval が失敗したロックは期限で自然に消え、その後は普通に更新できる', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); fake.evalFails = true
  const m = await load()
  await timing(m, { lockTtlSec: 1 })
  await m.getValidBossAccessToken()
  assert.ok(fake.lock(), 'ロックがすぐ消えた')
  await sleep(1100)
  assert.equal(fake.lock(), null, '期限が過ぎてもロックが残っている')
  fake.store.set('boss:token', { v: stored(400), exp: 0 }) // また更新が必要になった
  const n = await load()
  await timing(n, { lockTtlSec: 1 })
  const r = await settle(n.getValidBossAccessToken())
  assert.equal(r.ok, true)
  assert.equal(kc.calls, 2)
})
await t('更新・保存の後にロックの解除だけが失敗しても、呼び出しは成功し、ほかの呼び出しも保存済みのトークンをすぐ使える', async () => {
  fake.store.set('boss:token', { v: stored(400), exp: 0 }); fake.evalFails = true
  const m = await load()
  const a = await m.getValidBossAccessToken()
  assert.equal(fake.token().access_token, a)
  assert.ok(fake.lock(), '前提: ロックが残っている')
  const t0 = Date.now()
  const rs = await Promise.all([await load(), await load()].map((x) => settle(x.getValidBossAccessToken())))
  assert.ok(rs.every((r) => r.ok && r.v === a), 'ほかの呼び出しが保存済みのトークンを使えなかった')
  assert.ok(Date.now() - t0 < 1000, `ほかの呼び出しが ${Date.now() - t0}ms 待った`)
  assert.equal(kc.calls, 1)
})

// ---- 8. route の既存の動き（修正後の版だけ） ----
if (IS_TARGET) {
  const { NextRequest } = await import('next/server')
  const req = (p: string) => new NextRequest(`http://localhost/api/boss/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'proxy-SECRET-key' }, body: JSON.stringify({ mallOrderNumber: '372877-20260425-0147424025' }) })
  const findOrder = (await import('../app/api/boss/find-order/route')).POST
  const shipments = (await import('../app/api/boss/order-shipments/route')).POST

  await t('find-order: 有効なトークンをそのまま BOSS に渡す（更新しない）・注文なしは今までどおり', async () => {
    const s = stored(10); fake.store.set('boss:token', { v: s, exp: 0 })
    const r = await findOrder(req('find-order'))
    assert.equal(kc.calls, 0)
    assert.equal(boss.auth[0], `Bearer ${s.access_token}`)
    const body = await r.json()
    for (const x of secrets) assert.ok(!JSON.stringify(body).includes(x))
    say(`       （注文なしの応答: HTTP ${r.status} ${JSON.stringify(body).slice(0, 80)}）`)
  })
  await t('find-order: 更新に失敗 → 今までどおり 500 internal_error。応答に秘密・BOSS の本文を含めない', async () => {
    fake.store.set('boss:token', { v: stored(400), exp: 0 }); kc.mode = 'invalid_grant'
    const r = await findOrder(req('find-order'))
    const body = await r.json()
    assert.equal(r.status, 500)
    assert.equal(body.reason, 'internal_error')
    assert.ok(!JSON.stringify(body).includes('Token is not active'))
    for (const x of secrets) assert.ok(!JSON.stringify(body).includes(x))
    assert.equal(boss.calls, 0)
  })
  await t('order-shipments: 有効なトークンをそのまま使う・更新に失敗したら今までどおり 500 internal_error', async () => {
    const s = stored(10); fake.store.set('boss:token', { v: s, exp: 0 })
    await shipments(req('order-shipments'))
    assert.equal(kc.calls, 0)
    assert.equal(boss.auth[0], `Bearer ${s.access_token}`)
    fake.store.set('boss:token', { v: stored(400), exp: 0 }); kc.mode = 'invalid_grant'
    const r = await shipments(req('order-shipments'))
    assert.equal(r.status, 500)
    assert.deepEqual(await r.json(), { ok: false, reason: 'internal_error' })
  })
}

// ---- 9. ログに秘密が出ていない ----
await t('ログ全体に、トークン・更新用トークン・クライアントの秘密・BOSS の本文が出ていない', async () => {
  const all = logs.join('\n')
  const leaked = [...secrets].filter((s) => all.includes(s))
  assert.equal(leaked.length, 0, `${leaked.length} 種類の秘密がログに出た`)
})

const ng = results.filter((r) => !r.ok)
say(`\n${results.length - ng.length} 件 OK / ${ng.length} 件 NG`)
process.exit(ng.length ? 1 : 0)
