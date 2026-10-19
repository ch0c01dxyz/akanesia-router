/**
 * Gate anchors untuk OpenCode free-tier (P3, diadopsi dari opencode-free-bridge).
 *
 * Hasil eksperimen replay terhadap gate upstream:
 * - Gate mengecek NAMA tool: tool "read" WAJIB ada di daftar tools.
 *   (fabricated "read" lolos; real "read" yang di-rename gagal.)
 * - Gate mengecek header: user-agent, x-opencode-session, x-session-affinity.
 *
 * Konstanta ini di-pin independen dari mekanisme fingerprint agar perubahan
 * bentuk (shape bug) di fingerprint tidak terbaca sebagai IP block, dan agar
 * penghapusan tak sengaja tertangkap oleh test.
 *
 * JANGAN hapus "read" dari OPENCODE_FINGERPRINT_TOOLS atau header di bawah
 * ini dari direct lanes (opencode-go / opencode-zen) tanpa verifikasi live.
 */

// Nama tool yang wajib ada — gate menolak request tanpa tool bernama ini.
export const OPENCODE_GATE_ANCHOR_TOOL = "read";

// Header esensial yang wajib dikirim ke upstream free-tier.
export const OPENCODE_GATE_ANCHOR_HEADERS = Object.freeze([
  "user-agent",
  "x-opencode-session",
  "x-session-affinity",
]);

/**
 * Validasi defensif: kembalikan daftar anchor yang hilang.
 * @param {{ headers?: object, tools?: Array }} req
 * @returns {string[]} daftar peringatan (kosong = lengkap)
 */
export function checkGateAnchors({ headers = {}, tools = [] } = {}) {
  const warnings = [];
  const lower = {};
  for (const k of Object.keys(headers || {})) lower[String(k).toLowerCase()] = true;
  for (const h of OPENCODE_GATE_ANCHOR_HEADERS) {
    if (!lower[h]) warnings.push(`missing gate header: ${h}`);
  }
  const names = (tools || []).map((t) => t?.function?.name || t?.name).filter(Boolean);
  if (!names.includes(OPENCODE_GATE_ANCHOR_TOOL)) {
    warnings.push(`missing gate tool: "${OPENCODE_GATE_ANCHOR_TOOL}"`);
  }
  return warnings;
}
