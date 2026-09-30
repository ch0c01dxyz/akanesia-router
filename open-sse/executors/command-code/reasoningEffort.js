// Command-Code-scoped reasoning-effort sanitation + 400/422 clamp-and-retry.
//
// Ported from OmniRoute's open-sse/executors/base/reasoningEffort.ts (the
// command-code-relevant branches) and base/reasoningEffortRecovery.ts /
// services/learnedReasoningEffortCaps.ts (types stripped).
//
// OmniRoute's generic sanitizer has branches for many other providers
// (nvidia, mistral, github, deepseek, glm-5.2/5.3, grok, o1-preview...). Only the
// branches that can fire for provider === "command-code" are ported here; the
// reactive 400/422 recovery + process-wide learned caps are ported verbatim
// since they are provider-agnostic machinery the command-code executor relies on.
import { getModelsByProviderId } from "../../config/providerModels.js";

export const REASONING_EFFORT_ORDER = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge caller-supplied extra upstream headers into the request headers.
 * Ported from OmniRoute's open-sse/executors/base/headers.ts.
 */
export function mergeUpstreamExtraHeaders(headers, extra) {
  if (!extra) return;
  for (const [k, v] of Object.entries(extra)) {
    if (typeof k === "string" && k.length > 0 && typeof v === "string") {
      if (k.toLowerCase() === "user-agent") {
        headers["User-Agent"] = v;
        continue;
      }
      headers[k] = v;
    }
  }
}

// ── effort carrier read/write ─────────────────────────────────────────────

function readEffortCarriers(b) {
  const reasoning = isRecord(b.reasoning) ? b.reasoning : null;
  const outputConfig = isRecord(b.output_config) ? b.output_config : null;
  const hasTopLevelReasoningEffort = Object.prototype.hasOwnProperty.call(b, "reasoning_effort");
  const hasReasoningEffort = !!(reasoning && Object.prototype.hasOwnProperty.call(reasoning, "effort"));
  const hasOutputConfigEffort = !!(
    outputConfig && Object.prototype.hasOwnProperty.call(outputConfig, "effort")
  );
  const effort = b.reasoning_effort ?? reasoning?.effort ?? outputConfig?.effort;
  return { reasoning, outputConfig, hasTopLevelReasoningEffort, hasReasoningEffort, hasOutputConfigEffort, effort };
}

/** Write a normalized effort value back to every carrier that was present. */
function writeEffortValue(b, value, c) {
  const next = { ...b };
  if (c.hasTopLevelReasoningEffort) next.reasoning_effort = value;
  if (c.hasReasoningEffort && c.reasoning) next.reasoning = { ...c.reasoning, effort: value };
  if (c.hasOutputConfigEffort && c.outputConfig)
    next.output_config = { ...c.outputConfig, effort: value };
  return next;
}

// ── learned caps (process-wide) ───────────────────────────────────────────

const learnedCaps = new Map();

function rankOf(value) {
  return REASONING_EFFORT_ORDER.indexOf(value);
}

/**
 * Clamp to the nearest learned tier: the smallest accepted value with
 * rank >= effortStr's rank, or — when the demand exceeds every accepted value —
 * the greatest accepted value. Returns null when effortStr is already accepted,
 * empty, or not a recognized member of REASONING_EFFORT_ORDER.
 */
function clampToLearned(effortStr, accepted) {
  if (!effortStr || accepted.has(effortStr)) return null;
  const rank = rankOf(effortStr);
  if (rank === -1) return null;

  let nearestAbove = null;
  let nearestAboveRank = Infinity;
  let highest = null;
  let highestRank = -1;
  for (const v of accepted) {
    const r = rankOf(v);
    if (r < 0) continue;
    if (r >= rank && r < nearestAboveRank) {
      nearestAboveRank = r;
      nearestAbove = v;
    }
    if (r > highestRank) {
      highestRank = r;
      highest = v;
    }
  }
  return nearestAbove ?? highest;
}

function getLearnedReasoningEffort(provider, model) {
  return learnedCaps.get(`${provider}:${String(model || "").toLowerCase()}`) ?? null;
}

function recordLearnedReasoningEffort(provider, model, acceptedValues) {
  const set = new Set(acceptedValues);
  learnedCaps.set(`${provider}:${String(model || "").toLowerCase()}`, set);
  return set;
}

// Matches prose shapes: OVH's "@ai-sdk/openai-compatible" deserializer
// ("expected one of `a`, `b`"), generic ("Supported types are a, b, and c"),
// and "please use a, b, or c".
const LIST_INTRO = /(?:expected one of|supported (?:types|values) are|please use)[:\s]*([^.]+)/i;

/**
 * Extract the upstream-advertised accepted reasoning_effort values from a 4xx
 * error body. Returns only tokens present in REASONING_EFFORT_ORDER (unknown
 * tokens are dropped defensively) in the order they appeared, or null when the
 * text names no recognized enum member.
 */
