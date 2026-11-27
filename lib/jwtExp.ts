// 管理画面に期限だけを見せるための補助。トークンの中身はほかに使わない
/** JWT の exp（数値）だけ。JWT でなければ null。トークンの中身はほかに使わない */
export function jwtExp(token: unknown): number | null {
  if (typeof token !== "string") return null;
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof p?.exp === "number" && Number.isFinite(p.exp) ? p.exp : null;
  } catch {
    return null;
  }
}
