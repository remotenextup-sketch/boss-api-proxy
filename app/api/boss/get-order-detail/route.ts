import { NextRequest, NextResponse } from "next/server";
import { getValidBossAccessToken } from "@/lib/bossToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get("orderId");

  if (!orderId) {
    return NextResponse.json(
      { ok: false, reason: "orderId_required" },
      { status: 400 }
    );
  }

  const accessToken = await getValidBossAccessToken();

  const res = await fetch(
    `${process.env.BOSS_API_BASE_URL}/v1/orders/${orderId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok) {
    const raw = await res.text();
    return NextResponse.json(
      { ok: false, reason: "boss_error", raw },
      { status: 502 }
    );
  }

  const data = await res.json();
  const shipment = data.shipments?.[0] ?? {};

  return NextResponse.json({
    ok: true,
    orderStatus: data.orderStatus ?? null,
    carrier: shipment.deliveryCompanyName ?? null,
    trackingNumber: shipment.trackingNumber ?? null,
  });
}

