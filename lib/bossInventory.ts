// BOSS の在庫一覧（GetInventory: GET /BOSS-API/v1/inventory/list）を 1 ページだけ読む（読み取り専用）
//
// - 呼び先はこの 1 本に固定する。入力から URL・メソッドを作らない。BOSS が返す nextPageUrl はたどらない
// - 在庫を変える API（InventoryReflection など）はここでもどこでも呼ばない
// - 条件の意味（zeroInventory・isInactive・restockThreshold・日時の書式と基準）は BOSS の仕様で未確認のため、
//   名前と値をそのまま BOSS へ渡す（こちらで「含める／除く」に読み替えない）
// - BOSS の応答本文は返さない。整えた項目だけを返す

export const INVENTORY_PATH = "/BOSS-API/v1/inventory/list";

export type InventoryQuery = {
  page: number;
  pageSize: number;
  fromDateTime?: string;
  toDateTime?: string;
  zeroInventory?: boolean;
  isInactive?: boolean;
  restockThreshold?: boolean;
  warehouseIds?: number[];
};

export type InventoryWarehouse = {
  warehouseId: number | null;
  warehouseName: string | null;
  warehouseStatus: number | null;
  allocated: number | null;
  unallocated: number | null;
  actual: number | null;
};

export type InventoryItem = {
  bossId: string | null;
  skuCode: string | null;
  janCode: string | null;
  itemName: string | null;
  saleable: number | null;
  allocated: number | null;
  actual: number | null;
  backOrder: number | null;
  safetyStock: number | null;
  restockThreshold: number | null;
  isInactive: boolean | null;
  warehouses: InventoryWarehouse[];
};

export type InventoryPage = {
  ok: true;
  page: number;
  pageSize: number;
  totalPages: number | null;
  totalRecords: number | null;
  hasNext: boolean;
  fetchedAt: string;
  items: InventoryItem[];
};

export const MAX_PAGE = 10_000;
export const MAX_PAGE_SIZE = 500;
export const MAX_WINDOW_DAYS = 31;
const MAX_WAREHOUSES = 20;
const ALLOWED = new Set(["page", "pageSize", "from", "to", "zeroInventory", "isInactive", "restockThreshold", "warehouseIds"]);
// タイムゾーン付きの ISO 8601（例 2026-11-05T09:00:00+09:00 / 2026-11-05T00:00:00Z）
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type ParseResult = { ok: true; query: InventoryQuery } | { ok: false; field: string };

