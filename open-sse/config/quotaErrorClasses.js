/**
 * Klasifikasi error upstream untuk ide #4 "Fill-first sadar kuota".
 *
 * Fungsi pure: status HTTP + teks error → salah satu kelas error.
 * Klasifikasi ini HANYA mengatur pencatatan insiden & visibilitas dashboard;
 * TIDAK mengubah perilaku retry/fallback (itu tetap wewenang checkFallbackError
 * di accountFallback.js / ERROR_RULES di errorConfig.js).
 *
 * Urutan evaluasi selaras dengan ERROR_RULES (teks dulu, lalu status),
 * tetapi output-nya kelas error, bukan cooldown/backoff.
 */

// Kelas error yang dikenal. Nilai string dipakai sebagai error_class di DB.
export const ERROR_CLASSES = {
  RATE_LIMITED: "rate_limited",     // 429/503/504 — boleh retry, hitung counter
  OVERLOADED: "overloaded",        // 529; 429 yang menyebut upstream/overloaded — hitung counter
  QUOTA_EXHAUSTED: "quota_exhausted", // 402; 429 ber-body quota — langsung masuk dashboard
  AUTH_ERROR: "auth_error",        // 401; 403 bermasalah kredensial — langsung masuk dashboard
  POLICY_REFUSAL: "policy_refusal", // 403 content-policy / SAFETY block — tidak dihitung
  SERVER_ERROR: "server_error",    // 500/502 — hitung counter
  PAYLOAD_ERROR: "payload_error",  // 400/404/413/415/422 — tidak dihitung
  SUSPENDED: "suspended",        // 403/423 ber-body "suspend" — akun di-suspend; langsung masuk dashboard + picu auto-disable
  IGNORED: "ignored",              // 499 client closed — selalu diabaikan
  UNKNOWN: "unknown",              // status tak dikenal — netral, tidak dihitung
};

// Jumlah maksimum rule operator di settings.providerErrorRules.
export const MAX_PROVIDER_ERROR_RULES = 50;

const VALID_ERROR_CLASSES = new Set(Object.values(ERROR_CLASSES));

// Rule yang tersimpan di DB bisa tidak valid permanen — log tiap rule
// invalid cukup sekali supaya tidak spam console di setiap error upstream.
const invalidRuleWarned = new Set();
function warnInvalidRule(rule) {
  const key = JSON.stringify(rule);
  if (invalidRuleWarned.has(key)) return;
  invalidRuleWarned.add(key);
  console.warn(
    `[quota] providerErrorRules: rule tidak valid, dilewati (fail-open): ${key}. ` +
      `Bentuk valid: { provider, match, errorClass } dengan errorClass salah satu dari: ` +
      `${[...VALID_ERROR_CLASSES].join(", ")}`
  );
}

/**
 * Sanitasi rule operator dari settings.providerErrorRules (fail-open).
 * Bentuk rule valid: { provider, match, errorClass } —
 *   - provider: id provider (string non-kosong; harus sama persis dengan
 *     provider id yang dicatat di recordFailure, mis. "openai")
 *   - match: substring pada body error (string non-kosong; case-insensitive)
 *   - errorClass: salah satu nilai ERROR_CLASSES
 * Maksimal 50 rule; rule invalid dilewati dengan log, bukan crash.
 * @param {*} rules - nilai mentah settings.providerErrorRules
 * @returns {Array<{provider:string,match:string,errorClass:string}>}
 */
export function sanitizeProviderErrorRules(rules) {
  if (!Array.isArray(rules)) return [];
  const out = [];
  for (const rule of rules.slice(0, MAX_PROVIDER_ERROR_RULES)) {
    const provider = typeof rule?.provider === "string" ? rule.provider.trim() : "";
    const match = typeof rule?.match === "string" ? rule.match.trim().toLowerCase() : "";
    const errorClass = typeof rule?.errorClass === "string" ? rule.errorClass.trim() : "";
    if (!provider || !match || !VALID_ERROR_CLASSES.has(errorClass)) {
      warnInvalidRule(rule);
      continue;
    }
    out.push({ provider, match, errorClass });
  }
  return out;
}
// dipakai bila getSettings() belum punya nilainya).
export const QUOTA_DEFAULTS = {
  failureThreshold: 3, // quotaFailureThreshold: clamp 1–10
  maxFallbacks: 5,     // quotaMaxFallbacks: clamp min 1
  maxGlobalAttempts: 30, // maxGlobalAttempts: clamp 1–200
};

