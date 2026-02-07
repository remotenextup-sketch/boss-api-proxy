export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { kv } from "@vercel/kv";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
};

export async function POST(req: Request) {
  console.log("🔥 HIT orders/list");

  try {
    // ------------------------
    // 1. リクエストボディ取得
    // ------------------------
    const body = await req.json();
    const orders = body?.orders;

    if (!Array.isArray(orders) || orders.length === 0) {
      return Response.json(
        {
          ok: false,
          reason: "invalid_request",
          message: "orders must be a non-empty array",
        },
        { status: 400 }
      );
    }

    // ------------------------
    // 2. KV からトークン取得
    // ------------------------
    const token = (await kv.get("boss:token")) as BossToken | null;

    if (!token || !token.access_token) {
      return Response.json(
        {
          ok: false,
          reason: "no_token",
          message: "BOSS access token not found. Authorization required.",
        },
        { status: 401 }
      );
    }

    // ------------------------
    // 3. トークン有効期限チェック
    // ------------------------
    const now = Math.floor(Date.now() / 1000);

    if (token.expires_at <= now) {
      console.warn("❌ BOSS access token expired");

      return Response.json(
        {
          ok: false,
          reason: "token_expired",
          message: "BOSS access token expired. Reauthorization required.",
        },
        { status: 401 }
      );
    }

    // ------------------------
    // 4. BOSS orders/list 呼び出し
    // ------------------------
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
      console.error("❌ BOSS orders/list error", res.status, raw);

      return Response.json(
        {
          ok: false,
          reason: "boss_api_error",
          status: res.status,
          body: raw,
        },
        { status: 500 }
      );
    }

    // ------------------------
    // 5. 正常レスポンス
    // ------------------------
    return Response.json({
      ok: true,
      data: JSON.parse(raw),
    });
  } catch (e: any) {
    console.error("❌ orders/list fatal", e);

    return Response.json(
      {
        ok: false,
        reason: "internal_error",
        message: e.message,
      },
      { status: 500 }
    );
  }
}

