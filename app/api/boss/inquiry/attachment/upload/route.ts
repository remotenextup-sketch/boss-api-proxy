export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

// 問い合わせ返信に添付するファイルを楽天へ登録する。
// 楽天側の制限（inquirymngapi.attachment.post）:
//   ・1リクエストにつき1ファイル
//   ・5MB以下
//   ・ファイル名は拡張子込み100文字以内
//   ・png / jpeg / jpg / gif / pdf のみ
//   ・ファイル名に [ ] を含めると後から取得できなくなる
//   ・保存期限はアップロードから90日

const RAKUTEN_BASE = "https://api.rms.rakuten.co.jp";
const RAKUTEN_EP_ATTACHMENT = `${RAKUTEN_BASE}/es/1.0/inquirymng-api/attachment`;

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_LABEL_LENGTH = 100;
const ALLOWED_EXTENSIONS = ["png", "jpeg", "jpg", "gif", "pdf"];

function buildEsaAuthHeader(): string {
  const serviceSecret = process.env.RAKUTEN_SERVICE_SECRET?.trim();
  const licenseKey = process.env.RAKUTEN_LICENSE_KEY?.trim();
  if (!serviceSecret) throw new Error("RAKUTEN_SERVICE_SECRET is not set");
  if (!licenseKey) throw new Error("RAKUTEN_LICENSE_KEY is not set");
  return (
    "ESA " +
    Buffer.from(`${serviceSecret}:${licenseKey}`, "utf-8").toString("base64")
  );
}

function verifyApiKey(req: NextRequest): boolean {
  const proxyKey = process.env.BOSS_PROXY_API_KEY?.trim();
  if (!proxyKey) return true; // key未設定時はスキップ
  const provided = req.headers.get("x-api-key")?.trim();
  return provided === proxyKey;
}

export async function POST(req: NextRequest) {
  if (!verifyApiKey(req)) {
    return NextResponse.json({ ok: false, reason: "Unauthorized" }, { status: 401 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    return NextResponse.json(
      { ok: false, reason: "multipart/form-data で file を送ってください" },
      { status: 400 }
    );
  }

  if (!file) {
    return NextResponse.json({ ok: false, reason: "file is required" }, { status: 400 });
  }

  // 楽天へ送る前に、こちらで弾ける不備は先に返す（楽天のエラーは分かりにくいため）
  const name = file.name ?? "";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, reason: "file_too_large", detail: "添付できるのは5MBまでです" },
      { status: 413 }
    );
  }
  if (name.length > MAX_LABEL_LENGTH) {
    return NextResponse.json(
      { ok: false, reason: "filename_too_long", detail: "ファイル名は拡張子込み100文字以内にしてください" },
      { status: 400 }
    );
  }
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json(
      {
        ok: false,
        reason: "unsupported_extension",
        detail: `対応形式は ${ALLOWED_EXTENSIONS.join(" / ")} です`,
      },
      { status: 400 }
    );
  }
  if (name.includes("[") || name.includes("]")) {
    return NextResponse.json(
      { ok: false, reason: "invalid_filename", detail: "ファイル名に [ ] は使用できません" },
      { status: 400 }
    );
  }

  const upstream = new FormData();
  upstream.append("file", file, name);

  let res: Response;
  try {
    res = await fetch(RAKUTEN_EP_ATTACHMENT, {
      method: "POST",
      headers: {
        // Content-Type は FormData に任せる（boundary が必要なため指定しない）
        Authorization: buildEsaAuthHeader(),
        Accept: "application/json",
      },
      body: upstream,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: "rakuten_unreachable", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  const text = await res.text();
  console.log(`[rakuten-attachment] status=${res.status} name=${name} size=${file.size} body=${text.slice(0, 200)}`);

  if (res.status !== 201) {
    return NextResponse.json(
      { ok: false, reason: "rakuten_upload_failed", status: res.status, detail: text },
      { status: 502 }
    );
  }

  let parsed: { result?: { label?: string; path?: string; errorMessage?: string } };
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_response", detail: text.slice(0, 300) },
      { status: 502 }
    );
  }

  // 登録処理中のエラーは 201 でも errorMessage に入る
  if (parsed.result?.errorMessage) {
    return NextResponse.json(
      { ok: false, reason: "rakuten_upload_error", detail: parsed.result.errorMessage },
      { status: 502 }
    );
  }
  if (!parsed.result?.path || !parsed.result?.label) {
    return NextResponse.json(
      { ok: false, reason: "invalid_response", detail: text.slice(0, 300) },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    label: parsed.result.label,
    path: parsed.result.path,
  });
}
