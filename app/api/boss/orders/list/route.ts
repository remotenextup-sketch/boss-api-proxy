// app/api/boss/orders/list/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getValidBossAccessToken } from "@/lib/bossToken";

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

    // ★ 統一されたトークン取得（ロック付き）
    let accessToken = await getValidBossAccessToken();

    // BOSS API 実行
    let res = await fetchOrders(accessToken, orders);

    // 401なら再取得 → 再試行（保険）
    if (res.status === 401) {
      console.info("⚠️ 401 detected, retry after refresh");
      accessToken = await getValidBossAccessToken();
      res = await fetchOrders(accessToken, orders);
    }

    const raw = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: "boss_error", status: res.status, raw },
        { status: 500 }
      );
    }

    const data = JSON.parse(raw);

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    console.error("❌ orders/list fatal", e);
    return NextResponse.json(
      { ok: false, reason: "internal_error", message: e.message },
      { status: 500 }
    );
  }
}
