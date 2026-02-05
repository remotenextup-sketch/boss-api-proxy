export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const AUTH_URL = "https://api.boss-oms.jp/BOSS-API/auth";

export async function POST() {
  try {
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.BOSS_CLIENT_ID ?? "",
        client_secret: process.env.BOSS_CLIENT_SECRET ?? "",
      }),
    });

    // ★ 必須① 生レスポンス取得
    const text = await res.text();
    console.log("[BOSS token raw response]", {
      status: res.status,
      body: text,
    });

    // ★ HTTPエラーガード
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: "BOSS auth failed",
          status: res.status,
          raw: text,
        },
        { status: 500 }
      );
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          message: "Invalid JSON from BOSS",
          raw: text,
        },
        { status: 500 }
      );
    }

    // ★ 必須② access_token ガード
    if (!data.access_token) {
      return NextResponse.json(
        {
          ok: false,
          message: "access_token missing",
          raw: data,
        },
        { status: 500 }
      );
    }

    // ★ ここで初めて Redis
    await kv.set("boss:access_token", data.access_token);

    if (data.refresh_token) {
      await kv.set("boss:refresh_token", data.refresh_token);
    }

    if (data.expires_in) {
      await kv.set("boss:expires_at", Date.now() + data.expires_in * 1000);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[BOSS auth fatal]", err);
    return NextResponse.json(
      { ok: false, message: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}