/**
 * Clamp threshold kegagalan (pola clamp-di-konsumsi).
 * @param {*} v - nilai mentah dari settings.quotaFailureThreshold
 * @returns {number} 1–10, default 3
 */
export function clampQuotaFailureThreshold(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return QUOTA_DEFAULTS.failureThreshold;
  return Math.min(10, Math.max(1, Math.floor(n)));
}

/**
 * Clamp batas fallback (pola clamp-di-konsumsi).
 * @param {*} v - nilai mentah dari settings.quotaMaxFallbacks
 * @returns {number} min 1, default 5
 */
export function clampQuotaMaxFallbacks(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return QUOTA_DEFAULTS.maxFallbacks;
  return Math.max(1, Math.floor(n));
}

/**
 * Clamp budget total percobaan combo per request (pola clamp-di-konsumsi,
 * port OmniRoute #11134). Hard cap 200 agar budget tak terbatas tidak
 * menyebabkan request background yang tak terkendali.
 * @param {*} v - nilai mentah dari settings.maxGlobalAttempts
 * @returns {number} 1–200, default 30
 */
export function clampMaxGlobalAttempts(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return QUOTA_DEFAULTS.maxGlobalAttempts;
  return Math.min(200, Math.max(1, Math.floor(n)));
}

/**
 * Aturan klasifikasi, dievaluasi berurutan (top-to-bottom).
 * Setiap aturan: { errorClass, status?, text? }
 *   - status: daftar kode HTTP yang cocok (bila ada, kode harus cocok)
 *   - text: daftar substring (case-insensitive) pada body error;
 *           cocok bila SALAH SATU substring muncul
 * Aturan teks dievaluasi sebelum aturan status murni (ala ERROR_RULES),
 * kecuali aturan yang mengikat keduanya (mis. overloaded ↔ 429).
 */
export const QUOTA_ERROR_CLASS_RULES = [
  // --- Aturan teks (spesifik, didahulukan) ---
  // Akun di-suspend: sinyal paling spesifik — didahulukan sebelum AUTH_ERROR.
  { errorClass: ERROR_CLASSES.SUSPENDED, status: [403, 423], text: ["suspend"] },
  // Kredensial bermasalah (401/403 dengan penanda body).
  { errorClass: ERROR_CLASSES.AUTH_ERROR, text: ["permission_denied", "entitlement", "invalid_api_key"] },
  // Penolakan kebijakan: content-policy / refusal / Gemini SAFETY block.
  { errorClass: ERROR_CLASSES.POLICY_REFUSAL, text: ["content_policy_violation", "refusal", "safety"] },
  // Kuota habis: 429 yang bodynya menyebut kuota.
  {
    errorClass: ERROR_CLASSES.QUOTA_EXHAUSTED,
    text: ["insufficient_quota", "quota_exceeded", "credit_balance_exhausted", "quota"],
  },
  // Overload: 429 yang menyebut upstream/overloaded (termasuk varian "slow down"
  // yang dikombinasikan dengan upstream, sehingga dicek sebelum rate_limited).
  { errorClass: ERROR_CLASSES.OVERLOADED, status: [429], text: ["overloaded", "upstream"] },
  // Rate limit murni: 429 ber-body rate-limit.
  {
    errorClass: ERROR_CLASSES.RATE_LIMITED,
    text: ["rate_limit_exceeded", "slow_down", "too many requests", "rate limit"],
  },

  // --- Aturan status (fallback bila teks tidak cocok) ---
  { errorClass: ERROR_CLASSES.RATE_LIMITED, status: [429, 503, 504] },
  { errorClass: ERROR_CLASSES.OVERLOADED, status: [529] },
  { errorClass: ERROR_CLASSES.QUOTA_EXHAUSTED, status: [402] },
  { errorClass: ERROR_CLASSES.AUTH_ERROR, status: [401, 403] },
  { errorClass: ERROR_CLASSES.SERVER_ERROR, status: [500, 502] },
  { errorClass: ERROR_CLASSES.PAYLOAD_ERROR, status: [400, 404, 413, 415, 422] },
];

