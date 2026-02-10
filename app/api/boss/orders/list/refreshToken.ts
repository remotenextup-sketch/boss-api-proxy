// app/api/boss/orders/list/refreshToken.ts

import { kv } from "@vercel/kv";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
};

export async function refreshToken(): Promise<BossToken> {
  console.info("🔄 BOSS token refresh start");

  const clientId = process.env.BOSS_CLIENT_ID;
  const clientSecret = process.env.BOSS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("BOSS client credentials not set");
  }

  const current = await kv.get<BossToken>("boss:token");
  if (!current?.refresh_token) {
    throw new Error("No refresh_token in KV");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: current.refresh_token,
  });

  const res = await fetch(
    "https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }
  );

  const raw = await res.text();

  if (!res.ok) {
    console.error("❌ refresh failed FINAL", raw);
    throw new Error("BOSS token refresh failed");
  }

  const json = JSON.parse(raw);

  const newToken: BossToken = {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? current.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + json.expires_in,
  };

  await kv.set("boss:token", newToken);

  console.info("✅ BOSS token refreshed");

  return newToken;
}

