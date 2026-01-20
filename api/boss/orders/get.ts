import type { NextApiRequest, NextApiResponse } from 'next';
import fetch from 'node-fetch';
import { getTokens } from '../../../lib/use-token';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { orderId } = req.body;
  const tokens = await getTokens();

  if (!tokens?.accessToken) {
    return res.status(401).json({ error: 'access token not found in KV' });
  }

  try {
    const response = await fetch(`https://api.boss-oms.jp/BOSS-API/v1/orders/list`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ orderId })
    });

    const data = await response.json();
    res.status(200).json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
