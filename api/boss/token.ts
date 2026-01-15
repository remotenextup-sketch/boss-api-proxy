// api/boss/token.ts

export async function getAccessToken() {
  try {
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
    return json.access_token ?? null;
  } catch (e) {
    console.error('token error', e);
    return null;
  }
}
