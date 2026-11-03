/**
 * Buffer replay request (ide #7) — ring buffer in-memory untuk request
 * upstream yang GAGAL, agar bisa di-debug/di-replay dari dashboard.
 *
 * - TIDAK di-persist (hilang saat restart); singleton globalThis HMR-safe.
 * - Kapasitas berbasis byte (default dari setting `replayLogMaxBytes`);
 *   entry lama dibuang otomatis (drop-oldest), buffer tidak pernah
 *   melewati batas.
 * - REDAKSI saat capture (fail-closed, syarat wajib RULES.md):
 *   header sensitif -> "[REDACTED]", key JSON sensitif (rekursif) ->
 *   "[REDACTED]", query param URL yang sensitif -> "[REDACTED]".
 * - Modul ini murni/sinkron dan tidak boleh throw: capture() selalu
 *   mengembalikan entry atau null, tidak pernah mengganggu request.
 */

const G = globalThis;
const KEY = "__9router_replayBuffer__";

export const REDACTED = "[REDACTED]";

// Batas default — diselaraskan dengan settingsRepo (replayLogMaxBytes).
export const REPLAY_DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
// Truncate request body (spesifikasi: ~64 KB).
export const REPLAY_BODY_MAX_CHARS = 64 * 1024;
// Truncate teks response/error yang disimpan.
export const REPLAY_RESPONSE_MAX_CHARS = 8 * 1024;

// Header yang value-nya tidak boleh masuk buffer (case-insensitive).
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "proxy-authorization",
]);

// Key JSON yang value-nya di-redact (case-insensitive, rekursif).
// Termasuk "api_key"/"apikey" agar kriteria terima terpenuhi.
const SENSITIVE_BODY_KEYS = new Set([
  "password",
  "secret",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "client_secret",
]);

// Nama query param URL yang value-nya di-redact untuk tampilan.
const SENSITIVE_QUERY_PATTERN = /(key|token|secret|auth|signature|password)/i;

// Batas kedalaman rekursi redaksi agar body jahat tidak menyebabkan stack overflow.
const MAX_REDACT_DEPTH = 12;

function ambilState() {
  if (!G[KEY]) {
    G[KEY] = {
      entri: [], // [{ entry, bytes }] — urutan kronologis (terlama dulu)
      bytesTerpakai: 0,
      maxBytes: REPLAY_DEFAULT_MAX_BYTES,
    };
  }
  return G[KEY];
}

/**
 * Redaksi header: salin objek, value header sensitif -> "[REDACTED]".
 * Case-insensitive terhadap nama header. Aman untuk input non-objek.
 */
export function redactHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const hasil = {};
  for (const [nama, value] of Object.entries(headers)) {
    hasil[nama] = SENSITIVE_HEADERS.has(String(nama).toLowerCase())
      || /api[-_]?key|token|secret|password/i.test(nama) ? REDACTED : value;
  }
  return hasil;
}

/**
 * Redaksi rekursif untuk object/array hasil JSON.parse.
 * Key yang sensitif (case-insensitive) -> "[REDACTED]".
 */
