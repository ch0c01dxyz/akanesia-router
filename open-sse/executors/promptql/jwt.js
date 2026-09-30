// PromptQL (prompt.ql.app) JWT / credential helpers (ported from OmniRoute services/promptql/jwt.ts).
//
// Two live token shapes exist:
//  1. **Playground enrich-token** (`iss: enrich-token`, `aud: promptql.hasura.io`)
//     → project id in `https://promptql.hasura.io`.`x-hasura-project-id`
//     → required for start_thread / send_thread_message / thread_events
//  2. **DDN / lux project token** (`iss: https://auth.pro.hasura.io/ddn/token`)
//     → project id is the JWT **`aud`** (UUID); no hasura namespace claims
//     → works for getCreditSummary (Limits), NOT for playground chat

function readStr(v) {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return t.length ? t : "";
}

function readPs(data, keys) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const rec = data;
  for (const k of keys) {
    const v = readStr(rec[k]);
    if (v) return v;
  }
  return "";
}

/** Accept bare JWT or `Bearer …`. */
export function normalizePromptQlToken(raw) {
  const t = raw.trim().replace(/^Bearer\s+/i, "").trim();
  return t;
}

export function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** UUID v1–v5 (case-insensitive) — used by PromptQL project ids. */
export function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (value || "").trim()
  );
}

/** Extract PromptQL project id from a JWT (playground enrich-token or DDN/lux token). */
export function extractProjectIdFromToken(token) {
  const payload = decodeJwtPayload(token);
  if (!payload) return "";

  const hasura = payload["https://promptql.hasura.io"];
  if (hasura && typeof hasura === "object" && !Array.isArray(hasura)) {
    const id = readStr(hasura["x-hasura-project-id"]);
    if (id && looksLikeUuid(id)) return id;
    if (id) return id;
  }

  const direct = readStr(payload.project_id) || readStr(payload.projectId);
  if (direct) return direct;

  // DDN lux JWT: aud is the project UUID (not "promptql.hasura.io")
  const aud = payload.aud;
  if (typeof aud === "string" && looksLikeUuid(aud)) return aud.trim();
  if (Array.isArray(aud)) {
    for (const a of aud) {
      if (typeof a === "string" && looksLikeUuid(a)) return a.trim();
    }
  }
  return "";
}

/**
 * True when the JWT is a playground enrich-token (chat-capable).
 * DDN lux tokens work for credits only and must NOT be used for playground GraphQL.
 */
export function isPlaygroundPromptQlToken(token) {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const hasura = payload["https://promptql.hasura.io"];
  if (hasura && typeof hasura === "object" && !Array.isArray(hasura)) {
    const id = hasura["x-hasura-project-id"];
    if (typeof id === "string" && id.trim()) return true;
  }
  const iss = readStr(payload.iss).toLowerCase();
  if (iss === "enrich-token" || iss.includes("enrich-token")) return true;
  const aud = payload.aud;
  if (typeof aud === "string" && aud.toLowerCase() === "promptql.hasura.io") return true;
  return false;
}

/**
 * Hosts trusted as PromptQL DDN/lux token issuers. A bare `String.includes()` against
 * `iss` is spoofable (`https://auth.pro.hasura.io.evil.com/...` also "contains" the
 * trusted substring) — always parse `iss` as a URL and compare the hostname instead.
 */
const TRUSTED_DDN_ISSUER_HOSTS = ["auth.pro.hasura.io", "auth.pro.ql.app"];

/** True when `iss` parses as a URL whose hostname is (or is a subdomain of) a trusted host. */
export function issuerHostIsTrusted(iss) {
  try {
    const host = new URL(iss).hostname.toLowerCase();
    return TRUSTED_DDN_ISSUER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** DDN/lux project JWT (iss auth.pro.hasura.io) — credits yes, playground chat no. */
export function isDdnProjectPromptQlToken(token) {
  if (!token || isPlaygroundPromptQlToken(token)) return false;
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const iss = readStr(payload.iss);
  if (issuerHostIsTrusted(iss)) return true;
  // aud is a project UUID and no hasura claims → treat as DDN
  const aud = payload.aud;
  if (typeof aud === "string" && looksLikeUuid(aud)) return true;
  return false;
}

export function isJwtExpired(token, skewSec = 30) {
  const payload = decodeJwtPayload(token);
  const exp = payload && typeof payload.exp === "number" ? payload.exp : 0;
  if (!exp) return false;
  return Math.floor(Date.now() / 1000) >= exp - skewSec;
}

const DEFAULT_TZ = "UTC";

export function resolvePromptQlCredentials(credentials) {
  const credRec = credentials;
  const direct =
    readStr(credentials?.apiKey) ||
    readStr(credRec?.accessToken) ||
    readStr(credRec?.token);
  const ps = credentials?.providerSpecificData;
  const token = normalizePromptQlToken(
    direct || readPs(ps, ["token", "jwt", "accessToken", "bearer", "apiKey"])
  );
  // Prefer explicit PSD / connection.projectId, then JWT claims (hasura or aud).
  const projectId =
    readPs(ps, ["projectId", "project_id", "x-hasura-project-id"]) ||
    readStr(credRec?.projectId) ||
    readStr(credRec?.project_id) ||
    extractProjectIdFromToken(token);
  const cookie = readPs(ps, ["cookie", "sessionCookie", "authCookie"]);
  const timezone = readPs(ps, ["timezone", "tz"]) || DEFAULT_TZ;
  return { token, projectId, cookie, timezone };
}
