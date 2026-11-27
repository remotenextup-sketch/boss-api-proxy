// 管理画面に期限・時刻だけを見せるための補助。トークンの中身はほかに使わない（値は返さない）
function claims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** JWT の exp（数値）だけ。JWT でなければ null */
export function jwtExp(token: unknown): number | null {
  return num(claims(token)?.exp);
}

/** JWT の時刻だけ（iat = 発行、auth_time = 人がログイン・許可した時刻。OIDC の項目で、無ければ null） */
export function jwtTimes(token: unknown): { iat: number | null; authTime: number | null } {
  const c = claims(token);
  return { iat: num(c?.iat), authTime: num(c?.auth_time) };
}
