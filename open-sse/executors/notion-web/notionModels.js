// notionModels — Notion AI Web model discovery helpers (ported from OmniRoute).
//
// Notion has no public model catalog API. The browser AI surface loads models via
// cookie-auth `POST /api/v3/getAvailableModels` with body `{ spaceId }`.
// These helpers parse that response and build the cookie/headers/body the
// models-discovery route needs.
//
// Notion's edge rejects Node/undici TLS fingerprints, so the executor uses the
// Chrome-JA3 tls-client path (./tlsClient.js) for runInferenceTranscript.

// ─── Fallback catalog (seeded from the live AI picker) ──────────────────────

/**
 * Offline fallback when getAvailableModels is unreachable.
 * Catalog ids use real web-picker labels; `notionCodename` is what the API accepts.
 */
export const NOTION_WEB_FALLBACK_MODELS = [
  { id: "notion-ai", name: "Notion AI (default)", owned_by: "notion" },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    owned_by: "openai",
    supportsReasoning: true,
    notionCodename: "orange-mousse",
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    owned_by: "openai",
    supportsReasoning: true,
    notionCodename: "orchid-muffin",
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    owned_by: "openai",
    supportsReasoning: true,
    notionCodename: "olive-jellyroll",
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    owned_by: "openai",
    supportsReasoning: true,
    notionCodename: "oregon-grape-medium",
  },
  {
    id: "gpt-5.4-nano",
    name: "GPT-5.4 Nano",
    owned_by: "openai",
    supportsReasoning: true,
    notionCodename: "otaheite-apple-medium",
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    owned_by: "gemini",
    supportsReasoning: true,
    notionCodename: "grapefruit-zeppole",
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    owned_by: "gemini",
    supportsReasoning: true,
    notionCodename: "galette-medium-thinking",
  },
  {
    id: "fable-5",
    name: "Claude Fable 5",
    owned_by: "anthropic",
    supportsReasoning: true,
    disabled: true,
    notionCodename: "acai-budino-high",
  },
  {
    id: "opus-5",
    name: "Claude Opus 5",
    owned_by: "anthropic",
    supportsReasoning: true,
    notionCodename: "agave-flan",
  },
  {
    id: "sonnet-5",
    name: "Claude Sonnet 5",
    owned_by: "anthropic",
    supportsReasoning: true,
    notionCodename: "angel-cake-high",
  },
  {
    id: "haiku-4.5",
    name: "Claude Haiku 4.5",
    owned_by: "anthropic",
    notionCodename: "anthropic-haiku-4.5",
  },
  {
    id: "grok-4.6",
    name: "Grok 4.6",
    owned_by: "xai",
    supportsReasoning: true,
    notionCodename: "soursop-shortcake",
  },
  {
    id: "kimi-k3",
    name: "Kimi K3",
    owned_by: "mystery",
    supportsReasoning: true,
    notionCodename: "fireworks-kimi-k3",
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    owned_by: "mystery",
    notionCodename: "fireworks-kimi-k2.7",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    owned_by: "mystery",
    supportsReasoning: true,
    notionCodename: "baseten-deepseek-v4-pro",
  },
  {
    id: "glm-5.2",
    name: "GLM 5.2",
    owned_by: "mystery",
    supportsReasoning: true,
    notionCodename: "baseten-glm-5.2",
  },
];

// ─── Discovery constants ────────────────────────────────────────────────────

// Browser AI surface uses app.notion.com (live capture 2026-07-19). www.notion.so
// still works for many paths but can return a different space default / cookie
// domain behavior — prefer the same host the web picker uses.
export const NOTION_APP_ORIGIN = "https://app.notion.com";
export const NOTION_LEGACY_ORIGIN = "https://www.notion.so";
export const NOTION_MODELS_URL = `${NOTION_APP_ORIGIN}/api/v3/getAvailableModels`;
export const NOTION_SPACES_URL = `${NOTION_APP_ORIGIN}/api/v3/getSpaces`;
const NOTION_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
/** Recent Notion web client version — accepted loosely but required by some paths. */
export const NOTION_CLIENT_VERSION = "23.13.20260719.1125";
/** Cap how many workspaces we probe for AI models when space_id is omitted. */
const NOTION_MAX_SPACE_PROBE = 8;
/** Cache auto-selected workspace per token so chat/inference reuses discovery. */
const NOTION_SPACE_CACHE = new Map();
const NOTION_SPACE_CACHE_TTL_MS = 30 * 60 * 1000;

