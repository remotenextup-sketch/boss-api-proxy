export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  console.log("🔥 orders/list MINIMAL OK");
  return Response.json({ ok: true });
}

