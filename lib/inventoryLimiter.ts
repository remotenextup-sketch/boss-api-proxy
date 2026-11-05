import { kv } from "@vercel/kv";
import { randomUUID } from "node:crypto";

// 在庫の口から BOSS を呼ぶ回数・間隔を抑える（KV に状態を置く。在庫の口だけが使い、注文の口は見ない）
//
// ここの数値は **こちらで決めた暫定の運用制限** で、BOSS が公式に定めた上限ではない（公式の上限は未確認）。
// BOSS の 429 を受けたら、在庫の口だけを休ませる。
//
//   キー                        中身                                  期限
//   boss:inv:cooldown           休止中の印（BOSS の 429 のあと）       休止の長さ
//   boss:inv:cooldown_level     続けて 429 を受けた回数（休止を倍に）  1 時間
//   boss:inv:lock               同時 1 つのロック（値は呼び出しの ID）  lockTtlMs
//   boss:inv:gap                呼び出しの開始の間隔                   minIntervalMs
//   boss:inv:daily:YYYYMMDD     日本時間の 1 日の呼び出し回数          2 日
//
// この口自身は待たない・再試行しない。止めたときは 429 と retryAfterSec を返し、待つか続けるかは呼ぶ側が決める。
//   cooling_down : BOSS の 429 による休止中。retryAfterSec は休止の残り
//   busy         : 別の在庫の呼び出しが BOSS を呼んでいる最中。1 秒後
//   too_soon     : 前の呼び出しの開始から minIntervalMs 未満。1 秒後
//   daily_limit  : 1 日の上限に達した。日本時間の翌 0 時まで

export const inventoryLimits = {
  minIntervalMs: 1000, // 呼び出しの開始の間隔（暫定）
  lockTtlMs: 20_000, // 同時 1 つのロック。BOSS への呼び出しの制限時間（fetchTimeoutMs）より長くする
  fetchTimeoutMs: 15_000, // BOSS への 1 回の呼び出しの制限時間
  dailyLimit: 3000, // 日本時間の 1 日の上限（暫定）
  cooldownBaseSec: 60, // 1 回目の 429 の休止
  cooldownMaxSec: 900, // 休止の上限
  cooldownLevelTtlSec: 3600, // この時間 429 が無ければ休止の長さを最初に戻す
};

const COOLDOWN = "boss:inv:cooldown";
const COOLDOWN_LEVEL = "boss:inv:cooldown_level";
const LOCK = "boss:inv:lock";
const GAP = "boss:inv:gap";
const dailyKey = (now: Date) => `boss:inv:daily:${jstDate(now)}`;

// 確認と削除を 1 回で行う（期限切れの後に別の呼び出しが取ったロックは消さない）。失敗しても GET → DEL はしない
const RELEASE_LOCK_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export type BlockReason = "cooling_down" | "busy" | "too_soon" | "daily_limit";
export type InventorySlot = { release: () => Promise<void> };

/** 休止中なら残りの秒数（BOSS を呼ぶ前、トークンを取る前に見る） */
export async function cooldownRemainingSec(): Promise<number> {
  const ms = await kv.pttl(COOLDOWN);
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/** BOSS を 1 回呼んでよいか。よければロックを持った slot を返す（終わったら必ず release） */
export async function acquireInventorySlot(
  now = new Date()
): Promise<{ ok: true; slot: InventorySlot } | { ok: false; reason: BlockReason; retryAfterSec: number }> {
  const rest = await cooldownRemainingSec();
  if (rest > 0) return { ok: false, reason: "cooling_down", retryAfterSec: rest };

  const id = randomUUID();
  const locked = await kv.set(LOCK, id, { nx: true, px: inventoryLimits.lockTtlMs });
  if (!locked) return { ok: false, reason: "busy", retryAfterSec: 1 };
  const slot: InventorySlot = { release: () => releaseLock(id) };

  try {
    const spaced = await kv.set(GAP, "1", { nx: true, px: inventoryLimits.minIntervalMs });
    if (!spaced) {
      await slot.release();
      return { ok: false, reason: "too_soon", retryAfterSec: 1 };
    }
    const key = dailyKey(now);
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, 2 * 86_400);
    if (count > inventoryLimits.dailyLimit) {
      await slot.release();
      return { ok: false, reason: "daily_limit", retryAfterSec: secondsUntilJstMidnight(now) };
    }
  } catch (e) {
    await slot.release();
    throw e;
  }
  return { ok: true, slot };
}

/** BOSS の 429 を受けたら在庫の口を休ませる。休止の秒数を返す（BOSS の Retry-After がもっと長ければそちら） */
export async function startCooldown(retryAfterSec: number | null): Promise<number> {
  const level = await kv.incr(COOLDOWN_LEVEL);
  await kv.expire(COOLDOWN_LEVEL, inventoryLimits.cooldownLevelTtlSec);
  const backoff = Math.min(inventoryLimits.cooldownBaseSec * 2 ** Math.max(0, level - 1), inventoryLimits.cooldownMaxSec);
  const sec = Math.max(backoff, Math.min(retryAfterSec ?? 0, inventoryLimits.cooldownMaxSec));
  await kv.set(COOLDOWN, "1", { px: sec * 1000 });
  return sec;
}

/** 成功したら休止の段階を最初に戻す（失敗しても期限で戻るので、結果に影響させない） */
export async function resetCooldownLevel(): Promise<void> {
  try {
    await kv.del(COOLDOWN_LEVEL);
  } catch {
    // 期限（cooldownLevelTtlSec）で消える
  }
}

async function releaseLock(id: string): Promise<void> {
  try {
    await kv.eval(RELEASE_LOCK_SCRIPT, [LOCK], [id]);
  } catch {
    // 外せなくても期限（lockTtlMs）で消える。呼び出しの結果には影響させない
    console.warn("⚠️ [inventory] lock release failed; it will expire by TTL");
  }
}

function jstDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
}

function secondsUntilJstMidnight(now: Date): number {
  const jst = now.getTime() + 9 * 3600_000;
  const next = Math.floor(jst / 86_400_000 + 1) * 86_400_000;
  return Math.max(1, Math.ceil((next - jst) / 1000));
}
