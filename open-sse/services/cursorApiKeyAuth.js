/**
 * Cursor user API keys (`crsr_…`, dari cursor.com/dashboard/api) tidak diterima
 * sebagai Bearer mentah oleh api2.cursor.sh (401). cursor-agent menukar key
 * tersebut via POST `/auth/exchange_user_api_key` menjadi session JWT 1 jam
 * (`type: "api_key_token"`); refreshToken membawa `exp` yang sama sehingga
 * "refresh" = tukar ulang key. Modul ini memiliki exchange + cache per-key
 * agar executor tidak menukar ulang setiap request.
 */

import crypto from "node:crypto";

export const CURSOR_API_BASE_URL = "https://api2.cursor.sh";
export const CURSOR_API_KEY_PREFIX = "crsr_";
export const CURSOR_API_KEY_EXCHANGE_PATH = "/auth/exchange_user_api_key";
export const CURSOR_API_KEY_EXCHANGE_URL = `${CURSOR_API_BASE_URL}${CURSOR_API_KEY_EXCHANGE_PATH}`;

// Tukar ulang 5 menit sebelum kedaluwarsa; bila JWT tak membawa exp,
// anggap 55 menit (di bawah umur 1 jam yang didokumentasikan).
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 55 * 60 * 1000;
const EXCHANGE_TIMEOUT_MS = 15_000;

export class CursorApiKeyExchangeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "CursorApiKeyExchangeError";
    this.status = status;
  }
}

const sessionCache = new Map(); // fingerprint key → { accessToken, refreshToken, expiresAt }
const inflightExchanges = new Map(); // fingerprint key → Promise (singleflight)

export function isCursorApiKey(value) {
  return typeof value === "string" && value.startsWith(CURSOR_API_KEY_PREFIX);
}

// Fingerprint cache-key, bukan hash kredensial — diberi label konteks tetap
// agar terbaca sebagai digest ber-domain, bukan bare password hash.
function cacheKeyFor(apiKey) {
  return crypto
    .createHmac("sha256", "akanesia-cursor-session-cache-fingerprint-v1")
    .update(apiKey)
    .digest("hex");
}

export function readJwtExpiryMs(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

function parseExchangeBody(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CursorApiKeyExchangeError("Cursor API key exchange returned a non-JSON body", 502);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new CursorApiKeyExchangeError("Cursor API key exchange returned an empty body", 502);
  }
  const { accessToken, refreshToken } = parsed;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new CursorApiKeyExchangeError("Cursor API key exchange returned no accessToken", 502);
  }
  return {
    accessToken,
    refreshToken: typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : null,
  };
}

export async function exchangeCursorApiKey(apiKey, options = {}) {
  if (!isCursorApiKey(apiKey)) {
    throw new CursorApiKeyExchangeError(
      `Cursor API keys start with "${CURSOR_API_KEY_PREFIX}"`,
      400
    );
  }
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const signal = options.signal || AbortSignal.timeout(EXCHANGE_TIMEOUT_MS);

  let response;
  try {
    response = await fetchImpl(CURSOR_API_KEY_EXCHANGE_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: "{}",
      signal,
    });
  } catch {
    throw new CursorApiKeyExchangeError("Cursor API key exchange request failed", 502);
  }

  if (response.status === 401 || response.status === 403) {
    throw new CursorApiKeyExchangeError("Cursor rejected the API key", 401);
  }
  if (!response.ok) {
    throw new CursorApiKeyExchangeError(
      `Cursor API key exchange failed with HTTP ${response.status}`,
      response.status >= 500 ? 502 : response.status
    );
  }

  const { accessToken, refreshToken } = parseExchangeBody(await response.text());
  const expiresAt = readJwtExpiryMs(accessToken) || now() + FALLBACK_TTL_MS;
  return { accessToken, refreshToken, expiresAt };
}

function isFresh(token, nowMs) {
  return token.expiresAt - REFRESH_SKEW_MS > nowMs;
}

export async function resolveCursorSessionToken(apiKey, options = {}) {
  const now = options.now || Date.now;
  const key = cacheKeyFor(apiKey);
  const cached = sessionCache.get(key);
  if (cached && isFresh(cached, now())) return cached;

  const pending = inflightExchanges.get(key);
  if (pending) return pending;

  const exchange = exchangeCursorApiKey(apiKey, options)
    .then((token) => {
      sessionCache.set(key, token);
      return token;
    })
    .finally(() => {
      inflightExchanges.delete(key);
    });
  inflightExchanges.set(key, exchange);
  return exchange;
}

export function __resetCursorApiKeyAuthForTest() {
  sessionCache.clear();
  inflightExchanges.clear();
}
