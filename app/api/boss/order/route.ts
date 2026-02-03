// app/api/boss/order/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const BOSS_ORDER_API = "https://api.boss-oms.jp/BOSS-API/order";
const BOSS_TOKEN_ENDPOINT = process.env.BOSS_TOKEN_ENDPOINT!;
const CLIENT_ID = process.env.BOSS_CLIENT_ID!;
const CLIENT_SECRET = process.env.BOSS_CLIENT_SECRET!;

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(BOSS_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  const text = await res.text();
  const data = JSON.parse(text);

  if (!res.ok || !data.access_token) {
    throw new Error(`Token refresh failed: ${text}`);
  }

  // KVに更新
  await kv.set("boss:access_token", data.access_token);
  await kv.set("boss:refresh_token", data.refresh_token);
  await kv.set("boss:expires_at", Date.now() + data.expires_in * 1000);

  return data.access_token;
}

async function getAccessToken(): Promise<string | null> {
  const token = await kv.get<string>("boss:access_token");
  const expiresAt = await kv.get<number>("boss:expires_at");

  if (!token || !expiresAt || Date.now() > expiresAt) {
    // 期限切れなら refresh
    const refreshToken = await kv.get<string>("boss:refresh_token");
    if (!refreshToken) return null;
    return await refreshAccessToken(refreshToken);
  }

  return token;
}

export async function POST(req: Request) {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return NextResponse.json(
        { ok: false, message: "No valid access token. Please re-authenticate." },
        { status: 401 }
      );
    }

    const body = await req.json();

    const res = await fetch(BOSS_ORDER_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status, data }, { status: res.status });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, message: err.message }, { status: 500 });
  }
}

