// lib/use-token.ts
import 'server-only';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
};

const KEY = 'boss:tokens';

export async function getTokensFromKV(): Promise<StoredTokens | null> {
  return await redis.get<StoredTokens>(KEY);
}

export async function setTokens(tokens: StoredTokens) {
  await redis.set(KEY, tokens);
}

