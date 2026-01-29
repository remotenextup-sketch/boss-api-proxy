// api/boss/orders/debug.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAccessToken } from '../token';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const accessToken = await getAccessToken();

    const response = await fetch(
      'https://api.boss-oms.jp/BOSS-API/v1/orders/list',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ orderId }),
      }
    );

    const data = await response.json();

    // 🔍 デバッグ用：加工せずそのまま返す
    return res.status(200).json({
      debug: true,
      raw: data,
    });
  } catch (error: any) {
    console.error('orders/debug error', error);
    return res.status(500).json({
      error: 'debug fetch failed',
      message: error?.message,
    });
  }
}
