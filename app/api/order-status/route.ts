import { NextResponse } from "next/server";
import fetch from "node-fetch"; // 必要なら追加

// Redis 経由でアクセストークンを取得/保存する例
async function getBossAccessToken(): Promise<string> {
  const tokenUrl = process.env.BOSS_TOKEN_ENDPOINT;
  const clientId = process.env.BOSS_CLIENT_ID;
  const clientSecret = process.env.BOSS_CLIENT_SECRET;
  const refreshToken = process.env.BOSS_REFRESH_TOKEN;

  if (!tokenUrl || !clientId || !clientSecret || !refreshToken) {
    throw new Error("BOSS API credentials missing");
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch BOSS token: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

// BOSS API に注文番号を送って注文情報を取得
async function fetchBossOrderStatus(mallOrderNumber: string) {
  const token = await getBossAccessToken();
  const baseUrl = process.env.BOSS_API_BASE_URL;

  if (!baseUrl) throw new Error("BOSS API base URL missing");

  const res = await fetch(`${baseUrl}/orders/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ mallOrderNumber }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BOSS API Error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data;
}

// GET は確認用
export async function GET(req: Request) {
  return new Response("Hello from main branch");
}

// POST で order-status API
export async function POST(req: Request) {
  try {
    const { mallOrderNumber } = await req.json();
    console.log("Received mallOrderNumber:", mallOrderNumber);

    const searchData = await fetchBossOrderStatus(mallOrderNumber);

    // detailData は必要に応じて searchData から加工
    const detailData = searchData.orders?.[0] ?? {};

    console.log("searchData", JSON.stringify(searchData, null, 2));
    console.log("detailData", JSON.stringify(detailData, null, 2));

    return NextResponse.json({ searchData, detailData });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message || "Something went wrong" },
      { status: 500 }
    );
  }
}

