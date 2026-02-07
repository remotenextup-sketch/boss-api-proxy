import { kv } from "@vercel/kv";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

export async function refreshToken(oldToken: BossToken): Promise<BossToken> {
  console.log("🔄 BOSS token refresh start");

  const clientId = process.env.BOSS_CLIENT_ID;
  const clientSecret = process.env.BOSS_CLIENT_SECRET;

  console.log("🔍 CLIENT_ID exists:", !!clientId);
  console.log("🔍 CLIENT_SECRET exists:", !!clientSecret);

  if (!clientId || !clientSecret) {
    throw new Error("BOSS_CLIENT_ID or BOSS_CLIENT_SECRET is missing");
  }

  // ==========
  // ① Basic 認証方式（まずは王道）
  // ==========
  const basicAuth =
    "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let res = await fetch("https://api.boss-oms.jp/BOSS-API/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: oldToken.refresh_token,
    }),
  });

  let text = await res.text();

  // ==========
  // ② Basic がダメなら BOSS 独自ヘッダー方式にフォールバック
  // ==========
  if (!res.ok) {
    console.error("⚠️ Basic auth failed, retry with X-API headers", text);

    res = await fetch("https://api.boss-oms.jp/BOSS-API/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-API-KEY": clientId,
        "X-API-SECRET": clientSecret,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: oldToken.refresh_token,
      }),
    });

    text = await res.text();
  }

  if (!res.ok) {
    console.error("❌ refresh failed FINAL", text);
    throw new Error("BOSS token refresh failed");
  }

  const data = JSON.parse(text);

  const newToken: BossToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? oldToken.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  };

  await kv.set("boss:token", newToken);

  console.log("✅ BOSS token refreshed");

  return newToken;
}

