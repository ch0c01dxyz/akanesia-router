/**
 * Token budgeting for reasoning models (P1, diadopsi dari opencode-free-bridge).
 *
 * Reasoning models (Muse Spark, MiMo, Nemotron, LongCat, ...) emit
 * chain-of-thought tokens that count against the SAME output budget as the
 * visible answer. When a client asks for a small max_tokens, the model spends
 * the whole budget thinking and returns finish_reason: "length" with empty
 * content. The failure is silent: no error, no content, tokens still billed.
 *
 * Fix: ADDITIVE budget — max_tokens = answer_budget + thinking_budget.
 * The client's value is never lowered, only raised when too small to survive
 * the model's reasoning phase.
 *
 * Tuning (diukur terhadap live OpenCode gateway):
 *   MIN_ANSWER_TOKENS = 1024 (cocok dengan pi & reservasi Anthropic)
 *   THINKING_BUDGET   = 4096 (mencakup ~100-800 reasoning tokens + margin)
 */

import { getCapabilitiesForModel } from "../providers/capabilities.js";

export const MIN_ANSWER_TOKENS = 1024;
export const THINKING_BUDGET = 4096;
export const MAX_OUTPUT_TOKENS = 131072;
// Non-reasoning models still get a floor, so a tiny client value cannot
// truncate a normal answer mid-sentence.
export const MIN_PLAIN_TOKENS = 512;

/** True bila model adalah reasoning/thinking model menurut capabilities. */
export function isReasoningModel(provider, modelId) {
  const id = String(modelId || "");
  if (!id) return false;
  try {
    return getCapabilitiesForModel(provider, id).reasoning === true;
  } catch {
    return false; // fail-open: anggap bukan reasoning
  }
}

/** True bila request butuh reasoning budget (model thinking atau effort eksplisit). */
export function isReasoningRequest(body, provider, modelId) {
  if (isReasoningModel(provider, modelId)) return true;
  const effort = body?.reasoning_effort ?? body?.reasoning?.effort;
  return Boolean(effort) && effort !== "none";
}

function parseRequestedTokens(requested) {
  if (requested === undefined || requested === null || typeof requested === "boolean") {
    return MAX_OUTPUT_TOKENS;
  }
  if (typeof requested === "string" && requested.trim() === "") {
    return MAX_OUTPUT_TOKENS;
  }
  const raw = Number(requested);
  if (!Number.isFinite(raw) || raw < 0) return MAX_OUTPUT_TOKENS;
  return Math.floor(raw);
}

/**
 * Clamp budget output ke rentang yang selalu menyisakan ruang untuk jawaban
 * yang terlihat. Nilai klien tidak pernah diturunkan — hanya dinaikkan bila
 * terlalu kecil untuk fase reasoning model.
 */
export function effectiveMaxTokens(requested, provider, modelId, body = null) {
  const wanted = parseRequestedTokens(requested);
  const effective = isReasoningRequest(body, provider, modelId)
    ? Math.max(wanted, MIN_ANSWER_TOKENS) + THINKING_BUDGET
    : Math.max(wanted, MIN_PLAIN_TOKENS);

  // Jangan minta lebih dari yang bisa di-emit model (ceiling dari capabilities).
  let ceiling = MAX_OUTPUT_TOKENS;
  try {
    const maxOutput = getCapabilitiesForModel(provider, modelId)?.maxOutput;
    if (Number.isFinite(maxOutput) && maxOutput > 0) ceiling = Math.min(ceiling, maxOutput);
  } catch { /* abaikan */ }
  return Math.min(effective, ceiling);
}
