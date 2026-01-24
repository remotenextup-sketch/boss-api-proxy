const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ACCESS_KEY = 'boss:access_token';
const REFRESH_KEY = 'boss:refresh_token';

async function setTokens({ accessToken, refreshToken }) {
  await redis.set(ACCESS_KEY, accessToken);
  await redis.set(REFRESH_KEY, refreshToken);
}

async function getTokensFromKV() {
  const accessToken = await redis.get(ACCESS_KEY);
  const refreshToken = await redis.get(REFRESH_KEY);
  return { accessToken, refreshToken };
}

module.exports = {
  setTokens,
  getTokensFromKV,
};
