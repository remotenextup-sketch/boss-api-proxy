// api/boss/orders/get.ts
import fetch from 'node-fetch';
import { getAccessToken } from '../token';

export default async function handler(req, res) {
  const { orderId } = req.body; // ← ★ここ修正

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

  // BOSS APIは失敗時HTML返すことがあるのでガード
  try {
    const json = JSON.parse(text);
    return res.status(r.status).json(json);
  } catch {
    return res.status(r.status).json({
      error: 'Invalid JSON from BOSS',
      raw: text,
    });
  }
}
