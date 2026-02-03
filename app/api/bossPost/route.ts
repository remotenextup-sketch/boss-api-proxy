// app/api/bossPost/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getBossAccessToken } from "@/lib/bossToken";

/**
 * BOSS Orders Search API
 * POST https://api.boss-oms.jp/v1/orders/search
 */
const BOSS_ORDERS_SEARCH_URL = "https://api.boss-oms.jp/api/v1/orders/search";

export async function POST(req: NextRequest) {
  try {
    // ===============================
    // 1. リクエスト body 取得
    // ===============================
    const body = await req.json();
    const { mallOrderNumber } = body;

    if (!mallOrderNumber) {
      return NextResponse.json(
        { ok: false, error: "mallOrderNumber is required" },
        { status: 400 }
      );
    }

    // ===============================
    // 2. access_token 取得（KV）
    // ===============================
    const accessToken = await getBossAccessToken();

    // ===============================
    // 3. BOSS API 呼び出し
    // ===============================
    const res = await fetch(BOSS_ORDERS_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        // 🔑 BOSS 正式仕様
        "Authorization": `Bearer ${accessToken}`,
        "X-API-KEY": process.env.BOSS_CLIENT_ID!, // client_id
      },
      body: JSON.stringify({
        mallOrderNumber,
      }),
    });

    // ===============================
    // 4. レスポンス処理
    // ===============================
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
          stage: "orders.search",
          status: res.status,
          raw: json,
        },
        { status: res.status }
      );
    }

    // ===============================
    // 5. 正常終了
    // ===============================
    return NextResponse.json({
      ok: true,
      data: json,
    });
  } catch (err: any) {
    console.error("bossPost error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? "unknown error",
      },
      { status: 500 }
    );
  }
}

