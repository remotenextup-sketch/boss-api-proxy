export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireProxyApiKey } from "@/lib/proxyAuth";

const RAKUTEN_BASE = "https://api.rms.rakuten.co.jp";
const RAKUTEN_EP_INQUIRIES = `${RAKUTEN_BASE}/es/1.0/inquirymng-api/inquiries`;

function buildEsaAuthHeader(): string {
  const serviceSecret = process.env.RAKUTEN_SERVICE_SECRET?.trim();
  const licenseKey = process.env.RAKUTEN_LICENSE_KEY?.trim();
  if (!serviceSecret) throw new Error("RAKUTEN_SERVICE_SECRET is not set");
  if (!licenseKey) throw new Error("RAKUTEN_LICENSE_KEY is not set");
  return (
    "ESA " +
    Buffer.from(`${serviceSecret}:${licenseKey}`, "utf-8").toString("base64")
  );
}


export async function GET(req: NextRequest) {
  const denied = requireProxyApiKey(req);
  if (denied) return denied;

  let authHeader: string;
  try {
    authHeader = buildEsaAuthHeader();
  } catch (e) {
    return NextResponse.json({ ok: false, reason: (e as Error).message }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const fromDate = searchParams.get("fromDate");   // YYYY-MM-DD
  const toDate = searchParams.get("toDate");       // YYYY-MM-DD
  const status = searchParams.get("status") ?? "all"; // all | unread | read
  const limit = searchParams.get("limit") ?? "100";
  const page = searchParams.get("page") ?? "1";

  const params = new URLSearchParams({ status, limit, page });
  if (fromDate) params.set("fromDate", fromDate.length === 10 ? `${fromDate}T00:00:00` : fromDate);
  if (toDate) params.set("toDate", toDate.length === 10 ? `${toDate}T23:59:59` : toDate);

  const url = `${RAKUTEN_EP_INQUIRIES}?${params.toString()}`;

  let rakutenRes: Response;
  try {
    rakutenRes = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: "fetch_failed", detail: String(e) },
      { status: 502 }
    );
  }

  const text = await rakutenRes.text();
  if (!rakutenRes.ok) {
    return NextResponse.json(
      { ok: false, reason: `Rakuten API returned ${rakutenRes.status}`, detail: text },
      { status: 502 }
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_json", detail: text.slice(0, 500) },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, data: json });
}
