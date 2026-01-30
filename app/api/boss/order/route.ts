// app/api/boss/order/route.ts
import { NextResponse } from 'next/server';
import fetch from 'node-fetch';

const BOSS_API_URL = 'https://api.example.com/orders'; // 注文詳細APIのベースURL
const BOSS_CLIENT_ID = process.env.BOSS_CLIENT_ID;
const BOSS_CLIENT_SECRET = process.env.BOSS_CLIENT_SECRET;

// リフレッシュトークンからアクセストークンを取得
async function getAccessToken(refreshToken: string) {
  const res = await fetch('https://api.example.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: BOSS_CLIENT_ID,
      client_secret: BOSS_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Token fetch failed: ${errText}`);
  }

  const data = await res.json();
  return data.access_token; // アクセストークン
}

export async function POST(req: Request) {
  try {
    const { orderNumber, refreshToken } = await req.json();

    if (!orderNumber || !refreshToken) {
      return NextResponse.json({ ok: false, message: 'orderNumber and refreshToken required' }, { status: 400 });
    }

    const accessToken = await getAccessToken(refreshToken);

    const res = await fetch(`${BOSS_API_URL}/${orderNumber}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ ok: false, message: errText }, { status: res.status });
    }

    const orderData = await res.json();
    return NextResponse.json({ ok: true, order: orderData });
  } catch (err: any) {
    return NextResponse.json({ ok: false, message: err.message }, { status: 500 });
  }
}

