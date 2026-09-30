/**
 * MaxAI web-app signing constants — extracted live from the public JS bundle
 * (ported from OmniRoute's executors/maxai/constants.ts).
 *
 * MaxAI's request signer needs a small set of CLIENT-SIDE constants that its own
 * front-end ships VERBATIM in the public `www.maxai.co` JavaScript bundle
 * (identical for every visitor, no per-user or server secret). They are extracted
 * from the live bundle, so if MaxAI ever rotates a value — or a Next.js rebuild
 * renumbers its chunks — the provider self-heals on the next refresh instead of
 * hard-failing every signed call.
 *
 * NOTHING id/key/version-shaped is hardcoded anywhere. Every such value
 * (hmacKey, aesKey, docIdKey, ctxKey, appVersion) is discovered at runtime and
 * validated; the repo carries no scannable secret and no build-specific chunk
 * number.
 *
 * WHAT is extracted, and from WHERE (all are plain, public static assets):
 *   pages/_app-*.js  — the Next.js app-entry chunk (framework-STABLE name, not a
 *   MaxAI chunk number). Webpack module 69319 inside it defines the constants as
 *   export getters we follow to their string literals:
 *     - hmacKey     export `Mn` → a hex string   (HMAC-SHA1 → SM3 keying)
 *     - aesKey      export `Rl` → a hex string    (CryptoJS AES passphrase)
 *     - docIdKey    export `U0` → a UUID          (doc-upload HMAC key)
 *     - appVersion  the sole `webpage_x.y.z` literal (folded into the sign_str)
 *   the SIGNER chunk — a NUMBERED chunk whose id changes across builds, so it is
 *   located by CONTENT FINGERPRINT (never by number): the chunk that assembles
 *   the signed payload, recognised by the ctx-slot pattern `"<40hex>":{a:…}` next
 *   to the `(0,r.nj)("<hex>")` header-name decoders. From it we read:
 *     - ctxKey      the 40-hex payload content-slot label
 *     - headerNames the `nj("<hex>")` calls = hex→ASCII header/slot names
 */
import { createHmac, createHash } from "node:crypto";

/** The public bundle base. `/app/` is the SPA entry that references the chunks. */
export const MAXAI_WEBAPP_ORIGIN = "https://www.maxai.co";
export const MAXAI_WEBAPP_APP_PATH = "/app/";

/** Settings key under which the extracted constants bundle is persisted. */
export const MAXAI_CONSTANTS_SETTINGS_KEY = "maxaiSigningConstants";

/** Firefox-150 UA used for the (unauthenticated) static-asset fetches. */
const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0";

/**
 * Default HTTP header NAMES (standard, non-secret labels). Extraction overrides
 * any the signer chunk exposes; these keep a signer with valid keys working even
 * if the signer chunk momentarily can't be located.
 */
export const MAXAI_DEFAULT_HEADER_NAMES = {
  authorization: "X-Authorization",
  clientDomain: "X-Client-Domain",
  clientPath: "X-Client-Path",
  random: "X-Random",
  browserName: "X-Browser-Name",
  browserVersion: "X-Browser-Version",
  browserMajor: "X-Browser-Major",
  appVersionHeader: "X-App-Version",
  appEnvHeader: "X-App-Env",
  appEnvValue: "MaxAI-Browser-Extension",
  tSlot: "t",
  pSlot: "p",
  dSlot: "d",
};

/** Resolve a webpack export getter `Name:function(){return VAR}` → the `VAR="…"` literal. */
export function resolveWebpackGetter(src, exportName) {
  const getter = new RegExp(
    `${exportName}\\s*:\\s*function\\s*\\(\\)\\s*\\{\\s*return\\s+([A-Za-z_$][\\w$]*)\\s*\\}`
  );
  let m = src.match(getter);
  if (!m) {
    const arrow = new RegExp(`${exportName}\\s*:\\s*\\(\\)\\s*=>\\s*([A-Za-z_$][\\w$]*)`);
    m = src.match(arrow);
  }
  if (!m) return null;
  const varName = m[1];
  const assign = new RegExp(`\\b${varName}\\s*=\\s*"([^"]+)"`);
  const am = src.match(assign);
  return am ? am[1] : null;
}

/** Decode the `(0,r.nj)("<hex>")` header-name calls (nj = hex→ASCII). */
export function decodeNjHeaderNames(signerChunk) {
  const out = new Set();
  for (const m of signerChunk.matchAll(/nj\)\("([0-9a-f]+)"\)/g)) {
    try {
      const decoded = Buffer.from(m[1], "hex").toString("utf8");
      // Keep only printable ASCII header-ish tokens (drop numeric ja3 codes etc).
      if (/^[\x20-\x7e]+$/.test(decoded)) out.add(decoded);
    } catch {
      // skip malformed hex
    }
  }
  return [...out];
}