// Browser fingerprint headers — make requests look like real Chromium
// to reduce Cloudflare bot-detection challenges.
export const BROWSER_HEADERS = {
  "sec-ch-ua": '"Chromium";v="149", "Not)A;Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  priority: "u=1, i",
  "cache-control": "no-cache",
  pragma: "no-cache",
};

function notionTokenCacheKey(cookie) {
  // Prefer the token_v2 value only — ignore optional space/user parts.
  return readCookieValue(cookie, "token_v2") || normalizeNotionWebCookie(cookie);
}

/** Normalize a pasted credential to a Cookie header string. */
export function normalizeNotionWebCookie(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  return trimmed.includes("=") ? trimmed : `token_v2=${trimmed}`;
}

/** Read `name=value` from a cookie header (case-insensitive name). */
export function readCookieValue(cookie, name) {
  if (!cookie || !name) return "";
  const re = new RegExp(
    `(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`,
    "i"
  );
  const m = cookie.match(re);
  if (!m) return "";
  const raw = m[1].trim();
  // Malformed % sequences in cookie values must not throw.
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function extractSpaceIdFromNotionCookie(cookie) {
  return readCookieValue(cookie, "space_id") || readCookieValue(cookie, "spaceId") || "";
}

export function extractNotionUserIdFromCookie(cookie) {
  return (
    readCookieValue(cookie, "notion_user_id") ||
    readCookieValue(cookie, "notion_user_id_v2") ||
    readCookieValue(cookie, "user_id") ||
    ""
  );
}

/** Trim to a non-empty string, or fall back to `fallback`. */
function trimmedOrFallback(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** True when the row's `modelConfiguration.supportedReasoningEfforts` is a non-empty array. */
function rowSupportsReasoning(row) {
  const efforts = row.modelConfiguration?.supportedReasoningEfforts;
  return Array.isArray(efforts) && efforts.length > 0;
}

/**
 * Slugify Notion's human picker label ("GPT-5.6 Sol" → "gpt-5.6-sol") so
 * OpenAI-compatible clients can request a readable id as well as the food
 * codename the runInferenceTranscript API actually needs.
 */
export function slugifyNotionDisplayName(name) {
  // Keep dots so versioned labels stay readable ("GPT-5.6 Sol" → "gpt-5.6-sol",
  // not "gpt-5-6-sol"). Collapse other punctuation/spaces to single hyphens.
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * Resolve the catalog id for a Notion model: prefer the web-picker label slug
 * (`fable-5`) over the internal food codename (`acai-budino-high`).
 */
export function catalogIdForNotionModel(codename, displayName) {
  const slug = slugifyNotionDisplayName(displayName);
  if (slug && slug !== "notion-ai") return slug;
  return codename;
}

/**
 * Collect models Notion returned with `isDisabled: true` (not listed in the
 * OpenAI catalog). Used for warnings — e.g. Fable 5 with
 * `disabledReason: business_or_enterprise_plan_required`.
 */
export function listNotionDisabledModels(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const list = data.models;
  if (!Array.isArray(list)) return [];

  const out = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry;
    if (row.isDisabled !== true) continue;
    const codename = typeof row.model === "string" ? row.model.trim() : "";
    if (!codename || seen.has(codename)) continue;
    seen.add(codename);
    const name = trimmedOrFallback(row.modelMessage, codename);
    const reason =
      typeof row.disabledReason === "string" && row.disabledReason.trim()
        ? row.disabledReason.trim()
        : "disabled";
    out.push({
      id: catalogIdForNotionModel(codename, name),
      name,
      notionCodename: codename,
      reason,
    });
  }
  return out;
}

/** Human-readable warning for disabled/plan-locked models (empty when none). */
export function formatNotionDisabledModelsWarning(disabled) {
  if (!disabled.length) return "";
  const parts = disabled.map((d) => {
    const reason = d.reason.replace(/_/g, " ");
    return `${d.name} (${reason})`;
  });
  return (
    `Notion hid ${disabled.length} model(s) as unavailable for this account/workspace: ` +
    `${parts.join("; ")}. ` +
    `They appear in the web picker only when your plan unlocks them ` +
    `(e.g. Fable 5 requires a Notion Business or Enterprise plan).`
  );
}

/**
 * Parse one getAvailableModels list entry into a model, or `null` when the entry
 * should be skipped (disabled, malformed, or a duplicate already in `seen`).
 */
function parseNotionModelEntry(entry, seen) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const row = entry;
  // Notion still returns plan-locked models (Fable 5) with isDisabled=true.
  // Listing them in /v1/models would invite failed chat requests.
  if (row.isDisabled === true) return null;

  const codename = typeof row.model === "string" ? row.model.trim() : "";
  if (!codename) return null;

  const name = trimmedOrFallback(row.modelMessage, codename);
  const catalogId = catalogIdForNotionModel(codename, name);

  // Dedupe on both catalog id and codename so a second row with the same
  // label or the same food codename is not listed twice.
  if (seen.has(catalogId) || seen.has(codename)) return null;
  seen.add(catalogId);
  seen.add(codename);

  return {
    id: catalogId,
    name,
    owned_by: trimmedOrFallback(row.modelFamily, "notion"),
    ...(catalogId !== codename ? { notionCodename: codename } : {}),
    ...(rowSupportsReasoning(row) ? { supportsReasoning: true } : {}),
  };
}

/**
 * Identity helper kept for call-site stability. Catalog entries are already
 * primary-friendly (real labels); food codenames are NOT dual-listed so
 * `/v1/models` and the UI show "fable-5" / "Fable 5" instead of "acai-budino-high".
 * Inference still accepts codenames via `resolveNotionCodename`.
 */
export function withFriendlyNotionAliases(models) {
  return models;
}

/** Ensure a stable default id always exists for clients that still request notion-ai. */
function withDefaultNotionModel(out, seen) {
  if (out.length === 0 || seen.has("notion-ai")) return out;
  return [{ id: "notion-ai", name: "Notion AI (default)", owned_by: "notion" }, ...out];
}

/**
 * Parse getAvailableModels JSON into OpenAI-style model entries.
 * Skips disabled models. Catalog id = web picker label slug; name = modelMessage;
 * notionCodename = internal food codename for runInferenceTranscript.
 */
export function parseNotionAvailableModels(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const list = data.models;
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const model = parseNotionModelEntry(entry, seen);
    if (model) out.push(model);
  }

  return withFriendlyNotionAliases(withDefaultNotionModel(out, seen));
}

