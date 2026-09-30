// Vision-model id heuristic used by the command-code executor.
//
// Ported from OmniRoute's src/shared/constants/visionModels.ts (single source
// of truth for the model-id vision heuristic). Kept conservative: this is only
// the last-resort fallback — the command-code executor first applies its own
// CC_VISION_MODEL_PATTERNS.

export const VISION_MODEL_ID_FRAGMENTS = [
  "pixtral",
  "llava",
  "bakllava",
  "qwen-vl",
  "qwen2-vl",
  "qwen2.5-vl",
  "qwen3-vl",
  "qvq",
  "internvl",
  "minicpm-v",
  "moondream",
  "mimo-vl",
  "mimo-v2.5",
  "step-3.7-flash",
  "kimi-vl",
  "glm-4v",
  "glm-4.5v",
  "glm-4.6v",
  "glm-5.3-flash",
  "gpt-4o",
  "gpt-4.1",
  "gpt-4-turbo",
  "gpt-4-vision",
  "gpt-5",
  "gemini-1.5",
  "gemini-2",
  "gemini-3",
  "gemini-exp",
  "claude-3",
  "claude-fable",
  "claude-opus-4",
  "claude-sonnet-4",
  "claude-haiku-4",
  "claude-fable",
  "mistral-medium-3",
  "minimax-m3",
  "kimi-k2.",
  "hcx-005",
  "-vision",
  "multimodal",
];

/**
 * Whether a model id looks like a vision-capable model. Case-insensitive
 * substring match against VISION_MODEL_ID_FRAGMENTS. Returns `false` for
 * empty / nullish input.
 */
export function isVisionModelId(modelId) {
  if (!modelId) return false;
  const normalized = String(modelId).toLowerCase();

  // Xiaomi documents the Pro chat variants as text-only even though the base
  // MiMo V2.5 model is multimodal.
  if (/(?:^|\/)mimo-v2\.5-pro(?:$|[:/])/i.test(normalized)) return false;
  if (/(?:^|\/)mimo-v2-pro(?:$|[:/])/i.test(normalized)) return false;

  return VISION_MODEL_ID_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}