/** Map the decoded header-name list onto the structured header-name slots. */
function mapHeaderNames(decoded) {
  const has = (v) => decoded.includes(v);
  const out = {};
  if (has("X-Authorization")) out.authorization = "X-Authorization";
  if (has("X-Client-Domain")) out.clientDomain = "X-Client-Domain";
  if (has("X-Client-Path")) out.clientPath = "X-Client-Path";
  if (has("X-Random")) out.random = "X-Random";
  if (has("X-Browser-Name")) out.browserName = "X-Browser-Name";
  if (has("X-Browser-Version")) out.browserVersion = "X-Browser-Version";
  if (has("X-Browser-Major")) out.browserMajor = "X-Browser-Major";
  if (has("X-App-Version")) out.appVersionHeader = "X-App-Version";
  if (has("X-App-Env")) out.appEnvHeader = "X-App-Env";
  if (has("MaxAI-Browser-Extension")) out.appEnvValue = "MaxAI-Browser-Extension";
  return out;
}

/** Extract the 40-hex payload content-slot label from the signer chunk. */
export function extractCtxKey(signerChunk) {
  return (signerChunk.match(/"([0-9a-f]{40})"\s*:\s*\{\s*a\s*:/) || [])[1] ?? null;
}

/**
 * Content fingerprint for the SIGNER chunk (build-independent). The signer chunk
 * is the one that both (a) carries the ctx payload slot `"<40hex>":{a:…}` and
 * (b) decodes header names via `(0,r.nj)("<hex>")`. Matching BOTH avoids a false
 * positive on any unrelated chunk that merely contains a 40-hex string.
 */
export function looksLikeSignerChunk(js) {
  return extractCtxKey(js) !== null && /nj\)\("[0-9a-f]+"\)/.test(js);
}

/**
 * Parse the two bundle chunks into raw constants. Pure (no network).
 */
export function parseMaxaiConstants(appChunk, signerChunk) {
  const decoded = decodeNjHeaderNames(signerChunk);
  return {
    hmacKey: resolveWebpackGetter(appChunk, "Mn"),
    aesKey: resolveWebpackGetter(appChunk, "Rl"),
    docIdKey: resolveWebpackGetter(appChunk, "U0"),
    appVersion: (appChunk.match(/"(webpage_\d+\.\d+\.\d+)"/) || [])[1] ?? null,
    ctxKey: extractCtxKey(signerChunk),
    headerNames: mapHeaderNames(decoded),
  };
}

/** A MaxAI signing key is a 40+ char lowercase hex string. */
function isHexKey(v) {
  return typeof v === "string" && /^[0-9a-f]{40,}$/.test(v);
}

/** A doc-id key is a UUID (v4-shaped). */
function isUuidKey(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
}

/** A MaxAI app_version tag looks like `webpage_x.y.z`. */
function isAppVersion(v) {
  return typeof v === "string" && /^webpage_\d+\.\d+\.\d+$/.test(v);
}

/**
 * Fold parsed pieces into a full constants object. The five extracted values
 * (hmacKey, aesKey, ctxKey, docIdKey, appVersion) are ALL required and must be
 * well-formed — return null otherwise, so we never persist a half-configured
 * signer. Only the plain HTTP header names fall back to the standard defaults.
 */
export function assembleMaxaiConstants(parsed) {
  if (!isHexKey(parsed.hmacKey) || !isHexKey(parsed.aesKey)) return null;
  if (!isHexKey(parsed.ctxKey)) return null;
  if (!isUuidKey(parsed.docIdKey)) return null;
  if (!isAppVersion(parsed.appVersion)) return null;
  return {
    hmacKey: parsed.hmacKey,
    aesKey: parsed.aesKey,
    appVersion: parsed.appVersion,
    ctxKey: parsed.ctxKey,
    docIdKey: parsed.docIdKey,
    headerNames: { ...MAXAI_DEFAULT_HEADER_NAMES, ...parsed.headerNames },
    source: "extracted",
    extractedAt: Date.now(),
  };
}

/** True when a constants object is structurally well-formed (all 5 values valid). */
export function isValidConstantsShape(c) {
  if (!c) return false;
  return (
    isHexKey(c.hmacKey) &&
    isHexKey(c.aesKey) &&
    isHexKey(c.ctxKey) &&
    isUuidKey(c.docIdKey) &&
    isAppVersion(c.appVersion) &&
    !!c.headerNames
  );
}

