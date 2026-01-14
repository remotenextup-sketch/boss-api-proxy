// /api/boss/oauth/callback.ts

export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('No code');
  }

  try {
    const tokenRes = await fetch(
      'https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: process.env.BOSS_CLIENT_ID!,
          client_secret: process.env.BOSS_CLIENT_SECRET!,
          redirect_uri:
            'https://boss-api-proxy.vercel.app/api/boss/oauth/callback',
          code: code as string,
        }).toString(),
      }
    );

    const text = await tokenRes.text();

    // ここでBOSSからの生レスポンスを確認できる
    if (!tokenRes.ok) {
      return res.status(tokenRes.status).json({
        error: 'token_exchange_failed',
        detail: text,
      });
    }

    const json = JSON.parse(text);

    return res.status(200).json(json);
  } catch (e: any) {
    return res.status(500).json({
      error: 'callback_exception',
      message: e.message,
    });
  }
}
