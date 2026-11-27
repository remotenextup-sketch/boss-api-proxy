// BOSS の認証の確認（管理画面の接続テスト）。アクセストークンを 1 回取るだけ（期限内なら使い回し、切れていれば更新する）。
// 注文・出荷などの業務 API は呼ばない。トークンの値は返さず、期限（epoch 秒）だけを返す。
//   GET /api/boss/auth/status   x-api-key: BOSS_CREDENTIALS_API_KEY
//   → { ok:true, accessExpiresAt, refreshExpiresAt } / { ok:false, reason }（reason は reauth_required など決まった語）
// 更新は lib/bossToken.ts の 1 か所だけで行う（ロック・回転する更新用トークンの保存も同じ処理）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { requireCredentialsApiKey } from "@/lib/credentialsAuth";
import { BossTokenError, getValidBossAccessToken } from "@/lib/bossToken";
import { jwtExp } from "@/lib/jwtExp";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const denied = requireCredentialsApiKey(req);
  if (denied) return denied;
  try {
    const access = await getValidBossAccessToken();
    const stored = await kv.get<{ refresh_token?: unknown; expires_at?: unknown }>("boss:token").catch(() => null);
    return NextResponse.json(
      {
        ok: true,
        accessExpiresAt: jwtExp(access) ?? (typeof stored?.expires_at === "number" ? stored.expires_at : null),
        refreshExpiresAt: jwtExp(stored?.refresh_token),
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    const reason = e instanceof BossTokenError ? e.code : "internal_error";
    console.warn("[auth/status]", JSON.stringify({ reason }));
    return NextResponse.json({ ok: false, reason }, { status: reason === "internal_error" ? 500 : 200, headers: NO_STORE });
  }
}
