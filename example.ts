// pages/api/boss/example.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getValidAccessToken } from '../../../lib/accessTokenStore';
import { redisClient } from '../../../lib/redis';

type Data = {
  message: string;
  token?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  try {
    // アクセストークン取得
    const token = await getValidAccessToken();

    if (!token) {
      return res.status(500).json({ message: 'access_token not available' });
    }

    // ここで token を使って外部 API 呼び出し可能
    // 例: fetch('https://example.com/api', { headers: { Authorization: `Bearer ${token}` } })

    return res.status(200).json({
      message: 'example ok (auth)',
      token,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'internal error' });
  }
}

