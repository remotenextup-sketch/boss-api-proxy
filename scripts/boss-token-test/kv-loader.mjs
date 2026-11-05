// テスト専用: @vercel/kv を手元の偽の KV（fake-kv.mjs）に差し替える
//   npx tsx --import ./scripts/boss-token-test/kv-loader.mjs scripts/test-boss-token.ts
import { register } from 'node:module'
register('./kv-hooks.mjs', import.meta.url)
