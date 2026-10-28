export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// app/api/boss/oauth/auto/route.ts
import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { requireProxyApiKey } from "@/lib/proxyAuth";
import { OAUTH_STATE_PREFIX, OAUTH_STATE_TTL_SEC } from "@/lib/oauthState";

/**
 * BOSS の再認証を始める (鍵が必要)
 * 1) x-api-key を付けて /api/boss/oauth/auto を呼ぶ
 *      curl -H "x-api-key: $BOSS_PROXY_API_KEY" https://<proxy>/api/boss/oauth/auto
 * 2) 返ってきた sample_url を 10 分以内にブラウザで開く
 * 3) BOSSログイン → 同意 → redirect_uri (/api/boss/oauth/callback) に code と state が付いて戻る
 * 4) callback が state を照合 (1 回限り) してから token 交換し、KV に保存する
 */
export async function GET(req: Request) {
  const denied = requireProxyApiKey(req);
  if (denied) return denied;

  const CLIENT_ID = process.env.BOSS_CLIENT_ID;
  const REDIRECT_URI = process.env.BOSS_REDIRECT_URI;

  if (!CLIENT_ID || !REDIRECT_URI) {
    return NextResponse.json(
      { ok: false, message: "env variables missing: BOSS_CLIENT_ID / BOSS_REDIRECT_URI" },
      { status: 500 }
    );
  }

  // ✅ refresh_token を確実に返してもらうために
  // - openid（OIDC）
  // - offline_access（refresh_token発行条件）
  // を含める
  const scope = "openid offline_access order inventory mow-shipment";

  // 使い捨ての state。callback で照合して消す (他人が用意した code を受け付けないため)
  const state = randomBytes(32).toString("hex");
  await kv.set(`${OAUTH_STATE_PREFIX}${state}`, "1", { ex: OAUTH_STATE_TTL_SEC });

  const sampleUrl =
    "https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/auth" +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${state}`;

  return NextResponse.json({
    ok: true,
    message: `sample_url を ${OAUTH_STATE_TTL_SEC / 60} 分以内にブラウザで開き、BOSS で認可してください。`,
    sample_url: sampleUrl,
  });
}
