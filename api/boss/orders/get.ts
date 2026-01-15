import fetch from 'node-fetch';
import { getAccessToken } from '../token';

export default async function handler(req, res) {
  try {
    // 🔴 ここ修正
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId required' });
    }

    const accessToken = await getAccessToken();

    const r = await fetch(
      `https://api.boss-oms.jp/BOSS-API/v1/orders/${orderId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const text = await r.text();

    // BOSSはたまにJSON以外返すので保険
    try {
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch {
      return res.status(500).json({
        error: 'Invalid JSON from BOSS',
        raw: text,
      });
    }
  } catch (e) {
    console.error('get order error', e);
    return res.status(500).json({ error: 'internal error' });
  }
}
