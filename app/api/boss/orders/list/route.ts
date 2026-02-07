export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { kv } from "@vercel/kv";

export async function POST() {
  console.log("🔥 KV TEST START");

  let token = null;
  try {
    token = await kv.get("boss:token");
    console.log("🔥 KV VALUE", token);
  } catch (e: any) {
    console.error("🔥 KV ERROR", e);
    return Response.json(
      { ok: false, where: "kv.get", message: e.message },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    hasToken: !!token,
    tokenType: token ? typeof token : null,
  });
}

