// 楽天の認証情報の戻し（「前の設定」を試験して通ったときだけ、今の設定と入れ替える）
//   POST /api/boss/credentials/rakuten/rollback   x-api-key: BOSS_CREDENTIALS_API_KEY
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCredentialsApiKey } from "@/lib/credentialsAuth";
import { rollbackRakutenCreds } from "@/lib/rakutenCreds";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const denied = requireCredentialsApiKey(req);
  if (denied) return denied;
  try {
    const r = await rollbackRakutenCreds();
    console.info("[credentials/rakuten/rollback]", JSON.stringify(r.ok ? { ok: true } : { ok: false, reason: r.reason, status: r.status ?? null }));
    return NextResponse.json(r, { status: r.ok ? 200 : r.reason === "not_configured" ? 503 : r.reason === "busy" ? 409 : 200, headers: NO_STORE });
  } catch (e) {
    console.error("[credentials/rakuten/rollback] failed", (e as Error)?.name ?? "Error");
    return NextResponse.json({ ok: false, reason: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
