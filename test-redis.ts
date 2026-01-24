import type { NextApiRequest, NextApiResponse } from 'next';
import { redisClient } from '@/lib/redis';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const token = await redisClient.get('refresh_token');
  res.status(200).json({ token });
}

