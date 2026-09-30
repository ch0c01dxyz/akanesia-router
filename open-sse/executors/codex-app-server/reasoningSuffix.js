// Suffix-based reasoning-effort parsing for codex (app-server) model IDs.
//
// Ported from OmniRoute's open-sse/executors/codex/reasoningSuffix.ts (types stripped).

export const CODEX_EFFORT_ORDER = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

export const CODEX_MAX_ALIAS_MODELS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
]);

export const CODEX_ULTRA_ALIAS_MODELS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
  "gpt-6-sol",
]);

/** Highest effort a max/ultra-tier base model accepts, or null for other models. */
export function getCodexAliasEffortCap(model) {
  if (CODEX_ULTRA_ALIAS_MODELS.has(model)) return "ultra";
  if (CODEX_MAX_ALIAS_MODELS.has(model)) return "max";
  return null;
}

export function splitCodexReasoningSuffix(model) {
  const modelId = typeof model === "string" ? model : "";
  const maxTierMatch = /^(.+?)(?:-(max|ultra)|\((max|ultra)\))$/.exec(modelId);
  if (maxTierMatch) {
    const [, baseModel, hyphenEffort, parenthesizedEffort] = maxTierMatch;
    const effort = hyphenEffort ?? parenthesizedEffort;
    const supportedModels = parenthesizedEffort
      ? CODEX_MAX_ALIAS_MODELS
      : effort === "ultra"
        ? CODEX_ULTRA_ALIAS_MODELS
        : CODEX_MAX_ALIAS_MODELS;
    if (supportedModels.has(baseModel)) {
      return { baseModel, effort };
    }
  }

  for (const effort of ["none", "low", "medium", "high", "xhigh"]) {
    if (modelId.endsWith(`-${effort}`)) {
      return { baseModel: modelId.slice(0, -`-${effort}`.length), effort };
    }
  }
  return { baseModel: modelId, effort: null };
}
