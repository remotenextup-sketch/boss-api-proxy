// 「KV に設定が無い」と「KV の障害で読めない」を、本物の KV のクライアント（@vercel/kv → @upstash/redis）で区別できることの試験。
// 本番の KV へは接続しない。手元に Upstash の REST の偽物（127.0.0.1）を立て、本物のクライアントをそこへ向ける
//   npx tsx scripts/test-rakuten-creds-kv-http.ts     （kv-loader は使わない）
// 確かめること（@upstash/redis v1.36 の動き）:
//   - キーが無い: HTTP 200 {"result":null}（@vercel/kv は /pipeline で [{"result":null}]）→ get は null → 環境変数（変更前と同じ）
//   - 障害: HTTP 5xx・401 → UpstashError、接続できない → 再試行の後に例外、200 でも result が無い → TypeError → いずれもエラー（環境変数に落とさない）
//   - 復号できない値 → エラー
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const FAKE_SECRET = 'TEST-ONLY-fake-service-secret'
const FAKE_LICENSE = 'TEST-ONLY-fake-license-key'
process.env.RAKUTEN_SERVICE_SECRET = FAKE_SECRET
process.env.RAKUTEN_LICENSE_KEY = FAKE_LICENSE
process.env.RAKUTEN_CREDS_ENC_KEY = randomBytes(32).toString('base64')
for (const level of ['log', 'info', 'warn', 'error'] as const) console[level] = () => {}
const say = (s: string) => process.stdout.write(s + '\n')

type Mode = 'null' | 'http500' | 'http401' | 'no_result' | 'not_json' | 'garbage' | 'value'
let mode: Mode = 'null'
let stored: unknown = null
const seen: string[] = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    seen.push(body)
    // @vercel/kv は自動でまとめて送る（POST /pipeline、本文はコマンドの配列、応答は結果の配列）。単発（POST /）にも答える
    const pipeline = req.url === '/pipeline'
    const send = (status: number, text: string) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(text) }
    const one = (o: unknown) => send(200, JSON.stringify(pipeline ? (JSON.parse(body) as unknown[]).map(() => o) : o))
    if (mode === 'http500') return send(500, JSON.stringify({ error: 'ERR internal' }))
    if (mode === 'http401') return send(401, JSON.stringify({ error: 'WRONGPASS' }))
    if (mode === 'no_result') return one({})
    if (mode === 'not_json') return send(200, '<html>gateway</html>')
    if (mode === 'garbage') return one({ result: JSON.stringify({ v: 1, iv: 'AAAA', tag: 'AAAA', data: 'AAAA' }) })
    if (mode === 'value') return one({ result: JSON.stringify(stored) })
    return one({ result: null })
  })
})

async function main() {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  process.env.KV_REST_API_URL = `http://127.0.0.1:${port}`
  process.env.KV_REST_API_TOKEN = 'TEST-ONLY-fake-kv-token'
  const lib = await import('../lib/rakutenCreds')
  const outcome = async () => { try { const r = await lib.getRakutenCreds(); return `${r.source}:${r.creds.licenseKey}` } catch (e) { return (e as Error).message } }
  let ok = 0
  const t = async (name: string, fn: () => unknown) => { await fn(); ok++; say(`OK ${name}`) }

  await t('キーが無い（200 result:null）→ 環境変数（変更前と同じ）', async () => {
    mode = 'null'
    assert.equal(await outcome(), `env:${FAKE_LICENSE}`)
    assert.ok(seen.at(-1)!.includes('"get"') && seen.at(-1)!.includes('rakuten:creds:active'), '本物のクライアントで get を送った')
  })
  for (const [m, name] of [['http500', 'HTTP 500'], ['http401', 'HTTP 401（鍵違い）'], ['no_result', '200 だが result が無い'], ['not_json', '200 だが JSON でない']] as const) {
    await t(`KV の障害（${name}）→ エラー（環境変数に落とさない）`, async () => {
      mode = m
      assert.equal(await outcome(), 'RAKUTEN_CREDS_UNAVAILABLE (kv_unavailable)')
    })
  }
  await t('復号できない値 → エラー', async () => {
    mode = 'garbage'
    assert.equal(await outcome(), 'RAKUTEN_CREDS_UNAVAILABLE (kv_unreadable)')
  })
  await t('KV に接続できない（再試行の後）→ エラー', async () => {
    const saved = process.env.KV_REST_API_URL
    server.close()
    const started = Date.now()
    assert.equal(await outcome(), 'RAKUTEN_CREDS_UNAVAILABLE (kv_unavailable)')
    say(`   （再試行を含めて ${Date.now() - started} ms）`)
    process.env.KV_REST_API_URL = saved
  })
  say(`\n${ok} OK`)
}

main().then(() => process.exit(0), (e) => { process.stderr.write(`NG ${(e as Error).message.slice(0, 300)}\n`); process.exit(1) })
