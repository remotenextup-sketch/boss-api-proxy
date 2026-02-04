// app/api/boss/orders/search/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // ===== 1. access_token を KV から取得 =====
    const accessToken = await kv.get<string>("boss:access_token");

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, message: "No access token in KV" },
        { status: 401 }
      );
    }

    // ===== 2. リクエストボディ取得 =====
    const body = await req.json();

    if (!body.mallOrderNumber) {
      return NextResponse.json(
        { ok: false, message: "mallOrderNumber is required" },
        { status: 400 }
      );
    }

    // ===== 3. BOSS SearchOrder API =====
    const url = "https://api.boss-oms.jp/v1/orders/search";

    const headers = {
      "Content-Type": "application/json",
      // ★ X-API-KEY は送らない（重要）
      Authorization: `Bearer ${accessToken}`,
    };

    const requestBody = {
      mallOrderNumber: body.mallOrderNumber,
      // 必要なら日付条件もここに足せる
      // orderPlacedDateTime: body.orderPlacedDateTime,
    };

    // ===== デバッグログ =====
    console.log("BOSS SearchOrder URL:", url);
    console.log("BOSS headers:", {
      ...headers,
      Authorization: "Bearer ***",
    });
    console.log("BOSS body:", requestBody);

    // ===== 4. API 実行 =====
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    const text = await res.text();

    // ===== 5. レスポンス =====
    if (!res.ok) {
      console.error("BOSS SearchOrder error:", text);
      return NextResponse.json(
        {
          ok: false,
          stage: "searchOrder",
          status: res.status,
          raw: JSON.parse(text),
        },
        { status: res.status }
      );
    }

    return NextResponse.json({
      ok: true,
      stage: "searchOrder",
      status: res.status,
      data: JSON.parse(text),
    });
  } catch (err: any) {
    console.error("SearchOrder fatal error:", err);
    return NextResponse.json(
      { ok: false, message: err.message ?? "unknown error" },
      { status: 500 }
    );
  }
}

