import type { NextApiRequest, NextApiResponse } from "next";

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
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    if (!baseUrl) {
      throw new Error("NEXT_PUBLIC_BASE_URL is not defined");
    }

    const searchRes = await fetch(`${baseUrl}/api/boss/orders/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mallOrderNumber }),
    });

    const searchData = await searchRes.json();
    console.log("searchData", JSON.stringify(searchData, null, 2));

    const orderId =
      searchData?.orders && searchData.orders.length > 0
        ? searchData.orders[0]
        : null;

    if (!orderId) {
      return res.status(404).json({ error: "Order not found" });
    }

    const detailRes = await fetch(`${baseUrl}/api/boss/orders/get`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderId }),
    });

    const detailData = await detailRes.json();
    console.log("detailData", JSON.stringify(detailData, null, 2));

    return res.status(200).json({
      orderId,
      order: detailData,
    });
  } catch (error: any) {
    console.error("order-status error", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
}

