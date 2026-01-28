import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Dify → boss-api-proxy → BOSS API
 * 注文番号から配送状況を返すエンドポイント
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { mallOrderNumber } = req.body;

  if (!mallOrderNumber) {
    return res.status(400).json({ error: "mallOrderNumber is required" });
  }

  try {
    /**
     * ① 注文検索
     */
    const searchRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL}/api/boss/orders/search`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mallOrderNumber }),
      }
    );

    const searchData = await searchRes.json();

    if (!searchRes.ok || !searchData?.data?.length) {
      return res.status(200).json({
        found: false,
        message: "注文情報が見つかりませんでした",
      });
    }

    const orderId = searchData.data[0].order_id;

    /**
     * ② 注文詳細取得
     */
    const detailRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL}/api/boss/orders/get`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      }
    );

    const detailData = await detailRes.json();

    if (!detailRes.ok || !detailData?.data) {
      throw new Error("注文詳細の取得に失敗しました");
    }

    const order = detailData.data;

    /**
     * ③ Dify向けに整形
     * ※ BOSSの項目名は環境で微妙に違うので防御的に
     */
    const shipping = order.shipping || {};
    const packages = shipping.packages?.[0] || {};

    return res.status(200).json({
      found: true,
      orderId,
      status: order.order_status_name ?? "不明",
      shippingStatus: shipping.shipping_status_name ?? "未発送",
      shippingCompany: packages.delivery_company_name ?? null,
      trackingNumber: packages.tracking_number ?? null,
      shippingDate: shipping.shipping_date ?? null,
    });
  } catch (error: any) {
    console.error("order-status error:", error);
    return res.status(500).json({
      error: "internal_server_error",
      message: error.message,
    });
  }
}
