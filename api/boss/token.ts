import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // GET / POST どちらも許可（内部用）
    const clientId = process.env.BOSS_CLIENT_ID;
    const clientSecret = process.env.BOSS_CLIENT_SECRET;
    const refreshToken = process.env.BOSS_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(500).json({
        error: 'env missing',
        clientId: !!clientId,
        clientSecret: !!clientSecret,
        refreshToken: !!refreshToken,
      });
    }

    const tokenRes = await fetch(
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

    const text = await tokenRes.text();

    if (!tokenRes.ok) {
      return res.status(tokenRes.status).json({
        error: 'boss token error',
        body: text,
      });
    }

    const json = JSON.parse(text);

    // refresh_token が返ってきたら更新（任意）
    if (json.refresh_token) {
      // ※ 本当は DB or KV に保存するのが理想
      // 今回は環境変数固定でOK
    }

    return res.status(200).json({
      access_token: json.access_token,
      expires_in: json.expires_in,
    });
  } catch (e: any) {
    return res.status(500).json({
      error: 'token internal error',
      message: e.message,
    });
  }
}
