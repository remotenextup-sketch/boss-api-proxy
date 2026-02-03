// app/api/boss/oauth/callback/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

export async function GET(req: Request) {
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
      { ok: false, message: "env variables missing" },
      { status: 500 }
    );
  }

  try {
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
          redirect_uri: REDIRECT_URI,
        }),
      }
    );

    const raw = await tokenRes.text();
    console.log("BOSS token raw:", raw);

    if (!tokenRes.ok) {
      return NextResponse.json(
        { ok: false, message: "token exchange failed", raw },
        { status: 500 }
      );
    }

    const data = JSON.parse(raw);

    // ===== KV保存 =====
    await kv.set("boss:access_token", data.access_token);
    await kv.set("boss:refresh_token", data.refresh_token);
    await kv.set(
      "boss:expires_at",
      Date.now() + data.expires_in * 1000
    );

    // フロント確認用（最小）
    return NextResponse.json({
      ok: true,
      access_token: data.access_token,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
