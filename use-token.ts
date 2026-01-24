// pages/api/boss/use-token.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { redisClient } from '../../../lib/redis';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // KV からトークン取得
    const accessToken = await redisClient.get('BOSS_ACCESS_TOKEN');
    const refreshToken = await redisClient.get('BOSS_REFRESH_TOKEN');

    if (!accessToken) {
      return res.status(404).json({ error: 'access token not found in KV' });
    }

    return res.status(200).json({
      message: 'tokens retrieved',
      accessToken,
      refreshToken: refreshToken || null,
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

