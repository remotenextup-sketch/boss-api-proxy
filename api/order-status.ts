import { kv } from "@vercel/kv";

export const config = { runtime: "edge" };

// ===== ステータスマッピング =====
const ORDER_STATUS_MAP: Record<number, string> = {
  100: "新規",
  200: "承認待ち",
  300: "承認済み",
  400: "出荷待ち",
  500: "配送中",
  600: "発送済み",
  800: "完了",
  850: "交換中",
  900: "キャンセル",
  950: "返金済み",
};

const SHIPMENT_STATUS_MAP: Record<number, string> = {
  0: "未割当",
  1: "割当済み",
  2: "配送中",
  3: "発送済み",
  4: "配送失敗",
  5: "キャンセル",
};

// ===== 正規化 =====
function normalizeBossOrder(order: any) {
  const shipment = order.shipments?.[0];

  const shippingStatus =
    shipment?.shipmentStatus !== undefined
      ? SHIPMENT_STATUS_MAP[shipment.shipmentStatus] ?? "不明"
      : "未出荷";

  return {
    order_id: order.orderID,
    mall_order_number: order.mallOrderNumber,
    order_status: ORDER_STATUS_MAP[order.orderStatus] ?? "不明",
    shipping_status: shippingStatus,
    carrier: shipment?.resultDeliveryCompany ?? null,
    tracking_number: shipment?.resultDeliveryNumber ?? null,
    delivery_method: shipment?.resultDeliveryMethod ?? null,
    estimated_delivery_date: shipment?.resultDeliveryDate ?? null,
    last_update:
      shipment?.shippingRequestedDateTime ??
      order.orderImportDateTime ??
      null,
  };
}

// ===== メインハンドラ =====
export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const body = await req.json();
  const mallOrderNumber = body?.mallOrderNumber;

  if (!mallOrderNumber) {
    return new Response(
      JSON.stringify({ error: "mallOrderNumber required" }),
      { status: 400 }
    );
  }

  const cacheKey = `order:mall:${mallOrderNumber}`;
  const cached = await kv.get(cacheKey);
  if (cached) {
    return Response.json({ source: "cache", ...cached });
  }

  // ===== ① search =====
  const searchRes = await fetch(
    `${process.env.BOSS_API_BASE_URL}/v1/orders/search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.BOSS_API_TOKEN}`,
      },
      body: JSON.stringify({ mallOrderNumber }),
    }
  );

  if (!searchRes.ok) {
    return new Response(
      JSON.stringify({ error: "BOSS search failed" }),
      { status: 502 }
    );
  }

  const searchData = await searchRes.json();
  const orderId = searchData?.orders?.[0];

  if (!orderId) {
    return Response.json({ found: false });
  }

  // ===== ② list（get相当） =====
  const getRes = await fetch(
    `${process.env.BOSS_API_BASE_URL}/v1/orders/list`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        const accessToken = await getBossAccessToken();

headers: {
  "Content-Type": "application/json",
  Authorization: `Bearer ${accessToken}`,
},
      body: JSON.stringify({ orders: [orderId] }),
    }
  );

  if (!getRes.ok) {
    return new Response(
      JSON.stringify({ error: "BOSS get failed" }),
      { status: 502 }
    );
  }

  const orderData = await getRes.json();
  const order = Array.isArray(orderData) ? orderData[0] : orderData;

  const normalized = normalizeBossOrder(order);

  // ===== TTL 設定 =====
  const ttl =
    normalized.shipping_status === "完了"
      ? 86400
      : normalized.shipping_status === "配送中" ||
        normalized.shipping_status === "発送済み"
      ? 900
      : 300;

  await kv.set(cacheKey, normalized, { ex: ttl });

  return Response.json({ source: "live", ...normalized });
}
