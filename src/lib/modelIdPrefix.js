/**
 * Model-id prefix stacking guards for compatible-provider nodes.
 *
 * A node's public model ids are `<prefix>/<upstreamId>`, but stored rows
 * (custom models, alias values, enabled-model lists) can carry the prefix
 * already — written before normalization existed or pasted from a prefixed
 * listing. Emission must collapse those stacks so the catalog never
 * publishes `<prefix>/<prefix>/<model>`.
 *
 * Collapsing is scoped to compatible nodes on purpose: a canonical
 * provider's ids may legitimately begin with the provider's own name
 * (e.g. `moonshotai/Kimi-K3.1-Pro`) and must be kept verbatim. Callers
 * must only pass a node's own prefixes as candidates.
 */

/**
 * Strip every repeated leading `<prefix>/` for the given node prefixes.
 *
 * Only the node's OWN prefixes are ever stripped, and only as a leading
 * stack: upstream ids may legitimately contain slashes
 * (`opc/big-pickle`). Idempotent by construction — a fully collapsed id
 * collapses to itself, and emission re-adding one `<prefix>/` yields
 * exactly `<prefix>/<upstreamId>`.
 *
 * Matching is exact (case-sensitive): a prefix renamed after storage no
 * longer collapses; the stale id surfaces for cleanup instead of silently
 * changing identity under a different name.
 *
 * @param {string} modelId
 * @param {Array<string|null|undefined>} prefixes
 * @returns {string}
 */
export function collapseProviderPrefix(modelId, prefixes) {
  if (typeof modelId !== "string" || !modelId.includes("/")) return modelId;
  const withSlashes = [];
  for (const prefix of prefixes || []) {
    if (prefix) withSlashes.push(`${prefix}/`);
  }
  if (withSlashes.length === 0) return modelId;
  let current = modelId;
  let changed = true;
  while (changed) {
    changed = false;
    for (const withSlash of withSlashes) {
      while (current.length > withSlash.length && current.startsWith(withSlash)) {
        current = current.slice(withSlash.length);
        changed = true;
      }
    }
  }
  return current;
}
