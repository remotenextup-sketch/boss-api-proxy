import { NextResponse } from "next/server";
import { getBossAccessToken } from "@/lib/bossToken";

export async function POST(req: Request) {
  const body = await req.json();
  const accessToken = await getBossAccessToken();

  const endpoint = "https://api.boss-oms.jp/v1/orders/search";

  const candidates = [
    {
      label: "① status + orderPlacedDateTime",
      body: {
        orderStatuses: [
          "WaitingShipment",
          "Shipping",
          "Shipped",
          "Completed",
        ],
        orderPlacedDateTime: {
          from: "2026-02-01T00:00:00+09:00",
          to: "2026-02-05T23:59:59+09:00",
        },
      },
    },
    {
      label: "② status + mallOrderNumber",
      body: {
        orderStatuses: [
          "WaitingShipment",
          "Shipping",
          "Shipped",
          "Completed",
        ],
        mallOrderNumber: body.mallOrderNumber,
      },
    },
  ];

  const results = [];

  for (const c of candidates) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(c.body),
    });

    const text = await res.text();
    let json;
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
  }

  return NextResponse.json({
    ok: true,
    tested: candidates.length,
    results,
  });
}

