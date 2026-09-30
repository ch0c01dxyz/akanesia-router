// Pre-fetch remote image URLs into base64 BEFORE translation, for target
// formats whose upstream providers cannot fetch remote URLs themselves
// (they require inline base64). Runs on the source-format body.
import { Agent } from "undici";
import { FORMATS } from "../formats.js";
import { fetchImageAsBase64, parseDataUri, resolvePinnedIps } from "./image.js";
import { PREFETCH_CONCURRENCY } from "../../config/mediaConfig.js";

// Targets that require inline base64 images (cannot accept remote URLs).
const TARGETS_NEED_BASE64 = new Set([
  FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX,
  FORMATS.ANTIGRAVITY, FORMATS.OLLAMA, FORMATS.KIRO,
  FORMATS.COMMANDCODE,
]);

function isRemoteUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

// Collect {get,set} accessors for every remote image URL in a source body.
function collectImageRefs(body, sourceFormat) {
  const refs = [];
  const pushOpenAI = (messages) => {
    for (const msg of messages || []) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block?.type === "image_url") {
          const url = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
          if (isRemoteUrl(url)) refs.push({ get: () => url, set: (v) => {
            if (typeof block.image_url === "string") block.image_url = v; else block.image_url.url = v;
          } });
        }
      }
    }
  };
  const pushGemini = (contents) => {
    for (const c of contents || []) {
      for (const p of c.parts || []) {
        const uri = p?.fileData?.fileUri;
        if (isRemoteUrl(uri)) refs.push({ get: () => uri, part: p });
      }
    }
  };

  switch (sourceFormat) {
    case FORMATS.OPENAI:
    case FORMATS.OLLAMA:
    case FORMATS.KIRO:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
      pushOpenAI(body.messages);
      break;
    case FORMATS.CLAUDE:
      for (const msg of body.messages || []) {
        if (!Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
          if (block?.type === "image" && block.source?.type === "url" && isRemoteUrl(block.source.url)) {
            refs.push({ get: () => block.source.url, claudeBlock: block });
          }
        }
      }
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
      pushGemini(body.contents);
      break;
    case FORMATS.ANTIGRAVITY:
      pushGemini(body?.request?.contents);
      break;
    default:
      pushOpenAI(body.messages);
  }
  return refs;
}

/**
 * Replace remote image URLs with base64 data when the target needs inline data.
 * No-op when target accepts remote URLs (e.g. openai, claude) or body has none.
 *
 * Unduhan berjalan PARALEL (batas PREFETCH_CONCURRENCY) karena prefetch ada di
 * jalur TTFT — unduhan serial menambah langsung ke latency respons pertama.
 * Hasil diterapkan ke body sesuai urutan refs semula (deterministik).
 * Kegagalan satu gambar bersifat fail-open per gambar (dilewati, tidak
 * menggagalkan yang lain) — sama seperti perilaku serial sebelumnya.
 * Timeout per gambar tetap ditangani di fetchImageAsBase64 via options.
 * @returns {Promise<number>} count of images converted
 */
export async function prefetchRemoteImages(body, sourceFormat, targetFormat, options = {}) {
  if (!body || !TARGETS_NEED_BASE64.has(targetFormat)) return 0;
  const refs = collectImageRefs(body, sourceFormat);
  if (!refs.length) return 0;

  // Cache Agent per hostname dalam satu sesi prefetch. Lookup di-pin ke IP
  // tervalidasi (anti-TOCTOU), sehingga satu Agent tidak boleh dipakai lintas
  // hostname — cache ini menghilangkan "satu Agent per gambar" tanpa melemahkan
  // SSRF guard. Nilai berupa Promise agar resolve konkuren untuk hostname yang
  // sama hanya terjadi sekali; null = hostname ditolak SSRF guard.
  const cacheDispatcher = new Map();
  const dapatkanDispatcher = (hostname) => {
    const kunci = hostname.toLowerCase();
    let janji = cacheDispatcher.get(kunci);
    if (!janji) {
      janji = (async () => {
        try {
          const pinned = await resolvePinnedIps(kunci);
          if (!pinned) return null;
          return new Agent({
            connect: { lookup: (_h, _o, cb) => cb(null, [{ address: pinned[0].address, family: pinned[0].family }]) },
          });
        } catch {
          return null;
        }
      })();
      cacheDispatcher.set(kunci, janji);
    }
    return janji;
  };

  try {
    // Fase 1 — unduh paralel dengan batas konkurensi; hasil diindeks sesuai
    // urutan refs agar fase penerapan tetap deterministik.
    const unduhan = await petaParalelBatas(refs, PREFETCH_CONCURRENCY, async (ref) => {
      const url = ref.get();
      if (parseDataUri(url)) return null; // sudah inline — dilewati seperti sebelumnya
      let hostname;
      try { hostname = new URL(url).hostname; }
      catch { return null; } // URL tidak valid — fail-open seperti sebelumnya
      const dispatcher = await dapatkanDispatcher(hostname);
      // Tanpa dispatcher (SSRF guard menolak): panggil tanpa dispatcher agar
      // fetchImageAsBase64 memakai jalur pinning internalnya — hasil akhirnya
      // tetap null (fail-open), sama seperti perilaku serial sebelumnya.
      const fetched = await fetchImageAsBase64(url, dispatcher ? { ...options, dispatcher } : options);
      if (!fetched) return null;
      return { ref, fetched };
    });

    // Fase 2 — terapkan ke body sesuai urutan semula (tiap ref menyentuh
    // bloknya sendiri; pemisahan fase menjaga hasil tetap terurut).
    let converted = 0;
    for (const item of unduhan) {
      if (!item) continue;
      const { ref, fetched } = item;
      if (ref.set) ref.set(fetched.url);
      else if (ref.part) { delete ref.part.fileData; ref.part.inlineData = { mimeType: fetched.mimeType, data: fetched.url.split(",")[1] }; }
      else if (ref.claudeBlock) ref.claudeBlock.source = { type: "base64", media_type: fetched.mimeType, data: fetched.url.split(",")[1] };
      converted++;
    }
    return converted;
  } finally {
    // Tutup semua Agent sesi; unduhan sudah selesai sehingga tidak ada
    // koneksi yang masih dipakai.
    await Promise.allSettled(Array.from(cacheDispatcher.values(), async (janji) => {
      try { await (await janji)?.close(); } catch { /* abaikan */ }
    }));
  }
}

// Worker pool sederhana dengan batas konkurensi: hasil tetap sesuai urutan
// input (diindeks), dan error per item tidak menghentikan worker lain
// (fail-open per item — samakan dengan perilaku serial sebelumnya).
async function petaParalelBatas(daftar, batas, fn) {
  const hasil = new Array(daftar.length);
  let berikutnya = 0;
  async function pekerja() {
    for (;;) {
      const i = berikutnya++;
      if (i >= daftar.length) return;
      try {
        hasil[i] = await fn(daftar[i], i);
      } catch {
        hasil[i] = null;
      }
    }
  }
  const n = Math.max(1, Math.min(batas, daftar.length));
  await Promise.all(Array.from({ length: n }, pekerja));
  return hasil;
}
