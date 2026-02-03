// app/api/boss/oauth/auto/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

/**
 * 使い方
 * 1) /api/boss/oauth/auto を開く
 * 2) 返ってきた sample_url をブラウザで開く
 * 3) BOSSログイン → 同意 → redirect_uri に ?code=... が付いて戻る
 * 4) /api/boss/oauth/callback が code を受け取り、token交換してKVに保存
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  const CLIENT_ID = process.env.BOSS_CLIENT_ID;
  const REDIRECT_URI = process.env.BOSS_REDIRECT_URI;

  if (!CLIENT_ID || !REDIRECT_URI) {
    return NextResponse.json(
      { ok: false, message: "env variables missing: BOSS_CLIENT_ID / BOSS_REDIRECT_URI" },
      { status: 500 }
    );
  }

  // ✅ refresh_token を確実に返してもらうために
  // - openid（OIDC）
  // - offline_access（refresh_token発行条件）
  // を含める
  const scope = "openid offline_access order inventory mow-shipment";

  const sampleUrl =
    "https://auth.boss-oms.jp/realms/boss/protocol/openid-connect/auth" +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=xyz123`;

  // code が無い場合は「認可URL」を返すだけ（このルートの役割）
  if (!code) {
    return NextResponse.json({
      ok: false,
      message:
        "認可コードがありません。sample_url をブラウザで開いてBOSS認可を行い、redirect_uri に付与される code を取得してください。",
      sample_url: sampleUrl,
      note:
        "※この /auto は認可URLの提示用です。code→token交換は /api/boss/oauth/callback で実施します。",
    });
  }

  // もし誤って /auto?code=... を叩いた場合も、次に何をすべきか分かるように案内だけ返す
  return NextResponse.json({
    ok: true,
    message:
      "code を受け取りました。この code を使った token 交換は /api/boss/oauth/callback が担当です。redirect_uri は callback を指す設定にしてください。",
    code,
    next: "/api/boss/oauth/callback?code=xxxx",
    sample_url: sampleUrl,
  });
}

