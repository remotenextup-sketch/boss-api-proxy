import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

// 在庫の口（/api/boss/inventory）だけで使う鍵。CS 用の BOSS_PROXY_API_KEY とは別にし、互いの口を通さない
//   在庫の鍵が未設定、または CS 用の鍵と同じ値 → 503 not_configured（取り違えで分離が崩れないように）
//   鍵が無い・違う（CS 用の鍵を含む）         → 401 unauthorized
// 既存の口は lib/proxyAuth.ts の requireProxyApiKey のまま（在庫の鍵では通らない）
export function requireInventoryApiKey(req: Request): NextResponse | null {
  const expected = process.env.BOSS_INVENTORY_API_KEY?.trim();
  const csKey = process.env.BOSS_PROXY_API_KEY?.trim();
  if (!expected || (csKey && safeEqual(expected, csKey))) {
    console.error("[inventoryAuth] BOSS_INVENTORY_API_KEY is not set or equals BOSS_PROXY_API_KEY");
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

// 長さの違いも比較時間に出ないよう、ハッシュをそろえてから比べる（proxyAuth と同じ）
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
