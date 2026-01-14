// api/boss/token.ts
import fetch from 'node-fetch';

export async function getAccessToken() {
  const res = await fetch(
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

  const json = await res.json();

  if (!json.access_token) {
    console.error(json);
    throw new Error('Failed to refresh access token');
  }

  // 🔁 refresh_token ローテーションが来た場合に備える
  if (json.refresh_token && json.refresh_token !== process.env.BOSS_REFRESH_TOKEN) {
    console.warn('refresh_token rotated. Update ENV manually.');
    // ※ 本番では KV / DB に保存
  }

  return json.access_token;
}
