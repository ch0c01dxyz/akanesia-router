/**
 * LMArena live model list parsing, catalog normalization, and name→UUID resolution.
 * Ported from OmniRoute's executors/lmarena/models.ts (types stripped).
 *
 * Live arena.ai HTML discovery is intentionally disabled. Catalog + UUID map
 * come from the Direct-chat scrape seed (./directModels.js).
 */

import { sanitizeLMArenaError } from "./error.js";
import {
  LMARENA_DIRECT_MODEL_ENTRIES,
  resolveLmarenaArenaId,
} from "./directModels.js";

export const LMARENA_API_BASE = "https://arena.ai";
export const LMARENA_STREAM_URL = `${LMARENA_API_BASE}/nextjs-api/stream/create-evaluation`;
/**
 * Current Chrome stable UA (header surface).
 * TLS JA3/JA4 profile is separate: the provider-tested wreq-js profile is pinned
 * to chrome_146 in ./tlsClient.js while headers track the live browser string.
 * Treat that deliberate version skew as a WAF-sensitive compatibility surface.
 */
export const LMARENA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
export const LMARENA_MODEL_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Browser-like CORS headers for arena.ai same-origin API calls. */
export function buildLmarenaBrowserHeaders(extra) {
  return {
    Accept: "text/event-stream, application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Origin: LMARENA_API_BASE,
    Referer: `${LMARENA_API_BASE}/`,
    "Sec-Ch-Ua": '"Chromium";v="150", "Google Chrome";v="150", "Not-A.Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": LMARENA_USER_AGENT,
    ...extra,
  };
}

// Live arena.ai HTML discovery is intentionally disabled. Catalog + UUID map
// come from the Direct-chat scrape seed (registry/lmarena/directModels.ts in OmniRoute).

