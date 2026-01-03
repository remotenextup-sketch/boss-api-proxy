export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).json({ error });
  }

  if (!code) {
    return res.status(400).json({ error: 'no code' });
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
          client_id: process.env.BOSS_CLIENT_ID,
          client_secret: process.env.BOSS_CLIENT_SECRET,
          redirect_uri: process.env.BOSS_REDIRECT_URI,
          code,
        }),
      }
    );

    const token = await tokenRes.json();

    if (!token.access_token) {
      return res.status(500).json(token);
    }

    // ⚠️ 本番では絶対ログ出ししない
    console.log('BOSS token acquired');

    // TODO: refresh_token を安全に保存
    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'token fetch failed' });
  }
}
