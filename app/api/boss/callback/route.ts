// app/api/boss/callback/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json({ ok: false, message: "No code provided" }, { status: 400 });
    }

    // BOSS トークン取得
    const tokenRes = await fetch(
      "https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: process.env.BOSS_CLIENT_ID!,
          client_secret: process.env.BOSS_CLIENT_SECRET!, // 必須なら残す
          redirect_uri: process.env.BOSS_REDIRECT_URI!, // Vercel デプロイ先 URL
          code,
        }).toString(),
      }
    );

    const text = await tokenRes.text();
    console.log("BOSS token raw:", text);

    if (!tokenRes.ok) {
      return NextResponse.json(
        { ok: false, error: "token_exchange_failed", detail: text },
        { status: tokenRes.status }
      );
    }

    const data = JSON.parse(text);

    if (!data.access_token) {
      return NextResponse.json({ ok: false, message: "No access_token in response", data }, { status: 500 });
    }

    // Redis に保存
    await kv.set("boss:access_token", data.access_token);
    await kv.set("boss:refresh_token", data.refresh_token);
    await kv.set("boss:expires_at", Date.now() + data.expires_in * 1000);

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    console.error("callback exception:", e);
    return NextResponse.json(
      { ok: false, error: "callback_exception", message: e.message },
      { status: 500 }
    );
  }
}

