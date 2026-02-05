// app/api/boss/find-order-id/route.ts

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
};

function decodeJwtExp(token: string): number {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64").toString("utf8")
  );
  return payload.exp;
}

function isExpired(expiresAt: number, marginSec = 60) {
  return Date.now() / 1000 > expiresAt - marginSec;
}

async function getValidBossAccessToken(): Promise<string> {
  const key = "boss:token";
  const token = await kv.get<BossToken>(key);

  // まだ有効な access_token があればそれを使う
  if (token && !isExpired(token.expires_at)) {
    return token.access_token;
  }

  // refresh_token が無い場合は致命的
  if (!token?.refresh_token) {
    throw new Error("refresh_token not found");
  }

  // refresh
  const res = await fetch(process.env.BOSS_AUTH_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: process.env.BOSS_CLIENT_ID!,
      client_secret: process.env.BOSS_CLIENT_SECRET!,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`token refresh failed: ${t}`);
  }

  const json = await res.json();

  const newToken: BossToken = {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? token.refresh_token,
    expires_at: decodeJwtExp(json.access_token),
  };

  await kv.set(key, newToken);

  return newToken.access_token;
}

export async function GET(req: NextRequest) {
  try {
    // query param 取得（Dify / curl 用）
    const mallOrderNumber =
      req.nextUrl.searchParams.get("mallOrderNumber");

    if (!mallOrderNumber) {
      return NextResponse.json(
        { ok: false, reason: "mallOrderNumber_required" },
        { status: 400 }
      );
    }

    const accessToken = await getValidBossAccessToken();
    const baseUrl = process.env.BOSS_API_BASE_URL!;

    // BOSS 注文検索
    const res = await fetch(`${baseUrl}/v1/orders/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mallOrderNumber }),
    });

    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json(
        { ok: false, reason: "search_failed", raw: t },
        { status: 502 }
      );
    }

    const orderIds: number[] = await res.json();

    if (!orderIds || orderIds.length === 0) {
      return NextResponse.json({
        ok: false,
        reason: "not_found",
      });
    }

    if (orderIds.length > 1) {
      return NextResponse.json({
        ok: false,
        reason: "ambiguous",
        orderIds,
      });
    }

    return NextResponse.json({
      ok: true,
      orderId: orderIds[0],
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        reason: "internal_error",
        message: e?.message ?? "unknown_error",
      },
      { status: 500 }
    );
  }
}