export function buildNotionModelsDiscoveryHeaders(token) {
  const cookie = normalizeNotionWebCookie(token);
  const spaceId = extractSpaceIdFromNotionCookie(cookie);
  const userId = extractNotionUserIdFromCookie(cookie);
  const headers = {
    accept: "*/*",
    "content-type": "application/json",
    "user-agent": NOTION_USER_AGENT,
    origin: NOTION_APP_ORIGIN,
    referer: `${NOTION_APP_ORIGIN}/ai`,
    "notion-client-version": NOTION_CLIENT_VERSION,
    "notion-audit-log-platform": "web",
    ...(cookie ? { cookie } : {}),
    ...BROWSER_HEADERS,
  };
  if (spaceId) headers["x-notion-space-id"] = spaceId;
  if (userId) headers["x-notion-active-user-header"] = userId;
  return headers;
}

export function buildNotionModelsDiscoveryBody(token) {
  const cookie = normalizeNotionWebCookie(token);
  const spaceId = extractSpaceIdFromNotionCookie(cookie);
  return spaceId ? { spaceId } : {};
}

export function getNotionModelsDiscoveryUrl() {
  return NOTION_MODELS_URL;
}

/**
 * Parse getSpaces JSON into a stable userId (top-level map key) and all space ids.
 * Shape: `{ [userId]: { space: { [spaceId]: {...} } } }`.
 */
function collectUserSpaceEntry(key, value, spaceIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const spaceMap = value.space;
  if (!spaceMap || typeof spaceMap !== "object" || Array.isArray(spaceMap)) return "";
  for (const id of Object.keys(spaceMap)) {
    if (id && !spaceIds.includes(id)) spaceIds.push(id);
  }
  return key && !key.includes(" ") ? key : "";
}

/** Flat shape: { spaces: [{ id }] } */
function pickSpaceIdFromSpacesArray(spaces) {
  if (!Array.isArray(spaces)) return "";
  for (const s of spaces) {
    if (s && typeof s === "object" && typeof s.id === "string") {
      return s.id;
    }
  }
  return "";
}

