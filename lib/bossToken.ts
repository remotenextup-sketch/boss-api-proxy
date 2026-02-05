import { kv } from "@vercel/kv";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
};

const TOKEN_KEY = "boss:token";
const REFRESH_LOCK_KEY = "boss:token:refreshing";

// JWT exp を読む
function decodeJwtExp(token: string): number {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64").toString("utf8")
  );
  return payload.exp;
}

// 5分前から失効扱い
function isExpired(expiresAt: number, marginSec = 300): boolean {
  return Date.now() / 1000 > expiresAt - marginSec;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getValidBossAccessToken(): Promise<string> {
  let token = await kv.get<BossToken>(TOKEN_KEY);

  // ---- 有効なら即返す ----
  if (token && !isExpired(token.expires_at)) {
    return token.access_token;
  }

  // ---- refresh ロック確認 ----
  const locked = await kv.get(REFRESH_LOCK_KEY);
  if (locked) {
    // 他プロセスがrefresh中 → 待って再取得
    await sleep(500);
    token = await kv.get<BossToken>(TOKEN_KEY);

    if (token && !isExpired(token.expires_at)) {
      return token.access_token;
    }

    throw new Error("token refresh race failed");
  }

  // ---- refresh 開始 ----
  if (!token?.refresh_token) {
    throw new Error("BOSS refresh_token not found. Re-auth required.");
  }

  await kv.set(REFRESH_LOCK_KEY, true, { ex: 30 });

  try {
    const res = await fetch(
      "https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token.refresh_token,
          client_id: process.env.BOSS_CLIENT_ID!,
          client_secret: process.env.BOSS_CLIENT_SECRET!,
        }),
      }
    );

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`refresh failed: ${raw}`);
    }

    const json = JSON.parse(raw);

    const newToken: BossToken = {
      access_token: json.access_token,
      refresh_token: json.refresh_token, // ★必ず更新
      expires_at: decodeJwtExp(json.access_token),
    };

    await kv.set(TOKEN_KEY, newToken);

    return newToken.access_token;
  } finally {
    await kv.del(REFRESH_LOCK_KEY);
  }
}

