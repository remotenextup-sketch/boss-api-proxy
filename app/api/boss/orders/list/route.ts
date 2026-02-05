// app/api/boss/orders/list/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getValidBossAccessToken } from "@/lib/bossToken";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderId = body.orderId;

    if (!orderId) {
      return NextResponse.json(
        { ok: false, message: "orderId is required" },
        { status: 400 }
      );
    }

    // ★ ここが最重要：key は必ず boss:token
    const token = await getValidBossAccessToken();

    const res = await fetch(
      "https://api.boss-oms.jp/v1/orders/list",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          orders: [orderId],
        }),
      }
    );

    const text = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: "boss_error",
          status: res.status,
          statusText: res.statusText,
          raw: text,
        },
        { status: res.status }
      );
    }

    return NextResponse.json({
      ok: true,
      data: JSON.parse(text),
    });

  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        reason: "internal_error",
        message: e.message,
      },
      { status: 500 }
    );
  }
}

