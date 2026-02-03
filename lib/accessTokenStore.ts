import { redisClient } from './redis';
import fetch from 'node-fetch';

const TOKEN_KEY = 'boss_access_token';
// BOSSの expires_in はだいたい3600秒想定 → 少し余裕を持たせる
const TOKEN_EXPIRE = 55 * 60; // 55分

type BossTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
};

export async function getValidAccessToken(): Promise<string> {
  // 1️⃣ Redis(KV) から取得
  const cached = await redisClient.get<string>(TOKEN_KEY);
  if (cached) {
    return cached;
  }

  // 2️⃣ 無ければ BOSS API で新規取得
  const res = await fetch('https://api.boss-oms.jp/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.BOSS_CLIENT_ID,
      client_secret: process.env.BOSS_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BOSS token fetch failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as BossTokenResponse;

  if (!data.access_token) {
    throw new Error('BOSS token response has no access_token');
  }

  // 3️⃣ Redis に保存（期限管理は Redis に丸投げ）
  await redisClient.set(TOKEN_KEY, data.access_token, {
    ex: TOKEN_EXPIRE,
  });

  return data.access_token;
}

