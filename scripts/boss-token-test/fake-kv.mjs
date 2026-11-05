// テスト専用の偽の KV（@vercel/kv の get / set（nx・ex）/ del / eval だけ）。状態は fake から操作する
const store = new Map() // key -> { v, exp }
export const fake = {
  store,
  failSetToken: 0, // boss:token の set を、書かずに失敗させる回数
  throwAfterApply: 0, // boss:token の set を、書いたのに失敗として返す回数（成否不明）
  reset() { store.clear(); this.failSetToken = 0; this.throwAfterApply = 0 },
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
export const kv = {
  async get(k) { await tick(); const e = alive(k); return e ? clone(e.v) : null },
  async set(k, v, o = {}) {
    await tick()
    if (k === 'boss:token' && fake.failSetToken > 0) { fake.failSetToken--; throw new Error('fake kv: set failed') }
    if (o.nx && alive(k)) return null
    store.set(k, { v: clone(v), exp: o.ex ? Date.now() + o.ex * 1000 : 0 })
    if (k === 'boss:token' && fake.throwAfterApply > 0) { fake.throwAfterApply--; throw new Error('fake kv: timeout after write') }
    return 'OK'
  },
  async del(k) { await tick(); return store.delete(k) ? 1 : 0 },
  async eval(script, keys, args) {
    await tick()
    if (!/redis\.call\("get", KEYS\[1\]\) == ARGV\[1\]/.test(script)) throw new Error('fake kv: unexpected script')
    const e = alive(keys[0])
    if (e && e.v === args[0]) { store.delete(keys[0]); return 1 }
    return 0
  },
}