/** Flat shape: { spaceIds: [] } */
function pickSpaceIdFromSpaceIdsArray(spaceIds) {
  return Array.isArray(spaceIds) && typeof spaceIds[0] === "string" ? spaceIds[0] : "";
}

/** Fallback spaceId extraction from the flat `{ spaces: [] }` / `{ spaceIds: [] }` shapes. */
function collectFallbackSpaceIds(root, spaceIds) {
  const fromArray = pickSpaceIdFromSpacesArray(root.spaces);
  if (fromArray) spaceIds.push(fromArray);
  const fromIds = pickSpaceIdFromSpaceIdsArray(root.spaceIds);
  if (fromIds && !spaceIds.includes(fromIds)) spaceIds.push(fromIds);
}

export function parseNotionGetSpaces(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { userId: "", spaceIds: [] };
  }
  const root = data;
  const spaceIds = [];
  let userId = "";

  for (const [key, value] of Object.entries(root)) {
    const entryUserId = collectUserSpaceEntry(key, value, spaceIds);
    if (!userId && entryUserId) userId = entryUserId;
  }

  if (spaceIds.length === 0) {
    collectFallbackSpaceIds(root, spaceIds);
  }

  return { userId, spaceIds };
}

/** Best-effort spaceId extraction from getSpaces response shapes. */
export function pickFirstSpaceId(data) {
  return parseNotionGetSpaces(data).spaceIds[0] || "";
}

function buildNotionBrowserHeaders(cookie, userId) {
  const headers = {
    accept: "*/*",
    "content-type": "application/json",
    "user-agent": NOTION_USER_AGENT,
    origin: NOTION_APP_ORIGIN,
    referer: `${NOTION_APP_ORIGIN}/ai`,
    "notion-client-version": NOTION_CLIENT_VERSION,
    "notion-audit-log-platform": "web",
    cookie,
    ...BROWSER_HEADERS,
  };
  if (userId) headers["x-notion-active-user-header"] = userId;
  return headers;
}

/**
 * Load workspace candidates from getSpaces using browser-like headers.
 * Does not require space_id in the cookie — only token_v2.
 */
export async function fetchNotionWorkspaceCandidates(cookie, fetchImpl = fetch) {
  const normalized = normalizeNotionWebCookie(cookie);
  if (!normalized) return { userId: "", spaceIds: [] };
  const userFromCookie = extractNotionUserIdFromCookie(normalized);
  try {
    const res = await fetchImpl(NOTION_SPACES_URL, {
      method: "POST",
      headers: buildNotionBrowserHeaders(normalized, userFromCookie || undefined),
      body: "{}",
    });
    if (!res.ok) return { userId: userFromCookie, spaceIds: [] };
    const data = await res.json();
    const parsed = parseNotionGetSpaces(data);
    return {
      userId: userFromCookie || parsed.userId,
      spaceIds: parsed.spaceIds,
    };
  } catch {
    return { userId: userFromCookie, spaceIds: [] };
  }
}

/**
 * Try to resolve a workspace spaceId from getSpaces when the cookie has none.
 * Returns "" on any failure (caller falls back to local catalog).
 */
export async function resolveNotionSpaceIdFromGetSpaces(cookie, fetchImpl = fetch) {
  const { spaceIds } = await fetchNotionWorkspaceCandidates(cookie, fetchImpl);
  return spaceIds[0] || "";
}

/**
 * Probe getAvailableModels for each candidate space and pick the best catalog.
 *
 * IMPORTANT: do NOT early-exit on the first "good enough" workspace. Real accounts
 * often have a personal space (many models, Fable plan-locked) and a Business/
 * AI space (Fable enabled). Exiting early permanently hides Fable 5.
 */
