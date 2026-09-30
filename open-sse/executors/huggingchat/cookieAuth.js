/**
 * Cookie-input normalization for web providers (ported from OmniRoute's
 * src/lib/providers/webCookieAuth.ts — the subset huggingchat needs).
 *
 * Accepts whatever the user pasted as the credential:
 *   - full Cookie header:  "hf-chat=abc; __Host-hf-chat=def"
 *   - JSON cookie export:  [{"name":"hf-chat","value":"abc",...}]
 *   - bare cookie value:   "abc"  (wrapped as `<defaultCookieName>=abc`)
 * Also strips a leading "Bearer " / "cookie:" prefix.
 */

export function stripCookieInputPrefix(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";

  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:/i, "").trim();
}

/**
 * Parse a JSON array of cookie objects and produce a Cookie header string.
 * Accepts the format exported by browser cookie-editor extensions / DevTools.
 * Only `name` and `value` are required; extra fields are silently ignored.
 * Returns null if the input is not JSON (pass-through).
 */
export function parseJsonCookiesToHeader(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed || !trimmed.startsWith("[")) return null;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0) return "";

  const parts = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid cookie JSON at index ${i}: expected an object`);
    }
    if (typeof entry.name !== "string" || !entry.name) {
      throw new Error(`Invalid cookie JSON at index ${i}: missing required field 'name'`);
    }
    if (typeof entry.value !== "string") {
      throw new Error(`Invalid cookie JSON at index ${i}: missing required field 'value'`);
    }
    parts.push(`${entry.name}=${entry.value}`);
  }

  return parts.join("; ");
}

export function normalizeSessionCookieHeader(rawValue, defaultCookieName) {
  const stripped = stripCookieInputPrefix(rawValue);
  if (!stripped) return "";

  const jsonResult = parseJsonCookiesToHeader(stripped);
  if (jsonResult !== null) {
    return jsonResult;
  }

  if (stripped.includes("=")) {
    return stripped;
  }

  return `${defaultCookieName}=${stripped}`;
}
