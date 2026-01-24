// lib/use-token.ts
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ACCESS_KEY = 'boss:access_token';
const REFRESH_KEY = 'boss:refresh_token';

export async function getTokensFromKV() {
  const [accessToken, refreshToken] = await Promise.all([
    redis.get<string>(ACCESS_KEY),
    redis.get<string>(REFRESH_KEY),
  ]);

  return {
    accessToken,
    refreshToken,
  };
}

export async function setTokens(params: {
  accessToken: string;
  refreshToken: string;
}) {
  await redis.set(ACCESS_KEY, params.accessToken);
  await redis.set(REFRESH_KEY, params.refreshToken);
}

