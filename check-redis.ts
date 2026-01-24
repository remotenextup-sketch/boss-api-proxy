// lib/check-redis.ts
import { redisClient } from './redis.ts';

(async () => {
  try {
    const token = await redisClient.get('refresh_token');
    console.log('Redis にセットされている refresh_token:', token);
  } catch (err) {
    console.error('Redis への接続か取得でエラー:', err);
  } finally {
    process.exit(0);
  }
})();

