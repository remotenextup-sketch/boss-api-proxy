// app/api/boss/order/route.ts
import { NextResponse } from 'next/server';
import fetch from 'node-fetch';
import { getTokensFromKV, setTokens } from '../../utils/kv'; // KV操作関数
import { BOSS_CLIENT_ID, BOSS_CLIENT_SECRET, BOSS_API_URL } from '../../config';

// KV前提でアクセストークンを取得
async function getValidAccessToken(): Promise<string> {
  const tokens = await getTokensFromKV();
  if (!tokens || !tokens.refreshToken) {
    throw new Error('No refresh token found in KV');
  }

  const { accessToken, refreshToken, expiresAt } = tokens;

  // 有効期限が残っていればそのまま返す
  if (accessToken && expiresAt && Date.now() < expiresAt) {
    return accessToken;
  }

  // アクセストークンが無効 or 期限切れ → refresh
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
    throw new Error(`Failed to refresh token: ${errText}`);
  }

  const data: { access_token: string; expires_in: number; refresh_token?: string } =
    await res.json();

  // 新しいトークンを KV に保存（refresh_token が返ってきた場合は上書き）
  const newAccessToken = data.access_token;
  const newRefreshToken = data.refresh_token ?? refreshToken;
  const newExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // 1分前に余裕を持たせる

  await setTokens({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt: newExpiresAt,
  });

  return newAccessToken;
}

export async function POST(req: Request) {
  try {
    const { orderNumber } = await req.json();
    if (!orderNumber) {
      return NextResponse.json({ ok: false, message: 'orderNumber is required' });
    }

    const accessToken = await getValidAccessToken();

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

// GETリクエスト → 生存確認用
export async function GET() {
  return NextResponse.json({ ok: true, message: 'Order API is alive' });
}

