import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";
const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  quotaVisibility: {},
  // Ambang kegagalan beruntun sebelum sebuah insiden kuota/error ditampilkan di
  // dashboard "Insiden Kuota & Error" (rentang valid 1–10; validasi di titik konsumsi).
  // Catatan: ini hanya mengatur VISIBILITAS dashboard — koneksi tidak diblokir/dilewati.
  quotaFailureThreshold: 3,
  // Batas kedalaman fallback dalam satu request: jumlah maksimum koneksi/model
  // cadangan yang dicoba sebelum request dinyatakan gagal.
  quotaMaxFallbacks: 5,
  // TTL cache hasil "Check Models" (detik). 0 = cache mati total (bypass).
  checkModelsTtlSeconds: 3600,
  // Auto-disable akun yang terdeteksi suspend dari tombol "Check Models"
  // (403/423 + body "suspend"). Default OFF — hanya aktif bila pengguna
  // menyalakan toggle di Dashboard > Endpoint & Key > Insiden Kuota & Error.
  // (Auto-disable dari jalur chat & Kiro models discovery selalu aktif.)
  suspendAutoDisableOnCheck: false,
  // Daftar providerId yang Auto Sync-nya ON (ide #6): modelnya di-refresh
  // otomatis tiap interval checkModelsTtlSeconds oleh scheduler server.
  autoSyncProviderIds: [],
  // Kapasitas maksimum buffer Replay request (byte). Entry lama dibuang
  // otomatis (drop-oldest); default 5 MB (ide #7).
  replayLogMaxBytes: 5 * 1024 * 1024,
  // Warming koneksi fill-first (ide #2): ping ringan provider aktif setelah
  // server listen agar request pertama tidak membayar penalti TLS penuh.
  // Default ON; OFF = tidak ada traffic warmup sama sekali.
  fillFirstWarmupEnabled: true,
  // Probe identitas model / LLM fingerprinting (ide #5c).
  probeEnabled: true,
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  capacityAdapter: {
    vision: { enabled: true, roundRobin: false, models: [] },
    pdf: { enabled: false, roundRobin: false, models: [] },
    audioInput: { enabled: true, roundRobin: false, models: [] },
    videoInput: { enabled: false, roundRobin: false, models: [] },
  },
  requireLogin: true,
  requireApiKey: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  ssoType: "oidc",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  samlEntryPoint: "",
  samlIssuer: "urn:9router:sp",
  samlCert: "",
  samlLoginLabel: "Sign in with SAML SSO",
  samlAttributeEmail: "email",
  samlAttributeName: "name",
  enableObservability: false,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {},
  rtkEnabled: true,
  headroomEnabled: false,
  headroomUrl: DEFAULT_HEADROOM_URL,
  headroomCompressUserMessages: false,
  headroomTimeoutMs: 3000,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
  // Override header per-provider dari user, diterapkan saat dispatch:
  // { [providerId]: { headers: {..} } }. Berdampingan dengan custom header
  // per-node ide #8 (level koneksi) — lihat urutan merge di base.js execute().
  providerOverrides: {},
  // Override jeda retry rate-limit per-provider (detik), diatur dari halaman
  // detail provider. { [providerId]: seconds }. Provider tanpa entri memakai
  // backoff mesin yang sudah ada (tidak berubah). Diterapkan di
  // markAccountUnavailable hanya bila upstream tidak memberi hint reset
  // yang presisi (tidak menimpa resetAt GitHub/Antigravity).
  providerRetryDelaySeconds: {},
  // Kurasi model yang diiklankan di /v1/models (exact match pada id penuh,
  // mis. "openai/gpt-4o" atau nama combo). Allowlist non-kosong -> hanya yang
  // terdaftar yang tampil; denylist selalu mengecualikan (menang atas
  // allowlist). Diatur via PATCH /api/settings.
  modelVisibilityAllowlist: [],
  modelVisibilityDenylist: [],
};

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

// Merge raw settings with defaults; backward-compat for missing keys
export function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  if (merged.capacityAdapter && typeof merged.capacityAdapter === "object") {
    for (const capKey of Object.keys(merged.capacityAdapter)) {
      const entry = merged.capacityAdapter[capKey];
      if (Array.isArray(entry?.models)) {
        entry.models = entry.models.map((m) =>
          m === "oc/mimo-v2.5-free" ? "oc/mimo-v2.6-flash-free" : m
        );
      }
    }
  }
  return merged;
}

export async function getSettings() {
  const raw = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(function () {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = { ...current, ...updates };
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)],
    );
  });
  return mergeWithDefaults(next);
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings() {
  return await readRaw();
}
