import fetch from 'node-fetch';
import { getAccessToken } from '../token';

export default async function handler(req, res) {
  try {
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
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const text = await r.text();
    console.log('order raw response', text);

    try {
      return res.status(200).json(JSON.parse(text));
    } catch {
      return res.status(500).json({ error: 'invalid json', raw: text });
    }
  } catch (e) {
    console.error('❌ get order handler error', e);
    return res.status(500).json({ error: 'internal error' });
  }
}
