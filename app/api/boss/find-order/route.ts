export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getValidBossAccessToken } from "@/lib/bossToken";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mallOrderNumber, email } = body;

    if (!mallOrderNumber) {
      return NextResponse.json(
        { ok: false, reason: "mallOrderNumber_required" },
        { status: 400 }
      );
    }

    // ★ 統一されたトークン取得（ロック付き）
    const accessToken = await getValidBossAccessToken();
    const base = process.env.BOSS_API_BASE_URL!;

    /* -------- SearchOrder -------- */
    const searchRes = await fetch(`${base}/v1/orders/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ mallOrderNumber }),
    });

    if (!searchRes.ok) {
      const t = await searchRes.text();
      return NextResponse.json(
        { ok: false, reason: "search_failed", raw: t },
        { status: 502 }
      );
    }

    const orderIds: number[] = await searchRes.json();

    if (!orderIds || orderIds.length === 0) {
      return NextResponse.json({ ok: false, reason: "not_found" });
    }

    if (orderIds.length > 1) {
      return NextResponse.json({
        ok: false,
        reason: "ambiguous",
        orderIds,
      });
    }

    const orderId = orderIds[0];

    /* -------- Order Detail -------- */
    const detailRes = await fetch(`${base}/v1/orders/${orderId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!detailRes.ok) {
      const t = await detailRes.text();
      return NextResponse.json(
        { ok: false, reason: "detail_failed", raw: t },
        { status: 502 }
      );
    }

    const detail = await detailRes.json();

    /* -------- ★ 本人確認：メールアドレス照合 -------- */
    if (email) {
      const inputEmail = email.trim().toLowerCase();
      const orderEmail = (
        detail.buyerEmail ?? detail.customerEmail ?? ""
      ).trim().toLowerCase();

      if (orderEmail && inputEmail !== orderEmail) {
        console.warn(
          `⚠️ Email mismatch: input=${inputEmail}, order=${orderEmail}, orderId=${orderId}`
        );
        return NextResponse.json({
          ok: false,
          reason: "email_mismatch",
          message: "注文情報とメールアドレスが一致しません",
        });
      }
    }

    /* -------- Dify向け最小レスポンス -------- */
    return NextResponse.json({
      ok: true,
      order: {
        orderId,
        mallOrderNumber: detail.mallOrderNumber,
        orderStatus: detail.orderStatus,
        shipmentStatus: detail.shipmentStatus,
        carrier: detail.shipments?.[0]?.carrierName ?? null,
        trackingNumber: detail.shipments?.[0]?.trackingNumber ?? null,
      },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, reason: "internal_error", message: e.message },
      { status: 500 }
    );
  }
}
