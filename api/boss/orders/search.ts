// api/boss/orders/search.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

async function getAccessToken() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL}/api/boss/token`
  );

  if (!res.ok) {
    throw new Error('token fetch failed');
  }

  const json = await res.json();
  return json.accessToken;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    const { mallOrderNumber } = req.body;

    if (!mallOrderNumber) {
      return res.status(400).json({ error: 'mallOrderNumber required' });
    }

    const accessToken = await getAccessToken();

    const response = await fetch(
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

    const json = await response.json();
    return res.status(200).json(json);
  } catch (e) {
    console.error('search error', e);
    return res.status(500).json({
      error: 'search failed',
      detail: String(e),
    });
  }
}
