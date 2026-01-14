import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * BOSS access_token を取得（refresh込み）
 * /api/boss/token は
 * {
 *   access_token: "...",
 *   expires_in: 3600
 * }
 * を返す想定
 */
async function getAccessToken(): Promise<string> {
  const res = await fetch('https://boss-api-proxy.vercel.app/api/boss/token', {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(`token fetch failed: ${res.status}`);
  }

  const json = await res.json();

  if (!json.access_token) {
    console.error('token response:', json);
    throw new Error('access_token not found');
  }

  return json.access_token;
}

export const config = {
  api: {
    bodyParser: true, // ← これ超重要
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // --- Dify から来る body を確認 ---
    // 想定: { mallOrderNumber: "372877-xxxx" }
    const body = req.body;

    if (!body || !body.mallOrderNumber) {
      return res.status(400).json({
        error: 'mallOrderNumber is required',
        received: body,
      });
    }

    // --- access_token 取得 ---
    const accessToken = await getAccessToken();

    // --- BOSS API に中継 ---
    const apiRes = await fetch(
      'https://api.boss-oms.jp/BOSS-API/v1/orders/search',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mallOrderNumber: body.mallOrderNumber,
        }),
      }
    );

    const text = await apiRes.text();

    // BOSS API がエラー返す場合も body をそのまま返す
    if (!apiRes.ok) {
      return res.status(apiRes.status).json({
        error: 'BOSS API error',
        status: apiRes.status,
        body: text,
      });
    }

    // 正常時
    const json = JSON.parse(text);
    return res.status(200).json(json);

  } catch (err: any) {
    console.error('search order error:', err);
    return res.status(500).json({
      error: 'internal error',
      message: err.message,
    });
  }
}
