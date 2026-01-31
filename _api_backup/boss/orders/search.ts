import { getAccessToken } from '../token';

export default async function handler(req, res) {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return res.status(500).json({ error: 'access token not available' });
    }

    const { mallOrderNumber } = req.body;

    const bossRes = await fetch(
      'https://api.boss-oms.jp/BOSS-API/v1/orders/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ mallOrderNumber }),
      }
    );

    const data = await bossRes.json();
    return res.status(200).json(data);
  } catch (e) {
    console.error('search error', e);
    return res.status(500).json({ error: 'search failed', detail: String(e) });
  }
}
