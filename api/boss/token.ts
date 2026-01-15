// api/boss/token.ts

export async function getAccessToken() {
  console.log('ENV CHECK', {
    hasClientId: !!process.env.BOSS_CLIENT_ID,
    hasClientSecret: !!process.env.BOSS_CLIENT_SECRET,
    hasRefreshToken: !!process.env.BOSS_REFRESH_TOKEN,
    refreshHead: process.env.BOSS_REFRESH_TOKEN?.slice(0, 8),
  });

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

    const text = await res.text();
    console.log('TOKEN RAW RESPONSE', text);

    const json = JSON.parse(text);
    return json.access_token ?? null;
  } catch (e) {
    console.error('token error', e);
    return null;
  }
}
