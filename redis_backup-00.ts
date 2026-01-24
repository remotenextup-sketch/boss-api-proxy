// lib/redis.ts
import { Redis } from '@upstash/redis';

export const redisClient = Redis.fromEnv();
