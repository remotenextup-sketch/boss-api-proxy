// app/api/boss/orders/search/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

const BOSS_ORDERS_SEARCH_URL =
  "https://api.boss-oms.jp/api/v1/orders/search";

export async function POST(req: Request) {
  const accessToken = await kv.get<string>("boss:access_token");

  if (!accessToken) {
    return NextResponse.json(
      { ok: false, message: "no access token" },
      { status: 401 }
    );
  }

  const body = await req.json();

  const res = await fetch(BOSS_ORDERS_SEARCH_URL, {
    method: "POST",
    headers: {
      // 🔑 必須2点
      "Authorization": `Bearer ${accessToken}`,
      "X-API-KEY": process.env.BOSS_CLIENT_ID!, // ★これが抜けてた
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      includeDeletedOrders: false,
      ...body,
    }),
  });

  const text = await res.text();

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return NextResponse.json({
    ok: res.ok,
    status: res.status,
    data: json,
  });
}

