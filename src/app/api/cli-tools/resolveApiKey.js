/**
 * Menentukan API key yang ditulis ke konfigurasi CLI tool.
 *
 * Kartu CLI tool mengirim string kosong saat tidak ada key yang dipilih
 * secara eksplisit (mis. konfigurasi yang ada sudah punya blok provider tapi
 * frontend tidak bisa membaca kembali header Authorization yang tersimpan).
 * Route-route sebelumnya memakai fallback literal "sk_9router" yang
 * menyebabkan 401 "Invalid API key" untuk deployment dengan
 * requireApiKey=true.
 *
 * Urutan resolusi:
 *   1. Key dari pemanggil (string non-kosong).
 *   2. Key aktif pertama di tabel apiKeys dashboard.
 *   3. String kosong — route tidak menulis nilai header Authorization,
 *      yang tidak masalah untuk deployment requireApiKey=false.
 *
 * Placeholder "sk_9router" TIDAK PERNAH ditulis; itu bukan key asli.
 */

import { getApiKeys } from "@/lib/db";

/**
 * @param {string|null|undefined} callerKey Key yang dikirim frontend.
 * @returns {Promise<string>}
 */
export async function resolveCliApiKey(callerKey) {
  if (callerKey && callerKey.trim() && callerKey.trim() !== "sk_9router") {
    return callerKey.trim();
  }
  try {
    const keys = await getApiKeys();
    const active = keys.find((k) => k.isActive);
    return active?.key || "";
  } catch {
    return "";
  }
}
