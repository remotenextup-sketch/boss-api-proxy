export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// app/api/bossOrderList/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getValidBossAccessToken } from "@/lib/bossToken";

const BOSS_ORDERS_LIST_URL =
  "https://api.boss-oms.jp/v1/orders/list";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderIds } = body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "orderIds (number[]) is required" },
        { status: 400 }
      );
    }

    const accessToken = await getValidBossAccessToken();

    const res = await fetch(BOSS_ORDERS_LIST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "X-API-KEY": process.env.BOSS_CLIENT_ID!,
      },
      body: JSON.stringify({
        orders: orderIds,
      }),
    });

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          stage: "orders.list",
          status: res.status,
          raw: json,
        },
        { status: res.status }
      );
    }

    return NextResponse.json({
      ok: true,
      data: json,
    });
  } catch (err: any) {
    console.error("bossOrderList error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}