export function parseInventoryQuery(sp: URLSearchParams): ParseResult {
  const seen = new Set<string>();
  for (const key of sp.keys()) {
    if (!ALLOWED.has(key)) return { ok: false, field: "unknown_param" };
    if (seen.has(key)) return { ok: false, field: key };
    seen.add(key);
  }

  const int = (key: string, def: number, max: number): number | null => {
    const v = sp.get(key);
    if (v === null) return def;
    if (!/^\d{1,6}$/.test(v)) return null;
    const n = Number(v);
    return n >= 1 && n <= max ? n : null;
  };
  const bool = (key: string): boolean | undefined | null => {
    const v = sp.get(key);
    if (v === null) return undefined;
    return v === "true" ? true : v === "false" ? false : null;
  };

  const page = int("page", 1, MAX_PAGE);
  if (page === null) return { ok: false, field: "page" };
  const pageSize = int("pageSize", MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  if (pageSize === null) return { ok: false, field: "pageSize" };

  const query: InventoryQuery = { page, pageSize };

  const from = sp.get("from");
  const to = sp.get("to");
  if ((from === null) !== (to === null)) return { ok: false, field: "from_to" };
  if (from !== null && to !== null) {
    if (!ISO.test(from) || Number.isNaN(Date.parse(from))) return { ok: false, field: "from" };
    if (!ISO.test(to) || Number.isNaN(Date.parse(to))) return { ok: false, field: "to" };
    const span = Date.parse(to) - Date.parse(from);
    if (span <= 0) return { ok: false, field: "from_to" };
    if (span > MAX_WINDOW_DAYS * 86_400_000) return { ok: false, field: "from_to" };
    query.fromDateTime = from;
    query.toDateTime = to;
  }

  for (const key of ["zeroInventory", "isInactive", "restockThreshold"] as const) {
    const b = bool(key);
    if (b === null) return { ok: false, field: key };
    if (b !== undefined) query[key] = b;
  }

  const wh = sp.get("warehouseIds");
  if (wh !== null) {
    if (!new RegExp(`^\\d{1,9}(,\\d{1,9}){0,${MAX_WAREHOUSES - 1}}$`).test(wh)) return { ok: false, field: "warehouseIds" };
    query.warehouseIds = wh.split(",").map(Number);
  }

  return { ok: true, query };
}

export function buildInventoryUrl(base: string, q: InventoryQuery): string {
  // find-order と同じく BOSS_API_BASE_URL に固定の道筋をつなぐ
  const u = new URL(base.replace(/\/+$/, "") + INVENTORY_PATH);
  u.searchParams.set("page", String(q.page));
  u.searchParams.set("PageSize", String(q.pageSize)); // 仕様書の表記（11-05 の読み取りで PageSize=1 が効いた）
  if (q.fromDateTime) u.searchParams.set("fromDateTime", q.fromDateTime);
  if (q.toDateTime) u.searchParams.set("toDateTime", q.toDateTime);
  if (q.zeroInventory !== undefined) u.searchParams.set("zeroInventory", String(q.zeroInventory));
  if (q.isInactive !== undefined) u.searchParams.set("isInactive", String(q.isInactive));
  if (q.restockThreshold !== undefined) u.searchParams.set("restockThreshold", String(q.restockThreshold));
  // 複数の倉庫の渡し方（繰り返し・カンマ区切り）は仕様で未確認。繰り返しで渡す
  for (const id of q.warehouseIds ?? []) u.searchParams.append("warehouseIds", String(id));
  return u.toString();
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export function normalizeInventoryPage(body: unknown, q: InventoryQuery, now = new Date()): InventoryPage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.results)) return null;

  const items: InventoryItem[] = b.results.map((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const whs = Array.isArray(x.warehouseInventories) ? x.warehouseInventories : [];
    return {
      bossId: str(x.id),
      skuCode: str(x.skuCode),
      janCode: str(x.janCode),
      itemName: str(x.itemName),
      saleable: num(x.saleableCount),
      allocated: num(x.allocatedInventory),
      actual: num(x.actualWarehouseInventory),
      backOrder: num(x.backOrderQuantity),
      safetyStock: num(x.safeInventoryLevel),
      restockThreshold: num(x.restockThreshold),
      isInactive: boolOrNull(x.isInactive),
      warehouses: whs.map((w) => {
        const y = (w ?? {}) as Record<string, unknown>;
        return {
          warehouseId: num(y.warehouseId),
          warehouseName: str(y.warehouseName),
          warehouseStatus: num(y.warehouseStatus),
          allocated: num(y.allocatedInventory),
          unallocated: num(y.unallocatedInventory),
          actual: num(y.actualWarehouseInventory),
        };
      }),
    };
  });

  const page = num(b.pageNumber) ?? q.page;
  const totalPages = num(b.totalNumberOfPages);
  const hasNext =
    totalPages !== null ? page < totalPages : typeof b.nextPageUrl === "string" && b.nextPageUrl.length > 0;

  return {
    ok: true,
    page,
    pageSize: num(b.pageSize) ?? q.pageSize,
    totalPages,
    totalRecords: num(b.totalNumberOfRecords),
    hasNext,
    fetchedAt: now.toISOString(),
    items,
  };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type InventoryFetchResult =
  | InventoryPage
  | { ok: false; kind: "http"; status: number; retryAfterSec: number | null }
  | { ok: false; kind: "timeout" }
  | { ok: false; kind: "network" }
  | { ok: false; kind: "invalid_response" };

export async function fetchInventoryPage(
  deps: { fetch: FetchLike; base: string; accessToken: string; timeoutMs: number },
  q: InventoryQuery
): Promise<InventoryFetchResult> {
  let res: Response;
  let body: unknown = null;
  try {
    res = await deps.fetch(buildInventoryUrl(deps.base, q), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${deps.accessToken}`,
        Accept: "application/json,application/problem+json",
      },
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, kind: "http", status: res.status, retryAfterSec: parseRetryAfter(res.headers.get("retry-after")) };
    }
    body = await res.json();
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, kind: "timeout" };
    if (name === "SyntaxError") return { ok: false, kind: "invalid_response" };
    return { ok: false, kind: "network" };
  }
  return normalizeInventoryPage(body, q) ?? { ok: false, kind: "invalid_response" };
}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  if (/^\d{1,6}$/.test(v.trim())) return Number(v.trim());
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - Date.now()) / 1000));
}
