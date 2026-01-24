// pages/api/boss/test-api.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getValidAccessToken } from '../../../lib/accessTokenStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const token = await getValidAccessToken();
    return res.status(200).json({ token });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

