import { kv } from "@vercel/kv";
import { randomUUID } from "node:crypto";

type BossToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
};

const TOKEN_KEY = "boss:token";
const REFRESH_LOCK_KEY = "boss:token:refreshing";
const TOKEN_ENDPOINT =
  "https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/token";

// 時間の設定（テストで縮めるために export。本番では変えない）
//   アクセストークンの有効期間は 5 分。期限の 60 秒前（短いトークンは有効期間の 1/5）までは使い回す
//   更新の制限時間 < ロックの期限 にして、更新中にロックが切れて二重に更新しないようにする
//   待つ側は、更新の制限時間より長く待つ
export const bossTokenTiming = {
  maxMarginSec: 60,
  lockTtlSec: 30,
  refreshTimeoutMs: 10_000,
  waitMs: 12_000,
  pollMs: 300,
  saveAttempts: 3,
};

export type BossTokenErrorCode =
  | "reauth_required" // 更新用トークンが無い・無効（BOSS で認証し直す）
  | "refresh_failed"
  | "refresh_timeout"
  | "refresh_wait_timeout";

// 文言は固定。トークン・BOSS の応答本文は入れない（find-order は message を応答に含めるため）
export class BossTokenError extends Error {
  constructor(public code: BossTokenErrorCode) {
    super(`BOSS token unavailable (${code})`);
    this.name = "BossTokenError";
  }
}

function jwtClaims(token: string): { exp?: number; iat?: number } {
  try {
    const p = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    );
    return {
      exp: typeof p.exp === "number" ? p.exp : undefined,
      iat: typeof p.iat === "number" ? p.iat : undefined,
    };
  } catch {
    return {};
  }
}

function marginSec(token: BossToken): number {
  const { iat } = jwtClaims(token.access_token);
  const life = typeof iat === "number" ? token.expires_at - iat : NaN;
  return life > 0
    ? Math.min(bossTokenTiming.maxMarginSec, Math.floor(life / 5))
    : bossTokenTiming.maxMarginSec;
}

function isFresh(token: BossToken | null): boolean {
  return (
    !!token?.access_token &&
    Date.now() / 1000 < token.expires_at - marginSec(token)
  );
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// 同じインスタンスの中で同時に来た更新は 1 つにまとめる（インスタンスをまたぐ分は KV のロック）
let inflight: Promise<string> | null = null;

// 更新できたのに KV へ保存できなかったトークン。BOSS 側では更新用トークンがもう入れ替わっているので、
// これが唯一の新しい更新用トークンになりうる。このインスタンスで使い続け、次の呼び出しで保存をやり直す
let unsaved: BossToken | null = null;

function newer(a: BossToken | null, b: BossToken | null): BossToken | null {
  if (!a) return b;
  if (!b) return a;
  return b.expires_at > a.expires_at ? b : a;
}

export async function getValidBossAccessToken(): Promise<string> {
  if (unsaved) {
    await retrySaveUnsaved();
  }
  const token = newer(await kv.get<BossToken>(TOKEN_KEY), unsaved);

  // ---- 有効なら即返す ----
  if (isFresh(token)) {
    return token!.access_token;
  }

  if (!inflight) {
    inflight = obtainFreshToken(token).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function obtainFreshToken(seen: BossToken | null): Promise<string> {
  // ---- ロック取得を試みる（NX = 存在しない場合のみセット。値は自分の ID） ----
  const lockId = randomUUID();
  const acquired = await kv.set(REFRESH_LOCK_KEY, lockId, {
    nx: true,
    ex: bossTokenTiming.lockTtlSec,
  });

  if (!acquired) {
    return waitForOtherRefresh(seen);
  }

  try {
    // ロック取得後に再度トークン確認（他プロセスが直前に更新した可能性）
    const token = newer(await kv.get<BossToken>(TOKEN_KEY), unsaved);
    if (isFresh(token)) {
      return token!.access_token;
    }
    if (!token?.refresh_token) {
      console.error("❌ BOSS token refresh skipped: reauth_required (no refresh token)");
      throw new BossTokenError("reauth_required");
    }
    return await refreshAndSave(token);
  } finally {
    await releaseLock(lockId);
  }
}

// 他プロセスが更新中 → 新しいトークンが保存されるまで待つ。
// 相手の更新が失敗した（ロックが外れたのに新しいトークンが無い）ときは、自分では更新しに行かずに失敗にする
//（無効な更新用トークンで BOSS へ何度も行かないため。次の呼び出しで改めて更新する）
async function waitForOtherRefresh(seen: BossToken | null): Promise<string> {
  const deadline = Date.now() + bossTokenTiming.waitMs;
  while (Date.now() < deadline) {
    await sleep(bossTokenTiming.pollMs);
    const token = await kv.get<BossToken>(TOKEN_KEY);
    if (isFresh(token)) {
      return token!.access_token;
    }
    // 余裕の秒数に入っていても、待つ前と違う（= 更新された）トークンで期限内なら使う
    if (
      token?.access_token &&
      token.access_token !== seen?.access_token &&
      Date.now() / 1000 < token.expires_at - 5
    ) {
      return token.access_token;
    }
    if (!(await kv.get(REFRESH_LOCK_KEY))) {
      // 保存 → ロックを外す、の順なので、ロックが無ければ保存は終わっている。念のため読み直す
      const again = await kv.get<BossToken>(TOKEN_KEY);
      if (isFresh(again)) {
        return again!.access_token;
      }
      console.error("❌ BOSS token refresh by another request did not produce a token");
      throw new BossTokenError("refresh_failed");
    }
  }
  console.error("❌ BOSS token refresh wait timed out");
  throw new BossTokenError("refresh_wait_timeout");
}

async function refreshAndSave(token: BossToken): Promise<string> {
  console.info("🔄 BOSS token refresh start");

  let res: Response;
  let json: any = null;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        client_id: process.env.BOSS_CLIENT_ID!,
        client_secret: process.env.BOSS_CLIENT_SECRET!,
      }),
      signal: AbortSignal.timeout(bossTokenTiming.refreshTimeoutMs),
      cache: "no-store",
    });
    json = await res.json().catch(() => null);
  } catch (e) {
    const name = (e as Error)?.name;
    const code: BossTokenErrorCode =
      name === "TimeoutError" || name === "AbortError" ? "refresh_timeout" : "refresh_failed";
    console.error(`❌ BOSS token refresh failed: ${code}`);
    throw new BossTokenError(code);
  }

  if (!res.ok || typeof json?.access_token !== "string") {
    // 本文は出さない。OAuth のエラーの種類（invalid_grant など）だけを残す
    const kind =
      typeof json?.error === "string" && /^[a-z_]{1,40}$/.test(json.error)
        ? json.error
        : "unknown";
    console.error(`❌ BOSS token refresh failed: HTTP ${res.status} ${kind}`);
    throw new BossTokenError(
      kind === "invalid_grant" ? "reauth_required" : "refresh_failed"
    );
  }

  const exp = jwtClaims(json.access_token).exp;
  const newToken: BossToken = {
    access_token: json.access_token,
    // ★返ってきたら必ず更新。返ってこなければ今のものを残す（消すと再認証が必要になる）
    refresh_token:
      typeof json.refresh_token === "string" && json.refresh_token
        ? json.refresh_token
        : token.refresh_token,
    expires_at:
      exp ?? Math.floor(Date.now() / 1000) + (Number(json.expires_in) || 300),
  };

  // BOSS 側では更新用トークンがもう入れ替わっている。保存できないと次の更新で使えないので、やり直す
  if (await saveToken(newToken)) {
    unsaved = null;
    console.info("✅ BOSS token refreshed");
  } else {
    // 失敗にしても入れ替わった更新用トークンは戻らない。この呼び出しは新しいトークンで続け、
    // このインスタンスに持っておいて次の呼び出しで保存をやり直す
    unsaved = newToken;
    console.error(
      "❌ BOSS token refreshed but token_save_failed: the new refresh token is kept in this instance only and will be saved on the next call; BOSS re-auth may be required if this instance stops first"
    );
  }
  return newToken.access_token;
}

