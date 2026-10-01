// Utilitas bersama untuk fitur Route-Masking (menu dashboard "Route-Masking").
// Route-Masking memetakan NAMA SAMARAN -> "provider/model" asli. Harness
// memanggil chat dengan nama samaran; gateway me-routing ke model asli dan
// respons tetap menampilkan nama model asli (bukan blind masking penuh).

import { resolveProviderAlias } from "open-sse/services/model.js";

// Penanda owned_by untuk entri nama samaran di /v1/models.
export const ROUTE_MASKING_OWNED_BY = "route-masking";

// Normalisasi key penyimpanan: lowercase + trim, agar lookup case-insensitive
// (aturan duplikat memakai perbandingan case-insensitive).
export function normalizeMaskKey(alias) {
  return String(alias || "").trim().toLowerCase();
}

// Nama samaran berformat "prefix/model" — prefix boleh virtual (tidak
// terdaftar, mis. "routerlokal") atau prefix provider asli. Contoh valid:
// "routerlokal/glm-5.3-flash", "dahono/glm-5.3-flashx".
export const ROUTE_MASK_NAME_REGEX = /^[a-zA-Z0-9_.\-]+\/[^\s]+$/;
export const ROUTE_MASK_NAME_MAX_LENGTH = 128;

// Aturan kredensial: SAMA dengan filter /v1/models (buildModelsList).
// Koneksi tanpa apiKey/accessToken/refreshToken disembunyikan, kecuali
// authType none/free/optional dan ollama-local yang memang tidak butuh kunci.
export function koneksiPunyaKredensial(conn) {
  if (!conn) return false;
  const authType = String(conn.authType || "").toLowerCase();
  if (authType === "none" || authType === "free" || authType === "optional") return true;
  if (conn.provider === "ollama-local") return true;
  return [conn.apiKey, conn.accessToken, conn.refreshToken]
    .some((v) => typeof v === "string" && v.trim() !== "");
}

// Cari koneksi aktif + berkredensial untuk bagian provider dari target
// "provider/model". providerPart bisa berupa id provider bawaan, alias
// provider (mis. "o" -> "openai"), atau prefix node kustom.
export function cariKoneksiBerkredensial(providerPart, connections) {
  if (!providerPart || !Array.isArray(connections)) return null;
  const target = String(providerPart).trim();
  if (!target) return null;
  let providerId = null;
  try {
    providerId = resolveProviderAlias(target);
  } catch {
    providerId = null;
  }
  for (const conn of connections) {
    if (!conn || conn.isActive === false) continue;
    const cocokProvider = providerId && conn.provider === providerId;
    const cocokPrefix = conn.providerSpecificData?.prefix === target;
    if (!cocokProvider && !cocokPrefix) continue;
    if (koneksiPunyaKredensial(conn)) return conn;
  }
  return null;
}

// Validasi murni (sync) untuk pasangan nama samaran -> target "provider/model".
// Aturan duplikat dari Egar: yang dilarang hanya bila nama samaran SAMA
// PERSIS (full string, case-insensitive) dengan model asli. Contoh:
// - "dahono/glm-5.3-flash" -> "routerlokal/glm-5.3-flash" : diizinkan
// - "dahono/glm-5.3-flash" -> "dahono/glm-5.3-flash"       : DITOLAK
// - "dahono/glm-5.3-flash" -> "dahono/glm-5.3-flashx"      : diizinkan
// Mengembalikan { ok: true, alias, target, providerPart, modelPart } atau
// { ok: false, error } dengan pesan error yang aman ditampilkan ke UI.
export function validateRouteMaskInput(alias, model) {
  const namaSamaran = typeof alias === "string" ? alias.trim() : "";
  const target = typeof model === "string" ? model.trim() : "";

  if (!namaSamaran) {
    return { ok: false, error: "Nama samaran wajib diisi." };
  }
  if (namaSamaran.length > ROUTE_MASK_NAME_MAX_LENGTH) {
    return { ok: false, error: `Nama samaran maksimal ${ROUTE_MASK_NAME_MAX_LENGTH} karakter.` };
  }
  if (!ROUTE_MASK_NAME_REGEX.test(namaSamaran)) {
    return { ok: false, error: "Nama samaran harus berformat \"prefix/model\" (contoh: routerlokal/glm-5.3-flash)." };
  }

  if (!target) {
    return { ok: false, error: "Model target wajib dipilih." };
  }
  const slash = target.indexOf("/");
  if (slash <= 0 || slash === target.length - 1) {
    return { ok: false, error: "Model target harus berformat \"provider/model\"." };
  }
  const providerPart = target.slice(0, slash).trim();
  const modelPart = target.slice(slash + 1).trim();
  if (!providerPart || !modelPart) {
    return { ok: false, error: "Model target harus berformat \"provider/model\"." };
  }

  // Syarat dari Egar: nama samaran tidak boleh duplikat dengan nama model asli.
  if (namaSamaran.toLowerCase() === target.toLowerCase()) {
    return { ok: false, error: "Masking model should be different than model real name" };
  }

  return { ok: true, alias: namaSamaran, target, providerPart, modelPart };
}
