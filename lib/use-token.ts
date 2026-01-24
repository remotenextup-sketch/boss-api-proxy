// lib/use-token.ts
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function setTokens(params: {
  accessToken: string;
  refreshToken: string;
}) {
  await redis.set(ACCESS_KEY, params.accessToken);
  await redis.set(REFRESH_KEY, params.refreshToken);
}

export async function getTokensFromKV() {
  const accessToken = await redis.get<string>(ACCESS_KEY);
  const refreshToken = await redis.get<string>(REFRESH_KEY);

  return {
    accessToken,
    refreshToken,
  };
}
