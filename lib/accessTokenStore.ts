import { redisClient } from './redis.ts'; // KV 操作用
import fetch from 'node-fetch';

const TOKEN_KEY = 'boss_access_token';
const TOKEN_EXPIRE = 60 * 60; // 1時間で例

export async function getValidAccessToken() {
  // KV から取得
  const cached = await redisClient.get(TOKEN_KEY);
  if (cached) return cached;

  // トークンが無ければ BOSS API にリクエスト
  const res = await fetch('https://api.boss-oms.jp/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.BOSS_CLIENT_ID,
      client_secret: process.env.BOSS_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) throw new Error(`token fetch failed: ${res.status}`);
  const data = await res.json();

  // KV に保存
  await redisClient.set(TOKEN_KEY, data.access_token, { ex: TOKEN_EXPIRE });
  return data.access_token;
}

