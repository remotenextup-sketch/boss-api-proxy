import { NextResponse } from 'next/server';
import Redis from 'ioredis';

// Redis接続設定（Vercelの環境変数 REDIS_URL）
const redis = new Redis(process.env.REDIS_URL);

// GET: トークン取得
export async function GET() {
  try {
    const token = await redis.get('BOSS_API_TOKEN');

    if (!token) {
      return NextResponse.json(
        { ok: false, message: 'Token not found in Redis' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      token,
      message: 'BOSS token API is alive',
    });
  } catch (error) {
    console.error('GET Error:', error);
    return NextResponse.json(
      { ok: false, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// POST: トークン更新
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token } = body;

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { ok: false, message: 'Invalid token' },
        { status: 400 }
      );
    }

    // Redis に保存（TTLが必要なら: EX 3600 など）
    await redis.set('BOSS_API_TOKEN', token);

    return NextResponse.json({
      ok: true,
      message: 'BOSS_API_TOKEN updated successfully',
    });
  } catch (error) {
    console.error('POST Error:', error);
    return NextResponse.json(
      { ok: false, message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

