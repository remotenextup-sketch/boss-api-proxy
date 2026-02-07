// app/api/boss/orders/list/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

/**
 * KV に保存されているトークン形式
 */
type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
};

/**
 * JWT の exp を読む
 */
function decodeJwtExp(token: string): number {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64").toString("utf8")
  );
  return payload.exp;
}

/**
 * 有効期限チェック（60秒マージン）
 */
function isExpired(expiresAt: number, marginSec = 60) {
  return Date.now() / 1000 > expiresAt - marginSec;
}

/**
 * 有効な access_token を取得（必要なら refresh）
 */
async function getValidBossAccessToken(): Promise<string> {
  const TOKEN_KEY = "boss:token";
  const REFRESH_LOCK_KEY = "boss:refresh-lock";

  const token = await kv.get<BossToken>(TOKEN_KEY);

  if (!token) {
    throw new Error("no access token in KV");
  }

  // まだ有効
  if (!isExpired(token.expires_at)) {
    return token.access_token;
  }

  // refresh 多重防止
  const locked = await kv.get<boolean>(REFRESH_LOCK_KEY);
  if (locked) {
    // 少し待って再取得
    await new Promise((r) => setTimeout(r, 800));
    const retry = await kv.get<BossToken>(TOKEN_KEY);
    if (retry && !isExpired(retry.expires_at)) {
      return retry.access_token;
    }
  }

  await kv.set(REFRESH_LOCK_KEY, true, { ex: 30 });

  try {
    const res = await fetch(
      "https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token.refresh_token,
          client_id: process.env.BOSS_CLIENT_ID!,
          client_secret: process.env.BOSS_CLIENT_SECRET!,
          redirect_uri: process.env.BOSS_REDIRECT_URI!, // ★必須
        }),
      }
    );

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`refresh failed: ${raw}`);
    }

    const json = JSON.parse(raw);

    const newToken: BossToken = {
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? token.refresh_token,
      expires_at: decodeJwtExp(json.access_token),
    };

    await kv.set(TOKEN_KEY, newToken);
    return newToken.access_token;
  } finally {
    await kv.del(REFRESH_LOCK_KEY);
  }
}

/**
 * POST /api/boss/orders/list
 * body: { orderId: number }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orderId = body?.orderId;

    if (!orderId) {
      return NextResponse.json(
        { ok: false, message: "orderId is required" },
        { status: 400 }
      );
    }

    const accessToken = await getValidBossAccessToken();
    const base = process.env.BOSS_API_BASE_URL!;

    const res = await fetch(`${base}/v1/orders/list`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        orders: [Number(orderId)], // ★BOSS仕様
      }),
    });

    const raw = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: "boss_error",
          status: res.status,
          statusText: res.statusText,
          raw,
        },
        { status: 502 }
      );
    }

    const data = JSON.parse(raw);

    return NextResponse.json({
      ok: true,
      data,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        reason: "internal_error",
        message: e.message,
      },
      { status: 500 }
    );
  }
}

