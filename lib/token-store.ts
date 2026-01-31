import { redisClient } from './redis.ts';

export async function setTokens(tokens: {
  accessToken: string;
  refreshToken: string;
}) {
  await redisClient.set('BOSS_ACCESS_TOKEN', tokens.accessToken);
  await redisClient.set('BOSS_REFRESH_TOKEN', tokens.refreshToken);
}

export async function getTokens() {
  const accessToken = await redisClient.get('BOSS_ACCESS_TOKEN');
  const refreshToken = await redisClient.get('BOSS_REFRESH_TOKEN');

  return { accessToken, refreshToken };
}