// Nuansa OpenRouter: body error membawa "limit_source" dengan nilai yang
// menentukan arti sebenarnya dari error tersebut.
//   - openrouter_credits / openrouter_key_limit → kuota habis (jangan retry)
//   - in_flight_budget → rate limit biasa (boleh retry)
const LIMIT_SOURCE_QUOTA = new Set(["openrouter_credits", "openrouter_key_limit"]);
const LIMIT_SOURCE_RATE_LIMIT = new Set(["in_flight_budget"]);
const LIMIT_SOURCE_RE = /limit_source["'\s:=]+([a-z_]+)/i;

function matchOpenRouterLimitSource(lowerText) {
  const m = LIMIT_SOURCE_RE.exec(lowerText);
  if (!m) return null;
  const value = m[1].toLowerCase();
  if (LIMIT_SOURCE_QUOTA.has(value)) return ERROR_CLASSES.QUOTA_EXHAUSTED;
  if (LIMIT_SOURCE_RATE_LIMIT.has(value)) return ERROR_CLASSES.RATE_LIMITED;
  return null;
}

function ruleMatches(rule, statusCode, lowerText) {
  if (rule.status && !rule.status.includes(statusCode)) return false;
  if (rule.text && !rule.text.some((t) => lowerText.includes(t))) return false;
  return true;
}

/**
 * Klasifikasikan error upstream menjadi kelas error kuota.
 * Pure function — tanpa side effect, tanpa I/O.
 * @param {number|string} status - kode status HTTP upstream
 * @param {string} errorText - body/pesan error upstream
 * @param {object} [options]
 * @param {string} [options.provider] - id provider koneksi yang error
 * @param {Array} [options.rules] - rule mentah settings.providerErrorRules
 *   (disanitasi fail-open); dievaluasi SETELAH 499 tetapi SEBELUM aturan
 *   katalog — rule operator menang atas aturan bawaan.
 * @returns {string} salah satu nilai ERROR_CLASSES
 */
export function classifyQuotaError(status, errorText, options = {}) {
  const statusCode = Number(status);
  const lowerText = String(errorText ?? "").toLowerCase();

  // 499 (client closed request) selalu diabaikan — dievaluasi pertama, tanpa kecuali.
  if (statusCode === 499) return ERROR_CLASSES.IGNORED;

  // Rule operator (settings.providerErrorRules): operator bisa mendeklarasikan
  // klasifikasi per-provider tanpa patch katalog. Hanya berlaku bila provider
  // cocok persis dengan id provider koneksi yang error.
  if (options?.provider && options?.rules) {
    for (const rule of sanitizeProviderErrorRules(options.rules)) {
      if (rule.provider === options.provider && lowerText.includes(rule.match)) {
        return rule.errorClass;
      }
    }
  }

  // Nuansa OpenRouter limit_source: sinyal paling presisi, didahulukan
  // sebelum aturan generik.
  const limitSourceClass = matchOpenRouterLimitSource(lowerText);
  if (limitSourceClass) return limitSourceClass;

  for (const rule of QUOTA_ERROR_CLASS_RULES) {
    if (ruleMatches(rule, statusCode, lowerText)) return rule.errorClass;
  }

  // Status tidak dikenal → netral (tidak dihitung counter-nya).
  return ERROR_CLASSES.UNKNOWN;
}
