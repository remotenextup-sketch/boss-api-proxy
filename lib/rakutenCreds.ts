// 楽天 RMS の認証情報（serviceSecret・licenseKey）の読み出しと、画面からの差し替え。
//
// 読み出し（6 本の楽天の口が使う）:
//   RAKUTEN_CREDS_ENC_KEY（32 バイトを base64）が設定され、KV に「今の設定」があれば、それを復号して使う。
//   それ以外（鍵が無い・KV に無い・KV が読めない・復号できない）は、今までどおり環境変数
//   RAKUTEN_SERVICE_SECRET / RAKUTEN_LICENSE_KEY を使う。→ この鍵を設定するまでは動きが今と全く同じ
//
// 差し替え（cs-platform の管理画面から。x-api-key は BOSS_CREDENTIALS_API_KEY）:
//   試験   … 送られた値で、ライセンスキーの期限の取得（読み取りだけ）を 1 回呼ぶ。保存しない
//   切替   … もう一度試験して通ったときだけ、今の設定を「前の設定」に残してから新しい値を「今の設定」にする
//   戻し   … 「前の設定」を試験して通ったときだけ、今の設定と入れ替える
//
// 値は KV に AES-256-GCM で暗号化して置く（KV の鍵だけでは読めない）。値・暗号文は応答にもログにも出さない。
import { kv } from "@vercel/kv";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "crypto";

export type RakutenCreds = { serviceSecret: string; licenseKey: string };
export type CredsSource = "kv" | "env";

export const RAKUTEN_CREDS_ACTIVE_KEY = "rakuten:creds:active";
export const RAKUTEN_CREDS_PREVIOUS_KEY = "rakuten:creds:previous";
export const RAKUTEN_CREDS_LOCK_KEY = "rakuten:creds:lock";
const LOCK_TTL_SEC = 30;

export const RMS_BASE = "https://api.rms.rakuten.co.jp";
export const RMS_LICENSE_EXPIRY = `${RMS_BASE}/es/1.0/license-management/license-key/expiry-date`;

type Stored = { v: 1; iv: string; tag: string; data: string; savedAt: string; origin: CredsSource };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// ---- 暗号化 ----
function encKey(): Buffer | null {
  const raw = process.env.RAKUTEN_CREDS_ENC_KEY?.trim();
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  return k.length === 32 ? k : null;
}

export function credsStoreConfigured(): boolean {
  return encKey() !== null;
}

function seal(creds: RakutenCreds, origin: CredsSource, key: Buffer): Stored {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(JSON.stringify({ s: creds.serviceSecret, l: creds.licenseKey }), "utf8"), c.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64"), savedAt: new Date().toISOString(), origin };
}

function open(stored: unknown, key: Buffer): RakutenCreds | null {
  const s = stored as Partial<Stored> | null;
  if (!s || s.v !== 1 || typeof s.iv !== "string" || typeof s.tag !== "string" || typeof s.data !== "string") return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "base64"));
    d.setAuthTag(Buffer.from(s.tag, "base64"));
    const j = JSON.parse(Buffer.concat([d.update(Buffer.from(s.data, "base64")), d.final()]).toString("utf8"));
    return typeof j?.s === "string" && typeof j?.l === "string" && j.s && j.l ? { serviceSecret: j.s, licenseKey: j.l } : null;
  } catch {
    return null;
  }
}

function envCreds(): Partial<RakutenCreds> {
  return { serviceSecret: process.env.RAKUTEN_SERVICE_SECRET?.trim() || undefined, licenseKey: process.env.RAKUTEN_LICENSE_KEY?.trim() || undefined };
}

// ---- 読み出し ----
/** 今使う認証情報と、その出どころ。値が無ければ undefined の項目を返す（呼び出し側で今までどおりのエラーにする） */
export async function getRakutenCreds(): Promise<{ creds: Partial<RakutenCreds>; source: CredsSource }> {
  const key = encKey();
  if (key) {
    try {
      const c = open(await kv.get(RAKUTEN_CREDS_ACTIVE_KEY), key);
      if (c) return { creds: c, source: "kv" };
    } catch (e) {
      // KV が読めないときは環境変数で続ける（今と同じ動き）。理由の名前だけ
      console.error("[rakutenCreds] kv read failed; using env", (e as Error)?.name ?? "Error");
    }
  }
  return { creds: envCreds(), source: "env" };
}

export function esaHeader(c: RakutenCreds): string {
  return "ESA " + Buffer.from(`${c.serviceSecret}:${c.licenseKey}`, "utf-8").toString("base64");
}

