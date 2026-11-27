import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

// 認証情報の管理の口（/api/boss/credentials/*・/api/boss/auth/status）だけで使う鍵 BOSS_CREDENTIALS_API_KEY。
// BOSS_PROXY_API_KEY を持つ既存の利用先（CS の取り込み・GAS・Dify など）から、楽天の認証情報を差し替えられないようにする。
//   鍵が未設定、またはほかの鍵と同じ値 → 503 not_configured（取り違えで分離が崩れないように）
//   鍵が無い・違う（ほかの鍵を含む）   → 401 unauthorized
export function requireCredentialsApiKey(req: Request): NextResponse | null {
  const expected = process.env.BOSS_CREDENTIALS_API_KEY?.trim();
  const others = [
    process.env.BOSS_PROXY_API_KEY?.trim(),
    process.env.BOSS_INVENTORY_API_KEY?.trim(),
    process.env.BOSS_CONSIGNEE_API_KEY?.trim(),
  ].filter((k): k is string => !!k);
  if (!expected || others.some((k) => safeEqual(expected, k))) {
    console.error("[credentialsAuth] BOSS_CREDENTIALS_API_KEY is not set or equals another key");
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const provided = req.headers.get("x-api-key")?.trim() ?? "";
  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}

// 長さの違いも比較時間に出ないよう、ハッシュをそろえてから比べる（proxyAuth と同じ）
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
