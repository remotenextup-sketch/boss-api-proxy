// /api/boss/token.ts

export default async function handler(req, res) {
  try {
    console.log('=== BOSS TOKEN DEBUG ===');
    console.log({
      client_id: process.env.BOSS_CLIENT_ID,
      has_refresh: !!process.env.BOSS_REFRESH_TOKEN,
      refresh_head: process.env.BOSS_REFRESH_TOKEN?.slice(0, 10),
      refresh_length: process.env.BOSS_REFRESH_TOKEN?.length,
    });

    if (!process.env.BOSS_CLIENT_ID || !process.env.BOSS_CLIENT_SECRET || !process.env.BOSS_REFRESH_TOKEN) {
      return res.status(500).json({
        error: 'missing env',
        env: {
          has_client_id: !!process.env.BOSS_CLIENT_ID,
          has_client_secret: !!process.env.BOSS_CLIENT_SECRET,
          has_refresh: !!process.env.BOSS_REFRESH_TOKEN,
        },
      });
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.BOSS_CLIENT_ID,
      client_secret: process.env.BOSS_CLIENT_SECRET,
      refresh_token: process.env.BOSS_REFRESH_TOKEN,
    });

    const tokenRes = await fetch(
      'https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      }
    );

    const text = await tokenRes.text();
    console.log('=== BOSS TOKEN RESPONSE ===', text);

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(500).json({ error: 'invalid json', raw: text });
    }

    if (!tokenRes.ok) {
      return res.status(tokenRes.status).json({
        error: 'boss token error',
        body: json,
      });
    }

    return res.status(200).json({
      access_token: json.access_token,
      expires_in: json.expires_in,
      token_type: json.token_type,
    });
  } catch (e) {
    console.error('=== TOKEN FATAL ===', e);
    return res.status(500).json({
      error: 'fatal',
      message: String(e),
    });
  }
}
