export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { source_channel, mall_code, order } = body;

    if (!source_channel || !mall_code || !order) {
      return NextResponse.json(
        { ok: false, reason: "missing_params: source_channel, mall_code, order required" },
        { status: 400 }
      );
    }

    const rpcRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/sync_order_from_api`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_source_channel: source_channel,
          p_mall_code: mall_code,
          p_order_data: order,
        }),
      }
    );

    const result = await rpcRes.json();

    if (!rpcRes.ok) {
      console.error("[sync-order] RPC HTTP error", rpcRes.status, result);
      return NextResponse.json(
        { ok: false, reason: "rpc_http_error", detail: result },
        { status: 502 }
      );
    }

    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[sync-order] internal error", e);
    return NextResponse.json(
      { ok: false, reason: "internal_error", message: e.message },
      { status: 500 }
    );
  }
}
