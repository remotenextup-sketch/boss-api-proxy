export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  // 本番APIのレスポンスを模したモック
  const mockData = {
    ok: true,
    access_token: "mock_access_token_123",
    refresh_token: "mock_refresh_token_456",
    expires_at: Date.now() + 3600 * 1000,
  };

  return NextResponse.json(mockData);
}

