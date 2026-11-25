import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

// 届け先の口（/api/boss/order-consignees）だけで使う鍵。CS 用の BOSS_PROXY_API_KEY・在庫の BOSS_INVENTORY_API_KEY とは別にし、
// 既存の利用先（CS の取り込み・Dify・GAS など、BOSS_PROXY_API_KEY を持つもの）からは届け先（個人情報）を取れないようにする
//   届け先の鍵が未設定、またはほかの鍵と同じ値 → 503 not_configured（取り違えで分離が崩れないように）
//   鍵が無い・違う（CS 用・在庫の鍵を含む）     → 401 unauthorized
export function requireConsigneeApiKey(req: Request): NextResponse | null {
  const expected = process.env.BOSS_CONSIGNEE_API_KEY?.trim();
  const others = [process.env.BOSS_PROXY_API_KEY?.trim(), process.env.BOSS_INVENTORY_API_KEY?.trim()].filter((k): k is string => !!k);
  if (!expected || others.some((k) => safeEqual(expected, k))) {
    console.error("[consigneeAuth] BOSS_CONSIGNEE_API_KEY is not set or equals another key");
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  const provided = req.headers.get("x-api-key")?.trim() ?? "";
  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  return null;
}

// 長さの違いも比較時間に出ないよう、ハッシュをそろえてから比べる（proxyAuth と同じ）
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
