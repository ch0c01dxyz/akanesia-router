import { updateProviderConnection } from "@/lib/db/repos/connectionsRepo.js";
import { recordFailure } from "@/sse/services/quotaIncidents.js";
import { providerLogLabel } from "./providerLogLabel.js";

// Deteksi sinyal "akun di-suspend" dari respons upstream.
// Kriteria sengaja ketat: HANYA 403/423 yang bodynya menyebut "suspend".
// 401 (API key salah/kedaluwarsa) TIDAK termasuk — salah ketik key tidak
// boleh menonaktifkan akun.
export function isSuspensionSignal(status, message) {
  const code = Number(status);
  if (code !== 403 && code !== 423) return false;
  return /suspend/i.test(String(message || ""));
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
