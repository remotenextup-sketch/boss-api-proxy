// 注文を Supabase の orders に保存する (RPC sync_order_from_api、service_role 専用)。
// 以前は公開の /api/boss/sync-order を経由していたが、鍵なしで誰でも注文を書き換えられたため、
// find-order の中から直接呼ぶ形にした。
export async function syncOrderToSupabase(params: {
  source_channel: string;
  mall_code: string;
  order: unknown;
}): Promise<unknown> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  const res = await fetch(`${url}/rest/v1/rpc/sync_order_from_api`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_source_channel: params.source_channel,
      p_mall_code: params.mall_code,
      p_order_data: params.order,
    }),
  });

  const result = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`sync_order_from_api failed: ${res.status} ${JSON.stringify(result)}`);
  }
  return result;
}
