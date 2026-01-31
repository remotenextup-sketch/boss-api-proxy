import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokens } from '../../../lib/token-store';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const tokens = await getTokens();

    if (!tokens?.accessToken) {
      return res.status(404).json({ error: 'access token not found' });
    }

    return res.status(200).json(tokens);
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

