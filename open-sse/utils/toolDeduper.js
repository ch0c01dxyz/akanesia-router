/**
 * Normalisasi tool sebelum dispatch:
 * - Dedup built-in tool ekuivalen MCP (khusus klien Claude, mengurangi token bloat).
 * - Dedup tool bernama persis sama untuk model DeepSeek — upstream DeepSeek menolak
 *   nama tool duplikat dengan 400 "Tool names must be unique" di semua endpoint
 *   (api.deepseek.com, opencode.go, LiteLLM). Definisi pertama menang; tool_choice
 *   dan referensi riwayat pesan memakai nama/id sehingga tidak ada yang rusak.
 */
import { isDeepSeekModel } from "../providers/models/helpers.js";

const DEDUP_RULES = [
  {
    // Exa MCP present → drop built-in web tools (Exa is preferred).
    triggers: ["mcp__exa__web_search_exa", "mcp__exa__web_fetch_exa"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Tavily MCP present → drop built-in web tools.
    triggers: ["mcp__tavily__tavily_search", "mcp__tavily__tavily_extract"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Browser MCP present → drop Cowork's duplicate Claude_in_Chrome connector.
    triggers: [/^mcp__browsermcp__/],
    strip: [/^mcp__Claude_in_Chrome__/],
  },
];

function getToolName(t) {
  return t?.name || t?.function?.name || "";
}

function matches(name, pattern) {
  if (typeof pattern === "string") return name === pattern;
  return pattern instanceof RegExp ? pattern.test(name) : false;
}

/**
 * @param {Array} tools - array tools yang sudah ditranslasi
 * @param {Object} [opts]
 * @param {string|null} [opts.clientTool] - klien terdeteksi ("claude" | "codex" | ...)
 * @param {string|null} [opts.model] - id model, bisa membawa suffix thinking (level)
 * @returns {{ tools: Array, stripped: Array<string> }}
 */
function dedupeTools(tools, opts = {}) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, stripped: [] };
  const names = tools.map(getToolName);
  const toStrip = new Set();
  const toDrop = new Set(); // indeks tool duplikat bernama sama

  // Dedup built-in berbasis MCP: khusus klien Claude (upstream 7f5bd155 —
  // dulu unconditional untuk semua klien, kini di-gate agar tidak menghapus
  // tool sah di klien non-Claude).
  if (opts.clientTool === "claude") {
    for (const rule of DEDUP_RULES) {
      const hasTrigger = names.some((n) => rule.triggers.some((p) => matches(n, p)));
      if (!hasTrigger) continue;
      for (const n of names) {
        if (rule.strip.some((p) => matches(n, p))) toStrip.add(n);
      }
    }
  }

  // Dedup nama persis: upstream DeepSeek menolak nama tool duplikat. Berlaku untuk
  // setiap klien × provider yang menyajikan model deepseek-* (official API, Console
  // Go, gateway LiteLLM); model non-DeepSeek tidak disentuh.
  if (isDeepSeekModel(opts.model)) {
    const seen = new Set();
    for (let i = 0; i < tools.length; i++) {
      const n = getToolName(tools[i]);
      if (!n) continue;
      if (seen.has(n)) toDrop.add(i);
      else seen.add(n);
    }
  }

  if (toStrip.size === 0 && toDrop.size === 0) return { tools, stripped: [] };
  const out = tools.filter((t, i) => !toDrop.has(i) && !toStrip.has(getToolName(t)));
  const stripped = Array.from(toDrop).map((i) => getToolName(tools[i])).concat(Array.from(toStrip));
  return { tools: out, stripped };
}

export { dedupeTools };