/** 6 本の楽天の口用。無ければ今までと同じ文言のエラー（名前だけで値は含まない） */
export async function rakutenEsaHeader(): Promise<string> {
  const { creds } = await getRakutenCreds();
  if (!creds.serviceSecret) throw new Error("RAKUTEN_SERVICE_SECRET is not set");
  if (!creds.licenseKey) throw new Error("RAKUTEN_LICENSE_KEY is not set");
  return esaHeader(creds as RakutenCreds);
}

/** items/prices 用（無ければ null） */
export async function rakutenEsaHeaderOrNull(): Promise<string | null> {
  const { creds } = await getRakutenCreds();
  return creds.serviceSecret && creds.licenseKey ? esaHeader(creds as RakutenCreds) : null;
}

// ---- 期限の取得（読み取りだけ） ----
/** レスポンス構造が変わっても拾えるよう、日付らしき値を再帰的に探す（license/expiry の元の処理と同じ） */
export function findExpiryDate(value: unknown): string | null {
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findExpiryDate(v);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!/expir|date/i.test(k)) continue;
      const found = findExpiryDate(v);
      if (found) return found;
    }
    for (const v of Object.values(value as Record<string, unknown>)) {
      const found = findExpiryDate(v);
      if (found) return found;
    }
  }
  return null;
}

export function daysLeftOf(expiryDate: string, nowMs = Date.now()): number {
  const expiry = new Date(`${expiryDate.slice(0, 10)}T23:59:59+09:00`);
  return Math.floor((expiry.getTime() - nowMs) / 86_400_000);
}

export type TestReason = "rms_unauthorized" | "rms_forbidden" | "rms_http_error" | "rms_unreachable" | "invalid_response" | "expiry_not_found";
export type TestResult = { ok: true; expiryDate: string; daysLeft: number } | { ok: false; reason: TestReason; status?: number };

/**
 * 渡された認証情報で、ライセンスキーの期限の取得（RMS の読み取りだけの API）を 1 回呼ぶ。
 * 結果は期限と残り日数、または決まった理由と HTTP の番号だけ（RMS の応答本文は返さない）。
 */
