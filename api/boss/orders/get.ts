// api/boss/orders/get.ts
import { getAccessToken } from '../token';

export default async function handler(req, res) {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId required' });
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return res.status(500).json({ error: 'failed to get access token' });
    }

    const apiRes = await fetch(
      'https://api.boss-oms.jp/BOSS-API/v1/orders/get',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          orderId: Number(orderId), // ★重要：数値で渡す
        }),
      }
    );

    const text = await apiRes.text();

    try {
      const json = JSON.parse(text);
      return res.status(apiRes.status).json(json);
    } catch {
      return res.status(apiRes.status).json({
        error: 'non-json response from BOSS',
        raw: text,
      });
    }
  } catch (e) {
    console.error('orders/get error', e);
    return res.status(500).json({
      error: 'internal error',
      message: e?.message,
    });
  }
}
