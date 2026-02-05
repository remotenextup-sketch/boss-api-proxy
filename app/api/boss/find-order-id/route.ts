import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mallOrderNumber =
    req.nextUrl.searchParams.get("mallOrderNumber");

  if (!mallOrderNumber) {
    return NextResponse.json(
      { ok: false, error: "mallOrderNumber is required" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    mallOrderNumber,
    step: "reached_real_route",
  });
}

