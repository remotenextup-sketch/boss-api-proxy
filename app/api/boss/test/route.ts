export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// app/api/boss/test/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";


export async function GET() {
  // ① KVからトークン取得
  const accessToken = await kv.get<string>("boss:access_token");

  if (!accessToken) {
    return NextResponse.json(
      { ok: false, message: "no access token in KV" },
      { status: 401 }
    );
  }

  // ② BOSS APIを叩く（例：ユーザー情報）
  const res = await fetch(
    "https://api.boss-oms.jp/api/v1/me",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const text = await res.text();

  // ③ 失敗時も中身をそのまま返す
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, status: res.status, raw: text },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: JSON.parse(text),
  });
}

