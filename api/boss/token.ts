// api/boss/token.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTokensFromKV, setTokens } from '../../lib/use-token';

const TOKEN_ENDPOINT =
  'https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token';

/**
 * 内部利用用（他APIから呼ぶ）
 */
export async function getAccessToken(): Promise<string> {
  const tokens = await getTokensFromKV();

  if (!tokens?.refreshToken) {
    throw new Error('refresh token not found in KV');
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.BOSS_CLIENT_ID!,
      client_secret: process.env.BOSS_CLIENT_SECRET!,
      refresh_token: tokens.refreshToken,
    }),
  });

  const json = await response.json();

  if (!json.access_token) {
    console.error('TOKEN ERROR RESPONSE', json);
    throw new Error('failed to refresh access token');
  }

  await setTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? tokens.refreshToken,
  });

  return json.access_token;
}

/**
 * Route Handler（Next13方式）
 */
export async function GET(_req: NextRequest) {
  try {
    const accessToken = await getAccessToken();
    return NextResponse.json({ accessToken });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'token fetch failed' },
      { status: 500 }
    );
  }
}

