// conol-web-models — Conol model catalog + effort selection (ported from OmniRoute).
//
// Effort ladders observed on https://conol.ai/api/agent-servers (2026-07-30).
// The fallback seeds below mirror OmniRoute's CONOL_FALLBACK_MODELS; the live
// /api/agent-servers discovery catalog is optional infra and not ported.

/** Ordered weakest → strongest. Used to clamp a requested effort onto a model. */
export const CONOL_EFFORT_ORDER = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

const EFFORTS_XHIGH = ["low", "medium", "high", "xhigh"];
const EFFORTS_STANDARD = ["minimal", "low", "medium", "high"];
const EFFORTS_NO_XHIGH = ["low", "medium", "high"];
const EFFORTS_HIGH_ONLY = ["high", "xhigh"];
const EFFORTS_PRO = ["medium", "high", "xhigh"];

const FALLBACK_MODEL_SEEDS = [
  { id: "claude-opus-5", vision: true, efforts: EFFORTS_XHIGH },
  { id: "claude-opus-4-8", vision: true, efforts: EFFORTS_XHIGH },
  { id: "claude-fable-5", vision: true, efforts: EFFORTS_XHIGH },
  { id: "claude-sonnet-5", vision: true, efforts: EFFORTS_NO_XHIGH },
  { id: "claude-sonnet-4-6", vision: true, efforts: EFFORTS_NO_XHIGH },
  { id: "claude-haiku-4-5", vision: true, efforts: EFFORTS_STANDARD },
  { id: "gpt-5.5", vision: true, efforts: EFFORTS_XHIGH },
  { id: "gpt-5.5-pro", vision: true, efforts: EFFORTS_PRO },
  { id: "gpt-5.6-sol", vision: true, efforts: EFFORTS_XHIGH },
  { id: "gpt-5.6-terra", vision: true, efforts: EFFORTS_XHIGH },
  { id: "gpt-5.6-luna", vision: true, efforts: EFFORTS_XHIGH },
  { id: "deepseek/deepseek-v4-pro", vision: false, efforts: EFFORTS_HIGH_ONLY },
  { id: "openrouter/fusion", vision: false, efforts: [] },
  { id: "z-ai/glm-5.2", vision: false, efforts: EFFORTS_STANDARD },
  { id: "tencent/hy3", vision: false, efforts: EFFORTS_STANDARD },
  { id: "moonshotai/kimi-k3", vision: true, efforts: EFFORTS_STANDARD },
  { id: "moonshotai/kimi-k2.7-code", vision: true, efforts: EFFORTS_STANDARD },
  { id: "qwen/qwen3.7-plus", vision: true, efforts: EFFORTS_STANDARD },
  { id: "qwen/qwen3.7-max", vision: false, efforts: EFFORTS_STANDARD },
  { id: "minimax/minimax-m3", vision: true, efforts: EFFORTS_STANDARD },
  { id: "stepfun/step-3.7-flash", vision: true, efforts: EFFORTS_STANDARD },
  { id: "google/gemini-3.7-flash", vision: true, efforts: EFFORTS_STANDARD },
  { id: "google/gemini-3.1-pro-preview", vision: true, efforts: EFFORTS_STANDARD },
  { id: "google/gemini-3.1-flash-lite", vision: true, efforts: EFFORTS_STANDARD },
  { id: "x-ai/grok-4.3", vision: true, efforts: EFFORTS_STANDARD },
  { id: "deepseek/deepseek-v4-flash", vision: false, efforts: EFFORTS_HIGH_ONLY },
  { id: "xiaomi/mimo-v2.5", vision: true, efforts: EFFORTS_STANDARD },
  { id: "xiaomi/mimo-v2.5-pro", vision: false, efforts: EFFORTS_STANDARD },
];

/** Presets exposed by the web client's model picker (id → text/multimodal model). */
export const CONOL_FALLBACK_MODEL_PRESETS = [
  { id: "flash", text: "deepseek/deepseek-v4-flash", multimodal: "google/gemini-3.7-flash" },
  { id: "moderate", text: "deepseek/deepseek-v4-pro", multimodal: "claude-sonnet-5" },
  { id: "pro", text: "z-ai/glm-5.2", multimodal: "moonshotai/kimi-k3" },
  { id: "ultra", text: "claude-fable-5", multimodal: "claude-fable-5" },
];

function modelName(id) {
  return id
    .split("/")
    .pop()
    .split("-")
    .map((part) => {
      const lower = part.toLowerCase();
      if (["gpt", "ai", "glm"].includes(lower)) return lower.toUpperCase();
      return part.length ? part[0].toUpperCase() + part.slice(1) : part;
    })
    .join(" ");
}

export const CONOL_FALLBACK_MODELS = FALLBACK_MODEL_SEEDS.map((seed) => ({
  id: seed.id,
  name: modelName(seed.id),
  supportsVision: seed.vision,
  efforts: [...seed.efforts],
}));

const CONOL_FALLBACK_EFFORTS = new Map(
  FALLBACK_MODEL_SEEDS.map((seed) => [seed.id, seed.efforts])
);

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Clamp a requested effort onto the ladder a model actually advertises.
 * Returns `null` when the model exposes no effort control at all.
 */
export function clampConolEffort(requested, supported) {
  const ladder =
    supported && supported.length
      ? CONOL_EFFORT_ORDER.filter((effort) => supported.includes(effort))
      : [];
  if (!ladder.length) return null;
  if (ladder.includes(requested)) return requested;

  const requestedRank = CONOL_EFFORT_ORDER.indexOf(requested);
  // Prefer the strongest supported effort at or below the request; otherwise the weakest above.
  let below = null;
  for (const effort of ladder) {
    if (CONOL_EFFORT_ORDER.indexOf(effort) <= requestedRank) below = effort;
  }
  return below ?? ladder[0];
}

/** Effort ladder for a model id, using discovery data when available. */
export function conolEffortsForModel(modelId, discovered) {
  const fromDiscovery = discovered?.find((model) => model.id === modelId)?.efforts;
  if (fromDiscovery) return [...fromDiscovery];
  return [...(CONOL_FALLBACK_EFFORTS.get(modelId) ?? [])];
}

/**
 * Effort applied when the caller does not pin one via the `-<effort>` model suffix.
 * Clamped per-model, so models without an `xhigh` rung fall back to their strongest rung.
 */
export const CONOL_DEFAULT_EFFORT = "xhigh";

export function resolveConolModelSelection(value) {
  let model = readString(value);
  if (model.startsWith("conol-web/")) model = model.slice("conol-web/".length);
  else if (model.startsWith("conol/")) model = model.slice("conol/".length);
  else if (model.startsWith("cnl/")) model = model.slice("cnl/".length);
  model ||= "claude-sonnet-5";

  const effortMatch = model.match(/-(xhigh|high|medium|low|minimal)$/);
  if (!effortMatch) return { model, effort: CONOL_DEFAULT_EFFORT, effortExplicit: false };
  return {
    model: model.slice(0, -effortMatch[0].length),
    effort: effortMatch[1],
    effortExplicit: true,
  };
}

export function resolveConolModelId(value) {
  return resolveConolModelSelection(value).model;
}
