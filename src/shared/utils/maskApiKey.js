// Masker satu arah untuk API key gateway: hanya awal/akhir yang terlihat
// agar key bisa dikenali tanpa membocorkan nilainya. Murni, tanpa dependensi.

export function maskApiKey(fullKey) {
  if (!fullKey || fullKey.length <= 10) return fullKey || "";
  return fullKey.slice(0, 6) + "•".repeat(fullKey.length - 10) + fullKey.slice(-4);
}
