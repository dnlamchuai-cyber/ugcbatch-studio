/** WEB_MODE=1 (public web / VPS deploy). Dependency-free so both ssrf-guard and route helpers can share it. */
export function isWebMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.WEB_MODE === "1" || env.WEB_MODE === "true";
}
