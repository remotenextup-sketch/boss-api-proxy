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

    const accessToken = await getValidBossAccessToken();
    const base = process.env.BOSS_API_BASE_URL!;

    const searchRes = await fetch(`${base}/BOSS-API/v1/orders/search`, {
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

    const detailRes = await fetch(`${base}/BOSS-API/v1/orders/list`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ orders: [orderId] }),
    });

    if (!detailRes.ok) {
      const t = await detailRes.text();
      return NextResponse.json(
        { ok: false, reason: "detail_failed", status: detailRes.status, raw: t },
        { status: 502 }
      );
    }

    const detailData = await detailRes.json();
    const detail = Array.isArray(detailData) ? detailData[0] : detailData;

    if (!detail) {
      return NextResponse.json({ ok: false, reason: "detail_empty" });
    }

    if (email) {
      const inputEmail = email.trim().toLowerCase();
      const orderEmail = (detail.buyer?.email ?? "").trim().toLowerCase();

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

    const shipment = detail.shipments?.[0];
    const consignee = shipment?.consignee;
    const addressParts = [
      consignee?.prefecture,
      consignee?.city,
      consignee?.townAndStreet,
    ].filter(Boolean);

    // ---- ▼ 全商品リストを生成（全shipmentの全itemを収集） ----
    const allItems: Array<{
      index: number;
      itemName: string;
      skuCode: string;
      unitPrice: number | null;
      quantity: number | null;
    }> = [];

    let idx = 1;
    for (const s of detail.shipments ?? []) {
      for (const item of s.shipmentItems ?? []) {
        allItems.push({
          index: idx++,
          itemName: item.itemName ?? "",
          skuCode: item.skuCode ?? "",
          unitPrice: item.unitPrice ?? null,
          quantity: item.quantity ?? null,
        });
      }
    }
    // ---- ▲ 全商品リスト生成ここまで ▲ ----

    // 代表商品（既存互換）
    const firstItem = allItems[0] ?? null;

    return NextResponse.json({
      ok: true,
      order: {
        orderId,
        mallOrderNumber: detail.mallOrderNumber,
        orderStatus: detail.orderStatus,
        shipmentStatus: shipment?.shipmentStatus ?? null,
        carrier: shipment?.resultDeliveryCompany ?? null,
        trackingNumber: shipment?.resultDeliveryNumber ?? null,
        buyerName: detail.buyer?.name ?? null,
        buyerEmail: detail.buyer?.email ?? null,
        // 既存フィールド（互換性維持）
        itemName: firstItem?.itemName ?? null,
        skuCode: firstItem?.skuCode ?? null,
        unitPrice: firstItem?.unitPrice ?? null,
        quantity: firstItem?.quantity ?? null,
        // ▼ 新規：全商品リスト ▼
        items: allItems,
        itemCount: allItems.length,
        // ▲ 新規ここまで ▲
        resultDeliveryDate: shipment?.resultDeliveryDate ?? null,
        mallOrderDateTime: detail.mallOrderDateTime ?? null,
        totalPrice: detail.price?.totalPrice ?? null,
        address: addressParts.join(" ") || null,
        postalCode: consignee?.postalCode ?? null,
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
