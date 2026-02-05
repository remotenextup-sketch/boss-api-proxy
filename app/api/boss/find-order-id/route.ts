// app/api/boss/find-order-id/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

const TOKEN_KEY = "boss:token";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mallOrderNumber = body?.mallOrderNumber;

    if (!mallOrderNumber) {
      return NextResponse.json(
        { ok: false, reason: "mallOrderNumber_required" },
        { status: 400 }
      );
    }

    const token = (await kv.get(TOKEN_KEY)) as BossToken | null;

    if (!token?.access_token) {
      return NextResponse.json(
        { ok: false, message: "no access token in KV" },
        { status: 401 }
      );
    }

    // ここは既存のSearchOrder処理をそのまま使ってOK
    // （省略してるけど、今動いてるfind-order-idの中身をそのまま移植）

    return NextResponse.json({
      ok: true,
      orderId: 180836007, // ← 実際はBOSSレスポンスから
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, reason: "internal_error", message: err?.message },
      { status: 500 }
    );
  }
}

