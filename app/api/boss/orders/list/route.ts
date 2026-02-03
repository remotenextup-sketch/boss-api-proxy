// app/api/boss/orders/list/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // ① リクエスト body を JSON として取得
    const body = await req.json();

    if (!body.orders || !Array.isArray(body.orders)) {
      return NextResponse.json(
        { ok: false, message: "orders 配列を指定してください" },
        { status: 400 }
      );
    }

    // ② KV からアクセストークン取得
    const accessToken = await kv.get<string>("boss:access_token");
    if (!accessToken) {
      return NextResponse.json(
        { ok: false, message: "KV に access_token がありません" },
        { status: 401 }
      );
    }

    // ③ BOSS API /v1/orders/list に POST
    const res = await fetch("https://api.boss-oms.jp/api/v1/orders/list", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    // ④ 失敗時も raw を返す
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, status: res.status, raw: text },
        { status: res.status }
      );
    }

    return NextResponse.json({
      ok: true,
      data: JSON.parse(text),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