/**
 * Reproduce the SM3 proof `p` for a (path, reqTime, userId, appVersion) under a key.
 * Used to prove the signing algorithm in tests with mock keys — the runtime does
 * NOT embed any real vector (its trust anchor is the live signed probe).
 */
export function reproduceProof(hmacKey, vector) {
  const signStr = `${vector.appVersion}:${vector.reqTime}:${vector.path}:${vector.userId}`;
  const sha1 = createHmac("sha1", Buffer.from(`${vector.reqTime}:${hmacKey}`, "utf8"))
    .update(Buffer.from(signStr, "utf8"))
    .digest("hex");
  return createHash("sm3")
    .update(Buffer.from(`${vector.reqTime}:${sha1}:${hmacKey}`, "utf8"))
    .digest("hex");
}

/**
 * Runtime validation of an extracted/stored constants set. SHAPE-based on purpose:
 * no real signature vector is embedded, so the definitive check is the first live
 * signed call (a wrong value is rejected by MaxAI → re-extract). An optional
 * `vector` enables proof-based checking in tests with mock keys.
 */
export function validateMaxaiConstants(constants, vector) {
  if (!isValidConstantsShape(constants)) return false;
  if (!vector) return true;
  try {
    return reproduceProof(constants.hmacKey, vector) === vector.expectedProof;
  } catch {
    return false;
  }
}

/**
 * Fetch a text asset with the Firefox UA. Injectable for tests.
 * Returns "" on any failure (caller treats empty as miss).
 */
async function fetchText(url, fetchImpl, signal) {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": FETCH_UA, Accept: "*/*" },
      signal: signal ?? undefined,
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

/** All `/_next/static/chunks/...js` URLs referenced by the app HTML, in order. */
export function allChunkUrls(html) {
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9/_-]+\.js/g)) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      out.push(m[0]);
    }
  }
  return out;
}

/**
 * From the `/app/` HTML, resolve the app-entry chunk (by its stable Next.js
 * `pages/_app-*.js` name) and the list of candidate numbered chunks to scan for
 * the signer chunk BY CONTENT. No specific chunk number is ever assumed.
 */
export function findChunkUrls(html) {
  const urls = allChunkUrls(html);
  let appChunk = null;
  const candidateChunks = [];
  for (const p of urls) {
    if (/\/pages\/_app-[a-z0-9]+\.js$/i.test(p)) {
      appChunk = p;
    } else if (/\/chunks\/[A-Za-z0-9]+-[a-z0-9]+\.js$/i.test(p)) {
      // Any hashed vendor/number chunk is a signer-chunk candidate; we identify
      // the real one by content, not by its (build-specific) name.
      candidateChunks.push(p);
    }
  }
  return { appChunk, candidateChunks };
}

/**
 * Locate + fetch the signer chunk text by CONTENT (never by number): scan the
 * candidate chunks referenced in the app HTML and return the first whose content
 * matches the signer fingerprint (ctx slot + nj header decoders). A MaxAI-side
 * chunk renumber is therefore self-healing, not a break.
 */
async function fetchSignerChunk(origin, candidates, fetchImpl, signal, maxScan) {
  for (const c of candidates.slice(0, maxScan)) {
    const js = await fetchText(origin + c, fetchImpl, signal);
    if (js && looksLikeSignerChunk(js)) return js;
  }
  return "";
}

/**
 * Fetch + parse the live constants from MaxAI's public bundle. Returns a fully
 * assembled, SHAPE-validated constants object, or null on any failure (network,
 * missing chunk, unparseable, malformed values). Never throws. The definitive
 * key validation is the caller's first live signed call.
 *
 * opts: { fetchImpl?, signal?, origin?, maxScanChunks? }
 */
export async function fetchMaxaiConstants(opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const origin = opts.origin ?? MAXAI_WEBAPP_ORIGIN;
  const maxScan = opts.maxScanChunks ?? 80;

  const html = await fetchText(origin + MAXAI_WEBAPP_APP_PATH, fetchImpl, opts.signal);
  if (!html) return null;

  const { appChunk, candidateChunks } = findChunkUrls(html);
  if (!appChunk) return null;

  const appJs = await fetchText(origin + appChunk, fetchImpl, opts.signal);
  if (!appJs) return null;

  const signerJs = await fetchSignerChunk(
    origin,
    candidateChunks,
    fetchImpl,
    opts.signal,
    maxScan
  );

  const parsed = parseMaxaiConstants(appJs, signerJs);
  const assembled = assembleMaxaiConstants(parsed);
  if (!assembled) return null;
  if (!validateMaxaiConstants(assembled)) return null;
  return assembled;
}
