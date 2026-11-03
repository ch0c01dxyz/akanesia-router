// Persistensi cooldown Antigravity (Argon) di kv store.
//
// Masalah: quotaCache Antigravity hanya in-memory — entri 0% (kuota habis
// sampai resetAt) hilang saat server restart, sehingga akun yang mestinya
// dilewati justru dicoba lagi. Modul ini menyimpan entri 0% yang masih
// berlaku ke kv scope "argonCooldowns" dan mengembalikannya ke cache
// in-memory sekali per proses (saat pertama kali dibutuhkan setelah
// restart). Entri kedaluwarsa diabaikan saat dibaca (dan dibersihkan
// oportunistik) — tidak ada TTL machinery tambahan. Semua fungsi fail-open:
// gagal baca/tulis kv tidak boleh mengganggu alur quota.

import { makeKv } from "@/lib/db/helpers/kvStore.js";

const SCOPE = "argonCooldowns";
const kv = makeKv(SCOPE);

const keyFor = (connectionId, model) => `${connectionId}|${model}`;

let restored = false;

export async function saveAntigravityCooldown(connectionId, model, resetAtMs) {
  try {
    if (!connectionId || !model || !Number.isFinite(resetAtMs) || resetAtMs <= Date.now()) return;
    await kv.set(keyFor(connectionId, model), { resetAt: new Date(resetAtMs).toISOString() });
  } catch {
    // Fail-open: hilangnya persistensi bukan alasan menggagalkan request.
  }
}

// Simpan semua entri 0% yang masih berlaku dari satu snapshot quota.
export async function saveAntigravityCooldowns(connectionId, quotas) {
  try {
    if (!connectionId || !quotas || typeof quotas !== "object") return;
    const entries = {};
    for (const [model, quota] of Object.entries(quotas)) {
      if (quota?.remainingPercentage <= 0 && quota?.resetAt) {
        const ms = new Date(quota.resetAt).getTime();
        if (Number.isFinite(ms) && ms > Date.now()) {
          entries[keyFor(connectionId, model)] = { resetAt: quota.resetAt };
        }
      }
    }
    if (Object.keys(entries).length > 0) await kv.setMany(entries);
  } catch {
    // Fail-open, lihat saveAntigravityCooldown.
  }
}

// Muat entri yang masih berlaku: Map connectionId -> { model: quotaEntry }.
// Entri kedaluwarsa/rusak dihapus oportunistik saat dibaca.
export async function loadPersistedAntigravityCooldowns() {
  const out = new Map();
  try {
    const all = await kv.getAll();
    const expired = [];
    for (const [key, value] of Object.entries(all)) {
      const ms = value?.resetAt ? new Date(value.resetAt).getTime() : NaN;
      const sep = key.indexOf("|");
      if (!Number.isFinite(ms) || ms <= Date.now() || sep === -1) {
        expired.push(key);
        continue;
      }
      const connectionId = key.slice(0, sep);
      const model = key.slice(sep + 1);
      if (!out.has(connectionId)) out.set(connectionId, {});
      out.get(connectionId)[model] = { remainingPercentage: 0, resetAt: value.resetAt };
    }
    for (const key of expired) {
      try {
        await kv.remove(key);
      } catch {
        // Abaikan — pembersihan bukan jalur kritis.
      }
    }
  } catch {
    // Fail-open: kembalikan apa pun yang sempat terkumpul (bisa kosong).
  }
  return out;
}

export async function clearPersistedAntigravityCooldowns(connectionId) {
  try {
    if (!connectionId) return;
    const all = await kv.getAll();
    for (const key of Object.keys(all)) {
      if (key.startsWith(`${connectionId}|`)) await kv.remove(key);
    }
  } catch {
    // Fail-open.
  }
}

// Gabungkan entri tersimpan ke cache in-memory — hanya model yang belum
// ada di memori (data segar upstream selalu menang). Sekali per proses;
// setelah restart, state modul ikut reset sehingga restore berjalan lagi.
export async function ensureAntigravityCooldownsRestored(cacheMap) {
  if (restored || !cacheMap) return;
  restored = true;
  const persisted = await loadPersistedAntigravityCooldowns();
  for (const [connectionId, models] of persisted) {
    const current = cacheMap.get(connectionId) || {};
    let changed = false;
    for (const [model, entry] of Object.entries(models)) {
      if (!current[model]) {
        current[model] = entry;
        changed = true;
      }
    }
    if (changed) cacheMap.set(connectionId, current);
  }
}

// Test-only: kembalikan flag restore seolah modul baru dimuat (restart).
export function __resetArgonCooldownRestoreForTests() {
  restored = false;
}
