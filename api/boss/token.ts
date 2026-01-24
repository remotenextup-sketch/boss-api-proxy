// api/boss/token.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTokensFromKV, setTokens } from '../../lib/use-token';

const TOKEN_ENDPOINT =
  'https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    const tokens = await getTokensFromKV();

    if (!tokens?.refreshToken) {
      return res.status(500).json({
        error: 'refresh token not found in KV',
      });
    }

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
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
      return res.status(500).json({
        error: 'failed to refresh access token',
        detail: json,
      });
    }

    await setTokens({
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? tokens.refreshToken,
    });

    return res.status(200).json({
      accessToken: json.access_token,
    });
  } catch (e) {
    console.error('token handler error', e);
    return res.status(500).json({
      error: 'token fetch failed',
    });
  }
}