export async function selectBestNotionSpaceId(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cookie = normalizeNotionWebCookie(opts.cookie);
  if (!cookie || opts.spaceIds.length === 0) return null;

  let best = null;

  for (const spaceId of opts.spaceIds.slice(0, NOTION_MAX_SPACE_PROBE)) {
    if (!spaceId) continue;
    try {
      const headers = buildNotionBrowserHeaders(cookie, opts.userId || undefined);
      headers["x-notion-space-id"] = spaceId;
      const res = await fetchImpl(NOTION_MODELS_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ spaceId }),
        signal: opts.signal ?? undefined,
      });
      if (!res.ok) continue;
      const raw = await res.json();
      const models = parseNotionAvailableModels(raw);
      const enabled = models.filter((m) => m.id !== "notion-ai").length;
      // Prefer workspaces where plan-locked models (e.g. Fable 5) are actually enabled.
      const disabled = listNotionDisabledModels(raw);
      const fableLocked = disabled.some(
        (d) => d.id === "fable-5" || d.notionCodename === "acai-budino-high"
      );
      const fableEnabled = models.some(
        (m) => m.id === "fable-5" || m.notionCodename === "acai-budino-high"
      );
      // Score: enabled models, plus a large bonus for unlocked Fable (or no Fable lock).
      let score = enabled * 10;
      if (fableEnabled) score += 1000;
      else if (fableLocked) score -= 50;

      if (!best || score > best.score) {
        best = { spaceId, models, raw, score };
      }
    } catch {
      // try next space
    }
  }

  return best ? { spaceId: best.spaceId, models: best.models, raw: best.raw } : null;
}

/**
 * Resolve the best workspace for a cookie that has no space_id.
 * Cached so inference and model discovery share the same selection.
 */
export async function resolveNotionRuntimeWorkspace(opts) {
  const cookie = normalizeNotionWebCookie(opts.cookie);
  const explicit = extractSpaceIdFromNotionCookie(cookie);
  const userId = extractNotionUserIdFromCookie(cookie);
  if (explicit) {
    return { spaceId: explicit, userId, fromCache: false };
  }

  const key = notionTokenCacheKey(cookie);
  const cached = NOTION_SPACE_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { spaceId: cached.spaceId, userId: cached.userId || userId, fromCache: true };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const candidates = await fetchNotionWorkspaceCandidates(cookie, fetchImpl);
  const best = await selectBestNotionSpaceId({
    cookie,
    spaceIds: candidates.spaceIds,
    userId: userId || candidates.userId || undefined,
    fetchImpl,
    signal: opts.signal,
  });
  if (!best?.spaceId) {
    return {
      spaceId: candidates.spaceIds[0] || "",
      userId: userId || candidates.userId,
      fromCache: false,
    };
  }

  const resolvedUser = userId || candidates.userId;
  NOTION_SPACE_CACHE.set(key, {
    spaceId: best.spaceId,
    userId: resolvedUser,
    expiresAt: Date.now() + NOTION_SPACE_CACHE_TTL_MS,
  });
  return { spaceId: best.spaceId, userId: resolvedUser, fromCache: false };
}

/**
 * Discovery when the cookie already carries an explicit space_id — a single
 * targeted getAvailableModels call.
 */
