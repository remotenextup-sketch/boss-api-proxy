// app/api/boss/orders/list/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { refreshToken } from "./refreshToken";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

function isExpired(token: BossToken): boolean {
  return token.expires_at <= Math.floor(Date.now() / 1000) + 5;
}

async function fetchOrders(
  token: string,
  orders: number[]
): Promise<Response> {
  return fetch("https://api.boss-oms.jp/BOSS-API/v1/orders/list", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ orders }),
  });
}

export async function POST(req: Request) {
  try {
    console.info("🔥 HIT orders/list");

    const body = await req.json();
    const orders = body?.orders;

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json(
        { ok: false, message: "orders is required and must be array" },
        { status: 400 }
      );
    }

    let token = await kv.get<BossToken>("boss:token");

    if (!token?.access_token) {
      return NextResponse.json(
        { ok: false, message: "no access token" },
        { status: 401 }
      );
    }

    // ① 期限切れなら refresh
    if (isExpired(token)) {
      console.info("❌ BOSS access token expired");
      token = await refreshToken();
    }

    // ② BOSS API 実行
    let res = await fetchOrders(token.access_token, orders);

    // ③ 途中で401なら再 refresh → 再試行（保険）
    if (res.status === 401) {
      console.info("⚠️ 401 detected, retry after refresh");
      token = await refreshToken();
      res = await fetchOrders(token.access_token, orders);
    }

    const raw = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: "boss_error",
          status: res.status,
          raw,
        },
        { status: 500 }
      );
    }

    const data = JSON.parse(raw);

    return NextResponse.json({
      ok: true,
      data,
    });
  } catch (e: any) {
    console.error("❌ orders/list fatal", e);
    return NextResponse.json(
      { ok: false, reason: "internal_error", message: e.message },
      { status: 500 }
    );
  }
}

