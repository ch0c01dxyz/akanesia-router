// Ported from OmniRoute's open-sse/vendor/codex-chatgpt-web/usage/totals.ts.
// Adapted from miuuyy/codex-chatgpt-web (MIT).

/**
 * `inputTokens` already includes cache detail, so cache tokens are never added twice. A provider's
 * explicit total is accepted only when it is at least input+output.
 */
export function usageDisplayTotalTokens(usage) {
  if (!usage) return undefined;
  const baseTotal = usage.inputTokens + usage.outputTokens;
  const explicitTotal = usage.totalTokens;
  return typeof explicitTotal === "number" ? Math.max(explicitTotal, baseTotal) : baseTotal;
}
