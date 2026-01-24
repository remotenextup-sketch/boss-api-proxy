// lib/bossAuth.ts
import axios from "axios";
import { redis } from "./redis";

const TOKEN_URL = "https://auth.boss.com/oauth/token"; // 実URLに合わせて

export async function getBossAccessToken() {
  const accessToken = await redis.get<string>("boss:access_token");
  const expiresAt = await redis.get<number>("boss:access_token_expires_at");

  // まだ有効ならそのまま使う
  if (accessToken && expiresAt && Date.now() < expiresAt) {
    return accessToken;
  }

  // 期限切れ → refresh
  const refreshToken = await redis.get<string>("boss:refresh_token");
  if (!refreshToken) {
    throw new Error("refresh_token が Redis に存在しません");
  }

  const res = await axios.post(TOKEN_URL, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.BOSS_CLIENT_ID,
    client_secret: process.env.BOSS_CLIENT_SECRET,
  });

  const {
    access_token,
    refresh_token,
    expires_in,
  } = res.data;

  // Redis 更新
  await redis.set("boss:access_token", access_token);
  await redis.set("boss:refresh_token", refresh_token);
  await redis.set(
    "boss:access_token_expires_at",
    Date.now() + expires_in * 1000 - 60_000 // 1分余裕
  );

  return access_token;
}
