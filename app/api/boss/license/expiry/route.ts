export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireProxyApiKey } from "@/lib/proxyAuth";

// ライセンスキーの有効期限を取得する（LicenseManagementAPI: license.expiryDate.get）。
// 問い合わせ管理APIを使うとライセンスキーの有効期限は90日で、
// 切れると楽天の取り込みも返信も全て止まる。手入力の期限管理をやめ、
// GASの日次チェックからこのエンドポイントを叩いて残日数を監視する。

const RAKUTEN_BASE = "https://api.rms.rakuten.co.jp";

// 楽天のマニュアルに endpoint の記載が見当たらないため、候補を順に試して
// 200 が返ったものを採用する。判明後は RAKUTEN_EP_LICENSE_EXPIRY に固定する。
// 楽天のマニュアルに endpoint の記載が無いため実地で特定した。
// 他のパスは404、このパスのみ400が返り、licenseKey をクエリに付けると200になる。
const EXPIRY_PATH = `${RAKUTEN_BASE}/es/1.0/license-management/license-key/expiry-date`;

function candidateUrls(): string[] {
  // licenseKey をクエリに付ける形で 200 が返ることを確認済み
  const licenseKey = process.env.RAKUTEN_LICENSE_KEY?.trim() ?? "";
  return [`${EXPIRY_PATH}?licenseKey=${encodeURIComponent(licenseKey)}`];
}

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


/** レスポンス構造が変わっても拾えるよう、日付らしき値を再帰的に探す */
function findExpiryDate(value: unknown): string | null {
  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findExpiryDate(v);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (!/expir|date/i.test(key)) continue;
      const found = findExpiryDate(v);
      if (found) return found;
    }
    // キー名で絞れなかった場合は全体を走査する
    for (const v of Object.values(value as Record<string, unknown>)) {
      const found = findExpiryDate(v);
      if (found) return found;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = requireProxyApiKey(req);
  if (denied) return denied;

  const configured = process.env.RAKUTEN_EP_LICENSE_EXPIRY?.trim();
  const candidates = configured ? [configured] : candidateUrls();
  const tried: Array<{ url: string; status: number | string; detail?: string }> = [];

  let res: Response | null = null;
  let usedUrl = ""; void usedUrl;
  for (const url of candidates) {
    try {
      const r = await fetch(url, {
        method: "GET",
        headers: { Authorization: buildEsaAuthHeader(), Accept: "application/json" },
      });
      const bodyText = r.status === 200 ? '' : (await r.text()).slice(0, 160);
      // キーが含まれるURLはそのまま返さない
      tried.push({ url: url.split('?')[0] + (url.includes('?') ? '?' + url.split('?')[1].replace(/=[^&]*/g, '=***') : ''), status: r.status, detail: bodyText });
      if (r.status === 200) { res = r; usedUrl = url; break; }
    } catch (e) {
      tried.push({ url: url.split('?')[0], status: e instanceof Error ? e.message : "error" });
    }
  }

  if (!res) {
    return NextResponse.json(
      { ok: false, reason: "endpoint_not_found", tried },
      { status: 502 }
    );
  }

  const text = await res.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_response", detail: text.slice(0, 300) },
      { status: 502 }
    );
  }

  const expiryDate = findExpiryDate(parsed);
  if (!expiryDate) {
    return NextResponse.json(
      { ok: false, reason: "expiry_not_found", detail: text.slice(0, 300) },
      { status: 502 }
    );
  }

  // 残日数も返しておく（GAS側で計算しなくて済むように）
  const expiry = new Date(`${expiryDate.slice(0, 10)}T23:59:59+09:00`);
  const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);

  return NextResponse.json({ ok: true, expiryDate: expiryDate.slice(0, 10), daysLeft, raw: parsed });
}
