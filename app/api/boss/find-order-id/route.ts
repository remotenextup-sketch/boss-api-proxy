import { NextRequest, NextResponse } from "next/server";
import { getValidBossAccessToken } from "@/lib/bossToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mallOrderNumber =
    req.nextUrl.searchParams.get("mallOrderNumber");

  if (!mallOrderNumber) {
    return NextResponse.json(
      { ok: false, reason: "mallOrderNumber_required" },
      { status: 400 }
    );
  }

  // ★ ここが今回の本丸
  const accessToken = await getValidBossAccessToken();

  const res = await fetch(
    `${process.env.BOSS_API_BASE_URL}/v1/orders/search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mallOrderNumber }),
    }
  );

  if (!res.ok) {
    const raw = await res.text();
    return NextResponse.json(
      { ok: false, reason: "boss_error", raw },
      { status: 502 }
    );
  }

  const orderIds: number[] = await res.json();

  if (!orderIds?.length) {
    return NextResponse.json({ ok: false, reason: "not_found" });
  }

  if (orderIds.length > 1) {
    return NextResponse.json({
      ok: false,
      reason: "ambiguous",
      orderIds,
    });
  }

  return NextResponse.json({
    ok: true,
    orderId: orderIds[0],
  });
}

