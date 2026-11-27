// 楽天の認証情報の試験（保存しない）
//   POST /api/boss/credentials/rakuten/test  { licenseKey, serviceSecret? }   x-api-key: BOSS_CREDENTIALS_API_KEY
//   serviceSecret を送らなければ、今の serviceSecret のままライセンスキーだけを使う
//   → { ok, expiryDate, daysLeft } または { ok:false, reason, status? }（RMS の応答本文・値は返さない）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCredentialsApiKey } from "@/lib/credentialsAuth";
import { getRakutenCreds, parseCredsInput, testRakutenCreds } from "@/lib/rakutenCreds";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const denied = requireCredentialsApiKey(req);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400, headers: NO_STORE });
  }
  const input = parseCredsInput(body);
  if (!input) return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400, headers: NO_STORE });
  try {
    let serviceSecret = input.serviceSecret;
    if (!serviceSecret) {
      serviceSecret = (await getRakutenCreds()).creds.serviceSecret;
      if (!serviceSecret) return NextResponse.json({ ok: false, reason: "current_missing" }, { headers: NO_STORE });
    }
    const r = await testRakutenCreds({ licenseKey: input.licenseKey, serviceSecret });
    if (!r.ok) console.warn("[credentials/rakuten/test]", JSON.stringify({ reason: r.reason, status: r.status ?? null }));
    return NextResponse.json(r, { headers: NO_STORE });
  } catch (e) {
    console.error("[credentials/rakuten/test] failed", (e as Error)?.name ?? "Error");
    return NextResponse.json({ ok: false, reason: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
