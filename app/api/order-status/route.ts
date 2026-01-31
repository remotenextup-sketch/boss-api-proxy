import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const BOSS_API_BASE = "https://api.boss-oms.jp/BOSS-API";
const AUTH_URL = `${BOSS_API_BASE}/auth`;

async function getValidAccessToken() {
  const now = Date.now();

  let accessToken = await kv.get<string>("boss:access_token");
  const refreshToken = await kv.get<string>("boss:refresh_token");
  const expiresAt = await kv.get<number>("boss:expires_at");

  // 有効ならそのまま使う
  if (accessToken && expiresAt && now < expiresAt) {
    return accessToken;
  }

  if (!refreshToken) {
    throw new Error("Refresh token not found");
  }

  // 🔄 トークン更新
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: process.env.BOSS_CLIENT_ID,
      client_secret: process.env.BOSS_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to refresh access token");
  }

  const data = await res.json();

  const newAccessToken = data.access_token;
  const newRefreshToken = data.refresh_token;
  const expiresIn = data.expires_in; // 秒

  await kv.set("boss:access_token", newAccessToken);
  await kv.set("boss:refresh_token", newRefreshToken);
  await kv.set("boss:expires_at", now + expiresIn * 1000);

  return newAccessToken;
}

export async function POST(req: NextRequest) {
  try {
    const { mallOrderNumber } = await req.json();

    if (!mallOrderNumber) {
      return NextResponse.json(
        { ok: false, message: "mallOrderNumber is required" },
        { status: 400 }
      );
    }

    // 🔑 有効なアクセストークン取得
    const accessToken = await getValidAccessToken();

    // 1️⃣ 注文検索
    const searchRes = await fetch(`${BOSS_API_BASE}/SearchOrder`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ mallOrderNumber }),
    });

    const searchData = await searchRes.json();

    if (!searchData.orders || searchData.orders.length === 0) {
      return NextResponse.json(
        { ok: false, message: "Order not found" },
        { status: 404 }
      );
    }

    const orderId = searchData.orders[0];

    // 2️⃣ 注文詳細取得
    const detailRes = await fetch(`${BOSS_API_BASE}/GetOrder`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ orderId }),
    });

    const detailData = await detailRes.json();

    // 3️⃣ Dify 用に整形して返却
    return NextResponse.json({
      ok: true,
      order: {
        orderNumber: detailData.orderNumber,
        status: detailData.status,
        deliveryDate: detailData.deliveryDate,
        items: detailData.items ?? [],
        totalAmount: detailData.totalAmount,
      },
    });
  } catch (err: any) {
    console.error("❌ order-status error:", err);
    return NextResponse.json(
      { ok: false, message: err.message },
      { status: 500 }
    );
  }
}

