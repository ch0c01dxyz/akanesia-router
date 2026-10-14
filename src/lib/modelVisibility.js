// Kurasi model yang diiklankan di /v1/models (dan semua daftar turunan yang
// memakai buildModelsList). Combo adalah entri list biasa dengan id = nama
// combo, jadi kandidat combo difilter oleh helper yang sama — tidak ada
// duplikasi logika.
//
// Semantik (exact match pada id penuh, mis. "openai/gpt-4o" atau nama combo):
// - allowlist non-kosong  -> hanya id yang terdaftar yang tampil
// - denylist              -> selalu mengecualikan, menang atas allowlist
// - keduanya kosong       -> semua lolos (default, tanpa filter)

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v !== "");
}

export function filterModelsByVisibility(models, settings) {
  const allow = new Set(normalizeIdList(settings?.modelVisibilityAllowlist));
  const deny = new Set(normalizeIdList(settings?.modelVisibilityDenylist));
  if (allow.size === 0 && deny.size === 0) return models;
  return (models || []).filter((m) => {
    const id = m?.id;
    if (typeof id !== "string" || deny.has(id)) return false;
    return allow.size === 0 || allow.has(id);
  });
}
