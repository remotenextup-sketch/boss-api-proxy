import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const AUTH_URL = "https://api.boss-oms.jp/BOSS-API/auth";

export async function POST() {
  try {
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: process.env.BOSS_CLIENT_ID,
        client_secret: process.env.BOSS_CLIENT_SECRET,
      }),
    });

    const data = await res.json();

    await kv.set("boss:access_token", data.access_token);
    await kv.set("boss:refresh_token", data.refresh_token);
    await kv.set("boss:expires_at", Date.now() + data.expires_in * 1000);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, message: err.message }, { status: 500 });
  }
}

