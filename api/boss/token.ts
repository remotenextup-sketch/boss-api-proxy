// api/boss/token.ts
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const tokenRes = await fetch(
    'https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.BOSS_CLIENT_ID!,
        client_secret: process.env.BOSS_CLIENT_SECRET!,
        refresh_token: process.env.BOSS_REFRESH_TOKEN!,
      }),
    }
  );

  const json = await tokenRes.json();

  if (!json.access_token) {
    return res.status(401).json(json);
  }

  // refresh_token が更新された場合
  if (json.refresh_token) {
    // 本来はDBに保存
    console.warn('New refresh_token issued');
  }

  return res.status(200).json({
    access_token: json.access_token,
    expires_in: json.expires_in,
  });
}
