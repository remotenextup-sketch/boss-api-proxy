// api/boss/orders/get.ts
import fetch from 'node-fetch';
import { getAccessToken } from '../token';

export default async function handler(req, res) {
  try {
    console.log('GET ORDER START');
    console.log('REQ BODY', req.body);

    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'orderId required' });
    }

    const accessToken = await getAccessToken();
    console.log('ACCESS TOKEN HEAD', accessToken?.slice(0, 10));

    if (!accessToken) {
      return res.status(401).json({ error: 'failed to get access token' });
    }

    const url = `https://api.boss-oms.jp/BOSS-API/v1/orders/${orderId}`;
    console.log('FETCH URL', url);

    const r = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    const text = await r.text();
    console.log('BOSS STATUS', r.status);
    console.log('BOSS RAW TEXT', text);

    if (!text) {
      return res.status(r.status).json({ error: 'empty response from boss' });
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        error: 'boss response is not json',
        raw: text,
      });
    }

    return res.status(200).json(json);

  } catch (e: any) {
    console.error('HANDLER ERROR', e);
    return res.status(500).json({
      error: 'handler exception',
      message: e?.message,
    });
  }
}
