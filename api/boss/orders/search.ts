// api/boss/orders/search.ts
import fetch from 'node-fetch';
import { getAccessToken } from '../token';

export default async function handler(req, res) {
  const { mallOrderNumber } = req.body;

  if (!mallOrderNumber) {
    return res.status(400).json({ error: 'mallOrderNumber required' });
  }

  const accessToken = await getAccessToken();

  const r = await fetch(
    'https://api.boss-oms.jp/BOSS-API/v1/orders/search',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ mallOrderNumber })
    }
  );

  const json = await r.json();
  return res.status(200).json(json);
}
