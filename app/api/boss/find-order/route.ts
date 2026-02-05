export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";


/* ===============================
   型
================================ */
type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
};

/* ===============================
   util
================================ */
function decodeJwtExp(token: string): number {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64").toString("utf8")
  );
  return payload.exp;
}

function isExpired(expiresAt: number, marginSec = 60): boolean {
  return Date.now() / 1000 > expiresAt - marginSec;
}

/* ===============================
   Token取得（KV + refresh）
================================ */
async function getValidBossAccessToken(): Promise<string> {
  const key = "boss:token";
  const token = (await kv.get<BossToken>(key)) ?? null;

  if (token && !isExpired(token.expires_at)) {
    return token.access_token;
  }

  if (!token?.refresh_token) {
    throw new Error("BOSS refresh_token not found in KV");
  }

  console.log("🔁 Refreshing BOSS access token");

  const res = await fetch(
    "https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        client_id: process.env.BOSS_CLIENT_ID!,
        client_secret: process.env.BOSS_CLIENT_SECRET!,
      }),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token refresh failed: ${t}`);
  }

  const json = await res.json();

  const newToken: BossToken = {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? token.refresh_token,
    expires_at: decodeJwtExp(json.access_token),
  };

  await kv.set(key, newToken);
  return newToken.access_token;
}

/* ===============================
   API本体
================================ */
export async function POST(req: NextRequest) {
  try {
    const { mallOrderNumber } = await req.json();

    if (!mallOrderNumber) {
      return NextResponse.json(
        { ok: false, reason: "mallOrderNumber_required" },
        { status: 400 }
      );
    }

    const accessToken = await getValidBossAccessToken();
    const base = process.env.BOSS_API_BASE_URL!;

    /* -------- SearchOrder -------- */
    const searchRes = await fetch(`${base}/v1/orders/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ mallOrderNumber }),
    });

    if (!searchRes.ok) {
      const t = await searchRes.text();
      return NextResponse.json(
        { ok: false, reason: "search_failed", raw: t },
        { status: 502 }
      );
    }

    const orderIds: number[] = await searchRes.json();

    if (!orderIds || orderIds.length === 0) {
      return NextResponse.json({ ok: false, reason: "not_found" });
    }

    if (orderIds.length > 1) {
      return NextResponse.json({
        ok: false,
        reason: "ambiguous",
        orderIds,
      });
    }

    const orderId = orderIds[0];

    /* -------- Order Detail -------- */
    const detailRes = await fetch(`${base}/v1/orders/${orderId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!detailRes.ok) {
      const t = await detailRes.text();
      return NextResponse.json(
        { ok: false, reason: "detail_failed", raw: t },
        { status: 502 }
      );
    }

    const detail = await detailRes.json();

    /* -------- Dify向け最小レスポンス -------- */
    return NextResponse.json({
      ok: true,
      order: {
        orderId,
        mallOrderNumber: detail.mallOrderNumber,
        orderStatus: detail.orderStatus,
        shipmentStatus: detail.shipmentStatus,
        carrier: detail.shipments?.[0]?.carrierName ?? null,
        trackingNumber: detail.shipments?.[0]?.trackingNumber ?? null,
      },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, reason: "internal_error", message: e.message },
      { status: 500 }
    );
  }
}