export async function testRakutenCreds(c: RakutenCreds, doFetch: FetchLike = fetch): Promise<TestResult> {
  let res: Response;
  try {
    res = await doFetch(`${RMS_LICENSE_EXPIRY}?licenseKey=${encodeURIComponent(c.licenseKey)}`, {
      method: "GET",
      headers: { Authorization: esaHeader(c), Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "rms_unreachable" };
  }
  if (res.status !== 200) {
    await res.text().catch(() => "");
    const reason: TestReason = res.status === 401 ? "rms_unauthorized" : res.status === 403 ? "rms_forbidden" : "rms_http_error";
    return { ok: false, reason, status: res.status };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await res.text());
  } catch {
    return { ok: false, reason: "invalid_response" };
  }
  const expiryDate = findExpiryDate(parsed);
  if (!expiryDate) return { ok: false, reason: "expiry_not_found" };
  return { ok: true, expiryDate: expiryDate.slice(0, 10), daysLeft: daysLeftOf(expiryDate) };
}

// ---- 入力の確認 ----
const VALUE_RE = /^[\x21-\x7e]{8,256}$/; // 空白・制御文字・全角を含まない 8〜256 文字

export type CredsInput = { licenseKey: string; serviceSecret?: string };
export function parseCredsInput(body: unknown): CredsInput | null {
  const b = body as { licenseKey?: unknown; serviceSecret?: unknown } | null;
  if (!b || typeof b.licenseKey !== "string") return null;
  const licenseKey = b.licenseKey.trim();
  if (!VALUE_RE.test(licenseKey)) return null;
  if (b.serviceSecret === undefined || b.serviceSecret === null || b.serviceSecret === "") return { licenseKey };
  if (typeof b.serviceSecret !== "string") return null;
  const serviceSecret = b.serviceSecret.trim();
  if (!VALUE_RE.test(serviceSecret)) return null;
  return { licenseKey, serviceSecret };
}

// ---- 状態・切替・戻し ----
export type CredsStatus = {
  ok: true;
  configured: boolean; // 画面からの差し替えが使えるか（暗号化の鍵があるか）
  source: CredsSource; // 今使っている出どころ
  activeSavedAt: string | null;
  previous: { savedAt: string | null; origin: CredsSource | null } | null;
};

function meta(stored: unknown): { savedAt: string | null; origin: CredsSource | null } | null {
  const s = stored as Partial<Stored> | null;
  if (!s || s.v !== 1) return null;
  return { savedAt: typeof s.savedAt === "string" ? s.savedAt : null, origin: s.origin === "kv" || s.origin === "env" ? s.origin : null };
}

export async function rakutenCredsStatus(): Promise<CredsStatus> {
  const key = encKey();
  if (!key) return { ok: true, configured: false, source: "env", activeSavedAt: null, previous: null };
  const [active, previous] = await Promise.all([kv.get(RAKUTEN_CREDS_ACTIVE_KEY), kv.get(RAKUTEN_CREDS_PREVIOUS_KEY)]);
  const activeOk = open(active, key) !== null;
  return {
    ok: true,
    configured: true,
    source: activeOk ? "kv" : "env",
    activeSavedAt: activeOk ? meta(active)?.savedAt ?? null : null,
    previous: open(previous, key) ? meta(previous) : null,
  };
}

export type ChangeReason = TestReason | "not_configured" | "busy" | "current_missing" | "same_as_current" | "no_previous" | "save_failed";
export type ChangeResult =
  | { ok: true; expiryDate: string; daysLeft: number; serviceSecretChanged: boolean }
  | { ok: false; reason: ChangeReason; status?: number };

const RELEASE_LOCK_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

async function withLock<T>(fn: () => Promise<T>): Promise<T | { ok: false; reason: "busy" }> {
  const id = randomUUID();
  const got = await kv.set(RAKUTEN_CREDS_LOCK_KEY, id, { nx: true, ex: LOCK_TTL_SEC });
  if (!got) return { ok: false, reason: "busy" };
  try {
    return await fn();
  } finally {
    try {
      await kv.eval(RELEASE_LOCK_SCRIPT, [RAKUTEN_CREDS_LOCK_KEY], [id]);
    } catch {
      console.warn("[rakutenCreds] lock release failed; it will expire by TTL");
    }
  }
}

const same = (a: RakutenCreds, b: RakutenCreds) => a.licenseKey === b.licenseKey && a.serviceSecret === b.serviceSecret;

/**
 * 切替。serviceSecret を送らなければ今の serviceSecret のままライセンスキーだけを替える。
 * 試験に通らなければ何も書かない。書く順は「前の設定」→「今の設定」（途中で失敗しても今の設定は壊れない）。
 */
export async function activateRakutenCreds(input: CredsInput, doFetch: FetchLike = fetch): Promise<ChangeResult> {
  const key = encKey();
  if (!key) return { ok: false, reason: "not_configured" };
  return withLock(async (): Promise<ChangeResult> => {
    const { creds: current, source } = await getRakutenCreds();
    if (!current.serviceSecret || !current.licenseKey) return { ok: false, reason: "current_missing" };
    const cur = current as RakutenCreds;
    const next: RakutenCreds = { licenseKey: input.licenseKey, serviceSecret: input.serviceSecret ?? cur.serviceSecret };
    if (same(next, cur)) return { ok: false, reason: "same_as_current" };
    const t = await testRakutenCreds(next, doFetch);
    if (!t.ok) return t;
    try {
      await kv.set(RAKUTEN_CREDS_PREVIOUS_KEY, seal(cur, source, key));
      await kv.set(RAKUTEN_CREDS_ACTIVE_KEY, seal(next, "kv", key));
    } catch (e) {
      console.error("[rakutenCreds] save failed", (e as Error)?.name ?? "Error");
      return { ok: false, reason: "save_failed" };
    }
    return { ok: true, expiryDate: t.expiryDate, daysLeft: t.daysLeft, serviceSecretChanged: next.serviceSecret !== cur.serviceSecret };
  }) as Promise<ChangeResult>;
}

/** 戻し。「前の設定」を試験して通ったときだけ、今の設定と入れ替える（もう一度戻せば元に戻る） */
export async function rollbackRakutenCreds(doFetch: FetchLike = fetch): Promise<ChangeResult> {
  const key = encKey();
  if (!key) return { ok: false, reason: "not_configured" };
  return withLock(async (): Promise<ChangeResult> => {
    const prev = open(await kv.get(RAKUTEN_CREDS_PREVIOUS_KEY), key);
    if (!prev) return { ok: false, reason: "no_previous" };
    const { creds: current, source } = await getRakutenCreds();
    const t = await testRakutenCreds(prev, doFetch);
    if (!t.ok) return t;
    try {
      if (current.serviceSecret && current.licenseKey) await kv.set(RAKUTEN_CREDS_PREVIOUS_KEY, seal(current as RakutenCreds, source, key));
      await kv.set(RAKUTEN_CREDS_ACTIVE_KEY, seal(prev, "kv", key));
    } catch (e) {
      console.error("[rakutenCreds] save failed", (e as Error)?.name ?? "Error");
      return { ok: false, reason: "save_failed" };
    }
    return { ok: true, expiryDate: t.expiryDate, daysLeft: t.daysLeft, serviceSecretChanged: !!current.serviceSecret && prev.serviceSecret !== current.serviceSecret };
  }) as Promise<ChangeResult>;
}
