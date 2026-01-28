import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { mallOrderNumber } = await req.json();
    console.log("searchData", mallOrderNumber);

    // 仮で空のレスポンス
    const searchData = {};
    const detailData = {};

    return NextResponse.json({ searchData, detailData });
  } catch (err) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
