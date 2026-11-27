import { NextResponse } from "next/server";

// BOSS の再認証の戻り先（/api/boss/oauth/callback）の応答。人がブラウザで見るので、成功・失敗が分かる簡単な画面にする。
// 文は決まったものだけ（例外の中身・トークン・BOSS の応答は出さない）。
// Accept が JSON だけ（text/html を含まない）の呼び出しには、今までどおりの JSON を返す（状態の番号も同じ）
export type CallbackBody = { ok: boolean; [k: string]: unknown };

const PAGES = {
  ok: { title: "BOSS の認証が完了しました", body: "この画面を閉じて、CS の画面（API 認証情報の更新 → BOSS）で「接続テスト」を押してください。" },
  retry: { title: "認証を確認できませんでした", body: "時間切れ（10 分）か、別の画面から始めた可能性があります。CS の画面の「再認証を始める」からやり直してください。" },
  failed: { title: "認証を完了できませんでした", body: "BOSS とのやり取りに失敗しました。時間をおいて、CS の画面の「再認証を始める」からやり直してください。続くときは開発者に連絡してください。" },
} as const;

export function wantsJson(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

export function callbackPage(kind: keyof typeof PAGES): string {
  const p = PAGES[kind];
  const color = kind === "ok" ? "#166534" : "#991b1b";
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
    `<title>${p.title}</title></head><body style="font-family:sans-serif;max-width:560px;margin:48px auto;padding:0 16px;line-height:1.7">` +
    `<h1 style="font-size:20px;color:${color}">${p.title}</h1><p>${p.body}</p></body></html>`;
}

/** JSON の呼び出しには今までどおりの JSON、ブラウザには画面を返す。状態の番号は同じ */
export function respond(req: Request, body: CallbackBody, init?: { status?: number }): NextResponse {
  const status = init?.status ?? 200;
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  if (wantsJson(req)) return NextResponse.json(body, { status, headers });
  const kind = body.ok ? "ok" : status === 400 ? "retry" : "failed";
  return new NextResponse(callbackPage(kind), { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