function stripLMArenaModelPrefix(model) {
  return model.replace(/^(?:lmarena|lma|arena)\//i, "").trim();
}

function normalizeModelName(model) {
  return model.trim().toLowerCase();
}

function hasLMArenaCapability(entry, direction, key) {
  const capabilities =
    direction === "input" ? entry.capabilities?.inputCapabilities : entry.capabilities?.outputCapabilities;
  return capabilities?.[key] === true;
}

/**
 * Arena ships hundreds of initialModels rows; many are webdev-only, hidden,
 * unranked sentinels (chat rank = MAX_SAFE_INTEGER), or UUID twins that 404 on
 * create-evaluation. Keep the catalog to chat-usable, ranked, selectable rows.
 */
const LMARENA_MAX_REASONABLE_CHAT_RANK = 100_000;
/** Soft cap after dedupe — Arena UI only surfaces ~100–130 chat models. */
export const LMARENA_CATALOG_SOFT_CAP = 120;

const deadCatalogKeys = new Map();
const DEAD_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

function deadKey(value) {
  return value.trim().toLowerCase();
}

/** Remember a model id/publicName that 404/502'd so the next catalog import drops it. */
export function markLMArenaCatalogModelDead(idOrPublicName) {
  if (!idOrPublicName?.trim()) return;
  deadCatalogKeys.set(deadKey(idOrPublicName), Date.now() + DEAD_CATALOG_TTL_MS);
}

export function clearLMArenaDeadCatalogModels() {
  deadCatalogKeys.clear();
}

function isMarkedDead(entry, publicId) {
  const now = Date.now();
  for (const key of [publicId, entry.id, entry.publicName, entry.name, entry.displayName]) {
    if (!key) continue;
    const exp = deadCatalogKeys.get(deadKey(key));
    if (exp === undefined) continue;
    if (exp <= now) {
      deadCatalogKeys.delete(deadKey(key));
      continue;
    }
    return true;
  }
  return false;
}

function isLMArenaChatCatalogModel(entry) {
  if (entry.userSelectable === false) return false;
  // Must resolve to a real Arena UUID for create-evaluation.
  if (typeof entry.id !== "string" || !LMARENA_MODEL_ID_RE.test(entry.id)) return false;

  const chatRank = entry.rankByModality?.chat;
  if (typeof chatRank !== "number" || !Number.isFinite(chatRank)) return false;
  // Unranked / placeholder rows use huge sentinels and commonly 404 when probed.
  if (chatRank >= LMARENA_MAX_REASONABLE_CHAT_RANK) return false;

  if (!hasLMArenaCapability(entry, "input", "text")) return false;
  if (!hasLMArenaCapability(entry, "output", "text")) return false;

  // Prefer rows with a stable human slug (not bare UUID as the only label).
  const publicId = getLMArenaPublicModelId(entry).trim();
  if (!publicId) return false;
  if (LMARENA_MODEL_ID_RE.test(publicId) && !entry.publicName && !entry.name) return false;

  return true;
}

function lmarenaModelResolutionScore(entry) {
  let score = 0;
  if (entry.userSelectable === false) score += 1_000_000;
  if (!hasLMArenaCapability(entry, "input", "text")) score += 100_000;
  if (!hasLMArenaCapability(entry, "output", "text")) score += 50_000;

  const chatRank = entry.rankByModality?.chat;
  if (typeof chatRank === "number" && Number.isFinite(chatRank)) {
    score += chatRank;
  } else if (typeof entry.rank === "number" && Number.isFinite(entry.rank)) {
    score += 10_000 + entry.rank;
  } else {
    score += 20_000;
  }

  if (!entry.name) score += 500;
  if (!entry.organization && !entry.provider) score += 100;

  return score;
}

function getLMArenaPublicModelId(entry) {
  return entry.publicName || entry.displayName || entry.name || entry.id || "";
}

export function normalizeLMArenaModelsForCatalog(models) {
  const bestByPublicId = new Map();

  models.forEach((entry, index) => {
    if (!isLMArenaChatCatalogModel(entry)) return;
    const publicId = getLMArenaPublicModelId(entry).trim();
    if (!publicId) return;
    if (isMarkedDead(entry, publicId)) return;

    const previous = bestByPublicId.get(publicId);
    if (!previous || lmarenaModelResolutionScore(entry) < lmarenaModelResolutionScore(previous.entry)) {
      bestByPublicId.set(publicId, { entry, index });
    }
  });

  return Array.from(bestByPublicId.entries())
    .sort(
      ([, a], [, b]) =>
        lmarenaModelResolutionScore(a.entry) - lmarenaModelResolutionScore(b.entry) || a.index - b.index
    )
    .slice(0, LMARENA_CATALOG_SOFT_CAP)
    .map(([id, { entry }]) => ({
      id,
      name: entry.displayName || entry.publicName || entry.name || id,
      owned_by: entry.organization || entry.provider || "lmarena",
      ...(hasLMArenaCapability(entry, "input", "image") ? { supportsVision: true } : {}),
      apiFormat: "chat-completions",
      supportedEndpoints: ["chat"],
    }));
}

export function pickLMArenaModelId(model, models) {
  const requested = stripLMArenaModelPrefix(model);
  if (LMARENA_MODEL_ID_RE.test(requested)) return requested;

  const normalized = normalizeModelName(requested);
  const matches = models
    .map((entry, index) => ({ entry, index }))
    // Only map onto chat-catalog-quality rows — avoids binding a public name to a
    // webdev-only / unranked twin UUID that 404s on create-evaluation.
    .filter(({ entry }) => isLMArenaChatCatalogModel(entry))
    .filter(({ entry }) =>
      [entry.id, entry.publicName, entry.name, entry.displayName].some(
        (candidate) => typeof candidate === "string" && normalizeModelName(candidate) === normalized
      )
    );
  const match = matches.sort(
    (a, b) => lmarenaModelResolutionScore(a.entry) - lmarenaModelResolutionScore(b.entry) || a.index - b.index
  )[0]?.entry;

  return match?.id || requested;
}

export function parseLMArenaInitialModels(html) {
  const escapedMarker = '\\"initialModels\\":[';
  const plainMarker = '"initialModels":[';
  const marker = html.includes(escapedMarker) ? escapedMarker : plainMarker;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return [];

  const arrayStart = markerIndex + marker.length - 1;
  const escapedEnd = '],\\"initialModelAId\\"';
  const plainEnd = '],"initialModelAId"';
  const arrayEnd = html.indexOf(escapedEnd, arrayStart);
  const fallbackEnd = html.indexOf(plainEnd, arrayStart);
  const endIndex = arrayEnd >= 0 ? arrayEnd : fallbackEnd;
  if (endIndex < 0 || endIndex < arrayStart) return [];

  const rawArray = html.slice(arrayStart, endIndex + 1).replace(/\\"/g, '"');
  try {
    const parsed = JSON.parse(rawArray);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Static Direct-chat allowlist only — no arena.ai network call. */
export async function getLMArenaModels(log) {
  // Chat path only — Image rows live in IMAGE_PROVIDERS (imageRegistry).
  const models = LMARENA_DIRECT_MODEL_ENTRIES.filter(
    (m) => m.category === "Text" || m.category === "Search"
  ).map((m) => ({
    id: m.arenaId,
    publicName: m.catalogId,
    name: m.publicName,
    displayName: m.displayName,
    organization: m.organization,
    userSelectable: true,
    capabilities: {
      inputCapabilities: { text: true, ...(m.vision ? { image: true } : {}) },
      outputCapabilities: {
        text: true,
        ...(m.category === "Search" ? { web: true } : {}),
      },
    },
    rankByModality: { chat: 1 },
  }));
  log?.debug?.(
    "LMArenaExecutor",
    `Using static Direct-chat catalog (${models.length} Text/Search models; Image in imageRegistry)`
  );
  return models;
}

export async function resolveLMArenaModelId(model, log) {
  const requested = stripLMArenaModelPrefix(model);
  if (LMARENA_MODEL_ID_RE.test(requested)) return requested;

  try {
    const fromSeed = resolveLmarenaArenaId(requested);
    if (fromSeed) return fromSeed;
    return pickLMArenaModelId(requested, await getLMArenaModels(log));
  } catch (error) {
    log?.warn?.(
      "LMArenaExecutor",
      `Using raw model id after static catalog lookup failed: ${sanitizeLMArenaError(error, "Arena catalog lookup error")}`
    );
    return requested;
  }
}
