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
      `https://api.boss-oms.jp/BOSS-API/v1/orders/${orderId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    const text = await apiRes.text();

    // JSONじゃないレスポンス対策
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
