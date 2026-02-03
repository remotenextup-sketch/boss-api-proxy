import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export async function GET() {
  const mockData = {
    access_token: "mock_access_token_123",
    refresh_token: "mock_refresh_token_456",
    expires_at: Date.now() + 3600 * 1000,
  };

  await kv.set("boss:access_token", mockData.access_token);
  await kv.set("boss:refresh_token", mockData.refresh_token);
  await kv.set("boss:expires_at", mockData.expires_at);

  return NextResponse.json({ ok: true, ...mockData });
}

