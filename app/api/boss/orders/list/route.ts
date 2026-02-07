export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { kv } from "@vercel/kv";

export async function POST(req: Request) {
  console.log("🔥 FETCH TEST START");

  try {
    const body = await req.json();
    const orders = body?.orders;

    if (!Array.isArray(orders) || orders.length === 0) {
      return Response.json(
        { ok: false, where: "input", message: "orders must be array" },
        { status: 400 }
      );
    }

    const token: any = await kv.get("boss:token");
    if (!token?.access_token) {
      return Response.json(
        { ok: false, where: "token", message: "no access token" },
        { status: 401 }
      );
    }

    let res;
    try {
      res = await fetch("https://api.boss-oms.jp/BOSS-API/v1/orders/list", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          orders: orders.map((id: any) => Number(id)),
        }),
      });
    } catch (e: any) {
      console.error("🔥 FETCH THROW", e);
      return Response.json(
        { ok: false, where: "fetch", message: e.message },
        { status: 500 }
      );
    }

    const text = await res.text();

    console.log("🔥 FETCH STATUS", res.status);
    console.log("🔥 FETCH BODY", text);

    if (!res.ok) {
      return Response.json(
        {
          ok: false,
          where: "boss_response",
          status: res.status,
          body: text,
        },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      data: JSON.parse(text),
    });
  } catch (e: any) {
    console.error("🔥 OUTER ERROR", e);
    return Response.json(
      { ok: false, where: "outer", message: e.message },
      { status: 500 }
    );
  }
}

