// api/boss/orders/get.ts
import fetch from 'node-fetch';
import { getAccessToken } from '../token';

export default async function handler(req, res) {
  const { orderId } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: 'orderId required' });
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    return res.status(401).json({ error: 'failed to get access token' });
  }

  const r = await fetch(
    `https://api.boss-oms.jp/BOSS-API/v1/orders/${orderId}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );

  const text = await r.text(); // ★ まず text で受ける
  console.log('BOSS RAW RESPONSE', {
    status: r.status,
    text,
  });

  // JSON じゃなかった場合
  if (!text) {
    return res.status(r.status).json({
      error: 'empty response from boss',
    });
  }

  try {
    const json = JSON.parse(text);
    return res.status(200).json(json);
  } catch (e) {
    return res.status(500).json({
      error: 'boss response is not json',
      raw: text,
    });
  }
}
