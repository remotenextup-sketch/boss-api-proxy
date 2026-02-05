// api/boss/find-order-id.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method Not Allowed");
  }

  const mallOrderNumber = req.query.mallOrderNumber;

  if (!mallOrderNumber || typeof mallOrderNumber !== "string") {
    return res.status(400).json({
      ok: false,
      reason: "mallOrderNumber_required",
    });
  }

  // 🔴 まずは生存確認だけ
  return res.status(200).json({
    ok: true,
    alive: true,
    mallOrderNumber,
  });
}

