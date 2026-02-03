// app/api/boss/orders/search/route.ts
import { NextResponse } from "next/server";
import { getBossAccessToken } from "@/lib/bossToken";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { mallOrderNumber } = body;

    if (!mallOrderNumber || typeof mallOrderNumber !== "string") {
      return NextResponse.json(
        {
          ok: false,
          error: "mallOrderNumber is required",
          received: mallOrderNumber,
        },
        { status: 400 }
      );
    }

    // 🔑 常に「有効な」アクセストークンを取得
    const accessToken = await getBossAccessToken();

    const res = await fetch(
      "https://api.boss-oms.jp/api/v1/orders/search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          includeDeletedOrders: false,
          ...body,
        }),
      }
    );

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
  } catch (e: any) {
    console.error("orders/search error:", e);
    return NextResponse.json(
      { ok: false, error: e.message ?? "unknown error" },
      { status: 500 }
    );
  }
}

