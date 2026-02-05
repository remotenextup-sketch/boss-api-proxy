export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const CLIENT_ID = process.env.BOSS_CLIENT_ID!;
  const CLIENT_SECRET = process.env.BOSS_CLIENT_SECRET!;
  const REDIRECT_URI = process.env.BOSS_REDIRECT_URI!;

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

  // ★ ここが重要：find-order-id と完全一致
  await kv.set("boss:token", {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  });

  return NextResponse.json({ ok: true });
}

