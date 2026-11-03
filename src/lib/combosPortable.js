// Portable combo export/import — secret-free by construction.
//
// Export carries only what a combo is: name, kind, model list, and its
// dashboard strategy (from settings.comboStrategies). It never contains
// connections, API keys, or any other settings, so a file can be shared
// between installs. Import validates the whole file before anything is
// written and rejects unknown fields plus any secret-like key anywhere
// (including inside strategy objects).

export const COMBO_EXPORT_VERSION = 1;

// Same rule as POST /api/combos: only a-z, A-Z, 0-9, -, _ and .
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// Keys that must never appear in an export/import file, at any depth.
const SECRET_KEY_PATTERN = /api[-_]?key|secret|token|password|authorization|cookie|credential/i;

const TOP_LEVEL_FIELDS = new Set(["version", "exportedAt", "combos", "mode"]);
const COMBO_FIELDS = new Set(["name", "kind", "models", "strategy"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Returns the offending dotted path, or null when clean.
function findSecretKey(value, path = "$") {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSecretKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (SECRET_KEY_PATTERN.test(key)) return `${path}.${key}`;
      const hit = findSecretKey(value[key], `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

function findUnknownField(obj, allowed, path = "$") {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) return `${path}.${key}`;
  }
  return null;
}

export function buildCombosExport(combos, strategies = {}) {
  return {
    version: COMBO_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    combos: (combos || []).map((combo) => {
      const out = {
        name: combo.name,
        kind: combo.kind ?? null,
        models: Array.isArray(combo.models) ? [...combo.models] : [],
      };
      const strategy = strategies?.[combo.name];
      if (isPlainObject(strategy)) out.strategy = { ...strategy };
      return out;
    }),
  };
}

// Aturan models yang sama dipakai POST/PUT/PATCH combo: undefined/null berarti
// "tidak diubah" (POST default ke []), selain itu wajib array string non-kosong
// — string polos yang lolos akan tersimpan sebagai JSON string dan merusak
// consumer yang mengira models selalu array.
export function isValidComboModels(models) {
  return (
    models === undefined ||
    models === null ||
    (Array.isArray(models) && models.every((m) => typeof m === "string" && !!m))
  );
}

// Validates a parsed import file. Returns { ok: true, mode, combos } or
// { ok: false, error }. Never throws on malformed input.
export function parseComboImportFile(body) {
  if (!isPlainObject(body)) {
    return { ok: false, error: "File import harus berupa objek JSON." };
  }
  const unknownTop = findUnknownField(body, TOP_LEVEL_FIELDS);
  if (unknownTop) {
    return { ok: false, error: `Field tidak dikenal: ${unknownTop}.` };
  }
  const secretPath = findSecretKey(body);
  if (secretPath) {
    return { ok: false, error: `File mengandung field sensitif (${secretPath}) — import ditolak.` };
  }
  const mode = body.mode ?? "merge";
  if (mode !== "merge" && mode !== "replace") {
    return { ok: false, error: "Mode harus \"merge\" atau \"replace\"." };
  }
  if (!Array.isArray(body.combos)) {
    return { ok: false, error: "Field \"combos\" harus berupa array." };
  }
  const seen = new Set();
  const combos = [];
  for (let i = 0; i < body.combos.length; i++) {
    const entry = body.combos[i];
    const at = `combos[${i}]`;
    if (!isPlainObject(entry)) {
      return { ok: false, error: `${at} harus berupa objek.` };
    }
    const unknown = findUnknownField(entry, COMBO_FIELDS, at);
    if (unknown) {
      return { ok: false, error: `Field tidak dikenal: ${unknown}.` };
    }
    if (typeof entry.name !== "string" || !VALID_NAME_REGEX.test(entry.name)) {
      return { ok: false, error: `${at}.name tidak valid (hanya huruf, angka, -, _ dan .).` };
    }
    if (seen.has(entry.name)) {
      return { ok: false, error: `Nama combo duplikat di file: ${entry.name}.` };
    }
    seen.add(entry.name);
    if (!Array.isArray(entry.models) || entry.models.some((m) => typeof m !== "string" || !m)) {
      return { ok: false, error: `${at}.models harus berupa array string.` };
    }
    if (entry.kind !== undefined && entry.kind !== null && typeof entry.kind !== "string") {
      return { ok: false, error: `${at}.kind harus berupa string atau null.` };
    }
    if (entry.strategy !== undefined && !isPlainObject(entry.strategy)) {
      return { ok: false, error: `${at}.strategy harus berupa objek.` };
    }
    combos.push({
      name: entry.name,
      kind: entry.kind ?? null,
      models: [...entry.models],
      ...(entry.strategy !== undefined ? { strategy: { ...entry.strategy } } : {}),
    });
  }
  return { ok: true, mode, combos };
}