// 保存できなかったトークンの保存をやり直す。ロックが取れたときだけ（更新中の相手がいれば次の機会に）。
// KV にもっと新しいトークンがあれば（別の更新が済んだ）、持っていたものは捨てる
async function retrySaveUnsaved() {
  const pending = unsaved;
  if (!pending) return;
  const lockId = randomUUID();
  try {
    const acquired = await kv.set(REFRESH_LOCK_KEY, lockId, {
      nx: true,
      ex: bossTokenTiming.lockTtlSec,
    });
    if (!acquired) return;
  } catch {
    return;
  }
  try {
    const current = await kv.get<BossToken>(TOKEN_KEY);
    if (current && current.expires_at >= pending.expires_at) {
      if (unsaved === pending) unsaved = null;
      return;
    }
    if (await saveToken(pending)) {
      if (unsaved === pending) unsaved = null;
      console.info("✅ BOSS token saved on retry");
    }
  } catch {
    // 次の呼び出しでまたやり直す
  } finally {
    await releaseLock(lockId);
  }
}

async function saveToken(newToken: BossToken): Promise<boolean> {
  for (let i = 1; i <= bossTokenTiming.saveAttempts; i++) {
    try {
      await kv.set(TOKEN_KEY, newToken);
      return true;
    } catch {
      if (i < bossTokenTiming.saveAttempts) await sleep(200 * i);
    }
  }
  // 失敗が返っても書けていることがある（応答だけ失われた）。読み直して確かめる
  try {
    const stored = await kv.get<BossToken>(TOKEN_KEY);
    return stored?.access_token === newToken.access_token;
  } catch {
    return false;
  }
}

// 自分のロックだけを外す（期限切れの後に別のプロセスが取ったロックは消さない）
const RELEASE_LOCK_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

// 確認と削除を 1 回で行えるスクリプトでだけ外す。失敗しても GET → DEL では外さない
//（その間に期限が切れて別のプロセスが取り直したロックを消してしまうため）。外せなければ期限（lockTtlSec）で消える。
// 外せなかったことは呼び出しの結果に影響させない（更新・保存が済んでいればそのトークンを返す）
async function releaseLock(lockId: string) {
  try {
    await kv.eval(RELEASE_LOCK_SCRIPT, [REFRESH_LOCK_KEY], [lockId]);
  } catch {
    console.warn("⚠️ BOSS token lock release failed; it will expire by TTL");
  }
}
