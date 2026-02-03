// lib/bossToken.ts
import { kv } from "@vercel/kv";

const TOKEN_ENDPOINT =
  "https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token";

const CLIENT_ID = process.env.BOSS_CLIENT_ID!;
const CLIENT_SECRET = process.env.BOSS_CLIENT_SECRET!;

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export async function getBossAccessToken(): Promise<string> {
  const accessToken = await kv.get<string>("boss:access_token");
  const refreshToken = await kv.get<string>("boss:refresh_token");
  const expiresAt = await kv.get<number>("boss:expires_at");

  // access_token がまだ有効
  if (accessToken && expiresAt && Date.now() < expiresAt) {
    return accessToken;
  }

  if (!refreshToken) {
    throw new Error("BOSS refresh_token not found. Re-auth required.");
  }

  console.log("🔁 Refreshing BOSS access token");

  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", refreshToken);
  params.set("client_id", CLIENT_ID);
  params.set("client_secret", CLIENT_SECRET);

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Refresh failed:", text);
    throw new Error("Failed to refresh BOSS access token");
  }

  const data = (await res.json()) as TokenResponse;

  const newExpiresAt = Date.now() + data.expires_in * 1000;

  await kv.set("boss:access_token", data.access_token);
  await kv.set("boss:expires_at", newExpiresAt);

  // refresh_token は返らない場合もある（Keycloak仕様）
  if (data.refresh_token) {
    await kv.set("boss:refresh_token", data.refresh_token);
  }

  return data.access_token;
}

