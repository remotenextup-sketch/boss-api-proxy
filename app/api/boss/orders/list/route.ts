export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export async function POST(req: Request) {
  try {
    console.log("🔥 HIT orders/list");

    const body = await req.json();
    const orders = body?.orders;

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json(
        { message: "orders is required and must be array" },
        { status: 400 }
      );
    }

    const token = await kv.get<any>("boss:token");
    if (!token?.access_token) {
      return NextResponse.json(
        { message: "no access token in KV" },
        { status: 401 }
      );
    }

    const res = await fetch(
      "https://api.boss-oms.jp/BOSS-API/v1/orders/list",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          orders: orders.map((id: any) => Number(id)),
        }),
      }
    );

    const raw = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        {
          message: "boss_error",
          status: res.status,
          raw,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(JSON.parse(raw));
  } catch (e: any) {
    return NextResponse.json(
      { message: "internal_error", detail: e.message },
      { status: 500 }
    );
  }
}

