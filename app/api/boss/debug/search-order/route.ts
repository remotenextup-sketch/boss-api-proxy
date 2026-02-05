export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getValidBossAccessToken } from "@/lib/bossToken";

const endpoint = "https://api.boss-oms.jp/BOSS-API/v1/orders/search";

export async function POST(req: Request) {
  const body = await req.json();

  const accessToken = await getValidBossAccessToken();

  const candidates = [
    {
      label: "① mallOrderNumber only",
      body: {
        mallOrderNumber: body.mallOrderNumber,
      },
    },
    {
      label: "② mallOrderNumber + orderPlacedDateTime",
      body: {
        mallOrderNumber: body.mallOrderNumber,
        orderPlacedDateTime: body.orderPlacedDateTime,
      },
    },
    {
      label: "③ orderPlacedDateTime only",
      body: {
        orderPlacedDateTime: body.orderPlacedDateTime,
      },
    },
  ];

  const results: {
    label: string;
    requestBody: any;
    status?: number;
    response?: any;
    error?: string;
  }[] = [];

  for (const c of candidates) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(c.body),
      });

      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }

      results.push({
        label: c.label,
        requestBody: c.body,
        status: res.status,
        response: json,
      });
    } catch (e: any) {
      results.push({
        label: c.label,
        requestBody: c.body,
        error: e.message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    tested: candidates.length,
    results,
  });
}

