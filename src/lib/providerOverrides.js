// Validasi override header per-provider — dipakai di trust boundary.
// Satu sumber kebenaran agar PATCH /api/settings tidak bisa mem-bypass
// blocked list yang ditegakkan PUT /api/providers/[id]/overrides.

const MAX_HEADERS = 20;
const MAX_HEADER_VALUE_LENGTH = 8192;
// Subset token RFC 7230: huruf, digit, hyphen (tanpa spasi, tanpa unicode)
const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;

// Header struktur request / auth yang tidak boleh di-override user.
// Authorization/Cookie dijaga agar override tidak menimpa kredensial koneksi.
export const BLOCKED_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "connection",
  "transfer-encoding",
  "authorization",
  "cookie",
]);

/**
 * Validasi + normalisasi satu entry override { headers }.
 * Mengembalikan { override } atau { error }.
 * Override tanpa header dinormalisasi menjadi null (= hapus).
 */
export function normalizeProviderOverride({ headers }) {
  const out = {};

  if (headers !== undefined && headers !== null) {
    if (typeof headers !== "object" || Array.isArray(headers)) {
      return { error: "headers harus berupa object" };
    }
    const entries = Object.entries(headers).filter(([, v]) => v !== "" && v != null);
    if (entries.length > MAX_HEADERS) {
      return { error: `Terlalu banyak header (maks ${MAX_HEADERS})` };
    }
    const clean = {};
    for (const [name, value] of entries) {
      if (!HEADER_NAME_RE.test(name)) {
        return { error: `Nama header tidak valid: ${name}` };
      }
      if (typeof value !== "string" || /[\r\n]/.test(value)) {
        return { error: `Value tidak valid untuk header ${name}` };
      }
      if (value.length > MAX_HEADER_VALUE_LENGTH) {
        return { error: `Value header ${name} terlalu panjang (maks ${MAX_HEADER_VALUE_LENGTH})` };
      }
      if (BLOCKED_HEADERS.has(name.toLowerCase())) {
        return { error: `Header ${name} tidak boleh di-override` };
      }
      clean[name] = value;
    }
    if (Object.keys(clean).length) out.headers = clean;
  }

  return { override: Object.keys(out).length ? out : null };
}

/**
 * Validasi seluruh map providerOverrides { [providerId]: { headers } }.
 * Mengembalikan { overrides } (ternormalisasi) atau { error }.
 */
export function normalizeProviderOverridesMap(map) {
  if (map === undefined || map === null) return { overrides: map };
  if (typeof map !== "object" || Array.isArray(map)) {
    return { error: "providerOverrides harus berupa object" };
  }
  const out = {};
  for (const [providerId, entry] of Object.entries(map)) {
    if (entry === null) {
      out[providerId] = null;
      continue;
    }
    const { override, error } = normalizeProviderOverride(entry || {});
    if (error) return { error: `provider ${providerId}: ${error}` };
    out[providerId] = override;
  }
  return { overrides: out };
}
