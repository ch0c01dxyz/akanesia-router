/**
 * Regenerate open-sse/providers/registry/index.js from the registry entries on disk,
 * plus open-sse/executors/adapters.manifest.js (ide #1: lazy-load executor).
 *
 * The index is auto-generated: static imports for every provider entry, in
 * alphabetical file order. Do NOT edit index.js by hand — add/remove a
 * `<id>.js` entry file and re-run:
 *
 *   node scripts/generate-registry-index.mjs
 *
 * Manifest adapter (adapters.manifest.js) juga auto-generated: peta id → file
 * adapter + metadata ringan untuk UI. Sumbernya:
 *   - open-sse/executors/adapterDefs.js (ADAPTER_DEFS: adapter spesialis), dan
 *   - open-sse/providers/registry/*.js (id tiap provider → DefaultExecutor).
 * Do NOT edit adapters.manifest.js by hand — ubah adapterDefs.js / registry,
 * lalu re-run script ini.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADAPTER_DEFS } from "../open-sse/executors/adapterDefs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../open-sse/providers/registry");
const executorsDir = path.resolve(here, "../open-sse/executors");

// ── 1. registry/index.js (perilaku lama, tidak berubah) ──────────────────────
// Provider yang SENGAJA dinonaktifkan: tetap di disk, tapi tidak di-import
// (dipertahankan sebagai baris komentar agar niatnya eksplisit).
const NONAKTIF = new Map([
  ["trae.js", "Temporarily hidden — no tool calling support (trae SOLO agent / windsurf gRPC skip ToolCallChunk)."],
  ["devin-cli.js", "Disabled."],
  ["windsurf.js", "Disabled."],
]);

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".js") && f !== "index.js")
  .sort((a, b) => a.localeCompare(b, "en"));

const filesAktif = files.filter((f) => !NONAKTIF.has(f));

const lines = ["// Auto-generated: static imports for all registry entries"];
filesAktif.forEach((f, i) => lines.push(`import p${i} from "./${f}";`));
// Pertahankan entri nonaktif sebagai komentar (niat eksplisit, bukan lupa).
for (const [f, alasan] of NONAKTIF) {
  if (files.includes(f)) lines.push(`// Nonaktif (${alasan}): import "./${f}" sengaja dimatikan.`);
}
lines.push("export default [");
filesAktif.forEach((_, i) => lines.push(`  p${i},`));
lines.push("];", "");

fs.writeFileSync(path.join(dir, "index.js"), lines.join("\n"));
console.log(`wrote index.js with ${filesAktif.length} entries (${files.length - filesAktif.length} nonaktif dilewati)`);

// ── 2. executors/adapters.manifest.js (ide #1) ───────────────────────────────
// Ambil id tiap provider dari isi file (bukan nama file: mis. mlx.js → "mlx-gemma").
function bacaIdRegistry(namaFile) {
  const src = fs.readFileSync(path.join(dir, namaFile), "utf8");
  const m = src.match(/^\s*id:\s*["']([^"']+)["']/m);
  if (!m) throw new Error(`registry/${namaFile}: field id tidak ditemukan`);
  return m[1];
}

const registryIds = filesAktif.map(bacaIdRegistry);

// Validasi: tidak boleh ada duplikat id.
const terlihat = new Set();
const duplikat = [];
for (const id of registryIds) {
  if (terlihat.has(id)) duplikat.push(id);
  terlihat.add(id);
}
if (duplikat.length > 0) {
  throw new Error(`id registry duplikat: ${duplikat.join(", ")}`);
}

// Validasi: definisi adapter tidak boleh menabrak antar key yang sama dengan
// file/export berbeda (duplikat key di object literal JS akan diam-diam menang
// yang terakhir — cegah dengan cek eksplisit di sini bila perlu).
const manifest = {};
const kunciDuplikat = [];
function tambahKeManifest(id, def, specialized) {
  if (manifest[id]) kunciDuplikat.push(id);
  manifest[id] = { file: def.file, exportName: def.exportName, args: def.args || [], specialized };
}

// Adapter spesialis dulu (dari adapterDefs.js).
// Lewati adapter milik provider yang SENGAJA dinonaktifkan (NONAKTIF di atas):
// file adapter-nya dicocokkan ke nama file registry yang nonaktif.
const fileNonaktif = new Set([...NONAKTIF.keys()].map((f) => `./${f}`));
for (const [id, def] of Object.entries(ADAPTER_DEFS)) {
  if (fileNonaktif.has(def.file)) continue; // provider nonaktif → jangan petakan
  if (!def.file || !def.exportName) {
    throw new Error(`ADAPTER_DEFS["${id}"]: file/exportName wajib diisi`);
  }
  // Keamanan: file adapter harus di dalam open-sse/executors/ (tidak boleh ../).
  const resolved = path.resolve(executorsDir, def.file);
  if (!resolved.startsWith(executorsDir + path.sep)) {
    throw new Error(`ADAPTER_DEFS["${id}"]: file "${def.file}" keluar dari open-sse/executors/`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`ADAPTER_DEFS["${id}"]: file "${def.file}" tidak ada di disk`);
  }
  tambahKeManifest(id, def, true);
}

// Semua provider registry tanpa adapter spesialis → DefaultExecutor.
for (const id of registryIds) {
  if (manifest[id]) continue; // sudah punya adapter spesialis
  tambahKeManifest(id, { file: "./default.js", exportName: "DefaultExecutor", args: [id] }, false);
}

if (kunciDuplikat.length > 0) {
  throw new Error(`id adapter duplikat: ${kunciDuplikat.join(", ")}`);
}

const ids = Object.keys(manifest).sort((a, b) => a.localeCompare(b, "en"));
const daftarFile = [...new Set(ids.map((id) => manifest[id].file))].sort((a, b) => a.localeCompare(b, "en"));

const barisManifest = [
  "// Auto-generated by scripts/generate-registry-index.mjs — DO NOT edit manually.",
  "// Peta id → file adapter + metadata ringan untuk UI (ide #1: lazy-load executor).",
  "// Di-import eager oleh open-sse/executors/index.js; file adapter sendiri",
  "// tetap di disk dan di-load on-demand via getAdapter().",
  `export const ADAPTER_MANIFEST = ${JSON.stringify(manifest, null, 2)};`,
  `export const ADAPTER_IDS = ${JSON.stringify(ids)};`,
  `export const ADAPTER_FILES = ${JSON.stringify(daftarFile)};`,
  "",
];

fs.writeFileSync(path.join(executorsDir, "adapters.manifest.js"), barisManifest.join("\n"));
const spesialis = ids.filter((id) => manifest[id].specialized).length;
console.log(
  `wrote adapters.manifest.js: ${ids.length} id (${spesialis} spesialis, ${ids.length - spesialis} default), ` +
    `${daftarFile.length} file unik, ${registryIds.length} id registry terpetakan`
);
