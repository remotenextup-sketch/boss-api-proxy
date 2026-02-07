// app/api/boss/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json(
        { ok: false, message: "no code" },
        { status: 400 }
      );
    }

    const CLIENT_ID = process.env.BOSS_CLIENT_ID;
    const CLIENT_SECRET = process.env.BOSS_CLIENT_SECRET;
    const REDIRECT_URI = process.env.BOSS_REDIRECT_URI;

    if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
      return NextResponse.json(
        { ok: false, message: "missing env" },
        { status: 500 }
      );
    }

    // ★ authorization_code → token 交換（redirect_uri 完全一致）
    const tokenRes = await fetch(
      "https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI, // ★最重要
        }),
      }
    );

    const raw = await tokenRes.text();
    console.log("BOSS token raw:", raw);
    console.log("redirect_uri:", REDIRECT_URI);

    if (!tokenRes.ok) {
      return NextResponse.json(
        { ok: false, message: "token exchange failed", raw },
        { status: 500 }
      );
    }

    const json = JSON.parse(raw);

    if (!json.access_token || !json.refresh_token || !json.expires_in) {
      return NextResponse.json(
        { ok: false, message: "invalid token response", json },
        { status: 500 }
      );
    }

    const token: BossToken = {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + json.expires_in,
    };

    // ★ KV 保存（以降すべてのAPIがこれを使う）
    await kv.set("boss:token", token);

    return NextResponse.json({
      ok: true,
      saved: true,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: "internal_error", error: e.message },
      { status: 500 }
    );
  }
}

