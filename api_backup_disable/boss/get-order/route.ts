import { NextRequest, NextResponse } from "next/server";
import { getValidBossAccessToken } from "@/lib/bossToken";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json();

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
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    const raw = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: "detail_failed", raw },
        { status: 502 }
      );
    }

    const detail = JSON.parse(raw);

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
    return NextResponse.json(
      { ok: false, reason: "internal_error", message: e.message },
      { status: 500 }
    );
  }
}

