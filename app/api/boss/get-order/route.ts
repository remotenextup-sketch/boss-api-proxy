// app/api/boss/get-order/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
};

const TOKEN_KEY = "boss:token";

/**
 * GET /api/boss/get-order?orderId=xxxxx
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId");

    if (!orderId) {
      return NextResponse.json(
        { ok: false, message: "orderId is required" },
        { status: 400 }
      );
    }

    // --- KV からトークン取得 ---
    const token = (await kv.get(TOKEN_KEY)) as BossToken | null;

    if (!token?.access_token) {
      return NextResponse.json(
        { ok: false, message: "no access token in KV" },
        { status: 401 }
      );
    }

    // --- BOSS GetOrder API（正しいURL & GET） ---
    const bossRes = await fetch(
      `https://api.boss-oms.jp/BOSS-API/v1/orders/${orderId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: "application/json",
        },
      }
    );

    const raw = await bossRes.text();

    if (!bossRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: "boss_error",
          status: bossRes.status,
          statusText: bossRes.statusText,
          raw,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: JSON.parse(raw),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        reason: "internal_error",
        message: err?.message ?? "unknown error",
      },
      { status: 500 }
    );
  }
}

