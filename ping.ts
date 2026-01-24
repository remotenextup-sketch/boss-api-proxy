import type { NextApiRequest, NextApiResponse } from 'next';
import { getValidAccessToken } from '../../lib/accessTokenStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getValidAccessToken();

  // Authorization チェック（ダミー or 実際のアクセストークン）
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer')) {
    return res.status(401).json({ error: 'access_token missing' });
  }

  res.status(200).json({
    message: 'ping ok (auth)',
    refreshToken: token,
  });
}

