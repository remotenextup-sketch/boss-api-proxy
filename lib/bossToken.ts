// lib/bossToken.ts
import { kv } from "@vercel/kv";

const TOKEN_URL = "https://api.boss-oms.jp/BOSS-API/RefreshToken";

export async function getBossAccessToken(): Promise<string> {
  const accessToken = await kv.get<string>("boss:access_token");
  const refreshToken = await kv.get<string>("boss:refresh_token");
  const expiresAt = await kv.get<number>("boss:expires_at"); // unix ms

  if (!accessToken || !refreshToken || !expiresAt) {
    throw new Error("BOSS token not found in KV");
  }

  // 5分余裕見て更新
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return accessToken;
  }

  console.log("🔁 BOSS access token refresh");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  const data = await res.json();

  await kv.set("boss:access_token", data.accessToken);
  await kv.set("boss:refresh_token", data.refreshToken);
  await kv.set("boss:expires_at", Date.now() + data.expiresIn * 1000);

  return data.accessToken;
}

