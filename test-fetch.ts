// pages/api/boss/test-fetch.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fetch from 'node-fetch';
import { redisClient } from '../../../lib/redis';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const accessToken = await redisClient.get('BOSS_ACCESS_TOKEN');
    if (!accessToken) {
      return res.status(404).json({ error: 'access token not found in KV' });
    }

    const { orderId } = req.query;
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    const apiRes = await fetch(`https://api.boss-oms.jp/BOSS-API/v1/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!apiRes.ok) return res.status(apiRes.status).json({ error: `HTTP ${apiRes.status}` });

    const data = await apiRes.json();
    return res.status(200).json(data);
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

