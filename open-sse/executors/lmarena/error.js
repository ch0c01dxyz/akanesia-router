/**
 * Error sanitizing for the Arena (lmarena) executor.
 * Ported from OmniRoute's executors/lmarena/error.ts (types stripped).
 *
 * 9router has no sanitizeErrorMessage equivalent, so a local fail-safe
 * sanitizer is used: coercion-safe, control-char stripped, truncated.
 */

const ERROR_NAME_ONLY_RE = /^[A-Za-z]*Error:?$/;

function sanitizeArenaText(value) {
  let candidate = value;
  try {
    if (value instanceof Error) candidate = value.message;
  } catch {
    // Hostile thrown values can expose coercing prototype/message accessors.
  }
  if (candidate == null) return "";
  let text;
  try {
    text = typeof candidate === "string" ? candidate : String(candidate);
  } catch {
    return "";
  }
  // Strip control characters (including ANSI escapes) and truncate.
  return text.replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Convert an unknown Arena failure into a stable, public-safe message. */
export function sanitizeLMArenaError(value, fallback = "Arena upstream error") {
  const sanitized = sanitizeArenaText(value);
  if (!sanitized || ERROR_NAME_ONLY_RE.test(sanitized)) return fallback;
  return sanitized;
}
