export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { kv } from "@vercel/kv";
import { refreshToken } from "./refreshToken";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

export async function POST(req: Request) {
  console.log("🔥 HIT orders/list");

  try {
    // ------------------------
    // 1. input
    // ------------------------
    const body = await req.json();
    const orders = body?.orders;

    if (!Array.isArray(orders) || orders.length === 0) {
      return Response.json(
        { ok: false, message: "orders must be array" },
        { status: 400 }
      );
    }

    // ------------------------
    // 2. token load
    // ------------------------
    let token = (await kv.get("boss:token")) as BossToken | null;

    if (!token) {
      return Response.json(
        { ok: false, message: "no token in KV" },
        { status: 401 }
      );
    }

    // ------------------------
    // 3. refresh if expired
    // ------------------------
    const now = Math.floor(Date.now() / 1000);
    if (token.expires_at <= now) {
      console.log("🔄 token expired, refreshing");
      token = await refreshToken(token);
    }

    // ------------------------
    // 4. call BOSS API
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

    const text = await res.text();

    if (!res.ok) {
      console.error("❌ BOSS orders/list error", res.status, text);
      return Response.json(
        {
          ok: false,
          where: "boss_api",
          status: res.status,
          body: text,
        },
        { status: 500 }
      );
    }

    // ------------------------
    // 5. success
    // ------------------------
    return Response.json({
      ok: true,
      data: JSON.parse(text),
    });
  } catch (e: any) {
    console.error("❌ orders/list fatal", e);
    return Response.json(
      { ok: false, message: e.message },
      { status: 500 }
    );
  }
}

