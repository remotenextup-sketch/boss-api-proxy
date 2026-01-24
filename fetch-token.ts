// pages/api/boss/fetch-token.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fetch from 'node-fetch';
import { redisClient } from '../../../lib/redis';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // BOSS APIのトークン取得エンドポイントとクレデンシャル
    const response = await fetch('https://api.boss-oms.jp/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded', // JSONじゃない場合
      },
      body: new URLSearchParams({
        client_id: process.env.BOSS_CLIENT_ID!,
        client_secret: process.env.BOSS_CLIENT_SECRET!,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      throw new Error(`token fetch failed: ${response.status}`);
    }

    const data = await response.json();
    const { access_token, refresh_token, expires_in } = data;

    // KVに保存（例：Redis）
    await redisClient.set('BOSS_ACCESS_TOKEN', access_token, { ex: expires_in });
    if (refresh_token) {
      await redisClient.set('BOSS_REFRESH_TOKEN', refresh_token);
    }

    return res.status(200).json({ access_token, refresh_token });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

