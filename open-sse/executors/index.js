/**
 * Lazy-load executor (ide #1).
 *
 * Dulu: semua file executor di-import eager + di-instantiate di module scope,
 * sehingga me-load 9router berarti mengeksekusi ±70 modul upstream sekaligus.
 * Sekarang: hanya manifest ringan (adapters.manifest.js, hasil generate) yang
 * di-import eager; file adapter di-load on-demand via dynamic import.
 *
 * - getAdapter(id): async, cache Map + dedupe promise in-flight (singleflight).
 *   Banyak request konkuren ke adapter yang sama berbagi satu Promise.
 *   Rejection TIDAK di-cache agar request berikutnya bisa retry.
 *   Satu adapter gagal di-load ≠ registry mati (error terisolasi per-adapter).
 * - getExecutor(provider): async, wrapper fail-open — bila adapter spesialis
 *   gagal di-load, fallback ke DefaultExecutor (kontrak lama).
 * - hasSpecializedExecutor(provider): sync, cek tabel definisi saja.
 *
 * Adapter tetap di disk, di luar bundle: dynamic import memakai file URL
 * (pathToFileURL, bukan path mentah; ekstensi wajib) + escape hatch
 * webpackIgnore/turbopackIgnore. Daftar executor baru di adapterDefs.js
 * (bukan di sini), lalu regen: node scripts/generate-registry-index.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ADAPTER_DEFS } from "./adapterDefs.js";
import { ADAPTER_MANIFEST } from "./adapters.manifest.js";

// Direktori fisik adapter di runtime. Urutan: checkout repo (dev,
// custom-server, vitest) dulu, lalu hasil trace standalone Next.js.
function cariDirektoriExecutors() {
  const kandidat = [
    path.join(process.cwd(), "open-sse", "executors"),
    path.join(process.cwd(), ".next", "standalone", "open-sse", "executors"),
  ];
  for (const dir of kandidat) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      // abaikan kandidat yang tidak bisa dibaca, lanjut ke berikutnya
    }
  }
  return kandidat[0]; // biar error import-nya jelas bila dua-duanya hilang
}

const EXECUTORS_DIR = cariDirektoriExecutors();

/**
 * Pabrik loader adapter. `manifest`: id → { file, exportName, args }.
 * `toFileUrl`: file relatif → string file URL. `importModule`: (url) => Promise<mod>.
 * Dipisah agar logika murni (cache, singleflight, isolasi error) bisa diuji
 * tanpa network / tanpa menyentuh disk (tests/unit/executor-lazy-load.test.js).
 */
export function createAdapterLoader({ manifest, toFileUrl, importModule }) {
  const instances = new Map(); // id → instance yang sudah berhasil di-load
  const inflight = new Map(); // id → Promise<instance> yang sedang berjalan

  function definisiUntuk(id, paksaDefault) {
    if (!paksaDefault && manifest[id]) return manifest[id];
    // Provider tanpa adapter spesialis (atau fallback darurat): DefaultExecutor.
    return { file: "./default.js", exportName: "DefaultExecutor", args: [id] };
  }

  async function muatInstance(id, paksaDefault = false) {
    const def = definisiUntuk(id, paksaDefault);
    const url = toFileUrl(def.file);
    let mod;
    try {
      mod = await importModule(url);
    } catch (err) {
      throw new Error(`[executors] gagal me-load adapter "${id}" dari ${def.file}: ${err?.message || err}`);
    }
    const Cls = def.exportName === "default" ? mod.default : mod[def.exportName];
    if (typeof Cls !== "function") {
      throw new Error(`[executors] export "${def.exportName}" tidak ditemukan di ${def.file} (adapter "${id}")`);
    }
    return new Cls(...(def.args || []));
  }

  async function getAdapterInternal(id, paksaDefault = false) {
    const key = paksaDefault ? `default:${id}` : String(id);
    if (instances.has(key)) return instances.get(key);
    if (inflight.has(key)) return inflight.get(key); // singleflight
    const p = muatInstance(String(id), paksaDefault).then(
      (inst) => {
        instances.set(key, inst);
        inflight.delete(key);
        return inst;
      },
      (err) => {
        inflight.delete(key); // rejection TIDAK di-cache → bisa retry
        throw err;
      }
    );
    inflight.set(key, p);
    return p;
  }

  // API utama ide #1: akses adapter secara lazy.
  async function getAdapter(id) {
    return getAdapterInternal(id, false);
  }

  // Kontrak lama: async, fail-open ke DefaultExecutor bila adapter spesialis rusak.
  async function getExecutor(provider) {
    try {
      return await getAdapterInternal(provider, false);
    } catch (err) {
      console.warn(`[executors] adapter "${provider}" gagal, fallback ke DefaultExecutor: ${err?.message || err}`);
      return getAdapterInternal(provider, true);
    }
  }

  function sudahDiLoad(id) {
    return instances.has(String(id));
  }

  function resetCache() {
    instances.clear();
    inflight.clear();
  }

  return { getAdapter, getExecutor, sudahDiLoad, resetCache };
}

const loader = createAdapterLoader({
  manifest: ADAPTER_MANIFEST,
  toFileUrl: (file) => pathToFileURL(path.join(EXECUTORS_DIR, file)).href,
  // Escape hatch: adapter tetap di disk, di luar bundle webpack/turbopack.
  importModule: (url) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
});

export const getAdapter = (id) => loader.getAdapter(id);
export const getExecutor = (provider) => loader.getExecutor(provider);

export function hasSpecializedExecutor(provider) {
  return !!ADAPTER_DEFS[provider];
}

// Re-export ringan untuk kompatibilitas (base.js tidak punya dependensi berat).
export { BaseExecutor } from "./base.js";
export { ADAPTER_DEFS } from "./adapterDefs.js";
export { ADAPTER_MANIFEST, ADAPTER_IDS, ADAPTER_FILES } from "./adapters.manifest.js";
