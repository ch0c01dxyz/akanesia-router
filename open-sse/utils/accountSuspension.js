import { getProviderConnectionById, updateProviderConnection } from "@/lib/db/repos/connectionsRepo.js";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { recordFailure } from "@/sse/services/quotaIncidents.js";
import { providerLogLabel } from "./providerLogLabel.js";

// Deteksi sinyal "akun di-suspend" dari respons upstream.
// Kriteria sengaja ketat: HANYA 403/423 yang bodynya menyebut "suspend".
// 401 (API key salah/kedaluwarsa) TIDAK termasuk — salah ketik key tidak
// boleh menonaktifkan akun.
// CATATAN: detektor belum membedakan "banned" permanen vs "suspend";
// sinyal "banned" dari upstream saat ini tidak terdeteksi (out of scope).
export function isSuspensionSignal(status, message) {
  const code = Number(status);
  if (code !== 403 && code !== 423) return false;
  return /suspend/i.test(String(message || ""));
}

// Cakupan auto-disable (settings.autoDisableBannedScope, port OmniRoute #10617):
// - "all" (default): semua koneksi yang kena sinyal suspend dinonaktifkan (perilaku lama).
// - "oauth-only": hanya koneksi akun subscription/OAuth; koneksi API key prepaid
//   tetap aktif di pool routing (operator mem-failover manual via insiden dashboard).
export const AUTO_DISABLE_BANNED_SCOPES = ["all", "oauth-only"];

export function normalizeAutoDisableBannedScope(value) {
  return value === "oauth-only" ? "oauth-only" : "all";
}

// authType koneksi yang punya "kursi login" subscription/OAuth (bisa di-lock
// upstream) — bedakan dari API key prepaid ("apikey").
const SUBSCRIPTION_AUTH_TYPES = new Set(["oauth", "access_token", "cookie"]);

export function isSubscriptionStyleAuthType(authType) {
  return SUBSCRIPTION_AUTH_TYPES.has(String(authType || "").trim().toLowerCase());
}

// Pure: bolehkah auto-disable untuk scope + authType ini?
// authType tak dikenal → konservatif (ikut perilaku lama: tetap disable).
export function shouldAutoDisableForScope({ scope, authType }) {
  if (normalizeAutoDisableBannedScope(scope) === "all") return true;
  if (authType == null || String(authType).trim() === "") return true;
  return isSubscriptionStyleAuthType(authType);
}

// Baca scope dari settings + authType koneksi dari DB; semuanya fail-open:
// gagal baca → fallback "all" (perilaku lama), tidak pernah throw.
async function scopeAllowsDisable(connectionId, log) {
  let scope = "all";
  try {
    scope = normalizeAutoDisableBannedScope((await getSettings())?.autoDisableBannedScope);
  } catch {
    // abaikan — fallback "all"
  }
  if (scope === "all") return true;
  let authType;
  try {
    authType = (await getProviderConnectionById(connectionId))?.authType;
  } catch {
    // abaikan — authType tak dikenal = konservatif (tetap disable)
  }
  const allowed = shouldAutoDisableForScope({ scope, authType });
  if (!allowed) {
    try {
      log?.errorLine?.(
        "",
        "⏭️",
        `Auto-disable dilewati — koneksi "${connectionId}" memakai API key prepaid (autoDisableBannedScope=oauth-only).`
      );
    } catch {
      // abaikan — logging tidak boleh mengganggu
    }
  }
  return allowed;
}

// Nonaktifkan otomatis koneksi yang terdeteksi suspend.
// - Set isActive=false di DB (fail-open: gagal DB → false, tidak throw)
// - Catat insiden errorClass "suspended" agar muncul di dashboard
//   (Endpoint & Key > Insiden Kuota & Error)
// - Log keras ke terminal agar terlihat di PowerShell/CMD
// Mengembalikan true bila koneksi dinonaktifkan.
export async function autoDisableSuspendedAccount({
  connectionId,
  provider,
  model,
  status,
  message,
  credentials,
  log,
}) {
  if (!connectionId || !isSuspensionSignal(status, message)) return false;

  // Hormati cakupan auto-disable (autoDisableBannedScope): "oauth-only"
  // melewatkan koneksi API key prepaid. Fail-open.
  if (!(await scopeAllowsDisable(connectionId, log))) return false;

  let disabled = false;
  try {
    const updated = await updateProviderConnection(connectionId, { isActive: false });
    disabled = !!(updated && updated.isActive === false);
  } catch {
    return false;
  }
  if (!disabled) return false;

  const label = providerLogLabel(provider, credentials);
  const line = `AKUN DI-SUSPEND — koneksi "${credentials?.connectionName || connectionId}" (${label}${model ? `/${model}` : ""}) dinonaktifkan otomatis (upstream ${status}). Aktifkan kembali manual setelah akun dipulihkan.`;
  try {
    if (log?.errorLine) log.errorLine("", "⛔", line);
    else console.warn(`[SUSPEND] ${line}`);
  } catch {
    // abaikan — logging tidak boleh mengganggu
  }

  // Catat insiden (fail-open).
  try {
    await recordFailure({
      connectionId,
      model,
      provider,
      status,
      errorText: String(message || "").slice(0, 500),
    });
  } catch {
    // abaikan
  }
  return true;
}
