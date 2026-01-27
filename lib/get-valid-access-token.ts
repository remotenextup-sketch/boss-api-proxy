// lib/get-valid-access-token.ts
import { kv } from "@vercel/kv"

const ACCESS_KEY = "boss_access_token"
const REFRESH_KEY = "boss_refresh_token"

export async function getValidAccessToken() {
  // 1. access token を確認
  const accessToken = await kv.get<string>(ACCESS_KEY)
  if (accessToken) {
    return accessToken
  }

  // 2. refresh token を確認
  const refreshToken = await kv.get<string>(REFRESH_KEY)
  if (!refreshToken) {
    throw new Error("REFRESH_TOKEN_NOT_FOUND")
  }

  // 3. refresh 実行
  const newAccessToken = await refreshAccessToken(refreshToken)

  // 4. 保存
  await kv.set(ACCESS_KEY, newAccessToken)

  return newAccessToken
}
