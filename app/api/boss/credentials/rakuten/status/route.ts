// 楽天の認証情報の出どころ（KV／環境変数）と保存日時だけを返す。値は返さない
//   GET /api/boss/credentials/rakuten/status   x-api-key: BOSS_CREDENTIALS_API_KEY
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCredentialsApiKey } from "@/lib/credentialsAuth";
import { rakutenCredsStatus } from "@/lib/rakutenCreds";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const denied = requireCredentialsApiKey(req);
  if (denied) return denied;
  try {
    return NextResponse.json(await rakutenCredsStatus(), { headers: NO_STORE });
  } catch (e) {
    console.error("[credentials/rakuten/status] failed", (e as Error)?.name ?? "Error");
    return NextResponse.json({ ok: false, reason: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
