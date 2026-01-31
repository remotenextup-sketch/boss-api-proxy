// api/boss/orders/debug.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '../token';

export async function GET(_req: NextRequest) {
  try {
    const token = await getAccessToken();

    return NextResponse.json({
      ok: true,
      tokenPreview: token.slice(0, 10) + '...',
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'debug failed' },
      { status: 500 }
    );
  }
}

