import { AI_PROVIDERS } from "@/shared/constants/providers";

// Nama tampilan provider yang terbaca manusia.
// Prioritas: nama koneksi > nama di AI_PROVIDERS > id mentah.
// Provider kompatibel dinamis (openai-compatible-*<uuid>) tidak punya nama
// di AI_PROVIDERS, sehingga nama koneksi adalah yang paling bermakna.
export function providerDisplayName(providerId, connection) {
  return connection?.name || AI_PROVIDERS[providerId]?.name || providerId || "—";
}

// Tambahkan field providerName pada tiap item (insiden, replay entry, ...)
// berdasarkan connectionId-nya. Fail-open: bila daftar koneksi tak tersedia,
// providerName fallback ke nama AI_PROVIDERS / id mentah.
export function enrichWithProviderName(items, connections, { idKey = "connectionId" } = {}) {
  const connById = new Map((connections || []).map((c) => [c?.id, c]));
  return (items || []).map((item) => ({
    ...item,
    providerName: providerDisplayName(item?.provider, connById.get(item?.[idKey])),
  }));
}
