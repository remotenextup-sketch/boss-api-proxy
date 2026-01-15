import fetch from 'node-fetch';

export async function getAccessToken() {
  try {
    console.log('🔑 getAccessToken called');

    const refreshToken = process.env.BOSS_REFRESH_TOKEN;
    const clientId = process.env.BOSS_CLIENT_ID;
    const clientSecret = process.env.BOSS_CLIENT_SECRET;

    console.log('env check', {
      hasRefresh: !!refreshToken,
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      refreshHead: refreshToken?.slice(0, 10),
    });

    if (!refreshToken || !clientId || !clientSecret) {
      return null;
    }

    const res = await fetch(
      'https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }),
      }
    );

    const text = await res.text();
    console.log('token raw response', text);

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      console.error('❌ token response not json');
      return null;
    }

    if (!json.access_token) {
      console.error('❌ no access_token', json);
      return null;
    }

    console.log('✅ access token issued');
    return json.access_token;
  } catch (e) {
    console.error('❌ getAccessToken error', e);
    return null;
  }
}
