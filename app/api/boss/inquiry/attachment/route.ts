export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireProxyApiKey } from "@/lib/proxyAuth";
import { rakutenEsaHeader } from "@/lib/rakutenCreds";

const RAKUTEN_BASE = "https://api.rms.rakuten.co.jp";

// 認証情報は lib/rakutenCreds.ts から（画面で差し替えた値が KV にあればそれ、無ければ今までどおり環境変数）
const buildEsaAuthHeader = rakutenEsaHeader;


export async function GET(req: NextRequest) {
  const denied = requireProxyApiKey(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  const label = searchParams.get("label");

  if (!path) {
    return NextResponse.json({ ok: false, reason: "path is required" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ ok: false, reason: "label is required" }, { status: 400 });
  }

  let authHeader: string;
  try {
    authHeader = await buildEsaAuthHeader();
  } catch (e) {
    return NextResponse.json({ ok: false, reason: (e as Error).message }, { status: 500 });
  }

  const url = `${RAKUTEN_BASE}/es/1.0/inquirymng-api/attachment?path=${encodeURIComponent(path)}&label=${encodeURIComponent(label)}`;

  const rakutenRes = await fetch(url, {
    headers: { Authorization: authHeader },
  });

  if (!rakutenRes.ok) {
    const errText = await rakutenRes.text().catch(() => '');
    return NextResponse.json(
      { ok: false, reason: `Rakuten API returned ${rakutenRes.status}`, detail: errText, url },
      { status: 502 }
    );
  }

  const contentType = rakutenRes.headers.get("content-type") ?? "application/octet-stream";
  const buffer = await rakutenRes.arrayBuffer();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
