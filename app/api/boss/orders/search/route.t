// app/api/boss/orders/search/route.ts
import { NextResponse } from "next/server";
import { getValidBossAccessToken } from "@/lib/bossToken";

export async function POST(req: Request) {
  const body = await req.json();

  console.log("=== SearchOrder DEBUG ===");
  console.log("Incoming body:", JSON.stringify(body, null, 2));

  try {
    const accessToken = await getValidBossAccessToken();

    const bossRes = await fetch(
      "https://api.boss-oms.jp/v1/orders/search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const text = await bossRes.text();

    console.log("BOSS status:", bossRes.status);
    console.log("BOSS raw response:", text);

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }

    return NextResponse.json({
      ok: bossRes.ok,
      status: bossRes.status,
      requestBody: body,
      bossResponse: json,
    });
  } catch (err: any) {
    console.error("[SearchOrder ERROR]", err);

    return NextResponse.json(
      {
        ok: false,
        error: err.message ?? "unknown error",
      },
      { status: 500 }
    );
  }
}

