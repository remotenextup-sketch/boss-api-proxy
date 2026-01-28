import { NextResponse } from "next/server";

// GET が必要なら残す
export async function GET(req: Request) {
  return new Response("Hello from main branch");
}

// POST で order-status API
export async function POST(req: Request) {
  try {
    const { mallOrderNumber } = await req.json();
    console.log("searchData", mallOrderNumber);

    // ここに boss-api 呼び出しや処理を書く
    const searchData = {}; // 仮で空オブジェクト
    const detailData = {}; // 仮で空オブジェクト

    console.log("searchData", JSON.stringify(searchData, null, 2));
    console.log("detailData", JSON.stringify(detailData, null, 2));

    return NextResponse.json({ searchData, detailData });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch order status" }, { status: 500 });
  }
}

