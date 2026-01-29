import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; // ← 超重要（Edge回避）

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      message: 'boss token api is alive',
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'unknown error' },
      { status: 500 }
    );
  }
}

