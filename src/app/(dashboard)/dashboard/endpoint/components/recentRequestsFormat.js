import { AI_PROVIDERS } from "@/shared/constants/providers";

/**
 * Format ISO timestamp menjadi label relatif Bahasa Indonesia.
 * Contoh: "baru saja", "45 dtk lalu", "3 mnt lalu", "2 jam lalu", "5 hari lalu".
 */
export function formatRelativeTime(timestamp) {
  const time = new Date(timestamp).getTime();
  const diffMs = Date.now() - time;
  if (Number.isNaN(time) || diffMs < 0) return "—";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return "baru saja";
  if (seconds < 60) return `${seconds} dtk lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

/**
 * Kelas warna dot status request (ditulis literal agar terdeteksi Tailwind).
 * Nilai status yang disimpan: "success" | "error".
 */
export function requestStatusClass(status) {
  if (status === "success") return "bg-green-500";
  if (status === "error") return "bg-red-500";
  return "bg-gray-500";
}

/**
 * Label status request dalam Bahasa Indonesia.
 */
export function requestStatusLabel(status) {
  if (status === "success") return "Sukses";
  if (status === "error") return "Gagal";
  return status || "—";
}

/**
 * Nama provider yang terbaca manusia, mengikuti hierarki §8 codebase-map:
 * nama koneksi (dari /api/providers) > nama AI_PROVIDERS > id mentah.
 */
export function providerLabel(providerId, nameMap = {}) {
  if (nameMap[providerId]) return nameMap[providerId];
  return AI_PROVIDERS[providerId]?.name || providerId || "—";
}
