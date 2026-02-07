import { kv } from "@vercel/kv";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

export async function refreshToken(oldToken: BossToken): Promise<BossToken> {
  console.log("🔄 BOSS token refresh start");

  const res = await fetch("https://api.boss-oms.jp/BOSS-API/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // ★★★ ここが最重要 ★★★
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.BOSS_CLIENT_ID}:${process.env.BOSS_CLIENT_SECRET}`
        ).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: oldToken.refresh_token,
    }),
  });

  const text = await res.text();

  if (!res.ok) {
    console.error("❌ refresh failed", text);
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

