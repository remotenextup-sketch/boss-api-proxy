import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/accessTokenStore";

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Order API is alive",
  });
}

export async function POST(req: Request) {
  try {
    const { orderNumber } = await req.json();

    if (!orderNumber) {
      return NextResponse.json(
        { ok: false, message: "orderNumber is required" },
        { status: 400 }
      );
    }

    // ✅ ここが肝
    const accessToken = await getValidAccessToken();

    // 🔽 本来はここで BOSS API を叩く
    // const res = await fetch("https://boss-api/...", {
    //   headers: {
    //     Authorization: `Bearer ${accessToken}`,
    //   },
    // });

    return NextResponse.json({
      ok: true,
      orderNumber,
      accessTokenUsed: true,
    });
  } catch (err: any) {
    console.error("ORDER API ERROR", err);
    return NextResponse.json(
      { ok: false, message: err.message },
      { status: 500 }
    );
  }
}

