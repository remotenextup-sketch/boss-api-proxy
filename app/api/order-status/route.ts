// app/api/order-status/route.ts
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: Request) {
  const body = await req.json();
  const { mallOrderNumber } = body;

  console.log("mallOrderNumber", mallOrderNumber);

  return NextResponse.json({
    ok: true,
    mallOrderNumber,
  });
}
