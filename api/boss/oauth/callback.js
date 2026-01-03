export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).json({ error });
  }

  if (!code) {
    return res.status(400).json({ error: 'no code' });
  }

  const codeParam = Array.isArray(code) ? code[0] : code;

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
          code: codeParam,
        }),
      }
    );

    const text = await tokenRes.text();
    console.log('token status', tokenRes.status);
    console.log('token raw', text);

    const token = JSON.parse(text);

    if (!token.access_token) {
      return res.status(500).json(token);
    }

    console.log('BOSS token acquired');

    res.status(200).json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'token fetch failed' });
  }
}
