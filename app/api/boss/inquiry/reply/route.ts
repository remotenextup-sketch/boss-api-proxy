export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

const RAKUTEN_BASE = "https://api.rms.rakuten.co.jp";
const RAKUTEN_EP_REPLY = `${RAKUTEN_BASE}/es/1.0/inquirymng-api/inquiry/reply`;
const RAKUTEN_EP_COMPLETE = `${RAKUTEN_BASE}/es/1.0/inquirymng-api/inquiries/complete`;

// 楽天ドメイン許可リスト（GAS rakutenIsAllowedUrl_ 準拠）
const ALLOWED_RAKUTEN_DOMAINS = [
  "rakuten.co.jp",
  "rakuten.ne.jp",
  "rakuten.com",
  "rakuten-bank.co.jp",
  "trafficgate.net",
  "rakuten-card.co.jp",
  "payment.sej.co.jp",
  "faq.rakuten.net",
  "support.rakuten-card.jp",
  "r10s.jp",
  "item.rakuten.co.jp",
];

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

function isAllowedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED_RAKUTEN_DOMAINS.some(
      (d) => host === d || host.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

function wrapLine(line: string, maxLen: number): string {
  const chunks: string[] = [];
  for (let i = 0; i < line.length; i += maxLen) {
    chunks.push(line.slice(i, i + maxLen));
  }
  return chunks.join("\n");
}

// GAS rakutenSanitizeMessage_ と同じルール
function sanitizeMessage(s: string): string {
  s = String(s || "").trim();

  // 1行300文字でラップ
  s = s
    .split("\n")
    .map((line) => wrapLine(line, 300))
    .join("\n");

  // 非HTTPS URL / 楽天以外のドメインを除去
  s = s.replace(/(https?:\/\/[^\s]+)/g, (url) => {
    return /^https:\/\//i.test(url) && isAllowedUrl(url) ? url : "";
  });

  // 2000文字で切り捨て
  if (s.length > 2000) s = s.slice(0, 2000);

  // 空文字フォールバック
  if (!s)
    s = "お問い合わせありがとうございます。内容を確認のうえご案内いたします。";

  return s;
}

export async function POST(req: NextRequest) {
  // プロキシAPIキー認証
  const configuredKey = process.env.BOSS_PROXY_API_KEY?.trim();
  if (configuredKey) {
    const providedKey = req.headers.get("x-api-key");
    if (providedKey !== configuredKey) {
      return NextResponse.json(
        { ok: false, reason: "unauthorized" },
        { status: 401 }
      );
    }
  }

  try {
    const body = await req.json();
    const { inquiryNumber, message, dryRun = false } = body as {
      inquiryNumber?: string;
      message?: string;
      dryRun?: boolean;
    };

    // バリデーション
    if (!inquiryNumber || !message) {
      return NextResponse.json(
        { ok: false, reason: "inquiryNumber and message are required" },
        { status: 400 }
      );
    }

    // shopId は環境変数から取得（単一店舗運用）
    const shopId = process.env.RAKUTEN_SHOP_ID?.trim();
    if (!shopId) {
      return NextResponse.json(
        { ok: false, reason: "RAKUTEN_SHOP_ID is not set" },
        { status: 500 }
      );
    }

    const sanitized = sanitizeMessage(message);

    // dryRun: 楽天APIを叩かず送信予定ペイロードを返す
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        payload: {
          replyEndpoint: RAKUTEN_EP_REPLY,
          completeEndpoint: RAKUTEN_EP_COMPLETE,
          inquiryNumber,
          shopId,
          message: sanitized,
          messageLength: sanitized.length,
        },
      });
    }

    const authHeader = buildEsaAuthHeader();

    // Step 1: 楽天へ返信
    const replyRes = await fetch(RAKUTEN_EP_REPLY, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify({
        inquiryNumber,
        shopId,
        message: sanitized,
      }),
    });

    if (replyRes.status !== 201) {
      const detail = await replyRes.text();
      return NextResponse.json(
        {
          ok: false,
          reason: "rakuten_reply_failed",
          status: replyRes.status,
          detail,
        },
        { status: 502 }
      );
    }

    // Step 2: 返信完了マーク（reply 成功後に必須）
    const completeRes = await fetch(RAKUTEN_EP_COMPLETE, {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify({ inquiryNumbers: [inquiryNumber] }),
    });

    if (completeRes.status !== 200) {
      const detail = await completeRes.text();
      // reply は成功しているので ok:true だが警告を返す
      return NextResponse.json({
        ok: true,
        replied: true,
        completed: false,
        completeWarning: `complete failed (${completeRes.status}): ${detail}`,
      });
    }

    const completeJson = (await completeRes.json()) as {
      result?: { ok?: string[]; error?: { inquiryNumber: string; errorMessage: string }[] };
    };
    const completeErrors = completeJson.result?.error ?? [];

    if (completeErrors.length > 0) {
      return NextResponse.json({
        ok: true,
        replied: true,
        completed: false,
        completeWarning: `complete errors: ${JSON.stringify(completeErrors)}`,
      });
    }

    return NextResponse.json({ ok: true, replied: true, completed: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return NextResponse.json(
      { ok: false, reason: "internal_error", message: msg },
      { status: 500 }
    );
  }
}
