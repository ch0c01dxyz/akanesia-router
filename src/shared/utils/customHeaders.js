// Custom headers per provider node — ide #8 "Advanced Option".
// Dipakai oleh: API provider-nodes (validasi), DefaultExecutor (apply saat
// build request), dan validate route. File ini murni (tanpa secret handling)
// agar aman di-import dari client maupun server.

// Nama header mengikuti RFC 7230 token (ASCII, tanpa spasi/colon).
export const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
export const CUSTOM_HEADERS_MAX = 20;
export const CUSTOM_HEADER_VALUE_MAX = 4096;
// Placeholder di value yang diganti dengan API key koneksi saat request.
export const CUSTOM_HEADER_KEY_PLACEHOLDER = "{{key}}";

/**
 * Validasi + normalisasi array customHeaders dari input user/API.
 * @returns {{ headers: Array<{name,value}> } | { error: string }}
 */
export function sanitizeCustomHeaders(input) {
  if (input == null) return { headers: [] };
  if (!Array.isArray(input)) return { error: "customHeaders harus berupa array" };
  if (input.length > CUSTOM_HEADERS_MAX) {
    return { error: `Maksimal ${CUSTOM_HEADERS_MAX} custom header` };
  }
  const out = [];
  const seen = new Set();
  for (const h of input) {
    const name = typeof h?.name === "string" ? h.name.trim() : "";
    const value = typeof h?.value === "string" ? h.value : "";
    if (!name && !value) continue; // baris kosong → lewati
    if (!HEADER_NAME_RE.test(name)) {
      return { error: `Nama header tidak valid: "${name}"` };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) return { error: `Header duplikat: "${name}"` };
    seen.add(key);
    if (value.length > CUSTOM_HEADER_VALUE_MAX) {
      return { error: `Value header "${name}" terlalu panjang` };
    }
    out.push({ name, value });
  }
  return { headers: out };
}

/**
 * Ambil daftar nama custom header dari credentials (providerSpecificData).
 * @returns {string[]}
 */
export function getCustomHeaderNames(credentials) {
  const list = credentials?.providerSpecificData?.customHeaders;
  if (!Array.isArray(list)) return [];
  return list
    .map((h) => (typeof h?.name === "string" ? h.name.trim() : ""))
    .filter(Boolean);
}

/**
 * Terapkan custom headers ke objek headers. Dijalankan SETELAH header default
 * 9router (termasuk auth), sehingga custom MENANG jika nama sama.
 * Placeholder {{key}} diganti dengan API key / access token koneksi.
 * @returns {string[]} nama header yang diterapkan (untuk redaksi log)
 */
export function applyCustomHeaders(headers, credentials) {
  const list = credentials?.providerSpecificData?.customHeaders;
  if (!headers || !Array.isArray(list) || list.length === 0) return [];
  const token = credentials?.apiKey || credentials?.accessToken || "";
  const applied = [];
  for (const h of list) {
    const name = typeof h?.name === "string" ? h.name.trim() : "";
    if (!name) continue;
    const value = String(h?.value ?? "").split(CUSTOM_HEADER_KEY_PLACEHOLDER).join(token);
    headers[name] = value;
    applied.push(name);
  }
  return applied;
}

/**
 * Redaksi value custom header untuk log — jangan pernah bocorkan secret.
 * Mengembalikan objek headers baru; headers asli tidak diubah.
 */
export function redactCustomHeaders(headers, credentialsOrNames) {
  if (!headers || typeof headers !== "object") return headers;
  const names = Array.isArray(credentialsOrNames)
    ? credentialsOrNames
    : getCustomHeaderNames(credentialsOrNames);
  if (names.length === 0) return headers;
  const lower = new Set(names.map((n) => String(n).toLowerCase()));
  const out = { ...headers };
  for (const key of Object.keys(out)) {
    if (lower.has(key.toLowerCase())) out[key] = "[REDACTED]";
  }
  return out;
}
