const FORWARDED = new Set(["retry-after", "x-should-retry"]);
const FORWARDED_PREFIX = "anthropic-ratelimit-";

export function upstreamRetryResetMs(headers, body = null, now = Date.now()) {
  const value = headers?.get?.("retry-after")?.trim();
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return now + seconds * 1000;
    if (!Number.isFinite(seconds)) {
      const date = Date.parse(value);
      if (Number.isFinite(date) && date > now) return date;
    }
  }
  const hint = body?.retry_after ?? body?.error?.retry_after;
  const seconds = typeof hint === "number" || (typeof hint === "string" && hint.trim()) ? Number(hint) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1000 : null;
}

export function upstreamResponseHeaders(headers) {
  const out = {};
  if (typeof headers?.forEach !== "function") return out;
  headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (FORWARDED.has(key) || key.startsWith(FORWARDED_PREFIX)) out[key] = value;
  });
  return out;
}
