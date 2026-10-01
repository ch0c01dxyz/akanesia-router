// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

// Diekspor agar API provider-nodes dan /v1/models bisa menolak /
// menyembunyikan prefix node kustom yang bertabrakan dengan id/alias
// provider bawaan. Tanpa ini, model node tampil di /v1/models sebagai
// `{prefix}/{model}` tetapi chat me-routing `{prefix}` ke provider bawaan
// (getModelInfo sengaja memprioritaskan provider bawaan) sehingga request
// gagal dengan "No active credentials for provider: {prefix}".
export { RESERVED_PROVIDER_PREFIXES };

export function isReservedProviderPrefix(prefix) {
  return typeof prefix === "string" && RESERVED_PROVIDER_PREFIXES.has(prefix.trim());
}

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getCachedModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

// Cache singkat untuk tabel modelAliases agar tiap request chat tidak selalu
// SELECT ke DB. Di-invalidate eksplisit setiap PUT/DELETE alias.
const MASK_ALIAS_CACHE_TTL_MS = 10_000;
let maskAliasCache = null;
let maskAliasCacheAt = 0;

async function getCachedModelAliases() {
  const now = Date.now();
  if (maskAliasCache && now - maskAliasCacheAt < MASK_ALIAS_CACHE_TTL_MS) {
    return maskAliasCache;
  }
  const aliases = await getModelAliases();
  maskAliasCache = aliases || {};
  maskAliasCacheAt = now;
  return maskAliasCache;
}

/** Kosongkan cache mask — dipanggil setelah PUT/DELETE /api/models/alias. */
export function invalidateMaskAliasCache() {
  maskAliasCache = null;
  maskAliasCacheAt = 0;
}

/**
 * Resolve prefix node kustom (openai/anthropic/embedding-compatible) menjadi
 * node id. Null bila prefix adalah id/alias provider bawaan (reserved) atau
 * tidak cocok dengan node manapun.
 */
async function resolveNodePrefixId(providerAlias) {
  if (!providerAlias || RESERVED_PROVIDER_PREFIXES.has(providerAlias)) return null;
  const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
  const matchedOpenAI = openaiNodes.find((node) => node.prefix === providerAlias);
  if (matchedOpenAI) return matchedOpenAI.id;
  const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
  const matchedAnthropic = anthropicNodes.find((node) => node.prefix === providerAlias);
  if (matchedAnthropic) return matchedAnthropic.id;
  const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
  const matchedEmbedding = embeddingNodes.find((node) => node.prefix === providerAlias);
  if (matchedEmbedding) return matchedEmbedding.id;
  return null;
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  // Route-Masking: nama samaran boleh berformat "prefix/model" (prefix bisa
  // virtual, mis. "routerlokal/glm-5.3-flash"), jadi seluruh string harus
  // dicocokkan ke daftar mask DULU sebelum di-parse sebagai provider/model.
  // Tanpa ini, "routerlokal/..." tidak pernah mencapai alias map karena
  // parseModel menganggapnya pasangan provider/model biasa.
  if (typeof modelStr === "string" && modelStr.includes("/")) {
    let masks = null;
    try {
      masks = await getCachedModelAliases();
    } catch (err) {
      // Fail-open ke parsing normal, tapi jangan telan error DB diam-diam.
      console.warn("[route-masking] getModelAliases gagal, lanjut parsing normal:", err?.message || err);
    }
    if (masks && Object.prototype.hasOwnProperty.call(masks, modelStr)) {
      const resolved = resolveModelAliasFromMap(modelStr, masks);
      if (resolved) {
        // Target mask harus melewati resolusi yang sama dengan jalur normal:
        // prefix node kustom -> node id, lalu alias provider lokal.
        // Tanpa ini, mask ke target node kustom (mis. "dahono/...") gagal
        // dengan "No active credentials" karena kredensial tersimpan
        // di bawah node id, bukan prefix.
        const nodeId = await resolveNodePrefixId(resolved.provider);
        const provider = nodeId || LOCAL_PROVIDER_ALIASES[resolved.provider] || resolved.provider;
        return { provider, model: resolved.model };
      }
    }
  }

  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    const nodeId = await resolveNodePrefixId(parsed.providerAlias);
    if (nodeId) {
      return { provider: nodeId, model: parsed.model };
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  return getModelInfoCore(modelStr, getModelAliases);
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
