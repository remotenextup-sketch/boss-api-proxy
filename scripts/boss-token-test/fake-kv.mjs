// テスト専用の偽の KV（@vercel/kv の get / set（nx・ex）/ getdel / del / eval だけ）。状態は fake から操作する
const store = new Map() // key -> { v, exp }
export const fake = {
  store,
  failSetToken: 0, // boss:token の set を、書かずに失敗させる回数
  throwAfterApply: 0, // boss:token の set を、書いたのに失敗として返す回数（成否不明）
  evalFails: false, // スクリプト（eval）が使えない KV
  lockOps: [], // ロックのキーへの操作の記録（get・set・del・eval）
  down: false, // KV が止まっている（すべての命令が失敗する）
  beforeSet: null, // set の直前に待たせる（競合の再現用）。async (key, opts) => {}
  reset() { store.clear(); this.failSetToken = 0; this.throwAfterApply = 0; this.evalFails = false; this.lockOps = []; this.down = false; this.beforeSet = null },
  lock() { return alive('boss:token:refreshing')?.v ?? null },
  token() { return alive('boss:token')?.v ?? null },
}
function alive(k) {
  const e = store.get(k)
  if (!e) return undefined
  if (e.exp && Date.now() > e.exp) { store.delete(k); return undefined }
  return e
}
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)))
const tick = () => new Promise((r) => setTimeout(r, 2))
const rec = (op, k) => {
  if (fake.down) throw new Error('fake kv: down'); if (k === 'boss:token:refreshing') fake.lockOps.push(op) }
export const kv = {
  async get(k) { await tick(); rec('get', k); const e = alive(k); return e ? clone(e.v) : null },
  async set(k, v, o = {}) {
    await tick()
    if (fake.beforeSet) await fake.beforeSet(k, o)
    rec('set', k)
    if (k === 'boss:token' && fake.failSetToken > 0) { fake.failSetToken--; throw new Error('fake kv: set failed') }
    if (o.nx && alive(k)) return null
    store.set(k, { v: clone(v), exp: o.ex ? Date.now() + o.ex * 1000 : o.px ? Date.now() + o.px : 0 })
    if (k === 'boss:token' && fake.throwAfterApply > 0) { fake.throwAfterApply--; throw new Error('fake kv: timeout after write') }
    return 'OK'
  },
  async incr(k) { await tick(); rec('incr', k); const e = alive(k); const n = (e ? Number(e.v) : 0) + 1; store.set(k, { v: n, exp: e?.exp ?? 0 }); return n },
  async expire(k, sec) { await tick(); rec('expire', k); const e = alive(k); if (!e) return 0; e.exp = Date.now() + sec * 1000; return 1 },
  async pttl(k) { await tick(); rec('pttl', k); const e = alive(k); if (!e) return -2; return e.exp ? e.exp - Date.now() : -1 },
  async getdel(k) { await tick(); rec('getdel', k); const e = alive(k); store.delete(k); return e ? clone(e.v) : null },
  async del(k) { await tick(); rec('del', k); return store.delete(k) ? 1 : 0 },
  async eval(script, keys, args) {
    await tick()
    rec('eval', keys[0])
    if (fake.evalFails) throw new Error('fake kv: eval not supported')
    if (!/redis\.call\("get", KEYS\[1\]\) == ARGV\[1\]/.test(script)) throw new Error('fake kv: unexpected script')
    const e = alive(keys[0])
    if (e && e.v === args[0]) { store.delete(keys[0]); return 1 }
    return 0
  },
}
