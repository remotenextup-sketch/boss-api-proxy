// api/boss/orders/get.ts
import fetch from 'node-fetch';
import { getAccessToken } from '../token';

export default async function handler(req, res) {
  const { bossOrderId } = req.body;

  if (!bossOrderId) {
    return res.status(400).json({ error: 'bossOrderId required' });
  }

  const accessToken = await getAccessToken();

  const r = await fetch(
    `https://api.boss-oms.jp/BOSS-API/v1/orders/${bossOrderId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const json = await r.json();
  return res.status(200).json(json);
}