function parseReasoningEffortEnum(errText) {
  if (typeof errText !== "string" || !errText) return null;
  const match = LIST_INTRO.exec(errText);
  if (!match) return null;
  const tokens = match[1]
    .split(/,|\||\b(?:and|or)\b|&/i)
    .map((t) =>
      t
        .replace(/`/g, "")
        .replace(/\([^)]*\)/g, "")
        .trim()
        .toLowerCase()
        .replace(/^[^a-z]+|[^a-z]+$/g, "")
    )
    .filter((t) => t.length > 0 && REASONING_EFFORT_ORDER.includes(t));
  return tokens.length > 0 ? tokens : null;
}

// ── command-code sanitize ─────────────────────────────────────────────────

/**
 * Command-Code-relevant subset of OmniRoute's sanitizeReasoningEffortForProvider:
 * - `minimal` is rejected by Command Code outright
 *   ("Validation error: Invalid option: expected one of
 *   \"low\"|\"medium\"|\"high\"|\"xhigh\"|\"max\" at \"params.reasoning_effort\"") —
 *   map it to the closest supported value (`low`).
 * - Command Code's top tier is natively `max`; OmniRoute's internal `xhigh`
 *   maps to `max`.
 * - Generic learned clamp (reactively recorded by applyReasoningEffortRecovery).
 * - Explicit per-model capability clamp from the registry's
 *   supportedThinkingEfforts: remap to the smallest ranked declared tier >= the
 *   request, else the highest declared tier.
 */
export function sanitizeReasoningEffortForCommandCode(body, model, log) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const b = body;
  const c = readEffortCarriers(b);
  if (c.effort === undefined) return body;
  const effortStr = typeof c.effort === "string" ? c.effort.toLowerCase() : "";
  const modelStr = model || "";

  if (effortStr === "minimal") {
    log?.info?.("REASONING_SANITIZE", `command-code/${modelStr}: mapped reasoning_effort minimal → low`);
    return writeEffortValue(b, "low", c);
  }

  if (effortStr === "xhigh") {
    log?.info?.("REASONING_SANITIZE", `command-code/${modelStr}: normalized reasoning_effort xhigh → max`);
    return writeEffortValue(b, "max", c);
  }

  const learnedSet = getLearnedReasoningEffort("command-code", modelStr);
  if (learnedSet && learnedSet.size > 0 && !learnedSet.has(effortStr)) {
    const clamped = clampToLearned(effortStr, learnedSet);
    if (clamped && clamped !== effortStr) {
      log?.info?.(
        "REASONING_SANITIZE",
        `command-code/${modelStr}: clamped reasoning_effort ${effortStr} → ${clamped} (learned)`
      );
      return writeEffortValue(b, clamped, c);
    }
  }

  const providerModelIdForClamp = modelStr.startsWith("command-code/")
    ? modelStr.slice("command-code".length + 1)
    : modelStr;
  const declaredEfforts = getModelsByProviderId("command-code").find(
    (entry) => entry.id === providerModelIdForClamp || entry.aliases?.includes(providerModelIdForClamp)
  )?.supportedThinkingEfforts;
  const declaredRanked = (Array.isArray(declaredEfforts) ? declaredEfforts : [])
    .map((tier) => ({ tier, rank: REASONING_EFFORT_ORDER.indexOf(tier) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank);
  if (declaredRanked.length > 0 && !declaredEfforts.includes(effortStr)) {
    const requestedRank = REASONING_EFFORT_ORDER.indexOf(effortStr);
    const nearest =
      declaredRanked.find((x) => x.rank >= requestedRank) ??
      declaredRanked[declaredRanked.length - 1];
    log?.info?.(
      "REASONING_SANITIZE",
      `command-code/${modelStr}: mapped reasoning_effort ${effortStr} → ${nearest.tier} (model accepts ${declaredEfforts.join("/")})`
    );
    return writeEffortValue(b, nearest.tier, c);
  }

  return body;
}

// ── reactive 400/422 clamp-and-retry ────────────────────────────────────────

/**
 * Detect an upstream 400/422 naming a rejected reasoning_effort enum, clamp
 * the body to the nearest accepted value, and retry the same URL once.
 * Returns the original response/body unchanged (retried: false) when the
 * response isn't a recoverable reasoning_effort rejection.
 *
 * Ported from OmniRoute's base/reasoningEffortRecovery.ts (applyReasoningEffortRecovery).
 */
export async function applyReasoningEffortRecovery(params) {
  const { response, url, provider, model, fetchOptions, fetchFn, log } = params;
  let body = params.body;

  const notRecoverable = { response, body, retried: false, attempted: false };

  if (response.status !== 400 && response.status !== 422) {
    return notRecoverable;
  }
  if (!body || typeof body !== "object") {
    return notRecoverable;
  }

  const errText = await response
    .clone()
    .text()
    .catch(() => "");
  const acceptedValues = parseReasoningEffortEnum(errText);
  if (!acceptedValues) {
    return notRecoverable;
  }

  const learned = recordLearnedReasoningEffort(provider, model, acceptedValues);
  if (!learned || learned.size === 0) {
    return { response, body, retried: false, attempted: true };
  }

  const beforeRetry = JSON.stringify(body);
  const clampedBody = sanitizeReasoningEffortForCommandCode(body, model, log ?? undefined);
  const afterRetry = JSON.stringify(clampedBody);
  if (beforeRetry === afterRetry) {
    log?.info?.(
      "REASONING_SANITIZE",
      `Upstream ${response.status} rejected reasoning_effort on ${url} — learned ${[...learned].join(",")} but clamp was no-op for ${provider}/${model}, not retrying`
    );
    return { response, body: clampedBody, retried: false, attempted: true };
  }

  const serialize = params.serializeBody ?? ((b2) => JSON.stringify(b2));
  const retryBody = await serialize(clampedBody);
  log?.info?.(
    "REASONING_SANITIZE",
    `Upstream ${response.status} rejected reasoning_effort on ${url} — clamped to ${[...learned].join(",")} and retrying (learned for ${provider}/${model})`
  );
  const retriedResponse = await fetchFn(url, { ...fetchOptions, body: retryBody });
  return { response: retriedResponse, body: clampedBody, retried: true, attempted: true };
}
