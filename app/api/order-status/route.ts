import { NextResponse } from "next/server";

// POST API
export async function POST(req: Request) {
  try {
    const { mallOrderNumber } = await req.json();
    console.log("Received mallOrderNumber:", mallOrderNumber);

    // ここで実際の処理を呼び出す
    const searchData = {}; // 仮
    const detailData = {}; // 仮

    return NextResponse.json({ searchData, detailData });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
