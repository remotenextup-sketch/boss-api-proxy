import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

// boss-api-proxy の API を呼べるのは、BOSS_PROXY_API_KEY を x-api-key で送ってきた相手だけ。
// 鍵が設定されていなければ、誰も通さない (設定漏れで全公開にならないように)。
//   鍵が未設定        → 503 not_configured
//   鍵が無い・違う    → 401 unauthorized
// 使い方: const denied = requireProxyApiKey(req); if (denied) return denied;
export function requireProxyApiKey(req: Request): NextResponse | null {
  const expected = process.env.BOSS_PROXY_API_KEY?.trim();
  if (!expected) {
    console.error("[proxyAuth] BOSS_PROXY_API_KEY is not set");
    return NextResponse.json(
      { ok: false, reason: "not_configured" },
      { status: 503 }
    );
  }

  const provided = req.headers.get("x-api-key")?.trim() ?? "";
  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json(
      { ok: false, reason: "unauthorized" },
      { status: 401 }
    );
  }

  return null;
}

// 長さの違いも比較時間に出ないよう、ハッシュをそろえてから比べる
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
