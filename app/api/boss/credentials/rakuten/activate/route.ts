// 楽天の認証情報の切替（試験に通ったときだけ保存。今の設定は「前の設定」に残す）
//   POST /api/boss/credentials/rakuten/activate  { licenseKey, serviceSecret? }   x-api-key: BOSS_CREDENTIALS_API_KEY
//   serviceSecret を送らなければ、今の serviceSecret のままライセンスキーだけを使う
//   → { ok, expiryDate, daysLeft, licenseKeyChanged, serviceSecretChanged } または { ok:false, reason, status? }（RMS の応答本文・値は返さない）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCredentialsApiKey } from "@/lib/credentialsAuth";
import { activateRakutenCreds, parseCredsInput } from "@/lib/rakutenCreds";

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
    const r = await activateRakutenCreds(input);
    console.info("[credentials/rakuten/activate]", JSON.stringify(r.ok ? { ok: true, licenseKeyChanged: r.licenseKeyChanged, serviceSecretChanged: r.serviceSecretChanged } : { ok: false, reason: r.reason, status: r.status ?? null }));
    return NextResponse.json(r, { status: r.ok ? 200 : r.reason === "not_configured" ? 503 : r.reason === "busy" ? 409 : 200, headers: NO_STORE });
  } catch (e) {
    console.error("[credentials/rakuten/activate] failed", (e as Error)?.name ?? "Error");
    return NextResponse.json({ ok: false, reason: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
