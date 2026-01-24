import type { NextApiRequest, NextApiResponse } from 'next';
import { getValidAccessToken } from '@/lib/accessTokenStore';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const token = await getValidAccessToken();

  res.status(200).json({
    token,
    exists: !!token,
  });
}