export function redactJsonValue(value, depth = 0) {
  if (depth > MAX_REDACT_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactJsonValue(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const hasil = {};
    for (const [k, v] of Object.entries(value)) {
      hasil[k] = SENSITIVE_BODY_KEYS.has(String(k).toLowerCase())
        ? REDACTED
        : redactJsonValue(v, depth + 1);
    }
    return hasil;
  }
  return value;
}

/**
 * Redaksi body menjadi STRING siap simpan.
 * - Objek -> JSON.stringify setelah redaksi rekursif.
 * - String JSON valid -> parse, redact, stringify ulang.
 * - String non-JSON -> best-effort regex untuk pola "key": "value" / key=value
 *   dengan key sensitif (fail-closed: lebih baik redact berlebih).
 * - Nilai lain -> String(value).
 */
export function redactBody(body) {
  if (body === null || body === undefined) return "";
  if (typeof body === "object") {
    try {
      return JSON.stringify(redactJsonValue(body));
    } catch {
      return REDACTED;
    }
  }
  const teks = String(body);
  const potongan = teks.slice(0, REPLAY_BODY_MAX_CHARS + 1024);
  try {
    const parsed = JSON.parse(potongan);
    return JSON.stringify(redactJsonValue(parsed));
  } catch {
    // Bukan JSON: redact pola "key": value dan key=value untuk key sensitif.
    const pola = new RegExp(
      `(["']?(?:${[...SENSITIVE_BODY_KEYS].join("|")})["']?\\s*[:=]\\s*)(["']?)[^"'\\s,}]+\\2`,
      "gi"
    );
    return potongan.replace(pola, `$1$2${REDACTED}$2`);
  }
}

/**
 * Redaksi URL untuk tampilan: value query param yang namanya sensitif
 * (mis. ?key=, ?token=) -> "[REDACTED]". Path tetap utuh.
 */
export function redactUrl(url) {
  if (!url || typeof url !== "string") return "";
  const redactParams = (u) => {
    for (const nama of [...u.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PATTERN.test(nama)) u.searchParams.set(nama, REDACTED);
    }
    // URLSearchParams meng-encode "[REDACTED]" -> %5BREDACTED%5D; kembalikan
    // ke bentuk literal agar enak dibaca di UI.
    return u.toString().replace(/%5bredacted%5d/gi, REDACTED);
  };
  try {
    return redactParams(new URL(url));
  } catch {
    // Bukan URL absolut.
  }
  // URL relatif ber-query (mis. "/v1/chat?key=..."): parse dengan base dummy
  // agar query param sensitif tetap di-redact; base dibuang dari hasil.
  if (url.includes("?")) {
    try {
      return redactParams(new URL(url, "http://localhost")).replace(/^http:\/\/localhost/, "");
    } catch {
      // abaikan, lanjut ke fallback manual
    }
  }
  // Bukan URL sama sekali: redact pola query manual (fail-closed).
  return url
    .slice(0, 2048)
    .replace(/([?&][^=&#]*(?:key|token|secret|auth|signature|password)[^=&#]*=)[^&#]*/gi, `$1${REDACTED}`);
}

// Panjang minimum agar tidak me-redact string umum yang pendek;
// API key/token praktis selalu jauh lebih panjang dari ini.
const MIN_SECRET_LENGTH = 8;

/**
 * Kumpulkan nilai secret dari objek credentials: apiKey, token OAuth,
 * dan value custom header (ide #8). Murni traversal — tidak menyimpan
 * apa pun. Dipakai untuk me-redact secret yang muncul di free-text
 * (isi pesan / response upstream yang menggemakan key).
 */
export function kumpulkanSecretValues(credentials) {
  const c = credentials || {};
  const vals = [];
  for (const k of ["apiKey", "accessToken", "refreshToken", "idToken", "copilotToken"]) {
    if (typeof c[k] === "string" && c[k].length >= MIN_SECRET_LENGTH) vals.push(c[k]);
  }
  const ch = c?.providerSpecificData?.customHeaders;
  if (Array.isArray(ch)) {
    for (const h of ch) {
      const v = h?.value;
      if (typeof v === "string" && v.length >= MIN_SECRET_LENGTH) vals.push(v);
    }
  }
  return [...new Set(vals)];
}

/**
 * Ganti semua kemunculan nilai secret dengan "[REDACTED]".
 * Memakai split/join (tanpa regex) agar aman untuk karakter khusus.
 * Fail-closed: lebih baik redact berlebih daripada bocor.
 */
export function redactSecretValues(teks, secretValues) {
  let hasil = teks === null || teks === undefined ? "" : String(teks);
  if (!Array.isArray(secretValues)) return hasil;
  for (const s of secretValues) {
    if (typeof s !== "string" || s.length < MIN_SECRET_LENGTH) continue;
    if (hasil.includes(s)) hasil = hasil.split(s).join(REDACTED);
  }
  return hasil;
}

/**
 * Potong teks ke maxChars. Mengembalikan { text, truncated }.
 */
export function truncateText(teks, maxChars) {
  const s = teks === null || teks === undefined ? "" : String(teks);
  if (s.length <= maxChars) return { text: s, truncated: false };
  return { text: s.slice(0, maxChars), truncated: true };
}

/** Perkiraan ukuran byte string (UTF-8). */
export function estimateBytes(str) {
  try {
    return new TextEncoder().encode(str).length;
  } catch {
    return String(str).length;
  }
}

function buatId() {
  return `rpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Simpan satu entry request gagal ke buffer. TIDAK PERNAH throw
 * (mengembalikan entry, atau null bila input tidak valid/gagal).
 *
 * @param {object} input
 * @param {string} input.provider
 * @param {string} input.model
 * @param {string} [input.connectionId]
 * @param {string} [input.method] - default "POST"
 * @param {string} [input.url] - URL upstream (di-redact untuk tampilan)
 * @param {number} [input.status]
 * @param {number} [input.latencyMs]
 * @param {object} [input.requestHeaders] - header upstream (di-redact)
 * @param {any} input.requestBody - body provider-format (di-redact + truncate)
 * @param {string} [input.responseText] - teks response/error (di-redact + truncate;
 *   upstream bisa menggemakan request, jadi diperlakukan sama seperti body)
 * @param {string} [input.error] - pesan error (di-redact + truncate)
 * @param {string} [input.errorOrigin] - asal error: "provider" (server LLM
 *   mengembalikan HTTP error) atau "gateway" (akanesia-router gagal
 *   mendapatkan respons: network error, connect timeout, dsb.)
 * @param {string[]} [input.secretValues] - nilai secret aktual dari credentials
 *   (tidak pernah disimpan; hanya dipakai me-redact kemunculan di free-text)
 */
export function captureReplayEntry(input) {
  try {
    if (!input || typeof input !== "object") return null;
    const state = ambilState();
    const secretValues = Array.isArray(input.secretValues) ? input.secretValues : [];

    const bodyRedacted = redactSecretValues(redactBody(input.requestBody), secretValues);
    const bodyPotong = truncateText(bodyRedacted, REPLAY_BODY_MAX_CHARS);
    // Batas mentah sebelum redaksi agar regex tidak bekerja pada teks raksasa.
    const responsMentah = String(input.responseText || input.error || "").slice(0, REPLAY_RESPONSE_MAX_CHARS * 4);
    const responsPotong = truncateText(redactSecretValues(redactBody(responsMentah), secretValues), REPLAY_RESPONSE_MAX_CHARS);

    const entry = {
      id: buatId(),
      ts: Date.now(),
      provider: String(input.provider || ""),
      model: String(input.model || ""),
      connectionId: String(input.connectionId || ""),
      method: String(input.method || "POST"),
      url: redactSecretValues(redactUrl(input.url), secretValues),
      status: Number(input.status) || 0,
      // Asal error untuk identifikasi: "provider" = server LLM yang
      // mengembalikan error; "gateway" = akanesia-router yang gagal
      // mendapatkan respons. "unknown" untuk entry lama.
      errorOrigin: input.errorOrigin === "provider" || input.errorOrigin === "gateway"
        ? input.errorOrigin
        : "unknown",
      latencyMs: Number(input.latencyMs) || 0,
      requestHeaders: redactHeaders(input.requestHeaders),
      requestBody: bodyPotong.text,
      requestBodyTruncated: bodyPotong.truncated,
      responseText: responsPotong.text,
      responseTruncated: responsPotong.truncated,
      error: input.error ? truncateText(redactSecretValues(redactBody(input.error), secretValues), 2048).text : null,
    };

    const bytes = estimateBytes(JSON.stringify(entry));
    state.entri.push({ entry, bytes });
    state.bytesTerpakai += bytes;

    // Drop-oldest: buang entry terlama sampai di bawah batas.
    while (state.entri.length > 0 && state.bytesTerpakai > state.maxBytes) {
      const lama = state.entri.shift();
      state.bytesTerpakai -= lama.bytes;
      if (state.bytesTerpakai < 0) state.bytesTerpakai = 0;
    }

    return entry;
  } catch {
    return null;
  }
}

/** Daftar entry, terbaru dulu. Mengembalikan salinan (tidak bisa mutasi state). */
export function listReplayEntries() {
  const state = ambilState();
  return state.entri.map((e) => e.entry).reverse();
}

/** Ambil satu entry by id, atau null. */
export function getReplayEntry(id) {
  if (!id) return null;
  const state = ambilState();
  const ketemu = state.entri.find((e) => e.entry.id === id);
  return ketemu ? ketemu.entry : null;
}

/** Kosongkan buffer. */
export function clearReplayLog() {
  const state = ambilState();
  state.entri = [];
  state.bytesTerpakai = 0;
}

/**
 * Ubah batas byte buffer (dipanggil saat setting replayLogMaxBytes dibaca/
 * diubah). Nilai tidak valid diabaikan. Buffer langsung di-trim bila
 * melebihi batas baru.
 */
export function setReplayMaxBytes(n) {
  const state = ambilState();
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return state.maxBytes;
  state.maxBytes = Math.floor(v);
  while (state.entri.length > 0 && state.bytesTerpakai > state.maxBytes) {
    const lama = state.entri.shift();
    state.bytesTerpakai -= lama.bytes;
    if (state.bytesTerpakai < 0) state.bytesTerpakai = 0;
  }
  return state.maxBytes;
}

/** Statistik buffer untuk UI (pemakaian vs batas). */
export function getReplayStats() {
  const state = ambilState();
  return {
    count: state.entri.length,
    bytesUsed: state.bytesTerpakai,
    maxBytes: state.maxBytes,
  };
}
