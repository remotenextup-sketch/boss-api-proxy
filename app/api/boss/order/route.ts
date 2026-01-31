// pages/api/order-status.ts
import type { NextApiRequest, NextApiResponse } from "next";

// ここにBOSSから取得した固定アクセストークンを入れてください
const ACCESS_TOKEN = "ここにアクセストークン";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, message: "Method Not Allowed" });
    }

    const { mallOrderNumber } = req.body;

    if (!mallOrderNumber) {
      return res.status(400).json({ ok: false, message: "mallOrderNumber is required" });
    }

    console.log("🟢 fetch前:", mallOrderNumber);

    // 1️⃣ BOSS API 注文検索
    const searchRes = await fetch("https://api.boss-oms.jp/BOSS-API/SearchOrder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ mallOrderNumber }),
    });

    const searchData = await searchRes.json();
    console.log("🟢 searchData:", searchData);

    if (!searchData.orders?.length) {
      return res.status(404).json({ ok: false, message: "Order not found" });
    }

    const orderID = searchData.orders[0];

    // 2️⃣ BOSS API 注文詳細取得
    const detailRes = await fetch("https://api.boss-oms.jp/BOSS-API/GetOrder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ orderId: orderID }),
    });

    const detailData = await detailRes.json();
    console.log("🟢 detailData:", detailData);

    // 3️⃣ Dify用に整形
    return res.status(200).json({
      ok: true,
      order: {
        orderNumber: detailData.orderNumber,
        status: detailData.status,
        deliveryDate: detailData.deliveryDate,
        items: detailData.items || [],
        totalAmount: detailData.totalAmount,
      },
    });
  } catch (err: any) {
    console.error("❌ error:", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
}

