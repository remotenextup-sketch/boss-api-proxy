import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const accessToken = await kv.get<string>("boss:access_token");
    const clientId = process.env.BOSS_CLIENT_ID;

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, message: "no access token in KV" },
        { status: 401 }
      );
    }

    if (!clientId) {
      return NextResponse.json(
        { ok: false, message: "BOSS_CLIENT_ID is not set" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { orders } = body;

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json(
        { ok: false, message: "orders (orderId array) is required" },
        { status: 400 }
      );
    }

    const res = await fetch(
      "https://api.boss-oms.jp/api/v1/orders/list", // ← ★ここが決定打
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-API-KEY": clientId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orders }),
      }
    );

    const text = await res.text();
    let data: any;

    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          stage: "orders.list",
          status: res.status,
          raw: data,
        },
        { status: res.status }
      );
    }

    return NextResponse.json({
      ok: true,
      data,
    });
  } catch (err: any) {
    console.error("orders/list error:", err);
    return NextResponse.json(
      { ok: false, error: err.message ?? "unknown error" },
      { status: 500 }
    );
  }
}