async function discoverNotionModelsForExplicitSpace(opts) {
  const headers = buildNotionModelsDiscoveryHeaders(opts.cookie);
  headers["x-notion-space-id"] = opts.spaceId;
  if (opts.userId) headers["x-notion-active-user-header"] = opts.userId;

  const res = await opts.fetchImpl(NOTION_MODELS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ spaceId: opts.spaceId }),
    signal: opts.signal ?? undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`getAvailableModels failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    spaceId: opts.spaceId,
    models: parseNotionAvailableModels(data),
    data,
    spaceIdFromGetSpaces: false,
  };
}

/**
 * Discovery when the cookie has no space_id — resolve via getSpaces, then probe
 * workspaces for the richest AI model list (so operators only need the raw
 * token_v2 value). Prefer the Business/AI workspace where Fable is unlocked
 * over a personal space where Fable is plan-locked (same model count otherwise).
 * Caches the winning workspace so inference reuses the same selection as /models.
 */
async function discoverNotionModelsViaGetSpaces(opts) {
  const candidates = await fetchNotionWorkspaceCandidates(opts.cookie, opts.fetchImpl);
  const userId = opts.userId || candidates.userId;
  if (candidates.spaceIds.length === 0) {
    throw new Error(
      "Could not resolve a Notion workspace from token_v2 alone. " +
        "Re-copy a fresh token_v2 from app.notion.com (Application → Cookies), " +
        "or optionally paste space_id from Network → getAvailableModels → x-notion-space-id."
    );
  }

  const best = await selectBestNotionSpaceId({
    cookie: opts.cookie,
    spaceIds: candidates.spaceIds,
    userId: userId || undefined,
    fetchImpl: opts.fetchImpl,
    signal: opts.signal,
  });
  if (!best || best.models.length === 0) {
    throw new Error(
      "getAvailableModels returned no enabled models for any workspace visible to this token"
    );
  }

  const key = notionTokenCacheKey(opts.cookie);
  NOTION_SPACE_CACHE.set(key, {
    spaceId: best.spaceId,
    userId: userId || "",
    expiresAt: Date.now() + NOTION_SPACE_CACHE_TTL_MS,
  });

  return { spaceId: best.spaceId, models: best.models, data: best.raw, spaceIdFromGetSpaces: true };
}

/**
 * End-to-end discovery used by the models route special-case (and unit tests).
 * Resolves spaceId from cookie or getSpaces, then calls getAvailableModels.
 */
export async function discoverNotionWebModels(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cookie = normalizeNotionWebCookie(opts.token);
  if (!cookie) {
    throw new Error("Missing Notion token_v2 cookie");
  }

  const spaceIdFromCookie = extractSpaceIdFromNotionCookie(cookie);
  const userId = extractNotionUserIdFromCookie(cookie);

  const result = spaceIdFromCookie
    ? await discoverNotionModelsForExplicitSpace({
        cookie,
        spaceId: spaceIdFromCookie,
        userId,
        fetchImpl,
        signal: opts.signal,
      })
    : await discoverNotionModelsViaGetSpaces({ cookie, userId, fetchImpl, signal: opts.signal });

  if (result.models.length === 0) {
    throw new Error("getAvailableModels returned no enabled models");
  }

  const disabledModels = listNotionDisabledModels(result.data);
  const warnings = [];
  const disabledWarning = formatNotionDisabledModelsWarning(disabledModels);
  if (disabledWarning) warnings.push(disabledWarning);
  // Auto space selection is silent when it works — no scary "paste space_id" nags.

  return {
    models: result.models,
    spaceId: result.spaceId,
    source: "api",
    disabledModels,
    spaceIdFromGetSpaces: result.spaceIdFromGetSpaces,
    ...(warnings.length ? { warning: warnings.join(" ") } : {}),
  };
}

/** Effective food codename for a catalog model entry. */
export function notionCodenameOf(model) {
  if (!model?.id || model.id === "notion-ai") return "";
  return (model.notionCodename || model.id).trim();
}

/**
 * Build a reverse map of friendly labels/slugs/food-codenames → Notion food codenames.
 * Used by the executor so clients can request either id style.
 */
export function buildNotionFriendlyToCodenameMap(models = NOTION_WEB_FALLBACK_MODELS) {
  const map = new Map();
  for (const m of models) {
    if (!m?.id || m.id === "notion-ai") continue;
    const codename = notionCodenameOf(m);
    if (!codename) continue;

    // Catalog id (friendly slug) + its lowercase form.
    map.set(m.id, codename);
    map.set(m.id.toLowerCase(), codename);
    // Food codename itself (power users / cached clients).
    map.set(codename, codename);
    map.set(codename.toLowerCase(), codename);
    // Display label + slug (e.g. "Fable 5" / "fable-5").
    if (m.name) {
      map.set(m.name.toLowerCase(), codename);
      const slug = slugifyNotionDisplayName(m.name);
      if (slug) map.set(slug, codename);
    }
  }
  return map;
}

/**
 * Normalize a client model id to the codename Notion's transcript API expects.
 * Accepts provider prefixes (notion-web/, nw/), food codenames, display names,
 * and slugified labels (fable-5, gpt-5.6-sol).
 */
export function resolveNotionCodename(model, extraModels = []) {
  let m = typeof model === "string" ? model.trim() : "";
  if (!m || m === "notion-ai") return "";
  // Strip provider prefixes added by /v1/models catalog.
  if (m.startsWith("notion-web/")) m = m.slice("notion-web/".length);
  else if (m.startsWith("nw/")) m = m.slice(3);
  if (!m || m === "notion-ai") return "";

  const map = buildNotionFriendlyToCodenameMap([...NOTION_WEB_FALLBACK_MODELS, ...extraModels]);
  // Unknown ids pass through as-is so a freshly discovered codename still works
  // before the fallback table is updated.
  return map.get(m) || map.get(m.toLowerCase()) || map.get(slugifyNotionDisplayName(m)) || m;
}
