import type { NextApiRequest, NextApiResponse } from 'next';
import { redisClient } from '@/lib/redis';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const dummyToken = 'dummy-access-token-' + Date.now();

  // Redis に保存
  await redisClient.set('access_token', dummyToken);

  res.status(200).json({
    saved: true,
    token: dummyToken,
  });
}

