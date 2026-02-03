import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export async function GET() {
  try {
    const token = await kv.get("boss:access_token");
    if (!token) {
      return NextResponse.json({ ok: false, message: "No token in KV" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, token });
  } catch (err: any) {
    return NextResponse.json({ ok: false, message: err.message }, { status: 500 });
  }
}

