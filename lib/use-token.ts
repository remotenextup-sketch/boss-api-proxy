// lib/use-token.ts
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();


export async function setTokens(tokens: { accessToken: string; refreshToken: string }) {
  await kv.set('BOSS_ACCESS_TOKEN', tokens.accessToken);
  await kv.set('BOSS_REFRESH_TOKEN', tokens.refreshToken);
}

export async function getTokensFromKV() {
  const accessToken = await kv.get('BOSS_ACCESS_TOKEN');
  const refreshToken = await kv.get('BOSS_REFRESH_TOKEN');
  if (!accessToken || !refreshToken) throw new Error('access token not found in KV');
  return { accessToken, refreshToken };
}


